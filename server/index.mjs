import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import dotenv from 'dotenv';
import { WebSocketServer, WebSocket } from 'ws';
import { loadConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { createProviders } from './providers.mjs';
import { createCallService } from './calls.mjs';
import { createSecurity, securityHeaders, canAccessDesk, validOrigin, validateTwilio } from './security.mjs';
import { createApiRouter, createTwilioRouter, createExportRouter, errorHandler } from './routes.mjs';
import { createCallerAccess, CallerAccessError } from './caller-access.mjs';
import { createSessions } from './session.mjs';
import { createQueue } from './queue.mjs';
import { createIntegrations } from './integrations/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

export async function createRuntime({ config = loadConfig(process.env, root), store: suppliedStore, providers: suppliedProviders, calls: suppliedCalls } = {}) {
  const store = suppliedStore || await createStore(config.dataPath);
  const providers = suppliedProviders || createProviders(config);
  const callerAccess = createCallerAccess(config);
  const sessions = createSessions(config);
  const integrations = createIntegrations({ config });
  // ws -> agentId ('' for a desk with no agent selected yet).
  const clients = new Map();
  const disconnectTimers = new Map();
  const broadcast = (event, { to } = {}) => {
    const payload = JSON.stringify(event);
    for (const [client, agentId] of clients) {
      // A targeted event reaches that agent's own tabs only. An untargeted one
      // is floor-wide information: who is ringing, who is on what.
      if (to && agentId !== to) continue;
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > 1024 * 1024) { client.close(1013, 'Desk connection is too slow'); continue; }
      client.send(payload);
    }
  };
  const calls = suppliedCalls || createCallService({ config, store, providers, broadcast, onComplete: call => integrations.deliver(call) });
  const queue = createQueue({ store, calls });
  const floorEvent = () => broadcast({ type: 'floor', floor: queue.snapshot() });
  await calls.initialize?.();
  let audioAvailable = false;
  try { await execFileAsync('ffmpeg', ['-version'], { timeout: 3000, maxBuffer: 32 * 1024, env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } }); audioAvailable = true; } catch { /* status reports missing conversion support without logging subprocess output */ }
  const app = express();
  app.locals.publicSocketOrigin = config.publicBaseUrl.replace(/^https:/, 'wss:');
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(securityHeaders);
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));
  let hasBuild = false;
  try { await access(path.join(config.distPath, 'index.html')); hasBuild = true; } catch { /* Dev uses Vite on localhost. */ }
  // Caller transport stays invitation-scoped. Workspace access below follows
  // the explicit protected/shared-demo deployment mode.
  if (hasBuild) {
    app.get('/caller', (req, res) => res.sendFile(path.join(config.distPath, 'index.html')));
    app.use('/assets', express.static(path.join(config.distPath, 'assets'), { dotfiles: 'deny', index: false, fallthrough: false }));
    app.get('/favicon.svg', (req, res) => res.sendFile(path.join(config.distPath, 'favicon.svg')));
  }
  app.use('/twilio', createTwilioRouter({ config, calls }));
  // Token-authenticated and read-only, so it sits outside the workspace gate.
  app.use('/api/export', createExportRouter({ config, calls, store, integrations }));
  app.use(createSecurity(config));
  app.use('/api', express.json({ limit: '32kb', strict: true }), createApiRouter({ config, store, providers, calls, broadcast, audioAvailable, callerAccess, sessions, queue, integrations, floorEvent }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (hasBuild) {
    app.use(express.static(config.distPath, { dotfiles: 'deny', index: false, fallthrough: true }));
    app.get(['/', '/desk', '/enroll', '/admin', '/voices', '/floor', '/pill'], (req, res) => res.sendFile(path.join(config.distPath, 'index.html')));
  } else {
    app.get('/', (req, res) => res.type('text/plain').send('NoteFIsh API is running. Start npm run dev:web, or run npm run build to serve the website here.'));
  }
  app.use((req, res) => res.status(404).json({ error: 'Page not found.' }));
  app.use(errorHandler);
  const server = http.createServer({ requestTimeout: 120_000, headersTimeout: 15_000, keepAliveTimeout: 5000, maxHeaderSize: 16 * 1024 }, app);
  const deskWss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const twilioWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  const callerWss = new WebSocketServer({ noServer: true, maxPayload: 4096, perMessageDeflate: false });
  const denyUpgrade = (socket, status = 403) => { socket.write(`HTTP/1.1 ${status} Forbidden\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  server.on('upgrade', (req, socket, head) => {
    if (req.url === '/ws/desk') {
      if (!canAccessDesk(req, config) || !validOrigin(req, config)) return denyUpgrade(socket);
      // Two tabs per seat is ordinary; the cap is on tabs, not on agents.
      if (clients.size >= Math.max(5, config.maxAgents * 2)) return denyUpgrade(socket, 429);
      deskWss.handleUpgrade(req, socket, head, ws => deskWss.emit('connection', ws, req));
    } else if (req.url === '/ws/caller') {
      if (!validOrigin(req, config)) return denyUpgrade(socket);
      if (callerWss.clients.size >= config.maxConcurrentCalls || !callerAccess.allowUpgrade(req.socket.remoteAddress)) return denyUpgrade(socket, 429);
      callerWss.handleUpgrade(req, socket, head, ws => callerWss.emit('connection', ws, req));
    } else if (req.url === '/ws/twilio') {
      if (!validateTwilio(req, config, { websocket: true })) return denyUpgrade(socket);
      if (twilioWss.clients.size >= config.maxConcurrentCalls) return denyUpgrade(socket, 429);
      twilioWss.handleUpgrade(req, socket, head, ws => twilioWss.emit('connection', ws, req));
    } else denyUpgrade(socket, 404);
  });
  // A caller must never be left talking to a closed browser. When the last tab
  // for a seat goes, that seat's live browser calls end after a short grace;
  // unassigned calls follow the floor going dark entirely.
  const scheduleHangup = (key, owns) => {
    clearTimeout(disconnectTimers.get(key));
    if (!calls.snapshot().some(call => call.transport === 'browser' && call.state === 'in_call' && owns(call))) return;
    const timer = setTimeout(() => {
      disconnectTimers.delete(key);
      if (key === '' ? clients.size : [...clients.values()].includes(key)) return;
      for (const call of calls.snapshot()) {
        if (call.transport === 'browser' && call.state === 'in_call' && owns(call)) void calls.end(call.id).catch(() => {});
      }
    }, 10_000);
    timer.unref();
    disconnectTimers.set(key, timer);
  };
  deskWss.on('connection', (ws, req) => {
    const agentId = config.publicDemo ? '' : sessions.read(req);
    clients.set(ws, agentId); ws.isAlive = true;
    if (agentId) { clearTimeout(disconnectTimers.get(agentId)); disconnectTimers.delete(agentId); queue.connect(agentId); floorEvent(); }
    clearTimeout(disconnectTimers.get('')); disconnectTimers.delete('');
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', () => { /* Browser writes cannot inject telephone audio or execute commands. */ });
    ws.on('error', () => {});
    ws.on('close', () => {
      clients.delete(ws);
      if (agentId) {
        queue.disconnect(agentId);
        floorEvent();
        if (![...clients.values()].includes(agentId)) scheduleHangup(agentId, call => call.agentId === agentId);
      }
      if (!clients.size) scheduleHangup('', () => true);
    });
    ws.send(JSON.stringify({
      type: 'snapshot', calls: calls.snapshot(), settings: store.snapshot().settings,
      agents: store.snapshot().agents, floor: queue.snapshot(), agentId,
    }));
  });
  twilioWss.on('connection', (ws, req) => { ws.on('error', () => {}); calls.handleStream(ws, req); });
  callerWss.on('connection', ws => {
    ws.on('error', () => {});
    const reject = message => {
      if (ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify({ type: 'error', error: message })); ws.close(1008, 'Caller access denied'); }
    };
    const timer = setTimeout(() => reject('Caller link verification timed out. Tap Call again.'), 5000);
    timer.unref();
    ws.once('close', () => clearTimeout(timer));
    let joining = false;
    const join = (raw, binary) => {
      if (joining || binary || raw.length > 1024) return reject('Open a valid caller link before starting a call.');
      joining = true;
      void (async () => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { throw new CallerAccessError('Open a valid caller link before starting a call.'); }
        if (!message || typeof message !== 'object' || Array.isArray(message) || Object.keys(message).some(key => !['type', 'token'].includes(key)) || message.type !== 'join') throw new CallerAccessError('Open a valid caller link before starting a call.');
        const { label } = callerAccess.consume(message.token);
        const call = await calls.registerBrowserInbound({ from: label });
        if (ws.readyState !== WebSocket.OPEN) { await calls.end(call.id); return; }
        clearTimeout(timer);
        ws.removeListener('message', join);
        calls.handleBrowserStream(ws, { callId: call.id });
      })().catch(error => reject(error instanceof CallerAccessError || error.name === 'CallError' ? error.message : 'The call could not start. Ask the agent for a new caller link.'));
    };
    ws.on('message', join);
  });
  const heartbeat = setInterval(() => {
    for (const ws of clients.keys()) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  }, 30_000);
  heartbeat.unref();
  const close = async () => {
    clearInterval(heartbeat);
    for (const timer of disconnectTimers.values()) clearTimeout(timer);
    disconnectTimers.clear();
    callerAccess.clear();
    queue.clear();
    await calls.close?.();
    for (const ws of [...clients.keys(), ...twilioWss.clients, ...callerWss.clients]) ws.close(1001, 'Server shutting down');
    await store.flush();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    deskWss.close(); twilioWss.close(); callerWss.close();
  };
  return { app, server, config, store, calls, queue, sessions, integrations, close };
}

async function main() {
  // Explicit project .env wins over unrelated local shell keys, while production
  // always takes its secrets from the hosting environment.
  const production = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  dotenv.config({ path: path.join(root, '.env'), override: !production, quiet: true });
  const runtime = await createRuntime();
  runtime.server.listen(runtime.config.port, runtime.config.host, () => {
    console.log(`NoteFIsh is listening on port ${runtime.config.port}.`);
  });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await runtime.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Config messages name variables only; never print raw provider exceptions.
    console.error(error.message?.startsWith('Invalid ') || error.message?.startsWith('NOTEFISH_') || error.message?.startsWith('PUBLIC_BASE_') || error.message?.startsWith('DATA_DIR') ? error.message : 'NoteFIsh could not start. Check configuration and local data permissions.');
    process.exitCode = 1;
  });
}
