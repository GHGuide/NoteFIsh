import { randomUUID } from 'node:crypto';
import { convertAudio, SpeechSegmenter, AudioError, ringbackTone, pcm16kToMulaw8k } from './audio.mjs';
import { ProviderError } from './providers.mjs';
import { languageCodes } from './languages.mjs';

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

/** One real caller, one desk. Only synthesized Fish speech reaches the caller. */
export function createCallService({
  config, store, providers, broadcast,
  convert = convertAudio, fetchImpl = globalThis.fetch,
  noAnswerMs = 60000, maxCallMs = 3600000, playbackGraceMs = 10000,
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
  const emit = event => { try { broadcast(event); } catch { /* A browser disconnect cannot interrupt a phone call. */ } };
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
  function notifyCaller(runtime) {
    if (runtime.call.transport !== 'browser' || runtime.ws?.readyState !== 1) return;
    try {
      // A caller link never exposes desk tickets, voice IDs or conversation transcripts.
      sendBrowser(runtime, { type: 'state', callId: runtime.call.id, state: runtime.call.state,
        phase: runtime.call.phase, customerLanguage: runtime.call.customerLanguage });
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
    cancelReply(runtime); runtime.captionAbort.abort(); runtime.captionQueue.length = 0;
    clearTimeout(runtime.noAnswerTimer); clearTimeout(runtime.lifetimeTimer); clearInterval(runtime.ringbackTimer); clearInterval(runtime.heartbeatTimer);
    runtime.call.state = 'ended'; runtime.call.endedAt = now(); runtime.call.mediaConnected = false;
    if (reason) runtime.call.error = reason;
    notifyCaller(runtime);
    const ws = runtime.ws; runtime.ws = null;
    // Closing Connect/Stream continues the webhook's final Hangup instruction.
    if (ws && ws.readyState < 2) ws.close(1000, 'Call ended');
    const saved = await persist(runtime);
    live.delete(runtime.call.id);
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
        const { audio, sourceLanguage, targetLanguage } = runtime.captionQueue.shift();
        const signal = runtime.captionAbort.signal;
        try {
          const textSource = await providers.transcribe({ audio, mimeType: 'audio/wav', language: sourceLanguage, signal });
          if (!textSource?.trim()) continue;
          const textShown = await providers.translate({ text: textSource, sourceLanguage, targetLanguage, signal });
          if (runtime.call.state !== 'in_call' || signal.aborted) break;
          addLine(runtime, { speaker: 'customer', sourceLang: sourceLanguage, targetLang: targetLanguage, textSource, textShown, delivery: 'caption' });
          await persist(runtime);
        } catch (error) {
          if (runtime.call.state !== 'in_call' || signal.aborted) break;
          warn(runtime, safeError(error)); await persist(runtime);
        }
      }
    } catch { emit({ type: 'error', error: 'A caption could not be saved.' }); }
    finally { runtime.captionRunning = false; }
  }
  function queueCaption(runtime, audio) {
    if (!audio) return;
    if (runtime.captionQueue.length >= 3) {
      if (Date.now() - runtime.lastQueueWarning > 10000) {
        runtime.lastQueueWarning = Date.now();
        warn(runtime, 'Captions are falling behind. A speech segment was skipped; ask the caller to repeat it.');
      }
      return;
    }
    const settings = runtime.call;
    if (!languageCodes.has(settings.customerLanguage) || !languageCodes.has(settings.agentLanguage)) {
      warn(runtime, 'Choose supported call languages before continuing captions.'); return;
    }
    runtime.captionQueue.push({ audio, sourceLanguage: settings.customerLanguage, targetLanguage: settings.agentLanguage });
    void drainCaptions(runtime);
  }

  async function applySettings(settings) {
    if (!languageCodes.has(settings.customerLanguage) || !languageCodes.has(settings.agentLanguage)) throw new CallError('Choose supported call languages.', 400);
    const pending = [];
    for (const runtime of live.values()) {
      if (runtime.call.state === 'ended' || (runtime.call.customerLanguage === settings.customerLanguage && runtime.call.agentLanguage === settings.agentLanguage)) continue;
      // Finish the current phrase with its original language hint. Already queued
      // captions and an in-flight reply keep their own captured language pair.
      if (runtime.call.state === 'in_call') queueCaption(runtime, runtime.segmenter.flush());
      runtime.call.customerLanguage = settings.customerLanguage;
      runtime.call.agentLanguage = settings.agentLanguage;
      pending.push(persist(runtime));
    }
    await Promise.all(pending);
  }

  async function createInboundCall({ callSid, from, to, transport }) {
    await initialize();
    const duplicate = [...live.values()].find(value => value.call.callSid === callSid);
    if (duplicate) return structuredClone(duplicate.call);
    if (store.snapshot().calls.some(call => call.callSid === callSid)) throw new CallError('This call has already ended.');
    if (live.size) throw new CallError('The desk is already handling another call.');
    const settings = store.snapshot().settings;
    if (!languageCodes.has(settings.agentLanguage) || !languageCodes.has(settings.customerLanguage)) throw new CallError('Configure valid call languages before receiving a call.', 503);
    const call = {
      id: randomUUID(), callSid, from, to, transport, state: 'ringing', phase: 'listening', stage: 'waiting', mediaConnected: false,
      startedAt: now(), answeredAt: null, endedAt: null,
      voiceId: settings.voiceId, agentLanguage: settings.agentLanguage, customerLanguage: settings.customerLanguage,
      transcript: [], ticket: { issue: '', address: '', dispatch: 'none' },
    };
    const runtime = { call, ws: null, streamSid: null,
      segmenter: new SpeechSegmenter(transport === 'browser' ? { format: 'pcm', sampleRate: 16000 } : {}), run: 0, busy: false,
      captionAbort: new AbortController(), captionQueue: [], captionRunning: false, lastQueueWarning: 0,
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
  async function registerBrowserInbound() {
    return createInboundCall({ callSid: `browser:${randomUUID()}`, from: 'Browser caller', to: 'Browser desk', transport: 'browser' });
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
            emit({ type: 'audio', callId, payload: audio.toString('base64') });
          }
          queueCaption(runtime, runtime.segmenter.push(raw));
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
        emit({ type: 'audio', callId: runtime.call.id, payload });
        queueCaption(runtime, runtime.segmenter.push(frame));
      })().catch(() => fail());
    });
    ws.on('close', () => {
      clearTimeout(startTimer);
      if (runtime && runtime.call.state !== 'ended') void backgroundFinish(runtime, 'The phone disconnected.');
    });
    ws.on('error', () => fail());
  }

  async function answer(id) {
    const runtime = find(id); connected(runtime);
    if (runtime.call.state === 'in_call') return structuredClone(runtime.call);
    clearTimeout(runtime.noAnswerTimer); clearInterval(runtime.ringbackTimer);
    send(runtime, { event: 'clear' });
    runtime.call.state = 'in_call'; runtime.call.answeredAt = now();
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
  async function reply(id, { buffer, mimetype, text }) {
    const runtime = find(id, true); connected(runtime);
    if (runtime.busy) throw new CallError('Wait for the current reply, or stop it before starting another.');
    const state = store.snapshot(); const settings = state.settings;
    const voice = state.voices.find(voice => voice.id === settings.voiceId);
    if (!voice || voice.status !== 'ready' || voice.archived || !['enrolled', 'licensed'].includes(voice.kind)) throw new CallError('Select a ready, enrolled or licensed voice before speaking.');
    if (!languageCodes.has(settings.agentLanguage) || !languageCodes.has(settings.customerLanguage)) throw new CallError('Choose supported call languages.');
    if (text !== undefined) text = textInput(text, 3000, 'reply text');
    else if (!Buffer.isBuffer(buffer) || buffer.length > 12 * 1024 * 1024) throw new CallError('Provide a short microphone recording.', 400);
    queueCaption(runtime, runtime.segmenter.flush());
    runtime.busy = true; const generation = ++runtime.run;
    const controller = new AbortController(); runtime.replyAbort = controller;
    const signal = controller.signal; runtime.call.error = undefined;
    runtime.call.voiceId = voice.id; runtime.call.agentLanguage = settings.agentLanguage;
    runtime.call.customerLanguage = settings.customerLanguage; runtime.call.phase = 'translating';
    runtime.call.stage = text === undefined ? 'transcribing' : 'translating';
    const current = () => runtime.run === generation && runtime.call.state === 'in_call' && !signal.aborted;
    try {
      await persist(runtime);
      let textSource = text;
      if (textSource === undefined) {
        const audio = await convert(buffer, mimetype, { output: 'wav', sampleRate: 16000, minSeconds: 0.25, maxSeconds: 45, signal });
        if (!current()) return structuredClone(runtime.call);
        textSource = await providers.transcribe({ audio, mimeType: 'audio/wav', language: settings.agentLanguage, signal });
      }
      if (!current()) return structuredClone(runtime.call);
      if (!textSource?.trim()) throw new CallError('No speech was detected. Hold the button and try again.', 422);
      runtime.call.stage = 'translating'; await persist(runtime);
      const textShown = await providers.translate({ text: textSource, sourceLanguage: settings.agentLanguage, targetLanguage: settings.customerLanguage, signal });
      if (!current()) return structuredClone(runtime.call);
      const line = addLine(runtime, { speaker: 'agent', sourceLang: settings.agentLanguage, targetLang: settings.customerLanguage,
        textSource, textShown, voiceId: voice.id, referenceId: voice.referenceId, delivery: 'pending' });
      runtime.replyLineId = line.id; runtime.call.stage = 'synthesizing'; await persist(runtime);
      const mp3 = await providers.synthesize({ text: textShown, referenceId: voice.referenceId, signal, format: 'mp3' });
      if (!current()) return structuredClone(runtime.call);
      const mulaw = await convert(mp3, 'audio/mpeg', { output: 'mulaw', sampleRate: 8000, maxSeconds: 90, signal });
      if (!current()) return structuredClone(runtime.call);
      connected(runtime); runtime.mark = `reply-${generation}-${line.id}`;
      runtime.call.phase = 'playing'; runtime.call.stage = 'playing';
      if (runtime.call.transport === 'browser') {
        if (!Buffer.isBuffer(mp3) || mp3.length > 3 * 1024 * 1024) throw new CallError('The generated reply is too long. Try a shorter sentence.', 422);
        notifyCaller(runtime);
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
  async function update(id, patch) {
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
        call.ticket.dispatch = 'confirmed'; call.ticket.dispatchConfirmedAt = now(); call.ticket.dispatchConfirmedBy = 'Desk agent';
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
    ptt: (id, { buffer, mimetype }) => reply(id, { buffer, mimetype }),
    say: (id, { text }) => reply(id, { text }),
  };
}
