import { describe, expect, it } from 'vitest';
import {
  CANONICAL_STEM_IDS,
  MAX_SEPARATION_TOTAL_FRAMES,
  STEM_DISPLAY_LABELS_PT_BR,
  computeSha256Hex,
  encodeStereoPcm16Wav,
  type CanonicalStemId,
  type SeparatedStemOutput,
} from './demucs-onnx-separator';
import {
  SixStemWebAudioMixerController,
  type MixerAudioBufferLike,
  type MixerAudioContextLike,
  type MixerBufferSourceNodeLike,
  type MixerGainNodeLike,
  type TargetAudioLibraryKind,
} from './six-stem-mixer';

class FakeMixerGainNode implements MixerGainNodeLike {
  gain = { value: 1 };
  connectedTo: unknown = null;
  disconnected = false;
  connect(dest: unknown): unknown {
    this.connectedTo = dest;
    return dest;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeMixerAudioBuffer implements MixerAudioBufferLike {
  private readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number
  ) {
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length)
    );
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

class FakeMixerBufferSourceNode implements MixerBufferSourceNodeLike {
  buffer: MixerAudioBufferLike | null = null;
  onended: (() => void) | null = null;
  connectedTo: unknown = null;
  startCalls: Array<{ when: number | undefined; offset: number | undefined }> =
    [];
  stopped = false;
  disconnected = false;

  connect(dest: unknown): unknown {
    this.connectedTo = dest;
    return dest;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  start(when?: number, offset?: number): void {
    this.startCalls.push({ when, offset });
  }
  stop(): void {
    this.stopped = true;
  }
}

class FakeMixerAudioContext implements MixerAudioContextLike {
  currentTime = 1.25;
  readonly sampleRate = 44100;
  state: AudioContextState = 'suspended';
  readonly destination = { id: 'destination' };
  readonly gains: FakeMixerGainNode[] = [];
  readonly sources: FakeMixerBufferSourceNode[] = [];
  closed = false;

  createGain(): MixerGainNodeLike {
    const g = new FakeMixerGainNode();
    this.gains.push(g);
    return g;
  }

  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number
  ): MixerAudioBufferLike {
    return new FakeMixerAudioBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): MixerBufferSourceNodeLike {
    const s = new FakeMixerBufferSourceNode();
    this.sources.push(s);
    return s;
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
  }
}

async function buildFakeSixStems(
  totalFrames = 44100,
  sampleRate = 44100
): Promise<SeparatedStemOutput[]> {
  const stems: SeparatedStemOutput[] = [];
  for (let i = 0; i < CANONICAL_STEM_IDS.length; i++) {
    const id = CANONICAL_STEM_IDS[i];
    const left = new Float32Array(totalFrames);
    const right = new Float32Array(totalFrames);
    for (let f = 0; f < totalFrames; f++) {
      left[f] = Math.sin((f / sampleRate) * 2 * Math.PI * (220 + i * 55)) * 0.2;
      right[f] = Math.cos((f / sampleRate) * 2 * Math.PI * (220 + i * 55)) * 0.2;
    }
    const wavBytes = encodeStereoPcm16Wav({ sampleRate, left, right });
    const sha256 = await computeSha256Hex(wavBytes);
    stems.push({
      id,
      labelPtBr: STEM_DISPLAY_LABELS_PT_BR[id],
      sampleRate,
      channels: 2,
      totalFrames,
      left,
      right,
      wavBytes,
      byteLength: wavBytes.byteLength,
      sha256,
      rms: 0.14,
      peak: 0.2,
    });
  }
  return stems;
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to read Blob bytes.'));
    reader.onload = () =>
      resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

describe('SixStemWebAudioMixerController (M22-B)', () => {
  it.each(['play', 'seek'] as const)('rolls back every source after a partial %s failure', async (operation) => {
    const context = new FakeMixerAudioContext();
    const originalCreate = context.createBufferSource.bind(context);
    const mixer = new SixStemWebAudioMixerController({
      createAudioContext: () => context,
      createObjectURL: () => 'blob:stem',
      revokeObjectURL: () => {},
      yieldToMainThread: async () => {},
    });
    await mixer.loadStems(await buildFakeSixStems(1000));
    if (operation === 'seek') await mixer.play();
    const failAt = context.sources.length + 3;
    context.createBufferSource = () => {
      const source = originalCreate();
      if (context.sources.length === failAt) {
        source.start = () => { throw new Error('Could not start source'); };
      }
      return source;
    };

    const snapshot = operation === 'play' ? await mixer.play() : mixer.seekFrame(500);
    expect(snapshot).toMatchObject({
      state: 'paused',
      activeSourceCount: 0,
      error: { message: 'Could not start source' },
    });
    expect(context.sources.every(source => source.stopped && source.disconnected)).toBe(true);
    expect((await mixer.play()).state).toBe('playing');
    mixer.dispose();
  });

  it('synchronizes all 6 AudioBufferSourceNodes at the exact same scheduled timestamp/offset with zero drift across play, pause, seek, and mute/solo', async () => {
    const fakeCtx = new FakeMixerAudioContext();
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    let urlSeq = 0;

    const mixer = new SixStemWebAudioMixerController({
      createAudioContext: () => fakeCtx,
      createObjectURL: () => {
        const u = `blob:mixer-test-${++urlSeq}`;
        createdUrls.push(u);
        return u;
      },
      revokeObjectURL: (u) => {
        revokedUrls.push(u);
      },
      yieldToMainThread: async () => {},
    });

    const stems = await buildFakeSixStems(44100, 44100);
    const loadedSnap = await mixer.loadStems(stems, {
      modelId: 'htdemucs_6s_onnx',
      modelVersion: 'v4-6s-fp16weights',
      sourceSha256: 'c'.repeat(64),
    });

    expect(loadedSnap.state).toBe('ready');
    expect(loadedSnap.totalFrames).toBe(44100);
    expect(loadedSnap.durationSeconds).toBe(1);
    expect(createdUrls).toHaveLength(6);

    // Play -> all 6 sources must start at identical context.currentTime + lookahead (2.525) and offset 0
    fakeCtx.currentTime = 2.5;
    const playSnap = await mixer.play();
    expect(playSnap.state).toBe('playing');
    expect(playSnap.maxInterStemStartDriftSeconds).toBe(0);
    expect(playSnap.scheduleDeadlineMissed).toBe(false);
    expect(playSnap.activeSourceCount).toBe(6);
    expect(fakeCtx.sources).toHaveLength(6);
    for (const src of fakeCtx.sources) {
      expect(src.startCalls).toEqual([{ when: 2.525, offset: 0 }]);
    }

    // Mute / Solo / Volume adjustments during playback must NOT restart BufferSourceNodes
    mixer.setStemVolume('vocals', 0.4);
    mixer.setStemMuted('drums', true);
    let snap = mixer.getSnapshot();
    expect(snap.stems.vocals.effectiveGain).toBeCloseTo(0.4, 5);
    expect(snap.stems.drums.isAudible).toBe(false);
    expect(snap.stems.drums.effectiveGain).toBe(0);
    expect(fakeCtx.sources).toHaveLength(6);

    // Zero volume marks channel non-audible even without mute/solo
    mixer.setStemVolume('guitar', 0);
    expect(mixer.getSnapshot().stems.guitar.isAudible).toBe(false);
    mixer.setStemVolume('guitar', 1);
    mixer.setMasterVolume(0);
    expect(mixer.getSnapshot().stems.vocals.isAudible).toBe(false);
    mixer.setMasterVolume(1);

    // Single solo silences non-soloed stems
    mixer.setStemSolo('piano', true);
    snap = mixer.getSnapshot();
    expect(snap.anySoloActive).toBe(true);
    expect(snap.stems.piano.isAudible).toBe(true);
    expect(snap.stems.vocals.isAudible).toBe(false);
    expect(snap.stems.bass.isAudible).toBe(false);

    // Multi-solo activates both soloed non-muted stems
    mixer.setStemSolo('bass', true);
    snap = mixer.getSnapshot();
    expect(snap.stems.piano.isAudible).toBe(true);
    expect(snap.stems.bass.isAudible).toBe(true);
    expect(snap.stems.guitar.isAudible).toBe(false);
    // gainNodes: [0]=master, [1..6]=vocals,drums,bass,guitar,piano,other
    expect(fakeCtx.gains[3].gain.value).toBe(1); // bass
    expect(fakeCtx.gains[5].gain.value).toBe(1); // piano
    expect(fakeCtx.gains[4].gain.value).toBe(0); // guitar
    expect(fakeCtx.sources).toHaveLength(6);

    // Seek while playing stops first 6 sources and schedules 6 new sources identically at 3.025 / 0.5s offset
    fakeCtx.currentTime = 3.0;
    const seekSnap = mixer.seekSeconds(0.5);
    expect(seekSnap.state).toBe('playing');
    expect(seekSnap.currentFrame).toBe(22050);
    expect(seekSnap.maxInterStemStartDriftSeconds).toBe(0);
    expect(fakeCtx.sources).toHaveLength(12);
    for (let i = 0; i < 6; i++) {
      expect(fakeCtx.sources[i].stopped).toBe(true);
    }
    for (let i = 6; i < 12; i++) {
      expect(fakeCtx.sources[i].startCalls).toEqual([{ when: 3.025, offset: 0.5 }]);
    }

    // Pause advances position accurately from AudioContext clock (3.275 - 3.025 = 0.25s = 11025 frames -> 33075)
    fakeCtx.currentTime = 3.275;
    const pauseSnap = mixer.pause();
    expect(pauseSnap.state).toBe('paused');
    expect(pauseSnap.currentFrame).toBe(33075);

    // Natural end of playback when source.onended fires resets cleanly to ready @ frame 0
    await mixer.play();
    const latestSource = fakeCtx.sources.at(-1)!;
    latestSource.onended?.();
    expect(mixer.getSnapshot().state).toBe('ready');
    expect(mixer.getSnapshot().currentFrame).toBe(0);

    // Library target preparation supports only ministry_library and louvaio_library
    mixer.setTargetLibrary('louvaio_library');
    const louvaioDraft = mixer.buildLibraryPublishDraft({
      ministryId: 'min-1',
      songId: 'song-1',
      canonicalVersionId: 'ver-1',
    });
    expect(louvaioDraft.targetLibrary).toBe('louvaio_library');
    expect(louvaioDraft.ministryId).toBeNull();
    expect(Object.keys(louvaioDraft.stems)).toEqual([...CANONICAL_STEM_IDS]);

    mixer.setTargetLibrary('ministry_library');
    const ministryDraft = mixer.buildLibraryPublishDraft({
      ministryId: 'min-1',
      songId: 'song-1',
      canonicalVersionId: 'ver-1',
    });
    expect(ministryDraft.targetLibrary).toBe('ministry_library');
    expect(ministryDraft.ministryId).toBe('min-1');

    expect(() =>
      mixer.setTargetLibrary('personal_library' as TargetAudioLibraryKind)
    ).toThrowError(expect.objectContaining({ code: 'INVALID_DESCRIPTOR' }));

    // Dispose stops active sources, closes AudioContext, and revokes all 6 blob URLs
    await mixer.play();
    mixer.dispose();
    const diag = mixer.getDiagnostics();
    expect(diag.disposed).toBe(true);
    expect(fakeCtx.closed).toBe(true);
    expect(revokedUrls).toHaveLength(6);
    expect(diag.activeObjectUrlCount).toBe(0);
    expect(mixer.getSnapshot().state).toBe('disposed');
  });

  it('rejects incomplete stem sets and mismatched sampleRate/frame counts cleanly', async () => {
    const fakeCtx = new FakeMixerAudioContext();
    const mixer = new SixStemWebAudioMixerController({
      createAudioContext: () => fakeCtx,
      createObjectURL: () => 'blob:err',
      revokeObjectURL: () => {},
    });

    const stems = await buildFakeSixStems(1000, 44100);
    const missingOne = stems.slice(0, 5);
    const errSnap1 = await mixer.loadStems(missingOne);
    expect(errSnap1.state).toBe('error');
    expect(errSnap1.error?.code).toBe('INVALID_AUDIO');

    // Frame mismatch on one stem
    const mismatchedStems = [...stems];
    mismatchedStems[2] = {
      ...(await buildFakeSixStems(800, 44100))[2],
      id: 'bass' as CanonicalStemId,
    };
    const errSnap2 = await mixer.loadStems(mismatchedStems);
    expect(errSnap2.state).toBe('error');
    expect(errSnap2.error?.code).toBe('INVALID_AUDIO');

    mixer.dispose();
  });

  it('prevents play-during-resume vs stop/pause races, reports real advancing-clock deadline misses, and drops stale metadata/audio on reload or clear', async () => {
    let releaseResume: (() => void) | null = null;
    let currentClock = 1.0;
    let advanceOnStart = false;
    const fakeCtx: MixerAudioContextLike = {
      get currentTime() {
        return currentClock;
      },
      sampleRate: 44100,
      state: 'suspended',
      destination: {},
      createGain: () => new FakeMixerGainNode(),
      createBuffer: (c, l, r) => new FakeMixerAudioBuffer(c, l, r),
      createBufferSource: () => {
        const s = new FakeMixerBufferSourceNode();
        const origStart = s.start.bind(s);
        s.start = (when?: number, offset?: number) => {
          if (advanceOnStart) {
            currentClock += 0.01;
          }
          origStart(when, offset);
        };
        return s;
      },
      resume: async () => {
        await new Promise<void>((r) => {
          releaseResume = () => {
            (fakeCtx as { state: AudioContextState }).state = 'running';
            r();
          };
        });
      },
      close: async () => {},
    };

    const observedStates: string[] = [];
    const mixer = new SixStemWebAudioMixerController({
      createAudioContext: () => fakeCtx,
      createObjectURL: () => `blob:race-${Math.random()}`,
      revokeObjectURL: () => {},
      scheduleLookaheadSeconds: 0.025,
      yieldToMainThread: async () => {},
    });
    mixer.subscribe((s) => observedStates.push(`${s.state}:${s.totalFrames}`));

    const track1 = await buildFakeSixStems(1000, 44100);
    await mixer.loadStems(track1, {
      modelId: 'm1',
      modelVersion: 'v1',
      sourceSha256: 'e'.repeat(64),
    });

    // Race 1: stop() while awaiting AudioContext.resume() cancels pending play()
    const pendingPlay1 = mixer.play();
    mixer.stop();
    releaseResume!();
    const afterStopSnap = await pendingPlay1;
    expect(afterStopSnap.state).toBe('ready');
    expect(afterStopSnap.activeSourceCount).toBe(0);

    // Race 2: pause() while awaiting AudioContext.resume() cancels pending play()
    (fakeCtx as { state: AudioContextState }).state = 'suspended';
    const pendingPlay2 = mixer.play();
    mixer.pause();
    releaseResume!();
    const afterPauseSnap = await pendingPlay2;
    expect(afterPauseSnap.state).toBe('ready');
    expect(afterPauseSnap.activeSourceCount).toBe(0);

    // Lookahead keeps advancing-clock drift at 0 when lookahead > loop span (6 * 0.01 = 0.06 > 0.025 reports overrun)
    (fakeCtx as { state: AudioContextState }).state = 'running';
    advanceOnStart = true;
    const deadlineMissedSnap = await mixer.play();
    expect(deadlineMissedSnap.state).toBe('paused');
    expect(deadlineMissedSnap.activeSourceCount).toBe(0);
    expect(deadlineMissedSnap.scheduleDeadlineMissed).toBe(true);
    expect(deadlineMissedSnap.maxInterStemStartDriftSeconds).toBeCloseTo(
      0.035,
      5
    );
    advanceOnStart = false;

    // Reload track2 without metadata clears previous sourceSha256 and clears audio during 'loading'
    observedStates.length = 0;
    const track2 = await buildFakeSixStems(600, 44100);
    await mixer.loadStems(track2);
    expect(observedStates[0]).toBe('loading:0');
    expect(() =>
      mixer.buildLibraryPublishDraft()
    ).not.toThrow();
    expect(mixer.buildLibraryPublishDraft().sourceSha256).toBeNull();

    mixer.clear();
    expect(mixer.getSnapshot().state).toBe('idle');
    expect(mixer.getSnapshot().totalFrames).toBe(0);

    // Oversized stem frame counts exceeding MAX_SEPARATION_TOTAL_FRAMES fail closed before creating AudioBuffers
    const createBufferSpy: number[] = [];
    const cappedMixer = new SixStemWebAudioMixerController({
      createAudioContext: () => ({
        ...fakeCtx,
        createBuffer: (c, l, r) => {
          createBufferSpy.push(l);
          return new FakeMixerAudioBuffer(c, l, r);
        },
      }),
      createObjectURL: () => 'blob:oversized',
      revokeObjectURL: () => {},
      yieldToMainThread: async () => {},
    });
    const fakeHugeStems = (await buildFakeSixStems(4, 44100)).map((s) => ({
      ...s,
      totalFrames: MAX_SEPARATION_TOTAL_FRAMES + 1,
    }));
    const errHuge = await cappedMixer.loadStems(fakeHugeStems);
    expect(errHuge.state).toBe('error');
    expect(errHuge.error?.code).toBe('INVALID_AUDIO');
    expect(createBufferSpy).toHaveLength(0);

    // 1-byte garbage wavBytes paired with valid PCM arrays must fail with CORRUPT_WAV BEFORE ready/export
    const garbageWavStems = (await buildFakeSixStems(4, 44100)).map((s) => ({
      ...s,
      wavBytes: new Uint8Array([0xff]),
      byteLength: 1,
    }));
    const errGarbageWav = await cappedMixer.loadStems(garbageWavStems);
    expect(errGarbageWav.state).toBe('error');
    expect(errGarbageWav.error?.code).toBe('CORRUPT_WAV');
    expect(createBufferSpy).toHaveLength(0);

    // Mismatched declared sha256 metadata fails closed before allocating AudioBuffers
    const spoofedShaStems = (await buildFakeSixStems(4, 44100)).map((s) => ({
      ...s,
      sha256: 'f'.repeat(64),
    }));
    const errSpoofedSha = await cappedMixer.loadStems(spoofedShaStems);
    expect(errSpoofedSha.state).toBe('error');
    expect(errSpoofedSha.error?.code).toBe('INVALID_AUDIO');
    expect(createBufferSpy).toHaveLength(0);

    cappedMixer.dispose();
    mixer.dispose();
  });

  it('uses an immutable WAV snapshot as single source of truth against divergent caller PCM, yield-time TOCTOU mutations, and >1.0 Demucs peaks', async () => {
    const allocatedBuffers: FakeMixerAudioBuffer[] = [];
    const exportedBlobs: Blob[] = [];
    let yieldCount = 0;

    const fakeCtx: MixerAudioContextLike = {
      currentTime: 0,
      sampleRate: 44100,
      state: 'running',
      destination: {},
      createGain: () => new FakeMixerGainNode(),
      createBuffer: (c, l, r) => {
        const buf = new FakeMixerAudioBuffer(c, l, r);
        allocatedBuffers.push(buf);
        return buf;
      },
      createBufferSource: () => new FakeMixerBufferSourceNode(),
      resume: async () => {},
      close: async () => {},
    };

    let stemsRef: Array<{
      id: CanonicalStemId;
      sampleRate: number;
      left?: Float32Array;
      right?: Float32Array;
      wavBytes: Uint8Array;
      byteLength?: number;
      sha256?: string;
    }> = [];
    let metadataRef: {
      modelId: string;
      modelVersion: string;
      sourceSha256: string;
    } | null = null;

    const mixer = new SixStemWebAudioMixerController({
      createAudioContext: () => fakeCtx,
      createObjectURL: (blob) => {
        exportedBlobs.push(blob);
        return `blob:single-source-${exportedBlobs.length}`;
      },
      revokeObjectURL: () => {},
      yieldToMainThread: async () => {
        yieldCount += 1;
        // Simulate hostile mid-load caller mutation across ALL 6 stems + metadata during async yields (TOCTOU test)
        for (const stem of stemsRef) {
          if (stem.left) {
            stem.left[0] = 2.0;
          }
          stem.wavBytes[44] ^= 0x7f;
        }
        stemsRef.length = 0;
        if (metadataRef) {
          metadataRef.sourceSha256 = 'f'.repeat(64);
        }
      },
    });

    // 1) Divergent caller PCM/stats (0.5) paired with silent WAV bytes: playback, stats, and export all strictly reflect WAV (0.0)
    const silentWav = encodeStereoPcm16Wav({
      sampleRate: 44100,
      left: new Float32Array(4),
      right: new Float32Array(4),
    });
    const silentSha = await computeSha256Hex(silentWav);
    const divergentStems = (await buildFakeSixStems(4, 44100)).map((s) => ({
      ...s,
      left: new Float32Array(4).fill(0.5),
      right: new Float32Array(4).fill(0.5),
      rms: 0.5,
      peak: 0.5,
      wavBytes: new Uint8Array(silentWav),
      byteLength: silentWav.byteLength,
      sha256: silentSha,
    }));
    stemsRef = [];
    const silentSnap = await mixer.loadStems(divergentStems);
    expect(silentSnap.state).toBe('ready');
    for (const buf of allocatedBuffers) {
      expect(Array.from(buf.getChannelData(0))).toEqual([0, 0, 0, 0]);
      expect(Array.from(buf.getChannelData(1))).toEqual([0, 0, 0, 0]);
    }
    expect(silentSnap.stems.vocals.rms).toBe(0);
    expect(silentSnap.stems.vocals.peak).toBe(0);
    expect(await readBlobBytes(exportedBlobs[0])).toEqual(silentWav);

    // 2) Peak > 1.0 (1.05) + high-amplitude boundaries (0.9460890293) + full-set/metadata yield-time TOCTOU mutation without declared stem sha256
    allocatedBuffers.length = 0;
    exportedBlobs.length = 0;
    const hotLeft = new Float32Array([1.0, 0.9460890293, 1.05, -1.0]);
    const hotRight = new Float32Array([1.05, -1.0, 0.9460890293, 1.0]);
    const hotWav = encodeStereoPcm16Wav({
      sampleRate: 44100,
      left: hotLeft,
      right: hotRight,
    });
    const hotSha = await computeSha256Hex(hotWav);
    const builtHotStems = (await buildFakeSixStems(4, 44100)).map((s, idx) => ({
      id: s.id,
      sampleRate: s.sampleRate,
      left: new Float32Array(hotLeft),
      right: new Float32Array(hotRight),
      wavBytes: new Uint8Array(hotWav),
      byteLength: hotWav.byteLength,
      // Omit sha256 on drums (idx 1) and rest to prove mutation immunity does not rely on hash rejection
      ...(idx === 0 ? { sha256: hotSha } : {}),
    }));
    stemsRef = builtHotStems;
    const originalSourceSha = 'a'.repeat(64);
    metadataRef = {
      modelId: 'htdemucs_6s_onnx',
      modelVersion: 'v4-6s-fp16weights',
      sourceSha256: originalSourceSha,
    };

    const hotSnap = await mixer.loadStems(stemsRef, metadataRef);
    expect(yieldCount).toBeGreaterThan(0);
    expect(hotSnap.state).toBe('ready');
    // Caller mutations across any stem (including drums/other), array truncation, and metadata during yields must have zero effect
    for (let idx = 0; idx < CANONICAL_STEM_IDS.length; idx++) {
      const stemId = CANONICAL_STEM_IDS[idx];
      expect(hotSnap.stems[stemId].sha256).toBe(hotSha);
      expect(allocatedBuffers[idx].getChannelData(0)[0]).toBeCloseTo(32767 / 32768, 6);
      expect(allocatedBuffers[idx].getChannelData(0)[2]).toBeCloseTo(32767 / 32768, 6);
      expect(allocatedBuffers[idx].getChannelData(0)[3]).toBeCloseTo(-1, 6);
      expect(await readBlobBytes(exportedBlobs[idx])).toEqual(hotWav);
    }
    expect(mixer.buildLibraryPublishDraft().sourceSha256).toBe(originalSourceSha);

    mixer.dispose();
  });
});
