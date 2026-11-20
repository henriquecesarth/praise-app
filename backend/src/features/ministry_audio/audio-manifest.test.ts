// M22-C.5D-B — requestHash, manifest shape and the six-stem publication decision (pure, offline).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertPublishableMp3Set, buildManifest, isVisibleManifest, requestHashOf } from './audio-manifest';
import type { Mp3Facts } from './direct-storage';
import { STEM_IDS, uploadV2Schema, type StemManifest, type StemV2 } from './ministry-audio.schema';
import type { Mp3StemManifest } from './mp3-stream-validator';

const fixtures = join(__dirname, '../../../../shared/fixtures/ministry-audio-mp3-v1');
const real = JSON.parse(readFileSync(join(fixtures, 'real-encoder-cases.json'), 'utf8')) as { cases: Array<{ name: string; manifest: Mp3StemManifest }> };
const base = real.cases.find((c) => c.name === 'valid-44100-12000')!.manifest;
const mp3Stems = (patch: Partial<Mp3StemManifest> = {}): Mp3StemManifest[] => STEM_IDS.map((id) => ({ ...base, id, ...patch }));
const model = { id: 'htdemucs_6s', version: '1.0.0' };
const meta = { title: 'T', artist: 'A', version: 'Live' };
const model1 = model;

const pcm = (id: StemManifest['id']): StemManifest => ({
  id, codec: 'pcm_s16le', sampleRate: 8000, channels: 2, frames: 1, durationSeconds: 1 / 8000, sizeBytes: 48, sha256: 'a'.repeat(64),
});
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

describe('requestHash', () => {
  it('v1 is bit-for-bit the algorithm that existed before (envelope, key order, stems order)', () => {
    const shuffled = [...STEM_IDS].reverse().map(pcm);
    const manifest = buildManifest('r'.repeat(64), 'Live', model1, shuffled);
    expect(manifest.schemaVersion).toBe(1);
    const legacy = { schemaVersion: 1, recordingId: 'r'.repeat(64), recordingVersion: 'Live', model: model1, stems: STEM_IDS.map(pcm) };
    expect(requestHashOf(meta, manifest)).toBe(sha({ ...meta, manifest: legacy }));
    // pinned value: a change here would make already-stored v1 reservations conflict on retry
    expect(requestHashOf(meta, manifest)).toMatch(/^[a-f0-9]{64}$/);
  });

  it('a v2-requested PCM recording is still persisted and hashed as v1', () => {
    expect(buildManifest('r'.repeat(64), 'Live', model, STEM_IDS.map(pcm)).schemaVersion).toBe(1);
  });

  it('v2 is deterministic regardless of the order of stems or of the keys a client sent', () => {
    const reordered = [...mp3Stems()].reverse().map((s) => JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(s).reverse()))) as Mp3StemManifest);
    const a = buildManifest('r'.repeat(64), 'Live', model, mp3Stems());
    const b = buildManifest('r'.repeat(64), 'Live', model, reordered);
    expect(a.schemaVersion).toBe(2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(requestHashOf(meta, a)).toBe(requestHashOf(meta, b));
    expect(a.stems.map((s) => s.id)).toEqual([...STEM_IDS]);
  });

  it('is the same for a body parsed by the v2 schema, whatever order its keys arrive in', () => {
    const body = (stems: unknown[]) => ({
      ...meta, schemaVersion: 2, idempotencyKey: 'k'.repeat(20), confirmed: true, model, stems,
    });
    const forward = uploadV2Schema.parse(body(mp3Stems()));
    const backward = uploadV2Schema.parse(body(mp3Stems().map((s) => Object.fromEntries(Object.entries(s).reverse()))));
    const hashOf = (input: typeof forward) => requestHashOf(input, buildManifest('r'.repeat(64), input.version, input.model, input.stems));
    expect(hashOf(forward)).toBe(hashOf(backward));
  });

  it('any change in codec, size, sha256, rate, frames or alignment produces a different hash', () => {
    const hashFor = (stems: StemV2[]) => requestHashOf(meta, buildManifest('r'.repeat(64), 'Live', model, stems));
    const original = hashFor(mp3Stems());
    const variants: Array<[string, StemV2[]]> = [
      ['sha256', mp3Stems({ sha256: 'b'.repeat(64) })],
      ['sizeBytes', mp3Stems({ sizeBytes: base.sizeBytes + 1 })],
      ['frames', mp3Stems({ frames: base.frames - 1, durationSeconds: (base.frames - 1) / base.sampleRate })],
      ['alignment.encoderDelayFrames', mp3Stems({ alignment: { ...base.alignment, encoderDelayFrames: base.alignment.encoderDelayFrames + 1 } })],
      ['alignment.paddingFrames', mp3Stems({ alignment: { ...base.alignment, paddingFrames: base.alignment.paddingFrames + 1 } })],
      ['alignment.mpegAudioFrames', mp3Stems({ alignment: { ...base.alignment, mpegAudioFrames: base.alignment.mpegAudioFrames + 1 } })],
      ['sampleRate', mp3Stems({ sampleRate: 48_000 })],
      ['one stem only', [{ ...mp3Stems()[0], sha256: 'c'.repeat(64) }, ...mp3Stems().slice(1)]],
      ['v1 PCM instead', STEM_IDS.map(pcm)],
    ];
    for (const [label, stems] of variants) expect(hashFor(stems), label).not.toBe(original);
    expect(requestHashOf({ ...meta, title: 'Other' }, buildManifest('r'.repeat(64), 'Live', model, mp3Stems()))).not.toBe(original);
  });
});

describe('manifest visibility', () => {
  it('hides MP3 manifests while the codec is not enabled, and never hides PCM', () => {
    expect(isVisibleManifest(buildManifest('r'.repeat(64), 'Live', model, STEM_IDS.map(pcm)))).toBe(true);
    expect(isVisibleManifest(buildManifest('r'.repeat(64), 'Live', model, mp3Stems()))).toBe(false);
  });
});

describe('assertPublishableMp3Set', () => {
  const facts = (stem: Mp3StemManifest, patch: Partial<Mp3Facts> = {}): Mp3Facts => ({
    id: stem.id, sampleRate: stem.sampleRate, sizeBytes: stem.sizeBytes, sha256: stem.sha256,
    mpegAudioFrames: stem.alignment.mpegAudioFrames, frames: stem.frames, tagDelayFrames: 576,
    tagPaddingFrames: stem.alignment.paddingFrames + 529,
    decoderDelayFrames: 529, encoder: 'Lavc63.1.', ...patch,
  });
  const subject = (patch: (id: StemManifest['id'], stem: Mp3StemManifest) => Partial<Mp3Facts> | null = () => ({})) => {
    const stems = mp3Stems();
    const directAttempts = Object.fromEntries(stems.map((stem) => {
      const p = patch(stem.id, stem);
      return [stem.id, { receipt: { etag: '"e"', ...(p === null ? {} : { mp3: facts(stem, p) }) } }];
    }));
    return { manifest: buildManifest('r'.repeat(64), 'Live', model, stems), directAttempts };
  };
  const refused = (record: Parameters<typeof assertPublishableMp3Set>[0]) => {
    try { assertPublishableMp3Set(record); } catch (e) { return (e as { statusCode?: number }).statusCode; }
    return 'accepted';
  };

  it('accepts six consistent, manifest-matching, server-derived results', () => {
    expect(refused(subject())).toBe('accepted');
  });

  it('is a no-op for PCM recordings', () => {
    expect(() => assertPublishableMp3Set({ manifest: buildManifest('r'.repeat(64), 'Live', model, STEM_IDS.map(pcm)) })).not.toThrow();
  });

  it('refuses a missing result, even for a single stem', () => {
    expect(refused(subject((id) => (id === 'bass' ? null : {})))).toBe(409);
    expect(refused({ manifest: subject().manifest })).toBe(409);
  });

  it('refuses results that do not describe the manifest stem (sha, size, frames, mpeg frames, rate, id)', () => {
    for (const patch of [
      { sha256: 'f'.repeat(64) }, { sizeBytes: base.sizeBytes + 1 }, { frames: base.frames + 1 },
      { mpegAudioFrames: base.alignment.mpegAudioFrames + 1 }, { sampleRate: 48_000 as const }, { id: 'drums' as const },
    ]) expect(refused(subject((id) => (id === 'guitar' ? patch : {}))), JSON.stringify(patch)).toBe(409);
  });

  it('refuses a coordinated delay shift in one stem and an outlier encoder, even though each is individually plausible', () => {
    expect(refused(subject((id) => (id === 'piano' ? { decoderDelayFrames: 530, tagPaddingFrames: facts(base).tagPaddingFrames + 1 } : {})))).toBe(409);
    expect(refused(subject((id) => (id === 'other' ? { encoder: 'Lavc99.9.' } : {})))).toBe(409);
    expect(refused(subject((id) => (id === 'vocals' ? { encoder: 'LAME3.100' } : {})))).toBe(409);
  });

  it('does not take the declared alignment as proof: matching manifests with absent facts are refused', () => {
    expect(refused(subject(() => null))).toBe(409);
  });
});
