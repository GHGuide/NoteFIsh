// Streaming resampler used by the fallback capture path. Every callback emits
// exactly 100 ms of PCM16LE, mono, 16 kHz (3,200 bytes), never raw device-rate data.
export class Pcm16Encoder {
  constructor(inputRate, onChunk) {
    if (!Number.isFinite(inputRate) || inputRate < 8000) throw new Error('Unsupported microphone sample rate.');
    this.ratio = inputRate / 16000;
    this.onChunk = onChunk;
    this.reset();
  }
  reset() { this.remaining = this.ratio; this.sum = 0; this.offset = 0; this.buffer = new ArrayBuffer(3200); this.view = new DataView(this.buffer); }
  write(input) {
    for (const sample of input) {
      let available = 1;
      while (available > 0.000001) {
        const weight = Math.min(available, this.remaining);
        this.sum += sample * weight;
        this.remaining -= weight;
        available -= weight;
        if (this.remaining <= 0.000001) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.view.setInt16(this.offset, Math.round(value * (value < 0 ? 32768 : 32767)), true);
          this.offset += 2;
          this.remaining = this.ratio;
          this.sum = 0;
          if (this.offset === 3200) { this.onChunk(this.buffer); this.buffer = new ArrayBuffer(3200); this.view = new DataView(this.buffer); this.offset = 0; }
        }
      }
    }
  }
}

export class BrowserCallAudio {
  constructor({ onChunk, onPlayed, onPlayback, onAudioState, onMicrophoneEnded, onMicrophoneState }) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('This browser does not support call audio. Please open the link in Safari or Chrome.');
    this.context = new Context({ latencyHint: 'interactive' });
    this.playbackAnalyser = this.context.createAnalyser();
    this.playbackAnalyser.fftSize = 2048;
    this.playbackAnalyser.connect(this.context.destination);
    this.onChunk = onChunk;
    this.onPlayed = onPlayed;
    this.onPlayback = onPlayback;
    this.onAudioState = onAudioState;
    this.onMicrophoneEnded = onMicrophoneEnded;
    this.onMicrophoneState = onMicrophoneState;
    this.userMuted = false;
    this.deviceMuted = false;
    this.listening = false;
    this.disposed = false;
    this.generation = 0;
    this.source = null;
    this.context.onstatechange = () => { if (!this.disposed) this.onAudioState?.(this.context.state); };
  }
  // Invoke immediately from the Call button gesture, before requesting the mic.
  async unlock() {
    await this.context.resume();
    if (this.context.state !== 'running') throw new Error('Tap Enable audio to allow sound for this call.');
  }
  async prepare() {
    // Both operations begin in the tap gesture. A suspended AudioContext must
    // not hold an already-approved microphone behind a never-resolving resume.
    void this.unlock().catch(() => { if (!this.disposed) this.onAudioState?.(this.context.state); });
    await this.startMicrophone();
  }
  async startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs a secure HTTPS page. Open the public call link in Safari or Chrome.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
    if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    const updateTrackState = () => {
      this.deviceMuted = stream.getAudioTracks().some(track => track.muted || track.readyState !== 'live');
      if (this.deviceMuted) this.setListening(false);
      if (!this.disposed) this.onMicrophoneState?.({ muted: this.deviceMuted });
    };
    for (const track of stream.getAudioTracks()) {
      track.enabled = !this.userMuted;
      track.onended = () => { if (!this.disposed) this.onMicrophoneEnded?.(); };
      track.onmute = updateTrackState; track.onunmute = updateTrackState;
    }
    updateTrackState();
    this.microphone = this.context.createMediaStreamSource(stream);
    const sink = this.context.createGain();
    sink.gain.value = 0;
    sink.connect(this.context.destination);
    this.sink = sink;
    if (this.context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        await this.context.audioWorklet.addModule(new URL('./pcm-worklet.js?no-inline', import.meta.url).href);
        if (this.disposed) return;
        this.processor = new AudioWorkletNode(this.context, 'notefish-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
        this.processor.port.onmessage = event => { if (this.listening && !this.disposed) this.onChunk(event.data); };
        this.processor.port.postMessage({ enabled: this.listening });
      } catch { /* Older Safari and restricted worklet environments use the same PCM contract below. */ }
    }
    if (this.disposed) return;
    if (!this.processor) {
      this.encoder = new Pcm16Encoder(this.context.sampleRate, chunk => this.onChunk(chunk));
      this.processor = this.context.createScriptProcessor(2048, 1, 1);
      this.processor.onaudioprocess = event => { if (this.listening && !this.disposed) this.encoder.write(event.inputBuffer.getChannelData(0)); };
    }
    this.microphone.connect(this.processor);
    this.processor.connect(sink);
  }
  setListening(enabled) {
    const allowed = Boolean(enabled) && !this.userMuted && !this.deviceMuted && !this.disposed;
    if (this.listening === allowed) return;
    this.listening = allowed;
    this.encoder?.reset();
    this.processor?.port?.postMessage({ enabled: this.listening });
  }
  setMuted(muted) {
    this.userMuted = Boolean(muted);
    for (const track of this.stream?.getAudioTracks() || []) track.enabled = !this.userMuted;
    if (this.userMuted) this.setListening(false);
  }
  clearPlayback() {
    this.generation += 1;
    this.reply = null;
    const source = this.source;
    this.source = null;
    if (source) { source.onended = null; try { source.stop(); } catch {} try { source.disconnect(); } catch {} }
    this.onPlayback?.(false);
  }
  /** A streamed reply: PCM16 chunks scheduled back to back as they arrive; played is
   * acknowledged when the last scheduled buffer has actually finished. */
  beginStream(playbackId, sampleRate = 16000) {
    this.clearPlayback();
    if (this.disposed || this.context.state !== 'running') return;
    this.reply = { playbackId, sampleRate, generation: this.generation, nextTime: 0, pending: 0, ended: false };
    this.setListening(false);
    this.onPlayback?.(true);
  }
  pushChunk(playbackId, payload) {
    const stream = this.reply;
    if (!stream || stream.playbackId !== playbackId || stream.generation !== this.generation || this.disposed) return;
    const encoded = atob(payload);
    const samples = new Int16Array(Math.floor(encoded.length / 2));
    for (let index = 0; index < samples.length; index++) samples[index] = (encoded.charCodeAt(index * 2) | (encoded.charCodeAt(index * 2 + 1) << 8)) << 16 >> 16;
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, stream.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index++) channel[index] = samples[index] / 32768;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackAnalyser);
    const start = Math.max(this.context.currentTime + 0.02, stream.nextTime);
    stream.nextTime = start + buffer.duration;
    stream.pending += 1;
    source.onended = () => {
      source.disconnect();
      if (this.reply !== stream) return;
      stream.pending -= 1;
      if (stream.ended && stream.pending === 0) this.finishStream(stream);
    };
    source.start(start);
  }
  endStream(playbackId) {
    const stream = this.reply;
    if (!stream || stream.playbackId !== playbackId) return;
    stream.ended = true;
    if (stream.pending === 0) this.finishStream(stream);
  }
  finishStream(stream) {
    if (this.reply !== stream) return;
    this.reply = null;
    this.onPlayback?.(false);
    this.onPlayed(stream.playbackId);
  }
  async play(payload, playbackId) {
    this.clearPlayback();
    const generation = this.generation;
    if (this.disposed) return;
    if (this.context.state !== 'running') throw new Error('Audio is paused. Tap Enable audio to hear the reply.');
    const encoded = atob(payload);
    const bytes = new Uint8Array(encoded.length);
    for (let index = 0; index < encoded.length; index++) bytes[index] = encoded.charCodeAt(index);
    const buffer = await this.context.decodeAudioData(bytes.buffer);
    if (this.disposed || generation !== this.generation) return;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackAnalyser);
    this.source = source;
    this.setListening(false);
    source.onended = () => {
      if (this.disposed || this.source !== source || generation !== this.generation) return;
      this.source = null;
      source.disconnect();
      this.onPlayback?.(false);
      // Acknowledgement follows actual playback completion, never receipt or decode.
      this.onPlayed(playbackId);
    };
    source.start();
    this.onPlayback?.(true);
  }
  stop() {
    if (this.disposed) return;
    this.disposed = true;
    this.setListening(false);
    this.clearPlayback();
    this.stream?.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.onunmute = null; track.stop(); });
    if (this.processor?.port) this.processor.port.onmessage = null;
    if (this.processor?.onaudioprocess) this.processor.onaudioprocess = null;
    try { this.microphone?.disconnect(); } catch {}
    try { this.processor?.disconnect(); } catch {}
    try { this.sink?.disconnect(); } catch {}
    try { this.playbackAnalyser?.disconnect(); } catch {}
    this.context.onstatechange = null;
    this.context.close().catch(() => {});
  }
}
