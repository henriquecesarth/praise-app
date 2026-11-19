import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MinistryAudioPlayback } from './ministry-audio-contract';
import { prepareMinistryMixerTracks } from './ministry-audio-files';

interface Case { name: string; base: 'pcm' | 'mp3'; patch: Record<string, unknown>; contractValid: boolean; webPlayable: boolean }
const fixture = JSON.parse(readFileSync(
  resolve(__dirname, '../../../shared/fixtures/ministry-audio-contract-v2/stem-cases.json'), 'utf8')) as
  { base: Record<'pcm' | 'mp3', Record<string, unknown>>; cases: Case[] };

const IDS = ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'] as const;

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

function playback(schemaVersion: 1 | 2, stem: Record<string, unknown>): MinistryAudioPlayback {
  return {
    manifest: {
      schemaVersion, recordingId: 'r'.repeat(64), recordingVersion: 'V', model: { id: 'm', version: '1' },
      stems: IDS.map((id) => ({ ...structuredClone(stem), id })) as MinistryAudioPlayback['manifest']['stems'],
    },
    tracks: IDS.map((id) => ({ id, url: `https://example.invalid/${id}` })),
    expiresAt: 1,
  };
}

const prepare = (value: MinistryAudioPlayback) =>
  prepareMinistryMixerTracks('r'.repeat(64), value, async () => new Uint8Array());

describe('ministry audio reader contract (shared fixtures)', () => {
  for (const testCase of fixture.cases) {
    it(`${testCase.name}: v1 and v2 playable=${testCase.webPlayable}`, () => {
      const stem = applyPatch(fixture.base[testCase.base], testCase.patch);
      for (const version of [1, 2] as const) {
        const run = () => prepare(playback(version, stem));
        if (testCase.webPlayable) expect(run()).toHaveLength(6); else expect(run).toThrow('Dados de reprodução inválidos.');
      }
    });
  }

  it('rejects negative duration and stems with divergent rate or frames before any download', () => {
    expect(() => prepare(playback(1, { ...fixture.base.pcm, durationSeconds: -1 }))).toThrow();
    const value = playback(1, fixture.base.pcm);
    (value.manifest.stems[3] as { frames: number; sizeBytes: number; durationSeconds: number }).frames = 44100;
    (value.manifest.stems[3] as { sizeBytes: number }).sizeBytes = 44 + 44100 * 4;
    (value.manifest.stems[3] as { durationSeconds: number }).durationSeconds = 1;
    expect(() => prepare(value)).toThrow();
  });

  it('rejects unknown manifest versions and keeps v1 track fields unchanged', () => {
    expect(() => prepare(playback(3 as 1, fixture.base.pcm))).toThrow();
    const [first] = prepare(playback(1, fixture.base.pcm));
    expect(first).toMatchObject({ id: 'vocals', sampleRate: 44100, totalFrames: 1323000, byteLength: 5292044 });
  });
});
