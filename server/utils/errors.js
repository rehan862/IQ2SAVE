/**
 * Every error surfaced to a client goes through AppError so the response body
 * is always a curated code/message pair. Anything else that escapes a route is
 * reported as a generic INTERNAL_ERROR by the error middleware.
 */
export class AppError extends Error {
  constructor(code, message, { status = 400, cause, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

export const ERRORS = {
  INVALID_URL: () =>
    new AppError('INVALID_URL', 'Please enter a valid supported URL.', { status: 400 }),

  URL_TOO_LONG: () =>
    new AppError('URL_TOO_LONG', 'That URL is too long to process.', { status: 400 }),

  UNSUPPORTED_PLATFORM: () =>
    new AppError('UNSUPPORTED_PLATFORM', "This platform isn't currently supported.", {
      status: 422,
    }),

  BLOCKED_HOST: () =>
    new AppError('BLOCKED_HOST', 'That address cannot be processed.', { status: 400 }),

  ENGINE_MISSING: (binary) =>
    new AppError(
      'ENGINE_MISSING',
      `Required tool "${binary}" is not installed. Open Settings for setup instructions.`,
      { status: 503, details: { binary } },
    ),

  ANALYZE_FAILED: (hint) =>
    new AppError('ANALYZE_FAILED', hint || "We couldn't read that link. Please check it and try again.", {
      status: 422,
    }),

  PROCESSING_FAILED: (hint) =>
    new AppError('PROCESSING_FAILED', hint || "We couldn't process this link. Please try again.", {
      status: 500,
    }),

  UNAVAILABLE: () =>
    new AppError('UNAVAILABLE', 'The media service is temporarily unavailable. Please try again later.', {
      status: 503,
    }),

  RATE_LIMITED: (retryAfterSec) =>
    new AppError('RATE_LIMITED', 'Too many requests. Please wait a moment and try again.', {
      status: 429,
      details: { retryAfter: retryAfterSec },
    }),

  QUEUE_FULL: () =>
    new AppError('QUEUE_FULL', 'Too many downloads are already running. Please wait for one to finish.', {
      status: 429,
    }),

  TIMEOUT: () =>
    new AppError('TIMEOUT', 'That took too long and was stopped. Try a smaller file or a lower quality.', {
      status: 504,
    }),

  TOO_LARGE: (limitBytes) =>
    new AppError('TOO_LARGE', 'That file is larger than the configured size limit.', {
      status: 413,
      details: { limitBytes },
    }),

  NOT_FOUND: (what = 'That item') =>
    new AppError('NOT_FOUND', `${what} could not be found.`, { status: 404 }),

  BAD_REQUEST: (message) =>
    new AppError('BAD_REQUEST', message || 'The request was not valid.', { status: 400 }),

  CANCELLED: () => new AppError('CANCELLED', 'The job was cancelled.', { status: 409 }),

  INTERNAL: () =>
    new AppError('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.', {
      status: 500,
    }),
};
