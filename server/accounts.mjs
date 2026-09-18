// Accounts: who may open the desk. A user is a name, an email and a scrypt-hashed
// password in the store; a signed cookie says which user a browser is. Seats
// The desk belongs to whoever set it up, and stays theirs: there is no seat to take
// and no reason to sign out again.
import express from 'express';
import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { constantTimeEqual, isLocalRequest, validOrigin } from './security.mjs';

const COOKIE = 'notefish_user';
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const MAX_USERS = 500;
const ID = /^[0-9a-f-]{36}$/;
const INVITE_TTL = 7 * 24 * 60 * 60 * 1000;
// admin runs the desk; supervisor watches the floor and keeps the glossary; agent answers calls with their own seat and voice.
export const ROLES = ['admin', 'supervisor', 'agent'];

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

const publicUser = user => user ? { id: user.id, name: user.name, email: user.email, role: user.role || 'admin', createdAt: user.createdAt } : null; // accounts from before roles ran the desk

/** One cookie out of a Cookie header, bounded so a huge header cannot be walked. */
export function readCookie(header, name) {
  if (typeof header !== 'string' || header.length > 4096) return '';
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value.length <= 512 ? value : '';
  }
  return '';
}

export function createAccounts(config, store, { now = Date.now } = {}) {
  // The cookie secret: the configured one, else one minted once and kept in the store,
  // so sign-ins survive a restart even without NOTEFISH_SESSION_SECRET.
  const secret = () => config.sessionSecret || store.snapshot().authSecret || '';
  const ensureSecret = async () => { if (!secret()) await store.update(state => { state.authSecret ||= randomBytes(32).toString('hex'); }); };
  const sign = payload => createHmac('sha256', secret()).update(payload).digest('base64url');
  const users = () => store.snapshot().users || [];
  const failures = new Map(); // ip → { count, until }

  const hasAdmin = () => users().some(user => (user.role || 'admin') === 'admin');
  const roleOf = id => { const user = users().find(item => item.id === id); return user ? user.role || 'admin' : ''; };

  return {
    hasAdmin,
    roleOf,
    count: () => users().length,
    find: id => publicUser(users().find(user => user.id === id)),
    list: () => users().map(publicUser),
    async setRole(id, role) {
      if (!ROLES.includes(role)) throw new AuthError('Choose admin, supervisor or agent.');
      const user = await store.update(state => {
        const item = state.users.find(user => user.id === id);
        if (!item) throw new AuthError('Account not found.', 404);
        if ((item.role || 'admin') === 'admin' && role !== 'admin' && !state.users.some(other => other.id !== id && (other.role || 'admin') === 'admin')) throw new AuthError('The desk needs at least one admin.', 409);
        item.role = role; return item;
      });
      return publicUser(user);
    },
    // Offboarding: the account goes, its seats are freed for the next person. Their voices are the caller's job (routes), done before this.
    async remove(id) {
      const user = await store.update(state => {
        const item = state.users.find(user => user.id === id);
        if (!item) throw new AuthError('Account not found.', 404);
        if ((item.role || 'admin') === 'admin' && !state.users.some(other => other.id !== id && (other.role || 'admin') === 'admin')) throw new AuthError('The desk needs at least one admin.', 409);
        state.users = state.users.filter(user => user.id !== id);
        return item;
      });
      return publicUser(user);
    },
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
    async signUp({ name, email, password, role = 'agent' }) {
      name = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 100) : '';
      email = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!name) throw new AuthError('Tell us your name.');
      if (!EMAIL.test(email)) throw new AuthError('That email address does not look right.');
      if (typeof password !== 'string' || password.length < 10 || password.length > 200) throw new AuthError('Use a password of at least 10 characters.');
      await ensureSecret();
      if (!ROLES.includes(role)) throw new AuthError('Choose admin, supervisor or agent.');
      const user = { id: randomUUID(), name, email, role, passwordHash: hashPassword(password), createdAt: new Date(now()).toISOString() };
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
  constructor(message, status = 400) { super(message); this.name = 'AuthError'; this.status = status; }
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
    // open: nobody has set this desk up yet, so signing up claims it. After that the
    // desk belongs to that person and signing up again is refused.
    res.json({ user: id ? accounts.find(id) : null, users: accounts.count(), open: !accounts.hasAdmin(), local: isLocalRequest(req), google: false });
  });
  router.post('/signup', async (req, res, next) => {
    try {
      const body = { ...(req.body || {}) };
      if (accounts.hasAdmin()) throw new AuthError('This desk already belongs to someone. Sign in instead.', 403);
      if (config.adminEmail && String(body.email || '').trim().toLowerCase() !== config.adminEmail) throw new AuthError('This desk is waiting for the person who set it up.', 403);
      const user = await accounts.signUp({ ...body, role: 'admin' });
      res.set('Set-Cookie', accounts.cookie(user.id)).status(201).json({ user });
    } catch (error) { next(error); }
  });
  router.post('/signin', async (req, res, next) => {
    try {
      const user = await accounts.signIn(req.body || {}, req.socket?.remoteAddress || '');
      res.set('Set-Cookie', accounts.cookie(user.id)).json({ user });
    } catch (error) { next(error); }
  });
  // Signing out on purpose is gone: you set this desk up once and it stays yours. The
  // route stays so an old tab calling it is answered rather than left hanging.
  router.post('/signout', (req, res) => res.set('Set-Cookie', accounts.clearCookie()).status(204).end());
  router.use((error, req, res, next) => {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message, code: 'AUTH' });
    next(error);
  });
  return router;
}
