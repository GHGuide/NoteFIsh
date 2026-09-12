import test from 'node:test';
import assert from 'node:assert/strict';
import twilio from 'twilio';
import { loadConfig, getStatus } from '../server/config.mjs';
import { isLocalRequest, isAuthenticated, canAccessDesk, validOrigin, validateTwilio } from '../server/security.mjs';

const config = loadConfig({ NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', PUBLIC_BASE_URL: 'https://example.test', TWILIO_AUTH_TOKEN: 'test-only-auth-token' });
const req = (headers = {}, remoteAddress = '127.0.0.1') => ({ headers: { host: 'localhost:3001', ...headers }, socket: { remoteAddress } });

test('local bypass requires actual loopback, a loopback Host, and no proxy headers', () => {
  assert.equal(isLocalRequest(req()), true);
  assert.equal(isLocalRequest(req({}, '203.0.113.1')), false);
  assert.equal(isLocalRequest(req({ host: 'example.test' })), false);
  for (const header of ['forwarded', 'x-forwarded-host', 'x-forwarded-for', 'x-forwarded-proto', 'cf-connecting-ip']) assert.equal(isLocalRequest(req({ [header]: 'proxy' })), false);
  assert.equal(isAuthenticated(req({ host: 'example.test' }), config), false);
});

test('public HTTP Basic validates the complete password and fails closed when configuration is missing', () => {
  const credentials = password => `Basic ${Buffer.from(`desk:${password}`).toString('base64')}`;
  assert.equal(isAuthenticated(req({ host: 'example.test', authorization: credentials(config.deskPassword) }), config), true);
  assert.equal(isAuthenticated(req({ host: 'example.test', authorization: credentials(`${config.deskPassword}x`) }), config), false);
  assert.equal(isAuthenticated(req({ host: 'example.test', authorization: credentials(config.deskPassword) }), { ...config, publicBaseUrl: '' }), false);
  assert.equal(isAuthenticated(req({ host: 'example.test', authorization: 'Basic !!!' }), config), false);
});

test('shared demo access requires explicit validated opt-in and can be returned to protected mode', () => {
  const request = req({ host: 'example.test' }, '203.0.113.1');
  assert.equal(canAccessDesk(request, config), false);
  const demo = loadConfig({ NODE_ENV: 'production', NOTEFISH_PUBLIC_DEMO: 'true', PUBLIC_BASE_URL: 'https://example.test' });
  assert.equal(demo.publicDemo, true);
  assert.equal(canAccessDesk(request, demo), true);
  assert.equal(isAuthenticated(request, demo), false);
  assert.equal(canAccessDesk(request, { ...demo, publicBaseUrl: '' }), false);
  assert.equal(canAccessDesk(request, { ...demo, publicDemo: 'true' }), false);
  const protectedConfig = loadConfig({ NODE_ENV: 'production', NOTEFISH_PUBLIC_DEMO: 'false', PUBLIC_BASE_URL: 'https://example.test', NOTEFISH_DESK_PASSWORD: config.deskPassword });
  assert.equal(canAccessDesk(request, protectedConfig), false);
  for (const value of ['1', 'TRUE', 'yes']) assert.throws(() => loadConfig({ NOTEFISH_PUBLIC_DEMO: value }), /Invalid NOTEFISH_PUBLIC_DEMO/);
  assert.throws(() => loadConfig({ NOTEFISH_PUBLIC_DEMO: 'true' }), /PUBLIC_BASE_URL/);
  const status = getStatus(demo, { audioAvailable: true });
  assert.deepEqual(status.access, { mode: 'shared-demo', loginRequired: false });
  assert.equal(status.missing.includes('NOTEFISH_DESK_PASSWORD'), false);
});

test('Origin checks reject cross-site commands and accept same-origin or local development', () => {
  assert.equal(validOrigin(req({ origin: 'http://localhost:5173' }), config), true);
  assert.equal(validOrigin(req({ host: 'example.test', origin: 'https://example.test' }), config), true);
  assert.equal(validOrigin(req({ host: 'example.test', origin: 'https://evil.test' }), config), false);
  assert.equal(validOrigin(req({ host: 'example.test', origin: 'http://localhost:5173' }), config), false);
  assert.equal(validOrigin(req(), config), false);
});

test('Twilio request signatures bind all body values and exact public endpoint', () => {
  const body = { AccountSid: `AC${'1'.repeat(32)}`, CallSid: `CA${'2'.repeat(32)}`, From: '+33123456789' };
  const signature = twilio.getExpectedTwilioSignature(config.twilioAuthToken, `${config.publicBaseUrl}/twilio/incoming`, body);
  const incoming = { headers: { 'x-twilio-signature': signature }, body, path: '/twilio/incoming', url: '/twilio/incoming' };
  assert.equal(validateTwilio(incoming, config), true);
  assert.equal(validateTwilio({ ...incoming, body: { ...body, From: '+33123456780' } }, config), false);
  assert.equal(validateTwilio({ ...incoming, url: '/twilio/incoming?other=1' }, config), false);
  assert.equal(validateTwilio({ ...incoming, path: '/twilio/status' }, config), false);
  assert.equal(validateTwilio(incoming, { ...config, deskPassword: '' }), false);
});

test('Twilio WSS rejects untrusted signatures and accepts documented canonical/trailing slash variants', () => {
  for (const suffix of ['', '/']) {
    const signature = twilio.getExpectedTwilioSignature(config.twilioAuthToken, `wss://example.test/ws/twilio${suffix}`, {});
    assert.equal(validateTwilio({ url: '/ws/twilio', headers: { 'x-twilio-signature': signature } }, config, { websocket: true }), true);
  }
  assert.equal(validateTwilio({ url: '/ws/twilio', headers: { 'x-twilio-signature': 'x'.repeat(27) + '=' } }, config, { websocket: true }), false);
});

test('status exposes configuration names without secret values or verification claims', () => {
  const status = getStatus(config, { audioAvailable: true });
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes(config.deskPassword), false);
  assert.equal(serialized.includes(config.twilioAuthToken), false);
  assert.equal(status.verified, false);
  assert.equal(status.providers.fish.verified, false);
  assert.ok(status.missing.includes('FISH_API_KEY'));
});
