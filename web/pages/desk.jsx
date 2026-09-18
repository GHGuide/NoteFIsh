// The desk: one call as plain reading. Captions above, a pill composer below;
// the ringing card, the notes form and the ended summary are the same sheet in
// different moments. Between calls it is a home screen: a welcome, a dark
// banner with the next thing to do, this week's numbers, recent calls.
// Behaviour is the old Desk's (recorder, PTT keys, invitations, ticket
// saving); the clothes are design/build.py desk_screen() and design/moments.py
// desk_ringing / desk_ticket / desk_ended.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, Globe2, Link2, Maximize2, Mic, MicOff, Phone, PhoneOff, Play, Send, Share2, Volume2 } from 'lucide-react';
import { api } from '../api.js';
import { Toolbar, Title, Tabs, Body, Col, Label, Dot, Status, Chip, Row, Btn, TextBtn, Pill, SelectPill, Field, Switch, Wave, Typing, Empty, Spinner, Ask, Avatar, Puff, SWATCHES } from '../shell.jsx';
import { languages, languageName, REGISTERS, useCapture, callState, isArchived, needsDispatch, stamp, formatDuration } from '../lib.jsx';
import './desk.css';

const transportLabel = call => call?.transport === 'twilio' ? 'phone' : call?.transport === 'companion' ? 'companion' : 'browser link';
const and = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';
const day = value => value ? new Date(value).toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';
const since = (from, to = Date.now()) => Math.max(0, Math.floor((to - new Date(from).getTime()) / 1000));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const LANGUAGE_OPTIONS = [{ value: 'auto', label: 'Detect automatically' }, ...languages.map(item => ({ value: item.code, label: item.name }))];
/** The caller's language code for the small line under a caption ("FR"). */
const codeOf = (line, call) => { const code = (line?.speaker === 'agent' ? line.targetLang : line?.sourceLang && line.sourceLang !== 'und' ? line.sourceLang : '') || call?.detectedLanguage || call?.customerLanguage || ''; return code && code !== 'auto' ? code.toUpperCase() : ''; };
// The home screen's list draws a call the way the Calls page does (same words, same status).
const hhmm = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const midnight = d => { const m = new Date(d); m.setHours(0, 0, 0, 0); return m; };
const daysAgo = t => Math.round((midnight(Date.now()) - midnight(t)) / 864e5);
const monday = () => { const d = midnight(Date.now()); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d; };
const secs = (a, b) => a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 1000)) : 0;
const short = l => l && l !== 'auto' ? l.slice(0, 2).toUpperCase() : '';
const pair = call => [short(call.detectedLanguage || call.customerLanguage), short(call.agentLanguage)].filter(Boolean).join(' → ');
const firstLine = text => (text || '').trim().split('\n')[0].trim();
const dayLabel = t => { const d = daysAgo(t); return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : new Date(t).toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }); };
const statusOf = call => callState(call) === 'in_call' ? ['green', 'On the line'] : callState(call) === 'ringing' ? ['green', 'Ringing']
  : call.error ? ['red', /play|deliver/i.test(call.error) ? 'Delivery failed' : call.error.split(/(?<=[.!?])\s/)[0]]
  : firstLine(call.ticket?.issue) ? ['green', 'Notes saved'] : !call.answeredAt ? ['muted', 'Not answered'] : ['muted', 'Transcript saved'];

/** One caption: who, the line in the agent's language, the other language underneath. */
function Caption({ line, code, partial = false }) {
  const agent = line.speaker === 'agent';
  const small = line.textSource !== line.textShown ? (agent ? line.textShown : line.textSource) : '';
  return <div className={`ds-cap ${agent ? 'agent' : ''} ${partial ? 'partial' : ''}`}>
    <div className="who">{agent ? 'You' : 'Caller'}{partial && <Typing />}{line.delivery === 'played' && <span className="played"><Check size={11} strokeWidth={2.4} />played</span>}{line.delivery === 'pending' && <span className="sending">sending…</span>}{line.feeling && <span className="feel">{line.feeling}</span>}{line.t && <time>{stamp(line.t)}</time>}</div>
    <p className="big">{agent ? line.textSource : line.textShown}</p>
    {small && <p className="small">{code && <span className="desk-code">{code}</span>}{small}</p>}
  </div>;
}

export default function DeskPage({ data, navigate, route, setError, setNotice, saveOwned, owned, updateCall, connection, invitation, setInvitation, focus, setFocus, enableAudio, clearAudio, setAudioMuted, user, voice: myVoice, partialCaption }) {
  const [selectedCallId, setSelectedCallId] = useState(route.query.call || '');
  useEffect(() => { if (route.query.call) setSelectedCallId(route.query.call); }, [route.query.call]);
  const ringingCalls = data.calls.filter(item => callState(item) === 'ringing');
  const liveCall = data.calls.find(item => callState(item) === 'in_call') || ringingCalls[0];
  const call = liveCall || data.calls.find(item => item.id === selectedCallId) || null;
  const active = callState(call) === 'in_call';
  const ringing = callState(call) === 'ringing';
  const ended = !!call && !active && !ringing;
  const [tab, setTab] = useState('captions');
  useEffect(() => { setTab(ended ? 'transcript' : 'captions'); }, [call?.id, ended]);
  const [busy, setBusy] = useState('');
  const [reply, setReply] = useState('');
  // How the next reply should sound. 'auto' lets the desk decide from the clip and the caller.
  const [feeling, setFeeling] = useState('auto');
  const feelingRef = useRef('auto'); feelingRef.current = feeling;
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const microphoneMutedRef = useRef(false);
  const [languageSaving, setLanguageSaving] = useState(false);
  const [ticket, setTicket] = useState({ issue: '', address: '' });
  const [now, setNow] = useState(Date.now());
  const [newCaptions, setNewCaptions] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const scroller = useRef(null);
  const followTranscript = useRef(true);
  const pointerHeld = useRef(false);
  const activeRef = useRef(call); activeRef.current = call;
  // The server answers with the desk's own voice and languages.
  const agentLanguage = owned('agentLanguage') || data.settings.agentLanguage;
  const customerLanguage = owned('customerLanguage') || data.settings.customerLanguage;
  const voice = data.voices.find(item => item.id === (owned('voiceId') || data.settings.voiceId) && item.status === 'ready' && !isArchived(item));
  const phase = call?.phase || 'listening';
  const processing = active && !['listening', 'idle'].includes(phase);
  const canTalk = active && !!voice && !busy && !languageSaving && !processing && connection === 'connected';
  const capture = useCapture(async (blob, duration) => {
    if (microphoneMutedRef.current) return;
    if (duration < .3) { setNotice('Hold a little longer to record your reply.'); return; }
    const current = activeRef.current;
    if (callState(current) !== 'in_call') return;
    setBusy('reply');
    try { const result = await api.ptt(current.id, blob, feelingRef.current); updateCall(result.call); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(''); }
  }, 45);
  useEffect(() => { if (capture.error) setError(capture.error); }, [capture.error]);
  useEffect(() => { microphoneMutedRef.current = false; setMicrophoneMuted(false); }, [active, call?.id]);
  useEffect(() => { setFeeling('auto'); }, [call?.id]);
  useEffect(() => { setTicket({ issue: call?.ticket?.issue || '', address: call?.ticket?.address || '' }); }, [call?.id]);
  useEffect(() => { if (!active) { capture.stop(true); clearAudio(); } }, [active, call?.id]);
  useEffect(() => { if (!(active || ringing || invitation)) return; setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [active, ringing, !!invitation]);
  useEffect(() => { followTranscript.current = true; setNewCaptions(false); }, [call?.id]);
  useEffect(() => {
    if (!scroller.current) return;
    if (followTranscript.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    else if (call?.transcript?.length) setNewCaptions(true);
  }, [call?.id, call?.transcript?.length, partialCaption?.text, tab]);
  // Fonts, a growing partial line or a resized window all move the bottom; keep following it.
  useEffect(() => {
    const el = scroller.current;
    if (!el?.firstElementChild) return;
    const observer = new ResizeObserver(() => { if (followTranscript.current) el.scrollTop = el.scrollHeight; });
    observer.observe(el); observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [tab, call?.id, (call?.transcript?.length || 0) > 0]);
  useEffect(() => { if (liveCall) { setSelectedCallId(liveCall.id); setInvitation(null); } }, [liveCall?.id]);
  useEffect(() => { setAudioMuted(capture.recording || capture.requesting || processing || busy === 'reply'); return () => setAudioMuted(false); }, [capture.recording, capture.requesting, processing, busy]);
  const startTalk = useCallback(() => { if (canTalk && !microphoneMutedRef.current) { clearAudio(); capture.start().catch(failure => setError(failure.message)); } }, [canTalk, capture.start]);
  const toggleMicrophone = () => { const muted = !microphoneMutedRef.current; microphoneMutedRef.current = muted; if (muted) { pointerHeld.current = false; capture.stop(true); } setMicrophoneMuted(muted); };
  // Inside the Mac app, ⌥Space anywhere is the same hold-to-speak key.
  useEffect(() => {
    const tauri = window.__TAURI__;
    if (!tauri?.event?.listen) return;
    let unlisten; tauri.event.listen('ptt', event => { if (event.payload) startTalk(); else capture.stop(); }).then(fn => { unlisten = fn; });
    return () => unlisten?.();
  }, [startTalk, capture.stop]);
  useEffect(() => {
    const down = event => {
      if (event.key === 'Escape') { capture.stop(true); return; }
      if (event.code !== 'Space' || event.repeat || event.target?.closest?.('input, textarea, select, [contenteditable="true"], a, button:not([data-ptt])')) return;
      event.preventDefault(); startTalk();
    };
    const up = event => { if (event.code === 'Space') capture.stop(); };
    const cancel = () => capture.stop(true);
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', cancel); document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', visibility); };
  }, [startTalk, capture.stop]);
  const action = async (name, fn) => { setBusy(name); try { const result = await fn(); if (result?.call) updateCall(result.call); } catch (failure) { setError(failure.message); } finally { setBusy(''); } };
  // Notes save on their own, a moment after typing stops, without blocking the mic.
  const saveTicket = async patch => { try { const result = await api.ticket(call.id, patch); updateCall(result.call); } catch (failure) { setError(failure.message); } };
  useEffect(() => {
    if (!call || (ticket.issue === (call.ticket?.issue || '') && ticket.address === (call.ticket?.address || ''))) return;
    const timer = setTimeout(() => saveTicket({ issue: ticket.issue, address: ticket.address }), 600);
    return () => clearTimeout(timer);
  }, [ticket.issue, ticket.address]);
  const browserReady = !!voice && data.setup?.ready && connection === 'connected' && !busy;
  const inviteExpired = invitation && new Date(invitation.expiresAt).getTime() <= now;
  const createInvitation = async () => {
    setInviteBusy(true);
    try {
      await enableAudio();
      // Ask before the call, so the first held reply is not lost to a permission prompt.
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open NoteFish over HTTPS to use your microphone.');
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      microphone.getTracks().forEach(track => track.stop());
      const created = await api.createInvitation(); setInvitation(created); setNow(Date.now()); setSelectedCallId(''); setNotice('Link ready. Copy it and send it to the caller.');
    }
    catch (failure) { setError(failure.name === 'NotAllowedError' ? 'Allow microphone access in your browser, then create the call link again.' : failure.message); }
    finally { setInviteBusy(false); }
  };
  const changeCallerLanguage = async next => {
    setLanguageSaving(true);
    try { if (await saveOwned({ customerLanguage: next })) setNotice(`Caller language changed to ${next === 'auto' ? 'detect automatically' : languageName(next)}. New phrases and replies use this language.`); }
    finally { setLanguageSaving(false); }
  };
  const copyInvitation = async () => { try { await navigator.clipboard.writeText(invitation.url); setNotice('Call link copied. Share it with the person calling you.'); } catch { setError('Select and copy the call link manually. Clipboard access is unavailable.'); } };
  const shareInvitation = async () => { try { await navigator.share({ title: 'NoteFish call', text: 'Open this link on your phone and tap Call.', url: invitation.url }); } catch (failure) { if (failure.name !== 'AbortError') setError(failure.message); } };
  const sendTyped = event => { event.preventDefault(); const text = reply.trim(); if (!text || !canTalk) return; action('reply', async () => { const result = await api.say(call.id, text, feeling); setReply(''); return result; }); };
  const speakPhrase = text => action('reply', () => api.say(call.id, text, feeling));
  const onScroll = event => { const el = event.currentTarget; followTranscript.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; if (followTranscript.current) setNewCaptions(false); };
  const scrollToLatest = () => { followTranscript.current = true; setNewCaptions(false); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; };
  const nextCall = () => { setSelectedCallId(''); if (route.query.call) navigate('/desk'); };

  // ---- what to say about this call
  const transcript = call?.transcript || [];
  const replies = transcript.filter(line => line.speaker === 'agent');
  const lastAgentLine = replies.at(-1);
  const callerCode = call?.detectedLanguage || (call ? call.customerLanguage : customerLanguage) || '';
  const target = callerCode !== 'auto' ? callerCode : '';
  const targetName = target ? languageName(target) : 'their language';
  const callerLanguage = call?.detectedLanguage ? `${languageName(call.detectedLanguage)}, detected` : target ? languageName(target) : 'detecting…';
  const previous = call?.from ? data.calls.filter(item => item.id !== call.id && item.from === call.from && callState(item) === 'ended').sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)) : [];
  const last = previous[0];
  const spokeAs = call?.agentName || myVoice?.name || '';
  const mostly = Object.entries(replies.reduce((counts, line) => line.feeling ? { ...counts, [line.feeling]: (counts[line.feeling] || 0) + 1 } : counts, {})).sort((a, b) => b[1] - a[1])[0]?.[0];
  const length = ended ? (call.answeredAt ? formatDuration(since(call.answeredAt, new Date(call.endedAt || Date.now()).getTime())) : 'not answered') : '';
  const waiting = ringingCalls.length;
  const quick = (owned('phrases') || []).slice(0, 3);
  const zendesk = data.setup?.integrations?.zendesk?.configured;
  const firstName = (user?.name || '').trim().split(/\s+/)[0];
  const title = !call ? (firstName ? `Welcome back, ${firstName}` : 'Welcome to your desk') : ended ? 'Call ended' : ringing ? 'Incoming call' : call.from || 'Caller';
  const sub = !call ? (voice ? `Ready for a call · ${voice.name}` : 'Record a voice first')
    : ringing ? `${call.from || 'Caller'} · ${transportLabel(call)} · language on answer`
    : active ? `Live · ${formatDuration(since(call.answeredAt || call.startedAt, now))} · ${transportLabel(call)} · ${callerLanguage}`
    : [call.from || 'Caller', length, target && languageName(target), spokeAs && `spoke as ${spokeAs}${mostly ? `, mostly ${mostly}` : ''}`].filter(Boolean).join(' · ');
  const recording = capture.recording || capture.requesting;
  const replying = processing || busy === 'reply';
  const partial = partialCaption && partialCaption.callId === call?.id ? partialCaption : null;
  const emptyNote = active ? `What they say appears here in ${languageName(call.agentLanguage || agentLanguage)}, as they speak.` : 'Nothing was said on this call.';

  const captions = <div className="ds-col desk-scroll" ref={scroller} onScroll={onScroll} role="log" aria-live="polite" aria-relevant="additions text">
    {!transcript.length && !partial ? <Empty icon={<AudioLines size={34} strokeWidth={1} />} title="The conversation appears here.">{emptyNote}</Empty>
      : <div className="ds-caps">{transcript.map((line, index) => <Caption key={line.id || index} line={line} code={codeOf(line, call)} />)}{partial && <Caption partial line={{ speaker: 'customer', textSource: partial.text, textShown: partial.shown || partial.text }} code={codeOf(null, call)} />}</div>}
  </div>;
  const dispatch = needsDispatch(call?.ticket?.dispatch);
  const notes = !call ? <Body><Empty title="Notes open with the next call.">They are saved with its transcript.</Empty></Body> : <>
    <Col className="desk-scroll" style={{ marginTop: 16 }}><div className="ds-stack">
      <Field label="Summary"><textarea rows={3} maxLength={4000} value={ticket.issue} onChange={event => setTicket({ ...ticket, issue: event.target.value })} /></Field>
      <Field label="Address or location"><input maxLength={1000} value={ticket.address} onChange={event => setTicket({ ...ticket, address: event.target.value })} /></Field>
      <div className="ds-toggle-row"><Switch checked={dispatch} label="Dispatch requested" onChange={on => saveTicket({ dispatch: on ? 'requested' : 'none' })} /><div><strong>Dispatch requested</strong><span>Confirm with the caller before ending the call</span></div>{call.ticket?.dispatchConfirmedAt ? <span className="ds-status green"><Check size={12} strokeWidth={2.4} />confirmed</span> : dispatch && <TextBtn onClick={() => saveTicket({ confirmDispatch: true })}>Confirm dispatch</TextBtn>}</div>
    </div></Col>
    <Col className="ds-foot"><span className="desk-left"><CheckCircle2 size={13} />Saved as you type · {zendesk ? 'goes to Zendesk with the transcript when the call ends' : 'saved with the transcript'}</span>{active && <Btn small onClick={() => setTab('captions')}>Back to captions</Btn>}</Col>
  </>;
  const facts = call?.from && !ringing ? <Col className="ds-facts">
    <span><Phone size={13} />{previous.length ? `${plural(previous.length, 'earlier call')} · last ${day(last.startedAt)}` : 'First call from this number'}</span>
    {last?.ticket?.issue && <span><CheckCircle2 size={13} />Last ticket · {last.ticket.issue}</span>}
    {last && <TextBtn onClick={() => navigate(`/calls/${last.id}`)}>Open last call<ChevronRight size={12} /></TextBtn>}
  </Col> : null;
  const hint = recording ? `The caller hears ${targetName} in your voice when you let go.` : `Hold ${window.__TAURI__ ? '⌥ Space' : 'Space'} anywhere, or the mic. The caller hears ${targetName} in your voice.`;

  // ---- the home screen, between calls
  const takes = REGISTERS.filter(item => (owned('registers') || {})[item.key]).length;
  const voiceReady = data.voices.some(item => item.kind === 'enrolled' && item.status === 'ready' && !item.archived && !item.archivedAt); // one recording is enough
  const week = data.calls.filter(item => new Date(item.startedAt) >= monday());
  const minutes = Math.round(week.reduce((sum, item) => sum + secs(item.answeredAt, item.endedAt), 0) / 60);
  const answeredDays = new Set(data.calls.filter(item => item.answeredAt).map(item => daysAgo(item.startedAt)));
  let streak = 0; for (let d = answeredDays.has(0) ? 0 : 1; answeredDays.has(d); d++) streak++;
  const recent = data.calls.slice().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, 8);
  const groups = recent.reduce((list, item) => { const label = dayLabel(item.startedAt); if (list.at(-1)?.[0] === label) list.at(-1)[1].push(item); else list.push([label, [item]]); return list; }, []);
  const agentOf = item => (item.agentName ? { name: item.agentName } : null);
  const inviteNote = !voice ? 'Choose a voice first.' : inviteExpired ? 'Your previous link expired. Create a fresh one.' : !browserReady ? (connection !== 'connected' ? 'Reconnecting to the desk…' : data.setup?.blockers?.[0] || 'Finishing call setup…') : 'The caller opens it on their phone and taps Call.';
  const invite = invitation && !inviteExpired ? <div className="desk-invite">
    <div className="ds-copyrow"><input readOnly aria-label="Caller invitation link" value={invitation.url} onFocus={event => event.target.select()} /><Btn kind="ghost" small icon={<Copy size={14} />} onClick={copyInvitation}>Copy</Btn>{typeof navigator.share === 'function' && <Btn kind="ghost" small icon={<Share2 size={14} />} onClick={shareInvitation}>Share</Btn>}</div>
    <div className="between"><span className="ds-note">One use · Expires {stamp(invitation.expiresAt)}</span><TextBtn muted disabled={!browserReady || inviteBusy} onClick={createInvitation}>Create a new link</TextBtn></div>
    <p className="ds-note">Try a short conversation: they ask in {customerLanguage === 'auto' ? 'their language' : languageName(customerLanguage)} when the delivery arrives; you answer in {languageName(agentLanguage)}. Headphones on both devices.</p>
  </div>
    : voiceReady ? ((inviteExpired || !browserReady) && <p className="ds-note desk-invite">{inviteNote}</p>)
    : <div className="desk-invite between"><TextBtn icon={inviteBusy ? <Spinner size={13} /> : <Link2 size={13} />} disabled={!browserReady || inviteBusy} onClick={createInvitation}>{inviteBusy ? 'Preparing your call…' : 'Create call link'}</TextBtn><span className="ds-note">{inviteNote}</span></div>;
  const home = <>
    <Col wide className="desk-home">
      <div className="left">
        <div className="desk-banner">
          <div className="text">{voiceReady ? <>
            <h2>Your voice is ready.</h2><p>Send a caller a link, or turn on Listen for calls in the menu bar to catch Zoom and WhatsApp.</p>
            <Btn icon={inviteBusy ? <Spinner size={15} /> : <Link2 size={15} />} disabled={!browserReady || inviteBusy} onClick={createInvitation}>{inviteBusy ? 'Preparing your call…' : 'Create call link'}</Btn>
          </> : <>
            <h2>Make the desk sound like <em>you</em>.</h2><p>One minute of reading aloud is enough. The desk adds the feeling itself; record more takes later if you want them exact.</p>
            <Btn icon={<Mic size={15} />} onClick={() => navigate('/voice?tab=takes')}>Record your voice</Btn>
          </>}</div>
          <div className="desk-art" aria-hidden="true"><Puff variant="bloom" color={SWATCHES[7][1]} size={92} /><Puff variant="pom" color={SWATCHES[4][1]} size={62} face={false} /><Puff variant="sheep" color={SWATCHES[6][1]} size={52} face={false} /><Puff variant="cloud" color={SWATCHES[9][1]} size={44} face={false} /></div>
        </div>
        {invite}
      </div>
      <div className="desk-stats">
        <div className="n"><strong>{week.length}</strong><span>{week.length === 1 ? 'call' : 'calls'} this week</span></div>
        <div className="n"><strong>{minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} m` : minutes}</strong><span>{minutes >= 60 ? 'translated' : 'min translated'}</span></div>
        <div className="n"><strong>{streak}</strong><span>day streak</span></div>
        <div className="voice"><Label>Voice</Label><div className="who"><Avatar who={voice || 'workspace'} size={36} /><div><strong>{voice ? voice.name : 'No voice chosen'}</strong><span>{voice ? (voice.kind === 'licensed' ? 'licensed voice' : 'your voice') : 'Pick one to answer calls'}</span></div><TextBtn onClick={() => navigate('/voice')}>{voice ? 'Change' : 'Choose'}</TextBtn></div></div>
      </div>
    </Col>
    <Body>
      {!recent.length ? <><Label>Recent</Label><p className="ds-note" style={{ marginTop: 8 }}>Your calls will appear here. The first one can be a link you send to your own phone.</p></>
        : groups.map(([label, calls], index) => <React.Fragment key={label}>
          <Label style={{ margin: index ? '22px 0 4px' : '0 0 4px' }}>{label}</Label>
          {calls.map(item => { const agent = agentOf(item); const main = firstLine(item.ticket?.issue) || item.from || 'Caller'; const [tone, text] = statusOf(item);
            const rowSub = [hhmm(item.startedAt), main !== item.from && item.from, pair(item), callState(item) === 'ended' ? (item.answeredAt ? formatDuration(secs(item.answeredAt, item.endedAt)) : 'not answered') : null, agent?.name].filter(Boolean).join(' · ');
            return <Row key={item.id} lead={<Avatar who={agent || (item.answeredAt ? 'workspace' : '')} size={30} face={!!agent} />} main={main} sub={rowSub} title={item.error || undefined} right={<Status tone={tone}><span className="desk-clip">{text}</span></Status>} onClick={() => navigate(`/calls/${encodeURIComponent(item.id)}`)} />; })}
        </React.Fragment>)}
    </Body>
  </>;

  return <>
    <Toolbar><button type="button" className="ds-tool" aria-label="Focus" aria-pressed={focus} onClick={() => setFocus(!focus)}><Maximize2 size={15} /></button></Toolbar>
    <Title title={title} sub={sub} />
    {call && <Tabs items={ended ? [{ key: 'notes', label: 'Notes' }, { key: 'transcript', label: 'Transcript' }] : [{ key: 'captions', label: 'Captions' }, { key: 'notes', label: 'Notes' }]} value={tab} onChange={setTab} />}

    {ringing && <>
      <Col className="ds-strip green"><span className="state"><Dot tone="green" />Ringing · {formatDuration(since(call.startedAt, now))}</span><span className="note">{waiting > 1 ? `${waiting} waiting` : ''}</span></Col>
      <Col className="ds-who"><span className="icon"><Phone size={22} /></span><div><strong>{call.from || 'Caller'}</strong><span>{[transportLabel(call), previous.length ? `${plural(previous.length, 'earlier call')}${last.detectedLanguage || (last.customerLanguage && last.customerLanguage !== 'auto') ? `, spoke ${languageName(last.detectedLanguage || last.customerLanguage)}` : ''}` : 'first call'].join(' · ')}</span></div><div className="actions"><Btn kind="ghost" disabled={!!busy} onClick={() => action('end', () => api.end(call.id))}>Decline</Btn><Btn kind="green" icon={busy === 'answer' ? <Spinner size={15} /> : <Phone size={15} />} disabled={!!busy} onClick={() => action('answer', async () => { await enableAudio(); return api.answer(call.id); })}>Answer</Btn></div></Col>
      <Col className="ds-facts" style={{ marginTop: 12 }}>{last?.ticket?.issue && <span><CheckCircle2 size={13} />Last ticket · {last.ticket.issue}</span>}<span><Globe2 size={13} />Captions in {languageName(agentLanguage)}, you answer in {targetName}</span></Col>
      {tab === 'notes' ? notes : <Body tight>
        {ringingCalls.length > 1 && <><Label style={{ margin: '6px 0 4px' }}>Also waiting</Label>{ringingCalls.filter(item => item.id !== call.id).map((item, index) => <Row key={item.id} solid lead={<span className="lead num">{index + 2}</span>} main={item.from || 'Caller'} sub={`${transportLabel(item)} · language on answer · waiting ${formatDuration(since(item.startedAt, now))}`} />)}</>}
        <p className="ds-note" style={{ marginTop: 16 }}>Answer to start captions. Your first reply matches how the caller sounds on its own — unless you pick a sound.</p>
      </Body>}
    </>}

    {active && <>
      <Col className={`ds-strip ${recording ? 'red' : microphoneMuted && !replying ? 'muted' : ''}`}>
        <span className="state"><Dot tone={recording ? 'red' : microphoneMuted && !replying ? 'muted' : 'green'} />{recording ? 'Recording' : replying ? 'Replying' : microphoneMuted ? 'Muted' : 'Listening'}</span>
        {tab === 'notes' ? <span className="note">Hold {window.__TAURI__ ? '⌥ Space' : 'Space'} to speak from any tab · {call.from || 'the caller'} is on the line</span> : <span className="ctls">
          <span className="desk-pair">{languageName(call.agentLanguage || agentLanguage)}<span className="arrow">→</span><SelectPill aria-label="Caller language" value={customerLanguage} onChange={changeCallerLanguage} options={LANGUAGE_OPTIONS} disabled={languageSaving || connection !== 'connected'} /></span>
          <button type="button" className="ds-pill ctl" aria-pressed={microphoneMuted} onClick={toggleMicrophone}>{microphoneMuted ? <Mic size={13} /> : <MicOff size={13} />}{microphoneMuted ? 'Unmute' : 'Mute'}</button>
          <button type="button" className="ds-pill ctl red" disabled={busy === 'end'} onClick={() => { capture.stop(true); clearAudio(); action('end', () => api.end(call.id)); }}><PhoneOff size={13} />End</button>
        </span>}
      </Col>
      {tab === 'notes' ? notes : <>
        <Col className="ds-pillrow" style={{ marginTop: 12 }}><Label>Sound</Label>{[{ key: 'auto', label: 'Auto' }, ...REGISTERS].map(item => <Pill key={item.key} on={feeling === item.key} onClick={() => setFeeling(item.key)}>{item.label}</Pill>)}{feeling === 'auto' && lastAgentLine?.feeling && <span className="ds-note">last: {lastAgentLine.feeling}</span>}</Col>
        {facts}
        {captions}
        {newCaptions && <Col className="desk-new"><TextBtn onClick={scrollToLatest}>New captions<ChevronDown size={13} /></TextBtn></Col>}
        <Col className="ds-composer-wrap">
          {quick.length > 0 && <div className="ds-quick"><Label>Quick</Label>{quick.map(phrase => <button type="button" key={phrase.id} className="ds-pill quick" disabled={!canTalk} onClick={() => speakPhrase(phrase.text)}><Play size={10} />{phrase.text}</button>)}</div>}
          <form className={`ds-composer ${capture.recording ? 'recording' : ''}`} onSubmit={sendTyped}>
            <button type="button" className={`mic ${capture.recording ? 'on' : ''}`} data-ptt="true" aria-label={capture.recording ? 'Release to send' : 'Hold to speak'} disabled={microphoneMuted || replying || (!canTalk && !recording)}
              onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); pointerHeld.current = true; event.currentTarget.setPointerCapture(event.pointerId); startTalk(); }} onPointerUp={() => { pointerHeld.current = false; capture.stop(); }} onPointerCancel={() => { pointerHeld.current = false; capture.stop(true); }} onLostPointerCapture={() => { if (pointerHeld.current) { pointerHeld.current = false; capture.stop(true); } }}>{microphoneMuted ? <MicOff size={17} /> : <Mic size={17} />}</button>
            {recording ? <span className="live desk-live"><Wave />{capture.requesting ? 'Allow microphone access' : 'Speak — release to send'}</span>
              : replying ? <span className="live"><Spinner size={14} />Sending your voice reply…<TextBtn muted disabled={busy === 'stop'} onClick={() => action('stop', () => api.stop(call.id))}>{phase === 'playing' ? 'Stop' : 'Cancel'}</TextBtn></span>
              : <input value={reply} maxLength={3000} aria-label="Reply" placeholder={`Type in ${languageName(agentLanguage)}, or hold the mic to speak`} disabled={!canTalk} onChange={event => setReply(event.target.value)} />}
            {target && <span className="lang">→ {target.toUpperCase()}</span>}
            <button type="submit" className="send" aria-label="Send" disabled={!canTalk || !reply.trim()}><Send size={14} /></button>
          </form>
          <p className="ds-hint">{hint}</p>
        </Col>
      </>}
    </>}

    {ended && <>
      <Col className="ds-done">
        <Chip tone="green" tall icon={<CheckCircle2 size={13} />}>Transcript saved</Chip>
        {call.ticket?.issue && <Chip tone="green" tall icon={<CheckCircle2 size={13} />}>Notes saved</Chip>}
        {call.ticket?.dispatchConfirmedAt && <Chip tone="green" tall icon={<CheckCircle2 size={13} />}>Dispatch confirmed</Chip>}
        {replies.length > 0 && <Chip tone="green" tall icon={<Volume2 size={13} />}>Caller heard {replies.filter(line => line.delivery === 'played').length} of {replies.length} {replies.length === 1 ? 'reply' : 'replies'}</Chip>}
      </Col>
      {tab === 'notes' ? notes : <>{facts}{captions}</>}
      <Col className="ds-foot"><Btn icon={<Phone size={15} />} onClick={nextCall}>Next call</Btn><Btn kind="ghost" icon={<ChevronRight size={15} />} onClick={() => navigate(`/calls/${call.id}`)}>Open the record</Btn>{waiting > 0 && <span className="ds-note">{waiting} waiting · you are next</span>}</Col>
    </>}

    {!call && home}

    {!active && <Ask placeholder={call ? 'Ask about this caller' : 'Ask anything'} scope={call ? 'call' : 'calls'} callId={call?.id} />}
  </>;
}
