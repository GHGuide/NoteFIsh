import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessions, readCookie } from '../server/session.mjs';
import { createQueue } from '../server/queue.mjs';

const agentId = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const config = { sessionSecret: 'a'.repeat(32), production: true };

test('a seat cookie is signed, bound to one agent, and expires', () => {
  const sessions = createSessions(config);
  const token = sessions.issue(agentId);
  assert.equal(sessions.verify(token), agentId);

  // Nothing about the token may be editable by its holder.
  const [id, issued, signature] = token.split('.');
  assert.equal(sessions.verify(`${other}.${issued}.${signature}`), '');
  assert.equal(sessions.verify(`${id}.${Number(issued) + 1}.${signature}`), '');
  assert.equal(sessions.verify(`${id}.${issued}.${'x'.repeat(signature.length)}`), '');
  assert.equal(sessions.verify(''), '');
  assert.equal(sessions.verify('not-a-token'), '');
  assert.equal(sessions.verify(`${id}.${issued}`), '');

  // A different secret cannot mint a seat for this server.
  assert.equal(createSessions({ ...config, sessionSecret: 'b'.repeat(32) }).verify(token), '');

  let clock = 0;
  const shortLived = createSessions(config, { now: () => clock, ttlMs: 1000 });
  const fresh = shortLived.issue(agentId);
  clock = 900; assert.equal(shortLived.verify(fresh), agentId);
  clock = 1001; assert.equal(shortLived.verify(fresh), '');

  assert.equal(sessions.ephemeral, false);
  assert.equal(createSessions({ production: false }).ephemeral, true);
});

test('the seat cookie carries the flags that keep it out of scripts and cross-site requests', () => {
  const sessions = createSessions(config);
  const cookie = sessions.cookie(agentId);
  for (const flag of ['HttpOnly', 'SameSite=Strict', 'Secure', 'Path=/']) assert.ok(cookie.includes(flag), flag);
  assert.ok(sessions.clearCookie().includes('Max-Age=0'));
  // Development over plain http must not set Secure, or the cookie is dropped.
  assert.equal(createSessions({ ...config, production: false }).cookie(agentId).includes('Secure'), false);

  assert.equal(readCookie('a=1; notefish_agent=value; b=2', 'notefish_agent'), 'value');
  assert.equal(readCookie('notefish_agent_other=value', 'notefish_agent'), '');
  assert.equal(readCookie(undefined, 'notefish_agent'), '');
  assert.equal(readCookie('x'.repeat(5000), 'notefish_agent'), '');
});

test('the floor reports presence, pauses and who is on which call', () => {
  const agents = [
    { id: agentId, name: 'Nina', archived: false },
    { id: other, name: 'Sam', archived: false },
    { id: '33333333-3333-4333-8333-333333333333', name: 'Gone', archived: true },
  ];
  let calls = [];
  const queue = createQueue({ store: { snapshot: () => ({ agents }) }, calls: { snapshot: () => calls } });

  assert.deepEqual(queue.agents().map(agent => agent.state), ['offline', 'offline']);
  assert.deepEqual(queue.pickOrder(), []);

  queue.connect(agentId);
  assert.deepEqual(queue.pickOrder(), [agentId]);

  // Two tabs are one seat: closing one leaves the agent online.
  queue.connect(agentId); queue.disconnect(agentId);
  assert.deepEqual(queue.pickOrder(), [agentId]);

  queue.connect(other);
  queue.pause(other, 'Break');
  const paused = queue.agents().find(agent => agent.id === other);
  assert.equal(paused.state, 'paused');
  assert.equal(paused.pauseReason, 'Break');
  assert.deepEqual(queue.pickOrder(), [agentId]);
  queue.resume(other);
  assert.deepEqual(queue.pickOrder().sort(), [agentId, other].sort());

  calls = [
    { id: 'call-a', state: 'in_call', agentId, from: '+3311', transport: 'twilio', startedAt: '2026-09-15T10:00:02Z' },
    { id: 'call-b', state: 'ringing', from: '+3322', transport: 'browser', startedAt: '2026-09-15T10:00:00Z' },
    { id: 'call-c', state: 'ringing', from: '+3333', transport: 'browser', startedAt: '2026-09-15T10:00:01Z' },
    { id: 'call-d', state: 'ended', agentId: other, from: '+3344', transport: 'browser', startedAt: '2026-09-15T09:00:00Z' },
  ];
  assert.equal(queue.busy(agentId), true);
  assert.deepEqual(queue.pickOrder(), [other], 'an agent on a call is not offered the next one');

  const snapshot = queue.snapshot();
  assert.deepEqual(snapshot.waiting.map(call => call.id), ['call-b', 'call-c'], 'longest wait first');
  assert.deepEqual(snapshot.waiting.map(call => call.position), [1, 2]);
  assert.equal(queue.positionOf('call-c'), 2);
  assert.equal(queue.positionOf('call-a'), 0);
  assert.equal(snapshot.agents.find(agent => agent.id === agentId).callId, 'call-a');

  // Losing the connection clears a pause so a stale "on break" cannot persist.
  queue.pause(agentId, 'Lunch'); queue.disconnect(agentId);
  assert.equal(queue.agents().find(agent => agent.id === agentId).paused, false);
});
