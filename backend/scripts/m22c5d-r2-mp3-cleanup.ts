import { readFileSync } from 'node:fs';
import { DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';
import { assertLiveIsolation, cleanupJournal, CommandGuard, GuardViolation, parseJournal } from '../src/scripts/m22c5d-r2-mp3-e2e-core';

// M22-C.5D-C0 — removes ONLY the keys listed in a run journal (recomputed, never trusted from the file), then proves each
// is absent. No listing, no wildcards, nothing outside m22c5d-r2-<uuid>-(su|rc)[x] ministries. NOT executed without authorization.
//   M22C5D_JOURNAL=<journal.json> ... npx --no-install tsx scripts/m22c5d-r2-mp3-cleanup.ts

async function main(): Promise<number> {
  const path = process.env.M22C5D_JOURNAL;
  let config: ReturnType<typeof getR2DevelopmentConfig>;
  try {
    config = getR2DevelopmentConfig(process.env);
    assertLiveIsolation(process.env, config.bucket);
    if (!path) throw new GuardViolation('Journal required.');
  } catch {
    console.log('BLOCKED — the isolation guard, the bucket configuration or the journal path was not satisfied. Nothing was contacted.');
    return 2;
  }
  let journal;
  try {
    journal = parseJournal(readFileSync(path, 'utf8'), config.bucket);
  } catch {
    console.log('REFUSED — the journal is unreadable, belongs to another bucket or lists keys that are not planned keys.');
    return 2;
  }
  const guard = new CommandGuard(config.bucket, [...new Set(journal.entries.map((e) => e.ministryId))]);
  const original = S3Client.prototype.send;
  (S3Client.prototype as { send: unknown }).send = guard.wrap(original as never);
  const { createR2Client } = await import('../src/features/ministry_audio/r2-storage');
  const client = createR2Client(config);
  const outcome = await cleanupJournal(journal,
    async (key) => { await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key })); },
    async (key) => {
      try { await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key })); return true; }
      catch (error) { if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false; throw error; }
    });
  const clean = outcome.stillPresent === 0 && outcome.failed === 0;
  console.log(`${clean ? 'PASS' : 'FAIL'}  cleanup: ${outcome.removed}/${outcome.attempted} journaled keys absent, ${outcome.stillPresent} still present, ${outcome.failed} errors`);
  return clean ? 0 : 1;
}

void main().then((code) => { process.exitCode = code; }, () => {
  console.error('FAIL — cleanup. Check configuration without sharing signed URLs.');
  process.exitCode = 1;
});
