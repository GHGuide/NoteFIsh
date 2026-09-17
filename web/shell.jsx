// The companion design's building blocks: the puff avatars and the logo mark,
// the sidebar, and the document rhythm inside the sheet (toolbar · title · tabs ·
// read bar · body · ask). Pages compose these; design/build.py is the reference.
import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, Loader2, Send, X } from 'lucide-react';
import { api } from './api.js';

// ---- avatars: eight puffs, eleven colours (design/build.py PUFFS / SWATCHES) ----
export const PUFFS = ['fish', 'puff', 'cloud', 'sheep', 'bloom', 'tuft', 'pom', 'squish'];
export const SWATCHES = [['ink', '#242424'], ['brown', '#7A4E2D'], ['red', '#C43B36'], ['orange', '#E2732A'], ['amber', '#E7A72F'], ['green', '#3C8A4E'], ['teal', '#2E9E86'], ['blue', '#2F6FE0'], ['purple', '#7D4FE0'], ['pink', '#D63F8C'], ['gray', '#7A7A7A']];
const TAU = Math.PI * 2;
const ring = (n, rx, ry, r, { cy = 51, start = 0, rfn } = {}) => Array.from({ length: n }, (_, k) => { const a = start + TAU * k / n; return [50 + rx * Math.cos(a), cy + ry * Math.sin(a), rfn ? rfn(a) : r]; });
function puffParts(variant) {
  switch (variant) {
    case 'fish': { const body = Array.from({ length: 8 }, (_, k) => { const a = TAU * k / 8; return [42 + 25 * Math.cos(a), 51 + 23 * Math.sin(a), 14]; }); return { bumps: [...body, [80, 36, 12], [80, 66, 12], [71, 51, 11]], cores: [['e', 42, 51, 30, 26]], dy: 0 }; }
    case 'cloud': { const top = [200, 235, 270, 305, 340].map(a => [50 + 25 * Math.cos(a * Math.PI / 180), 50 + 25 * Math.sin(a * Math.PI / 180), a === 270 ? 19 : 16]); return { bumps: top, cores: [['c', 50, 56, 30], ['c', 27, 62, 15], ['c', 73, 62, 15]], dy: 6 }; }
    case 'sheep': return { bumps: ring(12, 30, 30, 11), cores: [['c', 50, 51, 32]], dy: 0 };
    case 'bloom': return { bumps: ring(6, 25, 25, 19, { start: -Math.PI / 2 }), cores: [['c', 50, 51, 26]], dy: 0 };
    case 'tuft': return { bumps: [...ring(8, 26, 26, 17), [41, 13, 7], [50, 8, 7.5], [59, 13, 7]], cores: [['c', 50, 52, 30]], dy: 1 };
    case 'pom': return { bumps: ring(16, 34, 34, 8.5), cores: [['c', 50, 51, 36]], dy: 0 };
    case 'squish': return { bumps: ring(8, 33, 22, 15), cores: [['e', 50, 51, 36, 26]], dy: 0 };
    case 'pear': return { bumps: ring(8, 26, 27, 13, { cy: 53, rfn: a => 12 + 7 * Math.max(0, Math.sin(a)) }), cores: [['c', 50, 55, 28]], dy: 4 };
    default: return { bumps: ring(8, 26, 26, 17), cores: [['c', 50, 51, 30]], dy: 0 };
  }
}
/** A fluffy circle of bumps, dot eyes, a small smile. `face=false` shows the puff without eyes (lists, records). */
export function Puff({ variant = 'fish', color = '#2F6FE0', size = 32, face = true, className }) {
  const { bumps, cores, dy } = puffParts(PUFFS.includes(variant) || variant === 'pear' ? variant : 'fish');
  const eye = color.toUpperCase() === '#242424' ? '#F3F1EC' : '#1B1B1B';
  const ey = 48 + dy, cx = variant === 'fish' ? 42 : 50;
  return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" className={className}>
    {bumps.map(([x, y, r], i) => <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={r} fill={color} />)}
    {cores.map((c, i) => c[0] === 'c' ? <circle key={`c${i}`} cx={c[1]} cy={c[2]} r={c[3]} fill={color} /> : <ellipse key={`c${i}`} cx={c[1]} cy={c[2]} rx={c[3]} ry={c[4]} fill={color} />)}
    {face && <><circle cx={cx - 8} cy={ey} r="2.8" fill={eye} /><circle cx={cx + 8} cy={ey} r="2.8" fill={eye} /><path d={`M${cx - 5},${ey + 9} Q${cx},${ey + 12} ${cx + 5},${ey + 9}`} fill="none" stroke={eye} strokeWidth="2.4" strokeLinecap="round" /></>}
  </svg>;
}
/** The mark: the fish puff on an ink tile, two slit eyes cut out so it holds at 16px. */
export function LogoMark({ size = 22, tile = true, fg = '#F3F1EC', bg = '#242424', radius = 26 }) {
  const { bumps, cores } = puffParts('fish');
  return <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    {tile && <rect width="100" height="100" rx={radius} fill={bg} />}
    <g transform="translate(8 9) scale(.84)">
      {bumps.map(([x, y, r], i) => <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={r} fill={fg} />)}
      {cores.map((c, i) => <ellipse key={`c${i}`} cx={c[1]} cy={c[2]} rx={c[3]} ry={c[4]} fill={fg} />)}
      <g transform="rotate(-9 34 47)"><rect x="31.4" y="40" width="5.2" height="14" rx="2.6" fill={bg} /></g>
      <g transform="rotate(9 50 47)"><rect x="47.4" y="40" width="5.2" height="14" rx="2.6" fill={bg} /></g>
    </g>
  </svg>;
}
/** Which puff someone is: their saved avatar, or a steady pick from their name. */
export function avatarOf(who) {
  const saved = who && typeof who === 'object' ? who.avatar : null;
  if (saved?.variant && saved?.color) return { variant: saved.variant, color: saved.color, face: saved.face !== false };
  const name = typeof who === 'string' ? who : who?.name || '';
  const seed = [...name].reduce((sum, char) => sum * 31 + char.charCodeAt(0), 7) >>> 0;
  if (!name) return { variant: 'cloud', color: '#9A958B', face: false };
  return { variant: PUFFS[seed % PUFFS.length], color: SWATCHES[(seed >>> 3) % SWATCHES.length][1], face: true };
}
export function Avatar({ who, size = 30, face }) { const a = avatarOf(who); return <Puff variant={a.variant} color={a.color} size={size} face={face === undefined ? a.face : face} />; }

// ---- the sheet's rhythm ----
export function Toolbar({ back, onBack, children }) {
  return <div className="ds-toolbar">{back ? <button type="button" className="ds-tool back" aria-label="Back" onClick={onBack}><ChevronLeft size={16} /></button> : <span />}<div className="right">{children}</div></div>;
}
export function Title({ title, sub, children }) {
  return <div className="ds-col ds-title"><h1>{title}</h1>{sub && <p>{sub}</p>}{children}</div>;
}
export function Tabs({ items, value, onChange }) {
  return <div className="ds-tabs" role="tablist"><div className="ds-col">{items.map(item => <button type="button" role="tab" key={item.key} aria-selected={value === item.key} className={value === item.key ? 'on' : ''} onClick={() => onChange(item.key)}>{item.icon}{item.label}{item.count !== undefined && <span className="ds-chip">{item.count}</span>}</button>)}</div></div>;
}
export function ReadBar({ children, right, className = '' }) {
  return <div className={`ds-col ds-readbar ${className}`}><div className="left">{children}</div>{right && <div className="right">{right}</div>}</div>;
}
export function Body({ children, className = '', tight = false, wide = false }) {
  return <div className={`ds-col ${wide ? 'wide' : ''} ds-body ${tight ? 'tight' : ''} ${className}`}>{children}</div>;
}
export function Col({ children, className = '', style, wide = false }) { return <div className={`ds-col ${wide ? 'wide' : ''} ${className}`} style={style}>{children}</div>; }
export function Label({ children, style }) { return <div className="ds-label" style={style}>{children}</div>; }
export function Dot({ tone = 'muted' }) { return <span className={`ds-dot ${tone}`} />; }
export function Status({ tone = 'muted', children }) { return <span className={`ds-status ${tone}`}><Dot tone={tone} />{children}</span>; }
export function Chip({ tone = '', tall = false, children, icon }) { return <span className={`ds-chip ${tone} ${tall ? 'tall' : ''}`}>{icon}{children}</span>; }
export function Stat({ n, label }) { return <div className="ds-stat"><strong>{n}</strong><span>{label}</span></div>; }
export function Bar({ label, pct }) { return <div className="ds-bar"><span>{label}</span><span><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></span><span>{Math.round(pct)}%</span></div>; }
/** One list line: a lead (avatar, icon, number), a title with a sub line, something on the right. */
export function Row({ lead, main, sub, right, onClick, solid = false, title }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag type={onClick ? 'button' : undefined} className={`ds-row ${solid ? 'solid' : ''}`} onClick={onClick} title={title}>{lead}<div><strong>{main}</strong>{sub && <span>{sub}</span>}</div>{right && <div className="right">{right}</div>}</Tag>;
}
export function Btn({ kind = 'ink', small = false, pill = false, grow = false, icon, children, className = '', ...props }) {
  return <button type="button" className={`ds-btn ${kind} ${small ? 'small' : ''} ${pill ? 'pill' : ''} ${grow ? 'grow' : ''} ${className}`} {...props}>{icon}{children}</button>;
}
export function TextBtn({ muted = false, icon, children, className = '', ...props }) { return <button type="button" className={`ds-text ${muted ? 'muted' : ''} ${className}`} {...props}>{icon}{children}</button>; }
export function Pill({ on = false, children, className = '', ...props }) { return <button type="button" className={`ds-pill ${on ? 'on' : ''} ${className}`} aria-pressed={on} {...props}>{children}</button>; }
export function SelectPill({ value, onChange, options, lead, bar = false, className = '', ...props }) {
  return <span className={`ds-selectpill ${bar ? 'bar' : ''} ${className}`}>{lead && <span className="lead" style={{ position: 'absolute', left: 9, display: 'grid', color: 'var(--navtext)', pointerEvents: 'none' }}>{lead}</span>}<select value={value} onChange={event => onChange(event.target.value)} className={lead ? 'with-lead' : ''} {...props}>{options.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}</select><ChevronDown size={12} className="chev" /></span>;
}
export function Field({ label, children, className = '' }) { return <label className={`ds-field ${className}`}>{label && <span>{label}</span>}{children}</label>; }
export function Switch({ checked, onChange, label }) { return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="ds-switch" onClick={() => onChange(!checked)}><i /></button>; }
export function Option({ on, main, sub, onClick }) { return <button type="button" className={`ds-option ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}><span className="mark">{on && <Check size={11} strokeWidth={2.6} />}</span><div><strong>{main}</strong><span>{sub}</span></div></button>; }
export function Setting({ main, sub, children }) { return <div className="ds-setting"><div><strong>{main}</strong>{sub && <span>{sub}</span>}</div><div className="ctl">{children}</div></div>; }
export function Wave({ className = '' }) { return <span className={`ds-wave ${className}`} aria-hidden="true"><i /><i /><i /><i /><i /><i /></span>; }
export function Typing() { return <span className="ds-typing" aria-hidden="true"><i /><i /><i /></span>; }
export function Empty({ icon, title, children, actions }) { return <div className="ds-empty">{icon}<h2>{title}</h2>{children && <p>{children}</p>}{actions && <div className="actions">{actions}</div>}</div>; }
export function Spinner({ size = 16 }) { return <Loader2 className="spin" size={size} />; }

/** The ask bar: a question about this page's own data, answered in a bubble above it. */
export function Ask({ placeholder = 'Ask anything', scope = 'calls', callId }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null); // { text, thinking }
  const controller = useRef(null);
  useEffect(() => () => controller.current?.abort(), []);
  const submit = async event => {
    event.preventDefault();
    const q = question.trim();
    if (!q) return;
    controller.current?.abort();
    const current = new AbortController(); controller.current = current;
    setAnswer({ text: 'Thinking…', thinking: true });
    try { const result = await api.ask({ question: q, scope, callId }, current.signal); if (!current.signal.aborted) setAnswer({ text: result.answer }); }
    catch (failure) { if (!current.signal.aborted) setAnswer({ text: failure.message }); }
  };
  return <div className="ds-col ds-ask">
    {answer && <div className={`answer ${answer.thinking ? 'thinking' : ''}`} role="status"><p>{answer.text}</p><button type="button" className="close" aria-label="Dismiss" onClick={() => { controller.current?.abort(); setAnswer(null); }}><X size={14} /></button></div>}
    <form onSubmit={submit}><input value={question} placeholder={placeholder} aria-label={placeholder} maxLength={500} onChange={event => setQuestion(event.target.value)} /><button type="submit" aria-label="Ask" disabled={!question.trim()}><Send size={12} /></button></form>
  </div>;
}

/** A small modal in the design's clothes (the free month, confirmations). */
export function Sheet({ title, children, onClose, intro }) {
  useEffect(() => { const key = event => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [onClose]);
  return <div className="ds-modal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div className="ds-modal" role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2>{intro && <p>{intro}</p>}{children}</div></div>;
}
