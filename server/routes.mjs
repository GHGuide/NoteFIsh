import express from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import twilio from 'twilio';
import { languages, languageCodes } from './languages.mjs';
import { getStatus } from './config.mjs';
import { isLocalRequest, validateTwilio } from './security.mjs';

export class InputError extends Error {
  constructor(message, status = 400, code = 'INVALID_INPUT') { super(message); this.name = 'InputError'; this.status = status; this.code = code; }
}
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
const ref = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(value)) throw new InputError('Provide a valid Fish reference ID.');
  return value;
};
const voiceState = value => value === 'trained' ? 'ready' : value === 'failed' ? 'failed' : 'training';
const findVoice = (store, id, ready = false) => {
  const voice = store.snapshot().voices.find(item => item.id === id);
  if (!voice) throw new InputError('Voice not found.', 404, 'NOT_FOUND');
  if (ready && (voice.archived || voice.status !== 'ready')) throw new InputError('Choose a ready voice from your active voice library.', 409);
  return voice;
};

export function createApiRouter({ config, store, providers, calls, broadcast, audioAvailable, callerAccess }) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 8, fieldSize: 8000, parts: 10 } }).single('audio');
  let activeExpensive = 0;
  const limited = handler => async (req, res, next) => {
    if (activeExpensive >= 2) return next(new InputError('Two audio requests are already running. Wait a moment and retry.', 429, 'AUDIO_BUSY'));
    activeExpensive++;
    try { await handler(req, res); } catch (error) { next(error); } finally { activeExpensive--; }
  };
  const stateEvent = () => broadcast({ type: 'snapshot', calls: calls.snapshot(), settings: store.snapshot().settings });
  router.get('/session', (req, res) => res.json({ authenticated: true, loginRequired: false, method: !config.production && isLocalRequest(req) ? 'local' : 'basic' }));
  router.post('/caller-invitations', (req, res) => {
    if (req.body !== undefined) allowed(req.body, []);
    res.status(201).json(callerAccess.issue());
  });
  router.get(['/status', '/setup'], (req, res) => res.json(getStatus(config, { audioAvailable })));
  router.get('/languages', (req, res) => res.json({ languages }));
  router.get('/bootstrap', (req, res) => res.json({ ...store.snapshot(), calls: calls.snapshot(), setup: getStatus(config, { audioAvailable }), languages }));
  router.get('/voices', (req, res) => {
    if (req.query.archived !== undefined && !['true', 'false'].includes(req.query.archived)) throw new InputError('The archived filter must be true or false.');
    res.json({ voices: store.snapshot().voices.filter(voice => req.query.archived === 'true' || !voice.archived) });
  });
  router.get('/voices/available', limited(async (req, res) => {
    const results = await providers.listOwnVoices();
    res.json({ voices: results.map(voice => ({ referenceId: ref(voice.referenceId), name: voice.name, description: voice.description, status: voiceState(voice.state), languages: voice.languages || [] })) });
  }));
  router.post(['/voices/clone', '/voices'], limited(async (req, res) => {
    await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
    allowed(req.body, ['name', 'description', 'transcript', 'language', 'consent', 'kind']);
    if (req.body.consent !== 'true') throw new InputError('Confirm that this is your own voice or that you have permission to clone it.');
    if (store.snapshot().calls.some(call => call.state !== 'ended')) throw new InputError('Finish the call before enrolling a voice.', 409);
    if (!req.file) throw new InputError('Record or upload a voice sample.');
    if (store.snapshot().voices.length >= 1000) throw new InputError('The voice library is full.', 409);
    const name = text(req.body.name, 'voice name', 100);
    const description = text(req.body.description, 'description', 1000, true);
    const selectedLanguage = language(req.body.language || 'en');
    const transcript = text(req.body.transcript, 'sample transcript', 6000, true);
    const result = await providers.createVoice({ name, description, audio: req.file.buffer, mimeType: req.file.mimetype, transcript });
    const voice = { id: randomUUID(), referenceId: ref(result.referenceId), name, description, language: selectedLanguage, kind: 'enrolled', status: voiceState(result.state), archived: false, createdAt: new Date().toISOString(), consent: true, consentAt: new Date().toISOString() };
    await store.update(state => { state.voices.push(voice); });
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
    const voice = { id: randomUUID(), referenceId, name, description, language: selectedLanguage, kind, status: voiceState(result.state), archived: false, createdAt: new Date().toISOString(), consent: true, consentAt: new Date().toISOString() };
    await store.update(state => { if (state.voices.some(item => item.referenceId === referenceId)) throw new InputError('That voice is already in the library.', 409); state.voices.push(voice); });
    res.status(201).json({ voice });
  }));
  async function updateVoice(req, res, archive = false) {
    const patch = archive ? { archived: true } : req.body;
    allowed(patch, ['name', 'description', 'archived']);
    findVoice(store, req.params.id);
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
  router.delete('/voices/:id', (req, res) => updateVoice(req, res, true));
  router.post('/voices/:id/refresh', limited(async (req, res) => {
    const original = findVoice(store, req.params.id);
    const result = await providers.getVoice({ referenceId: original.referenceId });
    const voice = await store.update(state => { const item = state.voices.find(item => item.id === original.id); item.status = voiceState(result.state); return item; });
    res.json({ voice });
  }));
  router.post('/voices/:id/preview', limited(async (req, res) => {
    allowed(req.body, ['text', 'language', 'sourceLanguage']);
    const voice = findVoice(store, req.params.id, true);
    const previewText = text(req.body.text, 'preview text', 1000);
    const targetLanguage = language(req.body.language || voice.language);
    const sourceLanguage = language(req.body.sourceLanguage || store.snapshot().settings.agentLanguage);
    const spokenText = sourceLanguage === targetLanguage ? previewText : await providers.translate({ text: previewText, sourceLanguage, targetLanguage });
    const audio = await providers.synthesize({ text: spokenText, referenceId: voice.referenceId, format: 'mp3' });
    res.type('audio/mpeg').send(audio);
  }));
  router.get('/settings', (req, res) => res.json({ settings: store.snapshot().settings }));
  const saveSettings = async (req, res) => {
    allowed(req.body, ['voiceId', 'agentLanguage', 'customerLanguage', 'queueName']);
    const patch = {};
    if ('voiceId' in req.body) { if (req.body.voiceId !== null) findVoice(store, req.body.voiceId, true); patch.voiceId = req.body.voiceId; }
    if ('agentLanguage' in req.body) patch.agentLanguage = language(req.body.agentLanguage);
    if ('customerLanguage' in req.body) patch.customerLanguage = language(req.body.customerLanguage);
    if ('queueName' in req.body) patch.queueName = text(req.body.queueName, 'queue name', 100);
    const settings = await store.update(state => { Object.assign(state.settings, patch); return state.settings; });
    stateEvent(); res.json({ settings });
  };
  router.put('/settings', saveSettings); router.patch('/settings', saveSettings);
  router.get('/calls', (req, res) => res.json({ calls: calls.snapshot() }));
  for (const action of ['answer', 'end', 'stop']) router.post(`/calls/:id/${action}`, async (req, res) => res.json({ call: await calls[action](req.params.id) }));
  router.post('/calls/:id/reply', limited(async (req, res) => {
    if (req.is('multipart/form-data')) {
      await new Promise((resolve, reject) => upload(req, res, error => error ? reject(error) : resolve()));
      if (!req.file) throw new InputError('Record a reply first.');
      allowed(req.body, []);
      res.json({ call: await calls.ptt(req.params.id, { buffer: req.file.buffer, mimetype: req.file.mimetype }) });
    } else {
      allowed(req.body, ['text']);
      res.json({ call: await calls.say(req.params.id, { text: text(req.body.text, 'reply', 3000) }) });
    }
  }));
  router.patch('/calls/:id/ticket', async (req, res) => {
    allowed(req.body, ['issue', 'address', 'dispatch', 'confirmDispatch']);
    const patch = {};
    if ('issue' in req.body) patch.issue = text(req.body.issue, 'issue', 4000, true);
    if ('address' in req.body) patch.address = text(req.body.address, 'address', 1000, true);
    if ('dispatch' in req.body) { if (!['none', 'requested', 'confirmed', 'pending'].includes(req.body.dispatch)) throw new InputError('Choose a valid dispatch status.'); patch.dispatch = req.body.dispatch; }
    if ('confirmDispatch' in req.body) { if (typeof req.body.confirmDispatch !== 'boolean') throw new InputError('Confirm dispatch must be true or false.'); patch.confirmDispatch = req.body.confirmDispatch; }
    res.json({ call: await calls.update(req.params.id, patch) });
  });
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
  if (['InputError', 'ProviderError', 'AudioError', 'CallError', 'CallerAccessError'].includes(error.name) && Number.isInteger(error.status) && error.status >= 400 && error.status <= 599) return res.status(error.status).json({ error: error.message, code: error.code || 'REQUEST_FAILED' });
  res.status(500).json({ error: 'The request could not be completed. Try again.', code: 'INTERNAL_ERROR' });
}
