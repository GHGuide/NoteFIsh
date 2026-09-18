import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCall } from '../companion/detect.mjs';

const tab = (url, title = '', browser = 'Comet') => ({ browser, url, title });
const SIRI = 'com.apple.CoreSpeech'; // always listening on a Mac with Siri on, and never a call
const COMET = 'ai.perplexity.comet.helper';

test('a call in progress wins over a tab that has merely been open all day', () => {
  // The real shape of the problem: 34 tabs, a Messenger thread early on, the
  // meeting several tabs later. The first match used to win and the call was missed.
  const tabs = [
    tab('https://instagram.com/direct/inbox/', 'Inbox • Instagram'),
    tab('https://messenger.com/t/12345', 'Messenger'),
    tab('https://news.example/article', 'Something else'),
    tab('https://meet.google.com/abc-defg-hij', 'Meet – abc-defg-hij'),
  ];
  const found = detectCall({ processes: [], tabs, capturing: [SIRI, COMET] });
  assert.equal(found.app, 'Google Meet', 'the meeting, not the chat tab that happened to be first');
  assert.equal(found.live, true);
  assert.equal(found.via, 'Comet');
});

test('leaving the meeting ends the call, though the tab still sits on the same URL', () => {
  // The bug the user hit: the pill kept asking to translate a call that was over,
  // because meet.google.com/abc-defg-hij is still the address of a meeting you left.
  const tabs = [tab('https://meet.google.com/abc-defg-hij', 'Meet – abc-defg-hij')];
  const during = detectCall({ processes: [], tabs, capturing: [SIRI, COMET] });
  const after = detectCall({ processes: [], tabs, capturing: [SIRI] });
  assert.equal(during.live, true, 'in the meeting, the browser holds the microphone');
  assert.equal(after.live, false, 'out of it, the browser has let go');
});

test('the answer does not depend on being bridged already, so a bridge cannot end itself', () => {
  const state = { processes: ['zoom.us'], tabs: [], capturing: [SIRI, 'us.zoom.xos'] };
  assert.deepEqual(detectCall(state), detectCall(state));
  assert.equal(detectCall(state).live, true);
});

test('the bundle id handed back is the one to point the tap at', () => {
  const found = detectCall({ processes: [], tabs: [tab('https://meet.google.com/abc-defg-hij', 'Meet')], capturing: [COMET] });
  assert.equal(found.bundle, COMET, 'tap the browser, not the whole Mac and its notification sounds');
});

test('a browser we cannot name is still a call when something is holding the microphone', () => {
  const tabs = [tab('https://meet.google.com/abc-defg-hij', 'Meet', 'Some New Browser')];
  const found = detectCall({ processes: [], tabs, capturing: [SIRI, 'com.example.newbrowser.helper'] });
  assert.equal(found.live, true);
  assert.equal(found.bundle, '', 'no bundle we trust, so tap everything rather than hear nothing');
});

test('a running call app beats a call site sitting idle in a tab', () => {
  const found = detectCall({ processes: ['zoom.us'], tabs: [tab('https://messenger.com/t/1', 'Messenger')], capturing: ['us.zoom.xos'] });
  assert.equal(found.app, 'Zoom');
  assert.equal(found.kind, 'app');
});

test('Meet is recognised from Safari, whose audio runs under WebKit rather than Safari', () => {
  const found = detectCall({ processes: [], tabs: [tab('https://meet.google.com/xyz-abcd-efg', 'Meet', 'Safari')], capturing: ['com.apple.WebKit.GPU'] });
  assert.equal(found.app, 'Google Meet');
  assert.equal(found.via, 'Safari');
  assert.equal(found.live, true);
});

test('an app we have never heard of, holding the microphone, is a call', () => {
  const found = detectCall({ processes: ['Finder'], tabs: [], capturing: [SIRI, 'com.example.somephone'] });
  assert.equal(found.app, 'Call');
  assert.equal(found.live, true);
});

test('NoteFish listening to itself is not a call', () => {
  assert.equal(detectCall({ processes: ['Finder'], tabs: [], capturing: [SIRI, 'com.notefish.desk'] }), null);
});

test('with no probe at all, the tab title is all there is to go on', () => {
  const tabs = [tab('https://meet.google.com/abc-defg-hij', 'Meet – abc-defg-hij')];
  assert.equal(detectCall({ processes: [], tabs }).live, true);
});

test('no call anywhere is no call', () => {
  assert.equal(detectCall({ processes: ['Finder'], tabs: [tab('https://example.com', 'Example')], capturing: [SIRI] }), null);
});
