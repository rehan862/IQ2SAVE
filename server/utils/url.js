import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config/index.js';
import { ERRORS } from './errors.js';

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/** Parse and normalise user input, rejecting anything that is not a plain web URL. */
export function parseUrl(raw) {
  if (typeof raw !== 'string') throw ERRORS.INVALID_URL();
  const trimmed = raw.trim();
  if (!trimmed) throw ERRORS.INVALID_URL();
  if (trimmed.length > config.maxUrlLength) throw ERRORS.URL_TOO_LONG();

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    // A bare "youtube.com/watch?v=x" is a reasonable thing for someone to paste.
    try {
      url = new URL(`https://${trimmed}`);
    } catch {
      throw ERRORS.INVALID_URL();
    }
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw ERRORS.INVALID_URL();
  if (!url.hostname) throw ERRORS.INVALID_URL();
  // Credentials in a URL are never needed here and would be logged or passed
  // to a subprocess, so refuse rather than silently strip them.
  if (url.username || url.password) throw ERRORS.INVALID_URL();

  return url;
}

function ipv4ToInt(ip) {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

const V4_BLOCKED = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, includes cloud metadata at 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
].map(([base, bits]) => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  // Both sides must be coerced to unsigned: `&` yields a signed int32, so any
  // network above 127.255.255.255 would otherwise compare as a negative number
  // and silently never match.
  return { network: (ipv4ToInt(base) & mask) >>> 0, mask };
});

function isPrivateV4(ip) {
  const value = ipv4ToInt(ip);
  return V4_BLOCKED.some(({ network, mask }) => ((value & mask) >>> 0) === network);
}

function isPrivateV6(ip) {
  const lower = ip.toLowerCase().split('%')[0];
  if (lower === '::1' || lower === '::') return true;

  // IPv4-mapped and IPv4-compatible forms tunnel the v4 rules through v6.
  const mapped = lower.match(/^(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (mapped) return isPrivateV4(mapped[1]);

  const head = Number.parseInt(lower.split(':')[0] || '0', 16);
  if (Number.isNaN(head)) return true;
  if ((head & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((head & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

export function isPrivateAddress(ip) {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateV4(ip);
  if (version === 6) return isPrivateV6(ip);
  return true;
}

/**
 * Resolve a hostname and confirm every address it maps to is publicly routable.
 * Returns the resolved addresses so callers can pin one for the actual request
 * instead of re-resolving and inheriting a DNS-rebinding race.
 */
export async function resolvePublicAddresses(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw ERRORS.BLOCKED_HOST();
    return [{ address: hostname, family: net.isIP(hostname) }];
  }

  const lowered = hostname.toLowerCase();
  if (lowered === 'localhost' || lowered.endsWith('.localhost') || lowered.endsWith('.local')) {
    throw ERRORS.BLOCKED_HOST();
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw ERRORS.BLOCKED_HOST();
  }

  if (!records.length) throw ERRORS.BLOCKED_HOST();
  for (const record of records) {
    if (isPrivateAddress(record.address)) throw ERRORS.BLOCKED_HOST();
  }
  return records;
}

/** Strip query noise so the same media analysed twice produces one cache key. */
export function canonicalUrl(url) {
  const clone = new URL(url.toString());
  clone.hash = '';
  for (const key of [...clone.searchParams.keys()]) {
    if (/^(utm_|fbclid|gclid|igshid|si$|feature$)/i.test(key)) clone.searchParams.delete(key);
  }
  return clone.toString();
}
