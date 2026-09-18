// NoteFish's workspace in the companion design: a sidebar, an inset sheet, and
// the pages inside it. State (calls, settings, the desk socket, seats) lives
// here and flows to every page as `common`; web/pages/* draw the sheets.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Bell, CheckCircle2, ChevronDown, LogOut, Maximize2, Menu, PanelLeft, PhoneCall, X } from 'lucide-react';
import { api } from './api.js';
import { mergeTrainingStatus, monitorVoiceTraining } from './voice-training.js';
import { CallerAudio } from './audio.js';
import { DEFAULT_SETTINGS, EMPTY_FLOOR, AGENT_STATE, callState } from './lib.jsx';
import { Avatar, LogoMark } from './shell.jsx';
import { UiProvider, RouteTransition } from './components/ui.jsx';
import Caller from './Caller.jsx';
import PillEntry from './pill.jsx';
import DeskPage from './pages/desk.jsx';
import CallsPage from './pages/calls.jsx';
import InsightsPage from './pages/insights.jsx';
import GlossaryPage from './pages/glossary.jsx';
import PhrasesPage from './pages/phrases.jsx';
import VoicePage from './pages/voice.jsx';
import FloorPage from './pages/floor.jsx';
import SettingsPage from './pages/settings.jsx';
import FreeMonth from './pages/free.jsx';
import AuthPage from './pages/auth.jsx';
import Onboarding, { PAUSE_KEY } from './pages/onboarding.jsx';
import { Mic, Disc, BarChart3, BookOpen, Quote, Users, Gift, Settings, CircleHelp } from 'lucide-react';

const HELP_URL = 'https://github.com/GHGuide/NoteFish#readme';
const NAV = [
  { path: '/desk', label: 'Desk', icon: Mic },
  { path: '/calls', label: 'Calls', icon: Disc },
  { path: '/insights', label: 'Insights', icon: BarChart3 },
  { path: '/glossary', label: 'Glossary', icon: BookOpen },
  { path: '/phrases', label: 'Phrases', icon: Quote },
  { path: '/voice', label: 'Voice', icon: AudioLines },
  { path: '/floor', label: 'Floor', icon: Users, floorOnly: true },
];
// Older links keep working: the library and the recorder are tabs of Voice, Setup is Settings.
const ALIASES = { '/': '/desk', '/voices': '/voice?tab=library', '/enroll': '/voice?tab=takes', '/admin': '/settings' };

export default function App() {
  // The public caller surface never initializes authenticated workspace hooks,
  // loads voices/settings/tickets, or opens the desk WebSocket.
  const path = location.pathname.replace(/\/+$/, '');
  return <UiProvider>{path === '/caller' ? <CallerEntry /> : path === '/pill' ? <PillEntry /> : <Gate />}</UiProvider>;
}

/** Nobody signed in: the sign-in / sign-up screen. The first person to arrive creates the desk. */
function Gate() {
  const [me, setMe] = useState(null); // { user, users }
  useEffect(() => { api.me().then(setMe).catch(() => setMe({ user: null, users: 0 })); }, []);
  // /join#token: an invitation to a seat. The page signs them up as that seat.
  const token = location.pathname.replace(/\/+$/, '') === '/join' ? location.hash.slice(1) : '';
  const [invite, setInvite] = useState(token ? undefined : null);
  useEffect(() => { if (token) api.invite(token).then(found => setInvite({ ...found, token })).catch(failure => setInvite({ token, error: failure.message })); }, [token]);
  // Skipping is a local convenience: the server's loopback bypass already opens the API here.
  const [skipped, setSkipped] = useState(() => { try { return localStorage.getItem('notefish.skipAuth') === '1'; } catch { return false; } });
  const skip = value => { setSkipped(value); try { value ? localStorage.setItem('notefish.skipAuth', '1') : localStorage.removeItem('notefish.skipAuth'); } catch { /* fine */ } };
  if (!me || invite === undefined) return null;
  if (invite && !me.user) return <AuthPage users={me.users} invite={invite} onSignedIn={user => { history.replaceState({}, '', '/desk'); setMe({ ...me, user }); }} />;
  if (!me.user && !(skipped && me.local)) return <AuthPage users={me.users} open={me.open !== false} local={me.local} onSignedIn={user => setMe({ ...me, user })} onSkip={() => skip(true)} />;
  return <WorkspaceApp user={me.user} onSignedOut={() => { skip(false); setMe({ ...me, user: null, users: Math.max(1, me.users) }); }} />;
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

/** '/calls/abc?tab=notes' → { path: '/calls', params: { id: 'abc' }, query: { tab: 'notes' } }. */
function parseRoute(route) {
  const [pathname, search = ''] = route.split('?');
  const query = Object.fromEntries(new URLSearchParams(search));
  const match = pathname.match(/^\/calls\/([^/]+)$/);
  if (match) return { path: '/calls', params: { id: decodeURIComponent(match[1]) }, query, full: route };
  const base = ALIASES[pathname] || pathname;
  if (base.includes('?')) return parseRoute(base + (search ? `&${search}` : ''));
  return { path: NAV.some(item => item.path === base) || base === '/settings' ? base : '/desk', params: {}, query, full: route };
}

function WorkspaceApp({ user, onSignedOut }) {
  const role = user?.role || 'admin'; // no account means this desk is yours
  const [route, setRoute] = useState(location.pathname + location.search);
  const [mobileNav, setMobileNav] = useState(false);
  const [focus, setFocus] = useState(false);
  const [free, setFree] = useState(false);
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
  const navigate = useCallback(path => { history.pushState({}, '', path); setRoute(path); setMobileNav(false); }, []);
  useEffect(() => { const pop = () => setRoute(location.pathname + location.search); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
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
    try { const result = await api.settings(patch); setData(current => ({ ...current, settings: { ...current.settings, ...(result.settings || result) } })); return true; }
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
  const parsed = parseRoute(route);
  const sharedDemo = data.setup?.access?.mode === 'shared-demo';
  const multiAgent = data.setup?.floor?.multiAgent !== false;
  const roster = (data.agents || []).filter(agent => !agent.archived);
  // The floor only appears once someone actually adds agents, so a one-person
  // deployment never has to think about seats.
  const hasFloor = multiAgent && roster.length > 0;
  const seat = roster.find(agent => agent.id === data.agentId) || null;
  const mine = data.floor?.agents?.find(agent => agent.id === seat?.id);
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
  // Things an agent owns: with a seat they live on the agent, on a single desk on the workspace.
  const saveOwned = async patch => { try { if (seat) { await api.editAgent(seat.id, patch); await refreshFloor(); } else await saveSettings(patch); return true; } catch (failure) { setError(failure.message); return false; } };
  const owned = key => (seat ? seat[key] : data.settings[key]);
  const [seatBusy, setSeatBusy] = useState(false);
  const takeSeat = id => { if (!id) return; setSeatBusy(true); seatActions.take(id).catch(failure => setError(failure.message)).finally(() => setSeatBusy(false)); };
  const common = { user, role, data, navigate, route: parsed, loading, error, setError, setNotice, saveSettings, saveOwned, owned, refreshVoices, updateCall, sharedDemo, trainingNotes, multiAgent, hasFloor, roster, seat, seatActions, refreshFloor, partialCaption, connection, invitation, setInvitation, audioReady, enableAudio, clearAudio: () => player.current.clear(), setAudioMuted: muted => { player.current.muted = muted; if (muted) player.current.clear(); }, reload, focus, setFocus, openFree: () => setFree(true) };
  // First run: setup until it is finished, unless paused to go record a voice.
  const [setupPaused, setSetupPaused] = useState(() => { try { return sessionStorage.getItem(PAUSE_KEY) === '1'; } catch { return false; } });
  // Whoever just signed in, admin or agent, until they have finished their own setup.
  const needsSetup = !loading && !owned('onboardedAt') && !sharedDemo;
  const resumeSetup = () => { try { sessionStorage.removeItem(PAUSE_KEY); } catch { /* fine */ } setSetupPaused(false); navigate('/desk'); };
  if (needsSetup && !setupPaused) return <Onboarding {...common} onDone={() => { try { setSetupPaused(sessionStorage.getItem(PAUSE_KEY) === '1'); } catch { /* fine */ } }} />;
  const Page = { '/desk': DeskPage, '/calls': CallsPage, '/insights': InsightsPage, '/glossary': GlossaryPage, '/phrases': PhrasesPage, '/voice': VoicePage, '/floor': FloorPage, '/settings': SettingsPage }[parsed.path] || DeskPage;
  const seatState = !seat ? null : mine?.state === 'on_call' ? ['On a call', 'amber'] : mine?.paused ? [mine.pauseReason ? `Paused · ${mine.pauseReason}` : 'Paused', 'muted'] : ['On the floor', ''];
  return <div className={`ds-app ${focus ? 'is-focus' : ''}`}>
    <button type="button" className="ds-tool ds-toggle" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(true)}><Menu size={18} /></button>
    <aside className={`ds-side ${mobileNav ? 'is-open' : ''}`} id="workspace-sidebar">
      <a className="ds-lockup" href="/desk" onClick={event => { event.preventDefault(); navigate('/desk'); }} aria-label="NoteFish desk"><LogoMark size={22} /><span>NoteFish<span className="dot">.</span></span></a>
      <div className="ds-identity" aria-label={seat ? 'Your seat' : hasFloor ? 'Answering as' : 'Workspace'}>
        {seat ? <><Avatar who={seat} size={26} /><div><strong>{seat.name}</strong><span className={`state ${seatState[1]}`}><i />{seatState[0]}</span></div>{mine?.state !== 'on_call' && <button type="button" className="leave" disabled={seatBusy} onClick={() => { setSeatBusy(true); seatActions.leave().catch(failure => setError(failure.message)).finally(() => setSeatBusy(false)); }}>Sign out</button>}</>
          : hasFloor ? <div><span className="ds-label" style={{ display: 'block', marginBottom: 4 }}>Answering as</span><select aria-label="Your name on the roster" value="" disabled={seatBusy} onChange={event => takeSeat(event.target.value)}><option value="">Choose your name…</option>{roster.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><span className="ds-identity-note">Calls ring the name you choose.</span></div>
          : <><Avatar who={{ name: 'workspace', avatar: data.settings.avatar }} size={26} /><div><strong>{sharedDemo ? 'Shared demo' : 'My workspace'}</strong><span className={`state ${connection === 'connected' ? '' : 'muted'}`}><i />{connection === 'connected' ? 'Connected' : 'Connecting…'}</span></div></>}
      </div>
      <nav className="ds-nav" aria-label="Main navigation">{NAV.filter(item => !item.floorOnly || hasFloor).map(item => <a href={item.path} key={item.path} className={parsed.path === item.path ? 'active' : ''} aria-current={parsed.path === item.path ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(item.path); }}><item.icon size={16} strokeWidth={1.7} />{item.label}{item.path === '/desk' && incoming && <span className="ring" aria-label="Incoming call" />}{item.path === '/floor' && data.floor?.waiting?.length > 0 && <span className="badge">{data.floor.waiting.length}</span>}</a>)}</nav>
      <nav className="ds-nav bottom" aria-label="More">
        <button type="button" onClick={() => setFree(true)}><Gift size={16} strokeWidth={1.7} />Get a free month</button>
        {role === 'admin' && <a href="/settings" className={parsed.path === '/settings' ? 'active' : ''} onClick={event => { event.preventDefault(); navigate('/settings'); }}><Settings size={16} strokeWidth={1.7} />Settings</a>}
        <a href={HELP_URL} target="_blank" rel="noreferrer"><CircleHelp size={16} strokeWidth={1.7} />Help</a>
        <button type="button" title={user?.email || ''} onClick={() => api.signOut().catch(() => {}).finally(onSignedOut)}><LogOut size={16} strokeWidth={1.7} />{user ? `Sign out · ${user.name.split(' ')[0]}` : 'Sign in'}</button>
        <div className="ds-side-foot"><i className={connection === 'connected' ? 'connected' : ''} />{connection === 'connected' ? 'Desk connected' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</div>
      </nav>
    </aside>
    {mobileNav && <button className="ds-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <button type="button" className="ds-collapse" aria-label={focus ? 'Show the sidebar' : 'Hide the sidebar'} aria-pressed={focus} onClick={() => setFocus(!focus)}><PanelLeft size={17} strokeWidth={1.7} /></button>
    <div className="ds-topbar" data-tauri-drag-region="true">
      <button type="button" aria-label="Settings" onClick={() => navigate('/settings')}><Avatar who={seat || { name: 'workspace', avatar: data.settings.avatar }} size={20} /></button>
    </div>
    {needsSetup && setupPaused && !incoming && <div className="ds-banner" role="status"><span>Setup is paused.</span><button type="button" onClick={resumeSetup}>Continue setup</button></div>}
    {incoming && parsed.path !== '/desk' && <div className="ds-banner" role="status"><PhoneCall size={15} /><span>Incoming call from <b>{incoming.from || 'a caller'}</b></span><button type="button" onClick={() => navigate('/desk')}>Go to desk</button></div>}
    {error && <div className="ds-banner error" role="alert"><span>{error}</span><button type="button" className="x" aria-label="Dismiss" onClick={() => setError('')}><X size={14} /></button></div>}
    <section className="ds-sheet"><RouteTransition route={parsed.path + (parsed.params.id || '')}><Page {...common} /></RouteTransition></section>
    {free && <FreeMonth onClose={() => setFree(false)} seat={seat} setNotice={setNotice} />}
    {notice && <div className="ds-toast" role="status"><CheckCircle2 size={15} />{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={13} /></button></div>}
  </div>;
}
