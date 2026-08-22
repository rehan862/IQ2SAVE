import { notice } from './base.js';
import { createYtdlpProvider } from './ytdlpBase.js';

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

const VIDEO_PATHS = /^\/(watch|shorts\/|live\/|embed\/|v\/|clip\/)/;

export const youtube = createYtdlpProvider({
  id: 'youtube',
  label: 'YouTube',
  kinds: ['youtube-video', 'youtube-shorts', 'youtube-audio'],

  matches(url) {
    const host = url.hostname.toLowerCase();
    if (!HOSTS.has(host)) return false;
    if (host === 'youtu.be' || host === 'www.youtu.be') return url.pathname.length > 1;
    if (VIDEO_PATHS.test(url.pathname)) return true;
    // /watch requires ?v=, which the path test above already accepted.
    return url.searchParams.has('v');
  },

  describe(info) {
    return info.description ? String(info.description).slice(0, 500) : null;
  },

  extraNotices(info) {
    const out = [];
    if (info.availability && info.availability !== 'public') {
      out.push(
        notice(
          'info',
          'NOT_PUBLIC',
          `This video is marked "${info.availability}". Make sure you own it or have permission before saving it.`,
        ),
      );
    }
    if (info.age_limit) {
      out.push(notice('warning', 'AGE_LIMIT', 'This video is age-restricted and may not be readable.'));
    }
    return out;
  },
});
