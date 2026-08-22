import express from 'express';
import fs from 'node:fs';
import { config } from '../config/index.js';
import { jobLogs, jobs } from '../db/repos.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { services } from '../providers/index.js';
import { analyzeUrl, selectFormat } from '../services/analyze.js';
import { getCapabilities } from '../services/capabilities.js';
import { jobQueue } from '../services/jobQueue.js';
import { ERRORS } from '../utils/errors.js';
import { containedPath } from '../utils/filename.js';

export const api = express.Router();

const ok = (res, data) => res.json({ success: true, data });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asyncRoute = (handler) => (req, res, next) => handler(req, res, next).catch(next);

function requireUrl(req) {
  const { url } = req.body ?? {};
  if (typeof url !== 'string' || !url.trim()) throw ERRORS.INVALID_URL();
  return url;
}

function requireJobId(req) {
  const { id } = req.params;
  if (!UUID.test(id)) throw ERRORS.NOT_FOUND('That job');
  return id;
}

/** Strip internal fields before a job crosses the wire. */
function publicJob(job) {
  if (!job) return null;
  const { outputPath, ...rest } = job;
  return { ...rest, hasFile: Boolean(outputPath) };
}

api.get(
  '/system',
  asyncRoute(async (_req, res) => {
    const capabilities = await getCapabilities();
    ok(res, {
      app: { name: config.appName, tagline: config.appTagline },
      capabilities: {
        ytdlp: { available: capabilities.ytdlp.available, version: capabilities.ytdlp.version },
        ffmpeg: { available: capabilities.ffmpeg.available, version: capabilities.ffmpeg.version },
        canMerge: capabilities.canMerge,
        canConvertAudio: capabilities.canConvertAudio,
      },
      limits: {
        maxConcurrentJobs: config.maxConcurrentJobs,
        maxFileBytes: config.maxFileBytes,
        rateLimitMax: config.rateLimitMax,
        rateLimitWindowMs: config.rateLimitWindowMs,
        tempFileTtlMs: config.tempFileTtlMs,
      },
      paths: { downloadDir: config.downloadDir },
      stats: jobs.stats(),
      activeJobs: jobQueue.activeCount(),
    });
  }),
);

api.get('/services', (_req, res) => ok(res, { services }));

// Analysis spawns a subprocess, so it gets a tighter budget than reads. These
// are absolute rather than a fraction of the global limit: the global one has to
// be loose enough for progress polling, which says nothing about how often a
// person can reasonably paste a new link.
api.post(
  '/analyze',
  rateLimit({ name: 'analyze', max: 15 }),
  asyncRoute(async (req, res) => {
    const url = requireUrl(req);
    const controller = new AbortController();
    req.on('aborted', () => controller.abort());

    const { media, provider, cached } = await analyzeUrl(url, { signal: controller.signal });

    ok(res, {
      provider: provider.id,
      providerLabel: provider.label,
      cached,
      media: {
        title: media.title,
        uploader: media.uploader,
        thumbnail: media.thumbnail,
        duration: media.duration,
        webpageUrl: media.webpageUrl,
        live: media.live,
        provider: media.provider,
        providerLabel: media.providerLabel,
        sourceUrl: media.sourceUrl,
        formats: (media.formats ?? []).map((format) => ({
          id: format.id,
          kind: format.kind,
          label: format.label,
          container: format.container,
          height: format.height ?? null,
          fps: format.fps ?? null,
          approxBytes: format.approxBytes ?? null,
          exactSize: Boolean(format.exactSize),
          requiresMerge: Boolean(format.requiresMerge),
          note: format.note ?? null,
        })),
        notices: media.notices ?? [],
      },
    });
  }),
);

api.post(
  '/download',
  rateLimit({ name: 'download', max: 10 }),
  asyncRoute(async (req, res) => {
    const url = requireUrl(req);
    const { formatId } = req.body ?? {};
    if (formatId !== undefined && typeof formatId !== 'string') throw ERRORS.BAD_REQUEST('Invalid format.');

    // Re-derive the format server-side. The client only ever names an id, so a
    // crafted request cannot smuggle engine arguments through the selector.
    const { media, provider, url: parsed } = await analyzeUrl(url);
    const format = selectFormat(media, formatId);
    if (!format) throw ERRORS.BAD_REQUEST('That format is no longer available. Analyse the link again.');

    const job = jobQueue.enqueue({ providerId: provider.id, url: parsed, format, media });
    res.status(202);
    ok(res, { job: publicJob(job) });
  }),
);

api.get(
  '/job/:id',
  asyncRoute(async (req, res) => {
    const job = jobQueue.get(requireJobId(req));
    if (!job) throw ERRORS.NOT_FOUND('That job');
    ok(res, { job: publicJob(job) });
  }),
);

api.get(
  '/job/:id/logs',
  asyncRoute(async (req, res) => {
    const id = requireJobId(req);
    if (!jobs.get(id)) throw ERRORS.NOT_FOUND('That job');
    ok(res, { logs: jobLogs.listForJob(id) });
  }),
);

api.delete(
  '/job/:id',
  asyncRoute(async (req, res) => {
    const id = requireJobId(req);
    const job = jobs.get(id);
    if (!job) throw ERRORS.NOT_FOUND('That job');

    const cancelled = jobQueue.cancel(id);
    if (!cancelled) jobs.delete(id);
    ok(res, { cancelled, deleted: !cancelled });
  }),
);

api.get(
  '/jobs',
  asyncRoute(async (req, res) => {
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const allowed = ['queued', 'running', 'completed', 'failed', 'cancelled'];

    ok(res, {
      jobs: jobs.list({ limit, offset, status: allowed.includes(status) ? status : null }).map(publicJob),
      counts: jobs.countByStatus(),
    });
  }),
);

/** Serve a finished file for saving or in-browser playback. */
api.get(
  '/file/:id',
  asyncRoute(async (req, res) => {
    const job = jobs.get(requireJobId(req));
    if (!job || job.status !== 'completed' || !job.outputPath) throw ERRORS.NOT_FOUND('That file');

    // The stored path is re-checked in case the download directory changed.
    const safePath = containedPath(config.downloadDir, job.outputPath);
    if (!safePath || !fs.existsSync(safePath)) {
      throw ERRORS.NOT_FOUND('That file is no longer on disk. It may have been moved or deleted');
    }

    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.download(safePath, job.outputName || 'download', (error) => {
      if (error && !res.headersSent) throw ERRORS.NOT_FOUND('That file');
    });
  }),
);
