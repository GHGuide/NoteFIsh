import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Run the shipped desk handlers and capture hook with explicit browser callback
// timing, including mute between release and MediaRecorder's async onstop.
// The hook lives in lib.jsx; the desk page (companion design) in pages/desk.jsx.
const lib = await readFile(new URL('../web/lib.jsx', import.meta.url), 'utf8');
const captureSource = lib.slice(lib.indexOf('export function useCapture('), lib.indexOf('\nexport function LanguageSelect(')).replace(/^export /, '');
const app = await readFile(new URL('../web/pages/desk.jsx', import.meta.url), 'utf8');
const deskStart = app.indexOf('export default function DeskPage(');
const deskSource = app.slice(deskStart, app.indexOf('\n  const action =', deskStart)).replace(/^export default /, '');

function fixture({ deferPermission = false } = {}) {
  const recorders = []; const uploads = []; const tracks = []; const grants = [];
  let requests = 0; let time = 1000;
  const microphone = () => {
    const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
    tracks.push(track);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  };
  class Recorder {
    constructor(_stream, options) { this.state = 'inactive'; this.mimeType = options.mimeType; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    finish() {
      time += 1000;
      this.ondataavailable({ data: new Blob(['spoken reply'], { type: this.mimeType }) });
      this.onstop();
    }
  }
  const Desk = runInNewContext(`${captureSource}\n${deskSource}\nreturn { startTalk, toggleMicrophone, capture }; }\nDeskPage;`, {
    useState: value => [value, () => {}], useRef: value => ({ current: value }),
    useCallback: value => value, useEffect: () => {},
    callState: call => call?.state, isArchived: () => false, needsDispatch: () => false, languageName: code => code, REGISTERS: [], stamp: () => '', formatDuration: () => '', languages: [],
    Date: { now: () => time }, Blob, MediaRecorder: Recorder, recordingType: () => 'audio/webm',
    navigator: { mediaDevices: { getUserMedia: async () => {
      requests++;
      if (deferPermission) await new Promise(resolve => grants.push(resolve));
      return microphone();
    } } },
    api: { ptt: async (id, blob) => { uploads.push({ id, blob }); return { call: { id } }; } },
  });
  const desk = Desk({
    data: { calls: [{ id: 'call', state: 'in_call', phase: 'listening' }], voices: [{ id: 'voice', status: 'ready' }], settings: { voiceId: 'voice' } },
    connection: 'connected', clearAudio() {}, setError(error) { throw new Error(error); }, setNotice() {}, updateCall() {},
    route: { path: '/desk', params: {}, query: {} }, owned: () => undefined, saveOwned: async () => true, setAudioMuted() {}, roster: [], seat: null, hasFloor: false,
  });
  return { desk, recorders, uploads, tracks, grants, requests: () => requests };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('desk mute blocks both speaking entry points, and unmute permits a fresh recorded reply', async () => {
  const { desk, requests, recorders, uploads } = fixture();
  desk.toggleMicrophone();
  desk.startTalk(); // Shared by the Space and pointer handlers.
  await settle();
  assert.equal(requests(), 0, 'muted hold must not request or start the microphone');
  desk.toggleMicrophone();
  desk.startTalk(); await settle();
  desk.capture.stop(); recorders[0].finish(); await settle();
  assert.equal(uploads.length, 1);
  assert.equal(await uploads[0].blob.text(), 'spoken reply');
});

test('mute discards an active or just-released recording even after unmute and a late release', async () => {
  for (const alreadyReleased of [false, true]) {
    const { desk, recorders, tracks, uploads } = fixture();
    desk.startTalk(); await settle();
    if (alreadyReleased) desk.capture.stop();
    desk.toggleMicrophone();
    desk.toggleMicrophone(); // Unmute must not rescue previously cancelled speech.
    desk.capture.stop(); recorders[0].finish(); await settle();
    assert.equal(uploads.length, 0);
    assert.equal(tracks[0].readyState, 'ended');
  }
});

test('mute while microphone permission is pending releases a late grant without recording or sending', async () => {
  const { desk, grants, recorders, tracks, uploads } = fixture({ deferPermission: true });
  desk.startTalk();
  desk.toggleMicrophone();
  grants[0](); await settle();
  assert.equal(recorders.length, 0);
  assert.equal(uploads.length, 0);
  assert.equal(tracks[0].readyState, 'ended');
});

test('unmuting and pressing talk again cannot revive the cancelled permission request', async () => {
  const { desk, grants, recorders, tracks, uploads } = fixture({ deferPermission: true });
  desk.startTalk();
  desk.toggleMicrophone();
  desk.toggleMicrophone();
  desk.startTalk();
  grants[1](); await settle();
  grants[0](); await settle();
  assert.equal(recorders.length, 1, 'only the new speaking gesture may start a recorder');
  assert.equal(tracks[1].readyState, 'ended', 'stale granted microphone must be released');
  desk.capture.stop(); recorders[0].finish(); await settle();
  assert.equal(uploads.length, 1);
});
