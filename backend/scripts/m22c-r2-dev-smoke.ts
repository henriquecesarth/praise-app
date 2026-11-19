import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { getR2DevelopmentConfig } from '../src/features/ministry_audio/r2-development-config';
import type { StemManifest } from '../src/features/ministry_audio/ministry-audio.schema';

// Authorized CORS origin of the development bucket. Keep it aligned with the bucket policy.
const ALLOWED_ORIGIN = 'http://127.0.0.1:5173';

class StepFailure extends Error {}

function check(condition: unknown, step: string): asserts condition {
  if (!condition) throw new StepFailure(step);
  console.log(`PASS  ${step}`);
}

async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
  try {
    const result = await action();
    console.log(`PASS  ${name}`);
    return result;
  } catch {
    throw new StepFailure(name);
  }
}

function makeWav(): Uint8Array<ArrayBuffer> {
  const frames = 8_000;
  const bytes = Buffer.alloc(44 + frames * 4);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write('WAVEfmt ', 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(8_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(frames * 4, 40);
  return new Uint8Array(bytes);
}

async function request(url: string, init: RequestInit) {
  return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
}

async function run() {
  if (process.env.M22C_R2_LIVE_TESTS !== '1' ||
    process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV === 'production') {
    console.log('BLOCKED — real R2 probe requires an explicitly authorized development run.');
    process.exitCode = 2;
    return;
  }

  const { R2StemStorage } = await import('../src/features/ministry_audio/r2-storage');
  const storage = new R2StemStorage(getR2DevelopmentConfig(process.env));
  const origin = ALLOWED_ORIGIN;
  const wav = makeWav();
  const sha256 = createHash('sha256').update(wav).digest('hex');
  const id = createHash('sha256').update(randomUUID()).digest('hex');
  const stage = `staging/ministry-audio/r2-development-probe/${id}/vocals/1.wav`;
  const differentStage = stage.replace('/vocals/', '/bass/');
  const final = `objects/ministry-audio/r2-development-probe/${id}/vocals.wav`;
  const expected: StemManifest = {
    id: 'vocals', codec: 'pcm_s16le', sampleRate: 8_000, channels: 2, durationSeconds: 1,
    frames: 8_000, sha256, sizeBytes: wav.length,
  };

  try {
    const upload = await step('sign staging PUT', () => storage.signUpload(stage, expected, 60));
    const preflight = (candidate: string) => request(upload.url, {
      method: 'OPTIONS',
      headers: {
        Origin: candidate,
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': Object.keys(upload.headers).join(','),
      },
    });
    const allowed = await preflight(origin);
    const denied = await preflight('https://unauthorized.example.test');
    check(allowed.ok && allowed.headers.get('access-control-allow-origin') === origin, 'allowed PUT preflight');
    check(!denied.headers.get('access-control-allow-origin'), 'denied PUT preflight');

    const put = {
      method: 'PUT',
      headers: { ...upload.headers, Origin: origin, 'Content-Length': String(wav.length) },
      body: wav,
    };
    const alteredUrl = new URL(upload.url);
    alteredUrl.pathname = alteredUrl.pathname.replace('/vocals/', '/bass/');
    check(!(await request(alteredUrl.href, put)).ok, 'signature is bound to the staging key');
    check((await request(upload.url, put)).ok, 'signed PUT');
    check((await request(upload.url, put)).status === 412, 'conditional repeat PUT');

    const receipt = await step('seal: verified WAV/size/SHA-256 and conditional final write', () => storage.seal(stage, final, expected));
    await step('conditional HEAD with If-Match receipt', () => storage.assertObject(final, expected, receipt));
    const download = await step('sign final GET', () => storage.signDownload(final, receipt, 60));
    const readPreflight = await request(download.url, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': Object.keys(download.headers).join(','),
      },
    });
    check(readPreflight.ok && readPreflight.headers.get('access-control-allow-origin') === origin, 'GET preflight');
    const content = await request(download.url, { headers: { ...download.headers, Origin: origin } });
    check(content.ok && content.headers.get('access-control-allow-origin') === origin, 'signed GET');
    const body = await content.arrayBuffer();
    check(body.byteLength === wav.length && createHash('sha256').update(new Uint8Array(body)).digest('hex') === sha256, 'independent downloaded SHA-256');
    check(!(await request(download.url.split('?')[0], {})).ok, 'private object');
    const short = await step('sign 1 s GET', () => storage.signDownload(final, receipt, 1));
    await delay(2_100);
    check(!(await request(short.url, { headers: short.headers })).ok, 'expired signature');
    console.log('PASS — dedicated development R2 signed PUT/GET, CORS, conditional write, key binding, SHA-256 and expiry.');
  } finally {
    const cleanup = await Promise.allSettled([stage, differentStage, final].map((key) => storage.remove(key)));
    if (cleanup.some((result) => result.status === 'rejected')) throw new StepFailure('cleanup of probe objects');
    console.log('PASS  cleanup of probe objects');
  }
}

void run().catch((error) => {
  console.error(`FAIL  ${error instanceof StepFailure ? error.message : 'unexpected error'}`);
  console.error('FAIL — development R2 probe. Check configuration, policy and provider diagnostics without sharing signed URLs.');
  process.exitCode = 1;
});
