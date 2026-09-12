import test from 'node:test';
import assert from 'node:assert/strict';
import { mulawToPcm, pcmToMulaw, pcm16kToMulaw8k, pcmToWav, SpeechSegmenter, convertAudio, ringbackTone } from '../server/audio.mjs';

test('G.711 decoding and WAV framing preserve telephone samples', () => {
  const pcm = mulawToPcm(Buffer.from([0xff, 0x7f, 0x00, 0x80]));
  assert.deepEqual([0, 2, 4, 6].map(i => pcm.readInt16LE(i)), [0, 0, -32124, 32124]);
  const wav = pcmToWav(pcm);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(24), 8000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.deepEqual(mulawToPcm(pcmToMulaw(pcm)), pcm);
  assert.equal(ringbackTone().length, 8000);
});

test('VAD ignores silence, retains speech, flushes on silence, bounds long utterances', () => {
  const segmenter = new SpeechSegmenter();
  for (let i = 0; i < 500; i++) assert.equal(segmenter.push(Buffer.alloc(160, 0xff)), null);
  let segment;
  for (let i = 0; i < 20; i++) segment = segmenter.push(Buffer.alloc(160, 0x80));
  assert.equal(segment, null);
  for (let i = 0; i < 35; i++) segment = segmenter.push(Buffer.alloc(160, 0xff));
  assert.ok(Buffer.isBuffer(segment));
  assert.equal(segment.toString('ascii', 0, 4), 'RIFF');
  assert.equal(segmenter.flush(), null);
  let bounded = null;
  for (let i = 0; i < 400; i++) bounded = segmenter.push(Buffer.alloc(160, 0x80)) || bounded;
  assert.ok(bounded.length <= 8000 * 8 * 2 + 44);
});

test('ffmpeg converts real WAV to headerless 8k mulaw, rejects invalid/overlong clips', async () => {
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < 8000; i++) pcm.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 16000) * 10000), i * 2);
  const wav = pcmToWav(pcm, 16000);
  const telephone = await convertAudio(wav, 'audio/wav', { output: 'mulaw', sampleRate: 8000, maxSeconds: 1 });
  assert.equal(telephone.length, 4000);
  assert.notEqual(telephone.toString('ascii', 0, 4), 'RIFF');
  await assert.rejects(convertAudio(Buffer.alloc(500), 'audio/wav'), /decoded/);
  await assert.rejects(convertAudio(wav, 'text/plain'), /WebM/);
  await assert.rejects(convertAudio(pcmToWav(Buffer.alloc(16000 * 4), 16000), 'audio/wav', { maxSeconds: 1 }), /under 1 seconds/);
});

test('browser PCM is segmented at native16k and relayed as bounded8k desk frames', () => {
  const pcm = Buffer.alloc(3200);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(8000, i);
  assert.equal(pcm16kToMulaw8k(pcm).length, 800);
  const segmenter = new SpeechSegmenter({ format: 'pcm', sampleRate: 16000 });
  for (let i = 0; i < 4; i++) assert.equal(segmenter.push(pcm), null);
  let segment;
  for (let i = 0; i < 7; i++) segment = segmenter.push(Buffer.alloc(3200));
  assert.equal(segment.readUInt32LE(24), 16000);
  assert.equal(segment.readUInt32LE(40), 11 * 3200);
  assert.throws(() => pcm16kToMulaw8k(Buffer.alloc(3)), /Invalid/);
  assert.throws(() => segmenter.push(Buffer.alloc(3)), /Invalid/);
});
