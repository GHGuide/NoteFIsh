// The call desk's arrangeable panels: the wrapper every panel sits in (drag,
// hide, move), the arrange bar and hidden tray, and the panels that are new
// with layouts: Caller, Canned lines, Queue, Agents, and the measured transcript.
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useDragControls, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowLeftRight, ArrowUp, AudioLines, Check, ChevronRight, Clock, EyeOff, Globe2, GripVertical, Phone, PhoneCall, Play, Plus, RotateCcw, Trash2, Users, X } from 'lucide-react';
import { PANELS, PRESETS, presetOf } from '../server/layout.mjs';
import { languageName } from '../server/languages.mjs';
import { measureTextHeight, onFontsReady } from './text-fit.js';
import { windowOf } from './transcript-window.js';

export const panelLabel = id => PANELS.find(panel => panel.id === id)?.label || id;

/** One desk panel. Outside arrange mode it is invisible chrome; in arrange mode it
 * grows a grip to drag, arrows and a hide button (the keyboard's way to do the same). */
export function DeskPanel({ id, title, label, className = '', actions = null, arranging, column, index, count, onMove, onHide, onDrop, children }) {
  const controls = useDragControls();
  const reduced = useReducedMotion();
  const [dragging, setDragging] = useState(false);
  return <motion.section layout={!reduced} data-panel={id} aria-label={label || title} className={`desk-panel ${className} ${arranging ? 'is-arranging' : ''} ${dragging ? 'is-dragging' : ''}`}
    drag={arranging} dragControls={controls} dragListener={false} dragMomentum={false} dragSnapToOrigin dragElastic={0.15}
    onDragStart={() => setDragging(true)} onDragEnd={(event, info) => { setDragging(false); onDrop(id, { x: event.clientX ?? info.point.x - window.scrollX, y: event.clientY ?? info.point.y - window.scrollY }); }}
    whileDrag={{ scale: 1.02, zIndex: 30 }} transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 }}>
    {(arranging || title) && <div className="desk-panel-head">
      {arranging && <button type="button" className="panel-grip" aria-label={`Drag ${title || label}`} onPointerDown={event => controls.start(event)}><GripVertical size={15} /></button>}
      <h2>{title || label}</h2>
      <div className="desk-panel-tools">{!arranging && actions}{arranging && <>
        <button type="button" className="icon-button small" aria-label={`Move ${title || label} up`} disabled={index === 0} onClick={() => onMove(id, column, index - 1)}><ArrowUp size={14} /></button>
        <button type="button" className="icon-button small" aria-label={`Move ${title || label} down`} disabled={index >= count - 1} onClick={() => onMove(id, column, index + 1)}><ArrowDown size={14} /></button>
        <button type="button" className="icon-button small" aria-label={`Move ${title || label} to the ${column === 'side' ? 'wide' : 'narrow'} column`} onClick={() => onMove(id, column === 'side' ? 'main' : 'side')}><ArrowLeftRight size={14} /></button>
        <button type="button" className="icon-button small" aria-label={`Hide ${title || label}`} onClick={() => onHide(id)}><EyeOff size={14} /></button>
      </>}</div>
    </div>}
    <div className="desk-panel-body">{children}</div>
  </motion.section>;
}

export function ArrangeBar({ layout, floor, onPreset, onReset, onDone, seatName }) {
  const current = presetOf(layout, { floor });
  return <div className="arrange-bar" role="region" aria-label="Arrange the desk">
    <span className="arrange-hint"><GripVertical size={14} />Drag panels between the two columns. Hide what you don’t use. {seatName ? `Saved to ${seatName}’s seat.` : 'Saved for this desk.'}</span>
    <div className="arrange-actions">
      <span className="arrange-label">Presets</span>
      <div className="preset-tabs" role="group" aria-label="Layout presets">{Object.keys(PRESETS).map(key => <button type="button" key={key} aria-pressed={current === key} onClick={() => onPreset(key)}>{{ classic: 'Classic', transcript: 'Transcript first', compact: 'Compact' }[key]}</button>)}</div>
      <button type="button" className="text-button" onClick={onReset}><RotateCcw size={13} />Reset</button>
      <button type="button" className="button primary compact" onClick={onDone}><Check size={14} />Done</button>
    </div>
  </div>;
}

export function HiddenTray({ ids, onShow, trayRef, over }) {
  return <div ref={trayRef} className={`hidden-tray ${over ? 'is-over' : ''}`} aria-label="Hidden panels">
    <EyeOff size={14} /><span>Hidden</span>
    {ids.length ? ids.map(id => <button type="button" key={id} className="hidden-chip" onClick={() => onShow(id)}>{panelLabel(id)}<Plus size={12} /></button>) : <span className="hidden-none">Nothing hidden</span>}
    <span className="hidden-drop-hint">Drop a panel here to hide it</span>
  </div>;
}

const callState = call => call?.state === 'ringing' ? 'ringing' : call?.state === 'in_call' ? 'in_call' : 'ended';
const channel = call => call?.transport === 'twilio' ? 'Phone' : 'Browser link';

/** Who is calling and what happened the last time this number called. */
export function CallerPanel({ call, calls, onOpen, canOpen }) {
  if (!call) return <p className="panel-empty">Who is calling, their language, and their earlier calls appear here when a call comes in.</p>;
  const previous = calls.filter(item => item.id !== call.id && item.from && item.from === call.from && callState(item) === 'ended').sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const last = previous[0];
  const language = call.detectedLanguage ? `${languageName(call.detectedLanguage)} · detected` : call.customerLanguage === 'auto' ? 'Detecting…' : languageName(call.customerLanguage);
  const when = value => value ? new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
  const dispatch = last?.ticket?.dispatchConfirmedAt ? 'dispatched' : last?.ticket?.dispatch && last.ticket.dispatch !== 'none' ? 'dispatch requested' : 'no dispatch';
  return <>
    <div className="caller-grid">
      <div className="caller-kv"><span>Number</span>{call.from || 'Unknown'}</div>
      <div className="caller-kv"><span>Channel</span>{channel(call)}</div>
      <div className="caller-kv"><span>Language</span>{language}</div>
      <div className="caller-kv"><span>Previous calls</span>{previous.length ? `${previous.length} · last on ${when(last.startedAt)}` : 'First call'}</div>
    </div>
    {last && <div className="caller-last">
      <div className="caller-last-copy"><Clock size={15} /><div><strong>Last ticket · {when(last.startedAt)}</strong><span>{last.ticket?.issue?.trim() || 'No notes were saved'}{last.ticket?.issue?.trim() ? ` · ${dispatch}` : ''}</span></div></div>
      {canOpen && <button type="button" className="text-button" onClick={() => onOpen(last.id)}>Open that conversation<ChevronRight size={13} /></button>}
    </div>}
  </>;
}

/** Saved lines an agent says often. One click speaks the line to the caller in their language. */
export function PhrasesPanel({ phrases, onChange, canSpeak, onSpeak, targetLanguage, editing }) {
  const [draft, setDraft] = useState('');
  const [busyId, setBusyId] = useState('');
  const add = event => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onChange([...phrases, { id: `p-${Date.now().toString(36)}`, text }]); setDraft('');
  };
  const speak = async phrase => { setBusyId(phrase.id); try { await onSpeak(phrase.text); } finally { setBusyId(''); } };
  return <>
    {phrases.length ? <ul className="phrase-list">{phrases.map(phrase => <li key={phrase.id}>
      <button type="button" className="phrase-play" aria-label={`Say: ${phrase.text}`} disabled={!canSpeak || !!busyId} onClick={() => speak(phrase)}>{busyId === phrase.id ? <AudioLines size={13} /> : <Play size={12} fill="currentColor" />}</button>
      <span className="phrase-text">{phrase.text}</span>
      {editing && <button type="button" className="icon-button small" aria-label={`Remove: ${phrase.text}`} onClick={() => onChange(phrases.filter(item => item.id !== phrase.id))}><Trash2 size={13} /></button>}
    </li>)}</ul> : <p className="panel-empty">Save the lines you say on every call. One click speaks them {targetLanguage ? `in ${languageName(targetLanguage)}` : 'in the caller’s language'}, in your voice.</p>}
    <form className="phrase-form" onSubmit={add}><label className="sr-only" htmlFor="phrase-draft">New canned line</label><input id="phrase-draft" value={draft} maxLength={300} placeholder="One moment, please." onChange={event => setDraft(event.target.value)} /><button type="submit" className="button secondary compact" disabled={!draft.trim() || phrases.length >= 30}><Plus size={14} />Add</button></form>
  </>;
}

export function QueuePanel({ calls, needsSeat, busy, onAnswer, blocked, stamp }) {
  if (needsSeat) return <p className="queue-empty"><Users size={15} />Choose your name in the sidebar to answer calls.</p>;
  if (!calls.length) return <p className="panel-empty">No one is waiting.</p>;
  return <div className="queue-list">{calls.map(call => <div className="queue-item" key={call.id}>
    <span className="queue-position"><PhoneCall size={15} /></span>
    <div><strong>{call.from || 'Caller'}</strong><span>{channel(call)} · since {stamp(call.startedAt)}</span></div>
    <button type="button" className="button answer compact" disabled={!!busy || blocked} onClick={() => onAnswer(call)}>Answer</button>
  </div>)}</div>;
}

const AGENT_STATE = { available: ['Available', 'var(--green)'], on_call: ['On a call', 'var(--red)'], paused: ['Paused', 'var(--amber)'], offline: ['Offline', '#B9B5AC'] };
export function AgentsPanel({ agents, me }) {
  if (!agents.length) return <p className="panel-empty">No agents on the floor yet.</p>;
  return <div className="agent-list">{agents.map(agent => { const [label, color] = AGENT_STATE[agent.state] || AGENT_STATE.offline; return <div className="agent-row" key={agent.id}>
    <span className="agent-dot" style={{ background: color }} /><strong>{agent.name}{agent.id === me ? ' (you)' : ''}</strong><span>{label}{agent.pauseReason ? ` · ${agent.pauseReason}` : ''}</span>
  </div>; })}</div>;
}

/** The transcript, measured before it is drawn. Pretext tells us each line's
 * height from its text alone, so a new caption opens to exactly its size and a
 * long call renders only the lines in view (no layout reads on scroll). */
const WINDOW_AFTER = 120;
export function TranscriptLog({ lines, call, partial = '', partialSource = '', containerRef, onScroll, empty, stamp }) {
  const reduced = useReducedMotion();
  const [fonts, setFonts] = useState(null); // { shown, source, width, chrome, lineHeight, sourceLineHeight }
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);
  const [generation, setGeneration] = useState(0);
  const mounted = useRef(new Set());
  const pending = useRef(0);

  // Calibrate once from the first drawn line: its fonts, the column width, and the
  // fixed chrome around the text (avatar row, gaps, padding). Everything after is arithmetic.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const article = container?.querySelector('.transcript-line');
    const shown = article?.querySelector('p');
    if (!container || !article || !shown) return;
    const style = getComputedStyle(shown);
    const source = article.querySelector('.source-text span > span:last-child, .source-text > span');
    const sourceStyle = source ? getComputedStyle(source) : style;
    const font = s => `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
    const lineHeight = parseFloat(style.lineHeight) || Math.round(parseFloat(style.fontSize) * 1.45);
    const sourceLineHeight = parseFloat(sourceStyle.lineHeight) || Math.round(parseFloat(sourceStyle.fontSize) * 1.4);
    const width = shown.clientWidth;
    const line = lines.find(item => (item.id || '') === article.dataset.line) || lines[0];
    const shownText = line.speaker === 'agent' ? line.textSource : line.textShown;
    const sourceText = line.textSource !== line.textShown ? (line.speaker === 'agent' ? line.textShown : line.textSource) : '';
    const text = measureTextHeight(shownText, font(style), width, lineHeight) + (sourceText ? measureTextHeight(sourceText, font(sourceStyle), Math.max(0, width - 18), sourceLineHeight) : 0);
    if (!text) return;
    setFonts({ shown: font(style), source: font(sourceStyle), width, lineHeight, sourceLineHeight, chrome: Math.max(0, article.offsetHeight - text) });
    setViewport(container.clientHeight);
  }, [lines.length > 0, call?.id, generation]);
  useEffect(() => onFontsReady(() => setGeneration(value => value + 1)), []);

  const heightOf = useMemo(() => {
    if (!fonts) return () => 0;
    return line => {
      const shownText = line.speaker === 'agent' ? line.textSource : line.textShown;
      const sourceText = line.textSource !== line.textShown ? (line.speaker === 'agent' ? line.textShown : line.textSource) : '';
      const text = measureTextHeight(shownText, fonts.shown, fonts.width, fonts.lineHeight) + (sourceText ? measureTextHeight(sourceText, fonts.source, Math.max(0, fonts.width - 18), fonts.sourceLineHeight) : 0);
      return text ? text + fonts.chrome : 0;
    };
  }, [fonts]);

  const windowed = fonts && lines.length > WINDOW_AFTER;
  const heights = useMemo(() => windowed ? lines.map(heightOf) : null, [windowed, lines, heightOf]);
  const win = windowed && heights.every(Boolean) ? windowOf(heights, scrollTop, viewport || 600) : null;
  const handleScroll = event => {
    onScroll?.(event);
    if (!windowed) return;
    const el = event.currentTarget;
    if (pending.current) return;
    pending.current = requestAnimationFrame(() => { pending.current = 0; setScrollTop(el.scrollTop); setViewport(el.clientHeight); });
  };
  useEffect(() => () => { if (pending.current) cancelAnimationFrame(pending.current); }, []);

  const languageOf = line => languageName(line.speaker === 'agent' ? line.targetLang || call?.detectedLanguage || call?.customerLanguage : (line.sourceLang && line.sourceLang !== 'und' ? line.sourceLang : call?.detectedLanguage || call?.customerLanguage));
  const render = (line, index) => {
    const key = line.id || `${call?.id}-${index}`;
    const fresh = !mounted.current.has(key) && lines.length > 1 && index === lines.length - 1 && !reduced;
    mounted.current.add(key);
    const measured = fresh ? heightOf(line) : 0;
    const body = <>
      <div className="transcript-meta"><span className="speaker-avatar">{line.speaker === 'agent' ? <AudioLines size={14} /> : <Phone size={13} />}</span><strong>{line.speaker === 'agent' ? 'You' : 'Partner'}</strong><time>{stamp(line.t || line.at)}</time>{line.delivery && line.delivery !== 'caption' && <span className={`delivery ${line.delivery}`}>{line.delivery === 'played' ? 'Played to caller' : line.delivery === 'pending' ? 'Sending' : line.delivery}</span>}{line.feeling && <span className="delivery" title={line.tag || ''}>{line.feeling}</span>}</div>
      <p>{line.speaker === 'agent' ? line.textSource : line.textShown}</p>
      {line.textSource !== line.textShown && <div className="source-text"><Globe2 size={12} /><span><span className="transcript-language">{languageOf(line)}</span>{line.speaker === 'agent' ? line.textShown : line.textSource}</span></div>}
    </>;
    const className = `transcript-line ${line.speaker === 'agent' ? 'agent' : 'customer'}`;
    if (!fresh) return <article className={className} data-line={line.id || ''} key={key}>{body}</article>;
    return <motion.article className={className} data-line={line.id || ''} key={key} initial={{ height: measured || 'auto', opacity: 0, y: 10, overflow: 'hidden' }} animate={{ height: 'auto', opacity: 1, y: 0, transitionEnd: { overflow: 'visible' } }} transition={{ duration: .32, ease: [0.2, 0.7, 0.2, 1] }}>{body}</motion.article>;
  };

  return <div className="transcript" ref={containerRef} role="log" aria-label="Call transcript" aria-live="polite" aria-relevant="additions text" tabIndex={0} onScroll={handleScroll}>
    {!lines.length && !partial ? empty : win ? <>
      <div style={{ height: win.top }} aria-hidden="true" />
      {lines.slice(win.start, win.end).map((line, offset) => render(line, win.start + offset))}
      <div style={{ height: win.bottom }} aria-hidden="true" />
    </> : lines.map(render)}
    {partial && <article className="transcript-line customer is-partial" aria-live="off"><div className="transcript-meta"><span className="speaker-avatar"><Phone size={13} /></span><strong>Partner</strong><span className="delivery">speaking…</span></div><p>{partial}</p>{partialSource && <div className="source-text"><Globe2 size={12} /><span><span className="transcript-language">{languageName(call?.detectedLanguage || call?.customerLanguage)}</span>{partialSource}</span></div>}</article>}
  </div>;
}

export { X };
