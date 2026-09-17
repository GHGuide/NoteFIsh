async function request(path, options = {}) {
  const headers = options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' };
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers: { ...headers, ...options.headers } });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { const body = await response.json(); message = typeof body.error === 'string' ? body.error : body.error?.message || body.message || message; } catch {}
    throw new Error(message);
  }
  if (options.audio) return response.blob();
  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  bootstrap: async () => { const [setup, voices, settings, calls, agents, session] = await Promise.all([request('/status'), request('/voices?archived=true'), request('/settings'), request('/calls'), request('/agents'), request('/session')]); return { setup, ...voices, ...settings, ...calls, agents: agents.agents, floor: agents.floor, agentId: agents.agentId, session }; },
  agents: () => request('/agents'),
  createAgent: (body) => request('/agents', { method: 'POST', body: JSON.stringify(body) }),
  editAgent: (id, body) => request(`/agents/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  removeAgent: (id) => request(`/agents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  takeSeat: (id) => request(`/agents/${encodeURIComponent(id)}/session`, { method: 'POST', body: '{}' }),
  leaveSeat: () => request('/agents/session', { method: 'DELETE' }),
  pause: (reason) => request('/agents/session/pause', { method: 'POST', body: JSON.stringify({ reason }) }),
  resume: () => request('/agents/session/resume', { method: 'POST', body: '{}' }),
  floor: () => request('/floor'),
  integrations: () => request('/integrations'),
  session: () => request('/session'),
  voices: () => request('/voices?archived=true'),
  availableVoices: () => request('/voices/available'),
  createVoice: (body) => request('/voices/clone', { method: 'POST', body }),
  importVoice: (body) => request('/voices/import', { method: 'POST', body: JSON.stringify(body) }),
  importPack: (body) => request('/voices/import-pack', { method: 'POST', body: JSON.stringify(body) }),
  exportVoice: (id) => request(`/voices/${encodeURIComponent(id)}/export`),
  exportVoices: () => request('/voices/export'),
  editVoice: (id, body) => request(`/voices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  archiveVoice: (id) => request(`/voices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) }),
  refreshVoice: (id, options = {}) => request(`/voices/${encodeURIComponent(id)}/refresh`, { method: 'POST', signal: options.signal }),
  previewVoice: (id, body) => request(`/voices/${encodeURIComponent(id)}/preview`, { method: 'POST', body: JSON.stringify(body), audio: true }),
  settings: (body) => request('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  setup: () => request('/status'),
  createInvitation: () => request('/caller-invitations', { method: 'POST', body: '{}' }),
  answer: (id) => request(`/calls/${encodeURIComponent(id)}/answer`, { method: 'POST' }),
  end: (id) => request(`/calls/${encodeURIComponent(id)}/end`, { method: 'POST' }),
  stop: (id) => request(`/calls/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  updateCall: (id, body) => request(`/calls/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  say: (id, text, feeling) => request(`/calls/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ text, ...(feeling && feeling !== 'auto' ? { feeling } : {}) }) }),
  ptt: (id, blob, feeling) => { const body = new FormData(); body.append('audio', blob, `reply.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`); if (feeling && feeling !== 'auto') body.append('feeling', feeling); return request(`/calls/${encodeURIComponent(id)}/reply`, { method: 'POST', body }); },
  ticket: (id, body) => request(`/calls/${encodeURIComponent(id)}/ticket`, { method: 'PATCH', body: JSON.stringify(body) }),
  ask: (body, signal) => request('/ask', { method: 'POST', body: JSON.stringify(body), signal }),
  tryLine: (body) => request('/try', { method: 'POST', body: JSON.stringify(body) }),
  tryClip: (blob) => { const body = new FormData(); body.append('audio', blob, `try.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`); return request('/try', { method: 'POST', body }); },
  me: () => request('/auth/me'),
  users: () => request('/users'),
  setRole: (id, role) => request(`/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeUser: (id) => request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteVoice: (id) => request(`/voices/${encodeURIComponent(id)}?permanent=true`, { method: 'DELETE' }),
  invite: (token) => request(`/auth/invite/${encodeURIComponent(token)}`),
  reinvite: (id) => request(`/agents/${encodeURIComponent(id)}/invite`, { method: 'POST', body: '{}' }),
  signUp: (body) => request('/auth/signup', { method: 'POST', body: JSON.stringify(body) }),
  signIn: (body) => request('/auth/signin', { method: 'POST', body: JSON.stringify(body) }),
  signOut: () => request('/auth/signout', { method: 'POST' }),
};
