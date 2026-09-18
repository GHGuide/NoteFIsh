// Voice: the voice callers hear (the one in use, one take per feeling, the
// library), the puff that stands for you, and how formal replies are.
import React, { useEffect, useRef, useState } from 'react';
import { Share2, Trash2, Archive, ArrowDownToLine, AudioLines, Check, Globe2, Mic, MoreHorizontal, Play, RefreshCw, Search, Settings2, Square } from 'lucide-react';
import { api } from '../api.js';
import { Toolbar, Title, Tabs, ReadBar, Body, Col, Label, Status, Chip, Row, Btn, TextBtn, Pill, SelectPill, Field, Switch, Option, Setting, Empty, Spinner, Ask, Avatar, Puff, PUFFS, SWATCHES, avatarOf } from '../shell.jsx';
import { useCapture, VoiceModal, ImportModal, REGISTERS, READING_SCRIPTS, downloadJson, isArchived, languageName, formatDuration, callState } from '../lib.jsx';
import { ActionMenu } from '../components/ui.jsx';
import AudioWaveform from '../components/AudioWaveform.jsx';
import RecordedAudio from '../components/RecordedAudio.jsx';
import Explainer from '../components/explainer.jsx';
import { useConfirm } from '../components/confirm.jsx';
import './voice.css';

const TABS = [{ key: 'voice', label: 'Your voice' }, { key: 'takes', label: 'Takes' }, { key: 'avatar', label: 'Avatar' }, { key: 'register', label: 'Register' }, { key: 'library', label: 'Library' }];
const AUDIO_ACCEPT = 'audio/wav,audio/mpeg,audio/mp4,audio/webm,audio/ogg,.wav,.mp3,.m4a,.webm,.ogg';
const FORMALITY = [['formal', 'Formal', "vous · Sie · usted. The default for callers you don't know."], ['casual', 'Casual', 'tu · du · tú. For repeat callers who use it first.'], ['match', 'Match the caller', 'Follow whatever register the caller uses.']];
const kindOf = voice => voice.kind === 'licensed' ? 'Licensed voice' : 'Voice clone';
const toneOf = voice => isArchived(voice) ? ['muted', 'Archived'] : voice.status === 'ready' ? ['green', 'Ready'] : voice.status === 'training' ? ['amber', 'Training'] : ['red', 'Needs attention'];
const feelingOf = key => REGISTERS.find(item => item.key === key);
const dateOf = value => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' });

export default function VoicePage(common) {
  const ask = useConfirm();
  const { data, navigate, route, setError, setNotice, saveOwned, owned, refreshVoices, user } = common;
  const [localTab, setLocalTab] = useState('voice');
  const tab = TABS.some(item => item.key === route.query.tab) ? route.query.tab : localTab;
  const setTab = key => { setLocalTab(key); navigate(`/voice?tab=${key}`); };
  const [selectedId, setSelectedId] = useState(null);
  const [importing, setImporting] = useState(false);
  const voiceId = owned('voiceId') || data.settings.voiceId || '';
  const selected = data.voices.find(item => item.id === selectedId);
  const use = async chosen => { if (await saveOwned({ voiceId: chosen.id })) { setNotice(`${chosen.name} answers your calls.`); setSelectedId(null); } };
  // A voice travels as a small file: the Fish reference and consent, never audio.
  const share = async voice => { try { downloadJson(`${voice.name}.notefish-voice.json`, await api.exportVoice(voice.id)); setNotice('Voice file saved. Send it to a colleague; they drop it on Voice › Library.'); } catch (failure) { setError(failure.message); } };
  const importFile = async file => {
    try {
      const pack = JSON.parse(await file.text());
      const names = (pack?.voices || []).map(item => item.name).filter(Boolean);
      if (!await ask({
        title: names.length === 1 ? `Import ${names[0]}?` : `Import ${names.length || 'these'} voices?`,
        body: 'Import only voices you recorded yourself, or have the speaker\u2019s permission to use. They join your library and can answer calls.',
        confirm: 'Import',
      })) return;
      const result = await api.importPack({ pack, consent: true }); await refreshVoices();
      setNotice(`${result.imported.length} voice${result.imported.length === 1 ? '' : 's'} imported${result.skipped.length ? `, ${result.skipped.length} already here` : ''}.`);
    } catch (failure) { setError(failure.message.startsWith('Unexpected') ? 'That is not a NoteFish voice file.' : failure.message); }
  };
  const shared = { share, importFile, ...common, setTab, setSelectedId, setImporting, use, voiceId, me: { name: user?.name || 'workspace', avatar: data.settings.avatar }, voice: data.voices.find(item => item.id === voiceId), ready: data.voices.filter(item => item.status === 'ready' && !isArchived(item) && (item.usable ?? true)), registers: owned('registers') || {} };
  const Section = { voice: YourVoice, takes: Takes, avatar: AvatarTab, register: Register, library: Library }[tab];
  return <>
    <Toolbar />
    <Title title="Voice" sub={tab === 'takes' ? 'One take is enough. Record more feelings only if you want them to sound exactly like you.' : 'How you sound to callers, and the puff that stands for you'} />
    <Tabs items={TABS} value={tab} onChange={setTab} />
    <Section {...shared} />
    <Ask placeholder="Ask how a reply will sound" scope="settings" />
    {selected && <VoiceModal voice={selected} agentLanguage={data.settings.agentLanguage} customerLanguage={data.settings.customerLanguage} onClose={() => setSelectedId(null)} setError={setError} setNotice={setNotice} refreshVoices={refreshVoices} onUse={() => use(selected)} />}
    {importing && <ImportModal onClose={() => setImporting(false)} setError={setError} setNotice={setNotice} refreshVoices={refreshVoices} />}
  </>;
}

function YourVoice({ data, owned, saveOwned, me, voice, ready, registers, setTab, setSelectedId, share }) {
  const own = owned('voiceId') || '';
  const ownVoice = data.voices.find(item => item.id === own);
  const choices = ownVoice && !ready.includes(ownVoice) ? [ownVoice, ...ready] : ready;
  const options = [...(own ? [] : [{ value: '', label: ready.length ? 'Choose a voice' : 'No voice yet', disabled: true }]), ...choices.map(item => ({ value: item.id, label: item.name }))];
  const taken = REGISTERS.filter(item => registers[item.key]);
  return <Body>
    <Explainer
      id="voice" puff="fish" color="#2E9E86"
      title={<>The voice they hear is <em>yours</em>.</>}
      sub="Read one short passage and NoteFish answers in your own voice, in a language you may not even speak. Record more feelings and it matches the mood of the call."
      examples={[
        { say: 'a calm take', then: 'how you sound most of the time' },
        { say: 'an apologetic take', then: 'used when the caller is upset' },
      ]}
      action={{ label: 'Record a take', onClick: () => setTab('takes') }}
    />
    <div className="ds-card"><Avatar who={me} size={54} /><div><strong>{voice ? `${voice.name} · ${voice.kind === 'licensed' ? 'licensed voice' : 'your voice'}` : 'No voice yet'}</strong><span>{voice ? [voice.createdAt && `Recorded ${dateOf(voice.createdAt)}`, languageName(voice.language || 'en'), kindOf(voice)].filter(Boolean).join(' · ') : 'Read one short passage and callers hear you in their language.'}</span></div>
      <div className="actions">{voice && <Btn pill kind="ghost" icon={<Play size={12} />} onClick={() => setSelectedId(voice.id)}>Hear it</Btn>}{voice && (voice.mine ?? true) && <Btn pill kind="ghost" icon={<Share2 size={12} />} onClick={() => share(voice)}>Share</Btn>}<Btn pill icon={<Mic size={13} />} onClick={() => setTab('takes')}>{voice ? 'Re-record' : 'Record'}</Btn></div></div>
    <h3>Voice for calls</h3>
    <Setting main="Which voice answers" sub="The voice every reply is spoken in. Switch between them here or in the sidebar."><SelectPill aria-label="Which voice answers" value={own} onChange={id => saveOwned({ voiceId: id || null })} options={options} /></Setting>
    <h3>Takes</h3>
    <Setting main={taken.length ? `${taken.length} of ${REGISTERS.length} feelings recorded` : 'One take is enough'} sub={taken.length ? taken.map(item => item.label).join(', ') : 'The desk adds the feeling itself. A take per feeling makes it sound exactly like you.'}><TextBtn onClick={() => setTab('takes')}>{taken.length ? 'Record more' : 'Record a take'}</TextBtn></Setting>
  </Body>;
}

function Takes({ data, user, registers, setError, setNotice, saveOwned, refreshVoices, trainingNotes, sharedDemo, setSelectedId }) {
  const [register, setRegister] = useState('calm');
  const [language, setLanguage] = useState(READING_SCRIPTS[data.settings.customerLanguage] ? data.settings.customerLanguage : 'en');
  const [sample, setSample] = useState(null);
  const [name, setName] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState(null);
  const fileInput = useRef(null);
  const feeling = feelingOf(register);
  const script = READING_SCRIPTS[language] || READING_SCRIPTS.en;
  const liveCall = data.calls.some(call => ['ringing', 'in_call'].includes(callState(call)));
  const created = data.voices.find(item => item.id === savedId);
  const take = next => { setSample(next); setName(`${user?.name || 'My voice'} · ${feeling.label}`); setConsent(false); setSavedId(null); };
  const capture = useCapture((blob, duration) => {
    if (duration < 10) { setError('Read for at least 10 seconds. Try reading the whole passage at your usual pace.'); return; }
    if (duration < 30) setNotice('Under 30 seconds. It will work, but 45–60 seconds sounds more like you.');
    take({ blob, duration, name: `voice-recording.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`, transcript: script });
  });
  useEffect(() => { if (capture.error) setError(capture.error); }, [capture.error]);
  useEffect(() => { if (liveCall) capture.stop(true); }, [liveCall, capture.stop]);
  const upload = file => {
    if (!file) return;
    if (!/\.(wav|mp3|m4a|webm|ogg)$/i.test(file.name) && !['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4', 'audio/webm', 'audio/ogg'].includes(file.type)) { setError('Choose a WAV, MP3, M4A, WebM, or OGG recording.'); return; }
    if (file.size > 30 * 1024 * 1024) { setError('Choose a recording smaller than 30 MB.'); return; }
    take({ blob: file, name: file.name, transcript: '' });
  };
  const submit = async event => {
    event.preventDefault(); if (!sample || !consent || !name.trim() || busy || liveCall) return;
    setBusy(true);
    try {
      const payload = new FormData();
      for (const [key, value] of Object.entries({ name: name.trim(), language, transcript: sample.transcript, consent: 'true', register })) payload.append(key, value);
      payload.append('audio', sample.blob, sample.name);
      const result = await api.createVoice(payload);
      await refreshVoices(result.voice);
      await saveOwned({ registers: { ...registers, [register]: result.voice.id } });
      setSavedId(result.voice.id); setSample(null);
      setNotice(`${feeling.label} take saved to your library.`);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  };
  if (sample) return <Body tight><form className="ds-stack voice-review" onSubmit={submit}>
    <div className="voice-review-head"><Label>{feeling.label} take · {languageName(language)}</Label><TextBtn muted icon={<RefreshCw size={13} />} disabled={busy} onClick={() => setSample(null)}>Record again</TextBtn></div>
    <RecordedAudio blob={sample.blob} />
    <Field label="Voice name"><input required maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></Field>
    <label className="ds-check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={busy} required /><span>This is my voice, or I have permission to clone it and use it for translated calls.</span></label>
    {liveCall && <div className="ds-info">Finish the call before creating a voice.</div>}
    <Btn type="submit" icon={busy ? <Spinner size={15} /> : <AudioLines size={16} />} disabled={busy || !consent || !name.trim() || liveCall}>{busy ? 'Creating your voice…' : 'Create voice'}</Btn>
    {sharedDemo && <p className="ds-note">Saved voices are available to everyone using this shared demo.</p>}
  </form></Body>;
  return <>
    <Col className="ds-pillrow" style={{ marginTop: 18 }}><Label>Take</Label>{REGISTERS.map(item => <Pill key={item.key} on={item.key === register} disabled={capture.recording} onClick={() => setRegister(item.key)}>{item.label}{registers[item.key] && <Check size={11} strokeWidth={2.6} />}</Pill>)}<SelectPill bar className="voice-lang" aria-label="Recording language" lead={<Globe2 size={13} />} value={language} onChange={setLanguage} disabled={capture.recording} options={Object.keys(READING_SCRIPTS).map(code => ({ value: code, label: languageName(code) }))} /></Col>
    <Body tight className="ds-stack">
      {created && <div className="ds-card"><Avatar who={created.name} size={40} /><div><strong>{created.name}</strong><span>{[created.register && `${feelingOf(created.register)?.label} take`, kindOf(created), toneOf(created)[1]].filter(Boolean).join(' · ')}</span></div>{created.status === 'ready' && <div className="actions"><Btn pill kind="ghost" icon={<Play size={12} />} onClick={() => setSelectedId(created.id)}>Hear it</Btn></div>}</div>}
      {created?.status === 'training' && <div className="ds-info"><Spinner size={14} />{trainingNotes[created.id] || 'Fish is preparing your voice. You can keep using the desk while it finishes.'}</div>}
      {created?.status === 'failed' && <div className="ds-info">{created.error || 'Fish could not create this voice. Try another clear recording.'}</div>}
      <div className="ds-script"><div className="head"><span className="ds-label">Read this aloud</span><span>{feeling.hint} · 45–60 s</span></div><p>{script}</p></div>
    </Body>
    <Col className="ds-foot voice-foot">
      {liveCall && <div className="ds-info">Finish the call before creating a voice.</div>}
      {capture.recording && <AudioWaveform stream={capture.stream} active={!capture.interrupted} height={36} label="Live microphone level" />}
      <Btn kind={capture.recording ? 'red' : 'ink'} className="voice-record" icon={capture.requesting ? <Spinner size={15} /> : capture.recording ? <Square size={15} fill="currentColor" /> : <Mic size={15} />} disabled={liveCall || capture.requesting} onClick={() => capture.recording ? capture.stop() : capture.start().catch(failure => setError(failure.message))}>{capture.requesting ? 'Allow microphone access…' : capture.recording ? `Stop recording · ${formatDuration(capture.seconds)}` : 'Record my voice'}</Btn>
      <span className="ds-note" role="status">{capture.interrupted ? 'Microphone paused. Check your microphone or stop and try again.' : capture.recording ? 'Stop when you finish the passage.' : 'One speaker. No music. Keep one feeling for the whole passage.'}</span>
      {capture.requesting ? <TextBtn onClick={() => capture.stop(true)}>Cancel</TextBtn> : <TextBtn disabled={capture.recording || liveCall} onClick={() => fileInput.current?.click()}>Use an existing recording</TextBtn>}
      <input hidden ref={fileInput} type="file" accept={AUDIO_ACCEPT} onChange={event => { upload(event.target.files[0]); event.target.value = ''; }} />
    </Col>
  </>;
}

function AvatarTab({ user, owned, saveOwned }) {
  const [draft, setDraft] = useState(null);
  useEffect(() => { setDraft(null); }, [owned('voiceId')]);
  const saved = owned('avatar');
  const fallback = avatarOf(user?.name || 'workspace');
  const avatar = draft || (saved?.variant && saved?.color ? { variant: saved.variant, color: saved.color, face: saved.face !== false } : fallback);
  const change = next => { setDraft(next); saveOwned({ avatar: next }); };
  return <Body tight className="voice-look">
    <div className="voice-big"><Puff variant={avatar.variant} color={avatar.color} size={92} /></div>
    <div className="ds-panel">
      <div className="head"><button type="button" className="ds-ptab on">Shape</button><button type="button" className="ds-ptab" disabled title="Coming soon">Generate</button><button type="button" className="ds-ptab" disabled title="Coming soon">Upload</button><span style={{ flex: 1 }} /><TextBtn muted onClick={() => { setDraft(fallback); saveOwned({ avatar: null }); }}>Reset</TextBtn></div>
      <div className="ds-avatar-cells">{PUFFS.map(variant => <button type="button" key={variant} className={`ds-avatar-cell ${variant === avatar.variant ? 'on' : ''}`} aria-label={variant} aria-pressed={variant === avatar.variant} onClick={() => change({ ...avatar, variant })}><Puff variant={variant} color={avatar.color} size={44} /></button>)}</div>
      {[SWATCHES.slice(0, 6), SWATCHES.slice(6)].map((row, index) => <div className="ds-swatches" key={index}>{row.map(([name, color]) => <button type="button" key={color} className={`ds-swatch ${color === avatar.color ? 'on' : ''}`} style={{ background: color }} aria-label={name} aria-pressed={color === avatar.color} onClick={() => change({ ...avatar, color })} />)}</div>)}
    </div>
    <div className="ds-toggle-row"><div><strong>Show my face</strong><span>Off shows the puff without eyes in lists and call records.</span></div><Puff variant={avatar.variant} color={avatar.color} size={32} face={false} /><Switch checked={avatar.face} onChange={face => change({ ...avatar, face })} label="Show my face" /></div>
  </Body>;
}

function Register({ owned, saveOwned }) {
  const formality = owned('formality') || 'formal';
  const persona = owned('persona') || '';
  return <Body tight>
    <h3 className="voice-first">Register</h3>
    {FORMALITY.map(([key, main, sub]) => <Option key={key} on={formality === key} main={main} sub={sub} onClick={() => saveOwned({ formality: key })} />)}
    <Field label="House style" className="voice-style"><textarea key={persona} rows={3} maxLength={300} defaultValue={persona} placeholder="Brief and friendly. Formal “vous”. Never promise a time you can’t keep." onBlur={event => { const next = event.target.value.trim(); if (next !== persona) saveOwned({ persona: next }); }} /></Field>
    <p className="ds-note">Shapes how replies are worded before they are spoken — length, politeness, phrasing. Facts and meaning never change.</p>
  </Body>;
}

function Library({data, loading, voiceId, trainingNotes, setError, setNotice, refreshVoices, setSelectedId, setImporting, setTab, use, importFile, share }) {
  const ask = useConfirm();
  const [over, setOver] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const attempt = fn => fn().catch(failure => setError(failure.message));
  const act = (voice, fn) => { setBusy(voice.id); attempt(fn).finally(() => setBusy('')); };
  const matches = voice => `${voice.name} ${voice.description || ''} ${languageName(voice.language || 'en')}`.toLowerCase().includes(query.trim().toLowerCase());
  const shown = data.voices.filter(voice => !isArchived(voice) && matches(voice));
  const archived = data.voices.filter(voice => isArchived(voice) && matches(voice));
  // What you may do to a voice: preview anything you can use; edit, share, archive and delete only what is yours (or everything, as an admin).
  const menu = voice => { const mine = voice.mine ?? true; return [
    { id: 'preview', label: 'Preview voice', icon: Play, disabled: voice.status !== 'ready' || isArchived(voice) || !(voice.usable ?? true), opensDialog: true, onSelect: () => setSelectedId(voice.id) },
    mine && { id: 'edit', label: 'Edit voice details', icon: Settings2, opensDialog: true, onSelect: () => setSelectedId(voice.id) },
    { separator: true },
    { id: 'refresh', label: 'Refresh voice status', icon: RefreshCw, onSelect: () => act(voice, async () => { await api.refreshVoice(voice.id); await refreshVoices(); setNotice('Voice status refreshed.'); }) },
    mine && { id: 'export', label: 'Share voice file', icon: ArrowDownToLine, onSelect: () => act(voice, async () => { downloadJson(`${voice.name}.notefish-voice.json`, await api.exportVoice(voice.id)); setNotice('Voice file downloaded. Import it on any other desk.'); }) },
    mine && { separator: true },
    mine && { id: 'archive', label: isArchived(voice) ? 'Restore voice' : 'Archive voice', icon: Archive, onSelect: () => act(voice, async () => { await api.editVoice(voice.id, { archived: !isArchived(voice) }); await refreshVoices(); setNotice(isArchived(voice) ? 'Voice restored.' : 'Voice archived. You can restore it from Archived.'); }) },
    mine && voice.kind === 'enrolled' && { id: 'delete', label: 'Delete for good', icon: Trash2, onSelect: async () => { if (await ask({ title: `Delete ${voice.name}?`, body: 'The clone is removed from Fish Audio as well as from this library, and any call set to answer in it falls back to the desk\u2019s other voice. This cannot be undone.', confirm: 'Delete for good', tone: 'red' })) act(voice, async () => { await api.deleteVoice(voice.id); await refreshVoices(); setNotice(`${voice.name} deleted at Fish and removed here.`); }); } },
  ].filter(Boolean); };
  const line = voice => {
    const [tone, word] = toneOf(voice);
    const usable = voice.status === 'ready' && !isArchived(voice) && (voice.usable ?? true);
    return <Row key={voice.id} lead={<span className="lead"><Avatar who={voice.name} size={30} /></span>}
      main={<>{voice.name}{voice.id === voiceId && <Chip tone="ink">Desk voice</Chip>}{voice.register && <Chip>{feelingOf(voice.register)?.label} take</Chip>}{voice.kind === 'enrolled' && voice.owner && !(voice.mine ?? true) && <Chip>{voice.owner.split(' ')[0]}’s</Chip>}</>}
      sub={[kindOf(voice), languageName(voice.language || 'en'), voice.status === 'training' && !isArchived(voice) ? trainingNotes[voice.id] || 'Fish is creating this voice' : voice.status === 'failed' && !isArchived(voice) ? voice.error || word : word].join(' · ')}
      right={<><Status tone={tone}>{word}</Status>{usable && voice.id !== voiceId && <TextBtn disabled={busy === voice.id} onClick={() => act(voice, () => use(voice))}>Use</TextBtn>}<ActionMenu label={`Actions for ${voice.name}`} items={menu(voice)}><button type="button" className="ds-tool" aria-label={`Manage ${voice.name}`} disabled={busy === voice.id}>{busy === voice.id ? <Spinner size={15} /> : <MoreHorizontal size={16} />}</button></ActionMenu></>} />;
  };
  return <>
    <ReadBar right={<><TextBtn onClick={() => setImporting(true)}>Import</TextBtn><TextBtn onClick={() => attempt(async () => { downloadJson('notefish-voices.json', await api.exportVoices()); setNotice('Voice library exported.'); })}>Export library</TextBtn></>}><Search size={14} /><input type="search" placeholder="Search voices" aria-label="Search voices" value={query} onChange={event => setQuery(event.target.value)} /></ReadBar>
    <Body tight className="voice-lib">
      <label className={`voice-drop ${over ? 'over' : ''}`} onDragOver={event => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={event => { event.preventDefault(); setOver(false); const file = event.dataTransfer.files?.[0]; if (file) importFile(file); }}>
        <ArrowDownToLine size={16} /><span>Drop a NoteFish voice file here, or <b>choose one</b>. Share yours with the Share button on any voice.</span>
        <input type="file" accept="application/json,.json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) importFile(file); event.target.value = ''; }} />
      </label>
      {loading ? <div className="ds-info"><Spinner size={14} />Loading your voices…</div>
        : !data.voices.length ? <Empty icon={<AudioLines size={34} strokeWidth={1.4} />} title="Every conversation starts with a voice." actions={<><Btn small icon={<Mic size={14} />} onClick={() => setTab('takes')}>Record</Btn><Btn small kind="ghost" icon={<ArrowDownToLine size={14} />} onClick={() => setImporting(true)}>Import</Btn></>}>Add a short recording to make your first voice clone, or import a Fish voice you already have.</Empty>
        : <>{shown.map(line)}{!shown.length && <p className="ds-note voice-none">{query ? 'No voices match. Try another name or language.' : 'Your active voices appear here.'}</p>}{archived.length > 0 && <><Label style={{ margin: '18px 0 2px' }}>Archived</Label>{archived.map(line)}</>}</>}
    </Body>
  </>;
}
