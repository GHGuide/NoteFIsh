// Which call is happening on this Mac, from what is running, which tabs are open, and
// which processes are actually capturing audio. Pure: the companion feeds it process
// names, browser tab titles/URLs, and the bundle ids the audio-activity probe printed.
//
// Capturing audio is what makes a call a call. A tab's URL says a meeting exists; it
// keeps saying so long after you have left, which is why leaving a Google Meet used to
// bring the pill straight back asking to translate a call that was over. An app holds
// the microphone only while the call is live and lets go the instant it ends.

/** Desktop apps that carry calls: `match` is the process name `ps` prints, `bundle` the
 *  bundle id Core Audio reports while the app is listening. */
export const CALL_APPS = [
  { app: 'Zoom', match: /zoom\.us|CptHost/i, bundle: /^us\.zoom\./i },
  { app: 'WhatsApp', match: /^WhatsApp/i, bundle: /whatsapp/i },
  { app: 'FaceTime', match: /^FaceTime$/i, bundle: /^com\.apple\.(FaceTime|avconference)/i },
  { app: 'Microsoft Teams', match: /Microsoft Teams|MSTeams/i, bundle: /^com\.microsoft\.(teams|Teams)/i },
  { app: 'Discord', match: /^Discord/i, bundle: /^com\.hnc\.Discord/i },
  { app: 'Slack', match: /^Slack$/i, bundle: /slackmacgap/i },
  { app: 'Skype', match: /^Skype/i, bundle: /^com\.skype/i },
  { app: 'Signal', match: /^Signal$/i, bundle: /signal/i },
  { app: 'Telegram', match: /^Telegram/i, bundle: /telegram|keepcoder/i },
  { app: 'Webex', match: /Webex/i, bundle: /webex|Cisco-Systems\.Spark/i },
];

/** Browsers whose tabs can hold a call. `titleWord` is what the browser calls a tab's
 *  title in AppleScript; `bundle` matches the process that does its audio, which for
 *  every one of them is a helper beside the app rather than the app itself. */
export const BROWSERS = [
  { app: 'Google Chrome', titleWord: 'title', bundle: /^com\.google\.Chrome/i },
  { app: 'Comet', titleWord: 'title', bundle: /^ai\.perplexity\.comet/i },
  { app: 'Brave Browser', titleWord: 'title', bundle: /^com\.brave\./i },
  { app: 'Microsoft Edge', titleWord: 'title', bundle: /^com\.microsoft\.edgemac/i },
  { app: 'Arc', titleWord: 'title', bundle: /^company\.thebrowser\./i },
  { app: 'Chromium', titleWord: 'title', bundle: /^org\.chromium\./i },
  { app: 'Safari', titleWord: 'name', bundle: /^com\.apple\.(Safari|WebKit)/i },
];

/** Web calls, by tab URL or title. */
export const CALL_SITES = [
  { app: 'Google Meet', match: /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i },
  { app: 'Zoom', match: /zoom\.us\/(wc|j)\//i },
  { app: 'Microsoft Teams', match: /teams\.(microsoft|live)\.com/i },
  { app: 'WhatsApp', match: /web\.whatsapp\.com/i },
  { app: 'Instagram', match: /instagram\.com\/(call|direct)/i },
  { app: 'Messenger', match: /messenger\.com\/(call|groupcall|t\/)/i },
  { app: 'Discord', match: /discord\.com\/channels/i },
  { app: 'Webex', match: /webex\.com\/(meet|wbxmjs)/i },
  { app: 'Slack', match: /app\.slack\.com\/huddle/i },
];

/** Tab titles that mean a call is live. Only consulted when the audio probe is missing. */
const LIVE_TITLE = /\bmeet\b|\bcall\b|\bhuddle\b|\bvideo\b|\bvoice\b|\bringing\b|\bmeeting\b/i;

/** Things that listen to the microphone without a call being on: the Mac's own voice
 *  services, and NoteFish itself. Anything else capturing audio next to an open meeting
 *  tab is taken as that meeting, so an unrecognised browser still gets you a call. */
const NOT_A_CALL = /^com\.apple\.(CoreSpeech|Siri|VoiceOver|speech|accessibility)|notefish/i;

/**
 * The most likely call: {app, kind:'app'|'web', via, live, bundle} or null.
 * `bundle` is the bundle id to point the audio tap at, or '' to tap the whole Mac.
 * Only a `live` call should be bridged; an idle one is a meeting tab sitting open.
 */
export function detectCall({ processes = [], tabs = [], capturing = null } = {}) {
  const hears = Array.isArray(capturing);
  const capturedBy = pattern => (hears ? capturing.find(id => pattern.test(id)) || '' : '');
  const strangers = hears ? capturing.filter(id => !NOT_A_CALL.test(id)) : [];
  const announces = tab => LIVE_TITLE.test(tab.title || '') || /meet\.google\.com\/[a-z]{3}-|zoom\.us\/(wc|j)\//i.test(tab.url || '');

  // Every candidate, then the most specific one, rather than whichever was looked at
  // first. Holding the microphone beats a window merely being open; a tab that says it
  // is in a meeting beats its neighbours in the same browser; a meeting beats an app
  // that happens to be running. Lower rank wins, and ties keep the order they came in.
  const candidates = [];
  const add = (rank, found) => candidates.push({ rank, found });

  for (const name of processes) {
    const app = CALL_APPS.find(item => item.match.test(name));
    if (!app) continue;
    const bundle = capturedBy(app.bundle);
    if (bundle) add(1, { app: app.app, kind: 'app', via: name, live: true, bundle });
    else if (!hears) add(4, { app: app.app, kind: 'app', via: name, live: true, bundle: '' });
    else add(9, { app: app.app, kind: 'app', via: name, live: false, bundle: '' });
  }

  for (const tab of tabs) {
    const site = CALL_SITES.find(item => item.match.test(`${tab.url || ''} ${tab.title || ''}`));
    if (!site) continue;
    const browser = BROWSERS.find(item => item.app === tab.browser);
    const bundle = browser ? capturedBy(browser.bundle) : '';
    const announced = announces(tab);
    const found = { app: site.app, kind: 'web', via: tab.browser || 'browser', live: true, bundle };
    // Holding the microphone says the browser is in a call but not which of its tabs is,
    // so among the tabs of a browser we can hear, the one that reads like a meeting wins.
    if (bundle) add(announced ? 2 : 3, found);
    else if (!hears) announced ? add(3, { ...found, bundle: '' }) : add(9, { ...found, live: false, bundle: '' });
    else if (strangers.length) add(announced ? 5 : 6, { ...found, bundle: '' });
    else add(9, { ...found, live: false, bundle: '' });
  }

  // Some app we do not have a name for is holding the microphone. That is still a call,
  // and bridging it is the whole point of not keeping a list of every app in the world.
  if (strangers.length) add(8, { app: 'Call', kind: 'app', via: 'microphone in use', live: true, bundle: '' });

  candidates.sort((a, b) => a.rank - b.rank);
  return candidates[0]?.found || null;
}

/** Split `ps -Ao comm` output into short process names. */
export function processNames(psOutput) {
  return String(psOutput || '').split('\n').map(line => line.trim().split('/').pop()).filter(Boolean);
}
