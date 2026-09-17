import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccounts } from '../server/accounts.mjs';

function memoryStore(agents) {
  const state = { users: [], agents, invites: [], authSecret: null };
  return { snapshot: () => structuredClone(state), update: async fn => { const next = structuredClone(state); await fn(next); Object.assign(state, next); return next; } };
}
const config = { production: false, publicBaseUrl: '', deskPassword: '', sessionSecret: 'a-test-secret' };
const nina = { id: '11111111-1111-4111-8111-111111111111', name: 'Nina Okafor', email: 'nina@acme.example', userId: null, archived: false };

test('an invitation names a seat; accepting it signs the person up as that seat, once, and signing in later finds the seat again', async () => {
  let clock = 1_000_000;
  const store = memoryStore([nina]);
  const accounts = createAccounts(config, store, { now: () => clock });
  const invite = await accounts.invites.issue(nina);
  assert.match(invite.token, /^[0-9a-f-]{36}[0-9a-f]{32}$/);
  assert.equal(accounts.invites.pending(nina.id).token, invite.token, 'the roster can show the pending link');
  assert.equal(accounts.invites.find(invite.token).agent.name, 'Nina Okafor');
  assert.equal(accounts.invites.find('nonsense'), null);
  const user = await accounts.signUp({ name: 'Nina Okafor', email: 'nina@acme.example', password: 'ten characters!' });
  assert.equal(await accounts.invites.accept(invite.token, user), nina.id, 'accepting hands back the seat');
  assert.equal(store.snapshot().agents[0].userId, user.id, 'the seat now belongs to the account');
  assert.equal(accounts.invites.pending(nina.id), null, 'one use');
  await assert.rejects(accounts.invites.accept(invite.token, user), /no longer valid/);
  assert.equal(accounts.seatOf(user.id), nina.id, 'signing in later takes the same seat');
  const again = await accounts.invites.issue(nina);
  clock += 8 * 24 * 60 * 60 * 1000;
  assert.equal(accounts.invites.find(again.token), null, 'a week later the link has expired');
});
