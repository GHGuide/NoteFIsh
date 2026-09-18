import test from 'node:test';
import assert from 'node:assert/strict';
import { PANEL_IDS, PRESETS, DEFAULT_LAYOUT, normalizeLayout, presetOf, movePanel, isLayoutShape } from '../server/layout.mjs';
import { validateState } from '../server/store.mjs';

const every = layout => [...layout.side, ...layout.main, ...layout.hidden];

test('a layout always lists every panel exactly once, whatever was stored', () => {
  assert.deepEqual(normalizeLayout(undefined), DEFAULT_LAYOUT);
  assert.deepEqual(normalizeLayout('junk'), DEFAULT_LAYOUT);
  for (const preset of Object.values(PRESETS)) assert.deepEqual(every(normalizeLayout(preset)).sort(), [...PANEL_IDS].sort(), 'presets are complete');

  const messy = normalizeLayout({ side: ['transcript', 'bogus', 'transcript'], main: ['voice'] });
  assert.deepEqual(normalizeLayout({ side: 'nope' }), DEFAULT_LAYOUT, 'a column that is not a list is not a layout');
  assert.deepEqual(messy.side, ['transcript'], 'unknown and duplicate ids are dropped');
  assert.deepEqual(messy.main, ['voice']);
  assert.deepEqual(every(messy).sort(), [...PANEL_IDS].sort(), 'panels the layout forgot land in hidden');
  assert.ok(messy.hidden.includes('speak'));

  assert.equal(presetOf(normalizeLayout(PRESETS.compact)), 'compact');
  assert.equal(presetOf(messy), '');
});

test('moving a panel keeps the other columns intact', () => {
  const moved = movePanel(DEFAULT_LAYOUT, 'phrases', 'main', 1);
  assert.deepEqual(moved.side, ['voice', 'connect', 'speak']);
  assert.deepEqual(moved.main, ['transcript', 'phrases', 'caller', 'notes']);
  const hidden = movePanel(moved, 'transcript', 'hidden');
  assert.deepEqual(hidden.hidden.at(-1), 'transcript', 'no index means the end');
  assert.deepEqual(movePanel(moved, 'notes', 'main', 99).main.at(-1), 'notes', 'an index past the end clamps');
});

test('the store accepts layouts and canned lines on the desk, and rejects junk', () => {
  const base = () => ({ version: 3, voices: [], calls: [], settings: { voiceId: null, agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' } });
  const ok = base();
  ok.settings.layout = { side: ['speak'], main: ['transcript'], hidden: [] };
  ok.settings.phrases = [{ id: 'p1', text: 'One moment, please.' }];
  assert.ok(validateState(ok));
  assert.ok(isLayoutShape(ok.settings.layout));

  const badLayout = base(); badLayout.settings.layout = { side: 'speak' };
  assert.throws(() => validateState(badLayout), /settings are invalid/);
  const badPhrase = base(); badPhrase.settings.phrases = [{ id: 'p', text: 'x'.repeat(301) }];
  assert.throws(() => validateState(badPhrase), /settings are invalid/);
  const tooMany = base(); tooMany.settings.phrases = Array.from({ length: 31 }, (_, i) => ({ id: `p${i}`, text: 'Hi' }));
  assert.throws(() => validateState(tooMany), /settings are invalid/);
});
