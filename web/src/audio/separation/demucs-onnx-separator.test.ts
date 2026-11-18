import { describe, expect, it, vi } from 'vitest';
import {
  AudioSeparationModelRegistry,
  CANONICAL_STEM_IDS,
  HTDEMUCS_6S_ONNX_DESCRIPTOR,
  MAX_MODEL_BYTES,
  createOrtWebSessionAdapter,
  createOverlapWindow,
  decodeWavToStereoFloat32,
  encodeStereoPcm16Wav,
  readBoundedResponseBytes,
  separateStereoAudio,
  validateModelDescriptor,
  type AudioSeparationModelDescriptor,
  type CanonicalStemId,
  type ExecutionProviderName,
  type OnnxInferenceSessionHandle,
  type SeparationProgressEvent,
} from './demucs-onnx-separator';

function buildCustomWavBuffer(params: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  samples: number[];
  overrideRiffChunkSize?: number;
  overrideBlockAlign?: number;
  overrideByteRate?: number;
  trailingBytes?: number;
  truncateDataByBytes?: number;
}): ArrayBuffer {
  const { sampleRate, channels, bitsPerSample, audioFormat, samples } = params;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = params.overrideBlockAlign ?? channels * bytesPerSample;
  const byteRate = params.overrideByteRate ?? sampleRate * (channels * bytesPerSample);
  const dataBytes = samples.length * bytesPerSample;
  const oddPadByte = dataBytes % 2;
  const riffSize =
    params.overrideRiffChunkSize ?? 36 + dataBytes + oddPadByte + (params.trailingBytes ?? 0);
  const actualBufBytes = Math.max(
    44,
    44 + dataBytes + oddPadByte + (params.trailingBytes ?? 0) - (params.truncateDataByBytes ?? 0)
  );
  const buf = new ArrayBuffer(actualBufBytes);
  const view = new DataView(buf);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, riffSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, audioFormat, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < samples.length; i++) {
    const offset = 44 + i * bytesPerSample;
    if (offset + bytesPerSample > actualBufBytes) {
      break;
    }
    const v = samples[i];
    if (audioFormat === 3 && bitsPerSample === 32) {
      view.setFloat32(offset, v, true);
    } else if (audioFormat === 1 && bitsPerSample === 16) {
      view.setInt16(offset, Math.round(v), true);
    } else if (audioFormat === 1 && bitsPerSample === 24) {
      const iv = Math.round(v);
      view.setUint8(offset, iv & 0xff);
      view.setUint8(offset + 1, (iv >> 8) & 0xff);
      view.setUint8(offset + 2, (iv >> 16) & 0xff);
    }
  }

  return buf;
}

function buildExtensibleWavBuffer(params: {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  subFormatTag: number;
  guidTail?: number[];
  cbSize?: number;
  samples: number[];
}): ArrayBuffer {
  const bytesPerSample = params.bitsPerSample / 8;
  const blockAlign = params.channels * bytesPerSample;
  const byteRate = params.sampleRate * blockAlign;
  const dataBytes = params.samples.length * bytesPerSample;
  const fmtSize = 40;
  const riffSize = 4 + (8 + fmtSize) + (8 + dataBytes);
  const buf = new ArrayBuffer(8 + riffSize);
  const view = new DataView(buf);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, riffSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, fmtSize, true);
  view.setUint16(20, 0xfffe, true);
  view.setUint16(22, params.channels, true);
  view.setUint32(24, params.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, params.bitsPerSample, true);
  view.setUint16(36, params.cbSize ?? 22, true);
  view.setUint16(38, params.bitsPerSample, true);
  view.setUint32(40, params.channels === 2 ? 0x3 : 0x4, true);
  view.setUint32(44, params.subFormatTag, true);

  const defaultTail = [0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71];
  const tail = params.guidTail ?? defaultTail;
  for (let i = 0; i < tail.length; i++) {
    view.setUint8(48 + i, tail[i]);
  }

  writeAscii(60, 'data');
  view.setUint32(64, dataBytes, true);
  for (let i = 0; i < params.samples.length; i++) {
    const off = 68 + i * bytesPerSample;
    if (params.subFormatTag === 3) {
      view.setFloat32(off, params.samples[i], true);
    } else {
      view.setInt16(off, Math.round(params.samples[i]), true);
    }
  }
  return buf;
}

describe('demucs-onnx-separator (M22-A)', () => {
  it('validates default 6-stem HTDemucs descriptor, enforces complete 6-stem permutations, and registers future models', () => {
    expect(() => validateModelDescriptor(HTDEMUCS_6S_ONNX_DESCRIPTOR)).not.toThrow();
    expect(HTDEMUCS_6S_ONNX_DESCRIPTOR.canonicalStemOrder).toEqual([
      'vocals',
      'drums',
      'bass',
      'guitar',
      'piano',
      'other',
    ]);
    expect(HTDEMUCS_6S_ONNX_DESCRIPTOR.rawOutputStemOrder).toEqual([
      'drums',
      'bass',
      'other',
      'vocals',
      'guitar',
      'piano',
    ]);

    const registry = new AudioSeparationModelRegistry([HTDEMUCS_6S_ONNX_DESCRIPTOR]);
    const futureModel: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      id: 'htdemucs_6s_webgpu_future',
      displayName: 'HT-Demucs 6S WebGPU Optimized',
      version: 'v5-webgpu',
      segmentSamples: 1024,
      rawOutputStemOrder: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'],
      expectedModelSha256: undefined,
      expectedModelBytes: undefined,
    };
    registry.register(futureModel);
    expect(registry.list()).toHaveLength(2);
    expect(registry.get('htdemucs_6s_webgpu_future')?.version).toBe('v5-webgpu');

    // Incomplete stem descriptor (e.g. vocals only) must be rejected.
    expect(() =>
      registry.register({
        ...futureModel,
        id: 'incomplete_stems',
        rawOutputStemOrder: ['vocals'],
        canonicalStemOrder: ['vocals'],
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));

    expect(() =>
      registry.register({
        ...futureModel,
        id: 'broken_stems',
        rawOutputStemOrder: ['vocals', 'vocals', 'bass', 'guitar', 'piano', 'other'],
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));

    expect(() =>
      registry.register({
        ...futureModel,
        id: 'bad_overlap',
        defaultOverlapRatio: 0.5,
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
  });

  it('requires checksum verification when loading a pinned model descriptor', async () => {
    await expect(
      createOrtWebSessionAdapter(new Uint8Array([1, 2, 3, 4]), HTDEMUCS_6S_ONNX_DESCRIPTOR, {
        verifyModelChecksum: false,
      })
    ).rejects.toMatchObject({ code: 'MODEL_CHECKSUM_MISMATCH' });
  });

  it('encodes and decodes PCM16 stereo WAV, WAVE_FORMAT_EXTENSIBLE, and promotes mono WAV to stereo', () => {
    const left = new Float32Array([0, 0.25, -0.5, 0.75, -1.0, 0.125]);
    const right = new Float32Array([0.1, -0.25, 0.5, -0.75, 0.9, -0.125]);
    const encoded = encodeStereoPcm16Wav({ sampleRate: 44100, left, right });

    const decoded = decodeWavToStereoFloat32(encoded.slice().buffer, {
      expectedSampleRate: 44100,
    });
    expect(decoded.sampleRate).toBe(44100);
    expect(decoded.totalFrames).toBe(6);
    expect(decoded.sourceChannels).toBe(2);
    for (let i = 0; i < left.length; i++) {
      expect(decoded.left[i]).toBeCloseTo(left[i], 3);
      expect(decoded.right[i]).toBeCloseTo(right[i], 3);
    }

    const monoWav = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 24,
      audioFormat: 1,
      samples: [0, 4194304, -4194304],
    });
    const decodedMono = decodeWavToStereoFloat32(monoWav, {
      expectedSampleRate: 44100,
    });
    expect(decodedMono.sourceChannels).toBe(1);
    expect(decodedMono.channels).toBe(2);
    expect(decodedMono.totalFrames).toBe(3);
    expect(decodedMono.left[1]).toBeCloseTo(0.5, 4);
    expect(decodedMono.right[1]).toBeCloseTo(0.5, 4);

    const extWav = buildExtensibleWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 32,
      subFormatTag: 3,
      samples: [0.5, -0.5, 0.25, -0.25],
    });
    const decodedExt = decodeWavToStereoFloat32(extWav, {
      expectedSampleRate: 44100,
    });
    expect(decodedExt.totalFrames).toBe(2);
    expect(decodedExt.left[0]).toBeCloseTo(0.5, 5);
    expect(decodedExt.right[1]).toBeCloseTo(-0.25, 5);
  });

  it('rejects empty, corrupt, undersized RIFF, contradictory blockAlign, partial frames, invalid extensible GUID, and NaN WAV inputs', () => {
    expect(() => decodeWavToStereoFloat32(new ArrayBuffer(0))).toThrowError(
      expect.objectContaining({ code: 'EMPTY_AUDIO' })
    );

    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6]).buffer;
    expect(() => decodeWavToStereoFloat32(garbage)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_WAV' })
    );

    const truncated = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      audioFormat: 1,
      samples: [1000, -1000, 2000, -2000],
      truncateDataByBytes: 2,
    });
    expect(() => decodeWavToStereoFloat32(truncated)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_WAV' })
    );

    const undersizedRiff = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      audioFormat: 1,
      samples: [1000, -1000, 2000, -2000],
      overrideRiffChunkSize: 36,
    });
    expect(() => decodeWavToStereoFloat32(undersizedRiff)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_WAV' })
    );

    const badBlockAlign = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      audioFormat: 1,
      samples: [1000, -1000, 2000, -2000],
      overrideBlockAlign: 2,
    });
    expect(() => decodeWavToStereoFloat32(badBlockAlign)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_WAV' })
    );

    // 3 PCM16 samples = 6 bytes with stereo blockAlign 4 -> partial final frame
    const partialFrame = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      audioFormat: 1,
      samples: [1000, -1000, 2000],
    });
    expect(() => decodeWavToStereoFloat32(partialFrame)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_WAV' })
    );

    const wrongGuidTail = buildExtensibleWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      subFormatTag: 1,
      guidTail: [0x01, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71],
      samples: [100, -100],
    });
    expect(() => decodeWavToStereoFloat32(wrongGuidTail)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_WAV_FORMAT' })
    );

    const wrongRate = buildCustomWavBuffer({
      sampleRate: 48000,
      channels: 2,
      bitsPerSample: 16,
      audioFormat: 1,
      samples: [1000, -1000, 2000, -2000],
    });
    expect(() =>
      decodeWavToStereoFloat32(wrongRate, { expectedSampleRate: 44100 })
    ).toThrowError(expect.objectContaining({ code: 'SAMPLE_RATE_MISMATCH' }));

    const threeCh = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 3,
      bitsPerSample: 16,
      audioFormat: 1,
      samples: [100, 200, 300],
    });
    expect(() => decodeWavToStereoFloat32(threeCh)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CHANNELS' })
    );

    const nanFloatWav = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 32,
      audioFormat: 3,
      samples: [0.1, Number.NaN],
    });
    expect(() => decodeWavToStereoFloat32(nanFloatWav)).toThrowError(
      expect.objectContaining({ code: 'NON_FINITE_AUDIO' })
    );
  });

  it('creates strictly-positive trapezoidal overlap windows whose fade-in and fade-out sum to 1.0', () => {
    const window = createOverlapWindow(16, 4);
    expect(window.length).toBe(16);
    for (let i = 0; i < window.length; i++) {
      expect(window[i]).toBeGreaterThan(0);
      expect(window[i]).toBeLessThanOrEqual(1);
    }
    for (let k = 0; k < 4; k++) {
      expect(window[k]).toBeCloseTo(window[15 - k], 6);
      expect(window[k] + window[12 + k]).toBeCloseTo(1, 6);
    }
    for (let i = 4; i < 12; i++) {
      expect(window[i]).toBe(1);
    }
  });

  it('maps raw stem order to canonical 6-stem order and stitches multi-chunk overlap-add identically', async () => {
    const descriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      id: 'test_6s_small',
      segmentSamples: 16,
      defaultOverlapRatio: 0.25,
      expectedModelSha256: undefined,
      expectedModelBytes: undefined,
    };

    const totalFrames = 30;
    const left = new Float32Array(totalFrames);
    const right = new Float32Array(totalFrames);
    for (let t = 0; t < totalFrames; t++) {
      left[t] = Math.sin(t * 0.2) * 0.6;
      right[t] = Math.cos(t * 0.15) * 0.5;
    }

    const stemWeights: Record<CanonicalStemId, number> = {
      vocals: 0.3,
      drums: 0.15,
      bass: 0.2,
      guitar: 0.12,
      piano: 0.18,
      other: 0.05,
    };

    const runSegment = vi.fn(
      async (
        mixPlanarStereo: Float32Array,
        segmentSamples: number,
        activeDescriptor: AudioSeparationModelDescriptor
      ): Promise<Float32Array> => {
        const stemCount = activeDescriptor.rawOutputStemOrder.length;
        const out = new Float32Array(stemCount * 2 * segmentSamples);
        for (let rawIdx = 0; rawIdx < stemCount; rawIdx++) {
          const stemId = activeDescriptor.rawOutputStemOrder[rawIdx];
          const w = stemWeights[stemId];
          const outL = rawIdx * 2 * segmentSamples;
          const outR = (rawIdx * 2 + 1) * segmentSamples;
          for (let t = 0; t < segmentSamples; t++) {
            out[outL + t] = mixPlanarStereo[t] * w;
            out[outR + t] = mixPlanarStereo[segmentSamples + t] * w;
          }
        }
        return out;
      }
    );

    const dispose = vi.fn();
    const session: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      descriptor,
      modelId: descriptor.id,
      modelVersion: descriptor.version,
      ortVersion: '1.21.0-test',
      modelChecksumVerified: false,
      runSegment,
      dispose,
    };

    const progressEvents: SeparationProgressEvent[] = [];
    const result = await separateStereoAudio(
      { sampleRate: 44100, totalFrames, left, right },
      {
        descriptor,
        createSession: async () => ({ session, modelLoadMs: 12 }),
        inputSha256: 'deadbeef'.repeat(8),
        yieldBetweenChunks: false,
        onProgress: (evt) => progressEvents.push(evt),
      }
    );

    expect(runSegment).toHaveBeenCalledTimes(3);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(result.orderedStems.map((s) => s.id)).toEqual([...CANONICAL_STEM_IDS]);
    expect(result.telemetry.chunksProcessed).toBe(3);
    expect(result.telemetry.executionProvider).toBe('wasm');
    expect(result.telemetry.ortVersion).toBe('1.21.0-test');
    expect(result.telemetry.modelChecksumVerified).toBe(false);
    expect(result.telemetry.modelLoadMs).toBe(12);
    expect(result.telemetry.reconstructionMaxAbsError).toBeLessThan(1e-5);
    expect(progressEvents.some((e) => e.phase === 'loading_model')).toBe(true);
    expect(progressEvents.at(-1)?.phase).toBe('complete');

    for (const stem of result.orderedStems) {
      expect(stem.totalFrames).toBe(totalFrames);
      expect(stem.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(stem.byteLength).toBe(44 + totalFrames * 4);
      expect(stem.rms).toBeGreaterThan(0);
      expect(stem.peak).toBeGreaterThan(0);
      const expectedGain = stemWeights[stem.id];
      for (let t = 0; t < totalFrames; t++) {
        expect(stem.left[t]).toBeCloseTo(left[t] * expectedGain, 5);
        expect(stem.right[t]).toBeCloseTo(right[t] * expectedGain, 5);
      }
    }

    const uniqueHashes = new Set(result.orderedStems.map((s) => s.sha256));
    expect(uniqueHashes.size).toBe(6);
  });

  it('rejects out-of-range input samples and NaN in padded output tail, and prevents completion after abort during async dispose', async () => {
    const descriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      segmentSamples: 16,
      defaultOverlapRatio: 0.25,
      expectedModelSha256: undefined,
      expectedModelBytes: undefined,
    };

    const outOfRangeAudio = {
      sampleRate: 44100,
      totalFrames: 8,
      left: new Float32Array(8).fill(2.0),
      right: new Float32Array(8).fill(0.1),
    };
    const noopSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      runSegment: async () => new Float32Array(6 * 2 * 16),
      dispose: vi.fn(),
    };
    await expect(
      separateStereoAudio(outOfRangeAudio, {
        descriptor,
        session: noopSession,
        yieldBetweenChunks: false,
      })
    ).rejects.toMatchObject({ code: 'INVALID_AUDIO' });

    // Audio is 8 frames (copyLen = 8, padded tail = 8..15); NaN in padded tail must still fail closed.
    const validShortAudio = {
      sampleRate: 44100,
      totalFrames: 8,
      left: new Float32Array(8).fill(0.2),
      right: new Float32Array(8).fill(-0.2),
    };
    const nanTailSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      runSegment: async () => {
        const out = new Float32Array(6 * 2 * 16);
        out[15] = Number.NaN;
        return out;
      },
      dispose: vi.fn(),
    };
    await expect(
      separateStereoAudio(validShortAudio, {
        descriptor,
        session: nanTailSession,
        yieldBetweenChunks: false,
      })
    ).rejects.toMatchObject({ code: 'NON_FINITE_OUTPUT' });

    // Cancellation during asynchronous dispose() must reject with CANCELLED and never emit 'complete'.
    const abortController = new AbortController();
    const phases: string[] = [];
    let releaseDispose: (() => void) | null = null;
    const slowDisposeSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      runSegment: async () => new Float32Array(6 * 2 * 16).fill(0.05),
      dispose: () =>
        new Promise<void>((resolve) => {
          releaseDispose = resolve;
        }),
    };

    const runPromise = separateStereoAudio(validShortAudio, {
      descriptor,
      createSession: async () => ({ session: slowDisposeSession }),
      signal: abortController.signal,
      yieldBetweenChunks: false,
      onProgress: (evt) => phases.push(evt.phase),
    });

    await vi.waitFor(() => {
      expect(releaseDispose).not.toBeNull();
    });
    abortController.abort();
    releaseDispose!();

    await expect(runPromise).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(phases).not.toContain('complete');
  });

  it('closes M1-M3 and L1: rejects trailing RIFF bytes, missing odd padding, oversized cbSize, non-finite telemetry, invalid caps, and post-abort dispose errors', async () => {
    // M1: trailing bytes beyond declared RIFF extent
    const trailingBytesWav = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      audioFormat: 1,
      samples: [100, -100],
      overrideRiffChunkSize: 40,
      trailingBytes: 4,
    });
    expect(() => decodeWavToStereoFloat32(trailingBytesWav)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_WAV' })
    );

    // M1: final odd-sized chunk missing RIFF word-alignment padding byte
    const baseOdd = buildCustomWavBuffer({
      sampleRate: 44100,
      channels: 1,
      bitsPerSample: 8,
      audioFormat: 1,
      samples: [128, 128, 128],
    });
    // Construct minimal RIFF with 3-byte data (odd) and NO padding byte
    const oddBuf = new ArrayBuffer(44 + 3);
    new Uint8Array(oddBuf).set(new Uint8Array(baseOdd, 0, 44 + 3));
    const oddView = new DataView(oddBuf);
    oddView.setUint32(4, 36 + 3, true);
    oddView.setUint32(40, 3, true);
    expect(() => decodeWavToStereoFloat32(oddBuf)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_WAV' })
    );

    // M1: WAVE_FORMAT_EXTENSIBLE with cbSize > chunkSize - 18
    const oversizedCbSize = buildExtensibleWavBuffer({
      sampleRate: 44100,
      channels: 2,
      bitsPerSample: 16,
      subFormatTag: 1,
      cbSize: 30,
      samples: [100, -100],
    });
    expect(() => decodeWavToStereoFloat32(oversizedCbSize)).toThrowError(
      expect.objectContaining({ code: 'CORRUPT_WAV' })
    );

    // M3: reject non-finite / invalid caps in readBoundedResponseBytes and createOrtWebSessionAdapter
    await expect(
      readBoundedResponseBytes(
        new Response(new Uint8Array([1, 2, 3])),
        Number.NaN,
        'INVALID_AUDIO',
        'test'
      )
    ).rejects.toMatchObject({ code: 'INVALID_AUDIO' });

    await expect(
      readBoundedResponseBytes(
        new Response(new Uint8Array([1, 2, 3])),
        Number.POSITIVE_INFINITY,
        'INVALID_AUDIO',
        'test'
      )
    ).rejects.toMatchObject({ code: 'INVALID_AUDIO' });

    await expect(
      createOrtWebSessionAdapter(new Uint8Array([1, 2, 3]), {
        ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
        expectedModelSha256: undefined,
        expectedModelBytes: undefined,
      }, {
        maxModelBytes: Number.NaN,
      })
    ).rejects.toMatchObject({ code: 'INVALID_MODEL_SOURCE' });

    // M3: decodeWavToStereoFloat32 enforces maxFrames before allocation
    const fourFrameWav = encodeStereoPcm16Wav({
      sampleRate: 44100,
      left: new Float32Array([0.1, 0.2, 0.3, 0.4]),
      right: new Float32Array([0.1, 0.2, 0.3, 0.4]),
    });
    expect(() =>
      decodeWavToStereoFloat32(fourFrameWav.slice().buffer, {
        expectedSampleRate: 44100,
        maxFrames: 2,
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIO' }));
    for (const badMaxFrames of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      expect(() =>
        decodeWavToStereoFloat32(fourFrameWav.slice().buffer, {
          expectedSampleRate: 44100,
          maxFrames: badMaxFrames,
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_AUDIO' }));
    }

    // M2: non-finite telemetry fields (modelLoadMs: NaN or modelBytes: Infinity) must reject before emitting 'complete'
    const descriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      segmentSamples: 16,
      defaultOverlapRatio: 0.25,
      expectedModelSha256: undefined,
      expectedModelBytes: undefined,
    };
    const shortAudio = {
      sampleRate: 44100,
      totalFrames: 8,
      left: new Float32Array(8).fill(0.1),
      right: new Float32Array(8).fill(-0.1),
    };
    const m2Phases: string[] = [];
    await expect(
      separateStereoAudio(shortAudio, {
        descriptor,
        createSession: async () => ({
          modelLoadMs: Number.NaN,
          session: {
            executionProvider: 'wasm',
            inputNames: ['mix'],
            outputNames: ['stems'],
            modelBytes: Number.POSITIVE_INFINITY,
            runSegment: async () => new Float32Array(6 * 2 * 16).fill(0.05),
            dispose: vi.fn(),
          },
        }),
        yieldBetweenChunks: false,
        onProgress: (e) => m2Phases.push(e.phase),
      })
    ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
    expect(m2Phases).not.toContain('complete');

    for (const badMaxFrames of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      const neverCalledCreateSession = vi.fn();
      await expect(
        separateStereoAudio(shortAudio, {
          descriptor,
          maxFrames: badMaxFrames,
          createSession: neverCalledCreateSession,
          yieldBetweenChunks: false,
        })
      ).rejects.toMatchObject({ code: 'INVALID_AUDIO' });
      expect(neverCalledCreateSession).not.toHaveBeenCalled();
    }

    for (const invalidTelemetrySession of [
      { modelBytes: MAX_MODEL_BYTES + 1 },
      { modelBytes: Number.MAX_VALUE },
      { modelChecksumVerified: true, modelSha256: undefined },
      { modelChecksumVerified: null as unknown as boolean },
      { modelSha256: 'not-a-sha256' },
      {
        modelId: 'other_model_a',
        modelVersion: descriptor.version,
        modelSha256: 'a'.repeat(64),
        modelChecksumVerified: true,
      },
    ]) {
      const m2EdgePhases: string[] = [];
      await expect(
        separateStereoAudio(shortAudio, {
          descriptor,
          createSession: async () => ({
            session: {
              executionProvider: 'wasm',
              inputNames: ['mix'],
              outputNames: ['stems'],
              ...invalidTelemetrySession,
              runSegment: async () => new Float32Array(6 * 2 * 16).fill(0.05),
              dispose: vi.fn(),
            },
          }),
          yieldBetweenChunks: false,
          onProgress: (e) => m2EdgePhases.push(e.phase),
        })
      ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
      expect(m2EdgePhases).not.toContain('complete');
    }

    // L1: disposal error after abort must not mask CANCELLED
    const abortCtrl = new AbortController();
    let triggerDisposeReject: (() => void) | null = null;
    const rejectDisposeSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      runSegment: async () => new Float32Array(6 * 2 * 16).fill(0.05),
      dispose: () =>
        new Promise<void>((_, reject) => {
          triggerDisposeReject = () => reject(new Error('dispose boom'));
        }),
    };
    const l1Promise = separateStereoAudio(shortAudio, {
      descriptor,
      createSession: async () => ({ session: rejectDisposeSession }),
      signal: abortCtrl.signal,
      yieldBetweenChunks: false,
    });
    await vi.waitFor(() => {
      expect(triggerDisposeReject).not.toBeNull();
    });
    abortCtrl.abort();
    triggerDisposeReject!();
    await expect(l1Promise).rejects.toMatchObject({ code: 'CANCELLED' });

    // L1 (failure-cleanup): inference failure + abort during pending disposal error still yields CANCELLED
    const l1FailAbortCtrl = new AbortController();
    let triggerFailDisposeReject: (() => void) | null = null;
    const failThenDisposeRejectSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      runSegment: async () => {
        throw new Error('infer fail');
      },
      dispose: () =>
        new Promise<void>((_, reject) => {
          triggerFailDisposeReject = () => reject(new Error('dispose fail'));
        }),
    };
    const l1FailPromise = separateStereoAudio(shortAudio, {
      descriptor,
      createSession: async () => ({ session: failThenDisposeRejectSession }),
      signal: l1FailAbortCtrl.signal,
      yieldBetweenChunks: false,
    });
    await vi.waitFor(() => {
      expect(triggerFailDisposeReject).not.toBeNull();
    });
    l1FailAbortCtrl.abort();
    triggerFailDisposeReject!();
    await expect(l1FailPromise).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('closes M4: snapshots mutable caller model bytes and descriptor before hashing/verification, and releases session on abort during create', async () => {
    vi.resetModules();
    let capturedBytes: Uint8Array | null = null;
    let waitForPendingCreate: (() => Promise<void>) | null = null;
    const releaseSpy = vi.fn(async () => {});
    vi.doMock('onnxruntime-web', () => ({
      env: { wasm: {}, versions: { web: '1.21.0-mock' } },
      Tensor: class {
        constructor(
          public type: string,
          public data: Float32Array,
          public dims: number[]
        ) {}
        dispose() {}
      },
      InferenceSession: {
        create: async (bytes: Uint8Array) => {
          capturedBytes = new Uint8Array(bytes);
          if (waitForPendingCreate) {
            await waitForPendingCreate();
          }
          return {
            inputNames: ['mix'],
            outputNames: ['stems'],
            run: async () => ({}),
            release: releaseSpy,
          };
        },
      },
    }));

    const originalSubtle = globalThis.crypto.subtle;
    let digestSpy: { mockRestore(): void } | null = null;

    try {
      const freshMod = await import('./demucs-onnx-separator');
      const callerBytes = new Uint8Array([10, 20, 30, 40]);
      const originalSnapshot = new Uint8Array(callerBytes);
      const expectedDigest = await freshMod.computeSha256Hex(originalSnapshot);

      const sizeOnlyDescriptor: AudioSeparationModelDescriptor = {
        ...freshMod.HTDEMUCS_6S_ONNX_DESCRIPTOR,
        id: 'size_only_test',
        expectedModelBytes: 4,
        expectedModelSha256: undefined,
      };
      let onDigestMutate: (() => void) | null = () => {
        // Mutate caller buffer and descriptor WHILE digest is running (before checksum comparison).
        callerBytes[0] = 99;
        callerBytes[1] = 88;
        (sizeOnlyDescriptor as { expectedModelSha256?: string }).expectedModelSha256 =
          'f'.repeat(64);
      };

      digestSpy = vi
        .spyOn(originalSubtle, 'digest')
        .mockImplementation(async (alg, data) => {
          onDigestMutate?.();
          return await SubtleCrypto.prototype.digest.call(originalSubtle, alg, data);
        });

      const { session } = await freshMod.createOrtWebSessionAdapter(
        callerBytes,
        sizeOnlyDescriptor,
        { preferredProviders: ['wasm'], verifyModelChecksum: true }
      );

      expect(capturedBytes).toEqual(originalSnapshot);
      expect(session.modelSha256).toBe(expectedDigest);
      expect(session.modelChecksumVerified).toBe(false);
      expect(session.modelId).toBe('size_only_test');

      // Case 2: Uppercase expectedModelSha256 mutated with id during crypto.subtle.digest still uses frozen snapshot
      const pinnedUpperDescriptor: AudioSeparationModelDescriptor = {
        ...freshMod.HTDEMUCS_6S_ONNX_DESCRIPTOR,
        id: 'pinned_upper_test',
        expectedModelBytes: 4,
        expectedModelSha256: expectedDigest.toUpperCase(),
      };
      onDigestMutate = () => {
        const mutable = pinnedUpperDescriptor as {
          id: string;
          expectedModelSha256?: string;
        };
        mutable.expectedModelSha256 = '0'.repeat(64);
        mutable.id = 'tampered_id';
      };
      const { session: pinnedSession } = await freshMod.createOrtWebSessionAdapter(
        new Uint8Array(originalSnapshot),
        pinnedUpperDescriptor,
        { preferredProviders: ['wasm'], verifyModelChecksum: true }
      );
      expect(pinnedSession.modelChecksumVerified).toBe(true);
      expect(pinnedSession.modelSha256).toBe(expectedDigest);
      expect(pinnedSession.modelId).toBe('pinned_upper_test');

      // Case 3: Aborting while InferenceSession.create is pending releases the newly created session and rejects CANCELLED
      onDigestMutate = null;
      const cleanPinnedDescriptor: AudioSeparationModelDescriptor = {
        ...freshMod.HTDEMUCS_6S_ONNX_DESCRIPTOR,
        id: 'abort_during_create_test',
        expectedModelBytes: 4,
        expectedModelSha256: expectedDigest,
      };
      let releaseCreateGate: (() => void) | null = null;
      let createEntered = false;
      waitForPendingCreate = () => {
        createEntered = true;
        return new Promise<void>((resolve) => {
          releaseCreateGate = resolve;
        });
      };
      const createAbortCtrl = new AbortController();
      const createPromise = freshMod.createOrtWebSessionAdapter(
        new Uint8Array(originalSnapshot),
        cleanPinnedDescriptor,
        { preferredProviders: ['wasm'], verifyModelChecksum: true, signal: createAbortCtrl.signal }
      );
      await vi.waitFor(() => {
        expect(createEntered).toBe(true);
      });
      createAbortCtrl.abort();
      releaseCreateGate!();
      await expect(createPromise).rejects.toMatchObject({ code: 'CANCELLED' });
      expect(releaseSpy).toHaveBeenCalledTimes(1);
    } finally {
      digestSpy?.mockRestore();
      vi.doUnmock('onnxruntime-web');
      vi.resetModules();
    }
  });

  it('enforces descriptor version validation and rejects checksum attestation when only modelVersion is missing or mismatched', async () => {
    for (const badDescriptor of [
      {
        ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
        version: undefined as unknown as string,
      },
      {
        ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
        version: '   ',
      },
      {
        ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
        id: undefined as unknown as string,
      },
    ]) {
      expect(() => validateModelDescriptor(badDescriptor)).toThrowError(
        expect.objectContaining({ code: 'INVALID_DESCRIPTOR' })
      );
      await expect(
        separateStereoAudio(
          {
            sampleRate: 44100,
            totalFrames: 8,
            left: new Float32Array(8).fill(0.1),
            right: new Float32Array(8).fill(-0.1),
          },
          {
            descriptor: badDescriptor,
            createSession: vi.fn(),
            yieldBetweenChunks: false,
          }
        )
      ).rejects.toMatchObject({ code: 'INVALID_DESCRIPTOR' });
    }

    const pinnedAttestationDescriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      segmentSamples: 16,
      defaultOverlapRatio: 0.25,
      expectedModelSha256: 'a'.repeat(64),
      expectedModelBytes: 1234,
    };
    const shortAudio = {
      sampleRate: 44100,
      totalFrames: 8,
      left: new Float32Array(8).fill(0.1),
      right: new Float32Array(8).fill(-0.1),
    };

    for (const badModelVersion of [undefined, 'v2-mismatched']) {
      const versionEdgePhases: string[] = [];
      await expect(
        separateStereoAudio(shortAudio, {
          descriptor: pinnedAttestationDescriptor,
          createSession: async () => ({
            session: {
              executionProvider: 'wasm',
              inputNames: ['mix'],
              outputNames: ['stems'],
              descriptor: pinnedAttestationDescriptor,
              modelId: pinnedAttestationDescriptor.id,
              ...(badModelVersion !== undefined
                ? { modelVersion: badModelVersion }
                : {}),
              modelBytes: 1234,
              modelSha256: 'a'.repeat(64),
              modelChecksumVerified: true,
              runSegment: async () => new Float32Array(6 * 2 * 16).fill(0.05),
              dispose: vi.fn(),
            },
          }),
          yieldBetweenChunks: false,
          onProgress: (e) => versionEdgePhases.push(e.phase),
        })
      ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
      expect(versionEdgePhases).not.toContain('complete');
    }
  });

  it('defeats getter TOCTOU on snapshot, handles Symbol values without TypeError, and rejects sparse provider arrays', async () => {
    // 1. Single-read getter TOCTOU on expectedModelSha256 (valid on read 1, undefined on read 2) preserves pinning
    let shaReads = 0;
    const shaGetterDescriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      id: 'toctou_sha_test',
      expectedModelBytes: undefined,
      get expectedModelSha256() {
        shaReads += 1;
        return shaReads === 1 ? 'a'.repeat(64) : undefined;
      },
    };
    await expect(
      createOrtWebSessionAdapter(new Uint8Array([1, 2, 3]), shaGetterDescriptor, {
        verifyModelChecksum: false,
      })
    ).rejects.toMatchObject({ code: 'MODEL_CHECKSUM_MISMATCH' });
    expect(shaReads).toBe(1);

    shaReads = 0;
    await expect(
      createOrtWebSessionAdapter(new Uint8Array([1, 2, 3]), shaGetterDescriptor, {
        verifyModelChecksum: true,
      })
    ).rejects.toMatchObject({ code: 'MODEL_CHECKSUM_MISMATCH' });
    expect(shaReads).toBe(1);

    // 2. Single-read getter on rawOutputStemOrder: read 1 valid / read 2 non-array does not fail; read 1 non-array throws INVALID_DESCRIPTOR
    let rawReads = 0;
    const rawGetterValidFirst = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      id: 'toctou_raw_valid_first',
      segmentSamples: 16,
      defaultOverlapRatio: 0.25,
      expectedModelBytes: undefined,
      expectedModelSha256: undefined,
      get rawOutputStemOrder() {
        rawReads += 1;
        return (
          rawReads === 1
            ? ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other']
            : 123
        ) as unknown as readonly CanonicalStemId[];
      },
    } as AudioSeparationModelDescriptor;
    const toctouResult = await separateStereoAudio(
      {
        sampleRate: 44100,
        totalFrames: 8,
        left: new Float32Array(8).fill(0.1),
        right: new Float32Array(8).fill(-0.1),
      },
      {
        descriptor: rawGetterValidFirst,
        createSession: async () => ({
          session: {
            executionProvider: 'wasm',
            inputNames: ['mix'],
            outputNames: ['stems'],
            runSegment: async () => new Float32Array(6 * 2 * 16).fill(0.05),
            dispose: vi.fn(),
          },
        }),
        yieldBetweenChunks: false,
      }
    );
    expect(rawReads).toBe(1);
    expect(toctouResult.orderedStems).toHaveLength(6);

    const rawGetterInvalidFirst = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      get rawOutputStemOrder() {
        return 123 as unknown as readonly CanonicalStemId[];
      },
    } as AudioSeparationModelDescriptor;
    expect(() => validateModelDescriptor(rawGetterInvalidFirst)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DESCRIPTOR' })
    );

    // 3. Symbol values in expectedModelBytes, sampleRate, and maxFrames throw typed AudioSeparationError (never TypeError)
    const symbolBytesDescriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      expectedModelBytes: Symbol('badBytes') as unknown as number,
    };
    expect(() => validateModelDescriptor(symbolBytesDescriptor)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DESCRIPTOR' })
    );
    const symbolSampleRateDescriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      sampleRate: Symbol('badRate') as unknown as number,
    };
    expect(() => validateModelDescriptor(symbolSampleRateDescriptor)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DESCRIPTOR' })
    );
    await expect(
      separateStereoAudio(
        {
          sampleRate: 44100,
          totalFrames: 8,
          left: new Float32Array(8).fill(0.1),
          right: new Float32Array(8).fill(-0.1),
        },
        {
          descriptor: {
            ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
            segmentSamples: 16,
            defaultOverlapRatio: 0.25,
          },
          maxFrames: Symbol('badMaxFrames') as unknown as number,
          createSession: vi.fn(),
          yieldBetweenChunks: false,
        }
      )
    ).rejects.toMatchObject({ code: 'INVALID_AUDIO' });

    // 4. Sparse provider arrays (new Array(1)) are rejected with INVALID_DESCRIPTOR by both validator and registry
    const sparseProvidersDescriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      supportedExecutionProviders: new Array(1) as ExecutionProviderName[],
    };
    expect(() => validateModelDescriptor(sparseProvidersDescriptor)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DESCRIPTOR' })
    );
    expect(() =>
      new AudioSeparationModelRegistry().register(sparseProvidersDescriptor)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));

    // 5. Prototype-inherited sparse holes are rejected across all 3 descriptor arrays
    for (const field of [
      'rawOutputStemOrder',
      'canonicalStemOrder',
      'supportedExecutionProviders',
    ] as const) {
      const inherited = [...HTDEMUCS_6S_ONNX_DESCRIPTOR[field]];
      const proto = Object.assign(Object.create(Array.prototype), {
        0: inherited[0],
      });
      delete (inherited as unknown[])[0];
      Object.setPrototypeOf(inherited, proto);
      const badInheritedDescriptor = {
        ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
        [field]: inherited,
      } as AudioSeparationModelDescriptor;
      expect(() => validateModelDescriptor(badInheritedDescriptor)).toThrowError(
        expect.objectContaining({ code: 'INVALID_DESCRIPTOR' })
      );
      expect(() =>
        new AudioSeparationModelRegistry().register(badInheritedDescriptor)
      ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
    }

    // 6. Element getter on supportedExecutionProviders that expands array during iteration is rejected (fresh array per call)
    const makeExpandingProvidersDescriptor = (): AudioSeparationModelDescriptor => {
      const mutatingProviders = ['wasm'] as ExecutionProviderName[];
      Object.defineProperty(mutatingProviders, 0, {
        enumerable: true,
        configurable: true,
        get() {
          for (let k = 0; k < 16; k++) {
            Array.prototype.push.call(this, 'wasm');
          }
          return 'wasm';
        },
      });
      return {
        ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
        supportedExecutionProviders: mutatingProviders,
      };
    };
    expect(() =>
      validateModelDescriptor(makeExpandingProvidersDescriptor())
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
    expect(() =>
      new AudioSeparationModelRegistry().register(
        makeExpandingProvidersDescriptor()
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));

    // 6b. Proxy reporting negative length on supportedExecutionProviders is rejected
    const negLenProviders = new Proxy(['wasm'] as ExecutionProviderName[], {
      get(target, prop, receiver) {
        if (prop === 'length') {
          return -1;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
    const negLenDescriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      supportedExecutionProviders: negLenProviders,
    };
    expect(() => validateModelDescriptor(negLenDescriptor)).toThrowError(
      expect.objectContaining({ code: 'INVALID_DESCRIPTOR' })
    );
    expect(() =>
      new AudioSeparationModelRegistry().register(negLenDescriptor)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));

    // 6c. Cross-array getter deleting canonicalStemOrder[0] (backed by prototype) during rawOutputStemOrder[0] read is rejected
    const makeCrossDeleteDescriptor = (): AudioSeparationModelDescriptor => {
      const targetCanonical = [...HTDEMUCS_6S_ONNX_DESCRIPTOR.canonicalStemOrder];
      const canonicalProto = Object.assign(Object.create(Array.prototype), {
        0: targetCanonical[0],
      });
      Object.setPrototypeOf(targetCanonical, canonicalProto);
      const mutatingRaw = [...HTDEMUCS_6S_ONNX_DESCRIPTOR.rawOutputStemOrder];
      const initialRawZero = mutatingRaw[0];
      Object.defineProperty(mutatingRaw, 0, {
        enumerable: true,
        configurable: true,
        get() {
          delete (targetCanonical as unknown[])[0];
          return initialRawZero;
        },
      });
      return {
        ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
        rawOutputStemOrder: mutatingRaw,
        canonicalStemOrder: targetCanonical,
      };
    };
    expect(() =>
      validateModelDescriptor(makeCrossDeleteDescriptor())
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
    expect(() =>
      new AudioSeparationModelRegistry().register(makeCrossDeleteDescriptor())
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));

    // 7. Boxed Symbols and null-prototype objects never leak TypeError from formatters
    for (const bizarreValue of [
      Object(Symbol('rate')) as unknown as number,
      Object.create(null) as unknown as number,
    ]) {
      expect(() =>
        validateModelDescriptor({
          ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
          sampleRate: bizarreValue,
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
      expect(() =>
        validateModelDescriptor({
          ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
          expectedModelBytes: bizarreValue,
        })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));
    }
  });

  it('closes Codex Finding 1: binds session descriptor contract, requires attestation for pinned models, and validates tensor contract before chunk 0', async () => {
    const pinnedDescriptor: AudioSeparationModelDescriptor = {
      ...HTDEMUCS_6S_ONNX_DESCRIPTOR,
      segmentSamples: 16,
      defaultOverlapRatio: 0.25,
      expectedModelBytes: 1234,
      expectedModelSha256: 'a'.repeat(64),
    };
    const shortAudio = {
      sampleRate: 44100,
      totalFrames: 8,
      left: new Float32Array(8).fill(0.1),
      right: new Float32Array(8).fill(-0.1),
    };

    // 1. Reused session bound to a descriptor with different rawOutputStemOrder must fail BEFORE chunk 0
    const runSegmentDivergent = vi.fn(async () => new Float32Array(6 * 2 * 16));
    const divergentOrderSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      descriptor: {
        ...pinnedDescriptor,
        rawOutputStemOrder: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'],
      },
      modelId: pinnedDescriptor.id,
      modelVersion: pinnedDescriptor.version,
      modelBytes: 1234,
      modelSha256: 'a'.repeat(64),
      modelChecksumVerified: true,
      runSegment: runSegmentDivergent,
      dispose: vi.fn(),
    };
    await expect(
      separateStereoAudio(shortAudio, {
        descriptor: pinnedDescriptor,
        session: divergentOrderSession,
        yieldBetweenChunks: false,
      })
    ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
    expect(runSegmentDivergent).not.toHaveBeenCalled();

    // 2. Pinned descriptor must reject an injected session missing checksum/size attestation BEFORE chunk 0
    const runSegmentUnattested = vi.fn(async () => new Float32Array(6 * 2 * 16));
    const unattestedSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      runSegment: runSegmentUnattested,
      dispose: vi.fn(),
    };
    await expect(
      separateStereoAudio(shortAudio, {
        descriptor: pinnedDescriptor,
        session: unattestedSession,
        yieldBetweenChunks: false,
      })
    ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
    expect(runSegmentUnattested).not.toHaveBeenCalled();

    // 3. Session missing expected input/output tensor names must fail BEFORE chunk 0
    const runSegmentBadTensors = vi.fn(async () => new Float32Array(6 * 2 * 16));
    const badTensorSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['wrong_in'],
      outputNames: ['stems'],
      descriptor: pinnedDescriptor,
      modelId: pinnedDescriptor.id,
      modelVersion: pinnedDescriptor.version,
      modelBytes: 1234,
      modelSha256: 'a'.repeat(64),
      modelChecksumVerified: true,
      runSegment: runSegmentBadTensors,
      dispose: vi.fn(),
    };
    await expect(
      separateStereoAudio(shortAudio, {
        descriptor: pinnedDescriptor,
        session: badTensorSession,
        yieldBetweenChunks: false,
      })
    ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
    expect(runSegmentBadTensors).not.toHaveBeenCalled();

    // 4. Pinned session with valid modelId/version/sha256/bytes and matching descriptor but NOT created via createOrtWebSessionAdapter must fail BEFORE chunk 0
    const runSegmentSpoofed = vi.fn(async () => new Float32Array(6 * 2 * 16));
    const spoofedInjectedSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      descriptor: pinnedDescriptor,
      modelId: pinnedDescriptor.id,
      modelVersion: pinnedDescriptor.version,
      modelBytes: 1234,
      modelSha256: 'a'.repeat(64),
      modelChecksumVerified: true,
      runSegment: runSegmentSpoofed,
      dispose: vi.fn(),
    };
    await expect(
      separateStereoAudio(shortAudio, {
        descriptor: pinnedDescriptor,
        session: spoofedInjectedSession,
        yieldBetweenChunks: false,
      })
    ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
    expect(runSegmentSpoofed).not.toHaveBeenCalled();

    // 5. Session attestation mutating AFTER chunk 0 executes passes pre-check, runs chunk 0, and fails post-check before 'complete'
    const unpinnedDescriptor: AudioSeparationModelDescriptor = {
      ...pinnedDescriptor,
      expectedModelBytes: undefined,
      expectedModelSha256: undefined,
    };
    let chunkExecCount = 0;
    let mutatedOrtVersion = '1.21.0-initial';
    const postChunkPhases: string[] = [];
    const mutatingPostChunkSession: OnnxInferenceSessionHandle = {
      executionProvider: 'wasm',
      inputNames: ['mix'],
      outputNames: ['stems'],
      descriptor: unpinnedDescriptor,
      modelId: unpinnedDescriptor.id,
      modelVersion: unpinnedDescriptor.version,
      get ortVersion() {
        return mutatedOrtVersion;
      },
      runSegment: async () => {
        chunkExecCount += 1;
        mutatedOrtVersion = '1.21.0-tampered-after-chunk0';
        return new Float32Array(6 * 2 * 16).fill(0.05);
      },
      dispose: vi.fn(),
    };
    await expect(
      separateStereoAudio(shortAudio, {
        descriptor: unpinnedDescriptor,
        session: mutatingPostChunkSession,
        yieldBetweenChunks: false,
        onProgress: (evt) => postChunkPhases.push(evt.phase),
      })
    ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
    expect(chunkExecCount).toBe(1);
    expect(postChunkPhases).not.toContain('complete');
  });

  it('closes Codex Finding 2: snapshots custom Blob bytes and enforces effective byteLength bounds and tensor names on ORT create', async () => {
    vi.resetModules();
    let capturedBytes: Uint8Array | null = null;
    let mockInputNames = ['mix'];
    let mockOutputNames = ['stems'];
    const ortRunSpy = vi.fn(async () => ({
      stems: {
        data: new Float32Array(6 * 2 * 16).fill(0.05),
        dims: [1, 6, 2, 16],
        dispose: vi.fn(),
      },
    }));
    const releaseSpy = vi.fn(async () => {});

    vi.doMock('onnxruntime-web', () => ({
      env: { wasm: {}, versions: { web: '1.21.0-mock' } },
      Tensor: class {
        constructor(
          public type: string,
          public data: Float32Array,
          public dims: number[]
        ) {}
        dispose() {}
      },
      InferenceSession: {
        create: async (bytes: Uint8Array) => {
          capturedBytes = new Uint8Array(bytes);
          return {
            inputNames: mockInputNames,
            outputNames: mockOutputNames,
            run: ortRunSpy,
            release: releaseSpy,
          };
        },
      },
    }));

    const originalSubtle = globalThis.crypto.subtle;
    let digestSpy: { mockRestore(): void } | null = null;

    try {
      const freshMod = await import('./demucs-onnx-separator');
      const backing = new Uint8Array([1, 2, 3, 4]);
      const originalHash = await freshMod.computeSha256Hex(backing);

      // Custom Blob returning a shared ArrayBuffer mutated during digest
      const customBlob = new Blob([backing]);
      Object.defineProperty(customBlob, 'size', { value: 4 });
      Object.defineProperty(customBlob, 'arrayBuffer', {
        value: async () => backing.buffer,
      });

      digestSpy = vi
        .spyOn(originalSubtle, 'digest')
        .mockImplementation(async (alg, data) => {
          backing[0] = 250;
          backing[1] = 251;
          return await SubtleCrypto.prototype.digest.call(originalSubtle, alg, data);
        });

      const pinnedBlobDescriptor: AudioSeparationModelDescriptor = {
        ...freshMod.HTDEMUCS_6S_ONNX_DESCRIPTOR,
        id: 'blob_snapshot_test',
        segmentSamples: 16,
        defaultOverlapRatio: 0.25,
        expectedModelBytes: 4,
        expectedModelSha256: originalHash,
      };
      const { session } = await freshMod.createOrtWebSessionAdapter(
        customBlob,
        pinnedBlobDescriptor,
        { preferredProviders: ['wasm'], verifyModelChecksum: true }
      );
      expect(capturedBytes).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(session.descriptor?.rawOutputStemOrder).toEqual(
        pinnedBlobDescriptor.rawOutputStemOrder
      );
      expect(Object.isFrozen(session)).toBe(true);
      expect(Object.isFrozen(session.runSegment)).toBe(true);
      expect(Object.isFrozen(session.dispose)).toBe(true);
      expect(() => {
        (session.runSegment as unknown as { call: unknown }).call = () => {
          throw new Error('hijacked');
        };
      }).toThrow(TypeError);
      await expect(
        session.runSegment(new Float32Array(32), 16, {
          ...pinnedBlobDescriptor,
          rawOutputStemOrder: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'],
        })
      ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });

      // Overwriting Function.prototype.call / Reflect.apply post-load cannot hijack authentic session invocation
      const realRunSegment = vi.fn(async () => new Float32Array(6 * 2 * 16).fill(0.05));
      const hijackedCallSpy = vi.fn(async () => new Float32Array(6 * 2 * 16));
      (realRunSegment as unknown as { call: unknown }).call = hijackedCallSpy;
      const callTamperSession: OnnxInferenceSessionHandle = {
        executionProvider: 'wasm',
        inputNames: ['mix'],
        outputNames: ['stems'],
        runSegment: realRunSegment,
        dispose: vi.fn(),
      };
      const originalReflectApply = Reflect.apply;
      const hijackedReflectApply = vi.fn(() => {
        throw new Error('hijacked Reflect.apply');
      });
      Reflect.apply = hijackedReflectApply;
      try {
        await freshMod.separateStereoAudio(
          {
            sampleRate: 44100,
            totalFrames: 8,
            left: new Float32Array(8).fill(0.2),
            right: new Float32Array(8).fill(-0.2),
          },
          {
            descriptor: {
              ...pinnedBlobDescriptor,
              expectedModelBytes: undefined,
              expectedModelSha256: undefined,
            },
            session: callTamperSession,
            yieldBetweenChunks: false,
          }
        );
      } finally {
        Reflect.apply = originalReflectApply;
      }
      expect(realRunSegment).toHaveBeenCalledTimes(1);
      expect(hijackedCallSpy).not.toHaveBeenCalled();
      expect(hijackedReflectApply).not.toHaveBeenCalled();

      // Authentic createOrtWebSessionAdapter session passes pinned separateStereoAudio and completes
      const e2eAudio = {
        sampleRate: 44100,
        totalFrames: 8,
        left: new Float32Array(8).fill(0.3),
        right: new Float32Array(8).fill(-0.3),
      };
      const authenticResult = await freshMod.separateStereoAudio(e2eAudio, {
        descriptor: pinnedBlobDescriptor,
        session,
        yieldBetweenChunks: false,
      });
      expect(authenticResult.telemetry.modelChecksumVerified).toBe(true);
      expect(authenticResult.telemetry.modelSha256).toBe(originalHash);
      expect(ortRunSpy).toHaveBeenCalledTimes(1);

      // Reusing the same authentic session with a different rawOutputStemOrder must fail BEFORE running chunk 0
      ortRunSpy.mockClear();
      await expect(
        freshMod.separateStereoAudio(e2eAudio, {
          descriptor: {
            ...pinnedBlobDescriptor,
            rawOutputStemOrder: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'],
          },
          session,
          yieldBetweenChunks: false,
        })
      ).rejects.toMatchObject({ code: 'INFERENCE_FAILED' });
      expect(ortRunSpy).not.toHaveBeenCalled();

      // Custom Blob claiming small size while returning oversized buffer > maxModelBytes must fail closed
      const oversizedBlob = new Blob([new Uint8Array([1, 2])]);
      Object.defineProperty(oversizedBlob, 'size', { value: 2 });
      Object.defineProperty(oversizedBlob, 'arrayBuffer', {
        value: async () => new Uint8Array(64).buffer,
      });
      await expect(
        freshMod.createOrtWebSessionAdapter(
          oversizedBlob,
          {
            ...pinnedBlobDescriptor,
            expectedModelBytes: undefined,
            expectedModelSha256: undefined,
          },
          { maxModelBytes: 8, verifyModelChecksum: false }
        )
      ).rejects.toMatchObject({ code: 'INVALID_MODEL_SOURCE' });

      // ORT model exposing wrong tensor names must release session and fail MODEL_LOAD_FAILED
      mockInputNames = ['other_input'];
      mockOutputNames = ['stems'];
      await expect(
        freshMod.createOrtWebSessionAdapter(
          new Uint8Array([1, 2, 3, 4]),
          {
            ...pinnedBlobDescriptor,
            expectedModelBytes: undefined,
            expectedModelSha256: undefined,
          },
          { verifyModelChecksum: false }
        )
      ).rejects.toMatchObject({ code: 'MODEL_LOAD_FAILED' });
      expect(releaseSpy).toHaveBeenCalledTimes(1);
    } finally {
      digestSpy?.mockRestore();
      vi.doUnmock('onnxruntime-web');
      vi.resetModules();
    }
  });
});
