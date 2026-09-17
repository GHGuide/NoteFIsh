import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createCallService } from '../server/calls.mjs';
import { upsample16kTo24k } from '../server/live-captions.mjs';

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
  message(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  binary(buffer) { this.emit('message', buffer, true); }
}
const settle = async (read, ready, tries = 100) => { for (let i = 0; i < tries; i++) { const v = read(); if (ready(v)) return v; await delay(10); } return read(); };

function harness({ liveFails = false, customerLanguage = 'fr' } = {}) {
  let data = { version: 2, voices: [{ id: 'v', referenceId: 'ref_live_000001', kind: 'enrolled', status: 'ready', archived: false }],
    settings: { voiceId: 'v', agentLanguage: 'en', customerLanguage, queueName: 'Main line' }, agents: [], calls: [] };
  let work = Promise.resolve();
  const store = { snapshot: () => structuredClone(data), update(fn) { const next = work.then(async () => { const copy = structuredClone(data); const r = await fn(copy); data = copy; return structuredClone(r); }); work = next.catch(() => {}); return next; } };
  const events = []; const pushed = []; const sessions = []; const translated = [];
  const providers = {
    transcribe: async () => { throw new Error('the segmenter path must not run while live captions are up'); },
    translate: async ({ text, sourceLanguage, targetLanguage }) => { translated.push({ text, sourceLanguage, targetLanguage }); return `EN(${text})`; },
    interpret: async ({ text }) => ({ text: `EN: ${text}`, language: 'fr', tone: 'calm', sentences: [] }),
    synthesize: async () => Buffer.alloc(300, 0x11),
    openTranscription({ onPartial, onFinal }) {
      const session = { open: !liveFails, ready: liveFails ? Promise.reject(new Error('no realtime')) : Promise.resolve(), push: pcm => pushed.push(pcm), close() { session.open = false; session.closed = true; }, onPartial, onFinal };
      sessions.push(session); return session;
    },
  };
  const service = createCallService({ config: { twilioAccountSid: 'AC' + '7'.repeat(32), twilioNumber: '+12025550123', fishModel: 's1' }, store, providers, broadcast: e => events.push(e), convert: async () => Buffer.alloc(800, 0x7f) });
  return { service, events, pushed, sessions, translated };
}

test('a browser caller is captioned live: frames stream to the session, phrases come back as caption lines, partials reach the desk', async t => {
  const f = harness(); t.after(() => f.service.close());
  const call = await f.service.registerBrowserInbound({ from: 'Zoom' });
  const ws = new Socket(); f.service.handleBrowserStream(ws, { callId: call.id });
  await f.service.answer(call.id);
  assert.equal(f.sessions.length, 1, 'one live session per call');
  ws.binary(Buffer.alloc(640, 0x10)); ws.binary(Buffer.alloc(640, 0x10));
  await delay(5);
  assert.equal(f.pushed.length, 2, 'caller frames go to the live session, not the segmenter');
  f.sessions[0].onPartial('Bonjour, je');
  assert.ok(f.events.some(e => e.type === 'caption-partial' && e.text === 'Bonjour, je'), 'partials are shown while they speak');
  f.sessions[0].onFinal('Bonjour, je vous appelle pour ma commande.');
  const captioned = await settle(() => f.service.snapshot().find(item => item.id === call.id), item => item?.transcript.length);
  const line = captioned.transcript.at(-1);
  assert.equal(line.speaker, 'customer'); assert.equal(line.textSource, 'Bonjour, je vous appelle pour ma commande.'); assert.equal(line.textShown, 'EN: Bonjour, je vous appelle pour ma commande.');
  assert.ok(f.events.some(e => e.type === 'caption-partial' && e.text === ''), 'the partial is cleared once the phrase lands');
  assert.ok(ws.sent.some(e => e.type === 'caption' && e.who === 'you'), 'the caller still gets their own caption');
  await f.service.end(call.id);
  assert.equal(f.sessions[0].closed, true, 'the session closes with the call');
});

test('when the live session cannot start, the segmenter path carries on', async t => {
  const f = harness({ liveFails: true }); t.after(() => f.service.close());
  const call = await f.service.registerBrowserInbound({});
  const ws = new Socket(); f.service.handleBrowserStream(ws, { callId: call.id });
  await f.service.answer(call.id); await delay(5);
  ws.binary(Buffer.alloc(640, 0x10));
  await delay(5);
  assert.equal(f.pushed.length, 0, 'nothing is pushed to a failed session');
  assert.ok(f.events.some(e => e.type === 'error' || e.type === 'call'), 'the desk hears about it and the call continues');
  await f.service.end(call.id);
});

test('8→24 kHz resampling keeps timing: 16k in, 24k out, no drift', () => {
  const pcm = Buffer.alloc(640); for (let i = 0; i < 320; i++) pcm.writeInt16LE(i * 10, i * 2);
  const out = upsample16kTo24k(pcm);
  assert.equal(out.length, 960);
  assert.equal(out.readInt16LE(0), 0); assert.ok(Math.abs(out.readInt16LE(958) - 3190) <= 10);
});

test('the phrase so far is translated while the caller is still talking', async t => {
  const f = harness(); t.after(() => f.service.close());
  const call = await f.service.registerBrowserInbound({ from: 'Zoom' });
  const ws = new Socket(); f.service.handleBrowserStream(ws, { callId: call.id });
  await f.service.answer(call.id);

  f.sessions[0].onPartial('Bonjour, je vous appelle');
  const partial = await settle(() => f.events.filter(e => e.type === 'caption-partial').at(-1), e => e?.shown);
  assert.equal(partial.text, 'Bonjour, je vous appelle', 'the caller’s own words stay on screen');
  assert.equal(partial.shown, 'EN(Bonjour, je vous appelle)', 'and the agent reads them before the phrase ends');
  assert.deepEqual(f.translated.at(-1), { text: 'Bonjour, je vous appelle', sourceLanguage: 'fr', targetLanguage: 'en' });

  // A few more characters are not worth another call, and a partial is never a transcript line.
  const spent = f.translated.length;
  f.sessions[0].onPartial('Bonjour, je vous appelle.');
  await delay(20);
  assert.equal(f.translated.length, spent, 'a small addition does not spend another translation');
  assert.equal(f.service.snapshot().find(i => i.id === call.id).transcript.length, 0);

  // The finished phrase is authoritative: the partial clears and the interpreter writes the line.
  f.sessions[0].onFinal('Bonjour, je vous appelle pour ma commande.');
  const captioned = await settle(() => f.service.snapshot().find(i => i.id === call.id), i => i?.transcript.length);
  assert.equal(captioned.transcript.at(-1).textShown, 'EN: Bonjour, je vous appelle pour ma commande.');
  assert.ok(f.events.some(e => e.type === 'caption-partial' && e.text === ''), 'the partial is cleared once the phrase lands');
  await f.service.end(call.id);
});

test('a partial stays in the caller’s own words until auto-detect knows what they speak', async t => {
  const f = harness({ customerLanguage: 'auto' }); t.after(() => f.service.close());
  const call = await f.service.registerBrowserInbound({});
  const ws = new Socket(); f.service.handleBrowserStream(ws, { callId: call.id });
  await f.service.answer(call.id);

  f.sessions[0].onPartial('Bonjour, je vous appelle');
  await delay(20);
  assert.equal(f.translated.length, 0, 'there is no language pair to translate across yet');
  assert.ok(f.events.some(e => e.type === 'caption-partial' && e.text === 'Bonjour, je vous appelle' && !e.shown));

  // The first finished phrase names the language; partials after it are translated.
  f.sessions[0].onFinal('Bonjour, je vous appelle pour ma commande.');
  await settle(() => f.service.snapshot().find(i => i.id === call.id), i => i?.detectedLanguage);
  f.sessions[0].onPartial('Le chauffeur est en retard');
  const partial = await settle(() => f.events.filter(e => e.type === 'caption-partial').at(-1), e => e?.shown);
  assert.equal(partial.shown, 'EN(Le chauffeur est en retard)');
  assert.equal(f.translated.at(-1).sourceLanguage, 'fr', 'across the detected pair');
  await f.service.end(call.id);
});
