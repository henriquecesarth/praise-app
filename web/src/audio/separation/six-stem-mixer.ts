import {
  AudioSeparationError,
  CANONICAL_STEM_IDS,
  DEFAULT_MAX_AUDIO_SECONDS,
  MAX_AUDIO_WAV_BYTES,
  MAX_SEPARATION_TOTAL_FRAMES,
  STEM_DISPLAY_LABELS_PT_BR,
  computeSha256Hex,
  decodeWavToStereoFloat32,
  parseStrictWavDescriptor,
  type CanonicalStemId,
  type SeparatedStemOutput,
} from './demucs-onnx-separator';
import { clampFrame, framesToSeconds } from '../local-audio-transport';

export type TargetAudioLibraryKind = 'ministry_library' | 'louvaio_library';

export type SixStemMixerState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'error'
  | 'disposed';

export interface SeparatedStemMixerInput {
  id: CanonicalStemId;
  labelPtBr?: string;
  sampleRate: number;
  totalFrames?: number;
  wavBytes: Uint8Array;
  byteLength?: number;
  sha256?: string;
}

export interface SeparatedMixerMetadata {
  modelId: string;
  modelVersion: string;
  sourceSha256?: string | null;
}

export interface SeparatedLibraryPublishDraft {
  targetLibrary: TargetAudioLibraryKind;
  ministryId: string | null;
  songId: string | null;
  canonicalVersionId: string | null;
  sourceSha256: string | null;
  modelId: string;
  modelVersion: string;
  sampleRate: number;
  totalFrames: number;
  durationSeconds: number;
  stems: Record<
    CanonicalStemId,
    {
      id: CanonicalStemId;
      labelPtBr: string;
      byteLength: number;
      sha256: string;
      rms: number;
      peak: number;
      totalFrames: number;
    }
  >;
}

export interface MixerStemChannelSnapshot {
  id: CanonicalStemId;
  labelPtBr: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  effectiveGain: number;
  isAudible: boolean;
  rms: number;
  peak: number;
  byteLength: number;
  sha256: string;
  downloadUrl: string | null;
}

export interface SixStemMixerSnapshot {
  state: SixStemMixerState;
  sampleRate: number;
  totalFrames: number;
  currentFrame: number;
  durationSeconds: number;
  currentTimeSeconds: number;
  masterVolume: number;
  anySoloActive: boolean;
  targetLibrary: TargetAudioLibraryKind;
  stems: Record<CanonicalStemId, MixerStemChannelSnapshot>;
  orderedStems: readonly MixerStemChannelSnapshot[];
  maxInterStemStartDriftSeconds: number;
  scheduleDeadlineMissed: boolean;
  scheduleSpanSeconds: number;
  activeSourceCount: number;
  error: { code: string; message: string } | null;
}

export interface MixerGainNodeLike {
  gain: { value: number };
  connect(destination: unknown): unknown;
  disconnect(): void;
}

export interface MixerAudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

export interface MixerBufferSourceNodeLike {
  buffer: MixerAudioBufferLike | null;
  onended: (() => void) | null;
  connect(destination: unknown): unknown;
  disconnect(): void;
  start(when?: number, offset?: number): void;
  stop(when?: number): void;
}

export interface MixerAudioContextLike {
  readonly currentTime: number;
  readonly sampleRate: number;
  readonly state: AudioContextState;
  readonly destination: unknown;
  createGain(): MixerGainNodeLike;
  createBuffer(
    numberOfChannels: number,
    length: number,
    sampleRate: number
  ): MixerAudioBufferLike;
  createBufferSource(): MixerBufferSourceNodeLike;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export const DEFAULT_MIXER_SCHEDULE_LOOKAHEAD_SECONDS = 0.025;

export interface SixStemMixerDependencies {
  createAudioContext?: (sampleRateHint: number) => MixerAudioContextLike | null;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  scheduleLookaheadSeconds?: number;
  yieldToMainThread?: () => Promise<void>;
  limits?: { wavBytes: number; frames: number; seconds: number };
  enableWavDownloads?: boolean;
}

function defaultYieldToMainThread(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createWavBlobWithoutCopy(wavBytes: Uint8Array): Blob {
  if (wavBytes.buffer instanceof ArrayBuffer) {
    return new Blob([wavBytes as Uint8Array<ArrayBuffer>], {
      type: 'audio/wav',
    });
  }
  const copy = new Uint8Array(wavBytes.byteLength);
  copy.set(wavBytes);
  return new Blob([copy], { type: 'audio/wav' });
}

function defaultCreateAudioContext(
  sampleRateHint: number
): MixerAudioContextLike | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  try {
    return new Ctor({ sampleRate: sampleRateHint }) as unknown as MixerAudioContextLike;
  } catch {
    try {
      return new Ctor() as unknown as MixerAudioContextLike;
    } catch {
      return null;
    }
  }
}

function clampUnitVolume(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.min(1, value));
}

function computeSignalStats(left: Float32Array, right: Float32Array): {
  rms: number;
  peak: number;
} {
  let sumSq = 0;
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const l = left[i];
    const r = right[i];
    sumSq += l * l + r * r;
    const absMax = Math.max(Math.abs(l), Math.abs(r));
    if (absMax > peak) {
      peak = absMax;
    }
  }
  const rms = left.length > 0 ? Math.sqrt(sumSq / (left.length * 2)) : 0;
  return { rms, peak };
}

interface InternalStemState {
  id: CanonicalStemId;
  labelPtBr: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  rms: number;
  peak: number;
  byteLength: number;
  sha256: string;
  downloadUrl: string | null;
  audioBuffer: MixerAudioBufferLike | null;
  gainNode: MixerGainNodeLike | null;
}

export class SixStemWebAudioMixerController {
  private readonly createAudioContextFn: (
    sampleRateHint: number
  ) => MixerAudioContextLike | null;
  private readonly createObjectURLFn: (blob: Blob) => string;
  private readonly revokeObjectURLFn: (url: string) => void;
  private readonly scheduleLookaheadSeconds: number;
  private readonly yieldToMainThreadFn: () => Promise<void>;
  private readonly limits: NonNullable<SixStemMixerDependencies['limits']>;
  private readonly enableWavDownloads: boolean;

  private readonly listeners = new Set<
    (snapshot: SixStemMixerSnapshot) => void
  >();

  private state: SixStemMixerState = 'idle';
  private sampleRate = 44100;
  private totalFrames = 0;
  private offsetFrames = 0;
  private masterVolume = 1;
  private targetLibrary: TargetAudioLibraryKind = 'ministry_library';
  private metadata: SeparatedMixerMetadata = {
    modelId: '',
    modelVersion: '',
    sourceSha256: null,
  };
  private error: { code: string; message: string } | null = null;

  private audioContext: MixerAudioContextLike | null = null;
  private masterGainNode: MixerGainNodeLike | null = null;
  private activeSources = new Map<CanonicalStemId, MixerBufferSourceNodeLike>();
  private playbackStartedContextTime: number | null = null;
  private generation = 0;
  private playbackToken = 0;
  private transportActionSeq = 0;
  private disposed = false;

  private maxInterStemStartDriftSeconds = 0;
  private scheduleDeadlineMissed = false;
  private scheduleSpanSeconds = 0;
  private lastScheduledStarts: Record<
    CanonicalStemId,
    { when: number; offsetSeconds: number }
  > | null = null;
  private playScheduleCount = 0;
  private createdObjectUrlCount = 0;
  private revokedObjectUrlCount = 0;

  private readonly stemStates: Record<CanonicalStemId, InternalStemState>;

  constructor(deps: SixStemMixerDependencies = {}) {
    this.limits = { wavBytes: MAX_AUDIO_WAV_BYTES, frames: MAX_SEPARATION_TOTAL_FRAMES, seconds: DEFAULT_MAX_AUDIO_SECONDS, ...deps.limits };
    this.enableWavDownloads = deps.enableWavDownloads ?? true;
    this.createAudioContextFn =
      deps.createAudioContext ?? defaultCreateAudioContext;
    this.createObjectURLFn =
      deps.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
    this.revokeObjectURLFn =
      deps.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
    const lookahead = deps.scheduleLookaheadSeconds;
    this.scheduleLookaheadSeconds =
      typeof lookahead === 'number' &&
      Number.isFinite(lookahead) &&
      lookahead >= 0 &&
      lookahead <= 0.25
        ? lookahead
        : DEFAULT_MIXER_SCHEDULE_LOOKAHEAD_SECONDS;
    this.yieldToMainThreadFn =
      deps.yieldToMainThread ?? defaultYieldToMainThread;

    const initial = {} as Record<CanonicalStemId, InternalStemState>;
    for (const id of CANONICAL_STEM_IDS) {
      initial[id] = {
        id,
        labelPtBr: STEM_DISPLAY_LABELS_PT_BR[id],
        volume: 1,
        muted: false,
        solo: false,
        rms: 0,
        peak: 0,
        byteLength: 0,
        sha256: '',
        downloadUrl: null,
        audioBuffer: null,
        gainNode: null,
      };
    }
    this.stemStates = initial;
  }

  private computeCurrentFrame(): number {
    if (
      this.state === 'playing' &&
      this.audioContext !== null &&
      this.playbackStartedContextTime !== null
    ) {
      const elapsedSec = Math.max(
        0,
        this.audioContext.currentTime - this.playbackStartedContextTime
      );
      return clampFrame(
        this.offsetFrames + Math.round(elapsedSec * this.sampleRate),
        this.totalFrames
      );
    }
    return clampFrame(this.offsetFrames, this.totalFrames);
  }

  private computeAnySolo(): boolean {
    return CANONICAL_STEM_IDS.some((id) => this.stemStates[id].solo);
  }

  private applyGainsToNodes(): void {
    if (this.masterGainNode) {
      this.masterGainNode.gain.value = this.masterVolume;
    }
    const anySolo = this.computeAnySolo();
    for (const id of CANONICAL_STEM_IDS) {
      const stem = this.stemStates[id];
      const routingActive = !stem.muted && (!anySolo || stem.solo);
      const effectiveGain = routingActive ? stem.volume : 0;
      if (stem.gainNode) {
        stem.gainNode.gain.value = effectiveGain;
      }
    }
  }

  getSnapshot(): SixStemMixerSnapshot {
    const anySoloActive = this.computeAnySolo();
    const currentFrame = this.computeCurrentFrame();
    const stems = {} as Record<CanonicalStemId, MixerStemChannelSnapshot>;
    const orderedStems: MixerStemChannelSnapshot[] = [];

    for (const id of CANONICAL_STEM_IDS) {
      const s = this.stemStates[id];
      const routingActive = !s.muted && (!anySoloActive || s.solo);
      const effectiveGain = routingActive ? s.volume : 0;
      const isAudible = effectiveGain > 0 && this.masterVolume > 0;
      const channelSnap: MixerStemChannelSnapshot = {
        id: s.id,
        labelPtBr: s.labelPtBr,
        volume: s.volume,
        muted: s.muted,
        solo: s.solo,
        effectiveGain,
        isAudible,
        rms: s.rms,
        peak: s.peak,
        byteLength: s.byteLength,
        sha256: s.sha256,
        downloadUrl: s.downloadUrl,
      };
      stems[id] = channelSnap;
      orderedStems.push(channelSnap);
    }

    return {
      state: this.state,
      sampleRate: this.sampleRate,
      totalFrames: this.totalFrames,
      currentFrame,
      durationSeconds: framesToSeconds(this.totalFrames, this.sampleRate),
      currentTimeSeconds: framesToSeconds(currentFrame, this.sampleRate),
      masterVolume: this.masterVolume,
      anySoloActive,
      targetLibrary: this.targetLibrary,
      stems,
      orderedStems,
      maxInterStemStartDriftSeconds: this.maxInterStemStartDriftSeconds,
      scheduleDeadlineMissed: this.scheduleDeadlineMissed,
      scheduleSpanSeconds: this.scheduleSpanSeconds,
      activeSourceCount: this.activeSources.size,
      error: this.error ? { ...this.error } : null,
    };
  }

  getDiagnostics(): {
    disposed: boolean;
    hasAudioContext: boolean;
    audioContextState: AudioContextState | null;
    playScheduleCount: number;
    lastScheduledStarts: Record<
      CanonicalStemId,
      { when: number; offsetSeconds: number }
    > | null;
    maxInterStemStartDriftSeconds: number;
    scheduleDeadlineMissed: boolean;
    scheduleSpanSeconds: number;
    createdObjectUrlCount: number;
    revokedObjectUrlCount: number;
    activeObjectUrlCount: number;
  } {
    let activeUrls = 0;
    for (const id of CANONICAL_STEM_IDS) {
      if (this.stemStates[id].downloadUrl !== null) {
        activeUrls += 1;
      }
    }
    return {
      disposed: this.disposed,
      hasAudioContext: this.audioContext !== null,
      audioContextState: this.audioContext?.state ?? null,
      playScheduleCount: this.playScheduleCount,
      lastScheduledStarts: this.lastScheduledStarts
        ? { ...this.lastScheduledStarts }
        : null,
      maxInterStemStartDriftSeconds: this.maxInterStemStartDriftSeconds,
      scheduleDeadlineMissed: this.scheduleDeadlineMissed,
      scheduleSpanSeconds: this.scheduleSpanSeconds,
      createdObjectUrlCount: this.createdObjectUrlCount,
      revokedObjectUrlCount: this.revokedObjectUrlCount,
      activeObjectUrlCount: activeUrls,
    };
  }

  subscribe(listener: (snapshot: SixStemMixerSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const listener of [...this.listeners]) {
      listener(snap);
    }
  }

  private stopActiveSources(): void {
    this.playbackToken += 1;
    for (const [, source] of this.activeSources.entries()) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Ignore stop errors on already-stopped Web Audio source nodes.
      }
      try {
        source.disconnect();
      } catch {
        // Ignore disconnect errors on detached nodes.
      }
    }
    this.activeSources.clear();
    this.playbackStartedContextTime = null;
  }

  private revokeStemDownloadUrls(): void {
    for (const id of CANONICAL_STEM_IDS) {
      const url = this.stemStates[id].downloadUrl;
      if (url !== null) {
        this.stemStates[id].downloadUrl = null;
        try {
          this.revokeObjectURLFn(url);
          this.revokedObjectUrlCount += 1;
        } catch {
          // Ignore revoke errors.
        }
      }
    }
  }

  private disconnectGraphNodes(): void {
    for (const id of CANONICAL_STEM_IDS) {
      const gainNode = this.stemStates[id].gainNode;
      if (gainNode) {
        try {
          gainNode.disconnect();
        } catch {
          // Ignore disconnect errors.
        }
        this.stemStates[id].gainNode = null;
      }
      this.stemStates[id].audioBuffer = null;
    }
    if (this.masterGainNode) {
      try {
        this.masterGainNode.disconnect();
      } catch {
        // Ignore disconnect errors.
      }
      this.masterGainNode = null;
    }
  }

  private ensureAudioGraph(sampleRateHint: number): MixerAudioContextLike {
    if (!this.audioContext) {
      const created = this.createAudioContextFn(sampleRateHint);
      if (!created) {
        throw new AudioSeparationError(
          'INVALID_AUDIO',
          'Web Audio API AudioContext is unavailable in this environment.'
        );
      }
      this.audioContext = created;
    }

    if (!this.masterGainNode) {
      const master = this.audioContext.createGain();
      master.connect(this.audioContext.destination);
      this.masterGainNode = master;
    }

    for (const id of CANONICAL_STEM_IDS) {
      if (!this.stemStates[id].gainNode) {
        const stemGain = this.audioContext.createGain();
        stemGain.connect(this.masterGainNode);
        this.stemStates[id].gainNode = stemGain;
      }
    }

    this.applyGainsToNodes();
    return this.audioContext;
  }

  private resetTrackData(): void {
    for (const id of CANONICAL_STEM_IDS) {
      const st = this.stemStates[id];
      st.labelPtBr = STEM_DISPLAY_LABELS_PT_BR[id];
      st.rms = 0;
      st.peak = 0;
      st.byteLength = 0;
      st.sha256 = '';
      st.downloadUrl = null;
      st.audioBuffer = null;
    }
    this.sampleRate = 44100;
    this.totalFrames = 0;
    this.offsetFrames = 0;
    this.maxInterStemStartDriftSeconds = 0;
    this.scheduleDeadlineMissed = false;
    this.scheduleSpanSeconds = 0;
    this.lastScheduledStarts = null;
    this.metadata = {
      modelId: '',
      modelVersion: '',
      sourceSha256: null,
    };
  }

  clear(): SixStemMixerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.generation += 1;
    this.transportActionSeq += 1;
    this.stopActiveSources();
    this.revokeStemDownloadUrls();
    this.disconnectGraphNodes();
    this.resetTrackData();
    this.error = null;
    this.state = 'idle';
    this.emit();
    return this.getSnapshot();
  }

  async loadStems(
    stems: readonly (SeparatedStemOutput | SeparatedStemMixerInput)[],
    metadata?: Partial<SeparatedMixerMetadata>
  ): Promise<SixStemMixerSnapshot> {
    if (this.disposed) {
      return this.getSnapshot();
    }

    this.generation += 1;
    this.transportActionSeq += 1;
    const loadGen = this.generation;
    this.stopActiveSources();
    this.revokeStemDownloadUrls();
    this.disconnectGraphNodes();
    this.resetTrackData();
    this.error = null;
    this.state = 'loading';
    this.emit();

    const pendingUrls: string[] = [];

    try {
      if (!Array.isArray(stems) || stems.length !== CANONICAL_STEM_IDS.length) {
        throw new AudioSeparationError(
          'INVALID_AUDIO',
          `Mixer requires exactly ${CANONICAL_STEM_IDS.length} canonical stems.`
        );
      }

      const byId = new Map<
        CanonicalStemId,
        SeparatedStemOutput | SeparatedStemMixerInput
      >();
      for (const item of stems) {
        if (!item || !CANONICAL_STEM_IDS.includes(item.id)) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Invalid stem id "${String((item as { id?: unknown })?.id)}".`
          );
        }
        if (byId.has(item.id)) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Duplicate stem id "${item.id}" supplied to mixer.`
          );
        }
        byId.set(item.id, item);
      }

      for (const requiredId of CANONICAL_STEM_IDS) {
        if (!byId.has(requiredId)) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Missing stem "${requiredId}" for 6-track mixer.`
          );
        }
      }

      let resolvedSampleRate: number | null = null;
      let resolvedTotalFrames: number | null = null;

      const snapshotMetadata: SeparatedMixerMetadata = {
        modelId: metadata?.modelId ?? '',
        modelVersion: metadata?.modelVersion ?? '',
        sourceSha256: metadata?.sourceSha256 ?? null,
      };

      const capturedInputs = CANONICAL_STEM_IDS.map((id) => {
        const raw = byId.get(id)!;
        const rawWavBytes = raw.wavBytes;
        const rawByteLength = raw.byteLength;
        const rawSampleRate = raw.sampleRate;
        const rawTotalFrames = raw.totalFrames;
        const rawSha256 = raw.sha256;
        const rawLabelPtBr = raw.labelPtBr;

        if (!(rawWavBytes instanceof Uint8Array) || rawWavBytes.byteLength === 0) {
          throw new AudioSeparationError(
            'EMPTY_AUDIO',
            `Stem "${id}" has empty WAV bytes.`
          );
        }
        if (rawWavBytes.byteLength > this.limits.wavBytes) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Stem "${id}" WAV size (${rawWavBytes.byteLength} bytes) exceeds limit (${this.limits.wavBytes}).`
          );
        }

        // Snapshot all 6 stems + metadata synchronously BEFORE the first await/yield
        // so caller mutations on any stem (1st..6th) or metadata cannot cause TOCTOU.
        const wavBytes = rawWavBytes.slice();
        if (rawByteLength !== undefined && rawByteLength !== wavBytes.byteLength) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Stem "${id}" declared byteLength (${rawByteLength}) mismatches WAV size (${wavBytes.byteLength}).`
          );
        }

        const wavDescriptor = parseStrictWavDescriptor(wavBytes);
        const wavMaxFrames = Math.min(
          wavDescriptor.sampleRate * this.limits.seconds,
          this.limits.frames
        );
        if (
          wavDescriptor.totalFrames <= 0 ||
          wavDescriptor.totalFrames > wavMaxFrames
        ) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Stem "${id}" WAV frame count (${wavDescriptor.totalFrames}) exceeds limit (${wavMaxFrames} frames).`
          );
        }

        if (
          !Number.isInteger(rawSampleRate) ||
          rawSampleRate <= 0 ||
          rawSampleRate !== wavDescriptor.sampleRate ||
          (rawTotalFrames !== undefined && rawTotalFrames !== wavDescriptor.totalFrames)
        ) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Stem "${id}" metadata mismatches WAV header (${wavDescriptor.sampleRate} Hz, ${wavDescriptor.totalFrames} frames).`
          );
        }

        if (resolvedSampleRate === null) {
          resolvedSampleRate = wavDescriptor.sampleRate;
        } else if (wavDescriptor.sampleRate !== resolvedSampleRate) {
          throw new AudioSeparationError(
            'SAMPLE_RATE_MISMATCH',
            `Stem "${id}" sampleRate ${wavDescriptor.sampleRate} Hz mismatches ${resolvedSampleRate} Hz.`
          );
        }

        if (resolvedTotalFrames === null) {
          resolvedTotalFrames = wavDescriptor.totalFrames;
        } else if (wavDescriptor.totalFrames !== resolvedTotalFrames) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Stem "${id}" frame count ${wavDescriptor.totalFrames} mismatches ${resolvedTotalFrames}.`
          );
        }

        return {
          id,
          labelPtBr: rawLabelPtBr ?? STEM_DISPLAY_LABELS_PT_BR[id],
          wavBytes,
          wavMaxFrames,
          expectedSha256: rawSha256,
        };
      });

      byId.clear();
      stems = [];
      const checksums = new Map<CanonicalStemId, string>();

      for (const cap of capturedInputs) {
        const sha256 = await computeSha256Hex(cap.wavBytes);
        if (loadGen !== this.generation || this.disposed) {
          return this.getSnapshot();
        }
        if (cap.expectedSha256 !== undefined && cap.expectedSha256 !== sha256) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Stem "${cap.id}" sha256 metadata mismatches WAV bytes.`
          );
        }

        checksums.set(cap.id, sha256);

        await this.yieldToMainThreadFn();
        if (loadGen !== this.generation || this.disposed) {
          return this.getSnapshot();
        }
      }

      const finalSampleRate = resolvedSampleRate!;
      const finalTotalFrames = resolvedTotalFrames!;
      const ctx = this.ensureAudioGraph(finalSampleRate);
      const stagedEntries: Array<{
        id: CanonicalStemId;
        labelPtBr: string;
        audioBuffer: MixerAudioBufferLike;
        byteLength: number;
        sha256: string;
        rms: number;
        peak: number;
        downloadUrl: string | null;
      }> = [];

      for (const stem of capturedInputs) {
        if (loadGen !== this.generation || this.disposed) {
          for (const url of pendingUrls) {
            try {
              this.revokeObjectURLFn(url);
              this.revokedObjectUrlCount += 1;
            } catch {
              // Ignore revoke failure during rollback.
            }
          }
          return this.getSnapshot();
        }
        // Allocate only one temporary decoded pair at a time while staging final AudioBuffers.
        const { left, right } = decodeWavToStereoFloat32(stem.wavBytes.buffer, {
          expectedSampleRate: finalSampleRate,
          maxFrames: stem.wavMaxFrames,
        });
        const { rms, peak } = computeSignalStats(left, right);
        const audioBuffer = ctx.createBuffer(2, finalTotalFrames, finalSampleRate);
        audioBuffer.getChannelData(0).set(left);
        audioBuffer.getChannelData(1).set(right);

        let downloadUrl: string | null = null;
        if (this.enableWavDownloads) {
          downloadUrl = this.createObjectURLFn(createWavBlobWithoutCopy(stem.wavBytes));
          this.createdObjectUrlCount += 1;
          pendingUrls.push(downloadUrl);
        }

        stagedEntries.push({
          id: stem.id,
          labelPtBr: stem.labelPtBr,
          audioBuffer,
          byteLength: stem.wavBytes.byteLength,
          sha256: checksums.get(stem.id)!,
          rms,
          peak,
          downloadUrl,
        });
        stem.wavBytes = new Uint8Array();
        await this.yieldToMainThreadFn();
      }

      if (loadGen !== this.generation || this.disposed) {
        for (const url of pendingUrls) {
          try {
            this.revokeObjectURLFn(url);
            this.revokedObjectUrlCount += 1;
          } catch {
            // Ignore revoke failure during rollback.
          }
        }
        return this.getSnapshot();
      }

      for (const staged of stagedEntries) {
        const stateEntry = this.stemStates[staged.id];
        stateEntry.labelPtBr = staged.labelPtBr;
        stateEntry.audioBuffer = staged.audioBuffer;
        stateEntry.byteLength = staged.byteLength;
        stateEntry.sha256 = staged.sha256;
        stateEntry.rms = staged.rms;
        stateEntry.peak = staged.peak;
        stateEntry.downloadUrl = staged.downloadUrl;
      }

      this.sampleRate = finalSampleRate;
      this.totalFrames = finalTotalFrames;
      this.offsetFrames = 0;
      this.metadata = snapshotMetadata;
      this.applyGainsToNodes();
      this.state = 'ready';
      this.emit();
      return this.getSnapshot();
    } catch (err) {
      for (const url of pendingUrls) {
        try {
          this.revokeObjectURLFn(url);
          this.revokedObjectUrlCount += 1;
        } catch {
          // Ignore revoke failure during rollback.
        }
      }
      if (loadGen !== this.generation || this.disposed) {
        return this.getSnapshot();
      }
      this.disconnectGraphNodes();
      this.totalFrames = 0;
      this.offsetFrames = 0;
      this.state = 'error';
      this.error = {
        code:
          err instanceof AudioSeparationError ? err.code : 'INVALID_AUDIO',
        message:
          err instanceof Error
            ? err.message
            : 'Falha ao carregar faixas no mixer.',
      };
      this.emit();
      return this.getSnapshot();
    }
  }

  private scheduleAllStemsSynchronized(startFrame: number): void {
    if (!this.audioContext) {
      return;
    }
    this.stopActiveSources();

    const clampedStart = clampFrame(startFrame, this.totalFrames);
    this.offsetFrames = clampedStart;
    const offsetSeconds = framesToSeconds(clampedStart, this.sampleRate);
    const token = ++this.playbackToken;
    this.scheduleDeadlineMissed = false;
    this.scheduleSpanSeconds = 0;
    this.maxInterStemStartDriftSeconds = 0;
    this.lastScheduledStarts = null;

    const scheduledStarts = {} as Record<
      CanonicalStemId,
      { when: number; offsetSeconds: number }
    >;

    try {
      for (const id of CANONICAL_STEM_IDS) {
        const stem = this.stemStates[id];
        if (!stem.audioBuffer || !stem.gainNode) {
          throw new AudioSeparationError(
            'INVALID_AUDIO',
            `Stem "${id}" audio buffer is not initialized.`
          );
        }
        const source = this.audioContext.createBufferSource();
        this.activeSources.set(id, source);
        source.buffer = stem.audioBuffer;
        source.connect(stem.gainNode);
        source.onended = () => {
          if (this.disposed || this.playbackToken !== token) {
            return;
          }
          this.stopActiveSources();
          this.offsetFrames = 0;
          this.state = 'ready';
          this.emit();
        };
      }

      // Set the shared deadline after the graph is connected.
      const preStartContextTime = this.audioContext.currentTime;
      const scheduledStartAt = preStartContextTime + this.scheduleLookaheadSeconds;
      for (const [id, source] of this.activeSources) {
        source.start(scheduledStartAt, offsetSeconds);
        scheduledStarts[id] = { when: scheduledStartAt, offsetSeconds };
      }
      const postScheduleContextTime = this.audioContext.currentTime;
      this.scheduleSpanSeconds = Math.max(0, postScheduleContextTime - preStartContextTime);
      this.scheduleDeadlineMissed = postScheduleContextTime > scheduledStartAt;
      if (this.scheduleDeadlineMissed) {
        this.maxInterStemStartDriftSeconds = postScheduleContextTime - scheduledStartAt;
        throw new AudioSeparationError(
          'INVALID_AUDIO',
          'O mixer perdeu o tempo de início sincronizado. Tente reproduzir novamente.'
        );
      }
      this.playbackStartedContextTime = scheduledStartAt;
      this.lastScheduledStarts = scheduledStarts;
      this.playScheduleCount += 1;
      this.state = 'playing';
      this.error = null;
    } catch (err) {
      this.stopActiveSources();
      this.state = 'paused';
      this.error = {
        code: 'INVALID_AUDIO',
        message: err instanceof Error ? err.message : 'Falha ao agendar faixas no mixer.',
      };
    }
  }

  async play(): Promise<SixStemMixerSnapshot> {
    if (this.disposed) {
      return this.getSnapshot();
    }
    if (
      this.state !== 'ready' &&
      this.state !== 'paused' &&
      this.state !== 'playing'
    ) {
      return this.getSnapshot();
    }
    if (this.state === 'playing') {
      return this.getSnapshot();
    }
    if (!this.audioContext || this.totalFrames <= 0) {
      return this.getSnapshot();
    }

    const loadGen = this.generation;
    const actionSeq = ++this.transportActionSeq;
    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (err) {
        if (
          actionSeq !== this.transportActionSeq ||
          loadGen !== this.generation ||
          this.disposed
        ) {
          return this.getSnapshot();
        }
        this.state = 'error';
        this.error = {
          code: 'INVALID_AUDIO',
          message:
            err instanceof Error
              ? err.message
              : 'Falha ao iniciar AudioContext do mixer.',
        };
        this.emit();
        return this.getSnapshot();
      }
    }

    const currentStateAfterResume = this.state as SixStemMixerState;
    if (
      actionSeq !== this.transportActionSeq ||
      loadGen !== this.generation ||
      this.disposed ||
      this.totalFrames <= 0 ||
      currentStateAfterResume === 'playing'
    ) {
      return this.getSnapshot();
    }

    const startFrom =
      this.offsetFrames >= this.totalFrames ? 0 : this.offsetFrames;
    this.scheduleAllStemsSynchronized(startFrom);
    this.emit();
    return this.getSnapshot();
  }

  pause(): SixStemMixerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.transportActionSeq += 1;
    if (this.state !== 'playing') {
      return this.getSnapshot();
    }
    const pausedFrame = this.computeCurrentFrame();
    this.stopActiveSources();
    this.offsetFrames = pausedFrame;
    this.state = 'paused';
    this.emit();
    return this.getSnapshot();
  }

  stop(): SixStemMixerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.transportActionSeq += 1;
    if (
      this.state !== 'playing' &&
      this.state !== 'paused' &&
      this.state !== 'ready'
    ) {
      return this.getSnapshot();
    }
    this.stopActiveSources();
    this.offsetFrames = 0;
    this.state = 'ready';
    this.emit();
    return this.getSnapshot();
  }

  seekFrame(frame: number): SixStemMixerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.transportActionSeq += 1;
    if (
      this.state !== 'ready' &&
      this.state !== 'paused' &&
      this.state !== 'playing'
    ) {
      return this.getSnapshot();
    }
    const clamped = clampFrame(frame, this.totalFrames);
    if (this.state === 'playing') {
      this.scheduleAllStemsSynchronized(clamped);
    } else {
      this.offsetFrames = clamped;
    }
    this.emit();
    return this.getSnapshot();
  }

  seekSeconds(seconds: number): SixStemMixerSnapshot {
    const safeSec = Number.isFinite(seconds) ? seconds : 0;
    return this.seekFrame(Math.round(safeSec * this.sampleRate));
  }

  setStemVolume(stemId: CanonicalStemId, volume: number): SixStemMixerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.stemStates[stemId].volume = clampUnitVolume(volume);
    this.applyGainsToNodes();
    this.emit();
    return this.getSnapshot();
  }

  setStemMuted(stemId: CanonicalStemId, muted: boolean): SixStemMixerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.stemStates[stemId].muted = Boolean(muted);
    this.applyGainsToNodes();
    this.emit();
    return this.getSnapshot();
  }

  toggleStemMute(stemId: CanonicalStemId): SixStemMixerSnapshot {
    return this.setStemMuted(stemId, !this.stemStates[stemId].muted);
  }

  setStemSolo(stemId: CanonicalStemId, solo: boolean): SixStemMixerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.stemStates[stemId].solo = Boolean(solo);
    this.applyGainsToNodes();
    this.emit();
    return this.getSnapshot();
  }

  toggleStemSolo(stemId: CanonicalStemId): SixStemMixerSnapshot {
    return this.setStemSolo(stemId, !this.stemStates[stemId].solo);
  }

  setMasterVolume(volume: number): SixStemMixerSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.masterVolume = clampUnitVolume(volume);
    this.applyGainsToNodes();
    this.emit();
    return this.getSnapshot();
  }

  setTargetLibrary(target: TargetAudioLibraryKind): SixStemMixerSnapshot {
    if (target !== 'ministry_library' && target !== 'louvaio_library') {
      throw new AudioSeparationError(
        'INVALID_DESCRIPTOR',
        'Apenas "ministry_library" (Biblioteca Ministerial) ou "louvaio_library" (Biblioteca LouvAIO) sao permitidas.'
      );
    }
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.targetLibrary = target;
    this.emit();
    return this.getSnapshot();
  }

  buildLibraryPublishDraft(context?: {
    ministryId?: string | null;
    songId?: string | null;
    canonicalVersionId?: string | null;
  }): SeparatedLibraryPublishDraft {
    if (this.totalFrames <= 0 || this.state === 'disposed') {
      throw new AudioSeparationError(
        'INVALID_AUDIO',
        'Stems must be loaded in the mixer before building a library publish draft.'
      );
    }
    const stems = {} as SeparatedLibraryPublishDraft['stems'];
    for (const id of CANONICAL_STEM_IDS) {
      const s = this.stemStates[id];
      stems[id] = {
        id: s.id,
        labelPtBr: s.labelPtBr,
        byteLength: s.byteLength,
        sha256: s.sha256,
        rms: s.rms,
        peak: s.peak,
        totalFrames: this.totalFrames,
      };
    }

    return {
      targetLibrary: this.targetLibrary,
      ministryId:
        this.targetLibrary === 'ministry_library'
          ? (context?.ministryId ?? null)
          : null,
      songId: context?.songId ?? null,
      canonicalVersionId: context?.canonicalVersionId ?? null,
      sourceSha256: this.metadata.sourceSha256 ?? null,
      modelId: this.metadata.modelId,
      modelVersion: this.metadata.modelVersion,
      sampleRate: this.sampleRate,
      totalFrames: this.totalFrames,
      durationSeconds: framesToSeconds(this.totalFrames, this.sampleRate),
      stems,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.transportActionSeq += 1;
    this.stopActiveSources();
    this.revokeStemDownloadUrls();
    this.disconnectGraphNodes();
    this.resetTrackData();
    if (this.audioContext) {
      const ctxToClose = this.audioContext;
      this.audioContext = null;
      void ctxToClose.close().catch(() => {
        // Ignore AudioContext.close() rejection on already-closed contexts.
      });
    }
    this.totalFrames = 0;
    this.offsetFrames = 0;
    this.state = 'disposed';
    this.emit();
    this.listeners.clear();
  }
}
