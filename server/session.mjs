import { createHmac, randomBytes } from 'node:crypto';
import { constantTimeEqual } from './security.mjs';

const COOKIE = 'notefish_agent';
const TTL_MS = 12 * 60 * 60 * 1000;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reads one cookie without adding a parser dependency. */
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

/**
 * Desk sessions identify WHICH agent a browser is acting as. They are presence,
 * not authentication: anyone who can already reach the workspace can claim any
 * roster entry. Workspace access itself stays with security.mjs. The signed
 * payload is deliberately just an id, so an OIDC subject can replace the roster
 * id later without touching routing.
 */
export function createSessions(config, { now = Date.now, ttlMs = TTL_MS } = {}) {
  // An absent secret means sessions last only as long as this process. That is
  // correct for a single-instance demo and is reported through /api/session.
  const secret = config.sessionSecret || randomBytes(32).toString('hex');
  const ephemeral = !config.sessionSecret;
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url');
  return {
    ephemeral,
    issue(agentId) {
      if (typeof agentId !== 'string' || !ID.test(agentId)) throw new Error('Invalid agent id');
      const payload = `${agentId}.${now()}`;
      return `${payload}.${sign(payload)}`;
    },
    verify(token) {
      if (typeof token !== 'string' || token.length > 512) return '';
      const parts = token.split('.');
      if (parts.length !== 3) return '';
      const [agentId, issuedText, signature] = parts;
      if (!ID.test(agentId) || !/^\d{1,15}$/.test(issuedText)) return '';
      if (!constantTimeEqual(signature, sign(`${agentId}.${issuedText}`))) return '';
      if (now() - Number(issuedText) > ttlMs) return '';
      return agentId;
    },
    read(req) {
      return this.verify(readCookie(req.headers?.cookie, COOKIE));
    },
    cookie(agentId) {
      const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(ttlMs / 1000)}`];
      if (config.production) flags.push('Secure');
      return `${COOKIE}=${this.issue(agentId)}; ${flags.join('; ')}`;
    },
    clearCookie() {
      const flags = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
      if (config.production) flags.push('Secure');
      return `${COOKIE}=; ${flags.join('; ')}`;
    },
  };
}
