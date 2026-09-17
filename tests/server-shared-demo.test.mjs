import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';

test('shared demo opens the workspace without a login challenge while preserving Origin and caller transport isolation', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-shared-'));
  await mkdir(path.join(directory, 'dist'));
  await writeFile(path.join(directory, 'dist/index.html'), '<!doctype html><title>NoteFIsh test</title>');
  const config = loadConfig({ NODE_ENV: 'production', NOTEFISH_PUBLIC_DEMO: 'true', PUBLIC_BASE_URL: 'https://example.test', DATA_DIR: directory, FISH_API_KEY: 'fish-test-only', OPENAI_API_KEY: 'openai-test-only' }, directory);
  let providerCalls = 0;
  const providers = { async createVoice() { providerCalls++; throw new Error('Unexpected provider request'); } };
  const runtime = await createRuntime({ config, providers });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const socketBase = base.replace('http:', 'ws:');
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });

  for (const route of ['/', '/voices', '/enroll', '/desk', '/admin', '/api/bootstrap', '/api/voices', '/api/settings', '/api/status']) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.has('www-authenticate'), false, route);
    assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const body = await response.text();
    assert.equal(body.includes(config.fishApiKey), false);
    assert.equal(body.includes(config.openaiApiKey), false);
  }
  assert.deepEqual(await (await fetch(base + '/api/session')).json(), {
    authenticated: false, loginRequired: false, method: 'shared-demo',
    // A shared demo cannot tell visitors apart, so it stays a single desk.
    multiAgent: false, identity: 'single-desk', agent: null, persistentSessions: false,
  });
  const roster = await fetch(base + '/api/agents', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://example.test' }, body: JSON.stringify({ name: 'Nina' }) });
  assert.equal(roster.status, 409);
  assert.equal((await roster.json()).code, 'SINGLE_DESK');
  const put = origin => fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ queueName: 'Shared demo line' }) });
  assert.equal((await put()).status, 403);
  assert.equal((await put('https://other.test')).status, 403);
  assert.equal((await put('https://example.test')).status, 200);
  for (const consent of [undefined, 'true']) {
    const form = new FormData();
    form.append('name', 'A named voice');
    if (consent) form.append('consent', consent);
    const response = await fetch(base + '/api/voices/clone', { method: 'POST', headers: { Origin: 'https://example.test' }, body: form });
    assert.equal(response.status, 400);
    assert.equal(response.headers.has('www-authenticate'), false);
  }
  assert.equal(providerCalls, 0);

  const snapshot = await new Promise((resolve, reject) => {
    const ws = new WebSocket(socketBase + '/ws/desk', { headers: { Origin: 'https://example.test' } });
    ws.once('message', data => { ws.close(); resolve(JSON.parse(data)); });
    ws.once('error', reject);
  });
  assert.equal(snapshot.type, 'snapshot');
  assert.equal(snapshot.settings.queueName, 'Shared demo line');
  for (const route of ['/ws/desk', '/ws/caller']) {
    const status = await new Promise((resolve, reject) => {
      const ws = new WebSocket(socketBase + route, { headers: { Origin: 'https://other.test' } });
      ws.on('unexpected-response', (_req, response) => { response.resume(); resolve(response.statusCode); });
      ws.once('open', () => { ws.close(); reject(new Error('Cross-origin socket opened')); });
      ws.on('error', () => {});
    });
    assert.equal(status, 403);
  }
  const rejected = await new Promise((resolve, reject) => {
    const ws = new WebSocket(socketBase + '/ws/caller', { headers: { Origin: 'https://example.test' } });
    ws.once('open', () => ws.send(JSON.stringify({ type: 'join', token: 'invalid' })));
    ws.once('message', data => { ws.close(); resolve(JSON.parse(data)); });
    ws.once('error', reject);
  });
  assert.equal(rejected.type, 'error');
  assert.equal('calls' in rejected, false);
  assert.equal('settings' in rejected, false);
  const invitationResponse = await fetch(base + '/api/caller-invitations', { method: 'POST', headers: { Origin: 'https://example.test' } });
  assert.equal(invitationResponse.status, 201);
  const invitation = await invitationResponse.json();
  assert.equal(new URL(invitation.url).pathname, '/caller');
  assert.ok(new URL(invitation.url).hash.length > 60);
  assert.deepEqual(runtime.calls.snapshot(), []);
});
