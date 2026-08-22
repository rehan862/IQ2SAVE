import { AppError, ERRORS } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export function notFound(_req, _res, next) {
  next(ERRORS.NOT_FOUND('That endpoint'));
}

/**
 * Single exit point for every failure. Only curated AppError messages reach the
 * client; anything else is logged in full and reported as a generic error so
 * stack traces, paths and engine internals never leave the process.
 */
export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }

  let appError;
  if (error instanceof AppError) {
    appError = error;
  } else if (error?.type === 'entity.too.large') {
    appError = ERRORS.BAD_REQUEST('That request was too large.');
  } else if (error?.type === 'entity.parse.failed' || error instanceof SyntaxError) {
    appError = ERRORS.BAD_REQUEST('That request body was not valid JSON.');
  } else {
    appError = ERRORS.INTERNAL();
    logger.error('Unhandled request failure', {
      method: req.method,
      path: req.path,
      message: error?.message,
      stack: error?.stack?.split('\n').slice(0, 4).join(' | '),
    });
  }

  const body = {
    success: false,
    error: { code: appError.code, message: appError.message },
  };
  if (appError.details) body.error.details = appError.details;

  res.status(appError.status).json(body);
}
