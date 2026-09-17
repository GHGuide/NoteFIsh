import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts, hashPassword, verifyPassword } from '../server/accounts.mjs';
import { canAccessDesk } from '../server/security.mjs';

// A store with just what accounts touch: users and the cookie secret.
function memoryStore(users = []) {
  const state = { users, authSecret: null };
  return { snapshot: () => structuredClone(state), update: async fn => { const next = structuredClone(state); await fn(next); Object.assign(state, next); return next; } };
}
const remote = cookie => ({ socket: { remoteAddress: '203.0.113.9' }, headers: { host: 'desk.example', cookie } });
const config = { production: true, publicBaseUrl: 'https://desk.example', deskPassword: 'a-long-desk-password!', sessionSecret: '' };

test('a password hash verifies its own password and nothing else', () => {
  const stored = hashPassword('correct horse battery');
  assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(verifyPassword('correct horse battery', stored), true);
  assert.equal(verifyPassword('correct horse batter', stored), false);
  assert.equal(verifyPassword('anything', 'garbage'), false);
});

test('signing up creates the account, sets a cookie the desk accepts, and refuses a second account on the same email', async () => {
  const store = memoryStore();
  const accounts = createAccounts(config, store);
  const user = await accounts.signUp({ name: '  Nina   Okafor ', email: 'Nina@Acme.Example', password: 'ten characters!' });
  assert.equal(user.name, 'Nina Okafor'); assert.equal(user.email, 'nina@acme.example'); assert.equal('passwordHash' in user, false, 'the hash never leaves the server');
  assert.ok(store.snapshot().authSecret, 'a cookie secret was minted and kept');
  const cookie = accounts.cookie(user.id);
  assert.match(cookie, /^notefish_user=.+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  assert.equal(accounts.read(remote(cookie.split(';')[0])), user.id, 'the cookie names the user');
  assert.equal(canAccessDesk(remote(cookie.split(';')[0]), config, accounts), true, 'a signed-in browser may open the desk from anywhere');
  assert.equal(canAccessDesk(remote(''), config, accounts), false, 'a stranger may not');
  await assert.rejects(accounts.signUp({ name: 'Nina', email: 'nina@acme.example', password: 'ten characters!' }), /already an account/);
  await assert.rejects(accounts.signUp({ name: 'Sam', email: 'not-an-email', password: 'ten characters!' }), /email/);
  await assert.rejects(accounts.signUp({ name: 'Sam', email: 'sam@acme.example', password: 'short' }), /at least 10/);
});

test('signing in checks the password, counts failures per address, and a tampered cookie is nobody', async () => {
  const store = memoryStore();
  const accounts = createAccounts(config, store);
  const user = await accounts.signUp({ name: 'Nina', email: 'nina@acme.example', password: 'ten characters!' });
  assert.equal((await accounts.signIn({ email: 'NINA@acme.example', password: 'ten characters!' }, '1.1.1.1')).id, user.id);
  await assert.rejects(accounts.signIn({ email: 'nina@acme.example', password: 'wrong password' }, '1.1.1.1'), /do not match/);
  await assert.rejects(accounts.signIn({ email: 'nobody@acme.example', password: 'ten characters!' }, '1.1.1.1'), /do not match/, 'an unknown email reads the same as a wrong password');
  for (let i = 0; i < 10; i++) await accounts.signIn({ email: 'nina@acme.example', password: 'wrong' }, '2.2.2.2').catch(() => {});
  await assert.rejects(accounts.signIn({ email: 'nina@acme.example', password: 'ten characters!' }, '2.2.2.2'), /Too many attempts/, 'ten failures lock that address for a minute, even for the right password');
  const good = accounts.cookie(user.id).split(';')[0];
  assert.equal(accounts.read(remote(good.slice(0, -2) + 'xx')), '', 'a changed signature is rejected');
  assert.equal(accounts.read(remote(good.replace(user.id, '00000000-0000-4000-8000-000000000000'))), '', 'a signature for another id is rejected');
});
