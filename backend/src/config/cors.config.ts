import cors from 'cors';
import { RequestHandler } from 'express';
import { config } from './unifiedConfig';

export interface CorsConfigOptions {
  nodeEnv: string;
  corsOrigin?: string;
  webAppUrl?: string;
}

/**
 * Normalizes an origin string by trimming whitespace and removing trailing slashes.
 */
export function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

/**
 * Parses comma-separated origin strings into a list of normalized origins.
 * Strips whitespace, removes trailing slashes, and ignores empty entries.
 */
export function parseCorsOrigins(raw?: string): string[] {
  if (!raw || typeof raw !== 'string') {
    return [];
  }

  const origins = raw
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  const seen = new Set<string>();
  const uniqueOrigins: string[] = [];
  for (const o of origins) {
    const key = o.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniqueOrigins.push(o);
    }
  }
  return uniqueOrigins;
}

/**
 * Checks whether an origin is a local development origin (localhost or 127.0.0.1 on any port).
 */
export function isLocalDevOrigin(origin: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/i.test(origin.trim().replace(/\/+$/, ''));
}

/**
 * Determines whether a given request origin is allowed based on the environment configuration.
 *
 * Rules:
 * 1. If requestOrigin is absent/falsy, returns false (no CORS headers needed for non-browser clients).
 * 2. In production (nodeEnv === 'production'):
 *    - MUST use an explicit allowlist from CORS_ORIGIN.
 *    - If CORS_ORIGIN is absent, empty, or malformed, the allowlist is empty -> FAIL CLOSED (all browser origins denied).
 * 3. In non-production (development / test):
 *    - Allows origins in CORS_ORIGIN if specified.
 *    - Allows webAppUrl origin if specified.
 *    - Allows local development origins (localhost, 127.0.0.1).
 *    - Denies arbitrary unknown origins.
 */
export function isAllowedOrigin(
  requestOrigin: string | undefined,
  options?: Partial<CorsConfigOptions>
): boolean {
  if (!requestOrigin || typeof requestOrigin !== 'string') {
    return false;
  }

  const normalizedRequest = normalizeOrigin(requestOrigin);
  if (!normalizedRequest) {
    return false;
  }

  const nodeEnv = options?.nodeEnv ?? config.nodeEnv;
  const configuredOrigins = parseCorsOrigins(
    options && 'corsOrigin' in options ? options.corsOrigin : config.corsOrigin
  ).map((o) => normalizeOrigin(o));

  if (nodeEnv === 'production') {
    // FAIL CLOSED: If no allowed origins are configured, deny all browser cross-origin requests.
    if (configuredOrigins.length === 0) {
      return false;
    }
    return configuredOrigins.includes(normalizedRequest);
  }

  // Non-production (development / test)
  if (configuredOrigins.includes(normalizedRequest)) {
    return true;
  }

  const webAppUrl = options && 'webAppUrl' in options ? options.webAppUrl : config.webAppUrl;
  if (webAppUrl) {
    const webAppOrigins = parseCorsOrigins(webAppUrl).map((o) => normalizeOrigin(o));
    if (webAppOrigins.includes(normalizedRequest)) {
      return true;
    }
  }

  if (isLocalDevOrigin(requestOrigin)) {
    return true;
  }

  return false;
}

/**
 * Creates a cors.CorsOptionsDelegate that enforces strict production CORS rules.
 */
export function createCorsOptionsDelegate(
  overrideOptions?: Partial<CorsConfigOptions>
): cors.CorsOptionsDelegate {
  return (req, callback) => {
    const requestOrigin = req.headers.origin as string | undefined;

    // Requests without Origin header (curl, mobile native clients, server-to-server)
    // are not subject to browser CORS and should NOT receive CORS headers.
    if (!requestOrigin) {
      return callback(null, { origin: false });
    }

    const allowed = isAllowedOrigin(requestOrigin, overrideOptions);

    if (allowed) {
      return callback(null, {
        origin: requestOrigin,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
        optionsSuccessStatus: 204,
      });
    }

    // Disallowed origin: reject by not reflecting origin and not enabling credentials.
    return callback(null, { origin: false });
  };
}

/**
 * Creates Express CORS middleware with hardened settings.
 */
export function createCorsMiddleware(
  overrideOptions?: Partial<CorsConfigOptions>
): RequestHandler {
  return cors(createCorsOptionsDelegate(overrideOptions));
}
