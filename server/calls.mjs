import { randomUUID } from 'node:crypto';
import { convertAudio, SpeechSegmenter, AudioError, ringbackTone, pcm16kToMulaw8k, mulawToPcm } from './audio.mjs';

/** Telephone audio for the live captioner: 8 kHz PCM16 doubled to 16 kHz by linear interpolation. */
function upsample8kTo16k(pcm8k) {
  const frames = Math.floor(pcm8k.length / 2);
  const out = Buffer.allocUnsafe(frames * 4);
  for (let i = 0; i < frames; i++) {
    const a = pcm8k.readInt16LE(i * 2), b = i + 1 < frames ? pcm8k.readInt16LE(i * 2 + 2) : a;
    out.writeInt16LE(a, i * 4); out.writeInt16LE(Math.round((a + b) / 2), i * 4 + 2);
  }
  return out;
}
import { ProviderError } from './providers.mjs';
import { languageCodes, isCallerLanguage } from './languages.mjs';
import { measureClip, arousalOf, registerFor, tagFor, prosodyFor, describe, chooseRegister, taggedText, REGISTERS, canonicalRegister } from './emotion.mjs';

const CALL_SID = /^CA[0-9a-f]{32}$/iu;
const STREAM_SID = /^MZ[0-9a-f]{32}$/iu;
const PHONE = /^\+[1-9]\d{6,14}$/u;
const TERMINAL = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled']);
const now = () => new Date().toISOString();

export class CallError extends Error {
  constructor(message, status = 409) { super(message); this.name = 'CallError'; this.status = status; }
}

function safeError(error) {
  return error instanceof ProviderError || error instanceof AudioError || error instanceof CallError
    ? error.message : 'The call operation could not be completed. Try again.';
}

function textInput(value, maximum, label, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim())
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new CallError(`Provide valid ${label}.`, 400);
  return value.trim();
}

/**
 * Real callers and a floor of agents. Only synthesized Fish speech reaches a
 * caller, and caller audio only reaches the agent the call is assigned to.
 */
export function createCallService({
  config, store, providers, broadcast,
  convert = convertAudio, fetchImpl = globalThis.fetch,
  noAnswerMs = 60000, maxCallMs = 3600000, playbackGraceMs = 10000,
  maxConcurrentCalls = config?.maxConcurrentCalls || 20,
  onComplete = null,
}) {
  const live = new Map(); let initializing;
  const waitingTone = ringbackTone().toString('base64');
  function initialize() {
    if (!initializing) initializing = store.update(state => {
      for (const call of state.calls) if (call.state !== 'ended') {
        call.state = 'ended'; call.phase = 'listening'; call.endedAt = now();
        call.error = 'The server restarted. This stream is no longer connected.';
      }
    });
    return initializing;
  }
  const snapshot = () => {
    const saved = store.snapshot().calls;
    return saved.map(call => structuredClone(live.get(call.id)?.call || call));
  };
  // `to` narrows an event to one agent. Caller audio must never fan out to
  // every open desk: other agents have no business hearing this caller.
  const emit = (event, to) => { try { broadcast(event, to ? { to } : undefined); } catch { /* A browser disconnect cannot interrupt a phone call. */ } };
  const persist = async runtime => {
    const copy = structuredClone(runtime.call);
    await store.update(state => {
      const i = state.calls.findIndex(call => call.id === copy.id);
      if (i < 0) {
        if (state.calls.length >= 1000) throw new CallError('Call storage is full. Export older calls before receiving another call.', 503);
        state.calls.unshift(copy);
      } else {
        // Ticket edits have their own serialized mutation path; a caption/audio
        // update captured before that edit must not replace the newer ticket.
        copy.ticket = structuredClone(state.calls[i].ticket);
        state.calls[i] = copy;
      }
    });
    emit({ type: 'call', call: structuredClone(runtime.call) });
    notifyCaller(runtime);
    return structuredClone(runtime.call);
  };
  function find(id, requireActive = false) {
    if (typeof id !== 'string' || id.length > 128) throw new CallError('Invalid call.', 400);
    const runtime = live.get(id);
    if (!runtime || runtime.call.state === 'ended') throw new CallError('This call is no longer connected.', 409);
    if (requireActive && runtime.call.state !== 'in_call') throw new CallError('Answer the call before speaking.');
    return runtime;
  }
  function connected(runtime) {
    if (!runtime.ws || runtime.ws.readyState !== 1 || (runtime.call.transport !== 'browser' && !runtime.streamSid)) throw new CallError('The caller audio is not connected.');
  }
  function sendBrowser(runtime, event) {
    connected(runtime);
    if (runtime.ws.bufferedAmount > 4 * 1024 * 1024) throw new CallError('The caller audio connection is too slow. Try again.');
    runtime.ws.send(JSON.stringify(event));
  }
  /** The caller's own captions, on their phone if they want them: what they said, as
   * heard, and what the desk answered, in their language. Never another call's lines. */
  function captionCaller(runtime, line, who) {
    if (!line || runtime.call.transport !== 'browser' || runtime.ws?.readyState !== 1) return;
    try { sendBrowser(runtime, { type: 'caption', id: line.id, who, text: who === 'you' ? line.textSource : line.textShown }); } catch { /* audio matters more than a caption */ }
  }
  function notifyCaller(runtime) {
    if (runtime.call.transport !== 'browser' || runtime.ws?.readyState !== 1) return;
    try {
      // A caller link never exposes desk notes, voice IDs or other calls; it sees only its own captions.
      sendBrowser(runtime, { type: 'state', callId: runtime.call.id, state: runtime.call.state,
        phase: runtime.call.phase, customerLanguage: runtime.call.customerLanguage === 'auto' ? (runtime.call.detectedLanguage || 'auto') : runtime.call.customerLanguage });
    } catch { runtime.ws?.close(1013, 'Caller connection is too slow'); }
  }
  function send(runtime, event) {
    if (runtime.call.transport === 'browser') {
      if (event.event !== 'clear') throw new CallError('Invalid caller audio transport.');
      return sendBrowser(runtime, { type: 'clear' });
    }
    connected(runtime);
    if (runtime.ws.bufferedAmount > 1024 * 1024) throw new CallError('The phone audio connection is too slow. Try again.');
    runtime.ws.send(JSON.stringify({ ...event, streamSid: runtime.streamSid }));
  }
  function cancelReply(runtime, delivery = 'cancelled') {
    runtime.run += 1; runtime.replyAbort?.abort(); runtime.replyAbort = null;
    clearTimeout(runtime.playbackTimer); runtime.playbackTimer = null; runtime.mark = null;
    if (runtime.replyLineId) {
      const line = runtime.call.transcript.find(line => line.id === runtime.replyLineId);
      if (line && line.delivery === 'pending') line.delivery = delivery;
    }
    runtime.replyLineId = null; runtime.busy = false; runtime.segmenter.reset(); runtime.pcmTail = Buffer.alloc(0);
    runtime.call.phase = 'listening'; runtime.call.stage = 'listening';
  }
  function warn(runtime, message) {
    runtime.call.error = message;
    emit({ type: 'error', callId: runtime.call.id, error: message });
  }
  async function finish(runtime, reason, remote = false) {
    if (runtime.call.state === 'ended') return structuredClone(runtime.call);
    cancelReply(runtime); runtime.captionAbort.abort(); runtime.captionQueue.length = 0; stopLiveCaptions(runtime);
    clearTimeout(runtime.noAnswerTimer); clearTimeout(runtime.lifetimeTimer); clearInterval(runtime.ringbackTimer); clearInterval(runtime.heartbeatTimer);
    runtime.call.state = 'ended'; runtime.call.endedAt = now(); runtime.call.mediaConnected = false;
    if (reason) runtime.call.error = reason;
    notifyCaller(runtime);
    const ws = runtime.ws; runtime.ws = null;
    // Closing Connect/Stream continues the webhook's final Hangup instruction.
    if (ws && ws.readyState < 2) ws.close(1000, 'Call ended');
    const saved = await persist(runtime);
    live.delete(runtime.call.id);
    // Outbound delivery must never be able to break hanging up.
    if (onComplete) { try { void onComplete(structuredClone(saved)); } catch { /* delivery reports its own failures */ } }
    if (remote && runtime.call.transport !== 'browser' && config.twilioAccountSid && config.twilioAuthToken) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000); timer.unref?.();
      try {
        const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Calls/${runtime.call.callSid}.json`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ Status: 'completed' }),
        });
        await response.body?.cancel();
        if (!response.ok) emit({ type: 'error', callId: saved.id, error: 'Audio disconnected. Twilio did not confirm hangup; check the phone or Twilio console.' });
      } catch {
        emit({ type: 'error', callId: saved.id, error: 'Audio disconnected. Twilio did not confirm hangup; check the phone or Twilio console.' });
      } finally { clearTimeout(timer); }
    }
    return saved;
  }
  async function backgroundFinish(runtime, reason, remote = false) {
    try { await finish(runtime, reason, remote); }
    catch { emit({ type: 'error', error: 'The call ended, but its latest state could not be saved.' }); }
  }
  function addLine(runtime, line) {
    if (runtime.call.transcript.length >= 1000) throw new CallError('This call reached its transcript limit. End the call and start a new one.');
    runtime.call.transcript.push({ id: randomUUID(), t: now(), ...line });
    return runtime.call.transcript.at(-1);
  }
  async function drainCaptions(runtime) {
    if (runtime.captionRunning) return;
    runtime.captionRunning = true;
    try {
      while (runtime.captionQueue.length && runtime.call.state === 'in_call') {
        const { audio, text, sourceLanguage, targetLanguage } = runtime.captionQueue.shift();
        const signal = runtime.captionAbort.signal;
        try {
          // Once the caller's language is known, keep using it as the hint; 'auto' only for the first phrases.
          const hint = sourceLanguage === 'auto' ? (runtime.call.detectedLanguage || 'auto') : sourceLanguage;
          // Live captions hand us the phrase as text already; the segmenter path still transcribes a clip.
          const textSource = text !== undefined ? text : await providers.transcribe({ audio, mimeType: 'audio/wav', language: hint, signal });
          if (!textSource?.trim()) continue;
          let textShown, spoken = hint;
          if (providers.interpret) {
            // Captions are always in the agent's language; the interpreter also tells us what the caller speaks and how.
            const result = await providers.interpret({ text: textSource, sourceLanguage: hint, targetLanguage, signal });
            textShown = result.text;
            // The caller's state steers the next reply: an upset caller is answered with an apology.
            runtime.call.callerTone = result.tone || 'calm';
            runtime.captionTone = result.tone && result.tone !== 'calm' ? result.tone : '';
            const detecting = hint === 'auto' || runtime.call.customerLanguage === 'auto';
            if (detecting && result.language && languageCodes.has(result.language)) {
              spoken = result.language;
              if (runtime.call.detectedLanguage !== result.language) {
                runtime.call.detectedLanguage = result.language;
                emit({ type: 'language', callId: runtime.call.id, language: result.language });
              }
            }
          } else {
            textShown = await providers.translate({ text: textSource, sourceLanguage: hint === 'auto' ? targetLanguage : hint, targetLanguage, signal });
          }
          if (runtime.call.state !== 'in_call' || signal.aborted) break;
          captionCaller(runtime, addLine(runtime, { speaker: 'customer', sourceLang: spoken === 'auto' ? 'und' : spoken, targetLang: targetLanguage, textSource, textShown, delivery: 'caption', ...(runtime.captionTone ? { feeling: runtime.captionTone } : {}) }), 'you');
          runtime.captionTone = '';
          await persist(runtime);
        } catch (error) {
          if (runtime.call.state !== 'in_call' || signal.aborted) break;
          warn(runtime, safeError(error)); await persist(runtime);
        }
      }
    } catch { emit({ type: 'error', error: 'A caption could not be saved.' }); }
    finally { runtime.captionRunning = false; }
  }
  // Partial captions: short enough to be worth a translation, and this much longer than the last one before spending another.
  const PARTIAL_MIN_CHARS = 8, PARTIAL_GROWTH = 10;

  function queueCaption(runtime, audio, text) {
    if (!audio && text === undefined) return;
    if (runtime.captionQueue.length >= 3) {
      if (Date.now() - runtime.lastQueueWarning > 10000) {
        runtime.lastQueueWarning = Date.now();
        warn(runtime, 'Captions are falling behind. A speech segment was skipped; ask the caller to repeat it.');
      }
      return;
    }
    const settings = runtime.call;
    if (!isCallerLanguage(settings.customerLanguage) || !languageCodes.has(settings.agentLanguage)) {
      warn(runtime, 'Choose supported call languages before continuing captions.'); return;
    }
    runtime.captionQueue.push({ audio, text, sourceLanguage: settings.customerLanguage, targetLanguage: settings.agentLanguage });
    void drainCaptions(runtime);
  }

  async function applySettings(settings) {
    if (!isCallerLanguage(settings.customerLanguage) || !languageCodes.has(settings.agentLanguage)) throw new CallError('Choose supported call languages.', 400);
    const pending = [];
    for (const runtime of live.values()) {
      // Each live call follows its own agent's pair, so a workspace-default
      // change leaves calls whose agent overrides it untouched.
      const resolved = resolveSettings(runtime.call.agentId);
      if (!isCallerLanguage(resolved.customerLanguage) || !languageCodes.has(resolved.agentLanguage)) continue;
      if (runtime.call.state === 'ended' || (runtime.call.customerLanguage === resolved.customerLanguage && runtime.call.agentLanguage === resolved.agentLanguage)) continue;
      // Finish the current phrase with its original language hint. Already queued
      // captions and an in-flight reply keep their own captured language pair.
      if (runtime.call.state === 'in_call') queueCaption(runtime, runtime.segmenter.flush());
      runtime.call.customerLanguage = resolved.customerLanguage;
      runtime.call.agentLanguage = resolved.agentLanguage;
      pending.push(persist(runtime));
    }
    await Promise.all(pending);
  }

  async function createInboundCall({ callSid, from, to, transport, via = null }) {
    await initialize();
    const duplicate = [...live.values()].find(value => value.call.callSid === callSid);
    if (duplicate) return structuredClone(duplicate.call);
    if (store.snapshot().calls.some(call => call.callSid === callSid)) throw new CallError('This call has already ended.');
    if (live.size >= maxConcurrentCalls) throw new CallError('Every line is busy. Try again shortly.');
    const settings = store.snapshot().settings;
    if (!languageCodes.has(settings.agentLanguage) || !isCallerLanguage(settings.customerLanguage)) throw new CallError('Configure valid call languages before receiving a call.', 503);
    const call = {
      id: randomUUID(), callSid, from, to, transport, ...(via ? { via } : {}), state: 'ringing', phase: 'listening', stage: 'waiting', mediaConnected: false,
      startedAt: now(), answeredAt: null, endedAt: null, agentId: null, agentName: '', detectedLanguage: null,
      voiceId: settings.voiceId, agentLanguage: settings.agentLanguage, customerLanguage: settings.customerLanguage,
      queueName: settings.queueName || '',
      transcript: [], ticket: { issue: '', address: '', dispatch: 'none' },
    };
    const runtime = { call, ws: null, streamSid: null,
      segmenter: new SpeechSegmenter(transport === 'browser' ? { format: 'pcm', sampleRate: 16000 } : {}), run: 0, busy: false,
      captionAbort: new AbortController(), captionQueue: [], captionRunning: false, lastQueueWarning: 0, partial: null,
      replyAbort: null, replyLineId: null, mark: null, noAnswerTimer: null, lifetimeTimer: null, playbackTimer: null, ringbackTimer: null,
      frameWindow: Date.now(), frameBytes: 0, frameCount: 0, pcmTail: Buffer.alloc(0), heartbeatTimer: null, browserAlive: true,
    };
    live.set(call.id, runtime);
    try { await persist(runtime); } catch (error) { live.delete(call.id); throw error; }
    runtime.noAnswerTimer = setTimeout(() => void backgroundFinish(runtime, 'No agent answered within 60 seconds.', true), noAnswerMs);
    runtime.noAnswerTimer.unref?.();
    runtime.lifetimeTimer = setTimeout(() => void backgroundFinish(runtime, 'The call reached the one-hour demo limit.', true), maxCallMs);
    runtime.lifetimeTimer.unref?.();
    return structuredClone(call);
  }

  async function registerInbound({ callSid, from, to }) {
    if (!CALL_SID.test(callSid || '')) throw new CallError('Invalid incoming call.', 400);
    if (typeof from !== 'string' || (!PHONE.test(from) && !['anonymous', 'restricted', 'unknown'].includes(from))) throw new CallError('Invalid incoming caller.', 400);
    if (typeof to !== 'string' || !PHONE.test(to) || (config.twilioNumber && to !== config.twilioNumber)) throw new CallError('This number is not assigned to the desk.', 400);
    return createInboundCall({ callSid, from, to, transport: 'twilio' });
  }
  async function registerBrowserInbound({ from = '', via = 'link' } = {}) {
    // via: 'link' is a caller on their phone; 'companion' is a call the companion detected on this Mac (Zoom, WhatsApp…).
    return createInboundCall({ callSid: `browser:${randomUUID()}`, from: from || 'Browser caller', to: 'Browser desk', transport: 'browser', via });
  }

  /** Called only after the server consumes a valid, single-use caller invitation. */
  function handleBrowserStream(ws, { callId }) {
    const runtime = find(callId);
    if (runtime.call.transport !== 'browser' || runtime.ws || ws.readyState !== 1) throw new CallError('This caller connection is not available.');
    runtime.ws = ws; runtime.call.mediaConnected = true;
    const fail = () => {
      if (ws.readyState < 2) ws.close(1008, 'Invalid caller stream');
      void backgroundFinish(runtime, 'The caller audio stream was interrupted.');
    };
    ws.on('message', (raw, isBinary) => {
      void (async () => {
        if (runtime.call.state === 'ended') return;
        runtime.browserAlive = true;
        if (Date.now() - runtime.frameWindow > 10000) {
          runtime.frameWindow = Date.now(); runtime.frameBytes = 0; runtime.frameCount = 0;
        }
        if (++runtime.frameCount > 2000) return fail();
        if (isBinary) {
          if (!Buffer.isBuffer(raw) || raw.length < 2 || raw.length > 3200 || raw.length % 2) return fail();
          runtime.frameBytes += raw.length;
          if (runtime.frameBytes > 640000) return fail();
          if (runtime.call.state !== 'in_call' || runtime.busy) return;
          // Preserve 16kHz PCM for transcription; only the existing desk player uses 8kHz G.711.
          const buffered = Buffer.concat([runtime.pcmTail, raw]);
          const pairedBytes = buffered.length - buffered.length % 4;
          runtime.pcmTail = Buffer.from(buffered.subarray(pairedBytes));
          if (pairedBytes) {
            const audio = pcm16kToMulaw8k(buffered.subarray(0, pairedBytes));
            emit({ type: 'audio', callId, payload: audio.toString('base64') }, runtime.call.agentId);
          }
          hearCaller(runtime, raw);
          return;
        }
        if (raw.length > 1024) return fail();
        let message; try { message = JSON.parse(raw.toString()); } catch { return fail(); }
        if (!message || typeof message !== 'object' || Array.isArray(message)) return fail();
        if (message.type === 'end' && Object.keys(message).length === 1) return finish(runtime);
        if (message.type !== 'played' || Object.keys(message).some(key => !['type', 'playbackId'].includes(key))
          || typeof message.playbackId !== 'string' || message.playbackId.length > 128) return fail();
        if (runtime.mark && message.playbackId === runtime.mark) {
          const line = runtime.call.transcript.find(line => line.id === runtime.replyLineId);
          if (line) line.delivery = 'played';
          cancelReply(runtime); await persist(runtime);
        }
      })().catch(() => fail());
    });
    ws.on('pong', () => { runtime.browserAlive = true; });
    ws.on('close', () => {
      clearInterval(runtime.heartbeatTimer);
      if (runtime.call.state !== 'ended') void backgroundFinish(runtime, 'The caller disconnected.');
    });
    ws.on('error', fail);
    runtime.heartbeatTimer = setInterval(() => {
      if (runtime.call.state === 'ended') return;
      if (!runtime.browserAlive) {
        ws.terminate?.(); void backgroundFinish(runtime, 'The caller connection was lost.'); return;
      }
      runtime.browserAlive = false;
      try { ws.ping?.(); } catch { fail(); }
    }, 15000);
    runtime.heartbeatTimer.unref?.();
    void persist(runtime).catch(fail);
  }

  function handleStream(ws) {
    let runtime; let started = false;
    const startTimer = setTimeout(() => ws.close(1008, 'Start required'), 10000); startTimer.unref?.();
    const fail = () => {
      if (ws.readyState < 2) ws.close(1008, 'Invalid telephone stream');
      if (runtime) void backgroundFinish(runtime, 'The telephone audio stream was interrupted.');
    };
    ws.on('message', (raw, isBinary) => {
      void (async () => {
        if (isBinary || raw.length > 16384) return fail();
        let message; try { message = JSON.parse(raw.toString()); } catch { return fail(); }
        if (!message || typeof message !== 'object' || Array.isArray(message)) return fail();
        if (message.event === 'connected' && !started) return;
        if (message.event === 'start') {
          if (started) return fail();
          const start = message.start;
          if (!start || start.accountSid !== config.twilioAccountSid || !CALL_SID.test(start.callSid || '')
            || !STREAM_SID.test(message.streamSid || '') || message.streamSid !== start.streamSid
            || start.mediaFormat?.encoding !== 'audio/x-mulaw' || start.mediaFormat?.sampleRate !== 8000
            || start.mediaFormat?.channels !== 1 || !Array.isArray(start.tracks) || !start.tracks.includes('inbound')) return fail();
          const candidate = live.get(start.customParameters?.callId);
          if (!candidate || candidate.call.transport !== 'twilio' || candidate.call.callSid !== start.callSid || candidate.ws || candidate.call.state === 'ended') return fail();
          runtime = candidate; runtime.ws = ws; runtime.streamSid = message.streamSid;
          runtime.call.mediaConnected = true; started = true; clearTimeout(startTimer);
          const ring = () => {
            if (runtime.call.state !== 'ringing') return;
            try { send(runtime, { event: 'media', media: { payload: waitingTone } }); } catch { fail(); }
          };
          ring(); runtime.ringbackTimer = setInterval(ring, 4000); runtime.ringbackTimer.unref?.();
          await persist(runtime); return;
        }
        if (!runtime || !started || message.streamSid !== runtime.streamSid || runtime.call.state === 'ended') return fail();
        if (message.event === 'stop') { await finish(runtime); return; }
        if (message.event === 'mark') {
          if (typeof message.mark?.name !== 'string' || message.mark.name.length > 128) return fail();
          if (runtime.mark && message.mark.name === runtime.mark) {
            const line = runtime.call.transcript.find(line => line.id === runtime.replyLineId);
            if (line) line.delivery = 'played';
            cancelReply(runtime); await persist(runtime);
          }
          return;
        }
        if (message.event === 'dtmf') return;
        if (message.event !== 'media') return fail();
        const payload = message.media?.payload;
        if (message.media?.track !== 'inbound' || typeof payload !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/u.test(payload)
          || payload.length % 4 !== 0 || payload.length > 6400) return fail();
        const frame = Buffer.from(payload, 'base64');
        if (!frame.length || frame.length > 4800 || frame.toString('base64') !== payload) return fail();
        if (Date.now() - runtime.frameWindow > 10000) { runtime.frameWindow = Date.now(); runtime.frameBytes = 0; }
        runtime.frameBytes += frame.length;
        if (runtime.frameBytes > 160000) return fail();
        if (runtime.call.state !== 'in_call' || runtime.busy) return;
        emit({ type: 'audio', callId: runtime.call.id, payload }, runtime.call.agentId);
        hearCaller(runtime, null, frame);
      })().catch(() => fail());
    });
    ws.on('close', () => {
      clearTimeout(startTimer);
      if (runtime && runtime.call.state !== 'ended') void backgroundFinish(runtime, 'The phone disconnected.');
    });
    ws.on('error', () => fail());
  }

  /** Agent overrides win over the workspace defaults; an empty override inherits. */
  /** One instruction block for the interpreter: how to word replies, which register, and the words that never change. */
  function composeStyle({ persona = '', formality = null, glossary = [] }) {
    const lines = [];
    if (persona && persona.trim()) lines.push(persona.trim());
    if (formality === 'formal') lines.push('Address the caller formally (vous, Sie, usted, u).');
    if (formality === 'casual') lines.push('Address the caller informally (tu, du, tú, je).');
    if (formality === 'match') lines.push('Mirror the register the caller uses, formal or informal.');
    const keep = glossary.filter(item => item.kind === 'keep').map(item => item.term);
    const spell = glossary.filter(item => item.kind === 'spell').map(item => item.term);
    const as = glossary.filter(item => item.kind === 'as' && item.as).map(item => `"${item.term}" → "${item.as}"`);
    if (keep.length) lines.push(`Never translate these, keep them exactly as written: ${keep.join(', ')}.`);
    if (spell.length) lines.push(`Read these digit by digit or letter by letter: ${spell.join(', ')}.`);
    if (as.length) lines.push(`Translate these terms exactly so: ${as.join('; ')}.`);
    return lines.join('\n').slice(0, 1500);
  }
  function resolveSettings(agentId) {
    const state = store.snapshot();
    const defaults = state.settings;
    const agent = agentId ? (state.agents || []).find(item => item.id === agentId && !item.archived) : null;
    return {
      agent,
      voiceId: agent?.voiceId || defaults.voiceId,
      registers: agent?.registers || defaults.registers || {},
      persona: agent?.persona || defaults.persona || '',
      style: composeStyle({ persona: agent?.persona || defaults.persona || '', formality: agent?.formality || defaults.formality || null, glossary: defaults.glossary || [] }),
      agentLanguage: agent?.agentLanguage || defaults.agentLanguage,
      customerLanguage: agent?.customerLanguage || defaults.customerLanguage,
    };
  }

  /** Live captions for one call: the caller's frames go to the transcription session as they arrive; each finished
   * phrase joins the caption queue as text. Without the provider, or if it fails, the segmenter path carries on. */
  function startLiveCaptions(runtime) {
    if (!providers.openTranscription || runtime.live) return;
    const settings = resolveSettings(runtime.call.agentId);
    const hint = settings.customerLanguage === 'auto' ? (runtime.call.detectedLanguage || 'auto') : settings.customerLanguage;
    try {
      const live = providers.openTranscription({
        language: hint,
        onPartial: text => {
          if (runtime.call.state !== 'in_call' || runtime.live !== live || !heardSpeech(runtime)) return;
          if (!runtime.partial) runtime.partial = { text: '', shown: '', from: '', running: false };
          const state = runtime.partial;
          // A new phrase starts its own text, so the old translation no longer describes it.
          if (state.from && !text.startsWith(state.from)) state.shown = '';
          state.text = text;
          showPartial(runtime, text, state.shown);
          void translatePartial(runtime);
        },
        onFinal: text => { if (runtime.call.state === 'in_call' && runtime.live === live) { clearPartial(runtime); if (heardSpeech(runtime)) queueCaption(runtime, null, text); } },
        onError: error => { if (runtime.live === live) { warn(runtime, `Live captions stopped, using segments: ${safeError(error)}`); stopLiveCaptions(runtime); } },
      });
      runtime.live = live;
      live.ready.catch(error => { if (runtime.live === live) { warn(runtime, `Live captions unavailable, using segments: ${safeError(error)}`); stopLiveCaptions(runtime); } });
    } catch (error) { warn(runtime, `Live captions unavailable: ${safeError(error)}`); }
  }
  function stopLiveCaptions(runtime) {
    const live = runtime.live; runtime.live = null;
    clearPartial(runtime);
    try { live?.close(); } catch { /* closing */ }
  }

  /** What the caller is saying right now: their own words, and the agent's
   * language once a translation of the phrase so far has come back. */
  function showPartial(runtime, text, shown = '') {
    emit({ type: 'caption-partial', callId: runtime.call.id, text, ...(shown ? { shown } : {}) }, runtime.call.agentId);
  }
  function clearPartial(runtime) {
    if (!runtime.partial) return;
    runtime.partial = null;
    showPartial(runtime, '');
  }
  /** The pair a partial is translated across, or nulls while auto-detect is still waiting for the first phrase. */
  function partialLanguages(runtime) {
    const source = runtime.call.customerLanguage === 'auto' ? runtime.call.detectedLanguage : runtime.call.customerLanguage;
    const target = runtime.call.agentLanguage;
    if (!source || !languageCodes.has(source) || !languageCodes.has(target) || source === target) return null;
    return { source, target };
  }
  /**
   * Translate the phrase so far, so the agent reads it in their own language
   * before the caller stops talking. One translation is in flight at a time and
   * the next only starts once it returns, so its own round trip paces the spend:
   * a fast talker costs a handful of short calls per phrase, not one per token.
   */
  async function translatePartial(runtime) {
    const state = runtime.partial;
    if (!state || state.running || !providers.translate) return;
    const pair = partialLanguages(runtime);
    if (!pair) return;
    const text = state.text;
    // Enough to be worth translating, and meaningfully more than last time —
    // except when the caller has started a new phrase, which resets the text.
    const restarted = !state.from || !text.startsWith(state.from);
    if (text.length < PARTIAL_MIN_CHARS || (!restarted && text.length - state.from.length < PARTIAL_GROWTH)) return;
    state.running = true; state.from = text;
    try {
      const shown = await providers.translate({ text, sourceLanguage: pair.source, targetLanguage: pair.target, signal: runtime.captionAbort.signal });
      if (runtime.partial === state && shown?.trim()) { state.shown = shown; showPartial(runtime, state.text, shown); }
    } catch { /* the caller's own words stay on screen; the finished phrase is the authoritative caption */ }
    finally { state.running = false; if (runtime.partial === state) void translatePartial(runtime); }
  }
  /** A caller frame goes to live captions when the session is up; otherwise to the segmenter. */
  // The live transcriber invents sentences over silence. Remember when the caller
  // last made a sound, and let a caption through only if it followed one.
  const SPEECH_FLOOR = 350; // PCM16 RMS, about -39 dBFS: quieter than any voice on a call
  const SPEECH_MEMORY = 6000; // a phrase finishes within a few seconds of its last sound
  const LEVEL_EVERY = 120; // how often the meter is worth redrawing, in ms
  /** How loud the caller is right now, 0 to 1, on a decibel scale so an ordinary voice
   *  sits in the middle of the meter rather than at the bottom of it. */
  const loudness = rms => {
    if (!(rms > 0)) return 0;
    const dbfs = 20 * Math.log10(rms / 32768);
    return Math.max(0, Math.min(1, (dbfs + 50) / 50));
  };
  function noteSound(runtime, pcm) {
    let sum = 0, count = 0;
    for (let i = 0; i + 1 < pcm.length; i += 8) { const v = pcm.readInt16LE(i); sum += v * v; count++; }
    if (!count) return;
    const rms = Math.sqrt(sum / count);
    if (rms > SPEECH_FLOOR) runtime.lastSound = Date.now();
    // The same number, kept rather than thrown away, so the desk and the pill can draw a
    // meter that moves with the caller's voice. It is the one thing on screen that proves
    // the call is being heard at all; an animation that plays regardless proves nothing,
    // and a bridge that had gone deaf looked exactly like one that was working.
    const at = Date.now();
    // A gap in the audio makes whatever was loudest before it old news, not the level
    // now, so the meter starts again from this frame rather than replaying that peak.
    if (at - (runtime.frameAt || 0) > LEVEL_EVERY * 2) runtime.levelPeak = 0;
    runtime.frameAt = at;
    runtime.levelPeak = Math.max(runtime.levelPeak || 0, rms);
    if (at - (runtime.levelAt || 0) < LEVEL_EVERY) return;
    runtime.levelAt = at;
    const level = loudness(runtime.levelPeak);
    runtime.levelPeak = 0;
    emit({ type: 'level', callId: runtime.call.id, level: Math.round(level * 100) / 100 }, runtime.call.agentId);
  }
  const heardSpeech = runtime => runtime.lastSound && Date.now() - runtime.lastSound < SPEECH_MEMORY;
  function hearCaller(runtime, pcm16k, mulawFrame) {
    const pcm = pcm16k ?? upsample8kTo16k(mulawToPcm(mulawFrame));
    noteSound(runtime, pcm);
    if (runtime.live?.open) { runtime.live.push(pcm); return; }
    queueCaption(runtime, runtime.segmenter.push(pcm16k ?? mulawFrame));
  }
  async function answer(id, agentId = null) {
    const runtime = find(id); connected(runtime);
    // Every available agent sees a ringing call. The first one through this
    // check owns it; the rest are told so rather than silently stealing it.
    if (agentId && runtime.call.agentId && runtime.call.agentId !== agentId) throw new CallError('Another agent already answered this call.');
    if (runtime.call.state === 'in_call') return structuredClone(runtime.call);
    if (agentId) {
      const settings = resolveSettings(agentId);
      if (!settings.agent) throw new CallError('This agent is no longer on the roster.', 403);
      for (const other of live.values()) {
        if (other !== runtime && other.call.agentId === agentId && other.call.state === 'in_call') throw new CallError('You are already on another call. End it before answering.');
      }
      runtime.call.agentId = agentId;
      runtime.call.agentName = settings.agent.name;
      if (settings.voiceId) runtime.call.voiceId = settings.voiceId;
      if (languageCodes.has(settings.agentLanguage)) runtime.call.agentLanguage = settings.agentLanguage;
      if (isCallerLanguage(settings.customerLanguage)) runtime.call.customerLanguage = settings.customerLanguage;
    }
    clearTimeout(runtime.noAnswerTimer); clearInterval(runtime.ringbackTimer);
    send(runtime, { event: 'clear' });
    runtime.call.state = 'in_call'; runtime.call.answeredAt = now();
    startLiveCaptions(runtime);
    runtime.call.stage = 'listening'; runtime.segmenter.reset();
    return persist(runtime);
  }
  async function end(id) {
    const old = snapshot().find(call => call.id === id);
    if (old?.state === 'ended') return old;
    return finish(find(id), undefined, true);
  }
  async function stop(id) {
    const runtime = find(id, true);
    cancelReply(runtime);
    try { send(runtime, { event: 'clear' }); } catch (error) { warn(runtime, safeError(error)); }
    return persist(runtime);
  }
  async function reply(id, { buffer, mimetype, text, feeling }) {
    const runtime = find(id, true); connected(runtime);
    if (runtime.busy) throw new CallError('Wait for the current reply, or stop it before starting another.');
    feeling = feeling === undefined ? undefined : canonicalRegister(feeling);
    if (feeling !== undefined && feeling !== 'auto' && !REGISTERS.includes(feeling)) throw new CallError(`Choose a feeling: auto, ${REGISTERS.join(', ')}.`);
    const state = store.snapshot(); const settings = resolveSettings(runtime.call.agentId);
    const readyVoice = id => { const v = state.voices.find(voice => voice.id === id); return v && v.status === 'ready' && !v.archived && ['enrolled', 'licensed'].includes(v.kind) ? v : null; };
    const baseVoice = readyVoice(settings.voiceId);
    if (!baseVoice) throw new CallError('Select a ready, enrolled or licensed voice before speaking.');
    // The caller's language: what they were heard speaking, else the configured one.
    const targetLanguage = settings.customerLanguage === 'auto' ? runtime.call.detectedLanguage : settings.customerLanguage;
    if (!languageCodes.has(settings.agentLanguage) || !isCallerLanguage(settings.customerLanguage)) throw new CallError('Choose supported call languages.');
    if (!targetLanguage) throw new CallError('Wait for the caller to say something so their language can be detected, or pick their language in the call bar.', 409);
    let voice = baseVoice;
    if (text !== undefined) text = textInput(text, 3000, 'reply text');
    else if (!Buffer.isBuffer(buffer) || buffer.length > 12 * 1024 * 1024) throw new CallError('Provide a short microphone recording.', 400);
    queueCaption(runtime, runtime.segmenter.flush());
    runtime.busy = true; const generation = ++runtime.run;
    const controller = new AbortController(); runtime.replyAbort = controller;
    const signal = controller.signal; runtime.call.error = undefined;
    runtime.call.voiceId = voice.id; runtime.call.agentLanguage = settings.agentLanguage;
    runtime.call.customerLanguage = settings.customerLanguage; runtime.call.phase = 'translating';
    let arousal = null, register = 'calm', tag = '', prosody = {};
    runtime.call.stage = text === undefined ? 'transcribing' : 'translating';
    const current = () => runtime.run === generation && runtime.call.state === 'in_call' && !signal.aborted;
    try {
      await persist(runtime);
      let textSource = text, clip = null;
      if (textSource === undefined) {
        const audio = await convert(buffer, mimetype, { output: 'wav', sampleRate: 16000, minSeconds: 0.25, maxSeconds: 45, signal });
        if (!current()) return structuredClone(runtime.call);
        textSource = await providers.transcribe({ audio, mimeType: 'audio/wav', language: settings.agentLanguage, signal });
        // How it was said, from the clip itself: text alone would decide the emotion otherwise.
        if (textSource?.trim()) clip = measureClip(audio, textSource.trim().split(/\s+/u).length);
      }
      if (!current()) return structuredClone(runtime.call);
      if (!textSource?.trim()) throw new CallError('No speech was detected. Hold the button and try again.', 422);
      runtime.call.stage = 'translating'; await persist(runtime);
      // Providers without an interpreter (tests, older adapters) still translate; tone then defaults to calm.
      const interpreted = providers.interpret
        ? await providers.interpret({ text: textSource, sourceLanguage: settings.agentLanguage, targetLanguage, style: settings.style, signal })
        : { text: await providers.translate({ text: textSource, sourceLanguage: settings.agentLanguage, targetLanguage, signal }), tone: 'calm', language: settings.agentLanguage, sentences: [] };
      if (!current()) return structuredClone(runtime.call);
      arousal = clip ? arousalOf(clip, baseVoice.baseline || undefined) : { level: 'medium', rateRatio: 1, louderDb: 0 };
      const firstReply = !runtime.call.transcript.some(line => line.speaker === 'agent');
      const waited = new Date(runtime.call.answeredAt || runtime.call.startedAt).getTime() - new Date(runtime.call.startedAt).getTime();
      const chosen = chooseRegister({ override: feeling, tone: interpreted.tone, arousal, callerTone: runtime.call.callerTone, longWait: Number.isFinite(waited) && waited > 120000, firstReply });
      register = chosen.register;
      // The agent's own take in that register (or the workspace's, on a single desk); otherwise the default voice.
      voice = readyVoice(settings.registers?.[register]) || baseVoice;
      runtime.call.voiceId = voice.id;
      tag = tagFor(register, arousal, config.fishModel || 's2.1-pro-free');
      prosody = prosodyFor(arousal);
      const textShown = interpreted.text;
      const line = addLine(runtime, { speaker: 'agent', sourceLang: settings.agentLanguage, targetLang: targetLanguage,
        textSource, textShown, voiceId: voice.id, referenceId: voice.referenceId, delivery: 'pending',
        register, feeling: describe(register, arousal), tag, why: chosen.reason });
      const spoken = taggedText(interpreted.sentences, textShown, register, arousal, config.fishModel || 's2.1-pro-free');
      runtime.replyLineId = line.id; runtime.call.stage = 'synthesizing'; await persist(runtime);
      // Streamed replies play as Fish produces them; a provider without the live socket, or one that fails before the first chunk, takes the one-shot path below.
      if (providers.synthesizeStream) {
        const streamed = await streamReply(runtime, { generation, line, spoken, voice, prosody, signal, current });
        if (streamed !== 'fallback') return streamed;
        if (!current()) return structuredClone(runtime.call);
      }
      const mp3 = await providers.synthesize({ text: spoken, referenceId: voice.referenceId, fallbackReferenceId: voice.elevenReferenceId || '', signal, format: 'mp3', ...prosody });
      if (!current()) return structuredClone(runtime.call);
      const mulaw = await convert(mp3, 'audio/mpeg', { output: 'mulaw', sampleRate: 8000, maxSeconds: 90, signal });
      if (!current()) return structuredClone(runtime.call);
      connected(runtime); runtime.mark = `reply-${generation}-${line.id}`;
      runtime.call.phase = 'playing'; runtime.call.stage = 'playing';
      if (runtime.call.transport === 'browser') {
        if (!Buffer.isBuffer(mp3) || mp3.length > 3 * 1024 * 1024) throw new CallError('The generated reply is too long. Try a shorter sentence.', 422);
        notifyCaller(runtime); captionCaller(runtime, line, 'agent');
        // Decoding above verifies duration and playability; the phone receives the original Fish MP3.
        sendBrowser(runtime, { type: 'audio', callId: runtime.call.id, mimeType: 'audio/mpeg',
          payload: mp3.toString('base64'), playbackId: runtime.mark });
      } else {
        // Fish MP3 is decoded to headerless 8kHz mono G.711 audio. No browser mic bytes reach this path.
        for (let offset = 0; offset < mulaw.length; offset += 8000) {
          send(runtime, { event: 'media', media: { payload: mulaw.subarray(offset, offset + 8000).toString('base64') } });
        }
        send(runtime, { event: 'mark', mark: { name: runtime.mark } });
      }
      runtime.playbackTimer = setTimeout(() => {
        if (!current()) return;
        cancelReply(runtime, 'unconfirmed');
        try { send(runtime, { event: 'clear' }); } catch {}
        warn(runtime, `${runtime.call.transport === 'browser' ? 'The caller browser' : 'Twilio'} did not confirm playback. Ask the caller whether they heard the reply.`);
        void persist(runtime).catch(() => emit({ type: 'error', error: 'The playback result could not be saved.' }));
      }, Math.ceil(mulaw.length / 8) + playbackGraceMs);
      runtime.playbackTimer.unref?.();
      return await persist(runtime);
    } catch (error) {
      if (!current()) return structuredClone(runtime.call);
      cancelReply(runtime, 'failed');
      try { send(runtime, { event: 'clear' }); } catch {}
      warn(runtime, safeError(error)); await persist(runtime);
      if (error instanceof ProviderError || error instanceof AudioError || error instanceof CallError) throw error;
      throw new CallError('The reply could not be delivered. Try again.', 502);
    }
  }
  /** Chunk by chunk to the phone (PCM16 16 kHz) or to Twilio (G.711 8 kHz), 'played' or a mark at the end. */
  async function streamReply(runtime, { generation, line, spoken, voice, prosody, signal, current }) {
    const browser = runtime.call.transport === 'browser';
    const mark = `reply-${generation}-${line.id}`;
    let started = false, bytes = 0, tail = Buffer.alloc(0);
    const begin = () => {
      connected(runtime); runtime.mark = mark;
      runtime.call.phase = 'playing'; runtime.call.stage = 'playing';
      if (browser) { notifyCaller(runtime); captionCaller(runtime, line, 'agent'); sendBrowser(runtime, { type: 'audio-start', callId: runtime.call.id, playbackId: mark, sampleRate: 16000 }); }
      started = true;
    };
    const deliver = chunk => {
      if (!current()) return;
      if (!started) begin();
      bytes += chunk.length;
      if (browser) { sendBrowser(runtime, { type: 'audio-chunk', playbackId: mark, payload: chunk.toString('base64') }); return; }
      // G.711 needs whole 16 kHz sample pairs; carry the odd bytes to the next chunk.
      const buffered = Buffer.concat([tail, chunk]); const usable = buffered.length - buffered.length % 4;
      tail = Buffer.from(buffered.subarray(usable));
      for (let offset = 0; offset < usable; offset += 6400) send(runtime, { event: 'media', media: { payload: pcm16kToMulaw8k(buffered.subarray(offset, Math.min(usable, offset + 6400))).toString('base64') } });
    };
    try {
      await providers.synthesizeStream({ text: spoken, referenceId: voice.referenceId, signal, ...prosody, onChunk: deliver });
    } catch (error) {
      if (!started) {
        // The desk hears a provider's own words; the server keeps the whole thing,
        // because a fallback that happens every time is worth being able to explain.
        console.warn('live speech fell back:', error?.message || error);
        warn(runtime, `Live speech unavailable, using the standard path: ${safeError(error)}`);
        return 'fallback';
      }
      throw error;
    }
    if (!current()) return structuredClone(runtime.call);
    if (!started) throw new CallError('Fish produced no speech for this reply.', 502);
    if (browser) sendBrowser(runtime, { type: 'audio-end', playbackId: mark });
    else send(runtime, { event: 'mark', mark: { name: mark } });
    runtime.playbackTimer = setTimeout(() => {
      if (!current()) return;
      cancelReply(runtime, 'unconfirmed');
      try { send(runtime, { event: 'clear' }); } catch {}
      warn(runtime, `${browser ? 'The caller browser' : 'Twilio'} did not confirm playback. Ask the caller whether they heard the reply.`);
      void persist(runtime).catch(() => emit({ type: 'error', error: 'The playback result could not be saved.' }));
    }, Math.ceil(bytes / 32) + playbackGraceMs);
    runtime.playbackTimer.unref?.();
    return await persist(runtime);
  }
  async function update(id, patch, actor = '') {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)
      || Object.keys(patch).some(key => !['issue', 'address', 'dispatch', 'confirmDispatch'].includes(key))) throw new CallError('Invalid ticket update.', 400);
    if (patch.issue !== undefined) textInput(patch.issue, 4000, 'issue', true);
    if (patch.address !== undefined) textInput(patch.address, 1000, 'address', true);
    if (patch.dispatch !== undefined && !['none', 'requested', 'confirmed', 'pending'].includes(patch.dispatch)) throw new CallError('Choose a valid dispatch state.', 400);
    if (patch.confirmDispatch !== undefined && typeof patch.confirmDispatch !== 'boolean') throw new CallError('Invalid dispatch confirmation.', 400);
    const runtime = live.get(id); let result;
    await store.update(state => {
      const call = state.calls.find(call => call.id === id);
      if (!call) throw new CallError('Call not found.', 404);
      for (const key of ['issue', 'address', 'dispatch']) if (patch[key] !== undefined) call.ticket[key] = patch[key];
      if (patch.confirmDispatch) {
        call.ticket.dispatch = 'confirmed'; call.ticket.dispatchConfirmedAt = now();
        call.ticket.dispatchConfirmedBy = (typeof actor === 'string' && actor.trim().slice(0, 100)) || call.agentName || 'Desk agent';
      }
      result = structuredClone(call);
      if (runtime) runtime.call.ticket = structuredClone(call.ticket);
    });
    emit({ type: 'call', call: runtime ? structuredClone(runtime.call) : result });
    return runtime ? structuredClone(runtime.call) : result;
  }
  async function handleStatus(callSid, status) {
    if (!CALL_SID.test(callSid || '') || typeof status !== 'string' || status.length > 30) throw new CallError('Invalid call status.', 400);
    const runtime = [...live.values()].find(item => item.call.callSid === callSid);
    if (runtime && TERMINAL.has(status)) return finish(runtime);
    return null;
  }
  async function close() {
    await Promise.all([...live.values()].map(runtime => backgroundFinish(runtime, 'The server is shutting down.', true)));
  }
  return { initialize, snapshot, registerInbound, registerBrowserInbound, handleStatus, handleStream, handleBrowserStream, answer, end, stop, update, close, applySettings,
    ptt: (id, { buffer, mimetype, feeling }) => reply(id, { buffer, mimetype, feeling }),
    say: (id, { text, feeling }) => reply(id, { text, feeling }),
  };
}
