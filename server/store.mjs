import { mkdir, open, rename, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isLayoutShape } from './layout.mjs';
import { REGISTERS, canonicalRegister } from './emotion.mjs';

const MAX_STATE = 16 * 1024 * 1024;
export const VERSION = 2;
export const MAX_AGENTS = 50;
const initialState = () => ({ version: VERSION, voices: [], settings: { voiceId: null, agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' }, agents: [], calls: [] });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;
const phrasesOk = value => value === undefined || (Array.isArray(value) && value.length <= 30 && value.every(item => plain(item) && text(item.id, 64) && text(item.text, 300) && item.text.trim()));
const layoutOk = value => value === undefined || isLayoutShape(value);

/** Version 1 held one global settings row and no roster. Its settings become the
 * workspace defaults that every agent inherits until they override one. */
export function migrateState(state) {
  if (!plain(state)) return state;
  if (state.version === 1) state = { ...state, version: VERSION, agents: [] };
  // Registers renamed on 17 Sep 2026 (brisk -> energetic): old files keep loading, old takes keep their slot.
  const rename = map => plain(map) ? Object.fromEntries(Object.entries(map).map(([k, v]) => [canonicalRegister(k), v])) : map;
  for (const voice of Array.isArray(state.voices) ? state.voices : []) if (plain(voice) && voice.register) voice.register = canonicalRegister(voice.register);
  if (plain(state.settings) && state.settings.registers) state.settings.registers = rename(state.settings.registers);
  for (const agent of Array.isArray(state.agents) ? state.agents : []) if (plain(agent) && agent.registers) agent.registers = rename(agent.registers);
  return state;
}

export function validateState(state) {
  if (!plain(state) || state.version !== VERSION || !Array.isArray(state.voices) || state.voices.length > 1000 || !Array.isArray(state.calls) || state.calls.length > 1000 || !plain(state.settings) || !Array.isArray(state.agents) || state.agents.length > MAX_AGENTS) throw new Error('Stored NoteFIsh data has an invalid structure');
  for (const agent of state.agents) {
    if (!plain(agent) || !text(agent.id, 128) || !agent.id || !text(agent.name, 100) || !agent.name.trim()
      || !(agent.voiceId === null || text(agent.voiceId, 128))
      || !(agent.agentLanguage === null || text(agent.agentLanguage, 40))
      || !(agent.customerLanguage === null || text(agent.customerLanguage, 40))
      || typeof agent.archived !== 'boolean' || !text(agent.createdAt, 50)) throw new Error('Stored agent data is invalid');
    if (agent.registers !== undefined && (!plain(agent.registers) || Object.entries(agent.registers).some(([k, v]) => !REGISTERS.includes(k) || !(v === null || text(v, 128))))) throw new Error('Stored agent data is invalid');
    if (!layoutOk(agent.layout) || !phrasesOk(agent.phrases)) throw new Error('Stored agent data is invalid');
    if (!(agent.persona === undefined || agent.persona === null || text(agent.persona, 300))) throw new Error('Stored agent data is invalid');
  }
  if (new Set(state.agents.map(agent => agent.id)).size !== state.agents.length) throw new Error('Stored agent data is invalid');
  const settings = state.settings;
  if (!(settings.voiceId === null || text(settings.voiceId, 128)) || !text(settings.agentLanguage, 40) || !text(settings.customerLanguage, 40) || !text(settings.queueName, 100)) throw new Error('Stored settings are invalid');
  if (settings.registers !== undefined && (!plain(settings.registers) || Object.entries(settings.registers).some(([k, v]) => !REGISTERS.includes(k) || !(v === null || text(v, 128))))) throw new Error('Stored settings are invalid');
  if (!layoutOk(settings.layout) || !phrasesOk(settings.phrases)) throw new Error('Stored settings are invalid');
  if (!(settings.persona === undefined || settings.persona === null || text(settings.persona, 300))) throw new Error('Stored settings are invalid');
  for (const voice of state.voices) {
    if (!plain(voice) || !text(voice.id, 128) || !text(voice.referenceId, 128) || !text(voice.name, 100) || !text(voice.description, 1000) || !text(voice.language, 40) || !['enrolled', 'licensed'].includes(voice.kind) || !['training', 'ready', 'failed'].includes(voice.status) || typeof voice.archived !== 'boolean' || !text(voice.createdAt, 50)) throw new Error('Stored voice data is invalid');
    if (!([undefined, null].includes(voice.register) || REGISTERS.includes(voice.register))) throw new Error('Stored voice data is invalid');
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
    for (const line of call.transcript) if (!plain(line) || !['customer', 'agent'].includes(line.speaker) || !text(line.textSource, 12000) || !text(line.textShown, 12000) || !text(line.sourceLang, 40)) throw new Error('Stored transcript is invalid');
    if (!text(call.ticket.issue, 4000) || !text(call.ticket.address, 1000) || !['none', 'requested', 'confirmed', 'pending', true, false].includes(call.ticket.dispatch)) throw new Error('Stored ticket is invalid');
  }
  return state;
}

export async function createStore(filePath) {
  let state = initialState();
  try {
    const info = await stat(filePath);
    if (info.size > MAX_STATE) throw new Error('Stored NoteFIsh data exceeds the size limit');
    state = validateState(migrateState(JSON.parse(await readFile(filePath, 'utf8'))));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot load NoteFIsh data safely; inspect the local data file without sharing its private contents');
  }
  let pending = Promise.resolve();
  const persist = async (next) => {
    const encoded = JSON.stringify(validateState(next));
    if (Buffer.byteLength(encoded) > MAX_STATE) throw new Error('NoteFIsh storage is full. Archive or export older call data before continuing');
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.tmp`;
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(encoded, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, filePath);
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
  };
}
