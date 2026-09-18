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
import { createAccounts, createAuthRouter } from './accounts.mjs';
import { createIntegrations } from './integrations/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const execFileAsync = promisify(execFile);

export async function createRuntime({ config = loadConfig(process.env, root), store: suppliedStore, providers: suppliedProviders, calls: suppliedCalls } = {}) {
  const store = suppliedStore || await createStore(config.dataPath, { connectionString: config.databaseUrl });
  if (store.movedFromFile) console.log('Moved the existing desk data into the database.');
  const providers = suppliedProviders || createProviders(config);
  const callerAccess = createCallerAccess(config);
  const accounts = createAccounts(config, store);
  const integrations = createIntegrations({ config });
  // One desk, however many tabs it has open. Everything a call does goes to all of
  // them; there is no longer a seat for an event to be addressed to.
  const clients = new Set();
  let hangupTimer = null;
  const broadcast = event => {
    const payload = JSON.stringify(event);
    for (const client of clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > 1024 * 1024) { client.close(1013, 'Desk connection is too slow'); continue; }
      client.send(payload);
    }
  };
  const calls = suppliedCalls || createCallService({ config, store, providers, broadcast, onComplete: call => integrations.deliver(call) });
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
  // Signing in has to work before being signed in; the pages are public shells whose data is not.
  app.use('/api/auth', express.json({ limit: '8kb', strict: true }), createAuthRouter({ config, accounts }));
  // The marketing site answers on the bare domain; the desk answers on its own
  // subdomain. One service, so there is no second thing to deploy and keep alive.
  const sitePage = name => path.join(root, 'site', `${name}.html`);
  const onSite = req => config.siteHosts.includes(req.hostname);
  // The site's own fonts and scripts. Serving them from here keeps the desk's
  // Content Security Policy strict: nothing inline, nothing from another origin.
  app.use('/site', express.static(path.join(root, 'site'), { dotfiles: 'deny', index: false, extensions: false, fallthrough: true, setHeaders: res => res.setHeader('Cache-Control', 'public, max-age=3600') }));
  app.get('/', (req, res, next) => {
    if (!onSite(req)) return next();
    res.sendFile(sitePage('index'), error => { if (error && !res.headersSent) next(); });
  });
  // The download page and the build it fetches. Public: someone installing the
  // app has no account yet, and the page is the same for everyone.
  app.get('/downloads', (req, res, next) => {
    if (!onSite(req)) return next();
    res.sendFile(sitePage('downloads'), error => { if (error && !res.headersSent) next(); });
  });
  app.get('/api/mac-build', (req, res) => {
    res.json(config.macBuildUrl
      ? { url: config.macBuildUrl, version: config.macBuildVersion || null, file: config.macBuildUrl.split('/').pop() || null }
      : { url: null });
  });
  app.get(['/', '/desk', '/enroll', '/admin', '/voices', '/voice', '/calls', '/calls/:id', '/insights', '/glossary', '/phrases', '/settings', '/join'], (req, res) => res.sendFile(path.join(config.distPath, 'index.html'), error => { if (error && !res.headersSent) res.status(404).end(); }));
  app.use(createSecurity(config, accounts));
  app.use('/api', express.json({ limit: '32kb', strict: true }), createApiRouter({ config, store, providers, calls, broadcast, audioAvailable, callerAccess, accounts, integrations }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (hasBuild) {
    app.use(express.static(config.distPath, { dotfiles: 'deny', index: false, fallthrough: true }));
    app.get(['/', '/desk', '/enroll', '/admin', '/voices', '/voice', '/floor', '/pill', '/calls', '/calls/:id', '/insights', '/glossary', '/phrases', '/settings', '/join'], (req, res) => res.sendFile(path.join(config.distPath, 'index.html')));
  } else {
    app.get('/', (req, res) => res.type('text/plain').send('NoteFish API is running. Start npm run dev:web, or run npm run build to serve the website here.'));
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
      if (!canAccessDesk(req, config, accounts) || !validOrigin(req, config)) return denyUpgrade(socket);
      // Several tabs of one desk is ordinary; the cap is on tabs.
      if (clients.size >= config.maxDeskTabs) return denyUpgrade(socket, 429);
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
  // A caller must never be left talking to a closed browser. When the last tab goes,
  // the live browser calls end after a short grace in case it is only a reload.
  const scheduleHangup = () => {
    clearTimeout(hangupTimer);
    const stranded = () => calls.snapshot().filter(call => call.transport === 'browser' && call.state === 'in_call');
    if (!stranded().length) return;
    hangupTimer = setTimeout(() => {
      hangupTimer = null;
      if (clients.size) return;
      for (const call of stranded()) void calls.end(call.id).catch(() => {});
    }, 10_000);
    hangupTimer.unref();
  };
  deskWss.on('connection', ws => {
    clients.add(ws); ws.isAlive = true;
    clearTimeout(hangupTimer); hangupTimer = null;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', () => { /* Browser writes cannot inject telephone audio or execute commands. */ });
    ws.on('error', () => {});
    ws.on('close', () => { clients.delete(ws); if (!clients.size) scheduleHangup(); });
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
        const { label, via } = callerAccess.consume(message.token);
        const call = await calls.registerBrowserInbound({ from: label, via });
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
    clearTimeout(hangupTimer);
    callerAccess.clear();
    await calls.close?.();
    for (const ws of [...clients, ...twilioWss.clients, ...callerWss.clients]) ws.close(1001, 'Server shutting down');
    await store.flush();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    deskWss.close(); twilioWss.close(); callerWss.close();
  };
  return { app, server, config, store, calls, integrations, close };
}

async function main() {
  // Explicit project .env wins over unrelated local shell keys, while production
  // always takes its secrets from the hosting environment.
  const production = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  dotenv.config({ path: path.join(root, '.env'), override: !production, quiet: true });
  const runtime = await createRuntime();
  runtime.server.listen(runtime.config.port, runtime.config.host, () => {
    console.log(`NoteFish is listening on port ${runtime.config.port}.`);
  });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await runtime.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    // Config messages name variables only; never print raw provider exceptions.
    // A configuration error names a variable and is safe to print; anything else
    // could carry a provider's own words, so it stays generic.
    console.error(['ConfigError', 'StorageError'].includes(error.name) ? error.message : 'NoteFish could not start. Check configuration and local data permissions.');
    process.exitCode = 1;
  });
}
