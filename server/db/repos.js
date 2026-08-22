import { db } from './index.js';

const JOB_COLUMNS = [
  'kind',
  'provider',
  'source_url',
  'canonical_url',
  'title',
  'thumbnail',
  'uploader',
  'duration',
  'format_id',
  'format_label',
  'container',
  'status',
  'stage',
  'progress',
  'determinate',
  'downloaded_bytes',
  'total_bytes',
  'speed_bps',
  'eta_seconds',
  'output_name',
  'output_path',
  'output_bytes',
  'error_code',
  'error_message',
  'started_at',
  'finished_at',
  'duration_ms',
];

const SNAKE = /_([a-z])/g;
const camel = (key) => key.replace(SNAKE, (_, c) => c.toUpperCase());

function toApi(row) {
  if (!row) return null;
  const out = {};
  for (const [key, value] of Object.entries(row)) out[camel(key)] = value;
  out.determinate = Boolean(row.determinate);
  return out;
}

export const jobs = {
  create(job) {
    db.prepare(
      `INSERT INTO jobs (id, kind, provider, source_url, canonical_url, title, thumbnail,
                         uploader, duration, format_id, format_label, container,
                         status, stage, determinate, total_bytes, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      job.id,
      job.kind ?? 'download',
      job.provider,
      job.sourceUrl,
      job.canonicalUrl ?? null,
      job.title ?? null,
      job.thumbnail ?? null,
      job.uploader ?? null,
      job.duration ?? null,
      job.formatId ?? null,
      job.formatLabel ?? null,
      job.container ?? null,
      job.status ?? 'queued',
      job.stage ?? 'queued',
      job.determinate === false ? 0 : 1,
      job.totalBytes ?? null,
      job.createdAt ?? Date.now(),
    );
    return jobs.get(job.id);
  },

  /** Patch a job using camelCase keys; unknown keys are ignored. */
  update(id, patch) {
    const sets = [];
    const values = [];
    for (const column of JOB_COLUMNS) {
      const key = camel(column);
      if (!(key in patch)) continue;
      let value = patch[key];
      if (typeof value === 'boolean') value = value ? 1 : 0;
      sets.push(`${column} = ?`);
      values.push(value === undefined ? null : value);
    }
    if (!sets.length) return jobs.get(id);
    values.push(id);
    db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
    return jobs.get(id);
  },

  get(id) {
    return toApi(db.prepare('SELECT * FROM jobs WHERE id = ?').get(id));
  },

  list({ limit = 50, offset = 0, status = null } = {}) {
    const rows = status
      ? db
          .prepare('SELECT * FROM jobs WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
          .all(status, limit, offset)
      : db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
    return rows.map(toApi);
  },

  countByStatus() {
    const rows = db.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  },

  stats() {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const row = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(status = 'completed') AS completed,
                SUM(status = 'failed')    AS failed,
                SUM(status IN ('queued','running')) AS active,
                SUM(created_at >= ?)      AS last24h,
                SUM(output_bytes)         AS bytes,
                AVG(CASE WHEN status = 'completed' THEN duration_ms END) AS avgMs
           FROM jobs`,
      )
      .get(dayAgo);
    return {
      total: row.total ?? 0,
      completed: row.completed ?? 0,
      failed: row.failed ?? 0,
      active: row.active ?? 0,
      last24h: row.last24h ?? 0,
      totalBytes: row.bytes ?? 0,
      averageDurationMs: row.avgMs ? Math.round(row.avgMs) : null,
    };
  },

  delete(id) {
    return db.prepare('DELETE FROM jobs WHERE id = ?').run(id).changes > 0;
  },

  /** Drop old finished rows. Files on disk are left alone. */
  prune(olderThanMs) {
    return db
      .prepare(
        `DELETE FROM jobs
          WHERE status IN ('completed','failed','cancelled')
            AND COALESCE(finished_at, created_at) < ?`,
      )
      .run(Date.now() - olderThanMs).changes;
  },
};

export const jobLogs = {
  add(jobId, level, message, meta = null) {
    db.prepare('INSERT INTO job_logs (job_id, level, message, meta, created_at) VALUES (?,?,?,?,?)').run(
      jobId,
      level,
      message,
      meta ? JSON.stringify(meta) : null,
      Date.now(),
    );
  },

  listForJob(jobId, limit = 200) {
    return db
      .prepare('SELECT level, message, meta, created_at AS createdAt FROM job_logs WHERE job_id = ? ORDER BY id ASC LIMIT ?')
      .all(jobId, limit)
      .map((row) => ({ ...row, meta: row.meta ? JSON.parse(row.meta) : null }));
  },
};

export const mediaCache = {
  get(canonicalUrl) {
    const row = db
      .prepare('SELECT payload, expires_at AS expiresAt FROM media_cache WHERE canonical_url = ?')
      .get(canonicalUrl);
    if (!row) return null;
    if (row.expiresAt < Date.now()) {
      db.prepare('DELETE FROM media_cache WHERE canonical_url = ?').run(canonicalUrl);
      return null;
    }
    try {
      return JSON.parse(row.payload);
    } catch {
      return null;
    }
  },

  set(canonicalUrl, provider, payload, ttlMs) {
    const now = Date.now();
    db.prepare(
      `INSERT INTO media_cache (canonical_url, provider, payload, created_at, expires_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT (canonical_url) DO UPDATE SET
         provider = excluded.provider,
         payload = excluded.payload,
         created_at = excluded.created_at,
         expires_at = excluded.expires_at`,
    ).run(canonicalUrl, provider, JSON.stringify(payload), now, now + ttlMs);
  },

  prune() {
    return db.prepare('DELETE FROM media_cache WHERE expires_at < ?').run(Date.now()).changes;
  },
};

export const settings = {
  all() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },

  get(key, fallback = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : fallback;
  },

  set(key, value) {
    db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?,?,?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(key, value === null ? null : String(value), Date.now());
  },
};
