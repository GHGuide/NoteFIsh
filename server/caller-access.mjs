import { randomUUID } from 'node:crypto';
import { constantTimeEqual } from './security.mjs';

const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class CallerAccessError extends Error {
  constructor(message, status = 403) { super(message); this.name = 'CallerAccessError'; this.status = status; }
}

/** Ephemeral, one-use caller capabilities. Tokens stay in fragments and WS frames,
 * never request URLs, logs, persisted call records, or desk snapshots. */
export function createCallerAccess(config, { now = Date.now, lifetimeMs = 10 * 60_000 } = {}) {
  if (!Number.isInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > 10 * 60_000) throw new Error('Invalid caller invitation lifetime');
  const invitations = new Set();
  const attempts = new Map();
  const prune = () => { for (const invitation of invitations) if (invitation.expires <= now()) invitations.delete(invitation); };
  return {
    issue({ label = '', local = false } = {}) {
      // A phone link needs the public HTTPS address; the companion joins from this machine and only needs the token.
      if (!local && (!config.publicBaseUrl || (!config.deskPassword && !config.publicDemo))) throw new CallerAccessError('Configure the public HTTPS address and workspace access before creating a caller link.', 503);
      prune();
      if (invitations.size >= 8) throw new CallerAccessError('There are already eight active caller links. Use an existing link or wait ten minutes.', 429);
      // Existing Node randomUUID supplies independent cryptographically random IDs;
      // together these contain 244 random bits, with no custom crypto algorithm.
      const clean = typeof label === 'string' ? label.replace(/[^\p{L}\p{N} .,'’·()+-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '';
      const invitation = { token: `${randomUUID()}.${randomUUID()}`, expires: now() + lifetimeMs, label: clean, via: local ? 'companion' : 'link' };
      invitations.add(invitation);
      return { ...(config.publicBaseUrl ? { url: `${config.publicBaseUrl}/caller#${invitation.token}` } : {}), ...(local ? { token: invitation.token } : {}), expiresAt: new Date(invitation.expires).toISOString(), ...(clean ? { label: clean } : {}) };
    },
    consume(token) {
      if (typeof token !== 'string' || !TOKEN.test(token)) throw new CallerAccessError('This caller link is invalid, expired, or already used. Ask the person at the desk for a new one.');
      prune();
      let matched;
      for (const invitation of invitations) if (constantTimeEqual(token, invitation.token)) matched = invitation;
      if (!matched) throw new CallerAccessError('This caller link is invalid, expired, or already used. Ask the person at the desk for a new one.');
      invitations.delete(matched);
      return { label: matched.label || '', via: matched.via || 'link' };
    },
    allowUpgrade(address) {
      const current = now();
      for (const [key, attempt] of attempts) if (attempt.until <= current) attempts.delete(key);
      const key = typeof address === 'string' && address.length <= 100 ? address : 'unknown';
      const attempt = attempts.get(key);
      if (!attempt && attempts.size >= 1000) return false;
      if (attempt) { attempt.count++; return attempt.count <= 30; }
      attempts.set(key, { count: 1, until: current + 60_000 });
      return true;
    },
    clear() { invitations.clear(); attempts.clear(); },
  };
}
