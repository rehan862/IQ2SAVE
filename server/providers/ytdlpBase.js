import { ytdlp } from '../engines/ytdlp.js';
import { ERRORS } from '../utils/errors.js';
import { defaultHandleError, notice } from './base.js';
import { baseMediaFromInfo, buildFormats } from './formats.js';

/**
 * Build a provider backed by yt-dlp. Callers supply URL matching and any
 * platform-specific notices; metadata reading, format derivation and the
 * download itself are identical across platforms.
 */
export function createYtdlpProvider({ id, label, kinds, matches, describe, extraNotices }) {
  return {
    id,
    label,
    kinds,

    validateUrl(url) {
      return matches(url);
    },

    async getMediaInfo(url, ctx = {}) {
      const info = await ytdlp.getInfo(url.toString(), { signal: ctx.signal });

      // --no-playlist normally collapses this, but channel and profile URLs
      // still resolve to a container rather than a single item.
      if (info._type === 'playlist') {
        const entries = (info.entries || []).filter(Boolean);
        if (entries.length !== 1) {
          throw ERRORS.ANALYZE_FAILED(
            'That link points to a channel or playlist. Please paste the link to a single video or post.',
          );
        }
        return this.buildMedia(entries[0], url, ctx);
      }

      return this.buildMedia(info, url, ctx);
    },

    buildMedia(info, url, ctx = {}) {
      const base = baseMediaFromInfo(info);
      const formats = buildFormats(info, { canMerge: ctx.canMerge !== false });
      const notices = [];

      if (base.live) {
        notices.push(
          notice('warning', 'LIVE_STREAM', 'This is a live stream. Only the portion already broadcast can be saved.'),
        );
      }
      if (!formats.length) {
        notices.push(
          notice('warning', 'NO_FORMATS', 'No downloadable media track was found at this link.'),
        );
      }
      if (ctx.canMerge === false && formats.every((f) => f.kind === 'audio')) {
        notices.push(notice('warning', 'FFMPEG_MISSING', 'Install ffmpeg to enable higher video resolutions.'));
      }
      for (const extra of extraNotices?.(info) ?? []) notices.push(extra);

      return {
        provider: id,
        providerLabel: label,
        description: describe?.(info) ?? null,
        ...base,
        formats,
        notices,
      };
    },

    getAvailableFormats(media) {
      return media.formats ?? [];
    },

    async createDownload({ url, format, outputDir, basename }, ctx = {}) {
      const result = await ytdlp.download({
        url: url.toString(),
        selector: format?.selector ?? null,
        audioFormat: format?.audioFormat ?? null,
        mergeFormat: format?.container === 'webm' ? 'webm' : 'mp4',
        outputDir,
        basename,
        onProgress: ctx.onProgress,
        onStage: ctx.onStage,
        signal: ctx.signal,
      });

      return { path: result.path, container: format?.container ?? null };
    },

    handleError: defaultHandleError,
  };
}
