import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, rename, chmod } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { loadConfig } from '../server/config.mjs';
import { createRuntime } from '../server/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function prepareDemoConfig(publicUrl, projectRoot = root, inherited = process.env, portOverride) {
  let url;
  try { url = new URL(publicUrl); } catch { throw new Error('Provide the public HTTPS origin as the only argument.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.port || url.search || url.hash) throw new Error('Provide an HTTPS origin without a path or credentials.');
  const envPath = path.join(projectRoot, '.env');
  let contents = '';
  try { contents = await readFile(envPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read the local .env file safely.'); }
  if (Buffer.byteLength(contents) > 64 * 1024) throw new Error('The local .env file is unexpectedly large.');
  const variables = dotenv.parse(contents);
  if (!variables.NOTEFISH_DESK_PASSWORD) {
    variables.NOTEFISH_DESK_PASSWORD = `${randomUUID()}.${randomUUID()}`;
    const updated = `${contents.replace(/\n?$/, '\n')}NOTEFISH_DESK_PASSWORD=${variables.NOTEFISH_DESK_PASSWORD}\n`;
    const temporary = `${envPath}.demo.tmp`;
    await writeFile(temporary, updated, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, envPath);
  } else if (variables.NOTEFISH_DESK_PASSWORD.length < 24) {
    throw new Error('Set a desk password with at least 24 characters in the local .env file.');
  }
  await chmod(envPath, 0o600);
  return loadConfig({ ...inherited, ...variables, ...(portOverride !== undefined ? { PORT: portOverride } : {}), PUBLIC_BASE_URL: url.origin, HOST: '127.0.0.1' }, projectRoot);
}

async function main() {
  if (process.argv.length < 3 || process.argv.length > 4 || (process.argv[3] && !/^--port=\d{1,5}$/.test(process.argv[3]))) throw new Error('Usage: node scripts/start-browser-demo.mjs https://public-host [--port=3002]');
  const config = await prepareDemoConfig(process.argv[2], root, process.env, process.argv[3]?.slice(7));
  const runtime = await createRuntime({ config });
  runtime.server.once('error', async () => {
    console.error('The demo could not bind its local port. Stop the previous server before retrying.');
    await runtime.close(); process.exitCode = 1;
  });
  runtime.server.listen(config.port, config.host, () => {
    console.log(`NoteFish browser demo is listening on local port ${config.port}. Desk username: desk. The password remains in the ignored local .env file.`);
  });
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; await runtime.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('Could not start the browser demo. Check the HTTPS origin, .env permissions, and desk password length.'); process.exitCode = 1; });
}
