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
  constructor({ onChunk, onPlayed, onPlayback, onAudioState, onMicrophoneEnded }) {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('This browser does not support call audio. Please open the link in Safari or Chrome.');
    this.context = new Context({ latencyHint: 'interactive' });
    this.onChunk = onChunk;
    this.onPlayed = onPlayed;
    this.onPlayback = onPlayback;
    this.onAudioState = onAudioState;
    this.onMicrophoneEnded = onMicrophoneEnded;
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
  async startMicrophone() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access needs a secure HTTPS page. Open the public call link in Safari or Chrome.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
    if (this.disposed) { stream.getTracks().forEach(track => track.stop()); return; }
    this.stream = stream;
    for (const track of stream.getAudioTracks()) track.onended = () => { if (!this.disposed) this.onMicrophoneEnded?.(); };
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
    if (this.listening === Boolean(enabled)) return;
    this.listening = Boolean(enabled);
    this.encoder?.reset();
    this.processor?.port?.postMessage({ enabled: this.listening });
  }
  clearPlayback() {
    this.generation += 1;
    const source = this.source;
    this.source = null;
    if (source) { source.onended = null; try { source.stop(); } catch {} try { source.disconnect(); } catch {} }
    this.onPlayback?.(false);
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
    source.connect(this.context.destination);
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
    this.stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    if (this.processor?.port) this.processor.port.onmessage = null;
    if (this.processor?.onaudioprocess) this.processor.onaudioprocess = null;
    try { this.microphone?.disconnect(); } catch {}
    try { this.processor?.disconnect(); } catch {}
    try { this.sink?.disconnect(); } catch {}
    this.context.onstatechange = null;
    this.context.close().catch(() => {});
  }
}
