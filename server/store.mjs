import { chooseStorage } from './storage.mjs';
import { isLayoutShape } from './layout.mjs';
import { REGISTERS, canonicalRegister } from './emotion.mjs';

const MAX_STATE = 16 * 1024 * 1024;
export const VERSION = 3;
const initialState = () => ({ version: VERSION, voices: [], settings: { voiceId: null, agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' }, calls: [], users: [] });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const phrasesOk = value => value === undefined || (Array.isArray(value) && value.length <= 30 && value.every(item => plain(item) && text(item.id, 64) && text(item.text, 300) && item.text.trim()));
const layoutOk = value => value === undefined || isLayoutShape(value);
const FORMALITY = ['formal', 'casual', 'match'];
const glossaryOk = value => value === undefined || (Array.isArray(value) && value.length <= 200 && value.every(item => plain(item) && text(item.id, 64) && text(item.term, 120) && item.term.trim() && ['keep', 'as', 'spell'].includes(item.kind) && text(item.as ?? '', 200)));
const formalityOk = value => value === undefined || value === null || FORMALITY.includes(value);
const avatarOk = value => value === undefined || value === null || (plain(value) && text(value.variant, 20) && /^#[0-9A-Fa-f]{6}$/.test(String(value.color || '')) && (value.face === undefined || typeof value.face === 'boolean'));

/** Version 1 held one global settings row. Version 2 added a roster of agents, each
 * able to override the desk's settings and hold its own voice. Version 3 takes the
 * roster out again: one desk, and what a person switches between is their voices.
 *
 * The seat that was last in use hands its choices back to the desk on the way out, so
 * whoever was answering keeps the voice and the languages they were answering with. */
export function migrateState(state) {
  if (!plain(state)) return state;
  if (state.version === 1) state = { ...state, version: 2, agents: [] };
  if (state.version === 2) {
    const agents = (Array.isArray(state.agents) ? state.agents : []).filter(plain);
    const seat = agents.find(agent => !agent.archived && agent.voiceId) || agents.find(agent => !agent.archived);
    const settings = plain(state.settings) ? state.settings : {};
    // Anything the seat had set was what that person was actually answering with, so it
    // wins over the workspace default it was overriding. Anything it left alone falls
    // through to the default, which is where it was coming from already.
    if (seat) {
      for (const key of ['voiceId', 'agentLanguage', 'customerLanguage', 'persona', 'formality', 'avatar', 'onboardedAt', 'registers', 'layout', 'phrases']) {
        if (seat[key] != null) settings[key] = seat[key];
      }
    }
    state = { ...state, version: VERSION, settings };
    delete state.agents; delete state.invites;
  }
  if (plain(state) && !Array.isArray(state.users)) state.users = [];
  // Registers renamed on 17 Sep 2026 (brisk -> energetic): old files keep loading, old takes keep their slot.
  const rename = map => plain(map) ? Object.fromEntries(Object.entries(map).map(([k, v]) => [canonicalRegister(k), v])) : map;
  for (const voice of Array.isArray(state.voices) ? state.voices : []) if (plain(voice) && voice.register) voice.register = canonicalRegister(voice.register);
  if (plain(state.settings) && state.settings.registers) state.settings.registers = rename(state.settings.registers);
  return state;
}

export function validateState(state) {
  if (!plain(state) || state.version !== VERSION || !Array.isArray(state.voices) || state.voices.length > 1000 || !Array.isArray(state.calls) || state.calls.length > 1000 || !plain(state.settings)) throw new Error('Stored NoteFish data has an invalid structure');
  const users = state.users ?? []; // older files have no accounts yet
  if (!Array.isArray(users) || users.length > 500) throw new Error('Stored account data is invalid');
  for (const user of users) {
    if (!plain(user) || !text(user.id, 128) || !text(user.name, 100) || !text(user.email, 254) || !text(user.passwordHash, 400) || !text(user.createdAt, 50)) throw new Error('Stored account data is invalid');
    if (!([undefined].includes(user.role) || ['admin', 'supervisor', 'agent'].includes(user.role))) throw new Error('Stored account data is invalid');
  }
  if (!([undefined, null].includes(state.authSecret) || text(state.authSecret, 128))) throw new Error('Stored account data is invalid');
  const settings = state.settings;
  if (!(settings.voiceId === null || text(settings.voiceId, 128)) || !text(settings.agentLanguage, 40) || !text(settings.customerLanguage, 40) || !text(settings.queueName, 100)) throw new Error('Stored settings are invalid');
  if (settings.registers !== undefined && (!plain(settings.registers) || Object.entries(settings.registers).some(([k, v]) => !REGISTERS.includes(k) || !(v === null || text(v, 128))))) throw new Error('Stored settings are invalid');
  if (!layoutOk(settings.layout) || !phrasesOk(settings.phrases)) throw new Error('Stored settings are invalid');
  if (!(settings.persona === undefined || settings.persona === null || text(settings.persona, 300))) throw new Error('Stored settings are invalid');
  if (!glossaryOk(settings.glossary) || !formalityOk(settings.formality) || !avatarOk(settings.avatar)) throw new Error('Stored settings are invalid');
  if (!([undefined, null].includes(settings.onboardedAt) || text(settings.onboardedAt, 50))) throw new Error('Stored settings are invalid');
  for (const voice of state.voices) {
    if (!plain(voice) || !text(voice.id, 128) || !text(voice.referenceId, 128) || !text(voice.name, 100) || !text(voice.description, 1000) || !text(voice.language, 40) || !['enrolled', 'licensed'].includes(voice.kind) || !['training', 'ready', 'failed'].includes(voice.status) || typeof voice.archived !== 'boolean' || !text(voice.createdAt, 50)) throw new Error('Stored voice data is invalid');
    if (!([undefined, null].includes(voice.register) || REGISTERS.includes(voice.register))) throw new Error('Stored voice data is invalid');
    if (!([undefined, null].includes(voice.ownerId) || text(voice.ownerId, 128))) throw new Error('Stored voice data is invalid');
    if (!([undefined, null].includes(voice.elevenReferenceId) || text(voice.elevenReferenceId, 128))) throw new Error('Stored voice data is invalid');
    if (!([undefined, null].includes(voice.baseline) || (plain(voice.baseline) && typeof voice.baseline.loudness === 'number' && typeof voice.baseline.rate === 'number'))) throw new Error('Stored voice data is invalid');
  }
  for (const call of state.calls) {
    const validSid = plain(call) && (call.transport === 'browser'
      ? /^browser:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(call.callSid)
      : [undefined, 'twilio'].includes(call.transport) && /^CA[0-9a-f]{32}$/i.test(call.callSid));
    if (!plain(call) || !text(call.id, 128) || !validSid || !text(call.from, 40) || !['ringing', 'in_call', 'ended'].includes(call.state) || !Array.isArray(call.transcript) || call.transcript.length > 5000 || !plain(call.ticket)) throw new Error('Stored call data is invalid');
    if (!([undefined, null].includes(call.agentId) || text(call.agentId, 128))) throw new Error('Stored call data is invalid');
    if (!([undefined, null].includes(call.detectedLanguage) || text(call.detectedLanguage, 40))) throw new Error('Stored call data is invalid');
    if (!([undefined, null].includes(call.callerTone) || text(call.callerTone, 20))) throw new Error('Stored call data is invalid');
    if (!([undefined, null].includes(call.via) || ['link', 'companion'].includes(call.via))) throw new Error('Stored call data is invalid');
    for (const line of call.transcript) if (!plain(line) || !['customer', 'agent'].includes(line.speaker) || !text(line.textSource, 12000) || !text(line.textShown, 12000) || !text(line.sourceLang, 40)) throw new Error('Stored transcript is invalid');
    if (!text(call.ticket.issue, 4000) || !text(call.ticket.address, 1000) || !['none', 'requested', 'confirmed', 'pending', true, false].includes(call.ticket.dispatch)) throw new Error('Stored ticket is invalid');
  }
  return state;
}

export async function createStore(filePath, { connectionString = '', driver } = {}) {
  const { storage, moved } = await chooseStorage({ filePath, connectionString, maxBytes: MAX_STATE, driver });
  let state = initialState();
  try {
    const encoded = await storage.load();
    if (encoded !== null) state = validateState(migrateState(JSON.parse(encoded)));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot load NoteFish data safely; inspect the stored data without sharing its private contents');
  }
  let pending = Promise.resolve();
  const persist = async (next) => {
    const encoded = JSON.stringify(validateState(next));
    if (Buffer.byteLength(encoded) > MAX_STATE) throw new Error('NoteFish storage is full. Archive or export older call data before continuing');
    await storage.save(encoded);
    state = next;
  };
  return {
    snapshot: () => structuredClone(state),
    update(mutator) {
      const work = pending.then(async () => {
        const next = structuredClone(state);
        const result = await mutator(next);
        await persist(next);
        return structuredClone(result);
      });
      pending = work.catch(() => {});
      return work;
    },
    flush: () => pending,
    where: () => storage.describe(),
    movedFromFile: moved,
    close: async () => { await pending; await storage.close(); },
  };
}
