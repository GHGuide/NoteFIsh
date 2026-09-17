// Floor: who is waiting and who is on what. Read-only; the desk carries the audio.
import React, { useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { Toolbar, Title, Tabs, ReadBar, Body, Label, Row, Stat, Status, Avatar, Btn, Empty, Ask } from '../shell.jsx';
import { api } from '../api.js';
import { EMPTY_FLOOR, AGENT_STATE, formatDuration, languageName } from '../lib.jsx';

const TONE = { available: 'green', on_call: 'amber', paused: 'muted', offline: 'muted' };
const wait = s => s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;

export default function FloorPage({ data, navigate, route, seat, roster, multiAgent, enableAudio, setError }) {
  const [tab, setTab] = useState(route.query.tab || 'queue');
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState('');
  const floor = data.floor || EMPTY_FLOOR;
  const waiting = floor.waiting || [], agents = floor.agents || [];
  const live = waiting.length > 0 || agents.some(agent => agent.state === 'on_call');
  useEffect(() => { if (!live) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [live]);
  if (!multiAgent) return <><Toolbar /><Title title="Floor" sub="Who is on what · read-only · no audio" /><Body><Empty icon={<Users size={26} strokeWidth={1.4} />} title="The floor needs the protected workspace.">{data.setup?.floor?.reason}</Empty></Body><Ask placeholder="Ask about the floor" scope="floor" /></>;
  const since = t => Math.max(0, Math.floor((now - new Date(t).getTime()) / 1000));
  const callOf = id => data.calls.find(call => call.id === id);
  const langOf = call => { const l = call?.detectedLanguage || call?.customerLanguage; return l && l !== 'auto' ? languageName(l) : null; };
  const mine = agents.find(agent => agent.id === seat?.id);
  const canAnswer = seat && mine?.state !== 'on_call';
  const answer = async call => { setBusy(call.id); try { await enableAudio(); await api.answer(call.id); navigate('/desk'); } catch (failure) { setError(failure.message); } finally { setBusy(''); } };
  const longest = waiting.length ? Math.max(...waiting.map(call => since(call.startedAt))) : 0;
  const list = agents.map(agent => {
    const person = roster.find(item => item.id === agent.id) || agent;
    const call = agent.state === 'on_call' ? callOf(agent.callId) : null;
    const lang = person.customerLanguage || data.settings.customerLanguage;
    const sub = call ? [call.from || 'Caller', formatDuration(since(call.answeredAt || call.startedAt)), (call.detectedLanguage || call.customerLanguage || '').slice(0, 2).toUpperCase()].filter(Boolean).join(' · ')
      : agent.state === 'on_call' ? 'On a call' : agent.state === 'paused' ? agent.pauseReason || 'Paused' : agent.state === 'offline' ? 'Not signed in' : lang === 'auto' ? 'Ready · detects the caller’s language' : `Ready · callers in ${languageName(lang)}`;
    return <Row key={agent.id} lead={<Avatar who={person} size={32} />} main={agent.id === seat?.id ? <>{agent.name} <span className="ds-chip">you</span></> : agent.name} sub={sub} right={<Status tone={TONE[agent.state]}>{AGENT_STATE[agent.state]}</Status>} />;
  });
  const nobody = <p className="ds-note">No agents yet. Add them in Settings.</p>;
  return <>
    <Toolbar />
    <Title title="Floor" sub="Who is on what · read-only · no audio" />
    <Tabs items={[{ key: 'queue', label: 'Queue', count: waiting.length || undefined }, { key: 'agents', label: 'Agents' }]} value={tab} onChange={setTab} />
    {tab === 'agents' && <ReadBar><Users size={14} />{roster.length} on the roster</ReadBar>}
    <Body>
      {tab === 'queue' ? <>
        <div className="ds-stats four" style={{ marginBottom: 10 }}>
          <Stat n={waiting.length} label="Waiting" />
          <Stat n={agents.filter(agent => agent.state === 'on_call').length} label="On calls" />
          <Stat n={agents.filter(agent => agent.state === 'available').length} label="Available" />
          <Stat n={waiting.length ? wait(longest) : '—'} label="Longest wait" />
        </div>
        {!seat && waiting.length > 0 && <p className="ds-note" style={{ marginBottom: 6 }}>Choose your name in the sidebar to answer calls.</p>}
        {!waiting.length ? <p className="ds-note">Nobody is waiting.</p> : waiting.map((call, index) => <Row key={call.id} solid lead={<span className="lead num">{call.position || index + 1}</span>} main={call.from || 'Caller'}
          sub={[call.transport === 'twilio' ? 'Phone' : 'Browser', langOf(callOf(call.id)), `waiting ${wait(since(call.startedAt))}`].filter(Boolean).join(' · ')}
          right={canAnswer && <Btn kind="green" small disabled={busy === call.id} onClick={() => answer(call)}>Answer</Btn>} />)}
        <Label style={{ margin: '16px 0 2px' }}>Agents</Label>
        {agents.length ? list : nobody}
      </> : agents.length ? list : nobody}
    </Body>
    <Ask placeholder="Ask about the floor" scope="floor" />
  </>;
}
