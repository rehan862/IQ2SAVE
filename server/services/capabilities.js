import { config } from '../config/index.js';
import { ffmpeg } from '../engines/ffmpeg.js';
import { ytdlp } from '../engines/ytdlp.js';
import { logger } from '../utils/logger.js';

let cache = null;

/**
 * Report which external binaries are actually runnable. The UI uses this to
 * explain missing capabilities up front instead of letting a download fail
 * halfway through, and format lists are narrowed when ffmpeg is unavailable.
 */
export async function getCapabilities({ refresh = false } = {}) {
  if (cache && !refresh) return cache;

  const [ytdlpVersion, ffmpegVersion] = await Promise.all([ytdlp.version(), ffmpeg.version()]);

  cache = {
    ytdlp: { available: Boolean(ytdlpVersion), version: ytdlpVersion, binary: config.ytdlpPath },
    ffmpeg: { available: Boolean(ffmpegVersion), version: ffmpegVersion, binary: config.ffmpegPath },
    canMerge: Boolean(ffmpegVersion),
    canConvertAudio: Boolean(ffmpegVersion),
    checkedAt: Date.now(),
  };

  if (!cache.ytdlp.available) {
    logger.warn('yt-dlp is not runnable; only direct media links will work', { binary: config.ytdlpPath });
  }
  if (!cache.ffmpeg.available) {
    logger.warn('ffmpeg is not runnable; merging and audio conversion are disabled', {
      binary: config.ffmpegPath,
    });
  }

  return cache;
}

export function invalidateCapabilities() {
  cache = null;
}
