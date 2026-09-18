// A card hung under the thing you pressed. One implementation, because a menu that
// behaves differently in two corners of the same window is two bugs waiting.
//
// It closes on Escape, on a press anywhere else, and when the window loses focus, and
// hands focus back to the button that opened it so the keyboard is never stranded in a
// menu that is no longer there.
import React, { useEffect, useRef, useState } from 'react';

export default function Popover({ label, trigger, children, align = 'right', width, className = '' }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);
  const button = useRef(null);
  useEffect(() => {
    if (!open) return;
    const away = event => { if (!wrap.current?.contains(event.target)) setOpen(false); };
    const key = event => { if (event.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const blur = () => setOpen(false);
    // Pointerdown, not click: a menu that waits for mouseup stays open under the cursor.
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', key); window.removeEventListener('blur', blur); };
  }, [open]);
  const close = () => { setOpen(false); button.current?.focus(); };
  return <div className={`ds-pop-wrap ${className}`} ref={wrap}>
    {trigger({ ref: button, open, toggle: () => setOpen(current => !current), props: { 'aria-haspopup': 'menu', 'aria-expanded': open } })}
    {open && <div className={`ds-pop ${align}`} role="menu" aria-label={label} style={width ? { width } : undefined}>{children(close)}</div>}
  </div>;
}
