-- IQ2SAVE schema. Applied idempotently on every boot by server/db/index.js.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- One row per download/convert request. Progress columns are written from real
-- engine output only; when an engine cannot report progress, `determinate` is 0
-- and the UI shows an indeterminate state instead of inventing a percentage.
CREATE TABLE IF NOT EXISTS jobs (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL DEFAULT 'download',
  provider          TEXT NOT NULL,
  source_url        TEXT NOT NULL,
  canonical_url     TEXT,

  title             TEXT,
  thumbnail         TEXT,
  uploader          TEXT,
  duration          REAL,

  format_id         TEXT,
  format_label      TEXT,
  container         TEXT,

  status            TEXT NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','completed','failed','cancelled')),
  stage             TEXT,
  progress          REAL,
  determinate       INTEGER NOT NULL DEFAULT 1,
  downloaded_bytes  INTEGER,
  total_bytes       INTEGER,
  speed_bps         REAL,
  eta_seconds       REAL,

  output_name       TEXT,
  output_path       TEXT,
  output_bytes      INTEGER,

  error_code        TEXT,
  error_message     TEXT,

  created_at        INTEGER NOT NULL,
  started_at        INTEGER,
  finished_at       INTEGER,
  duration_ms       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at DESC);

-- Append-only processing log. Useful when a download fails and the user wants
-- to know why without reading the terminal.
CREATE TABLE IF NOT EXISTS job_logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id     TEXT,
  level      TEXT NOT NULL DEFAULT 'info',
  message    TEXT NOT NULL,
  meta       TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (job_id) REFERENCES jobs (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_job_logs_job ON job_logs (job_id, id);

-- Analysing a link spawns a subprocess that can take many seconds, so results
-- are cached briefly. Media URLs inside the payload expire, hence the short TTL.
CREATE TABLE IF NOT EXISTS media_cache (
  canonical_url TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  payload       TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_cache_expiry ON media_cache (expires_at);

-- Runtime-editable settings. Anything here overrides the corresponding .env
-- default so preferences can be changed from the UI without a restart.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL
);
