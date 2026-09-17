import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Archive, ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Copy, ExternalLink, FileAudio, Globe2, Headphones, LayoutPanelLeft, Library, Link2, Loader2, Menu, Maximize2, Minimize2, Mic, MicOff, MoreHorizontal, Phone, PhoneCall, PhoneOff, Play, Plus, Radio, RefreshCw, Search, Send, Settings2, Share2, ShieldCheck, Smartphone, Sparkles, Square, Trash2, Upload, UserRound, Users, Volume2, X } from 'lucide-react';
import { api } from './api.js';
import { mergeTrainingStatus, monitorVoiceTraining } from './voice-training.js';
import { CallerAudio, recordingType } from './audio.js';
import { languages, languageName } from '../server/languages.mjs';
import { PANELS, PRESETS, DEFAULT_LAYOUT, normalizeLayout, movePanel } from '../server/layout.mjs';
import { DeskPanel, ArrangeBar, HiddenTray, CallerPanel, PhrasesPanel, QueuePanel, AgentsPanel, TranscriptLog } from './desk-panels.jsx';
import Caller from './Caller.jsx';
import AudioWaveform from './components/AudioWaveform.jsx';
import RecordedAudio from './components/RecordedAudio.jsx';
import { UiProvider, Dialog as Modal, ChoiceTabs, ActionMenu, Tooltip, RouteTransition } from './components/ui.jsx';
import { motion } from 'motion/react';
import conversationIllustration from './assets/undraw-audio-conversation.svg';
import recordingIllustration from './assets/undraw-recording.svg';

const DEFAULT_SETTINGS = { voiceId: '', agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' };
const NAV = [{ path: '/desk', label: 'Call desk', icon: Headphones }, { path: '/floor', label: 'Floor', icon: Users, floorOnly: true }, { path: '/voices', label: 'Voice library', icon: Library }, { path: '/enroll', label: 'Create voice', icon: AudioLines }, { path: '/admin', label: 'Setup', icon: Settings2 }];
const EMPTY_FLOOR = { waiting: [], agents: [] };
const AGENT_STATE = { available: 'Available', on_call: 'On a call', paused: 'Paused', offline: 'Offline' };
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
  const captureAttempt = useRef(0);
  const done = useRef(onFinish);
  done.current = onFinish;
  const stop = useCallback((cancel = false) => {
    wanted.current = false;
    captureAttempt.current++;
    setRequesting(false);
    const current = capture.current;
    if (current) { current.cancelled ||= cancel; if (current.recorder.state !== 'inactive') current.recorder.stop(); }
  }, []);
  const start = useCallback(async () => {
    if (wanted.current || capture.current) return;
    wanted.current = true;
    const attempt = ++captureAttempt.current;
    setRequesting(true);
    setCaptureError('');
    setInterrupted(false);
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording requires HTTPS or localhost. Upload a recording, or open the secure website.');
      const mimeType = recordingType();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!wanted.current || attempt !== captureAttempt.current) { stream.getTracks().forEach(track => track.stop()); return; }
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
    } catch (error) { stream?.getTracks().forEach(track => track.stop()); if (attempt !== captureAttempt.current) return; wanted.current = false; if (capture.current?.stream === stream) capture.current = null; setRecording(false); setStream(null); throw error; }
    finally { if (attempt === captureAttempt.current) setRequesting(false); }
  }, []);
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => { const elapsed = Math.floor((Date.now() - (capture.current?.startedAt || Date.now())) / 1000); setSeconds(elapsed); if (elapsed >= maximumSeconds) stop(); }, 200);
    return () => clearInterval(interval);
  }, [recording, maximumSeconds, stop]);
  useEffect(() => () => { wanted.current = false; const current = capture.current; if (current) { current.cancelled = true; if (current.recorder.state !== 'inactive') current.recorder.stop(); current.stream.getTracks().forEach(track => track.stop()); } }, []);
  return { recording, requesting, seconds, stream, interrupted, error: captureError, start, stop };
}

function LanguageSelect({ label, value, onChange, disabled = false, id, allowAuto = false, detected = '' }) {
  return <label className="field"><span>{label}{allowAuto && value === 'auto' && <small>{detected ? ` · ${languageName(detected)} detected` : ' · listening'}</small>}</span><div className="select-wrap"><Globe2 size={15} /><select id={id} value={value || 'en'} onChange={event => onChange(event.target.value)} disabled={disabled}>{allowAuto && <option value="auto">Detect automatically</option>}{languages.map(language => <option key={language.code} value={language.code}>{language.name}</option>)}</select><ChevronDown size={14} /></div></label>;
}

function StatusPill({ status }) { return <span className={`status-pill ${status}`}><span />{status === 'ready' ? 'Ready to use' : status === 'training' ? 'Training' : status === 'failed' ? 'Needs attention' : status === 'archived' ? 'Archived' : status}</span>; }
function Spinner({ size = 16 }) { return <Loader2 className="spin" size={size} />; }
function VoiceAvatar({ name = '', large = false }) { const seed = [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0); return <div aria-hidden="true" className={`voice-avatar avatar-${seed % 5} ${large ? 'large' : ''}`}><div /><AudioLines size={large ? 36 : 25} strokeWidth={1.25} /></div>; }

export default function App() {
  // The public caller surface never initializes authenticated workspace hooks,
  // loads voices/settings/tickets, or opens the desk WebSocket.
  const path = location.pathname.replace(/\/+$/, '');
  return <UiProvider>{path === '/caller' ? <CallerEntry /> : path === '/pill' ? <PillEntry /> : <WorkspaceApp />}</UiProvider>;
}

/** The pill under the menu bar (Mac app): call state, the last caption, hold-to-talk feedback. */
function PillEntry() {
  const [calls, setCalls] = useState([]);
  const [connection, setConnection] = useState('connecting');
  const [holding, setHolding] = useState(false);
  useEffect(() => { document.documentElement.classList.add('pill-page'); return () => document.documentElement.classList.remove('pill-page'); }, []);
  useEffect(() => {
    let socket, timer, closed = false;
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/desk`);
      socket.onopen = () => setConnection('connected');
      socket.onmessage = event => { let message; try { message = JSON.parse(event.data); } catch { return; } if (message.type === 'snapshot') setCalls(message.calls || []); if (message.type === 'call' && message.call) setCalls(current => [message.call, ...current.filter(call => call.id !== message.call.id)]); };
      socket.onclose = () => { setConnection('reconnecting'); if (!closed) timer = setTimeout(connect, 2000); };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); socket?.close(); };
  }, []);
  useEffect(() => {
    const tauri = window.__TAURI__;
    if (!tauri?.event?.listen) return;
    let unlisten; tauri.event.listen('ptt', event => setHolding(!!event.payload)).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, []);
  const live = calls.find(call => call.state === 'in_call') || calls.find(call => call.state === 'ringing');
  const last = live?.transcript?.at(-1);
  const state = !live ? (connection === 'connected' ? 'No call' : 'Connecting…') : live.state === 'ringing' ? `${live.from || 'Call'} · ringing` : holding ? 'Recording' : live.phase === 'playing' ? 'Speaking' : live.phase === 'translating' ? 'Translating' : 'Listening';
  const caption = last ? (last.speaker === 'agent' ? last.textSource : last.textShown) : live ? 'Hold ⌥ Space anywhere to speak.' : 'Calls appear here. Hold ⌥ Space to speak.';
  const openDesk = () => { try { window.__TAURI__?.webviewWindow?.WebviewWindow?.getByLabel?.('main')?.then?.(w => w?.show()); } catch { /* not in the app */ } };
  return <div className={`pill ${live ? 'is-live' : ''} ${holding ? 'is-holding' : ''}`} data-tauri-drag-region="true">
    <span className="pill-mark"><AudioLines size={16} /></span>
    <span className="pill-state"><span className="pill-dot" />{state}</span>
    <span className="pill-caption" title={caption}>{caption}</span>
    <button type="button" className="pill-open" onClick={openDesk} aria-label="Open the desk"><Maximize2 size={13} /></button>
  </div>;
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
  const [route, setRoute] = useState(location.pathname === '/' ? '/desk' : location.pathname);
  const [mobileNav, setMobileNav] = useState(false);
  const [focusDesk, setFocusDesk] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [data, setData] = useState({ voices: [], settings: DEFAULT_SETTINGS, calls: [], setup: null, agents: [], floor: EMPTY_FLOOR, agentId: '', session: null });
  const [partialCaption, setPartialCaption] = useState(null); // what the caller is saying right now, before the phrase lands
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [audioReady, setAudioReady] = useState(false);
  const [trainingNotes, setTrainingNotes] = useState({});
  const latestData = useRef(data);
  latestData.current = data;
  // Taking or leaving a seat changes the cookie the desk socket identifies with,
  // so the socket has to be re-opened for events to route to the new seat.
  const reconnect = useRef(null);
  const player = useRef(new CallerAudio());
  const navigate = useCallback(path => { history.pushState({}, '', path); setRoute(path); setMobileNav(false); window.scrollTo(0, 0); }, []);
  useEffect(() => { const pop = () => setRoute(location.pathname); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  const reload = useCallback(async () => {
    try { const value = await api.bootstrap(); setData(current => ({ ...current, ...value, settings: { ...DEFAULT_SETTINGS, ...value.settings } })); setError(''); }
    catch (failure) { setError(failure.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => monitorVoiceTraining({
    getState: () => latestData.current,
    refreshVoice: api.refreshVoice,
    onVoice: voice => setData(current => ({ ...current, voices: mergeTrainingStatus(current.voices, voice) })),
    onPaused: (id, message) => setTrainingNotes(current => ({ ...current, [id]: message })),
  }), []);
  const updateCall = useCallback(call => { if (!call) return; setData(current => ({ ...current, calls: [call, ...current.calls.filter(item => item.id !== call.id)] })); }, []);
  useEffect(() => {
    let socket, timer, disposed = false, reopen = 2500;
    reconnect.current = () => { reopen = 50; try { socket?.close(); } catch { /* already closing */ } };
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/desk`);
      socket.onopen = () => setConnection('connected');
      socket.onmessage = event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'snapshot') setData(current => ({
          ...current, calls: message.calls || current.calls,
          settings: message.settings ? { ...current.settings, ...message.settings } : current.settings,
          agents: message.agents || current.agents, floor: message.floor || current.floor,
          agentId: message.agentId === undefined ? current.agentId : message.agentId,
        }));
        if (message.type === 'floor') setData(current => ({ ...current, floor: message.floor || current.floor }));
        if (message.type === 'caption-partial') setPartialCaption(message.text ? { callId: message.callId, text: message.text, shown: message.shown || '' } : null);
        if (message.type === 'call') updateCall(message.call);
        if (message.type === 'audio' || message.type === 'caller-audio') player.current.play(message.payload, message.sampleRate || 8000);
        if (message.type === 'error') setError(message.error || message.message || 'The call connection needs attention.');
      };
      socket.onclose = () => { if (!disposed) { setConnection('reconnecting'); timer = setTimeout(connect, reopen); reopen = 2500; } };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => { disposed = true; reconnect.current = null; clearTimeout(timer); socket?.close(); player.current.clear(); };
  }, [updateCall]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  const saveSettings = async patch => {
    try { const result = await api.settings(patch); setData(current => ({ ...current, settings: result.settings || result })); return true; }
    catch (failure) { setError(failure.message); return false; }
  };
  const refreshVoices = async savedVoice => {
    if (savedVoice?.id) setData(current => ({ ...current, voices: [savedVoice, ...current.voices.filter(voice => voice.id !== savedVoice.id)] }));
    const result = await api.voices();
    setData(current => ({ ...current, voices: result.voices || [] }));
  };
  const enableAudio = async () => { await player.current.enable(); setAudioReady(true); };
  const incoming = data.calls.find(call => callState(call) === 'ringing');
  useEffect(() => { player.current.setRinging(Boolean(incoming && audioReady)); return () => player.current.stopRinging(); }, [incoming?.id, audioReady]);
  const page = NAV.find(item => item.path === route.split('?')[0]) || NAV[0];
  const sharedDemo = data.setup?.access?.mode === 'shared-demo';
  const multiAgent = data.setup?.floor?.multiAgent !== false;
  const roster = (data.agents || []).filter(agent => !agent.archived);
  // The floor only appears once someone actually adds agents, so a one-person
  // deployment never has to think about seats.
  const hasFloor = multiAgent && roster.length > 0;
  const seat = roster.find(agent => agent.id === data.agentId) || null;
  const refreshFloor = useCallback(async () => {
    try { const result = await api.agents(); setData(current => ({ ...current, agents: result.agents || [], floor: result.floor || current.floor, agentId: result.agentId ?? current.agentId })); }
    catch (failure) { setError(failure.message); }
  }, []);
  const seatActions = {
    take: async id => { await api.takeSeat(id); await refreshFloor(); reconnect.current?.(); },
    leave: async () => { await api.leaveSeat(); await refreshFloor(); reconnect.current?.(); },
    pause: async reason => { const result = await api.pause(reason); setData(current => ({ ...current, floor: result.floor })); },
    resume: async () => { const result = await api.resume(); setData(current => ({ ...current, floor: result.floor })); },
  };
  const common = { data, navigate, loading, setError, setNotice, saveSettings, refreshVoices, updateCall, sharedDemo, trainingNotes, multiAgent, hasFloor, roster, seat, seatActions, refreshFloor, partialCaption };
  return <div className={`app-shell ${focusDesk && page.path === '/desk' ? 'demo-focus' : ''}`}>
    <aside id="workspace-sidebar" className={`sidebar ${mobileNav ? 'is-open' : ''}`}>
      <a className="wordmark" href="/voices" onClick={event => { event.preventDefault(); navigate('/voices'); }} aria-label="NoteFish voice library"><span className="brand-mark"><AudioLines size={21} strokeWidth={2.2} /></span>NoteFish<span className="wordmark-dot">.</span></a>
      <div className="workspace-switch"><span className="workspace-avatar">N</span><div><strong>{sharedDemo ? 'Shared demo' : 'My workspace'}</strong><span>{sharedDemo ? 'No sign-in required' : 'Personal workspace'}</span></div><ChevronDown size={14} /></div>
      <div className="nav-label">WORKSPACE</div>
      {hasFloor && <SeatBar seat={seat} floor={data.floor} roster={roster} actions={seatActions} setError={setError} />}
      <nav aria-label="Main navigation">{NAV.filter(item => !item.floorOnly || hasFloor).map(item => <a href={item.path} key={item.path} className={page.path === item.path ? 'active' : ''} onClick={event => { event.preventDefault(); navigate(item.path); }} aria-current={page.path === item.path ? 'page' : undefined}><item.icon size={18} strokeWidth={1.7} />{item.label}{item.path === '/desk' && incoming && <span className="nav-ring" />}{item.path === '/floor' && data.floor?.waiting?.length > 1 && <span className="nav-count">{data.floor.waiting.length}</span>}</a>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><div className="tiny-orbit"><AudioLines size={18} /></div><strong>Your voice. Their language.</strong><p>A little closer, in every conversation.</p><a href="/desk" onClick={event => { event.preventDefault(); navigate('/desk'); }}>Open your desk <ArrowUpRight /></a></div><div className="sidebar-footer"><span className={`connection-dot ${connection}`} />{connection === 'connected' ? 'Workspace connected' : connection === 'connecting' ? 'Connecting workspace' : 'Reconnecting workspace'}</div></div>
    </aside>
    {mobileNav && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button menu-button" aria-label="Open navigation" aria-expanded={mobileNav} aria-controls="workspace-sidebar" onClick={() => setMobileNav(true)}><Menu size={20} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{page.label}</strong></div><div className="topbar-right"><span className="private-label"><ShieldCheck size={14} />{sharedDemo ? 'Shared demo · no sign-in' : data.setup ? 'Private workspace' : 'Workspace'}</span><Tooltip content="Fish Audio documentation"><a href="https://docs.fish.audio/" target="_blank" rel="noreferrer" className="icon-button" aria-label="Fish Audio documentation"><CircleHelp size={18} /></a></Tooltip><span className="user-avatar" aria-label={sharedDemo ? 'Shared demo workspace' : 'My workspace'}>N</span></div></header>
      {incoming && route !== '/desk' && <div className="incoming-banner" role="status"><PhoneCall size={18} /><span>Incoming call from <strong>{incoming.from || 'a customer'}</strong></span><button onClick={() => navigate('/desk')}>Go to call <ArrowRight size={15} /></button></div>}
      {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
      <main><RouteTransition route={page.path}>{page.path === '/voices' ? <VoiceLibrary {...common} /> : page.path === '/enroll' ? <Enroll {...common} /> : page.path === '/floor' ? <Floor {...common} /> : page.path === '/desk' ? <Desk {...common} connection={connection} invitation={invitation} setInvitation={setInvitation} focusDesk={focusDesk} setFocusDesk={setFocusDesk} audioReady={audioReady} enableAudio={enableAudio} clearAudio={() => player.current.clear()} setAudioMuted={muted => { player.current.muted = muted; if (muted) player.current.clear(); }} /> : <Setup {...common} reload={reload} />}</RouteTransition></main>
      <footer className="page-footer"><span>Made for human conversations.</span><span>NoteFish <span className="footer-dot">·</span> Powered by Fish Audio</span></footer>
    </div>
    {notice && <div className="toast" role="status"><CheckCircle2 size={17} />{notice}<button className="icon-button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X size={14} /></button></div>}
  </div>;
}

/** A file the browser saves, for voice exports. */
function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name.replace(/[\\/:*?"<>|]+/g, '-') });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SeatBar({ seat, floor, roster, actions, setError }) {
  const [busy, setBusy] = useState('');
  const mine = floor?.agents?.find(agent => agent.id === seat?.id);
  const run = (key, work) => { setBusy(key); work().catch(failure => setError(failure.message)).finally(() => setBusy('')); };
  if (!seat) {
    return <div className="seat-bar" aria-label="Answering as">
      <div className="nav-label">ANSWERING AS</div>
      <label className="field"><span className="sr-only">Your name on the roster</span><div className="select-wrap"><UserRound size={15} /><select aria-label="Your name on the roster" value="" disabled={!!busy} onChange={event => event.target.value && run('take', () => actions.take(event.target.value))}><option value="">Choose your name…</option>{roster.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><ChevronDown size={14} /></div></label>
      <p className="seat-note">Calls ring the name you choose.</p>
    </div>;
  }
  return <div className="seat-bar seated" aria-label="Your seat">
    <div className="seat-identity"><span className="workspace-avatar">{seat.name.slice(0, 1).toUpperCase()}</span><div><strong>{seat.name}</strong><span>{AGENT_STATE[mine?.state] || 'Available'}</span></div></div>
    <div className="seat-actions">
      {mine?.paused
        ? <button className="button primary compact" disabled={busy === 'resume'} onClick={() => run('resume', actions.resume)}>Take calls</button>
        : <button className="button secondary compact" disabled={busy === 'pause' || mine?.state === 'on_call'} onClick={() => run('pause', () => actions.pause('Break'))}>Pause</button>}
      <button className="text-button" disabled={busy === 'leave' || mine?.state === 'on_call'} onClick={() => run('leave', actions.leave)}>Sign out</button>
    </div>
    {/* Presence, not authentication: the roster names a seat, it does not verify a person. */}
    <p className="seat-note">Seat only. Anyone with workspace access can pick any name.</p>
  </div>;
}

function Floor({ data, navigate, seat, roster, multiAgent }) {
  const floor = data.floor || EMPTY_FLOOR;
  const waiting = floor.waiting || [];
  const agents = floor.agents || [];
  const busy = agents.filter(agent => agent.state === 'on_call').length;
  const available = agents.filter(agent => agent.state === 'available').length;
  const longest = waiting.length ? Math.max(...waiting.map(call => Date.now() - new Date(call.startedAt).getTime())) : 0;
  if (!multiAgent) return <div className="page"><section className="card empty-card"><h1>The floor needs the protected workspace</h1><p>{data.setup?.floor?.reason}</p></section></div>;
  return <div className="page floor-page">
    <header className="page-heading"><div><span className="eyebrow">NOTEFISH · FLOOR</span><h1>Who is on what</h1><p>A read-only view of the queue and the room. It carries no audio.</p></div></header>
    <div className="floor-stats">
      <div className="floor-stat"><strong>{waiting.length}</strong><span>Waiting</span></div>
      <div className="floor-stat"><strong>{busy}</strong><span>On calls</span></div>
      <div className="floor-stat"><strong>{available}</strong><span>Available</span></div>
      <div className="floor-stat"><strong>{waiting.length ? `${Math.round(longest / 1000)}s` : '—'}</strong><span>Longest wait</span></div>
    </div>
    <section className="card">
      <div className="mini-section-heading"><h2>Queue</h2>{waiting.length > 0 && <button className="text-button" onClick={() => navigate('/desk')}>Go to the desk <ArrowRight size={14} /></button>}</div>
      {waiting.length ? <ul className="floor-queue">{waiting.map(call => <li key={call.id}><span className="floor-position">{call.position}</span><div><strong>{call.from || 'Caller'}</strong><span>{call.transport === 'twilio' ? 'Phone' : 'Browser'} · waiting since {stamp(call.startedAt)}</span></div></li>)}</ul> : <p className="empty-note">Nobody is waiting.</p>}
    </section>
    <section className="card">
      <div className="mini-section-heading"><h2>Agents</h2><span className="chip">{roster.length} on the roster</span></div>
      {agents.length ? <ul className="floor-agents">{agents.map(agent => <li key={agent.id} className={agent.state}>
        <span className="workspace-avatar">{agent.name.slice(0, 1).toUpperCase()}</span>
        <div><strong>{agent.name}{agent.id === seat?.id && <span className="chip">You</span>}</strong><span>{AGENT_STATE[agent.state]}{agent.pauseReason ? ` · ${agent.pauseReason}` : ''}</span></div>
        <span className={`status-pill ${agent.state === 'available' ? 'ready' : agent.state === 'on_call' ? 'training' : 'archived'}`}><span />{AGENT_STATE[agent.state]}</span>
      </li>)}</ul> : <p className="empty-note">No agents yet. Add them in Setup.</p>}
    </section>
  </div>;
}

function Roster({ data, roster, setError, setNotice, refreshFloor, multiAgent }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const readyVoices = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice));
  const run = async (work, message) => {
    setBusy(true);
    try { await work(); await refreshFloor(); if (message) setNotice(message); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  if (!multiAgent) return <section className="card"><div className="mini-section-heading"><h2>Agents</h2></div><p className="empty-note">{data.setup?.floor?.reason}</p></section>;
  return <section className="card">
    <div className="mini-section-heading"><h2>Agents</h2><span className="chip">{roster.length} / {data.setup?.floor?.maxAgents || 20}</span></div>
    <p className="field-help">A roster entry is a seat, not an account. Anyone who can open this workspace can take any seat, so keep the workspace password with the people who should answer calls.</p>
    <form className="roster-add" onSubmit={event => { event.preventDefault(); if (!name.trim()) return; run(async () => { await api.createAgent({ name: name.trim() }); setName(''); }, `${name.trim()} added to the roster.`); }}>
      <label className="field"><span className="sr-only">Agent name</span><input value={name} maxLength={100} placeholder="Add an agent by name" onChange={event => setName(event.target.value)} /></label>
      <button className="button primary" disabled={busy || !name.trim()}><Plus size={15} />Add</button>
    </form>
    {roster.length ? <ul className="roster-list">{roster.map(agent => <li key={agent.id}>
      <span className="workspace-avatar">{agent.name.slice(0, 1).toUpperCase()}</span>
      <div className="roster-name"><strong>{agent.name}</strong><span>{agent.voiceId ? readyVoices.find(voice => voice.id === agent.voiceId)?.name || 'Voice unavailable' : 'Workspace voice'}{agent.customerLanguage ? ` · speaks to ${agent.customerLanguage === 'auto' ? 'whatever the caller speaks' : languageName(agent.customerLanguage)}` : ''}</span></div>
      <label className="field compact"><span className="sr-only">Voice for {agent.name}</span><div className="select-wrap"><AudioLines size={14} /><select aria-label={`Voice for ${agent.name}`} value={agent.voiceId || ''} disabled={busy} onChange={event => run(() => api.editAgent(agent.id, { voiceId: event.target.value || null }))}><option value="">Workspace voice</option>{readyVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select><ChevronDown size={13} /></div></label>
      <label className="field compact"><span className="sr-only">Caller language for {agent.name}</span><div className="select-wrap"><Globe2 size={14} /><select aria-label={`Caller language for ${agent.name}`} value={agent.customerLanguage || ''} disabled={busy} onChange={event => run(() => api.editAgent(agent.id, { customerLanguage: event.target.value || null }))}><option value="">Workspace default</option><option value="auto">Detect automatically</option>{languages.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select><ChevronDown size={13} /></div></label>
      <label className="field compact roster-style"><span className="sr-only">Style for {agent.name}</span><input aria-label={`Style for ${agent.name}`} placeholder="Style, e.g. brief and formal" maxLength={300} defaultValue={agent.persona || ''} disabled={busy} onBlur={event => { if ((event.target.value || '').trim() !== (agent.persona || '')) run(() => api.editAgent(agent.id, { persona: event.target.value })); }} /></label>
      <button className="icon-button" aria-label={`Remove ${agent.name}`} disabled={busy} onClick={() => run(() => api.removeAgent(agent.id), `${agent.name} removed from the roster.`)}><Trash2 size={15} /></button>
    </li>)}</ul> : <p className="empty-note">No agents yet. With an empty roster this stays a single desk and anyone can answer.</p>}
  </section>;
}

function ArrowUpRight() { return <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>; }

function VoiceLibrary({ data, navigate, loading, setError, setNotice, saveSettings, refreshVoices, sharedDemo, trainingNotes, seat, refreshFloor }) {
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
    { id: 'export', label: 'Export voice file', icon: ArrowDownToLine, onSelect: async () => { try { downloadJson(`${voice.name}.notefish-voice.json`, await api.exportVoice(voice.id)); setNotice('Voice file downloaded. Import it on any other desk.'); } catch (failure) { setError(failure.message); } } },
    { separator: true },
    { id: 'archive', label: isArchived(voice) ? 'Restore voice' : 'Archive voice', icon: Archive, onSelect: () => voiceAction(voice, 'archive') },
  ];
  return <div className="page library-page">
    <section className="library-hero"><div className="hero-copy"><span className="eyebrow"><span className="eyebrow-dot" /> THE VOICE BEHIND YOUR CONVERSATIONS</span><h1>A familiar voice.<br /><em>In every language.</em></h1><p>Create a voice that sounds like you.<br className="desktop-break" /> Bring it to every conversation, wherever it goes.</p><button className="button primary" onClick={() => navigate('/enroll')}><Plus size={17} />Create a voice</button></div><div className="hero-art" aria-hidden="true"><img className="hero-illustration" src={conversationIllustration} alt="" draggable="false" /><span className="art-caption">Your voice. A shared understanding.</span></div></section>
    {!loading && <Takes data={data} navigate={navigate} saveSettings={saveSettings} seat={seat} refreshFloor={refreshFloor} setError={setError} setNotice={setNotice} />}
    <section className="library-section"><div className="section-heading"><div><h2>{sharedDemo ? 'Demo voices' : 'Your voices'} <span className="count-badge">{active.length}</span></h2><p>{sharedDemo ? 'A shared collection. Create, name, and keep your voice here.' : 'Your own collection. Ready for a real conversation.'}</p></div><button className="text-button" onClick={async () => { try { downloadJson('notefish-voices.json', await api.exportVoices()); setNotice('Voice library exported.'); } catch (failure) { setError(failure.message); } }}><ArrowDownToLine size={14} />Export library</button><button className="button secondary compact" onClick={() => setImporting(true)}><ArrowDownToLine size={15} />Import Fish voice</button></div>
      <ChoiceTabs value={filter} onValueChange={setFilter} options={[{ value: 'all', label: 'All voices' }, { value: 'ready', label: 'Ready' }, { value: 'training', label: 'Training' }, { value: 'archived', label: 'Archived' }]} label="Filter voices" className="library-tabs" listClassName="filter-tabs" rightSlot={<label className="search-field"><Search size={16} /><input type="search" aria-label="Search voices" placeholder="Search your voices…" value={query} onChange={event => setQuery(event.target.value)} />{query && <Tooltip content="Clear search"><button type="button" aria-label="Clear search" onClick={() => setQuery('')}><X size={14} /></button></Tooltip>}</label>}>
      {loading ? <div className="voice-grid" role="status" aria-label="Loading your voices">{[0, 1, 2].map(item => <div className="voice-card skeleton-card" key={item}><div className="skeleton-circle" /><div className="skeleton-line" /><div className="skeleton-line short" /></div>)}</div> : filtered.length ? <div className="voice-grid">{filtered.map(voice => <article className="voice-card" key={voice.id}><div className="voice-card-top"><VoiceAvatar name={voice.name} /><ActionMenu label={`Actions for ${voice.name}`} items={voiceMenu(voice)}><button type="button" className="icon-button" aria-label={`Manage ${voice.name}`} disabled={voiceBusy === voice.id}>{voiceBusy === voice.id ? <Spinner size={17} /> : <MoreHorizontal size={20} />}</button></ActionMenu></div><div className="voice-name-row"><h3>{voice.name}</h3>{data.settings.voiceId === voice.id && <span className="assigned-label"><Headphones size={11} />Desk voice</span>}</div><p>{voice.description || 'A voice for your next conversation.'}</p>{voice.status === 'training' && !isArchived(voice) && <p className="voice-training-note">{trainingNotes[voice.id] || 'Fish is creating this voice. You can leave this page.'}</p>}<div className="voice-tags"><span><Globe2 size={12} />{languageName(voice.language || 'en')}</span><span>{voice.kind === 'licensed' ? 'Licensed voice' : 'Voice clone'}</span>{voice.register && <span><AudioLines size={12} />{REGISTERS.find(item => item.key === voice.register)?.label} take</span>}</div><div className="voice-card-bottom"><StatusPill status={isArchived(voice) ? 'archived' : voice.status} />{voice.status === 'ready' && !isArchived(voice) && <button className="button secondary compact voice-use-button" disabled={voiceBusy === voice.id} onClick={() => voiceAction(voice, 'use')}>{data.settings.voiceId === voice.id ? <Check size={14} /> : <Headphones size={14} />}{data.settings.voiceId === voice.id ? 'Open desk' : 'Use voice'}</button>}<Tooltip content={voice.status === 'ready' && !isArchived(voice) ? 'Preview voice' : 'Voice details'}><button type="button" className="preview-button" onClick={() => setSelectedId(voice.id)} aria-label={`Preview and manage ${voice.name}`}>{voice.status === 'ready' && !isArchived(voice) ? <Play size={15} fill="currentColor" /> : <Settings2 size={16} />}</button></Tooltip></div></article>)}{filter !== 'archived' && !query && <button className="create-voice-card" onClick={() => navigate('/enroll')}><span><Plus size={23} strokeWidth={1.4} /></span><strong>Create another voice</strong><small>A new voice. A new possibility.</small></button>}</div> : active.length === 0 && filter === 'all' && !query ? <div className="library-empty"><div className="empty-illustration" aria-hidden="true"><img src={recordingIllustration} alt="" draggable="false" /></div><h3>Every conversation starts with a voice.</h3><p>Add a short recording to make your first voice clone.<br />It’s yours to preview, manage, and use on the phone.</p><button className="button primary" onClick={() => navigate('/enroll')}><Plus size={16} />Create your first voice</button><button className="text-button" onClick={() => setImporting(true)}>Already have a Fish voice? Import it <ArrowRight size={14} /></button></div> : <div className="small-empty"><Search size={25} /><h3>{filter === 'archived' && !query ? 'No archived voices' : 'No voices found'}</h3><p>{query ? 'Try another name, description, or language.' : filter === 'training' ? 'Voices being created will appear here.' : filter === 'ready' ? 'Your voices will appear here when training finishes.' : 'Voices you archive stay here until you restore them.'}</p></div>}
      </ChoiceTabs>
    </section><div className="library-bottom-note"><ShieldCheck size={16} /><span>{sharedDemo ? 'Voices saved here can be used and managed by anyone with this demo’s address. Only clone voices you own or have permission to use.' : 'Your voices are private. Only clone voices you own or have permission to use.'}</span><a href="/admin" onClick={event => { event.preventDefault(); navigate('/admin'); }}>Set up your first call <ArrowRight size={14} /></a></div>
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
  return <Modal title="Import a Fish voice" onClose={onClose}><p className="modal-description">Choose a voice from your Fish Audio account, or enter the reference ID of an enrolled or licensed voice.</p>{localError && <div className="inline-error" role="alert">{localError}</div>}<form className="form-stack" onSubmit={submit}><label className="field"><span>From a NoteFish voice file <small>exported from another desk</small></span><input type="file" accept="application/json,.json" disabled={busy} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); setLocalError(''); try { const pack = JSON.parse(await file.text()); const result = await api.importPack({ pack, consent: form.consent }); await refreshVoices(); setNotice(`${result.imported.length} voice${result.imported.length === 1 ? '' : 's'} imported${result.skipped.length ? `, ${result.skipped.length} already here` : ''}.`); onClose(); } catch (failure) { setLocalError(failure.message.startsWith('Confirm') ? 'Tick the consent box below first, then choose the file again.' : failure.message); event.target.value = ''; } finally { setBusy(false); } }} /></label>{finding ? <div className="info-box"><Spinner />Finding voices in your Fish account…</div> : available.length ? <label className="field"><span>Your Fish Audio voices <small>{available.length} available</small></span><div className="select-wrap"><AudioLines size={15} /><select value={ownedId} onChange={event => { const chosen = available.find(item => item.referenceId === event.target.value); setOwnedId(event.target.value); if (chosen) setForm({ ...form, name: chosen.name, referenceId: chosen.referenceId, kind: 'enrolled', consent: false }); }}><option value="">Choose an existing voice</option>{available.map(item => <option value={item.referenceId} key={item.referenceId}>{item.name} · {item.referenceId.slice(-8)} · {item.status === 'ready' || item.status === 'trained' ? 'Ready' : item.status}</option>)}</select><ChevronDown size={14} /></div></label> : listingError ? <div className="info-box"><CircleHelp size={15} /><span>Couldn’t load your Fish voices: {listingError} You can still enter a reference ID below.</span></div> : <p className="field-help">No existing voices found in your Fish account. You can import a licensed voice by its reference ID.</p>}<label className="field"><span>Voice name</span><input required maxLength={100} placeholder="e.g. Alex · Support" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label className="field"><span>Fish reference ID</span><input required placeholder="Paste your model reference ID" value={form.referenceId} onChange={event => { setOwnedId(''); setForm({ ...form, referenceId: event.target.value, kind: 'licensed', consent: false }); }} /></label><LanguageSelect label="Original voice language" value={form.language} onChange={language => setForm({ ...form, language })} /><label className="checkbox-label"><input type="checkbox" checked={form.consent} onChange={event => setForm({ ...form, consent: event.target.checked })} required /><span>I own this voice or have permission to use it for voice cloning and translated phone conversations.</span></label><div className="modal-bottom"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !form.consent}>{busy ? <Spinner /> : <ArrowDownToLine size={16} />}Import voice</button></div></form></Modal>;
}

// The North Wind and the Sun (the IPA's illustration passage, chosen to elicit a
// language's phonemic contrasts) followed by call-centre lines with a question,
// an exclamation, a number, a time, an address and a phone number. ~45–60 s.
const READING_SCRIPTS = {
  en: "The North Wind and the Sun were arguing about which of them was stronger, when a traveller came along wrapped in a warm cloak. They agreed that whoever first made the traveller take off his cloak would be the stronger. The North Wind blew as hard as he could, but the harder he blew, the more closely the traveller wrapped the cloak around him, and at last the North Wind gave up. Then the Sun shone out warmly, and at once the traveller took off his cloak. Thanks for calling — can you give me the order number? It’s four eight two one, under Dubois. The driver is two stops away, about fifteen minutes. Is the buzzer at twelve Rue de la Paix working? Wonderful, that’s sorted! If anything changes I’ll call you back on zero six, twelve, thirty-four, fifty-six, seventy-eight.",
  fr: "La bise et le soleil se disputaient, chacun assurant qu’il était le plus fort, quand ils ont vu un voyageur qui s’avançait, enveloppé dans son manteau. Ils sont tombés d’accord que celui qui arriverait le premier à le lui faire ôter serait regardé comme le plus fort. Alors la bise s’est mise à souffler de toutes ses forces, mais plus elle soufflait, plus le voyageur serrait son manteau autour de lui, et à la fin la bise a renoncé. Alors le soleil a commencé à briller, et au bout d’un moment le voyageur, réchauffé, a ôté son manteau. Merci d’avoir appelé — pouvez-vous me donner le numéro de commande ? C’est le quatre, huit, deux, un, au nom de Dubois. Le chauffeur est à deux arrêts, environ quinze minutes. Est-ce que l’interphone du douze rue de la Paix fonctionne ? Parfait, c’est réglé ! Si quelque chose change, je vous rappelle au zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit.",
  de: "Einst stritten sich Nordwind und Sonne, wer von ihnen beiden wohl der Stärkere wäre, als ein Wanderer, der in einen warmen Mantel gehüllt war, des Weges daherkam. Sie wurden einig, dass derjenige für den Stärkeren gelten sollte, der den Wanderer zwingen würde, seinen Mantel abzunehmen. Der Nordwind blies mit aller Macht, aber je mehr er blies, desto fester hüllte sich der Wanderer in seinen Mantel ein. Endlich gab der Nordwind den Kampf auf. Nun erwärmte die Sonne die Luft mit ihren freundlichen Strahlen, und schon nach wenigen Augenblicken zog der Wanderer seinen Mantel aus. Danke für Ihren Anruf — können Sie mir die Bestellnummer geben? Vier, acht, zwei, eins, auf den Namen Dubois. Der Fahrer ist zwei Haltestellen entfernt, etwa fünfzehn Minuten. Funktioniert die Klingel in der Rue de la Paix zwölf? Wunderbar, das ist erledigt! Wenn sich etwas ändert, rufe ich Sie unter null sechs, zwölf, vierunddreißig, sechsundfünfzig, achtundsiebzig zurück.",
  es: "El viento del norte y el sol discutían sobre cuál de los dos era el más fuerte, cuando pasó un viajero envuelto en una capa. Se pusieron de acuerdo en que quien primero lograra que el viajero se quitara la capa sería considerado el más fuerte. El viento del norte sopló con toda su fuerza, pero cuanto más soplaba, más se envolvía el viajero en su capa, y al final el viento desistió. Entonces el sol brilló con fuerza, y enseguida el viajero se quitó la capa. Gracias por llamar — ¿me puede dar el número de pedido? Es el cuatro, ocho, dos, uno, a nombre de Dubois. El repartidor está a dos paradas, unos quince minutos. ¿Funciona el portero del número doce de la Rue de la Paix? ¡Estupendo, ya está resuelto! Si algo cambia, le devuelvo la llamada al cero seis, doce, treinta y cuatro, cincuenta y seis, setenta y ocho.",
  nl: "De noordenwind en de zon hadden een discussie over de vraag wie van hun tweeën de sterkste was, toen er een reiziger langskwam in een warme jas. Ze spraken af dat wie de reiziger het eerst zijn jas kon laten uittrekken, de sterkste zou zijn. De noordenwind blies zo hard als hij kon, maar hoe harder hij blies, hoe dichter de reiziger zijn jas om zich heen trok, en uiteindelijk gaf de noordenwind het op. Toen scheen de zon warm, en meteen trok de reiziger zijn jas uit. Bedankt voor het bellen — kunt u mij het ordernummer geven? Het is vier, acht, twee, één, op naam van Dubois. De bezorger is twee haltes verderop, ongeveer vijftien minuten. Werkt de bel op Rue de la Paix twaalf? Geweldig, dat is geregeld! Als er iets verandert, bel ik u terug op nul zes, twaalf, vierendertig, zesenvijftig, achtenzeventig.",
};
/** One take of the agent's own voice per feeling. A seated agent edits their own slots; a single desk edits the workspace's. */
function Takes({ data, navigate, saveSettings, seat, refreshFloor, setError, setNotice }) {
  const own = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice) && voice.kind === 'enrolled');
  const registers = (seat ? seat.registers : data.settings.registers) || {};
  const [saving, setSaving] = useState('');
  const assign = async (key, id) => {
    setSaving(key);
    try {
      const next = { ...registers, [key]: id || null };
      if (seat) { await api.editAgent(seat.id, { registers: next }); await refreshFloor(); } else await saveSettings({ registers: next });
      setNotice(id ? `${REGISTERS.find(item => item.key === key).label} take set.` : 'Back to your default voice for that feeling.');
    } catch (failure) { setError(failure.message); } finally { setSaving(''); }
  };
  return <section className="library-section takes-section"><div className="section-heading"><div><h2>{seat ? `${seat.name}’s takes` : 'Your takes'}</h2><p>One recording per feeling. When you push to talk, NoteFish hears how you said it and speaks with the matching take.</p></div></div>
    <div className="takes-grid">{REGISTERS.map(item => { const chosen = own.find(voice => voice.id === registers[item.key]); return <div className={`take-card ${chosen ? 'has-take' : ''}`} key={item.key}><div className="take-card-top"><strong>{item.label}</strong>{chosen ? <span className="assigned-label"><Check size={11} />{chosen.name}</span> : <span className="subtle-tag">Default voice</span>}</div><small>{item.hint}</small>
      <div className="select-wrap"><AudioLines size={14} /><select aria-label={`${item.label} take`} value={registers[item.key] || ''} disabled={saving === item.key} onChange={event => assign(item.key, event.target.value)}><option value="">Use default voice</option>{own.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select><ChevronDown size={13} /></div>
      <button className="text-button" onClick={() => navigate(`/enroll?register=${item.key}`)}><Mic size={13} />{chosen ? 'Record again' : 'Record this take'}</button></div>; })}</div></section>;
}

const REGISTERS = [
  { key: 'calm', label: 'Calm', hint: 'Your everyday desk voice. Steady, unhurried. Record this one first.' },
  { key: 'warm', label: 'Warm', hint: 'As if the caller is a friend: a smile in the voice, a little more energy.' },
  { key: 'energetic', label: 'Energetic', hint: 'Bright and quick, the way you speak when something needs doing now.' },
  { key: 'reassuring', label: 'Reassuring', hint: 'Steady and certain: the caller should feel it is handled.' },
  { key: 'apologetic', label: 'Apologetic', hint: 'Softer and slower, as if something went wrong and it matters to you.' },
  { key: 'firm', label: 'Firm', hint: 'Clear boundaries without an edge. For the rules you cannot bend.' },
];
const VOICE_READING_SCRIPT = "Hello, it’s good to meet you. I’m here to listen and help you find the right answer. What would you like to talk about today? Take your time; there’s no need to rush. We can check the details together, one step at a time. Your delivery is arriving tomorrow morning, between nine and eleven. If anything changes, please let me know. Thank you for calling, and I hope you have a wonderful day.";

function Enroll({ data, navigate, setError, setNotice, refreshVoices, saveSettings, sharedDemo, trainingNotes }) {
  const [sample, setSample] = useState(null);
  const [name, setName] = useState('My voice');
  const [consent, setConsent] = useState(false);
  const [language, setLanguage] = useState(data.settings.customerLanguage && READING_SCRIPTS[data.settings.customerLanguage] ? data.settings.customerLanguage : 'en');
  const [register, setRegister] = useState(() => { const asked = new URLSearchParams(location.search).get('register'); return REGISTERS.some(item => item.key === asked) ? asked : 'calm'; });
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedVoice, setSavedVoice] = useState(null);
  const script = READING_SCRIPTS[language] || READING_SCRIPTS.en;
  const [previewCreated, setPreviewCreated] = useState(false);
  const fileInput = useRef(null);
  const reviewHeading = useRef(null);
  const createdVoice = data.voices.find(voice => voice.id === savedVoice?.id) || savedVoice;
  const capture = useCapture((blob, duration) => {
    if (duration < 10) { setError('Read for at least 10 seconds. Try reading the whole passage at your usual pace.'); return; }
    if (duration < 30) setNotice('Under 30 seconds. It will work, but 45–60 seconds sounds more like you.');
    setSample({ blob, duration, name: `voice-recording.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, guided: true });
    setTranscript(script);
  });
  useEffect(() => { if (capture.error) setError(capture.error); }, [capture.error]);
  useEffect(() => { if (sample) reviewHeading.current?.focus(); }, [sample]);
  const liveCall = data.calls.some(call => ['ringing', 'in_call'].includes(callState(call)));
  useEffect(() => { if (liveCall) capture.stop(true); }, [liveCall, capture.stop]);
  const resetSample = () => { setSample(null); setConsent(false); };
  const upload = file => {
    if (!file) return;
    if (!/\.(wav|mp3|m4a|webm|ogg)$/i.test(file.name) && !['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg'].includes(file.type)) { setError('Choose a WAV, MP3, M4A, WebM, or OGG recording.'); return; }
    if (file.size > 30 * 1024 * 1024) { setError('Choose a recording smaller than 30 MB.'); return; }
    setSample({ blob: file, name: file.name }); setTranscript(''); setConsent(false);
  };
  const submit = async event => {
    event.preventDefault(); if (!sample || !consent || !name.trim() || busy || liveCall) return;
    setBusy(true);
    try {
      const payload = new FormData();
      for (const [key, value] of Object.entries({ name: name.trim(), language, transcript, consent: 'true', register })) payload.append(key, value);
      payload.append('audio', sample.blob, sample.name);
      const result = await api.createVoice(payload); setSavedVoice(result.voice); await refreshVoices(result.voice);
      setNotice('Your voice is saved in the library.');
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  const useCreatedVoice = async () => {
    if (busy) return;
    setBusy(true);
    try { if (await saveSettings({ voiceId: createdVoice.id })) navigate('/desk'); } finally { setBusy(false); }
  };
  if (createdVoice) return <div className="page guided-enrollment"><div className="creation-success">
    <VoiceAvatar name={createdVoice.name} large /><span className="eyebrow">SAVED TO YOUR LIBRARY</span><h1>{createdVoice.name}</h1>
    <p>{createdVoice.status === 'ready' ? 'Your voice is ready for a conversation.' : createdVoice.status === 'failed' ? 'Fish could not create this voice. Try another clear recording.' : 'Fish is preparing your voice. You can keep using the site while it finishes.'}</p>
    <StatusPill status={isArchived(createdVoice) ? 'archived' : createdVoice.status} />
    {createdVoice.status === 'training' && trainingNotes[createdVoice.id] && <p role="status">{trainingNotes[createdVoice.id]}</p>}
    <div className="success-actions">{createdVoice.status === 'ready' && !isArchived(createdVoice) ? <><button className="button secondary" onClick={() => setPreviewCreated(true)}><Play size={15} />Preview voice</button><button className="button primary" disabled={busy} onClick={useCreatedVoice}>Use at call desk <ArrowRight size={16} /></button></> : <button className="button primary" onClick={() => navigate('/voices')}>Open voice library <ArrowRight size={16} /></button>}</div>
    <div className="success-links"><button className="text-button" onClick={() => navigate('/voices')}><Library size={14} />Manage voices</button><button className="text-button" onClick={() => { setSavedVoice(null); setPreviewCreated(false); resetSample(); }}><Plus size={14} />Record another voice</button></div>
  </div>{previewCreated && <VoiceModal voice={createdVoice} agentLanguage={data.settings.agentLanguage} customerLanguage={data.settings.customerLanguage} onClose={() => setPreviewCreated(false)} setError={setError} setNotice={setNotice} refreshVoices={refreshVoices} onUse={useCreatedVoice} />}</div>;
  return <div className="page guided-enrollment">
    <div className="guided-heading"><div><span className="eyebrow">YOUR VOICE, IN THEIR LANGUAGE</span><h1>{sample ? 'Make it yours.' : 'Read. Record. Ready.'}</h1><p>{sample ? 'Listen once, give it a name, and save your voice.' : 'Find a quiet spot. Press Record and read this aloud in your normal voice.'}</p></div><button className="text-button" onClick={() => navigate('/voices')}><Library size={15} />Manage voices</button></div>
    {liveCall && <div className="info-box"><Phone size={17} />Finish the call before creating a voice.</div>}
    {!sample ? <section className={`guided-recorder ${capture.recording ? 'is-recording' : ''}`} aria-label="Record your voice">
      <div className="reading-setup">
        <LanguageSelect label="Record in the language your callers hear" value={language} onChange={setLanguage} disabled={capture.recording} />
        <label className="field"><span>Register</span><div className="select-wrap"><AudioLines size={15} /><select value={register} onChange={event => setRegister(event.target.value)} disabled={capture.recording}>{REGISTERS.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select><ChevronDown size={14} /></div></label>
      </div>
      <p className="field-help">{REGISTERS.find(item => item.key === register)?.hint} Keep one feeling for the whole passage; the other feelings get their own take.</p>
      <div className="reading-caption"><span>READ THIS ALOUD</span><span>{languageName(language)} · 45–60 seconds · natural pace, half a second between sentences</span></div>
      <blockquote className="reading-passage">{script}</blockquote>
      <div className="guided-record-controls">
        {capture.recording && <AudioWaveform stream={capture.stream} active={!capture.interrupted} height={36} label="Live microphone level" />}
        <button type="button" className={`button record-voice-button ${capture.recording ? 'danger' : 'primary'}`} disabled={liveCall || capture.requesting} onClick={() => capture.recording ? capture.stop() : capture.start().catch(failure => setError(failure.message))}>{capture.requesting ? <Spinner /> : capture.recording ? <Square size={18} fill="currentColor" /> : <Mic size={20} />}{capture.requesting ? 'Allow microphone access…' : capture.recording ? 'Stop recording' : 'Record my voice'}</button>
        <p role="status">{capture.interrupted ? 'Microphone paused. Check your microphone or stop and try again.' : capture.recording ? `${formatDuration(capture.seconds)} · Stop when you finish the passage.` : 'One speaker. No music. Speak naturally.'}</p>
        {capture.requesting && <button className="text-button" onClick={() => capture.stop(true)}>Cancel</button>}
      </div>
    </section> : <form className="guided-review" onSubmit={submit}>
      <h2 ref={reviewHeading} tabIndex={-1}>Your recording</h2>
      <div className="sample-ready"><RecordedAudio blob={sample.blob} /><div className="sample-review-meta"><span>{sample.guided ? 'Microphone recording' : sample.name}</span><button type="button" className="text-button" disabled={busy} onClick={resetSample}><RefreshCw size={14} />Record again</button></div></div>
      <label className="field"><span>Voice name</span><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Alex" disabled={busy} /></label>
      <details className="recording-options"><summary>Recording details <ChevronDown size={14} /></summary><div className="form-stack"><LanguageSelect label="Recording language" value={language} onChange={setLanguage} disabled={busy} /><label className="field"><span>Words in your recording <small>optional</small></span><textarea rows={4} maxLength={5000} value={transcript} onChange={event => setTranscript(event.target.value)} disabled={busy} /></label><p className="field-help">If you changed the passage, update the words here or leave this blank.</p></div></details>
      <label className="checkbox-label"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} required /><span>This is my voice, or I have permission to clone it and use it for translated calls.</span></label>
      <button className="button primary full-width" disabled={busy || !consent || !name.trim() || liveCall}>{busy ? <Spinner /> : <AudioLines size={18} />}{busy ? 'Creating your voice…' : 'Create voice'}</button>
      {sharedDemo && <p className="shared-demo-note">Saved voices are available to everyone using this shared demo.</p>}
    </form>}
    {!sample && <details className="recording-options"><summary>Use an existing recording <ChevronDown size={14} /></summary><p>One clear speaker, preferably 30 seconds or more. WAV, MP3, M4A, WebM or OGG, up to 30 MB.</p><button type="button" className="button secondary" disabled={capture.recording || capture.requesting || liveCall} onClick={() => fileInput.current?.click()}><Upload size={15} />Choose audio file</button></details>}
    <input hidden ref={fileInput} type="file" accept="audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/ogg,.wav,.mp3,.m4a,.webm,.ogg" onChange={event => { upload(event.target.files[0]); event.target.value = ''; }} />
  </div>;
}

function Desk({ data, navigate, setError, setNotice, saveSettings, updateCall, connection, invitation, setInvitation, focusDesk, setFocusDesk, audioReady, enableAudio, clearAudio, setAudioMuted, hasFloor, seat, refreshFloor, partialCaption }) {
  const [selectedCallId, setSelectedCallId] = useState('');
  // With a floor, this desk shows the call assigned to this seat. Another
  // agent's live call is theirs; only the ringing queue is shared.
  const mine = call => !hasFloor || !call.agentId || call.agentId === data.agentId;
  const ringingCalls = data.calls.filter(call => callState(call) === 'ringing');
  const liveCall = data.calls.find(call => callState(call) === 'in_call' && mine(call)) || ringingCalls[0];
  const currentCall = liveCall || data.calls.find(call => call.id === selectedCallId) || null;
  const needsSeat = hasFloor && !seat;
  const active = callState(currentCall) === 'in_call';
  const ringing = callState(currentCall) === 'ringing';
  const [busy, setBusy] = useState('');
  const [reply, setReply] = useState('');
  const [typed, setTyped] = useState(false);
  // How the next reply should sound. 'auto' lets the desk decide from the clip and the caller.
  const [feeling, setFeeling] = useState('auto');
  const feelingRef = useRef('auto'); feelingRef.current = feeling;
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const microphoneMutedRef = useRef(false);
  const [languageSaving, setLanguageSaving] = useState(false);
  const [ticket, setTicket] = useState({ issue: '', address: '', dispatch: false });
  const [elapsed, setElapsed] = useState(0);
  const transcriptContainer = useRef(null);
  const followTranscript = useRef(true);
  const [newCaptions, setNewCaptions] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pointerHeld = useRef(false);
  const activeRef = useRef(currentCall);
  activeRef.current = currentCall;
  const readyVoices = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice));
  const voice = readyVoices.find(item => item.id === data.settings.voiceId);
  const phase = currentCall?.phase || 'listening';
  const processing = active && !['listening', 'idle'].includes(phase);
  const canTalk = active && !!voice && !busy && !languageSaving && !processing && connection === 'connected';
  const capture = useCapture(async (blob, duration) => {
    if (microphoneMutedRef.current) return;
    if (duration < .3) { setNotice('Hold a little longer to record your reply.'); return; }
    const call = activeRef.current;
    if (callState(call) !== 'in_call') return;
    setBusy('reply');
    try { const result = await api.ptt(call.id, blob, feelingRef.current); updateCall(result.call); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }, 45);
  useEffect(() => { if (capture.error) setError(capture.error); }, [capture.error]);
  useEffect(() => { microphoneMutedRef.current = false; setMicrophoneMuted(false); }, [active, currentCall?.id]);
  useEffect(() => { setFeeling('auto'); }, [currentCall?.id]);
  useEffect(() => { setTicket({ issue: currentCall?.ticket?.issue || '', address: currentCall?.ticket?.address || '', dispatch: needsDispatch(currentCall?.ticket?.dispatch) }); }, [currentCall?.id]);
  useEffect(() => {
    if (!active) { setElapsed(0); capture.stop(true); clearAudio(); return; }
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(currentCall.answeredAt || currentCall.startedAt).getTime()) / 1000)));
    tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [active, currentCall?.id]);
  useEffect(() => { followTranscript.current = true; setNewCaptions(false); }, [currentCall?.id]);
  useEffect(() => {
    if (followTranscript.current && transcriptContainer.current) transcriptContainer.current.scrollTop = transcriptContainer.current.scrollHeight;
    else if (currentCall?.transcript?.length) setNewCaptions(true);
  }, [currentCall?.id, currentCall?.transcript?.length]);
  useEffect(() => { if (liveCall) { setSelectedCallId(liveCall.id); setInvitation(null); } }, [liveCall?.id]);
  useEffect(() => { setAudioMuted(capture.recording || capture.requesting || processing || busy === 'reply'); return () => setAudioMuted(false); }, [capture.recording, capture.requesting, processing, busy]);
  useEffect(() => { if (!invitation) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [invitation]);
  const startTalk = useCallback(() => { if (canTalk && !microphoneMutedRef.current) { clearAudio(); capture.start().catch(failure => setError(failure.message)); } }, [canTalk, capture.start]);
  const toggleMicrophone = () => {
    const muted = !microphoneMutedRef.current;
    microphoneMutedRef.current = muted;
    if (muted) { pointerHeld.current = false; capture.stop(true); }
    setMicrophoneMuted(muted);
  };
  // Inside the Mac app, ⌥Space anywhere is the same hold-to-speak key.
  useEffect(() => {
    const tauri = window.__TAURI__;
    if (!tauri?.event?.listen) return;
    let unlisten; tauri.event.listen('ptt', event => { if (event.payload) startTalk(); else capture.stop(); }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, [startTalk, capture.stop]);
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
  const browserReady = !!voice && data.setup?.ready && connection === 'connected' && !busy;
  const inviteExpired = invitation && new Date(invitation.expiresAt).getTime() <= now;
  const createInvitation = async () => {
    setInviteBusy(true);
    try {
      await enableAudio();
      // Ask before the call, so the first held reply is not lost to a permission prompt.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open NoteFish over HTTPS to use your microphone.');
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      microphone.getTracks().forEach(track => track.stop());
      const created = await api.createInvitation(); setInvitation(created); setNow(Date.now()); setSelectedCallId(''); setNotice('Link ready. Copy it and send it to your partner.');
    }
    catch (failure) { setError(failure.name === 'NotAllowedError' ? 'Allow microphone access in your browser, then create the call link again.' : failure.message); }
    finally { setInviteBusy(false); }
  };
  const changePartnerLanguage = async customerLanguage => {
    setLanguageSaving(true);
    try { if (await saveSettings({ customerLanguage })) setNotice(`Partner language changed to ${languageName(customerLanguage)}. New phrases and replies use this language.`); }
    finally { setLanguageSaving(false); }
  };
  const copyInvitation = async () => { try { await navigator.clipboard.writeText(invitation.url); setNotice('Call link copied. Share it with the person calling you.'); } catch { setError('Select and copy the call link manually. Clipboard access is unavailable.'); } };
  const shareInvitation = async () => { try { await navigator.share({ title: 'NoteFish call', text: 'Open this link on your phone and tap Call.', url: invitation.url }); } catch (failure) { if (failure.name !== 'AbortError') setError(failure.message); } };
  const phaseLabel = capture.interrupted ? 'Microphone paused' : capture.recording ? 'Recording your reply' : capture.requesting ? 'Allow microphone access' : busy === 'reply' || processing ? phase === 'playing' ? 'Sending your voice reply' : currentCall?.stage === 'synthesizing' ? `Creating ${languageName(data.settings.customerLanguage)} speech` : currentCall?.stage === 'transcribing' ? 'Transcribing your reply' : 'Translating your reply' : active ? 'Listening to your partner' : ringing ? 'Your partner is calling' : 'Ready for a conversation';
  const scrollToLatest = () => { followTranscript.current = true; setNewCaptions(false); if (transcriptContainer.current) transcriptContainer.current.scrollTop = transcriptContainer.current.scrollHeight; };
  // ---- layout: which panel sits where. Saved to the seat, or to the workspace on a single desk.
  const layoutSource = seat ? seat.layout : data.settings.layout;
  const layoutKey = JSON.stringify(layoutSource || null);
  const [layout, setLayout] = useState(() => normalizeLayout(layoutSource));
  useEffect(() => { setLayout(normalizeLayout(layoutSource)); }, [seat?.id, layoutKey]);
  const [arranging, setArranging] = useState(false);
  const sideColumn = useRef(null), mainColumn = useRef(null), hiddenTray = useRef(null);
  const columnRefs = { side: sideColumn, main: mainColumn, hidden: hiddenTray };
  const persistOwned = async patch => { try { if (seat) { await api.editAgent(seat.id, patch); await refreshFloor(); } else await saveSettings(patch); } catch (failure) { setError(failure.message); } };
  const applyLayout = next => { setLayout(next); persistOwned({ layout: next }); };
  const available = id => hasFloor || !PANELS.find(panel => panel.id === id)?.floorOnly;
  const visible = column => layout[column].filter(available);
  const movePanelTo = (id, column, index) => applyLayout(movePanel(layout, id, column, index));
  const hidePanel = id => applyLayout(movePanel(layout, id, 'hidden'));
  const showPanel = id => applyLayout(movePanel(layout, id, 'side'));
  // Where a dragged panel landed: the hidden tray, or a column and the slot between its neighbours.
  const dropPanel = (id, point) => {
    const rect = column => columnRefs[column].current?.getBoundingClientRect();
    const inside = column => { const r = rect(column); return !!r && point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom; };
    let target = ['hidden', 'side', 'main'].find(inside);
    if (!target) { const s = rect('side'), m = rect('main'); if (!s || !m) return; target = Math.abs(point.x - (s.left + s.right) / 2) <= Math.abs(point.x - (m.left + m.right) / 2) ? 'side' : 'main'; }
    if (target === 'hidden') return hidePanel(id);
    const others = [...columnRefs[target].current.querySelectorAll('[data-panel]')].filter(el => el.dataset.panel !== id);
    const index = others.findIndex(el => { const r = el.getBoundingClientRect(); return point.y < r.top + r.height / 2; });
    applyLayout(movePanel(layout, id, target, index === -1 ? others.length : index));
  };
  const phrasesSource = (seat ? seat.phrases : data.settings.phrases) || [];
  const savePhrases = next => persistOwned({ phrases: next });
  const speakPhrase = text => action('reply', () => api.say(currentCall.id, text, feeling));
  const lastAgentLine = [...transcript].reverse().find(line => line.speaker === 'agent');
  const feelingRow = <div className="feeling-row" role="group" aria-label="How your reply should sound"><span className="feeling-label">Sound</span>{[['auto', 'Auto'], ...REGISTERS.map(item => [item.key, item.label])].map(([key, label]) => <button type="button" key={key} className={`feeling-pill ${feeling === key ? 'is-on' : ''}`} aria-pressed={feeling === key} onClick={() => setFeeling(key)}>{label}</button>)}{feeling === 'auto' && lastAgentLine?.feeling && <span className="feeling-auto">last: {lastAgentLine.feeling}{lastAgentLine.why && lastAgentLine.why !== 'said' ? ` · ${lastAgentLine.why}` : ''}</span>}</div>;
  const targetLanguage = currentCall?.detectedLanguage || (data.settings.customerLanguage !== 'auto' ? data.settings.customerLanguage : '');
  const transcriptScroll = event => { const el = event.currentTarget; followTranscript.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; if (followTranscript.current) setNewCaptions(false); };
  const renderers = {
    voice: { title: 'Your voice', className: 'demo-voice-panel', actions: <button className="text-button" disabled={active || ringing} onClick={() => navigate('/voices')}><Library size={14} />Manage voices</button>, body: <>
<label className="field"><span className="sr-only">Voice for this call</span><div className="select-wrap"><AudioLines size={17} /><select aria-label="Voice for this call" value={data.settings.voiceId || ''} disabled={active || ringing || !!busy} onChange={event => action('settings', () => saveSettings({ voiceId: event.target.value || null }))}><option value="">Choose a voice</option>{readyVoices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></div></label>
<button className="text-button" disabled={active || ringing} onClick={() => navigate('/enroll')}><Plus size={14} />Record a new voice</button>
<div className="demo-language-pair"><LanguageSelect label="You speak" value={data.settings.agentLanguage} onChange={agentLanguage => action('settings', () => saveSettings({ agentLanguage }))} disabled={active || ringing || !!busy} /><LanguageSelect label="Partner speaks" value={data.settings.customerLanguage} onChange={changePartnerLanguage} disabled={languageSaving || connection !== 'connected'} allowAuto detected={currentCall?.detectedLanguage || ''} /></div>
{(active || ringing) && <p className="field-help" role="status">{languageSaving ? 'Changing language…' : 'Changes apply to new phrases and replies. A reply already underway finishes in its original language.'}</p>}
    </> },
    connect: { label: 'Call', className: `demo-connect-panel ${ringing ? 'is-ringing' : ''}`, body: <>
{active || ringing ? <><div className="demo-call-identity"><span className="phone-icon">{ringing ? <PhoneCall size={22} /> : <Phone size={22} />}</span><div><span className="eyebrow">{ringing ? 'INCOMING CALL' : 'LIVE CALL'}</span><h2>{currentCall.from || 'Your partner'}</h2><p>{active ? formatDuration(elapsed) : 'Your partner is waiting.'}</p></div></div><div className="line-actions">{ringing ? <><button className="button secondary" disabled={!!busy} onClick={() => action('end', () => api.end(currentCall.id))}>Decline</button><button className="button answer" disabled={!!busy} onClick={() => action('answer', async () => { await enableAudio(); return api.answer(currentCall.id); })}>{busy === 'answer' ? <Spinner /> : <Phone size={17} />}Answer call</button></> : <><button type="button" className={`button secondary desk-mute-button ${microphoneMuted ? 'is-muted' : ''}`} aria-pressed={microphoneMuted} aria-label={microphoneMuted ? 'Unmute microphone' : 'Mute microphone'} onClick={toggleMicrophone}>{microphoneMuted ? <MicOff size={17} /> : <Mic size={17} />}{microphoneMuted ? 'Unmute' : 'Mute'}</button><button className="button end-call" disabled={busy === 'end'} onClick={() => { capture.stop(true); clearAudio(); action('end', () => api.end(currentCall.id)); }}><PhoneOff size={17} />End call</button></>}</div></> : <><h2>{currentCall ? 'Call ended. Transcript saved.' : 'Invite your partner'}</h2><p>{invitation && !inviteExpired ? 'Send this link to your partner. Keep this desk open and answer when it rings.' : 'Create a link. Your partner opens it on their phone and taps Call.'}</p>
{invitation && !inviteExpired ? <div className="demo-share-link"><label className="field"><span className="sr-only">Caller invitation link</span><input readOnly aria-label="Caller invitation link" value={invitation.url} onFocus={event => event.target.select()} /></label><button className="button primary full-width" onClick={copyInvitation}><Copy size={16} />Copy call link</button><div className="demo-link-secondary"><span>One use · Expires {stamp(invitation.expiresAt)}</span>{typeof navigator.share === 'function' && <button className="text-button" onClick={shareInvitation}><Share2 size={14} />Share</button>}</div><button className="text-button" disabled={!browserReady || inviteBusy} onClick={createInvitation}>Create a new link</button></div> : <><button className="button primary full-width" disabled={!browserReady || inviteBusy} onClick={createInvitation}>{inviteBusy ? <Spinner /> : <Link2 size={17} />}{inviteBusy ? 'Preparing your call…' : 'Create call link'}</button>{inviteExpired && <p className="call-link-help">Your previous link expired. Create a fresh one.</p>}</>}
{!browserReady && <p className="call-link-help">{!voice ? 'Select a ready voice to start, or record your own above.' : connection !== 'connected' ? 'Reconnecting to the desk…' : data.setup?.blockers?.[0] || 'Finishing call setup…'}</p>}</>}
{!audioReady && (active || ringing) && <button className="text-button" disabled={busy === 'audio'} onClick={() => action('audio', enableAudio)}><Volume2 size={15} />Enable sound</button>}
      {!currentCall && <details className="demo-prompt-notes"><summary>Try a short conversation <ChevronDown size={14} /></summary><p><strong>Partner, in French</strong>Bonjour, à quelle heure arrive ma livraison ?</p><p><strong>You, in English</strong>Your delivery will arrive tomorrow morning, between nine and eleven.</p><p>Pause between turns. Use headphones on both devices.</p></details>}
    </> },
    speak: { label: 'Speak to your partner', className: `talk-panel demo-talk-panel ${capture.recording ? 'recording' : ''}`, body: <>
<div className="talk-info"><div><h3 role="status">{active && microphoneMuted && !processing && busy !== 'reply' ? 'Your microphone is muted' : phaseLabel}</h3><p>{active && microphoneMuted ? 'You can still hear your partner. Unmute to record a reply, or type one below.' : capture.recording ? `${formatDuration(capture.seconds)} · Release to send. Esc to cancel.` : active ? `Hold to speak ${languageName(data.settings.agentLanguage)}. Release to send ${languageName(data.settings.customerLanguage)}.` : 'Once connected, hold the button to speak. Release to send your translated voice.'}</p></div></div>
{feelingRow}
{capture.recording && <AudioWaveform stream={capture.stream} active={!capture.interrupted} height={34} label="Your microphone level" />}
<div className="talk-actions">{processing || busy === 'reply' ? <button className="button secondary full-width" onClick={() => action('stop', () => api.stop(currentCall.id))} disabled={busy === 'stop'}><Square size={15} />{phase === 'playing' ? 'Stop playback' : 'Cancel reply'}</button> : <button className={`ptt-button ${capture.recording ? 'pressed' : ''}`} data-ptt="true" disabled={microphoneMuted || (!canTalk && !capture.recording && !capture.requesting)} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); pointerHeld.current = true; event.currentTarget.setPointerCapture(event.pointerId); startTalk(); }} onPointerUp={() => { pointerHeld.current = false; capture.stop(); }} onPointerCancel={() => { pointerHeld.current = false; capture.stop(true); }} onLostPointerCapture={() => { if (pointerHeld.current) { pointerHeld.current = false; capture.stop(true); } }}><>{microphoneMuted ? <MicOff size={20} /> : <Mic size={20} />}</>{microphoneMuted ? 'Microphone muted' : capture.recording ? 'Release to send' : 'Hold to speak'}<kbd>space</kbd></button>}
<button className="text-button" onClick={() => setTyped(!typed)} aria-expanded={typed}>{typed ? 'Hide typed reply' : 'Type a reply'}<ChevronDown size={13} /></button></div>
{typed && <form className="typed-reply" onSubmit={event => { event.preventDefault(); if (!reply.trim() || !canTalk) return; action('reply', async () => { const result = await api.say(currentCall.id, reply.trim(), feeling); setReply(''); return result; }); }}><label className="field"><span>Reply in {languageName(data.settings.agentLanguage)}</span><textarea rows={3} maxLength={3000} value={reply} onChange={event => setReply(event.target.value)} placeholder="What would you like to say?" /></label><button className="button primary" disabled={!canTalk || !reply.trim()}><Send size={15} />Translate & speak</button></form>}
    </> },
    phrases: { title: 'Canned lines', className: 'card', body: <PhrasesPanel phrases={phrasesSource} onChange={savePhrases} canSpeak={canTalk} onSpeak={speakPhrase} targetLanguage={targetLanguage} editing={arranging || !active} /> },
    transcript: { label: 'Live transcript', className: 'captions-panel demo-transcript-panel', body: <>
<header className="panel-header"><div><h2>Live transcript</h2><span>{languageName(currentCall?.agentLanguage || data.settings.agentLanguage)} above · {languageName(currentCall?.customerLanguage || data.settings.customerLanguage)} below</span></div><span className={`caption-state ${active ? 'live' : ''}`}><span />{active ? capture.recording ? 'Recording reply' : processing ? 'Replying' : 'Listening' : ringing ? 'Incoming call' : currentCall ? 'Saved' : 'Waiting for call'}</span></header>
      <TranscriptLog lines={transcript} call={currentCall} partial={partialCaption && partialCaption.callId === currentCall?.id ? (partialCaption.shown || partialCaption.text) : ''} partialSource={partialCaption && partialCaption.callId === currentCall?.id && partialCaption.shown ? partialCaption.text : ''} containerRef={transcriptContainer} onScroll={transcriptScroll} stamp={stamp} empty={<div className="transcript-empty"><AudioLines size={34} strokeWidth={1} /><h3>{active ? 'Your partner can speak now.' : 'The conversation appears here.'}</h3><p>{active ? `Their ${languageName(data.settings.customerLanguage)} speech appears in ${languageName(data.settings.agentLanguage)} as they speak.` : 'Share a call link and answer your partner. Follow their words here as you talk.'}</p><div className="language-chips"><span>{languageName(data.settings.customerLanguage)}</span><ArrowRight size={14} /><span>{languageName(data.settings.agentLanguage)}</span></div></div>} />
{newCaptions && <button className="button secondary latest-captions" onClick={scrollToLatest}>New captions <ChevronDown size={14} /></button>}
{currentCall?.error && <div className="call-error" role="alert">{currentCall.error}</div>}
<footer className="transcript-footer"><span><ShieldCheck size={13} />{currentCall && !active && !ringing ? 'Transcript saved automatically' : 'Transcript is saved as you talk'}</span>{data.calls.some(call => callState(call) === 'ended') && <label><span className="sr-only">Saved conversations</span><select aria-label="Saved conversations" disabled={active || ringing} value={selectedCallId} onChange={event => setSelectedCallId(event.target.value)}><option value="">New conversation</option>{data.calls.filter(call => callState(call) === 'ended').map(call => <option key={call.id} value={call.id}>{new Date(call.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</option>)}</select></label>}</footer>
    </> },
    caller: { title: 'Caller', className: 'card', body: <CallerPanel call={currentCall} calls={data.calls} onOpen={id => setSelectedCallId(id)} canOpen={!active && !ringing} /> },
    notes: { title: 'Call notes', className: 'card notes-panel', body: currentCall ? <div className="ticket-form"><label className="field"><span>Summary</span><textarea rows={3} value={ticket.issue} onChange={event => setTicket({ ...ticket, issue: event.target.value })} /></label><label className="field"><span>Address or location</span><input value={ticket.address} onChange={event => setTicket({ ...ticket, address: event.target.value })} /></label><label className="checkbox-label"><input type="checkbox" checked={!!ticket.dispatch} onChange={event => setTicket({ ...ticket, dispatch: event.target.checked })} /><span>A dispatch is needed</span></label><button className="button secondary" disabled={!!busy} onClick={() => action('ticket', async () => { const result = await api.ticket(currentCall.id, ticket); setNotice('Call notes saved.'); return result; })}><Check size={15} />Save notes</button>{ticket.dispatch && <button className="button secondary" disabled={!!busy || !!currentCall.ticket?.dispatchConfirmedAt} onClick={() => action('dispatch', () => api.ticket(currentCall.id, { ...ticket, confirmDispatch: true }))}>{currentCall.ticket?.dispatchConfirmedAt ? 'Dispatch confirmed' : 'Confirm dispatch'}</button>}</div> : <p className="panel-empty">Notes open with the next call and are saved with its transcript.</p> },
    queue: { title: 'Queue', className: 'card', actions: ringingCalls.length ? <span className="subtle-tag">{ringingCalls.length} waiting</span> : null, body: <QueuePanel calls={ringingCalls} needsSeat={needsSeat} busy={!!busy} blocked={active} onAnswer={call => action('answer', () => api.answer(call.id))} stamp={stamp} /> },
    agents: { title: 'Agents', className: 'card', body: <AgentsPanel agents={data.floor?.agents || []} me={data.agentId} /> },
  };
  const renderColumn = column => visible(column).map((id, index, list) => { const item = renderers[id]; return <DeskPanel key={id} id={id} title={item.title} label={item.label} className={item.className || ''} actions={item.actions} arranging={arranging} column={column} index={index} count={list.length} onMove={movePanelTo} onHide={hidePanel} onDrop={dropPanel}>{item.body}</DeskPanel>; });
  const queueVisible = visible('side').includes('queue') || visible('main').includes('queue');
  return <div className={`page desk-page demo-desk ${active || ringing ? 'has-call' : ''} ${arranging ? 'is-arranging' : ''}`}>
<header className="demo-desk-heading"><div><span className="eyebrow">NOTEFISH · LIVE VOICE TRANSLATION</span><h1>One call. Two languages.</h1></div><div className="demo-heading-actions"><span className={`desk-connection ${connection === 'connected' ? 'connected' : ''}`}><span />{connection === 'connected' ? 'Connected' : 'Reconnecting…'}</span><button className="button secondary compact" aria-pressed={arranging} onClick={() => setArranging(!arranging)}><LayoutPanelLeft size={15} />{arranging ? 'Done arranging' : 'Arrange'}</button><button className="button secondary compact" aria-pressed={focusDesk} onClick={() => setFocusDesk(!focusDesk)}>{focusDesk ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{focusDesk ? 'Exit focus' : 'Focus view'}</button></div></header>
    {arranging && <ArrangeBar layout={layout} floor={hasFloor} seatName={seat?.name} onPreset={key => applyLayout(normalizeLayout(PRESETS[key]))} onReset={() => applyLayout(normalizeLayout(DEFAULT_LAYOUT))} onDone={() => setArranging(false)} />}
    {hasFloor && !queueVisible && (needsSeat || ringingCalls.length > 0) && <section className="queue-strip" aria-label="Calls waiting">
      {needsSeat
        ? <p className="queue-empty"><Users size={15} />Choose your name in the sidebar to answer calls.</p>
        : ringingCalls.map(call => <div className="queue-item" key={call.id}>
          <span className="queue-position"><PhoneCall size={15} /></span>
          <div><strong>{call.from || 'Caller'}</strong><span>{call.transport === 'twilio' ? 'Phone' : 'Browser'} · since {stamp(call.startedAt)}</span></div>
          <button className="button answer compact" disabled={!!busy || (active && currentCall?.id !== call.id)} onClick={() => action('answer', () => api.answer(call.id))}>Answer</button>
        </div>)}
    </section>}
    <div className="demo-call-grid">
      <div className={`demo-call-controls desk-column ${arranging ? 'is-arranging' : ''}`} ref={sideColumn}>{renderColumn('side')}{arranging && !visible('side').length && <div className="drop-slot">Drop a panel here</div>}</div>
      <div className={`desk-main desk-column ${arranging ? 'is-arranging' : ''}`} ref={mainColumn}>{renderColumn('main')}{arranging && !visible('main').length && <div className="drop-slot">Drop a panel here</div>}</div>
    </div>
    {arranging && <HiddenTray ids={visible('hidden')} onShow={showPanel} trayRef={hiddenTray} />}
  </div>;
}

function Setup({ data, setError, setNotice, saveSettings, reload, navigate, roster, refreshFloor, multiAgent }) {
  const [refreshing, setRefreshing] = useState(false);
  const [deliveries, setDeliveries] = useState(null);
  useEffect(() => { api.integrations().then(setDeliveries).catch(() => setDeliveries(null)); }, []);
  const [queueName, setQueueName] = useState(data.settings.queueName || 'Main line');
  const [saving, setSaving] = useState(false);
  const setup = data.setup || {};
  const readyVoices = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice));
  const webhook = setup.webhookUrl || '';
  const blockers = setup.blockers || setup.missing || [];
  const copy = async value => { try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); } catch { setError('Clipboard access is unavailable. Select and copy the address manually.'); } };
  const services = [{ id: 'fish', title: 'Fish Audio', description: 'Your cloned voice', icon: AudioLines }, { id: 'openai', title: 'OpenAI', description: 'Captions & translation', icon: Sparkles }, { id: 'twilio', title: 'Twilio · Optional', description: 'Regular phone number calls', icon: Phone }];
  // One list that says what is still missing, in the order it has to be fixed.
  const checklist = [
    { done: setup.providers?.fish?.configured && setup.providers?.openai?.configured, label: 'Provider keys are set', hint: 'Set FISH_API_KEY and OPENAI_API_KEY in the server environment.' },
    { done: setup.audioAvailable, label: 'Audio conversion is available', hint: 'Install ffmpeg on the server.' },
    { done: readyVoices.length > 0, label: 'A voice is ready to speak', hint: 'Record one under Create voice, or import a licensed voice.', action: { label: 'Create voice', path: '/enroll' } },
    { done: Boolean(data.settings.voiceId), label: 'A voice is selected for the line', hint: 'Choose the voice this line answers in, below.' },
    { done: Boolean(setup.publicUrl), label: 'A public HTTPS address is set', hint: 'Set PUBLIC_BASE_URL so a phone can reach this desk.' },
    { done: Boolean(setup.phoneNumber), label: 'A phone number is connected', hint: 'Optional. Browser calls work without one.', optional: true },
  ];
  const remaining = checklist.filter(item => !item.done && !item.optional).length;
  return <div className="page setup-page"><div className="page-heading horizontal"><div><span className="eyebrow">FROM YOUR BROWSER TO THEIR PHONE</span><h1>Make the connection.</h1><p>Start with a browser call. Add a phone number when you need one.</p></div><button className="button secondary" disabled={refreshing} onClick={async () => { setRefreshing(true); await reload(); setRefreshing(false); }}><RefreshCw className={refreshing ? 'spin' : ''} size={15} />Refresh status</button></div><section className="browser-invite-panel"><div className="browser-invite-header"><span className="browser-invite-icon"><Smartphone size={21} /></span><div><h2>Your demo starts with a call link.</h2><p>Choose a ready voice at the desk, create a link, then open it on another phone. The caller taps Call, you answer, and the conversation begins.</p></div><button className="button primary" onClick={() => navigate('/desk')}>Open call desk <ArrowRight size={15} /></button></div><p className="browser-invite-note">Fish Audio provides your voice. OpenAI transcribes and translates. <span>Twilio is optional for this browser demo.</span></p></section><div className="provider-grid">{services.map(service => <article className="provider-card" key={service.id}><div className="provider-icon"><service.icon size={21} strokeWidth={1.5} /></div><div><h3>{service.title}</h3><p>{service.description}</p></div><span className={`provider-status ${setup.providers?.[service.id]?.configured ? 'configured' : ''}`}><span />{setup.providers?.[service.id]?.configured ? 'Configured' : 'Setup needed'}</span></article>)}</div><p className="provider-note">Configured means credentials are present. Test a real browser conversation from the desk. The optional setup below adds ordinary phone-number calling.</p>
    <div className="setup-layout"><div className="setup-steps">
      <section className="setup-step checklist-step"><div className="step-heading"><span>{remaining ? remaining : '✓'}</span><div><h2>{remaining ? 'Before your first call' : 'Ready for a call'}</h2><p>{remaining ? `${remaining} thing${remaining > 1 ? 's' : ''} left to set up.` : 'Everything needed for a call is in place.'}</p></div></div>
        <ul className="setup-checklist">{checklist.map(item => <li key={item.label} className={item.done ? 'done' : item.optional ? 'optional' : 'todo'}>
          <span className="check">{item.done ? <Check size={14} /> : <span className="dot" />}</span>
          <div><strong>{item.label}{item.optional && !item.done && <span className="chip">Optional</span>}</strong>{!item.done && <span>{item.hint}</span>}</div>
          {!item.done && item.action && <button className="text-button" onClick={() => navigate(item.action.path)}>{item.action.label} <ArrowRight size={13} /></button>}
        </li>)}</ul>
      </section>
      <section className="setup-step"><div className="step-heading"><span>01</span><div><h2>Choose your incoming number</h2><p>Customers call this number from their own phone.</p></div></div><div className="phone-number-display"><Phone size={19} /><div><span>Twilio phone number</span><strong>{setup.phoneNumber || 'No number connected yet'}</strong></div>{setup.phoneNumber && <button className="icon-button" aria-label="Copy phone number" onClick={() => copy(setup.phoneNumber)}><Copy size={16} /></button>}</div><p className="setup-instruction">Use a voice-capable Twilio number. In the Twilio Console, open <strong>Phone Numbers → Manage → Active numbers</strong> and choose the number you want to use.</p><a className="text-button" href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noreferrer">Open Twilio Console <ExternalLink size={13} /></a></section>
      <section className="setup-step"><div className="step-heading"><span>02</span><div><h2>Point the number to your desk</h2><p>Tell Twilio where incoming calls should go.</p></div></div><label className="field"><span>When a call comes in <span className="method-badge">HTTP POST</span></span><div className="copy-field"><input readOnly value={webhook} placeholder="Your public webhook will appear here" aria-label="Incoming call webhook URL" /><button className="icon-button" aria-label="Copy incoming webhook" disabled={!webhook} onClick={() => copy(webhook)}><Copy size={16} /></button></div></label><p className="setup-instruction">Under the number’s <strong>Voice configuration</strong>, set “A call comes in” to <strong>Webhook</strong>, paste this address, choose <strong>HTTP POST</strong>, then save.</p>{!webhook && <div className="info-box"><Globe2 size={17} /><span>The website needs a public HTTPS address so Twilio can reach it. This address appears after deployment is configured.</span></div>}<div className="waiting-note"><CircleHelp size={14} /><p>Twilio opens the phone connection before you click Answer. The customer waits on the line until you answer at the desk.</p></div></section>
      <section className="setup-step"><div className="step-heading"><span>03</span><div><h2>Set your conversation defaults</h2><p>Choose a voice and the languages for your line.</p></div></div><div className="form-stack"><label className="field"><span>Line name</span><input value={queueName} maxLength={100} onChange={event => setQueueName(event.target.value)} onBlur={async () => { if (queueName !== data.settings.queueName && queueName.trim()) { setSaving(true); await saveSettings({ queueName: queueName.trim() }); setSaving(false); } }} /></label><label className="field"><span>House style <small>optional</small></span><textarea rows={2} maxLength={300} defaultValue={data.settings.persona || ''} placeholder="Brief and friendly. Formal “vous”. Never promise a time you can’t keep." onBlur={event => { if ((event.target.value || '').trim() !== (data.settings.persona || '')) saveSettings({ persona: event.target.value }); }} /></label><p className="field-help">Shapes how replies are worded before they are spoken — length, politeness, phrasing. Facts and meaning never change.</p><label className="field"><span>Default voice</span><div className="select-wrap"><AudioLines size={15} /><select value={data.settings.voiceId || ''} onChange={event => saveSettings({ voiceId: event.target.value || null })}><option value="">Select a ready voice</option>{readyVoices.map(voice => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select><ChevronDown size={14} /></div></label><div className="two-fields"><LanguageSelect label="Agent language" value={data.settings.agentLanguage} onChange={agentLanguage => saveSettings({ agentLanguage })} /><LanguageSelect label="Caller language" value={data.settings.customerLanguage} onChange={customerLanguage => saveSettings({ customerLanguage })}  allowAuto /></div><p className="field-help">Changes save automatically{saving ? '…' : '.'} Preview your voice in the caller’s language before the first call.</p></div></section>
      <section className="setup-step"><div className="step-heading"><span>04</span><div><h2>Put agents on the floor</h2><p>Leave this empty to run one desk. Add names to share a queue.</p></div></div>
        <Roster data={data} roster={roster || []} setError={setError} setNotice={setNotice} refreshFloor={refreshFloor} multiAgent={multiAgent} />
      </section>
      <section className="setup-step"><div className="step-heading"><span>05</span><div><h2>Send finished calls onward</h2><p>A completed call can leave as a ticket. NoteFish never becomes the system of record.</p></div></div>
        <div className="integration-rows">
          <div className="integration-row"><div><strong>Signed webhook</strong><span>{setup.integrations?.webhook?.configured ? setup.integrations.webhook.url : 'Set NOTEFISH_WEBHOOK_URL and NOTEFISH_WEBHOOK_SECRET.'}</span></div><span className={`status-pill ${setup.integrations?.webhook?.configured ? 'ready' : 'archived'}`}><span />{setup.integrations?.webhook?.configured ? 'On' : 'Off'}</span></div>
          <div className="integration-row"><div><strong>Zendesk</strong><span>{setup.integrations?.zendesk?.configured ? 'Creates a ticket for each completed call.' : 'Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL and ZENDESK_API_TOKEN.'}</span></div><span className={`status-pill ${setup.integrations?.zendesk?.configured ? 'ready' : 'archived'}`}><span />{setup.integrations?.zendesk?.configured ? 'On' : 'Off'}</span></div>
          <div className="integration-row"><div><strong>Export API</strong><span>{setup.integrations?.exportApi?.configured ? 'GET /api/export/calls with the export bearer token.' : 'Set NOTEFISH_EXPORT_TOKEN to let a system pull calls.'}</span></div><span className={`status-pill ${setup.integrations?.exportApi?.configured ? 'ready' : 'archived'}`}><span />{setup.integrations?.exportApi?.configured ? 'On' : 'Off'}</span></div>
        </div>
        {deliveries?.recent?.length > 0 && <details className="setup-blockers"><summary>Recent deliveries <ChevronDown size={13} /></summary><ul>{deliveries.recent.map((entry, index) => <li key={index}>{entry.ok ? '✓' : '✗'} {entry.adapter} · {stamp(entry.at)}{entry.error ? ` · ${entry.error}` : ''}</li>)}</ul></details>}
      </section></div>
      <aside className="demo-guide"><div className="demo-icon"><PhoneCall size={29} strokeWidth={1.3} /></div><span className="eyebrow">OPTIONAL · PHONE NUMBER CALLS</span><h3>Let’s have a<br />conversation.</h3><p>When your line is connected, try it with another person on a real phone.</p><ol><li><span>1</span>Open your call desk and enable audio.</li><li><span>2</span>Have someone dial your Twilio number.</li><li><span>3</span>Answer, then watch the caller’s translated captions appear.</li><li><span>4</span>Hold Space, speak, and release. They should hear your cloned voice in their language.</li></ol><button className="button primary full-width" onClick={() => navigate('/desk')}>Open call desk <ArrowRight size={16} /></button><div className="demo-state"><span className={setup.ready ? 'ready-dot' : ''} />{setup.ready ? 'Configuration ready for a phone test' : 'Complete setup to test your line'}</div>{blockers.length > 0 && <details className="setup-blockers"><summary>Setup details <ChevronDown size={13} /></summary><ul>{blockers.map((blocker, index) => <li key={index}>{String(blocker)}</li>)}</ul></details>}</aside></div></div>;
}
