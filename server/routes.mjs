import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import twilio from 'twilio';
import { languages, languageCodes, isCallerLanguage } from './languages.mjs';
import { measureClip, REGISTERS, canonicalRegister } from './emotion.mjs';
import { isLayoutShape, normalizeLayout } from './layout.mjs';
import { buildPack, parsePack } from './voice-pack.mjs';
import { convertAudio } from './audio.mjs';
import { getStatus } from './config.mjs';
import { isLocalRequest, validateTwilio, constantTimeEqual } from './security.mjs';

export class InputError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') { super(message); this.name = 'InputError'; this.status = status; this.code = code; }
}

/** How a reply should sound, when the agent chose instead of letting the desk decide. */
const feelingInput = value => {
  if (value === undefined || value === '' || value === 'auto') return undefined;
  value = canonicalRegister(value);
  if (!REGISTERS.includes(value)) throw new InputError(`Choose a feeling: auto, ${REGISTERS.join(', ')}.`);
  return value;
};
/** A desk layout as sent by the app: three columns of panel ids. */
const layoutInput = value => { if (!isLayoutShape(value)) throw new InputError('The desk layout is not valid.'); return normalizeLayout(value); };
/** Canned lines: short strings an agent speaks with one click. Ids are kept when sane so the list can be edited in place. */
/** Glossary: words that stay as written, are translated a set way, or are read out letter by letter. */
function glossaryInput(value) {
  if (!Array.isArray(value) || value.length > 200) throw new InputError('The glossary must be a list of up to 200 entries.');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') throw new InputError('Each glossary entry needs a term.');
    allowed(item, ['id', 'term', 'kind', 'as']);
    const kind = ['keep', 'as', 'spell'].includes(item.kind) ? item.kind : 'keep';
    return { id: text(item.id || `g-${index}-${Date.now().toString(36)}`, 'glossary id', 64), term: text(item.term, 'term', 120).trim(), kind, as: kind === 'as' ? text(item.as ?? '', 'translation', 200, true).trim() : '' };
  }).filter(item => item.term);
}
function formalityInput(value) {
  if (value === null || value === undefined || value === '') return null;
  if (!['formal', 'casual', 'match'].includes(value)) throw new InputError('Register must be formal, casual or match.');
  return value;
}
function avatarInput(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object') throw new InputError('Avatar must be a shape and a colour.');
  allowed(value, ['variant', 'color', 'face']);
  if (!/^#[0-9A-Fa-f]{6}$/.test(String(value.color || ''))) throw new InputError('Avatar colour must be a hex colour.');
  return { variant: text(value.variant, 'avatar shape', 20), color: value.color.toUpperCase(), face: value.face !== false };
}

const phrasesInput = value => {
  if (!Array.isArray(value) || value.length > 30) throw new InputError('Canned lines are a list of at most 30 lines.');
  return value.map(item => {
    const raw = item && typeof item === 'object' ? item.text : item;
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 300) throw new InputError('Each canned line is 1 to 300 characters.');
    return { id: typeof item?.id === 'string' && /^[\w-]{1,64}$/.test(item.id) ? item.id : randomUUID(), text: raw.trim() };
  });
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const allowed = (body, fields) => {
  if (!object(body) || Object.keys(body).some(key => !fields.includes(key))) throw new InputError('The request contains an invalid field.');
};
const text = (value, name, max, optional = false) => {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new InputError(`Provide a valid ${name} within ${max} characters.`);
  return value.trim();
};
const language = value => {
  if (!languageCodes.has(value)) throw new InputError('Choose a language from the supported language list.');
  return value;
};
const callerLanguage = value => {
  if (!isCallerLanguage(value)) throw new InputError('Choose a language from the supported language list, or auto-detect.');
  return value;
};
const ref = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new InputError('Provide a valid Fish reference ID.');
  return value;
};
const CONTENT_FIELDS = ['glossary', 'phrases', 'persona', 'formality'];
const voiceState = value => value === 'trained' ? 'ready' : value === 'failed' ? 'failed' : 'training';
const findVoice = (store, id, ready = false) => {
  const voice = store.snapshot().voices.find(item => item.id === id);
  if (!voice) throw new InputError('Voice not found.', 404, 'NOT_FOUND');
  if (ready && (voice.archived || voice.status !== 'ready')) throw new InputError('Choose a ready voice from your active voice library.', 409);
  return voice;
};

/** The roster as the desk sees it: each seat with its pending invitation link, if any. */
export function roster(store, accounts, config) {
  const base = config.publicBaseUrl || `http://127.0.0.1:${config.port}`;
  return store.snapshot().agents.map(agent => { const invite = accounts?.invites.pending(agent.id); return { ...agent, inviteUrl: invite ? `${base}/join#${invite.token}` : null, inviteExpiresAt: invite?.expiresAt || null }; });
}

export function createApiRouter({ config, store, providers, calls, broadcast, audioAvailable, callerAccess, sessions, queue, integrations, accounts = null, floorEvent = () => {} }) {
  const router = express.Router();
  // A shared demo cannot tell one anonymous visitor from another, so it stays a
  // single desk. Named agents require the protected access mode.
  const multiAgent = !config.publicDemo;
  const currentAgent = req => (multiAgent && sessions ? sessions.read(req) : '');
  // A deployment with an empty roster is one desk and needs no seat. Seats
  // become required only once someone actually adds agents.
  const rostered = () => multiAgent && store.snapshot().agents.some(agent => !agent.archived);
  const requireFloor = () => {
    if (!multiAgent) throw new InputError('The shared demo runs as one desk. Set NOTEFISH_PUBLIC_DEMO=false to use a roster of agents.', 409, 'SINGLE_DESK');
  };
  // Who is asking. An account carries a role. A desk reached without one (local development,
  // the shared desk password, the demo) is run by whoever holds that access: admin.
  const userOf = req => accounts?.read(req) || '';
  const roleOf = req => { const id = userOf(req); return id ? accounts.roleOf(id) || 'admin' : 'admin'; };
  const forbid = message => { throw new InputError(message, 403, 'FORBIDDEN'); };
  const adminOnly = (req, res, next) => roleOf(req) === 'admin' ? next() : next(new InputError('Only an admin can do this.', 403, 'FORBIDDEN'));
  const requireAccounts = () => { if (!accounts) throw new InputError('This desk has no accounts.', 409); };
  const ownsSeat = (req, agent) => Boolean(agent.userId) && agent.userId === userOf(req);
  // A recorded voice belongs to whoever recorded it: only they, or an admin, use, share or remove it.
  // Licensed voices and voices from before ownership are shared; admins and supervisors look after those.
  const manages = (req, voice) => roleOf(req) === 'admin' || (voice.ownerId ? voice.ownerId === userOf(req) : roleOf(req) !== 'agent');
  const mayUse = (req, voice) => voice.kind !== 'enrolled' || !voice.ownerId || manages(req, voice);
  const usableVoice = (req, id) => { const voice = findVoice(store, id, true); if (!mayUse(req, voice)) forbid(`${voice.name} belongs to someone else.`); return voice.id; };
  const voiceView = (req, voice) => ({ ...voice, owner: voice.ownerId ? accounts?.find(voice.ownerId)?.name || null : null, mine: manages(req, voice), usable: mayUse(req, voice) });
  // Deleting for good: the model goes at Fish first, then the library entry and every seat that pointed at it.
  const purgeVoices = async ids => {
    for (const id of ids) {
      const voice = findVoice(store, id);
      if (voice.kind === 'enrolled') await providers.deleteVoice({ referenceId: voice.referenceId });
      await store.update(state => {
        state.voices = state.voices.filter(item => item.id !== id);
        const scrub = owner => { if (owner.voiceId === id) owner.voiceId = null; for (const key of Object.keys(owner.registers || {})) if (owner.registers[key] === id) owner.registers[key] = null; };
        scrub(state.settings); state.agents.forEach(scrub);
      });
    }
  };
  const findAgent = (id, { active = true } = {}) => {
    const agent = store.snapshot().agents.find(item => item.id === id);
    if (!agent || (active && agent.archived)) throw new InputError('Agent not found.', 404, 'NOT_FOUND');
    return agent;
  };
  /** An agent may only act on the call assigned to them. */
  const ownCall = (req, id) => {
    if (!multiAgent) return '';
    const agentId = currentAgent(req);
    const call = calls.snapshot().find(item => item.id === id);
    if (call?.agentId && agentId && call.agentId !== agentId) throw new InputError('This call belongs to another agent.', 403, 'NOT_YOUR_CALL');
    return agentId;
  };
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 8, fieldSize: 8000, parts: 10 } }).single('audio');
  let activeExpensive = 0;
  const limited = handler => async (req, res, next) => {
    if (activeExpensive >= 2) return next(new InputError('Two audio requests are already running. Wait a moment and retry.', 429, 'AUDIO_BUSY'));
    activeExpensive++;
    try { await handler(req, res); } catch (error) { next(error); } finally { activeExpensive--; }
  };
  const stateEvent = () => broadcast({ type: 'snapshot', calls: calls.snapshot(), settings: store.snapshot().settings, agents: roster(store, accounts, config), floor: queue ? queue.snapshot() : null });
  router.get('/session', (req, res) => {
    const agentId = currentAgent(req);
    const agent = agentId ? store.snapshot().agents.find(item => item.id === agentId && !item.archived) : null;
    res.json({
      authenticated: !config.publicDemo, loginRequired: false,
      method: config.publicDemo ? 'shared-demo' : !config.production && isLocalRequest(req) ? 'local' : 'basic',
      multiAgent,
      // Naming an agent identifies a seat. It does not authenticate a person.
      identity: multiAgent ? 'roster-presence' : 'single-desk',
      agent: agent ? { id: agent.id, name: agent.name } : null,
      persistentSessions: sessions ? !sessions.ephemeral : false,
    });
  });
  router.post('/caller-invitations', (req, res) => {
    if (req.body !== undefined) allowed(req.body, ['label', 'transport']);
    const label = req.body?.label ? text(req.body.label, 'call label', 40) : '';
    const local = req.body?.transport === 'companion';
    // The companion bridges a call happening on this machine (Zoom, WhatsApp, Meet…); it may only join from here.
    if (local && !isLocalRequest(req)) throw new InputError('The companion can only join from the machine running the desk.', 403);
    res.status(201).json(callerAccess.issue({ label, local }));
  });
  router.get(['/status', '/setup'], (req, res) => res.json(getStatus(config, { audioAvailable, driverInstalled: process.platform === 'darwin' ? existsSync('/Library/Audio/Plug-Ins/HAL/NoteFishVoice.driver') : null })));
  router.get('/languages', (req, res) => res.json({ languages }));
  /** The Mac app's pill has no console anyone can read; it reports here, and only from this machine. */
  router.post('/log', (req, res) => {
    if (!isLocalRequest(req)) throw new InputError('Local only.', 403);
    console.log(`[pill] ${String(req.body?.line ?? '').slice(0, 600)}`);
    res.status(204).end();
  });
  router.get('/bootstrap', (req, res) => res.json({
    ...store.snapshot(), calls: calls.snapshot(), setup: getStatus(config, { audioAvailable }), languages,
    floor: queue ? queue.snapshot() : null, agentId: currentAgent(req),
  }));
  router.get('/voices', (req, res) => {
    if (req.query.archived !== undefined && !['true', 'false'].includes(req.query.archived)) throw new InputError('The archived filter must be true or false.');
    res.json({ voices: store.snapshot().voices.filter(voice => req.query.archived === 'true' || !voice.archived).map(voice => voiceView(req, voice)) });
  });
  // Voice files: the Fish reference plus what the library knows. Import re-attaches after Fish confirms the model.
  router.get('/voices/export', (req, res) => {
    const state = store.snapshot();
    res.setHeader('Content-Disposition', 'attachment; filename="notefish-voices.json"');
    res.json(buildPack(state.voices.filter(voice => !voice.archived && manages(req, voice)), { exportedBy: state.settings.queueName || '' }));
  });
  router.get('/voices/:id/export', (req, res) => {
    const voice = findVoice(store, req.params.id);
    if (!manages(req, voice)) forbid(`Only ${voice.owner ? voice.owner : 'the owner'} of ${voice.name}, or an admin, can share it.`);
    res.setHeader('Content-Disposition', `attachment; filename="${(voice.name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'voice').slice(0, 60)}.notefish-voice.json"`);
    res.json(buildPack([voice]));
  });
  router.post('/voices/import-pack', limited(async (req, res) => {
    allowed(req.body, ['pack', 'consent']);
    if (req.body.consent !== true) throw new InputError('Confirm that you own or have licensed these voices.');
    let entries;
    try { entries = parsePack(req.body.pack); } catch (error) { throw new InputError(error.message); }
    const imported = [], skipped = [];
    for (const entry of entries) {
      if (store.snapshot().voices.some(voice => voice.referenceId === entry.referenceId)) { skipped.push(entry.name); continue; }
      if (store.snapshot().voices.length >= 1000) throw new InputError('The voice library is full.', 409);
      const result = await providers.getVoice({ referenceId: entry.referenceId });
      const voice = { id: randomUUID(), referenceId: entry.referenceId, name: entry.name, description: entry.description, language: languageCodes.has(entry.language) ? entry.language : 'en', kind: entry.kind,
        status: voiceState(result.state), archived: false, createdAt: new Date().toISOString(), consent: true, consentAt: new Date().toISOString(), ownerId: userOf(req) || null,
        ...(entry.register ? { register: entry.register } : {}), ...(entry.baseline ? { baseline: entry.baseline } : {}) };
      await store.update(state => { if (!state.voices.some(item => item.referenceId === voice.referenceId)) state.voices.push(voice); });
      imported.push(voice);
    }
    stateEvent(); res.status(201).json({ imported, skipped });
  }));
  router.get('/voices/available', limited(async (req, res) => {
    const results = await providers.listOwnVoices();
    res.json({ voices: results.map(voice => ({ referenceId: ref(voice.referenceId), name: voice.name, description: voice.description, status: voiceState(voice.state), languages: voice.languages || [] })) });
  }));
  router.post(['/voices/clone', '/voices'], limited(async (req, res) => {
    await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
    allowed(req.body, ['name', 'description', 'transcript', 'language', 'consent', 'kind', 'register']);
    if (req.body.consent !== 'true') throw new InputError('Confirm that this is your own voice or that you have permission to clone it.');
    const register = req.body.register ? canonicalRegister(req.body.register) : null;
    if (register !== null && !REGISTERS.includes(register)) throw new InputError(`Choose a register: ${REGISTERS.join(', ')}.`);
    if (store.snapshot().calls.some(call => call.state !== 'ended')) throw new InputError('Finish the call before enrolling a voice.', 409);
    if (!req.file) throw new InputError('Record or upload a voice sample.');
    if (store.snapshot().voices.length >= 1000) throw new InputError('The voice library is full.', 409);
    const name = text(req.body.name, 'voice name', 100);
    const description = text(req.body.description, 'description', 1000, true);
    const selectedLanguage = language(req.body.language || 'en');
    const transcript = text(req.body.transcript, 'sample transcript', 6000, true);
    // The reference's own loudness and rate are the baseline every later reply is measured against.
    let baseline = null;
    try {
      const wav = await convertAudio(req.file.buffer, req.file.mimetype, { output: 'wav', sampleRate: 16000, maxSeconds: 120, minSeconds: 3 });
      const clip = measureClip(wav, transcript ? transcript.trim().split(/\s+/u).length : 0);
      // Digital silence measures as nothing at all; only a real signal drowned in noise is refused.
      if (clip.voicedSeconds >= 1 && clip.snr < 15 && clip.loudness > -70) throw new InputError('We can hear the room more than your voice. Find a quieter spot and record again.', 422, 'NOISY_SAMPLE');
      baseline = { loudness: clip.loudness, rate: clip.rate, snr: clip.snr, seconds: clip.voicedSeconds };
    } catch (error) { if (error instanceof InputError) throw error; /* measurement is best-effort */ }
    const result = await providers.createVoice({ name, description, audio: req.file.buffer, mimeType: req.file.mimetype, transcript });
    const voice = { id: randomUUID(), referenceId: ref(result.referenceId), name, description, language: selectedLanguage, kind: 'enrolled', status: voiceState(result.state), archived: false, createdAt: new Date().toISOString(), consent: true, consentAt: new Date().toISOString(), ownerId: userOf(req) || null, register, baseline };
    const agentId = currentAgent(req);
    await store.update(state => {
      state.voices.push(voice);
      // A seated agent's take lands in their own register slot; the first one also becomes their default.
      const agent = agentId ? state.agents.find(item => item.id === agentId && !item.archived) : null;
      const owner = agent || state.settings;
      owner.registers = { ...(owner.registers || {}), ...(register ? { [register]: voice.id } : {}) };
      if (agent && (!agent.voiceId || register === 'calm')) agent.voiceId = voice.id;
    });
    res.status(201).json({ voice });
  }));
  router.post('/voices/import', limited(async (req, res) => {
    allowed(req.body, ['referenceId', 'name', 'description', 'language', 'consent', 'kind']);
    if (req.body.consent !== true) throw new InputError('Confirm that you own or have licensed this voice.');
    const referenceId = ref(req.body.referenceId);
    const kind = req.body.kind || 'licensed';
    if (!['enrolled', 'licensed'].includes(kind)) throw new InputError('Choose an enrolled or licensed voice.');
    const name = text(req.body.name, 'voice name', 100);
    const description = text(req.body.description, 'description', 1000, true);
    const selectedLanguage = language(req.body.language || 'en');
    const existing = store.snapshot().voices.find(voice => voice.referenceId === referenceId);
    if (existing) throw new InputError('That voice is already in the library. Restore it if it is archived.', 409);
    if (store.snapshot().voices.length >= 1000) throw new InputError('The voice library is full.', 409);
    const result = await providers.getVoice({ referenceId });
    const voice = { id: randomUUID(), referenceId, name, description, language: selectedLanguage, kind, status: voiceState(result.state), archived: false, createdAt: new Date().toISOString(), consent: true, consentAt: new Date().toISOString(), ownerId: userOf(req) || null };
    await store.update(state => { if (state.voices.some(item => item.referenceId === referenceId)) throw new InputError('That voice is already in the library.', 409); state.voices.push(voice); });
    res.status(201).json({ voice });
  }));
  async function updateVoice(req, res, archive = false) {
    const patch = archive ? { archived: true } : req.body;
    allowed(patch, ['name', 'description', 'archived']);
    const target = findVoice(store, req.params.id);
    if (!manages(req, target)) forbid(`${target.name} belongs to someone else.`);
    const changes = {};
    if ('name' in patch) changes.name = text(patch.name, 'voice name', 100);
    if ('description' in patch) changes.description = text(patch.description, 'description', 1000, true);
    if ('archived' in patch) { if (typeof patch.archived !== 'boolean') throw new InputError('Archived must be true or false.'); changes.archived = patch.archived; }
    const voice = await store.update(state => {
      const item = state.voices.find(item => item.id === req.params.id);
      Object.assign(item, changes);
      if (item.archived && state.settings.voiceId === item.id) state.settings.voiceId = null;
      return item;
    });
    stateEvent(); res.json({ voice });
  }
  router.patch('/voices/:id', (req, res) => updateVoice(req, res));
  router.delete('/voices/:id', async (req, res) => {
    if (req.query.permanent !== 'true') return updateVoice(req, res, true);
    const voice = findVoice(store, req.params.id);
    if (!manages(req, voice)) forbid(`${voice.name} belongs to someone else.`);
    await purgeVoices([voice.id]);
    stateEvent(); res.json({ deleted: voice.id });
  });
  router.post('/voices/:id/refresh', limited(async (req, res) => {
    const original = findVoice(store, req.params.id);
    const result = await providers.getVoice({ referenceId: original.referenceId });
    const voice = await store.update(state => { const item = state.voices.find(item => item.id === original.id); item.status = voiceState(result.state); return item; });
    res.json({ voice });
  }));
  router.post('/voices/:id/preview', limited(async (req, res) => {
    allowed(req.body, ['text', 'language', 'sourceLanguage']);
    const voice = findVoice(store, req.params.id, true);
    if (!mayUse(req, voice)) forbid(`${voice.name} belongs to someone else.`);
    const previewText = text(req.body.text, 'preview text', 1000);
    const targetLanguage = language(req.body.language || voice.language);
    const sourceLanguage = language(req.body.sourceLanguage || store.snapshot().settings.agentLanguage);
    const spokenText = sourceLanguage === targetLanguage ? previewText : await providers.translate({ text: previewText, sourceLanguage, targetLanguage });
    const audio = await providers.synthesize({ text: spokenText, referenceId: voice.referenceId, format: 'mp3' });
    res.type('audio/mpeg').send(audio);
  }));
  /** Setup's "hear yourself": a clip or a line in your language comes back spoken in the caller's, in the desk voice. */
  router.post('/try', limited(async (req, res) => {
    const settings = store.snapshot().settings;
    const voice = settings.voiceId ? findVoice(store, settings.voiceId, true) : null;
    if (!voice) throw new InputError('Choose a voice first.', 409, 'NO_VOICE');
    const sourceLanguage = language(settings.agentLanguage);
    const targetLanguage = settings.customerLanguage === 'auto' ? 'fr' : language(settings.customerLanguage);
    let heard;
    if (req.is('multipart/form-data')) {
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      if (!req.file) throw new InputError('Say something first.');
      if (!providers.transcribe) throw new InputError('Transcription needs the OpenAI key on the server.', 503);
      heard = await providers.transcribe({ audio: req.file.buffer, mimeType: req.file.mimetype, language: sourceLanguage });
    } else {
      allowed(req.body, ['text']);
      heard = text(req.body.text, 'line', 1000);
    }
    if (!heard?.trim()) throw new InputError('Nothing was heard. Try again a little closer to the microphone.');
    const said = sourceLanguage === targetLanguage ? heard : await providers.translate({ text: heard, sourceLanguage, targetLanguage });
    const audio = await providers.synthesize({ text: said, referenceId: voice.referenceId, format: 'mp3' });
    res.json({ heard, said, language: targetLanguage, audio: audio.toString('base64') });
  }));
  router.get('/settings', (req, res) => res.json({ settings: store.snapshot().settings }));
  const saveSettings = async (req, res) => {
    allowed(req.body, ['voiceId', 'agentLanguage', 'customerLanguage', 'queueName', 'registers', 'layout', 'phrases', 'persona', 'glossary', 'formality', 'avatar', 'onboardedAt']);
    const role = roleOf(req);
    if (role === 'agent') forbid('Only an admin can change workspace settings. Your own seat is under Voice.');
    if (role === 'supervisor' && Object.keys(req.body).some(key => !CONTENT_FIELDS.includes(key))) forbid('Supervisors keep the glossary, phrases and house style. Other settings need an admin.');
    const patch = {};
    if ('onboardedAt' in req.body) patch.onboardedAt = req.body.onboardedAt === null ? null : new Date().toISOString(); // true = now, null = run setup again
    if ('persona' in req.body) patch.persona = text(req.body.persona ?? '', 'house style', 300, true).trim();
    if ('glossary' in req.body) patch.glossary = glossaryInput(req.body.glossary);
    if ('formality' in req.body) patch.formality = formalityInput(req.body.formality);
    if ('avatar' in req.body) patch.avatar = avatarInput(req.body.avatar);
    if ('layout' in req.body) patch.layout = layoutInput(req.body.layout);
    if ('phrases' in req.body) patch.phrases = phrasesInput(req.body.phrases);
    if ('registers' in req.body) {
      req.body.registers = Object.fromEntries(Object.entries(req.body.registers || {}).map(([k, v]) => [canonicalRegister(k), v]));
      allowed(req.body.registers, REGISTERS);
      patch.registers = Object.fromEntries(Object.entries(req.body.registers).map(([k, v]) => [canonicalRegister(k), v ? findVoice(store, v, true).id : null]));
    }
    if ('voiceId' in req.body) { if (req.body.voiceId !== null) findVoice(store, req.body.voiceId, true); patch.voiceId = req.body.voiceId; }
    if ('agentLanguage' in req.body) patch.agentLanguage = language(req.body.agentLanguage);
    if ('customerLanguage' in req.body) patch.customerLanguage = callerLanguage(req.body.customerLanguage);
    if ('queueName' in req.body) patch.queueName = text(req.body.queueName, 'queue name', 100);
    const settings = await store.update(state => { Object.assign(state.settings, patch); return state.settings; });
    await calls.applySettings(settings);
    stateEvent(); res.json({ settings });
  };
  router.put('/settings', saveSettings); router.patch('/settings', saveSettings);
  const rosterView = () => roster(store, accounts, config);
  const joinUrl = token => `${config.publicBaseUrl || `http://127.0.0.1:${config.port}`}/join#${token}`;
  router.get('/agents', (req, res) => res.json({ agents: rosterView(), floor: queue ? queue.snapshot() : null, agentId: currentAgent(req) }));
  router.post('/agents/:id/invite', adminOnly, async (req, res) => {
    requireFloor();
    const agent = findAgent(req.params.id);
    if (!agent.email) throw new InputError('Give this agent an email first.');
    if (!accounts) throw new InputError('Invitations need accounts on this server.', 503);
    const invite = await accounts.invites.issue(agent);
    stateEvent();
    res.json({ inviteUrl: joinUrl(invite.token), expiresAt: invite.expiresAt });
  });
  router.post('/agents', adminOnly, async (req, res) => {
    requireFloor();
    allowed(req.body, ['name', 'voiceId', 'agentLanguage', 'customerLanguage', 'email']);
    // An email makes the seat an invitation: the person who opens the link signs up as that seat.
    const email = req.body.email ? text(req.body.email, 'email', 254).trim().toLowerCase() : '';
    if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(email)) throw new InputError('That email address does not look right.');
    const name = text(req.body.name || (email ? email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : ''), 'agent name', 100);
    const agent = {
      id: randomUUID(), name, ...(email ? { email, userId: null } : {}),
      voiceId: req.body.voiceId ? findVoice(store, req.body.voiceId, true).id : null,
      agentLanguage: req.body.agentLanguage ? language(req.body.agentLanguage) : null,
      customerLanguage: req.body.customerLanguage ? callerLanguage(req.body.customerLanguage) : null,
      registers: {}, archived: false, createdAt: new Date().toISOString(),
    };
    await store.update(state => {
      const active = state.agents.filter(item => !item.archived);
      if (active.length >= config.maxAgents) throw new InputError(`The roster is limited to ${config.maxAgents} agents.`, 409);
      if (active.some(item => item.name.toLowerCase() === name.toLowerCase())) throw new InputError('An agent with that name is already on the roster.', 409);
      if (email && active.some(item => item.email === email)) throw new InputError('Someone with that email is already on the roster.', 409);
      state.agents.push(agent);
    });
    const invite = email && accounts ? await accounts.invites.issue(agent) : null;
    stateEvent(); floorEvent();
    res.status(201).json({ agent, inviteUrl: invite ? joinUrl(invite.token) : null, expiresAt: invite?.expiresAt || null });
  });
  router.patch('/agents/:id', async (req, res) => {
    requireFloor();
    allowed(req.body, ['name', 'voiceId', 'agentLanguage', 'customerLanguage', 'archived', 'registers', 'layout', 'phrases', 'persona', 'formality', 'avatar']);
    const target = findAgent(req.params.id, { active: false });
    if (roleOf(req) !== 'admin') {
      if (!ownsSeat(req, target)) forbid('Only an admin can change another seat.');
      if ('archived' in req.body) forbid('Only an admin can remove a seat.');
    }
    const changes = {};
    if ('persona' in req.body) changes.persona = text(req.body.persona ?? '', 'style', 300, true).trim();
    if ('formality' in req.body) changes.formality = formalityInput(req.body.formality);
    if ('avatar' in req.body) changes.avatar = avatarInput(req.body.avatar);
    if ('layout' in req.body) changes.layout = layoutInput(req.body.layout);
    if ('phrases' in req.body) changes.phrases = phrasesInput(req.body.phrases);
    if ('name' in req.body) changes.name = text(req.body.name, 'agent name', 100);
    if ('voiceId' in req.body) changes.voiceId = req.body.voiceId ? usableVoice(req, req.body.voiceId) : null;
    if ('agentLanguage' in req.body) changes.agentLanguage = req.body.agentLanguage ? language(req.body.agentLanguage) : null;
    if ('customerLanguage' in req.body) changes.customerLanguage = req.body.customerLanguage ? callerLanguage(req.body.customerLanguage) : null;
    if ('registers' in req.body) {
      req.body.registers = Object.fromEntries(Object.entries(req.body.registers || {}).map(([k, v]) => [canonicalRegister(k), v]));
      allowed(req.body.registers, REGISTERS);
      changes.registers = Object.fromEntries(Object.entries(req.body.registers).map(([k, v]) => [canonicalRegister(k), v ? usableVoice(req, v) : null]));
    }
    if ('archived' in req.body) {
      if (typeof req.body.archived !== 'boolean') throw new InputError('Archived must be true or false.');
      changes.archived = req.body.archived;
    }
    if (changes.archived && calls.snapshot().some(call => call.agentId === req.params.id && call.state !== 'ended')) {
      throw new InputError('End this agent\'s call before removing them from the roster.', 409);
    }
    const agent = await store.update(state => {
      const item = state.agents.find(item => item.id === req.params.id);
      Object.assign(item, changes);
      return item;
    });
    stateEvent(); floorEvent();
    res.json({ agent });
  });
  router.delete('/agents/:id', adminOnly, async (req, res) => {
    requireFloor();
    findAgent(req.params.id, { active: false });
    if (calls.snapshot().some(call => call.agentId === req.params.id && call.state !== 'ended')) throw new InputError('End this agent\'s call before removing them from the roster.', 409);
    const agent = await store.update(state => {
      const item = state.agents.find(item => item.id === req.params.id);
      item.archived = true;
      return item;
    });
    stateEvent(); floorEvent();
    res.json({ agent });
  });
  // Taking a seat is presence, not a login: it says which roster entry this
  // browser is acting as. Workspace access was already decided upstream.
  router.post('/agents/:id/session', (req, res) => {
    requireFloor();
    if (req.body !== undefined) allowed(req.body, []);
    const agent = findAgent(req.params.id);
    if (agent.userId && !ownsSeat(req, agent) && roleOf(req) !== 'admin') forbid(`That seat belongs to ${agent.name}.`);
    res.setHeader('Set-Cookie', sessions.cookie(agent.id));
    res.status(201).json({ agent: { id: agent.id, name: agent.name } });
  });
  router.delete('/agents/session', (req, res) => {
    const agentId = currentAgent(req);
    res.setHeader('Set-Cookie', sessions ? sessions.clearCookie() : '');
    if (agentId && queue) { queue.resume(agentId); floorEvent(); }
    res.json({ agent: null });
  });
  router.post('/agents/session/pause', (req, res) => {
    requireFloor();
    allowed(req.body || {}, ['reason']);
    const agentId = currentAgent(req);
    if (!agentId) throw new InputError('Take a seat before pausing.', 409, 'NO_SEAT');
    queue.pause(agentId, text(req.body?.reason, 'reason', 100, true));
    floorEvent();
    res.json({ floor: queue.snapshot() });
  });
  router.post('/agents/session/resume', (req, res) => {
    requireFloor();
    if (req.body !== undefined) allowed(req.body, []);
    const agentId = currentAgent(req);
    if (!agentId) throw new InputError('Take a seat before resuming.', 409, 'NO_SEAT');
    queue.resume(agentId);
    floorEvent();
    res.json({ floor: queue.snapshot() });
  });
  // People. Roles live on accounts; a seat is what an account answers as.
  router.get('/users', adminOnly, (req, res) => { requireAccounts(); res.json({ users: accounts.list() }); });
  router.patch('/users/:id', adminOnly, async (req, res) => {
    requireAccounts(); allowed(req.body, ['role']);
    if (req.params.id === userOf(req)) throw new InputError('Ask another admin to change your own role.', 409);
    res.json({ user: await accounts.setRole(req.params.id, req.body.role) });
  });
  // Offboarding: their recorded voices are deleted at Fish, their seats are freed, the account goes.
  router.delete('/users/:id', adminOnly, async (req, res) => {
    requireAccounts();
    if (req.params.id === userOf(req)) throw new InputError('You cannot remove your own account.', 409);
    if (!accounts.find(req.params.id)) throw new InputError('Account not found.', 404, 'NOT_FOUND');
    const theirs = store.snapshot().voices.filter(voice => voice.ownerId === req.params.id).map(voice => voice.id);
    await purgeVoices(theirs);
    const user = await accounts.remove(req.params.id);
    stateEvent(); floorEvent();
    res.json({ user, voicesDeleted: theirs.length });
  });
  router.get('/floor', (req, res) => res.json({ floor: queue ? queue.snapshot() : { waiting: [], agents: [] } }));
  /** The ask bar. The question travels with a bounded slice of the desk's own data; the answer comes back as plain text. */
  router.post('/ask', limited(async (req, res) => {
    allowed(req.body, ['question', 'scope', 'callId']);
    if (!providers.ask) throw new InputError('Asking needs the OpenAI key on the server.', 503);
    const question = text(req.body.question, 'question', 500).trim();
    if (!question) throw new InputError('Ask something first.');
    const scope = ['call', 'calls', 'floor', 'settings'].includes(req.body.scope) ? req.body.scope : 'calls';
    const state = store.snapshot();
    const brief = call => ({ id: call.id, from: call.from, startedAt: call.startedAt, answeredAt: call.answeredAt, endedAt: call.endedAt, state: call.state, agent: state.agents.find(a => a.id === call.agentId)?.name || null, callerLanguage: call.detectedLanguage || call.customerLanguage, agentLanguage: call.agentLanguage, notes: call.ticket, replies: (call.transcript || []).filter(l => l.speaker === 'agent').length, callerLines: (call.transcript || []).filter(l => l.speaker !== 'agent').length });
    let context;
    if (scope === 'call') {
      const call = calls.snapshot().find(item => item.id === String(req.body.callId || ''));
      if (!call) throw new InputError('That call is not here.', 404);
      context = { call: brief(call), transcript: (call.transcript || []).slice(-80).map(l => ({ at: l.t, who: l.speaker === 'agent' ? 'agent' : 'caller', said: l.textSource, shown: l.textShown, feeling: l.feeling })) };
    } else if (scope === 'floor') context = { floor: queue ? queue.snapshot() : null, agents: state.agents.filter(a => !a.archived).map(a => ({ name: a.name, languages: [a.agentLanguage, a.customerLanguage] })) };
    else if (scope === 'settings') context = { settings: { ...state.settings, glossary: undefined }, glossary: state.settings.glossary || [], voices: state.voices.map(v => ({ name: v.name, kind: v.kind, status: v.status, language: v.language })), agents: state.agents.filter(a => !a.archived).map(a => a.name) };
    else context = { now: new Date().toISOString(), calls: calls.snapshot().slice(-60).map(brief) };
    res.json({ answer: await providers.ask({ question, context }) });
  }));
  router.get('/integrations', (req, res) => res.json({
    enabled: Boolean(integrations?.enabled), adapters: integrations?.names || [], recent: integrations?.history() || [],
  }));
  router.get('/calls', (req, res) => res.json({ calls: calls.snapshot() }));
  router.post('/calls/:id/answer', async (req, res) => {
    const agentId = ownCall(req, req.params.id);
    if (rostered() && !agentId) throw new InputError('Take a seat on the floor before answering.', 409, 'NO_SEAT');
    res.json({ call: await calls.answer(req.params.id, agentId || null) });
  });
  for (const action of ['end', 'stop']) router.post(`/calls/:id/${action}`, async (req, res) => {
    ownCall(req, req.params.id);
    res.json({ call: await calls[action](req.params.id) });
  });
  router.post('/calls/:id/reply', limited(async (req, res) => {
    ownCall(req, req.params.id);
    if (req.is('multipart/form-data')) {
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      if (!req.file) throw new InputError('Record a reply first.');
      allowed(req.body, ['feeling']);
      res.json({ call: await calls.ptt(req.params.id, { buffer: req.file.buffer, mimetype: req.file.mimetype, feeling: feelingInput(req.body.feeling) }) });
    } else {
      allowed(req.body, ['text', 'feeling']);
      res.json({ call: await calls.say(req.params.id, { text: text(req.body.text, 'reply', 3000), feeling: feelingInput(req.body.feeling) }) });
    }
  }));
  router.patch('/calls/:id/ticket', async (req, res) => {
    const agentId = ownCall(req, req.params.id);
    const actor = agentId ? store.snapshot().agents.find(item => item.id === agentId)?.name || '' : '';
    allowed(req.body, ['issue', 'address', 'dispatch', 'confirmDispatch']);
    const patch = {};
    if ('issue' in req.body) patch.issue = text(req.body.issue, 'issue', 4000, true);
    if ('address' in req.body) patch.address = text(req.body.address, 'address', 1000, true);
    if ('dispatch' in req.body) { if (!['none', 'requested', 'confirmed', 'pending'].includes(req.body.dispatch)) throw new InputError('Choose a valid dispatch status.'); patch.dispatch = req.body.dispatch; }
    if ('confirmDispatch' in req.body) { if (typeof req.body.confirmDispatch !== 'boolean') throw new InputError('Confirm dispatch must be true or false.'); patch.confirmDispatch = req.body.confirmDispatch; }
    res.json({ call: await calls.update(req.params.id, patch, actor) });
  });
  return router;
}

const csvCell = value => {
  const text = value === null || value === undefined ? '' : String(value);
  // A leading =, +, - or @ is executed by spreadsheet software; neutralise it.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
};

/**
 * Read-only pull API for a ticketing system that prefers polling to webhooks.
 * It is mounted before the workspace access gate and carries its own bearer
 * token, so an integration never needs the desk password.
 */
export function createExportRouter({ config, calls, store, integrations }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!config.exportToken) return res.status(503).json({ error: 'Set NOTEFISH_EXPORT_TOKEN to enable the export API.', code: 'EXPORT_DISABLED' });
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ') || !constantTimeEqual(header.slice(7), config.exportToken)) {
      return res.status(401).json({ error: 'Provide the export bearer token.', code: 'EXPORT_AUTH_REQUIRED' });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return res.status(405).json({ error: 'The export API is read-only.', code: 'READ_ONLY' });
    next();
  });
  router.get('/calls', (req, res) => {
    const { since, cursor, limit, format } = req.query;
    if (format !== undefined && !['json', 'csv'].includes(format)) throw new InputError('Choose json or csv.');
    for (const [name, value] of [['since', since], ['cursor', cursor]]) {
      if (value !== undefined && (typeof value !== 'string' || value.length > 40 || Number.isNaN(Date.parse(value)))) throw new InputError(`Provide ${name} as an ISO timestamp.`);
    }
    if (limit !== undefined && (typeof limit !== 'string' || !/^\d{1,4}$/.test(limit) || Number(limit) < 1 || Number(limit) > 500)) throw new InputError('Limit must be between 1 and 500.');
    const size = Number(limit || 100);
    const after = cursor || since;
    const ended = calls.snapshot()
      .filter(call => call.state === 'ended' && call.endedAt)
      .sort((a, b) => new Date(a.endedAt) - new Date(b.endedAt))
      .filter(call => !after || new Date(call.endedAt) > new Date(after));
    const page = ended.slice(0, size);
    const next = ended.length > page.length && page.length ? page.at(-1).endedAt : null;
    const rows = page.map(call => integrations ? integrations.payload(call) : call);
    if (format === 'csv') {
      const header = ['id', 'from', 'transport', 'agent', 'agentLanguage', 'customerLanguage', 'startedAt', 'answeredAt', 'endedAt', 'issue', 'address', 'dispatch', 'lines'];
      const body = rows.map(row => [
        row.id, row.from, row.transport, row.agent?.name || '', row.agentLanguage, row.customerLanguage,
        row.startedAt, row.answeredAt || '', row.endedAt, row.ticket?.issue || '', row.ticket?.address || '',
        row.ticket?.dispatch || 'none', row.transcript?.length || 0,
      ].map(csvCell).join(','));
      res.type('text/csv').set('Content-Disposition', 'attachment; filename="notefish-calls.csv"');
      if (next) res.set('X-NoteFish-Next-Cursor', next);
      return res.send([header.join(','), ...body].join('\n'));
    }
    res.json({ calls: rows, nextCursor: next, count: rows.length });
  });
  router.get('/agents', (req, res) => res.json({ agents: store.snapshot().agents.map(({ id, name, archived, createdAt }) => ({ id, name, archived, createdAt })) }));
  return router;
}

export function createTwilioRouter({ config, calls }) {
  const router = express.Router();
  router.use(express.urlencoded({ extended: false, limit: '32kb', parameterLimit: 100 }));
  router.use((req, res, next) => {
    // Mounted router strips /twilio from req.path. Validate against the fixed public endpoint.
    const verificationReq = { headers: req.headers, body: req.body, path: `/twilio${req.path}`, url: req.originalUrl };
    if (!validateTwilio(verificationReq, config)) return res.status(403).json({ error: 'Invalid Twilio signature.' });
    if (req.body.AccountSid !== config.twilioAccountSid || !/^CA[0-9a-f]{32}$/i.test(req.body.CallSid)) return res.status(400).json({ error: 'Invalid Twilio call.' });
    next();
  });
  router.post('/incoming', async (req, res) => {
    if (!config.twilioNumber || req.body.To !== config.twilioNumber) return res.status(400).json({ error: 'This number is not configured for the desk.' });
    const from = typeof req.body.From === 'string' && /^\+[1-9]\d{6,14}$/.test(req.body.From) ? req.body.From : 'unknown';
    const response = new twilio.twiml.VoiceResponse();
    try {
      const call = await calls.registerInbound({ callSid: req.body.CallSid, from, to: req.body.To });
      const stream = response.connect().stream({ url: `${config.publicBaseUrl.replace(/^https:/, 'wss:')}/ws/twilio` });
      stream.parameter({ name: 'callId', value: call.id });
      response.hangup();
    } catch (error) {
      if (error.status !== 409) throw error;
      response.reject({ reason: 'busy' });
    }
    res.type('text/xml').send(response.toString());
  });
  router.post('/status', async (req, res) => {
    if (!['queued', 'initiated', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(req.body.CallStatus)) return res.status(400).json({ error: 'Invalid call status.' });
    await calls.handleStatus(req.body.CallSid, req.body.CallStatus);
    res.sendStatus(204);
  });
  return router;
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Use one audio file under 30 MB and complete the required fields.', code: 'INVALID_UPLOAD' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request is too large.', code: 'REQUEST_TOO_LARGE' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Request JSON is invalid.', code: 'INVALID_JSON' });
  if (['InputError', 'ProviderError', 'AudioError', 'CallError', 'CallerAccessError', 'AuthError'].includes(error.name) && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) return res.status(error.status).json({ error: error.message, code: error.code || 'REQUEST_FAILED' });
  res.status(500).json({ error: 'The request could not be completed. Try again.', code: 'INTERNAL_ERROR' });
}
