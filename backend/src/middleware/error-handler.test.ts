import http from 'http';
import type { AddressInfo } from 'net';
import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorHandler } from './error-handler';

async function withServer(
  app: express.Express,
  fn: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('errorHandler middleware (M07)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function buildApp(withThrowRoute = false) {
    const app = express();
    app.use(express.json({ limit: '128b' }));

    app.post('/echo', (req, res) => {
      res.status(200).json({ ok: true, keys: Object.keys(req.body || {}) });
    });

    if (withThrowRoute) {
      app.get('/boom-secret', (_req, _res, next) => {
        const err = new Error('Sensitive unexpected failure') as Error & { body?: string; code?: string };
        err.body = '{"secret":"do-not-log-this-password"}';
        err.code = 'E_TEST';
        next(err);
      });

      app.get('/app-error', (_req, _res, next) => {
        next(new AppError(422, 'Erro de validação controlado.', [{ field: 'title' }]));
      });
    }

    app.use(errorHandler);
    return app;
  }

  it('returns 400 (not 500) on malformed JSON and never logs err.body / raw request payload', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = buildApp();
    const secretMarker = 'SUPER_SECRET_PASSWORD_M07_MALFORMED';

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: `{"password":"${secretMarker}"`,
      });
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body).toEqual({
        error: {
          message: 'JSON inválido no corpo da requisição.',
        },
      });
    });

    const loggedText = JSON.stringify(consoleSpy.mock.calls);
    expect(loggedText).not.toContain(secretMarker);
    expect(loggedText).not.toContain('Unhandled error:');
  });

  it('returns 413 on oversized JSON payloads and never logs raw body', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = buildApp();
    const secretMarker = 'OVERSIZED_TOKEN_M07_SECRET';

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/echo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: secretMarker.repeat(20) }),
      });
      const body = await res.json();

      expect(res.status).toBe(413);
      expect(body).toEqual({
        error: {
          message: 'Corpo da requisição excede o limite permitido.',
        },
      });
    });

    const loggedText = JSON.stringify(consoleSpy.mock.calls);
    expect(loggedText).not.toContain(secretMarker);
  });

  it('returns 500 on unhandled errors while sanitizing err.body out of console logs', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = buildApp(true);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/boom-secret`);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body).toEqual({
        error: {
          message: 'Erro interno do servidor.',
        },
      });
    });

    const loggedText = JSON.stringify(consoleSpy.mock.calls);
    expect(loggedText).not.toContain('do-not-log-this-password');
    expect(loggedText).toContain('E_TEST');
  });

  it('preserves AppError statusCode, message, and details contract', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = buildApp(true);

    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/app-error`);
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body).toEqual({
        error: {
          message: 'Erro de validação controlado.',
          details: [{ field: 'title' }],
        },
      });
    });
  });
});
