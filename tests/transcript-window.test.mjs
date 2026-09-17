import test from 'node:test';
import assert from 'node:assert/strict';
import { windowOf } from '../web/transcript-window.js';

test('a long transcript renders only the rows around the viewport, and the spacers add up', () => {
  const heights = Array.from({ length: 1000 }, (_, i) => 60 + (i % 5) * 20);
  const total = heights.reduce((sum, h) => sum + h, 0);
  const at = scrollTop => windowOf(heights, scrollTop, 500, 100);

  const topOfList = at(0);
  assert.equal(topOfList.start, 0);
  assert.ok(topOfList.end > 0 && topOfList.end < 30, 'a handful of rows at the top');
  assert.equal(topOfList.top, 0);

  const middle = at(40000);
  assert.ok(middle.start > 0 && middle.end < heights.length);
  const drawn = heights.slice(middle.start, middle.end).reduce((sum, h) => sum + h, 0);
  assert.equal(middle.top + drawn + middle.bottom, total, 'spacers keep the scroll height exact');
  assert.ok(middle.top <= 40000 - 100 && middle.top + drawn >= 40000 + 500 + 100, 'the viewport plus overscan is covered');

  const bottomOfList = at(total);
  assert.equal(bottomOfList.end, heights.length);
  assert.equal(bottomOfList.bottom, 0);

  assert.deepEqual(windowOf([], 0, 500), { start: 0, end: 0, top: 0, bottom: 0 });
});
