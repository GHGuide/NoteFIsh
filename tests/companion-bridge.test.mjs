import test from 'node:test';
import assert from 'node:assert/strict';
import { createCallerAccess } from '../server/caller-access.mjs';

test('the companion gets a local, labelled invitation without a public address; phones still need one', () => {
  const local = createCallerAccess({ publicBaseUrl: '', deskPassword: 'secret-secret-secret', publicDemo: false });
  assert.throws(() => local.issue(), /public HTTPS address/, 'a phone link needs the public address');
  const invite = local.issue({ label: 'Zoom · Weekly sync <script>', local: true });
  assert.match(invite.token, /^[0-9a-f-]{36}\.[0-9a-f-]{36}$/);
  assert.equal('url' in invite, false, 'no link to hand out, only the token for this machine');
  assert.equal(invite.label, 'Zoom · Weekly sync script', 'the label is plain text');
  assert.deepEqual(local.consume(invite.token), { label: 'Zoom · Weekly sync script', via: 'companion' }, 'joining hands the label back so the call is named after the app, marked as one the companion found');
  assert.throws(() => local.consume(invite.token), /invalid, expired, or already used/, 'one use');

  const remote = createCallerAccess({ publicBaseUrl: 'https://desk.example', deskPassword: 'secret-secret-secret', publicDemo: false });
  const link = remote.issue({ label: 'x'.repeat(80) });
  assert.ok(link.url.startsWith('https://desk.example/caller#'));
  assert.equal('token' in link, false, 'phone invitations keep the token inside the link only');
  assert.equal(link.label.length, 40, 'labels are capped');
  assert.deepEqual(remote.consume(link.url.split('#')[1]), { label: 'x'.repeat(40), via: 'link' });
  assert.deepEqual(remote.consume(remote.issue().url.split('#')[1]), { label: '', via: 'link' }, 'no label is fine');
});
