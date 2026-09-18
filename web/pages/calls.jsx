// Calls: this week's list grouped by day, and one call's record (notes, transcript).
import React, { useMemo, useState } from 'react';
import { Check, Copy, Search, X } from 'lucide-react';
import { Toolbar, Title, Tabs, ReadBar, Body, Label, Row, Status, Avatar, Empty, Ask, TextBtn } from '../shell.jsx';
import { formatDuration, needsDispatch } from '../lib.jsx';
import Explainer from '../components/explainer.jsx';
import './calls.css';

const secs = (a, b) => a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)) : 0;
const length = call => secs(call.answeredAt, call.endedAt);
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const midnight = d => { const m = new Date(d); m.setHours(0, 0, 0, 0); return m; };
const daysAgo = t => Math.round((midnight(Date.now()) - midnight(t)) / 864e5);
const when = t => { const d = daysAgo(t); return d <= 0 ? hhmm(t) : d === 1 ? `Yesterday ${hhmm(t)}` : `${new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${hhmm(t)}`; };
const monday = () => { const d = midnight(Date.now()); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; };
const longMinutes = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} min` : `${m} min`; };
const minSec = s => s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
const code = l => l && l !== 'auto' ? l.slice(0, 2).toUpperCase() : '';
const callerLang = call => call.detectedLanguage || call.customerLanguage;
const pair = call => [code(callerLang(call)), code(call.agentLanguage)].filter(Boolean).join(' → ');
const firstLine = text => (text || '').trim().split('\n')[0].trim();
const attention = call => call.state === 'ended' && Boolean(call.error || !call.answeredAt || !firstLine(call.ticket?.issue));
const statusOf = call => call.state === 'in_call' ? ['green', 'On the line'] : call.state === 'ringing' ? ['green', 'Ringing']
  : call.error ? ['red', /play|deliver/i.test(call.error) ? 'Delivery failed' : call.error.split(/(?<=[.!?])\s/)[0]]
  : firstLine(call.ticket?.issue) ? ['green', 'Notes saved'] : !call.answeredAt ? ['muted', 'Not answered'] : ['muted', 'Transcript saved'];

export default function CallsPage(common) {
  const { data, navigate, route } = common;
  const [tab, setTab] = useState(route.query.tab || 'all');
  const [q, setQ] = useState('');
  if (route.params.id) return <Record key={route.params.id} {...common} call={data.calls.find(call => call.id === route.params.id)} />;
  // The name on a past call is the voice the caller heard it in.
  const agentOf = call => (call.agentName ? { name: call.agentName } : null);
  const week = data.calls.filter(call => new Date(call.startedAt) >= monday());
  const needle = q.trim().toLowerCase();
  const shown = data.calls.filter(call => tab === 'attention' ? attention(call) : true)
    .filter(call => !needle || [call.from, call.ticket?.issue, call.ticket?.address, ...(call.transcript || []).flatMap(line => [line.textSource, line.textShown])].some(text => text?.toLowerCase().includes(needle)));
  const groups = [['TODAY', 0], ['YESTERDAY', 1], ['EARLIER', 2]].map(([label, day]) => [label, shown.filter(call => Math.min(daysAgo(call.startedAt), 2) === day)]).filter(([, calls]) => calls.length);
  const tabs = [{ key: 'all', label: 'All' }, { key: 'attention', label: 'Needs attention' }];
  return <>
    <Toolbar />
    <Title title="Calls" sub={`This week · ${week.length} call${week.length === 1 ? '' : 's'} · ${longMinutes(week.reduce((sum, call) => sum + length(call), 0))} translated`} />
    <Tabs items={tabs} value={tab} onChange={setTab} />
    <ReadBar><Search size={14} /><input value={q} placeholder="Search callers, notes, or what was said" aria-label="Search calls" onChange={event => setQ(event.target.value)} /></ReadBar>
    <Body>
      <Explainer
        id="calls" puff="squish" color="#2F6FE0"
        title={<>Every call, <em>kept</em>.</>}
        sub="What was said, in both languages, line by line, and whatever note you left at the end. Nothing is thrown away when the caller hangs up."
        examples={[
          { say: 'the transcript', then: 'what they said and what you answered' },
          { say: 'the note', then: 'what it was about, ready for a ticket' },
        ]}
        action={{ label: 'Open the latest', onClick: () => { const first = (common.data.calls || [])[0]; common.navigate(first ? `/calls/${first.id}` : '/desk'); } }}
      />
      {!groups.length ? (data.calls.length ? <Empty title="Nothing here.">{needle ? `No call mentions “${q.trim()}”.` : tab === 'mine' ? 'None of these calls were answered by you.' : 'Nothing needs attention.'}</Empty> : <Empty title="No calls yet.">Calls appear here as they come in.</Empty>)
        : groups.map(([label, calls], index) => <React.Fragment key={label}>
          <Label style={{ margin: index ? '22px 0 4px' : '0 0 4px' }}>{label}</Label>
          {calls.map(call => { const agent = agentOf(call); const main = firstLine(call.ticket?.issue) || call.from || 'Caller'; const [tone, text] = statusOf(call);
            const sub = [when(call.startedAt), main !== call.from && call.from, pair(call), call.state === 'ended' ? (call.answeredAt ? formatDuration(length(call)) : 'not answered') : null, agent?.name].filter(Boolean).join(' · ');
            return <Row key={call.id} lead={<Avatar who={agent || (call.answeredAt ? 'workspace' : '')} size={30} face={!!agent} />} main={main} sub={sub} title={call.error || undefined} right={<Status tone={tone}><span className="calls-clip">{text}</span></Status>} onClick={() => navigate(`/calls/${encodeURIComponent(call.id)}`)} />; })}
        </React.Fragment>)}
    </Body>
    <Ask placeholder="Ask about your calls" scope="calls" />
  </>;
}

function Record({ call, data, navigate, route, setNotice, setError }) {
  const [tab, setTab] = useState(route.query.tab === 'transcript' ? 'transcript' : 'notes');
  const [find, setFind] = useState(null); // null = closed
  if (!call) return <><Toolbar back onBack={() => navigate('/calls')} /><Title title="Calls" /><Body><Empty title="That call is not here.">It may have been removed, or the link is old.</Empty></Body><Ask placeholder="Ask about your calls" scope="calls" /></>;
  const agent = call.agentName ? { name: call.agentName } : null;
  const lines = call.transcript || [];
  const ticket = call.ticket || {};
  const issue = (ticket.issue || '').trim();
  const seconds = length(call);
  const langOf = line => code(line.speaker === 'agent' ? line.targetLang || callerLang(call) : (line.sourceLang && line.sourceLang !== 'und' ? line.sourceLang : callerLang(call)));
  const asText = () => lines.map(line => `${line.speaker === 'agent' ? 'You' : 'Caller'} (${hhmm(line.t)}): ${line.speaker === 'agent' ? line.textSource : line.textShown}`).join('\n');
  const copy = () => navigator.clipboard.writeText(asText()).then(() => setNotice('Transcript copied.'), () => setError('Could not copy the transcript.'));
  const needle = (find || '').trim().toLowerCase();
  const visible = needle ? lines.filter(line => [line.textSource, line.textShown].some(text => text?.toLowerCase().includes(needle))) : lines;
  return <>
    <Toolbar back onBack={() => navigate('/calls')}>
      {call.state === 'ended' && <button type="button" className="ds-tool filled" onClick={() => navigate(`/desk?call=${encodeURIComponent(call.id)}`)}>Open on desk</button>}
      <button type="button" className="ds-tool" aria-label="Copy the transcript" title="Copy the transcript" disabled={!lines.length} onClick={copy}><Copy size={15} /></button>
    </Toolbar>
    <Title title={firstLine(issue) || call.from || 'Caller'} sub={[new Date(call.startedAt).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }), call.answeredAt ? minSec(seconds) : 'not answered', call.from, pair(call), agent?.name].filter(Boolean).join(' · ')} />
    <Tabs items={[{ key: 'notes', label: 'Notes' }, { key: 'transcript', label: 'Transcript' }]} value={tab} onChange={setTab} />
    <ReadBar right={tab === 'transcript' && <>{find === null ? <button type="button" className="ds-tool" aria-label="Search the transcript" onClick={() => setFind('')}><Search size={15} /></button> : <button type="button" className="ds-tool" aria-label="Close search" onClick={() => setFind(null)}><X size={15} /></button>}<button type="button" className="ds-tool" aria-label="Copy the transcript" disabled={!lines.length} onClick={copy}><Copy size={15} /></button></>}>
      {find !== null && tab === 'transcript' ? <input className="calls-find" autoFocus value={find} placeholder="Find in the transcript" aria-label="Find in the transcript" onChange={event => setFind(event.target.value)} /> : <>{lines.length} line{lines.length === 1 ? '' : 's'} · {call.answeredAt ? minSec(seconds) : 'not answered'}</>}
    </ReadBar>
    <Body className={tab === 'notes' ? 'calls-doc' : ''}>
      {tab === 'notes' ? (issue ? <>
        {issue.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        {ticket.address?.trim() && <><h3>Address</h3><p>{ticket.address.trim()}</p></>}
        {needsDispatch(ticket.dispatch) && <><h3>Dispatch</h3><p>{ticket.dispatchConfirmedAt ? `Confirmed at ${hhmm(ticket.dispatchConfirmedAt)}` : ticket.dispatch === 'confirmed' ? 'Confirmed' : 'Requested'}</p></>}
        <p className="ds-note"><TextBtn muted onClick={() => navigate(`/desk?call=${encodeURIComponent(call.id)}`)}>Edit on the desk</TextBtn></p>
      </> : <Empty title="No notes were saved for this call." actions={call.state === 'ended' && <TextBtn onClick={() => navigate(`/desk?call=${encodeURIComponent(call.id)}`)}>Add them on the desk</TextBtn>}>The transcript is still here.</Empty>)
        : !lines.length ? <Empty title="Nothing was said on this call.">{call.answeredAt ? 'No line was captured before it ended.' : 'The call was never answered.'}</Empty>
        : !visible.length ? <p className="ds-note">No line mentions “{find.trim()}”.</p>
        : <div className="calls-lines">{visible.map((line, index) => { const agentLine = line.speaker === 'agent'; const big = agentLine ? line.textSource : line.textShown; const small = agentLine ? line.textShown : line.textSource;
          return <div key={line.id || index} className={`ds-cap ${agentLine ? 'agent' : ''}`}>
            <div className="who">{agentLine ? 'You' : 'Caller'}{agentLine && line.delivery === 'played' && <span className="played"><Check size={11} strokeWidth={2.4} />played</span>}{agentLine && line.delivery === 'pending' && <span className="sending">sending</span>}<time>{hhmm(line.t)}</time></div>
            <p className="big">{big}</p>
            {small && small !== big && <p className="small"><span className="calls-code">{langOf(line)}</span>{small}</p>}
          </div>; })}</div>}
    </Body>
    <Ask placeholder="Ask about this call" scope="call" callId={call.id} />
  </>;
}
