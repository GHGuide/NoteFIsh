import React, { useEffect, useRef, useState } from 'react';
import { AudioLines, CheckCircle2, Copy, Globe2, Headphones, Loader2, Mic, MicOff, Phone, PhoneOff, ShieldCheck, Volume2 } from 'lucide-react';
import { BrowserCallAudio } from './browser-call-audio.js';
import { microphoneIssue } from './microphone-help.js';
import { languageName } from '../server/languages.mjs';
import AudioWaveform from './components/AudioWaveform.jsx';
import { motion, useReducedMotion } from 'motion/react';

const COPY = {
  fr: {
    captions: 'Sous-titres · dans votre langue', captionsHide: 'Masquer', captionsShow: 'Afficher', captionsEmpty: 'Ce que vous dites tous les deux apparaît ici, dans votre langue.', you: 'Vous', agentName: 'Standard',
    label: 'UNE CONVERSATION, TOUT SIMPLEMENT', title: 'On vous écoute.', intro: 'Parlez dans votre langue. Votre interlocuteur vous répond avec une voix traduite.',
    call: 'Appeler', connecting: 'Connexion en cours…', ringing: 'Votre interlocuteur est prévenu.', waiting: 'Patientez un instant. La conversation commence dès qu’il répond.',
    live: 'Vous êtes en ligne.', listening: 'À vous de parler. Votre interlocuteur vous entend.', translating: 'Votre interlocuteur prépare sa réponse…', playing: 'Écoutez la réponse de votre interlocuteur.',
    end: 'Terminer l’appel', ended: 'Merci pour cette conversation.', endedBody: 'L’appel est terminé. Vous pouvez fermer cette page.',
    microphone: 'Microphone actif', muted: 'Microphone en pause', allow: 'Autorisez votre microphone pour commencer.', preparing: 'Préparation du microphone…',
    audio: 'Activer le son', audioHelp: 'Le son est en pause. Touchez le bouton pour reprendre l’appel.', retry: 'Réessayer', unavailable: 'Ce lien n’est pas disponible.', newLink: 'Demandez un nouveau lien d’appel à votre interlocuteur.',
    privacy: 'Votre voix est transmise pour cet appel et traduite pour votre interlocuteur. Elle n’est pas clonée.', headset: 'Pour un son clair, utilisez des écouteurs et gardez cette page ouverte.', browser: 'Appel audio sécurisé dans votre navigateur', microphoneEnded: 'Le microphone a été déconnecté. Demandez un nouveau lien pour rappeler.',
    disconnected: 'La connexion a été interrompue. Demandez un nouveau lien pour rappeler.',
    mute: 'Couper le micro', unmute: 'Réactiver le micro', mutedByYou: 'Votre microphone est coupé.',
    deviceMuted: 'Votre microphone est temporairement indisponible.', micWaveform: 'Activité réelle du microphone', replyWaveform: 'Audio de votre interlocuteur',
    cancel: 'Annuler', permissionTitle: 'Le microphone ne fonctionne pas ?',
    permissionOpen: 'Ouvrez ce lien directement dans Safari ou Chrome, plutôt que dans WhatsApp, Instagram ou le navigateur d’une autre application.',
    permissionSettings: 'Dans le menu du site de votre navigateur, autorisez le microphone, puis réessayez. Si le téléphone bloque le navigateur, autorisez aussi son microphone dans les réglages du téléphone.',
    permissionWaiting: 'Autorisez le microphone dans la fenêtre de votre navigateur. Si aucune fenêtre ne s’affiche, consultez l’aide ci-dessous.',
    copyLink: 'Copier le lien', copiedLink: 'Lien copié. Collez-le dans Safari ou Chrome.', manualCopy: 'Copiez le lien ci-dessous et collez-le dans Safari ou Chrome.',
    linkLabel: 'Lien complet de cet appel', speechLanguage: 'Langue de l’appel',
    micErrors: { blocked: 'L’accès au microphone est bloqué par le navigateur ou le téléphone.', missing: 'Aucun microphone disponible. Vérifiez votre appareil.', busy: 'Le microphone est indisponible. Fermez les autres appels et réessayez.', unsupported: 'Ce navigateur ne permet pas l’accès au microphone ici. Ouvrez le lien HTTPS dans Safari ou Chrome.', failed: 'Le microphone n’a pas pu démarrer. Réessayez ou ouvrez le lien dans Safari ou Chrome.', timeout: 'La demande de microphone est toujours en attente. Autorisez-la, puis réessayez.' },
  },
  en: {
    captions: 'Captions · in your language', captionsHide: 'Hide', captionsShow: 'Show', captionsEmpty: 'What you both say appears here, in your language.', you: 'You', agentName: 'Desk',
    label: 'A CONVERSATION, MADE SIMPLE', title: 'We’re listening.', intro: 'Speak in your language. The person at the desk replies with a translated voice.',
    call: 'Call', connecting: 'Connecting…', ringing: 'Your call is ringing.', waiting: 'Just a moment. The conversation starts when the person at the desk answers.',
    live: 'You’re connected.', listening: 'Go ahead and speak. The person at the desk can hear you.', translating: 'The person at the desk is preparing a reply…', playing: 'Listen to their reply.',
    end: 'End call', ended: 'Thanks for the conversation.', endedBody: 'The call has ended. You can close this page.',
    microphone: 'Microphone active', muted: 'Microphone paused', allow: 'Allow microphone access to begin.', preparing: 'Preparing your microphone…',
    audio: 'Enable audio', audioHelp: 'Audio is paused. Tap the button to resume the call.', retry: 'Try again', unavailable: 'This call link is unavailable.', newLink: 'Ask the person at the desk for a new call link.',
    privacy: 'Your voice is shared for this call and translated for the person at the desk. It is never cloned.', headset: 'For clear audio, use headphones and keep this page open.', browser: 'A secure audio call in your browser', microphoneEnded: 'The microphone was disconnected. Ask for a new link to call again.',
    disconnected: 'The connection was interrupted. Ask for a new link to call again.',
    mute: 'Mute microphone', unmute: 'Unmute microphone', mutedByYou: 'Your microphone is muted.',
    deviceMuted: 'Your microphone is temporarily unavailable.', micWaveform: 'Live microphone activity', replyWaveform: 'Audio from the person at the desk',
    cancel: 'Cancel', permissionTitle: 'Microphone not working?',
    permissionOpen: 'Open this link directly in Safari or Chrome, rather than inside WhatsApp, Instagram, or another app’s browser.',
    permissionSettings: 'In your browser’s site menu, allow Microphone, then try again. If your phone blocks the browser, also allow its microphone in your phone settings.',
    permissionWaiting: 'Allow the microphone in your browser’s permission popup. If no popup appears, open the help below.',
    copyLink: 'Copy call link', copiedLink: 'Link copied. Paste it into Safari or Chrome.', manualCopy: 'Copy the link below and paste it into Safari or Chrome.',
    linkLabel: 'Full link for this call', speechLanguage: 'Call language',
    micErrors: { blocked: 'Microphone access is blocked by the browser or phone.', missing: 'No microphone is available. Check your device.', busy: 'The microphone is unavailable. Close other calls and try again.', unsupported: 'This browser cannot access the microphone here. Open the HTTPS link in Safari or Chrome.', failed: 'The microphone could not start. Try again or open the link in Safari or Chrome.', timeout: 'The microphone request is still waiting. Allow it, then try again.' },
  },
};

export default function Caller() {
  const [token] = useState(() => { try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; } });
  const [language, setLanguage] = useState('en');
  const [captions, setCaptions] = useState([]);
  const [showCaptions, setShowCaptions] = useState(true);
  const [state, setState] = useState(token ? 'ready' : 'unavailable');
  const [phase, setPhase] = useState('listening');
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState(false);
  const [audioState, setAudioState] = useState('idle');
  const [microphoneReady, setMicrophoneReady] = useState(false);
  const [microphoneStream, setMicrophoneStream] = useState(null);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [deviceMuted, setDeviceMuted] = useState(false);
  const [permissionProblem, setPermissionProblem] = useState('');
  const [linkNotice, setLinkNotice] = useState('');
  const [speechLanguage, setSpeechLanguage] = useState('auto');
  const [used, setUsed] = useState(false);
  const reducedMotion = useReducedMotion();
  const mutedRef = useRef(false);
  const runtime = useRef(null);
  const pendingPlayback = useRef(null);
  const stateRef = useRef('ready');
  const copy = COPY[language] || COPY.en;
  const copyRef = useRef(copy);
  copyRef.current = copy;
  const connected = state === 'in_call';
  const inProgress = ['connecting', 'ringing', 'in_call'].includes(state);
  const microphoneLive = connected && phase === 'listening' && !playing && audioState === 'running' && !microphoneMuted && !deviceMuted;

  const finish = (finalState = 'ended', message = '', sendEnd = false) => {
    const session = runtime.current;
    if (session) {
      session.ended = true;
      clearTimeout(session.timeout);
      session.audio?.stop();
      if (sendEnd && session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({ type: 'end' }));
      if (session.socket && session.socket.readyState < WebSocket.CLOSING) session.socket.close(1000);
    }
    pendingPlayback.current = null;
    stateRef.current = finalState;
    setState(finalState);
    setMicrophoneReady(false);
    setMicrophoneStream(null);
    setPlaying(false);
    if (message) setError(message);
  };

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'fr' ? 'Votre appel · NoteFIsh' : 'Your call · NoteFIsh';
  }, [language]);
  useEffect(() => {
    const leave = () => { const session = runtime.current; if (!session) return; session.ended = true; clearTimeout(session.timeout); session.audio?.stop(); if (session.socket?.readyState === WebSocket.OPEN) { session.socket.send(JSON.stringify({ type: 'end' })); session.socket.close(1000); } };
    window.addEventListener('pagehide', leave);
    return () => { window.removeEventListener('pagehide', leave); leave(); };
  }, []);
  useEffect(() => { runtime.current?.audio?.setListening(microphoneLive); }, [microphoneLive]);

  const start = async () => {
    if (!token || used || (runtime.current && !runtime.current.ended)) return;
    setError(''); setPermissionProblem(''); setState('connecting'); stateRef.current = 'connecting'; setAudioState('idle');
    mutedRef.current = false; setMicrophoneMuted(false); setDeviceMuted(false);
    const session = { ended: false, socket: null, audio: null, timeout: null };
    runtime.current = session;
    try {
      session.timeout = setTimeout(() => {
        if (session.ended) return;
        setPermissionProblem('timeout'); finish('error', copyRef.current.micErrors.timeout);
      }, 30000);
      session.audio = new BrowserCallAudio({
        onChunk: chunk => {
          if (!session.ended && session.socket?.readyState === WebSocket.OPEN && session.audio.listening) {
            // Do not queue old microphone audio behind a stalled network.
            if (session.socket.bufferedAmount > 64000) { finish('error', copyRef.current.disconnected, true); return; }
            session.socket.send(chunk);
          }
        },
        onPlayed: playbackId => { if (!session.ended && session.socket?.readyState === WebSocket.OPEN) session.socket.send(JSON.stringify({ type: 'played', playbackId })); },
        onPlayback: value => { if (!session.ended) setPlaying(value); },
        onAudioState: value => { if (!session.ended) { setAudioState(value); if (value !== 'running') session.audio?.setListening(false); } },
        onMicrophoneEnded: () => { if (!session.ended) finish('error', copyRef.current.microphoneEnded, true); },
        onMicrophoneState: value => { if (!session.ended) setDeviceMuted(value.muted); },
      });
      await session.audio.prepare();
      if (session.ended) return;
      clearTimeout(session.timeout);
      setAudioState(session.audio.context.state);
      setMicrophoneReady(true);
      setMicrophoneStream(session.audio.stream);
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/caller`);
      session.socket = socket;
      socket.binaryType = 'arraybuffer';
      session.timeout = setTimeout(() => { if (!session.ended && stateRef.current === 'connecting') finish('error', copyRef.current.disconnected, true); }, 15000);
      socket.onopen = () => { if (!session.ended) socket.send(JSON.stringify({ type: 'join', token })); };
      socket.onmessage = event => {
        if (session.ended || typeof event.data !== 'string') return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.type === 'state') {
          clearTimeout(session.timeout);
          const nextState = message.state;
          if (!['ringing', 'in_call', 'ended'].includes(nextState)) return;
          setUsed(true);
          if (message.customerLanguage) { setSpeechLanguage(message.customerLanguage); setLanguage(message.customerLanguage === 'fr' ? 'fr' : 'en'); }
          if (message.error) setError(message.error);
          if (nextState === 'ended') { finish('ended', message.error || ''); return; }
          stateRef.current = nextState;
          setState(nextState);
          setPhase(message.phase || 'listening');
          session.audio.setListening(nextState === 'in_call' && message.phase === 'listening' && !session.audio.source && session.audio.context.state === 'running' && !mutedRef.current);
        }
        if (message.type === 'audio' && message.payload && message.playbackId) {
          session.audio.setListening(false);
          pendingPlayback.current = message;
          session.audio.play(message.payload, message.playbackId).then(() => { if (!session.ended && pendingPlayback.current === message) pendingPlayback.current = null; }).catch(failure => { if (!session.ended) { setError(failure.message); setAudioState(session.audio.context.state); } });
        }
        if (message.type === 'clear') { pendingPlayback.current = null; session.audio.clearPlayback(); }
        if (message.type === 'caption' && typeof message.text === 'string') setCaptions(list => [...list.filter(item => item.id !== message.id).slice(-19), { id: message.id || String(Date.now()), who: message.who === 'agent' ? 'agent' : 'you', text: message.text.slice(0, 600) }]);
        if (message.type === 'error') {
          const messageText = message.error || copyRef.current.disconnected;
          if (stateRef.current === 'connecting') finish('error', messageText, true);
          else setError(messageText);
        }
      };
      socket.onerror = () => { if (!session.ended) finish('error', copyRef.current.disconnected, true); };
      socket.onclose = () => { if (!session.ended) finish('error', copyRef.current.disconnected); };
    } catch (failure) {
      if (session.ended) return;
      const issue = microphoneIssue(failure, { secure: window.isSecureContext, supported: !!navigator.mediaDevices?.getUserMedia });
      setPermissionProblem(issue);
      finish('error', copyRef.current.micErrors[issue], true);
    }
  };

  const resumeAudio = async () => {
    const session = runtime.current;
    if (!session || session.ended) return;
    try { await session.audio.unlock(); setAudioState('running'); setError(''); const pending = pendingPlayback.current; if (pending) { await session.audio.play(pending.payload, pending.playbackId); pendingPlayback.current = null; } }
    catch (failure) { setError(failure.message); }
  };
  const toggleMicrophone = () => {
    const next = !mutedRef.current;
    mutedRef.current = next;
    runtime.current?.audio?.setMuted(next);
    setMicrophoneMuted(next);
  };
  const fullCallLink = `${location.origin}${location.pathname}#${encodeURIComponent(token)}`;
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(fullCallLink); setLinkNotice(copy.copiedLink); }
    catch { setLinkNotice(copy.manualCopy); }
  };

  const heading = state === 'ended' ? copy.ended : state === 'unavailable' || (state === 'error' && used) ? copy.unavailable : connected ? copy.live : state === 'ringing' ? copy.ringing : state === 'connecting' ? copy.connecting : copy.title;
  const body = state === 'ended' ? copy.endedBody : state === 'unavailable' || (state === 'error' && used) ? copy.newLink : connected ? playing ? copy.playing : phase !== 'listening' ? copy.translating : microphoneMuted ? copy.mutedByYou : deviceMuted ? copy.deviceMuted : copy.listening : state === 'ringing' ? copy.waiting : state === 'connecting' ? microphoneReady ? copy.waiting : copy.preparing : copy.intro;
  return <div className="caller-page" lang={language}>
    <header className="caller-header"><div className="wordmark"><span className="brand-mark"><AudioLines size={23} /></span>NoteFIsh<span className="wordmark-dot">.</span></div><button className="caller-language" onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')} aria-label={language === 'fr' ? 'Switch to English' : 'Passer en français'}><Globe2 size={14} />{language === 'fr' ? 'FR' : 'EN'}</button></header>
    <main className="caller-main"><div className={`caller-orb ${inProgress ? 'is-active' : ''} ${playing ? 'is-playing' : ''}`} aria-hidden="true">{state === 'ended' ? <CheckCircle2 size={45} strokeWidth={1} /> : playing ? <Volume2 size={45} strokeWidth={1} /> : state === 'connecting' ? <Loader2 className="spin" size={42} strokeWidth={1} /> : <AudioLines size={49} strokeWidth={1} />}</div><span className="eyebrow">{copy.label}</span><div className="caller-state" role="status" aria-live="polite"><h1>{heading}</h1><p>{body}</p></div>
      {inProgress && <div className={`caller-mic-state ${microphoneLive ? 'is-live' : ''}`}>{microphoneLive ? <Mic size={14} /> : <MicOff size={14} />}<span>{microphoneLive ? copy.microphone : copy.muted}</span></div>}
      {connected && <div className={`caller-live-audio ${playing ? 'is-playing' : ''}`}>
        <AudioWaveform stream={playing ? null : microphoneStream} analyser={playing ? runtime.current?.audio?.playbackAnalyser : null}
          audioContext={runtime.current?.audio?.context} active={microphoneLive || playing} height={56} label={playing ? copy.replyWaveform : copy.micWaveform} />
      </div>}
      {error && <div className="caller-error" role="alert">{error}</div>}
      {connected && <p className="caller-speech-language"><Globe2 size={14} />{copy.speechLanguage}: <strong>{speechLanguage === 'auto' ? (language === 'fr' ? 'détection…' : 'detecting…') : languageName(speechLanguage)}</strong></p>}
      {connected && <section className="caller-captions" aria-label={copy.captions}><div className="caller-captions-head"><span>{copy.captions}</span><button type="button" className="text-button" aria-pressed={showCaptions} onClick={() => setShowCaptions(!showCaptions)}>{showCaptions ? copy.captionsHide : copy.captionsShow}</button></div>{showCaptions && (captions.length ? <ol aria-live="polite">{captions.slice(-6).map(item => <li key={item.id} className={item.who}><span>{item.who === 'agent' ? copy.agentName : copy.you}</span><p>{item.text}</p></li>)}</ol> : <p className="caller-captions-empty">{copy.captionsEmpty}</p>)}</section>}
      {state === 'connecting' && !microphoneReady && <p className="caller-permission-wait" role="status">{copy.permissionWaiting}</p>}
      {inProgress && audioState !== 'running' && audioState !== 'idle' && <div className="caller-audio-recovery"><p>{copy.audioHelp}</p><button className="button primary" onClick={resumeAudio}><Volume2 size={17} />{copy.audio}</button></div>}
      {!inProgress && !used && token && state !== 'ended' && <><motion.button className="button primary caller-call-button" onClick={start} whileTap={reducedMotion ? undefined : { scale: .98 }}><Phone size={19} />{state === 'error' ? copy.retry : copy.call}</motion.button><span className="caller-permission">{copy.allow}</span></>}
      {!used && token && state !== 'ended' && <details className="caller-microphone-help" open={!!permissionProblem}>
        <summary>{copy.permissionTitle}</summary><p>{copy.permissionOpen}</p><p>{copy.permissionSettings}</p>
        <button type="button" className="button secondary" onClick={copyLink}><Copy size={15} />{copy.copyLink}</button>
        <label className="field"><span>{copy.linkLabel}</span><input readOnly value={fullCallLink} onFocus={event => event.target.select()} /></label>
        {linkNotice && <p role="status">{linkNotice}</p>}
      </details>}
      {inProgress && <div className="caller-touch-controls">
        {microphoneReady && <motion.button type="button" className={`button secondary caller-mute-button ${microphoneMuted ? 'is-muted' : ''}`}
          style={{ minHeight: 48, minWidth: 48 }} aria-pressed={microphoneMuted} aria-label={microphoneMuted ? copy.unmute : copy.mute}
          onClick={toggleMicrophone} whileTap={reducedMotion ? undefined : { scale: .97 }}>
          {microphoneMuted ? <MicOff size={19} /> : <Mic size={19} />}<span>{microphoneMuted ? copy.unmute : copy.mute}</span>
        </motion.button>}
        <motion.button className="button end-call caller-end-button" style={{ minHeight: 48, minWidth: 48 }}
          onClick={() => finish(state === 'connecting' && !runtime.current?.socket ? 'ready' : 'ended', '', true)} whileTap={reducedMotion ? undefined : { scale: .97 }}><PhoneOff size={17} />{state === 'connecting' && !microphoneReady ? copy.cancel : copy.end}</motion.button>
      </div>}
      <div className="caller-headphone-note"><Headphones size={17} /><p>{copy.headset}</p></div>
    </main><footer className="caller-footer"><div><ShieldCheck size={15} /><p>{copy.privacy}</p></div><span>{copy.browser}</span></footer>
  </div>;
}
