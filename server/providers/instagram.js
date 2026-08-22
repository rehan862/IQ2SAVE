import { notice } from './base.js';
import { createYtdlpProvider } from './ytdlpBase.js';

const HOSTS = new Set(['instagram.com', 'www.instagram.com', 'instagr.am', 'www.instagr.am']);

// Reels, feed posts, IGTV and the /<user>/reel/<id> form.
const MEDIA_PATHS = /^\/(reel|reels|p|tv)\/[^/]+/;
const USER_MEDIA_PATHS = /^\/[^/]+\/(reel|p)\/[^/]+/;

export const instagram = createYtdlpProvider({
  id: 'instagram',
  label: 'Instagram',
  kinds: ['instagram-reels', 'instagram-audio'],

  matches(url) {
    if (!HOSTS.has(url.hostname.toLowerCase())) return false;
    return MEDIA_PATHS.test(url.pathname) || USER_MEDIA_PATHS.test(url.pathname);
  },

  describe(info) {
    return info.description ? String(info.description).slice(0, 500) : null;
  },

  extraNotices() {
    // Instagram serves metadata for public posts only, and rate-limits hard.
    // Saying so up front is more useful than a bare failure later.
    return [
      notice(
        'info',
        'PUBLIC_ONLY',
        'Only public posts can be read. Private accounts, stories and close-friends posts are not accessible.',
      ),
    ];
  },
});
