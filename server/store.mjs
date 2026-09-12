import { mkdir, open, rename, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_STATE = 16 * 1024 * 1024;
const initialState = () => ({ version: 1, voices: [], settings: { voiceId: null, agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' }, calls: [] });
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.length <= max;

export function validateState(state) {
  if (!plain(state) || state.version !== 1 || !Array.isArray(state.voices) || state.voices.length > 1000 || !Array.isArray(state.calls) || state.calls.length > 1000 || !plain(state.settings)) throw new Error('Stored NoteFIsh data has an invalid structure');
  const settings = state.settings;
  if (!(settings.voiceId === null || text(settings.voiceId, 128)) || !text(settings.agentLanguage, 40) || !text(settings.customerLanguage, 40) || !text(settings.queueName, 100)) throw new Error('Stored settings are invalid');
  for (const voice of state.voices) {
    if (!plain(voice) || !text(voice.id, 128) || !text(voice.referenceId, 128) || !text(voice.name, 100) || !text(voice.description, 1000) || !text(voice.language, 40) || !['enrolled', 'licensed'].includes(voice.kind) || !['training', 'ready', 'failed'].includes(voice.status) || typeof voice.archived !== 'boolean' || !text(voice.createdAt, 50)) throw new Error('Stored voice data is invalid');
  }
  for (const call of state.calls) {
    const validSid = plain(call) && (call.transport === 'browser'
      ? /^browser:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(call.callSid)
      : [undefined, 'twilio'].includes(call.transport) && /^CA[0-9a-f]{32}$/i.test(call.callSid));
    if (!plain(call) || !text(call.id, 128) || !validSid || !text(call.from, 40) || !['ringing', 'in_call', 'ended'].includes(call.state) || !Array.isArray(call.transcript) || call.transcript.length > 5000 || !plain(call.ticket)) throw new Error('Stored call data is invalid');
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
    state = validateState(JSON.parse(await readFile(filePath, 'utf8')));
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
