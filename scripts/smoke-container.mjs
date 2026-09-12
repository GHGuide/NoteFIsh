#!/usr/bin/env node
// Runs the already-built demo image. No real provider credentials are used.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const image = 'notefish:demo';
const prefix = `notefish-smoke-${randomUUID().replaceAll('-', '')}`;
const volume = `${prefix}-data`;
const names = [`${prefix}-first`, `${prefix}-restart`];
const publicOrigin = 'https://smoke.notefish.invalid';
const secretKeys = new Set(['OPENAI_API_KEY', 'FISH_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'NOTEFISH_DESK_PASSWORD']);
const password = `${randomUUID()}${randomUUID()}`;
const authorization = `Basic ${Buffer.from(`desk:${password}`).toString('base64')}`;
const queueName = `Persistent demo ${prefix.slice(-8)}`;
const report = { image, startedAt: new Date().toISOString(), success: false, checks: [] };
let temporaryDirectory; let volumeCreated = false;
const containers = new Set();

function check(condition, label) {
  if (!condition) throw new Error(label);
  report.checks.push(label);
}

async function docker(args, label, { timeout = 30000 } = {}) {
  try {
    const { stdout } = await execFileAsync('docker', args, { timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    // Docker errors may contain input, environment or application logs. Never print them.
    throw new Error(label);
  }
}

async function request(base, route, { authenticated = false, method = 'GET', body } = {}) {
  const headers = {};
  if (authenticated) headers.Authorization = authorization;
  if (method !== 'GET') headers.Origin = publicOrigin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetch(`${base}${route}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
  } catch { throw new Error('The container did not answer an HTTP request.'); }
}

async function startContainer(name, envFile) {
  // Track the generated name before run: even a partial Docker failure can create it.
  containers.add(name);
  await docker(['run', '--detach', '--name', name, '--env-file', envFile,
    '--publish', '127.0.0.1::18080', '--mount', `type=volume,source=${volume},target=/var/data`, image],
  'The demo container could not start. Build notefish:demo first.');
  const rawPorts = await docker(['inspect', '--format', '{{json .NetworkSettings.Ports}}', name], 'The container port could not be inspected.');
  let binding;
  try { binding = JSON.parse(rawPorts)['18080/tcp']?.[0]; } catch { throw new Error('Docker returned an invalid port mapping.'); }
  if (binding?.HostIp !== '127.0.0.1' || !/^\d{1,5}$/u.test(binding.HostPort)
    || Number(binding.HostPort) < 1 || Number(binding.HostPort) > 65535) throw new Error('The container must use an ephemeral loopback-only port.');
  const base = `http://127.0.0.1:${binding.HostPort}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await request(base, '/healthz');
      const healthy = response.status === 200;
      await response.body?.cancel();
      if (healthy) return base;
    } catch { /* Startup may take a moment. */ }
    await delay(250);
  }
  throw new Error('The container did not become healthy within the startup window.');
}

async function verifyRuntime(name, base) {
  let response = await request(base, '/healthz');
  check(response.status === 200, 'Health endpoint returns 200.'); await response.body?.cancel();
  response = await request(base, '/api/settings');
  check(response.status === 401, 'Anonymous settings requests are denied with 401.'); await response.body?.cancel();
  response = await request(base, '/api/settings', { authenticated: true });
  check(response.status === 200, 'Authenticated settings requests return 200.');
  const { settings } = await response.json();
  check(settings?.agentLanguage === 'en' && settings?.customerLanguage === 'fr', 'Default languages are English agent and French caller.');

  const uid = await docker(['exec', name, 'node', '-e',
    "const fs=require('node:fs');const match=fs.readFileSync('/proc/1/status','utf8').match(/^Uid:\\s+(\\d+)/m);if(!match)process.exit(1);process.stdout.write(match[1]);"],
  'The application process identity could not be inspected.');
  const nodeUid = await docker(['exec', name, 'id', '-u', 'node'], 'The node account identity could not be inspected.');
  check(/^\d+$/u.test(uid) && uid !== '0' && uid === nodeUid, 'Application PID 1 runs as the non-root node user.');
  await docker(['exec', name, 'ffmpeg', '-version'], 'ffmpeg is unavailable inside the image.');
  report.checks.push('ffmpeg is available inside the image.');

  await docker(['exec', name, 'node', '-e',
    "const fs=require('node:fs');const forbidden=['/app/data','/app/keys.js','/app/server/keys.js'];if(fs.readdirSync('/app').some(n=>n==='.env'||n.startsWith('.env.'))||forbidden.some(p=>fs.existsSync(p)))process.exit(1);"],
  'A prohibited environment, key, or local data path was found in the container.');
  report.checks.push('No .env, local /app/data, or known key files are bundled.');
  response = await request(base, '/api/status', { authenticated: true });
  check(response.status === 200, 'Authenticated status endpoint returns 200.');
  const status = await response.json();
  check(status.providers?.fish?.configured === false && status.providers?.openai?.configured === false
    && status.providers?.twilio?.configured === false, 'No Fish, OpenAI, or Twilio credentials are configured in the smoke container.');
  return settings;
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Run this smoke check with Node.js 22 or newer.');
  const metadataRaw = await docker(['image', 'inspect', '--format', '{{json .Config.Env}}', image], 'The notefish:demo image is missing. Build it before running this script.');
  let metadata;
  try { metadata = JSON.parse(metadataRaw); } catch { throw new Error('Docker returned invalid image metadata.'); }
  check(Array.isArray(metadata) && metadata.every(entry => typeof entry === 'string' && !secretKeys.has(entry.split('=', 1)[0])),
    'Image environment contains no provider credentials or desk password.');
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  const envFile = path.join(temporaryDirectory, 'smoke.env');
  await writeFile(envFile, [
    'NODE_ENV=production', 'HOST=0.0.0.0', 'PORT=18080', 'DATA_DIR=/var/data',
    `PUBLIC_BASE_URL=${publicOrigin}`, `NOTEFISH_DESK_PASSWORD=${password}`, '',
  ].join('\n'), { mode: 0o600, flag: 'wx' });
  volumeCreated = true;
  await docker(['volume', 'create', volume], 'The temporary Docker volume could not be created.');
  const firstBase = await startContainer(names[0], envFile);
  const settings = await verifyRuntime(names[0], firstBase);
  const changed = await request(firstBase, '/api/settings', { authenticated: true, method: 'PUT', body: { ...settings, queueName } });
  check(changed.status === 200, 'An authenticated same-origin settings update succeeds.'); await changed.body?.cancel();
  await docker(['rm', '--force', names[0]], 'The first smoke container could not be removed.'); containers.delete(names[0]);
  const restartedBase = await startContainer(names[1], envFile);
  const restored = await verifyRuntime(names[1], restartedBase);
  check(restored.queueName === queueName, 'Queue settings survive container recreation on the same persistent volume.');
  report.success = true;
}

try {
  await main();
} catch (error) {
  report.error = error instanceof Error && typeof error.message === 'string' ? error.message : 'The container smoke check failed.';
  process.exitCode = 1;
} finally {
  const cleanupErrors = [];
  for (const name of containers) {
    try { await docker(['rm', '--force', name], 'A smoke container could not be removed.'); }
    catch { cleanupErrors.push('A generated smoke container could not be removed.'); }
  }
  if (volumeCreated) {
    try { await docker(['volume', 'rm', volume], 'The smoke volume could not be removed.'); }
    catch { cleanupErrors.push('The generated smoke volume could not be removed.'); }
  }
  if (temporaryDirectory) {
    try { await rm(temporaryDirectory, { recursive: true, force: true }); }
    catch { cleanupErrors.push('The temporary credential directory could not be removed.'); }
  }
  if (cleanupErrors.length) { report.cleanupErrors = cleanupErrors; report.success = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  const evidenceDirectory = path.join(root, 'data', 'evidence');
  try {
    await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
    await writeFile(path.join(evidenceDirectory, 'docker-smoke.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  } catch { report.evidenceSaved = false; }
  // Only static check names and sanitized outcomes are emitted; never command output or credentials.
  console.log(JSON.stringify(report, null, 2));
}
