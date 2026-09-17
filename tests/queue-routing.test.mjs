import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
      if (Date.now() - started > 3000) return reject(new Error('Expected socket event was not received'));
      setTimeout(check, 5);
    };
    check();
  });
  return { ws, events, waitFor };
}

test('a floor of agents takes concurrent calls, and one caller reaches one agent', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-floor-'));
  const config = loadConfig({
    NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://example.test',
    NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', NOTEFISH_SESSION_SECRET: 's'.repeat(40),
    DATA_DIR: directory,
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

  const addAgent = async name => {
    const response = await call('/api/agents', { method: 'POST', body: JSON.stringify({ name }) });
    assert.equal(response.status, 201, name);
    return (await response.json()).agent;
  };
  const takeSeat = async agent => {
    const response = await call(`/api/agents/${agent.id}/session`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 201);
    const cookie = response.headers.getSetCookie().find(value => value.startsWith('notefish_agent='));
    assert.ok(cookie, 'a seat sets a cookie');
    return cookie.split(';')[0];
  };

  const nina = await addAgent('Nina');
  const sam = await addAgent('Sam');
  assert.equal((await call('/api/agents', { method: 'POST', body: JSON.stringify({ name: 'nina' }) })).status, 409, 'names are unique');

  const ninaCookie = await takeSeat(nina);
  const samCookie = await takeSeat(sam);

  const deskFor = cookie => {
    const desk = trackedSocket(`ws://127.0.0.1:${port}/ws/desk`, { Origin: 'https://example.test', Authorization: auth, Cookie: cookie });
    sockets.push(desk.ws);
    return desk;
  };
  const ninaDesk = deskFor(ninaCookie);
  const samDesk = deskFor(samCookie);
  await Promise.all([ninaDesk.waitFor(event => event.type === 'snapshot'), samDesk.waitFor(event => event.type === 'snapshot')]);
  assert.equal((await ninaDesk.waitFor(event => event.type === 'snapshot')).agentId, nina.id, 'a desk knows which seat it is');

  const caller = async () => {
    const invitation = await (await call('/api/caller-invitations', { method: 'POST', body: '{}' })).json();
    const token = new URL(invitation.url).hash.slice(1);
    const socket = trackedSocket(`ws://127.0.0.1:${port}/ws/caller`, { Origin: 'https://example.test' });
    sockets.push(socket.ws);
    await new Promise(resolve => socket.ws.once('open', resolve));
    socket.ws.send(JSON.stringify({ type: 'join', token }));
    const ringing = await socket.waitFor(event => event.type === 'state' && event.state === 'ringing');
    return { socket, callId: ringing.callId };
  };

  const first = await caller();
  const second = await caller();
  assert.equal(runtime.calls.snapshot().filter(item => item.state === 'ringing').length, 2, 'two callers wait at once');

  const floor = await (await call('/api/floor')).json();
  assert.deepEqual(floor.floor.waiting.map(item => item.position), [1, 2]);

  // Every available agent is offered a ringing call; the first through wins.
  const ninaAnswer = await call(`/api/calls/${first.callId}/answer`, { method: 'POST', headers: { Cookie: ninaCookie }, body: '{}' });
  assert.equal(ninaAnswer.status, 200);
  const samSteals = await call(`/api/calls/${first.callId}/answer`, { method: 'POST', headers: { Cookie: samCookie }, body: '{}' });
  assert.equal(samSteals.status, 403);
  assert.equal((await samSteals.json()).code, 'NOT_YOUR_CALL');

  // An agent already on a call cannot pick up a second one.
  assert.equal((await call(`/api/calls/${second.callId}/answer`, { method: 'POST', headers: { Cookie: ninaCookie }, body: '{}' })).status, 409);
  assert.equal((await call(`/api/calls/${second.callId}/answer`, { method: 'POST', headers: { Cookie: samCookie }, body: '{}' })).status, 200);

  await first.socket.waitFor(event => event.type === 'state' && event.state === 'in_call');
  await second.socket.waitFor(event => event.type === 'state' && event.state === 'in_call');
  assert.equal(runtime.calls.snapshot().filter(item => item.state === 'in_call').length, 2, 'both calls run at the same time');

  // A caller's voice must reach their own agent and nobody else's desk.
  ninaDesk.events.length = 0; samDesk.events.length = 0;
  first.socket.ws.send(Buffer.alloc(3200, 7));
  const heard = await ninaDesk.waitFor(event => event.type === 'audio');
  assert.equal(heard.callId, first.callId);
  assert.equal(samDesk.events.some(event => event.type === 'audio'), false, 'the other desk never hears this caller');

  // A ticket is attributed to the agent who confirmed it.
  const ticket = await call(`/api/calls/${first.callId}/ticket`, { method: 'PATCH', headers: { Cookie: ninaCookie }, body: JSON.stringify({ issue: 'Locked out', confirmDispatch: true }) });
  assert.equal(ticket.status, 200);
  assert.equal((await ticket.json()).call.ticket.dispatchConfirmedBy, 'Nina');
  assert.equal((await call(`/api/calls/${first.callId}/ticket`, { method: 'PATCH', headers: { Cookie: samCookie }, body: JSON.stringify({ issue: 'Not mine' }) })).status, 403);

  // Pausing takes a seat out of the rotation without dropping its call.
  assert.equal((await call('/api/agents/session/pause', { method: 'POST', headers: { Cookie: samCookie }, body: JSON.stringify({ reason: 'Break' }) })).status, 200);
  assert.equal((await (await call('/api/floor')).json()).floor.agents.find(agent => agent.id === sam.id).state, 'on_call');
  assert.equal(runtime.calls.snapshot().find(item => item.id === second.callId).state, 'in_call');

  // A rostered agent cannot be removed mid-call, and a seatless desk cannot answer.
  assert.equal((await call(`/api/agents/${nina.id}`, { method: 'DELETE' })).status, 409);
  const third = await caller();
  assert.equal((await call(`/api/calls/${third.callId}/answer`, { method: 'POST', body: '{}' })).status, 409);

  assert.equal((await call(`/api/calls/${first.callId}/end`, { method: 'POST', headers: { Cookie: ninaCookie }, body: '{}' })).status, 200);
  assert.equal((await call(`/api/agents/${nina.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await call('/api/agents')).json()).agents.find(agent => agent.id === nina.id).archived, true);
});

test('an agent override wins over the workspace default, and an empty roster needs no seat', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-settings-'));
  const config = loadConfig({
    NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://example.test',
    NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', NOTEFISH_SESSION_SECRET: 's'.repeat(40),
    DATA_DIR: directory,
  }, directory);
  const runtime = await createRuntime({ config });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const headers = { Authorization: `Basic ${Buffer.from(`desk:${config.deskPassword}`).toString('base64')}`, Origin: 'https://example.test', 'Content-Type': 'application/json' };
  const call = (route, options = {}) => fetch(`${base}${route}`, { ...options, headers: { ...headers, ...options.headers } });

  const session = await (await call('/api/session')).json();
  assert.equal(session.multiAgent, true);
  assert.equal(session.identity, 'roster-presence', 'a seat is presence, never a login');
  assert.equal(session.persistentSessions, true);

  await call('/api/settings', { method: 'PUT', body: JSON.stringify({ agentLanguage: 'en', customerLanguage: 'fr' }) });
  const agent = (await (await call('/api/agents', { method: 'POST', body: JSON.stringify({ name: 'Ines', customerLanguage: 'de' }) })).json()).agent;
  assert.equal(agent.customerLanguage, 'de');
  assert.equal(agent.agentLanguage, null, 'an unset override inherits the workspace default');

  assert.equal((await call(`/api/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ customerLanguage: 'zz' }) })).status, 400);
  assert.equal((await call(`/api/agents/${agent.id}`, { method: 'PATCH', body: JSON.stringify({ voiceId: 'missing-voice' }) })).status, 404);
  assert.equal((await call('/api/agents', { method: 'POST', body: JSON.stringify({ name: '' }) })).status, 400);
});
