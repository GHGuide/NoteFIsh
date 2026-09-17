// Proves the NoteFish Voice driver end to end without a call app: send a tone into it
// over UDP (what the companion does) while recording from it as a microphone (what
// Zoom would do), then measure what came out.
import dgram from 'node:dgram';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import os from 'node:os';
const out = (process.argv[2] || os.tmpdir()) + '/notefish-driver-capture.pcm';
let devices = '';
try { execFileSync('ffmpeg', ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { devices = String(e.stderr || ''); } // ffmpeg exits 1 after listing
const list = (process.argv[3] || '') + devices;
const match = list.match(/\[(\d+)\] NoteF[Ii]sh Voice/);
if (!match) { console.log('NoteFish Voice is not visible as an input device yet.'); process.exit(2); }
const index = Number(match[1]);
console.log(`driver visible as avfoundation input [${index}]`);

// Record 4 s from the driver, as a call app would.
const rec = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', `:${index}`, '-t', '4', '-ac', '1', '-ar', '48000', '-f', 's16le', out], { stdio: ['ignore', 'ignore', 'inherit'] });
await new Promise(r => setTimeout(r, 800));

// Meanwhile speak a 440 Hz tone into it: 20 ms packets, 48 kHz mono PCM16, paced.
const udp = dgram.createSocket('udp4');
let phase = 0; const packets = 100; // 2 s
for (let p = 0; p < packets; p++) {
  const packet = Buffer.alloc(1920);
  for (let i = 0; i < 960; i++) { packet.writeInt16LE(Math.round(Math.sin(phase) * 12000), i * 2); phase += 2 * Math.PI * 440 / 48000; }
  udp.send(packet, 47321, '127.0.0.1');
  await new Promise(r => setTimeout(r, 20));
}
udp.close();
await new Promise(resolve => rec.on('exit', resolve));

const pcm = readFileSync(out);
const n = Math.floor(pcm.length / 2); let sum = 0, peak = 0;
for (let i = 0; i < n; i++) { const v = pcm.readInt16LE(i * 2); sum += v * v; peak = Math.max(peak, Math.abs(v)); }
const rms = Math.sqrt(sum / Math.max(1, n));
// zero crossings over the loud middle second → frequency
let crossings = 0; const start = Math.floor(n * 0.4), end = Math.floor(n * 0.6);
for (let i = start + 1; i < end; i++) if ((pcm.readInt16LE(i * 2) >= 0) !== (pcm.readInt16LE((i - 1) * 2) >= 0)) crossings++;
const hz = crossings / 2 / ((end - start) / 48000);
console.log(`captured ${(n / 48000).toFixed(2)} s · peak ${peak} · rms ${rms.toFixed(0)} · ~${hz.toFixed(0)} Hz in the middle`);
console.log(peak > 3000 && hz > 400 && hz < 480 ? 'DRIVER OK: the call app would hear exactly what NoteFish sends' : 'DRIVER SILENT or wrong: nothing usable came through');
