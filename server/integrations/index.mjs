import { createWebhookAdapter } from './webhook.mjs';
import { createZendeskAdapter } from './zendesk.mjs';

const RETRY_MS = [1000, 5000, 20000];

/**
 * Outbound only. A completed call leaves NoteFish as a ticket somewhere else;
 * nothing an adapter returns re-enters the call path. `deliver(call)` is the
 * whole interface, so a new destination is one file and one line here.
 */
export function createIntegrations({ config, fetchImpl = globalThis.fetch, retryMs = RETRY_MS, wait = ms => new Promise(resolve => setTimeout(resolve, ms).unref?.()) }) {
  const adapters = [];
  if (config.webhookUrl) adapters.push(createWebhookAdapter({ config, fetchImpl }));
  if (config.zendeskSubdomain) adapters.push(createZendeskAdapter({ config, fetchImpl }));
  const history = [];

  const record = entry => {
    history.unshift({ ...entry, at: new Date().toISOString() });
    if (history.length > 100) history.length = 100;
  };

  /** The call the outside world sees. Nothing here is provider configuration. */
  function payload(call) {
    return {
      id: call.id, callSid: call.callSid, transport: call.transport,
      from: call.from, queue: call.queueName || null,
      agent: call.agentId ? { id: call.agentId, name: call.agentName || '' } : null,
      agentLanguage: call.agentLanguage, customerLanguage: call.customerLanguage,
      startedAt: call.startedAt, answeredAt: call.answeredAt, endedAt: call.endedAt,
      ticket: call.ticket,
      transcript: (call.transcript || []).map(line => ({
        at: line.t, speaker: line.speaker, sourceLang: line.sourceLang,
        targetLang: line.targetLang || null, textSource: line.textSource, textShown: line.textShown,
      })),
    };
  }

  async function deliverTo(adapter, body) {
    let lastError = 'delivery failed';
    for (let attempt = 0; attempt <= retryMs.length; attempt++) {
      try {
        const result = await adapter.deliver(body);
        record({ adapter: adapter.name, callId: body.id, ok: true, reference: result?.reference || '', attempts: attempt + 1 });
        return true;
      } catch (error) {
        lastError = error?.message || 'delivery failed';
        // A 4xx will not become a 2xx by repeating it.
        if (error?.permanent) break;
        if (attempt < retryMs.length) await wait(retryMs[attempt]);
      }
    }
    record({ adapter: adapter.name, callId: body.id, ok: false, error: lastError.slice(0, 300) });
    return false;
  }

  return {
    enabled: adapters.length > 0,
    names: adapters.map(adapter => adapter.name),
    history: () => history.slice(0, 20),
    payload,
    async deliver(call) {
      if (!adapters.length || !call || call.state !== 'ended') return [];
      const body = payload(call);
      return Promise.all(adapters.map(adapter => deliverTo(adapter, body)));
    },
  };
}
