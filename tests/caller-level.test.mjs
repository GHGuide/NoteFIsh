import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';

/** 20 ms of 16 kHz mono PCM16 holding a 300 Hz tone at the given amplitude. */
function tone(amplitude) {
  const samples = 320;
  const frame = Buffer.allocUnsafe(samples * 2);
  for (let i = 0; i < samples; i++) frame.writeInt16LE(Math.round(amplitude * Math.sin(2 * Math.PI * 300 * i / 16000)), i * 2);
  return frame;
}

function tracked(url, headers) {
  const ws = new WebSocket(url, { headers });
  const events = [];
  ws.on('message', bytes => { try { events.push(JSON.parse(bytes)); } catch { /* binary */ } });
  ws.on('error', () => {});
  const waitFor = predicate => new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const event = events.find(predicate);
      if (event) return resolve(event);
      if (Date.now() - started > 4000) return reject(new Error('Expected socket event was not received'));
      setTimeout(check, 5);
    };
    check();
  });
  return { ws, events, waitFor };
}

// The pill draws its meter from this. It is the only thing on screen that tells the
// difference between a call being heard and a bridge that has gone silent, so it has to
// follow the caller's actual voice rather than animate regardless.
test('the desk is told how loud the caller is, and the number follows the audio', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-level-'));
  await mkdir(path.join(directory, 'dist'), { recursive: true });
  await writeFile(path.join(directory, 'dist', 'index.html'), '<!doctype html><title>NoteFish</title>');
  const config = loadConfig({ NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://example.test', NOTEFISH_DESK_PASSWORD: 'test-only-password-12345', DATA_DIR: directory }, directory);
  const runtime = await createRuntime({ config });
  await new Promise(resolve => runtime.server.listen(0, '127.0.0.1', resolve));
  const port = runtime.server.address().port;
  const base = `http://127.0.0.1:${port}`;
  const auth = `Basic ${Buffer.from(`desk:${config.deskPassword}`).toString('base64')}`;
  const headers = { Authorization: auth, Origin: 'https://example.test', 'Content-Type': 'application/json' };
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.terminate(); await runtime.close(); await rm(directory, { recursive: true, force: true }); });

  const invitation = await (await fetch(`${base}/api/caller-invitations`, { method: 'POST', headers, body: '{}' })).json();
  const token = new URL(invitation.url).hash.slice(1);
  const caller = tracked(`ws://127.0.0.1:${port}/ws/caller`, { Origin: 'https://example.test' });
  sockets.push(caller.ws);
  await new Promise(resolve => caller.ws.once('open', resolve));
  caller.ws.send(JSON.stringify({ type: 'join', token }));
  const ringing = await caller.waitFor(event => event.type === 'state' && event.state === 'ringing');

  const desk = tracked(`ws://127.0.0.1:${port}/ws/desk`, { Origin: 'https://example.test', Authorization: auth });
  sockets.push(desk.ws);
  await new Promise(resolve => desk.ws.once('open', resolve));
  assert.equal((await fetch(`${base}/api/calls/${ringing.callId}/answer`, { method: 'POST', headers, body: '{}' })).status, 200);
  await caller.waitFor(event => event.type === 'state' && event.state === 'in_call');

  // Streamed the way the companion streams it, a frame every 20 ms, rather than in one
  // burst: the meter reports the loudest moment since it last spoke, so a lump of audio
  // arriving all at once says nothing useful about what it looks like on a real call.
  const speak = async (amplitude, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) { caller.ws.send(tone(amplitude)); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  const levels = () => desk.events.filter(event => event.type === 'level' && event.callId === ringing.callId);

  await speak(9000, 400);
  const loud = levels().at(-1);
  assert.ok(loud, 'the desk hears a level while the caller is speaking');
  assert.ok(loud.level > 0.5, `a voice should read high on the meter, got ${loud.level}`);

  const before = levels().length;
  await speak(150, 400);
  const quiet = levels().at(-1);
  assert.ok(levels().length > before, 'the meter keeps reporting while the line is quiet');
  assert.ok(quiet.level < loud.level, `near-silence should read lower than a voice, got ${quiet.level} against ${loud.level}`);
  assert.ok(quiet.level < 0.25, `near-silence should sit near the bottom of the meter, got ${quiet.level}`);

  caller.ws.send(JSON.stringify({ type: 'end' }));
  await caller.waitFor(event => event.type === 'state' && event.state === 'ended');
});
