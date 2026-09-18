// Settings: the desk's own defaults, the integrations, and the phone number
// (the old Setup page in design clothes).
import React, { useEffect, useState } from 'react';
import { Copy, ExternalLink, Plus, RefreshCw, Send, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { languages, languageName, isArchived } from '../lib.jsx';
import { Toolbar, Title, Tabs, ReadBar, Body, Row, Setting, Status, Dot, Label, Chip, Btn, TextBtn, SelectPill, Field, Avatar, Empty, Ask } from '../shell.jsx';
import './settings.css';

const TABS = [{ key: 'workspace', label: 'Workspace' }, { key: 'integrations', label: 'Integrations' }, { key: 'phone', label: 'Phone number' }];
const LANGS = languages.map(item => ({ value: item.code, label: item.name }));
const callerName = code => code === 'auto' ? 'whatever they speak' : languageName(code);
const onOff = on => <Status tone={on ? 'green' : 'muted'}>{on ? 'On' : 'Off'}</Status>;
const when = value => value ? new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export default function SettingsPage(common) {
  const { data, route, navigate, reload, setNotice, setError } = common;
  const tab = TABS.some(item => item.key === route.query.tab) ? route.query.tab : 'workspace';
  const setTab = key => navigate(key === 'workspace' ? '/settings' : `/settings?tab=${key}`);
  const [refreshing, setRefreshing] = useState(false);
  const setup = data.setup || {};
  const readyVoices = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice));
  const copy = async value => { try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); } catch { setError('Clipboard access is unavailable. Select and copy it by hand.'); } };
  const shared = { ...common, setup, readyVoices, copy, setTab };
  const Pane = { workspace: Workspace, integrations: Integrations, phone: Phone }[tab];
  return <>
    <Toolbar><button type="button" className="ds-tool filled" disabled={refreshing} onClick={async () => { setRefreshing(true); await reload(); setRefreshing(false); }}><RefreshCw size={14} className={refreshing ? 'spin' : ''} />Refresh status</button></Toolbar>
    <Title title="Settings" sub="How this desk answers, and what it is connected to" />
    <Tabs items={TABS} value={tab} onChange={setTab} />
    <Pane {...shared} />
    <Ask placeholder="Ask about a setting" scope="settings" />
  </>;
}

function Workspace({ data, setup, readyVoices, saveSettings, setTab }) {
  const [style, setStyle] = useState(false);
  const s = data.settings;
  const voice = data.voices.find(item => item.id === s.voiceId);
  const hooks = setup.integrations || {};
  return <Body>
    <Setting main="Default voice" sub={voice ? `${voice.name} · ${voice.kind === 'licensed' ? 'licensed' : 'clone'} · used by anyone without their own` : 'No voice chosen yet · used by anyone without their own'}>
      <SelectPill aria-label="Default voice" value={s.voiceId || ''} onChange={value => saveSettings({ voiceId: value || null })} options={[{ value: '', label: readyVoices.length ? 'Choose a voice' : 'No ready voice yet' }, ...readyVoices.map(item => ({ value: item.id, label: item.name }))]} />
    </Setting>
    <Setting main="Languages" sub={`Agents speak ${languageName(s.agentLanguage)} · callers speak ${callerName(s.customerLanguage)} by default`}>
      <SelectPill aria-label="Agent language" value={s.agentLanguage} onChange={agentLanguage => saveSettings({ agentLanguage })} options={LANGS} />
      <SelectPill aria-label="Caller language" value={s.customerLanguage} onChange={customerLanguage => saveSettings({ customerLanguage })} options={[{ value: 'auto', label: 'Detect automatically' }, ...LANGS]} />
    </Setting>
    <Setting main="Line name" sub={s.queueName}>
      <input key={s.queueName} className="settings-inline" aria-label="Line name" defaultValue={s.queueName} maxLength={100} onBlur={event => { const queueName = event.target.value.trim(); if (queueName && queueName !== s.queueName) saveSettings({ queueName }); }} onKeyDown={event => { if (event.key === 'Enter') event.target.blur(); }} />
    </Setting>
    <Setting main="House style" sub={s.persona || 'How replies are worded'}><TextBtn onClick={() => setStyle(!style)}>{style ? 'Done' : 'Change'}</TextBtn></Setting>
    {style && <div className="settings-more">
      <Field label="House style"><textarea rows={2} maxLength={300} autoFocus defaultValue={s.persona || ''} placeholder="Brief and friendly. Formal “vous”. Never promise a time you can’t keep." onBlur={event => { const persona = event.target.value.trim(); if (persona !== (s.persona || '')) saveSettings({ persona }); }} /></Field>
      <p className="ds-note">Shapes how replies are worded before they are spoken: length, politeness, phrasing. Facts and meaning never change.</p>
    </div>}
    <Setting main="Setup" sub="The five-minute walkthrough: languages, voice, a test line, this Mac."><TextBtn onClick={() => { try { sessionStorage.removeItem('notefish.setupPaused'); } catch { /* fine */ } saveSettings({ onboardedAt: null }); }}>Run again</TextBtn></Setting>
    <Setting main="Zendesk" sub="Creates a ticket for every completed call">{onOff(hooks.zendesk?.configured)}</Setting>
    <Setting main="Signed webhook" sub={hooks.webhook?.url || 'Posts every completed call to your endpoint, signed'}>{onOff(hooks.webhook?.configured)}</Setting>
    <Setting main="Export API" sub="Let a system pull calls as JSON or CSV">{onOff(hooks.exportApi?.configured)}</Setting>
    <Setting main="Phone number" sub={setup.phoneNumber || 'No number connected · browser calls work without one'}><TextBtn onClick={() => setTab('phone')}>{setup.phoneNumber ? 'Change' : 'Connect'}</TextBtn></Setting>
  </Body>;
}

const ROLE_OPTIONS = [{ value: 'admin', label: 'Admin' }, { value: 'supervisor', label: 'Supervisor' }, { value: 'agent', label: 'Agent' }];
function Integrations({ setup }) {
  const [recent, setRecent] = useState(null);
  useEffect(() => { let live = true; api.integrations().then(result => { if (live) setRecent(result.recent || []); }).catch(() => { if (live) setRecent([]); }); return () => { live = false; }; }, []);
  const hooks = setup.integrations || {};
  return <Body>
    <Setting main="Signed webhook" sub={hooks.webhook?.configured ? hooks.webhook.url : 'Set NOTEFISH_WEBHOOK_URL and NOTEFISH_WEBHOOK_SECRET.'}>{onOff(hooks.webhook?.configured)}</Setting>
    <Setting main="Zendesk" sub={hooks.zendesk?.configured ? 'Creates a ticket for each completed call.' : 'Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_API_TOKEN.'}>{onOff(hooks.zendesk?.configured)}</Setting>
    <Setting main="Export API" sub={hooks.exportApi?.configured ? 'GET /api/export/calls with the export bearer token.' : 'Set NOTEFISH_EXPORT_TOKEN to let a system pull calls.'}>{onOff(hooks.exportApi?.configured)}</Setting>
    <p className="ds-note" style={{ marginTop: 12 }}>A completed call can leave as a ticket. NoteFish never becomes the system of record.</p>
    <Label style={{ margin: '18px 0 2px' }}>Recent deliveries</Label>
    {recent?.length ? recent.map((entry, index) => <Row key={index} main={entry.adapter} sub={`${when(entry.at)}${entry.error ? ` · ${entry.error}` : ''}`} right={<Status tone={entry.ok ? 'green' : 'red'}>{entry.ok ? 'Delivered' : 'Failed'}</Status>} />)
      : <p className="ds-note">{recent ? 'Nothing delivered yet.' : 'Loading…'}</p>}
  </Body>;
}

function Phone({ data, setup, readyVoices, navigate, copy }) {
  const webhook = setup.webhookUrl || '';
  // One list that says what is still missing, in the order it has to be fixed.
  const checklist = [
    { done: setup.providers?.fish?.configured && setup.providers?.openai?.configured, label: 'Provider keys are set', hint: 'Set FISH_API_KEY and OPENAI_API_KEY in the server environment.' },
    { done: setup.audioAvailable, label: 'Audio conversion is available', hint: 'Install ffmpeg on the server.' },
    { done: readyVoices.length > 0, label: 'A voice is ready to speak', hint: 'Record one under Voice, or import a licensed voice.', action: { label: 'Create voice', path: '/voice?tab=takes' } },
    { done: Boolean(data.settings.voiceId), label: 'A voice is selected for the line', hint: 'Choose the default voice under Workspace.' },
    { done: Boolean(setup.publicUrl), label: 'A public HTTPS address is set', hint: 'Set PUBLIC_BASE_URL so a phone can reach this desk.' },
    { done: Boolean(setup.phoneNumber), label: 'A phone number is connected', hint: 'Optional. Browser calls work without one.', optional: true },
  ];
  const remaining = checklist.filter(item => !item.done && !item.optional).length;
  return <Body>
    <div className="settings-block">
      <Setting main="Choose your incoming number" sub={setup.phoneNumber ? `${setup.phoneNumber} · customers call it from their own phone` : 'No number connected yet · customers call this number from their own phone'}>
        {setup.phoneNumber && <button type="button" className="ds-tool" aria-label="Copy phone number" onClick={() => copy(setup.phoneNumber)}><Copy size={14} /></button>}
      </Setting>
      <p className="ds-note">Use a voice-capable Twilio number. In the Twilio Console, open <b>Phone Numbers → Manage → Active numbers</b> and choose the number you want to use.</p>
      <a className="ds-text" href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noreferrer">Open Twilio Console <ExternalLink size={12} /></a>
    </div>
    <div className="settings-block">
      <Setting main="Point the number to your desk" sub="Tell Twilio where incoming calls should go · HTTP POST" />
      <div className="ds-copyrow"><span className="val" style={webhook ? undefined : { color: 'var(--placeholder)' }}>{webhook || 'Your public webhook appears here'}</span><Btn kind="ghost" small disabled={!webhook} onClick={() => copy(webhook)}>Copy</Btn></div>
      <p className="ds-note">Under the number’s <b>Voice configuration</b>, set “A call comes in” to <b>Webhook</b>, paste this address, choose <b>HTTP POST</b>, then save.</p>
      {!webhook && <div className="ds-info">The website needs a public HTTPS address so Twilio can reach it. Set PUBLIC_BASE_URL, then refresh the status.</div>}
      <p className="ds-note">Twilio opens the phone connection before you click Answer. The customer waits on the line until you answer at the desk.</p>
    </div>
    <Label style={{ margin: '18px 0 2px' }}>{remaining ? `Before your first call · ${remaining} left` : 'Ready for a call'}</Label>
    {checklist.map(item => <Row key={item.label} lead={<span className="lead"><Dot tone={item.done ? 'green' : 'muted'} /></span>} main={item.label} sub={item.done ? undefined : item.hint}
      right={!item.done && item.action ? <TextBtn onClick={() => navigate(item.action.path)}>{item.action.label}</TextBtn> : !item.done && item.optional ? <Chip>Optional</Chip> : undefined} />)}
  </Body>;
}
