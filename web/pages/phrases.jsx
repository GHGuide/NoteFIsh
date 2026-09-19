// Two lists that both decide what the caller hears, so they live on one screen.
//
// Phrases are whole lines you send without speaking. Words are the opposite: not things
// to say, but things that must survive being translated — a surname, a part number, an
// address. Words were a screen of their own called Glossary, which did not say what it
// was for, so nobody used it.
import React, { useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { languageName } from '../lib.jsx';
import { Toolbar, Title, Tabs, ReadBar, Body, Empty, Ask, SelectPill } from '../shell.jsx';
import Explainer from '../components/explainer.jsx';
import './phrases.css';

const MAX_PHRASES = 30, MAX_WORDS = 200;
const RULES = [
  { value: 'keep', label: 'Keep as written' },
  { value: 'as', label: 'Say it as' },
  { value: 'spell', label: 'Spell it out' },
];
/** What you call a phrase on the desk. Derived from its first words until you name it. */
const triggerOf = phrase => phrase.short || phrase.text.trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, '') || 'phrase';

/** Edit in place: click the text, type, Enter saves, Escape puts it back. */
function Editable({ value, onSave, className = '', placeholder, maxLength = 300, multiline = false }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) return <button type="button" className={`ph-edit ${className}`} onClick={() => { setDraft(value); setEditing(true); }} title="Click to edit">{value || <span className="ph-ghost">{placeholder}</span>}</button>;
  const stop = save => { setEditing(false); if (save && draft.trim() && draft.trim() !== value) onSave(draft.trim()); };
  const Tag = multiline ? 'textarea' : 'input';
  return <span className={`ph-editing ${className}`}>
    <Tag
      autoFocus value={draft} maxLength={maxLength} rows={multiline ? 2 : undefined}
      onChange={event => setDraft(event.target.value)}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); stop(false); }
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); stop(true); }
      }}
      onBlur={() => stop(true)}
    />
    <button type="button" className="ds-tool" aria-label="Save" onMouseDown={event => event.preventDefault()} onClick={() => stop(true)}><Check size={14} /></button>
    <button type="button" className="ds-tool" aria-label="Cancel" onMouseDown={event => event.preventDefault()} onClick={() => stop(false)}><X size={14} /></button>
  </span>;
}

export default function PhrasesPage({ data, route, navigate, saveSettings }) {
  const tab = route.query.tab === 'words' ? 'words' : 'phrases';
  const setTab = key => navigate(key === 'phrases' ? '/phrases' : `/phrases?tab=${key}`);
  const [draft, setDraft] = useState('');
  const phrases = data.settings.phrases || [];
  const words = data.settings.glossary || [];
  const code = data.settings.customerLanguage;
  const caller = code === 'auto' ? 'whatever the caller speaks' : languageName(code);
  const cap = tab === 'phrases' ? MAX_PHRASES : MAX_WORDS;
  const full = (tab === 'phrases' ? phrases.length : words.length) >= cap;

  const add = () => {
    const text = draft.trim();
    if (!text || full) return;
    if (tab === 'phrases') saveSettings({ phrases: [...phrases, { id: `p-${Date.now().toString(36)}`, text }] });
    else saveSettings({ glossary: [...words, { id: `g-${Date.now().toString(36)}`, term: text, kind: 'keep', as: '' }] });
    setDraft('');
  };
  const patchPhrase = (id, changes) => saveSettings({ phrases: phrases.map(item => item.id === id ? { ...item, ...changes } : item) });
  const patchWord = (id, changes) => saveSettings({ glossary: words.map(item => item.id === id ? { ...item, ...changes } : item) });

  return <>
    <Toolbar />
    <Title title="Phrases" sub="The lines you send without speaking, and the words that must survive being translated." />
    <Tabs items={[{ key: 'phrases', label: 'Phrases', count: phrases.length }, { key: 'words', label: 'Words', count: words.length }]} value={tab} onChange={setTab} />
    <ReadBar right={full ? <span className="ds-note">{cap} of {cap} · remove one to add another</span> : undefined}>
      <Plus size={14} />
      <input
        value={draft} maxLength={tab === 'phrases' ? 300 : 120} disabled={full}
        placeholder={tab === 'phrases' ? 'A line you say often, in your own language' : 'A name, a part number, an address'}
        aria-label={tab === 'phrases' ? 'New phrase' : 'New word'}
        onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') add(); }}
      />
    </ReadBar>
    <Body>
      {tab === 'phrases' ? <>
        <Explainer
          id="phrases" puff="tuft" color="#E2732A"
          title={<>The lines you say <em>every</em> day.</>}
          sub={`Write it once in your own language. On the desk one click sends it translated into ${caller}, spoken in your voice, without you saying a word.`}
          examples={[
            { say: 'one moment', then: 'Un instant, je vérifie pour vous.' },
            { say: 'call you back', then: 'Je vous rappelle dans dix minutes.' },
          ]}
        />
        {!phrases.length ? <Empty title="Nothing saved yet.">Add the line you find yourself saying on every call. It is translated and spoken in your voice like anything else.</Empty>
          : phrases.map(phrase => <div className="ph-item" key={phrase.id}>
            <div className="head">
              <Editable className="ph-trigger" value={triggerOf(phrase)} maxLength={40} placeholder="what you call it" onSave={short => patchPhrase(phrase.id, { short })} />
              <Editable className="ph-text" value={phrase.text} multiline onSave={text => patchPhrase(phrase.id, { text })} />
              <button type="button" className="ds-tool" aria-label={`Remove ${triggerOf(phrase)}`} onClick={() => saveSettings({ phrases: phrases.filter(item => item.id !== phrase.id) })}><Trash2 size={14} /></button>
            </div>
            <p className="ds-note">Sent in {caller}, in your voice.</p>
          </div>)}
      </> : <>
        <Explainer
          id="words" puff="bloom" color="#7A4E2D"
          title={<>The words it is <em>not</em> allowed to get wrong.</>}
          sub="A surname, a part number, a street. Left alone, a translator quietly turns them into something else. Put one here, say how it should be handled, and it stops guessing."
          examples={[
            { say: 'Dubois', then: 'stays Dubois, in every language' },
            { say: 'SKU-4471', then: 'read out character by character' },
          ]}
        />
        {!words.length ? <Empty title="Nothing pinned yet.">Add a name or a number that keeps coming out wrong, and it will stop.</Empty>
          : words.map(word => <div className="ph-item word" key={word.id}>
            <div className="head">
              <Editable className="ph-term" value={word.term} maxLength={120} onSave={term => patchWord(word.id, { term })} />
              <SelectPill aria-label={`How to handle ${word.term}`} value={word.kind} onChange={kind => patchWord(word.id, { kind })} options={RULES} />
              {word.kind === 'as' && <Editable className="ph-as" value={word.as || ''} placeholder="say it as…" maxLength={200} onSave={as => patchWord(word.id, { as })} />}
              <button type="button" className="ds-tool" aria-label={`Remove ${word.term}`} onClick={() => saveSettings({ glossary: words.filter(item => item.id !== word.id) })}><Trash2 size={14} /></button>
            </div>
            <p className="ds-note">{word.kind === 'as' ? <>Spoken as <b>{word.as || '…'}</b> in {caller}.</> : word.kind === 'spell' ? 'Read out character by character, never as a word.' : <>Left exactly as written, in {caller} and every other language.</>}</p>
          </div>)}
      </>}
    </Body>
    <Ask placeholder={tab === 'phrases' ? 'Ask for a phrase' : 'Ask how a word will be said'} scope="settings" />
  </>;
}
