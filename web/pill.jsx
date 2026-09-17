// The pill under the menu bar (Mac app). It is hidden until something is
// happening and then shows one of the companion design's call states:
// a call detected or ringing, listening, holding to speak, translating,
// speaking in your voice, and a short goodbye. The window is transparent and
// sized to whatever is drawn, so this component decides how big it is.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, Loader2, Monitor, Phone, Volume2, X } from 'lucide-react';
import { Puff } from './shell.jsx';
import { api } from './api.js';
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
  const reduced = useReducedMotion();
  const root = useRef(null);
  const applied = useRef(null);
  const shrink = useRef(0);
  const playingSince = useRef(0);

  useEffect(() => { document.documentElement.classList.add('pill-page'); return () => document.documentElement.classList.remove('pill-page'); }, []);

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

  // ⌥Space anywhere, and the tray's "Show the pill"
  useEffect(() => {
    const events = tauri()?.event;
    if (!events?.listen) return;
    const offs = [];
    events.listen('ptt', event => setHolding(!!event.payload)).then(off => offs.push(off));
    events.listen('pill-peek', () => setPeekAt(Date.now())).then(off => offs.push(off));
    return () => offs.forEach(off => off());
  }, []);

  const needsSeat = floor.agents.some(agent => !agent.archived) && !floor.agentId;
  const live = calls.find(call => call.state === 'in_call');
  const ringing = calls.find(call => call.state === 'ringing');
  const ended = !live && !ringing ? calls.filter(call => call.state === 'ended' && call.endedAt).sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt))[0] : null;
  const endedFresh = ended && now - new Date(ended.endedAt).getTime() < ENDED_LIFE ? ended : null;
  // Holding with nothing to reply to: say so briefly instead of recording into the void.
  useEffect(() => { if (holding && !live) setNudgeAt(Date.now()); }, [holding, !!live]);

  const state = ringing ? 'ringing'
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
    if (!state) return;
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

  const [held, setHeld] = useState(null);
  useEffect(() => {
    if (caption) { setHeld(caption); return; }
    const timer = setTimeout(() => setHeld(null), 500);
    return () => clearTimeout(timer);
  }, [caption?.text, caption?.sub, caption?.who, !!caption]);
  const shown = caption || held;

  // The window is exactly the box we draw. Grow it before the content moves and
  // shrink it after, so the pill never clips its own animation.
  const layout = useCallback((size, recenter) => { applied.current = size; send('pill-layout', { width: size.w, height: size.h, recenter }); }, []);
  useLayoutEffect(() => {
    if (!state || !root.current) return;
    const size = { w: Math.ceil(root.current.offsetWidth), h: Math.ceil(root.current.offsetHeight) };
    const previous = applied.current;
    clearTimeout(shrink.current);
    if (!previous) layout(size, true);
    else if (size.w > previous.w || size.h > previous.h) layout(size, false);
    else if (size.w !== previous.w || size.h !== previous.h) shrink.current = setTimeout(() => layout(size, false), 300);
  }, [state, shown?.text, shown?.sub, layout]);
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

  const pair = live ? <span className="dim">{code(live.agentLanguage)} ← {code(live.detectedLanguage || live.customerLanguage)}</span> : null;
  const played = playingSince.current ? (Date.now() - playingSince.current) / 1000 : 0;
  const body = {
    ringing: ringing && <>
      <span className="dim2">{ringing.via === 'companion' ? <Monitor size={15} /> : <Phone size={15} />}</span>
      <b>{ringing.from || 'Caller'}</b>
      <span className="dim">{needsSeat ? 'choose your name on the desk' : ringing.via === 'companion' ? 'translate this call?' : 'incoming'}</span>
      {needsSeat ? <button type="button" className="act" onClick={openDesk}>Open desk</button> : <button type="button" className="act" disabled={!!busy} onClick={() => answer(ringing)}>{busy === 'answer' ? 'Answering…' : 'Answer'}</button>}
      <button type="button" className="act ghost" aria-label="Decline" disabled={!!busy} onClick={() => act('end', () => api.end(ringing.id))}><X size={14} /></button>
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
  const swap = reduced ? {} : { initial: { opacity: 0, y: 5 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -5 }, transition: { duration: .15 } };
  return <div className="pillroot" ref={root}>
    <AnimatePresence initial={false}>
      {shown && <motion.div key="caption" className={`pillcap ${shown.mine ? 'mine' : ''}`} role="status" {...enter}>
        <span className="who">{shown.who}</span>
        <p>{shown.text}</p>
        {shown.sub && <p className="sub"><b>{shown.lang}</b>{shown.sub}</p>}
      </motion.div>}
    </AnimatePresence>
    <AnimatePresence initial={false}>
      {state && <motion.div key="pill" className={`pill is-${state}`} layout={!reduced} {...enter}>
        <button type="button" className="mark" aria-label="Open the desk" onClick={openDesk}><Puff variant="fish" color="#F3F1EC" size={22} face={false} /></button>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={state} className="pillrow" {...swap}>{body}</motion.span>
        </AnimatePresence>
      </motion.div>}
    </AnimatePresence>
  </div>;
}
