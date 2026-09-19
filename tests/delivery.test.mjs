import test from 'node:test';
import assert from 'node:assert/strict';
import { measureClip, arousalOf, deliveryOf } from '../server/emotion.mjs';

/** A WAV of speech-like noise at a given level, so measureClip has something to voice. */
function clip(seconds, amplitude = 4000) {
  const rate = 16000, frames = Math.round(rate * seconds);
  const body = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    // A tone under a slow envelope reads as voiced without being digital silence.
    const value = amplitude * Math.sin(2 * Math.PI * 140 * i / rate) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * i / rate));
    body.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value))), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + body.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

// The bug this pins: enrolling in a language with no reading passage sent the transcript
// as null, FormData turned that into the string "null", the server counted one word over
// a fifty-second clip, and from then on every reply from that voice measured as shouting.
test('a baseline built from one counted word does not make every later reply read as shouting', () => {
  const enrolment = measureClip(clip(50), 1); // what "null" as a transcript produces
  assert.ok(enrolment.rate < 0.1, `a one-word fifty-second clip really does measure that slow: ${enrolment.rate}`);

  const poisoned = arousalOf(measureClip(clip(4), 12), { loudness: enrolment.loudness, rate: enrolment.rate });
  assert.equal(poisoned.level, 'high', 'this is the damage: an ordinary reply reads as high arousal');

  // The server refuses an implausible rate and stores none, which reads as no rate at all.
  const guarded = arousalOf(measureClip(clip(4), 12), { loudness: enrolment.loudness, rate: 0 });
  assert.equal(guarded.level, 'medium', 'with no baseline rate, an ordinary reply is ordinary again');
  assert.equal(guarded.rateRatio, 1);
});

test('a real baseline still hears a reply snapped out faster and louder than usual', () => {
  const baseline = { loudness: -26, rate: 2.6 };
  const calm = arousalOf({ loudness: -26, rate: 2.6 }, baseline);
  const snapped = arousalOf({ loudness: -20, rate: 3.6 }, baseline);
  const murmured = arousalOf({ loudness: -33, rate: 1.9 }, baseline);
  assert.equal(calm.level, 'medium');
  assert.equal(snapped.level, 'high');
  assert.equal(murmured.level, 'low');
});

// What the interpreter is told, so the wording can match the delivery rather than the
// delivery being a label stuck on neutral prose afterwards.
test('the interpreter is told how it was said, in its own terms', () => {
  assert.equal(deliveryOf({ louderDb: 6, rateRatio: 1.4 }), 'noticeably louder than usual and faster than usual');
  assert.equal(deliveryOf({ louderDb: -6, rateRatio: 0.7 }), 'quieter than usual and slower than usual');
  assert.equal(deliveryOf({ louderDb: 0, rateRatio: 1 }), 'at their usual level and at their usual pace');
  assert.equal(deliveryOf(null), '', 'no clip, nothing claimed');
});
