import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createStore } from '../server/store.mjs';
import { loadConfig } from '../server/config.mjs';
import { createSecurity } from '../server/security.mjs';
import { createApiRouter, errorHandler } from '../server/routes.mjs';
import { pcmToWav } from '../server/audio.mjs';

// A valid local WAV exercises multipart byte handling without recording a person
// or invoking a network provider. Training transitions are controlled below.
const sample = pcmToWav(Buffer.alloc(16000 * 2 * 4), 16000);
const referenceId = 'test_enrollment_reference';

function enrollmentForm(overrides = {}, { audio = true, field = 'audio', duplicate = false } = {}) {
  const body = new FormData();
  const fields = { name: '  My named voice  ', description: 'My own test voice.', language: 'en', transcript: 'A test sample transcript.', consent: 'true', ...overrides };
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) body.append(key, value);
  if (audio) body.append(field, new Blob([sample], { type: 'audio/wav' }), 'voice-sample.wav');
  if (duplicate) body.append('audio', new Blob([sample], { type: 'audio/wav' }), 'second-sample.wav');
  return body;
}

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notefish-enrollment-'));
  const dataPath = path.join(dir, 'notefish.json');
  const config = loadConfig({ NODE_ENV: 'production', NOTEFISH_PUBLIC_DEMO: 'true', PUBLIC_BASE_URL: 'https://demo.example.test' }, dir);
  const invocations = { create: [], refresh: [] };
  let providerState = 'training';
  let store; let server; let base;
  const providers = {
    async createVoice(input) {
      invocations.create.push(input);
      return { referenceId, state: 'training', name: 'Provider title must not replace the chosen name' };
    },
    async getVoice(input) { invocations.refresh.push(input); return { referenceId: input.referenceId, state: providerState }; },
  };
  const close = async () => {
    if (!server) return;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    server = undefined;
    await store.flush();
  };
  const open = async () => {
    store = await createStore(dataPath);
    const app = express();
    app.use(createSecurity(config), express.json());
    app.use('/api', createApiRouter({ config, store, providers, calls: { applySettings: async () => {}, snapshot: () => store.snapshot().calls }, broadcast: () => {}, audioAvailable: true }));
    app.use(errorHandler);
    server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
    base = `http://127.0.0.1:${server.address().port}`;
  };
  t.after(async () => { await close(); await rm(dir, { recursive: true, force: true }); });
  await open();
  const request = (endpoint, { method = 'GET', body } = {}) => fetch(base + '/api' + endpoint, {
    method, headers: { Origin: config.publicBaseUrl, ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
    ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
  });
  return {
    request, invocations, dataPath,
    snapshot: () => store.snapshot(),
    update: mutator => store.update(mutator),
    ready: () => { providerState = 'trained'; },
    restart: async () => { await close(); await open(); },
  };
}

test('named multipart enrollment progresses from training to ready, selection and persisted library reload', async t => {
  const app = await fixture(t);
  const response = await app.request('/voices/clone', { method: 'POST', body: enrollmentForm() });
  assert.equal(response.status, 201);
  const { voice } = await response.json();
  assert.equal(voice.name, 'My named voice');
  assert.equal(voice.referenceId, referenceId);
  assert.equal(voice.status, 'training');
  assert.equal(voice.kind, 'enrolled');
  assert.equal(voice.consent, true);
  assert.ok(Number.isFinite(Date.parse(voice.consentAt)));
  assert.equal(app.invocations.create.length, 1);
  assert.equal(app.invocations.create[0].name, 'My named voice');
  assert.deepEqual(app.invocations.create[0].audio, sample);
  assert.equal(app.invocations.create[0].mimeType, 'audio/wav');
  assert.equal(app.invocations.create[0].transcript, 'A test sample transcript.');
  assert.deepEqual((await (await app.request('/voices')).json()).voices, [{ ...voice, owner: null, mine: true, usable: true }], 'the list says who may use and manage each voice');

  assert.equal((await app.request('/settings', { method: 'PUT', body: { voiceId: voice.id } })).status, 409, 'an unfinished clone cannot be used for calls');
  // Recording your first voice is enough to be ready for a call: the desk takes it as
  // the voice that answers, rather than making you go and choose it afterwards.
  assert.equal(app.snapshot().settings.voiceId, voice.id, 'the first voice recorded becomes the one that answers');
  const pending = await app.request(`/voices/${voice.id}/refresh`, { method: 'POST' });
  assert.equal((await pending.json()).voice.status, 'training');
  app.ready();
  const refreshed = await app.request(`/voices/${voice.id}/refresh`, { method: 'POST' });
  assert.equal(refreshed.status, 200);
  const ready = (await refreshed.json()).voice;
  assert.equal(ready.status, 'ready');
  assert.equal(ready.name, voice.name);
  assert.deepEqual(app.invocations.refresh, [{ referenceId }, { referenceId }]);
  assert.equal((await app.request('/settings', { method: 'PUT', body: { voiceId: voice.id, agentLanguage: 'en', customerLanguage: 'fr' } })).status, 200);

  await app.restart();
  const library = await app.request('/voices');
  assert.equal(library.status, 200);
  assert.deepEqual((await library.json()).voices, [{ ...ready, owner: null, mine: true, usable: true }]);
  const settings = (await (await app.request('/settings')).json()).settings;
  assert.equal(settings.voiceId, voice.id);
  assert.equal(settings.agentLanguage, 'en');
  assert.equal(settings.customerLanguage, 'fr');
  assert.equal(app.invocations.create.length, 1, 'reloading never clones a second voice');
  const persisted = await readFile(app.dataPath, 'utf8');
  assert.equal(persisted.includes('A test sample transcript.'), false, 'the enrollment sample transcript is not retained in the voice library');
  assert.equal(persisted.includes(sample.toString('base64')), false, 'uploaded audio is not written into the library state');
});

test('invalid names, missing or duplicate samples, and absent consent never invoke voice creation', async t => {
  const app = await fixture(t);
  const cases = [
    ['missing name', { name: undefined }],
    ['blank name', { name: '   ' }],
    ['long name', { name: 'a'.repeat(101) }],
    ['control character in name', { name: 'My\u0001voice' }],
    ['missing consent', { consent: undefined }],
    ['declined consent', { consent: 'false' }],
    ['missing audio', {}, { audio: false }],
    ['wrong audio field', {}, { field: 'recording' }],
    ['multiple audio samples', {}, { duplicate: true }],
    ['invalid sample language', { language: 'unsupported' }],
  ];
  for (const [label, fields, options] of cases) {
    const response = await app.request('/voices/clone', { method: 'POST', body: enrollmentForm(fields, options) });
    assert.equal(response.status, 400, label);
    assert.equal(app.invocations.create.length, 0, label);
    assert.equal(app.snapshot().voices.length, 0, label);
  }
});

test('an active call prevents enrollment before reaching the voice provider', async t => {
  const app = await fixture(t);
  await app.update(state => state.calls.push({
    id: 'test-call', callSid: 'browser:11111111-1111-4111-8111-111111111111', transport: 'browser', from: 'Browser caller', state: 'in_call',
    transcript: [], ticket: { issue: '', address: '', dispatch: 'none' },
  }));
  const response = await app.request('/voices/clone', { method: 'POST', body: enrollmentForm() });
  assert.equal(response.status, 409);
  assert.equal(app.invocations.create.length, 0);
  assert.equal(app.snapshot().voices.length, 0);
});
