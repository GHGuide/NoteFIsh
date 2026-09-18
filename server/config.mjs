import path from 'node:path';

const SID = /^AC[0-9a-f]{32}$/i;
const E164 = /^\+[1-9]\d{6,14}$/;

export function loadConfig(env = process.env, root = process.cwd()) {
  const read = (key, max = 1024) => {
    const value = env[key] || '';
    if (typeof value !== 'string' || value.length > max || /[\r\n\0]/.test(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const portText = read('PORT') || '3001';
  if (!/^\d{1,5}$/.test(portText) || Number(portText) < 1 || Number(portText) > 65535) throw new Error('Invalid PORT');
  const production = env.NODE_ENV === 'production' || env.RENDER === 'true';
  const host = read('HOST') || (production ? '0.0.0.0' : '127.0.0.1');
  if (!['127.0.0.1', '::1', '0.0.0.0', '::'].includes(host)) throw new Error('Invalid HOST');
  const publicBaseUrl = (read('PUBLIC_BASE_URL') || read('RENDER_EXTERNAL_URL')).replace(/\/$/, '');
  if (publicBaseUrl) {
    let url;
    try { url = new URL(publicBaseUrl); } catch { throw new Error('Invalid PUBLIC_BASE_URL'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || url.port) throw new Error('PUBLIC_BASE_URL must be an HTTPS origin without credentials, a path, or a custom port');
  }
  const deskPassword = read('NOTEFISH_DESK_PASSWORD', 256);
  const publicDemoValue = read('NOTEFISH_PUBLIC_DEMO', 5);
  if (!['', 'true', 'false'].includes(publicDemoValue)) throw new Error('Invalid NOTEFISH_PUBLIC_DEMO');
  const publicDemo = publicDemoValue === 'true';
  if (publicDemo && !publicBaseUrl) throw new Error('PUBLIC_BASE_URL is required for NOTEFISH_PUBLIC_DEMO');
  if (deskPassword && deskPassword.length < 16) throw new Error('NOTEFISH_DESK_PASSWORD must contain at least 16 characters');
  // Who may claim a fresh desk. Without it the first visitor to a public address
  // would become its admin, so a public desk needs one of the three ways in.
  const adminEmail = read('NOTEFISH_ADMIN_EMAIL', 254).trim().toLowerCase();
  if (adminEmail && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/.test(adminEmail)) throw new Error('Invalid NOTEFISH_ADMIN_EMAIL');
  if (!['127.0.0.1', '::1'].includes(host) && !deskPassword && !publicDemo && !adminEmail) throw new Error('A public HOST needs NOTEFISH_ADMIN_EMAIL (who may create the first account) or NOTEFISH_DESK_PASSWORD');
  const twilioAccountSid = read('TWILIO_ACCOUNT_SID');
  if (twilioAccountSid && !SID.test(twilioAccountSid)) throw new Error('Invalid TWILIO_ACCOUNT_SID');
  const twilioNumber = read('TWILIO_PHONE_NUMBER') || read('TWILIO_CALLER_ID');
  if (twilioNumber && !E164.test(twilioNumber)) throw new Error('Invalid TWILIO_PHONE_NUMBER');
  const sessionSecret = read('NOTEFISH_SESSION_SECRET', 256);
  if (sessionSecret && sessionSecret.length < 32) throw new Error('NOTEFISH_SESSION_SECRET must contain at least 32 characters');
  const count = (key, fallback, max) => {
    const value = read(key, 6) || String(fallback);
    if (!/^\d{1,6}$/.test(value) || Number(value) < 1 || Number(value) > max) throw new Error(`Invalid ${key}`);
    return Number(value);
  };
  const maxAgents = count('NOTEFISH_MAX_AGENTS', 20, 50);
  const maxConcurrentCalls = count('NOTEFISH_MAX_CONCURRENT_CALLS', 20, 50);
  const webhookUrl = read('NOTEFISH_WEBHOOK_URL');
  if (webhookUrl) {
    let url;
    try { url = new URL(webhookUrl); } catch { throw new Error('Invalid NOTEFISH_WEBHOOK_URL'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('NOTEFISH_WEBHOOK_URL must be an HTTPS URL without credentials');
  }
  const webhookSecret = read('NOTEFISH_WEBHOOK_SECRET', 256);
  if (webhookUrl && webhookSecret.length < 32) throw new Error('NOTEFISH_WEBHOOK_SECRET must contain at least 32 characters when a webhook URL is set');
  const exportToken = read('NOTEFISH_EXPORT_TOKEN', 256);
  if (exportToken && exportToken.length < 32) throw new Error('NOTEFISH_EXPORT_TOKEN must contain at least 32 characters');
  const zendeskSubdomain = read('ZENDESK_SUBDOMAIN', 100);
  if (zendeskSubdomain && !/^[a-z0-9][a-z0-9-]{0,62}$/i.test(zendeskSubdomain)) throw new Error('Invalid ZENDESK_SUBDOMAIN');
  const zendeskEmail = read('ZENDESK_EMAIL', 200);
  const zendeskApiToken = read('ZENDESK_API_TOKEN', 256);
  if (zendeskSubdomain && (!zendeskEmail || !zendeskApiToken)) throw new Error('ZENDESK_EMAIL and ZENDESK_API_TOKEN are required with ZENDESK_SUBDOMAIN');
  const dataDir = read('DATA_DIR') || path.join(root, 'data');
  if (!path.isAbsolute(dataDir)) throw new Error('DATA_DIR must be an absolute directory path');
  const model = (key, fallback) => {
    const value = read(key, 100) || fallback;
    if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  // How long Fish may buffer before the first audio chunk. 'low' starts sooner and
  // costs some prosody; 'normal' waits longest. Anything else is a typo worth catching.
  const latency = read('FISH_LATENCY', 20) || 'balanced';
  if (!['low', 'balanced', 'normal'].includes(latency)) throw new Error('FISH_LATENCY must be low, balanced or normal');
  return Object.freeze({
    root, port: Number(portText), host, publicBaseUrl, deskPassword, publicDemo,
    production, dataPath: path.join(dataDir, 'notefish.json'), distPath: path.join(root, 'dist'),
    openaiApiKey: read('OPENAI_API_KEY'), fishApiKey: read('FISH_API_KEY'),
    twilioAccountSid, twilioAuthToken: read('TWILIO_AUTH_TOKEN'), twilioNumber,
    sessionSecret, adminEmail, maxAgents, maxConcurrentCalls,
    webhookUrl, webhookSecret, exportToken,
    zendeskSubdomain, zendeskEmail, zendeskApiToken,
    demoVoiceReferenceId: read('NOTEFISH_DEMO_VOICE_REFERENCE_ID', 128),
    fishModel: model('FISH_MODEL', 's2.1-pro-free'),
    fishLatency: latency,
    transcribeModel: model('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
    // Live captions run on their own model: the batch one transcribes a finished clip,
    // this one streams words back while the caller is still talking.
    liveTranscribeModel: model('OPENAI_LIVE_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
    translationModel: model('OPENAI_TRANSLATION_MODEL', 'gpt-4o-mini'),
  });
}

export function getStatus(config, { audioAvailable = false, driverInstalled = null } = {}) {
  const keys = {
    OPENAI_API_KEY: config.openaiApiKey, FISH_API_KEY: config.fishApiKey,
    PUBLIC_BASE_URL: config.publicBaseUrl,
    ...(!config.publicDemo ? { NOTEFISH_DESK_PASSWORD: config.deskPassword } : {}),
  };
  const missing = Object.entries(keys).filter(([, value]) => !value).map(([key]) => key);
  const blockers = missing.map(key => `Set ${key} in the server environment.`);
  if (!audioAvailable) blockers.push('Install ffmpeg for audio conversion.');
  return {
    providers: {
      fish: { configured: Boolean(config.fishApiKey), verified: false },
      openai: { configured: Boolean(config.openaiApiKey), verified: false },
      twilio: { configured: Boolean(config.twilioAccountSid && config.twilioAuthToken && config.twilioNumber), verified: false, optional: true },
    },
    phoneNumber: config.twilioNumber || null, publicUrl: config.publicBaseUrl || null,
    webhookUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/twilio/incoming` : null,
    statusCallbackUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/twilio/status` : null,
    streamUrl: config.publicBaseUrl ? `${config.publicBaseUrl.replace(/^https:/, 'wss:')}/ws/twilio` : null,
    ready: blockers.length === 0, verified: false, blockers, missing, model: config.fishModel,
    audioAvailable, demoVerified: false, demoTransport: 'browser',
    mac: { platform: process.platform, driverInstalled }, // the NoteFish Voice virtual microphone, for calls in Zoom and the rest
    access: { mode: config.publicDemo ? 'shared-demo' : 'protected', loginRequired: !config.publicDemo },
    callerUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/caller` : null,
    // A shared demo has no way to tell one visitor from another, so a roster of
    // named agents there would be theatre. Multi-agent stays protected-only.
    floor: {
      multiAgent: !config.publicDemo,
      reason: config.publicDemo ? 'The shared demo runs as one desk. Set NOTEFISH_PUBLIC_DEMO=false to run a roster of agents.' : '',
      maxAgents: config.maxAgents, maxConcurrentCalls: config.maxConcurrentCalls,
      persistentSessions: Boolean(config.sessionSecret),
    },
    integrations: {
      webhook: { configured: Boolean(config.webhookUrl), url: config.webhookUrl || null },
      zendesk: { configured: Boolean(config.zendeskSubdomain && config.zendeskEmail && config.zendeskApiToken) },
      exportApi: { configured: Boolean(config.exportToken) },
    },
  };
}
