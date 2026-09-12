import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, lstat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = { cwd: root, maxBuffer: 32 * 1024 * 1024, timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'], env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' } };
const keySignatures = [
  /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u,
  /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bsk_live_[A-Za-z0-9]{16,}\b/u,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/u,
];
const forbidden = file => {
  const parts = file.split('/');
  return parts.some(part => (part === '.env' || part.startsWith('.env.')) && part !== '.env.example')
    || parts.includes('data') || parts.includes('keys.js') || /\.(?:pem|key)$/iu.test(file);
};
const safePath = file => {
  if (!file || path.isAbsolute(file) || file.split('/').includes('..')) throw new Error('Invalid source path');
  return file;
};

async function main() {
  let contents = '';
  try { contents = await readFile(path.join(root, '.env'), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (Buffer.byteLength(contents) > 64 * 1024) throw new Error('Environment file exceeds the audit limit');
  const variables = dotenv.parse(contents);
  const secrets = [...new Set(Object.entries(variables)
    .filter(([key, value]) => /(?:API_KEY|AUTH_TOKEN|API_SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN|SECRET|ACCOUNT_SID|PHONE_NUMBER)$/i.test(key) && value.length > 0)
    .map(([, value]) => value))].map(value => Buffer.from(value));
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], options);
  const entries = execFileSync('git', ['ls-files', '--stage', '-z'], options).toString().split('\0').filter(Boolean).map(line => {
    const match = /^(\d{6}) ([a-f0-9]{40,64}) ([0-3])\t([\s\S]+)$/u.exec(line);
    if (!match || match[3] !== '0' || !['100644', '100755', '120000'].includes(match[1])) throw new Error('The index contains an unsupported or unresolved source entry');
    return { file: safePath(match[4]), objectId: match[2] };
  });
  const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], options).toString().split('\0').filter(Boolean).map(safePath);
  const files = [...new Set([...entries.map(entry => entry.file), ...untracked])];
  const excludedFiles = files.filter(forbidden);
  const matchedFiles = new Set(); const signatureMatchedFiles = new Set();
  const scan = (file, body) => {
    if (body.length > 32 * 1024 * 1024) throw new Error('A source file exceeds the audit limit');
    if (secrets.some(secret => body.includes(secret))) matchedFiles.add(file);
    if (keySignatures.some(pattern => pattern.test(body.toString('utf8')))) signatureMatchedFiles.add(file);
  };
  for (const { file, objectId } of entries) {
    // Read the actual index blob. A clean working tree copy cannot conceal a
    // secret that is still staged for the next commit.
    scan(file, execFileSync('git', ['cat-file', 'blob', objectId], options));
  }
  for (const file of untracked) {
    const source = path.join(root, file); const info = await lstat(source);
    if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('An untracked source entry cannot be audited safely');
    scan(file, await readFile(source));
  }
  const ignoreProbes = ['.env', '.env.local', '.env.production', 'data/notefish.json', 'keys.js', 'server/keys.js', 'private.pem'];
  let ignored;
  try { ignored = execFileSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], { ...options, input: `${ignoreProbes.join('\0')}\0` }).toString().split('\0').filter(Boolean); }
  catch (error) { if (error.status !== 1) throw error; ignored = []; }
  const missingIgnoreRules = ignoreProbes.filter(file => !ignored.includes(file));
  const envInfo = contents ? await lstat(path.join(root, '.env')) : null;
  const envPrivate = !envInfo || (envInfo.isFile() && (envInfo.mode & 0o777) === 0o600);
  // Report counts and file names only. Never print credential values or excerpts.
  console.log(JSON.stringify({ usingGit: true, indexedFiles: entries.length, untrackedFiles: untracked.length, cachedContentChecked: true,
    scannedFiles: files.length, configuredSecretsChecked: secrets.length, envModePrivate: envPrivate,
    excludedFiles, matchedFiles: [...matchedFiles], signatureMatchedFiles: [...signatureMatchedFiles], missingIgnoreRules }));
  if (!envPrivate || excludedFiles.length || matchedFiles.size || signatureMatchedFiles.size || missingIgnoreRules.length) process.exitCode = 1;
}

main().catch(() => { console.error('Secret hygiene check could not complete safely. No credential values were printed.'); process.exitCode = 1; });
