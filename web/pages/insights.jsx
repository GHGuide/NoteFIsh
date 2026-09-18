// Insights: what this desk actually did, in the shape the eye reads fastest — one
// enormous number a card, a small-caps label naming it, the detail underneath.
//
// Every figure here is derived from calls that were really stored. Nothing is padded
// out with a metric that would read as a flattering zero: a card with nothing behind
// it yet says so in words instead of showing a confident 0%.
import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Globe, Info, Link2, MessageSquare, Mic, Monitor, Phone, Share2, Sparkles, Video } from 'lucide-react';
import { Toolbar, Title, Tabs, Body, Row, Bar, Empty, Ask, Avatar } from '../shell.jsx';
import Explainer from '../components/explainer.jsx';
import { languageName } from '../lib.jsx';
import './insights.css';

const DAY = 864e5;
const secs = (a, b) => a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 1000)) : 0;
const words = text => (text || '').trim().split(/\s+/u).filter(Boolean).length;
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const callerLang = call => { const code = call.detectedLanguage || call.customerLanguage; return code && code !== 'auto' ? code : null; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** How long that many minutes really is, so the number means something. */
function asLongAs(minutes) {
  if (minutes >= 600) return 'That is a working week on the phone.';
  if (minutes >= 180) return 'Longer than most flights you have taken.';
  if (minutes >= 90) return 'About the length of a film.';
  if (minutes >= 40) return 'About an album and a half.';
  if (minutes >= 12) return 'About as long as a coffee break.';
  if (minutes > 0) return 'A few minutes of somebody being understood.';
  return '';
}

/** Which icon a call arrived through, by the app the companion named it after. */
function appIcon(name) {
  const text = (name || '').toLowerCase();
  if (/zoom|meet|teams|webex|facetime/.test(text)) return <Video size={14} />;
  if (/whatsapp|messenger|instagram|telegram|signal|discord|slack/.test(text)) return <MessageSquare size={14} />;
  if (/phone|\+\d/.test(text)) return <Phone size={14} />;
  return <Link2 size={14} />;
}

/** A half circle that fills clockwise. Pure SVG: no library, no canvas. */
function Gauge({ pct, top, bottom }) {
  const length = Math.PI * 62;
  const filled = Math.max(0, Math.min(1, pct || 0)) * length;
  return <div className="in-gauge">
    <svg width="150" height="86" viewBox="0 0 150 86" aria-hidden="true">
      <path d="M 13 75 A 62 62 0 0 1 137 75" fill="none" stroke="var(--sheet-line)" strokeWidth="13" strokeLinecap="round" />
      <path d="M 13 75 A 62 62 0 0 1 137 75" fill="none" stroke="var(--green)" strokeWidth="13" strokeLinecap="round" strokeDasharray={`${filled} ${length}`} />
    </svg>
    <span className="mid"><strong>{top}</strong><span>{bottom}</span></span>
  </div>;
}

/** The circular badge from the reference: its text set around a ring. */
function ShareBadge({ onClick }) {
  return <button type="button" className="in-share" onClick={onClick} aria-label="Copy a summary of your month">
    <svg className="ring" viewBox="0 0 76 76" aria-hidden="true">
      <defs><path id="in-ring" d="M 38 38 m -27 0 a 27 27 0 1 1 54 0 a 27 27 0 1 1 -54 0" /></defs>
      <text><textPath href="#in-ring">SHARE · YOUR MONTH · SHARE · YOUR MONTH · </textPath></text>
    </svg>
    <span className="mid" aria-hidden="true"><Share2 size={17} /></span>
  </button>;
}

/** The day grid. A square per day, darker the more calls it held. */
function Heat({ byDay, weeksShown = 19 }) {
  const [back, setBack] = useState(0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const end = new Date(today.getTime() - back * weeksShown * 7 * DAY);
  end.setDate(end.getDate() + (6 - end.getDay())); // finish on a Saturday so columns are whole weeks
  const weeks = [], months = [];
  for (let w = weeksShown - 1; w >= 0; w--) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(end.getTime() - (w * 7 + (6 - d)) * DAY);
      days.push({ date, count: byDay.get(dayKey(date)) || 0, future: date > today });
    }
    weeks.push(days);
    const label = days[0].date.toLocaleDateString([], { month: 'short' });
    if (!months.length || months[months.length - 1].label !== label) months.push({ label, weeks: 1 });
    else months[months.length - 1].weeks++;
  }
  const step = count => count === 0 ? '' : count === 1 ? 'l1' : count <= 3 ? 'l2' : count <= 6 ? 'l3' : 'l4';
  return <div className="in-heat">
    <div className="in-heat-top">
      <div className="in-heat-nav">
        <button type="button" aria-label="Earlier weeks" onClick={() => setBack(back + 1)}><ChevronLeft size={14} /></button>
        <button type="button" aria-label="Later weeks" disabled={back === 0} onClick={() => setBack(Math.max(0, back - 1))}><ChevronRight size={14} /></button>
      </div>
      <div className="months">{months.map((month, index) => <span key={index} style={{ flexBasis: `${100 * month.weeks / weeksShown}%` }}>{month.label}</span>)}</div>
    </div>
    <div className="in-heat-body">
      <div className="in-days">{['Sun', '', 'Tue', '', 'Thu', '', 'Sat'].map((day, index) => <span key={index}>{day}</span>)}</div>
      <div className="in-weeks">
        {weeks.map((days, index) => <div className="in-week" key={index}>
          {days.map(day => <i
            key={day.date.toISOString()}
            className={`in-cell ${day.future ? 'void' : step(day.count)}`}
            title={day.future ? '' : `${day.date.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${plural(day.count, 'call')}`}
          />)}
        </div>)}
      </div>
    </div>
    <div className="in-legend">
      <span>Less</span>
      {['#DEDBD4', '#D6E7DB', '#9CC7A9', '#5E9C72', 'var(--green)'].map(colour => <i key={colour} style={{ background: colour }} />)}
      <span>More</span>
    </div>
  </div>;
}

/** One row of the where-from card: an icon, a bar with its share written inside it. */
function AppBar({ name, count, pct, note }) {
  const [tip, setTip] = useState(false);
  return <div className="in-app">
    <span className="ic">{appIcon(name)}</span>
    <button
      type="button" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}
      onFocus={() => setTip(true)} onBlur={() => setTip(false)} aria-label={`${name}: ${note}`}
    >
      <span className="track">
        <span className={`fill ${pct >= 12 ? '' : 'thin'}`} style={{ width: `${Math.max(4, pct)}%` }}>{Math.round(pct)}%</span>
        {tip && <span className="in-tip" role="tooltip"><strong>{name}</strong><span>{note}</span><i /></span>}
      </span>
    </button>
    <span className="cap">{count} {name}</span>
  </div>;
}

export default function InsightsPage({ data, route, navigate, setNotice, setError }) {
  const [tab, setTab] = useState(route.query.tab === 'voice' ? 'voice' : 'desk');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);

  const m = useMemo(() => {
    const calls = data.calls || [];
    const month = calls.filter(call => Date.parse(call.startedAt) >= now - 30 * DAY);
    const previous = calls.filter(call => { const at = Date.parse(call.startedAt); return at >= now - 60 * DAY && at < now - 30 * DAY; });
    const answered = month.filter(call => call.answeredAt);
    const talk = list => list.reduce((sum, call) => sum + secs(call.answeredAt, call.endedAt), 0);
    const minutes = Math.round(talk(month) / 60), lastMinutes = Math.round(talk(previous) / 60);

    const mine = month.flatMap(call => call.transcript || []).filter(line => line.speaker === 'agent');
    const played = mine.filter(line => line.delivery === 'played');
    const failed = mine.filter(line => line.delivery === 'failed');
    const spokenWords = played.reduce((sum, line) => sum + words(line.textShown), 0);

    const bridged = month.filter(call => call.via === 'companion');
    const count = (list, of) => [...list.reduce((map, item) => { const key = of(item); return key ? map.set(key, (map.get(key) || 0) + 1) : map; }, new Map())].sort((a, b) => b[1] - a[1]);
    const byApp = count(bridged, call => call.from || 'Call');
    const byVoice = count(month, call => call.agentName);
    const byFeeling = count(mine, line => line.feeling);
    const byLang = [...month.reduce((map, call) => { const code = callerLang(call); if (code) map.set(code, [...(map.get(code) || []), call]); return map; }, new Map())].sort((a, b) => b[1].length - a[1].length);

    const byDay = new Map();
    for (const call of calls) if (call.answeredAt) {
      const key = dayKey(new Date(Date.parse(call.answeredAt)));
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }
    const run = from => { let n = 0; const day = new Date(from); day.setHours(0, 0, 0, 0); while (byDay.has(dayKey(day))) { n++; day.setDate(day.getDate() - 1); } return n; };
    const today = new Date(now);
    const streak = byDay.has(dayKey(today)) ? run(today) : run(new Date(now - DAY));
    let longest = 0;
    for (const key of byDay.keys()) { const [y, mo, d] = key.split('-').map(Number); longest = Math.max(longest, run(new Date(y, mo - 1, d))); }

    const waits = answered.map(call => secs(call.startedAt, call.answeredAt)).sort((a, b) => a - b);
    return {
      calls, month, answered, minutes, mine, played, failed, spokenWords, bridged,
      byApp, byLang, byVoice, byFeeling, byDay, streak, longest,
      median: waits.length ? waits[Math.floor(waits.length / 2)] : 0,
      trend: lastMinutes > 0 ? Math.round(100 * (minutes - lastMinutes) / lastMinutes) : null,
    };
  }, [data.calls, now]);

  const share = async () => {
    const text = `NoteFish · last 30 days\n${plural(m.answered.length, 'call')} answered · ${plural(m.minutes, 'minute')} translated\n${plural(m.played.length, 'reply', 'replies')} spoken in my own voice across ${plural(m.byLang.length, 'language')}`;
    try { await navigator.clipboard.writeText(text); setNotice?.('Copied your month to the clipboard.'); }
    catch { setError?.('Clipboard access is unavailable. Select the numbers and copy them by hand.'); }
  };

  const nothing = !m.calls.length;
  const rate = m.month.length ? m.answered.length / m.month.length : 0;
  const named = m.month.filter(call => call.agentName).length;

  return <>
    <Toolbar />
    <Title title="Insights" sub="The last 30 days on this desk" />
    {!nothing && <div className="ds-col wide" style={{ position: 'relative', height: 0 }}><ShareBadge onClick={share} /></div>}
    <Tabs items={[{ key: 'desk', label: 'Your desk' }, { key: 'voice', label: 'Your voice' }]} value={tab} onChange={setTab} />
    <Body wide>
      <Explainer
        id="insights" puff="pom" color="#3C8A4E"
        title={<>Everything this desk did, <em>counted</em>.</>}
        sub="Every number here comes from calls that really happened. A card with nothing behind it yet says so, rather than showing you a confident zero."
        examples={[
          { say: 'a green day', then: 'a day you answered somebody' },
          { say: 'replies in your voice', then: 'lines the caller heard as you' },
        ]}
        action={{ label: 'Go to the desk', onClick: () => navigate('/desk') }}
      />

      {nothing ? <Empty icon={<Sparkles size={26} />} title="Nothing to count yet">
        Answer a call and this fills in: how long you talked, which languages came up, and which of your voices did the talking.
      </Empty> : tab === 'desk' ? <>
        <div className="in-grid">
          <div className="in-card">
            <span className="in-n">{m.answered.length}</span>
            <span className="in-lab">Calls answered</span>
            <Gauge pct={rate} top={`${Math.round(rate * 100)}%`} bottom={`of ${plural(m.month.length, 'call')}`} />
            <div className="in-line">{!m.answered.length ? 'Nothing answered yet this month' : m.median ? <>Picked up in <b>{m.median}s</b> typically</> : 'Picked up on the spot'}</div>
          </div>

          <div className="in-card">
            <span className="in-n">{m.played.length}</span>
            <span className="in-lab">Replies in your voice <Info size={12} aria-label="Lines you spoke that were translated and played to the caller" /></span>
            <div className="in-rule" />
            <div className="in-line"><b>{m.spokenWords.toLocaleString()}</b> words spoken aloud</div>
            <div className={`in-line ${m.failed.length ? 'warn' : ''}`}>{m.failed.length ? <><b>{m.failed.length}</b> never played</> : 'Every reply reached the caller'}</div>
          </div>

          <div className="in-card">
            {m.trend !== null && m.trend !== 0 && <span className={`in-trend ${m.trend < 0 ? 'down' : ''}`}>{m.trend > 0 ? '↗' : '↘'} {Math.abs(m.trend)}% this month</span>}
            <span className="in-n">{m.minutes.toLocaleString()}</span>
            <span className="in-lab">Minutes translated</span>
            {asLongAs(m.minutes) && <p className="in-say">{asLongAs(m.minutes)}</p>}
            <div className="in-split">
              {m.bridged.length > 0 && <span className="a" style={{ flexGrow: m.bridged.length }}><Monitor size={13} />{m.bridged.length} bridged</span>}
              {m.month.length - m.bridged.length > 0 && <span className="b" style={{ flexGrow: m.month.length - m.bridged.length }}><Link2 size={13} />{m.month.length - m.bridged.length} direct</span>}
              {!m.month.length && <span className="none">Nothing this month</span>}
            </div>
          </div>
        </div>

        <div className="in-grid two">
          <div className="in-card">
            <div className="in-head"><h3>Where they called from</h3><span className="in-lab">Apps bridged | {m.byApp.length}</span></div>
            {!m.byApp.length
              ? <p className="ds-note" style={{ marginTop: 16 }}>Nothing bridged this month. Turn on Listen for calls in the menu bar and NoteFish picks up Zoom, Meet and WhatsApp by itself.</p>
              : <div className="in-apps">{m.byApp.slice(0, 6).map(([name, n]) => <AppBar key={name} name={name} count={n} pct={100 * n / m.bridged.length} note={`${plural(n, 'call')} · ${Math.round(100 * n / m.bridged.length)}% of everything bridged`} />)}</div>}
          </div>

          <div className="in-card">
            <div className="in-head"><h3>{m.streak}-day streak</h3><span className="in-lab">Longest | {plural(m.longest, 'day')}</span></div>
            <Heat byDay={m.byDay} />
          </div>
        </div>
      </> : <div style={{ marginTop: 4 }}>
        <h3>Languages they spoke</h3>
        {!m.byLang.length ? <p className="ds-note">No caller language has been recorded yet.</p> : <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 8 }}>
            {m.byLang.slice(0, 6).map(([code, calls]) => <Bar key={code} label={languageName(code)} pct={100 * calls.length / m.month.length} />)}
          </div>
          <div style={{ marginTop: 16 }}>
            {m.byLang.map(([code, calls]) => <Row
              key={code} lead={<span className="lead box"><Globe size={14} /></span>} main={languageName(code)}
              sub={`${plural(calls.length, 'call')} · ${Math.round(calls.reduce((sum, call) => sum + secs(call.answeredAt, call.endedAt), 0) / 60)} min`}
              right={<span className="ds-chip">{code.toUpperCase()}</span>}
            />)}
          </div>
        </>}

        <h3 style={{ marginTop: 26 }}>Which voice answered</h3>
        {!m.byVoice.length ? <p className="ds-note">No call has been answered in a voice yet.</p>
          : m.byVoice.map(([name, n]) => <Row key={name} lead={<Avatar who={name} size={28} />} main={name} sub={`${plural(n, 'call')} answered`} right={<span className="ds-chip">{Math.round(100 * n / named)}%</span>} />)}

        {m.byFeeling.length > 0 && <>
          <h3 style={{ marginTop: 26 }}>How you came across</h3>
          <p className="ds-note" style={{ marginBottom: 10 }}>The tone each reply was spoken with, chosen by you or read from the caller.</p>
          {m.byFeeling.map(([feeling, n]) => <Row
            key={feeling} lead={<span className="lead box"><Mic size={14} /></span>}
            main={feeling.charAt(0).toUpperCase() + feeling.slice(1)} sub={plural(n, 'reply', 'replies')}
            right={<span className="ds-chip">{Math.round(100 * n / m.mine.length)}%</span>}
          />)}
        </>}
      </div>}
    </Body>
    <Ask placeholder="Ask about the last month" scope="calls" />
  </>;
}
