import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTrainingStatus, monitorVoiceTraining } from '../web/voice-training.js';

function clock() {
  let serial = 0;
  const timers = new Map();
  return {
    schedule(fn, delay) { const id = ++serial; timers.set(id, { fn, delay }); return id; },
    cancel(id) { timers.delete(id); },
    fire(delay) {
      const entry = [...timers].find(([, timer]) => timer.delay === delay);
      assert.ok(entry, `Expected a ${delay}ms timer`);
      timers.delete(entry[0]);
      return entry[1].fn();
    },
    delays: () => [...timers.values()].map(timer => timer.delay),
  };
}
const training = id => ({ id, name: `Voice ${id}`, status: 'training' });
function setup(overrides = {}) {
  const timer = clock();
  const state = { voices: [training('a')], calls: [] };
  const updated = [], paused = [];
  const stop = monitorVoiceTraining({
    getState: () => state,
    refreshVoice: async id => ({ voice: training(id) }),
    onVoice: voice => updated.push(voice),
    onPaused: id => paused.push(id),
    isVisible: () => true,
    intervalMs: 7, timeoutMs: 20,
    ...timer, ...overrides,
  });
  return { timer, state, updated, paused, stop };
}

test('checks are serial and disposal aborts and ignores a late response', async () => {
  let resolve, signal, requests = 0;
  const run = setup({ refreshVoice: (_id, options) => {
    requests += 1; signal = options.signal;
    return new Promise(done => { resolve = done; });
  } });
  const pending = run.timer.fire(7);
  assert.equal(requests, 1);
  assert.deepEqual(run.timer.delays(), [20]);
  run.stop();
  assert.equal(signal.aborted, true);
  resolve({ voice: { ...training('a'), status: 'ready' } });
  await pending;
  assert.deepEqual(run.updated, []);
  assert.deepEqual(run.timer.delays(), []);
});

test('training checks stop at their budget without declaring the voice failed', async () => {
  let requests = 0;
  const run = setup({ maxChecks: 2, refreshVoice: async id => { requests += 1; return { voice: training(id) }; } });
  await run.timer.fire(7); await run.timer.fire(7); await run.timer.fire(7);
  assert.equal(requests, 2);
  assert.deepEqual(run.paused, ['a']);
  assert.equal(run.updated.at(-1).status, 'training');
  run.stop();
});

test('malformed success responses cannot bypass the check budget', async () => {
  let requests = 0;
  const run = setup({ maxChecks: 2, maxFailures: 5, refreshVoice: async () => { requests += 1; return {}; } });
  await run.timer.fire(7); await run.timer.fire(7); await run.timer.fire(7);
  assert.equal(requests, 2);
  assert.deepEqual(run.updated, []);
  assert.deepEqual(run.paused, ['a']);
  run.stop();
});

test('timeout counts as a failed check and releases the polling slot', async () => {
  const run = setup({ maxFailures: 1, refreshVoice: (_id, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }) });
  const pending = run.timer.fire(7);
  run.timer.fire(20);
  await pending;
  assert.deepEqual(run.paused, ['a']);
  assert.deepEqual(run.timer.delays(), [7]);
  run.stop();
});

test('live calls and hidden tabs pause requests; eligible voices take turns', async () => {
  let visible = true;
  const requests = [];
  const run = setup({ isVisible: () => visible, refreshVoice: async id => { requests.push(id); return { voice: training(id) }; } });
  run.state.voices.push(training('b'));
  run.state.calls = [{ state: 'ringing' }];
  await run.timer.fire(7);
  run.state.calls = [{ state: 'in_call' }];
  await run.timer.fire(7);
  run.state.calls = [];
  visible = false;
  await run.timer.fire(7);
  assert.deepEqual(requests, []);
  visible = true;
  await run.timer.fire(7); await run.timer.fire(7); await run.timer.fire(7);
  assert.deepEqual(requests, ['a', 'b', 'a']);
  run.stop();
});

test('a late training response preserves edits, archived voices and newer ready state', () => {
  const renamed = { ...training('a'), name: 'My saved name', description: 'My description' };
  const response = { id: 'a', name: 'Old name', status: 'ready' };
  assert.deepEqual(mergeTrainingStatus([renamed], response)[0], { ...renamed, status: 'ready', error: undefined });
  const archived = { ...renamed, archived: true };
  assert.equal(mergeTrainingStatus([archived], response)[0], archived);
  const ready = { ...renamed, status: 'ready' };
  assert.equal(mergeTrainingStatus([ready], training('a'))[0], ready);
});
