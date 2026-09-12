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
import { createSecurity, securityHeaders, isAuthenticated, validOrigin, validateTwilio } from './security.mjs';
import { createApiRouter, createTwilioRouter, errorHandler } from './routes.mjs';
import { createCallerAccess, CallerAccessError } from './caller-access.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

export async function createRuntime({ config = loadConfig(process.env, root), store: suppliedStore, providers: suppliedProviders, calls: suppliedCalls } = {}) {
  const store = suppliedStore || await createStore(config.dataPath);
  const providers = suppliedProviders || createProviders(config);
  const callerAccess = createCallerAccess(config);
  const clients = new Set();
  let deskDisconnectTimer;
  const broadcast = event => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > 1024 * 1024) { client.close(1013, 'Desk connection is too slow'); continue; }
      client.send(payload);
    }
  };
  const calls = suppliedCalls || createCallService({ config, store, providers, broadcast });
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
  // The caller can load only its page and public build assets without desk login.
  // No API, voice list, ticket, transcript, or provider configuration is public.
  if (hasBuild) {
    app.get('/caller', (req, res) => res.sendFile(path.join(config.distPath, 'index.html')));
    app.use('/assets', express.static(path.join(config.distPath, 'assets'), { dotfiles: 'deny', index: false, fallthrough: false }));
    app.get('/favicon.svg', (req, res) => res.sendFile(path.join(config.distPath, 'favicon.svg')));
  }
  app.use('/twilio', createTwilioRouter({ config, calls }));
  app.use(createSecurity(config));
  app.use('/api', express.json({ limit: '32kb', strict: true }), createApiRouter({ config, store, providers, calls, broadcast, audioAvailable, callerAccess }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (hasBuild) {
    app.use(express.static(config.distPath, { dotfiles: 'deny', index: false, fallthrough: true }));
    app.get(['/', '/desk', '/enroll', '/admin', '/voices'], (req, res) => res.sendFile(path.join(config.distPath, 'index.html')));
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
      if (!isAuthenticated(req, config) || !validOrigin(req, config)) return denyUpgrade(socket);
      if (clients.size >= 5) return denyUpgrade(socket, 429);
      deskWss.handleUpgrade(req, socket, head, ws => deskWss.emit('connection', ws, req));
    } else if (req.url === '/ws/caller') {
      if (!validOrigin(req, config)) return denyUpgrade(socket);
      if (callerWss.clients.size >= 4 || !callerAccess.allowUpgrade(req.socket.remoteAddress)) return denyUpgrade(socket, 429);
      callerWss.handleUpgrade(req, socket, head, ws => callerWss.emit('connection', ws, req));
    } else if (req.url === '/ws/twilio') {
      if (!validateTwilio(req, config, { websocket: true })) return denyUpgrade(socket);
      if (twilioWss.clients.size >= 2) return denyUpgrade(socket, 429);
      twilioWss.handleUpgrade(req, socket, head, ws => twilioWss.emit('connection', ws, req));
    } else denyUpgrade(socket, 404);
  });
  deskWss.on('connection', ws => {
    clearTimeout(deskDisconnectTimer);
    clients.add(ws); ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', () => { /* Browser writes cannot inject telephone audio or execute commands. */ });
    ws.on('error', () => {});
    ws.on('close', () => {
      clients.delete(ws);
      if (clients.size || !calls.snapshot().some(call => call.transport === 'browser' && call.state === 'in_call')) return;
      clearTimeout(deskDisconnectTimer);
      deskDisconnectTimer = setTimeout(() => {
        if (clients.size) return;
        for (const call of calls.snapshot()) if (call.transport === 'browser' && call.state === 'in_call') void calls.end(call.id).catch(() => {});
      }, 10_000);
      deskDisconnectTimer.unref();
    });
    ws.send(JSON.stringify({ type: 'snapshot', calls: calls.snapshot(), settings: store.snapshot().settings }));
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
        callerAccess.consume(message.token);
        const call = await calls.registerBrowserInbound();
        if (ws.readyState !== WebSocket.OPEN) { await calls.end(call.id); return; }
        clearTimeout(timer);
        ws.removeListener('message', join);
        calls.handleBrowserStream(ws, { callId: call.id });
      })().catch(error => reject(error instanceof CallerAccessError || error.name === 'CallError' ? error.message : 'The call could not start. Ask the agent for a new caller link.'));
    };
    ws.on('message', join);
  });
  const heartbeat = setInterval(() => {
    for (const ws of clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); }
  }, 30_000);
  heartbeat.unref();
  const close = async () => {
    clearInterval(heartbeat);
    clearTimeout(deskDisconnectTimer);
    callerAccess.clear();
    await calls.close?.();
    for (const ws of [...clients, ...twilioWss.clients, ...callerWss.clients]) ws.close(1001, 'Server shutting down');
    await store.flush();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    deskWss.close(); twilioWss.close(); callerWss.close();
  };
  return { app, server, config, store, calls, close };
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
