// A menu that stays inside the app's own skin.
//
// This was a native <select> with `appearance: none`, which styles the closed state and
// nothing else: pressing it opened the macOS system menu, dark chrome and blue
// highlight, in the middle of a cream window. Every language picker, every voice
// picker and every glossary rule did that.
//
// The list is rendered into document.body rather than next to the button, because the
// sheet clips its overflow and the desk's rows scroll — a menu drawn in place would be
// cut off by whichever container it happened to sit in. Its position is measured from
// the button each time it opens, and it closes rather than chases if the page moves
// underneath it.
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

const MARGIN = 8;

export default function Select({ value, onChange, options, lead, bar = false, disabled, className = '', 'aria-label': label, ...rest }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState(null); // {left, top, width, drop}
  const [active, setActive] = useState(0);
  const button = useRef(null);
  const list = useRef(null);
  const id = useId();
  const picked = options.find(option => option.value === value) || null;
  const usable = options.filter(option => !option.disabled);

  const place = useCallback(() => {
    const box = button.current?.getBoundingClientRect();
    if (!box) return;
    const height = Math.min(options.length * 34 + 12, 300);
    const below = window.innerHeight - box.bottom - MARGIN;
    const drop = below >= height || below >= box.top - MARGIN;
    const width = Math.max(box.width, 200);
    setAt({
      left: Math.min(Math.max(MARGIN, box.left), window.innerWidth - width - MARGIN),
      top: drop ? box.bottom + 6 : box.top - 6,
      width, drop,
      max: drop ? below : box.top - MARGIN,
    });
  }, [options.length]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    // Scrolling the page moves the button out from under a menu measured once, so the
    // menu closes. The menu's OWN scrolling must not count: bringing the selected item
    // into view fires a scroll event, and this closed the menu the instant it opened.
    const shut = event => { if (event?.target && list.current?.contains(event.target)) return; setOpen(false); };
    const away = event => { if (!list.current?.contains(event.target) && !button.current?.contains(event.target)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    // A menu measured once must not hang in the wrong place: if the page moves, it closes.
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    window.addEventListener('blur', shut);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
      window.removeEventListener('blur', shut);
    };
  }, [open]);
  useEffect(() => { if (open) setActive(Math.max(0, usable.findIndex(option => option.value === value))); }, [open]);
  useEffect(() => { if (open) list.current?.querySelector('[data-on="true"]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const choose = option => { setOpen(false); button.current?.focus(); if (option.value !== value) onChange(option.value); };
  const keys = event => {
    if (!open && ['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); button.current?.focus(); return; }
    if (event.key === 'Tab') { setOpen(false); return; }
    const to = { ArrowDown: active + 1, ArrowUp: active - 1, Home: 0, End: usable.length - 1 }[event.key];
    if (to !== undefined) { event.preventDefault(); setActive(Math.max(0, Math.min(usable.length - 1, to))); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (usable[active]) choose(usable[active]); }
  };

  return <>
    <button
      type="button" ref={button} disabled={disabled} onClick={() => setOpen(current => !current)} onKeyDown={keys}
      className={`ds-select ${bar ? 'bar' : ''} ${open ? 'on' : ''} ${className}`}
      aria-haspopup="listbox" aria-expanded={open} aria-label={label} aria-controls={open ? id : undefined} {...rest}
    >
      {lead && <span className="lead">{lead}</span>}
      <span className="now">{picked ? picked.label : options[0]?.label || ''}</span>
      <ChevronDown size={12} className="chev" />
    </button>
    {open && at && createPortal(
      <div
        ref={list} id={id} role="listbox" aria-label={label} className={`ds-menu ${at.drop ? '' : 'up'}`}
        style={{ left: at.left, width: at.width, maxHeight: Math.max(120, at.max), ...(at.drop ? { top: at.top } : { bottom: window.innerHeight - at.top }) }}
      >
        {options.map((option, index) => {
          const on = option.value === value;
          const here = usable[active]?.value === option.value;
          return <button
            key={option.value} type="button" role="option" aria-selected={on} data-on={here}
            className={`ds-menu-item ${on ? 'on' : ''} ${here ? 'here' : ''}`} disabled={option.disabled}
            onMouseEnter={() => { const i = usable.findIndex(u => u.value === option.value); if (i >= 0) setActive(i); }}
            onClick={() => choose(option)}
          >
            <span>{option.label}</span>
            {on && <Check size={14} />}
          </button>;
        })}
      </div>, document.body)}
  </>;
}
