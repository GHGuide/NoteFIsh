import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Archive, ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Copy, ExternalLink, FileAudio, Globe2, Headphones, Library, Link2, Loader2, Menu, Mic, MoreHorizontal, Phone, PhoneCall, PhoneOff, Play, Plus, Radio, RefreshCw, Search, Send, Settings2, Share2, ShieldCheck, Smartphone, Sparkles, Square, Trash2, Upload, Volume2, X } from 'lucide-react';
import { api } from './api.js';
import { CallerAudio, recordingType } from './audio.js';
import { languages, languageName } from '../server/languages.mjs';
import Caller from './Caller.jsx';
import AudioWaveform from './components/AudioWaveform.jsx';
import { UiProvider, Dialog as Modal, ChoiceTabs, ActionMenu, Tooltip, RouteTransition } from './components/ui.jsx';
import { motion } from 'motion/react';
import conversationIllustration from './assets/undraw-audio-conversation.svg';
import recordingIllustration from './assets/undraw-recording.svg';

const DEFAULT_SETTINGS = { voiceId: '', agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' };
const NAV = [{ path: '/voices', label: 'Voice library', icon: Library }, { path: '/enroll', label: 'Create voice', icon: AudioLines }, { path: '/desk', label: 'Call desk', icon: Headphones }, { path: '/admin', label: 'Demo setup', icon: Settings2 }];
const isArchived = voice => Boolean(voice.archived || voice.archivedAt);
const needsDispatch = value => value === true || ['requested', 'pending', 'confirmed'].includes(value);
const callState = call => call?.state || (call?.status === 'active' ? 'in_call' : call?.status);
const stamp = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
const formatDuration = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function useCapture(onFinish, maximumSeconds = 90) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [stream, setStream] = useState(null);
  const [interrupted, setInterrupted] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const capture = useRef(null);
  const wanted = useRef(false);
  const done = useRef(onFinish);
  done.current = onFinish;
  const stop = useCallback((cancel = false) => {
    wanted.current = false;
    const current = capture.current;
    if (current) { current.cancelled ||= cancel; if (current.recorder.state !== 'inactive') current.recorder.stop(); }
  }, []);
  const start = useCallback(async () => {
    if (wanted.current || capture.current) return;
    wanted.current = true;
    setRequesting(true);
    setCaptureError('');
    setInterrupted(false);
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording requires HTTPS or localhost. Upload a recording, or open the secure website.');
      const mimeType = recordingType();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!wanted.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      const current = { recorder, stream, cancelled: false, startedAt: Date.now() };
      capture.current = current;
      setStream(stream);
      for (const track of stream.getAudioTracks()) {
        track.onmute = () => setInterrupted(true);
        track.onunmute = () => setInterrupted(false);
        track.onended = () => {
          current.cancelled = true;
          wanted.current = false;
          setCaptureError('Your microphone disconnected. This recording was discarded. Reconnect it and try again.');
          if (recorder.state !== 'inactive') recorder.stop();
        };
      }
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.onunmute = null; track.stop(); });
        const duration = (Date.now() - current.startedAt) / 1000;
        capture.current = null;
        setRecording(false);
        setStream(null);
        setInterrupted(false);
        setSeconds(0);
        if (!current.cancelled && chunks.length) done.current(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), duration);
      };
      recorder.onerror = () => { current.cancelled = true; stream.getTracks().forEach(track => track.stop()); setRecording(false); setStream(null); capture.current = null; wanted.current = false; };
      recorder.start(200);
      setSeconds(0);
      setRecording(true);
    } catch (error) { wanted.current = false; stream?.getTracks().forEach(track => track.stop()); if (capture.current?.stream === stream) capture.current = null; setRecording(false); setStream(null); throw error; }
    finally { setRequesting(false); }
  }, []);
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => { const elapsed = Math.floor((Date.now() - (capture.current?.startedAt || Date.now())) / 1000); setSeconds(elapsed); if (elapsed >= maximumSeconds) stop(); }, 200);
    return () => clearInterval(interval);
  }, [recording, maximumSeconds, stop]);
  useEffect(() => () => { wanted.current = false; const current = capture.current; if (current) { current.cancelled = true; if (current.recorder.state !== 'inactive') current.recorder.stop(); current.stream.getTracks().forEach(track => track.stop()); } }, []);
  return { recording, requesting, seconds, stream, interrupted, error: captureError, start, stop };
}

function LanguageSelect({ label, value, onChange, disabled = false, id }) {
  return <label className="field"><span>{label}</span><div className="select-wrap"><Globe2 size={15} /><select id={id} value={value || 'en'} onChange={event => onChange(event.target.value)} disabled={disabled}>{languages.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}</select><ChevronDown size={14} /></div></label>;
}

function StatusPill({ status }) { return <span className={`status-pill ${status}`}><span />{status === 'ready' ? 'Ready to use' : status === 'training' ? 'Training' : status === 'failed' ? 'Needs attention' : status === 'archived' ? 'Archived' : status}</span>; }
function Spinner({ size = 16 }) { return <Loader2 className="spin" size={size} />; }
function VoiceAvatar({ name = '', large = false }) { const seed = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0); return <div aria-hidden="true" className={`voice-avatar avatar-${seed % 5} ${large ? 'large' : ''}`}><div /><AudioLines size={large ? 36 : 25} strokeWidth={1.25} /></div>; }

export default function App() {
  // The public caller surface never initializes authenticated workspace hooks,
  // loads voices/settings/tickets, or opens the desk WebSocket.
  return <UiProvider>{location.pathname.replace(/\/+$/, '') === '/caller' ? <CallerEntry /> : <WorkspaceApp />}</UiProvider>;
}

function CallerEntry() {
  const [fragment, setFragment] = useState(location.hash);
  useEffect(() => {
    const update = () => setFragment(location.hash);
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
  }, []);
  // Changing invitation ends the previous caller session via its unmount cleanup.
  return <Caller key={fragment} />;
}

function WorkspaceApp() {
  const [route, setRoute] = useState(location.pathname === '/' ? '/voices' : location.pathname);
  const [mobileNav, setMobileNav] = useState(false);
  const [data, setData] = useState({ voices: [], settings: DEFAULT_SETTINGS, calls: [], setup: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [audioReady, setAudioReady] = useState(false);
  const player = useRef(new CallerAudio());
  const navigate = useCallback(path => { history.pushState({}, '', path); setRoute(path); setMobileNav(false); window.scrollTo(0, 0); }, []);
  useEffect(() => { const pop = () => setRoute(location.pathname); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  const reload = useCallback(async () => {
    try { const value = await api.bootstrap(); setData(current => ({ ...current, ...value, settings: { ...DEFAULT_SETTINGS, ...value.settings } })); setError(''); }
    catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const updateCall = useCallback(call => { if (!call) return; setData(current => ({ ...current, calls: [call, ...current.calls.filter(item => item.id !== call.id)] })); }, []);
  useEffect(() => {
    let socket, timer, disposed = false;
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/desk`);
      socket.onopen = () => setConnection('connected');
      socket.onmessage = event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'snapshot') setData(current => ({ ...current, calls: message.calls || current.calls, settings: message.settings ? { ...current.settings, ...message.settings } : current.settings }));
        if (message.type === 'call') updateCall(message.call);
        if (message.type === 'audio' || message.type === 'caller-audio') player.current.play(message.payload, message.sampleRate || 8000);
        if (message.type === 'error') setError(message.error || message.message || 'The call connection needs attention.');
      };
      socket.onclose = () => { if (!disposed) { setConnection('reconnecting'); timer = setTimeout(connect, 2500); } };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => { disposed = true; clearTimeout(timer); socket?.close(); player.current.clear(); };
  }, [updateCall]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const saveSettings = async patch => {
    try { const result = await api.settings({ ...data.settings, ...patch }); setData(current => ({ ...current, settings: result.settings || result })); return true; }
    catch (failure) { setError(failure.message); return false; }
  };
  const refreshVoices = async () => { const result = await api.voices(); setData(current => ({ ...current, voices: result.voices || [] })); };
  const enableAudio = async () => { await player.current.enable(); setAudioReady(true); };
  const incoming = data.calls.find(call => callState(call) === 'ringing');
  useEffect(() => { player.current.setRinging(Boolean(incoming && audioReady)); return () => player.current.stopRinging(); }, [incoming?.id, audioReady]);
  const page = NAV.find(item => item.path === route) || NAV[0];
  const common = { data, navigate, loading, setError, setNotice, saveSettings, refreshVoices, updateCall };
  return <div className="app-shell">
    <aside id="workspace-sidebar" className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <a className="wordmark" href="/voices" onClick={event => { event.preventDefault(); navigate('/voices'); }} aria-label="NoteFIsh voice library"><span className="brand-mark"><AudioLines size={21} strokeWidth={2.2} /></span>NoteFIsh<span className="wordmark-dot">.</span></a>
      <div className="workspace-switch"><span className="workspace-avatar">N</span><div><strong>My workspace</strong><span>Personal workspace</span></div><ChevronDown size={14} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav aria-label="Main navigation">{NAV.map(item => <a href={item.path} key={item.path} className={page.path === item.path ? 'active' : ''} onClick={event => { event.preventDefault(); navigate(item.path); }} aria-current={page.path === item.path ? 'page' : undefined}><item.icon size={18} strokeWidth={1.7} />{item.label}{item.path === '/desk' && incoming && <span className="nav-ring" />}</a>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><div className="tiny-orbit"><AudioLines size={18} /></div><strong>Your voice. Their language.</strong><p>A little closer, in every conversation.</p><a href="/desk" onClick={event => { event.preventDefault(); navigate('/desk'); }}>Open your desk <ArrowUpRight /></a></div><div className="sidebar-footer"><span className={`connection-dot ${connection}`} />{connection === 'connected' ? 'Workspace connected' : connection === 'connecting' ? 'Connecting workspace' : 'Reconnecting workspace'}</div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button menu-button" aria-label="Open navigation" aria-expanded={mobileNav} aria-controls="workspace-sidebar" onClick={() => setMobileNav(true)}><Menu size={20} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{page.label}</strong></div><div className="topbar-right"><span className="private-label"><ShieldCheck size={14} />Private workspace</span><Tooltip content="Fish Audio documentation"><a href="https://docs.fish.audio/" target="_blank" rel="noreferrer" className="icon-button" aria-label="Fish Audio documentation"><CircleHelp size={18} /></a></Tooltip><span className="user-avatar" aria-label="My workspace">N</span></div></header>
      {incoming && route !== '/desk' && <div className="incoming-banner" role="status"><PhoneCall size={18} /><span>Incoming call from <strong>{incoming.from || 'a customer'}</strong></span><button onClick={() => navigate('/desk')}>Go to call <ArrowRight size={15} /></button></div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      <main><RouteTransition route={page.path}>{page.path === '/voices' ? <VoiceLibrary {...common} /> : page.path === '/enroll' ? <Enroll {...common} /> : page.path === '/desk' ? <Desk {...common} connection={connection} audioReady={audioReady} enableAudio={enableAudio} clearAudio={() => player.current.clear()} setAudioMuted={muted => { player.current.muted = muted; if (muted) player.current.clear(); }} /> : <Setup {...common} reload={reload} />}</RouteTransition></main>
      <footer className="page-footer"><span>Made for human conversations.</span><span>NoteFIsh <span className="footer-dot">·</span> Powered by Fish Audio</span></footer>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
  </div>;
}

function ArrowUpRight() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

function VoiceLibrary({ data, navigate, loading, setError, setNotice, saveSettings, refreshVoices }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [importing, setImporting] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState('');
  const selected = data.voices.find(voice => voice.id === selectedId);
  const active = data.voices.filter(voice => !isArchived(voice));
  const filtered = data.voices.filter(voice => (filter === 'archived' ? isArchived(voice) : !isArchived(voice)) && (filter === 'ready' ? voice.status === 'ready' : filter === 'training' ? voice.status === 'training' : true) && `${voice.name} ${voice.description || ''} ${languageName(voice.language)}`.toLowerCase().includes(query.toLowerCase()));
  const voiceAction = async (voice, action) => {
    setVoiceBusy(voice.id);
    try {
      if (action === 'use') { if (await saveSettings({ voiceId: voice.id })) { setNotice(`${voice.name} is your call desk voice.`); navigate('/desk'); } }
      else if (action === 'refresh') { await api.refreshVoice(voice.id); await refreshVoices(); setNotice('Voice status refreshed.'); }
      else { await api.editVoice(voice.id, { archived: !isArchived(voice) }); await refreshVoices(); setNotice(isArchived(voice) ? 'Voice restored.' : 'Voice archived. You can restore it from Archived.'); }
    } catch (failure) { setError(failure.message); }
    finally { setVoiceBusy(''); }
  };
  const voiceMenu = voice => [
    { id: 'preview', label: 'Preview voice', icon: Play, disabled: voice.status !== 'ready' || isArchived(voice), opensDialog: true, onSelect: () => setSelectedId(voice.id) },
    { id: 'edit', label: 'Edit voice details', icon: Settings2, opensDialog: true, onSelect: () => setSelectedId(voice.id) },
    { separator: true },
    { id: 'use', label: 'Use at call desk', icon: Headphones, disabled: voice.status !== 'ready' || isArchived(voice), onSelect: () => voiceAction(voice, 'use') },
    { id: 'refresh', label: 'Refresh voice status', icon: RefreshCw, onSelect: () => voiceAction(voice, 'refresh') },
    { separator: true },
    { id: 'archive', label: isArchived(voice) ? 'Restore voice' : 'Archive voice', icon: Archive, onSelect: () => voiceAction(voice, 'archive') },
  ];
  return <div className="page library-page">
    <section className="library-hero"><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-dot" /> THE VOICE BEHIND YOUR CONVERSATIONS</span><h1>A familiar voice.<br /><em>In every language.</em></h1><p>Create a voice that sounds like you.<br className="desktop-break" /> Bring it to every conversation, wherever it goes.</p><button className="button primary" onClick={() => navigate('/enroll')}><Plus size={17} />Create a voice</button></div><div className="hero-art" aria-hidden="true"><img className="hero-illustration" src={conversationIllustration} alt="" draggable="false" /><span className="art-caption">Your voice. A shared understanding.</span></div></section>
    <section className="library-section"><div className="section-heading"><div><h2>Your voices <span className="count-badge">{active.length}</span></h2><p>Your own collection. Ready for a real conversation.</p></div><button className="button secondary compact" onClick={() => setImporting(true)}><ArrowDownToLine size={15} />Import Fish voice</button></div>
      <ChoiceTabs value={filter} onValueChange={setFilter} options={[{ value: 'all', label: 'All voices' }, { value: 'ready', label: 'Ready' }, { value: 'training', label: 'Training' }, { value: 'archived', label: 'Archived' }]} label="Filter voices" className="library-tabs" listClassName="filter-tabs" rightSlot={<label className="search-field"><Search size={16} /><input type="search" aria-label="Search voices" placeholder="Search your voices…" value={query} onChange={event => setQuery(event.target.value)} />{query && <Tooltip content="Clear search"><button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button></Tooltip>}</label>}>
      {loading ? <div className="voice-grid" role="status" aria-label="Loading your voices">{[0, 1, 2].map(item => <div className="voice-card skeleton-card" key={item}><div className="skeleton-circle" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>)}</div> : filtered.length ? <div className="voice-grid">{filtered.map(voice => <article className="voice-card" key={voice.id}><div className="voice-card-top"><VoiceAvatar name={voice.name} /><ActionMenu label={`Actions for ${voice.name}`} items={voiceMenu(voice)}><button type="button" className="icon-button" aria-label={`Manage ${voice.name}`} disabled={voiceBusy === voice.id}>{voiceBusy === voice.id ? <Spinner size={17} /> : <MoreHorizontal size={20} />}</button></ActionMenu></div><div className="voice-name-row"><h3>{voice.name}</h3>{data.settings.voiceId === voice.id && <span className="assigned-label"><Headphones size={11} />Desk voice</span>}</div><p>{voice.description || 'A voice for your next conversation.'}</p><div className="voice-tags"><span><Globe2 size={12} />{languageName(voice.language || 'en')}</span><span>{voice.kind === 'licensed' ? 'Licensed voice' : 'Voice clone'}</span></div><div className="voice-card-bottom"><StatusPill status={isArchived(voice) ? 'archived' : voice.status} /><Tooltip content={voice.status === 'ready' && !isArchived(voice) ? 'Preview voice' : 'Voice details'}><button type="button" className="preview-button" onClick={() => setSelectedId(voice.id)} aria-label={`Preview and manage ${voice.name}`}>{voice.status === 'ready' && !isArchived(voice) ? <Play size={15} fill="currentColor" /> : <Settings2 size={16} />}</button></Tooltip></div></article>)}{filter !== 'archived' && !query && <button className="create-voice-card" onClick={() => navigate('/enroll')}><span><Plus size={23} strokeWidth={1.4} /></span><strong>Create another voice</strong><small>A new voice. A new possibility.</small></button>}</div> : active.length === 0 && filter === 'all' && !query ? <div className="library-empty"><div className="empty-illustration" aria-hidden="true"><img src={recordingIllustration} alt="" draggable="false" /></div><h3>Every conversation starts with a voice.</h3><p>Add a short recording to make your first voice clone.<br />It’s yours to preview, manage, and use on the phone.</p><button className="button primary" onClick={() => navigate('/enroll')}><Plus size={16} />Create your first voice</button><button className="text-button" onClick={() => setImporting(true)}>Already have a Fish voice? Import it <ArrowRight size={14} /></button></div> : <div className="small-empty"><Search size={25} /><h3>{filter === 'archived' && !query ? 'No archived voices' : 'No voices found'}</h3><p>{query ? 'Try another name, description, or language.' : filter === 'training' ? 'Voices being created will appear here.' : filter === 'ready' ? 'Your voices will appear here when training finishes.' : 'Voices you archive stay here until you restore them.'}</p></div>}
      </ChoiceTabs>
    </section><div className="library-bottom-note"><ShieldCheck size={16} /><span>Your voices are private. Only clone voices you own or have permission to use.</span><a href="/admin" onClick={event => { event.preventDefault(); navigate('/admin'); }}>Set up your first call <ArrowRight size={14} /></a></div>
    {selected && <VoiceModal voice={selected} agentLanguage={data.settings.agentLanguage} customerLanguage={data.settings.customerLanguage} onClose={() => setSelectedId(null)} setError={setError} setNotice={setNotice} refreshVoices={refreshVoices} onUse={async () => { if (await saveSettings({ voiceId: selected.id })) { setNotice(`${selected.name} is your call desk voice.`); navigate('/desk'); } }} />}
    {importing && <ImportModal onClose={() => setImporting(false)} setError={setError} setNotice={setNotice} refreshVoices={refreshVoices} />}
  </div>;
}

function VoiceModal({ voice, agentLanguage = 'en', customerLanguage = 'fr', onClose, setError, setNotice, refreshVoices, onUse }) {
  const [name, setName] = useState(voice.name);
  const [description, setDescription] = useState(voice.description || '');
  const [text, setText] = useState(agentLanguage === 'en' ? 'Hello, how can I help you today?' : agentLanguage === 'fr' ? 'Bonjour, comment puis-je vous aider aujourd’hui ?' : '');
  const [language, setLanguage] = useState(customerLanguage);
  const [busy, setBusy] = useState('');
  const [audio, setAudio] = useState('');
  const [previewBlob, setPreviewBlob] = useState(null);
  const [previewAudioElement, setPreviewAudioElement] = useState(null);
  const [localError, setLocalError] = useState('');
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);
  const action = async (kind, fn) => { setBusy(kind); setLocalError(''); try { await fn(); } catch (failure) { setLocalError(failure.message); } finally { setBusy(''); } };
  return <Modal title="Your voice" onClose={onClose}><div className="voice-modal-intro"><VoiceAvatar name={voice.name} large /><div><h3>{voice.name}</h3><StatusPill status={isArchived(voice) ? 'archived' : voice.status} /><p>{voice.kind === 'licensed' ? 'Licensed voice' : 'Enrolled voice'} · {languageName(voice.language || 'en')}</p></div></div>
    {localError && <div className="inline-error" role="alert">{localError}</div>}
    {voice.status === 'failed' && <div className="inline-error">{voice.error || 'Fish could not complete training. Refresh the status or try a new recording.'}</div>}
    {voice.status === 'training' && <div className="info-box"><Spinner />Fish is preparing your voice. Refresh its status in a moment.</div>}
    <div className="form-stack"><label className="field"><span>Voice name</span><input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label><label className="field"><span>Description <small>optional</small></span><textarea rows={2} maxLength={500} value={description} onChange={event => setDescription(event.target.value)} /></label><div className="inline-actions"><button className="button secondary compact" disabled={!!busy || !name.trim()} onClick={() => action('save', async () => { await api.editVoice(voice.id, { name, description }); await refreshVoices(); setNotice('Voice details saved.'); })}>{busy === 'save' ? <Spinner /> : <Check size={15} />}Save details</button><button className="text-button" disabled={!!busy} onClick={() => action('refresh', async () => { await api.refreshVoice(voice.id); await refreshVoices(); setNotice('Voice status refreshed.'); })}>{busy === 'refresh' ? <Spinner /> : <RefreshCw size={14} />}Refresh status</button></div></div>
    {voice.status === 'ready' && !isArchived(voice) && <section className="preview-section"><div className="section-heading"><h3>Hear your voice</h3><span className="subtle-tag">Fish Audio</span></div><LanguageSelect label="Preview language" value={language} onChange={setLanguage} /><label className="field"><span>Preview text</span><textarea rows={3} value={text} maxLength={1000} onChange={event => setText(event.target.value)} placeholder={`Write a short line in ${languageName(agentLanguage)}…`} /></label><p className="field-help">Write in {languageName(agentLanguage)}. We’ll preview it in {languageName(language)}.</p><button className="button secondary" disabled={!!busy || !text.trim()} onClick={() => action('preview', async () => { const blob = await api.previewVoice(voice.id, { text, language, sourceLanguage: agentLanguage }); setPreviewBlob(blob); setAudio(URL.createObjectURL(blob)); })}>{busy === 'preview' ? <Spinner /> : <Play size={14} />}Generate preview</button>{audio && <><AudioWaveform blob={previewBlob} audioElement={previewAudioElement} height={52} label="Generated voice preview waveform" /><audio ref={setPreviewAudioElement} className="audio-preview" src={audio} controls autoPlay /></>}</section>}
    <div className="modal-bottom"><button className="text-button muted" disabled={!!busy} onClick={() => action('archive', async () => { await api.editVoice(voice.id, { archived: !isArchived(voice) }); await refreshVoices(); setNotice(isArchived(voice) ? 'Voice restored.' : 'Voice archived. You can restore it from your library.'); onClose(); })}><Archive size={15} />{isArchived(voice) ? 'Restore voice' : 'Archive voice'}</button><button className="button primary" disabled={!!busy || voice.status !== 'ready' || isArchived(voice)} onClick={onUse}>Use at call desk <ArrowRight size={16} /></button></div><p className="reference-id">Fish reference · {voice.referenceId}</p>
  </Modal>;
}

function ImportModal({ onClose, setError, setNotice, refreshVoices }) {
  const [form, setForm] = useState({ name: '', referenceId: '', language: 'en', consent: false, kind: 'licensed' });
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState([]);
  const [finding, setFinding] = useState(true);
  const [listingError, setListingError] = useState('');
  const [localError, setLocalError] = useState('');
  const [ownedId, setOwnedId] = useState('');
  useEffect(() => { let cancelled = false; api.availableVoices().then(result => { if (!cancelled) setAvailable(result.voices || []); }).catch(failure => { if (!cancelled) setListingError(failure.message); }).finally(() => { if (!cancelled) setFinding(false); }); return () => { cancelled = true; }; }, []);
  const submit = async event => { event.preventDefault(); setBusy(true); setLocalError(''); try { await api.importVoice(form); await refreshVoices(); setNotice('Fish voice added to your library.'); onClose(); } catch (failure) { setLocalError(failure.message); } finally { setBusy(false); } };
  return <Modal title="Import a Fish voice" onClose={onClose}><p className="modal-description">Choose a voice from your Fish Audio account, or enter the reference ID of an enrolled or licensed voice.</p>{localError && <div className="inline-error" role="alert">{localError}</div>}<form className="form-stack" onSubmit={submit}>{finding ? <div className="info-box"><Spinner />Finding voices in your Fish account…</div> : available.length ? <label className="field"><span>Your Fish Audio voices <small>{available.length} available</small></span><div className="select-wrap"><AudioLines size={15} /><select value={ownedId} onChange={event => { const chosen = available.find(item => item.referenceId === event.target.value); setOwnedId(event.target.value); if (chosen) setForm({ ...form, name: chosen.name, referenceId: chosen.referenceId, kind: 'enrolled', consent: false }); }}><option value="">Choose an existing voice</option>{available.map(item => <option value={item.referenceId} key={item.referenceId}>{item.name} · {item.referenceId.slice(-8)} · {item.status === 'ready' || item.status === 'trained' ? 'Ready' : item.status}</option>)}</select><ChevronDown size={14} /></div></label> : listingError ? <div className="info-box"><CircleHelp size={15} /><span>Couldn’t load your Fish voices: {listingError} You can still enter a reference ID below.</span></div> : <p className="field-help">No existing voices found in your Fish account. You can import a licensed voice by its reference ID.</p>}<label className="field"><span>Voice name</span><input required maxLength={100} placeholder="e.g. Alex · Support" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label className="field"><span>Fish reference ID</span><input required placeholder="Paste your model reference ID" value={form.referenceId} onChange={event => { setOwnedId(''); setForm({ ...form, referenceId: event.target.value, kind: 'licensed', consent: false }); }} /></label><LanguageSelect label="Original voice language" value={form.language} onChange={language => setForm({ ...form, language })} /><label className="checkbox-label"><input type="checkbox" checked={form.consent} onChange={event => setForm({ ...form, consent: event.target.checked })} required /><span>I own this voice or have permission to use it for voice cloning and translated phone conversations.</span></label><div className="modal-bottom"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !form.consent}>{busy ? <Spinner /> : <ArrowDownToLine size={16} />}Import voice</button></div></form></Modal>;
}

function Enroll({ data, navigate, setError, setNotice, refreshVoices }) {
  const [mode, setMode] = useState('record');
  const [form, setForm] = useState({ name: '', description: '', transcript: '', language: 'en', consent: false });
  const [sample, setSample] = useState(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [createdVoice, setCreatedVoice] = useState(null);
  const fileInput = useRef(null);
  const capture = useCapture((blob, duration) => { if (duration < 3) { setError('Record at least 3 seconds. A clear 15–30 second sample works best.'); return; } setSample({ blob, duration, name: `My voice recording.${blob.type.includes('mp4') ? 'm4a' : 'webm'}` }); setAudioUrl(URL.createObjectURL(blob)); });
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);
  useEffect(() => { if (capture.error) setError(capture.error); }, [capture.error]);
  const liveCall = data.calls.some(call => ['ringing', 'in_call'].includes(callState(call)));
  useEffect(() => { if (liveCall) capture.stop(true); }, [liveCall, capture.stop]);
  const upload = file => {
    if (!file) return;
    if (!/\.(wav|mp3|m4a|webm|ogg)$/i.test(file.name) && !['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg'].includes(file.type)) { setError('Choose an audio file: WAV, MP3, M4A, WebM, or OGG.'); return; }
    if (file.size > 30 * 1024 * 1024) { setError('This file is too large. Please choose a recording smaller than 30 MB.'); return; }
    setSample({ blob: file, name: file.name }); setAudioUrl(URL.createObjectURL(file));
  };
  const submit = async event => {
    event.preventDefault(); if (!sample || !form.consent) return; setBusy(true);
    try { const payload = new FormData(); for (const [key, value] of Object.entries(form)) payload.append(key, String(value)); payload.append('audio', sample.blob, sample.name); const result = await api.createVoice(payload); setCreatedVoice(result.voice); await refreshVoices(); setNotice('Your recording was submitted to Fish Audio.'); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!createdVoice || createdVoice.status !== 'training') return;
    let disposed = false;
    const timer = setInterval(async () => { try { const response = await api.refreshVoice(createdVoice.id); if (!disposed) { setCreatedVoice(response.voice); await refreshVoices(); } } catch (failure) { if (!disposed) setError(failure.message); clearInterval(timer); } }, 7000);
    return () => { disposed = true; clearInterval(timer); };
  }, [createdVoice?.id, createdVoice?.status]);
  if (createdVoice) return <div className="page create-page"><div className="creation-success"><VoiceAvatar name={createdVoice.name} large /><span className="eyebrow">YOUR VOICE, REIMAGINED</span><h1>{createdVoice.status === 'ready' ? 'Say hello to your voice.' : createdVoice.status === 'failed' ? 'Let’s try another take.' : 'A voice of your own.'}</h1><p>{createdVoice.status === 'ready' ? `${createdVoice.name} is ready to preview and use on your calls.` : createdVoice.status === 'failed' ? createdVoice.error || 'Fish could not complete this voice. You can review its details in the library.' : `Fish Audio is creating ${createdVoice.name}. This page will update when it’s ready.`}</p><StatusPill status={createdVoice.status} /><div className="success-actions"><button className="button primary" onClick={() => navigate('/voices')}>Open voice library <ArrowRight size={16} /></button><button className="button secondary" onClick={() => { setCreatedVoice(null); setSample(null); setAudioUrl(''); setForm({ name: '', description: '', transcript: '', language: 'en', consent: false }); }}>Create another voice</button></div></div></div>;
  return <div className="page create-page"><div className="page-heading"><span className="eyebrow">MAKE IT SOUND LIKE YOU</span><h1>Create your voice.</h1><p>A little of your voice. A whole new way to connect.</p></div><div className="create-layout"><form className="enroll-form" onSubmit={submit}><section className="form-section"><div className="step-heading"><span>01</span><div><h2>Give your voice a name</h2><p>Something easy to recognize in your library.</p></div></div><div className="form-stack"><label className="field"><span>Voice name <small>required</small></span><input required placeholder="e.g. Alex · Customer support" maxLength={100} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label className="field"><span>Description <small>optional</small></span><input placeholder="A warm, clear voice for everyday conversations" maxLength={500} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label><LanguageSelect label="Language of your recording" value={form.language} onChange={language => setForm({ ...form, language })} /></div></section>
      <section className="form-section"><div className="step-heading"><span>02</span><div><h2>Add your voice sample</h2><p>15–30 seconds of clear, natural speech works best.</p></div></div><ChoiceTabs value={mode} onValueChange={setMode} options={[{ value: 'record', label: 'Record audio', icon: Mic }, { value: 'upload', label: 'Upload a file', icon: Upload }]} label="Voice sample source" className="enrollment-tabs" listClassName="segmented-control" disabled={capture.recording || capture.requesting}>
      {liveCall && <div className="info-box"><Phone size={17} />Finish the current call before recording a new voice.</div>}
      <motion.div layout="size" className="enrollment-sample-panel" transition={{ duration: .2, ease: 'easeOut' }}>{sample ? <div className="sample-ready"><div className="sample-meta"><span><FileAudio size={22} /></span><div><strong>{sample.name}</strong><small>{sample.duration ? `${Math.round(sample.duration)} seconds · ` : ''}{(sample.blob.size / 1024 / 1024).toFixed(1)} MB</small></div><button type="button" className="icon-button" aria-label="Remove voice sample" onClick={() => { setSample(null); setAudioUrl(''); }}><Trash2 size={17} /></button></div><AudioWaveform blob={sample.blob} height={50} label="Voice sample waveform" /><audio controls src={audioUrl} /></div> : mode === 'record' ? <div className={`record-panel ${capture.recording ? 'recording' : ''}`}><AudioWaveform stream={capture.stream} active={capture.recording} height={52} label="Live microphone level" /><strong>{capture.interrupted ? 'Microphone paused' : capture.recording ? formatDuration(capture.seconds) : capture.requesting ? 'Allow microphone access…' : 'Find a quiet moment.'}</strong><p>{capture.interrupted ? 'Microphone access is temporarily interrupted. Resume it or stop recording.' : capture.recording ? 'Speak naturally. Let your personality through.' : 'Just you, your microphone, and a few sentences.'}</p><button type="button" className={`button ${capture.recording ? 'danger' : 'primary'}`} disabled={liveCall || capture.requesting} onClick={() => capture.recording ? capture.stop() : capture.start().catch(failure => setError(failure.message))}>{capture.requesting ? <Spinner /> : capture.recording ? <Square size={14} fill="currentColor" /> : <Mic size={16} />}{capture.recording ? 'Stop recording' : 'Start recording'}</button><small>Minimum 3 seconds · Up to 90 seconds</small></div> : <button type="button" className={`upload-panel ${dragging ? 'dragging' : ''}`} onClick={() => fileInput.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); upload(event.dataTransfer.files[0]); }}><span className="upload-icon"><Upload size={24} strokeWidth={1.5} /></span><strong>Drop your recording here</strong><p>or <u>browse files</u> on your computer</p><small>WAV, MP3, M4A, WebM or OGG · Up to 30 MB</small></button>}</motion.div>
      <input hidden ref={fileInput} type="file" accept="audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/ogg,.wav,.mp3,.m4a,.webm,.ogg" onChange={event => { upload(event.target.files[0]); event.target.value = ''; }} /></ChoiceTabs>
      <details className="recording-script"><summary>Need something to read? <ChevronDown size={14} /></summary><p>“Hello, and welcome. I’m here to help you find the right answer. Whether it’s a small question or something a little more complicated, we’ll work through it together. Take your time, and tell me what you need.”</p><button type="button" className="text-button" onClick={() => setForm({ ...form, transcript: 'Hello, and welcome. I’m here to help you find the right answer. Whether it’s a small question or something a little more complicated, we’ll work through it together. Take your time, and tell me what you need.' })}>Use this transcript <Check size={14} /></button></details>
      <label className="field"><span>What does the recording say? <small>optional</small></span><textarea placeholder="Paste the exact words in your sample for a more accurate clone…" rows={3} maxLength={5000} value={form.transcript} onChange={event => setForm({ ...form, transcript: event.target.value })} /></label></section>
      <section className="form-section consent-section"><label className="checkbox-label"><input type="checkbox" required checked={form.consent} onChange={event => setForm({ ...form, consent: event.target.checked })} /><span>I confirm this is my voice, or I have the speaker’s permission to clone it and use it for translated phone conversations.</span></label><button className="button primary full-width" disabled={busy || !sample || !form.consent || !form.name.trim() || liveCall || capture.recording}>{busy ? <Spinner /> : <Sparkles size={16} />}{busy ? 'Creating your voice…' : 'Create voice'}</button><p className="form-footnote"><ShieldCheck size={12} />Your voice is created as a private Fish Audio model.</p></section></form>
      <aside className="creation-guide"><div className="guide-orb"><img className="guide-illustration" src={recordingIllustration} alt="" draggable="false" /></div><h3>A great voice starts<br />with a good recording.</h3><div className="guide-tip"><Headphones size={18} /><div><strong>Keep it clear</strong><p>One speaker. A quiet room. No music in the background.</p></div></div><div className="guide-tip"><Mic size={18} /><div><strong>Sound like yourself</strong><p>Speak at a natural pace. There’s no need for a studio voice.</p></div></div><div className="guide-tip"><Globe2 size={18} /><div><strong>Go beyond one language</strong><p>Your voice can speak languages supported by your Fish model. Preview each one before a call.</p></div></div><div className="guide-bottom"><ShieldCheck size={16} /><p>Only your own or licensed voices. Never a voice taken from a live call.</p></div></aside></div></div>;
}

function Desk({ data, navigate, setError, setNotice, saveSettings, updateCall, connection, audioReady, enableAudio, clearAudio, setAudioMuted }) {
  const [selectedCallId, setSelectedCallId] = useState('');
  const liveCall = data.calls.find(call => ['ringing', 'in_call'].includes(callState(call)));
  const currentCall = liveCall || data.calls.find(call => call.id === selectedCallId) || data.calls[0] || null;
  const active = callState(currentCall) === 'in_call';
  const ringing = callState(currentCall) === 'ringing';
  const [busy, setBusy] = useState('');
  const [reply, setReply] = useState('');
  const [typed, setTyped] = useState(false);
  const [ticket, setTicket] = useState({ issue: '', address: '', dispatch: false });
  const [elapsed, setElapsed] = useState(0);
  const transcriptContainer = useRef(null);
  const [invitation, setInvitation] = useState(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pointerHeld = useRef(false);
  const activeRef = useRef(currentCall);
  activeRef.current = currentCall;
  const readyVoices = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice));
  const voice = readyVoices.find(item => item.id === data.settings.voiceId);
  const phase = currentCall?.phase || 'listening';
  const processing = active && !['listening', 'idle'].includes(phase);
  const canTalk = active && !!voice && !busy && !processing && connection === 'connected';
  const capture = useCapture(async (blob, duration) => {
    if (duration < .3) { setNotice('Hold a little longer to record your reply.'); return; }
    const call = activeRef.current;
    if (callState(call) !== 'in_call') return;
    setBusy('reply');
    try { const result = await api.ptt(call.id, blob); updateCall(result.call); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }, 45);
  useEffect(() => { if (capture.error) setError(capture.error); }, [capture.error]);
  useEffect(() => { setTicket({ issue: currentCall?.ticket?.issue || '', address: currentCall?.ticket?.address || '', dispatch: needsDispatch(currentCall?.ticket?.dispatch) }); }, [currentCall?.id]);
  useEffect(() => {
    if (!active) { setElapsed(0); capture.stop(true); clearAudio(); return; }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(currentCall.answeredAt || currentCall.startedAt).getTime()) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [active, currentCall?.id]);
  useEffect(() => { if (transcriptContainer.current) transcriptContainer.current.scrollTop = transcriptContainer.current.scrollHeight; }, [currentCall?.id, currentCall?.transcript?.length]);
  useEffect(() => { if (liveCall) setSelectedCallId(liveCall.id); }, [liveCall?.id]);
  useEffect(() => { setAudioMuted(capture.recording || capture.requesting || processing || busy === 'reply'); return () => setAudioMuted(false); }, [capture.recording, capture.requesting, processing, busy]);
  useEffect(() => { if (!invitation) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [invitation]);
  const startTalk = useCallback(() => { if (canTalk) { clearAudio(); capture.start().catch(failure => setError(failure.message)); } }, [canTalk, capture.start]);
  useEffect(() => {
    const down = event => {
      if (event.key === 'Escape') { capture.stop(true); return; }
      const target = event.target;
      if (event.code !== 'Space' || event.repeat || target?.closest?.('input, textarea, select, [contenteditable="true"], a, button:not([data-ptt])')) return;
      event.preventDefault(); startTalk();
    };
    const up = event => { if (event.code === 'Space') { capture.stop(); } };
    const cancel = () => capture.stop(true);
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); };
  }, [startTalk, capture.stop]);
  const action = async (name, fn) => { setBusy(name); try { const result = await fn(); if (result?.call) updateCall(result.call); } catch (failure) { setError(failure.message); } finally { setBusy(''); } };
  const transcript = currentCall?.transcript || [];
  const browserReady = !!voice && data.setup?.providers?.fish?.configured && data.setup?.providers?.openai?.configured && connection === 'connected';
  const inviteExpired = invitation && new Date(invitation.expiresAt).getTime() <= now;
  const createInvitation = async () => {
    setInviteBusy(true);
    try { await enableAudio(); const created = await api.createInvitation(); setInvitation(created); setNow(Date.now()); setNotice('Call link created. Open it on the caller’s phone.'); }
    catch (failure) { setError(failure.message); }
    finally { setInviteBusy(false); }
  };
  const copyInvitation = async () => { try { await navigator.clipboard.writeText(invitation.url); setNotice('Call link copied. Share it with the person calling you.'); } catch { setError('Select and copy the call link manually. Clipboard access is unavailable.'); } };
  const shareInvitation = async () => { try { await navigator.share({ title: 'NoteFIsh call', text: 'Open this link on your phone and tap Call.', url: invitation.url }); } catch (failure) { if (failure.name !== 'AbortError') setError(failure.message); } };
  return <div className={`page desk-page ${active || ringing ? 'has-call' : ''}`}><div className="page-heading horizontal"><div><span className="eyebrow">REAL PEOPLE. REAL CONVERSATIONS.</span><h1>Your call desk.</h1><p>Listen in your language. Reply in theirs.</p></div><div className={`desk-connection ${connection === 'connected' ? 'connected' : ''}`}><span />{connection === 'connected' ? 'Desk connected' : 'Reconnecting…'}</div></div>
    <div className="desk-settings"><label className="field voice-select"><span>Your voice</span><div className="select-wrap"><AudioLines size={16} /><select value={data.settings.voiceId || ''} onChange={event => saveSettings({ voiceId: event.target.value || null })} disabled={processing || !!busy}><option value="">Choose a voice</option>{readyVoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></div></label><LanguageSelect label="Your language" value={data.settings.agentLanguage} onChange={agentLanguage => saveSettings({ agentLanguage })} disabled={processing || !!busy} /><div className="language-direction"><ArrowRight size={18} /></div><LanguageSelect label="Caller’s language" value={data.settings.customerLanguage} onChange={customerLanguage => saveSettings({ customerLanguage })} disabled={processing || !!busy} /></div>
    {!voice && <div className="desk-advice"><AudioLines size={16} /><span>{readyVoices.length ? 'Choose a voice above to send translated replies.' : 'Create or import a voice before your first conversation.'}</span><button className="text-button" onClick={() => navigate('/voices')}>Voice library <ArrowRight size={14} /></button></div>}
    <section className="browser-invite-panel" aria-label="Browser call link"><div className="browser-invite-header"><span className="browser-invite-icon"><Smartphone size={21} /></span><div><h2>Start with a real conversation.</h2><p>Send a call link to another phone. They tap Call, your desk rings, and you answer here.</p></div><button className="button primary" disabled={!browserReady || inviteBusy || active || ringing} onClick={createInvitation}>{inviteBusy ? <Spinner /> : <Link2 size={15} />}{invitation ? 'New call link' : 'Create call link'}</button></div>{invitation && <div className="browser-invite-body"><label className="field"><span>{inviteExpired ? 'This link has expired. Create a new one.' : 'One-use call link'}</span><div className="copy-field"><input readOnly aria-label="Caller invitation link" value={invitation.url} onFocus={event => event.target.select()} /><button className="icon-button" aria-label="Copy caller link" disabled={inviteExpired} onClick={copyInvitation}><Copy size={16} /></button></div></label><div className="browser-invite-actions"><span>Expires {new Date(invitation.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · Caller speaks {languageName(data.settings.customerLanguage)}</span>{typeof navigator.share === 'function' && <button className="text-button" disabled={inviteExpired} onClick={shareInvitation}><Share2 size={14} />Share link</button>}<button className="text-button" disabled={inviteExpired} onClick={copyInvitation}><Copy size={13} />Copy link</button></div></div>}<p className="browser-invite-note">{browserReady ? 'Browser calls are ready to try. Keep this desk open while the caller joins.' : !voice ? 'Select an approved, ready voice to create a call link.' : 'Connect Fish Audio and OpenAI to enable translated browser calls.'} <span>Twilio is optional for this demo.</span></p></section>
    {data.calls.length > 1 && <label className="call-history-select"><span>Conversation</span><div className="select-wrap"><Phone size={14} /><select aria-label="View a past conversation" disabled={active || ringing} value={currentCall?.id || ''} onChange={event => setSelectedCallId(event.target.value)}>{data.calls.map(call => <option key={call.id} value={call.id}>{call.from || 'Browser caller'} · {new Date(call.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · {callState(call) === 'ended' ? 'Ended' : 'Live'}</option>)}</select><ChevronDown size={14} /></div></label>}
    <section className={`call-line ${active ? 'active' : ''} ${ringing ? 'ringing' : ''}`}><div className="line-identity"><span className="phone-icon">{ringing ? <PhoneCall size={22} /> : active ? <Phone size={22} /> : <Headphones size={23} />}</span><div><span className="line-caption">{ringing ? 'INCOMING CALL' : active ? 'LIVE CONVERSATION' : callState(currentCall) === 'ended' ? 'LAST CONVERSATION ENDED' : 'YOUR INCOMING LINE'}</span><h2>{ringing || active ? currentCall.from || 'Browser caller' : data.setup?.phoneNumber || 'Ready when you are.'}</h2><p>{active ? <><span className="live-dot" />{formatDuration(elapsed)}<span className="line-separator">·</span>{data.settings.queueName || 'Main line'}</> : ringing ? 'A customer is waiting. Answer to start listening.' : data.setup?.phoneNumber ? 'Call this number from a real phone to get started.' : 'Create a call link and open it on another phone to begin.'}</p></div></div><div className="line-actions"><button className={`button secondary audio-button ${audioReady ? 'enabled' : ''}`} onClick={() => action('audio', enableAudio)} disabled={busy === 'audio'}>{busy === 'audio' ? <Spinner /> : <Volume2 size={16} />}{audioReady ? 'Audio enabled' : 'Enable audio'}</button>{ringing ? <><button className="button secondary" disabled={!!busy} onClick={() => action('end', () => api.end(currentCall.id))}>Decline</button><button className="button answer" disabled={!!busy} onClick={() => action('answer', async () => { await enableAudio(); return api.answer(currentCall.id); })}>{busy === 'answer' ? <Spinner /> : <Phone size={16} />}Answer</button></> : active ? <button className="button end-call" disabled={busy === 'end'} onClick={() => { capture.stop(true); clearAudio(); action('end', () => api.end(currentCall.id)); }}><PhoneOff size={16} />End call</button> : <button className="button primary" disabled={!browserReady || inviteBusy} onClick={createInvitation}>{inviteBusy ? <Spinner /> : <Link2 size={15} />}Create call link</button>}</div></section>
    <div className="conversation-layout"><section className="captions-panel"><header className="panel-header"><div><h2>Conversation</h2><span>{languageName(data.settings.agentLanguage)} captions <span className="caption-arrow">←</span> {languageName(data.settings.customerLanguage)}</span></div><span className={`caption-state ${active ? 'live' : ''}`}><span />{active ? capture.recording ? 'Recording' : processing ? 'Reply in progress' : 'Listening' : 'Waiting for a call'}</span></header><div className="transcript" ref={transcriptContainer} role="log" aria-label="Call transcript" aria-live="polite" aria-relevant="additions text">{transcript.length ? transcript.map((line, index) => <article className={`transcript-line ${line.speaker === 'agent' ? 'agent' : 'customer'}`} key={line.id || index}><div className="transcript-meta"><span className="speaker-avatar">{line.speaker === 'agent' ? <AudioLines size={13} /> : <Phone size={12} />}</span><strong>{line.speaker === 'agent' ? 'You' : 'Caller'}</strong><time>{stamp(line.t || line.at)}</time>{line.delivery && line.delivery !== 'caption' && <span className={`delivery ${line.delivery}`}>{line.delivery === 'played' ? 'Played to caller' : line.delivery === 'pending' ? 'Sending' : line.delivery}</span>}</div><p>{line.speaker === 'agent' ? line.textSource : line.textShown}</p>{line.textSource !== line.textShown && <div className="source-text"><Globe2 size={11} /><span>{line.speaker === 'agent' ? line.textShown : line.textSource}</span></div>}</article>) : <div className="transcript-empty"><div className="caption-illustration"><div /><div /><div /></div><h3>{active ? 'Go ahead, say hello.' : 'A conversation, without the language barrier.'}</h3><p>{active ? 'When the caller speaks, their words will appear here in your language.' : 'Answer a call to hear the caller and follow along with translated captions.'}</p><div className="language-chips"><span>{languageName(data.settings.agentLanguage)}</span><ArrowRight size={13} /><span>{languageName(data.settings.customerLanguage)}</span></div></div>}</div>{currentCall?.error && <div className="call-error" role="alert">{currentCall.error}</div>}</section>
      <aside className="ticket-panel"><header className="panel-header"><div><h2>Call notes</h2><span>Keep the important details.</span></div><span className="notes-icon"><Activity size={16} /></span></header><div className="ticket-form"><label className="field"><span>What can we help with?</span><textarea rows={4} placeholder="A short summary of the customer’s request…" value={ticket.issue} onChange={event => setTicket({ ...ticket, issue: event.target.value })} /></label><label className="field"><span>Address or location <small>optional</small></span><input placeholder="Add an address" value={ticket.address} onChange={event => setTicket({ ...ticket, address: event.target.value })} /></label><label className="checkbox-label dispatch-check"><input type="checkbox" checked={!!ticket.dispatch} onChange={event => setTicket({ ...ticket, dispatch: event.target.checked })} /><span>A dispatch is needed</span></label><button className="button secondary full-width" disabled={!currentCall || !!busy} onClick={() => action('ticket', async () => { const result = await api.ticket(currentCall.id, ticket); setNotice('Call notes saved.'); return result; })}>{busy === 'ticket' ? <Spinner /> : <Check size={15} />}Save notes</button>{ticket.dispatch && <button className="button primary full-width" disabled={!currentCall || !!busy || !!currentCall?.ticket?.dispatchConfirmedAt} onClick={() => action('dispatch', () => api.ticket(currentCall.id, { ...ticket, confirmDispatch: true }))}>{currentCall?.ticket?.dispatchConfirmedAt ? <CheckCircle2 size={15} /> : <ArrowRight size={15} />}{currentCall?.ticket?.dispatchConfirmedAt ? 'Dispatch confirmed' : 'Confirm dispatch'}</button>}<p className="ticket-help">{ticket.dispatch ? 'Confirmation records the decision in this ticket. Arrange the dispatch through your usual process.' : 'Your notes and transcript stay with this call after you hang up.'}</p></div>{currentCall && <div className="ticket-reference"><span>Call reference</span><code>{currentCall.callSid || currentCall.id}</code></div>}</aside></div>
    <section className={`talk-panel ${capture.recording ? 'recording' : ''}`}><div className="talk-info"><span className="talk-icon"><Mic size={22} strokeWidth={1.6} /></span><div><h3>{capture.interrupted ? 'Your microphone is paused.' : capture.recording ? 'Recording your reply…' : capture.requesting ? 'Allow microphone access…' : busy === 'reply' || processing ? phase === 'playing' ? 'Your voice is playing to the caller.' : currentCall?.stage === 'synthesizing' ? 'Creating speech in your voice…' : currentCall?.stage === 'transcribing' ? 'Transcribing your reply…' : 'Translating your reply…' : 'Your words. Your voice. Their language.'}</h3><p>{capture.recording ? `${formatDuration(capture.seconds)} · Release to translate and send. Esc to cancel.` : busy === 'reply' || processing ? 'The line stays open while your reply is prepared.' : 'Hold to speak, then release. Your translated voice plays to the caller.'}</p>{capture.recording && <AudioWaveform className="desk-ptt-waveform" stream={capture.stream} active={!capture.interrupted} height={26} label="Your microphone level" />}</div></div><div className="talk-actions">{processing || busy === 'reply' ? <button className="button secondary" onClick={() => action('stop', () => api.stop(currentCall.id))} disabled={busy === 'stop'}><Square size={14} />Stop playback</button> : <button className={`ptt-button ${capture.recording ? 'pressed' : ''}`} data-ptt="true" disabled={!canTalk && !capture.recording && !capture.requesting} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); pointerHeld.current = true; event.currentTarget.setPointerCapture(event.pointerId); startTalk(); }} onPointerUp={() => { pointerHeld.current = false; capture.stop(); }} onPointerCancel={() => { pointerHeld.current = false; capture.stop(true); }} onLostPointerCapture={() => { if (pointerHeld.current) { pointerHeld.current = false; capture.stop(true); } }}><Mic size={17} />{capture.recording ? 'Release to send' : 'Hold to talk'}<kbd>space</kbd></button>}<button className="text-button" onClick={() => setTyped(!typed)}>{typed ? 'Hide typed reply' : 'Type a reply instead'}<ChevronDown size={13} /></button></div></section>
    {typed && <form className="typed-reply" onSubmit={event => { event.preventDefault(); if (!reply.trim() || !canTalk) return; action('reply', async () => { const result = await api.say(currentCall.id, reply.trim()); setReply(''); return result; }); }}><label className="field"><span>Write in {languageName(data.settings.agentLanguage)}. The caller hears {languageName(data.settings.customerLanguage)} in {voice?.name || 'your chosen voice'}.</span><textarea rows={2} maxLength={3000} value={reply} onChange={event => setReply(event.target.value)} placeholder="Type the exact message you want to say…" /></label><button className="button primary" disabled={!canTalk || !reply.trim()}><Send size={15} />Translate & speak</button></form>}
    <div className="desk-footnote"><ShieldCheck size={14} /><span>Your microphone is recorded for translation. Only the generated voice is sent to the caller.</span></div>
  </div>;
}

function Setup({ data, setError, setNotice, saveSettings, reload, navigate }) {
  const [refreshing, setRefreshing] = useState(false);
  const [queueName, setQueueName] = useState(data.settings.queueName || 'Main line');
  const [saving, setSaving] = useState(false);
  const setup = data.setup || {};
  const readyVoices = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice));
  const webhook = setup.webhookUrl || '';
  const blockers = setup.blockers || setup.missing || [];
  const copy = async value => { try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); } catch { setError('Clipboard access is unavailable. Select and copy the address manually.'); } };
  const services = [{ id: 'fish', title: 'Fish Audio', description: 'Your cloned voice', icon: AudioLines }, { id: 'openai', title: 'OpenAI', description: 'Captions & translation', icon: Sparkles }, { id: 'twilio', title: 'Twilio · Optional', description: 'Regular phone number calls', icon: Phone }];
  return <div className="page setup-page"><div className="page-heading horizontal"><div><span className="eyebrow">FROM YOUR BROWSER TO THEIR PHONE</span><h1>Make the connection.</h1><p>Start with a browser call. Add a phone number when you need one.</p></div><button className="button secondary" disabled={refreshing} onClick={async () => { setRefreshing(true); await reload(); setRefreshing(false); }}><RefreshCw className={refreshing ? 'spin' : ''} size={15} />Refresh status</button></div><section className="browser-invite-panel"><div className="browser-invite-header"><span className="browser-invite-icon"><Smartphone size={21} /></span><div><h2>Your demo starts with a call link.</h2><p>Choose a ready voice at the desk, create a link, then open it on another phone. The caller taps Call, you answer, and the conversation begins.</p></div><button className="button primary" onClick={() => navigate('/desk')}>Open call desk <ArrowRight size={15} /></button></div><p className="browser-invite-note">Fish Audio provides your voice. OpenAI transcribes and translates. <span>Twilio is optional for this browser demo.</span></p></section><div className="provider-grid">{services.map(service => <article className="provider-card" key={service.id}><div className="provider-icon"><service.icon size={21} strokeWidth={1.5} /></div><div><h3>{service.title}</h3><p>{service.description}</p></div><span className={`provider-status ${setup.providers?.[service.id]?.configured ? 'configured' : ''}`}><span />{setup.providers?.[service.id]?.configured ? 'Configured' : 'Setup needed'}</span></article>)}</div><p className="provider-note">Configured means credentials are present. Test a real browser conversation from the desk. The optional setup below adds ordinary phone-number calling.</p>
    <div className="setup-layout"><div className="setup-steps"><section className="setup-step"><div className="step-heading"><span>01</span><div><h2>Choose your incoming number</h2><p>Customers call this number from their own phone.</p></div></div><div className="phone-number-display"><Phone size={19} /><div><span>Twilio phone number</span><strong>{setup.phoneNumber || 'No number connected yet'}</strong></div>{setup.phoneNumber && <button className="icon-button" aria-label="Copy phone number" onClick={() => copy(setup.phoneNumber)}><Copy size={16} /></button>}</div><p className="setup-instruction">Use a voice-capable Twilio number. In the Twilio Console, open <strong>Phone Numbers → Manage → Active numbers</strong> and choose the number you want to use.</p><a className="text-button" href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noreferrer">Open Twilio Console <ExternalLink size={13} /></a></section>
      <section className="setup-step"><div className="step-heading"><span>02</span><div><h2>Point the number to your desk</h2><p>Tell Twilio where incoming calls should go.</p></div></div><label className="field"><span>When a call comes in <span className="method-badge">HTTP POST</span></span><div className="copy-field"><input readOnly value={webhook} placeholder="Your public webhook will appear here" aria-label="Incoming call webhook URL" /><button className="icon-button" aria-label="Copy incoming webhook" disabled={!webhook} onClick={() => copy(webhook)}><Copy size={16} /></button></div></label><p className="setup-instruction">Under the number’s <strong>Voice configuration</strong>, set “A call comes in” to <strong>Webhook</strong>, paste this address, choose <strong>HTTP POST</strong>, then save.</p>{!webhook && <div className="info-box"><Globe2 size={17} /><span>The website needs a public HTTPS address so Twilio can reach it. This address appears after deployment is configured.</span></div>}<div className="waiting-note"><CircleHelp size={14} /><p>Twilio opens the phone connection before you click Answer. The customer waits on the line until you answer at the desk.</p></div></section>
      <section className="setup-step"><div className="step-heading"><span>03</span><div><h2>Set your conversation defaults</h2><p>Choose a voice and the languages for your line.</p></div></div><div className="form-stack"><label className="field"><span>Line name</span><input value={queueName} maxLength={100} onChange={event => setQueueName(event.target.value)} onBlur={async () => { if (queueName !== data.settings.queueName && queueName.trim()) { setSaving(true); await saveSettings({ queueName: queueName.trim() }); setSaving(false); } }} /></label><label className="field"><span>Default voice</span><div className="select-wrap"><AudioLines size={15} /><select value={data.settings.voiceId || ''} onChange={event => saveSettings({ voiceId: event.target.value || null })}><option value="">Select a ready voice</option>{readyVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select><ChevronDown size={14} /></div></label><div className="two-fields"><LanguageSelect label="Agent language" value={data.settings.agentLanguage} onChange={agentLanguage => saveSettings({ agentLanguage })} /><LanguageSelect label="Caller language" value={data.settings.customerLanguage} onChange={customerLanguage => saveSettings({ customerLanguage })} /></div><p className="field-help">Changes save automatically{saving ? '…' : '.'} Preview your voice in the caller’s language before the first call.</p></div></section></div>
      <aside className="demo-guide"><div className="demo-icon"><PhoneCall size={29} strokeWidth={1.3} /></div><span className="eyebrow">OPTIONAL · PHONE NUMBER CALLS</span><h3>Let’s have a<br />conversation.</h3><p>When your line is connected, try it with another person on a real phone.</p><ol><li><span>1</span>Open your call desk and enable audio.</li><li><span>2</span>Have someone dial your Twilio number.</li><li><span>3</span>Answer, then watch the caller’s translated captions appear.</li><li><span>4</span>Hold Space, speak, and release. They should hear your cloned voice in their language.</li></ol><button className="button primary full-width" onClick={() => navigate('/desk')}>Open call desk <ArrowRight size={16} /></button><div className="demo-state"><span className={setup.ready ? 'ready-dot' : ''} />{setup.ready ? 'Configuration ready for a phone test' : 'Complete setup to test your line'}</div>{blockers.length > 0 && <details className="setup-blockers"><summary>Setup details <ChevronDown size={13} /></summary><ul>{blockers.map((blocker, index) => <li key={index}>{String(blocker)}</li>)}</ul></details>}</aside></div></div>;
}
