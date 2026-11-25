import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createSeparationDraft } from '../local-separation-draft';
import { polyfillBlobArrayBuffer } from '../local-separation-fixtures';
import { CANONICAL_STEM_IDS } from '../separation/demucs-onnx-separator';
import type { MinistryAudioUpload } from '../ministry-audio-contract';
import { compressSeparationDraft, createResumeStore } from './mp3-draft-compression';
import { Mp3PublicationHandoff, buildMp3Reservation, publishMp3Handoff, type Mp3PublicationApi } from './mp3-publication-handoff';
import { createInProcessEncoder, createLookupDecoder, mp3StemShape, tonesResult } from './mp3-test-support';

// M22-S3: explicit ownership transfer of a compressed draft to the experimental publication flow, with a fake API.

beforeAll(polyfillBlobArrayBuffer);
vi.setConfig({ testTimeout: 30_000 });
const pub = (api: object) => api as unknown as Mp3PublicationApi;

async function handoff() {
  const wav = await createSeparationDraft(await tonesResult(20_000));
  const encoder = createInProcessEncoder();
  const mp3 = await compressSeparationDraft({ draft: wav, encoder, decoder: createLookupDecoder(encoder), resume: createResumeStore(wav) });
  return { wav, mp3, handoff: new Mp3PublicationHandoff(wav, mp3) };
}
const metadata = { title: 'T', artist: 'A', version: 'V' };

function fakeApi(over: Partial<Mp3PublicationApi> = {}) {
  const uploaded: string[] = [];
  const upload = (status: MinistryAudioUpload['status'] = 'uploading', transfer: 'direct' | undefined = 'direct'): MinistryAudioUpload =>
    ({ id: 'up1', status, uploadedStemIds: uploaded.slice() as never, expiresAt: 1, transfer });
  const api = {
    reserve: vi.fn(async () => upload()),
    getUpload: vi.fn(async () => upload()),
    uploadDirectStem: vi.fn(async (_m: string, _id: string, stem: string, _file: Blob) => { uploaded.push(stem); return upload(); }),
    finalize: vi.fn(async () => ({})),
  };
  Object.assign(api, over);
  return { api, uploaded };
}

describe('Mp3PublicationHandoff', () => {
  it('builds an immutable schemaVersion 2 reservation with six verified MP3 stems and the WAV draft model', async () => {
    const { handoff: h, wav } = await handoff();
    const reservation = buildMp3Reservation(h, metadata, 'key-1');
    expect(reservation).toMatchObject({ schemaVersion: 2, idempotencyKey: 'key-1', confirmed: true, model: wav.model });
    expect(reservation.stems.map((s) => s.id)).toEqual([...CANONICAL_STEM_IDS]);
    for (const stem of reservation.stems) expect(mp3StemShape(stem)).toEqual([]);
  });

  it('refuses drafts of different recordings and disposed drafts', async () => {
    const a = await handoff();
    const other = await createSeparationDraft(await tonesResult(24_000));
    expect(() => new Mp3PublicationHandoff(other, a.mp3)).toThrowError(/diferentes/);
    a.mp3.dispose();
    expect(() => new Mp3PublicationHandoff(a.wav, a.mp3)).toThrowError(/descartado/);
  });

  it('releases both drafts together and never leaves a WAV/MP3 mix usable', async () => {
    const { handoff: h, wav, mp3 } = await handoff();
    h.dispose();
    expect(wav.disposed).toBe(true);
    expect(mp3.disposed).toBe(true);
    expect(h.disposed).toBe(true);
    expect(() => buildMp3Reservation(h, metadata, 'k')).toThrowError(/descartado/);
  });
});

describe('publishMp3Handoff', () => {
  const signal = () => new AbortController().signal;

  it('reserves, uploads the six MP3 files directly in canonical order, then finalizes; the drafts stay owned by the caller', async () => {
    const { handoff: h, wav, mp3 } = await handoff();
    const { api } = fakeApi();
    const progress: number[] = [];
    await expect(publishMp3Handoff(h, { api: pub(api), ministryId: 'm1', metadata, idempotencyKey: 'k', signal: signal(), onProgress: (n) => progress.push(n) })).resolves.toEqual({ uploadId: 'up1' });
    expect(api.reserve).toHaveBeenCalledTimes(1);
    expect(api.uploadDirectStem.mock.calls.map((c) => c[2])).toEqual([...CANONICAL_STEM_IDS]);
    for (const call of api.uploadDirectStem.mock.calls) expect((call[3] as File).type).toBe('audio/mpeg');
    expect(api.finalize).toHaveBeenCalledTimes(1);
    expect(progress.at(-1)).toBe(6);
    expect(wav.disposed || mp3.disposed).toBe(false);
  });

  it('resumes: only the stems the server does not have are uploaded, with the same reservation', async () => {
    const { handoff: h } = await handoff();
    const { api, uploaded } = fakeApi();
    uploaded.push('vocals', 'drums');
    await publishMp3Handoff(h, { api: pub(api), ministryId: 'm1', metadata, idempotencyKey: 'k', signal: signal(), uploadId: 'up1' });
    expect(api.reserve).not.toHaveBeenCalled();
    expect(api.uploadDirectStem.mock.calls.map((c) => c[2])).toEqual(['bass', 'guitar', 'piano', 'other']);
  });

  it('fail-closed: not direct, not uploading, partial upload, disposed mid-way, aborted, and server refusal never finalize', async () => {
    const shared = (await handoff()).handoff;
    const run = async (api: object, dispose = false, s = signal()) => {
      const h = dispose ? (await handoff()).handoff : shared;
      if (dispose) h.dispose();
      return publishMp3Handoff(h, { api: pub(api), ministryId: 'm1', metadata, idempotencyKey: 'k', signal: s });
    };
    const proxied = fakeApi({ reserve: vi.fn(async () => ({ id: 'u', status: 'uploading', uploadedStemIds: [], expiresAt: 1 })) as never });
    await expect(run(proxied.api)).rejects.toMatchObject({ code: 'FAILED' });
    expect(proxied.api.uploadDirectStem).not.toHaveBeenCalled();

    const closed = fakeApi({ reserve: vi.fn(async () => ({ id: 'u', status: 'expired', uploadedStemIds: [], expiresAt: 1, transfer: 'direct' })) as never });
    await expect(run(closed.api)).rejects.toMatchObject({ code: 'FAILED' });

    const partial = fakeApi({ uploadDirectStem: vi.fn(async () => ({ id: 'u', status: 'uploading', uploadedStemIds: ['vocals'], expiresAt: 1, transfer: 'direct' })) as never });
    await expect(run(partial.api)).rejects.toMatchObject({ code: 'FAILED' });
    expect(partial.api.finalize).not.toHaveBeenCalled();

    const refused = fakeApi({ reserve: vi.fn(async () => { throw new Error('AUDIO_CODEC_NOT_ENABLED'); }) as never });
    await expect(run(refused.api)).rejects.toThrowError('AUDIO_CODEC_NOT_ENABLED');
    expect(refused.api.uploadDirectStem).not.toHaveBeenCalled();

    const disposed = fakeApi();
    await expect(run(disposed.api, true)).rejects.toMatchObject({ code: 'INVALID_DRAFT' });
    expect(disposed.api.reserve).not.toHaveBeenCalled();

    const abort = new AbortController();
    const aborted = fakeApi({ uploadDirectStem: vi.fn(async () => { abort.abort(); return { id: 'u', status: 'uploading', uploadedStemIds: ['vocals'], expiresAt: 1, transfer: 'direct' }; }) as never });
    await expect(run(aborted.api, false, abort.signal)).rejects.toBeDefined();
    expect(aborted.api.finalize).not.toHaveBeenCalled();
  });
});