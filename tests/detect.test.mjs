import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCall } from '../companion/detect.mjs';

const tab = (url, title = '', browser = 'Comet') => ({ browser, url, title });

test('a call in progress wins over a tab that has merely been open all day', () => {
  // The real shape of the problem: 34 tabs, a Messenger thread early on, the
  // meeting several tabs later. The first match used to win and the call was missed.
  const tabs = [
    tab('https://instagram.com/direct/inbox/', 'Inbox • Instagram'),
    tab('https://messenger.com/t/12345', 'Messenger'),
    tab('https://news.example/article', 'Something else'),
    tab('https://meet.google.com/abc-defg-hij', 'Meet – abc-defg-hij'),
  ];
  const found = detectCall({ processes: [], tabs });
  assert.equal(found.app, 'Google Meet', 'the meeting, not the chat tab that happened to be first');
  assert.equal(found.live, true);
  assert.equal(found.via, 'Comet');
});

test('with nothing live, an open call site is still reported, so the microphone can decide', () => {
  const found = detectCall({ processes: [], tabs: [tab('https://instagram.com/direct/inbox/', 'Inbox • Instagram')] });
  assert.equal(found.app, 'Instagram');
  assert.equal(found.live, false, 'open is not the same as ringing');
});

test('a running call app beats a call site sitting idle in a tab', () => {
  const found = detectCall({ processes: ['zoom.us'], tabs: [tab('https://messenger.com/t/1', 'Messenger')] });
  assert.equal(found.app, 'Zoom');
  assert.equal(found.kind, 'app');
});

test('Meet is recognised from Safari too, not only the Chrome-shaped browsers', () => {
  const found = detectCall({ processes: [], tabs: [tab('https://meet.google.com/xyz-abcd-efg', 'Meet', 'Safari')] });
  assert.equal(found.app, 'Google Meet');
  assert.equal(found.via, 'Safari');
});

test('no call anywhere is no call', () => {
  assert.equal(detectCall({ processes: ['Finder'], tabs: [tab('https://example.com', 'Example')] }), null);
});
