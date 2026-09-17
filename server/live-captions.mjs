// Live captions: the caller's audio streams to OpenAI's Realtime transcription over
// one WebSocket, words come back while they are still talking (`onPartial`), and
// each finished phrase (`onFinal`) goes through the interpreter as before.
//   https://developers.openai.com/api/docs/guides/realtime-transcription
import WebSocket from 'ws';

export const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

/** Linear 16 kHz → 24 kHz upsample of PCM16 mono; the Realtime API takes 24 kHz. */
export function upsample16kTo24k(pcm) {
  const input = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const frames = Math.floor(input.length * 3 / 2);
  const output = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const position = i * 2 / 3;
    const index = Math.floor(position), fraction = position - index;
    const a = input[Math.min(index, input.length - 1)], b = input[Math.min(index + 1, input.length - 1)];
    output[i] = Math.round(a + (b - a) * fraction);
  }
  return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
}

/**
 * Opens a transcription session. `push(pcm16k)` feeds 16 kHz mono PCM16; server
 * VAD decides where phrases end. Returns { push, close, ready } — `ready` resolves
 * once the session is configured, rejects if it cannot be.
 */
export function openTranscription({ apiKey, model = 'gpt-4o-mini-transcribe', language = '', onPartial, onFinal, onError, url = REALTIME_URL, WebSocketImpl = WebSocket, silenceMs = 600 }) {
  if (!apiKey) throw new Error('OpenAI API key is not configured.');
  const ws = new WebSocketImpl(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  let open = false, closed = false;
  const partials = new Map(); // item id → text so far
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const timer = setTimeout(() => { if (!open) { rejectReady(new Error('Live captions did not connect in time.')); close(); } }, 10000);
  timer.unref?.();
  ws.on('open', () => {
    // GA Realtime shape: a transcription session with PCM in at 24 kHz, server VAD deciding where phrases end.
    ws.send(JSON.stringify({ type: 'session.update', session: { type: 'transcription', audio: { input: {
      format: { type: 'audio/pcm', rate: 24000 },
      transcription: { model, ...(language && language !== 'auto' ? { language } : {}) },
      turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: silenceMs },
      noise_reduction: { type: 'far_field' },
    } } } }));
  });
  ws.on('message', raw => {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    switch (message.type) {
      case 'session.updated': case 'session.created': case 'transcription_session.updated': case 'transcription_session.created':
        if (!open) { open = true; clearTimeout(timer); resolveReady(); }
        break;
      case 'conversation.item.input_audio_transcription.delta': {
        const text = (partials.get(message.item_id) || '') + (message.delta || '');
        partials.set(message.item_id, text);
        onPartial?.(text, message.item_id);
        break;
      }
      case 'conversation.item.input_audio_transcription.completed':
        partials.delete(message.item_id);
        if (message.transcript?.trim()) onFinal?.(message.transcript.trim(), message.item_id);
        break;
      case 'conversation.item.input_audio_transcription.failed':
        partials.delete(message.item_id);
        onError?.(new Error(message.error?.message || 'A phrase could not be transcribed.'));
        break;
      case 'error':
        if (!open) { clearTimeout(timer); rejectReady(new Error(message.error?.message || 'Live captions were refused.')); }
        onError?.(new Error(message.error?.message || 'Live captions failed.'));
        break;
      default: break;
    }
  });
  ws.on('error', error => { if (!open) { clearTimeout(timer); rejectReady(error); } onError?.(error); });
  ws.on('close', () => { closed = true; if (!open) { clearTimeout(timer); rejectReady(new Error('Live captions closed before starting.')); } });
  function push(pcm16k) {
    if (!open || closed || ws.readyState !== 1 || !pcm16k?.length) return;
    ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: upsample16kTo24k(pcm16k).toString('base64') }));
  }
  function close() { closed = true; clearTimeout(timer); try { ws.close(); } catch { /* closing */ } }
  return { push, close, ready, get open() { return open && !closed; } };
}
