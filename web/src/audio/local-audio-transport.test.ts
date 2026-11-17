import { describe, expect, it, vi } from 'vitest';
import {
  LocalAudioTransportController,
  MAX_TRANSPORT_RATE,
  MIN_TRANSPORT_RATE,
  WAV_HEADER_SLICE_BYTES,
  clampFrame,
  createSyntheticWavFile,
  estimatePcmMemoryBudget,
  framesToSeconds,
  parseWavHeaderSlice,
  readBlobAsArrayBuffer,
  secondsToFrames,
  type MediaElementLike,
  type TransportSnapshot,
} from './local-audio-transport';

class FakeMediaElement implements MediaElementLike {
  src = '';
  autoplay = false;
  preload = 'metadata';
  currentTime = 0;
  duration = NaN;
  playbackRate = 1;
  preservesPitch = true;
  volume = 1;
  paused = true;
  error: { code?: number; message?: string } | null = null;
  loadCalls = 0;
  playCalls = 0;
  pauseCalls = 0;

  private listeners = new Map<string, Set<EventListener>>();
  private onLoadBehavior: (el: FakeMediaElement) => void;
  private onPlayBehavior?: (el: FakeMediaElement) => Promise<void> | void;

  constructor(options?: {
    duration?: number;
    autoResolveLoad?: boolean;
    failDecode?: boolean;
    onPlayBehavior?: (el: FakeMediaElement) => Promise<void> | void;
  }) {
    const duration = options?.duration ?? 2;
    const autoResolve = options?.autoResolveLoad ?? true;
    this.onPlayBehavior = options?.onPlayBehavior;
    this.onLoadBehavior = (el) => {
      if (!autoResolve) return;
      queueMicrotask(() => {
        if (options?.failDecode) {
          el.error = { code: 4, message: 'MEDIA_ELEMENT_ERROR: Format error' };
          el.dispatch('error');
          return;
        }
        el.duration = duration;
        el.dispatch('loadedmetadata');
      });
    };
  }

  addEventListener(type: string, listener: EventListener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const evt = new Event(type);
    for (const listener of [...set]) {
      listener(evt);
    }
  }

  removeAttribute(qualifiedName: string): void {
    if (qualifiedName === 'src') {
      this.src = '';
    }
  }

  load(): void {
    this.loadCalls += 1;
    if (this.src) {
      this.onLoadBehavior(this);
    }
  }

  async play(): Promise<void> {
    this.playCalls += 1;
    if (this.onPlayBehavior) {
      await this.onPlayBehavior(this);
    }
    this.paused = false;
    this.dispatch('playing');
  }

  pause(): void {
    this.pauseCalls += 1;
    this.paused = true;
    this.dispatch('pause');
  }
}

function createFakeUrlRegistry() {
  let counter = 0;
  const active = new Set<string>();
  const created: string[] = [];
  const revoked: string[] = [];
  return {
    active,
    created,
    revoked,
    createObjectURL: vi.fn((_blob: Blob) => {
      counter += 1;
      const url = `blob:local-test/${counter}`;
      active.add(url);
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      active.delete(url);
      revoked.push(url);
    }),
  };
}

function createMockAudioContext() {
  const gainParam = {
    value: 1,
    setValueAtTime: vi.fn((v: number) => {
      gainParam.value = v;
    }),
  };
  const gainNode = {
    gain: gainParam,
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const sourceNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createMediaElementSource: vi.fn(() => sourceNode),
    createGain: vi.fn(() => gainNode),
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
    }),
  };
  return {
    ctx: ctx as unknown as AudioContext,
    raw: ctx,
    gainNode,
    sourceNode,
  };
}

describe('local-audio-transport pure math and header helpers', () => {
  it('converts and clamps frames deterministically', () => {
    expect(secondsToFrames(0.5, 44100)).toBe(22050);
    expect(framesToSeconds(22050, 44100)).toBe(0.5);
    expect(secondsToFrames(-1, 44100)).toBe(0);
    expect(secondsToFrames(Number.NaN, 44100)).toBe(0);
    expect(framesToSeconds(100, 0)).toBe(0);
    expect(clampFrame(-50, 88200)).toBe(0);
    expect(clampFrame(999999, 88200)).toBe(88200);
    expect(clampFrame(44100.4, 88200)).toBe(44100);
  });

  it('estimates full Float32 PCM vs PCM16 memory footprint', () => {
    // 5 minutes (300s) stereo 44.1 kHz
    const singleTrack = estimatePcmMemoryBudget({
      durationSeconds: 300,
      sampleRate: 44100,
      channels: 2,
      stems: 1,
    });
    expect(singleTrack.estimatedPcm16Bytes).toBe(300 * 44100 * 2 * 2);
    expect(singleTrack.estimatedFullFloat32PcmBytes).toBe(300 * 44100 * 2 * 4);
  });

  it('creates synthetic WAV file and parses only initial header slice', async () => {
    const wav = createSyntheticWavFile({
      durationSeconds: 1.5,
      sampleRate: 44100,
      channels: 2,
      frequencyHz: 880,
      fileName: 'tone-880.wav',
    });
    const headerBuf = await readBlobAsArrayBuffer(
      wav.slice(0, WAV_HEADER_SLICE_BYTES)
    );
    const parsed = parseWavHeaderSlice(headerBuf);
    expect(parsed).not.toBeNull();
    expect(parsed?.sampleRate).toBe(44100);
    expect(parsed?.channels).toBe(2);
    expect(parsed?.bitsPerSample).toBe(16);
    expect(parsed?.totalFrames).toBe(66150);
    expect(parsed?.durationSeconds).toBeCloseTo(1.5, 6);
  });

  it('returns null when parsing truncated or corrupt WAV header', () => {
    const bad = new TextEncoder().encode('NOT_A_RIFF_WAV_FILE_PAYLOAD').buffer;
    expect(parseWavHeaderSlice(bad)).toBeNull();
    expect(parseWavHeaderSlice(new ArrayBuffer(12))).toBeNull();
  });
});

describe('LocalAudioTransportController', () => {
  it('follows state machine idle -> loading -> ready -> playing -> paused -> idle and enforces no autoplay', async () => {
    const urls = createFakeUrlRegistry();
    const audio = new FakeMediaElement({ duration: 2 });
    const mockCtx = createMockAudioContext();
    const states: string[] = [];

    const controller = new LocalAudioTransportController(
      { accountNamespace: 'acc-1', ministryId: 'min-1' },
      {
        createAudioElement: () => audio,
        createAudioContext: () => mockCtx.ctx,
        createObjectURL: urls.createObjectURL,
        revokeObjectURL: urls.revokeObjectURL,
      }
    );

    controller.subscribe((snap) => states.push(snap.state));
    const wav = createSyntheticWavFile({ durationSeconds: 2, frequencyHz: 440 });

    const ready = await controller.load(wav);
    expect(ready.state).toBe('ready');
    expect(ready.generation).toBe(1);
    expect(ready.totalFrames).toBe(88200);
    expect(ready.currentFrame).toBe(0);
    expect(audio.autoplay).toBe(false);
    expect(audio.playCalls).toBe(0);
    expect(urls.active.size).toBe(1);

    const playing = await controller.play();
    expect(playing.state).toBe('playing');
    expect(audio.playCalls).toBe(1);

    const paused = controller.pause();
    expect(paused.state).toBe('paused');
    expect(audio.pauseCalls).toBeGreaterThanOrEqual(1);

    const stopped = controller.stop();
    expect(stopped.state).toBe('idle');
    expect(stopped.currentFrame).toBe(0);
    expect(stopped.fileName).toBeNull();
    expect(urls.active.size).toBe(0);
    expect(urls.revoked.length).toBe(1);
    expect(states).toEqual([
      'idle',
      'loading',
      'ready',
      'playing',
      'paused',
      'idle',
    ]);
  });

  it('seeks in frames with clamping and supports gain and playback rate 0.5x..1.5x with pitch distinction', async () => {
    const urls = createFakeUrlRegistry();
    const audio = new FakeMediaElement({ duration: 4 });
    const mockCtx = createMockAudioContext();

    const controller = new LocalAudioTransportController(undefined, {
      createAudioElement: () => audio,
      createAudioContext: () => mockCtx.ctx,
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    const wav = createSyntheticWavFile({ durationSeconds: 4, sampleRate: 44100 });
    await controller.load(wav);

    // Seek inside bounds
    const mid = controller.seek(44100);
    expect(mid.currentFrame).toBe(44100);
    expect(mid.currentTimeSeconds).toBeCloseTo(1, 6);
    expect(audio.currentTime).toBeCloseTo(1, 6);

    // Clamp below 0 and above totalFrames
    expect(controller.seek(-1000).currentFrame).toBe(0);
    expect(controller.seek(9999999).currentFrame).toBe(176400);
    expect(() => controller.seek(Number.NaN)).toThrow(RangeError);

    // Volume routed cleanly via WebAudio GainNode without double attenuation on <audio>
    const gainSnap = controller.setMasterGain(0.4);
    expect(gainSnap.masterGain).toBe(0.4);
    expect(mockCtx.gainNode.gain.value).toBe(0.4);
    expect(audio.volume).toBe(1);
    expect(controller.setMasterGain(3).masterGain).toBe(1);
    expect(controller.setMasterGain(-1).masterGain).toBe(0);
    expect(() => controller.setMasterGain(Number.POSITIVE_INFINITY)).toThrow(
      RangeError
    );

    // Speed 0.5x..1.5x and pitch preservation vs varispeed distinction
    const halfSpeed = controller.setRate(0.5);
    expect(halfSpeed.rate).toBe(MIN_TRANSPORT_RATE);
    expect(halfSpeed.preservesPitch).toBe(true);
    expect(halfSpeed.pitchShiftSemitonesSupported).toBe(false);
    expect(audio.playbackRate).toBe(0.5);
    expect(audio.preservesPitch).toBe(true);

    const varispeed = controller.setRate(1.5, { preservesPitch: false });
    expect(varispeed.rate).toBe(MAX_TRANSPORT_RATE);
    expect(varispeed.preservesPitch).toBe(false);
    expect(audio.playbackRate).toBe(1.5);
    expect(audio.preservesPitch).toBe(false);

    // Clamps outside [0.5, 1.5]
    expect(controller.setRate(0.1).rate).toBe(0.5);
    expect(controller.setRate(2.5).rate).toBe(1.5);
    expect(() => controller.setRate(Number.NaN)).toThrow(RangeError);

    controller.dispose();
  });

  it('uses fallback element volume when Web Audio GainNode is unavailable', async () => {
    const urls = createFakeUrlRegistry();
    const audio = new FakeMediaElement({ duration: 2 });

    const controller = new LocalAudioTransportController(undefined, {
      createAudioElement: () => audio,
      createAudioContext: () => null,
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    await controller.load(createSyntheticWavFile({ durationSeconds: 2 }));
    controller.setMasterGain(0.35);
    expect(audio.volume).toBe(0.35);
    controller.dispose();
  });

  it('reads only a 4 KiB header slice even on a huge WAV blob without decoding full PCM', async () => {
    const urls = createFakeUrlRegistry();
    const audio = new FakeMediaElement({ duration: 600 });
    const headerSample = createSyntheticWavFile({
      durationSeconds: 0.01,
      sampleRate: 44100,
      channels: 2,
    });
    const headerBytes = new Uint8Array(await readBlobAsArrayBuffer(headerSample));
    // Patch RIFF data size to represent 600s (10 minutes) without allocating 105 MB
    const tenMinDataBytes = 600 * 44100 * 2 * 2;
    const view = new DataView(headerBytes.buffer);
    view.setUint32(4, 36 + tenMinDataBytes, true);
    view.setUint32(40, tenMinDataBytes, true);

    const file = new File([headerBytes], 'long-10min-simulated.wav', {
      type: 'audio/wav',
    });
    const sliceSpy = vi.spyOn(file, 'slice');

    const controller = new LocalAudioTransportController(undefined, {
      createAudioElement: () => audio,
      createAudioContext: () => null,
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    const snap = await controller.load(file);
    expect(sliceSpy).toHaveBeenCalledWith(0, WAV_HEADER_SLICE_BYTES);
    expect(snap.state).toBe('ready');
    expect(snap.memoryBudget.headerSliceBytes).toBeLessThanOrEqual(
      WAV_HEADER_SLICE_BYTES
    );
    expect(snap.memoryBudget.streamingMode).toBe('blob-object-url');
    expect(snap.memoryBudget.estimatedFullFloat32PcmBytes).toBe(
      600 * 44100 * 2 * 4
    );
    controller.dispose();
  });

  it('rejects remote URLs, non-Blobs, empty files, corrupt WAV headers, and decode failures safely', async () => {
    const urls = createFakeUrlRegistry();
    const controller = new LocalAudioTransportController(undefined, {
      createAudioElement: () => new FakeMediaElement({ failDecode: true }),
      createAudioContext: () => null,
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    const remoteErr = await controller.load('https://example.com/music.mp3');
    expect(remoteErr.state).toBe('error');
    expect(remoteErr.error?.code).toBe('REMOTE_URL_FORBIDDEN');
    expect(urls.created.length).toBe(0);

    const invalidObjErr = await controller.load({ src: 'fake' });
    expect(invalidObjErr.state).toBe('error');
    expect(invalidObjErr.error?.code).toBe('INVALID_INPUT');

    const emptyFile = new File([], 'empty.wav', { type: 'audio/wav' });
    const emptyErr = await controller.load(emptyFile);
    expect(emptyErr.state).toBe('error');
    expect(emptyErr.error?.code).toBe('EMPTY_FILE');

    const corruptWav = new File(
      [new TextEncoder().encode('garbage-not-a-wav-file-at-all')],
      'broken.wav',
      { type: 'audio/wav' }
    );
    const corruptErr = await controller.load(corruptWav);
    expect(corruptErr.state).toBe('error');
    expect(corruptErr.error?.code).toBe('UNSUPPORTED_OR_CORRUPT_HEADER');
    expect(urls.active.size).toBe(0);

    const badMp3 = new File([new Uint8Array([0xff, 0xfb, 0x00, 0x00])], 'bad.mp3', {
      type: 'audio/mpeg',
    });
    const decodeErr = await controller.load(badMp3);
    expect(decodeErr.state).toBe('error');
    expect(decodeErr.error?.code).toBe('DECODE_ERROR');
    expect(urls.active.size).toBe(0);
    controller.dispose();
  });

  it('revokes prior object URL when replacing files, stops playback without autoplay, and ignores stale callbacks', async () => {
    const urls = createFakeUrlRegistry();
    const elements: FakeMediaElement[] = [];

    const controller = new LocalAudioTransportController(undefined, {
      createAudioElement: () => {
        const autoResolve = elements.length !== 0; // element[0] stays pending at loadedmetadata
        const el = new FakeMediaElement({ duration: 3, autoResolveLoad: autoResolve });
        elements.push(el);
        return el;
      },
      createAudioContext: () => createMockAudioContext().ctx,
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    const firstFile = createSyntheticWavFile({
      durationSeconds: 3,
      frequencyHz: 440,
      fileName: 'first.wav',
    });
    const secondFile = createSyntheticWavFile({
      durationSeconds: 3,
      frequencyHz: 880,
      fileName: 'second.wav',
    });

    // Start slow load #1 (gen 1) and let async header slice resolve so element[0] enters awaiting loadedmetadata
    const pendingFirstLoad = controller.load(firstFile);
    await vi.waitFor(() => {
      expect(elements.length).toBe(1);
      expect(urls.created.length).toBe(1);
    });

    // Supersede mid-load with load #2 (gen 2)
    const secondSnap = await controller.load(secondFile);
    const settledFirst = await pendingFirstLoad;

    expect(secondSnap.generation).toBe(2);
    expect(secondSnap.fileName).toBe('second.wav');
    expect(secondSnap.state).toBe('ready');
    expect(settledFirst.fileName).toBe('second.wav');
    expect(urls.revoked).toContain(urls.created[0]);
    expect(urls.active.size).toBe(1);

    // Late stale callbacks emitted on elements[0] must NOT touch gen 2 state
    elements[0].duration = 99;
    elements[0].currentTime = 50;
    elements[0].dispatch('loadedmetadata');
    elements[0].dispatch('playing');
    elements[0].dispatch('timeupdate');
    elements[0].dispatch('error');
    elements[0].dispatch('ended');

    const afterStale = controller.getSnapshot();
    expect(afterStale.generation).toBe(2);
    expect(afterStale.state).toBe('ready');
    expect(afterStale.fileName).toBe('second.wav');
    expect(afterStale.currentFrame).toBe(0);

    // Synchronous race during initial header slice read also aborts cleanly before creating URL #4
    const pendingSyncRace = controller.load(firstFile);
    const winningSnap = await controller.load(secondFile);
    await pendingSyncRace;
    expect(winningSnap.fileName).toBe('second.wav');
    expect(winningSnap.generation).toBe(4);
    expect(urls.active.size).toBe(1);

    // Start playing active element, then replace with another file -> stops playing & never autoplays
    await controller.play();
    expect(controller.getSnapshot().state).toBe('playing');

    const playingElemIndex = elements.length - 1;
    const thirdSnap = await controller.load(firstFile);
    expect(thirdSnap.state).toBe('ready');
    expect(thirdSnap.generation).toBe(5);
    expect(elements[playingElemIndex].pauseCalls).toBeGreaterThanOrEqual(1);
    expect(elements[elements.length - 1].playCalls).toBe(0);
    expect(urls.active.size).toBe(1);

    controller.dispose();
  });

  it('invalidates playback and revokes resources on account/ministry change and dispose', async () => {
    const urls = createFakeUrlRegistry();
    const mockCtx = createMockAudioContext();
    const events: TransportSnapshot[] = [];

    const controller = new LocalAudioTransportController(
      { accountNamespace: 'user-a', ministryId: 'min-a' },
      {
        createAudioElement: () => new FakeMediaElement({ duration: 2 }),
        createAudioContext: () => mockCtx.ctx,
        createObjectURL: urls.createObjectURL,
        revokeObjectURL: urls.revokeObjectURL,
      }
    );
    controller.subscribe((s) => events.push(s));

    await controller.load(createSyntheticWavFile({ durationSeconds: 2 }));
    await controller.play();
    expect(controller.getSnapshot().state).toBe('playing');

    // Same account + same ministry -> stays playing
    controller.setSessionContext({
      accountNamespace: 'user-a',
      ministryId: 'min-a',
      songId: 'song-2',
      versionId: 'ver-2',
    });
    expect(controller.getSnapshot().state).toBe('playing');

    // Ministry change -> immediate stop + URL revoked
    const afterSwitch = controller.setSessionContext({
      accountNamespace: 'user-a',
      ministryId: 'min-b',
    });
    expect(afterSwitch.state).toBe('idle');
    expect(urls.active.size).toBe(0);

    // Reload and play, then dispose permanently
    await controller.load(createSyntheticWavFile({ durationSeconds: 2 }));
    await controller.play();
    const snapshotCountBeforeDispose = events.length;
    controller.dispose();

    expect(controller.getDiagnostics().disposed).toBe(true);
    expect(urls.active.size).toBe(0);
    expect(mockCtx.raw.close).toHaveBeenCalledTimes(1);

    // Post-dispose operations are safe no-ops and do not emit stale snapshots
    await controller.play();
    controller.pause();
    controller.seek(100);
    controller.setRate(1.2);
    controller.setMasterGain(0.5);
    expect(events.length).toBe(snapshotCountBeforeDispose);
  });

  it('resumes suspended AudioContext and handles blocked autoplay rejections safely without corruption', async () => {
    const urls = createFakeUrlRegistry();
    const mockCtx = createMockAudioContext();
    mockCtx.raw.state = 'suspended';

    let rejectPlayOnce = true;
    const audio = new FakeMediaElement({
      duration: 2,
      onPlayBehavior: async () => {
        if (rejectPlayOnce) {
          rejectPlayOnce = false;
          throw new Error('NotAllowedError: play() failed without user gesture');
        }
      },
    });

    const controller = new LocalAudioTransportController(undefined, {
      createAudioElement: () => audio,
      createAudioContext: () => mockCtx.ctx,
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    await controller.load(createSyntheticWavFile({ durationSeconds: 2 }));
    const rejected = await controller.play();
    expect(mockCtx.raw.resume).toHaveBeenCalledTimes(1);
    expect(rejected.state).toBe('error');
    expect(rejected.error?.code).toBe('PLAYBACK_REJECTED');

    // Retry play directly once a user gesture unlocks playback (without forcing reload)
    const recovered = await controller.play();
    expect(recovered.state).toBe('playing');
    expect(recovered.error).toBeNull();

    controller.dispose();
  });

  it('does not overwrite paused with PLAYBACK_REJECTED when pause() aborts an in-flight play()', async () => {
    const urls = createFakeUrlRegistry();
    let rejectPendingPlay!: (reason?: unknown) => void;
    const audio = new FakeMediaElement({
      duration: 2,
      onPlayBehavior: () =>
        new Promise<void>((_resolve, reject) => {
          rejectPendingPlay = reject;
        }),
    });

    const controller = new LocalAudioTransportController(undefined, {
      createAudioElement: () => audio,
      createAudioContext: () => null,
      createObjectURL: urls.createObjectURL,
      revokeObjectURL: urls.revokeObjectURL,
    });

    await controller.load(createSyntheticWavFile({ durationSeconds: 2 }));
    const playPromise = controller.play();
    const pausedSnap = controller.pause();
    expect(pausedSnap.state).toBe('paused');

    rejectPendingPlay(new DOMException('The play() request was interrupted by a call to pause().', 'AbortError'));
    const settledPlay = await playPromise;
    expect(settledPlay.state).toBe('paused');
    expect(settledPlay.error).toBeNull();

    controller.dispose();
  });
});
