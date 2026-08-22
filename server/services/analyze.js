import { mediaCache } from '../db/repos.js';
import { resolveProvider } from '../providers/index.js';
import { canonicalUrl, parseUrl, resolvePublicAddresses } from '../utils/url.js';
import { getCapabilities } from './capabilities.js';

// Media URLs embedded in provider metadata are short-lived signed links, so the
// cache exists to make repeat analysis of the same page fast, not to be durable.
const CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Validate a URL, pick a provider, and read real metadata.
 *
 * Returns `{ media, provider, url }`. `media.formats` contains only options the
 * installed engines can actually deliver.
 */
export async function analyzeUrl(rawUrl, { signal, useCache = true } = {}) {
  const url = parseUrl(rawUrl);

  // Reject internal addresses before any engine is handed the URL.
  await resolvePublicAddresses(url.hostname);

  const provider = resolveProvider(url);
  const canonical = canonicalUrl(url);

  if (useCache) {
    const cached = mediaCache.get(canonical);
    if (cached) return { media: cached, provider, url, cached: true };
  }

  const capabilities = await getCapabilities();
  const media = await provider.getMediaInfo(url, {
    signal,
    canMerge: capabilities.canMerge,
  });

  media.sourceUrl = url.toString();
  media.canonicalUrl = canonical;

  mediaCache.set(canonical, provider.id, media, CACHE_TTL_MS);

  return { media, provider, url, cached: false };
}

/**
 * Resolve a client-supplied format id against a freshly derived format list.
 *
 * The client only ever sends an id. Format selectors are never accepted from
 * the request because they are passed to yt-dlp as arguments.
 */
export function selectFormat(media, formatId) {
  const formats = media.formats ?? [];
  if (!formatId) return formats[0] ?? null;
  return formats.find((format) => format.id === formatId) ?? null;
}
