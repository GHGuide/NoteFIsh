// First run: five short steps that end in something real, hearing yourself in
// the caller's language. Languages → voice → say a line → this Mac → done.
// Shown until settings.onboardedAt is set; Settings can run it again.
import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Copy, Mic, Play, Square } from 'lucide-react';
import { api } from '../api.js';
import { LogoMark, Puff, Avatar, Btn, TextBtn, Option, SelectPill, Spinner, Wave } from '../shell.jsx';
import { languages, languageName, useCapture, isArchived, REGISTERS } from '../lib.jsx';
import AudioWaveform from '../components/AudioWaveform.jsx';
import './onboarding.css';

export const PAUSE_KEY = 'notefish.setupPaused';
const STEPS = [
  { key: 'welcome', label: 'Welcome' },
  { key: 'languages', label: 'Languages' },
  { key: 'voice', label: 'Your voice' },
  { key: 'try', label: 'Say a line' },
  { key: 'mac', label: 'This Mac', macOnly: true },
  { key: 'done', label: 'Ready' },
];

export default function Onboarding({ data, owned, saveSettings, saveOwned, navigate, setError, onDone }) {
  const mac = data.setup?.mac?.platform === 'darwin';
  const steps = STEPS.filter(step => !step.macOnly || mac);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(null); // { heard, said, language, audio }
  const [line, setLine] = useState('');
  const [tryError, setTryError] = useState('');
  const [copied, setCopied] = useState(false);
  const player = useRef(null);
  const step = steps[index];
  const ready = data.voices.filter(voice => voice.status === 'ready' && !isArchived(voice));
  const voiceId = data.settings.voiceId;
  const voice = ready.find(item => item.id === voiceId);
  const takes = Object.values(owned('registers') || {}).filter(Boolean).length;
  const driver = data.setup?.mac?.driverInstalled;
  const go = delta => setIndex(current => Math.max(0, Math.min(steps.length - 1, current + delta)));
  const finish = async () => { setBusy(true); if (await saveOwned({ onboardedAt: true })) onDone(); setBusy(false); };
  const pause = path => { try { sessionStorage.setItem(PAUSE_KEY, '1'); } catch { /* fine */ } navigate(path); onDone(); };

  // Hold to speak: the same recorder the desk uses. Release sends the clip to /api/try.
  const capture = useCapture(async (blob, duration) => {
    if (duration < .4) { setTryError('Hold a little longer and say a full sentence.'); return; }
    setBusy(true); setTryError('');
    try { setTried(await api.tryClip(blob)); } catch (failure) { setTryError(failure.message); } finally { setBusy(false); }
  }, 20);
  useEffect(() => { if (capture.error) setTryError(capture.error); }, [capture.error]);
  const typeLine = async event => {
    event.preventDefault();
    if (!line.trim() || busy) return;
    setBusy(true); setTryError('');
    try { setTried(await api.tryLine({ text: line.trim() })); } catch (failure) { setTryError(failure.message); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!tried?.audio) return;
    const audio = new Audio(`data:audio/mpeg;base64,${tried.audio}`);
    player.current = audio; audio.play().catch(() => {});
    return () => { audio.pause(); };
  }, [tried]);
  const copyInstall = async () => { try { await navigator.clipboard.writeText('sh driver/install.sh'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('Copy the command by hand: sh driver/install.sh'); } };

  const target = data.settings.customerLanguage === 'auto' ? 'the caller’s language' : languageName(data.settings.customerLanguage);
  const body = {
    welcome: <>
      <span className="ob-eyebrow">Set up your desk</span>
      <h1>Five minutes, then any language.</h1>
      <p className="ob-lead">Pick the languages, choose a voice, say one line and hear it come back in {target}. Then the desk is yours.</p>
      <div className="ob-actions"><Btn onClick={() => go(1)}>Let’s go<ArrowRight size={15} /></Btn><TextBtn muted onClick={finish} disabled={busy}>Skip setup</TextBtn></div>
    </>,
    languages: <>
      <span className="ob-eyebrow">Step {index} of {steps.length - 2}</span>
      <h1>Who speaks what.</h1>
      <p className="ob-lead">You keep speaking your own language. Callers are understood in theirs, detected on their first sentence unless you pin one.</p>
      <div className="ob-fields">
        <div className="ob-field"><span>You speak</span><SelectPill value={owned('agentLanguage') || data.settings.agentLanguage} options={languages.map(item => ({ value: item.code, label: item.name }))} onChange={value => saveOwned({ agentLanguage: value })} /></div>
        <div className="ob-field"><span>Callers speak</span><SelectPill value={owned('customerLanguage') || data.settings.customerLanguage || 'auto'} options={[{ value: 'auto', label: 'Detect automatically' }, ...languages.map(item => ({ value: item.code, label: item.name }))]} onChange={value => saveOwned({ customerLanguage: value })} /></div>
      </div>
      <p className="ob-note">Captions always show in your language. Replies go out in theirs.</p>
    </>,
    voice: <>
      <span className="ob-eyebrow">Step {index} of {steps.length - 2}</span>
      <h1>The voice callers hear.</h1>
      <p className="ob-lead">Start with a licensed voice if you like. Your own takes a minute of reading aloud and sounds like you.</p>
      <div className="ob-options">
        {ready.length ? ready.map(item => <Option key={item.id} on={item.id === voiceId} main={item.name} sub={`${item.kind === 'licensed' ? 'Licensed voice' : 'Your voice'} · ${languageName(item.language || 'en')}${item.register ? ` · ${REGISTERS.find(r => r.key === item.register)?.label || item.register} take` : ''}`} onClick={() => saveSettings({ voiceId: item.id })} />)
          : <p className="ob-note">No voice is ready yet. Record yours, or import one under Voice › Library.</p>}
      </div>
      <div className="ob-actions"><Btn kind="ghost" icon={<Mic size={15} />} onClick={() => pause('/voice?tab=takes')}>Record my own voice</Btn><span className="ob-hint">{takes ? 'Recorded. One take is enough.' : 'One minute is enough. You come back here when it is done.'}</span></div>
    </>,
    try: <>
      <span className="ob-eyebrow">Step {index} of {steps.length - 2}</span>
      <h1>Say a line. Hear yourself in {target}.</h1>
      <p className="ob-lead">Hold the button, say something you would say to a caller, let go.</p>
      {!voice && <p className="ob-error">Choose a voice in the previous step first.</p>}
      <div className={`ob-try ${capture.recording ? 'is-recording' : ''}`}>
        <button type="button" className="ob-hold" disabled={!voice || busy || capture.requesting} onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); capture.start().catch(failure => setTryError(failure.message)); }} onPointerUp={() => capture.stop()} onPointerCancel={() => capture.stop(true)}>
          {busy ? <Spinner size={22} /> : capture.recording ? <Square size={20} /> : <Mic size={22} />}
        </button>
        <div className="ob-try-text">{capture.requesting ? 'Allow the microphone…' : capture.recording ? <span className="ob-live"><Wave />Release to send</span> : busy ? 'Translating and speaking…' : 'Hold to speak'}</div>
        {capture.recording && <AudioWaveform stream={capture.stream} active={!capture.interrupted} height={30} label="Microphone level" />}
      </div>
      <form className="ob-type" onSubmit={typeLine}><input value={line} placeholder={`Or type a line in ${languageName(data.settings.agentLanguage)}`} maxLength={1000} disabled={!voice || busy} onChange={event => setLine(event.target.value)} /><button type="submit" className="ob-send" disabled={!voice || busy || !line.trim()} aria-label="Speak it"><Play size={14} /></button></form>
      {tryError && <p className="ob-error" role="alert">{tryError}</p>}
      {tried && <div className="ob-result" role="status">
        <div><span>You said</span><p>{tried.heard}</p></div>
        <div><span>They hear, in {languageName(tried.language)}</span><p>{tried.said}</p></div>
        <TextBtn icon={<Play size={13} />} onClick={() => player.current?.play()}>Play again</TextBtn>
      </div>}
    </>,
    mac: <>
      <span className="ob-eyebrow">Step {index} of {steps.length - 2}</span>
      <h1>Calls on this Mac.</h1>
      <p className="ob-lead">For Zoom, WhatsApp, Meet and the rest, the desk listens to what the Mac plays and speaks through a virtual microphone the call app selects.</p>
      <div className="ob-checks">
        <div className={`ob-check ${tried ? 'ok' : ''}`}><i>{tried ? <Check size={13} strokeWidth={2.6} /> : '1'}</i><div><strong>Microphone</strong><span>{tried ? 'Working. You just used it.' : 'Say a line in the previous step to check it.'}</span></div></div>
        <div className={`ob-check ${driver ? 'ok' : ''}`}><i>{driver ? <Check size={13} strokeWidth={2.6} /> : '2'}</i><div><strong>Virtual microphone “NoteFish Voice”</strong><span>{driver ? 'Installed. Pick it as the microphone inside the call app.' : 'Not installed yet. In Terminal, from the NoteFish folder, run the line below. It asks for your password once.'}</span>{!driver && <div className="ob-cmd"><code>sh driver/install.sh</code><button type="button" onClick={copyInstall}>{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}</button></div>}</div></div>
        <div className="ob-check"><i>3</i><div><strong>System audio</strong><span>macOS asks once, the first time you turn on “Listen for calls” in the menu bar. Allow it so captions can hear the call.</span></div></div>
        <div className="ob-check"><i>4</i><div><strong>Hold ⌥ Space anywhere</strong><span>Whatever app is in front, hold the key, speak, let go. The pill by the notch shows the call.</span></div></div>
      </div>
    </>,
    done: <>
      <span className="ob-eyebrow">All set</span>
      <h1>Your desk is ready.</h1>
      <div className="ob-summary">
        <div><span>Languages</span><strong>{languageName(data.settings.agentLanguage)} → {data.settings.customerLanguage === 'auto' ? 'detected per caller' : languageName(data.settings.customerLanguage)}</strong></div>
        <div><span>Voice</span><strong>{voice ? voice.name : 'none yet'}</strong></div>
        <div><span>Microphone</span><strong>{tried ? 'tested' : 'not tested'}</strong></div>
        {mac && <div><span>Virtual microphone</span><strong>{driver ? 'installed' : 'not yet'}</strong></div>}
      </div>
      <div className="ob-actions"><Btn onClick={finish} disabled={busy}>{busy ? <Spinner size={15} /> : <Check size={15} />}Open the desk</Btn></div>
    </>,
  }[step.key];

  return <div className="ob">
    <aside className="ob-rail">
      <div className="ob-lockup"><LogoMark size={22} /><span>NoteFish<span className="dot">.</span></span></div>
      <ol className="ob-steps">{steps.map((item, i) => <li key={item.key} className={i === index ? 'now' : i < index ? 'done' : ''}><i>{i < index ? <Check size={11} strokeWidth={2.8} /> : i + 1}</i>{item.label}</li>)}</ol>
      <div className="ob-who"><Avatar who={voice || 'workspace'} size={30} /><div><strong>{voice?.name || 'Your desk'}</strong><span>Setup</span></div></div>
    </aside>
    <section className="ob-main">
      <div className="ob-art" aria-hidden="true"><Puff variant="fish" color="#2F6FE0" size={72} /><Puff variant="puff" color="#3C8A4E" size={48} face={false} /><Puff variant="bloom" color="#E7A72F" size={40} face={false} /></div>
      <div className="ob-body">{body}</div>
      {step.key !== 'welcome' && step.key !== 'done' && <div className="ob-nav">
        <TextBtn muted icon={<ArrowLeft size={14} />} onClick={() => go(-1)}>Back</TextBtn>
        <span className="ob-spacer" />
        <TextBtn muted onClick={finish} disabled={busy}>Skip setup</TextBtn>
        <Btn onClick={() => go(1)} disabled={busy}>{index === steps.length - 2 ? 'Next' : 'Next'}<ArrowRight size={15} /></Btn>
      </div>}
    </section>
  </div>;
}
