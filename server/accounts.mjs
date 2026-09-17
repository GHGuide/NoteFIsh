// Accounts: who may open the desk. A user is a name, an email and a scrypt-hashed
// password in the store; a signed cookie says which user a browser is. Seats
// (session.mjs) stay what they were: which roster entry a signed-in desk answers as.
import express from 'express';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { constantTimeEqual, isLocalRequest, validOrigin } from './security.mjs';
import { readCookie } from './session.mjs';

const COOKIE = 'notefish_user';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const MAX_USERS = 500;
const ID = /^[0-9a-f-]{36}$/;

export function hashPassword(password) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
// Compared against when the email is unknown, so a miss costs the same time as a wrong password.
const DECOY = hashPassword(randomBytes(12).toString('hex'));

const publicUser = user => user ? { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt } : null;

export function createAccounts(config, store, { now = Date.now } = {}) {
  // The cookie secret: the configured one, else one minted once and kept in the store,
  // so sign-ins survive a restart even without NOTEFISH_SESSION_SECRET.
  const secret = () => config.sessionSecret || store.snapshot().authSecret || '';
  const ensureSecret = async () => { if (!secret()) await store.update(state => { state.authSecret ||= randomBytes(32).toString('hex'); }); };
  const sign = payload => createHmac('sha256', secret()).update(payload).digest('base64url');
  const users = () => store.snapshot().users || [];
  const failures = new Map(); // ip → { count, until }

  return {
    count: () => users().length,
    find: id => publicUser(users().find(user => user.id === id)),
    read(req) {
      const token = readCookie(req.headers?.cookie, COOKIE);
      if (!token || token.length > 512 || !secret()) return '';
      const parts = token.split('.');
      if (parts.length !== 3) return '';
      const [id, issuedText, signature] = parts;
      if (!ID.test(id) || !/^\d{1,15}$/.test(issuedText)) return '';
      if (!constantTimeEqual(signature, sign(`${id}.${issuedText}`))) return '';
      if (now() - Number(issuedText) > TTL_MS) return '';
      return users().some(user => user.id === id) ? id : '';
    },
    cookie(id) {
      const payload = `${id}.${now()}`;
      const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(TTL_MS / 1000)}`];
      if (config.production) flags.push('Secure');
      return `${COOKIE}=${payload}.${sign(payload)}; ${flags.join('; ')}`;
    },
    clearCookie() {
      const flags = ['Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
      if (config.production) flags.push('Secure');
      return `${COOKIE}=; ${flags.join('; ')}`;
    },
    async signUp({ name, email, password }) {
      name = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
      email = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!name) throw new AuthError('Tell us your name.');
      if (!EMAIL.test(email)) throw new AuthError('That email address does not look right.');
      if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new AuthError('Use a password of at least 10 characters.');
      await ensureSecret();
      const user = { id: randomUUID(), name, email, passwordHash: hashPassword(password), createdAt: new Date(now()).toISOString() };
      await store.update(state => {
        state.users ||= [];
        if (state.users.length >= MAX_USERS) throw new AuthError('This desk has all the accounts it can hold.', 409);
        if (state.users.some(item => item.email === email)) throw new AuthError('There is already an account with that email. Sign in instead.', 409);
        state.users.push(user);
      });
      return publicUser(user);
    },
    async signIn({ email, password }, ip = '') {
      const attempt = failures.get(ip);
      if (attempt && attempt.until > now() && attempt.count >= 10) throw new AuthError('Too many attempts. Try again in a minute.', 429);
      email = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const user = users().find(item => item.email === email);
      const ok = typeof password === 'string' && password.length <= 200 && verifyPassword(password, user ? user.passwordHash : DECOY) && !!user;
      if (!ok) {
        if (attempt && attempt.until > now()) attempt.count++; else failures.set(ip, { count: 1, until: now() + 60_000 });
        throw new AuthError('That email and password do not match.', 401);
      }
      failures.delete(ip);
      await ensureSecret();
      return publicUser(user);
    },
  };
}

export class AuthError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** /api/auth: reachable without being signed in, which is the point. */
export function createAuthRouter({ config, accounts }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !validOrigin(req, config)) return res.status(403).json({ error: 'This action must originate from the NoteFish website.', code: 'INVALID_ORIGIN' });
    next();
  });
  router.get('/me', (req, res) => {
    const id = accounts.read(req);
    res.json({ user: id ? accounts.find(id) : null, users: accounts.count(), local: isLocalRequest(req), google: false });
  });
  router.post('/signup', async (req, res, next) => {
    try {
      const user = await accounts.signUp(req.body || {});
      res.set('Set-Cookie', accounts.cookie(user.id)).status(201).json({ user });
    } catch (error) { next(error); }
  });
  router.post('/signin', async (req, res, next) => {
    try {
      const user = await accounts.signIn(req.body || {}, req.socket?.remoteAddress || '');
      res.set('Set-Cookie', accounts.cookie(user.id)).json({ user });
    } catch (error) { next(error); }
  });
  router.post('/signout', (req, res) => res.set('Set-Cookie', accounts.clearCookie()).status(204).end());
  router.use((error, req, res, next) => {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message, code: 'AUTH' });
    next(error);
  });
  return router;
}
