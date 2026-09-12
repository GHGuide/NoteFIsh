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
  if (deskPassword && deskPassword.length < 16) throw new Error('NOTEFISH_DESK_PASSWORD must contain at least 16 characters');
  if (!['127.0.0.1', '::1'].includes(host) && !deskPassword) throw new Error('NOTEFISH_DESK_PASSWORD is required for a non-loopback HOST');
  const twilioAccountSid = read('TWILIO_ACCOUNT_SID');
  if (twilioAccountSid && !SID.test(twilioAccountSid)) throw new Error('Invalid TWILIO_ACCOUNT_SID');
  const twilioNumber = read('TWILIO_PHONE_NUMBER') || read('TWILIO_CALLER_ID');
  if (twilioNumber && !E164.test(twilioNumber)) throw new Error('Invalid TWILIO_PHONE_NUMBER');
  const dataDir = read('DATA_DIR') || path.join(root, 'data');
  if (!path.isAbsolute(dataDir)) throw new Error('DATA_DIR must be an absolute directory path');
  const model = (key, fallback) => {
    const value = read(key, 100) || fallback;
    if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  return Object.freeze({
    root, port: Number(portText), host, publicBaseUrl, deskPassword,
    production, dataPath: path.join(dataDir, 'notefish.json'), distPath: path.join(root, 'dist'),
    openaiApiKey: read('OPENAI_API_KEY'), fishApiKey: read('FISH_API_KEY'),
    twilioAccountSid, twilioAuthToken: read('TWILIO_AUTH_TOKEN'), twilioNumber,
    fishModel: model('FISH_MODEL', 's2.1-pro-free'),
    transcribeModel: model('OPENAI_TRANSCRIBE_MODEL', 'gpt-4o-mini-transcribe'),
    translationModel: model('OPENAI_TRANSLATION_MODEL', 'gpt-4o-mini'),
  });
}

export function getStatus(config, { audioAvailable = false } = {}) {
  const keys = {
    OPENAI_API_KEY: config.openaiApiKey, FISH_API_KEY: config.fishApiKey,
    PUBLIC_BASE_URL: config.publicBaseUrl,
    NOTEFISH_DESK_PASSWORD: config.deskPassword,
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
    callerUrl: config.publicBaseUrl ? `${config.publicBaseUrl}/caller` : null,
  };
}
