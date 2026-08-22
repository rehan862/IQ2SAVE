import { generic } from './generic.js';
import { instagram } from './instagram.js';
import { youtube } from './youtube.js';

// Order matters: the first provider whose validateUrl() returns true wins, and
// `generic` is deliberately last because it accepts everything.
const PLATFORM_PROVIDERS = [youtube, instagram];

export const providers = [...PLATFORM_PROVIDERS, generic];

const byId = new Map(providers.map((provider) => [provider.id, provider]));

export function resolveProvider(url) {
  for (const provider of PLATFORM_PROVIDERS) {
    if (provider.validateUrl(url)) return provider;
  }
  return generic;
}

export function getProvider(id) {
  return byId.get(id) ?? null;
}

/**
 * Service catalogue rendered as cards in the UI. `example` is shown as
 * placeholder text so the expected URL shape is obvious.
 */
export const services = [
  {
    id: 'youtube-shorts',
    provider: 'youtube',
    icon: 'shorts',
    example: 'https://www.youtube.com/shorts/…',
  },
  {
    id: 'youtube-video',
    provider: 'youtube',
    icon: 'video',
    example: 'https://www.youtube.com/watch?v=…',
  },
  {
    id: 'youtube-audio',
    provider: 'youtube',
    icon: 'audio',
    example: 'https://youtu.be/…',
  },
  {
    id: 'instagram-reels',
    provider: 'instagram',
    icon: 'reels',
    example: 'https://www.instagram.com/reel/…',
  },
  {
    id: 'instagram-audio',
    provider: 'instagram',
    icon: 'waveform',
    example: 'https://www.instagram.com/p/…',
  },
  {
    id: 'media-link',
    provider: 'generic',
    icon: 'link',
    example: 'https://example.com/video.mp4',
  },
];
