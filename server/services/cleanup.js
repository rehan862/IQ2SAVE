import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { jobs, mediaCache } from '../db/repos.js';
import { logger } from '../utils/logger.js';
import { jobQueue } from './jobQueue.js';

/**
 * Delete scratch files that no running job owns. Finished downloads live in
 * DOWNLOAD_DIR and are never touched here.
 */
async function sweepTempDir() {
  const cutoff = Date.now() - config.tempFileTtlMs;
  let removed = 0;

  let entries;
  try {
    entries = await fs.readdir(config.tempDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const target = path.join(config.tempDir, entry.name);
    try {
      const stat = await fs.stat(target);
      if (stat.mtimeMs >= cutoff) continue;

      // A long download legitimately keeps an old mtime on its .part file.
      const jobId = entry.name.split('.')[0];
      const owner = jobQueue.get(jobId);
      if (owner && (owner.status === 'running' || owner.status === 'queued')) continue;

      await fs.rm(target, { force: true, recursive: true });
      removed += 1;
    } catch {
      /* raced with another sweep or the job itself */
    }
  }

  return removed;
}

export function startCleanup() {
  const run = async () => {
    try {
      const [files, cacheRows, jobRows] = [
        await sweepTempDir(),
        mediaCache.prune(),
        jobs.prune(config.jobRecordTtlMs),
      ];
      if (files || cacheRows || jobRows) {
        logger.info('Cleanup pass complete', { tempFiles: files, cacheRows, jobRows });
      }
    } catch (error) {
      logger.warn('Cleanup pass failed', { message: error?.message });
    }
  };

  run();
  const timer = setInterval(run, config.cleanupIntervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
