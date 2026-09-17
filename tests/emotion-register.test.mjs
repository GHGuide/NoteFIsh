import test from 'node:test';
import assert from 'node:assert/strict';
import { pcmToWav } from '../server/audio.mjs';
import { measureClip, arousalOf, registerFor, tagFor, prosodyFor, describe } from '../server/emotion.mjs';
import { createProviders } from '../server/providers.mjs';

// A 16 kHz clip: `seconds` of a tone at the given amplitude, with silence between bursts.
function speechLike({ seconds = 3, amplitude = 0.3, burst = 0.3, gap = 0.15 } = {}) {
  const rate = 16000; const pcm = Buffer.alloc(rate * seconds * 2);
  for (let i = 0; i < rate * seconds; i++) {
    const t = i / rate; const inBurst = (t % (burst + gap)) < burst;
    const v = inBurst ? Math.sin(2 * Math.PI * 180 * t) * amplitude : 0;
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  return pcmToWav(pcm, rate);
}

test('a clip is measured relative to the agent, and louder-faster reads as higher arousal', () => {
  const quiet = measureClip(speechLike({ amplitude: 0.1 }), 8);
  const loud = measureClip(speechLike({ amplitude: 0.5 }), 16);
  assert.ok(loud.loudness > quiet.loudness + 8, 'loudness follows amplitude');
  assert.ok(loud.rate > quiet.rate, 'rate follows words per voiced second');
  assert.ok(quiet.snr > 15, 'a clean clip has a wide gap between speech and its silences');

  const baseline = { loudness: quiet.loudness, rate: quiet.rate };
  assert.equal(arousalOf(quiet, baseline).level, 'medium', 'the reference itself is the middle');
  assert.equal(arousalOf(loud, baseline).level, 'high');
  assert.equal(arousalOf({ loudness: quiet.loudness - 8, rate: quiet.rate * 0.6 }, baseline).level, 'low');

  const silence = measureClip(pcmToWav(Buffer.alloc(16000 * 2 * 2), 16000), 0);
  assert.equal(silence.voicedSeconds, 0, 'nothing voiced in silence');
});

test('tone and arousal pick a register, one S2 tag, and matching prosody', () => {
  assert.equal(registerFor('apologetic', { level: 'high' }), 'apologetic', 'an apology stays an apology however loud');
  assert.equal(registerFor('calm', { level: 'high' }), 'energetic', 'a loud, fast calm sentence is energetic');
  assert.equal(registerFor('firm', { level: 'high' }), 'firm', 'firm stays firm however loud');
  assert.equal(registerFor('warm', { level: 'medium' }), 'warm');
  assert.equal(registerFor('calm', { level: 'low' }), 'calm');

  const tag = tagFor('apologetic', { level: 'low' }, 's2.1-pro-free');
  assert.match(tag, /^\[[^\]]+\]$/, 'exactly one bracket tag');
  assert.match(tag, /apologetic/);
  assert.equal(tagFor('warm', { level: 'medium' }, 's1'), '', 'S1 takes parentheses, so no bracket tag is emitted');

  assert.deepEqual(prosodyFor({ level: 'high', rateRatio: 1.6 }), { speed: 1.2, temperature: 0.8 }, 'speed is clamped');
  assert.deepEqual(prosodyFor({ level: 'low', rateRatio: 0.5 }), { speed: 0.9, temperature: 0.5 });
  assert.equal(describe('energetic', { level: 'high' }), 'energetic · strong');
  assert.equal(describe('calm', { level: 'medium' }), 'calm');
});

test('the interpreter returns translation, detected language and tone from one JSON call', async () => {
  const bodies = [];
  const providers = createProviders({ openaiApiKey: 'test-only-key', fishApiKey: 'test-only-key', fishModel: 's2.1-pro-free' }, { fetchImpl: async (url, options) => {
    bodies.push(JSON.parse(options.body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ language: 'fr', text: 'I am waiting downstairs.', tone: 'brisk' }) } }] });
  } });
  const result = await providers.interpret({ text: "J'attends en bas.", sourceLanguage: 'auto', targetLanguage: 'en' });
  assert.deepEqual(result, { text: 'I am waiting downstairs.', language: 'fr', tone: 'energetic', sentences: [] }, 'an old tone label maps to the new register');
  assert.equal(bodies[0].response_format.type, 'json_object');
  assert.match(bodies[0].messages[0].content, /detect the language/i);

  // An unknown tone or a malformed language never reaches the call.
  const odd = createProviders({ openaiApiKey: 'test-only-key', fishApiKey: 'test-only-key' }, { fetchImpl: async () =>
    Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ language: 'French', text: 'Hello', tone: 'furious' }) } }] }) });
  const fallback = await odd.interpret({ text: 'Bonjour', sourceLanguage: 'fr', targetLanguage: 'en' });
  assert.deepEqual(fallback, { text: 'Hello', language: 'fr', tone: 'calm', sentences: [] });
});

test('synthesis passes the register tag, temperature and speed through to Fish', async () => {
  const bodies = [];
  const providers = createProviders({ openaiApiKey: 'k', fishApiKey: 'test-only-key', fishModel: 's2.1-pro-free' }, { fetchImpl: async (url, options) => {
    bodies.push(JSON.parse(options.body)); return new Response(Buffer.alloc(100), { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  await providers.synthesize({ text: '[sincerely apologetic] Je suis désolée.', referenceId: 'approved_voice', temperature: 0.5, speed: 0.9 });
  assert.equal(bodies[0].text, '[sincerely apologetic] Je suis désolée.');
  assert.equal(bodies[0].temperature, 0.5);
  assert.deepEqual(bodies[0].prosody, { speed: 0.9 });
  await providers.synthesize({ text: 'Bonjour', referenceId: 'approved_voice' });
  assert.equal('temperature' in bodies[1], false, 'defaults stay the provider defaults');
});
