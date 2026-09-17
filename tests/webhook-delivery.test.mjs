import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createIntegrations } from '../server/integrations/index.mjs';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';

const secret = 'w'.repeat(40);
const baseConfig = { webhookUrl: 'https://tickets.test/hook', webhookSecret: secret };
const endedCall = {
  id: 'call-1', callSid: 'browser:x', transport: 'browser', state: 'ended',
  from: '+33612345678', agentId: 'agent-1', agentName: 'Nina',
  agentLanguage: 'en', customerLanguage: 'fr',
  startedAt: '2026-09-15T10:00:00Z', answeredAt: '2026-09-15T10:00:04Z', endedAt: '2026-09-15T10:04:00Z',
  voiceId: 'voice-1',
  ticket: { issue: 'Locked out', address: '2 Rue Test', dispatch: 'confirmed' },
  transcript: [{ id: 'l1', t: '2026-09-15T10:00:10Z', speaker: 'customer', sourceLang: 'fr', targetLang: 'en', textSource: 'Je suis bloqué', textShown: 'I am locked out' }],
};

test('a completed call is signed, sent once, and never carries provider configuration', async () => {
  const sent = [];
  const integrations = createIntegrations({
    config: baseConfig,
    fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200, body: null }; },
  });
  assert.deepEqual(integrations.names, ['webhook']);
  await integrations.deliver(endedCall);
  assert.equal(sent.length, 1);

  const { url, init } = sent[0];
  assert.equal(url, baseConfig.webhookUrl);
  assert.equal(init.redirect, 'error');
  const timestamp = init.headers['X-NoteFIsh-Timestamp'];
  const expected = createHmac('sha256', secret).update(`${timestamp}.${init.body}`).digest('hex');
  assert.equal(init.headers['X-NoteFIsh-Signature'], `sha256=${expected}`, 'the signature covers the timestamp and the exact bytes sent');
  assert.ok(Math.abs(Date.now() / 1000 - Number(timestamp)) < 60, 'a receiver can reject a replayed timestamp');

  const body = JSON.parse(init.body);
  assert.equal(body.agent.name, 'Nina');
  assert.equal(body.ticket.issue, 'Locked out');
  assert.equal(body.transcript[0].textShown, 'I am locked out');
  assert.equal('voiceId' in body, false, 'voice and provider details stay inside NoteFIsh');
  assert.equal(JSON.stringify(body).includes(secret), false);

  // A live call is not a completed one.
  await integrations.deliver({ ...endedCall, state: 'in_call' });
  assert.equal(sent.length, 1);
});

test('delivery retries what may recover and gives up on what will not', async () => {
  const build = responder => {
    const attempts = [];
    const integrations = createIntegrations({
      config: baseConfig, retryMs: [1, 1], wait: async () => {},
      fetchImpl: async () => { attempts.push(1); return responder(attempts.length); },
    });
    return { integrations, attempts };
  };

  const flaky = build(count => count < 3 ? { ok: false, status: 503, body: null } : { ok: true, status: 200, body: null });
  await flaky.integrations.deliver(endedCall);
  assert.equal(flaky.attempts.length, 3);
  assert.equal(flaky.integrations.history()[0].ok, true);

  const rejected = build(() => ({ ok: false, status: 400, body: null }));
  await rejected.integrations.deliver(endedCall);
  assert.equal(rejected.attempts.length, 1, 'a 400 will not become a 200 by repeating it');
  assert.equal(rejected.integrations.history()[0].ok, false);

  const throttled = build(() => ({ ok: false, status: 429, body: null }));
  await throttled.integrations.deliver(endedCall);
  assert.equal(throttled.attempts.length, 3, 'a rate limit is worth retrying');

  const unreachable = build(() => { throw new Error('ECONNREFUSED'); });
  await unreachable.integrations.deliver(endedCall);
  assert.equal(unreachable.attempts.length, 3);
  const record = unreachable.integrations.history()[0];
  assert.equal(record.ok, false);
  assert.equal(record.callId, 'call-1');
});

test('the Zendesk adapter creates one ticket and reports its id', async () => {
  const sent = [];
  const integrations = createIntegrations({
    config: { zendeskSubdomain: 'acme', zendeskEmail: 'desk@acme.test', zendeskApiToken: 'token-value' },
    fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true, status: 201, json: async () => ({ ticket: { id: 42 } }), body: null }; },
  });
  assert.deepEqual(integrations.names, ['zendesk']);
  await integrations.deliver(endedCall);

  assert.equal(sent[0].url, 'https://acme.zendesk.com/api/v2/tickets.json');
  assert.equal(sent[0].init.headers.Authorization, `Basic ${Buffer.from('desk@acme.test/token:token-value').toString('base64')}`);
  const ticket = JSON.parse(sent[0].init.body).ticket;
  assert.equal(ticket.external_id, 'call-1', 'the same call cannot be filed twice under a different id');
  assert.ok(ticket.comment.body.includes('Locked out'));
  assert.ok(ticket.comment.body.includes('I am locked out'), 'the agent reads the translated line too');
  assert.equal(ticket.comment.public, false);
  assert.equal(integrations.history()[0].reference, '42');
});

test('the export API is token-gated, read-only, paged, and safe to open in a spreadsheet', { timeout: 20000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-export-'));
  const exportToken = 'e'.repeat(40);
  const config = loadConfig({
    NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://example.test',
    NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', NOTEFISH_EXPORT_TOKEN: exportToken,
    DATA_DIR: directory,
  }, directory);
  const runtime = await createRuntime({ config });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });

  await runtime.store.update(state => {
    state.calls = [
      { ...endedCall, id: 'call-a', callSid: `CA${'1'.repeat(32)}`, transport: 'twilio', endedAt: '2026-09-15T10:00:00Z', ticket: { issue: '=SUM(A1)', address: '', dispatch: 'none' } },
      { ...endedCall, id: 'call-b', callSid: `CA${'2'.repeat(32)}`, transport: 'twilio', endedAt: '2026-09-15T11:00:00Z' },
    ];
  });

  const withToken = (route, options = {}) => fetch(`${base}${route}`, { ...options, headers: { Authorization: `Bearer ${exportToken}`, ...options.headers } });
  assert.equal((await fetch(`${base}/api/export/calls`)).status, 401, 'the workspace password is not the export token');
  assert.equal((await withToken('/api/export/calls', { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/api/export/calls`, { headers: { Authorization: `Bearer ${'f'.repeat(40)}` } })).status, 401);

  const page = await (await withToken('/api/export/calls?limit=1')).json();
  assert.deepEqual(page.calls.map(call => call.id), ['call-a'], 'oldest first, so a cursor never skips a call');
  assert.equal(page.nextCursor, '2026-09-15T10:00:00Z');
  const next = await (await withToken(`/api/export/calls?cursor=${encodeURIComponent(page.nextCursor)}`)).json();
  assert.deepEqual(next.calls.map(call => call.id), ['call-b']);
  assert.equal(next.nextCursor, null);

  const csv = await (await withToken('/api/export/calls?format=csv')).text();
  const rows = csv.split('\n');
  assert.ok(rows[0].startsWith('id,from,transport,agent'));
  assert.equal(rows.length, 3);
  assert.ok(rows[1].includes("'=SUM(A1)"), 'a formula from a caller cannot execute in a spreadsheet');

  assert.equal((await withToken('/api/export/calls?limit=9999')).status, 400);
  assert.equal((await withToken('/api/export/calls?since=not-a-date')).status, 400);
});
