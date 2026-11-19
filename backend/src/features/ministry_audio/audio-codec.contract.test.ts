import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../middleware/error-handler';
import {
  AUDIO_CODECS, CODEC_PROFILES, MAX_MP3_ALIGNMENT_FRAMES, isPublishableCodec, mp3SizeBounds,
} from './audio-codec';
import { MinistryAudioService } from './ministry-audio.service';
import {
  STEM_IDS, mp3StemSchema, requirePublishableStems, selectUploadSchema, stemSchema, stemV2Schema, uploadSchema, uploadV2Schema,
} from './ministry-audio.schema';
import type { StemStorage } from './storage';

interface Case { name: string; base: 'pcm' | 'mp3'; patch: Record<string, unknown>; contractValid: boolean; reason?: string | string[] }
const fixture = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../shared/fixtures/ministry-audio-contract-v2/stem-cases.json'), 'utf8')) as
  { base: Record<'pcm' | 'mp3', Record<string, unknown>>; cases: Case[] };

function applyPatch(base: Record<string, unknown>, patch: Record<string, unknown>) {
  const out = structuredClone(base) as Record<string, any>;
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.');
    const last = keys.pop() as string;
    const target = keys.reduce((node, key) => node[key], out);
    if (value === null) delete target[last]; else target[last] = value;
  }
  return out;
}

const sixStems = (stem: Record<string, unknown>) => STEM_IDS.map((id) => ({ ...structuredClone(stem), id }));
const common = { title: 'T', artist: 'A', version: 'V', idempotencyKey: 'k'.repeat(24), confirmed: true, model: { id: 'm', version: '1' } };
const v1Body = (stems = sixStems(fixture.base.pcm)) => ({ ...common, stems });
const v2Body = (stems: unknown[]) => ({ ...common, schemaVersion: 2, stems });

describe('codec profiles', () => {
  it('maps codec to extension and MIME, keeping WAV/audio/wav for existing objects', () => {
    expect(CODEC_PROFILES.pcm_s16le).toMatchObject({ extension: 'wav', mime: 'audio/wav', maxBytes: 44 + 48_000 * 300 * 4 });
    expect(CODEC_PROFILES.mp3_cbr256).toMatchObject({ extension: 'mp3', mime: 'audio/mpeg' });
    expect(AUDIO_CODECS).toEqual(['pcm_s16le', 'mp3_cbr256']);
  });

  it('has independent limits per codec', () => {
    expect(CODEC_PROFILES.mp3_cbr256.maxBytes).toBeLessThan(CODEC_PROFILES.pcm_s16le.maxBytes / 4);
    expect(CODEC_PROFILES.mp3_cbr256.minSampleRate).toBe(44_100);
  });

  it('keeps mp3 unpublishable until byte validation exists', () => {
    expect(isPublishableCodec('pcm_s16le')).toBe(true);
    expect(isPublishableCodec('mp3_cbr256')).toBe(false);
  });

  it('computes CBR size bounds without encoder-specific constants', () => {
    expect(mp3SizeBounds(44_100, 1150)).toEqual({ min: 1151 * 835, max: 1151 * 836 });
    expect(mp3SizeBounds(48_000, 1251)).toEqual({ min: 1252 * 768, max: 1252 * 768 });
  });
});

describe('stem contract (shared fixtures)', () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const stem = applyPatch(fixture.base[testCase.base], testCase.patch);
      expect(stemV2Schema.safeParse(stem).success).toBe(testCase.contractValid);
      if (testCase.reason) {
        // Rejected for exactly the documented reason (single cause), not by accident.
        const result = mp3StemSchema.safeParse(stem);
        expect(result.success).toBe(false);
        const issues = result.success ? [] : result.error.issues.map((issue) => `${issue.path.join('.')}|${issue.message}`);
        const reasons = [testCase.reason].flat();
        expect(issues.length).toBeGreaterThan(0);
        for (const issue of issues) {
          expect(reasons.some((reason) => issue.includes(reason)), `unexpected rejection: ${issue}`).toBe(true);
        }
      }
    });
  }

  it('serialization round-trips and v1 pcm stems stay byte-identical', () => {
    for (const key of ['pcm', 'mp3'] as const) {
      const parsed = stemV2Schema.parse(fixture.base[key]);
      expect(JSON.parse(JSON.stringify(parsed))).toEqual(fixture.base[key]);
    }
    expect(stemSchema.parse(fixture.base.pcm)).toEqual(fixture.base.pcm);
    // Key order feeds the v1 requestHash (JSON.stringify of the parsed manifest): pin it.
    expect(JSON.stringify(uploadSchema.parse(v1Body()).stems[0])).toBe(
      '{"id":"vocals","codec":"pcm_s16le","sampleRate":44100,"channels":2,"durationSeconds":30,"frames":1323000,' +
      '"sizeBytes":5292044,"sha256":"' + 'a'.repeat(64) + '"}');
    expect(stemSchema.safeParse(fixture.base.mp3).success).toBe(false);
  });
});

describe('upload request versions', () => {
  it('keeps the v1 request shape unchanged', () => {
    expect(selectUploadSchema(v1Body())).toBe(uploadSchema);
    expect(uploadSchema.safeParse(v1Body()).success).toBe(true);
  });

  it('rejects v1 bodies carrying schemaVersion 1 or unknown versions', () => {
    for (const schemaVersion of [1, 3, '2', null]) {
      expect(selectUploadSchema({ ...v1Body(), schemaVersion }).safeParse({ ...v1Body(), schemaVersion }).success).toBe(false);
    }
  });

  it('v1 rejects mp3 stems and new fields', () => {
    expect(uploadSchema.safeParse(v1Body(sixStems(fixture.base.mp3))).success).toBe(false);
  });

  it('accepts a homogeneous v2 mp3 body and a v2 pcm body', () => {
    expect(selectUploadSchema(v2Body([]))).toBe(uploadV2Schema);
    expect(uploadV2Schema.safeParse(v2Body(sixStems(fixture.base.mp3))).success).toBe(true);
    expect(uploadV2Schema.safeParse(v2Body(sixStems(fixture.base.pcm))).success).toBe(true);
  });

  it('rejects mixed codecs, divergent alignment/frames/rate and duplicate ids in v2', () => {
    const mp3 = sixStems(fixture.base.mp3) as Array<Record<string, any>>;
    const pcm = sixStems(fixture.base.pcm);
    expect(uploadV2Schema.safeParse(v2Body([...mp3.slice(0, 5), pcm[5]])).success).toBe(false);
    const delay = structuredClone(mp3);
    delay[2].alignment.encoderDelayFrames = 576;
    delay[2].alignment.paddingFrames = 1224;
    expect(stemV2Schema.safeParse(delay[2]).success).toBe(true);
    expect(uploadV2Schema.safeParse(v2Body(delay)).success).toBe(false);
    // Each stem is individually valid; only the cross-stem rule fails.
    const rate = structuredClone(mp3);
    Object.assign(rate[4], { sampleRate: 48_000, frames: 1_440_000, durationSeconds: 30, sizeBytes: 961_536,
      alignment: { encoderDelayFrames: 1105, paddingFrames: 47, mpegAudioFrames: 1251, infoFrame: true } });
    expect(stemV2Schema.safeParse(rate[4]).success).toBe(true);
    expect(uploadV2Schema.safeParse(v2Body(rate)).success).toBe(false);
    const frames = structuredClone(mp3);
    Object.assign(frames[5], { frames: 1_322_000, durationSeconds: 1_322_000 / 44_100, sizeBytes: 960_500,
      alignment: { encoderDelayFrames: 1105, paddingFrames: 543, mpegAudioFrames: 1149, infoFrame: true } });
    expect(stemV2Schema.safeParse(frames[5]).success).toBe(true);
    expect(uploadV2Schema.safeParse(v2Body(frames)).success).toBe(false);
    const duplicate = structuredClone(mp3);
    duplicate[1].id = 'vocals';
    expect(uploadV2Schema.safeParse(v2Body(duplicate)).success).toBe(false);
    const short = sixStems(fixture.base.mp3).slice(0, 5);
    expect(uploadV2Schema.safeParse(v2Body(short)).success).toBe(false);
  });

  it('selector is unambiguous: extra or mismatched fields never bypass a version', () => {
    const mp3 = sixStems(fixture.base.mp3);
    // v1 (no schemaVersion) with v2-only content or extra top-level keys is rejected.
    expect(uploadSchema.safeParse(v1Body(mp3)).success).toBe(false);
    expect(uploadSchema.safeParse({ ...v1Body(), alignment: {} }).success).toBe(false);
    expect(uploadSchema.safeParse({ ...v1Body(), codec: 'mp3_cbr256' }).success).toBe(false);
    // v2 with extra keys or non-numeric/odd versions is rejected.
    expect(uploadV2Schema.safeParse({ ...v2Body(mp3), extra: true }).success).toBe(false);
    for (const body of [null, [], 'x', 7, { ...v2Body(mp3), schemaVersion: '2' }, { ...v2Body(mp3), schemaVersion: null }, { ...v2Body(mp3), schemaVersion: [2] }]) {
      expect(selectUploadSchema(body).safeParse(body).success).toBe(false);
    }
    // A pcm stem cannot smuggle an mp3 alignment block, and an mp3 stem cannot omit it.
    const pcmWithAlignment = { ...fixture.base.pcm, alignment: fixture.base.mp3.alignment };
    expect(stemV2Schema.safeParse(pcmWithAlignment).success).toBe(false);
  });

  it('bounds alignment independently of any encoder', () => {
    expect(MAX_MP3_ALIGNMENT_FRAMES).toBe(4608);
  });
});

describe('publication gate (fail-closed)', () => {
  const parsedMp3 = () => uploadV2Schema.parse(v2Body(sixStems(fixture.base.mp3)));

  it('requirePublishableStems rejects a contract-valid mp3 declaration', () => {
    expect(() => requirePublishableStems(parsedMp3().stems)).toThrowError(AppError);
    try { requirePublishableStems(parsedMp3().stems); } catch (error) {
      expect((error as AppError).statusCode).toBe(422);
      expect(JSON.stringify((error as AppError).details)).toContain('AUDIO_CODEC_NOT_ENABLED');
    }
  });

  it('requirePublishableStems passes v1-shaped pcm stems through', () => {
    const stems = uploadSchema.parse(v1Body()).stems;
    expect(requirePublishableStems(stems)).toHaveLength(6);
  });

  it('service.reserve authorizes first, then rejects mp3 without any repository write', async () => {
    const service = new MinistryAudioService({} as StemStorage);
    const repository = (service as unknown as { repository: { authorize: () => Promise<void>; reserve: () => Promise<unknown> } }).repository;
    const authorize = vi.spyOn(repository, 'authorize').mockResolvedValue();
    const reserve = vi.spyOn(repository, 'reserve');
    await expect(service.reserve({ ministryId: 'm1', userId: 'u1' }, parsedMp3())).rejects.toMatchObject({ statusCode: 422 });
    expect(authorize).toHaveBeenCalledOnce();
    expect(reserve).not.toHaveBeenCalled();
    authorize.mockRejectedValueOnce(new AppError(403, 'sem permissão'));
    await expect(service.reserve({ ministryId: 'm1', userId: 'u2' }, parsedMp3())).rejects.toMatchObject({ statusCode: 403 });
  });
});
