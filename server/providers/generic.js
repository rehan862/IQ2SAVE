import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg } from '../engines/ffmpeg.js';
import { httpStream } from '../engines/httpStream.js';
import { ytdlp } from '../engines/ytdlp.js';
import { ERRORS } from '../utils/errors.js';
import { defaultHandleError, notice } from './base.js';
import { sanitizeFilename } from '../utils/filename.js';
import { createYtdlpProvider } from './ytdlpBase.js';

const VIDEO_EXT = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv', 'ts', 'mpg', 'mpeg', '3gp']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'ogg', 'opus', 'wav', 'flac', 'wma']);
const HLS_EXT = new Set(['m3u8', 'm3u']);
const DASH_EXT = new Set(['mpd']);

const HLS_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
]);

// Delegate to yt-dlp's generic extractor for ordinary web pages.
const siteFallback = createYtdlpProvider({
  id: 'generic',
  label: 'Media Link',
  kinds: ['media-link'],
  matches: () => true,
});

function extensionOf(url) {
  const ext = path.extname(url.pathname).replace('.', '').toLowerCase();
  return ext || null;
}

function classify(url, inspection) {
  const ext = extensionOf(url);
  const type = inspection?.contentType ?? null;

  if (HLS_EXT.has(ext) || (type && HLS_TYPES.has(type))) return 'hls';
  if (DASH_EXT.has(ext) || type === 'application/dash+xml') return 'dash';
  if (VIDEO_EXT.has(ext) || AUDIO_EXT.has(ext)) return 'file';
  if (type?.startsWith('video/') || type?.startsWith('audio/')) return 'file';
  return 'site';
}

function titleFromUrl(url, inspection) {
  const fromHeader = inspection?.filename;
  const raw = fromHeader || decodeURIComponent(path.basename(url.pathname)) || url.hostname;
  return sanitizeFilename(path.parse(raw).name || url.hostname, { fallback: url.hostname });
}

export const generic = {
  id: 'generic',
  label: 'Media Link',
  kinds: ['media-link'],

  // Lowest-priority provider: the registry only reaches it when no platform
  // provider claimed the URL.
  validateUrl() {
    return true;
  },

  async getMediaInfo(url, ctx = {}) {
    let inspection = null;
    try {
      inspection = await httpStream.inspect(url, { signal: ctx.signal });
    } catch (error) {
      // A page that rejects HEAD is still worth handing to yt-dlp.
      if (error?.code === 'BLOCKED_HOST' || error?.code === 'CANCELLED') throw error;
    }

    const kind = classify(url, inspection);

    if (kind === 'site' || kind === 'dash') {
      const media = await siteFallback.getMediaInfo(url, ctx);
      if (!media.formats.length) throw ERRORS.UNSUPPORTED_PLATFORM();
      return media;
    }

    const probe = await ffmpeg.probe(url.toString(), { signal: ctx.signal }).catch(() => null);
    const title = titleFromUrl(url, inspection);

    if (kind === 'hls') return this.buildHlsMedia({ url, title, probe });
    return this.buildFileMedia({ url, title, probe, inspection });
  },

  buildFileMedia({ url, title, probe, inspection }) {
    const ext = extensionOf(url) || (probe?.hasVideo ? 'mp4' : 'm4a');
    const isAudioOnly = probe ? !probe.hasVideo : AUDIO_EXT.has(ext);
    const bytes = inspection?.contentLength ?? probe?.sizeBytes ?? null;

    const formats = [
      {
        id: 'src',
        kind: isAudioOnly ? 'audio' : 'video',
        label: isAudioOnly
          ? `Original audio (${ext.toUpperCase()})`
          : `Original file${probe?.height ? ` (${probe.height}p)` : ''}`,
        container: ext,
        height: probe?.height ?? null,
        fps: probe?.fps ?? null,
        vcodec: probe?.vcodec ?? null,
        acodec: probe?.acodec ?? null,
        // Content-Length is the byte count the server will actually send.
        approxBytes: bytes,
        exactSize: inspection?.contentLength != null,
        requiresMerge: false,
        engine: 'http',
        durationSec: probe?.durationSec ?? null,
        note: 'saved exactly as served, no re-encoding',
      },
    ];

    // Only offer audio extraction when a real audio stream was detected.
    if (probe?.hasAudio && !isAudioOnly) {
      formats.push({
        id: 'a-mp3',
        kind: 'audio',
        label: 'MP3 audio',
        container: 'mp3',
        height: null,
        fps: null,
        vcodec: null,
        acodec: 'mp3',
        approxBytes: null,
        exactSize: false,
        requiresMerge: false,
        engine: 'ffmpeg-audio',
        durationSec: probe?.durationSec ?? null,
        note: 'downloaded, then re-encoded locally',
      });
    }

    const notices = [];
    if (!probe) {
      notices.push(
        notice('info', 'NO_PROBE', 'The media details could not be read, so this file will be saved as-is.'),
      );
    }

    return {
      provider: 'generic',
      providerLabel: 'Media Link',
      id: null,
      title,
      uploader: url.hostname,
      thumbnail: null,
      duration: probe?.durationSec ?? null,
      webpageUrl: url.toString(),
      live: false,
      extractor: 'direct',
      description: null,
      formats,
      notices,
    };
  },

  buildHlsMedia({ url, title, probe }) {
    if (!probe) throw ERRORS.ANALYZE_FAILED('That stream could not be read.');

    return {
      provider: 'generic',
      providerLabel: 'Media Link',
      id: null,
      title,
      uploader: url.hostname,
      thumbnail: null,
      duration: probe.durationSec,
      webpageUrl: url.toString(),
      live: probe.durationSec === null,
      extractor: 'hls',
      description: null,
      formats: [
        {
          id: 'hls-mp4',
          kind: 'video',
          label: `MP4${probe.height ? ` (${probe.height}p)` : ''}`,
          container: 'mp4',
          height: probe.height,
          fps: probe.fps,
          vcodec: probe.vcodec,
          acodec: probe.acodec,
          // Segment sizes are not published by a playlist.
          approxBytes: null,
          exactSize: false,
          requiresMerge: false,
          engine: 'ffmpeg-remux',
          durationSec: probe.durationSec,
          note: 'segments are joined without re-encoding',
        },
      ],
      notices: probe.durationSec
        ? []
        : [notice('warning', 'LIVE_STREAM', 'This looks like a live stream, so the saved length may vary.')],
    };
  },

  getAvailableFormats(media) {
    return media.formats ?? [];
  },

  async createDownload({ url, format, outputDir, basename }, ctx = {}) {
    const engine = format?.engine ?? null;

    if (engine === 'http') {
      const destination = path.join(outputDir, `${basename}.${format.container}`);
      await httpStream.download({
        url,
        destPath: destination,
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      });
      return { path: destination, container: format.container };
    }

    if (engine === 'ffmpeg-audio') {
      // Fetch through our own SSRF-checked client first, then convert locally.
      const sourceExt = extensionOf(url) || 'bin';
      const intermediate = path.join(outputDir, `${basename}.source.${sourceExt}`);
      ctx.onStage?.('downloading');
      await httpStream.download({
        url,
        destPath: intermediate,
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      });

      const destination = path.join(outputDir, `${basename}.mp3`);
      ctx.onStage?.('extracting_audio');
      try {
        await ffmpeg.extractAudio({
          input: intermediate,
          output: destination,
          durationSec: format.durationSec ?? 0,
          onProgress: ctx.onProgress,
          signal: ctx.signal,
        });
      } finally {
        await fs.rm(intermediate, { force: true });
      }
      return { path: destination, container: 'mp3' };
    }

    if (engine === 'ffmpeg-remux') {
      const destination = path.join(outputDir, `${basename}.mp4`);
      ctx.onStage?.('downloading');
      await ffmpeg.run({
        args: [
          // ffmpeg fetches the segments itself; restrict it to the protocols a
          // playlist legitimately needs.
          '-protocol_whitelist',
          'file,http,https,tcp,tls,crypto',
          '-y',
          '-i',
          url.toString(),
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          destination,
        ],
        totalDurationSec: format.durationSec ?? 0,
        onProgress: ctx.onProgress,
        signal: ctx.signal,
      });
      return { path: destination, container: 'mp4' };
    }

    // Site fallback: the media came from yt-dlp's generic extractor.
    return siteFallback.createDownload({ url, format, outputDir, basename }, ctx);
  },

  handleError: defaultHandleError,
};
