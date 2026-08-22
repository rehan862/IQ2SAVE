import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config/index.js';
import { jobLogs, jobs } from '../db/repos.js';
import { getProvider } from '../providers/index.js';
import { AppError, ERRORS } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { containedPath, sanitizeWithExtension, uniquePath } from '../utils/filename.js';

const PROGRESS_FLUSH_MS = 600;

/** id -> { controller, live } for jobs that are queued or running right now. */
const active = new Map();
const waiting = [];

/**
 * Rename across filesystems. On Android the scratch directory sits in app
 * storage while downloads usually land on shared storage, so rename() fails
 * with EXDEV and the bytes have to be copied.
 */
async function moveFile(from, to) {
  try {
    await fs.rename(from, to);
    return;
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
  }
  await fs.copyFile(from, to);
  await fs.rm(from, { force: true });
}

function stageOf(rawStage) {
  return rawStage ?? 'downloading';
}

class JobRunner {
  constructor(record, { provider, url, format, media }) {
    this.id = record.id;
    this.provider = provider;
    this.url = url;
    this.format = format;
    this.media = media;
    this.controller = new AbortController();
    this.live = {
      status: 'queued',
      stage: 'queued',
      progress: null,
      determinate: Boolean(format?.approxBytes) || format?.durationSec != null,
      downloadedBytes: null,
      totalBytes: format?.approxBytes ?? null,
      speedBps: null,
      etaSeconds: null,
    };
    this.lastFlush = 0;
  }

  patchLive(patch) {
    Object.assign(this.live, patch);
  }

  flush(force = false) {
    const now = Date.now();
    if (!force && now - this.lastFlush < PROGRESS_FLUSH_MS) return;
    this.lastFlush = now;
    jobs.update(this.id, {
      stage: this.live.stage,
      progress: this.live.progress,
      determinate: this.live.determinate,
      downloadedBytes: this.live.downloadedBytes,
      totalBytes: this.live.totalBytes,
      speedBps: this.live.speedBps,
      etaSeconds: this.live.etaSeconds,
    });
  }

  onProgress = (event) => {
    // `progress` is null whenever the engine could not supply a real total, and
    // the UI renders an indeterminate bar in that case rather than a guess.
    this.patchLive({
      progress: event.progress ?? null,
      determinate: event.progress != null,
      downloadedBytes: event.downloadedBytes ?? this.live.downloadedBytes,
      totalBytes: event.totalBytes ?? this.live.totalBytes,
      speedBps: event.speedBps ?? null,
      etaSeconds: event.etaSeconds ?? null,
    });
    this.flush();
  };

  onStage = (stage) => {
    this.patchLive({ stage: stageOf(stage), progress: null, determinate: false });
    this.flush(true);
    jobLogs.add(this.id, 'info', `Stage: ${stage}`);
  };

  async execute() {
    const startedAt = Date.now();
    this.patchLive({ status: 'running', stage: 'downloading' });
    jobs.update(this.id, { status: 'running', stage: 'downloading', startedAt });
    jobLogs.add(this.id, 'info', `Started ${this.provider.id} download`, { format: this.format?.id });

    const produced = await this.provider.createDownload(
      {
        url: this.url,
        format: this.format,
        media: this.media,
        outputDir: config.tempDir,
        basename: this.id,
      },
      { onProgress: this.onProgress, onStage: this.onStage, signal: this.controller.signal },
    );

    // Never trust an engine-reported path to stay inside the scratch directory.
    const safeSource = containedPath(config.tempDir, produced.path);
    if (!safeSource) {
      logger.error('Engine produced a path outside the temp directory', { jobId: this.id });
      throw ERRORS.PROCESSING_FAILED();
    }

    this.onStage('finalizing');

    const stat = await fs.stat(safeSource);
    const container = produced.container || path.extname(safeSource).replace('.', '') || 'bin';
    const filename = sanitizeWithExtension(this.media?.title || 'download', container);
    const destination = await uniquePath(config.downloadDir, filename, fs);

    await moveFile(safeSource, destination);

    const finishedAt = Date.now();
    this.patchLive({ status: 'completed', stage: 'completed', progress: 1, determinate: true });

    jobs.update(this.id, {
      status: 'completed',
      stage: 'completed',
      progress: 1,
      determinate: true,
      outputName: path.basename(destination),
      outputPath: destination,
      outputBytes: stat.size,
      container,
      finishedAt,
      durationMs: finishedAt - startedAt,
    });
    jobLogs.add(this.id, 'info', 'Completed', { bytes: stat.size, file: path.basename(destination) });

    return jobs.get(this.id);
  }

  async fail(error) {
    const appError = error instanceof AppError ? error : this.provider.handleError(error);
    const cancelled = appError.code === 'CANCELLED';
    const finishedAt = Date.now();

    // Partial output is useless and would otherwise accumulate silently.
    await this.cleanupTemp();

    jobs.update(this.id, {
      status: cancelled ? 'cancelled' : 'failed',
      stage: cancelled ? 'cancelled' : 'failed',
      errorCode: appError.code,
      errorMessage: appError.message,
      finishedAt,
    });
    jobLogs.add(this.id, cancelled ? 'warn' : 'error', appError.message, { code: appError.code });

    if (!cancelled) {
      logger.warn('Job failed', { jobId: this.id, code: appError.code });
    }
  }

  async cleanupTemp() {
    try {
      const entries = await fs.readdir(config.tempDir);
      await Promise.all(
        entries
          .filter((name) => name.startsWith(this.id))
          .map((name) => fs.rm(path.join(config.tempDir, name), { force: true, recursive: true })),
      );
    } catch {
      /* nothing to clean */
    }
  }
}

function pump() {
  while (waiting.length > 0) {
    const runningCount = [...active.values()].filter((r) => r.live.status === 'running').length;
    if (runningCount >= config.maxConcurrentJobs) return;

    const id = waiting.shift();
    const runner = active.get(id);
    if (!runner) continue;

    runner
      .execute()
      .catch((error) => runner.fail(error))
      .finally(() => {
        active.delete(id);
        pump();
      });
  }
}

export const jobQueue = {
  /** Create a job row and schedule it. Returns the persisted job immediately. */
  enqueue({ providerId, url, format, media }) {
    const provider = getProvider(providerId);
    if (!provider) throw ERRORS.UNSUPPORTED_PLATFORM();

    if (active.size >= config.maxConcurrentJobs * 8) throw ERRORS.QUEUE_FULL();

    const id = randomUUID();
    const record = jobs.create({
      id,
      provider: provider.id,
      sourceUrl: url.toString(),
      canonicalUrl: media?.canonicalUrl ?? null,
      title: media?.title ?? null,
      thumbnail: media?.thumbnail ?? null,
      uploader: media?.uploader ?? null,
      duration: media?.duration ?? null,
      formatId: format?.id ?? null,
      formatLabel: format?.label ?? null,
      container: format?.container ?? null,
      totalBytes: format?.approxBytes ?? null,
      determinate: Boolean(format?.approxBytes) || format?.durationSec != null,
    });

    const runner = new JobRunner(record, { provider, url, format, media });
    active.set(id, runner);
    waiting.push(id);
    pump();

    return record;
  },

  /** Read a job, overlaying live counters that have not been flushed yet. */
  get(id) {
    const record = jobs.get(id);
    if (!record) return null;
    const runner = active.get(id);
    if (!runner || record.status === 'completed') return record;
    return { ...record, ...runner.live, id: record.id };
  },

  cancel(id) {
    const runner = active.get(id);
    if (!runner) return false;
    runner.controller.abort();
    const index = waiting.indexOf(id);
    if (index !== -1) waiting.splice(index, 1);
    return true;
  },

  activeCount() {
    return active.size;
  },

  /** Abort everything still in flight, used during shutdown. */
  abortAll() {
    for (const runner of active.values()) runner.controller.abort();
    waiting.length = 0;
  },
};
