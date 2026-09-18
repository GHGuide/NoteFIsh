import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';

// One desk, one owner. There is no roster to administer and nobody to invite; what is
// left of accounts is keeping a hosted desk shut to everyone but the person who set it up.
test('the first sign-up claims the desk, a second is refused, and a voice still belongs to whoever recorded it', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-owner-'));
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

  const open = await call('', 'GET', '/auth/me');
  assert.equal(open.body.open, true);
  const owner = await call('', 'POST', '/auth/signup', { name: 'Nina Okafor', email: 'nina@acme.example', password: 'ten characters!' });
  assert.equal(owner.status, 201);
  assert.equal((await call('', 'POST', '/auth/signup', { name: 'Anyone', email: 'anyone@else.example', password: 'ten characters!' })).status, 403, 'the desk is taken');
  assert.equal((await call('', 'GET', '/auth/me')).body.open, false);
  assert.doesNotMatch(owner.cookie, /notefish_agent=/, 'signing in no longer takes a seat, because there are none');

  // Nothing is left to ask about a roster.
  for (const route of ['/agents', '/floor']) assert.equal((await call(owner.cookie, 'GET', route)).status, 404, `${route} is gone`);

  // Voices are what a person switches between now. The desk's owner reaches all of
  // them, including anything recorded under an account from before the roster went, so
  // collapsing to one person never strands a voice nobody can use.
  const voice = (kind, ownerId, name) => ({ id: `${name.toLowerCase()}-voice`, referenceId: `ref${name.toLowerCase()}00000000`, name, description: '', language: 'en', kind, status: 'ready', archived: false, createdAt: new Date().toISOString(), consent: true, consentAt: new Date().toISOString(), ownerId });
  await runtime.store.update(state => { state.voices.push(voice('enrolled', owner.body.user.id, 'Nina'), voice('enrolled', 'a-long-gone-account', 'Mara'), voice('licensed', null, 'Kyoko')); });
  const seen = (await call(owner.cookie, 'GET', '/voices')).body.voices;
  assert.deepEqual(seen.map(item => [item.name, item.usable]), [['Nina', true], ['Mara', true], ['Kyoko', true]]);
  for (const id of ['nina-voice', 'mara-voice', 'kyoko-voice']) {
    assert.equal((await call(owner.cookie, 'PUT', '/settings', { voiceId: id })).status, 200, `${id} can be the voice that answers`);
  }

  // Recording sets you up; there is no separate seat to finish setting up.
  assert.equal((await call(owner.cookie, 'PUT', '/settings', { onboardedAt: true })).status, 200);
  assert.match(runtime.store.snapshot().settings.onboardedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(deleted.length, 0);
});

// The hosted shape: no shared desk password, accounts only.
test('a desk with accounts and no shared password asks people to sign in, and lets a signed-in one through', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-hosted-'));
  await mkdir(path.join(directory, 'dist'), { recursive: true });
  await writeFile(path.join(directory, 'dist', 'index.html'), '<!doctype html><title>NoteFish</title>');
  const config = loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', PUBLIC_BASE_URL: 'https://desk.example', NOTEFISH_ADMIN_EMAIL: 'Nina@Acme.Example', DATA_DIR: directory }, directory);
  assert.equal(config.deskPassword, '', 'no shared password on a hosted desk');
  assert.throws(() => loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', PUBLIC_BASE_URL: 'https://desk.example', DATA_DIR: directory }, directory), /NOTEFISH_ADMIN_EMAIL/, 'a public desk is never left open to the first visitor');
  const runtime = await createRuntime({ config, providers: { getVoice: async () => ({ state: 'trained' }) } });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });

  const shut = await fetch(`${base}/api/settings`);
  assert.equal(shut.status, 401, 'signed out is signed out, not a misconfigured server');
  assert.equal((await shut.json()).code, 'AUTH_REQUIRED');
  assert.equal((await fetch(`${base}/desk`)).status, 200, 'the shell still loads so the sign-in page can render');
  const grab = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { Origin: 'https://desk.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Passer By', email: 'passer@by.example', password: 'ten characters!' }) });
  assert.equal(grab.status, 403, 'only the named person can claim a fresh desk');
  const signUp = await fetch(`${base}/api/auth/signup`, { method: 'POST', headers: { Origin: 'https://desk.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Nina Okafor', email: 'nina@acme.example', password: 'ten characters!' }) });
  assert.equal(signUp.status, 201);
  const cookie = signUp.headers.getSetCookie().map(item => item.split(';')[0]).join('; ');
  assert.equal((await fetch(`${base}/api/settings`, { headers: { cookie } })).status, 200);
  // Signing out is gone from the interface; the route still answers so an old tab that
  // calls it is not left hanging, and the desk is simply signed in to again.
  const out = await fetch(`${base}/api/auth/signout`, { method: 'POST', headers: { Origin: 'https://desk.example', cookie } });
  assert.equal(out.status, 204);
});

// The bare domain is the marketing page; the desk keeps its own subdomain.
test('the marketing site answers on the site hosts, and the desk answers everywhere else', { timeout: 10000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-site-'));
  await mkdir(path.join(directory, 'dist'), { recursive: true });
  await writeFile(path.join(directory, 'dist', 'index.html'), '<!doctype html><title>NoteFish desk</title>');
  const config = loadConfig({ NODE_ENV: 'production', HOST: '0.0.0.0', PUBLIC_BASE_URL: 'https://app.notefish.ai', NOTEFISH_ADMIN_EMAIL: 'nina@acme.example', NOTEFISH_SITE_HOSTS: 'notefish.ai, www.notefish.ai', DATA_DIR: directory }, directory);
  assert.deepEqual(config.siteHosts, ['notefish.ai', 'www.notefish.ai']);
  const runtime = await createRuntime({ config, providers: { getVoice: async () => ({ state: 'trained' }) } });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  // fetch refuses to set Host, so ask over a plain socket the way a browser would.
  const page = host => new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port: runtime.server.address().port, path: '/', headers: { Host: host } }, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject); request.end();
  });

  const site = await page('notefish.ai');
  assert.equal(site.status, 200);
  assert.match(site.body, /Don’t translate/, 'the bare domain gets the marketing page');
  assert.match((await page('www.notefish.ai')).body, /Don’t translate/);
  const downloads = await new Promise((resolve, reject) => {
    const call = httpRequest({ host: '127.0.0.1', port: runtime.server.address().port, path: '/downloads', headers: { Host: 'notefish.ai' } }, response => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    call.on('error', reject); call.end();
  });
  assert.equal(downloads.status, 200);
  assert.match(downloads.body, /Three steps/, 'the download page explains the install');
  const build = await fetch(`${base}/api/mac-build`);
  assert.deepEqual(await build.json(), { url: null }, 'with no build configured the page is told so rather than guessing');

  const desk = await page('app.notefish.ai');
  assert.equal(desk.status, 200);
  assert.match(desk.body, /NoteFish desk/, 'the desk subdomain still gets the app shell');
  assert.doesNotMatch(desk.body, /Don’t translate/);
});
