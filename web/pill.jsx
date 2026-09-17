// The pill (Mac app). It is hidden until something is happening and then shows
// one of the companion design's call states: a call detected or ringing,
// listening, holding to speak, translating, speaking in your voice, a short
// goodbye. Hovering it shows the options: languages, the desk, hide, end.
//
// Two looks, one component. "pill" is the strip under the menu bar (Windows,
// and Macs without a notch). "notch" is the island that grows out of the
// MacBook notch, above the menu bar. Rust says which, with the notch's size.
// The window is transparent and sized to whatever is drawn.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, ChevronDown, EyeOff, Loader2, Maximize2, Monitor, Phone, PhoneOff, Volume2, X } from 'lucide-react';
import { Puff } from './shell.jsx';
import { api } from './api.js';
import { languages } from '../server/languages.mjs';
import './pill.css';

const SHOW_CAPTION = new Set(['listening', 'recording', 'thinking', 'speaking']);
const CAPTION_LIFE = 14000; // a finished line stays readable this long after it lands
const ENDED_LIFE = 5000, PEEK_LIFE = 4200, NUDGE_LIFE = 1800;
const SPRING = { type: 'spring', stiffness: 520, damping: 40, mass: .7 };
const WAVE = [8, 14, 20, 11, 17, 9];

const tauri = () => (typeof window !== 'undefined' ? window.__TAURI__ : null);
// Events, not commands: the capability already allows the page to emit, and Rust listens.
const send = (name, payload = {}) => { try { tauri()?.event?.emit?.(name, payload); } catch { /* not in the app */ } };
const code = value => (value && value !== 'auto' ? value.slice(0, 2).toUpperCase() : '··');
const clock = seconds => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

function Wave() { return <span className="wave" aria-hidden="true">{WAVE.map((h, i) => <i key={i} style={{ '--h': `${h}px`, '--d': `${i * .1}s` }} />)}</span>; }
function LanguageSel({ label, value, allowAuto = false, disabled, onChange }) {
  return <><span className="lab">{label}</span><span className="sel"><select aria-label={label} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}>{allowAuto && <option value="auto">Detect automatically</option>}{languages.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select><ChevronDown size={12} /></span></>;
}

export default function PillEntry() {
  const [calls, setCalls] = useState([]);
  const [floor, setFloor] = useState({ agents: [], agentId: '' }); // who this desk answers as, if a roster exists
  const [connection, setConnection] = useState('connecting');
  const [holding, setHolding] = useState(false);
  const [partial, setPartial] = useState(null);
  const [peekAt, setPeekAt] = useState(0);
  const [nudgeAt, setNudgeAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState('');
  const [hover, setHover] = useState(false);
  const [dismissed, setDismissed] = useState(''); // the call whose pill was hidden by hand
  // ?look=notch previews the island in a plain browser; in the app Rust decides.
  const [mode, setMode] = useState(() => ({ kind: new URLSearchParams(location.search).get('look') === 'notch' ? 'notch' : 'pill', notch: 220, bar: 38 }));
  const reduced = useReducedMotion();
  const root = useRef(null);
  const applied = useRef(null);
  const shrink = useRef(0);
  const playingSince = useRef(0);

  useEffect(() => { document.documentElement.classList.add('pill-page'); return () => document.documentElement.classList.remove('pill-page'); }, []);
  // Nobody can open a console on the app's pill, so it tells the local server when it breaks.
  useEffect(() => {
    const report = line => { try { fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line }) }); } catch { /* best effort */ } };
    const onError = event => report(`error: ${event.message} @ ${event.filename}:${event.lineno}`);
    const onRejection = event => report(`rejection: ${event.reason?.message || event.reason}`);
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    report(`mounted · tauri=${!!tauri()} · ${navigator.userAgent.slice(0, 60)}`);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);

  // the desk's own socket: the same events the desk window listens to
  useEffect(() => {
    let socket, timer, closed = false;
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/desk`);
      socket.onopen = () => setConnection('connected');
      socket.onmessage = event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'snapshot') { setCalls(message.calls || []); setFloor(current => ({ agents: message.agents || current.agents, agentId: message.agentId === undefined ? current.agentId : message.agentId })); }
        if (message.type === 'call' && message.call) setCalls(current => [message.call, ...current.filter(call => call.id !== message.call.id)]);
        if (message.type === 'caption-partial') setPartial(message.text ? { callId: message.callId, text: message.text, shown: message.shown || '' } : null);
      };
      socket.onclose = () => { setConnection('reconnecting'); if (!closed) timer = setTimeout(connect, 2000); };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => { closed = true; clearTimeout(timer); socket?.close(); };
  }, []);

  // ⌥Space anywhere, the tray's "Show the pill", and which look this Mac gets
  useEffect(() => {
    const events = tauri()?.event;
    if (!events?.listen) return;
    const offs = [];
    events.listen('ptt', event => setHolding(!!event.payload)).then(off => offs.push(off));
    events.listen('pill-peek', () => { setPeekAt(Date.now()); setDismissed(''); }).then(off => offs.push(off));
    // Rust watches the cursor for us: a panel that is never key gets no hover from WebKit.
    events.listen('pill-hover', event => setHover(!!event.payload)).then(off => offs.push(off));
    // Ask which look this Mac gets only once we can hear the answer, and ask again if it is slow.
    let known = false; const timers = [];
    events.listen('pill-mode', event => { if (event.payload?.kind) { known = true; setMode(event.payload); } }).then(off => { offs.push(off); send('pill-hello'); [1200, 3000].forEach(ms => timers.push(setTimeout(() => { if (!known) send('pill-hello'); }, ms))); });
    return () => { offs.forEach(off => off()); timers.forEach(clearTimeout); };
  }, []);

  const needsSeat = floor.agents.some(agent => !agent.archived) && !floor.agentId;
  const live = calls.find(call => call.state === 'in_call');
  const ringing = calls.find(call => call.state === 'ringing');
  const ended = !live && !ringing ? calls.filter(call => call.state === 'ended' && call.endedAt).sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt))[0] : null;
  const endedFresh = ended && now - new Date(ended.endedAt).getTime() < ENDED_LIFE ? ended : null;
  const current = ringing || live || endedFresh || null;
  const hidden = !!dismissed && current?.id === dismissed && now - peekAt > PEEK_LIFE;
  // Holding with nothing to reply to: say so briefly instead of recording into the void.
  useEffect(() => { if (holding && !live) setNudgeAt(Date.now()); }, [holding, !!live]);

  const state = hidden ? null
    : ringing ? 'ringing'
    : live && holding ? 'recording'
    : live && live.phase === 'translating' ? 'thinking'
    : live && live.phase === 'playing' ? 'speaking'
    : live ? 'listening'
    : holding || now - nudgeAt < NUDGE_LIFE ? 'nudge'
    : endedFresh ? 'ended'
    : now - peekAt < PEEK_LIFE ? 'ready'
    : null;

  // A clock only while something is on screen; nothing ticks when the pill is away.
  useEffect(() => {
    if (!state) { setHover(false); return; }
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [!!state]);
  useEffect(() => { if (state === 'speaking') { if (!playingSince.current) playingSince.current = Date.now(); } else playingSince.current = 0; }, [state]);

  const lastLine = live?.transcript?.[live.transcript.length - 1];
  const lineAge = lastLine ? now - new Date(lastLine.t).getTime() : Infinity;
  const caption = !SHOW_CAPTION.has(state) ? null
    : partial && partial.callId === live?.id && partial.text
      ? { who: 'Caller', text: partial.shown || partial.text, sub: partial.shown ? partial.text : '', lang: code(live?.detectedLanguage || live?.customerLanguage), mine: false }
      : lastLine && lineAge < CAPTION_LIFE
        ? { who: lastLine.speaker === 'agent' ? 'You' : 'Caller',
            text: lastLine.speaker === 'agent' ? lastLine.textSource : lastLine.textShown,
            sub: lastLine.textSource !== lastLine.textShown ? (lastLine.speaker === 'agent' ? lastLine.textShown : lastLine.textSource) : '',
            lang: code(lastLine.speaker === 'agent' ? lastLine.targetLang : lastLine.sourceLang),
            mine: lastLine.speaker === 'agent' }
        : null;
  // Between a partial clearing and its finished line arriving there is one render with no
  // caption; holding the last one for half a second keeps the card from blinking.
  const [held, setHeld] = useState(null);
  useEffect(() => {
    if (caption) { setHeld(caption); return; }
    const timer = setTimeout(() => setHeld(null), 500);
    return () => clearTimeout(timer);
  }, [caption?.text, caption?.sub, caption?.who, !!caption]);
  const shown = caption || held;
  const showActions = hover && !!(ringing || live);

  // The window is exactly the box we draw. A ResizeObserver sees every change of that box
  // (a state's row swapping in, a caption landing, fonts arriving, the options on hover);
  // grow the window before the content moves and shrink it after, so nothing is clipped.
  const layout = useCallback((size, recenter, why) => { applied.current = size; send('pill-layout', { width: size.w, height: size.h, recenter, why }); }, []);
  const why = useRef(''); why.current = state ? `${state}${shown ? '+caption' : ''}${showActions ? '+actions' : ''}` : '';
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const fit = () => {
      if (!why.current) return;
      const size = { w: Math.ceil(element.offsetWidth), h: Math.ceil(element.offsetHeight) };
      const previous = applied.current;
      clearTimeout(shrink.current);
      if (!previous) layout(size, true, why.current);
      else if (size.w > previous.w || size.h > previous.h) layout(size, false, why.current);
      else if (size.w !== previous.w || size.h !== previous.h) shrink.current = setTimeout(() => layout(size, false, why.current), 300);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [layout, mode.kind]);
  useEffect(() => () => clearTimeout(shrink.current), []);
  useEffect(() => {
    if (state) { send('pill-visible', { show: true }); return; }
    applied.current = null;
    const timer = setTimeout(() => send('pill-visible', { show: false }), reduced ? 0 : 240);
    return () => clearTimeout(timer);
  }, [!!state, reduced]);

  const act = (name, work) => { setBusy(name); work().catch(() => {}).finally(() => setBusy('')); };
  const openDesk = () => send('open-desk');
  const answer = call => act('answer', async () => { await api.answer(call.id); if (call.via !== 'companion') openDesk(); });
  // Languages go to the seat when there is one (the seat's own language wins), else to the workspace.
  const setLanguage = (key, value) => act('language', () => floor.agentId ? api.editAgent(floor.agentId, { [key]: value }) : api.settings({ [key]: value }));

  const pair = live ? <span className="dim">{code(live.agentLanguage)} ← {code(live.detectedLanguage || live.customerLanguage)}</span> : null;
  const played = playingSince.current ? (Date.now() - playingSince.current) / 1000 : 0;
  const body = {
    ringing: ringing && <>
      <span className="dim2">{ringing.via === 'companion' ? <Monitor size={15} /> : <Phone size={15} />}</span>
      <b>{ringing.from || 'Caller'}</b>
      <span className="dim">{needsSeat ? 'choose your name on the desk' : ringing.via === 'companion' ? 'translate this call?' : 'incoming'}</span>
      {needsSeat ? <button type="button" className="act" onClick={openDesk}>Open desk</button> : <button type="button" className="act" disabled={!!busy} onClick={() => answer(ringing)}>{busy === 'answer' ? 'Answering…' : 'Answer'}</button>}
      <button type="button" className="act ghost icon" aria-label="Decline" disabled={!!busy} onClick={() => act('end', () => api.end(ringing.id))}><X size={14} /></button>
    </>,
    listening: <><Wave /><span>Listening</span>{pair}<kbd>hold ⌥</kbd></>,
    recording: <><span className="rec" /><span>Recording</span><Wave /><span className="dim">release to send</span></>,
    thinking: <><Loader2 className="spin" size={15} /><span>Translating</span>{pair}</>,
    speaking: <>
      <span className="dim2"><Volume2 size={15} /></span><span>Playing in your voice</span>
      <span className="bar"><i style={{ width: `${Math.min(100, played * 22)}%` }} /></span>
      <span className="dim">{clock(played)}</span>
    </>,
    ended: endedFresh && <><span className="dim2"><Check size={15} /></span><span>Call ended</span><span className="dim">{endedFresh.answeredAt ? clock((new Date(endedFresh.endedAt) - new Date(endedFresh.answeredAt)) / 1000) : 'not answered'}</span></>,
    nudge: <><span className="dim">No call to reply to</span></>,
    ready: <><span className="dim">{connection === 'connected' ? 'Ready · hold ⌥ Space to speak' : 'Connecting to your desk…'}</span></>,
  }[state];

  const enter = reduced ? {} : { initial: { opacity: 0, y: -8, scale: .96 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: { opacity: 0, y: -8, scale: .96 }, transition: SPRING };
  const drop = reduced ? {} : { initial: { opacity: 0, y: -24 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -24 }, transition: SPRING };
  const swap = reduced ? {} : { initial: { opacity: 0, y: 5 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -5 }, transition: { duration: .15 } };
  const row = <>
    <button type="button" className="mark" aria-label="Open the desk" onClick={openDesk}><Puff variant="fish" color="#F3F1EC" size={22} face={false} /></button>
    <AnimatePresence mode="wait" initial={false}><motion.span key={state} className="pillrow" {...swap}>{body}</motion.span></AnimatePresence>
  </>;
  const actions = showActions && current && <div className="acts">
    <LanguageSel label="Caller" value={current.customerLanguage || 'auto'} allowAuto disabled={!!busy} onChange={value => setLanguage('customerLanguage', value)} />
    <LanguageSel label="Captions" value={current.agentLanguage || 'en'} disabled={!!busy} onChange={value => setLanguage('agentLanguage', value)} />
    <span className="gap" />
    <button type="button" className="act ghost" onClick={openDesk}><Maximize2 size={13} />Desk</button>
    <button type="button" className="act ghost" onClick={() => setDismissed(current.id)}><EyeOff size={13} />Hide</button>
    {live && <button type="button" className="act red" disabled={!!busy} onClick={() => act('end', () => api.end(live.id))}><PhoneOff size={13} />End</button>}
  </div>;
  const captionBlock = shown && <><span className="who">{shown.who}</span><p>{shown.text}</p>{shown.sub && <p className="sub"><b>{shown.lang}</b>{shown.sub}</p>}</>;

  if (mode.kind === 'notch') {
    return <div className="notchroot" ref={root} style={{ '--notch': `${mode.notch}px`, '--bar': `${mode.bar}px` }} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <AnimatePresence initial={false}>
        {state && <motion.div key="island" className={`island is-${state}`} layout={!reduced} {...drop}>
          <div className="pillrow">{row}</div>
          {shown && <div className={`ic ${shown.mine ? 'mine' : ''}`} role="status">{captionBlock}</div>}
          {actions}
        </motion.div>}
      </AnimatePresence>
    </div>;
  }
  return <div className="pillroot" ref={root} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
    <AnimatePresence initial={false}>
      {shown && <motion.div key="caption" className={`pillcap ${shown.mine ? 'mine' : ''}`} role="status" {...enter}>{captionBlock}</motion.div>}
    </AnimatePresence>
    <AnimatePresence initial={false}>
      {state && <motion.div key="pill" className={`pill is-${state}`} layout={!reduced} {...enter}>{row}</motion.div>}
    </AnimatePresence>
    <AnimatePresence initial={false}>
      {actions && <motion.div key="acts" className="pillacts" {...enter}>{actions}</motion.div>}
    </AnimatePresence>
  </div>;
}
