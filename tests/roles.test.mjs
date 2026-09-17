import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';

// One desk, three people: the admin who created it, an agent who joined by invitation, and what each may touch.
test('roles: the first account runs the desk, invited people get a seat and their own voice, and nothing more', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-roles-'));
  await mkdir(path.join(directory, 'dist'), { recursive: true });
  await writeFile(path.join(directory, 'dist', 'index.html'), '<!doctype html><title>NoteFish</title>');
  const config = loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://example.test', NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', DATA_DIR: directory }, directory);
  const deleted = [];
  const providers = { deleteVoice: async ({ referenceId }) => { deleted.push(referenceId); }, getVoice: async () => ({ state: 'trained' }) };
  const runtime = await createRuntime({ config, providers });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (cookie, method, route, body) => {
    const response = await fetch(`${base}/api${route}`, { method, headers: { Origin: 'https://example.test', 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.getSetCookie().map(item => item.split(';')[0]).join('; ') };
  };

  // Nobody runs the desk yet: the first sign-up becomes admin, and from then on it is invitation-only.
  const open = await call('', 'GET', '/auth/me');
  assert.equal(open.body.open, true);
  const admin = await call('', 'POST', '/auth/signup', { name: 'Nina Okafor', email: 'nina@acme.example', password: 'ten characters!' });
  assert.equal(admin.status, 201); assert.equal(admin.body.user.role, 'admin');
  const stranger = await call('', 'POST', '/auth/signup', { name: 'Anyone', email: 'anyone@else.example', password: 'ten characters!' });
  assert.equal(stranger.status, 403);
  assert.equal((await call('', 'GET', '/auth/me')).body.open, false);

  // The admin invites Mara; Mara joins as an agent with her seat.
  const seat = await call(admin.cookie, 'POST', '/agents', { email: 'mara@acme.example' });
  assert.equal(seat.status, 201);
  const token = new URL(seat.body.inviteUrl).hash.slice(1);
  const mara = await call('', 'POST', '/auth/signup', { password: 'ten characters!', invite: token });
  assert.equal(mara.status, 201); assert.equal(mara.body.user.role, 'agent'); assert.equal(mara.body.agentId, seat.body.agent.id);
  assert.match(mara.cookie, /notefish_agent=/, 'joining takes the seat');
  const adminSeat = await call(admin.cookie, 'POST', '/agents', { name: 'Nina' });
  await runtime.store.update(state => { state.agents.find(item => item.id === adminSeat.body.agent.id).userId = admin.body.user.id; }); // Nina's own seat

  // Workspace settings and the roster are the admin's. Mara's own seat is hers.
  assert.equal((await call(mara.cookie, 'PUT', '/settings', { queueName: 'Hijacked' })).status, 403);
  assert.equal((await call(mara.cookie, 'POST', '/agents', { name: 'Extra' })).status, 403);
  assert.equal((await call(mara.cookie, 'DELETE', `/agents/${adminSeat.body.agent.id}`)).status, 403);
  assert.equal((await call(mara.cookie, 'PATCH', `/agents/${adminSeat.body.agent.id}`, { customerLanguage: 'de' })).status, 403);
  assert.equal((await call(mara.cookie, 'PATCH', `/agents/${seat.body.agent.id}`, { customerLanguage: 'de' })).status, 200);
  assert.equal((await call(mara.cookie, 'POST', `/agents/${adminSeat.body.agent.id}/session`, {})).status, 403, 'another person’s seat cannot be taken');
  assert.equal((await call(mara.cookie, 'GET', '/users')).status, 403);
  assert.equal((await call(admin.cookie, 'PUT', '/settings', { queueName: 'Main line' })).status, 200);

  // Voices: Nina's recording is hers. Mara sees it, cannot use, share or archive it.
  const voice = (kind, ownerId, name) => ({ id: `${name.toLowerCase()}-voice`, referenceId: `ref${name.toLowerCase()}00000000`, name, description: '', language: 'en', kind, status: 'ready', archived: false, createdAt: new Date().toISOString(), consent: true, consentAt: new Date().toISOString(), ownerId });
  await runtime.store.update(state => { state.voices.push(voice('enrolled', admin.body.user.id, 'Nina'), voice('enrolled', mara.body.user.id, 'Mara'), voice('licensed', admin.body.user.id, 'Kyoko')); });
  const seen = (await call(mara.cookie, 'GET', '/voices')).body.voices;
  assert.deepEqual(seen.map(item => [item.name, item.mine, item.usable, item.owner]), [['Nina', false, false, 'Nina Okafor'], ['Mara', true, true, 'Mara'], ['Kyoko', false, true, 'Nina Okafor']]);
  assert.equal((await call(mara.cookie, 'GET', '/voices/nina-voice/export')).status, 403);
  assert.equal((await call(mara.cookie, 'PATCH', '/voices/nina-voice', { archived: true })).status, 403);
  assert.equal((await call(mara.cookie, 'PATCH', `/agents/${seat.body.agent.id}`, { voiceId: 'nina-voice' })).status, 403);
  assert.equal((await call(mara.cookie, 'PATCH', `/agents/${seat.body.agent.id}`, { voiceId: 'kyoko-voice' })).status, 200, 'licensed voices are shared');
  assert.equal((await call(mara.cookie, 'PATCH', `/agents/${seat.body.agent.id}`, { voiceId: 'mara-voice' })).status, 200);
  assert.equal((await call(mara.cookie, 'GET', '/voices/mara-voice/export')).status, 200);
  assert.equal((await call(admin.cookie, 'GET', '/voices/mara-voice/export')).status, 200, 'an admin can share any voice');
  assert.equal((await call(mara.cookie, 'GET', '/voices/export')).body.voices.map(item => item.name).join(), 'Mara', 'the library export holds only what you manage');

  // A supervisor keeps the glossary but not the workspace.
  assert.equal((await call(admin.cookie, 'PATCH', `/users/${admin.body.user.id}`, { role: 'agent' })).status, 409, 'not your own role');
  assert.equal((await call(admin.cookie, 'PATCH', `/users/${mara.body.user.id}`, { role: 'supervisor' })).body.user.role, 'supervisor');
  assert.equal((await call(mara.cookie, 'PUT', '/settings', { glossary: [{ id: 'g1', term: 'Acme', kind: 'keep', as: '' }] })).status, 200);
  assert.equal((await call(mara.cookie, 'PUT', '/settings', { queueName: 'Nope' })).status, 403);

  // Offboarding Mara: her recorded voice goes at Fish, the seat that pointed at it is freed and cleared.
  assert.equal((await call(admin.cookie, 'DELETE', `/users/${admin.body.user.id}`)).status, 409, 'not yourself');
  const gone = await call(admin.cookie, 'DELETE', `/users/${mara.body.user.id}`);
  assert.equal(gone.status, 200); assert.equal(gone.body.voicesDeleted, 1);
  assert.deepEqual(deleted, ['refmara00000000']);
  const after = runtime.store.snapshot();
  assert.equal(after.users.length, 1);
  assert.deepEqual(after.voices.map(item => item.name), ['Nina', 'Kyoko']);
  const freed = after.agents.find(item => item.id === seat.body.agent.id);
  assert.equal(freed.userId, null); assert.equal(freed.voiceId, null);
  assert.equal((await call(mara.cookie, 'GET', '/settings')).status, 401, 'her cookie no longer opens the desk');
});
