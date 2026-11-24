import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_AUDIO_SECONDS,
  MAX_AUDIO_WAV_BYTES,
  MAX_SEPARATION_TOTAL_FRAMES,
  decodeWavToStereoFloat32,
  encodeStereoPcm16Wav,
} from './demucs-onnx-separator';
import { MAX_MINISTRY_AUDIO_SECONDS, MAX_MINISTRY_STEM_BYTES } from '../ministry-audio-contract';

const SR = 44_100;

function silentWav(frames: number): ArrayBuffer {
  const bytes = encodeStereoPcm16Wav({ sampleRate: SR, left: new Float32Array(frames), right: new Float32Array(frames) });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('M22-E2 duration limits (300 s)', () => {
  it('keeps the three limits consistent and aligned with the publishing contract', () => {
    expect(DEFAULT_MAX_AUDIO_SECONDS).toBe(300);
    expect(MAX_SEPARATION_TOTAL_FRAMES).toBe(SR * 300);
    expect(44 + MAX_SEPARATION_TOTAL_FRAMES * 4).toBeLessThanOrEqual(MAX_AUDIO_WAV_BYTES);
    // an input of exactly the maximum must not be rejected for size, yet the cap stays tight (< +15% headroom)
    expect(MAX_AUDIO_WAV_BYTES).toBeLessThan((44 + MAX_SEPARATION_TOTAL_FRAMES * 4) * 1.15);
    expect(MAX_MINISTRY_AUDIO_SECONDS).toBeGreaterThanOrEqual(DEFAULT_MAX_AUDIO_SECONDS);
    // a produced 44.1 kHz stem of the maximum duration fits the publication/size contract
    expect(44 + MAX_SEPARATION_TOTAL_FRAMES * 4).toBeLessThanOrEqual(MAX_MINISTRY_STEM_BYTES);
  });

  it.each([180, 240, 300])('decodes a %i s WAV', (seconds) => {
    const wav = silentWav(SR * seconds);
    expect(wav.byteLength).toBeLessThanOrEqual(MAX_AUDIO_WAV_BYTES);
    const audio = decodeWavToStereoFloat32(wav, { expectedSampleRate: SR });
    expect(audio.totalFrames).toBe(SR * seconds);
  });

  it('rejects a WAV longer than 300 s before allocating samples', () => {
    const wav = silentWav(SR * 300 + 1);
    expect(() => decodeWavToStereoFloat32(wav, { expectedSampleRate: SR })).toThrow(/exceeds decode cap/);
    const way = silentWav(SR * 301);
    expect(() => decodeWavToStereoFloat32(way, { expectedSampleRate: SR })).toThrow(/exceeds decode cap/);
  });
});
