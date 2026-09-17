import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack, parsePack, PACK_KIND } from '../server/voice-pack.mjs';

test('a voice pack round-trips the reference and the takes, and nothing private', () => {
  const voices = [
    { id: 'local-1', referenceId: 'ref_calm_0001', name: 'Nina', description: 'Desk voice', language: 'fr', kind: 'enrolled', status: 'ready', archived: false, createdAt: 'x', consent: true, consentAt: 'y', register: 'calm', baseline: { loudness: -24.5, rate: 2.7, snr: 30 } },
    { id: 'local-2', referenceId: 'ref_brisk_002', name: 'Nina · quick', description: '', language: 'fr', kind: 'enrolled', register: 'brisk' },
  ];
  const pack = buildPack(voices, { exportedBy: 'Main line' });
  assert.equal(pack.kind, PACK_KIND);
  assert.deepEqual(Object.keys(pack.voices[0]).sort(), ['baseline', 'description', 'kind', 'language', 'name', 'referenceId', 'register']);
  assert.equal('consentAt' in pack.voices[0], false); assert.equal('id' in pack.voices[0], false);
  assert.deepEqual(pack.voices[0].baseline, { loudness: -24.5, rate: 2.7 }, 'snr is a recording detail, not part of the voice');

  const parsed = parsePack(JSON.stringify(pack));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].register, 'energetic', 'an old take name is upgraded on the way in');
  assert.equal(parsed[0].kind, 'enrolled'); assert.equal(parsed[0].language, 'fr');

  assert.equal(parsePack({ referenceId: 'abcdef123456', name: 'Single' })[0].name, 'Single', 'a single exported voice also imports');
  assert.throws(() => parsePack('{"hello":1}'), /not a NoteFIsh voice file/);
  assert.throws(() => parsePack({ kind: PACK_KIND, voices: [{ referenceId: 'x', name: 'Bad' }] }), /valid Fish reference/);
  assert.throws(() => parsePack({ kind: PACK_KIND, voices: [{ referenceId: 'abcdef123456', name: '' }] }), /needs a name/);
  assert.throws(() => parsePack({ kind: PACK_KIND, voices: [{ referenceId: 'abcdef123456', name: 'X', register: 'shouting' }] }), /unknown take/);
});
