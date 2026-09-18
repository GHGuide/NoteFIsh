// Where the desk's state actually lives. The store above this keeps one document
// and hands it here to be written; a backend only has to load it and save it.
//
// A file on disk is the default and is what local development and the tests use.
// Postgres is what a deployment wants, because a managed database is backed up and
// outlives the machine the server happens to be running on. The document is the
// same either way, so nothing above this file knows or cares which is in use.
import { mkdir, open, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

/** A database that will not talk to us, said plainly. Postgres reports the host,
 *  the user and what went wrong, none of which is the password. */
export class StorageError extends Error {
  constructor(message) { super(message); this.name = 'StorageError'; }
}
const dbFailure = error => new StorageError(
  `Could not use the database named in DATABASE_URL: ${error.message || 'no reason given'}${error.code ? ` (${error.code})` : ''}`,
);

/** A file beside the server. Written to a temporary name and renamed, so a crash
 *  mid-write leaves the previous document intact rather than half of a new one. */
export function fileStorage(filePath, { maxBytes }) {
  return {
    describe: () => filePath,
    async load() {
      try {
        const info = await stat(filePath);
        if (info.size > maxBytes) throw new Error('Stored NoteFish data exceeds the size limit');
        return await readFile(filePath, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async save(encoded) {
      await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const temporary = `${filePath}.tmp`;
      const handle = await open(temporary, 'w', 0o600);
      try { await handle.writeFile(encoded, 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, filePath);
    },
    async close() {},
  };
}

/** One row holding the whole document. The point is not the shape, it is that the
 *  database is somebody else's job to back up and does not vanish with the disk. */
export function postgresStorage(connectionString, { maxBytes, driver }) {
  let client = null;
  const connect = async () => {
    if (client) return client;
    const { Client } = driver || await import('pg');
    client = new Client({ connectionString, application_name: 'notefish', connectionTimeoutMillis: 10_000 });
    // A dropped connection must not poison the pool: forget it and reconnect next time.
    client.on('error', () => { client = null; });
    await client.connect();
    await client.query(`CREATE TABLE IF NOT EXISTS notefish_state (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      document jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    return client;
  };
  const withClient = async work => {
    try { return await work(await connect()); }
    catch (error) { client = null; throw error.name === 'StorageError' ? error : dbFailure(error); }
  };
  return {
    describe: () => 'the database',
    async load() {
      return withClient(async db => {
        const { rows } = await db.query('SELECT document FROM notefish_state WHERE id = 1');
        if (!rows.length) return null;
        const encoded = JSON.stringify(rows[0].document);
        if (Buffer.byteLength(encoded) > maxBytes) throw new Error('Stored NoteFish data exceeds the size limit');
        return encoded;
      });
    },
    async save(encoded) {
      await withClient(db => db.query(
        `INSERT INTO notefish_state (id, document) VALUES (1, $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET document = EXCLUDED.document, updated_at = now()`,
        [encoded],
      ));
    },
    async close() {
      const open = client; client = null;
      if (open) await open.end().catch(() => {});
    },
  };
}

/** Postgres when a database is configured, a file otherwise. On the first start
 *  against an empty database the file's contents move across, so switching a
 *  running deployment over does not start it from nothing. */
export async function chooseStorage({ filePath, connectionString = '', maxBytes, driver }) {
  const file = fileStorage(filePath, { maxBytes });
  if (!connectionString) return { storage: file, moved: false };
  const database = postgresStorage(connectionString, { maxBytes, driver });
  if (await database.load()) return { storage: database, moved: false };
  const existing = await file.load();
  if (!existing) return { storage: database, moved: false };
  await database.save(existing);
  return { storage: database, moved: true };
}
