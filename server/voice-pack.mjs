// A voice pack is what leaves and enters the library as a file: the Fish reference
// and the metadata NoteFIsh keeps about it. The model itself stays on Fish Audio;
// importing a pack re-attaches to it by reference, after Fish confirms it exists.
import { REGISTERS, canonicalRegister } from './emotion.mjs';

export const PACK_KIND = 'notefish-voice-pack';
export const PACK_VERSION = 1;
const text = (value, max) => typeof value === 'string' && value.length <= max;
const REFERENCE = /^[A-Za-z0-9_-]{6,128}$/;

/** The exportable shape of one library voice. Nothing private: no consent timestamps, no ids local to this install. */
export function packVoice(voice) {
  return {
    referenceId: voice.referenceId, name: voice.name, description: voice.description || '', language: voice.language || 'en', kind: voice.kind,
    ...(voice.register ? { register: voice.register } : {}),
    ...(voice.baseline && typeof voice.baseline.loudness === 'number' && typeof voice.baseline.rate === 'number' ? { baseline: { loudness: voice.baseline.loudness, rate: voice.baseline.rate } } : {}),
  };
}

export function buildPack(voices, { exportedBy = '' } = {}) {
  return { kind: PACK_KIND, version: PACK_VERSION, exportedAt: new Date().toISOString(), ...(exportedBy ? { exportedBy } : {}), voices: voices.map(packVoice) };
}

/** Validates a pack from anywhere; throws with a plain message. Returns clean voices. */
export function parsePack(input) {
  const pack = typeof input === 'string' ? JSON.parse(input) : input;
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('This is not a NoteFIsh voice file.');
  const voices = pack.kind === PACK_KIND ? pack.voices : pack.referenceId ? [pack] : null;
  if (!Array.isArray(voices) || !voices.length || voices.length > 100) throw new Error('This is not a NoteFIsh voice file.');
  return voices.map((voice, index) => {
    if (!voice || typeof voice !== 'object' || !REFERENCE.test(voice.referenceId || '')) throw new Error(`Voice ${index + 1} has no valid Fish reference.`);
    if (!text(voice.name, 100) || !voice.name.trim()) throw new Error(`Voice ${index + 1} needs a name.`);
    const register = voice.register ? canonicalRegister(voice.register) : null;
    if (register && !REGISTERS.includes(register)) throw new Error(`Voice ${index + 1}: unknown take "${voice.register}".`);
    const baseline = voice.baseline && typeof voice.baseline.loudness === 'number' && typeof voice.baseline.rate === 'number' ? { loudness: voice.baseline.loudness, rate: voice.baseline.rate } : null;
    return {
      referenceId: voice.referenceId, name: voice.name.trim(), description: text(voice.description, 1000) ? voice.description : '',
      language: text(voice.language, 40) && voice.language ? voice.language : 'en', kind: voice.kind === 'licensed' ? 'licensed' : 'enrolled', register, baseline,
    };
  });
}
