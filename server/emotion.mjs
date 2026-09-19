/**
 * How the agent said it, measured from their own push-to-talk clip.
 *
 * Research summary (docs/…/research report, Finding 5): text alone decides the
 * emotion a TTS model renders, so the clip has to be measured. Two cheap
 * proxies carry arousal well enough for a call desk: loudness of the voiced
 * part and speaking rate, both relative to the agent's own reference. Valence
 * (calm / warm / energetic / reassuring / apologetic / firm) comes from the interpreter's tone label.
 */
export const REGISTERS = ['calm', 'warm', 'energetic', 'reassuring', 'apologetic', 'firm'];
/** Older names still stored or sent by old clients. `brisk` was renamed on 17 Sep 2026. */
const ALIASES = { brisk: 'energetic' };
export const canonicalRegister = value => (typeof value === 'string' && ALIASES[value]) || value;
/** How a line was said, as the interpreter labels it. `upset` only ever comes from the caller's side. */
export const TONES = [...REGISTERS, 'upset'];
/** Fish S2 tags the interpreter may attach to a sentence. Anything else is dropped before synthesis. */
export const SENTENCE_TAGS = ['calm', 'warm', 'cheerful', 'reassuring', 'empathetic', 'apologetic', 'sincerely apologetic', 'soft tone', 'firm', 'in a hurry tone', 'whispering', 'sigh', 'laughing'];

const FRAME = 320; // 20 ms at 16 kHz

/** Per-frame RMS in dBFS for 16 kHz mono PCM16 WAV; skips the 44-byte header. */
function frames(wav) {
  const start = wav.length > 44 && wav.toString('ascii', 0, 4) === 'RIFF' ? 44 : 0;
  const out = [];
  for (let i = start; i + FRAME * 2 <= wav.length; i += FRAME * 2) {
    let sum = 0;
    for (let j = 0; j < FRAME; j++) { const v = wav.readInt16LE(i + j * 2) / 32768; sum += v * v; }
    out.push(20 * Math.log10(Math.sqrt(sum / FRAME) + 1e-6)); // dBFS of the frame's RMS
  }
  return out;
}

function percentile(values, p) {
  if (!values.length) return -120;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/** Loudness, rate and noise of a clip. `words` is the transcript's word count. */
export function measureClip(wav, words = 0) {
  const db = frames(wav);
  if (!db.length) return { loudness: -120, rate: 0, voicedSeconds: 0, snr: 0 };
  const floor = percentile(db, 0.1);
  const gate = Math.max(floor + 10, -60);
  const voiced = db.filter(v => v > gate);
  const loudness = voiced.length ? voiced.reduce((a, b) => a + b, 0) / voiced.length : floor;
  const voicedSeconds = voiced.length * FRAME / 16000;
  return {
    loudness: Number(loudness.toFixed(1)),
    rate: voicedSeconds > 0.4 ? Number((words / voicedSeconds).toFixed(2)) : 0,
    voicedSeconds: Number(voicedSeconds.toFixed(2)),
    snr: Number((percentile(db, 0.9) - floor).toFixed(1)),
  };
}

/** Arousal of a clip against the agent's reference. No reference: sensible defaults. */
export function arousalOf(clip, baseline = { loudness: -26, rate: 2.6 }) {
  const louder = clip.loudness - (baseline.loudness ?? -26);
  const faster = baseline.rate ? clip.rate / baseline.rate : 1;
  const score = (louder / 6) + ((faster - 1) * 2);
  const level = score > 0.6 ? 'high' : score < -0.6 ? 'low' : 'medium';
  return { level, louderDb: Number(louder.toFixed(1)), rateRatio: Number(faster.toFixed(2)) };
}

/** The register a reply should be spoken in, from what was said and how. */
export function registerFor(tone, arousal) {
  tone = canonicalRegister(tone);
  if (tone === 'apologetic') return 'apologetic';
  if (tone === 'upset') return 'firm'; // an agent who sounds upset is voiced firm, never apologetic by accident
  if (arousal?.level === 'high') return tone === 'firm' ? 'firm' : 'energetic';
  return REGISTERS.includes(tone) ? tone : 'calm';
}

/** Every signal, one decision. A feeling the agent chose wins; then the caller's
 * state (an upset caller gets an apology however flat the agent sounded; a long
 * wait earns one on the first reply); then how the agent actually said it. */
export function chooseRegister({ override, tone, arousal, callerTone, longWait = false, firstReply = false } = {}) {
  override = canonicalRegister(override);
  if (REGISTERS.includes(override)) return { register: override, reason: 'chosen' };
  const own = registerFor(tone, arousal);
  if (own === 'apologetic') return { register: own, reason: 'said' };
  // Firm is deliberate ("I need you to stop shouting"); everything else yields to an upset caller.
  if (callerTone === 'upset' && own !== 'firm') return { register: 'apologetic', reason: 'caller upset' };
  if (longWait && firstReply && own === 'calm') return { register: 'apologetic', reason: 'long wait' };
  if (callerTone === 'warm' && own === 'calm') return { register: 'warm', reason: 'caller warm' };
  return { register: own, reason: 'said' };
}

const TAGS = {
  calm: { low: '[calm, soft tone]', medium: '[calm]', high: '[calm but firm]' },
  warm: { low: '[warm, soft tone]', medium: '[warm, friendly]', high: '[warm, upbeat]' },
  energetic: { low: '[cheerful]', medium: '[energetic, upbeat]', high: '[excited, in a hurry tone]' },
  reassuring: { low: '[reassuring, soft tone]', medium: '[reassuring]', high: '[reassuring, confident]' },
  apologetic: { low: '[sincerely apologetic, soft tone]', medium: '[sincerely apologetic]', high: '[apologetic, earnest]' },
  firm: { low: '[firm, calm]', medium: '[firm]', high: '[firm, serious tone]' },
};

/** One S2 tag at the start of the sentence — Fish's rule: one emotion, first position. */
export function tagFor(register, arousal, model = 's2.1-pro') {
  if (!/^s2/u.test(model)) return '';
  return (TAGS[canonicalRegister(register)] || TAGS.calm)[arousal?.level || 'medium'];
}

/** The text Fish speaks: the register's tag leads the first sentence (the dominant
 * feeling must match the take that voices it); later sentences carry the
 * interpreter's tag when it is on the allowlist. S1 gets plain text. */
export function taggedText(sentences, text, register, arousal, model = 's2.1-pro') {
  const lead = tagFor(register, arousal, model);
  const whole = String(text || '').trim();
  if (!lead) return whole;
  const list = Array.isArray(sentences) ? sentences.filter(s => s && typeof s.text === 'string' && s.text.trim()).slice(0, 24) : [];
  const joined = list.map(s => s.text.trim()).join(' ');
  // The split must be the same words; a rewrite or a truncation falls back to one tag.
  if (!list.length || Math.abs(joined.length - whole.length) > Math.max(8, whole.length * 0.1)) return `${lead} ${whole}`;
  return list.map((s, i) => {
    const clean = typeof s.tag === 'string' ? s.tag.trim().toLowerCase() : '';
    const tag = i === 0 ? lead : (SENTENCE_TAGS.includes(clean) ? `[${clean}]` : '');
    return tag ? `${tag} ${s.text.trim()}` : s.text.trim();
  }).join(' ');
}

/** Speaking-rate and sampling settings derived from arousal. */
export function prosodyFor(arousal) {
  const speed = Math.min(1.2, Math.max(0.9, arousal?.rateRatio || 1));
  const temperature = arousal?.level === 'high' ? 0.8 : arousal?.level === 'low' ? 0.5 : 0.65;
  return { speed: Number(speed.toFixed(2)), temperature };
}

/** Reads the assessment back into plain words for the transcript. */
export function describe(register, arousal) {
  const level = { low: 'gentle', medium: '', high: 'strong' }[arousal?.level || 'medium'];
  return level ? `${register} · ${level}` : register;
}

// ponytail: loudness + rate, no pitch tracking. Add F0 range if listening tests say arousal is misread.

/** How the reply was said, in words the interpreter can act on. Both numbers come from
 *  the speaker's own clip measured against their own enrolment, so "louder" means
 *  louder than they usually are, not louder than some absolute. */
export function deliveryOf(arousal) {
  if (!arousal) return '';
  const loud = arousal.louderDb >= 4 ? 'noticeably louder than usual'
    : arousal.louderDb <= -4 ? 'quieter than usual' : 'at their usual level';
  const pace = arousal.rateRatio >= 1.25 ? 'and faster than usual'
    : arousal.rateRatio <= 0.8 ? 'and slower than usual' : 'and at their usual pace';
  return `${loud} ${pace}`;
}
