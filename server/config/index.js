import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const str = (key, fallback) => {
  const raw = process.env[key];
  return raw === undefined || raw.trim() === '' ? fallback : raw.trim();
};

const int = (key, fallback) => {
  const raw = str(key, null);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

const bool = (key, fallback) => {
  const raw = str(key, null);
  if (raw === null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};

const list = (key) =>
  str(key, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const absolute = (value, fallback) =>
  value ? path.resolve(ROOT, value) : fallback;

// Android exposes shared storage at ~/storage/downloads once the user has run
// `termux-setup-storage`. Landing files there is the difference between the
// user being able to open a download in their gallery and not, so prefer it.
function defaultDownloadDir() {
  const shared = path.join(os.homedir(), 'storage', 'downloads');
  try {
    if (fs.statSync(shared).isDirectory()) return path.join(shared, 'ClipMate');
  } catch {
    /* shared storage not set up; fall through */
  }
  return path.join(ROOT, 'downloads');
}

const requestedHost = str('HOST', '127.0.0.1');
const allowRemote = bool('ALLOW_REMOTE', false);
const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(requestedHost);

export const config = {
  appName: str('APP_NAME', 'IQ2SAVE'),
  appTagline: str('APP_TAGLINE', 'Your Links. Your Media.'),

  // Binding to a non-loopback interface without opting in would silently
  // expose a tool that runs subprocesses, so the flag is required.
  host: isLoopback || allowRemote ? requestedHost : '127.0.0.1',
  hostWasOverridden: !isLoopback && !allowRemote,
  requestedHost,
  port: int('PORT', 3000),
  allowRemote,
  corsOrigins: list('CORS_ORIGINS'),

  downloadDir: absolute(str('DOWNLOAD_DIR', null), defaultDownloadDir()),
  tempDir: absolute(str('TEMP_DIR', null), path.join(ROOT, 'tmp')),
  dbPath: absolute(str('DB_PATH', './data/clipmate.db'), path.join(ROOT, 'data', 'clipmate.db')),

  ytdlpPath: str('YTDLP_PATH', 'yt-dlp'),
  ffmpegPath: str('FFMPEG_PATH', 'ffmpeg'),
  ffprobePath: str('FFPROBE_PATH', 'ffprobe'),

  maxConcurrentJobs: Math.max(1, int('MAX_CONCURRENT_JOBS', 2)),
  jobTimeoutMs: int('JOB_TIMEOUT_MS', 30 * 60 * 1000),
  analyzeTimeoutMs: int('ANALYZE_TIMEOUT_MS', 90 * 1000),

  tempFileTtlMs: int('TEMP_FILE_TTL_MS', 60 * 60 * 1000),
  cleanupIntervalMs: int('CLEANUP_INTERVAL_MS', 10 * 60 * 1000),
  jobRecordTtlMs: int('JOB_RECORD_TTL_MS', 30 * 24 * 60 * 60 * 1000),

  maxUrlLength: int('MAX_URL_LENGTH', 2048),
  maxBodyBytes: int('MAX_BODY_BYTES', 16 * 1024),
  maxFileBytes: int('MAX_FILE_BYTES', 2 * 1024 * 1024 * 1024),
  rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60 * 1000),
  // A running download is polled every 900 ms and the Library every 2 s, so the
  // UI alone can legitimately make ~100 calls a minute. Analyze and download
  // carry their own far stricter limits; this one only catches a runaway loop.
  rateLimitMax: int('RATE_LIMIT_MAX', 240),

  logLevel: str('LOG_LEVEL', 'info'),
};

for (const dir of [config.downloadDir, config.tempDir, path.dirname(config.dbPath)]) {
  fs.mkdirSync(dir, { recursive: true });
}
