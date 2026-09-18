import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';
import { migrateState } from '../server/store.mjs';

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
      if (Date.now() - started > 3000) return reject(new Error('Expected socket event was not received'));
      setTimeout(check, 5);
    };
    check();
  });
  return { ws, events, waitFor };
}

// The failure this replaces: a roster existed, nobody had claimed a seat, and so every
// call rang nobody and died after sixty seconds with the desk open in front of the user.
test('a call rings the desk and is answered, with nobody having to claim anything first', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-desk-'));
  const config = loadConfig({
    NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://example.test',
    NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', DATA_DIR: directory,
  }, directory);
  const runtime = await createRuntime({ config });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await runtime.close(); await rm(directory, { recursive: true, force: true }); });

  const auth = `Basic ${Buffer.from(`desk:${config.deskPassword}`).toString('base64')}`;
  const headers = { Authorization: auth, Origin: 'https://example.test', 'Content-Type': 'application/json' };
  const call = (route, options = {}) => fetch(`${base}${route}`, { ...options, headers: { ...headers, ...options.headers } });

  // Nothing about seats is left to ask for.
  const session = await (await call('/api/session')).json();
  assert.equal(session.agent, undefined, 'a session is not an agent any more');
  assert.equal(session.multiAgent, undefined);
  for (const route of ['/api/agents', '/api/floor']) {
    assert.equal((await call(route)).status, 404, `${route} is gone`);
  }

  const desk = trackedSocket(`ws://127.0.0.1:${port}/ws/desk`, { Origin: 'https://example.test', Authorization: auth });
  sockets.push(desk.ws);
  await new Promise(resolve => desk.ws.once('open', resolve));
  const first = await desk.waitFor(event => event.type === 'snapshot');
  assert.equal(first.agents, undefined, 'the desk is not handed a roster');
  assert.equal(first.floor, undefined);

  const invitation = await (await call('/api/caller-invitations', { method: 'POST', body: JSON.stringify({ label: 'Tester', transport: 'companion' }) })).json();
  const caller = trackedSocket(`ws://127.0.0.1:${port}/ws/caller`, { Origin: 'https://example.test' });
  sockets.push(caller.ws);
  await new Promise(resolve => caller.ws.once('open', resolve));
  caller.ws.send(JSON.stringify({ type: 'join', token: invitation.token }));
  const ringing = await caller.waitFor(event => event.type === 'state' && event.state === 'ringing');

  const answered = await call(`/api/calls/${ringing.callId}/answer`, { method: 'POST', body: '{}' });
  assert.equal(answered.status, 200, 'answering needs no seat');
  await caller.waitFor(event => event.type === 'state' && event.state === 'in_call');

  // A second tab of the same desk may act on the same call rather than being told off.
  assert.equal((await call(`/api/calls/${ringing.callId}/end`, { method: 'POST', body: '{}' })).status, 200);
});

test('upgrading a desk that had a roster keeps the voice and languages it was answering with', () => {
  const state = migrateState({
    version: 2,
    voices: [{ id: 'v-leo' }],
    settings: { voiceId: null, agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' },
    agents: [
      { id: 'a-old', name: 'Archived', voiceId: 'v-gone', archived: true },
      { id: 'a1', name: 'Nina', voiceId: 'v-leo', agentLanguage: 'nl', customerLanguage: 'de', registers: { calm: 'v-leo' }, archived: false },
    ],
    invites: [{ token: 't', agentId: 'a1', email: 'x@y.z', expires: 1 }],
    calls: [],
  });
  assert.equal(state.version, 3);
  assert.equal(state.agents, undefined, 'the roster is gone');
  assert.equal(state.invites, undefined, 'so are invitations to seats');
  assert.equal(state.settings.voiceId, 'v-leo', 'the seat that was answering hands its voice to the desk');
  assert.equal(state.settings.agentLanguage, 'nl');
  assert.equal(state.settings.customerLanguage, 'de');
  assert.deepEqual(state.settings.registers, { calm: 'v-leo' });
});

test('a desk that never had a roster upgrades untouched', () => {
  const state = migrateState({ version: 2, voices: [], settings: { voiceId: 'v1', agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' }, agents: [], calls: [] });
  assert.equal(state.version, 3);
  assert.equal(state.settings.voiceId, 'v1');
  assert.equal(state.agents, undefined);
});
