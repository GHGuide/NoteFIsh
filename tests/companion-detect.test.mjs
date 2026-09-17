import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCall, processNames } from '../companion/detect.mjs';

test('a call is recognised from the apps that are running or the tabs that are open', () => {
  assert.deepEqual(detectCall({ processes: ['Finder', 'zoom.us', 'Google Chrome'] }), { app: 'Zoom', kind: 'app', via: 'zoom.us', live: true });
  assert.equal(detectCall({ processes: ['WhatsApp'] }).app, 'WhatsApp');
  assert.equal(detectCall({ processes: ['FaceTime'] }).app, 'FaceTime');
  assert.equal(detectCall({ processes: ['Finder', 'Safari', 'Music'] }), null, 'ordinary apps are not calls');

  const meet = detectCall({ tabs: [{ browser: 'Google Chrome', url: 'https://meet.google.com/abc-defg-hij', title: 'Meet – abc-defg-hij' }] });
  assert.deepEqual(meet, { app: 'Google Meet', kind: 'web', via: 'Google Chrome', live: true });
  assert.equal(detectCall({ tabs: [{ url: 'https://meet.google.com/', title: 'Google Meet' }] }), null, 'the Meet home page is not a call');
  assert.equal(detectCall({ tabs: [{ url: 'https://www.instagram.com/direct/t/1234/', title: 'Instagram • Direct' }] }).app, 'Instagram');
  assert.equal(detectCall({ tabs: [{ url: 'https://web.whatsapp.com/', title: 'WhatsApp' }] }).app, 'WhatsApp');
  assert.equal(detectCall({ tabs: [{ url: 'https://web.whatsapp.com/', title: 'WhatsApp' }] }).live, false, 'WhatsApp Web open is not yet a call');
  assert.equal(detectCall({ tabs: [{ url: 'https://web.whatsapp.com/', title: 'Voice call · WhatsApp' }] }).live, true);
  assert.equal(detectCall({ tabs: [{ url: 'https://zoom.us/wc/123/join', title: 'Zoom' }] }).app, 'Zoom');

  // A web call wins over a desktop app idling in the background.
  assert.equal(detectCall({ processes: ['Slack'], tabs: [{ url: 'https://meet.google.com/abc-defg-hij', title: 'Meet' }] }).app, 'Google Meet');
  assert.deepEqual(processNames('COMM\n/Applications/zoom.us.app/Contents/MacOS/zoom.us\nFinder\n'), ['COMM', 'zoom.us', 'Finder']);
});
