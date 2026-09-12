import { spawn } from 'node:child_process';

const INPUT_FORMATS = new Map([
  ['audio/webm', 'matroska'], ['video/webm', 'matroska'],
  ['audio/wav', 'wav'], ['audio/x-wav', 'wav'],
  ['audio/mpeg', 'mp3'], ['audio/mp3', 'mp3'],
  ['audio/mp4', 'mov'], ['audio/x-m4a', 'mov'], ['audio/ogg', 'ogg'],
]);

export class AudioError extends Error {
  constructor(message = 'Audio could not be decoded. Record a new clip.', status = 422) {
    super(message); this.name = 'AudioError'; this.status = status;
  }
}

export function audioMime(value) {
  if (typeof value !== 'string') throw new AudioError('Choose a supported audio file.', 400);
  const mime = value.split(';')[0].trim().toLowerCase();
  if (!INPUT_FORMATS.has(mime)) throw new AudioError('Use WebM, WAV, MP3, M4A, or Ogg audio.', 400);
  return mime;
}

/** Decode uploads with a fixed demuxer, no network protocols, no shell or temp audio files. */
export async function convertAudio(audio, mimeType, {
  output = 'wav', sampleRate = 16000, maxSeconds = 45, minSeconds = 0.15,
  signal, ffmpegPath = 'ffmpeg',
} = {}) {
  if (!Buffer.isBuffer(audio) || audio.length < 32 || audio.length > 30 * 1024 * 1024) {
    throw new AudioError('Audio must be a nonempty clip smaller than 30 MB.', 400);
  }
  const mime = audioMime(mimeType);
  if (!['wav', 'mulaw'].includes(output) || ![8000, 16000, 24000].includes(sampleRate)
    || !Number.isFinite(maxSeconds) || maxSeconds < 1 || maxSeconds > 120
    || !Number.isFinite(minSeconds) || minSeconds < 0 || minSeconds > maxSeconds) {
    throw new AudioError('Invalid audio conversion settings.', 400);
  }
  signal?.throwIfAborted();
  const bytesPerSecond = sampleRate * (output === 'mulaw' ? 1 : 2);
  const maxBytes = Math.ceil(maxSeconds * bytesPerSecond) + (output === 'wav' ? 128 : 0);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-protocol_whitelist', 'pipe', '-f', INPUT_FORMATS.get(mime), '-i', 'pipe:0',
      '-t', String(maxSeconds + 1), '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(sampleRate),
      '-c:a', output === 'mulaw' ? 'pcm_mulaw' : 'pcm_s16le', '-f', output, 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    });
    let settled = false; let size = 0; const chunks = [];
    const finish = (error, data) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', aborted);
      if (error) { child.kill('SIGKILL'); reject(error); } else resolve(data);
    };
    const aborted = () => finish(new AudioError('Audio processing was cancelled.', 409));
    const timer = setTimeout(() => finish(new AudioError('Audio processing timed out.', 504)), 20000);
    timer.unref?.();
    signal?.addEventListener('abort', aborted, { once: true });
    child.on('error', () => finish(new AudioError('Audio conversion is unavailable. Install ffmpeg on the server.', 503)));
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) return finish(new AudioError(`Keep the recording under ${maxSeconds} seconds.`, 400));
      chunks.push(chunk);
    });
    child.on('close', (code) => {
      if (code !== 0) return finish(new AudioError());
      const body = Buffer.concat(chunks);
      const minimum = Math.floor(minSeconds * bytesPerSecond) + (output === 'wav' ? 44 : 0);
      if (body.length < minimum) return finish(new AudioError(`Record at least ${minSeconds} seconds of speech.`, 400));
      finish(null, body);
    });
    child.stdin.end(audio);
    if (signal?.aborted) aborted();
  });
}

export function mulawToPcm(input) {
  if (!Buffer.isBuffer(input) || input.length > 960000) throw new AudioError('Invalid telephone audio.', 400);
  const output = Buffer.allocUnsafe(input.length * 2);
  for (let i = 0; i < input.length; i++) {
    const value = (~input[i]) & 0xff;
    const magnitude = (((value & 0x0f) << 3) + 0x84) << ((value >> 4) & 7);
    output.writeInt16LE((value & 0x80) ? 0x84 - magnitude : magnitude - 0x84, i * 2);
  }
  return output;
}

export function pcmToMulaw(input) {
  if (!Buffer.isBuffer(input) || input.length % 2 || input.length > 1920000) throw new AudioError('Invalid PCM audio.', 400);
  const output = Buffer.allocUnsafe(input.length / 2);
  for (let i = 0; i < output.length; i++) {
    let sample = input.readInt16LE(i * 2); const sign = sample < 0 ? 0x80 : 0;
    sample = Math.min(Math.abs(sample), 32635) + 0x84;
    let exponent = 7;
    for (let mask = 0x4000; exponent > 0 && !(sample & mask); exponent--, mask >>= 1) {}
    output[i] = (~(sign | (exponent << 4) | ((sample >> (exponent + 3)) & 0x0f))) & 0xff;
  }
  return output;
}

/** Downsample paired 16kHz samples for the existing 8kHz desk audio player. */
export function pcm16kToMulaw8k(input) {
  if (!Buffer.isBuffer(input) || input.length % 4 || input.length > 6400) throw new AudioError('Invalid browser microphone frame.', 400);
  const pcm8k = Buffer.allocUnsafe(input.length / 2);
  for (let i = 0; i < input.length; i += 4) {
    pcm8k.writeInt16LE(Math.round((input.readInt16LE(i) + input.readInt16LE(i + 2)) / 2), i / 2);
  }
  return pcmToMulaw(pcm8k);
}

/** Audible waiting tone, not a voice: actual conversation speech always comes from Fish. */
export function ringbackTone() {
  const pcm = Buffer.alloc(16000);
  for (let i = 0; i < 8000; i++) {
    const envelope = Math.min(1, i / 80, (7999 - i) / 80);
    pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 425 * i / 8000) * 2500 * envelope), i * 2);
  }
  return pcmToMulaw(pcm);
}

export function pcmToWav(pcm, sampleRate = 8000) {
  if (!Buffer.isBuffer(pcm) || pcm.length % 2 || pcm.length > 4000000
    || ![8000, 16000, 24000].includes(sampleRate)) throw new AudioError('Invalid PCM audio.', 400);
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(pcm.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class SpeechSegmenter {
  constructor({ threshold = 250, silenceMs = 700, maxMs = 8000, minSpeechMs = 240, format = 'mulaw', sampleRate = 8000 } = {}) {
    if (!((format === 'mulaw' && sampleRate === 8000) || (format === 'pcm' && sampleRate === 16000))) throw new AudioError('Invalid speech segmentation format.', 400);
    this.format = format; this.sampleRate = sampleRate;
    const bytesPerMs = sampleRate / 1000 * (format === 'pcm' ? 2 : 1);
    this.threshold = threshold; this.silenceBytes = silenceMs * bytesPerMs;
    this.maxBytes = maxMs * bytesPerMs; this.minSpeechBytes = minSpeechMs * bytesPerMs;
    this.prerollBytes = 160 * bytesPerMs; this.reset();
  }
  reset() { this.parts = []; this.bytes = 0; this.silent = 0; this.voiced = 0; this.preroll = Buffer.alloc(0); }
  push(audio) {
    if (!Buffer.isBuffer(audio) || audio.length > 6400 || (this.format === 'pcm' && audio.length % 2)) throw new AudioError('Invalid microphone audio.', 400);
    const pcm = this.format === 'pcm' ? audio : mulawToPcm(audio);
    let energy = 0;
    for (let i = 0; i < pcm.length; i += 2) energy += pcm.readInt16LE(i) ** 2;
    const speech = pcm.length > 0 && Math.sqrt(energy / (pcm.length / 2)) >= this.threshold;
    if (!this.parts.length && !speech) {
      this.preroll = Buffer.concat([this.preroll, audio]).subarray(-this.prerollBytes);
      return null;
    }
    if (!this.parts.length && this.preroll.length) { this.parts.push(this.preroll); this.bytes += this.preroll.length; }
    this.parts.push(audio); this.bytes += audio.length;
    this.silent = speech ? 0 : this.silent + audio.length;
    if (speech) this.voiced += audio.length;
    if (this.silent >= this.silenceBytes || this.bytes >= this.maxBytes) return this.flush();
    return null;
  }
  flush() {
    const audio = Buffer.concat(this.parts);
    const result = this.voiced >= this.minSpeechBytes ? pcmToWav(this.format === 'pcm' ? audio : mulawToPcm(audio), this.sampleRate) : null;
    this.reset(); return result;
  }
}
