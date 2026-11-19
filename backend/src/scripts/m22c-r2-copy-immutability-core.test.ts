import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  exitCodeForReport, formatReport, PROBE_FINAL_PREFIX, PROBE_STAGING_PREFIX, runCopyImmutability,
  type CopyOutcome, type CopyProbeDeps, type ProbeObject,
} from './m22c-r2-copy-immutability-core';

interface Stored {
  bytes: Uint8Array;
  object: ProbeObject;
}
interface FakeOptions {
  honorDestinationCondition?: boolean;
  honorSourceCondition?: boolean;
  failRemoveFor?: (key: string) => boolean;
  leaveOnRemove?: (key: string) => boolean;
}

const md5 = (bytes: Uint8Array) => `"${createHash('md5').update(bytes).digest('hex')}"`;

// In-memory provider with the semantics R2 documents. Options model a provider that ignores a condition.
function fakeProvider(options: FakeOptions = {}) {
  const { honorDestinationCondition = true, honorSourceCondition = true } = options;
  const store = new Map<string, Stored>();
  const calls: string[] = [];
  let counter = 0;
  const copy = async (stagingKey: string, finalKey: string, sourceEtag: string): Promise<CopyOutcome> => {
    calls.push(`copy ${stagingKey.slice(0, 8)}`);
    await Promise.resolve();
    const source = store.get(stagingKey);
    if (!source) return { kind: 'missing' };
    if (honorSourceCondition && source.object.etag !== sourceEtag) return { kind: 'precondition' };
    if (honorDestinationCondition && store.has(finalKey)) return { kind: 'precondition' };
    store.set(finalKey, {
      bytes: source.bytes,
      object: { ...source.object, contentType: 'audio/wav', cacheControl: 'private, no-store' },
    });
    return { kind: 'created', etag: source.object.etag };
  };
  const deps: CopyProbeDeps = {
    async put(key, bytes) {
      if (store.has(key)) return { kind: 'exists' };
      const object = { etag: md5(bytes), length: bytes.length, contentType: 'audio/wav', cacheControl: 'private, no-store' };
      store.set(key, { bytes, object });
      return { kind: 'created', etag: object.etag };
    },
    async head(key) {
      return store.get(key)?.object;
    },
    async read(key) {
      return store.get(key)?.bytes;
    },
    copy,
    async seal(stagingKey, finalKey, manifest) {
      const existing = store.get(finalKey);
      if (existing) {
        return createHash('sha256').update(existing.bytes).digest('hex') === manifest.sha256
          ? { kind: 'sealed', etag: existing.object.etag }
          : { kind: 'rejected', code: '409' };
      }
      const staging = store.get(stagingKey);
      if (!staging || createHash('sha256').update(staging.bytes).digest('hex') !== manifest.sha256) {
        return { kind: 'rejected', code: staging ? '422' : '409' };
      }
      const outcome = await copy(stagingKey, finalKey, staging.object.etag);
      return outcome.kind === 'created' ? { kind: 'sealed', etag: staging.object.etag } : { kind: 'rejected', code: '409' };
    },
    async remove(key) {
      if (options.failRemoveFor?.(key)) throw new Error('private provider information');
      if (!options.leaveOnRemove?.(key)) store.delete(key);
    },
    newId: () => `id-${counter++}`,
  };
  return { deps, store, calls };
}

describe('M22-C.3B CopyObject immutability probe (offline)', () => {
  it('passes every scenario against a provider that honors both conditions, and cleans up', async () => {
    const { deps, store } = fakeProvider();
    const report = await runCopyImmutability(deps);
    expect(report.checks.every(({ status }) => status === 'PASS')).toBe(true);
    expect(report.checks.map(({ area }) => area)).toEqual(expect.arrayContaining(['destination', 'source', 'integrity', 'idempotency', 'concurrency']));
    expect(report.overwriteDetected).toBe(false);
    expect(report.stoppedEarly).toBe(false);
    expect(report.cleanup).toBe('OK');
    expect(store.size).toBe(0);
    expect(exitCodeForReport(report)).toBe(0);
    expect(formatReport(report).at(-1)).toMatch(/^RESULT: PASS/);
  });

  it('only ever touches keys under the two synthetic probe prefixes', async () => {
    const seen = new Set<string>();
    const { deps } = fakeProvider();
    const record = (key: string) => seen.add(key);
    const wrapped: CopyProbeDeps = {
      ...deps,
      put: (key, bytes) => (record(key), deps.put(key, bytes)),
      head: (key) => (record(key), deps.head(key)),
      read: (key) => (record(key), deps.read(key)),
      copy: (source, destination, etag) => (record(source), record(destination), deps.copy(source, destination, etag)),
      seal: (source, destination, manifest) => (record(source), record(destination), deps.seal(source, destination, manifest)),
      remove: (key) => (record(key), deps.remove(key)),
    };
    await runCopyImmutability(wrapped);
    expect(seen.size).toBeGreaterThan(0);
    for (const key of seen) {
      expect(key.startsWith(PROBE_STAGING_PREFIX) || key.startsWith(PROBE_FINAL_PREFIX)).toBe(true);
    }
  });

  it('fails immediately and reports an overwrite when the destination condition is ignored', async () => {
    const { deps, store } = fakeProvider({ honorDestinationCondition: false });
    const report = await runCopyImmutability(deps);
    expect(report.overwriteDetected).toBe(true);
    expect(report.stoppedEarly).toBe(true);
    const failed = report.checks.filter(({ status }) => status === 'FAIL');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ area: 'destination', detail: expect.stringContaining('OVERWRITE') });
    // Nothing after the failing scenario ran.
    expect(report.checks.at(-1)?.status).toBe('FAIL');
    expect(exitCodeForReport(report)).toBe(1);
    expect(formatReport(report).join('\n')).toContain('Do not run the large profile in copy mode');
    expect(report.cleanup).toBe('OK');
    expect(store.size).toBe(0);
  });

  it('detects a provider that ignores the source condition', async () => {
    const { deps } = fakeProvider({ honorSourceCondition: false });
    const report = await runCopyImmutability(deps);
    expect(report.checks.some(({ status, area }) => status === 'FAIL' && area === 'source')).toBe(true);
    expect(exitCodeForReport(report)).toBe(1);
  });

  it('flags a destination whose content changed even when the status was 412', async () => {
    const { deps, store } = fakeProvider();
    const original = deps.copy;
    let tampered = false;
    const tampering: CopyProbeDeps = {
      ...deps,
      async copy(source, destination, etag) {
        const outcome = await original(source, destination, etag);
        if (!tampered && outcome.kind === 'precondition') {
          tampered = true;
          const entry = store.get(destination)!;
          store.set(destination, { ...entry, bytes: new Uint8Array(entry.bytes).fill(7) });
        }
        return outcome;
      },
    };
    const report = await runCopyImmutability(tampering);
    expect(report.checks.find(({ status }) => status === 'FAIL')).toMatchObject({
      area: 'destination',
      name: expect.stringContaining('unchanged'),
    });
  });

  it('reports when both concurrent promotions claim success', async () => {
    // A non-atomic provider: requests that overlap in time both pass the existence check and the last writer wins.
    const base = fakeProvider();
    let inflight = 0;
    const racing: CopyProbeDeps = {
      ...base.deps,
      async copy(source, destination, etag) {
        let overlapped = ++inflight > 1;
        await Promise.resolve();
        overlapped ||= inflight > 1;
        try {
          if (overlapped) {
            base.store.set(destination, { ...base.store.get(source)! });
            return { kind: 'created', etag };
          }
          return await base.deps.copy(source, destination, etag);
        } finally {
          inflight -= 1;
        }
      },
    };
    const report = await runCopyImmutability(racing);
    expect(report.checks.at(-1)).toMatchObject({ area: 'concurrency', status: 'FAIL' });
    expect(report.overwriteDetected).toBe(true);
  });

  it('treats a 429 on a contested key as inconclusive, and requires 409 from the adapter over an occupied key', async () => {
    const limited = fakeProvider();
    let copies = 0;
    const report429 = await runCopyImmutability({
      ...limited.deps,
      async copy(source, destination, etag) {
        copies += 1;
        return copies === 2 ? { kind: 'error', code: '429' } : limited.deps.copy(source, destination, etag);
      },
    });
    expect(report429.checks.find(({ status }) => status === 'FAIL')?.detail).toMatch(/INCONCLUSIVE/);
    expect(report429.overwriteDetected).toBe(false);

    const wrongCode = fakeProvider();
    const reportCode = await runCopyImmutability({
      ...wrongCode.deps,
      seal: async () => ({ kind: 'rejected', code: '503' }),
    });
    expect(reportCode.checks.find(({ status }) => status === 'FAIL')).toMatchObject({ area: 'destination', detail: expect.stringContaining('409') });
  });
  it('keeps going to cleanup after a thrown provider error and never prints its message', async () => {
    const { deps, store } = fakeProvider();
    let reads = 0;
    const flaky: CopyProbeDeps = {
      ...deps,
      read: async (key) => {
        reads += 1;
        if (reads === 2) throw new Error('https://signed.example/?X-Amz-Signature=secret');
        return deps.read(key);
      },
    };
    const report = await runCopyImmutability(flaky);
    const failure = report.checks.find(({ status }) => status === 'FAIL');
    expect(failure?.detail).toBe('unexpected error');
    expect(formatReport(report).join('\n')).not.toMatch(/signed\.example|X-Amz-Signature|secret/);
    expect(report.cleanup).toBe('OK');
    expect(store.size).toBe(0);
  });

  it('reports a failed cleanup and a leftover object with exit code 3', async () => {
    const failing = fakeProvider({ failRemoveFor: (key) => key.startsWith(PROBE_FINAL_PREFIX) });
    const failedReport = await runCopyImmutability(failing.deps);
    expect(failedReport.cleanup).toBe('FAILED');
    expect(exitCodeForReport(failedReport)).toBe(3);

    const leaving = fakeProvider({ leaveOnRemove: (key) => key.startsWith(PROBE_STAGING_PREFIX) });
    const leftReport = await runCopyImmutability(leaving.deps);
    expect(leftReport.cleanup).toBe('FAILED');
    expect(exitCodeForReport(leftReport)).toBe(3);
  });

  it('registers every key for cleanup even when seeding fails', async () => {
    const { deps } = fakeProvider();
    const removed: string[] = [];
    const broken: CopyProbeDeps = {
      ...deps,
      put: async () => ({ kind: 'error', code: '500' }),
      remove: async (key) => { removed.push(key); },
    };
    const report = await runCopyImmutability(broken);
    expect(report.checks[0]).toMatchObject({ status: 'FAIL' });
    expect(report.stoppedEarly).toBe(true);
    expect(removed.length).toBe(report.keysCovered);
    expect(removed.length).toBeGreaterThanOrEqual(2);
  });
});
