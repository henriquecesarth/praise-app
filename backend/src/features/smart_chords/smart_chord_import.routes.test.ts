import express from 'express';
import { createServer, Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.headers.authorization !== 'Bearer integration-test') {
      return next(Object.assign(new Error('Unauthorized'), { statusCode: 401 }));
    }
    (req as express.Request & { user?: { id: string } }).user = { id: 'import-test-user' };
    next();
  },
}));

import smartChordRouter from './smart_chord.routes';
import * as smartChordService from './smart_chord.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const servers: Server[] = [];

async function startTestServer(): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/smart-chords', smartChordRouter);
  app.use((error: { statusCode?: number; message?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(error.statusCode ?? 500).json({ error: { message: error.message } });
  });

  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind to a TCP port.');
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  vi.restoreAllMocks();
});

describe('Smart Chords import routes', () => {
  it('requires authentication for URL and image import routes', async () => {
    const baseUrl = await startTestServer();

    for (const [path, headers, body] of [
      ['/smart-chords/import/url', { 'content-type': 'application/json' }, JSON.stringify({ url: 'https://cifraclub.com.br/a/b' })],
      ['/smart-chords/import/image', { 'content-type': 'image/png' }, new Uint8Array(PNG)],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, { method: 'POST', headers, body });
      expect(response.status).toBe(401);
    }
  });

  it('returns metadata-only URL and image drafts without persisting a Smart Chord', async () => {
    const baseUrl = await startTestServer();
    const createSpy = vi.spyOn(smartChordService, 'createSmartChord');

    const urlResponse = await fetch(`${baseUrl}/smart-chords/import/url`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer integration-test',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://www.cifraclub.com.br/morada/pra-onde-eu-irei/' }),
    });
    expect(urlResponse.status).toBe(200);
    expect(await urlResponse.json()).toMatchObject({
      title: 'Pra Onde Eu Irei',
      artist_name: 'Morada',
      content: '',
      source_type: 'url',
      requires_manual_paste: true,
      source_url: 'https://www.cifraclub.com.br/morada/pra-onde-eu-irei/',
    });

    const imageResponse = await fetch(`${baseUrl}/smart-chords/import/image`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer integration-test',
        'content-type': 'image/png',
        'x-file-name': 'sheet.png',
      },
      body: new Uint8Array(PNG),
    });
    expect(imageResponse.status).toBe(200);
    expect(await imageResponse.json()).toMatchObject({
      title: 'Imagem cifra',
      content: '',
      source_type: 'image',
      requires_manual_paste: true,
    });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('maps oversized raw image bodies to HTTP 400', async () => {
    const baseUrl = await startTestServer();
    const response = await fetch(`${baseUrl}/smart-chords/import/image`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer integration-test',
        'content-type': 'image/png',
      },
      body: new Uint8Array(5 * 1024 * 1024 + 1),
    });

    expect(response.status).toBe(400);
  }, 20_000);
});
