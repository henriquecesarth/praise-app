import { createServer } from 'node:http';
import express from 'express';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertStagingKey } from '../src/features/ministry_audio/direct-storage';
import { STEM_IDS } from '../src/features/ministry_audio/ministry-audio.schema';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';
import { createR2Client } from '../src/features/ministry_audio/r2-storage';

// Development-only API server for the M22-C.4 browser/API E2E (started by web/playwright.m22c-r2.config.ts).
// It runs the real application against the Firebase EMULATORS and the PRIVATE DEVELOPMENT R2 bucket, and adds a
// loopback control surface under /__m22c used only by that spec:
//   GET  /__m22c/modes           effective read and promotion modes of the running adapter
//   GET  /__m22c/counters        counts of R2 commands issued by the server (never keys, URLs or content)
//   POST /__m22c/fault           {copy: n} makes the next n CopyObject calls fail before reaching R2
//   POST /__m22c/delete-staging  removes one synthetic staging object of an m22c-r2-<uuid> ministry
// None of this ships: scripts/ is outside the publish build and the server refuses to start outside the isolation guard.

const PORT = 4315;
const LOOPBACK = /^127\.0\.0\.1:\d{2,5}$/;

interface Counter {
  head: number;
  get: number;
  rangedGet: number;
  put: number;
}
const counters = {
  staging: { head: 0, get: 0, rangedGet: 0, put: 0 } satisfies Counter,
  final: { head: 0, get: 0, rangedGet: 0, put: 0 } satisfies Counter,
  copy: { sent: 0, blocked: 0 },
};
const pending = { copy: 0 };

interface CommandLike {
  constructor: { name: string };
  input?: { Key?: string; Range?: string };
}
type Send = (this: S3Client, command: CommandLike, ...rest: unknown[]) => Promise<unknown>;

function assertIsolation(): void {
  const env = process.env;
  if (env.NODE_ENV !== 'test' || env.M22C_R2_LIVE_TESTS !== '1' || env.VERCEL || env.VERCEL_ENV ||
      !/^demo-/.test(env.FIREBASE_PROJECT_ID ?? '') ||
      !LOOPBACK.test(env.FIRESTORE_EMULATOR_HOST ?? '') || !LOOPBACK.test(env.FIREBASE_AUTH_EMULATOR_HOST ?? '') ||
      env.MINISTRY_AUDIO_R2_DEV !== '1' || env.MINISTRY_AUDIO_DIRECT_SIMULATOR === '1') {
    throw new Error('Isolation guard failed.');
  }
}

// Sanitized, bounded diagnostics: command, key class, duration and the provider error NAME, HTTP status and transport
// code. Never keys, URLs, headers, messages or content, so the trace is safe to paste.
interface TraceEntry {
  n: number;
  at: number;
  command: string;
  place: 'staging' | 'final' | 'other';
  ms: number;
  outcome: 'ok' | 'injected' | 'error';
  status?: number;
  name?: string;
  code?: string;
}
const trace: TraceEntry[] = [];
const startedAt = Date.now();
let sequence = 0;

function record(command: string, key: string, began: number, error?: unknown, injected = false): void {
  const place = key.startsWith('staging/') ? 'staging' : key.startsWith('objects/') ? 'final' : 'other';
  const entry: TraceEntry = {
    n: ++sequence, at: began - startedAt, command: command.replace(/Command$/, ''), place, ms: Date.now() - began,
    outcome: injected ? 'injected' : error === undefined ? 'ok' : 'error',
  };
  if (error !== undefined && !injected) {
    const e = error as { name?: unknown; code?: unknown; cause?: { code?: unknown }; $metadata?: { httpStatusCode?: unknown } };
    if (typeof e.$metadata?.httpStatusCode === 'number') entry.status = e.$metadata.httpStatusCode;
    if (typeof e.name === 'string') entry.name = e.name.slice(0, 60);
    const code = typeof e.code === 'string' ? e.code : typeof e.cause?.code === 'string' ? e.cause.code : undefined;
    if (code) entry.code = code.slice(0, 60);
    // A 404 or a precondition answer is part of the normal flow (absent final object); everything else is reported.
    if (entry.status !== 404 && entry.status !== 412) console.error(`R2_FAIL #${entry.n} ${entry.command} ${entry.place} after ${entry.ms} ms status=${entry.status ?? '-'} name=${entry.name ?? '-'} code=${entry.code ?? '-'}`);
  }
  trace.push(entry);
  if (trace.length > 60) trace.shift();
}

function instrumentR2(): void {
  const original = S3Client.prototype.send as unknown as Send;
  (S3Client.prototype as unknown as { send: Send }).send = function send(this: S3Client, command, ...rest) {
    const name = command?.constructor?.name;
    const key = command?.input?.Key ?? '';
    const began = Date.now();
    if (name === 'CopyObjectCommand') {
      if (pending.copy > 0) {
        pending.copy -= 1;
        counters.copy.blocked += 1;
        record(name, key, began, new Error('Injected'), true);
        return Promise.reject(new Error('Injected copy failure.'));
      }
      counters.copy.sent += 1;
    } else {
      const place = key.startsWith('staging/') ? counters.staging : key.startsWith('objects/') ? counters.final : undefined;
      if (place) {
        if (name === 'HeadObjectCommand') place.head += 1;
        else if (name === 'GetObjectCommand') place[command.input?.Range ? 'rangedGet' : 'get'] += 1;
        else if (name === 'PutObjectCommand') place.put += 1;
      }
    }
    return original.call(this, command, ...rest).then(
      (result) => {
        record(name, key, began);
        return result;
      },
      (error: unknown) => {
        record(name, key, began, error ?? new Error('Unknown'));
        throw error;
      },
    );
  };
}

async function main() {
  assertIsolation();
  const config = getR2DevelopmentConfig(process.env);
  if (config.reader !== process.env.M22C_EXPECT_READ || config.promotion !== process.env.M22C_EXPECT_PROMOTION) {
    throw new Error('The effective R2 modes differ from the modes this run expects.');
  }
  instrumentR2();

  const control = express.Router();
  control.use(express.json({ limit: '4kb' }));
  control.get('/modes', (_req, res) => {
    res.json({ read: config.reader, promotion: config.promotion });
  });
  control.get('/counters', (_req, res) => {
    res.json(counters);
  });
  control.get('/trace', (_req, res) => {
    res.json({ faultPending: pending.copy, entries: trace.slice(-30) });
  });
  control.post('/fault', (req, res) => {
    const copy = (req.body as { copy?: unknown })?.copy;
    if (!Number.isInteger(copy) || (copy as number) < 0 || (copy as number) > 3) {
      res.status(400).json({ error: { message: 'Invalid fault.' } });
      return;
    }
    pending.copy = copy as number;
    res.status(204).end();
  });
  control.post('/delete-staging', async (req, res) => {
    const { ministryId, recordingId, stemId, attempt } = (req.body ?? {}) as Record<string, unknown>;
    const stem = STEM_IDS.find((id) => id === stemId);
    if (typeof ministryId !== 'string' || !/^m22c-r2-[a-f0-9-]{36}$/.test(ministryId) ||
        typeof recordingId !== 'string' || !/^[a-f0-9]{64}$/.test(recordingId) ||
        !stem || !Number.isInteger(attempt) || (attempt as number) < 1 || (attempt as number) > 3) {
      res.status(400).json({ error: { message: 'Only a synthetic staging object can be removed here.' } });
      return;
    }
    const key = `staging/ministry-audio/${ministryId}/${recordingId}/${stem}/${attempt}.wav`;
    assertStagingKey(key, stem);
    try {
      await createR2Client(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      res.status(204).end();
    } catch {
      res.status(503).json({ error: { message: 'Staging removal failed.' } });
    }
  });

  const { default: app } = await import('../src/app');
  // The application loads dotenv on import; check again so a local .env cannot weaken the guard.
  assertIsolation();
  const controlApp = express();
  controlApp.use('/__m22c', control);
  // The application is served exactly as app.listen would serve it; only the control prefix is diverted.
  createServer((req, res) => {
    if (req.url?.startsWith('/__m22c/')) {
      if (req.headers.host !== `127.0.0.1:${PORT}`) {
        res.statusCode = 403;
        res.end();
        return;
      }
      controlApp(req, res);
    }
    else app(req, res);
  }).listen(PORT, '127.0.0.1');
}

void main().catch(() => {
  console.error('FAIL — M22-C.4 E2E server did not start. Check the isolation guard and the expected modes.');
  process.exit(1);
});
