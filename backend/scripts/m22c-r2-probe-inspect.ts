import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';

// READ-ONLY inspection of the synthetic probe prefixes of the development bucket. It performs ListObjectsV2 only:
// no write, no delete. Output lists keys, sizes and timestamps so any leftover can be identified precisely before
// anyone authorizes a removal. Usage (from backend/): npx --no-install tsx scripts/m22c-r2-probe-inspect.ts

// Exactly the prefixes written by m22c-r2-seal-bench.ts and m22c-r2-dev-smoke.ts. Nothing else is listed.
const PREFIXES = [
  'staging/ministry-audio/r2-development-probe/',
  'objects/ministry-audio/r2-development-probe/',
] as const;
const MAX_KEYS_PER_PREFIX = 200;
const MIB = 1024 * 1024;

async function run() {
  if (process.env.M22C_R2_LIVE_TESTS !== '1' || process.env.M22C_R2_INSPECT !== '1' ||
    process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
    console.log('BLOCKED — read-only inspection needs M22C_R2_LIVE_TESTS=1, M22C_R2_INSPECT=1 and the development bucket configuration.');
    process.exitCode = 2;
    return;
  }
  const { accountId, bucket, accessKeyId, secretAccessKey } = getR2DevelopmentConfig(process.env);
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    maxAttempts: 1,
  });

  let leftovers = 0;
  for (const prefix of PREFIXES) {
    const listed = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: MAX_KEYS_PER_PREFIX }), {
      abortSignal: AbortSignal.timeout(15_000),
    });
    const objects = listed.Contents ?? [];
    const total = objects.reduce((sum, { Size }) => sum + (Size ?? 0), 0);
    console.log(`${prefix} -> ${objects.length}${listed.IsTruncated ? '+' : ''} object(s), ${(total / MIB).toFixed(1)} MiB`);
    for (const { Key, Size, LastModified } of objects) {
      console.log(`  ${Key} | ${Size} B | ${LastModified?.toISOString() ?? 'unknown time'}`);
    }
    leftovers += objects.length;
  }
  console.log(leftovers === 0
    ? 'RESULT: no leftover synthetic probe objects under the two prefixes.'
    : `RESULT: ${leftovers} object(s) found. Nothing was changed. The staging prefix also expires through the bucket lifecycle; remove any final objects/ key only after confirming it above.`);
}

void run().catch(() => {
  console.error('FAIL — read-only inspection. Check configuration and token permissions without sharing credentials.');
  process.exitCode = 1;
});
