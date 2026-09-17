// Get a free month: the referral sheet. A link to copy, or to send by email.
import React, { useState } from 'react';
import { Link2, Send } from 'lucide-react';
import { Btn, Pill, Puff, Sheet } from '../shell.jsx';
import './free.css';

const TABS = ['Refer a friend', 'Your referrals · 0', 'Have a code?'];
/** NINA138: the first name in capitals, letters only, plus three digits from its characters. */
const codeOf = name => { const word = (name || '').trim().split(/\s+/)[0].toUpperCase().replace(/[^A-Z]/g, '') || 'NOTEFISH'; return word + String([...word].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 1000).padStart(3, '0'); };

export default function FreeMonth({ onClose, seat, setNotice }) {
  const [tab, setTab] = useState(0);
  const [email, setEmail] = useState('');
  const code = codeOf(seat?.name);
  const link = `${location.origin}/r/${code}`;
  const copy = async () => { try { await navigator.clipboard.writeText(link); setNotice('Link copied.'); } catch { setNotice('Select the link and copy it by hand.'); } };
  return <Sheet title="Get a free month." intro="Share NoteFish with a friend. They get a month free, and so do you." onClose={onClose}>
    <div className="tabs">{TABS.map((label, index) => <Pill key={label} on={tab === index} onClick={() => setTab(index)}>{label}</Pill>)}</div>
    {tab === 0 ? <div className="box">
      <div className="ds-ticket"><span className="fish"><Puff variant="fish" color="#F3F1EC" size={128} /></span><span className="perf" /><span className="hole top" /><span className="hole bottom" /><div className="text"><small>NOTEFISH</small><strong>One month<br />free.</strong><span><i />A gift from {seat?.name?.trim().split(/\s+/)[0] || 'your desk'}</span></div></div>
      <div className="ds-steps free-steps"><div className="ds-step"><i>01</i><span>Share your link</span></div><div className="ds-step"><i>02</i><span>Your friend signs up and gets <b>a month free</b></span></div><div className="ds-step"><i>03</i><span>You get <b>a month free</b> after their first call</span></div></div>
      <div className="free-field"><strong>Your link</strong><div className="ds-copyrow"><span className="val"><Link2 size={13} />{location.host}/r/{code}</span><Btn kind="ghost" small onClick={copy}>Copy</Btn></div></div>
      <div className="free-field"><strong>Or send it by email</strong><div className="ds-copyrow"><input type="email" value={email} placeholder="email@example.com" aria-label="Email address" onChange={event => setEmail(event.target.value)} /><Btn small disabled={!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)} onClick={() => { location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent('A free month of NoteFish')}&body=${encodeURIComponent(link)}`; }}>Send<Send size={12} /></Btn></div></div>
    </div> : <p className="ds-note free-note">{tab === 1 ? 'No referrals yet. When a friend signs up with your link, they appear here.' : 'A code is entered when a friend signs up. There is nothing to redeem on this desk.'}</p>}
    <p className="free-foot">Your free month is taken off your next payment.</p>
  </Sheet>;
}
