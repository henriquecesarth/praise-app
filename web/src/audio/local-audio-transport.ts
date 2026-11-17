export type TransportState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'error';

export type TransportErrorCode =
  | 'INVALID_INPUT'
  | 'REMOTE_URL_FORBIDDEN'
  | 'EMPTY_FILE'
  | 'UNSUPPORTED_OR_CORRUPT_HEADER'
  | 'DECODE_ERROR'
  | 'PLAYBACK_REJECTED'
  | 'NOT_READY'
  | 'DISPOSED'
  | 'INVALID_ARGUMENT'
  | 'STALE_GENERATION';

export interface TransportSessionContext {
  accountNamespace: string;
  ministryId: string | null;
  songId?: string | null;
  versionId?: string | null;
}

export interface WavHeaderInfo {
  audioFormat: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataBytes: number;
  totalFrames: number;
  durationSeconds: number;
}

export interface TransportMemoryBudget {
  fileBytes: number;
  headerSliceBytes: number;
  estimatedFullFloat32PcmBytes: number;
  streamingMode: 'blob-object-url';
}

export interface TransportErrorInfo {
  code: TransportErrorCode;
  message: string;
}

export interface TransportSnapshot {
  state: TransportState;
  generation: number;
  sessionContext: TransportSessionContext;
  fileName: string | null;
  fileSizeBytes: number | null;
  mimeType: string | null;
  sampleRate: number;
  channels: number;
  totalFrames: number;
  currentFrame: number;
  durationSeconds: number;
  currentTimeSeconds: number;
  rate: number;
  preservesPitch: boolean;
  pitchShiftSemitonesSupported: false;
  masterGain: number;
  error: TransportErrorInfo | null;
  memoryBudget: TransportMemoryBudget;
}

export interface LoadAudioOptions {
  fileName?: string;
  sessionContext?: TransportSessionContext;
  expectedGeneration?: number;
}

export interface SetRateOptions {
  preservesPitch?: boolean;
}

export interface MediaElementLike {
  src: string;
  autoplay: boolean;
  preload: string;
  currentTime: number;
  readonly duration: number;
  playbackRate: number;
  preservesPitch?: boolean;
  mozPreservesPitch?: boolean;
  webkitPreservesPitch?: boolean;
  volume: number;
  readonly paused: boolean;
  readonly error: { code?: number; message?: string } | null;
  load(): void;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  removeAttribute(qualifiedName: string): void;
}

export interface LocalAudioTransportDependencies {
  createAudioElement?: () => MediaElementLike;
  createAudioContext?: () => AudioContext | null;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  enableWebAudioGain?: boolean;
  headerSliceBytes?: number;
  defaultSampleRate?: number;
}

export const DEFAULT_SAMPLE_RATE = 44100;
export const MIN_TRANSPORT_RATE = 0.5;
export const MAX_TRANSPORT_RATE = 1.5;
export const WAV_HEADER_SLICE_BYTES = 4096;

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

/** Read a small Blob/File slice into an ArrayBuffer, compatible with FileReader fallback. */
export async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return await blob.arrayBuffer();
  }
  if (typeof FileReader !== 'undefined') {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error('Expected ArrayBuffer from FileReader'));
        }
      };
      reader.onerror = () => {
        reject(reader.error ?? new Error('FileReader failed'));
      };
      reader.readAsArrayBuffer(blob);
    });
  }
  return await new Response(blob).arrayBuffer();
}

/** Convert playback seconds into an integer frame index. */
export function secondsToFrames(seconds: number, sampleRate: number): number {
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return 0;
  }
  return Math.round(seconds * sampleRate);
}

/** Convert a frame index into seconds at the given sample rate. */
export function framesToSeconds(frame: number, sampleRate: number): number {
  if (
    !Number.isFinite(frame) ||
    frame <= 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0
  ) {
    return 0;
  }
  return frame / sampleRate;
}

/** Clamp a frame index into `[0, totalFrames]`. */
export function clampFrame(frame: number, totalFrames: number): number {
  if (!Number.isFinite(totalFrames) || totalFrames <= 0) {
    return 0;
  }
  const maxFrame = Math.max(0, Math.floor(totalFrames));
  if (!Number.isFinite(frame)) {
    return 0;
  }
  return Math.min(maxFrame, Math.max(0, Math.round(frame)));
}

/** Estimate decoded PCM memory footprint vs compressed or streaming handles. */
export function estimatePcmMemoryBudget(params: {
  durationSeconds: number;
  sampleRate: number;
  channels: number;
  stems?: number;
}): {
  estimatedFullFloat32PcmBytes: number;
  estimatedPcm16Bytes: number;
} {
  const duration =
    Number.isFinite(params.durationSeconds) && params.durationSeconds > 0
      ? params.durationSeconds
      : 0;
  const sampleRate =
    Number.isFinite(params.sampleRate) && params.sampleRate > 0
      ? params.sampleRate
      : 0;
  const channels =
    Number.isFinite(params.channels) && params.channels > 0
      ? params.channels
      : 0;
  const stems =
    params.stems !== undefined &&
    Number.isFinite(params.stems) &&
    params.stems > 0
      ? params.stems
      : 1;
  const totalSamples = duration * sampleRate * channels * stems;
  return {
    estimatedFullFloat32PcmBytes: Math.ceil(totalSamples * 4),
    estimatedPcm16Bytes: Math.ceil(totalSamples * 2),
  };
}

/**
 * Inspect only the initial header slice (e.g. 4 KiB) of a WAV file so long
 * recordings are never decoded entirely into RAM just to compute frame metrics.
 */
export function parseWavHeaderSlice(buffer: ArrayBuffer): WavHeaderInfo | null {
  if (buffer.byteLength < 44) {
    return null;
  }
  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    return null;
  }

  let audioFormat: number | null = null;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataOffset = -1;
  let dataBytes = 0;

  let offset = 12;
  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;

    if (chunkId === 'fmt ') {
      if (chunkSize < 16 || payloadOffset + 16 > buffer.byteLength) {
        return null;
      }
      audioFormat = view.getUint16(payloadOffset, true);
      channels = view.getUint16(payloadOffset + 2, true);
      sampleRate = view.getUint32(payloadOffset + 4, true);
      bitsPerSample = view.getUint16(payloadOffset + 14, true);

      if (
        (audioFormat !== 1 && audioFormat !== 3 && audioFormat !== 0xfffe) ||
        channels < 1 ||
        channels > 16 ||
        sampleRate < 8000 ||
        sampleRate > 384000 ||
        (bitsPerSample !== 8 &&
          bitsPerSample !== 16 &&
          bitsPerSample !== 24 &&
          bitsPerSample !== 32)
      ) {
        return null;
      }
    } else if (chunkId === 'data') {
      dataOffset = payloadOffset;
      dataBytes = chunkSize;
      break;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    const nextOffset = payloadOffset + paddedSize;
    if (nextOffset <= offset) {
      break;
    }
    offset = nextOffset;
  }

  if (
    audioFormat === null ||
    channels <= 0 ||
    sampleRate <= 0 ||
    bitsPerSample <= 0 ||
    dataOffset < 0
  ) {
    return null;
  }

  const blockAlign = channels * (bitsPerSample / 8);
  if (blockAlign <= 0) {
    return null;
  }

  const totalFrames = Math.floor(dataBytes / blockAlign);
  const durationSeconds = totalFrames / sampleRate;

  return {
    audioFormat,
    sampleRate,
    channels,
    bitsPerSample,
    dataOffset,
    dataBytes,
    totalFrames,
    durationSeconds,
  };
}

/** Generate a short synthetic local PCM16 WAV File for tests and spikes. */
export function createSyntheticWavFile(options?: {
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  frequencyHz?: number;
  amplitude?: number;
  fileName?: string;
}): File {
  const durationSeconds = options?.durationSeconds ?? 2;
  const sampleRate = options?.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = options?.channels ?? 2;
  const frequencyHz = options?.frequencyHz ?? 440;
  const amplitude = Math.min(1, Math.max(0, options?.amplitude ?? 0.5));
  const fileName = options?.fileName ?? 'synthetic-tone.wav';

  if (
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isInteger(channels) ||
    channels < 1 ||
    channels > 2
  ) {
    throw new RangeError('Invalid synthetic WAV fixture parameters.');
  }

  const totalFrames = Math.round(durationSeconds * sampleRate);
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = totalFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  const peak = Math.round(32767 * amplitude);
  for (let i = 0; i < totalFrames; i++) {
    const sample = Math.round(
      Math.sin(2 * Math.PI * frequencyHz * (i / sampleRate)) * peak
    );
    const frameOffset = 44 + i * blockAlign;
    for (let c = 0; c < channels; c++) {
      view.setInt16(frameOffset + c * bytesPerSample, sample, true);
    }
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  if (typeof File === 'function') {
    return new File([blob], fileName, { type: 'audio/wav' });
  }
  return Object.assign(blob, {
    name: fileName,
    lastModified: Date.now(),
    webkitRelativePath: '',
  }) as File;
}

function defaultCreateAudioElement(): MediaElementLike {
  if (typeof Audio !== 'undefined') {
    return new Audio();
  }
  return document.createElement('audio');
}

function defaultCreateAudioContext(): AudioContext | null {
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
    return new Ctor();
  } catch {
    return null;
  }
}

function applyPreservesPitch(el: MediaElementLike, value: boolean): boolean {
  let supported = false;
  if ('preservesPitch' in el) {
    el.preservesPitch = value;
    supported = true;
  }
  if ('mozPreservesPitch' in el) {
    el.mozPreservesPitch = value;
    supported = true;
  }
  if ('webkitPreservesPitch' in el) {
    el.webkitPreservesPitch = value;
    supported = true;
  }
  return supported;
}

function isWavDeclared(file: Blob, fileName: string | null): boolean {
  const mime = (file.type || '').toLowerCase();
  if (
    mime === 'audio/wav' ||
    mime === 'audio/x-wav' ||
    mime === 'audio/wave' ||
    mime === 'audio/vnd.wave'
  ) {
    return true;
  }
  return (fileName || '').toLowerCase().endsWith('.wav');
}

function isDisallowedMime(file: Blob): boolean {
  const mime = (file.type || '').toLowerCase().trim();
  if (!mime) return false;
  if (mime.startsWith('audio/')) return false;
  if (mime === 'application/ogg') return false;
  if (mime === 'application/octet-stream') return false;
  return (
    mime.startsWith('text/') ||
    mime.startsWith('image/') ||
    mime.startsWith('application/json') ||
    mime.startsWith('application/pdf')
  );
}

function sameScope(
  a: TransportSessionContext,
  b: TransportSessionContext
): boolean {
  return (
    a.accountNamespace === b.accountNamespace && a.ministryId === b.ministryId
  );
}

export class LocalAudioTransportController {
  private readonly createAudioElement: () => MediaElementLike;
  private readonly createAudioContext: () => AudioContext | null;
  private readonly createObjectURLFn: (blob: Blob) => string;
  private readonly revokeObjectURLFn: (url: string) => void;
  private readonly enableWebAudioGain: boolean;
  private readonly headerSliceLimit: number;
  private readonly defaultSampleRate: number;

  private listeners = new Set<(snapshot: TransportSnapshot) => void>();
  private generation = 0;
  private playSequence = 0;
  private disposed = false;

  private state: TransportState = 'idle';
  private sessionContext: TransportSessionContext;
  private fileName: string | null = null;
  private fileSizeBytes: number | null = null;
  private mimeType: string | null = null;
  private sampleRate = DEFAULT_SAMPLE_RATE;
  private channels = 2;
  private totalFrames = 0;
  private currentFrame = 0;
  private durationSeconds = 0;
  private rate = 1.0;
  private preservesPitch = true;
  private masterGain = 1.0;
  private error: TransportErrorInfo | null = null;
  private headerSliceBytes = 0;

  private mediaElement: MediaElementLike | null = null;
  private activeObjectUrl: string | null = null;
  private mediaTeardown: (() => void) | null = null;

  private audioContext: AudioContext | null = null;
  private mediaSourceNode: MediaElementAudioSourceNode | null = null;
  private masterGainNode: GainNode | null = null;
  private webAudioConnected = false;

  private revokedUrlCount = 0;
  private loadCount = 0;

  constructor(
    initialContext: TransportSessionContext = {
      accountNamespace: 'local-default',
      ministryId: null,
    },
    deps: LocalAudioTransportDependencies = {}
  ) {
    this.sessionContext = { ...initialContext };
    this.createAudioElement =
      deps.createAudioElement ?? defaultCreateAudioElement;
    this.createAudioContext =
      deps.createAudioContext ?? defaultCreateAudioContext;
    this.createObjectURLFn =
      deps.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
    this.revokeObjectURLFn =
      deps.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
    this.enableWebAudioGain = deps.enableWebAudioGain ?? true;
    this.headerSliceLimit = deps.headerSliceBytes ?? WAV_HEADER_SLICE_BYTES;
    this.defaultSampleRate = deps.defaultSampleRate ?? DEFAULT_SAMPLE_RATE;
    this.sampleRate = this.defaultSampleRate;
  }

  getSnapshot(): TransportSnapshot {
    const budget = estimatePcmMemoryBudget({
      durationSeconds: this.durationSeconds,
      sampleRate: this.sampleRate,
      channels: this.channels,
      stems: 1,
    });
    return {
      state: this.state,
      generation: this.generation,
      sessionContext: { ...this.sessionContext },
      fileName: this.fileName,
      fileSizeBytes: this.fileSizeBytes,
      mimeType: this.mimeType,
      sampleRate: this.sampleRate,
      channels: this.channels,
      totalFrames: this.totalFrames,
      currentFrame: this.currentFrame,
      durationSeconds: this.durationSeconds,
      currentTimeSeconds: framesToSeconds(this.currentFrame, this.sampleRate),
      rate: this.rate,
      preservesPitch: this.preservesPitch,
      pitchShiftSemitonesSupported: false,
      masterGain: this.masterGain,
      error: this.error ? { ...this.error } : null,
      memoryBudget: {
        fileBytes: this.fileSizeBytes ?? 0,
        headerSliceBytes: this.headerSliceBytes,
        estimatedFullFloat32PcmBytes: budget.estimatedFullFloat32PcmBytes,
        streamingMode: 'blob-object-url',
      },
    };
  }

  getDiagnostics(): {
    disposed: boolean;
    activeObjectUrl: string | null;
    revokedUrlCount: number;
    loadCount: number;
    webAudioConnected: boolean;
    audioContextSampleRate: number | null;
    audioContextState: AudioContextState | null;
    mediaElement: MediaElementLike | null;
  } {
    return {
      disposed: this.disposed,
      activeObjectUrl: this.activeObjectUrl,
      revokedUrlCount: this.revokedUrlCount,
      loadCount: this.loadCount,
      webAudioConnected: this.webAudioConnected,
      audioContextSampleRate: this.audioContext?.sampleRate ?? null,
      audioContextState: this.audioContext?.state ?? null,
      mediaElement: this.mediaElement,
    };
  }

  subscribe(listener: (snapshot: TransportSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snap);
    }
  }

  private cleanupMediaResources(): void {
    const settlePendingLoad = this.mediaTeardown;
    this.mediaTeardown = null;

    if (this.mediaSourceNode) {
      try {
        this.mediaSourceNode.disconnect();
      } catch {
        // Ignore already-disconnected graph errors.
      }
      this.mediaSourceNode = null;
    }
    this.webAudioConnected = false;

    if (this.mediaElement) {
      try {
        this.mediaElement.pause();
        this.mediaElement.removeAttribute('src');
        this.mediaElement.load();
      } catch {
        // Ignore element teardown errors in detached environments.
      }
      this.mediaElement = null;
    }

    if (this.activeObjectUrl !== null) {
      const urlToRevoke = this.activeObjectUrl;
      this.activeObjectUrl = null;
      this.revokeUrlSafe(urlToRevoke);
    }

    if (settlePendingLoad) {
      settlePendingLoad();
    }
  }

  private revokeUrlSafe(url: string): void {
    try {
      this.revokeObjectURLFn(url);
      this.revokedUrlCount += 1;
    } catch {
      // Ignore revoke failures on synthetic/already-revoked handles.
    }
  }

  private resetLoadedMetadata(): void {
    this.fileName = null;
    this.fileSizeBytes = null;
    this.mimeType = null;
    this.sampleRate = this.defaultSampleRate;
    this.channels = 2;
    this.totalFrames = 0;
    this.currentFrame = 0;
    this.durationSeconds = 0;
    this.headerSliceBytes = 0;
  }

  private failLoad(
    code: TransportErrorCode,
    message: string
  ): TransportSnapshot {
    this.resetLoadedMetadata();
    this.state = 'error';
    this.error = { code, message };
    this.cleanupMediaResources();
    this.emit();
    return this.getSnapshot();
  }

  /**
   * Load an explicit user-selected local File or Blob.
   * Rejects remote URLs, buffers nothing in external/local DBs, inspects at most
   * a 4 KiB header slice for WAV frame metrics, and never autoplays.
   */
  async load(
    file: File | Blob | unknown,
    options?: LoadAudioOptions
  ): Promise<TransportSnapshot> {
    if (this.disposed) {
      return this.getSnapshot();
    }

    if (
      options?.expectedGeneration !== undefined &&
      options.expectedGeneration !== this.generation
    ) {
      return this.getSnapshot();
    }

    if (typeof file === 'string') {
      this.generation += 1;
      return this.failLoad(
        'REMOTE_URL_FORBIDDEN',
        'URLs remotas são proibidas no spike local; selecione um arquivo local explicitamente.'
      );
    }

    if (!(file instanceof Blob)) {
      this.generation += 1;
      return this.failLoad(
        'INVALID_INPUT',
        'Entrada inválida: apenas File ou Blob local é aceito.'
      );
    }

    const resolvedName =
      options?.fileName ??
      ('name' in file && typeof (file as File).name === 'string'
        ? (file as File).name
        : 'local-audio');

    if (options?.sessionContext) {
      this.sessionContext = { ...options.sessionContext };
    }

    // Invalidate previous generation immediately and stop any active playback.
    this.generation += 1;
    const loadGen = this.generation;
    this.loadCount += 1;
    this.resetLoadedMetadata();

    if (file.size <= 0) {
      return this.failLoad(
        'EMPTY_FILE',
        'Arquivo vazio (0 bytes): impossível carregar áudio.'
      );
    }

    if (isDisallowedMime(file)) {
      return this.failLoad(
        'UNSUPPORTED_OR_CORRUPT_HEADER',
        `Tipo MIME incompatível com áudio local: ${file.type}`
      );
    }

    this.state = 'loading';
    this.fileName = resolvedName;
    this.fileSizeBytes = file.size;
    this.mimeType = file.type || 'application/octet-stream';
    this.error = null;
    this.cleanupMediaResources();
    this.emit();

    let headerSliceBuffer: ArrayBuffer | null = null;
    try {
      const slice = file.slice(0, this.headerSliceLimit);
      this.headerSliceBytes = slice.size;
      headerSliceBuffer = await readBlobAsArrayBuffer(slice);
    } catch {
      if (loadGen !== this.generation || this.disposed) {
        return this.getSnapshot();
      }
      return this.failLoad(
        'DECODE_ERROR',
        'Falha ao ler cabeçalho inicial do arquivo local.'
      );
    }

    if (loadGen !== this.generation || this.disposed) {
      return this.getSnapshot();
    }

    let wavInfo: WavHeaderInfo | null = null;
    const startsWithRiff =
      headerSliceBuffer.byteLength >= 4 &&
      String.fromCharCode(...new Uint8Array(headerSliceBuffer, 0, 4)) ===
        'RIFF';

    if (startsWithRiff || isWavDeclared(file, resolvedName)) {
      wavInfo = parseWavHeaderSlice(headerSliceBuffer);
      if (!wavInfo || wavInfo.totalFrames <= 0) {
        return this.failLoad(
          'UNSUPPORTED_OR_CORRUPT_HEADER',
          'Cabeçalho WAV inválido, corrompido ou sem frames de áudio.'
        );
      }
      this.sampleRate = wavInfo.sampleRate;
      this.channels = wavInfo.channels;
      this.totalFrames = wavInfo.totalFrames;
      this.durationSeconds = wavInfo.durationSeconds;
    }

    const objectUrl = this.createObjectURLFn(file);
    if (loadGen !== this.generation || this.disposed) {
      this.revokeUrlSafe(objectUrl);
      return this.getSnapshot();
    }

    const audio = this.createAudioElement();
    audio.autoplay = false;
    audio.preload = 'metadata';

    this.activeObjectUrl = objectUrl;
    this.mediaElement = audio;

    this.attachWebAudioGainIfAvailable(audio);
    this.applyCurrentAudioParameters(audio);

    return await new Promise<TransportSnapshot>((resolve) => {
      let settled = false;

      const isCurrent = () =>
        !this.disposed &&
        loadGen === this.generation &&
        this.mediaElement === audio;

      const onTimeUpdate = () => {
        if (!isCurrent()) return;
        this.syncCurrentFrameFromElement(audio);
        this.emit();
      };

      const onPlaying = () => {
        if (!isCurrent()) return;
        if (this.state !== 'playing') {
          this.state = 'playing';
          this.error = null;
          this.syncCurrentFrameFromElement(audio);
          this.emit();
        }
      };

      const onPause = () => {
        if (!isCurrent()) return;
        if (this.state === 'playing') {
          this.syncCurrentFrameFromElement(audio);
          this.state = 'paused';
          this.emit();
        }
      };

      const onEnded = () => {
        if (!isCurrent()) return;
        this.currentFrame = this.totalFrames;
        this.state = 'paused';
        this.emit();
      };

      const onSeeked = () => {
        if (!isCurrent()) return;
        this.syncCurrentFrameFromElement(audio);
        this.emit();
      };

      const onLoadedMetadata = () => {
        if (!isCurrent()) {
          if (!settled) {
            settled = true;
            resolve(this.getSnapshot());
          }
          return;
        }
        const rawDuration = audio.duration;
        if (wavInfo) {
          this.sampleRate = wavInfo.sampleRate;
          this.channels = wavInfo.channels;
          this.totalFrames = wavInfo.totalFrames;
          this.durationSeconds = wavInfo.durationSeconds;
        } else if (Number.isFinite(rawDuration) && rawDuration > 0) {
          this.durationSeconds = rawDuration;
          this.totalFrames = secondsToFrames(rawDuration, this.sampleRate);
        } else {
          if (!settled) {
            settled = true;
            resolve(
              this.failLoad(
                'DECODE_ERROR',
                'Duração inválida ou fluxo sem áudio decodificável.'
              )
            );
          }
          return;
        }

        this.currentFrame = 0;
        // Strict guarantee: file load never starts playback automatically.
        try {
          if (!audio.paused) {
            audio.pause();
          }
          audio.currentTime = 0;
        } catch {
          // Ignore environments without writable currentTime prior to play.
        }
        this.state = 'ready';
        this.error = null;
        this.emit();
        if (!settled) {
          settled = true;
          resolve(this.getSnapshot());
        }
      };

      const onError = () => {
        if (!isCurrent()) {
          if (!settled) {
            settled = true;
            resolve(this.getSnapshot());
          }
          return;
        }
        const mediaErr = audio.error;
        const msg = mediaErr?.message
          ? `Falha de decodificação de mídia (${mediaErr.message})`
          : 'Falha ao decodificar o arquivo de áudio local selecionado.';
        if (!settled) {
          settled = true;
          resolve(this.failLoad('DECODE_ERROR', msg));
        } else {
          void this.failLoad('DECODE_ERROR', msg);
        }
      };

      audio.addEventListener('loadedmetadata', onLoadedMetadata);
      audio.addEventListener('timeupdate', onTimeUpdate);
      audio.addEventListener('playing', onPlaying);
      audio.addEventListener('pause', onPause);
      audio.addEventListener('ended', onEnded);
      audio.addEventListener('seeked', onSeeked);
      audio.addEventListener('error', onError);

      this.mediaTeardown = () => {
        audio.removeEventListener('loadedmetadata', onLoadedMetadata);
        audio.removeEventListener('timeupdate', onTimeUpdate);
        audio.removeEventListener('playing', onPlaying);
        audio.removeEventListener('pause', onPause);
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('seeked', onSeeked);
        audio.removeEventListener('error', onError);
        if (!settled) {
          settled = true;
          resolve(this.getSnapshot());
        }
      };

      audio.src = objectUrl;
      audio.load();
    });
  }

  private attachWebAudioGainIfAvailable(audio: MediaElementLike): void {
    if (!this.enableWebAudioGain) {
      this.webAudioConnected = false;
      return;
    }
    if (!this.audioContext) {
      this.audioContext = this.createAudioContext();
    }
    const ctx = this.audioContext;
    if (
      !ctx ||
      typeof ctx.createMediaElementSource !== 'function' ||
      typeof ctx.createGain !== 'function'
    ) {
      this.webAudioConnected = false;
      return;
    }

    try {
      const source = ctx.createMediaElementSource(
        audio as unknown as HTMLMediaElement
      );
      if (!this.masterGainNode) {
        this.masterGainNode = ctx.createGain();
        this.masterGainNode.connect(ctx.destination);
      }
      source.connect(this.masterGainNode);
      this.mediaSourceNode = source;
      this.webAudioConnected = true;
    } catch {
      this.webAudioConnected = false;
    }
  }

  private applyCurrentAudioParameters(audio: MediaElementLike): void {
    applyPreservesPitch(audio, this.preservesPitch);
    audio.playbackRate = this.rate;
    if (this.webAudioConnected && this.masterGainNode) {
      // Avoid double attenuation when audio passes through GainNode.
      audio.volume = 1;
      const ctx = this.audioContext;
      if (ctx && typeof this.masterGainNode.gain.setValueAtTime === 'function') {
        this.masterGainNode.gain.setValueAtTime(
          this.masterGain,
          ctx.currentTime
        );
      } else {
        this.masterGainNode.gain.value = this.masterGain;
      }
    } else {
      audio.volume = this.masterGain;
    }
  }

  private syncCurrentFrameFromElement(audio: MediaElementLike): void {
    const rawTime = audio.currentTime;
    if (!Number.isFinite(rawTime)) return;
    this.currentFrame = clampFrame(
      secondsToFrames(rawTime, this.sampleRate),
      this.totalFrames
    );
  }

  /** Poll current position directly from the active transport element. */
  syncPosition(): TransportSnapshot {
    if (this.disposed || !this.mediaElement) {
      return this.getSnapshot();
    }
    this.syncCurrentFrameFromElement(this.mediaElement);
    return this.getSnapshot();
  }

  async play(): Promise<TransportSnapshot> {
    if (this.disposed) {
      return this.getSnapshot();
    }
    const canRetryRejectedPlay =
      this.state === 'error' && this.error?.code === 'PLAYBACK_REJECTED';
    if (
      !this.mediaElement ||
      (this.state !== 'ready' &&
        this.state !== 'paused' &&
        this.state !== 'playing' &&
        !canRetryRejectedPlay)
    ) {
      return this.getSnapshot();
    }

    const playGen = this.generation;
    this.playSequence += 1;
    const playSeq = this.playSequence;
    const audio = this.mediaElement;

    if (
      this.currentFrame >= this.totalFrames &&
      this.totalFrames > 0
    ) {
      this.seek(0);
    }

    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {
        // Ignore blocked AudioContext resume; HTMLMediaElement fallback still runs if permitted.
      }
    }

    if (
      this.disposed ||
      playGen !== this.generation ||
      playSeq !== this.playSequence ||
      this.mediaElement !== audio
    ) {
      return this.getSnapshot();
    }

    this.applyCurrentAudioParameters(audio);

    try {
      await audio.play();
      if (
        this.disposed ||
        playGen !== this.generation ||
        playSeq !== this.playSequence ||
        this.mediaElement !== audio
      ) {
        try {
          audio.pause();
        } catch {
          // Ignore stale cleanup pause error.
        }
        return this.getSnapshot();
      }
      const prevFrame = this.currentFrame;
      const wasPlaying = this.state === 'playing' && this.error === null;
      this.state = 'playing';
      this.error = null;
      this.syncCurrentFrameFromElement(audio);
      if (!wasPlaying || this.currentFrame !== prevFrame) {
        this.emit();
      }
      return this.getSnapshot();
    } catch (err) {
      if (
        this.disposed ||
        playGen !== this.generation ||
        playSeq !== this.playSequence ||
        this.mediaElement !== audio
      ) {
        return this.getSnapshot();
      }
      const message =
        err instanceof Error
          ? err.message
          : 'Reprodução bloqueada pelo navegador (verifique política de autoplay/gesto).';
      this.state = 'error';
      this.error = { code: 'PLAYBACK_REJECTED', message };
      this.emit();
      return this.getSnapshot();
    }
  }

  pause(): TransportSnapshot {
    if (this.disposed || !this.mediaElement) {
      return this.getSnapshot();
    }
    this.playSequence += 1;
    if (
      this.state !== 'playing' &&
      this.state !== 'paused' &&
      this.state !== 'ready'
    ) {
      return this.getSnapshot();
    }
    const prevState = this.state;
    this.state = 'paused';
    this.mediaElement.pause();
    this.syncCurrentFrameFromElement(this.mediaElement);
    if (prevState !== 'paused') {
      this.emit();
    }
    return this.getSnapshot();
  }

  /** Seek monotonically inside `[0, totalFrames]`. */
  seek(frame: number): TransportSnapshot {
    if (this.disposed || !this.mediaElement) {
      return this.getSnapshot();
    }
    if (
      this.state !== 'ready' &&
      this.state !== 'playing' &&
      this.state !== 'paused'
    ) {
      return this.getSnapshot();
    }
    if (!Number.isFinite(frame)) {
      throw new RangeError('Frame de seek precisa ser um número finito.');
    }

    const targetFrame = clampFrame(frame, this.totalFrames);
    const targetSeconds = framesToSeconds(targetFrame, this.sampleRate);
    this.currentFrame = targetFrame;
    this.mediaElement.currentTime = targetSeconds;
    this.emit();
    return this.getSnapshot();
  }

  /**
   * Adjust playback speed within `[0.5, 1.5]`.
   * Distinguishes pitch-preserving time scaling (`preservesPitch = true`) from
   * varispeed resampling (`preservesPitch = false`); independent pitch-shifting
   * without rate change is explicitly unsupported (`pitchShiftSemitonesSupported: false`).
   */
  setRate(rate: number, options?: SetRateOptions): TransportSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    if (!Number.isFinite(rate)) {
      throw new RangeError('Taxa de reprodução precisa ser um número finito.');
    }
    const clampedRate = Math.min(
      MAX_TRANSPORT_RATE,
      Math.max(MIN_TRANSPORT_RATE, Math.round(rate * 1000) / 1000)
    );
    this.rate = clampedRate;
    if (options?.preservesPitch !== undefined) {
      this.preservesPitch = options.preservesPitch;
    }
    if (this.mediaElement) {
      applyPreservesPitch(this.mediaElement, this.preservesPitch);
      this.mediaElement.playbackRate = this.rate;
    }
    this.emit();
    return this.getSnapshot();
  }

  /** Set app master gain clamped to `[0, 1]`. */
  setMasterGain(gain: number): TransportSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    if (!Number.isFinite(gain)) {
      throw new RangeError('Master gain precisa ser um número finito.');
    }
    this.masterGain = Math.min(1, Math.max(0, gain));
    if (this.mediaElement) {
      this.applyCurrentAudioParameters(this.mediaElement);
    }
    this.emit();
    return this.getSnapshot();
  }

  /**
   * Switch active account/ministry or song/version context.
   * Any change of accountNamespace or ministryId stops playback and revokes active
   * object URLs immediately without deleting user files on disk.
   */
  setSessionContext(nextContext: TransportSessionContext): TransportSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    const prev = this.sessionContext;
    const scopeChanged = !sameScope(prev, nextContext);
    this.sessionContext = { ...nextContext };
    if (scopeChanged && this.state !== 'idle') {
      return this.stop();
    }
    this.emit();
    return this.getSnapshot();
  }

  /** Stop playback, detach media, revoke active object URLs, and return to idle. */
  stop(): TransportSnapshot {
    if (this.disposed) {
      return this.getSnapshot();
    }
    this.generation += 1;
    this.resetLoadedMetadata();
    this.state = 'idle';
    this.error = null;
    this.cleanupMediaResources();
    this.emit();
    return this.getSnapshot();
  }

  /** Permanently tear down transport resources, AudioContext, and listeners. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.resetLoadedMetadata();
    this.state = 'idle';
    this.error = null;
    this.cleanupMediaResources();

    if (this.masterGainNode) {
      try {
        this.masterGainNode.disconnect();
      } catch {
        // Ignore already-disconnected GainNode.
      }
      this.masterGainNode = null;
    }

    if (this.audioContext) {
      try {
        void this.audioContext.close();
      } catch {
        // Ignore AudioContext close failures in restricted environments.
      }
      this.audioContext = null;
    }

    this.listeners.clear();
  }
}
