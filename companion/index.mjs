#!/usr/bin/env node
// NoteFIsh companion (macOS). Sits next to any call — Zoom, Meet, Teams, WhatsApp,
// FaceTime, Instagram, whatever is using the microphone — and bridges it through
// your NoteFIsh desk: the other side's audio becomes captions, your replies come
// back in your cloned voice and go into the call as its microphone.
//
//   npm run companion -- --watch            detect calls and bridge them
//   npm run companion -- --start "Zoom"     bridge now, whatever is running
//   npm run companion -- --list-devices     see what ffmpeg can hear and speak to
//
// Audio plumbing (one-time, see docs/companion.md): the call app's speaker goes to
// a virtual device the companion listens to; the companion speaks into a second
// virtual device the call app uses as its microphone. Your real microphone never
// reaches the call — only the Fish voice does, exactly like the phone desk.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import dgram from 'node:dgram';
import { detectCall, processNames } from './detect.mjs';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const FRAME = 640; // 20 ms of 16 kHz mono PCM16, the same frames the phone page sends
const BROWSERS = ['Google Chrome', 'Comet', 'Brave Browser', 'Microsoft Edge', 'Arc', 'Chromium'];

// ---- arguments and environment ----
const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 14).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
const env = readEnv(path.join(here, '..', '.env'));
const server = (args.server || env.NOTEFISH_COMPANION_SERVER || `http://127.0.0.1:${env.PORT || 3001}`).replace(/\/$/, '');
const password = args.password || env.NOTEFISH_DESK_PASSWORD || '';
const interval = Math.max(1000, Number(args.interval || 3000));
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

function parseArgs(list) {
  const out = {};
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = list[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true; else { out[key] = next; i++; }
  }
  return out;
}
function readEnv(file) {
  try { return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])); }
  catch { return {}; }
}

// ---- the desk API, as the desk itself would call it ----
let seatCookie = '';
async function api(method, route, body) {
  const headers = { 'Content-Type': 'application/json', Origin: server, ...(password ? { Authorization: 'Basic ' + Buffer.from(`desk:${password}`).toString('base64') } : {}), ...(seatCookie ? { Cookie: seatCookie } : {}) };
  const response = await fetch(server + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) seatCookie = setCookie.split(';')[0]; // the seat: presence on the roster, so the desk offers this call to us and lets us answer it
  const text = await response.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!response.ok) throw new Error(data.error || `${method} ${route} failed (${response.status})`);
  return data;
}

// ---- audio devices, through ffmpeg ----
async function listDevices() {
  const inputs = [], outputs = [];
  const parse = (text, list) => { for (const m of text.matchAll(/\[(\d+)\]\s+([^\n,]+?)(?:,\s*[^\n]*)?$/gm)) list.push({ index: Number(m[1]), name: m[2].trim() }); };
  const inRun = await run('ffmpeg', ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8' }).catch(e => e);
  const inText = (inRun.stderr || '') + (inRun.stdout || '');
  parse(inText.slice(inText.indexOf('audio devices')), inputs);
  const outRun = await run('ffmpeg', ['-hide_banner', '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono', '-t', '0.05', '-f', 'audiotoolbox', '-list_devices', 'true', '-'], { encoding: 'utf8' }).catch(e => e);
  parse((outRun.stderr || '') + (outRun.stdout || ''), outputs);
  return { inputs: inputs.filter(d => d.name && d.name !== '(null)'), outputs: outputs.filter(d => d.name && d.name !== '(null)') };
}
function pick(list, wanted, fallbacks) {
  const byName = name => list.find(d => d.name.toLowerCase().includes(String(name).toLowerCase()));
  if (wanted !== undefined) { const found = /^\d+$/.test(String(wanted)) ? list.find(d => d.index === Number(wanted)) : byName(wanted); if (!found) throw new Error(`No audio device matches "${wanted}". Run with --list-devices.`); return found; }
  for (const name of fallbacks) { const found = byName(name); if (found) return found; }
  return null;
}

// ---- what is going on on this Mac ----
const micProbe = path.join(here, 'bin', 'mic-in-use');
const tapBinary = path.join(here, 'bin', 'system-audio-tap');
async function ensureTap() {
  if (existsSync(tapBinary)) return true;
  try { mkdirSync(path.dirname(tapBinary), { recursive: true }); await run('swiftc', ['-O', path.join(here, 'system-audio-tap.swift'), '-o', tapBinary]); return true; }
  catch { return false; }
}
async function ensureMicProbe() {
  if (existsSync(micProbe)) return true;
  try { mkdirSync(path.dirname(micProbe), { recursive: true }); await run('swiftc', ['-O', path.join(here, 'mic-in-use.swift'), '-o', micProbe]); return true; }
  catch { return false; }
}
async function observe() {
  const processes = processNames((await run('ps', ['-Ao', 'comm'], { encoding: 'utf8' }).catch(() => ({ stdout: '' }))).stdout);
  const tabs = [];
  for (const browser of BROWSERS) {
    if (!processes.some(name => name === browser || name === browser.split(' ')[0])) continue;
    const script = `tell application "${browser}" to if it is running then get {URL, title} of tabs of windows`;
    const out = (await run('osascript', ['-e', script], { encoding: 'utf8', timeout: 2000 }).catch(() => ({ stdout: '' }))).stdout.trim();
    if (!out) continue;
    // AppleScript prints URLs then titles, comma separated, one flat list per window group.
    const parts = out.split(', ');
    const half = Math.floor(parts.length / 2);
    for (let i = 0; i < half; i++) tabs.push({ browser, url: parts[i], title: parts[half + i] || '' });
  }
  let micInUse = false;
  if (existsSync(micProbe)) micInUse = (await run(micProbe, [], { encoding: 'utf8', timeout: 2000 }).catch(() => ({ stdout: '0' }))).stdout.trim() === '1';
  const known = detectCall({ processes, tabs });
  if (known && (known.kind === 'app' ? micInUse || !existsSync(micProbe) : known.live)) return { label: known.app, via: known.via };
  if (micInUse && !bridge.active) return { label: 'Call', via: 'microphone in use' };
  return null;
}

// ---- the bridge: one call, as the phone page would carry it ----
const bridge = { active: null };
async function startBridge(label, devices) {
  const invite = await api('POST', '/api/caller-invitations', { label: label.slice(0, 40), transport: 'companion' });
  const ws = new WebSocket(server.replace(/^http/, 'ws') + '/ws/caller', { headers: { Origin: server } });
  const session = { label, ws, capture: null, playing: false, callId: '', ended: false, pending: Buffer.alloc(0) };
  bridge.active = session;
  const stopCapture = () => { if (session.capture) { session.capture.kill('SIGTERM'); session.capture = null; } };
  const startCapture = () => {
    if (session.capture || session.ended) return;
    session.capture = devices.tap
      ? spawn(tapBinary, args.bundle ? [String(args.bundle)] : [], { stdio: ['ignore', 'pipe', 'inherit'] })
      : spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', `:${devices.input.index}`, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'inherit'] });
    session.capture.stdout.on('data', chunk => {
      session.pending = Buffer.concat([session.pending, chunk]);
      while (session.pending.length >= FRAME) {
        const frame = session.pending.subarray(0, FRAME); session.pending = session.pending.subarray(FRAME);
        if (!session.playing && ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    });
    session.capture.on('exit', code => { session.capture = null; if (!session.ended && code) log('capture stopped', code); });
  };
  // Streamed replies: into the NoteFIsh Voice driver over UDP (paced 20 ms packets at 48 kHz), or through ffmpeg for any other device; 'played' follows the last byte's play time.
  let stream = null;
  const udp = devices.output.udp ? dgram.createSocket('udp4') : null;
  const toDriver = (chunk16k) => {
    // 16 kHz → 48 kHz: each sample becomes three, linearly interpolated.
    const frames = Math.floor(chunk16k.length / 2); const out = Buffer.allocUnsafe(frames * 6);
    for (let i = 0; i < frames; i++) { const a = chunk16k.readInt16LE(i * 2), b = i + 1 < frames ? chunk16k.readInt16LE(i * 2 + 2) : a; out.writeInt16LE(a, i * 6); out.writeInt16LE(Math.round(a + (b - a) / 3), i * 6 + 2); out.writeInt16LE(Math.round(a + (b - a) * 2 / 3), i * 6 + 4); }
    return out;
  };
  const beginStream = (playbackId, sampleRate = 16000) => {
    endStreamNow();
    if (udp) { stream = { playbackId, sampleRate, bytes: 0, startedAt: Date.now(), queue: [], timer: null }; session.playing = true; return; }
    const player = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', String(sampleRate), '-ac', '1', '-i', 'pipe:0', '-f', 'audiotoolbox', '-audio_device_index', String(devices.output.index), '-'], { stdio: ['pipe', 'ignore', 'ignore'] });
    stream = { playbackId, sampleRate, player, bytes: 0, startedAt: Date.now() };
    session.playing = true;
  };
  const pushChunk = (playbackId, payload) => {
    if (!stream || stream.playbackId !== playbackId) return;
    const chunk = Buffer.from(payload, 'base64'); stream.bytes += chunk.length;
    if (udp) {
      // Pace the driver: 20 ms of 48 kHz mono per packet, sent on the clock, so its ring never runs dry or overflows.
      const pcm48 = toDriver(chunk);
      for (let offset = 0; offset < pcm48.length; offset += 1920) stream.queue.push(pcm48.subarray(offset, offset + 1920));
      if (!stream.timer) { const current = stream; stream.timer = setInterval(() => { const packet = current.queue.shift(); if (packet) udp.send(packet, 47321, '127.0.0.1'); else if (current.done) { clearInterval(current.timer); current.timer = null; } }, 20); }
      return;
    }
    if (stream.player.stdin.writable) stream.player.stdin.write(chunk);
  };
  const endStream = playbackId => {
    if (!stream || stream.playbackId !== playbackId) return;
    const current = stream; if (udp) current.done = true; else current.player.stdin.end();
    const remaining = Math.max(0, current.bytes / (current.sampleRate * 2) * 1000 - (Date.now() - current.startedAt)) + 150;
    setTimeout(() => { if (stream === current) { stream = null; session.playing = false; if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'played', playbackId })); } }, remaining);
  };
  const endStreamNow = () => { if (stream) { if (stream.timer) clearInterval(stream.timer); try { stream.player?.kill('SIGTERM'); } catch { /* gone */ } stream = null; session.playing = false; } };
  const play = (payload, playbackId) => {
    const file = path.join(tmpdir(), `notefish-${playbackId}.mp3`);
    writeFileSync(file, Buffer.from(payload, 'base64'));
    if (udp) {
      // Decode to 16 kHz PCM with ffmpeg, then feed it like a streamed reply.
      const decoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'ignore'] });
      beginStream(playbackId, 16000);
      decoder.stdout.on('data', chunk => pushChunk(playbackId, chunk.toString('base64')));
      decoder.on('exit', () => { rmSync(file, { force: true }); endStream(playbackId); });
      return;
    }
    session.playing = true;
    const player = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', file, '-f', 'audiotoolbox', '-audio_device_index', String(devices.output.index), '-'], { stdio: 'ignore' });
    player.on('exit', () => { session.playing = false; rmSync(file, { force: true }); if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'played', playbackId })); });
  };
  ws.on('open', () => ws.send(JSON.stringify({ type: 'join', token: invite.token })));
  ws.on('message', (raw, isBinary) => {
    if (isBinary) return;
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'state') {
      if (message.callId) session.callId = message.callId;
      if (message.state === 'ringing') { log(`${label}: ringing at the desk — answer it there${args.autoAnswer ? ' (answering for you)' : ''}`); if (args.autoAnswer && session.callId) api('POST', `/api/calls/${session.callId}/answer`).catch(error => log('could not answer:', error.message)); }
      if (message.state === 'in_call') { if (!session.capture) log(`${label}: bridged · captions on the desk · speak from the desk`); startCapture(); }
      if (message.state === 'ended') { log(`${label}: ended`); session.ended = true; stopCapture(); ws.close(); }
      if (message.error) log('desk:', message.error);
    }
    if (message.type === 'audio' && message.payload && message.playbackId) play(message.payload, message.playbackId);
    if (message.type === 'audio-start' && message.playbackId) beginStream(message.playbackId, message.sampleRate);
    if (message.type === 'audio-chunk' && message.playbackId && message.payload) pushChunk(message.playbackId, message.payload);
    if (message.type === 'audio-end' && message.playbackId) endStream(message.playbackId);
    if (message.type === 'clear') endStreamNow();
    if (message.type === 'caption' && message.text) log(`${message.who === 'agent' ? '   you →' : '  them →'} ${message.text}`);
    if (message.type === 'error') log('desk:', message.error);
  });
  ws.on('close', () => { session.ended = true; stopCapture(); if (bridge.active === session) bridge.active = null; });
  ws.on('error', error => log('desk connection:', error.message));
  return session;
}
function endBridge(reason) {
  const session = bridge.active; if (!session) return;
  log(`${session.label}: ${reason}`);
  session.ended = true;
  if (session.ws.readyState === WebSocket.OPEN) session.ws.send(JSON.stringify({ type: 'end' }));
  session.ws.close();
}

// ---- main ----
const devices = await listDevices();
if (args.listDevices) {
  console.log('Inputs (what the companion can listen to):'); for (const d of devices.inputs) console.log(`  [${d.index}] ${d.name}`);
  console.log('Outputs (what the companion can speak into):'); for (const d of devices.outputs) console.log(`  [${d.index}] ${d.name}`);
  process.exit(0);
}
// Hearing the call: the Core Audio tap (macOS 14.2+, no driver) unless --in names a device.
const tap = args.in === undefined && await ensureTap();
const input = tap ? { index: -1, name: args.bundle ? `tap · ${args.bundle}` : 'tap · system audio' } : pick(devices.inputs, args.in, ['BlackHole 16ch', 'BlackHole']);
// Speaking into the call still needs a virtual microphone the call app can select.
const voiceDriver = devices.inputs.find(d => d.name === 'NoteFIsh Voice') || devices.outputs.find(d => d.name === 'NoteFIsh Voice');
const output = args.out === undefined && voiceDriver ? { index: -1, name: 'NoteFIsh Voice', udp: true } : pick(devices.outputs, args.out, ['BlackHole 2ch', 'BlackHole']);
if (!input || !output) {
  console.error(`No virtual microphone found for speaking into the call. Install the NoteFIsh Voice driver (driver/README.md) or BlackHole:\n  brew install blackhole-2ch\nthen set the call app's microphone to it. Or pass --out explicitly (see --list-devices).`);
  process.exit(2);
}
if (!tap && input.name === output.name) console.error(`Warning: listening to and speaking into the same device (${input.name}) will echo your own replies back as captions. Use two devices.`);
try { await api('GET', '/api/session'); } catch (error) { console.error(`Cannot reach the desk at ${server}: ${error.message}`); process.exit(2); }
// --as Nina: sign in on the roster as that agent, so --auto-answer can pick up and the call carries their voice and takes.
if (args.as) {
  const roster = (await api('GET', '/api/agents')).agents.filter(agent => !agent.archived);
  const me = roster.find(agent => agent.name.toLowerCase() === String(args.as).toLowerCase());
  if (!me) { console.error(`No agent named "${args.as}" on the roster (${roster.map(a => a.name).join(', ') || 'empty'}).`); process.exit(2); }
  await api('POST', `/api/agents/${me.id}/session`, {});
  log(`answering as ${me.name}`);
}
log(`desk ${server} · hear: ${tap ? input.name : `[${input.index}] ${input.name}`} · speak: [${output.index}] ${output.name}`);
const probe = await ensureMicProbe();
log(probe ? 'microphone-in-use detection ready (any app)' : 'no swiftc: detecting known call apps and tabs only');

if (args.start) { await startBridge(args.start === true ? 'Call' : String(args.start), { input, output, tap }).catch(error => { console.error(`Could not bridge: ${error.message}`); process.exit(2); }); }
else if (args.watch) {
  let seen = 0, gone = 0;
  log('watching for calls… (Zoom, Meet, Teams, WhatsApp, FaceTime, Instagram, Messenger, Discord, Slack, or any app using the mic)');
  setInterval(async () => {
    const found = await observe().catch(() => null);
    if (found && !bridge.active) { if (++seen >= 2) { seen = 0; log(`detected ${found.label} (${found.via})`); await startBridge(found.label, { input, output, tap }).catch(error => log('could not bridge:', error.message)); } }
    else if (!found && bridge.active) { if (++gone >= 4) { gone = 0; endBridge('call is over'); } }
    else { seen = 0; gone = 0; }
  }, interval);
} else {
  console.log('Nothing to do: pass --watch to detect calls, --start "Label" to bridge now, or --list-devices.');
  process.exit(0);
}
process.on('SIGINT', () => { endBridge('stopped'); const bye = seatCookie ? api('DELETE', '/api/agents/session').catch(() => {}) : Promise.resolve(); bye.finally(() => setTimeout(() => process.exit(0), 300)); });
