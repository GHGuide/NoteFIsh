import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createCallService } from '../server/calls.mjs';

const sid = 'CA' + '1'.repeat(32), streamSid = 'MZ' + '2'.repeat(32), account = 'AC' + '3'.repeat(32);
const from = '+33612345678', to = '+12025550123';
class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; sent = [];
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
  message(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  binary(value) { this.emit('message', value, true); }
}
function setup(options = {}) {
  let data = { version: 1, voices: [{ id: 'voice1', referenceId: 'approved_voice', kind: 'enrolled', status: 'ready', archived: false }],
    settings: { voiceId: 'voice1', agentLanguage: 'en', customerLanguage: 'fr' }, calls: [] };
  let work = Promise.resolve();
  const store = { snapshot: () => structuredClone(data), update(fn) {
    const next = work.then(async () => { const copy = structuredClone(data); const result = await fn(copy); data = copy; return structuredClone(result); });
    work = next.catch(() => {}); return next;
  } };
  const events = []; const invoked = [];
  const providers = {
    transcribe: async args => { invoked.push(['transcribe', args]); return 'Bonjour'; },
    translate: async args => { invoked.push(['translate', args]); return args.targetLanguage === 'fr' ? 'Je vous aide.' : 'Hello'; },
    synthesize: async args => { invoked.push(['synthesize', args]); return Buffer.alloc(500, 0x11); },
    ...options.providers,
  };
  const service = createCallService({ config: { twilioAccountSid: account, twilioNumber: to }, store, providers,
    broadcast: e => events.push(e), convert: async (audio, mimeType, opts) => {
      invoked.push(['convert', { audio, mimeType, opts }]); return Buffer.alloc(800, 0x7f);
    }, ...options.service });
  async function start() {
    const call = await service.registerInbound({ callSid: sid, from, to }); const ws = new Socket();
    service.handleStream(ws);
    ws.message({ event: 'start', streamSid, start: { accountSid: account, callSid: sid, streamSid, tracks: ['inbound'],
      customParameters: { callId: call.id }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } });
    await delay(2); return { call, ws };
  }
  return { service, events, invoked, start, store };
}

test('real protocol path gates ringing audio, captions answered caller and plays only Fish conversion', async t => {
  const f = setup(); t.after(() => f.service.close()); const { call, ws } = await f.start();
  const media = payload => ws.message({ event: 'media', streamSid, media: { track: 'inbound', payload: payload.toString('base64') } });
  media(Buffer.alloc(160, 0x80));
  assert.equal(f.events.some(event => event.type === 'audio'), false);
  assert.equal(ws.sent.filter(event => event.event === 'media').length, 1, 'Caller hears generated ringback while waiting');
  await f.service.answer(call.id);
  assert.equal(ws.sent.at(-1).event, 'clear'); ws.sent.length = 0;
  for (let i = 0; i < 20; i++) media(Buffer.alloc(160, 0x80));
  for (let i = 0; i < 35; i++) media(Buffer.alloc(160, 0xff));
  await delay(10);
  assert.equal(f.service.snapshot()[0].transcript[0].textShown, 'Hello');
  assert.equal(f.service.snapshot()[0].transcript[0].sourceLang, 'fr');
  assert.equal(f.events.find(event => event.type === 'audio').callId, call.id);
  const result = await f.service.say(call.id, { text: 'I will help you.' });
  assert.equal(result.phase, 'playing');
  assert.equal(result.transcript.at(-1).delivery, 'pending');
  assert.equal(f.invoked.find(([kind]) => kind === 'synthesize')[1].referenceId, 'approved_voice');
  // Replies carry a leading register tag for the S2 models; the words themselves are untouched.
  assert.match(f.invoked.find(([kind]) => kind === 'synthesize')[1].text, /^(\[[^\]]+\] )?Je vous aide\.$/);
  const sent = ws.sent.find(frame => frame.event === 'media');
  assert.deepEqual(Buffer.from(sent.media.payload, 'base64'), Buffer.alloc(800, 0x7f));
  await assert.rejects(f.service.say(call.id, { text: 'Another reply' }), /current reply/);
  ws.message({ event: 'mark', streamSid, mark: ws.sent.find(frame => frame.event === 'mark').mark });
  await delay(5);
  assert.equal(f.service.snapshot()[0].phase, 'listening');
  assert.equal(f.service.snapshot()[0].transcript.at(-1).delivery, 'played');
  await f.service.end(call.id);
  assert.equal(f.service.snapshot()[0].state, 'ended');
  assert.equal(f.service.snapshot()[0].transcript.length, 2);
});

test('stopping a pending provider prevents stale audio and allows next reply', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = setup({ providers: { synthesize: async () => pending } }); t.after(() => f.service.close());
  const { call, ws } = await f.start(); await f.service.answer(call.id);
  ws.sent.length = 0;
  const speaking = f.service.say(call.id, { text: 'A delayed reply' });
  await delay(5); await f.service.stop(call.id); release(Buffer.alloc(200)); await speaking;
  assert.equal(ws.sent.some(frame => frame.event === 'media'), false);
  assert.ok(ws.sent.some(frame => frame.event === 'clear'));
  assert.equal(f.service.snapshot()[0].transcript.at(-1).delivery, 'cancelled');
  assert.equal(f.service.snapshot()[0].phase, 'listening');
});

test('live language change flushes old speech under its original hint and preserves an in-flight reply', async t => {
  let release;
  const f = setup({ providers: { synthesize: () => new Promise(resolve => { release = resolve; }) } });
  t.after(() => f.service.close());
  const { call, ws } = await f.start(); await f.service.answer(call.id);
  const media = payload => ws.message({ event: 'media', streamSid, media: { track: 'inbound', payload: payload.toString('base64') } });
  for (let i = 0; i < 20; i++) media(Buffer.alloc(160, 0x80));
  const settings = await f.store.update(state => { state.settings.customerLanguage = 'de'; return state.settings; });
  await f.service.applySettings(settings); await delay(10);
  assert.equal(f.service.snapshot()[0].customerLanguage, 'de');
  assert.equal(f.service.snapshot()[0].transcript[0].sourceLang, 'fr', 'partial old phrase keeps French hint');
  for (let i = 0; i < 20; i++) media(Buffer.alloc(160, 0x80));
  for (let i = 0; i < 35; i++) media(Buffer.alloc(160, 0xff));
  await delay(10);
  assert.equal(f.service.snapshot()[0].transcript[1].sourceLang, 'de', 'next phrase uses German hint');
  const speaking = f.service.say(call.id, { text: 'Already in progress' }); await delay(10);
  const next = await f.store.update(state => { state.settings.customerLanguage = 'es'; return state.settings; });
  await f.service.applySettings(next);
  release(Buffer.alloc(200)); await speaking;
  const latest = f.service.snapshot()[0];
  assert.equal(latest.customerLanguage, 'es');
  assert.equal(latest.transcript.at(-1).targetLang, 'de', 'reply already started keeps its selected target');
  assert.equal(latest.phase, 'playing');
  assert.equal(latest.state, 'in_call');
});

test('stream start is bound to registered account/call and rejects malformed frames', async t => {
  const f = setup(); t.after(() => f.service.close()); const { call, ws } = await f.start();
  const other = new Socket(); f.service.handleStream(other);
  other.message({ event: 'start', streamSid, start: { accountSid: account, callSid: 'CA' + '5'.repeat(32), streamSid,
    tracks: ['inbound'], customParameters: { callId: call.id }, mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 } } });
  assert.equal(other.readyState, 3);
  assert.equal(ws.readyState, 1);
  // A second caller no longer collides with the first; the floor takes both.
  const second = await f.service.registerInbound({ callSid: 'CA' + '6'.repeat(32), from, to });
  assert.equal(second.state, 'ringing');
  assert.equal(f.service.snapshot().filter(item => item.state !== 'ended').length, 2);
  await f.service.end(second.id);
  await f.service.answer(call.id);
  ws.message({ event: 'media', streamSid, media: { track: 'inbound', payload: 'invalid!!!!' } });
  await delay(5);
  assert.equal(ws.readyState, 3);
  assert.equal(f.service.snapshot()[0].state, 'ended');
});

test('no-answer and missing playback acknowledgement do not masquerade as a played conversation', async t => {
  const noAnswer = setup({ service: { noAnswerMs: 10 } }); t.after(() => noAnswer.service.close());
  await noAnswer.start(); await delay(30);
  assert.equal(noAnswer.service.snapshot()[0].state, 'ended');
  const f = setup({ service: { playbackGraceMs: 5 } }); t.after(() => f.service.close());
  const { call } = await f.start(); await f.service.answer(call.id);
  await f.service.say(call.id, { text: 'Test reply' }); await delay(130);
  assert.equal(f.service.snapshot()[0].transcript.at(-1).delivery, 'unconfirmed');
  assert.match(f.service.snapshot()[0].error, /did not confirm/);
});

test('archived voices cannot speak and confirmed tickets survive caption/reply writes', async t => {
  const f = setup(); t.after(() => f.service.close()); const { call } = await f.start(); await f.service.answer(call.id);
  await f.service.update(call.id, { issue: 'A support issue', confirmDispatch: true });
  await f.service.say(call.id, { text: 'A reply' });
  assert.equal(f.service.snapshot()[0].ticket.dispatch, 'confirmed');
  await f.service.stop(call.id);
  await f.store.update(state => { state.voices[0].archived = true; });
  await assert.rejects(f.service.say(call.id, { text: 'A reply' }), /enrolled or licensed/);
});

test('browser caller rings, relays real PCM, captions at 16k, and receives only the chosen Fish speech', async t => {
  let twilioRequests = 0;
  const f = setup({ service: { fetchImpl: async () => { twilioRequests++; throw new Error('Should never use Twilio'); } } });
  t.after(() => f.service.close());
  const call = await f.service.registerBrowserInbound(); const ws = new Socket();
  f.service.handleBrowserStream(ws, { callId: call.id }); await delay(3);
  assert.equal(call.transport, 'browser'); assert.match(call.callSid, /^browser:/);
  assert.equal(ws.sent.at(-1).state, 'ringing');
  const speech = Buffer.alloc(3200);
  for (let i = 0; i < 1600; i++) speech.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 400 / 16000) * 8000), i * 2);
  ws.binary(speech);
  assert.equal(f.events.some(event => event.type === 'audio'), false, 'No caller audio before Answer');
  await f.service.answer(call.id);
  assert.equal(ws.sent.at(-1).state, 'in_call');
  for (let i = 0; i < 4; i++) ws.binary(speech);
  for (let i = 0; i < 7; i++) ws.binary(Buffer.alloc(3200));
  await delay(10);
  const transcription = f.invoked.find(([method]) => method === 'transcribe')[1];
  assert.equal(transcription.audio.readUInt32LE(24), 16000, 'STT retains native 16k source quality');
  assert.equal(transcription.language, 'fr');
  assert.equal(f.service.snapshot()[0].transcript[0].textShown, 'Hello');
  assert.equal(Buffer.from(f.events.find(event => event.type === 'audio').payload, 'base64').length, 800);
  const playing = await f.service.say(call.id, { text: 'I will help you.' });
  assert.equal(playing.phase, 'playing');
  const audio = ws.sent.find(event => event.type === 'audio');
  assert.equal(audio.mimeType, 'audio/mpeg');
  assert.deepEqual(Buffer.from(audio.payload, 'base64'), Buffer.alloc(500, 0x11));
  assert.equal(f.invoked.find(([method]) => method === 'synthesize')[1].referenceId, 'approved_voice');
  assert.match(f.invoked.find(([method]) => method === 'synthesize')[1].text, /^(\[[^\]]+\] )?Je vous aide\.$/);
  const callerStates = ws.sent.filter(event => event.type === 'state');
  assert.ok(callerStates.every(event => !event.transcript && !event.ticket && !event.voiceId && !event.from));
  const before = f.events.filter(event => event.type === 'audio').length; ws.binary(speech);
  assert.equal(f.events.filter(event => event.type === 'audio').length, before, 'Caller mic is gated during Fish playback');
  ws.message({ type: 'played', playbackId: 'stale-id' }); await delay(2);
  assert.equal(f.service.snapshot()[0].phase, 'playing');
  ws.message({ type: 'played', playbackId: audio.playbackId }); await delay(3);
  assert.equal(f.service.snapshot()[0].transcript.at(-1).delivery, 'played');
  assert.equal(ws.sent.at(-1).phase, 'listening');
  await f.service.end(call.id);
  assert.equal(f.service.snapshot()[0].state, 'ended');
  assert.equal(ws.sent.at(-1).state, 'ended');
  assert.equal(twilioRequests, 0);
  assert.equal(f.service.snapshot()[0].transcript.length, 2);
});

test('browser caller stop/disconnect cancels stale speech and malformed PCM closes only that call', async t => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const f = setup({ providers: { synthesize: async () => pending } }); t.after(() => f.service.close());
  const call = await f.service.registerBrowserInbound(); const ws = new Socket();
  f.service.handleBrowserStream(ws, { callId: call.id }); await f.service.answer(call.id);
  const reply = f.service.say(call.id, { text: 'Wait for this response' }); await delay(4);
  await f.service.stop(call.id); release(Buffer.alloc(200)); await reply;
  assert.equal(ws.sent.some(event => event.type === 'audio'), false);
  assert.ok(ws.sent.some(event => event.type === 'clear'));
  ws.binary(Buffer.alloc(3)); await delay(4);
  assert.equal(ws.readyState, 3); assert.equal(f.service.snapshot()[0].state, 'ended');
  const next = await f.service.registerBrowserInbound(); const nextWs = new Socket();
  f.service.handleBrowserStream(nextWs, { callId: next.id }); await f.service.answer(next.id);
  nextWs.message({ type: 'end' }); await delay(4);
  assert.equal(f.service.snapshot().find(item => item.id === next.id).state, 'ended');
});
