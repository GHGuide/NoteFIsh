// The window's top right: what needs attention, and who this desk belongs to.
//
// Both are popovers hung under their button. They close on Escape, on a click
// anywhere else, and when the window loses focus, and they hand focus back to the
// button that opened them so the keyboard does not get stranded in a closed menu.
import React from 'react';
import { Bell, ChevronRight, Gift, Settings as Cog, TriangleAlert, UserRound } from 'lucide-react';
import Popover from './popover.jsx';
import { Avatar } from '../shell.jsx';

/** What is stopping this desk from taking a call, said once rather than per page. */
function Attention({ data, connection, navigate, close }) {
  const blockers = data.setup?.blockers || [];
  const voice = (data.voices || []).find(item => item.id === data.settings.voiceId && !item.archived);
  const notes = [];
  if (connection !== 'connected') notes.push({ tone: 'amber', main: 'Not connected to the desk', sub: 'Calls cannot ring until this reconnects.' });
  const spare = (data.voices || []).some(item => !item.archived && item.status === 'ready');
  if (!voice) notes.push({ tone: 'amber', main: 'No voice chosen', sub: spare ? 'Pick which one answers, in the sidebar.' : 'Record one on Voice and callers hear you.', go: '/voice' });
  for (const line of blockers) notes.push({ tone: 'amber', main: line, sub: '', go: '/settings' });
  return <>
    <div className="ds-pop-head"><strong>Needs attention</strong></div>
    {!notes.length
      ? <div className="ds-pop-row quiet"><span>Nothing to see to. The desk is ready for a call.</span></div>
      : notes.map((note, index) => <button
          key={index} type="button" className="ds-pop-row act"
          onClick={() => { close(); if (note.go) navigate(note.go); }}
        >
          <span className="ic amber"><TriangleAlert size={15} /></span>
          <span className="txt"><strong>{note.main}</strong>{note.sub && <span>{note.sub}</span>}</span>
          {note.go && <ChevronRight size={15} />}
        </button>)}
  </>;
}

/** Who this desk belongs to, how much it did this week, and the way out to settings. */
function Account({ user, data, voice, navigate, openFree, close }) {
  const week = (data.calls || []).filter(call => Date.parse(call.startedAt) >= Date.now() - 7 * 864e5);
  const answered = week.filter(call => call.answeredAt);
  const minutes = Math.round(answered.reduce((sum, call) => sum + Math.max(0, (Date.parse(call.endedAt || call.answeredAt) - Date.parse(call.answeredAt)) / 6e4), 0));
  return <>
    <div className="ds-pop-id">
      <span className="disc"><Avatar who={voice || { name: user?.name || 'NoteFish', avatar: data.settings.avatar }} size={36} /></span>
      <div>
        <strong>{user?.name || voice?.name || 'This desk'}</strong>
        <span>{user?.email || (voice ? 'The voice callers hear' : 'Signed in on this Mac')}</span>
      </div>
    </div>
    <div className="ds-pop-row">
      <span className="txt">
        <strong>{answered.length} call{answered.length === 1 ? '' : 's'} this week</strong>
        <span>{minutes} minute{minutes === 1 ? '' : 's'} translated</span>
      </span>
      <button type="button" className="ds-btn pill ink" onClick={() => { close(); navigate('/insights'); }}>See insights</button>
    </div>
    <div className="ds-pop-row">
      <span className="txt">
        <strong>Give a month away</strong>
        <span>Share NoteFish, get one back</span>
      </span>
      <button type="button" className="ds-btn pill" onClick={() => { close(); openFree(); }}><Gift size={13} />Refer a friend</button>
    </div>
    <button type="button" className="ds-pop-row act" onClick={() => { close(); navigate('/settings'); }}>
      <span className="ic"><Cog size={15} /></span>
      <span className="txt"><strong>Settings</strong></span>
      <ChevronRight size={15} />
    </button>
  </>;
}

export default function TopBar({ user, data, voice, connection, navigate, openFree }) {
  const blockers = (data.setup?.blockers || []).length
    + (connection === 'connected' ? 0 : 1)
    + ((data.voices || []).some(item => item.id === data.settings.voiceId && !item.archived) ? 0 : 1);
  const button = (label, icon, badge) => ({ ref, open, toggle, props }) => <button
    type="button" ref={ref} className={`ds-pop-btn ${open ? 'on' : ''}`} aria-label={label} onClick={toggle} {...props}
  >{icon}{badge > 0 && <i className="ds-pop-badge" aria-hidden="true" />}</button>;
  return <>
    <Popover label="Needs attention" trigger={button('Needs attention', <Bell size={17} strokeWidth={1.7} />, blockers)}>
      {close => <Attention data={data} connection={connection} navigate={navigate} close={close} />}
    </Popover>
    <Popover label="Your account" trigger={button('Your account', <UserRound size={17} strokeWidth={1.7} />, 0)}>
      {close => <Account user={user} data={data} voice={voice} navigate={navigate} openFree={openFree} close={close} />}
    </Popover>
  </>;
}
