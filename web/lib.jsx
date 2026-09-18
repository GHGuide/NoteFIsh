// Shared desk logic the pages reuse: the recorder hook, the voice dialogs, the
// reading scripts and registers, and the small helpers. Extracted from the
// original App.jsx so the companion-design pages can compose them.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Archive, ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Copy, ExternalLink, FileAudio, Globe2, Headphones, LayoutPanelLeft, Library, Link2, Loader2, Menu, Maximize2, Minimize2, Mic, MicOff, MoreHorizontal, Phone, PhoneCall, PhoneOff, Play, Plus, Radio, RefreshCw, Search, Send, Settings2, Share2, ShieldCheck, Smartphone, Sparkles, Square, Trash2, Upload, UserRound, Users, Volume2, X } from 'lucide-react';
import Select from './components/select.jsx';
import { api } from './api.js';
import { recordingType } from './audio.js';
import { languages, languageName } from '../server/languages.mjs';
import AudioWaveform from './components/AudioWaveform.jsx';
import { Dialog as Modal } from './components/ui.jsx';
import { Avatar } from './shell.jsx';
export { languages, languageName };

export const DEFAULT_SETTINGS = { voiceId: '', agentLanguage: 'en', customerLanguage: 'fr', queueName: 'Main line' };
export const isArchived = voice => Boolean(voice.archived || voice.archivedAt);
export const needsDispatch = value => value === true || ['requested', 'pending', 'confirmed'].includes(value);
export const callState = call => call?.state || (call?.status === 'active' ? 'in_call' : call?.status);
export const stamp = value => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
export const formatDuration = seconds => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export function useCapture(onFinish, maximumSeconds = 90) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [stream, setStream] = useState(null);
  const [interrupted, setInterrupted] = useState(false);
  const [captureError, setCaptureError] = useState('');
  const capture = useRef(null);
  const wanted = useRef(false);
  const captureAttempt = useRef(0);
  const done = useRef(onFinish);
  done.current = onFinish;
  const stop = useCallback((cancel = false) => {
    wanted.current = false;
    captureAttempt.current++;
    setRequesting(false);
    const current = capture.current;
    if (current) { current.cancelled ||= cancel; if (current.recorder.state !== 'inactive') current.recorder.stop(); }
  }, []);
  const start = useCallback(async () => {
    if (wanted.current || capture.current) return;
    wanted.current = true;
    const attempt = ++captureAttempt.current;
    setRequesting(true);
    setCaptureError('');
    setInterrupted(false);
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone recording requires HTTPS or localhost. Upload a recording, or open the secure website.');
      const mimeType = recordingType();
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!wanted.current || attempt !== captureAttempt.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      const current = { recorder, stream, cancelled: false, startedAt: Date.now() };
      capture.current = current;
      setStream(stream);
      for (const track of stream.getAudioTracks()) {
        track.onmute = () => setInterrupted(true);
        track.onunmute = () => setInterrupted(false);
        track.onended = () => {
          current.cancelled = true;
          wanted.current = false;
          setCaptureError('Your microphone disconnected. This recording was discarded. Reconnect it and try again.');
          if (recorder.state !== 'inactive') recorder.stop();
        };
      }
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(track => { track.onended = null; track.onmute = null; track.onunmute = null; track.stop(); });
        const duration = (Date.now() - current.startedAt) / 1000;
        capture.current = null;
        setRecording(false);
        setStream(null);
        setInterrupted(false);
        setSeconds(0);
        if (!current.cancelled && chunks.length) done.current(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }), duration);
      };
      recorder.onerror = () => { current.cancelled = true; stream.getTracks().forEach(track => track.stop()); setRecording(false); setStream(null); capture.current = null; wanted.current = false; };
      recorder.start(200);
      setSeconds(0);
      setRecording(true);
    } catch (error) { stream?.getTracks().forEach(track => track.stop()); if (attempt !== captureAttempt.current) return; wanted.current = false; if (capture.current?.stream === stream) capture.current = null; setRecording(false); setStream(null); throw error; }
    finally { if (attempt === captureAttempt.current) setRequesting(false); }
  }, []);
  useEffect(() => {
    if (!recording) return;
    const interval = setInterval(() => { const elapsed = Math.floor((Date.now() - (capture.current?.startedAt || Date.now())) / 1000); setSeconds(elapsed); if (elapsed >= maximumSeconds) stop(); }, 200);
    return () => clearInterval(interval);
  }, [recording, maximumSeconds, stop]);
  useEffect(() => () => { wanted.current = false; const current = capture.current; if (current) { current.cancelled = true; if (current.recorder.state !== 'inactive') current.recorder.stop(); current.stream.getTracks().forEach(track => track.stop()); } }, []);
  return { recording, requesting, seconds, stream, interrupted, error: captureError, start, stop };
}

export function LanguageSelect({ label, value, onChange, disabled = false, id, allowAuto = false, detected = '' }) {
  const options = [...(allowAuto ? [{ value: 'auto', label: 'Detect automatically' }] : []), ...languages.map(language => ({ value: language.code, label: language.name }))];
  return <div className="field"><span>{label}{allowAuto && value === 'auto' && <small>{detected ? ` · ${languageName(detected)} detected` : ' · listening'}</small>}</span>
    <Select id={id} aria-label={label} value={value || 'en'} onChange={onChange} disabled={disabled} options={options} lead={<Globe2 size={14} />} className="wide" />
  </div>;
}

export function StatusPill({ status }) { return <span className={`status-pill ${status}`}><span />{status === 'ready' ? 'Ready to use' : status === 'training' ? 'Training' : status === 'failed' ? 'Needs attention' : status === 'archived' ? 'Archived' : status}</span>; }
export function Spinner({ size = 16 }) { return <Loader2 className="spin" size={size} />; }

/** A file the browser saves, for voice exports. */
export function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: name.replace(/[\\/:*?"<>|]+/g, '-') });
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function VoiceModal({ voice, agentLanguage = 'en', customerLanguage = 'fr', onClose, setError, setNotice, refreshVoices, onUse }) {
  const [name, setName] = useState(voice.name);
  const [description, setDescription] = useState(voice.description || '');
  const [text, setText] = useState(agentLanguage === 'en' ? 'Hello, how can I help you today?' : agentLanguage === 'fr' ? 'Bonjour, comment puis-je vous aider aujourd’hui ?' : '');
  const [language, setLanguage] = useState(customerLanguage);
  const [busy, setBusy] = useState('');
  const [audio, setAudio] = useState('');
  const [previewBlob, setPreviewBlob] = useState(null);
  const [previewAudioElement, setPreviewAudioElement] = useState(null);
  const [localError, setLocalError] = useState('');
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);
  const action = async (kind, fn) => { setBusy(kind); setLocalError(''); try { await fn(); } catch (failure) { setLocalError(failure.message); } finally { setBusy(''); } };
  return <Modal title="Your voice" onClose={onClose}><div className="voice-modal-intro"><Avatar who={voice.name} size={54} /><div><h3>{voice.name}</h3><StatusPill status={isArchived(voice) ? 'archived' : voice.status} /><p>{voice.kind === 'licensed' ? 'Licensed voice' : 'Enrolled voice'} · {languageName(voice.language || 'en')}</p></div></div>
    {localError && <div className="inline-error" role="alert">{localError}</div>}
    {voice.status === 'failed' && <div className="inline-error">{voice.error || 'Fish could not complete training. Refresh the status or try a new recording.'}</div>}
    {voice.status === 'training' && <div className="info-box"><Spinner />Fish is preparing your voice. Refresh its status in a moment.</div>}
    <div className="form-stack"><label className="field"><span>Voice name</span><input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label><label className="field"><span>Description <small>optional</small></span><textarea rows={2} maxLength={500} value={description} onChange={event => setDescription(event.target.value)} /></label><div className="inline-actions"><button className="button secondary compact" disabled={!!busy || !name.trim()} onClick={() => action('save', async () => { await api.editVoice(voice.id, { name, description }); await refreshVoices(); setNotice('Voice details saved.'); })}>{busy === 'save' ? <Spinner /> : <Check size={15} />}Save details</button><button className="text-button" disabled={!!busy} onClick={() => action('refresh', async () => { await api.refreshVoice(voice.id); await refreshVoices(); setNotice('Voice status refreshed.'); })}>{busy === 'refresh' ? <Spinner /> : <RefreshCw size={14} />}Refresh status</button></div></div>
    {voice.status === 'ready' && !isArchived(voice) && <section className="preview-section"><div className="section-heading"><h3>Hear your voice</h3><span className="subtle-tag">Fish Audio</span></div><LanguageSelect label="Preview language" value={language} onChange={setLanguage} /><label className="field"><span>Preview text</span><textarea rows={3} value={text} maxLength={1000} onChange={event => setText(event.target.value)} placeholder={`Write a short line in ${languageName(agentLanguage)}…`} /></label><p className="field-help">Write in {languageName(agentLanguage)}. We’ll preview it in {languageName(language)}.</p><button className="button secondary" disabled={!!busy || !text.trim()} onClick={() => action('preview', async () => { const blob = await api.previewVoice(voice.id, { text, language, sourceLanguage: agentLanguage }); setPreviewBlob(blob); setAudio(URL.createObjectURL(blob)); })}>{busy === 'preview' ? <Spinner /> : <Play size={14} />}Generate preview</button>{audio && <><AudioWaveform blob={previewBlob} audioElement={previewAudioElement} height={52} label="Generated voice preview waveform" /><audio ref={setPreviewAudioElement} className="audio-preview" src={audio} controls autoPlay /></>}</section>}
    <div className="modal-bottom"><button className="text-button muted" disabled={!!busy} onClick={() => action('archive', async () => { await api.editVoice(voice.id, { archived: !isArchived(voice) }); await refreshVoices(); setNotice(isArchived(voice) ? 'Voice restored.' : 'Voice archived. You can restore it from your library.'); onClose(); })}><Archive size={15} />{isArchived(voice) ? 'Restore voice' : 'Archive voice'}</button><button className="button primary" disabled={!!busy || voice.status !== 'ready' || isArchived(voice)} onClick={onUse}>Use at call desk <ArrowRight size={16} /></button></div><p className="reference-id">Fish reference · {voice.referenceId}</p>
  </Modal>;
}

export function ImportModal({ onClose, setError, setNotice, refreshVoices }) {
  const [form, setForm] = useState({ name: '', referenceId: '', language: 'en', consent: false, kind: 'licensed' });
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState([]);
  const [finding, setFinding] = useState(true);
  const [listingError, setListingError] = useState('');
  const [localError, setLocalError] = useState('');
  const [ownedId, setOwnedId] = useState('');
  useEffect(() => { let cancelled = false; api.availableVoices().then(result => { if (!cancelled) setAvailable(result.voices || []); }).catch(failure => { if (!cancelled) setListingError(failure.message); }).finally(() => { if (!cancelled) setFinding(false); }); return () => { cancelled = true; }; }, []);
  const submit = async event => { event.preventDefault(); setBusy(true); setLocalError(''); try { await api.importVoice(form); await refreshVoices(); setNotice('Fish voice added to your library.'); onClose(); } catch (failure) { setLocalError(failure.message); } finally { setBusy(false); } };
  return <Modal title="Import a Fish voice" onClose={onClose}><p className="modal-description">Choose a voice from your Fish Audio account, or enter the reference ID of an enrolled or licensed voice.</p>{localError && <div className="inline-error" role="alert">{localError}</div>}<form className="form-stack" onSubmit={submit}><label className="field"><span>From a NoteFish voice file <small>exported from another desk</small></span><input type="file" accept="application/json,.json" disabled={busy} onChange={async event => { const file = event.target.files?.[0]; if (!file) return; setBusy(true); setLocalError(''); try { const pack = JSON.parse(await file.text()); const result = await api.importPack({ pack, consent: form.consent }); await refreshVoices(); setNotice(`${result.imported.length} voice${result.imported.length === 1 ? '' : 's'} imported${result.skipped.length ? `, ${result.skipped.length} already here` : ''}.`); onClose(); } catch (failure) { setLocalError(failure.message.startsWith('Confirm') ? 'Tick the consent box below first, then choose the file again.' : failure.message); event.target.value = ''; } finally { setBusy(false); } }} /></label>{finding ? <div className="info-box"><Spinner />Finding voices in your Fish account…</div> : available.length ? <label className="field"><span>Your Fish Audio voices <small>{available.length} available</small></span><Select
      aria-label="Your Fish Audio voices" value={ownedId} lead={<AudioLines size={14} />} className="wide"
      onChange={value => { const chosen = available.find(item => item.referenceId === value); setOwnedId(value); if (chosen) setForm({ ...form, name: chosen.name, referenceId: chosen.referenceId, kind: 'enrolled', consent: false }); }}
      options={[{ value: '', label: 'Choose an existing voice' }, ...available.map(item => ({ value: item.referenceId, label: `${item.name} · ${item.referenceId.slice(-8)} · ${item.status === 'ready' || item.status === 'trained' ? 'Ready' : item.status}` }))]}
    /></label> : listingError ? <div className="info-box"><CircleHelp size={15} /><span>Couldn’t load your Fish voices: {listingError} You can still enter a reference ID below.</span></div> : <p className="field-help">No existing voices found in your Fish account. You can import a licensed voice by its reference ID.</p>}<label className="field"><span>Voice name</span><input required maxLength={100} placeholder="e.g. Alex · Support" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label className="field"><span>Fish reference ID</span><input required placeholder="Paste your model reference ID" value={form.referenceId} onChange={event => { setOwnedId(''); setForm({ ...form, referenceId: event.target.value, kind: 'licensed', consent: false }); }} /></label><LanguageSelect label="Original voice language" value={form.language} onChange={language => setForm({ ...form, language })} /><label className="checkbox-label"><input type="checkbox" checked={form.consent} onChange={event => setForm({ ...form, consent: event.target.checked })} required /><span>I own this voice or have permission to use it for voice cloning and translated phone conversations.</span></label><div className="modal-bottom"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !form.consent}>{busy ? <Spinner /> : <ArrowDownToLine size={16} />}Import voice</button></div></form></Modal>;
}

// The North Wind and the Sun (the IPA's illustration passage, chosen to elicit a
// language's phonemic contrasts) followed by call-centre lines with a question,
// an exclamation, a number, a time, an address and a phone number. ~45–60 s.
export const READING_SCRIPTS = {
  en: "The North Wind and the Sun were arguing about which of them was stronger, when a traveller came along wrapped in a warm cloak. They agreed that whoever first made the traveller take off his cloak would be the stronger. The North Wind blew as hard as he could, but the harder he blew, the more closely the traveller wrapped the cloak around him, and at last the North Wind gave up. Then the Sun shone out warmly, and at once the traveller took off his cloak. Thanks for calling — can you give me the order number? It’s four eight two one, under Dubois. The driver is two stops away, about fifteen minutes. Is the buzzer at twelve Rue de la Paix working? Wonderful, that’s sorted! If anything changes I’ll call you back on zero six, twelve, thirty-four, fifty-six, seventy-eight.",
  fr: "La bise et le soleil se disputaient, chacun assurant qu’il était le plus fort, quand ils ont vu un voyageur qui s’avançait, enveloppé dans son manteau. Ils sont tombés d’accord que celui qui arriverait le premier à le lui faire ôter serait regardé comme le plus fort. Alors la bise s’est mise à souffler de toutes ses forces, mais plus elle soufflait, plus le voyageur serrait son manteau autour de lui, et à la fin la bise a renoncé. Alors le soleil a commencé à briller, et au bout d’un moment le voyageur, réchauffé, a ôté son manteau. Merci d’avoir appelé — pouvez-vous me donner le numéro de commande ? C’est le quatre, huit, deux, un, au nom de Dubois. Le chauffeur est à deux arrêts, environ quinze minutes. Est-ce que l’interphone du douze rue de la Paix fonctionne ? Parfait, c’est réglé ! Si quelque chose change, je vous rappelle au zéro six, douze, trente-quatre, cinquante-six, soixante-dix-huit.",
  de: "Einst stritten sich Nordwind und Sonne, wer von ihnen beiden wohl der Stärkere wäre, als ein Wanderer, der in einen warmen Mantel gehüllt war, des Weges daherkam. Sie wurden einig, dass derjenige für den Stärkeren gelten sollte, der den Wanderer zwingen würde, seinen Mantel abzunehmen. Der Nordwind blies mit aller Macht, aber je mehr er blies, desto fester hüllte sich der Wanderer in seinen Mantel ein. Endlich gab der Nordwind den Kampf auf. Nun erwärmte die Sonne die Luft mit ihren freundlichen Strahlen, und schon nach wenigen Augenblicken zog der Wanderer seinen Mantel aus. Danke für Ihren Anruf — können Sie mir die Bestellnummer geben? Vier, acht, zwei, eins, auf den Namen Dubois. Der Fahrer ist zwei Haltestellen entfernt, etwa fünfzehn Minuten. Funktioniert die Klingel in der Rue de la Paix zwölf? Wunderbar, das ist erledigt! Wenn sich etwas ändert, rufe ich Sie unter null sechs, zwölf, vierunddreißig, sechsundfünfzig, achtundsiebzig zurück.",
  es: "El viento del norte y el sol discutían sobre cuál de los dos era el más fuerte, cuando pasó un viajero envuelto en una capa. Se pusieron de acuerdo en que quien primero lograra que el viajero se quitara la capa sería considerado el más fuerte. El viento del norte sopló con toda su fuerza, pero cuanto más soplaba, más se envolvía el viajero en su capa, y al final el viento desistió. Entonces el sol brilló con fuerza, y enseguida el viajero se quitó la capa. Gracias por llamar — ¿me puede dar el número de pedido? Es el cuatro, ocho, dos, uno, a nombre de Dubois. El repartidor está a dos paradas, unos quince minutos. ¿Funciona el portero del número doce de la Rue de la Paix? ¡Estupendo, ya está resuelto! Si algo cambia, le devuelvo la llamada al cero seis, doce, treinta y cuatro, cincuenta y seis, setenta y ocho.",
  nl: "De noordenwind en de zon hadden een discussie over de vraag wie van hun tweeën de sterkste was, toen er een reiziger langskwam in een warme jas. Ze spraken af dat wie de reiziger het eerst zijn jas kon laten uittrekken, de sterkste zou zijn. De noordenwind blies zo hard als hij kon, maar hoe harder hij blies, hoe dichter de reiziger zijn jas om zich heen trok, en uiteindelijk gaf de noordenwind het op. Toen scheen de zon warm, en meteen trok de reiziger zijn jas uit. Bedankt voor het bellen — kunt u mij het ordernummer geven? Het is vier, acht, twee, één, op naam van Dubois. De bezorger is twee haltes verderop, ongeveer vijftien minuten. Werkt de bel op Rue de la Paix twaalf? Geweldig, dat is geregeld! Als er iets verandert, bel ik u terug op nul zes, twaalf, vierendertig, zesenvijftig, achtenzeventig.",
};

export const REGISTERS = [
  { key: 'calm', label: 'Calm', hint: 'Your everyday desk voice. Steady, unhurried. Record this one first.' },
  { key: 'warm', label: 'Warm', hint: 'As if the caller is a friend: a smile in the voice, a little more energy.' },
  { key: 'energetic', label: 'Energetic', hint: 'Bright and quick, the way you speak when something needs doing now.' },
  { key: 'reassuring', label: 'Reassuring', hint: 'Steady and certain: the caller should feel it is handled.' },
  { key: 'apologetic', label: 'Apologetic', hint: 'Softer and slower, as if something went wrong and it matters to you.' },
  { key: 'firm', label: 'Firm', hint: 'Clear boundaries without an edge. For the rules you cannot bend.' },
];
export const VOICE_READING_SCRIPT = "Hello, it’s good to meet you. I’m here to listen and help you find the right answer. What would you like to talk about today? Take your time; there’s no need to rush. We can check the details together, one step at a time. Your delivery is arriving tomorrow morning, between nine and eleven. If anything changes, please let me know. Thank you for calling, and I hope you have a wonderful day.";
