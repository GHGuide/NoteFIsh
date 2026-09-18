import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviders } from '../server/providers.mjs';
import { pcmToWav } from '../server/audio.mjs';

const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(200, 7)]);
const ok = (body, type) => new Response(body, { status: 200, headers: { 'content-type': type } });

// Every request the providers make, with the key each one carried.
function recorder(handlers) {
  const seen = [];
  const fetchImpl = async (url, options = {}) => {
    seen.push({ url, method: options.method || 'POST', key: options.headers?.['xi-api-key'] || options.headers?.Authorization || '' });
    for (const [match, reply] of handlers) if (url.includes(match)) return reply(options);
    throw new Error(`unexpected call to ${url}`);
  };
  return { seen, fetchImpl };
}
const base = { fishApiKey: 'fish-key', openaiApiKey: 'openai-key', fishModel: 's2.1-pro' };

test('when Fish cannot speak, the same person speaks from ElevenLabs', async () => {
  const { seen, fetchImpl } = recorder([
    ['api.fish.audio', () => new Response('down', { status: 503 })],
    ['api.elevenlabs.io', () => ok(MP3, 'audio/mpeg')],
  ]);
  const providers = createProviders({ ...base, elevenLabsApiKey: 'eleven-key' }, { fetchImpl });
  const audio = await providers.synthesize({ text: 'Bonjour.', referenceId: 'fish-reference-01', fallbackReferenceId: 'eleven-reference-01', format: 'mp3' });
  assert.deepEqual(audio, MP3, 'the caller hears speech, not an error');
  // Fish retries its own 503 once before the fallback is considered.
  assert.deepEqual(seen.map(call => new URL(call.url).host), ['api.fish.audio', 'api.fish.audio', 'api.elevenlabs.io']);
  const elsewhere = seen[2];
  assert.match(elsewhere.url, /\/v1\/text-to-speech\/eleven-reference-01\?output_format=mp3_44100_128/);
  assert.equal(elsewhere.key, 'eleven-key', 'ElevenLabs takes its key in its own header');
  assert.equal(seen[0].key, 'Bearer fish-key', 'Fish still takes a bearer token');
});

test('without a second reference, or without a key, Fish failing is the answer', async () => {
  for (const [label, config, voice] of [
    ['no key configured', base, 'eleven-reference-01'],
    ['voice never enrolled there', { ...base, elevenLabsApiKey: 'eleven-key' }, ''],
  ]) {
    const { seen, fetchImpl } = recorder([['api.fish.audio', () => new Response('down', { status: 503 })]]);
    const providers = createProviders(config, { fetchImpl });
    await assert.rejects(providers.synthesize({ text: 'Bonjour.', referenceId: 'fish-reference-01', fallbackReferenceId: voice, format: 'mp3' }), /Fish/, label);
    assert.equal(seen.filter(call => call.url.includes('elevenlabs')).length, 0, label);
  }
});

test('a recording is enrolled in both places, and an ElevenLabs failure never costs the recording', async () => {
  const fishVoice = { _id: 'fish-reference-01', state: 'trained', type: 'tts', title: 'Nina' };
  const wav = pcmToWav(Buffer.alloc(16000 * 2 * 4), 16000);

  const both = recorder([
    ['api.fish.audio', () => ok(JSON.stringify(fishVoice), 'application/json')],
    ['api.elevenlabs.io', () => ok(JSON.stringify({ voice_id: 'eleven-reference-01', requires_verification: false }), 'application/json')],
  ]);
  const paired = createProviders({ ...base, elevenLabsApiKey: 'eleven-key' }, { fetchImpl: both.fetchImpl });
  const made = await paired.createVoice({ name: 'Nina', audio: wav, mimeType: 'audio/wav' });
  assert.equal(made.referenceId, 'fish-reference-01');
  assert.equal(made.fallbackReferenceId, 'eleven-reference-01', 'both references come back, so both get stored');
  assert.match(both.seen.at(-1).url, /\/v1\/voices\/add$/);

  const refused = recorder([
    ['api.fish.audio', () => ok(JSON.stringify(fishVoice), 'application/json')],
    ['api.elevenlabs.io', () => new Response('no', { status: 401 })],
  ]);
  const lopsided = createProviders({ ...base, elevenLabsApiKey: 'wrong-key' }, { fetchImpl: refused.fetchImpl });
  const still = await lopsided.createVoice({ name: 'Nina', audio: wav, mimeType: 'audio/wav' });
  assert.equal(still.referenceId, 'fish-reference-01', 'the voice is recorded');
  assert.equal(still.fallbackReferenceId, undefined, 'it simply has no fallback');
});
