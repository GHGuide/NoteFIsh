// Asking before something irreversible, in the app rather than in the operating system.
//
// It was window.confirm, which on a Mac drops a system alert sheet over the window:
// AppKit chrome, the app's own name as a heading, and two buttons the app cannot label.
// Deleting a cloned voice deserves a sentence about what is actually being deleted, and
// a button whose verb says what it will do.
//
//   const ask = useConfirm()
//   if (await ask({ title, body, confirm: 'Delete for good', tone: 'red' })) ...
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Sheet, Btn } from '../shell.jsx';

const Ctx = createContext(null);

/** Ask, and get a promise that resolves true or false. */
export function useConfirm() {
  const ask = useContext(Ctx);
  // Outside the provider (the caller page, the pill) fall back rather than throw.
  return ask || (async ({ body }) => window.confirm(body));
}

export function ConfirmProvider({ children }) {
  const [asking, setAsking] = useState(null);
  const answer = useRef(null);
  const confirmButton = useRef(null);
  const ask = useCallback(options => new Promise(resolve => { answer.current = resolve; setAsking(options); }), []);
  const settle = value => { setAsking(null); answer.current?.(value); answer.current = null; };
  useEffect(() => { if (asking) confirmButton.current?.focus(); }, [asking]);
  return <Ctx.Provider value={ask}>
    {children}
    {asking && <Sheet title={asking.title} onClose={() => settle(false)}>
      <p className="ds-confirm-body">{asking.body}</p>
      <div className="ds-confirm-acts">
        <Btn kind="ghost" onClick={() => settle(false)}>{asking.cancel || 'Cancel'}</Btn>
        <Btn ref={confirmButton} kind={asking.tone === 'red' ? 'red' : 'ink'} onClick={() => settle(true)}>{asking.confirm || 'Yes'}</Btn>
      </div>
    </Sheet>}
  </Ctx.Provider>;
}
