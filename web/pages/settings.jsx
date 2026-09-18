// Settings, as a panel over the desk rather than a place you navigate away to.
//
// Two columns: a rail of sections on the left under their group headings, and on the
// right one quiet container of rows — a label, a line saying what it is, and the
// control. Closing it puts you back on the page you were reading.
import React, { useEffect, useRef, useState } from 'react';
import { BadgeCheck, Copy, Database, ExternalLink, Gauge, Headphones, Info, Link2, Mic, Phone as PhoneIcon, Plug, RefreshCw, Settings as Cog, ShieldCheck, UserRound, X } from 'lucide-react';
import { api } from '../api.js';
import { languages, languageName, isArchived } from '../lib.jsx';
import { Row, Setting, Status, Dot, Label, Chip, Btn, TextBtn, SelectPill, Field, Switch } from '../shell.jsx';
import { showAllGuides, guidesHidden } from '../components/explainer.jsx';
import './settings.css';

const LANGS = languages.map(item => ({ value: item.code, label: item.name }));
const callerName = code => code === 'auto' ? 'whatever they speak' : languageName(code);
const onOff = on => <Status tone={on ? 'green' : 'muted'}>{on ? 'On' : 'Off'}</Status>;
const when = value => value ? new Date(value).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

const SECTIONS = [
  { group: 'Settings', key: 'general', label: 'General', icon: Cog },
  { group: 'Settings', key: 'voice', label: 'Voice', icon: Mic },
  { group: 'Settings', key: 'calls', label: 'Calls', icon: Headphones },
  { group: 'Settings', key: 'phone', label: 'Phone number', icon: PhoneIcon },
  { group: 'Settings', key: 'integrations', label: 'Integrations', icon: Plug },
  { group: 'Account', key: 'account', label: 'Account', icon: UserRound },
  { group: 'Account', key: 'privacy', label: 'Data and privacy', icon: ShieldCheck },
  { group: 'Account', key: 'about', label: 'About', icon: Info },
];

/** The container everything sits in: rows divided by hairlines, nothing shouting. */
const Panel = ({ children }) => <div className="set-panel">{children}</div>;

export default function SettingsModal(common) {
  const { data, route, navigate, reload, setNotice, setError, onClose } = common;
  const wanted = SECTIONS.some(item => item.key === route.query.tab) ? route.query.tab : 'general';
  const [section, setSection] = useState(wanted);
  const [refreshing, setRefreshing] = useState(false);
  const card = useRef(null);
  useEffect(() => {
    const key = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    card.current?.focus();
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);

  const setup = data.setup || {};
  const readyVoices = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice));
  const copy = async value => { try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); } catch { setError('Clipboard access is unavailable. Select and copy it by hand.'); } };
  const shared = { ...common, setup, readyVoices, copy, setSection };
  const Pane = { general: General, voice: VoicePane, calls: Calls, phone: Phone, integrations: Integrations, account: Account, privacy: Privacy, about: About }[section];
  const title = SECTIONS.find(item => item.key === section)?.label || 'Settings';
  const groups = [...new Set(SECTIONS.map(item => item.group))];

  return <div className="set-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="set-card" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} ref={card}>
      <aside className="set-rail">
        {groups.map(group => <div className="set-group" key={group}>
          <Label>{group}</Label>
          {SECTIONS.filter(item => item.group === group).map(item => <button
            key={item.key} type="button" className={section === item.key ? 'on' : ''}
            aria-current={section === item.key ? 'page' : undefined}
            onClick={() => setSection(item.key)}
          ><item.icon size={16} strokeWidth={1.7} />{item.label}</button>)}
        </div>)}
        <div className="set-ver">
          <BadgeCheck size={14} />
          <span>NoteFish{setup.version ? ` ${setup.version}` : ''}</span>
        </div>
      </aside>
      <div className="set-main">
        <div className="set-top">
          <h1>{title}</h1>
          <div className="set-top-r">
            <button type="button" className="ds-tool" title="Refresh what the server reports" aria-label="Refresh status" disabled={refreshing}
              onClick={async () => { setRefreshing(true); await reload(); setRefreshing(false); }}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /></button>
            <button type="button" className="ds-tool" aria-label="Close settings" onClick={onClose}><X size={16} /></button>
          </div>
        </div>
        <div className="set-body"><Pane {...shared} navigate={path => { onClose(); navigate(path); }} /></div>
      </div>
    </div>
  </div>;
}

function General({ data, saveSettings }) {
  const s = data.settings;
  const [style, setStyle] = useState(false);
  const [guides, setGuides] = useState(() => guidesHidden());
  return <>
    <Panel>
      <Setting main="Languages" sub={`You speak ${languageName(s.agentLanguage)} · callers speak ${callerName(s.customerLanguage)} unless a call says otherwise`}>
        <SelectPill aria-label="Your language" value={s.agentLanguage} onChange={agentLanguage => saveSettings({ agentLanguage })} options={LANGS} />
        <SelectPill aria-label="Caller language" value={s.customerLanguage} onChange={customerLanguage => saveSettings({ customerLanguage })} options={[{ value: 'auto', label: 'Detect automatically' }, ...LANGS]} />
      </Setting>
      <Setting main="Line name" sub="What this desk is called on tickets and exports">
        <input key={s.queueName} className="set-inline" aria-label="Line name" defaultValue={s.queueName} maxLength={100}
          onBlur={event => { const queueName = event.target.value.trim(); if (queueName && queueName !== s.queueName) saveSettings({ queueName }); }}
          onKeyDown={event => { if (event.key === 'Enter') event.target.blur(); }} />
      </Setting>
      <Setting main="House style" sub={s.persona || 'How replies are worded before they are spoken'}>
        <Btn kind="pill" onClick={() => setStyle(!style)}>{style ? 'Done' : 'Change'}</Btn>
      </Setting>
      {style && <div className="set-more">
        <Field label="House style"><textarea rows={3} maxLength={300} autoFocus defaultValue={s.persona || ''}
          placeholder="Brief and friendly. Formal “vous”. Never promise a time you can’t keep."
          onBlur={event => { const persona = event.target.value.trim(); if (persona !== (s.persona || '')) saveSettings({ persona }); }} /></Field>
        <p className="ds-note">Shapes length, politeness and phrasing. Facts and meaning never change.</p>
      </div>}
      <Setting main="Screen guides" sub={guides ? `${guides} hidden · the card at the top of each screen explaining what it is for` : 'The card at the top of each screen explaining what it is for'}>
        <Btn kind="pill" disabled={!guides} onClick={() => { showAllGuides(); setGuides(0); }}>Show again</Btn>
      </Setting>
      <Setting main="Setup" sub="The short walkthrough: languages, a voice, a test call, this Mac">
        <Btn kind="pill" onClick={() => { try { sessionStorage.removeItem('notefish.setupPaused'); } catch { /* fine */ } saveSettings({ onboardedAt: null }); }}>Run again</Btn>
      </Setting>
    </Panel>
  </>;
}

function VoicePane({ data, readyVoices, saveSettings, navigate }) {
  const s = data.settings;
  const voice = data.voices.find(item => item.id === s.voiceId);
  const takes = Object.values(s.registers || {}).filter(Boolean).length;
  return <Panel>
    <Setting main="The voice that answers" sub={voice ? `${voice.name} · ${voice.kind === 'licensed' ? 'licensed' : 'your clone'}` : 'No voice chosen yet · callers hear nothing until one is'}>
      <SelectPill aria-label="The voice that answers" value={s.voiceId || ''} onChange={value => saveSettings({ voiceId: value || null })}
        options={[{ value: '', label: readyVoices.length ? 'Choose a voice' : 'No ready voice yet' }, ...readyVoices.map(item => ({ value: item.id, label: item.name }))]} />
    </Setting>
    <Setting main="Takes" sub={takes ? `${takes} of 6 feelings recorded · a reply is spoken with the take that fits its tone` : 'One take is enough. Record more and replies match the mood.'}>
      <Btn kind="pill" onClick={() => navigate('/voice?tab=takes')}>Record</Btn>
    </Setting>
    <Setting main="Your voices" sub={`${data.voices.filter(item => !isArchived(item)).length} in the library`}>
      <Btn kind="pill" onClick={() => navigate('/voice?tab=library')}>Open library</Btn>
    </Setting>
  </Panel>;
}

function Calls({ setup, data, navigate }) {
  const mac = setup.mac || {};
  return <>
    <Panel>
      <Setting main="Listen for calls" sub="The Mac app watches Zoom, Meet, Teams and WhatsApp, and offers to translate a call when one starts">
        <Status tone={mac.listening ? 'green' : 'muted'}>{mac.listening ? 'On' : 'Turn on in the menu bar'}</Status>
      </Setting>
      <Setting main="NoteFish Voice" sub={mac.driverInstalled ? 'Installed · choose it as the microphone in the call app' : 'Not installed · without it a bridged call has nothing to speak into'}>
        {onOff(mac.driverInstalled)}
      </Setting>
      <Setting main="Caller link" sub={setup.publicUrl ? `${setup.publicUrl}/caller · one use, expires` : 'Needs a public HTTPS address before a phone can open one'}>
        <Btn kind="pill" onClick={() => navigate('/desk')}>Create one</Btn>
      </Setting>
    </Panel>
    <p className="ds-note set-foot">Your own microphone never reaches the caller. Only the cloned voice does.</p>
  </>;
}

function Phone({ data, setup, readyVoices, navigate, copy }) {
  const webhook = setup.webhookUrl || '';
  const checklist = [
    { done: setup.providers?.fish?.configured && setup.providers?.openai?.configured, label: 'Provider keys are set', hint: 'Set FISH_API_KEY and OPENAI_API_KEY in the server environment.' },
    { done: setup.audioAvailable, label: 'Audio conversion is available', hint: 'Install ffmpeg on the server.' },
    { done: readyVoices.length > 0, label: 'A voice is ready to speak', hint: 'Record one under Voice, or import a licensed voice.', action: { label: 'Record one', path: '/voice?tab=takes' } },
    { done: Boolean(data.settings.voiceId), label: 'A voice is chosen', hint: 'Pick the one that answers under Voice.' },
    { done: Boolean(setup.publicUrl), label: 'A public HTTPS address is set', hint: 'Set PUBLIC_BASE_URL so a phone can reach this desk.' },
    { done: Boolean(setup.phoneNumber), label: 'A phone number is connected', hint: 'Optional. Browser and bridged calls work without one.', optional: true },
  ];
  const remaining = checklist.filter(item => !item.done && !item.optional).length;
  return <>
    <Panel>
      <Setting main="Incoming number" sub={setup.phoneNumber ? `${setup.phoneNumber} · callers dial this from their own phone` : 'None connected · browser and bridged calls work without one'}>
        {setup.phoneNumber && <button type="button" className="ds-tool" aria-label="Copy the number" onClick={() => copy(setup.phoneNumber)}><Copy size={14} /></button>}
      </Setting>
      <Setting main="Where Twilio should send the call" sub="Set this as the number's “A call comes in” webhook, HTTP POST">
        <Btn kind="pill" disabled={!webhook} onClick={() => copy(webhook)}>Copy</Btn>
      </Setting>
    </Panel>
    <div className="set-copy">{webhook || 'Your webhook address appears here once a public address is set.'}</div>
    <a className="ds-text set-foot" href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noreferrer">Open the Twilio console <ExternalLink size={12} /></a>
    <Label style={{ margin: '22px 0 2px' }}>{remaining ? `Before your first call · ${remaining} left` : 'Ready for a call'}</Label>
    {checklist.map(item => <Row key={item.label} lead={<span className="lead"><Dot tone={item.done ? 'green' : 'muted'} /></span>} main={item.label} sub={item.done ? undefined : item.hint}
      right={!item.done && item.action ? <TextBtn onClick={() => navigate(item.action.path)}>{item.action.label}</TextBtn> : !item.done && item.optional ? <Chip>Optional</Chip> : undefined} />)}
  </>;
}

function Integrations({ setup }) {
  const [recent, setRecent] = useState(null);
  useEffect(() => { let live = true; api.integrations().then(result => { if (live) setRecent(result.recent || []); }).catch(failure => { if (live) setRecent({ error: failure.message }); }); return () => { live = false; }; }, []);
  const hooks = setup.integrations || {};
  return <>
    <Panel>
      <Setting main="Signed webhook" sub={hooks.webhook?.configured ? hooks.webhook.url : 'Set NOTEFISH_WEBHOOK_URL and NOTEFISH_WEBHOOK_SECRET'}>{onOff(hooks.webhook?.configured)}</Setting>
      <Setting main="Zendesk" sub={hooks.zendesk?.configured ? 'Creates a ticket for each completed call' : 'Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_API_TOKEN'}>{onOff(hooks.zendesk?.configured)}</Setting>
      <Setting main="Export API" sub={hooks.exportApi?.configured ? 'GET /api/export/calls with the export bearer token' : 'Set NOTEFISH_EXPORT_TOKEN to let a system pull calls'}>{onOff(hooks.exportApi?.configured)}</Setting>
    </Panel>
    <p className="ds-note set-foot">A finished call can leave as a ticket. Nothing an integration returns comes back into a call.</p>
    <Label style={{ margin: '22px 0 2px' }}>Recent deliveries</Label>
    {recent?.error ? <p className="ds-note">Deliveries could not be loaded: {recent.error} Try the refresh button above.</p>
      : recent?.length ? recent.map((entry, index) => <Row key={index} main={entry.adapter} sub={`${when(entry.at)}${entry.error ? ` · ${entry.error}` : ''}`} right={<Status tone={entry.ok ? 'green' : 'red'}>{entry.ok ? 'Delivered' : 'Failed'}</Status>} />)
      : recent ? <p className="ds-note">Nothing delivered yet.</p>
      : <p className="ds-note">Loading deliveries…</p>}
  </>;
}

function Account({ user, setup }) {
  const mode = setup.access?.mode || '';
  return <>
    <Panel>
      <Setting main="Signed in as" sub={user?.email || 'No account on this desk · it opens straight to work on this Mac'}>
        {user ? <Chip tone="ink">{user.name}</Chip> : <Chip>Local</Chip>}
      </Setting>
      <Setting main="This desk" sub={mode === 'shared-demo' ? 'Shared demo · anyone with the address can use it' : 'Yours. Signing in happened once and there is nothing to sign out of.'}>
        <Status tone={mode === 'shared-demo' ? 'amber' : 'green'}>{mode === 'shared-demo' ? 'Shared' : 'Private'}</Status>
      </Setting>
    </Panel>
    <p className="ds-note set-foot">There is no sign-out. The desk belongs to whoever set it up, and stays theirs.</p>
  </>;
}

function Privacy({ setup, data }) {
  return <>
    <Panel>
      <Setting main="Where calls are kept" sub={setup.storage === 'database' ? 'In your database · backed up by whoever runs it' : 'In a file beside the server on this machine'}>
        <Chip icon={<Database size={12} />}>{setup.storage === 'database' ? 'Database' : 'On disk'}</Chip>
      </Setting>
      <Setting main="Calls stored" sub={`${data.calls.length} kept · transcripts included`}>
        <Chip>{data.calls.length}</Chip>
      </Setting>
      <Setting main="Voice recordings" sub="The audio you record is sent to the voice provider to build the clone, and is not kept here afterwards">
        <Chip icon={<Link2 size={12} />}>{data.voices.filter(v => v.kind === 'enrolled').length} cloned</Chip>
      </Setting>
    </Panel>
    <p className="ds-note set-foot">Deleting a voice for good removes the model at the provider as well as the entry here.</p>
  </>;
}

function About({ setup }) {
  const p = setup.providers || {};
  return <>
    <Panel>
      <Setting main="Speech" sub="Fish Audio clones the voice and speaks the replies">{onOff(p.fish?.configured)}</Setting>
      <Setting main="Words" sub="OpenAI transcribes the caller and translates">{onOff(p.openai?.configured)}</Setting>
      <Setting main="Fallback speech" sub="ElevenLabs speaks if Fish cannot">{onOff(p.elevenlabs?.configured)}</Setting>
      <Setting main="Audio conversion" sub="ffmpeg, for turning call audio into something the providers accept">{onOff(setup.audioAvailable)}</Setting>
      <Setting main="Phone" sub="Twilio, only needed for a real phone number">{onOff(p.twilio?.configured)}</Setting>
    </Panel>
    <p className="ds-note set-foot">Keys live in the server's environment and never reach this page.</p>
  </>;
}
