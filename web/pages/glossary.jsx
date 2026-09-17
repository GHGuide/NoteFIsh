// Glossary: words that stay exactly as written, in every language. The list
// lives on the workspace settings and is saved whole on every change.
import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { languageName } from '../lib.jsx';
import { Toolbar, Title, Tabs, ReadBar, Body, Row, SelectPill, Empty, Ask } from '../shell.jsx';
import './glossary.css';

const KINDS = [{ value: 'keep', label: 'Keep as written' }, { value: 'as', label: 'Translate as' }, { value: 'spell', label: 'Spell out' }];
const TABS = [{ key: 'all', label: 'All' }, ...KINDS.map(kind => ({ key: kind.value, label: kind.label }))];

export default function GlossaryPage({ data, saveSettings, role = 'admin' }) {
  const canEdit = role !== 'agent';
  const [tab, setTab] = useState('all');
  const [draft, setDraft] = useState('');
  const list = data.settings.glossary || [];
  const caller = data.settings.customerLanguage === 'auto' ? 'the caller’s language' : languageName(data.settings.customerLanguage);
  const save = glossary => saveSettings({ glossary });
  const patch = (id, changes) => save(list.map(item => item.id === id ? { ...item, ...changes } : item));
  // A new entry takes the kind of the open tab so it does not vanish from view.
  const add = () => { const term = draft.trim(); if (!term || list.length >= 200) return; save([...list, { id: `g-${Date.now().toString(36)}`, term, kind: tab === 'all' ? 'keep' : tab, as: '' }]); setDraft(''); };
  const shown = tab === 'all' ? list : list.filter(item => item.kind === tab);
  const sub = item => item.kind === 'as' ? `Say in ${caller} as: ${item.as || '…'}` : item.kind === 'spell' ? 'Read digit by digit' : 'Never translated';
  return <>
    <Toolbar />
    <Title title="Glossary" sub={canEdit ? 'Words that stay exactly as written, in every language' : 'Words that stay exactly as written, in every language · kept by your supervisor'} />
    <Tabs items={TABS} value={tab} onChange={setTab} />
    {canEdit && <ReadBar><Plus size={14} /><input value={draft} maxLength={120} placeholder="Add a word or phrase" aria-label="Add a word or phrase" disabled={list.length >= 200} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') add(); }} /></ReadBar>}
    <Body>
      {shown.length ? shown.map(item => <Row key={item.id} main={item.term} sub={sub(item)} right={canEdit && <>
        {item.kind === 'as' && <input key={item.as} className="glossary-as" aria-label={`${item.term} in ${caller}`} defaultValue={item.as} maxLength={200} placeholder={`In ${caller}…`} onBlur={event => { const as = event.target.value.trim(); if (as !== (item.as || '')) patch(item.id, { as }); }} onKeyDown={event => { if (event.key === 'Enter') event.target.blur(); }} />}
        <SelectPill aria-label={`How to say ${item.term}`} value={item.kind} onChange={kind => patch(item.id, { kind })} options={KINDS} />
        <button type="button" className="ds-tool" aria-label={`Remove ${item.term}`} onClick={() => save(list.filter(entry => entry.id !== item.id))}><Trash2 size={14} /></button>
      </>} />) : <Empty title={list.length ? 'Nothing of this kind yet.' : 'Nothing kept yet.'}>Names, products and addresses you add here are never translated.</Empty>}
    </Body>
    <Ask placeholder="Ask how a term will be said" scope="settings" />
  </>;
}
