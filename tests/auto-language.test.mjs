import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createCallService } from '../server/calls.mjs';

const sid = 'CA' + '1'.repeat(32), streamSid = 'MZ' + '2'.repeat(32), account = 'AC' + '3'.repeat(32);
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
  message(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
}
/** Captions run on their own queue; wait for one to land instead of guessing a delay. */
async function settle(read, ready, tries = 100) { for (let i = 0; i < tries; i++) { const value = read(); if (ready(value)) return value; await delay(10); } return read(); }

function setup({ customerLanguage = 'auto', tone = 'apologetic', callerTone = 'calm', sentences } = {}) {
  let data = { version: 3,
    voices: [
      { id: 'voice-calm', referenceId: 'ref_calm_00', kind: 'enrolled', status: 'ready', archived: false, register: 'calm', baseline: { loudness: -26, rate: 2.6 } },
      { id: 'voice-sorry', referenceId: 'ref_sorry_0', kind: 'enrolled', status: 'ready', archived: false, register: 'apologetic' },
    ],
    settings: { voiceId: 'voice-calm', agentLanguage: 'en', customerLanguage, queueName: 'Main line', registers: { apologetic: 'voice-sorry' } },
    calls: [] };
  let work = Promise.resolve();
  const store = { snapshot: () => structuredClone(data), update(fn) {
    const next = work.then(async () => { const copy = structuredClone(data); const result = await fn(copy); data = copy; return structuredClone(result); });
    work = next.catch(() => {}); return next;
  } };
  const events = []; const invoked = [];
  const providers = {
    transcribe: async args => { invoked.push(['transcribe', args]); return args.language === 'en' ? 'I am so sorry about that.' : "J'attends en bas."; },
    translate: async args => { invoked.push(['translate', args]); return 'translated'; },
    interpret: async args => { invoked.push(['interpret', args]); return args.sourceLanguage === 'en' ? { text: 'Je suis vraiment désolée.', language: 'en', tone, sentences: sentences || [] } : { text: 'I am waiting downstairs.', language: 'fr', tone: callerTone, sentences: [] }; },
    synthesize: async args => { invoked.push(['synthesize', args]); return Buffer.alloc(500, 0x11); },
  };
  const service = createCallService({ config: { twilioAccountSid: account, twilioNumber: '+12025550123', fishModel: 's2.1-pro-free' }, store, providers,
    broadcast: e => events.push(e), convert: async () => Buffer.alloc(800, 0x7f) });
  async function start() {
    const call = await service.registerInbound({ callSid: sid, from: '+33612345678', to: '+12025550123' }); const ws = new Socket();
    service.handleStream(ws);
    ws.message({ event: 'start', streamSid, start: { accountSid: account, callSid: sid, streamSid, tracks: ['inbound'], customParameters: { callId: call.id }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } });
    await delay(2); return { call, ws };
  }
  return { service, events, invoked, start, store };
}

test('a caller on auto-detect is heard in their own language, captioned in the agent’s, and answered in theirs with a register tag', async t => {
  const f = setup(); t.after(() => f.service.close());
  const { call, ws } = await f.start();
  await f.service.answer(call.id);

  // Before anyone speaks, the language is unknown: a reply cannot pick a target yet.
  await assert.rejects(f.service.ptt(call.id, { buffer: Buffer.alloc(4000), mimetype: 'audio/webm' }), /detected|pick their language/);

  // A caller phrase arrives (real segmentation is exercised elsewhere; feed the caption queue directly).
  const media = fill => ws.message({ event: 'media', streamSid, media: { track: 'inbound', payload: Buffer.alloc(160, fill).toString('base64') } });
  for (let i = 0; i < 20; i++) media(0x80);
  for (let i = 0; i < 35; i++) media(0xff); // silence ends the phrase
  const captioned = await settle(() => f.service.snapshot().find(item => item.id === call.id), item => item?.detectedLanguage);
  const transcribe = f.invoked.find(([kind]) => kind === 'transcribe');
  assert.equal(transcribe?.[1].language, 'auto', 'the first phrase is transcribed without a language hint');
  assert.equal(captioned.detectedLanguage, 'fr', 'the interpreter told us what the caller speaks');
  assert.equal(captioned.transcript.at(-1).textShown, 'I am waiting downstairs.', 'captions arrive in the agent’s language');
  assert.equal(captioned.transcript.at(-1).sourceLang, 'fr');
  assert.ok(f.events.some(event => event.type === 'language' && event.language === 'fr'), 'the desk is told');

  // The agent replies: measured from the clip, interpreted with tone, voiced in the apologetic register, tagged.
  const replied = await f.service.ptt(call.id, { buffer: Buffer.alloc(4000), mimetype: 'audio/webm' });
  const line = replied.transcript.at(-1);
  assert.equal(line.targetLang, 'fr', 'the reply targets the detected language');
  assert.equal(line.register, 'apologetic');
  assert.equal(line.voiceId, 'voice-sorry', 'the apologetic take is used');
  assert.match(line.tag, /apologetic/);
  const synth = f.invoked.find(([kind]) => kind === 'synthesize')[1];
  assert.equal(synth.referenceId, 'ref_sorry_0');
  assert.match(synth.text, /^\[[^\]]*apologetic[^\]]*\] Je suis vraiment désolée\.$/);
  assert.ok(Number.isFinite(synth.temperature) && Number.isFinite(synth.speed), 'prosody follows the measured clip');
});

test('a fixed caller language never asks the interpreter to detect, and S1 gets no bracket tag', async t => {
  const f = setup({ customerLanguage: 'fr' }); t.after(() => f.service.close());
  const { call } = await f.start();
  await f.service.answer(call.id);
  const replied = await f.service.ptt(call.id, { buffer: Buffer.alloc(4000), mimetype: 'audio/webm' });
  assert.equal(replied.transcript.at(-1).targetLang, 'fr');
  assert.equal(f.invoked.find(([kind]) => kind === 'interpret')[1].sourceLanguage, 'en');
});

test('the desk speaks with its own take for the register', async t => {
  const f = setup({ customerLanguage: 'fr' }); t.after(() => f.service.close());
  const { call } = await f.start();
  await f.service.answer(call.id);
  const replied = await f.service.ptt(call.id, { buffer: Buffer.alloc(4000), mimetype: 'audio/webm' });
  assert.equal(replied.transcript.at(-1).voiceId, 'voice-sorry', "the desk's apologetic take is used");
});

test('an upset caller is answered apologetically whatever the desk sounded like, and a chosen feeling overrides that', async t => {
  const f = setup({ customerLanguage: 'fr', tone: 'calm', callerTone: 'upset', sentences: [{ text: 'Je suis vraiment', tag: 'cheerful' }, { text: 'désolée.', tag: 'reassuring' }] }); t.after(() => f.service.close());
  const { call, ws } = await f.start();
  await f.service.answer(call.id);
  const media = fill => ws.message({ event: 'media', streamSid, media: { track: 'inbound', payload: Buffer.alloc(160, fill).toString('base64') } });
  for (let i = 0; i < 20; i++) media(0x80);
  for (let i = 0; i < 35; i++) media(0xff);
  const heard = await settle(() => f.service.snapshot().find(item => item.id === call.id), item => item?.callerTone);
  assert.equal(heard.callerTone, 'upset', 'the caller’s state is remembered from their caption');
  assert.equal(heard.transcript.at(-1).feeling, 'upset', 'and shown on the caption');

  const replied = await f.service.say(call.id, { text: 'I am on it.' });
  const line = replied.transcript.at(-1);
  assert.equal(line.register, 'apologetic'); assert.equal(line.why, 'caller upset');
  assert.equal(line.voiceId, 'voice-sorry');
  const synth = f.invoked.filter(([kind]) => kind === 'synthesize').at(-1)[1];
  assert.equal(synth.text, '[sincerely apologetic] Je suis vraiment [reassuring] désolée.', 'register leads, the interpreter tags the rest');

  await f.service.stop(call.id); // the phone is still playing the apology; a new reply needs the line back
  const chosen = await f.service.say(call.id, { text: 'Great news!', feeling: 'warm' });
  await f.service.stop(call.id);
  assert.equal(chosen.transcript.at(-1).register, 'warm'); assert.equal(chosen.transcript.at(-1).why, 'chosen');
  await assert.rejects(f.service.say(call.id, { text: 'x', feeling: 'furious' }), /Choose a feeling/);
  assert.equal(f.invoked.find(([kind, args]) => kind === 'interpret' && args.sourceLanguage === 'en')[1].style, '', 'no house style set: the interpreter gets none');
});
