// The phone's inbound channel is receive-only in the browser. Microphone clips
// are uploaded separately for transcription; no microphone is sent to Twilio.
export class CallerAudio {
  constructor() { this.context = null; this.nextTime = 0; this.sources = new Set(); this.ringSources = new Set(); this.ringTimer = null; }
  async enable() {
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) throw new Error('This browser does not support call audio. Use a current Chrome, Edge, or Safari browser.');
    if (!this.context) this.context = new Context();
    await this.context.resume();
  }
  play(payload, sampleRate = 8000) {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const raw = atob(payload);
    const buffer = this.context.createBuffer(1, raw.length, sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < raw.length; i++) {
      const byte = ~raw.charCodeAt(i) & 255;
      const sign = byte & 128;
      const exponent = (byte >> 4) & 7;
      const mantissa = byte & 15;
      const value = (((mantissa << 3) + 132) << exponent) - 132;
      samples[i] = (sign ? -value : value) / 32768;
    }
    // Drop a stale browser queue instead of allowing latency to grow forever.
    if (this.nextTime > this.context.currentTime + 0.65) this.clear();
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    const start = Math.max(this.context.currentTime + 0.025, this.nextTime);
    source.start(start);
    this.nextTime = start + buffer.duration;
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);
  }
  clear() {
    for (const source of this.sources) { try { source.stop(); } catch {} }
    this.sources.clear();
    this.nextTime = 0;
  }
  setRinging(enabled) {
    this.stopRinging();
    if (!enabled || !this.context) return;
    const tone = () => {
      if (this.context.state !== 'running') return;
      const start = this.context.currentTime;
      for (const delay of [0, 0.32]) {
        const gain = this.context.createGain();
        gain.gain.setValueAtTime(0, start + delay);
        gain.gain.linearRampToValueAtTime(0.025, start + delay + 0.02);
        gain.gain.setValueAtTime(0.025, start + delay + 0.17);
        gain.gain.linearRampToValueAtTime(0, start + delay + 0.23);
        gain.connect(this.context.destination);
        for (const frequency of [660, 880]) {
          const oscillator = this.context.createOscillator();
          oscillator.type = 'sine'; oscillator.frequency.value = frequency;
          oscillator.connect(gain); this.ringSources.add(oscillator);
          oscillator.onended = () => { this.ringSources.delete(oscillator); oscillator.disconnect(); };
          oscillator.start(start + delay); oscillator.stop(start + delay + 0.24);
        }
      }
    };
    tone();
    this.ringTimer = setInterval(tone, 2200);
  }
  stopRinging() {
    clearInterval(this.ringTimer); this.ringTimer = null;
    for (const source of this.ringSources) { try { source.stop(); } catch {} }
    this.ringSources.clear();
  }
}

export function recordingType() {
  if (!window.MediaRecorder) throw new Error('Audio recording is unavailable in this browser. Use Chrome or upload an audio file.');
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type)) || '';
}
