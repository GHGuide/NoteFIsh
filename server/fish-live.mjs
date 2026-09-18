// Fish Audio live TTS: one WebSocket, MessagePack frames, PCM chunks back as soon as
// the first sentence is ready. The desk plays them as they arrive instead of
// waiting for a whole MP3 — the reply starts a few hundred milliseconds after the
// agent lets go of the key.
//   https://docs.fish.audio/api-reference/endpoint/websocket/tts-live
import WebSocket from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import { ProviderError } from './errors.mjs';

export const LIVE_URL = 'wss://api.fish.audio/v1/tts/live';

/**
 * Stream speech for `text`. Resolves when Fish has finished; `onChunk(pcm16)` is
 * called for each PCM16 mono chunk at `sampleRate`. Rejects on any error, after
 * which the caller should fall back to the one-shot REST synthesis.
 */
export function streamSpeech({ apiKey, model = 's2.1-pro-free', text, referenceId, temperature, speed, sampleRate = 16000, latency = 'balanced', signal, onChunk, url = LIVE_URL, WebSocketImpl = WebSocket, timeoutMs = 20000 }) {
  return new Promise((resolve, reject) => {
    if (!apiKey) return reject(new ProviderError('Fish API key is not configured.'));
    if (!text?.trim()) return reject(new ProviderError('Nothing to say.'));
    const ws = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${apiKey}`, model } });
    let done = false, bytes = 0;
    const finish = (error) => {
      if (done) return; done = true;
      clearTimeout(timer); signal?.removeEventListener?.('abort', abort);
      try { ws.close(); } catch { /* closing */ }
      error ? reject(error) : resolve({ bytes });
    };
    const abort = () => finish(new ProviderError('Speech was cancelled.'));
    const timer = setTimeout(() => finish(new ProviderError('Fish did not finish speaking in time.')), timeoutMs);
    timer.unref?.();
    if (signal?.aborted) return abort();
    signal?.addEventListener?.('abort', abort, { once: true });
    ws.on('open', () => {
      const request = { text: '', reference_id: referenceId, format: 'pcm', sample_rate: sampleRate, latency, normalize: true,
        ...(Number.isFinite(temperature) ? { temperature: Math.min(1, Math.max(0.1, temperature)) } : {}),
        ...(Number.isFinite(speed) && speed !== 1 ? { prosody: { speed: Math.min(1.3, Math.max(0.8, speed)) } } : {}) };
      ws.send(encode({ event: 'start', request }));
      ws.send(encode({ event: 'text', text: text.endsWith(' ') ? text : `${text} ` }));
      ws.send(encode({ event: 'flush' }));
      ws.send(encode({ event: 'stop' }));
    });
    ws.on('message', raw => {
      let message; try { message = decode(raw); } catch { return finish(new ProviderError('Fish sent an unreadable frame.')); }
      if (message?.event === 'audio' && message.audio) {
        const chunk = Buffer.isBuffer(message.audio) ? message.audio : Buffer.from(message.audio.buffer ?? message.audio);
        bytes += chunk.length;
        try { onChunk?.(chunk); } catch (error) { return finish(error); }
      } else if (message?.event === 'finish') {
        if (message.reason === 'error') return finish(new ProviderError('Fish could not speak this reply.'));
        finish();
      } else if (message?.event === 'error') {
        finish(new ProviderError(message.message || 'Fish returned an error.'));
      }
    });
    ws.on('error', error => finish(new ProviderError(`Fish live connection failed: ${error.message}`)));
    ws.on('close', () => { if (!done) finish(bytes ? undefined : new ProviderError('Fish closed the connection before speaking.')); });
  });
}
