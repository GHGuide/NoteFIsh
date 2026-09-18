// NoteFish's workspace in the companion design: a sidebar, an inset sheet, and
// the pages inside it. State (calls, settings, the desk socket) lives here and
// flows to every page as `common`; web/pages/* draw the sheets.
//
// One desk. There was a roster of seats on top of this once, and a person had to
// choose a name before any call would ring them; what they switch between now is
// their own voices.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Bell, CheckCircle2, ChevronDown, Maximize2, Menu, PanelLeft, PhoneCall, X } from 'lucide-react';
import { api } from './api.js';
import { mergeTrainingStatus, monitorVoiceTraining } from './voice-training.js';
import { CallerAudio } from './audio.js';
import { DEFAULT_SETTINGS, callState } from './lib.jsx';
import { Avatar, LogoMark } from './shell.jsx';
import { UiProvider, RouteTransition } from './components/ui.jsx';
import { ConfirmProvider } from './components/confirm.jsx';
import TopBar from './components/topbar.jsx';
import VoiceMenu from './components/voice-menu.jsx';
import Caller from './Caller.jsx';
import PillEntry from './pill.jsx';
import DeskPage from './pages/desk.jsx';
import CallsPage from './pages/calls.jsx';
import InsightsPage from './pages/insights.jsx';
import GlossaryPage from './pages/glossary.jsx';
import PhrasesPage from './pages/phrases.jsx';
import VoicePage from './pages/voice.jsx';
import SettingsModal from './pages/settings.jsx';
import FreeMonth from './pages/free.jsx';
import AuthPage from './pages/auth.jsx';
import Onboarding, { PAUSE_KEY } from './pages/onboarding.jsx';
import { Mic, Disc, BarChart3, BookOpen, Quote, Gift, Settings, CircleHelp } from 'lucide-react';

const HELP_URL = 'https://github.com/GHGuide/NoteFish#readme';
const NAV = [
  { path: '/desk', label: 'Desk', icon: Mic },
  { path: '/calls', label: 'Calls', icon: Disc },
  { path: '/insights', label: 'Insights', icon: BarChart3 },
  { path: '/glossary', label: 'Glossary', icon: BookOpen },
  { path: '/phrases', label: 'Phrases', icon: Quote },
  { path: '/voice', label: 'Voice', icon: AudioLines },
];
// Older links keep working: the library and the recorder are tabs of Voice, Setup is Settings.
// Pages whose content is a grid, not prose: they get the wider column.
const WIDE = new Set(['/insights', '/desk']);
const ALIASES = { '/': '/desk', '/voices': '/voice?tab=library', '/enroll': '/voice?tab=takes', '/admin': '/settings' };

export default function App() {
  // The public caller surface never initializes authenticated workspace hooks,
  // loads voices/settings/tickets, or opens the desk WebSocket.
  const path = location.pathname.replace(/\/+$/, '');
  return <UiProvider>{path === '/caller' ? <CallerEntry /> : path === '/pill' ? <PillEntry /> : <Gate />}</UiProvider>;
}

/** Nobody signed in: the sign-in screen. The first person to arrive claims the desk,
 *  and from then on it is theirs; signing out again is not offered. */
function Gate() {
  const [me, setMe] = useState(null); // { user, users }
  useEffect(() => { api.me().then(setMe).catch(() => setMe({ user: null, users: 0 })); }, []);
  // Skipping is a local convenience: the server's loopback bypass already opens the API here.
  const [skipped, setSkipped] = useState(() => { try { return localStorage.getItem('notefish.skipAuth') === '1'; } catch { return false; } });
  const skip = value => { setSkipped(value); try { value ? localStorage.setItem('notefish.skipAuth', '1') : localStorage.removeItem('notefish.skipAuth'); } catch { /* fine */ } };
  if (!me) return null;
  if (!me.user && !(skipped && me.local)) return <AuthPage users={me.users} open={me.open !== false} local={me.local} onSignedIn={user => setMe({ ...me, user })} onSkip={() => skip(true)} />;
  // Signed in once and that is the end of it: there is no way back out of the desk.
  return <ConfirmProvider><WorkspaceApp user={me.user} /></ConfirmProvider>;
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

/** One broken component used to take the whole desk with it: a bad render threw,
 *  React unmounted everything, and the window went white with a live call on it.
 *  Now the page says so and the rest of the desk keeps working. */
class PageBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: null }; }
  static getDerivedStateFromError(error) { return { failed: error }; }
  componentDidCatch(error) { try { api.report?.(`desk page failed: ${error?.message || error}`); } catch { /* reporting is best effort */ } }
  componentDidUpdate(previous) { if (previous.route !== this.props.route && this.state.failed) this.setState({ failed: null }); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="ds-broken" role="alert">
      <h2>This page stopped working.</h2>
      <p>The rest of the desk is fine, and a call in progress is unaffected. Move to another page, or reload to come back to this one.</p>
      <button type="button" onClick={() => this.setState({ failed: null })}>Try this page again</button>
    </div>;
  }
}

function WorkspaceApp({ user }) {
  const role = user?.role || 'admin'; // no account means this desk is yours
  const [route, setRoute] = useState(location.pathname + location.search);
  const [mobileNav, setMobileNav] = useState(false);
  const [focus, setFocus] = useState(false);
  const [free, setFree] = useState(false);
  const [invitation, setInvitation] = useState(null);
  const [data, setData] = useState({ voices: [], settings: DEFAULT_SETTINGS, calls: [], setup: null, session: null });
  const [partialCaption, setPartialCaption] = useState(null); // what the caller is saying right now, before the phrase lands
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connection, setConnection] = useState('connecting');
  const [audioReady, setAudioReady] = useState(false);
  const [trainingNotes, setTrainingNotes] = useState({});
  const latestData = useRef(data);
  latestData.current = data;
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
    let socket, timer, disposed = false;
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/desk`);
      socket.onopen = () => setConnection('connected');
      socket.onmessage = event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'snapshot') setData(current => ({
          ...current, calls: message.calls || current.calls,
          settings: message.settings ? { ...current.settings, ...message.settings } : current.settings,
        }));
        if (message.type === 'caption-partial') setPartialCaption(message.text ? { callId: message.callId, text: message.text, shown: message.shown || '' } : null);
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
  // Your voices, which is what you switch between. A voice still training cannot
  // answer a call, so it is not offered as one you can switch to.
  const voices = (data.voices || []).filter(voice => !voice.archived && voice.status === 'ready' && voice.usable !== false);
  const voice = voices.find(item => item.id === data.settings.voiceId) || null;
  const useVoice = id => { if (id && id !== data.settings.voiceId) saveSettings({ voiceId: id }); };
  // Everything a person owns lives on the desk now, so saving one is saving the other.
  // `saveOwned` and `owned` stay as names the pages already use.
  const saveOwned = saveSettings;
  const owned = key => data.settings[key];
  const common = { user, role, data, navigate, route: parsed, loading, error, setError, setNotice, saveSettings, saveOwned, owned, refreshVoices, updateCall, sharedDemo, trainingNotes, voice, voices, useVoice, partialCaption, connection, invitation, setInvitation, audioReady, enableAudio, clearAudio: () => player.current.clear(), setAudioMuted: muted => { player.current.muted = muted; if (muted) player.current.clear(); }, reload, focus, setFocus, openFree: () => setFree(true) };
  // First run: setup until it is finished, unless paused to go record a voice.
  const [setupPaused, setSetupPaused] = useState(() => { try { return sessionStorage.getItem(PAUSE_KEY) === '1'; } catch { return false; } });
  // Whoever just signed in, admin or agent, until they have finished their own setup.
  const needsSetup = !loading && !owned('onboardedAt') && !sharedDemo;
  const resumeSetup = () => { try { sessionStorage.removeItem(PAUSE_KEY); } catch { /* fine */ } setSetupPaused(false); navigate('/desk'); };
  if (needsSetup && !setupPaused) return <Onboarding {...common} onDone={() => { try { setSetupPaused(sessionStorage.getItem(PAUSE_KEY) === '1'); } catch { /* fine */ } }} />;
  const PAGES = { '/desk': DeskPage, '/calls': CallsPage, '/insights': InsightsPage, '/glossary': GlossaryPage, '/phrases': PhrasesPage, '/voice': VoicePage };
  // Settings opens over whatever you were reading rather than taking its place, so
  // closing it puts you back where you were instead of on some default page.
  const settingsOpen = parsed.path === '/settings';
  const behind = useRef('/desk');
  if (!settingsOpen) behind.current = parsed.path;
  const shown = settingsOpen ? { ...parsed, path: behind.current, query: {} } : parsed;
  const Page = PAGES[shown.path] || DeskPage;
  return <div className={`ds-app ${focus ? 'is-focus' : ''}`}>
    <button type="button" className="ds-tool ds-toggle" aria-label="Open navigation" aria-expanded={mobileNav} onClick={() => setMobileNav(true)}><Menu size={18} /></button>
    <aside className={`ds-side ${mobileNav ? 'is-open' : ''}`} id="workspace-sidebar">
      <a className="ds-lockup" href="/desk" onClick={event => { event.preventDefault(); navigate('/desk'); }} aria-label="NoteFish desk"><LogoMark size={22} /><span>NoteFish<span className="dot">.</span></span></a>
      {/* Who the caller hears, and where you change it. On this desk that is who you are,
          so it sits where a name would. */}
      <VoiceMenu
        voice={voice} voices={voices} connection={connection} sharedDemo={sharedDemo}
        onPick={useVoice} onRecord={() => navigate('/voice?tab=takes')}
      />
      <nav className="ds-nav" aria-label="Main navigation">{NAV.map(item => <a href={item.path} key={item.path} className={parsed.path === item.path ? 'active' : ''} aria-current={parsed.path === item.path ? 'page' : undefined} onClick={event => { event.preventDefault(); navigate(item.path); }}><item.icon size={18} strokeWidth={1.7} />{item.label}{item.path === '/desk' && incoming && <span className="ring" aria-label="Incoming call" />}</a>)}</nav>
      <nav className="ds-nav bottom" aria-label="More">
        <button type="button" onClick={() => setFree(true)}><Gift size={18} strokeWidth={1.7} />Get a free month</button>
        {role === 'admin' && <a href="/settings" className={settingsOpen ? 'active' : ''} onClick={event => { event.preventDefault(); navigate('/settings'); }}><Settings size={18} strokeWidth={1.7} />Settings</a>}
        <a href={HELP_URL} target="_blank" rel="noreferrer"><CircleHelp size={18} strokeWidth={1.7} />Help</a>
        <div className="ds-side-foot" title={user?.email || ''}><i className={connection === 'connected' ? 'connected' : ''} />{connection === 'connected' ? 'Desk connected' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</div>
      </nav>
    </aside>
    {mobileNav && <button className="ds-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <button type="button" className="ds-collapse" aria-label={focus ? 'Show the sidebar' : 'Hide the sidebar'} aria-pressed={focus} onClick={() => setFocus(!focus)}><PanelLeft size={17} strokeWidth={1.7} /></button>
    <div className="ds-topbar" data-tauri-drag-region="true">
      <TopBar user={user} data={data} voice={voice} connection={connection} navigate={navigate} openFree={() => setFree(true)} />
    </div>
    {needsSetup && setupPaused && !incoming && <div className="ds-banner" role="status"><span>Setup is paused.</span><button type="button" onClick={resumeSetup}>Continue setup</button></div>}
    {incoming && parsed.path !== '/desk' && <div className="ds-banner" role="status"><PhoneCall size={15} /><span>Incoming call from <b>{incoming.from || 'a caller'}</b></span><button type="button" onClick={() => navigate('/desk')}>Go to desk</button></div>}
    {error && <div className="ds-banner error" role="alert"><span>{error}</span><button type="button" className="x" aria-label="Dismiss" onClick={() => setError('')}><X size={14} /></button></div>}
    <section className={`ds-sheet ${WIDE.has(shown.path) ? 'is-wide' : ''}`}><RouteTransition route={shown.path + (shown.params.id || '')}><PageBoundary route={shown.path + (shown.params.id || '')}><Page {...common} route={shown} /></PageBoundary></RouteTransition></section>
    {settingsOpen && <SettingsModal {...common} onClose={() => navigate(behind.current)} />}
    {free && <FreeMonth onClose={() => setFree(false)} name={user?.name || voice?.name || ''} setNotice={setNotice} />}
    {notice && <div className="ds-toast" role="status"><CheckCircle2 size={15} />{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={13} /></button></div>}
  </div>;
}
