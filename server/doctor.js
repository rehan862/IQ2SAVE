/**
 * Preflight check: `npm run doctor`. Reports whether this machine has
 * everything IQ2SAVE needs, and exits non-zero if a hard requirement is
 * missing so it can be used in a shell conditional.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config/index.js';
import { getCapabilities } from './services/capabilities.js';

const PASS = 'ok  ';
const WARN = 'warn';
const FAIL = 'FAIL';

const rows = [];
let failed = false;

function record(level, label, detail) {
  if (level === FAIL) failed = true;
  rows.push({ level, label, detail });
}

function checkNode() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const okay = major > 22 || (major === 22 && minor >= 5);
  record(
    okay ? PASS : FAIL,
    `node ${process.versions.node}`,
    okay ? `${os.platform()}/${os.arch()}` : 'needs >= 22.5.0 for node:sqlite and loadEnvFile',
  );
}

function checkSqlite() {
  try {
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t (a)');
    db.close();
    record(PASS, 'node:sqlite', 'built-in, no native build needed');
  } catch (error) {
    record(FAIL, 'node:sqlite', error.message);
  }
}

function checkWritable(label, dir) {
  const probe = path.join(dir, `.doctor-${process.pid}`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(probe, 'x');
    fs.rmSync(probe);
    record(PASS, label, dir);
  } catch (error) {
    record(FAIL, label, `${dir} — ${error.code ?? error.message}`);
  }
}

function checkSharedStorage() {
  const shared = path.join(os.homedir(), 'storage', 'downloads');
  if (fs.existsSync(shared)) {
    record(PASS, 'shared storage', 'downloads are visible to Android file managers');
  } else {
    record(
      WARN,
      'shared storage',
      'run `termux-setup-storage` and tap Allow so files land in ~/storage/downloads',
    );
  }
}

async function checkEngines() {
  const capabilities = await getCapabilities();
  record(
    capabilities.ytdlp.available ? PASS : FAIL,
    'yt-dlp',
    capabilities.ytdlp.available ? capabilities.ytdlp.version : 'missing — run: pkg install yt-dlp',
  );
  record(
    capabilities.ffmpeg.available ? PASS : FAIL,
    'ffmpeg',
    capabilities.ffmpeg.available ? capabilities.ffmpeg.version : 'missing — run: pkg install ffmpeg',
  );
  record(
    capabilities.canConvertAudio ? PASS : WARN,
    'mp3 extraction',
    capabilities.canConvertAudio ? 'available' : 'needs ffmpeg',
  );
  record(
    capabilities.canMerge ? PASS : WARN,
    'video+audio merge',
    capabilities.canMerge ? 'available' : 'needs yt-dlp and ffmpeg together',
  );
}

function checkBinding() {
  if (config.hostWasOverridden) {
    record(WARN, 'bind address', `HOST=${config.requestedHost} ignored; using 127.0.0.1 (ALLOW_REMOTE is false)`);
  } else if (config.allowRemote) {
    record(WARN, 'bind address', `${config.host}:${config.port} — reachable from your LAN`);
  } else {
    record(PASS, 'bind address', `${config.host}:${config.port} — this device only`);
  }
}

checkNode();
checkSqlite();
checkWritable('downloads dir', config.downloadDir);
checkWritable('temp dir', config.tempDir);
checkWritable('database dir', path.dirname(config.dbPath));
checkSharedStorage();
checkBinding();
await checkEngines();

const width = Math.max(...rows.map((row) => row.label.length));
console.log(`\n${config.appName} doctor\n`);
for (const { level, label, detail } of rows) {
  console.log(`  [${level}] ${label.padEnd(width)}  ${detail}`);
}
console.log(
  failed
    ? '\nSomething required is missing. Fix the FAIL lines above, then run this again.\n'
    : '\nAll required checks passed. Start with: npm start\n',
);

process.exit(failed ? 1 : 0);
