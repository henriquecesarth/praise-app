import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';
import { STEM_IDS } from '../src/features/ministry_audio/ministry-audio.schema';

// Removes ONLY the synthetic objects of one M22-C.2 browser run, using the CLEANUP_HINT printed by the spec.
// Usage (from backend/): $env:M22C_CLEANUP_MINISTRY='m22c-r2-<uuid>'; $env:M22C_CLEANUP_RECORDINGS='<id1>,<id2>'
// It accepts only ministries created by the spec (prefix m22c-r2-) and 64-hex recording ids. No listing, no wildcards.

async function run() {
  const ministry = process.env.M22C_CLEANUP_MINISTRY ?? '';
  const recordings = (process.env.M22C_CLEANUP_RECORDINGS ?? '').split(',').filter(Boolean);
  if (process.env.M22C_R2_LIVE_TESTS !== '1' || process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
    console.log('BLOCKED — cleanup needs M22C_R2_LIVE_TESTS=1 and the development bucket configuration.');
    process.exitCode = 2;
    return;
  }
  if (!/^m22c-r2-[a-f0-9-]{36}$/.test(ministry) || recordings.length === 0 || !recordings.every((id) => /^[a-f0-9]{64}$/.test(id))) {
    console.log('REFUSED — only m22c-r2-<uuid> ministries and 64-hex recording ids from the spec are accepted.');
    process.exitCode = 2;
    return;
  }

  const { R2StemStorage } = await import('../src/features/ministry_audio/r2-storage');
  const storage = new R2StemStorage(getR2DevelopmentConfig(process.env));
  const keys = recordings.flatMap((id) => STEM_IDS.flatMap((stem) => [
    `objects/ministry-audio/${ministry}/${id}/${stem}.wav`,
    ...[1, 2, 3].map((attempt) => `staging/ministry-audio/${ministry}/${id}/${stem}/${attempt}.wav`),
  ]));
  const results = await Promise.allSettled(keys.map((key) => storage.remove(key)));
  const failed = results.filter((result) => result.status === 'rejected').length;
  console.log(`${failed === 0 ? 'PASS' : 'FAIL'}  removed ${results.length - failed}/${results.length} synthetic keys (missing keys count as removed)`);
  if (failed) process.exitCode = 1;
}

void run().catch(() => {
  console.error('FAIL — cleanup. Check configuration without sharing signed URLs.');
  process.exitCode = 1;
});
