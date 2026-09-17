// Which call is happening on this Mac, from what is running and which tabs are
// open. Pure: the companion feeds it process names and browser tab titles/URLs.

/** Desktop apps that carry calls, by process name as `ps` prints it. */
export const CALL_APPS = [
  { app: 'Zoom', match: /zoom\.us|CptHost/i },
  { app: 'WhatsApp', match: /^WhatsApp/i },
  { app: 'FaceTime', match: /^FaceTime$/i },
  { app: 'Microsoft Teams', match: /Microsoft Teams|MSTeams/i },
  { app: 'Discord', match: /^Discord/i },
  { app: 'Slack', match: /^Slack$/i },
  { app: 'Skype', match: /^Skype/i },
  { app: 'Signal', match: /^Signal$/i },
  { app: 'Telegram', match: /^Telegram/i },
  { app: 'Webex', match: /Webex/i },
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

/** Tab titles that mean a call is live, not just the site being open. */
const LIVE_TITLE = /\bmeet\b|\bcall\b|\bhuddle\b|\bvideo\b|\bvoice\b|\bringing\b|\bmeeting\b/i;

/** {app, kind:'app'|'web', via} for the most likely call, or null. */
export function detectCall({ processes = [], tabs = [] } = {}) {
  for (const tab of tabs) {
    const text = `${tab.url || ''} ${tab.title || ''}`;
    const site = CALL_SITES.find(item => item.match.test(text));
    if (site) return { app: site.app, kind: 'web', via: tab.browser || 'browser', live: LIVE_TITLE.test(tab.title || '') || /meet\.google\.com\/[a-z]{3}-|zoom\.us\/(wc|j)\//i.test(tab.url || '') };
  }
  for (const name of processes) {
    const app = CALL_APPS.find(item => item.match.test(name));
    if (app) return { app: app.app, kind: 'app', via: name, live: true };
  }
  return null;
}

/** Split `ps -Ao comm` output into short process names. */
export function processNames(psOutput) {
  return String(psOutput || '').split('\n').map(line => line.trim().split('/').pop()).filter(Boolean);
}
