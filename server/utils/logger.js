import { config } from '../config/index.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

// Secrets should never reach a log line, but config drift is easier to survive
// than a leaked token, so scrub defensively on the way out.
const SENSITIVE = /(token|secret|password|api[-_]?key|authorization|cookie)/i;

function scrub(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function emit(level, message, meta) {
  if (LEVELS[level] > threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (meta === undefined) {
    stream.write(`${line}\n`);
    return;
  }
  let detail;
  try {
    detail = JSON.stringify(scrub(meta));
  } catch {
    detail = '[unserializable]';
  }
  stream.write(`${line} ${detail}\n`);
}

export const logger = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),
};
