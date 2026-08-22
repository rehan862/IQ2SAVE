import { config } from '../config/index.js';
import { ERRORS } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { probeBinary, runProcess } from './spawn.js';

let cachedVersion;

/**
 * Parse `ffmpeg -progress pipe:1` output. It emits `key=value` lines in blocks
 * terminated by `progress=continue` or `progress=end`.
 *
 * Note: ffmpeg's `out_time_ms` field is actually microseconds despite the name,
 * and matches `out_time_us` exactly. Both are divided by 1e6 here.
 */
function progressParser(totalDurationSec, onProgress) {
  let block = {};
  return (line) => {
    const eq = line.indexOf('=');
    if (eq === -1) return;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    block[key] = value;

    if (key !== 'progress') return;

    const micros = Number(block.out_time_us ?? block.out_time_ms);
    const seconds = Number.isFinite(micros) ? micros / 1e6 : null;
    const bytes = Number(block.total_size);
    const speed = Number.parseFloat(block.speed);

    onProgress?.({
      seconds,
      progress:
        totalDurationSec > 0 && seconds !== null
          ? Math.min(1, Math.max(0, seconds / totalDurationSec))
          : null,
      downloadedBytes: Number.isFinite(bytes) ? bytes : null,
      speedRatio: Number.isFinite(speed) ? speed : null,
      done: value === 'end',
    });

    block = {};
  };
}

export const ffmpeg = {
  async version() {
    if (cachedVersion === undefined) cachedVersion = await probeBinary(config.ffmpegPath, ['-version']);
    return cachedVersion;
  },

  /** Read container/stream details from a local file or a remote URL. */
  async probe(target, { signal, timeoutMs = config.analyzeTimeoutMs } = {}) {
    const { code, stdout } = await runProcess(
      config.ffprobePath,
      ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', '-i', target],
      { signal, timeoutMs },
    );

    if (code !== 0) return null;

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      return null;
    }

    const streams = parsed.streams || [];
    const video = streams.find((s) => s.codec_type === 'video');
    const audio = streams.find((s) => s.codec_type === 'audio');
    const duration = Number(parsed.format?.duration);
    const size = Number(parsed.format?.size);

    return {
      durationSec: Number.isFinite(duration) ? duration : null,
      sizeBytes: Number.isFinite(size) ? size : null,
      formatName: parsed.format?.format_name || null,
      bitrate: Number(parsed.format?.bit_rate) || null,
      hasVideo: Boolean(video),
      hasAudio: Boolean(audio),
      width: video?.width ?? null,
      height: video?.height ?? null,
      fps: video?.r_frame_rate ? evaluateFraction(video.r_frame_rate) : null,
      vcodec: video?.codec_name ?? null,
      acodec: audio?.codec_name ?? null,
      title: parsed.format?.tags?.title ?? null,
    };
  },

  /** Run ffmpeg with caller-supplied arguments and real progress reporting. */
  async run({
    args,
    totalDurationSec = 0,
    onProgress,
    signal,
    timeoutMs = config.jobTimeoutMs,
  }) {
    const handleLine = progressParser(totalDurationSec, onProgress);
    const fullArgs = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-nostats', '-progress', 'pipe:1', ...args];

    const { code, stderr } = await runProcess(config.ffmpegPath, fullArgs, {
      signal,
      timeoutMs,
      onStdoutLine: handleLine,
      onStderrLine: (line) => logger.debug('ffmpeg', { line: line.slice(0, 300) }),
    });

    if (code !== 0) {
      logger.warn('ffmpeg exited non-zero', { code, stderr: stderr.slice(0, 800) });
      throw ERRORS.PROCESSING_FAILED('The media could not be converted.');
    }
  },

  /** Copy an HLS/DASH playlist into a single file without re-encoding. */
  async remux({ input, output, durationSec = 0, onProgress, signal, timeoutMs }) {
    await ffmpeg.run({
      args: [
        '-y',
        '-i',
        input,
        '-c',
        'copy',
        // Required for MP4: the moov atom is written last otherwise.
        '-bsf:a',
        'aac_adtstoasc',
        '-movflags',
        '+faststart',
        output,
      ],
      totalDurationSec: durationSec,
      onProgress,
      signal,
      timeoutMs,
    });
  },

  /** Re-encode the audio track of a local file to a standalone audio file. */
  async extractAudio({ input, output, codec = 'libmp3lame', quality = '2', durationSec = 0, onProgress, signal, timeoutMs }) {
    await ffmpeg.run({
      args: ['-y', '-i', input, '-vn', '-c:a', codec, '-q:a', quality, output],
      totalDurationSec: durationSec,
      onProgress,
      signal,
      timeoutMs,
    });
  },
};

function evaluateFraction(text) {
  const [num, den] = String(text).split('/').map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  return Math.round((num / den) * 100) / 100;
}
