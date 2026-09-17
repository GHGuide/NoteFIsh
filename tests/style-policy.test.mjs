import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseRegister, taggedText, registerFor, SENTENCE_TAGS, REGISTERS, canonicalRegister } from '../server/emotion.mjs';
import { migrateState } from '../server/store.mjs';

const medium = { level: 'medium', rateRatio: 1 };

test('the register follows a chosen feeling, then the caller, then how the agent spoke', () => {
  assert.deepEqual(chooseRegister({ override: 'warm', tone: 'energetic', arousal: { level: 'high' }, callerTone: 'upset' }), { register: 'warm', reason: 'chosen' }, 'a chosen feeling beats everything');
  assert.deepEqual(chooseRegister({ tone: 'calm', arousal: medium, callerTone: 'upset' }), { register: 'apologetic', reason: 'caller upset' });
  assert.deepEqual(chooseRegister({ tone: 'energetic', arousal: medium, callerTone: 'upset' }), { register: 'apologetic', reason: 'caller upset' }, 'an energetic agent does not escalate an upset caller');
  assert.deepEqual(chooseRegister({ tone: 'firm', arousal: medium, callerTone: 'upset' }), { register: 'firm', reason: 'said' }, 'firm is deliberate and stays');
  assert.deepEqual(chooseRegister({ tone: 'apologetic', arousal: medium, callerTone: 'upset' }), { register: 'apologetic', reason: 'said' }, 'an apology the agent already made is theirs');
  assert.deepEqual(chooseRegister({ tone: 'calm', arousal: medium, longWait: true, firstReply: true }), { register: 'apologetic', reason: 'long wait' });
  assert.deepEqual(chooseRegister({ tone: 'calm', arousal: medium, longWait: true, firstReply: false }), { register: 'calm', reason: 'said' }, 'the long wait is only apologised for once');
  assert.deepEqual(chooseRegister({ tone: 'calm', arousal: medium, callerTone: 'warm' }), { register: 'warm', reason: 'caller warm' });
  assert.deepEqual(chooseRegister({ tone: 'warm', arousal: { level: 'high', rateRatio: 1.5 } }), { register: 'energetic', reason: 'said' }, 'loud and fast is energetic whatever the words');
  assert.equal(registerFor('upset', medium), 'firm', 'an agent labelled upset is voiced firm, never apologetic by accident');
  assert.equal(registerFor('reassuring', medium), 'reassuring');
  assert.equal(registerFor('brisk', medium), 'energetic', 'the old name still resolves');
  assert.equal(chooseRegister({ override: 'brisk', tone: 'calm', arousal: medium }).register, 'energetic', 'an old client choosing brisk gets energetic');
  assert.deepEqual(REGISTERS, ['calm', 'warm', 'energetic', 'reassuring', 'apologetic', 'firm']);
  assert.equal(chooseRegister({ override: 'auto', tone: 'calm', arousal: medium }).register, 'calm', 'auto is not an override');
});

test('sentences carry their own tags after the register leads the first one', () => {
  const sentences = [{ text: 'I am so sorry about the wait.', tag: 'cheerful' }, { text: 'Someone is on the way now.', tag: 'Reassuring' }, { text: 'Thank you for your patience.', tag: 'furious' }];
  const text = sentences.map(s => s.text).join(' ');
  const spoken = taggedText(sentences, text, 'apologetic', medium, 's2.1-pro-free');
  assert.equal(spoken, '[sincerely apologetic] I am so sorry about the wait. [reassuring] Someone is on the way now. Thank you for your patience.');
  assert.ok(!spoken.includes('cheerful'), 'the first sentence keeps the register, not the interpreter’s guess');
  assert.ok(!spoken.includes('furious'), 'tags off the allowlist are dropped');
  assert.equal(taggedText(sentences, text, 'apologetic', medium, 's1'), text, 'S1 gets plain text');
  assert.equal(taggedText([{ text: 'Different words entirely, not the translation.', tag: 'calm' }], text, 'calm', medium, 's2.1-pro-free'), `[calm] ${text}`, 'a split that is not the same text falls back to one tag');
  assert.equal(taggedText([], text, 'warm', { level: 'high' }, 's2.1-pro-free'), `[warm, upbeat] ${text}`);
  assert.ok(SENTENCE_TAGS.includes('reassuring'));
});

test('stored takes recorded as brisk load as energetic', () => {
  const state = migrateState({ version: 2, voices: [{ id: 'v1', register: 'brisk' }], settings: { registers: { brisk: 'v1', calm: null } }, agents: [{ id: 'a1', registers: { brisk: 'v1' } }], calls: [] });
  assert.equal(state.voices[0].register, 'energetic');
  assert.deepEqual(state.settings.registers, { energetic: 'v1', calm: null });
  assert.deepEqual(state.agents[0].registers, { energetic: 'v1' });
  assert.equal(canonicalRegister('warm'), 'warm');
});
