import { timingSafeEqual } from 'node:crypto';
import twilio from 'twilio';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const FORWARD_HEADERS = ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'cf-connecting-ip', 'true-client-ip'];

export function isLocalRequest(req) {
  if (!LOOPBACK.has(req.socket?.remoteAddress) || FORWARD_HEADERS.some(key => req.headers[key])) return false;
  const host = req.headers.host;
  if (typeof host !== 'string' || host.length > 128) return false;
  return /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(host);
}

export function constantTimeEqual(candidate, expected) {
  if (typeof candidate !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(candidate), b = Buffer.from(expected);
  if (a.length > 1024 || b.length > 1024) return false;
  const paddedA = Buffer.alloc(1028), paddedB = Buffer.alloc(1028);
  paddedA.writeUInt32BE(a.length); paddedB.writeUInt32BE(b.length);
  a.copy(paddedA, 4); b.copy(paddedB, 4);
  return timingSafeEqual(paddedA, paddedB);
}

export function isAuthenticated(req, config) {
  if (!config.production && isLocalRequest(req)) return true;
  if (!config.deskPassword || !config.publicBaseUrl) return false;
  const header = req.headers.authorization;
  if (typeof header !== 'string' || header.length > 1600 || !/^Basic [A-Za-z0-9+/]+=*$/.test(header)) return false;
  const credentials = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const colon = credentials.indexOf(':');
  if (colon < 0) return false;
  return constantTimeEqual(credentials.slice(0, colon), 'desk') && constantTimeEqual(credentials.slice(colon + 1), config.deskPassword);
}

// Shared demo access is an explicit deployment choice. It grants workspace
// access without pretending that an anonymous visitor authenticated.
export function canAccessDesk(req, config, accounts = null) {
  return (config.publicDemo === true && Boolean(config.publicBaseUrl)) || isAuthenticated(req, config) || Boolean(accounts?.read(req));
}

export function validOrigin(req, config) {
  const value = req.headers.origin;
  if (typeof value !== 'string' || value.length > 2048) return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (url.origin !== value || url.username || url.password) return false;
  if (config.publicBaseUrl && value === config.publicBaseUrl) return true;
  return !config.production && isLocalRequest(req) && ['http:', 'https:'].includes(url.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

export function securityHeaders(req, res, next) {
  const websocketOrigin = req.app?.locals.publicSocketOrigin || '';
  res.set({
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'microphone=(self), camera=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ${websocketOrigin} ws://localhost:* ws://127.0.0.1:*; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
    'Cache-Control': 'no-store',
  });
  next();
}

export function createSecurity(config, accounts = null) {
  const attempts = new Map();
  let requests = 0;
  return function protect(req, res, next) {
    const now = Date.now();
    if (++requests % 100 === 0) for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
    const ip = req.socket.remoteAddress || 'unknown';
    const attempt = attempts.get(ip);
    if (attempt?.until > now && attempt.count >= 20) return res.status(429).json({ error: 'Too many sign-in attempts. Try again in one minute.', code: 'AUTH_RATE_LIMIT' });
    if (!canAccessDesk(req, config, accounts)) {
      if (attempt?.until > now) attempt.count++; else attempts.set(ip, { count: 1, until: now + 60_000 });
      // Accounts are a way in of their own: a deployment with no desk password is
      // signed in to, not misconfigured.
      if (accounts) return res.status(401).json({ error: 'Sign in to use the desk.', code: 'AUTH_REQUIRED' });
      if (!config.deskPassword || !config.publicBaseUrl) return res.status(503).json({ error: 'Public desk access requires PUBLIC_BASE_URL and NOTEFISH_DESK_PASSWORD on the server.', code: 'PUBLIC_ACCESS_UNCONFIGURED' });
      res.set('WWW-Authenticate', 'Basic realm="NoteFish desk", charset="UTF-8"');
      return res.status(401).json({ error: 'Sign in with username desk and the configured desk password.', code: 'AUTH_REQUIRED' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !validOrigin(req, config)) return res.status(403).json({ error: 'This action must originate from the NoteFish website.', code: 'INVALID_ORIGIN' });
    next();
  };
}

export function validateTwilio(req, config, { websocket = false } = {}) {
  // The signature is what authenticates Twilio. Workspace access mode is a
  // separate concern, so a shared demo can still take real phone calls.
  if (!config.twilioAuthToken || !config.publicBaseUrl) return false;
  const signature = req.headers['x-twilio-signature'];
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{27}=$/.test(signature)) return false;
  const route = websocket ? '/ws/twilio' : req.path;
  if (!['/twilio/incoming', '/twilio/status', '/ws/twilio'].includes(route) || req.url?.includes('?')) return false;
  const params = websocket ? {} : req.body;
  if (!params || typeof params !== 'object' || Array.isArray(params) || Object.values(params).some(value => typeof value !== 'string')) return false;
  const baseUrl = websocket ? config.publicBaseUrl.replace(/^https:/, 'wss:') : config.publicBaseUrl;
  const urls = [`${baseUrl}${route}`];
  // Twilio documents a trailing slash variation for Voice WSS handshakes.
  if (websocket) urls.push(`${baseUrl}${route}/`);
  return urls.some(url => twilio.validateRequest(config.twilioAuthToken, signature, url, params));
}
