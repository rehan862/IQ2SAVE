import { config } from '../config/index.js';

// Thumbnails are hotlinked from provider CDNs, so remote https images are
// allowed. Everything executable must come from this origin.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.removeHeader('X-Powered-By');
  next();
}

/**
 * Same-origin requests carry no Origin header (or a matching one), so the
 * default posture is to allow nothing cross-origin unless CORS_ORIGINS lists it.
 */
export function cors(req, res, next) {
  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }

  if (config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Vary', 'Origin');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}

/**
 * Reject state-changing requests that arrive from another site. The UI is
 * same-origin and sends no Origin header on same-origin fetches in most
 * browsers, so an Origin that is present and foreign is a genuine signal.
 */
export function sameOriginOnly(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (!origin) {
    next();
    return;
  }

  const allowed = [`http://${req.headers.host}`, `https://${req.headers.host}`, ...config.corsOrigins];
  if (allowed.includes(origin)) {
    next();
    return;
  }

  res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN_ORIGIN', message: 'This request was blocked for security reasons.' },
  });
}
