import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';

test('single production service protects app/API/desk socket and exposes only minimal health', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-runtime-'));
  const config = loadConfig({ NODE_ENV: 'production', NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', PUBLIC_BASE_URL: 'https://example.test', DATA_DIR: directory, PORT: '18081' }, directory);
  const runtime = await createRuntime({ config });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const auth = `Basic ${Buffer.from(`desk:${config.deskPassword}`).toString('base64')}`;
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const health = await fetch(`${base}/healthz`);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal((await fetch(base)).status, 404, 'the sign-in shell is public; this deployment has no built bundle to serve'); // data stays behind the gate below
  assert.equal((await fetch(`${base}/api/status`)).status, 401);
  const authenticated = await fetch(`${base}/api/settings`, { headers: { Authorization: auth } });
  assert.equal(authenticated.status, 200);
  assert.equal((await authenticated.json()).settings.customerLanguage, 'fr');
  const mutate = await fetch(`${base}/api/settings`, { method: 'PUT', headers: { Authorization: auth, Origin: 'https://example.test', 'Content-Type': 'application/json' }, body: JSON.stringify({ queueName: 'Persistence test' }) });
  assert.equal(mutate.status, 200);
  for (const [url, headers] of [
    ['/ws/desk', { Origin: 'https://example.test' }],
    ['/ws/desk', { Origin: 'https://evil.test', Authorization: auth }],
    ['/ws/twilio', {}],
  ]) {
    const status = await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${url}`, { headers });
      ws.on('unexpected-response', (request, response) => { response.resume(); resolve(response.statusCode); });
      ws.on('open', () => { ws.close(); reject(new Error('Unauthorized socket opened')); });
      ws.on('error', () => {});
    });
    assert.equal(status, 403);
  }
  const snapshot = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/desk`, { headers: { Origin: 'https://example.test', Authorization: auth } });
    ws.once('message', data => { const value = JSON.parse(data); ws.close(); resolve(value); });
    ws.once('error', reject);
  });
  assert.equal(snapshot.type, 'snapshot');
  assert.equal(snapshot.settings.queueName, 'Persistence test');
  assert.deepEqual(snapshot.calls, []);
  assert.equal((await fetch(`${base}/twilio/incoming`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'AccountSid=invalid' })).status, 403);
});
