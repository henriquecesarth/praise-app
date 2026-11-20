import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MP3_CALIBRATION_PROBES, MP3_PROBE_CLICKS_L, MP3_PROBE_CLICKS_R } from './mp3-calibration-probes';

// shared/fixtures/ministry-audio-mp3-v1/probes.json is the language-neutral source of truth the backend tests read.
// A missing or divergent file FAILS here (readFileSync throws); nothing is skipped.
const SHARED = resolve(__dirname, '../../../shared/fixtures/ministry-audio-mp3-v1/probes.json');

describe('MP3 calibration probes: web module == shared fixture', () => {
  const shared = JSON.parse(readFileSync(SHARED, 'utf8'));

  it('has the expected envelope', () => {
    expect(shared).toMatchObject({ format: 'louvaio.ministry-audio-mp3-probes', version: 1, frames: 6000 });
    expect(Object.keys(shared.probes).sort()).toEqual(['44100', '48000']);
  });

  it('click positions are identical', () => {
    expect(shared.clicksL).toEqual([...MP3_PROBE_CLICKS_L]);
    expect(shared.clicksR).toEqual([...MP3_PROBE_CLICKS_R]);
  });

  it.each([44100, 48000] as const)('%i Hz probe bytes, hash and alignment are identical', (sr) => {
    const a = shared.probes[String(sr)];
    const b = MP3_CALIBRATION_PROBES[sr];
    expect(a).toEqual({ sampleRate: b.sampleRate, frames: b.frames, alignment: { ...b.alignment, infoFrame: true }, sha256: b.sha256, base64: b.base64 });
    expect(createHash('sha256').update(Buffer.from(b.base64, 'base64')).digest('hex')).toBe(b.sha256);
  });
});
