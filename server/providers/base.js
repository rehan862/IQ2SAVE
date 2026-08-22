/**
 * Provider contract.
 *
 * Every provider is a plain object implementing the methods below. The registry
 * in ./index.js picks one per URL; nothing outside this folder knows which
 * engine actually does the work, so a provider can be swapped or added without
 * touching routes or the frontend.
 *
 *   id            string   stable key stored on job rows
 *   label         string   human name shown in the UI
 *   kinds         string[] service tags the UI groups by
 *
 *   validateUrl(url: URL): boolean
 *       Cheap synchronous test. Must not perform I/O. Returning false lets the
 *       registry try the next provider.
 *
 *   getMediaInfo(url: URL, ctx): Promise<NormalizedMedia>
 *       Read real metadata. Must throw an AppError on failure and must never
 *       invent fields it could not determine.
 *
 *   getAvailableFormats(info): NormalizedFormat[]
 *       Derive the selectable options from what getMediaInfo actually found.
 *
 *   createDownload(request, ctx): Promise<{ path, bytes, container }>
 *       Produce a finished file on disk. `ctx.onProgress` and `ctx.onStage`
 *       report real engine output only.
 *
 *   handleError(error): AppError
 *       Map an engine-specific failure onto a safe, user-facing error.
 *
 * NormalizedMedia
 *   { provider, providerLabel, id, title, uploader, thumbnail, duration,
 *     webpageUrl, sourceUrl, canonicalUrl, live, formats, notices }
 *
 * NormalizedFormat
 *   { id, kind: 'video'|'audio', label, container, height, fps, vcodec, acodec,
 *     approxBytes, exactSize, requiresMerge, selector, note }
 *
 * A `notice` is `{ level: 'info'|'warning', code, message }` and is how a
 * provider explains a limitation instead of silently degrading.
 */

import { AppError, ERRORS } from '../utils/errors.js';

/** Default error mapping: pass AppErrors through, mask everything else. */
export function defaultHandleError(error) {
  if (error instanceof AppError) return error;
  return ERRORS.PROCESSING_FAILED();
}

export function notice(level, code, message) {
  return { level, code, message };
}
