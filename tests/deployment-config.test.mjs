import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.mjs';

test('Render uses injected PORT, all interfaces, provider hostname and mounted data directory', () => {
  const config = loadConfig({ RENDER: 'true', PORT: '10000', RENDER_EXTERNAL_URL: 'https://notefish.example.test', DATA_DIR: '/var/data', NOTEFISH_DESK_PASSWORD: 'test-only-password-12345' });
  assert.equal(config.port, 10000);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.publicBaseUrl, 'https://notefish.example.test');
  assert.equal(config.dataPath, '/var/data/notefish.json');
  assert.equal(config.production, true);
});

test('public listening fails closed without a strong password; invalid deployment values fail safely', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /NOTEFISH_DESK_PASSWORD/);
  assert.throws(() => loadConfig({ NOTEFISH_DESK_PASSWORD: 'short' }), /at least 16/);
  assert.throws(() => loadConfig({ PORT: '10000; other' }), /Invalid PORT/);
  assert.throws(() => loadConfig({ PUBLIC_BASE_URL: 'http://example.test' }), /HTTPS origin/);
  assert.throws(() => loadConfig({ PUBLIC_BASE_URL: 'https://user:pass@example.test' }), /HTTPS origin/);
  assert.throws(() => loadConfig({ DATA_DIR: '../other' }), /absolute directory/);
});
