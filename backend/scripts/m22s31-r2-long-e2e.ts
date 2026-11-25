import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import express from 'express';
import { CODEC_PROFILES } from '../src/features/ministry_audio/audio-codec';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';
import {
  ActivityTracker, apiTimeoutMs, assertLiveIsolation, cleanupJournal, createJournalFile, GuardViolation, lateWriteSweep, ministryIds, quiesceRun,
  updateJournalFile, type Journal,
} from '../src/scripts/m22c5d-r2-mp3-e2e-core';
import {
  LONG_BUDGETS, LONG_CLEANUP_LIMITS, LONG_LIMITS, LongCommandGuard, MemorySampler, MIB, TransferLedger, ledgerSignedRequest, loadLongFixtures, stemSizes,
} from '../src/scripts/m22s31-long-core';
import { EXPECTED_LONG_STEPS, runLongScenario, type LongEnv } from '../src/scripts/m22s31-long-scenarios';

// M22-S3.1 — LONG MP3 v2 homologation (six synthetic stems of about 300 s) against the PRIVATE R2 DEVELOPMENT bucket.
// A separate harness: the limits of m22c5d-r2-mp3-e2e.ts are untouched. su mode only (streamed read, promotion by verified
// upload); there is no rc mode here. NOT executed without explicit authorization.
//   --plan   prints the plan and the ceilings and connects to nothing
//   --run    one recording, six stems, ceilings in src/scripts/m22s31-long-core.ts (they are ceilings, never enlarged by the run)
//
// Needs M22S31_LONG_DIR (manifests.json + <stem>.mp3 made by the real Web encoder from synthetic audio) and, optionally,
// M22S31_KEEP_DIR (a NEW directory where the downloaded synthetic stems are kept for the Web playback check).
// Guards are those of C.5D-C0: isolation environment, exact bucket, exact synthetic keys of this run, five object commands
// only (no listing), plus here: no ranged read, no CopyObject, transfer ledger, and the object/original/command/time ceilings.
// The write-ahead journal is mandatory: the planned keys are recorded before the first upload URL exists, and the cleanup
// removes exactly those keys and proves each absent.

const PLAN = [
  'L0 gate closed by default (no R2 command, no byte)',
  'L1 reserve v2 with six ~300 s manifests of the real Web encoder (LAME3.100); write-ahead journal',
  'L2 six signed PUTs audio/mpeg, streamed validation, promotion by verified upload; seal time and memory per stem; idempotent /complete',
  'L3 finalize x3 concurrent; isolation refused with zero R2 commands; playback by another member; six signed downloads, SHA-256',
  'L4 signed URL past its lifetime refused; renewed URL downloads one stem again',
  'L5 archive: member loses access',
  'L6 ceilings: commands, transferred bytes, objects, no Range, no Copy',
  'S6 journaled exact-key cleanup, each key then proven absent',
];

class Blocked extends Error {}

function printPlan(): void {
  console.log('M22-S3.1 long plan (no connection is made):');
  for (const line of PLAN) console.log(`  - ${line}`);
  console.log(`  ceilings: ${JSON.stringify(LONG_BUDGETS)}`);
  console.log(`  run limits: ${JSON.stringify(LONG_LIMITS)}`);
  console.log(`  cleanup limits: ${JSON.stringify({ maxCommands: LONG_CLEANUP_LIMITS.maxCommands })}; expected steps: ${EXPECTED_LONG_STEPS}`);
}

export function parseArgs(argv: readonly string[]): { plan: true } | { run: true } | undefined {
  if (argv.length === 1 && argv[0] === '--plan') return { plan: true };
  if (argv.length === 1 && argv[0] === '--run') return { run: true };
  return undefined;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) { console.log('Usage: m22s31-r2-long-e2e.ts --plan | --run'); return 2; }
  if ('plan' in args) { printPlan(); return 0; }

  let bucket: string;
  let config: ReturnType<typeof getR2DevelopmentConfig>;
  let fixtures: ReturnType<typeof loadLongFixtures>;
  try {
    config = getR2DevelopmentConfig(process.env);
    bucket = config.bucket;
    assertLiveIsolation(process.env, bucket);
    if (!process.env.M22S31_LONG_DIR) throw new GuardViolation('Fixture directory required.');
    fixtures = loadLongFixtures(process.env.M22S31_LONG_DIR);
  } catch {
    throw new Blocked('BLOCKED — the isolation guard, the development bucket configuration or the fixture ceilings were not satisfied. Nothing was contacted.');
  }
  const keepDir = process.env.M22S31_KEEP_DIR;
  if (keepDir) {
    try { mkdirSync(keepDir, { recursive: false }); } catch { throw new Blocked('BLOCKED — M22S31_KEEP_DIR must be a new directory. Nothing was contacted.'); }
  }

  const journalPath = process.env.M22C5D_JOURNAL ?? join(tmpdir(), `m22c5d-r2-${randomUUID()}.journal.json`);
  const run = randomUUID();
  const journal: Journal = { format: 'louvaio.m22c5d-r2-journal', version: 1, runId: run, bucket, entries: [] };
  try {
    await createJournalFile(journalPath, journal); // exclusive: a previous run's journal is never touched
  } catch {
    throw new Blocked('BLOCKED — the journal could not be created exclusively as a new *.journal.json file. Nothing was contacted.');
  }

  const { db } = await import('../src/lib/firebase');
  const { UserRepository } = await import('../src/repositories/UserRepository');
  const { errorHandler } = await import('../src/middleware/error-handler');
  const { createMinistryAudioRouter } = await import('../src/features/ministry_audio/ministry-audio.routes');
  const { R2StemStorage, createR2Client } = await import('../src/features/ministry_audio/r2-storage');
  const users = new UserRepository();

  const ids = ministryIds(run);
  const ministries = { a: ids.su, b: ids.sux };
  console.log(`RUN ${run}  long su  bucket-class=development  journal=${journalPath}  fixtures=${fixtures.map((f) => f.bytes.length).join('+')} bytes`);

  const profile = CODEC_PROFILES.mp3_cbr256 as { serverByteValidation: boolean };
  const original = S3Client.prototype.send;
  const deadline = Date.now() + LONG_LIMITS.maxRunMs;
  let failures = 0;
  let cleanupFailures = 0;

  const ledger = new TransferLedger();
  const sampler = new MemorySampler();
  const guard = new LongCommandGuard(bucket, [ministries.a, ministries.b], ledger, stemSizes(fixtures));
  (S3Client.prototype as { send: unknown }).send = guard.wrap(original as never);
  const app = express();
  const requests = new ActivityTracker();
  const signed = new ActivityTracker();
  const server: Server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    app.use(requests.middleware());
    app.use(express.json());
    app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({
      storage: {
        put: async () => { throw new Error('proxy write is not used'); }, verify: async () => { throw new Error('proxy verify is not used'); },
        open: async () => { throw new Error('proxy read is not used'); }, remove: async () => { throw new Error('proxy delete is not used'); },
      },
      directStorage: new R2StemStorage({ ...config, promotion: 'upload', reader: 'stream' }),
    }));
    app.use(errorHandler);

    const adminA = `m22s31-admin-${randomUUID()}`, memberA = `m22s31-member-${randomUUID()}`, adminB = `m22s31-admin-${randomUUID()}`;
    const tokens = {
      adminA: users.generateAuthToken(adminA, 'a@example.test'),
      memberA: users.generateAuthToken(memberA, 'm@example.test'),
      adminB: users.generateAuthToken(adminB, 'b@example.test'),
    };
    const batch = db.batch();
    batch.set(db.collection('ministries').doc(ministries.a), { name: 'S31 A', owner_user_id: adminA });
    batch.set(db.collection('ministries').doc(ministries.b), { name: 'S31 B', owner_user_id: adminB });
    batch.set(db.collection('ministry_members').doc(`${ministries.a}_${memberA}`), { ministry_id: ministries.a, user_id: memberA, role: 'member', status: 'active' });
    await batch.commit();

    const target = { accountId: config.accountId, bucket, ministries: [ministries.a, ministries.b] };
    const env: LongEnv = {
      ministries, tokens, guard, ledger, sampler, journal, fixtures,
      idempotencyKey: () => randomUUID(),
      setCodec: (open) => { profile.serverByteValidation = open; },
      persistJournal: () => updateJournalFile(journalPath, journal),
      now: Date.now,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      api: async (tenant, path, method, token, body) => fetch(`${origin}/api/v1/ministries/${tenant}/audio-library${path}`, {
        method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(apiTimeoutMs(Date.now(), deadline, LONG_LIMITS)),
      }),
      put: (grant, bytes) => signed.track(async () => (await ledgerSignedRequest(grant, 'PUT', bytes, target, ledger, 0)).status),
      get: (grant, expectedBytes) => signed.track(() => ledgerSignedRequest(grant, 'GET', undefined, target, ledger, expectedBytes)),
      doc: async (tenant, id) => (await db.collection('ministries').doc(tenant).collection('audio_recordings').doc(id).get()).data(),
      keep: keepDir ? (stem, bytes) => writeFileSync(join(keepDir, `${stem}.mp3`), bytes, { flag: 'wx' }) : undefined,
    };

    console.log('--- long su (stream + upload)');
    try {
      const { report, measurements } = await runLongScenario(env);
      for (const step of report.steps) console.log(`${step.pass ? 'PASS' : 'FAIL'}  ${step.scenario}: ${step.step}`);
      const complete = report.steps.length === EXPECTED_LONG_STEPS;
      if (!report.ok) console.log('ABORTED  the first failed check stopped every later operation');
      else if (!complete) console.log(`FAIL  expected ${EXPECTED_LONG_STEPS} steps, got ${report.steps.length}`);
      failures += report.failed.length + (report.failed.length === 0 && !complete ? 1 : 0);
      console.log(`MEASURED ${JSON.stringify({ putMs: measurements.putMs, sealMs: measurements.sealMs, downloadMs: measurements.downloadMs, expiredStatus: measurements.expiredStatus, archivedPlaybackStatus: measurements.archivedPlaybackStatus })}`);
    } catch (error) {
      failures += 1;
      console.log(`FAIL  run aborted (${error instanceof GuardViolation ? error.message : 'unexpected error'})`);
    } finally {
      profile.serverByteValidation = false;
      sampler.stop();
      console.log(`R2 commands: ${JSON.stringify(guard.counters)}`);
      console.log(`TRANSFER ${JSON.stringify({ totalBytes: ledger.total, totalMiB: Math.round((ledger.total / MIB) * 10) / 10, capMiB: LONG_BUDGETS.transferBytes / MIB, byKind: ledger.byKind })}`);
      console.log(`MEMORY ${JSON.stringify(sampler.summary())}`);
      server.close();
      const quiet = await quiesceRun(guard, [requests, signed]);
      server.closeAllConnections();
      if (!quiet.quiescent) {
        cleanupFailures += 1;
        console.log(`FAIL  NOT QUIESCENT: ${quiet.pendingCommands} R2 command(s) and ${quiet.pendingWork} request(s) still pending after ${LONG_LIMITS.quiesceMs} ms. Cleanup was NOT started and nothing new was begun.`);
        console.log(`Journal preserved. Wait several minutes, then run: M22C5D_JOURNAL=${journalPath} npx --no-install tsx scripts/m22c5d-r2-mp3-cleanup.ts`);
      } else {
        try {
          const client = createR2Client(config);
          const cleanupGuard = new LongCommandGuard(bucket, [ministries.a, ministries.b], new TransferLedger(), stemSizes(fixtures), Date.now, LONG_CLEANUP_LIMITS);
          guard.authorizeCleanup(client, cleanupGuard);
          const exists = async (key: string) => {
            try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; }
            catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; }
          };
          const outcome = await cleanupJournal(journal, async (key) => { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); }, exists);
          let late = 0;
          try { late = outcome.failed === 0 ? await lateWriteSweep(journal, exists) : 0; } catch { late = -1; }
          const clean = outcome.stillPresent === 0 && outcome.failed === 0 && outcome.removed === outcome.attempted && late === 0;
          if (late !== 0) console.log('A late write (or an unverifiable sweep) needs a second cleanup: wait a few minutes, then run the standalone cleanup with the same journal.');
          console.log(`CLEANUP commands: ${JSON.stringify(cleanupGuard.counters)}`);
          console.log(`${clean ? 'PASS' : 'FAIL'}  S6 cleanup: ${outcome.removed}/${outcome.attempted} keys absent, ${outcome.stillPresent} still present, ${outcome.failed} errors, ${late} late writes`);
          if (!clean) cleanupFailures += 1;
        } catch {
          cleanupFailures += 1;
          console.log('FAIL  S6 cleanup could not run');
        }
      }
    }
  } finally {
    guard.freeze();
    server.close();
    server.closeAllConnections();
  }

  const ok = failures === 0 && cleanupFailures === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  M22-S3.1 long su (${failures} failing steps, ${cleanupFailures} cleanup problems)`);
  if (cleanupFailures) console.log(`Re-run cleanup with: M22C5D_JOURNAL=${journalPath} npx --no-install tsx scripts/m22c5d-r2-mp3-cleanup.ts`);
  return ok ? 0 : 1;
}

if (require.main === module) {
  void main().then((code) => { process.exitCode = code; }, (error: unknown) => {
    console.error(error instanceof Blocked ? error.message : 'FAIL — M22-S3.1 did not complete. No signed URLs or secrets are printed.');
    process.exitCode = error instanceof Blocked ? 2 : 1;
  });
}
