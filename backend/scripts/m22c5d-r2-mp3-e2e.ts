import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import express from 'express';
import { CODEC_PROFILES } from '../src/features/ministry_audio/audio-codec';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';
import type { Mp3StemManifest } from '../src/features/ministry_audio/mp3-stream-validator';
import {
  assertLiveIsolation, assertSignedTarget, cleanupJournal, CommandGuard, EXPECTED_STEPS, GuardViolation, LIMITS, MODES, ministryIds, RANGE_PART_BYTES, type Journal, type ModeTag,
} from '../src/scripts/m22c5d-r2-mp3-e2e-core';
import { runMp3Scenarios, type ScenarioEnv } from '../src/scripts/m22c5d-r2-mp3-e2e-scenarios';

// M22-C.5D-C0 — MP3 v2 homologation against the PRIVATE R2 DEVELOPMENT bucket. NOT executed without explicit authorization.
//
// What runs: the real service, the real R2 adapter in both configurations (stream+upload, ranged+copy), the Firebase
// EMULATORS and the real bucket. What is guarded in code (src/scripts/m22c5d-r2-mp3-e2e-core.ts): the isolation
// environment, the exact bucket, the exact synthetic keys of this run, the five object commands only (no listing), size,
// object, command and time budgets. This script lives in scripts/, outside the publish build, and opens the MP3 profile
// only in this process's memory after the guard passed.
//
//   --plan   prints the plan, limits and the keys class; connects to nothing; needs no environment.

const PLAN = [
  'S0 gate closed by default (no R2 command)',
  'S1 reserve v2, signed PUT audio/mpeg, streaming validation, promotion, receipts+facts, finalize x3 concurrent, reads, idempotent /complete',
  'S4 isolation: other ministry and plain member refused without any R2 command',
  'S2 (ranged+copy only) injected CopyObject failure after full verification, resume without reading staging',
  'S3 malformed MP3 with matching SHA-256 rejected (422), nothing promoted, finalize refused',
  'S6 journaled exact-key cleanup, each key then proven absent',
];

function printPlan(): void {
  console.log('M22-C.5D-C0 plan (no connection is made):');
  for (const line of PLAN) console.log(`  - ${line}`);
  console.log(`  modes: ${Object.entries(MODES).map(([tag, m]) => `${tag}=${m.read}+${m.promotion}`).join(', ')}; range part ${RANGE_PART_BYTES} B`);
  console.log(`  limits: ${JSON.stringify(LIMITS)}`);
}

class Blocked extends Error {}

async function main(): Promise<number> {
  if (process.argv.includes('--plan')) {
    printPlan();
    return 0;
  }
  let bucket: string;
  let config: ReturnType<typeof getR2DevelopmentConfig>;
  try {
    config = getR2DevelopmentConfig(process.env);
    bucket = config.bucket;
    assertLiveIsolation(process.env, bucket);
  } catch {
    throw new Blocked('BLOCKED — the isolation guard or the development bucket configuration was not satisfied. Nothing was contacted.');
  }

  // Loaded only after the guard: these read the emulator and project variables at import time.
  const { db } = await import('../src/lib/firebase');
  const { UserRepository } = await import('../src/repositories/UserRepository');
  const { errorHandler } = await import('../src/middleware/error-handler');
  const { createMinistryAudioRouter } = await import('../src/features/ministry_audio/ministry-audio.routes');
  const { R2StemStorage, createR2Client } = await import('../src/features/ministry_audio/r2-storage');
  const users = new UserRepository();

  const cases = JSON.parse(readFileSync(join(__dirname, '../../shared/fixtures/ministry-audio-mp3-v1/real-encoder-cases.json'), 'utf8')) as {
    cases: Array<{ name: string; manifest: Mp3StemManifest; base64: string }>;
  };
  const valid = cases.cases.find((c) => c.name === 'valid-44100-12000')!;
  const fixture = { bytes: Buffer.from(valid.base64, 'base64'), manifest: valid.manifest };

  const run = randomUUID();
  const ids = ministryIds(run);
  const journalPath = process.env.M22C5D_JOURNAL ?? join(tmpdir(), `m22c5d-r2-${run}.journal.json`);
  // A journal is never overwritten from a previous run, and only a dedicated file name is accepted.
  if (!journalPath.endsWith('.journal.json') || existsSync(journalPath)) throw new Blocked('BLOCKED — the journal path must be a new *.journal.json file. Nothing was contacted.');
  const journal: Journal = { format: 'louvaio.m22c5d-r2-journal', version: 1, runId: run, bucket, entries: [] };
  const persist = () => writeFileSync(journalPath, JSON.stringify(journal, null, 2), { mode: 0o600 });
  persist();
  console.log(`RUN ${run}  bucket-class=development  journal=${journalPath}`);

  const profile = CODEC_PROFILES.mp3_cbr256 as { serverByteValidation: boolean };
  const original = S3Client.prototype.send;
  const deadline = Date.now() + LIMITS.maxRunMs;
  let failures = 0;
  let cleanupFailures = 0;

  for (const mode of Object.keys(MODES) as ModeTag[]) {
    const ministries = { a: ids[mode], b: ids[`${mode}x` as 'sux' | 'rcx'] };
    const guard = new CommandGuard(bucket, [ministries.a, ministries.b]);
    (S3Client.prototype as { send: unknown }).send = guard.wrap(original as never);
    const app = express();
    const server: Server = app.listen(0, '127.0.0.1');
    try {
      await once(server, 'listening');
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      app.use(express.json());
      app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({
        storage: {
          put: async () => { throw new Error('proxy write is not used'); }, verify: async () => { throw new Error('proxy verify is not used'); },
          open: async () => { throw new Error('proxy read is not used'); }, remove: async () => { throw new Error('proxy delete is not used'); },
        },
        directStorage: new R2StemStorage({ ...config, promotion: MODES[mode].promotion, reader: MODES[mode].read, rangePartBytes: RANGE_PART_BYTES, rangeConcurrency: 3 }),
      }));
      app.use(errorHandler);

      const adminA = `m22c5d-admin-${randomUUID()}`, memberA = `m22c5d-member-${randomUUID()}`, adminB = `m22c5d-admin-${randomUUID()}`;
      const tokens = {
        adminA: users.generateAuthToken(adminA, 'a@example.test'),
        memberA: users.generateAuthToken(memberA, 'm@example.test'),
        adminB: users.generateAuthToken(adminB, 'b@example.test'),
      };
      const batch = db.batch();
      batch.set(db.collection('ministries').doc(ministries.a), { name: 'C0 A', owner_user_id: adminA });
      batch.set(db.collection('ministries').doc(ministries.b), { name: 'C0 B', owner_user_id: adminB });
      batch.set(db.collection('ministry_members').doc(`${ministries.a}_${memberA}`), { ministry_id: ministries.a, user_id: memberA, role: 'member', status: 'active' });
      await batch.commit();

      const request = (url: string, init: RequestInit) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20_000) });
      const scenarioEnv: ScenarioEnv = {
        mode, ministries, tokens, guard, journal, fixture,
        idempotencyKey: () => randomUUID(),
        setCodec: (open) => { profile.serverByteValidation = open; },
        api: (tenant, path, method, token, body) => {
          // Write-ahead: the journal on disk always lists a recording's planned keys before its first upload URL.
          if (path.endsWith('/upload-url')) persist();
          if (Date.now() > deadline) throw new GuardViolation('Time budget exceeded.');
          return request(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/ministries/${tenant}/audio-library${path}`, {
            method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
            body: body === undefined ? undefined : JSON.stringify(body),
          });
        },
        put: async (grant, bytes) => (assertSignedTarget(grant.url, config.accountId, bucket, Object.values(ministries)), await request(grant.url, { method: 'PUT', headers: grant.headers, body: new Uint8Array(bytes) })).status,
        get: async (grant) => {
          assertSignedTarget(grant.url, config.accountId, bucket, Object.values(ministries));
          const response = await request(grant.url, { method: 'GET', headers: grant.headers });
          return { status: response.status, contentType: response.headers.get('content-type'), bytes: Buffer.from(await response.arrayBuffer()) };
        },
        doc: async (tenant, id) => (await db.collection('ministries').doc(tenant).collection('audio_recordings').doc(id).get()).data(),
      };
      void origin;

      console.log(`--- mode ${mode} (${MODES[mode].read} + ${MODES[mode].promotion})`);
      try {
        const report = await runMp3Scenarios(scenarioEnv);
        for (const step of report.steps) console.log(`${step.pass ? 'PASS' : 'FAIL'}  ${step.scenario}: ${step.step}`);
        const complete = report.steps.length === EXPECTED_STEPS[mode];
        if (!complete) console.log(`FAIL  expected ${EXPECTED_STEPS[mode]} steps, got ${report.steps.length}`);
        failures += report.failed.length + (complete ? 0 : 1);
      } catch (error) {
        failures += 1;
        console.log(`FAIL  run aborted (${error instanceof GuardViolation ? error.message : 'unexpected error'})`);
      } finally {
        profile.serverByteValidation = false;
        persist();
        console.log(`R2 commands: ${JSON.stringify(guard.counters)}`);
        // S6 — cleanup runs on success and on failure, over this mode's journaled keys only.
        // A fresh guard: an exhausted run budget (time or commands) must never block the cleanup of the run's own keys.
        (S3Client.prototype as { send: unknown }).send = new CommandGuard(bucket, [ministries.a, ministries.b]).wrap(original as never);
        const modeJournal: Journal = { ...journal, entries: journal.entries.filter((e) => e.ministryId === ministries.a) };
        const client = createR2Client(config);
        const outcome = await cleanupJournal(modeJournal,
          async (key) => { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); },
          async (key) => {
            try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; }
            catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; }
          });
        const clean = outcome.stillPresent === 0 && outcome.failed === 0 && outcome.removed === outcome.attempted;
        console.log(`${clean ? 'PASS' : 'FAIL'}  S6 cleanup: ${outcome.removed}/${outcome.attempted} keys absent, ${outcome.stillPresent} still present, ${outcome.failed} errors`);
        if (!clean) cleanupFailures += 1;
      }
    } finally {
      (S3Client.prototype as { send: unknown }).send = original;
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    }
  }

  console.log(`${failures === 0 && cleanupFailures === 0 ? 'PASS' : 'FAIL'}  M22-C.5D-C0 (${failures} failing steps, ${cleanupFailures} cleanup problems)`);
  if (cleanupFailures) console.log(`Re-run cleanup with: M22C5D_JOURNAL=${journalPath} npx --no-install tsx scripts/m22c5d-r2-mp3-cleanup.ts`);
  return failures === 0 && cleanupFailures === 0 ? 0 : 1;
}

void main().then((code) => { process.exitCode = code; }, (error: unknown) => {
  console.error(error instanceof Blocked ? error.message : 'FAIL — M22-C.5D-C0 did not complete. No signed URLs or secrets are printed.');
  process.exitCode = error instanceof Blocked ? 2 : 1;
});
