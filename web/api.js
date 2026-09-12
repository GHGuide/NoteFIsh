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
  bootstrap: async () => { const [setup, voices, settings, calls] = await Promise.all([request('/status'), request('/voices?archived=true'), request('/settings'), request('/calls')]); return { setup, ...voices, ...settings, ...calls }; },
  voices: () => request('/voices?archived=true'),
  availableVoices: () => request('/voices/available'),
  createVoice: (body) => request('/voices/clone', { method: 'POST', body }),
  importVoice: (body) => request('/voices/import', { method: 'POST', body: JSON.stringify(body) }),
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
  say: (id, text) => request(`/calls/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),
  ptt: (id, blob) => { const body = new FormData(); body.append('audio', blob, `reply.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`); return request(`/calls/${encodeURIComponent(id)}/reply`, { method: 'POST', body }); },
  ticket: (id, body) => request(`/calls/${encodeURIComponent(id)}/ticket`, { method: 'PATCH', body: JSON.stringify(body) }),
};
