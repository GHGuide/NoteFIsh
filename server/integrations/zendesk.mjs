import { DeliveryError } from './webhook.mjs';

const line = entry => `[${entry.at}] ${entry.speaker === 'agent' ? 'Agent' : 'Caller'} (${entry.sourceLang}): ${entry.textSource}${entry.textShown && entry.textShown !== entry.textSource ? `\n    → ${entry.textShown}` : ''}`;

/**
 * One worked adapter, so the interface is proven against a real API shape
 * rather than only against itself. Zendesk stays the system of record; NoteFish
 * creates the ticket and forgets it.
 */
export function createZendeskAdapter({ config, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  const auth = Buffer.from(`${config.zendeskEmail}/token:${config.zendeskApiToken}`).toString('base64');
  return {
    name: 'zendesk',
    async deliver(body) {
      const transcript = body.transcript.map(line).join('\n');
      const ticket = {
        ticket: {
          subject: `Call from ${body.from}${body.agent?.name ? ` — ${body.agent.name}` : ''}`,
          comment: {
            body: [
              body.ticket?.issue ? `Issue: ${body.ticket.issue}` : '',
              body.ticket?.address ? `Address: ${body.ticket.address}` : '',
              `Languages: agent ${body.agentLanguage} / caller ${body.customerLanguage}`,
              body.ticket?.dispatch && body.ticket.dispatch !== 'none' ? `Dispatch: ${body.ticket.dispatch}` : '',
              '', 'Transcript:', transcript || '(no transcript)',
            ].filter(Boolean).join('\n'),
            public: false,
          },
          tags: ['notefish', `notefish-${body.transport}`],
          external_id: body.id,
        },
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
      try {
        const response = await fetchImpl(`https://${config.zendeskSubdomain}.zendesk.com/api/v2/tickets.json`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
          body: JSON.stringify(ticket),
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new DeliveryError(`Zendesk responded ${response.status}`, response.status >= 400 && response.status < 500 && response.status !== 429);
        }
        const data = await response.json().catch(() => ({}));
        return { reference: data?.ticket?.id ? String(data.ticket.id) : body.id };
      } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error?.name === 'AbortError' ? 'Zendesk timed out' : 'Zendesk could not be reached');
      } finally { clearTimeout(timer); }
    },
  };
}
