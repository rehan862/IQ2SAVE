import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const db = new DatabaseSync(config.dbPath);

db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

// A job left in queued/running state can only be a crash survivor: nothing is
// tracking it any more, so it would otherwise sit in the UI spinning forever.
const recovered = db
  .prepare(
    `UPDATE jobs
        SET status = 'failed',
            error_code = 'INTERRUPTED',
            error_message = 'Stopped because IQ2SAVE restarted.',
            finished_at = ?
      WHERE status IN ('queued','running')`,
  )
  .run(Date.now());

if (recovered.changes > 0) {
  logger.warn('Marked interrupted jobs as failed after restart', { count: recovered.changes });
}

logger.info('Database ready', { path: config.dbPath });
