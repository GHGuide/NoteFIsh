// The voice you answer in, and the way to change it — the first thing in the sidebar,
// because on this desk that is who you are.
//
// It was a native <select>, which on a Mac opens the system's own blue-highlighted menu
// in the middle of a cream window. This is the same choice in the app's own clothes:
// each voice with its puff, a tick on the one answering, and a way through to record
// another.
import React from 'react';
import { Check, ChevronDown, Mic } from 'lucide-react';
import Popover from './popover.jsx';
import { Avatar } from '../shell.jsx';

export default function VoiceMenu({ voice, voices, onPick, onRecord, connection, sharedDemo }) {
  const ready = connection === 'connected';
  const state = voice ? (ready ? 'Ready' : 'Connecting…') : 'Record one on Voice';
  // One voice and nothing to choose between: a plain block, not a menu that does nothing.
  if (voices.length <= 1) return <div className="ds-voice" aria-label="The voice you answer in">
    <Avatar who={voice || { name: 'NoteFish' }} size={30} />
    <span className="who">
      <strong>{voice ? voice.name : sharedDemo ? 'Shared demo' : 'No voice yet'}</strong>
      <span className={`state ${ready && voice ? '' : 'muted'}`}><i />{state}</span>
    </span>
  </div>;

  return <Popover label="The voice you answer in" align="left" width={268} className="ds-voice-wrap" trigger={({ ref, open, toggle, props }) => (
    <button type="button" ref={ref} className={`ds-voice pick ${open ? 'on' : ''}`} onClick={toggle} {...props}>
      <Avatar who={voice || { name: 'NoteFish' }} size={30} />
      <span className="who">
        <strong>{voice ? voice.name : 'Choose a voice'}</strong>
        <span className={`state ${ready && voice ? '' : 'muted'}`}><i />{state}</span>
      </span>
      <ChevronDown size={14} className="chev" />
    </button>
  )}>
    {close => <>
      <div className="ds-pop-head"><strong>Answer in</strong></div>
      {voices.map(item => <button
        key={item.id} type="button" role="menuitemradio" aria-checked={item.id === voice?.id}
        className={`ds-pop-pick ${item.id === voice?.id ? 'on' : ''}`}
        onClick={() => { close(); if (item.id !== voice?.id) onPick(item.id); }}
      >
        <Avatar who={item} size={28} />
        <span className="txt">
          <strong>{item.name}</strong>
          <span>{item.kind === 'licensed' ? 'Licensed voice' : 'Your clone'}</span>
        </span>
        {item.id === voice?.id && <Check size={15} className="tick" />}
      </button>)}
      <button type="button" className="ds-pop-row act" onClick={() => { close(); onRecord(); }}>
        <span className="ic"><Mic size={15} /></span>
        <span className="txt"><strong>Record another</strong><span>One passage is enough</span></span>
      </button>
    </>}
  </Popover>;
}
