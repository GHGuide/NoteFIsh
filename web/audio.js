// The phone's inbound channel is receive-only in the browser. Microphone clips
// are uploaded separately for transcription; no microphone is sent to Twilio.
export function audioRms(samples) {
  if (!(samples instanceof Float32Array) || !samples.length) return 0;
  let energy = 0;
  for (const sample of samples) energy += Number.isFinite(sample) ? Math.min(1, Math.abs(sample)) ** 2 : 0;
  return Math.sqrt(energy / samples.length);
}

export function audioPeaks(samples, count = 48) {
  if (!(samples instanceof Float32Array) || !Number.isInteger(count) || count < 1 || count > 128) return [];
  return Array.from({ length: count }, (_, index) => {
    const start = Math.floor(index * samples.length / count);
    const end = Math.max(start + 1, Math.floor((index + 1) * samples.length / count));
    let peak = 0;
    for (let offset = start; offset < Math.min(end, samples.length); offset++) {
      const sample = samples[offset];
      if (Number.isFinite(sample)) peak = Math.max(peak, Math.min(1, Math.abs(sample)));
    }
    return peak;
  });
}

// A seekable preview with an explicit sample count. MediaRecorder WebM clips
// often omit duration metadata, which makes native seeking unreliable.
export function audioBufferToWav(buffer) {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(bytes);
  const word = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true); word(36, 'data'); view.setUint32(40, bytes.byteLength - 44, true);
  const samples = Array.from({ length: channels }, (_, i) => buffer.getChannelData(i));
  for (let frame = 0; frame < buffer.length; frame++) for (let channel = 0; channel < channels; channel++) {
    const sample = Math.max(-1, Math.min(1, samples[channel][frame] || 0));
    view.setInt16(44 + (frame * channels + channel) * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
  }
  return new Blob([bytes], { type: 'audio/wav' });
}

export function audioTime(seconds) {
  const whole = Math.floor(Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

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
