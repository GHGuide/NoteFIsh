import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCallerAccess } from '../server/caller-access.mjs';
import { loadConfig, getStatus } from '../server/config.mjs';
import { prepareDemoConfig } from '../scripts/start-browser-demo.mjs';

const config = loadConfig({ PUBLIC_BASE_URL: 'https://example.test', NOTEFISH_DESK_PASSWORD: 'test-only-password-12345' });

test('caller invitations are unpredictable, fragment-only, expiring and single-use', () => {
  let clock = Date.now();
  const access = createCallerAccess(config, { now: () => clock, lifetimeMs: 1000 });
  const invite = access.issue();
  const url = new URL(invite.url);
  assert.equal(url.pathname, '/caller'); assert.equal(url.search, '');
  assert.equal(url.hash.length, 74);
  const token = url.hash.slice(1);
  assert.throws(() => access.consume(`${token.slice(0, -1)}z`), /invalid, expired, or already used/);
  access.consume(token);
  assert.throws(() => access.consume(token), /invalid, expired, or already used/);
  const second = new URL(access.issue().url).hash.slice(1);
  assert.notEqual(second, token);
  clock += 1001;
  assert.throws(() => access.consume(second), /invalid, expired, or already used/);
});

test('caller invitations and anonymous upgrade attempts are bounded', () => {
  let clock = Date.now();
  const access = createCallerAccess(config, { now: () => clock });
  for (let i = 0; i < 8; i++) access.issue();
  assert.throws(() => access.issue(), /eight active caller links/);
  for (let i = 0; i < 30; i++) assert.equal(access.allowUpgrade('127.0.0.1'), true);
  assert.equal(access.allowUpgrade('127.0.0.1'), false);
  clock += 60_001;
  assert.equal(access.allowUpgrade('127.0.0.1'), true);
  access.clear();
  assert.doesNotThrow(() => access.issue());
});

test('browser demo configuration does not require Twilio', () => {
  const status = getStatus({ ...config, fishApiKey: 'test-fish', openaiApiKey: 'test-openai' }, { audioAvailable: true });
  assert.equal(status.ready, true);
  assert.equal(status.demoTransport, 'browser');
  assert.equal(status.providers.twilio.optional, true);
  assert.deepEqual(status.missing, []);
});

test('demo launcher preserves project keys, generates a private desk password, and injects only the chosen public origin', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-launcher-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, '.env'), 'FISH_API_KEY=test-fish\nOPENAI_API_KEY=test-project-openai\n');
  const result = await prepareDemoConfig('https://example.test', directory, { OPENAI_API_KEY: 'test-other-shell-key' });
  assert.equal(result.openaiApiKey, 'test-project-openai');
  assert.equal(result.fishApiKey, 'test-fish');
  assert.ok(result.deskPassword.length >= 24);
  assert.equal(result.publicBaseUrl, 'https://example.test');
  assert.equal(result.host, '127.0.0.1');
  assert.equal((await stat(path.join(directory, '.env'))).mode & 0o777, 0o600);
  const persisted = await readFile(path.join(directory, '.env'), 'utf8');
  assert.ok(persisted.includes('FISH_API_KEY=test-fish'));
  assert.equal(persisted.includes('PUBLIC_BASE_URL='), false);
  const again = await prepareDemoConfig('https://another.example.test', directory, {});
  assert.equal(again.deskPassword, result.deskPassword);
  const overridden = await prepareDemoConfig('https://example.test', directory, {}, '3002');
  assert.equal(overridden.port, 3002);
  assert.equal((await readFile(path.join(directory, '.env'), 'utf8')).includes('PORT=3002'), false);
});
