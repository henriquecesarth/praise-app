import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import {
  parseCorsOrigins,
  isLocalDevOrigin,
  isAllowedOrigin,
  createCorsMiddleware,
  normalizeOrigin,
} from './cors.config';
import app from '../app';

describe('Production CORS Hardening Suite (R-CORS)', () => {
  describe('1. Parsing & Normalization Unit Tests', () => {
    it('parses valid comma-separated origins, trims whitespace and strips trailing slashes', () => {
      const parsed = parseCorsOrigins(
        ' https://praise-app-m7tn.vercel.app/ , https://louvaio.com , http://localhost:5173/ '
      );
      expect(parsed).toEqual([
        'https://praise-app-m7tn.vercel.app',
        'https://louvaio.com',
        'http://localhost:5173',
      ]);
    });

    it('returns empty array when input is undefined, null, or empty string', () => {
      expect(parseCorsOrigins(undefined)).toEqual([]);
      expect(parseCorsOrigins('')).toEqual([]);
      expect(parseCorsOrigins('   ')).toEqual([]);
      expect(parseCorsOrigins(',, , ')).toEqual([]);
      expect(parseCorsOrigins(null as any)).toEqual([]);
    });

    it('deduplicates case-insensitively while preserving valid format', () => {
      const parsed = parseCorsOrigins(
        'https://praise-app-m7tn.vercel.app, HTTPS://PRAISE-APP-M7TN.VERCEL.APP, https://praise-app-m7tn.vercel.app/'
      );
      expect(parsed).toEqual(['https://praise-app-m7tn.vercel.app']);
    });

    it('identifies local development origins correctly', () => {
      expect(isLocalDevOrigin('http://localhost:5173')).toBe(true);
      expect(isLocalDevOrigin('http://localhost:3000')).toBe(true);
      expect(isLocalDevOrigin('http://127.0.0.1:5173')).toBe(true);
      expect(isLocalDevOrigin('http://localhost')).toBe(true);
      expect(isLocalDevOrigin('https://localhost:5173')).toBe(true);
      expect(isLocalDevOrigin('http://localhost:5173/')).toBe(true);
      expect(isLocalDevOrigin('https://evil.com')).toBe(false);
      expect(isLocalDevOrigin('http://localhost.attacker.com')).toBe(false);
      expect(isLocalDevOrigin('http://not-localhost:5173')).toBe(false);
    });

    it('normalizes origins correctly', () => {
      expect(normalizeOrigin('  https://praise-app-m7tn.vercel.app/  ')).toBe(
        'https://praise-app-m7tn.vercel.app'
      );
      expect(normalizeOrigin('HTTPS://LOUVAIO.COM///')).toBe('https://louvaio.com');
    });
  });

  describe('2. isAllowedOrigin Evaluation Logic', () => {
    it('production: accepts configured production web origin', () => {
      const result = isAllowedOrigin('https://praise-app-m7tn.vercel.app', {
        nodeEnv: 'production',
        corsOrigin: 'https://praise-app-m7tn.vercel.app',
      });
      expect(result).toBe(true);
    });

    it('production: accepts configured origin with trailing slash in config or request', () => {
      const result1 = isAllowedOrigin('https://praise-app-m7tn.vercel.app/', {
        nodeEnv: 'production',
        corsOrigin: 'https://praise-app-m7tn.vercel.app',
      });
      expect(result1).toBe(true);

      const result2 = isAllowedOrigin('https://praise-app-m7tn.vercel.app', {
        nodeEnv: 'production',
        corsOrigin: 'https://praise-app-m7tn.vercel.app/',
      });
      expect(result2).toBe(true);
    });

    it('production: rejects arbitrary browser origins', () => {
      const result = isAllowedOrigin('https://evil.com', {
        nodeEnv: 'production',
        corsOrigin: 'https://praise-app-m7tn.vercel.app',
      });
      expect(result).toBe(false);
    });

    it('production: rejects subdomain suffix spoofing', () => {
      const result = isAllowedOrigin('https://praise-app-m7tn.vercel.app.attacker.com', {
        nodeEnv: 'production',
        corsOrigin: 'https://praise-app-m7tn.vercel.app',
      });
      expect(result).toBe(false);
    });

    it('production FAIL CLOSED: rejects all origins when CORS_ORIGIN is undefined', () => {
      expect(
        isAllowedOrigin('https://praise-app-m7tn.vercel.app', {
          nodeEnv: 'production',
          corsOrigin: undefined,
        })
      ).toBe(false);
      expect(
        isAllowedOrigin('https://evil.com', {
          nodeEnv: 'production',
          corsOrigin: undefined,
        })
      ).toBe(false);
    });

    it('production FAIL CLOSED: rejects all origins when CORS_ORIGIN is empty or whitespace', () => {
      expect(
        isAllowedOrigin('https://praise-app-m7tn.vercel.app', {
          nodeEnv: 'production',
          corsOrigin: '',
        })
      ).toBe(false);
      expect(
        isAllowedOrigin('https://praise-app-m7tn.vercel.app', {
          nodeEnv: 'production',
          corsOrigin: '   ',
        })
      ).toBe(false);
      expect(
        isAllowedOrigin('https://praise-app-m7tn.vercel.app', {
          nodeEnv: 'production',
          corsOrigin: '  , , ,  ',
        })
      ).toBe(false);
    });

    it('returns false for absent or empty requestOrigin', () => {
      expect(isAllowedOrigin(undefined, { nodeEnv: 'production', corsOrigin: 'https://praise-app-m7tn.vercel.app' })).toBe(false);
      expect(isAllowedOrigin('', { nodeEnv: 'production', corsOrigin: 'https://praise-app-m7tn.vercel.app' })).toBe(false);
      expect(isAllowedOrigin('   ', { nodeEnv: 'production', corsOrigin: 'https://praise-app-m7tn.vercel.app' })).toBe(false);
    });

    it('development: allows localhost and 127.0.0.1 origins', () => {
      expect(isAllowedOrigin('http://localhost:5173', { nodeEnv: 'development' })).toBe(true);
      expect(isAllowedOrigin('http://127.0.0.1:5173', { nodeEnv: 'development' })).toBe(true);
      expect(isAllowedOrigin('http://localhost:3000', { nodeEnv: 'development' })).toBe(true);
      expect(isAllowedOrigin('https://evil.com', { nodeEnv: 'development' })).toBe(false);
    });

    it('development: allows explicitly configured CORS_ORIGIN as well as local origins', () => {
      expect(
        isAllowedOrigin('https://custom-dev.example.com', {
          nodeEnv: 'development',
          corsOrigin: 'https://custom-dev.example.com',
        })
      ).toBe(true);
      expect(
        isAllowedOrigin('http://localhost:5173', {
          nodeEnv: 'development',
          corsOrigin: 'https://custom-dev.example.com',
        })
      ).toBe(true);
      expect(
        isAllowedOrigin('https://evil.com', {
          nodeEnv: 'development',
          corsOrigin: 'https://custom-dev.example.com',
        })
      ).toBe(false);
    });
  });

  describe('3. HTTP Pipeline Integration Tests', () => {
    let prodServer: http.Server;
    let prodBaseUrl: string;

    let failClosedServer: http.Server;
    let failClosedBaseUrl: string;

    let devServer: http.Server;
    let devBaseUrl: string;

    beforeAll(async () => {
      // 1. Production server with explicit CORS_ORIGIN
      const prodApp = express();
      prodApp.use(
        createCorsMiddleware({
          nodeEnv: 'production',
          corsOrigin: 'https://praise-app-m7tn.vercel.app',
        })
      );
      prodApp.get('/api/health', (_req, res) => {
        res.json({ status: 'ok', service: 'praise-backend' });
      });

      await new Promise<void>((resolve) => {
        prodServer = prodApp.listen(0, () => {
          const addr = prodServer.address() as any;
          prodBaseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });

      // 2. Production server with missing/malformed CORS_ORIGIN (Fail-Closed)
      const failClosedApp = express();
      failClosedApp.use(
        createCorsMiddleware({
          nodeEnv: 'production',
          corsOrigin: '   , ,  ',
        })
      );
      failClosedApp.get('/api/health', (_req, res) => {
        res.json({ status: 'ok', service: 'praise-backend' });
      });

      await new Promise<void>((resolve) => {
        failClosedServer = failClosedApp.listen(0, () => {
          const addr = failClosedServer.address() as any;
          failClosedBaseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });

      // 3. Development server
      const devApp = express();
      devApp.use(
        createCorsMiddleware({
          nodeEnv: 'development',
          corsOrigin: undefined,
          webAppUrl: 'http://localhost:5173',
        })
      );
      devApp.get('/api/health', (_req, res) => {
        res.json({ status: 'ok', service: 'praise-backend' });
      });

      await new Promise<void>((resolve) => {
        devServer = devApp.listen(0, () => {
          const addr = devServer.address() as any;
          devBaseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await Promise.all([
        new Promise<void>((resolve) => prodServer?.close(() => resolve())),
        new Promise<void>((resolve) => failClosedServer?.close(() => resolve())),
        new Promise<void>((resolve) => devServer?.close(() => resolve())),
      ]);
    });

    // ─── Production Tests ──────────────────────────────────────────────
    it('production: accepts configured production origin and attaches ACAO and credentials', async () => {
      const res = await fetch(`${prodBaseUrl}/api/health`, {
        headers: {
          Origin: 'https://praise-app-m7tn.vercel.app',
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://praise-app-m7tn.vercel.app'
      );
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('vary')).toContain('Origin');

      const data = (await res.json()) as any;
      expect(data.status).toBe('ok');
    });

    it('production: preflight OPTIONS for allowed origin returns 204 and standard CORS headers', async () => {
      const res = await fetch(`${prodBaseUrl}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://praise-app-m7tn.vercel.app',
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'Content-Type,Authorization',
        },
      });

      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe(
        'https://praise-app-m7tn.vercel.app'
      );
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
      expect(res.headers.get('access-control-allow-methods')).toBe(
        'GET,POST,PUT,PATCH,DELETE,OPTIONS'
      );
      expect(res.headers.get('access-control-allow-headers')).toContain('Content-Type');
    });

    it('production: rejects arbitrary browser origin without ACAO response', async () => {
      const res = await fetch(`${prodBaseUrl}/api/health`, {
        headers: {
          Origin: 'https://evil.com',
        },
      });

      expect(res.status).toBe(200);
      // Critical: NO Access-Control-Allow-Origin header returned
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      // Critical: NO credentials header returned
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('production: rejects arbitrary browser origin preflight OPTIONS without ACAO', async () => {
      const res = await fetch(`${prodBaseUrl}/api/health`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://evil.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      // No ACAO header present
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('production: requests without Origin header (native Android / curl) are accepted with 200 OK and no CORS headers', async () => {
      const res = await fetch(`${prodBaseUrl}/api/health`);

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe('ok');
      expect(data.service).toBe('praise-backend');

      // Native mobile requests do not receive unnecessary CORS headers
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    // ─── Fail-Closed Tests ─────────────────────────────────────────────
    it('production fail-closed: missing/malformed CORS_ORIGIN denies browser cross-origin without ACAO', async () => {
      const res = await fetch(`${failClosedBaseUrl}/api/health`, {
        headers: {
          Origin: 'https://praise-app-m7tn.vercel.app',
        },
      });

      expect(res.status).toBe(200);
      // Because CORS_ORIGIN was malformed, no origin is allowed -> NO ACAO returned!
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });

    it('production fail-closed: requests without Origin continue working even with missing/malformed CORS_ORIGIN', async () => {
      const res = await fetch(`${failClosedBaseUrl}/api/health`);

      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.status).toBe('ok');
    });

    // ─── Development Tests ─────────────────────────────────────────────
    it('development: accepts localhost and 127.0.0.1 development origins', async () => {
      const resLocalhost = await fetch(`${devBaseUrl}/api/health`, {
        headers: {
          Origin: 'http://localhost:5173',
        },
      });

      expect(resLocalhost.status).toBe(200);
      expect(resLocalhost.headers.get('access-control-allow-origin')).toBe(
        'http://localhost:5173'
      );
      expect(resLocalhost.headers.get('access-control-allow-credentials')).toBe('true');

      const resLoopback = await fetch(`${devBaseUrl}/api/health`, {
        headers: {
          Origin: 'http://127.0.0.1:5173',
        },
      });

      expect(resLoopback.status).toBe(200);
      expect(resLoopback.headers.get('access-control-allow-origin')).toBe(
        'http://127.0.0.1:5173'
      );
    });

    it('development: rejects arbitrary unknown origins', async () => {
      const res = await fetch(`${devBaseUrl}/api/health`, {
        headers: {
          Origin: 'https://malicious-external-site.org',
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
      expect(res.headers.get('access-control-allow-credentials')).toBeNull();
    });
  });

  describe('4. Canonical Express App Mounting Verification', () => {
    let mainServer: http.Server;
    let mainBaseUrl: string;

    beforeAll(async () => {
      await new Promise<void>((resolve) => {
        mainServer = app.listen(0, () => {
          const addr = mainServer.address() as any;
          mainBaseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        mainServer?.close(() => resolve());
      });
    });

    it('canonical app responds to no-origin health check with 200 OK', async () => {
      const res = await fetch(`${mainBaseUrl}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.status).toBe('ok');
      expect(body.service).toBe('praise-backend');
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('canonical app responds to diagnostic endpoint with 200 OK without Origin', async () => {
      const res = await fetch(`${mainBaseUrl}/api/diag`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body).toBeDefined();
    });
  });
});
