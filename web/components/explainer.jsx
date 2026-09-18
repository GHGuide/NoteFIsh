// The card at the top of every screen that says, in one breath, what the screen is
// for. It is the first thing under the tabs and the first thing you dismiss; once
// dismissed it stays dismissed, and Settings has a switch that brings them all back.
//
// Deliberately not a tour: no steps, no next button, nothing that follows you around.
// One card, one idea, an example of the thing itself, and a way to go and do it.
import React, { useState } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { Puff } from '../shell.jsx';

const KEY = 'notefish.guides';

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const write = value => { try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* a private window is fine */ } };

/** True once this screen's card has been dismissed. */
export const guideHidden = id => read()[id] === true;
/** Bring every screen's card back (Settings uses this). */
export function showAllGuides() { write({}); window.dispatchEvent(new Event('notefish:guides')); }
/** How many are currently hidden, so Settings can say whether the switch does anything. */
export const guidesHidden = () => Object.values(read()).filter(Boolean).length;

/**
 * @param id        storage key, one per screen
 * @param title     the headline. Wrap one word in <em> for the italic emphasis.
 * @param sub       one sentence. What this screen is for, said plainly.
 * @param examples  [{ say, then }] — the shape of the thing, drawn from the real feature
 * @param action    { label, onClick } — the one thing to go and do
 * @param puff      which puff decorates it, and in what colour
 */
export default function Explainer({ id, title, sub, examples = [], action, puff = 'fish', color = '#2E9E86' }) {
  const [hidden, setHidden] = useState(() => guideHidden(id));
  // Settings can un-hide every card while a page is open, so listen for that.
  React.useEffect(() => {
    const again = () => setHidden(guideHidden(id));
    window.addEventListener('notefish:guides', again);
    return () => window.removeEventListener('notefish:guides', again);
  }, [id]);
  if (hidden) return null;
  const dismiss = () => { write({ ...read(), [id]: true }); setHidden(true); };
  return <section className="ds-explain" aria-label="About this screen">
    <span className="art" aria-hidden="true"><Puff variant={puff} color={color} size={260} face={false} /></span>
    <button type="button" className="x" aria-label="Hide this" onClick={dismiss}><X size={15} /></button>
    <h2>{title}</h2>
    <p>{sub}</p>
    {examples.length > 0 && <div className="eg">
      {examples.map((example, index) => <div className="egrow" key={index}>
        <span className="say">{example.say}</span>
        <ArrowRight size={13} aria-hidden="true" />
        <span className="then">{example.then}</span>
      </div>)}
    </div>}
    {action && <button type="button" className="go" onClick={action.onClick}>{action.label}</button>}
  </section>;
}
