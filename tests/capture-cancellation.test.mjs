import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Execute the shipped hook and its MediaRecorder callbacks, with browser events
// scheduled explicitly. React rendering is irrelevant to this stop/onstop race.
const app = await readFile(new URL('../web/App.jsx', import.meta.url), 'utf8');
const hookStart = app.indexOf('function useCapture(');
const hookEnd = app.indexOf('\nfunction LanguageSelect(', hookStart);
if (hookStart < 0 || hookEnd <= hookStart) throw new Error('Cannot locate the production capture hook');
const hookSource = app.slice(hookStart, hookEnd);

function captureFixture() {
  const completed = []; const recorders = [];
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  class Recorder {
    constructor(_stream, options) { this.state = 'inactive'; this.mimeType = options?.mimeType || 'audio/webm'; recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; }
    finish() {
      this.ondataavailable({ data: new Blob(['captured speech'], { type: this.mimeType }) });
      this.onstop();
    }
  }
  const useCapture = runInNewContext(`${hookSource}\nuseCapture;`, {
    useState: initial => [initial, () => {}],
    useRef: initial => ({ current: initial }),
    useCallback: callback => callback,
    useEffect: () => {},
    navigator: { mediaDevices: { getUserMedia: async () => stream } },
    MediaRecorder: Recorder, recordingType: () => 'audio/webm', Blob, Date,
  });
  return { capture: useCapture((blob, duration) => completed.push({ blob, duration })), track, recorders, completed };
}

test('Escape or blur cancellation survives a release before the asynchronous recorder stop event', async () => {
  const { capture, track, recorders, completed } = captureFixture();
  await capture.start();
  capture.stop(true); // Escape/blur cancels.
  capture.stop(false); // Keyup/pointerup arrives before MediaRecorder.onstop.
  recorders[0].finish();
  assert.equal(completed.length, 0, 'cancelled microphone audio must not be submitted');
  assert.equal(track.readyState, 'ended');
  assert.equal(track.onended, null);
});

test('external microphone loss remains cancelled even when a pending release follows it', async () => {
  const { capture, track, recorders, completed } = captureFixture();
  await capture.start();
  track.readyState = 'ended'; track.onended();
  capture.stop(false);
  recorders[0].finish();
  assert.equal(completed.length, 0, 'device loss must not submit a partial reply');
  assert.equal(track.onmute, null);
  assert.equal(track.onunmute, null);
});

test('normal release still submits the completed recording once', async () => {
  const { capture, track, recorders, completed } = captureFixture();
  await capture.start();
  capture.stop(false);
  recorders[0].finish();
  assert.equal(completed.length, 1);
  assert.equal(await completed[0].blob.text(), 'captured speech');
  assert.equal(completed[0].blob.type, 'audio/webm');
  assert.equal(track.readyState, 'ended');
});
