/**
 * Presence and the queue view.
 *
 * Routing is deliberately "ring every available agent, first to answer wins".
 * A room of five to twenty seats does not need fairness bookkeeping, and the
 * winner is decided by the call service's own assignment guard, so this module
 * never has to hold a lock. Longest-idle routing can replace pickOrder() later
 * without touching anything else.
 */
export function createQueue({ store, calls, now = Date.now }) {
  const presence = new Map();

  const entry = agentId => {
    let value = presence.get(agentId);
    if (!value) { value = { sockets: 0, paused: false, reason: '', since: now() }; presence.set(agentId, value); }
    return value;
  };
  const roster = () => (store.snapshot().agents || []).filter(agent => !agent.archived);
  const liveCalls = () => calls.snapshot().filter(call => ['ringing', 'in_call'].includes(call.state));

  function agents() {
    const active = liveCalls();
    return roster().map(agent => {
      const value = presence.get(agent.id);
      const call = active.find(item => item.agentId === agent.id && item.state === 'in_call');
      const online = Boolean(value?.sockets);
      return {
        id: agent.id, name: agent.name, online,
        paused: Boolean(value?.paused), pauseReason: value?.reason || '',
        callId: call?.id || null,
        state: !online ? 'offline' : call ? 'on_call' : value?.paused ? 'paused' : 'available',
        since: value?.since || null,
      };
    });
  }

  return {
    connect(agentId) { const value = entry(agentId); value.sockets += 1; if (value.sockets === 1) value.since = now(); },
    disconnect(agentId) {
      const value = presence.get(agentId);
      if (!value) return;
      value.sockets = Math.max(0, value.sockets - 1);
      if (!value.sockets) { value.paused = false; value.reason = ''; value.since = now(); }
    },
    pause(agentId, reason = '') { const value = entry(agentId); value.paused = true; value.reason = reason; value.since = now(); },
    resume(agentId) { const value = entry(agentId); value.paused = false; value.reason = ''; value.since = now(); },
    agents,
    /** Agents a ringing call should be offered to. */
    pickOrder() { return agents().filter(agent => agent.state === 'available').map(agent => agent.id); },
    busy(agentId) { return liveCalls().some(call => call.agentId === agentId && call.state === 'in_call'); },
    snapshot() {
      const active = liveCalls();
      const waiting = active
        .filter(call => call.state === 'ringing')
        .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
        .map((call, index) => ({ id: call.id, from: call.from, transport: call.transport, startedAt: call.startedAt, position: index + 1 }));
      return { waiting, agents: agents() };
    },
    /** Queue position a waiting caller is told about. 0 means "not waiting". */
    positionOf(callId) {
      const waiting = this.snapshot().waiting;
      const found = waiting.find(call => call.id === callId);
      return found ? found.position : 0;
    },
    clear() { presence.clear(); },
  };
}
