import { describe, expect, it, vi } from 'vitest';
import { MAX_STEM_BYTES } from '../features/ministry_audio/ministry-audio.schema';
import {
  executeProfile, exitCodeFor, formatResults, MB, parseProfile, PROFILES, wavOfSize, MAX_BYTES_PER_PROFILE, MAX_RUNS_PER_PROFILE,
  type BenchDeps,
} from './m22c-r2-seal-bench-core';

const SIGNED = 'https://signed.example.invalid/object?X-Amz-Signature=SECRET';

function makeDeps(overrides: Partial<BenchDeps> = {}) {
  let clock = 0;
  const stored = new Map<string, Buffer>();
  const removed: string[] = [];
  const deps: BenchDeps = {
    storage: {
      signUpload: vi.fn(async () => ({ url: SIGNED, headers: { 'if-none-match': '*' } })),
      seal: vi.fn(async () => ({ etag: '"e"' })),
      signDownload: vi.fn(async () => ({ url: SIGNED, headers: { 'if-match': '"e"' } })),
      remove: vi.fn(async (key: string) => { removed.push(key); }),
    },
    putObject: vi.fn(async (_url, _headers, bytes) => { stored.set('last', bytes); return 200; }),
    getObject: vi.fn(async () => ({ status: 200, body: new Uint8Array(stored.get('last')!) })),
    now: () => (clock += 10),
    newId: () => `id-${clock}`,
    sampler: { start: vi.fn(), stop: vi.fn(() => ({ rssPeakBytes: 5 * MB, tempDiskPeakBytes: 2 * MB })) },
    ...overrides,
  };
  return { deps, removed };
}

describe('seal benchmark profiles', () => {
  it('requires an explicit, exact profile', () => {
    expect(parseProfile([])).toHaveProperty('error');
    for (const bad of [['quick'], ['--profile'], ['--profile', 'all'], ['--profile', 'quick', '--profile', 'large'], ['--profile=full'], ['--profile', 'quick', 'x']]) {
      expect(parseProfile(bad), bad.join(' ')).toHaveProperty('error');
    }
    expect(parseProfile(['--profile', 'quick'])).toEqual({ profile: 'quick' });
    expect(parseProfile(['--profile=large'])).toEqual({ profile: 'large' });
  });

  it('keeps each profile within the declared sample and volume limits', () => {
    expect(PROFILES.quick).toEqual([1 * MB, 5 * MB, 15 * MB]);
    expect(PROFILES.large).toEqual([30 * MB, MAX_STEM_BYTES]);
    for (const sizes of Object.values(PROFILES)) {
      expect(sizes.length).toBeLessThanOrEqual(MAX_RUNS_PER_PROFILE);
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBeLessThanOrEqual(MAX_BYTES_PER_PROFILE);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(MAX_STEM_BYTES);
    }
  });

  it('builds valid synthetic WAVs with matching manifests', () => {
    const { bytes, manifest } = wavOfSize(1 * MB);
    expect(manifest.sizeBytes).toBe(bytes.length);
    expect(manifest.sizeBytes).toBe(44 + manifest.frames * 4);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  });
});

describe('seal benchmark execution', () => {
  it('runs sizes sequentially once each, with own keys only, and cleans up', async () => {
    const { deps, removed } = makeDeps();
    const results = await executeProfile('quick', deps);
    expect(results.map(({ bytes }) => bytes)).toEqual(PROFILES.quick.map((size) => wavOfSize(size).bytes.length));
    expect(results.every(({ status, cleanup }) => status === 'COMPLETED' && cleanup === 'OK')).toBe(true);
    expect(deps.storage.seal).toHaveBeenCalledTimes(3);
    expect(deps.putObject).toHaveBeenCalledTimes(3);
    expect(removed).toHaveLength(6);
    expect(removed.every((key) => /^(staging|objects)\/ministry-audio\/r2-development-probe\/[a-f0-9]{64}\//.test(key))).toBe(true);
    expect(exitCodeFor(results)).toBe(0);
  });

  it('stops at the first error without retry, cleans up and marks the rest NOT_RUN', async () => {
    const seal = vi.fn().mockResolvedValueOnce({ etag: '"e"' }).mockRejectedValueOnce(Object.assign(new Error(`timeout ${SIGNED}`), { statusCode: 503 }));
    const { deps, removed } = makeDeps({ storage: { ...makeDeps().deps.storage, seal } });
    const storage = deps.storage;
    const results = await executeProfile('quick', { ...deps, storage: { ...storage, remove: vi.fn(async (key: string) => { removed.push(key); }) } });
    expect(results.map(({ status }) => status)).toEqual(['COMPLETED', 'FAILED', 'NOT_RUN']);
    expect(results[1].failure).toEqual({ phase: 'seal', code: '503' });
    expect(seal).toHaveBeenCalledTimes(2);
    expect(removed).toHaveLength(4);
    expect(results[1].cleanup).toBe('OK');
    expect(exitCodeFor(results)).toBe(1);
  });

  it('reports a PUT HTTP status and never repeats the request', async () => {
    const putObject = vi.fn(async () => 412);
    const { deps } = makeDeps({ putObject });
    const results = await executeProfile('large', deps);
    expect(results.map(({ status }) => status)).toEqual(['FAILED', 'NOT_RUN']);
    expect(results[0].failure).toEqual({ phase: 'put', code: '412' });
    expect(putObject).toHaveBeenCalledTimes(1);
  });

  it('reports failed cleanup and a distinct exit code', async () => {
    const { deps } = makeDeps();
    const failing = { ...deps.storage, remove: vi.fn(async () => { throw new Error('boom'); }) };
    const results = await executeProfile('large', { ...deps, storage: failing });
    expect(results.every(({ cleanup }) => cleanup === 'FAILED')).toBe(true);
    expect(exitCodeFor(results)).toBe(3);
  });

  it('detects a digest mismatch and flags a seal beyond the budget', async () => {
    const mismatch = makeDeps({ getObject: vi.fn(async () => ({ status: 200, body: new Uint8Array([1, 2, 3]) })) });
    const failed = await executeProfile('quick', mismatch.deps);
    expect(failed[0].failure?.phase).toBe('verify');

    let clock = 0;
    const slowSeal = vi.fn(async () => { clock += 39_000; return { etag: '"e"' }; });
    const { deps } = makeDeps({ now: () => clock, storage: { ...makeDeps().deps.storage, seal: slowSeal } });
    const slow = await executeProfile('large', deps);
    expect(slow[0].sealWithinBudget).toBe(false);
  });

  it('removes exactly the matching staging/final pair of the same run id', async () => {
    const { deps, removed } = makeDeps();
    await executeProfile('quick', deps);
    for (let index = 0; index < removed.length; index += 2) {
      const stage = /^staging\/ministry-audio\/r2-development-probe\/([a-f0-9]{64})\/vocals\/1\.wav$/.exec(removed[index]);
      const final = /^objects\/ministry-audio\/r2-development-probe\/([a-f0-9]{64})\/vocals\.wav$/.exec(removed[index + 1]);
      expect(stage?.[1]).toBeTruthy();
      expect(stage?.[1]).toBe(final?.[1]);
    }
    expect(new Set(removed).size).toBe(removed.length);
  });

  it('cleans up after a timeout in the PUT, reports only the error class, and orders the sampler around it', async () => {
    const order: string[] = [];
    const sampler = { start: vi.fn(() => order.push('start')), stop: vi.fn(() => { order.push('stop'); return { rssPeakBytes: 1 }; }) };
    const putObject = vi.fn(async () => { order.push('put'); throw Object.assign(new Error(`aborted ${SIGNED}`), { name: 'TimeoutError' }); });
    const remove = vi.fn(async () => { order.push('remove'); });
    const { deps } = makeDeps({ sampler, putObject, storage: { ...makeDeps().deps.storage, remove } });
    const results = await executeProfile('quick', deps);
    expect(results[0].failure).toEqual({ phase: 'put', code: 'TimeoutError' });
    expect(results[0].cleanup).toBe('OK');
    expect(order).toEqual(['start', 'put', 'remove', 'remove', 'stop']);
    expect(results.slice(1).every(({ status }) => status === 'NOT_RUN')).toBe(true);
  });

  it('starts no further size once an interrupt is requested', async () => {
    const { deps } = makeDeps({ shouldStop: () => true });
    const results = await executeProfile('quick', deps);
    expect(results.every(({ status }) => status === 'NOT_RUN')).toBe(true);
    expect(deps.putObject).not.toHaveBeenCalled();
    expect(deps.storage.remove).not.toHaveBeenCalled();
  });

  it('reports a seal aborted at the budget as over budget instead of a plain outage', async () => {
    let clock = 0;
    const seal = vi.fn(async () => { clock += 38_000; throw Object.assign(new Error('x'), { statusCode: 503 }); });
    const { deps } = makeDeps({ now: () => clock, storage: { ...makeDeps().deps.storage, seal } });
    const results = await executeProfile('quick', deps);
    expect(results[0].failure).toEqual({ phase: 'seal', code: '503' });
    expect(results[0].sealWithinBudget).toBe(false);
    expect(formatResults('quick', results).join('\n')).toContain('seal within 38 s: NO');
  });

  it('never prints signed URLs, error messages or credentials, and computes no percentile', async () => {
    const seal = vi.fn().mockRejectedValue(new Error(`failed for ${SIGNED}`));
    const { deps } = makeDeps({ storage: { ...makeDeps().deps.storage, seal } });
    const results = await executeProfile('quick', deps);
    const text = formatResults('quick', results).join('\n');
    expect(text).not.toContain('signed.example');
    expect(text).not.toContain('SECRET');
    expect(text.toLowerCase()).not.toContain('p95');
    expect(text).toContain('NOT_RUN');
  });
});
