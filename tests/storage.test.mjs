import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../server/store.mjs';

// A database that lives in this process: enough to prove the document goes out and
// comes back, without asking anyone for a real connection string.
function fakeDatabase() {
  const queries = [];
  let row = null;
  class Client {
    constructor(options) { this.options = options; }
    on() {}
    async connect() { this.connected = true; }
    async end() { this.connected = false; }
    async query(sql, values) {
      queries.push(sql.trim().split('\n')[0].trim());
      if (/CREATE TABLE/i.test(sql)) return { rows: [] };
      if (/^SELECT/i.test(sql.trim())) return { rows: row === null ? [] : [{ document: JSON.parse(row) }] };
      row = values[0];
      return { rows: [] };
    }
  }
  return { driver: { Client }, queries, read: () => row };
}

const seat = { id: '11111111-1111-4111-8111-111111111111', name: 'Nina', voiceId: null, agentLanguage: null, customerLanguage: null, registers: {}, archived: false, createdAt: new Date().toISOString() };

test('with a database configured the desk keeps its data there, and reads it back on the next start', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-db-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'notefish.json');
  const db = fakeDatabase();

  const store = await createStore(file, { connectionString: 'postgres://desk@example/notefish', driver: db.driver });
  assert.equal(store.where(), 'the database');
  assert.equal(store.movedFromFile, false, 'nothing to move, there was no file');
  await store.update(state => { state.agents.push(seat); state.settings.queueName = 'Main line'; });
  await store.close();

  assert.ok(db.queries.some(q => /CREATE TABLE IF NOT EXISTS notefish_state/.test(q)), 'it makes its own table');
  assert.equal(JSON.parse(db.read()).agents[0].name, 'Nina', 'the document is in the database');
  assert.equal(await readFile(file, 'utf8').catch(() => null), null, 'and nothing was written to disk');

  const reopened = await createStore(file, { connectionString: 'postgres://desk@example/notefish', driver: db.driver });
  assert.deepEqual(reopened.snapshot().agents.map(a => a.name), ['Nina'], 'a restart finds it again');
  assert.equal(reopened.snapshot().settings.queueName, 'Main line');
  await reopened.close();
});

test('switching a running desk over moves the existing file into the empty database, once', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-move-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'notefish.json');

  const onDisk = await createStore(file);
  assert.equal(onDisk.where(), file, 'without a connection string it is still a file');
  await onDisk.update(state => { state.agents.push(seat); });
  await onDisk.close();

  const db = fakeDatabase();
  const moved = await createStore(file, { connectionString: 'postgres://desk@example/notefish', driver: db.driver });
  assert.equal(moved.movedFromFile, true);
  assert.deepEqual(moved.snapshot().agents.map(a => a.name), ['Nina'], 'the desk comes up with its data, not empty');
  await moved.close();

  // Second start: the database already has it, so the file is left alone.
  const again = await createStore(file, { connectionString: 'postgres://desk@example/notefish', driver: db.driver });
  assert.equal(again.movedFromFile, false, 'moving happens once, not on every start');
  await again.close();
});

test('a database that refuses to answer stops the desk rather than quietly losing writes', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'notefish-down-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, 'notefish.json'), '{"version":6,"voices":[],"settings":{"voiceId":null,"agentLanguage":"en","customerLanguage":"fr","queueName":"Main line"},"agents":[],"calls":[],"users":[]}');
  class Broken { on() {} async connect() { throw new Error('connection refused'); } async end() {} async query() { throw new Error('connection refused'); } }
  await assert.rejects(
    createStore(path.join(directory, 'notefish.json'), { connectionString: 'postgres://desk@example/notefish', driver: { Client: Broken } }),
    /connection refused/,
  );
});
