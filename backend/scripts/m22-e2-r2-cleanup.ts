import { readFileSync } from 'node:fs';
import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { STEM_IDS } from '../src/features/ministry_audio/ministry-audio.schema';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';

// M22-D-E2: removes ONLY the synthetic objects listed in the inventory written by m22-e2-r2-server.ts, then verifies
// (HeadObject) that every one of those keys is gone. No listing, no wildcards, never empties the bucket.
// Usage (from backend/): $env:M22C_R2_LIVE_TESTS='1'; $env:E2R2_INVENTORY='<path>'
//   npx --no-install tsx scripts/m22-e2-r2-cleanup.ts

const MINISTRY = /^m22e2r2-[a-f0-9-]{36}-s[1-8]-[ab]$/;
const RECORDING = /^[a-f0-9]{64}$/;

async function run() {
  const file = process.env.E2R2_INVENTORY;
  if (process.env.M22C_R2_LIVE_TESTS !== '1' || process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production' || !file) {
    console.log('BLOCKED — cleanup needs M22C_R2_LIVE_TESTS=1, E2R2_INVENTORY and the development bucket configuration.');
    process.exitCode = 2;
    return;
  }
  const inventory = JSON.parse(readFileSync(file, 'utf8')) as { runId?: string; entries?: { ministryId: string; recordingId: string }[] };
  const entries = inventory.entries ?? [];
  if (entries.length === 0 || !inventory.runId || !entries.every((e) => MINISTRY.test(e.ministryId) &&
      RECORDING.test(e.recordingId) && e.ministryId.startsWith(`m22e2r2-${inventory.runId}-`))) {
    console.log('REFUSED — inventory contains entries that are not synthetic M22-D-E2 objects of one run.');
    process.exitCode = 2;
    return;
  }

  const { R2StemStorage, createR2Client } = await import('../src/features/ministry_audio/r2-storage');
  const config = getR2DevelopmentConfig(process.env);
  const storage = new R2StemStorage(config);
  const client = createR2Client(config);
  const keys = entries.flatMap(({ ministryId, recordingId }) => STEM_IDS.flatMap((stem) => [
    `objects/ministry-audio/${ministryId}/${recordingId}/${stem}.wav`,
    ...[1, 2, 3].map((attempt) => `staging/ministry-audio/${ministryId}/${recordingId}/${stem}/${attempt}.wav`),
  ]));
  const removed = await Promise.allSettled(keys.map((key) => storage.remove(key)));
  const removeFailed = removed.filter((r) => r.status === 'rejected').length;
  let stillPresent = 0;
  for (const key of keys) {
    try {
      await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
      stillPresent++;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404) stillPresent++; // anything but a clear "not found" is not proof of removal
    }
  }
  const ok = removeFailed === 0 && stillPresent === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  inventory keys=${keys.length} removeFailed=${removeFailed} stillPresentOrUnverified=${stillPresent}`);
  if (!ok) process.exitCode = 1;
}

void run().catch(() => {
  console.error('FAIL — cleanup. Check configuration without sharing signed URLs.');
  process.exitCode = 1;
});
