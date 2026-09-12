import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { audioPeaks, audioRms, audioBufferToWav, audioTime } from '../web/audio.js';
import { microphoneIssue } from '../web/microphone-help.js';
import { BrowserCallAudio, Pcm16Encoder } from '../web/browser-call-audio.js';

test('audio meter reports silence and real signal strength without inventing activity', () => {
  assert.equal(audioRms(new Float32Array(2048)), 0);
  assert.deepEqual(audioPeaks(new Float32Array(2048), 4), [0, 0, 0, 0]);
  const sine = Float32Array.from({ length: 16000 }, (_, index) => .25 * Math.sin(2 * Math.PI * 440 * index / 16000));
  assert.ok(Math.abs(audioRms(sine) - .25 / Math.sqrt(2)) < .00001);
  const impulse = new Float32Array(100); impulse[37] = -.6;
  const peaks = audioPeaks(impulse, 10);
  assert.equal(peaks.filter(value => value > 0).length, 1);
  assert.ok(Math.abs(peaks[3] - .6) < .00001);
  assert.equal(audioRms(new Float32Array([NaN, Infinity, -Infinity])), 0);
  assert.deepEqual(audioPeaks(new Float32Array([NaN, Infinity, 2, -3]), 4), [0, 0, 1, 1]);
  assert.deepEqual(audioPeaks(sine, 129), []);
});

test('16 kHz call encoding preserves duration and signal across device rates and callback boundaries', () => {
  for (const rate of [16000, 44100, 48000]) {
    const input = Float32Array.from({ length: rate }, (_, index) => .25 * Math.sin(2 * Math.PI * 440 * index / rate));
    const whole = []; const split = [];
    new Pcm16Encoder(rate, chunk => whole.push(Buffer.from(chunk))).write(input);
    const encoder = new Pcm16Encoder(rate, chunk => split.push(Buffer.from(chunk)));
    for (let offset = 0; offset < input.length; offset += 137) encoder.write(input.subarray(offset, offset + 137));
    assert.equal(whole.length, 10, `${rate} Hz must produce exactly one second`);
    assert.ok(whole.every(chunk => chunk.length === 3200));
    assert.deepEqual(Buffer.concat(split), Buffer.concat(whole), 'callback boundaries cannot lose samples');
    const bytes = Buffer.concat(whole);
    const samples = Float32Array.from({ length: 16000 }, (_, index) => bytes.readInt16LE(index * 2) / 32768);
    assert.ok(Math.abs(audioRms(samples) - .25 / Math.sqrt(2)) < .002);
  }
});

test('actual AudioWorklet emits the same PCM as fallback and discards paused partial chunks', async () => {
  const source = await readFile(new URL('../web/pcm-worklet.js', import.meta.url), 'utf8');
  let Processor;
  runInNewContext(source, {
    sampleRate: 44100,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: data => chunks.push(Buffer.from(data)) }; } },
    registerProcessor: (_name, processor) => { Processor = processor; },
  });
  const chunks = []; const processor = new Processor();
  const input = Float32Array.from({ length: 44100 }, (_, index) => .25 * Math.sin(2 * Math.PI * 440 * index / 44100));
  processor.port.onmessage({ data: { enabled: true } });
  for (let offset = 0; offset < input.length; offset += 128) processor.process([[input.subarray(offset, offset + 128)]]);
  const fallback = []; new Pcm16Encoder(44100, chunk => fallback.push(Buffer.from(chunk))).write(input);
  assert.deepEqual(Buffer.concat(chunks), Buffer.concat(fallback));
  chunks.length = 0;
  processor.process([[new Float32Array(2205).fill(.9)]]);
  processor.port.onmessage({ data: { enabled: false } });
  processor.process([[new Float32Array(4410).fill(.9)]]);
  processor.port.onmessage({ data: { enabled: true } });
  processor.process([[new Float32Array(4410)]]);
  assert.equal(chunks.length, 1);
  assert.ok(chunks[0].every(byte => byte === 0), 'muted speech must not leak into the resumed chunk');
});

function browserAudioFixture(t) {
  const track = { readyState: 'live', enabled: true, muted: false, stop() { this.readyState = 'ended'; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const sources = []; const acknowledgements = []; const microphoneStates = []; const chunks = [];
  const node = () => ({ connect(target) { this.target = target; }, disconnect() { this.disconnected = true; } });
  class Context {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.destination = {}; }
    createAnalyser() { const analyser = node(); analyser.context = this; return analyser; }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { return node(); }
    createBufferSource() { const source = { ...node(), start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } }; sources.push(source); return source; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    async decodeAudioData() { return { duration: .1 }; }
  }
  for (const [key, value] of Object.entries({ window: { AudioContext: Context }, navigator: { mediaDevices: { getUserMedia: async () => stream } } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  const audio = new BrowserCallAudio({ onChunk: chunk => chunks.push(chunk), onPlayed: id => acknowledgements.push(id), onMicrophoneState: state => microphoneStates.push(state) });
  t.after(() => audio.stop());
  return { audio, track, sources, acknowledgements, microphoneStates, chunks };
}

test('caller mute and device interruption suppress capture and release the microphone on stop', async t => {
  const { audio, track, microphoneStates, chunks } = browserAudioFixture(t);
  await audio.unlock(); await audio.startMicrophone();
  const input = { inputBuffer: { getChannelData: () => new Float32Array(4800).fill(.25) } };
  audio.setListening(true); audio.processor.onaudioprocess(input);
  assert.equal(chunks.length, 1);
  audio.setMuted(true); audio.setListening(true); audio.processor.onaudioprocess(input);
  assert.equal(audio.listening, false); assert.equal(track.enabled, false); assert.equal(chunks.length, 1);
  audio.setMuted(false); audio.setListening(true);
  track.muted = true; track.onmute(); audio.setListening(true); audio.processor.onaudioprocess(input);
  assert.equal(audio.listening, false); assert.equal(chunks.length, 1);
  track.muted = false; track.onunmute(); audio.setListening(true); audio.processor.onaudioprocess(input);
  assert.equal(chunks.length, 2);
  assert.deepEqual(microphoneStates, [{ muted: false }, { muted: true }, { muted: false }]);
  audio.stop();
  assert.equal(track.readyState, 'ended'); assert.equal(track.onmute, null); assert.equal(track.onunmute, null);
  assert.equal(audio.context.state, 'closed'); assert.equal(audio.playbackAnalyser.disconnected, true);
});

test('reply acknowledgement follows actual completion and cancelled playback never acknowledges', async t => {
  const { audio, sources, acknowledgements } = browserAudioFixture(t);
  await audio.unlock();
  await audio.play('AA==', 'first');
  assert.deepEqual(acknowledgements, []);
  assert.equal(sources[0].target, audio.playbackAnalyser, 'waveform measures the audible output path');
  audio.clearPlayback();
  assert.equal(sources[0].stopped, true); assert.deepEqual(acknowledgements, []);
  await audio.play('AA==', 'second'); sources[1].onended();
  assert.deepEqual(acknowledgements, ['second']);
  await audio.play('AA==', 'third'); audio.stop();
  assert.deepEqual(acknowledgements, ['second']);
});

test('clear during decode prevents stale reply from starting or acknowledging', async t => {
  const { audio, sources, acknowledgements } = browserAudioFixture(t);
  await audio.unlock();
  let finishDecode;
  audio.context.decodeAudioData = () => new Promise(resolve => { finishDecode = resolve; });
  const playing = audio.play('AA==', 'stale');
  audio.clearPlayback(); finishDecode({ duration: .1 }); await playing;
  assert.equal(sources.length, 0); assert.deepEqual(acknowledgements, []);
});

test('microphone readiness does not wait forever for browser audio unlock', async t => {
  const { audio, track } = browserAudioFixture(t);
  audio.context.resume = () => new Promise(() => {});
  await audio.prepare();
  assert.equal(audio.stream.getAudioTracks()[0], track);
  assert.equal(audio.context.state, 'suspended');
  assert.equal(audio.listening, false, 'audio recovery gesture is still required before sending speech');
});

test('late microphone permission after cancellation releases the stream', async t => {
  const { audio, track } = browserAudioFixture(t);
  let grant;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { grant = resolve; });
  const starting = audio.prepare();
  audio.stop();
  grant({ getTracks: () => [track], getAudioTracks: () => [track] });
  await starting;
  assert.equal(track.readyState, 'ended');
  assert.equal(audio.stream, undefined);
});

test('preview WAV duration follows actual samples and time labels use one consistent clock', async () => {
  const rate = 24000; const length = rate * 23 + rate * .75;
  const samples = Float32Array.from({ length }, (_, i) => .25 * Math.sin(2 * Math.PI * 440 * i / rate));
  const wav = await audioBufferToWav({ numberOfChannels: 1, length, sampleRate: rate, getChannelData: () => samples }).arrayBuffer();
  const view = new DataView(wav);
  assert.equal(view.getUint32(24, true), rate);
  assert.equal(view.getUint32(40, true) / view.getUint32(28, true), 23.75);
  assert.equal(wav.byteLength, 44 + length * 2);
  assert.equal(audioTime(23.75 / 2), '0:11');
  assert.equal(audioTime(23.75), '0:23');
  assert.equal(audioTime(Infinity), '0:00');
  assert.equal(audioTime(65.9), '1:05');
});

test('microphone failures give actionable categories without pretending access can be granted by the site', () => {
  assert.equal(microphoneIssue({ name: 'NotAllowedError' }), 'blocked');
  assert.equal(microphoneIssue({ name: 'NotReadableError' }), 'busy');
  assert.equal(microphoneIssue({ name: 'NotFoundError' }), 'missing');
  assert.equal(microphoneIssue({}, { supported: false }), 'unsupported');
  assert.equal(microphoneIssue({}, { secure: false }), 'unsupported');
});
