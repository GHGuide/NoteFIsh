// Insights: the last seven days in six numbers, the languages callers spoke, and who answered.
import React, { useState } from 'react';
import { Toolbar, Title, Tabs, Body, Row, Stat, Bar, Status, Avatar, Ask } from '../shell.jsx';
import { languageName } from '../lib.jsx';

const secs = (a, b) => a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)) : 0;
const hm = s => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h ${m} m` : `${m} m`; };
const callerLang = call => { const l = call.detectedLanguage || call.customerLanguage; return l && l !== 'auto' ? l : null; };
const TONE = { available: 'green', on_call: 'amber', paused: 'muted', offline: 'muted' };

export default function InsightsPage({ data, route }) {
  const [tab, setTab] = useState(route.query.tab || 'overview');
  const end = new Date(), start = new Date(Date.now() - 6 * 864e5); start.setHours(0, 0, 0, 0);
  const week = data.calls.filter(call => new Date(call.startedAt) >= start);
  const answered = week.filter(call => call.answeredAt);
  const minutes = calls => calls.reduce((sum, call) => sum + secs(call.answeredAt, call.endedAt), 0);
  const byLang = Object.entries(week.reduce((map, call) => { const l = callerLang(call); if (l) map[l] = [...(map[l] || []), call]; return map; }, {})).sort((a, b) => b[1].length - a[1].length);
  const spoken = byLang.reduce((sum, [, calls]) => sum + calls.length, 0);
  const short = d => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const bars = list => <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 4 }}>{list.map(([l, calls]) => <Bar key={l} label={languageName(l)} pct={100 * calls.length / spoken} />)}</div>;
  const tabs = [{ key: 'overview', label: 'Overview' }, { key: 'languages', label: 'Languages' }];
  return <>
    <Toolbar />
    <Title title="Insights" sub={`Last 7 days · ${short(start)} – ${start.getMonth() === end.getMonth() ? end.getDate() : short(end)}`} />
    <Tabs items={tabs} value={tab} onChange={setTab} />
    <Body>
      {tab === 'overview' && <>
        <div className="ds-stats">
          <Stat n={answered.length} label="Calls answered" />
          <Stat n={hm(minutes(week))} label="Minutes translated" />
          <Stat n={week.reduce((sum, call) => sum + (call.transcript || []).filter(line => line.speaker === 'agent' && line.delivery === 'played').length, 0)} label="Replies spoken" />
          <Stat n={week.filter(call => call.ticket?.issue?.trim()).length} label="Notes saved" />
          <Stat n={byLang.length} label="Languages served" />
          <Stat n={week.filter(call => secs(call.startedAt, call.answeredAt) > 60).length} label="Waited over a minute" />
        </div>
        {!week.length ? <p className="ds-note" style={{ marginTop: 18 }}>Nothing this week yet.</p> : byLang.length > 0 && <><h3>Languages this week</h3>{bars(byLang.slice(0, 5))}</>}
      </>}
      {tab === 'languages' && (!byLang.length ? <p className="ds-note">Nothing this week yet.</p> : <>
        {bars(byLang)}
        <div style={{ marginTop: 18 }}>{byLang.map(([l, calls]) => <Row key={l} main={languageName(l)} sub={`${calls.length} call${calls.length === 1 ? '' : 's'} · ${hm(minutes(calls))}`} right={<span className="ds-chip">{l.toUpperCase()}</span>} />)}</div>
      </>)}
    </Body>
    <Ask placeholder="Ask about this week" scope="calls" />
  </>;
}
