// Phrases: the saved lines one click on the desk says in full, in your voice.
// One list, saved whole.
import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { languageName } from '../lib.jsx';
import { Toolbar, Title, Tabs, ReadBar, Body, Empty, Ask } from '../shell.jsx';
import './phrases.css';

const MAX = 30;
const shortOf = phrase => phrase.short || phrase.text.trim().split(/\s+/)[0].toLowerCase().replace(/[^\p{L}\p{N}]/gu, '') || '…';

export default function PhrasesPage({ data, saveSettings }) {

  const [draft, setDraft] = useState('');
  const list = data.settings.phrases || [];
  const code = data.settings.customerLanguage;
  const caller = code === 'auto' ? 'the caller’s language' : languageName(code);
  const save = phrases => saveSettings({ phrases });
  const add = () => { const text = draft.trim(); if (!text || list.length >= MAX) return; save([...list, { id: `p-${Date.now().toString(36)}`, text }]); setDraft(''); };
  return <>
    <Toolbar />
    <Title title="Phrases" sub="One click on the desk says the full line in your voice." />
    <ReadBar right={list.length >= MAX ? <span className="ds-note">{MAX} of {MAX}</span> : undefined}><Plus size={14} /><input value={draft} maxLength={300} placeholder="New phrase" aria-label="New phrase" disabled={list.length >= MAX} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} /></ReadBar>
    <Body>
      {list.length ? list.map(phrase => <div className="phrases-item" key={phrase.id}>
        <div className="head"><span className="ds-chip ink">{shortOf(phrase)}</span><strong>{phrase.text}</strong><button type="button" className="ds-tool" aria-label={`Remove: ${phrase.text}`} onClick={() => save(list.filter(item => item.id !== phrase.id))}><Trash2 size={14} /></button></div>
        <p>{code !== 'auto' && <b>{code.toUpperCase()}</b>}Said in {caller} on the desk</p>
      </div>) : <Empty title="Save the lines you say on every call.">One click on the desk says a line in {caller}, in your voice.</Empty>}
    </Body>
    <Ask placeholder="Ask for a phrase" scope="settings" />
  </>;
}
