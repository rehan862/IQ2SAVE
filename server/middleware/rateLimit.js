import { config } from '../config/index.js';
import { ERRORS } from '../utils/errors.js';

/**
 * Fixed-window counter keyed by client address. In-memory is the right store
 * here: the app is a single process and the limit exists to stop a runaway
 * script, not a distributed attacker.
 */
const buckets = new Map();

function sweep() {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

setInterval(sweep, 60_000).unref();

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/** @param {{ max?: number, windowMs?: number, name?: string }} options */
export function rateLimit(options = {}) {
  const max = options.max ?? config.rateLimitMax;
  const windowMs = options.windowMs ?? config.rateLimitWindowMs;
  const name = options.name ?? 'default';

  return (req, res, next) => {
    if (max <= 0) {
      next();
      return;
    }

    const key = `${name}:${clientKey(req)}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      next(ERRORS.RATE_LIMITED(retryAfter));
      return;
    }

    next();
  };
}
