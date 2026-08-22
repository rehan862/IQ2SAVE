/**
 * Turn a yt-dlp `formats` array into the short, honest list the UI offers.
 *
 * Two rules drive everything here:
 *   1. A resolution is only listed when a real format with that height exists.
 *   2. A size is only attached when yt-dlp reported one. Otherwise the field is
 *      null and the UI says the size is unknown rather than guessing.
 */

const NONE = 'none';

const truthyCodec = (value) => Boolean(value) && value !== NONE;

function hasVideo(format) {
  if (format.vcodec) return format.vcodec !== NONE;
  if (format.video_ext) return format.video_ext !== NONE;
  return format.height != null;
}

function hasAudio(format) {
  if (format.acodec) return format.acodec !== NONE;
  if (format.audio_ext) return format.audio_ext !== NONE;
  return format.abr != null;
}

const sizeOf = (format) => {
  const exact = Number(format.filesize);
  if (Number.isFinite(exact) && exact > 0) return { bytes: exact, exact: true };
  const approx = Number(format.filesize_approx);
  if (Number.isFinite(approx) && approx > 0) return { bytes: approx, exact: false };
  return { bytes: null, exact: false };
};

const rank = (format) => Number(format.tbr) || Number(format.vbr) || sizeOf(format).bytes || 0;

// A vertical video (Shorts, Reels) carries its long edge in `height`, so naming
// the tier after `height` alone reports a 1080x1920 clip as 1440p. Every quality
// tier is named after the short edge.
function labelForResolution(width, height) {
  const parsedWidth = Number(width);
  const shortEdge =
    Number.isFinite(parsedWidth) && parsedWidth > 0 ? Math.min(parsedWidth, height) : height;
  if (shortEdge >= 4320) return '4320p (8K)';
  if (shortEdge >= 2160) return '2160p (4K)';
  if (shortEdge >= 1440) return '1440p (2K)';
  return `${shortEdge}p`;
}

export function buildFormats(info, { canMerge = true } = {}) {
  const raw = (Array.isArray(info.formats) ? info.formats : []).filter(
    (f) => f && f.protocol !== 'mhtml' && f.format_note !== 'storyboard',
  );

  const videoish = raw.filter(hasVideo);
  const audioOnly = raw.filter((f) => hasAudio(f) && !hasVideo(f));
  const progressive = videoish.filter(hasAudio);

  const bestAudio = audioOnly.length
    ? audioOnly.reduce((a, b) => ((Number(b.abr) || rank(b)) > (Number(a.abr) || rank(a)) ? b : a))
    : null;

  const heights = [...new Set(videoish.map((f) => Number(f.height)).filter((h) => Number.isFinite(h) && h > 0))].sort(
    (a, b) => b - a,
  );

  const formats = [];

  for (const height of heights) {
    const atHeight = videoish.filter((f) => Number(f.height) === height);
    const progressiveHere = atHeight.filter(hasAudio).sort((a, b) => rank(b) - rank(a))[0];
    const videoOnlyHere = atHeight.filter((f) => !hasAudio(f)).sort((a, b) => rank(b) - rank(a))[0];

    // A progressive stream needs no merge, so prefer it when one exists.
    if (progressiveHere) {
      const size = sizeOf(progressiveHere);
      formats.push({
        id: `v${height}`,
        kind: 'video',
        label: labelForResolution(progressiveHere.width, height),
        container: progressiveHere.ext || 'mp4',
        height,
        fps: Number(progressiveHere.fps) || null,
        vcodec: progressiveHere.vcodec ?? null,
        acodec: progressiveHere.acodec ?? null,
        approxBytes: size.bytes,
        exactSize: size.exact,
        requiresMerge: false,
        selector: `b[height=${height}][vcodec!=none][acodec!=none]/b[height<=${height}]`,
        note: null,
      });
      continue;
    }

    if (!videoOnlyHere) continue;

    // Video-only needs ffmpeg to be muxed with an audio track.
    if (!canMerge) continue;

    const videoSize = sizeOf(videoOnlyHere);
    const audioSize = bestAudio ? sizeOf(bestAudio) : { bytes: null, exact: false };
    const combined =
      videoSize.bytes !== null && audioSize.bytes !== null
        ? videoSize.bytes + audioSize.bytes
        : videoSize.bytes;

    formats.push({
      id: `v${height}`,
      kind: 'video',
      label: labelForResolution(videoOnlyHere.width, height),
      container: 'mp4',
      height,
      fps: Number(videoOnlyHere.fps) || null,
      vcodec: videoOnlyHere.vcodec ?? null,
      acodec: bestAudio?.acodec ?? null,
      approxBytes: combined,
      // A merge picks streams at download time, so the total is always an estimate.
      exactSize: false,
      requiresMerge: true,
      selector: `bv*[height<=${height}]+ba/b[height<=${height}]`,
      note: 'video and audio are combined during download',
    });
  }

  const audioSource = bestAudio || progressive.sort((a, b) => rank(b) - rank(a))[0] || null;

  if (audioSource) {
    if (bestAudio) {
      const size = sizeOf(bestAudio);
      formats.push({
        id: 'a-original',
        kind: 'audio',
        label: `Original audio (${(bestAudio.ext || 'm4a').toUpperCase()})`,
        container: bestAudio.ext || 'm4a',
        height: null,
        fps: null,
        vcodec: null,
        acodec: bestAudio.acodec ?? null,
        approxBytes: size.bytes,
        exactSize: size.exact,
        requiresMerge: false,
        selector: 'ba/b',
        note: 'no re-encoding, best quality',
      });
    }

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
      selector: 'ba/b',
      audioFormat: 'mp3',
      note: 're-encoded from the source audio',
    });
  }

  return formats;
}

/** Pick the largest usable thumbnail yt-dlp knows about. */
export function pickThumbnail(info) {
  if (typeof info.thumbnail === 'string' && info.thumbnail.startsWith('http')) return info.thumbnail;
  const list = Array.isArray(info.thumbnails) ? info.thumbnails : [];
  const usable = list
    .filter((t) => typeof t?.url === 'string' && t.url.startsWith('http'))
    .sort((a, b) => (Number(b.width) || Number(b.preference) || 0) - (Number(a.width) || Number(a.preference) || 0));
  return usable[0]?.url ?? null;
}

/** Common metadata shape shared by every yt-dlp-backed provider. */
export function baseMediaFromInfo(info) {
  const duration = Number(info.duration);
  return {
    id: info.id ?? null,
    title: info.title || info.fulltitle || 'Untitled',
    uploader: info.uploader || info.channel || info.uploader_id || null,
    thumbnail: pickThumbnail(info),
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    webpageUrl: info.webpage_url || info.original_url || null,
    live: Boolean(info.is_live || info.live_status === 'is_live'),
    extractor: info.extractor ?? null,
  };
}
