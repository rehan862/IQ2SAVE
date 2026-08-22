import { config } from '../config/index.js';
import { ERRORS } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { probeBinary, runProcess } from './spawn.js';

const PROGRESS_TAG = '@CMPROG@';
const FILE_TAG = '@CMFILE@';

// yt-dlp renders unavailable template fields as the literal string "NA".
const PROGRESS_TEMPLATE =
  `download:${PROGRESS_TAG}%(progress.downloaded_bytes)s|%(progress.total_bytes)s` +
  '|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.status)s';

const BASE_ARGS = [
  '--no-playlist',
  '--no-warnings',
  '--no-colors',
  '--no-mtime',
  '--ignore-config',
  '--socket-timeout',
  '30',
  '--retries',
  '3',
];

function num(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text || text === 'NA' || text === 'None' || text === 'null') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseProgressLine(line) {
  if (!line.startsWith(PROGRESS_TAG)) return null;
  const [downloaded, total, estimate, speed, eta, status] = line.slice(PROGRESS_TAG.length).split('|');
  const totalBytes = num(total) ?? num(estimate);
  const downloadedBytes = num(downloaded);
  return {
    downloadedBytes,
    totalBytes,
    speedBps: num(speed),
    etaSeconds: num(eta),
    status: (status || '').trim() || 'downloading',
    // Only a real total lets us state a real percentage.
    progress:
      totalBytes && downloadedBytes !== null ? Math.min(1, downloadedBytes / totalBytes) : null,
  };
}

/**
 * yt-dlp's stderr is written for humans and can name internal paths or
 * extractor internals, so it is logged but never returned verbatim. This maps
 * the failure modes worth telling the user apart.
 */
function describeFailure(stderr) {
  const text = (stderr || '').toLowerCase();
  if (text.includes('sign in to confirm') || text.includes('not a bot')) {
    return 'The site is asking this device to sign in before it will serve that media.';
  }
  if (text.includes('private video') || text.includes('login required') || text.includes('this content isn')) {
    return 'That media is private or restricted, so it cannot be read.';
  }
  if (text.includes('video unavailable') || text.includes('removed by the uploader')) {
    return 'That media is no longer available at this link.';
  }
  if (text.includes('unsupported url') || text.includes('is not a valid url')) {
    return "That link isn't one this tool can read.";
  }
  if (text.includes('age') && text.includes('restrict')) {
    return 'That media is age-restricted and cannot be read without signing in.';
  }
  if (text.includes('file is larger than max-filesize')) {
    return 'That file is larger than the configured size limit.';
  }
  if (text.includes('geo') && text.includes('restrict')) {
    return 'That media is not available in this region.';
  }
  if (text.includes('timed out') || text.includes('temporary failure') || text.includes('network')) {
    return 'The network request failed. Check your connection and try again.';
  }
  return null;
}

let cachedVersion;

export const ytdlp = {
  async version() {
    if (cachedVersion === undefined) cachedVersion = await probeBinary(config.ytdlpPath);
    return cachedVersion;
  },

  /** Fetch metadata for a single item. Throws AppError on failure. */
  async getInfo(url, { signal, timeoutMs = config.analyzeTimeoutMs } = {}) {
    const { code, stdout, stderr } = await runProcess(
      config.ytdlpPath,
      [...BASE_ARGS, '--dump-single-json', '--', url],
      { signal, timeoutMs },
    );

    if (code !== 0) {
      logger.warn('yt-dlp metadata read failed', { code, stderr: stderr.slice(0, 800) });
      throw ERRORS.ANALYZE_FAILED(describeFailure(stderr));
    }

    const start = stdout.indexOf('{');
    if (start === -1) throw ERRORS.ANALYZE_FAILED();
    try {
      return JSON.parse(stdout.slice(start));
    } catch (cause) {
      logger.error('yt-dlp returned unparsable metadata', { cause: cause.message });
      throw ERRORS.ANALYZE_FAILED();
    }
  },

  /**
   * Download one item into `outputDir` as `<basename>.<ext>`, letting yt-dlp
   * choose the extension. Resolves with the real path yt-dlp reports.
   */
  async download({
    url,
    selector,
    outputDir,
    basename,
    audioFormat = null,
    mergeFormat = 'mp4',
    maxFileBytes = config.maxFileBytes,
    onProgress,
    onStage,
    signal,
    timeoutMs = config.jobTimeoutMs,
  }) {
    const args = [
      ...BASE_ARGS,
      '--newline',
      '--no-simulate',
      // --print suppresses progress output, so it has to be re-enabled.
      '--progress',
      '--progress-template',
      PROGRESS_TEMPLATE,
      '--print',
      `after_move:${FILE_TAG}%(filepath)s`,
      '--paths',
      outputDir,
      '--output',
      `${basename}.%(ext)s`,
    ];

    if (maxFileBytes > 0) args.push('--max-filesize', String(maxFileBytes));

    if (audioFormat) {
      args.push('--extract-audio', '--audio-format', audioFormat, '--audio-quality', '0');
      if (selector) args.push('--format', selector);
    } else {
      if (selector) args.push('--format', selector);
      args.push('--merge-output-format', mergeFormat);
    }

    args.push('--', url);

    let resultPath = null;
    let sawProgress = false;

    const { code, stderr } = await runProcess(config.ytdlpPath, args, {
      signal,
      timeoutMs,
      onStdoutLine: (line) => {
        if (line.startsWith(FILE_TAG)) {
          resultPath = line.slice(FILE_TAG.length).trim();
          return;
        }
        const progress = parseProgressLine(line);
        if (progress) {
          sawProgress = true;
          onProgress?.(progress);
          return;
        }
        // yt-dlp announces post-processing on stdout; surface it as a stage so
        // the UI stops implying bytes are still moving.
        if (line.includes('[Merger]')) onStage?.('merging');
        else if (line.includes('[ExtractAudio]')) onStage?.('extracting_audio');
        else if (line.includes('[VideoConvertor]') || line.includes('[VideoRemuxer]')) onStage?.('converting');
      },
      onStderrLine: (line) => logger.debug('yt-dlp', { line: line.slice(0, 300) }),
    });

    if (code !== 0) {
      logger.warn('yt-dlp download failed', { code, stderr: stderr.slice(0, 800) });
      const hint = describeFailure(stderr);
      if (hint?.includes('size limit')) throw ERRORS.TOO_LARGE(maxFileBytes);
      throw ERRORS.PROCESSING_FAILED(hint);
    }

    if (!resultPath) {
      // Exit code 0 with no reported file means the size guard skipped it.
      logger.warn('yt-dlp reported success but produced no file', { stderr: stderr.slice(0, 500) });
      throw ERRORS.PROCESSING_FAILED('The download finished without producing a file.');
    }

    return { path: resultPath, hadRealProgress: sawProgress };
  },
};
