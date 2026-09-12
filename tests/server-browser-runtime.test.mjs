import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';

function trackedSocket(url, headers) {
  const ws = new WebSocket(url, { headers });
  const events = [];
  ws.on('message', bytes => events.push(JSON.parse(bytes)));
  ws.on('error', () => {});
  const waitFor = predicate => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const event = events.find(predicate);
      if (event) return resolve(event);
      if (Date.now() - started > 2000) return reject(new Error('Expected socket event was not received'));
      setTimeout(check, 5);
    };
    check();
  });
  return { ws, events, waitFor };
}

test('public caller shell and one-use socket admission never expose desk data or require Twilio', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-browser-'));
  await mkdir(path.join(directory, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(directory, 'dist', 'index.html'), '<!doctype html><title>NoteFIsh caller</title>');
  await writeFile(path.join(directory, 'dist', 'assets', 'app.js'), '/* public application bundle */');
  await writeFile(path.join(directory, 'dist', 'favicon.svg'), '<svg/>');
  const config = loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://example.test', NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', DATA_DIR: directory }, directory);
  const runtime = await createRuntime({ config });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const headers = { Authorization: `Basic ${Buffer.from(`desk:${config.deskPassword}`).toString('base64')}`, Origin: 'https://example.test', 'Content-Type': 'application/json' };
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  for (const route of ['/caller', '/assets/app.js', '/favicon.svg', '/healthz']) assert.equal((await fetch(`${base}${route}`)).status, 200);
  for (const route of ['/', '/desk', '/api/settings', '/api/voices', '/api/calls', '/api/status']) assert.equal((await fetch(`${base}${route}`)).status, 401);
  assert.equal((await fetch(`${base}/api/caller-invitations`, { method: 'POST', headers: { Origin: 'https://example.test' } })).status, 401);
  const invitationResponse = await fetch(`${base}/api/caller-invitations`, { method: 'POST', headers, body: '{}' });
  assert.equal(invitationResponse.status, 201);
  const invitation = await invitationResponse.json();
  const token = new URL(invitation.url).hash.slice(1);
  const caller = trackedSocket(`ws://127.0.0.1:${port}/ws/caller`, { Origin: 'https://example.test' });
  sockets.push(caller.ws);
  await new Promise(resolve => caller.ws.once('open', resolve));
  caller.ws.send(JSON.stringify({ type: 'join', token }));
  const ringing = await caller.waitFor(event => event.type === 'state' && event.state === 'ringing');
  assert.deepEqual(Object.keys(ringing).sort(), ['callId', 'customerLanguage', 'phase', 'state', 'type']);
  assert.equal(ringing.customerLanguage, 'fr');
  assert.equal(runtime.calls.snapshot().length, 1);
  assert.equal(runtime.calls.snapshot()[0].transport, 'browser');
  const replay = trackedSocket(`ws://127.0.0.1:${port}/ws/caller`, { Origin: 'https://example.test' });
  sockets.push(replay.ws);
  await new Promise(resolve => replay.ws.once('open', resolve));
  replay.ws.send(JSON.stringify({ type: 'join', token }));
  await replay.waitFor(event => event.type === 'error');
  assert.equal(runtime.calls.snapshot().length, 1);
  assert.equal((await fetch(`${base}/api/calls/${ringing.callId}/answer`, { method: 'POST', headers, body: '{}' })).status, 200);
  await caller.waitFor(event => event.type === 'state' && event.state === 'in_call');
  assert.equal((await fetch(`${base}/api/calls/${ringing.callId}/ticket`, { method: 'PATCH', headers, body: JSON.stringify({ issue: 'Private agent ticket' }) })).status, 200);
  caller.ws.send(JSON.stringify({ type: 'end' }));
  await caller.waitFor(event => event.type === 'state' && event.state === 'ended');
  await runtime.store.flush();
  assert.equal(runtime.store.snapshot().calls[0].state, 'ended');
  assert.equal(runtime.store.snapshot().calls[0].ticket.issue, 'Private agent ticket');
  assert.equal(JSON.stringify(caller.events).includes('Private agent ticket'), false);
  assert.equal(JSON.stringify(runtime.store.snapshot()).includes(token), false);
});
