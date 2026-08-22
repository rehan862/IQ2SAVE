import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { config } from '../config/index.js';
import { ERRORS } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { parseUrl, resolvePublicAddresses } from '../utils/url.js';

const MAX_REDIRECTS = 5;
const USER_AGENT = 'IQ2SAVE/1.0 (+local media utility)';

/**
 * Force the socket to connect to an address we already screened. Re-resolving
 * inside net.connect would reopen a DNS-rebinding window between the validation
 * and the connection.
 */
function pinnedLookup(records) {
  return (_hostname, options, callback) => {
    if (options?.all) {
      callback(null, records.map((r) => ({ address: r.address, family: r.family })));
      return;
    }
    const first = records[0];
    callback(null, first.address, first.family);
  };
}

function requestOnce(url, { method, signal, extraHeaders = {} }) {
  return new Promise((resolve, reject) => {
    resolvePublicAddresses(url.hostname).then(
      (records) => {
        const transport = url.protocol === 'https:' ? https : http;
        const request = transport.request(
          {
            method,
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: `${url.pathname}${url.search}`,
            // TLS is still validated against the original hostname.
            servername: net.isIP(url.hostname) ? undefined : url.hostname,
            lookup: pinnedLookup(records),
            headers: {
              'user-agent': USER_AGENT,
              accept: '*/*',
              host: url.host,
              ...extraHeaders,
            },
            signal,
            timeout: 30000,
          },
          (response) => resolve(response),
        );

        request.on('timeout', () => request.destroy(ERRORS.TIMEOUT()));
        request.on('error', (error) => reject(error));
        request.end();
      },
      (error) => reject(error),
    );
  });
}

/** Follow redirects manually so every hop is re-validated against the SSRF rules. */
async function requestFollowing(rawUrl, options) {
  let url = rawUrl instanceof URL ? rawUrl : parseUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response;
    try {
      response = await requestOnce(url, options);
    } catch (error) {
      if (error?.code === 'INVALID_URL' || error?.code === 'BLOCKED_HOST' || error?.code === 'TIMEOUT') throw error;
      if (error?.name === 'AbortError') throw ERRORS.CANCELLED();
      logger.warn('HTTP request failed', { code: error?.code, message: error?.message });
      throw ERRORS.PROCESSING_FAILED('The server could not be reached.');
    }

    const status = response.statusCode ?? 0;
    const location = response.headers.location;

    if (status >= 300 && status < 400 && location) {
      response.resume();
      let next;
      try {
        next = new URL(location, url);
      } catch {
        throw ERRORS.PROCESSING_FAILED('The server sent an invalid redirect.');
      }
      if (!['http:', 'https:'].includes(next.protocol)) throw ERRORS.BLOCKED_HOST();
      url = next;
      continue;
    }

    if (status === 404 || status === 410) {
      response.resume();
      throw ERRORS.NOT_FOUND('That media');
    }
    if (status === 401 || status === 403) {
      response.resume();
      throw ERRORS.PROCESSING_FAILED('That media is not publicly accessible.');
    }
    if (status >= 400) {
      response.resume();
      throw ERRORS.PROCESSING_FAILED(`The server responded with an error (${status}).`);
    }

    return { response, finalUrl: url };
  }

  throw ERRORS.PROCESSING_FAILED('The link redirected too many times.');
}

function filenameFromDisposition(header) {
  if (!header) return null;
  const utf8 = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (utf8) {
    try {
      return decodeURIComponent(utf8[1].trim());
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = header.match(/filename\s*=\s*"?([^";]+)"?/i);
  return plain ? plain[1].trim() : null;
}

export const httpStream = {
  /**
   * Inspect a URL without downloading its body. Falls back to a ranged GET
   * because plenty of media hosts do not implement HEAD.
   */
  async inspect(rawUrl, { signal } = {}) {
    let result;
    try {
      result = await requestFollowing(rawUrl, { method: 'HEAD', signal });
    } catch (error) {
      if (error?.code === 'BLOCKED_HOST' || error?.code === 'CANCELLED') throw error;
      result = await requestFollowing(rawUrl, {
        method: 'GET',
        signal,
        extraHeaders: { range: 'bytes=0-0' },
      });
    }

    const { response, finalUrl } = result;
    response.resume();

    const rawLength = Number(response.headers['content-length']);
    const contentRange = response.headers['content-range'];
    let contentLength = Number.isFinite(rawLength) ? rawLength : null;

    // A ranged probe reports 1 byte, so take the real total from Content-Range.
    if (contentRange) {
      const total = Number(String(contentRange).split('/')[1]);
      if (Number.isFinite(total)) contentLength = total;
    }

    return {
      finalUrl: finalUrl.toString(),
      contentType: String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase() || null,
      contentLength,
      acceptsRanges: String(response.headers['accept-ranges'] || '').includes('bytes'),
      filename: filenameFromDisposition(response.headers['content-disposition']),
      etag: response.headers.etag ?? null,
    };
  },

  /** Stream a URL to disk, reporting real byte counts. */
  async download({ url, destPath, maxBytes = config.maxFileBytes, onProgress, signal }) {
    const { response } = await requestFollowing(url, { method: 'GET', signal });

    const declared = Number(response.headers['content-length']);
    const totalBytes = Number.isFinite(declared) ? declared : null;

    if (maxBytes > 0 && totalBytes && totalBytes > maxBytes) {
      response.destroy();
      throw ERRORS.TOO_LARGE(maxBytes);
    }

    let downloadedBytes = 0;
    let lastEmit = 0;
    const startedAt = Date.now();

    const counter = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        if (maxBytes > 0 && downloadedBytes > maxBytes) {
          callback(ERRORS.TOO_LARGE(maxBytes));
          return;
        }
        const now = Date.now();
        if (now - lastEmit >= 250) {
          lastEmit = now;
          const elapsed = (now - startedAt) / 1000;
          onProgress?.({
            downloadedBytes,
            totalBytes,
            speedBps: elapsed > 0 ? downloadedBytes / elapsed : null,
            progress: totalBytes ? Math.min(1, downloadedBytes / totalBytes) : null,
            etaSeconds:
              totalBytes && elapsed > 0
                ? Math.max(0, (totalBytes - downloadedBytes) / (downloadedBytes / elapsed))
                : null,
          });
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(response, counter, fs.createWriteStream(destPath), { signal });
    } catch (error) {
      await fs.promises.rm(destPath, { force: true });
      if (error?.code === 'TOO_LARGE') throw error;
      if (error?.name === 'AbortError' || error?.code === 'ABORT_ERR') throw ERRORS.CANCELLED();
      logger.warn('Stream download failed', { message: error?.message });
      throw ERRORS.PROCESSING_FAILED('The download was interrupted.');
    }

    onProgress?.({
      downloadedBytes,
      totalBytes: totalBytes ?? downloadedBytes,
      progress: 1,
      speedBps: null,
      etaSeconds: 0,
    });

    return { bytes: downloadedBytes };
  },
};
