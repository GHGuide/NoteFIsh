import { createHmac } from 'node:crypto';

export class DeliveryError extends Error {
  constructor(message, permanent = false) { super(message); this.name = 'DeliveryError'; this.permanent = permanent; }
}

/**
 * Signed POST of a completed call. The receiver verifies
 * `sha256=HMAC(secret, "<timestamp>.<raw body>")` and rejects a timestamp that
 * is not recent, which is what stops a captured request being replayed.
 */
export function createWebhookAdapter({ config, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  return {
    name: 'webhook',
    async deliver(body) {
      const raw = JSON.stringify(body);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac('sha256', config.webhookSecret).update(`${timestamp}.${raw}`).digest('hex');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
      try {
        const response = await fetchImpl(config.webhookUrl, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            'X-NoteFish-Timestamp': String(timestamp),
            'X-NoteFish-Signature': `sha256=${signature}`,
            'X-NoteFish-Event': 'call.completed',
          },
          body: raw,
        });
        await response.body?.cancel();
        if (!response.ok) throw new DeliveryError(`Webhook responded ${response.status}`, response.status >= 400 && response.status < 500 && response.status !== 429);
        return { reference: body.id };
      } catch (error) {
        if (error instanceof DeliveryError) throw error;
        throw new DeliveryError(error?.name === 'AbortError' ? 'Webhook timed out' : 'Webhook could not be reached');
      } finally { clearTimeout(timer); }
    },
  };
}
