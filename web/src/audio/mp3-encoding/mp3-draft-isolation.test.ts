import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeparationDraft } from '../local-separation-draft';
import { polyfillBlobArrayBuffer } from '../local-separation-fixtures';
import { createResumeStore, compressSeparationDraft } from './mp3-draft-compression';
import { createInProcessEncoder, createLookupDecoder, tonesResult } from './mp3-test-support';

// M22-S2.1: results of an old run must never leak into a newer draft, and resumption is bound to the same source/profile.

// Real LAME encodes up to six stems several times per test: more than the 5 s default on a busy machine.
vi.setConfig({ testTimeout: 40_000 });
beforeAll(polyfillBlobArrayBuffer);

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; };

describe('resume store isolation', () => {
  it('a late result of a discarded run cannot repopulate the store or leak into the next draft', async () => {
    const draftA = await createSeparationDraft(await tonesResult(20_000));
    const store = createResumeStore(draftA);
    const gate = deferred();
    const abort = new AbortController();
    const encoderA = createInProcessEncoder({ beforeEncode: async (call) => { if (call === 1) await gate.promise; } });
    // Hold the run right AFTER encode+decode, while it reads the original WAV: patch File.arrayBuffer of the second read.
    const vocals = draftA.files().vocals!;
    const original = vocals.arrayBuffer.bind(vocals);
    let reads = 0;
    const secondRead = deferred();
    const lateRead = deferred();
    Object.defineProperty(vocals, 'arrayBuffer', { value: async () => { reads++; if (reads === 2) { secondRead.resolve(); await lateRead.promise; } return original(); } });
    const run = compressSeparationDraft({ draft: draftA, encoder: encoderA, decoder: createLookupDecoder(encoderA), signal: abort.signal, resume: store }).catch((e) => e);
    gate.resolve();
    await secondRead.promise; // encoded + decoded; now waiting for the second WAV read
    expect(reads).toBe(2);
    // discard: abort, close the store, then release the late read
    abort.abort();
    store.close();
    lateRead.resolve();
    const outcome = await run;
    expect(outcome).toMatchObject({ code: 'CANCELLED' });
    expect(store.size).toBe(0);

    // A new draft with a fresh store never sees anything from draft A.
    const draftB = await createSeparationDraft(await tonesResult(20_000));
    const storeB = createResumeStore(draftB);
    const encoderB = createInProcessEncoder();
    await compressSeparationDraft({ draft: draftB, encoder: encoderB, decoder: createLookupDecoder(encoderB), resume: storeB });
    expect(encoderB.calls).toBe(6);
  });

  it('a store belongs to one draft and one source file: a different draft is refused, a replaced WAV is not reused', async () => {
    const draftA = await createSeparationDraft(await tonesResult(20_000));
    const draftB = await createSeparationDraft(await tonesResult(20_000));
    const store = createResumeStore(draftA);
    const enc = createInProcessEncoder({ failOnCall: 3 });
    await compressSeparationDraft({ draft: draftA, encoder: enc, decoder: createLookupDecoder(enc), resume: store }).catch(() => undefined);
    expect(store.size).toBe(2);
    await expect(compressSeparationDraft({ draft: draftB, encoder: enc, decoder: createLookupDecoder(enc), resume: store })).rejects.toMatchObject({ code: 'INVALID_DRAFT' });

    // Same draft, but the stem entries were produced for another profile (decoder delay) -> not reused
    const other = createInProcessEncoder();
    const decoder = createLookupDecoder(other);
    for (const [sha, s] of enc.samplesBySha) other.samplesBySha.set(sha, s);
    decoder.calibrate = async (rate: number) => ({ shape: 'canonical' as const, sampleRate: rate as 44100, decoderDelayFrames: 530 });
    await compressSeparationDraft({ draft: draftA, encoder: other, decoder, resume: store });
    expect(other.calls).toBe(6); // nothing reused: different encoder profile
  });

  it('a closed store ignores late writes', async () => {
    const draft = await createSeparationDraft(await tonesResult(20_000));
    const store = createResumeStore(draft);
    store.close();
    const enc = createInProcessEncoder();
    await expect(compressSeparationDraft({ draft, encoder: enc, decoder: createLookupDecoder(enc), resume: store })).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(enc.calls).toBe(0);
    expect(store.size).toBe(0);
  });

  it('two overlapping runs on the same draft cannot both be active', async () => {
    const draft = await createSeparationDraft(await tonesResult(20_000));
    const store = createResumeStore(draft);
    const gate = deferred();
    const encoding = deferred();
    const slow = createInProcessEncoder({ beforeEncode: async (call) => { if (call === 1) { encoding.resolve(); await gate.promise; } } });
    const first = compressSeparationDraft({ draft, encoder: slow, decoder: createLookupDecoder(slow), resume: store }).catch((e) => e);
    await encoding.promise; // the first run is certainly active now
    const e2 = createInProcessEncoder();
    await expect(compressSeparationDraft({ draft, encoder: e2, decoder: createLookupDecoder(e2), resume: store })).rejects.toMatchObject({ code: 'FAILED' });
    expect(e2.calls).toBe(0);
    gate.resolve();
    expect(await first).toHaveProperty('mp3BytesTotal');
  });
});
