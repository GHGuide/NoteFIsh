import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createCallService } from '../server/calls.mjs';

const sid = 'CA' + '4'.repeat(32), streamSid = 'MZ' + '5'.repeat(32), account = 'AC' + '6'.repeat(32);
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
  message(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
}

function harness({ streamFails = false } = {}) {
  let data = { version: 2, voices: [{ id: 'v', referenceId: 'ref_stream_0001', kind: 'enrolled', status: 'ready', archived: false, register: 'calm' }],
    settings: { voiceId: 'v', agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' }, agents: [], calls: [] };
  let work = Promise.resolve();
  const store = { snapshot: () => structuredClone(data), update(fn) { const next = work.then(async () => { const copy = structuredClone(data); const r = await fn(copy); data = copy; return structuredClone(r); }); work = next.catch(() => {}); return next; } };
  const invoked = [];
  const providers = {
    transcribe: async () => 'Hello there.',
    translate: async () => 'Bonjour.',
    synthesize: async args => { invoked.push(['synthesize', args]); return Buffer.alloc(500, 0x11); },
    synthesizeStream: async args => {
      invoked.push(['stream', args]);
      if (streamFails) throw new Error('live socket down');
      // Three chunks of 16 kHz PCM16, 40 ms each; one has an odd number of sample pairs to exercise the carry.
      for (const size of [1280, 1282, 1278]) { args.onChunk(Buffer.alloc(size, 0x22)); await delay(2); }
      return { bytes: 3840 };
    },
  };
  const service = createCallService({ config: { twilioAccountSid: account, twilioNumber: '+12025550123', fishModel: 's2.1-pro-free' }, store, providers, broadcast: () => {}, convert: async () => Buffer.alloc(800, 0x7f) });
  return { service, invoked, store };
}

test('a reply streams to Twilio as G.711 frames while Fish is still speaking, then a mark', async t => {
  const f = harness(); t.after(() => f.service.close());
  const call = await f.service.registerInbound({ callSid: sid, from: '+33612345678', to: '+12025550123' }); const ws = new Socket();
  f.service.handleStream(ws);
  ws.message({ event: 'start', streamSid, start: { accountSid: account, callSid: sid, streamSid, tracks: ['inbound'], customParameters: { callId: call.id }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } });
  await delay(2); await f.service.answer(call.id); ws.sent.length = 0;
  const replied = await f.service.say(call.id, { text: 'Hello there.' });
  assert.equal(replied.phase, 'playing');
  const media = ws.sent.filter(event => event.event === 'media');
  assert.ok(media.length >= 3, `frames arrive per chunk, got ${media.length}`);
  const bytes = media.reduce((sum, event) => sum + Buffer.from(event.media.payload, 'base64').length, 0);
  assert.equal(bytes, 960, '3840 PCM bytes at 16 kHz become 960 G.711 bytes at 8 kHz, nothing dropped at chunk edges');
  assert.equal(ws.sent.at(-1).event, 'mark', 'the mark closes the streamed reply');
  assert.equal(f.invoked.some(([kind]) => kind === 'synthesize'), false, 'the one-shot path was not needed');
  assert.match(f.invoked.find(([kind]) => kind === 'stream')[1].text, /^\[[^\]]+\] Bonjour\.$/, 'the tagged text goes to the live socket');
});

test('when the live socket fails before any audio, the reply falls back to one-shot synthesis', async t => {
  const f = harness({ streamFails: true }); t.after(() => f.service.close());
  const call = await f.service.registerInbound({ callSid: sid, from: '+33612345678', to: '+12025550123' }); const ws = new Socket();
  f.service.handleStream(ws);
  ws.message({ event: 'start', streamSid, start: { accountSid: account, callSid: sid, streamSid, tracks: ['inbound'], customParameters: { callId: call.id }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } });
  await delay(2); await f.service.answer(call.id); ws.sent.length = 0;
  const replied = await f.service.say(call.id, { text: 'Hello there.' });
  assert.equal(replied.phase, 'playing');
  assert.ok(f.invoked.some(([kind]) => kind === 'synthesize'), 'one-shot synthesis took over');
  assert.equal(ws.sent.at(-1).event, 'mark');
  assert.ok(replied.transcript.at(-1).delivery === 'pending');
});
