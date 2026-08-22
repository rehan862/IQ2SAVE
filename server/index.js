import express from 'express';
import path from 'node:path';
import { config, ROOT } from './config/index.js';
import { cors, sameOriginOnly, securityHeaders } from './middleware/security.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { rateLimit } from './middleware/rateLimit.js';
import { api } from './routes/api.js';
import { getCapabilities } from './services/capabilities.js';
import { startCleanup } from './services/cleanup.js';
import { jobQueue } from './services/jobQueue.js';
import { logger } from './utils/logger.js';

const app = express();

app.disable('x-powered-by');
// Trust the loopback proxy only; req.ip must not be spoofable via headers.
app.set('trust proxy', 'loopback');

app.use(securityHeaders);
app.use(cors);
app.use(sameOriginOnly);
app.use(express.json({ limit: config.maxBodyBytes }));
// Only the API is metered. Static assets are a dozen requests per page load and
// would otherwise eat the same budget the UI needs for polling job progress.
app.use('/api', rateLimit({ name: 'global' }));

app.get('/healthz', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));

app.use('/api', api);

const publicDir = path.join(ROOT, 'public');

app.use(
  express.static(publicDir, {
    index: 'index.html',
    extensions: ['html'],
    maxAge: '1h',
    setHeaders(res, filePath) {
      // HTML must not be cached or the app shell goes stale after an update.
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }),
);

// Unknown /api paths are errors; anything else falls back to the app shell.
app.use('/api', notFound);
app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

app.use(errorHandler);

const server = app.listen(config.port, config.host, async () => {
  const capabilities = await getCapabilities();

  logger.info(`${config.appName} listening`, { url: `http://${config.host}:${config.port}` });
  logger.info('Downloads directory', { path: config.downloadDir });
  logger.info('Engines', {
    ytdlp: capabilities.ytdlp.version ?? 'not found',
    ffmpeg: capabilities.ffmpeg.version ?? 'not found',
  });

  if (config.hostWasOverridden) {
    logger.warn(
      `HOST=${config.requestedHost} was ignored because ALLOW_REMOTE is false; bound to 127.0.0.1 instead`,
    );
  }
  if (config.allowRemote) {
    logger.warn('ALLOW_REMOTE is enabled: other devices on this network can reach IQ2SAVE');
  }
  if (!capabilities.ytdlp.available) {
    logger.warn('yt-dlp not found. Install it with: pkg install yt-dlp');
  }
  if (!capabilities.ffmpeg.available) {
    logger.warn('ffmpeg not found. Install it with: pkg install ffmpeg');
  }
});

server.headersTimeout = 65_000;
server.requestTimeout = 0; // long downloads are served through this process

const stopCleanup = startCleanup();

let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);

  stopCleanup();
  jobQueue.abortAll();

  server.close(() => process.exit(0));
  // Don't let an in-flight response hold the process open indefinitely.
  setTimeout(() => process.exit(0), 8000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { message: reason?.message ?? String(reason) });
});
