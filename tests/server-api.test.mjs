import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createStore } from '../server/store.mjs';
import { loadConfig } from '../server/config.mjs';
import { createSecurity } from '../server/security.mjs';
import { createApiRouter, errorHandler } from '../server/routes.mjs';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'notefish-api-'));
  const store = await createStore(path.join(dir, 'notefish.json'));
  const config = loadConfig({ NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', PUBLIC_BASE_URL: 'https://example.test' }, dir);
  let imports = 0, previews = 0;
  const providers = {
    async getVoice({ referenceId }) { imports++; return { referenceId, state: 'trained' }; },
    async synthesize() { previews++; return Buffer.from('sample-mp3-bytes'); },
    async translate({ text }) { return text; },
  };
  const app = express();
  app.use(createSecurity(config), express.json());
  app.use('/api', createApiRouter({ config, store, providers, calls: { applySettings: async () => {}, snapshot: () => [] }, broadcast: () => {}, audioAvailable: true }));
  app.use(errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const request = (url, { method = 'GET', body, headers = {} } = {}) => fetch(`${base}${url}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: base, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { store, config, request, dir, counts: () => ({ imports, previews }) };
}

test('voice ownership attestation, management, archival and preview use real provider adapter calls', async t => {
  const { request, counts, store } = await fixture(t);
  const input = { referenceId: 'voice_reference_123', name: 'My enrolled voice', language: 'en', consent: false };
  assert.equal((await request('/api/voices/import', { method: 'POST', body: input })).status, 400);
  assert.equal(counts().imports, 0);
  const imported = await request('/api/voices/import', { method: 'POST', body: { ...input, consent: true } });
  assert.equal(imported.status, 201);
  const { voice } = await imported.json();
  assert.equal(voice.kind, 'licensed'); assert.equal(voice.status, 'ready'); assert.equal(counts().imports, 1);
  assert.equal((await request('/api/settings', { method: 'PUT', body: { voiceId: voice.id, customerLanguage: 'fr', agentLanguage: 'en' } })).status, 200);
  assert.equal((await request(`/api/voices/${voice.id}`, { method: 'PATCH', body: { name: 'Renamed voice' } })).status, 200);
  assert.equal(store.snapshot().voices[0].archived, false);
  assert.equal(store.snapshot().voices[0].name, 'Renamed voice');
  assert.equal((await request(`/api/voices/${voice.id}/preview`, { method: 'POST', body: { text: 'Bonjour.', language: 'fr' } })).status, 200);
  assert.equal(counts().previews, 1);
  assert.equal((await request(`/api/voices/${voice.id}`, { method: 'PATCH', body: { archived: true } })).status, 200);
  assert.equal(store.snapshot().settings.voiceId, null);
  assert.deepEqual((await (await request('/api/voices')).json()).voices, []);
  assert.equal((await (await request('/api/voices?archived=true')).json()).voices.length, 1);
  assert.equal((await request(`/api/voices/${voice.id}/preview`, { method: 'POST', body: { text: 'Bonjour.', language: 'fr' } })).status, 409);
  assert.equal(counts().previews, 1);
  assert.equal((await request(`/api/voices/${voice.id}`, { method: 'PATCH', body: { archived: false } })).status, 200);
  assert.equal((await (await request('/api/voices')).json()).voices.length, 1);
});

test('public requests require credentials, reject cross-origin mutation, and validate setting inputs', async t => {
  const { request, config } = await fixture(t);
  const headers = { 'X-Forwarded-Host': 'example.test', Origin: 'https://example.test' };
  assert.equal((await request('/api/settings', { headers })).status, 401);
  headers.Authorization = `Basic ${Buffer.from(`desk:${config.deskPassword}`).toString('base64')}`;
  assert.equal((await request('/api/settings', { headers })).status, 200);
  assert.equal((await request('/api/settings', { method: 'PUT', body: { customerLanguage: 'fr' }, headers: { ...headers, Origin: 'https://evil.test' } })).status, 403);
  assert.equal((await request('/api/settings', { method: 'PUT', body: { customerLanguage: 'made-up' }, headers })).status, 400);
  assert.equal((await request('/api/settings', { method: 'PUT', body: { unexpected: true }, headers })).status, 400);
});

test('atomic store serializes writes, persists across recreation, and rejects malformed files', async t => {
  const { store, dir } = await fixture(t);
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.update(state => { state.settings.queueName += ` ${i}`; })));
  assert.equal(store.snapshot().settings.queueName.split(' ').length, 14);
  const reopened = await createStore(path.join(dir, 'notefish.json'));
  assert.deepEqual(reopened.snapshot(), store.snapshot());
  assert.equal((await stat(path.join(dir, 'notefish.json'))).mode & 0o777, 0o600);
  await writeFile(path.join(dir, 'invalid.json'), '{"version":1,"voices":"bad"}');
  await assert.rejects(createStore(path.join(dir, 'invalid.json')), /Cannot load NoteFIsh data safely/);
});
