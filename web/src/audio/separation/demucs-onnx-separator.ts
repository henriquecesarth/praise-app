import { Sha256Hasher } from '../rehearsal-package-validator';

export const CANONICAL_STEM_IDS = [
  'vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'other',
] as const;

export type CanonicalStemId = (typeof CANONICAL_STEM_IDS)[number];

export const STEM_DISPLAY_LABELS_PT_BR: Record<CanonicalStemId, string> = {
  vocals: 'Voz',
  drums: 'Bateria',
  bass: 'Baixo',
  guitar: 'Guitarra',
  piano: 'Piano',
  other: 'Outros',
};

export type ExecutionProviderName = 'wasm' | 'webgpu';

export const MAX_MODEL_BYTES = 512 * 1024 * 1024;
export const MAX_AUDIO_WAV_BYTES = 100 * 1024 * 1024;
export const DEFAULT_MAX_AUDIO_SECONDS = 600;

/**
 * Microsoft WAVEFORMATEXTENSIBLE base GUID tail bytes:
 * `0000XXXX-0000-0010-8000-00aa00389b71` (last 12 bytes fixed).
 */
const WAVE_EXTENSIBLE_BASE_GUID_TAIL = [
  0x00, 0x00, 0x10, 0x00, 0x80, 0x00, 0x00, 0xaa, 0x00, 0x38, 0x9b, 0x71,
] as const;

export interface AudioSeparationModelDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly architecture: string;
  readonly version: string;
  readonly license: string;
  readonly sampleRate: number;
  readonly channels: 2;
  readonly segmentSamples: number;
  readonly defaultOverlapRatio: number;
  readonly inputTensorName: string;
  readonly outputTensorName: string;
  readonly rawOutputStemOrder: readonly CanonicalStemId[];
  readonly canonicalStemOrder: readonly CanonicalStemId[];
  readonly supportedExecutionProviders: readonly ExecutionProviderName[];
  readonly expectedModelSha256?: string;
  readonly expectedModelBytes?: number;
}

export const HTDEMUCS_6S_ONNX_DESCRIPTOR: AudioSeparationModelDescriptor = {
  id: 'htdemucs_6s_onnx',
  displayName: 'HT-Demucs 6 Faixas (ONNX fp16-weights)',
  architecture: 'htdemucs',
  version: 'v4-6s-fp16weights',
  license: 'MIT',
  sampleRate: 44100,
  channels: 2,
  segmentSamples: 343980,
  defaultOverlapRatio: 0.25,
  inputTensorName: 'mix',
  outputTensorName: 'stems',
  rawOutputStemOrder: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
  canonicalStemOrder: CANONICAL_STEM_IDS,
  supportedExecutionProviders: ['wasm', 'webgpu'],
  expectedModelSha256:
    '7ce55792e2231c93fbf92de95f5fd5b3a5e6c89f7db690dfd693e8f1dce56869',
  expectedModelBytes: 136428532,
};

export type AudioSeparationErrorCode =
  | 'INVALID_DESCRIPTOR'
  | 'INVALID_AUDIO'
  | 'EMPTY_AUDIO'
  | 'CORRUPT_WAV'
  | 'UNSUPPORTED_WAV_FORMAT'
  | 'UNSUPPORTED_CHANNELS'
  | 'SAMPLE_RATE_MISMATCH'
  | 'NON_FINITE_AUDIO'
  | 'INVALID_MODEL_SOURCE'
  | 'MODEL_CHECKSUM_MISMATCH'
  | 'MODEL_LOAD_FAILED'
  | 'INFERENCE_FAILED'
  | 'INVALID_OUTPUT_TENSOR'
  | 'NON_FINITE_OUTPUT'
  | 'CANCELLED';

export class AudioSeparationError extends Error {
  readonly code: AudioSeparationErrorCode;

  constructor(code: AudioSeparationErrorCode, message: string) {
    super(message);
    this.name = 'AudioSeparationError';
    this.code = code;
  }
}

export interface StereoFloat32Audio {
  sampleRate: number;
  totalFrames: number;
  channels: 2;
  sourceChannels: 1 | 2;
  bitsPerSample: number;
  left: Float32Array;
  right: Float32Array;
}

export interface OnnxInferenceSessionHandle {
  readonly executionProvider: ExecutionProviderName;
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  readonly descriptor?: AudioSeparationModelDescriptor;
  readonly modelId?: string;
  readonly modelVersion?: string;
  readonly modelBytes?: number;
  readonly modelSha256?: string;
  readonly modelChecksumVerified?: boolean;
  readonly ortVersion?: string;
  runSegment(
    mixPlanarStereo: Float32Array,
    segmentSamples: number,
    descriptor: AudioSeparationModelDescriptor
  ): Promise<Float32Array>;
  dispose(): Promise<void> | void;
}

export interface OrtWebSessionAdapterOptions {
  wasmPaths?: string;
  preferredProviders?: readonly ExecutionProviderName[];
  numThreads?: number;
  simd?: boolean;
  graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
  verifyModelChecksum?: boolean;
  maxModelBytes?: number;
}

export type OnnxModelSource = string | Uint8Array | ArrayBuffer | Blob;

export interface SeparationProgressEvent {
  phase: 'loading_model' | 'separating' | 'encoding' | 'complete';
  chunkIndex: number;
  totalChunks: number;
  fraction: number;
  elapsedMs: number;
}

export interface SeparatedStemOutput {
  id: CanonicalStemId;
  labelPtBr: string;
  sampleRate: number;
  channels: 2;
  totalFrames: number;
  left: Float32Array;
  right: Float32Array;
  wavBytes: Uint8Array;
  byteLength: number;
  sha256: string;
  rms: number;
  peak: number;
}

export interface SeparationTelemetryMetrics {
  modelId: string;
  modelVersion: string;
  executionProvider: ExecutionProviderName;
  ortVersion: string;
  modelBytes: number | null;
  modelSha256: string | null;
  modelChecksumVerified: boolean;
  sampleRate: number;
  totalFrames: number;
  audioDurationSeconds: number;
  segmentSamples: number;
  overlapSamples: number;
  chunksProcessed: number;
  modelLoadMs: number;
  inferenceMs: number;
  encodeMs: number;
  totalWallMs: number;
  rtf: number;
  jsHeapUsedBytes: number | null;
  jsHeapSnapshotKind: 'point_in_time_post_encode' | 'unavailable';
  reconstructionMaxAbsError: number;
  inputSha256: string | null;
}

export interface SeparationResult {
  descriptor: AudioSeparationModelDescriptor;
  stems: Record<CanonicalStemId, SeparatedStemOutput>;
  orderedStems: readonly SeparatedStemOutput[];
  telemetry: SeparationTelemetryMetrics;
}

export interface SeparateStereoAudioOptions {
  descriptor?: AudioSeparationModelDescriptor;
  session?: OnnxInferenceSessionHandle;
  createSession?: (
    descriptor: AudioSeparationModelDescriptor
  ) => Promise<{
    session: OnnxInferenceSessionHandle;
    modelLoadMs?: number;
  }>;
  overlapSamples?: number;
  maxFrames?: number;
  inputSha256?: string | null;
  signal?: AbortSignal;
  yieldBetweenChunks?: boolean;
  onProgress?: (event: SeparationProgressEvent) => void;
}

function formatDiagValue(value: unknown): string {
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint' ||
    typeof value === 'symbol'
  ) {
    return String(value);
  }
  if (typeof value === 'string') {
    return value;
  }
  return `[${typeof value}]`;
}

function snapshotModelDescriptor(
  descriptor: AudioSeparationModelDescriptor
): AudioSeparationModelDescriptor {
  if (!descriptor || typeof descriptor !== 'object') {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      'Model descriptor must be a non-null object.'
    );
  }

  // Read every property once to avoid getter-based TOCTOU across validation and freezing.
  const id = descriptor.id;
  const displayName = descriptor.displayName;
  const architecture = descriptor.architecture;
  const version = descriptor.version;
  const license = descriptor.license;
  const sampleRate = descriptor.sampleRate;
  const channels = descriptor.channels;
  const segmentSamples = descriptor.segmentSamples;
  const defaultOverlapRatio = descriptor.defaultOverlapRatio;
  const inputTensorName = descriptor.inputTensorName;
  const outputTensorName = descriptor.outputTensorName;
  const rawOutputRef = descriptor.rawOutputStemOrder;
  const canonicalRef = descriptor.canonicalStemOrder;
  const providersRef = descriptor.supportedExecutionProviders;
  const expectedModelBytes = descriptor.expectedModelBytes;
  const expectedModelSha256 = descriptor.expectedModelSha256;

  const stringFields: readonly [string, unknown][] = [
    ['id', id],
    ['displayName', displayName],
    ['architecture', architecture],
    ['version', version],
    ['license', license],
    ['inputTensorName', inputTensorName],
    ['outputTensorName', outputTensorName],
  ];
  for (const [field, value] of stringFields) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new AudioSeparationError(
        'INVALID_DESCRIPTOR',
        `Model descriptor ${field} must be a non-empty string.`
      );
    }
  }
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `Invalid model sampleRate: ${formatDiagValue(sampleRate)}`
    );
  }
  if (channels !== 2) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `Only stereo models are supported (got ${formatDiagValue(channels)}).`
    );
  }
  if (!Number.isInteger(segmentSamples) || segmentSamples < 4) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `Invalid model segmentSamples: ${formatDiagValue(segmentSamples)}`
    );
  }
  if (
    !Number.isFinite(defaultOverlapRatio) ||
    defaultOverlapRatio < 0 ||
    defaultOverlapRatio >= 0.5
  ) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `Invalid defaultOverlapRatio: ${formatDiagValue(defaultOverlapRatio)}`
    );
  }

  if (!Array.isArray(rawOutputRef) || !Array.isArray(canonicalRef)) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      'rawOutputStemOrder and canonicalStemOrder must be arrays.'
    );
  }
  const stemCount = CANONICAL_STEM_IDS.length;
  if (rawOutputRef.length !== stemCount || canonicalRef.length !== stemCount) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `rawOutputStemOrder and canonicalStemOrder must be exact permutations of all ${stemCount} canonical stems.`
    );
  }
  const rawOutputCopy: CanonicalStemId[] = [];
  for (let i = 0; i < stemCount; i++) {
    if (!Object.prototype.hasOwnProperty.call(rawOutputRef, i)) {
      throw new AudioSeparationError(
        'INVALID_DESCRIPTOR',
        'rawOutputStemOrder and canonicalStemOrder must not contain sparse holes.'
      );
    }
    rawOutputCopy.push(rawOutputRef[i]);
  }
  const canonicalCopy: CanonicalStemId[] = [];
  for (let i = 0; i < stemCount; i++) {
    if (!Object.prototype.hasOwnProperty.call(canonicalRef, i)) {
      throw new AudioSeparationError(
        'INVALID_DESCRIPTOR',
        'rawOutputStemOrder and canonicalStemOrder must not contain sparse holes.'
      );
    }
    canonicalCopy.push(canonicalRef[i]);
  }
  if (rawOutputRef.length !== stemCount || canonicalRef.length !== stemCount) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `rawOutputStemOrder and canonicalStemOrder must be exact permutations of all ${stemCount} canonical stems.`
    );
  }
  const rawSet = new Set(rawOutputCopy);
  const canonicalSet = new Set(canonicalCopy);
  if (rawSet.size !== stemCount || canonicalSet.size !== stemCount) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `rawOutputStemOrder and canonicalStemOrder must be exact permutations of all ${stemCount} canonical stems.`
    );
  }
  for (const requiredStem of CANONICAL_STEM_IDS) {
    if (!rawSet.has(requiredStem) || !canonicalSet.has(requiredStem)) {
      throw new AudioSeparationError(
        'INVALID_DESCRIPTOR',
        `Model descriptor is missing required canonical stem "${requiredStem}".`
      );
    }
  }

  if (!Array.isArray(providersRef)) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      'supportedExecutionProviders must contain only "wasm" or "webgpu".'
    );
  }
  const providersLen = providersRef.length;
  if (
    !Number.isInteger(providersLen) ||
    providersLen <= 0 ||
    providersLen > 16
  ) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      'supportedExecutionProviders must contain only "wasm" or "webgpu".'
    );
  }
  const providersCopy: ExecutionProviderName[] = [];
  for (let i = 0; i < providersLen; i++) {
    if (!Object.prototype.hasOwnProperty.call(providersRef, i)) {
      throw new AudioSeparationError(
        'INVALID_DESCRIPTOR',
        'supportedExecutionProviders must not contain sparse holes.'
      );
    }
    const ep = providersRef[i];
    if (ep !== 'wasm' && ep !== 'webgpu') {
      throw new AudioSeparationError(
        'INVALID_DESCRIPTOR',
        'supportedExecutionProviders must contain only "wasm" or "webgpu".'
      );
    }
    providersCopy.push(ep);
  }
  if (providersRef.length !== providersLen) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      'supportedExecutionProviders length mutated during validation.'
    );
  }

  if (
    expectedModelBytes !== undefined &&
    (!Number.isSafeInteger(expectedModelBytes) ||
      expectedModelBytes <= 0 ||
      expectedModelBytes > MAX_MODEL_BYTES)
  ) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `Invalid expectedModelBytes: ${formatDiagValue(expectedModelBytes)}`
    );
  }
  if (
    expectedModelSha256 !== undefined &&
    (typeof expectedModelSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/i.test(expectedModelSha256))
  ) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      'expectedModelSha256 must be a 64-character hex string.'
    );
  }

  const canonicalSha256 =
    expectedModelSha256 !== undefined
      ? expectedModelSha256.toLowerCase()
      : undefined;

  return Object.freeze({
    id,
    displayName,
    architecture,
    version,
    license,
    sampleRate,
    channels,
    segmentSamples,
    defaultOverlapRatio,
    inputTensorName,
    outputTensorName,
    rawOutputStemOrder: Object.freeze(rawOutputCopy),
    canonicalStemOrder: Object.freeze(canonicalCopy),
    supportedExecutionProviders: Object.freeze(providersCopy),
    ...(canonicalSha256 !== undefined
      ? { expectedModelSha256: canonicalSha256 }
      : {}),
    ...(expectedModelBytes !== undefined ? { expectedModelBytes } : {}),
  });
}

/**
 * Validate a separation model descriptor so future models can be plugged in safely
 * while guaranteeing a complete, non-duplicate 6-stem permutation for M22.
 */
export function validateModelDescriptor(
  descriptor: AudioSeparationModelDescriptor
): void {
  snapshotModelDescriptor(descriptor);
}

/**
 * Registry of client-side audio separation models so future architectures or
 * quantizations can be added without changing pipeline or UI contracts.
 */
export class AudioSeparationModelRegistry {
  private readonly models = new Map<string, AudioSeparationModelDescriptor>();

  constructor(initial: readonly AudioSeparationModelDescriptor[] = []) {
    for (const descriptor of initial) {
      this.register(descriptor);
    }
  }

  register(descriptor: AudioSeparationModelDescriptor): void {
    const frozen = snapshotModelDescriptor(descriptor);
    this.models.set(frozen.id, frozen);
  }

  get(id: string): AudioSeparationModelDescriptor | undefined {
    return this.models.get(id);
  }

  list(): readonly AudioSeparationModelDescriptor[] {
    return Array.from(this.models.values());
  }
}

export const DEFAULT_SEPARATION_MODEL_REGISTRY =
  new AudioSeparationModelRegistry([HTDEMUCS_6S_ONNX_DESCRIPTOR]);

/** Compute lowercase SHA-256 hex digest using WebCrypto with pure-JS fallback. */
export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    const bufferCopy = new Uint8Array(bytes.byteLength);
    bufferCopy.set(bytes);
    const digest = await subtle.digest('SHA-256', bufferCopy.buffer);
    const view = new Uint8Array(digest);
    let hex = '';
    for (let i = 0; i < view.length; i++) {
      hex += view[i].toString(16).padStart(2, '0');
    }
    return hex;
  }
  const hasher = new Sha256Hasher();
  hasher.update(bytes);
  return hasher.digestHex();
}

/**
 * Read a Fetch `Response` stream into a bounded `Uint8Array` so oversized remote
 * or local payloads fail closed before exhausting memory.
 */
export async function readBoundedResponseBytes(
  response: Response,
  maxBytes: number,
  errorCode: AudioSeparationErrorCode,
  label: string
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new AudioSeparationError(
      errorCode,
      `Invalid byte cap (${formatDiagValue(maxBytes)}) for ${label}.`
    );
  }
  const contentLengthHeader = response.headers.get('content-length');
  if (contentLengthHeader) {
    const declaredBytes = Number(contentLengthHeader);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      throw new AudioSeparationError(
        errorCode,
        `${label} size (${declaredBytes} bytes) exceeds cap (${maxBytes} bytes).`
      );
    }
  }

  if (!response.body) {
    const buf = await response.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new AudioSeparationError(
        errorCode,
        `${label} size (${buf.byteLength} bytes) exceeds cap (${maxBytes} bytes).`
      );
    }
    return new Uint8Array(buf);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && value.byteLength > 0) {
        totalRead += value.byteLength;
        if (totalRead > maxBytes) {
          await reader.cancel();
          throw new AudioSeparationError(
            errorCode,
            `${label} exceeds byte cap (${maxBytes} bytes).`
          );
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const assembled = new Uint8Array(totalRead);
  let offset = 0;
  for (const chunk of chunks) {
    assembled.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return assembled;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
}

interface StrictWavFormat {
  effectiveFormat: 1 | 3;
  channels: 1 | 2;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
  dataOffset: number;
  dataBytes: number;
  totalFrames: number;
}

/**
 * Single-pass strict RIFF/WAVE parser validating container bounds, unique fmt/data
 * chunks, consistent blockAlign/byteRate, whole frames, and full 16-byte
 * WAVE_FORMAT_EXTENSIBLE SubFormat GUIDs.
 */
function parseStrictWavDescriptor(buffer: ArrayBuffer): StrictWavFormat {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) {
    throw new AudioSeparationError('EMPTY_AUDIO', 'Audio buffer is empty.');
  }
  if (buffer.byteLength < 44) {
    throw new AudioSeparationError(
      'CORRUPT_WAV',
      'WAV buffer is smaller than minimum 44-byte RIFF/WAVE header.'
    );
  }

  const view = new DataView(buffer);
  if (readAscii(view, 0, 4) !== 'RIFF' || readAscii(view, 8, 4) !== 'WAVE') {
    throw new AudioSeparationError(
      'CORRUPT_WAV',
      'Invalid RIFF/WAVE magic header.'
    );
  }

  const riffChunkSize = view.getUint32(4, true);
  const riffEnd = 8 + riffChunkSize;
  if (riffChunkSize < 36 || riffEnd !== buffer.byteLength) {
    throw new AudioSeparationError(
      'CORRUPT_WAV',
      `Invalid RIFF chunk size (${riffChunkSize}) for ${buffer.byteLength}-byte buffer.`
    );
  }

  let fmt: {
    effectiveFormat: 1 | 3;
    channels: 1 | 2;
    sampleRate: number;
    bitsPerSample: number;
    blockAlign: number;
  } | null = null;
  let data: { dataOffset: number; dataBytes: number } | null = null;

  let offset = 12;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) {
      throw new AudioSeparationError(
        'CORRUPT_WAV',
        'Truncated RIFF subchunk header inside WAV extent.'
      );
    }
    const chunkId = readAscii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    if (payloadOffset + chunkSize > riffEnd) {
      throw new AudioSeparationError(
        'CORRUPT_WAV',
        `WAV subchunk "${chunkId}" extends past RIFF boundary.`
      );
    }

    if (chunkId === 'fmt ') {
      if (fmt !== null) {
        throw new AudioSeparationError(
          'CORRUPT_WAV',
          'Duplicate fmt chunk in WAV file.'
        );
      }
      if (chunkSize < 16) {
        throw new AudioSeparationError(
          'CORRUPT_WAV',
          `WAV fmt chunk too small (${chunkSize} bytes).`
        );
      }
      const audioFormat = view.getUint16(payloadOffset, true);
      const channels = view.getUint16(payloadOffset + 2, true);
      const sampleRate = view.getUint32(payloadOffset + 4, true);
      const byteRate = view.getUint32(payloadOffset + 8, true);
      const blockAlign = view.getUint16(payloadOffset + 12, true);
      const bitsPerSample = view.getUint16(payloadOffset + 14, true);

      if (channels !== 1 && channels !== 2) {
        throw new AudioSeparationError(
          'UNSUPPORTED_CHANNELS',
          `Only mono or stereo WAV files are supported (got ${channels} channels).`
        );
      }
      if (sampleRate < 8000 || sampleRate > 384000) {
        throw new AudioSeparationError(
          'UNSUPPORTED_WAV_FORMAT',
          `Unsupported WAV sample rate: ${sampleRate} Hz.`
        );
      }
      if (
        bitsPerSample !== 8 &&
        bitsPerSample !== 16 &&
        bitsPerSample !== 24 &&
        bitsPerSample !== 32
      ) {
        throw new AudioSeparationError(
          'UNSUPPORTED_WAV_FORMAT',
          `Unsupported WAV bit depth: ${bitsPerSample}.`
        );
      }

      const expectedBlockAlign = channels * (bitsPerSample / 8);
      if (blockAlign !== expectedBlockAlign) {
        throw new AudioSeparationError(
          'CORRUPT_WAV',
          `Contradictory WAV blockAlign ${blockAlign} (expected ${expectedBlockAlign}).`
        );
      }
      if (byteRate !== sampleRate * expectedBlockAlign) {
        throw new AudioSeparationError(
          'CORRUPT_WAV',
          `Contradictory WAV byteRate ${byteRate} (expected ${sampleRate * expectedBlockAlign}).`
        );
      }

      let effectiveFormat: 1 | 3;
      if (audioFormat === 1) {
        effectiveFormat = 1;
      } else if (audioFormat === 3) {
        if (bitsPerSample !== 32) {
          throw new AudioSeparationError(
            'UNSUPPORTED_WAV_FORMAT',
            `IEEE float WAV requires 32 bits/sample (got ${bitsPerSample}).`
          );
        }
        effectiveFormat = 3;
      } else if (audioFormat === 0xfffe) {
        if (chunkSize < 40) {
          throw new AudioSeparationError(
            'CORRUPT_WAV',
            'WAVE_FORMAT_EXTENSIBLE fmt chunk must be >= 40 bytes.'
          );
        }
        const cbSize = view.getUint16(payloadOffset + 16, true);
        const validBitsPerSample = view.getUint16(payloadOffset + 18, true);
        if (
          cbSize < 22 ||
          18 + cbSize > chunkSize ||
          validBitsPerSample < 1 ||
          validBitsPerSample > bitsPerSample
        ) {
          throw new AudioSeparationError(
            'CORRUPT_WAV',
            'Invalid WAVE_FORMAT_EXTENSIBLE cbSize or validBitsPerSample.'
          );
        }
        const subFormatTag = view.getUint32(payloadOffset + 24, true);
        for (let i = 0; i < WAVE_EXTENSIBLE_BASE_GUID_TAIL.length; i++) {
          if (
            view.getUint8(payloadOffset + 28 + i) !==
            WAVE_EXTENSIBLE_BASE_GUID_TAIL[i]
          ) {
            throw new AudioSeparationError(
              'UNSUPPORTED_WAV_FORMAT',
              'Unsupported WAVE_FORMAT_EXTENSIBLE SubFormat GUID.'
            );
          }
        }
        if (subFormatTag === 1) {
          effectiveFormat = 1;
        } else if (subFormatTag === 3) {
          if (bitsPerSample !== 32) {
            throw new AudioSeparationError(
              'UNSUPPORTED_WAV_FORMAT',
              `WAVE_FORMAT_EXTENSIBLE IEEE float requires 32 bits/sample (got ${bitsPerSample}).`
            );
          }
          effectiveFormat = 3;
        } else {
          throw new AudioSeparationError(
            'UNSUPPORTED_WAV_FORMAT',
            `Unsupported WAVE_FORMAT_EXTENSIBLE subformat tag: ${subFormatTag}.`
          );
        }
      } else {
        throw new AudioSeparationError(
          'UNSUPPORTED_WAV_FORMAT',
          `Unsupported WAV audio format tag: ${audioFormat}.`
        );
      }

      fmt = {
        effectiveFormat,
        channels,
        sampleRate,
        bitsPerSample,
        blockAlign,
      };
    } else if (chunkId === 'data') {
      if (fmt === null) {
        throw new AudioSeparationError(
          'CORRUPT_WAV',
          'WAV data chunk appears before fmt chunk.'
        );
      }
      if (data !== null) {
        throw new AudioSeparationError(
          'CORRUPT_WAV',
          'Duplicate data chunk in WAV file.'
        );
      }
      data = {
        dataOffset: payloadOffset,
        dataBytes: chunkSize,
      };
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    const nextOffset = payloadOffset + paddedSize;
    if (nextOffset <= offset || nextOffset > riffEnd) {
      throw new AudioSeparationError(
        'CORRUPT_WAV',
        'Invalid WAV chunk length advance or missing odd-chunk padding byte.'
      );
    }
    offset = nextOffset;
  }

  if (!fmt || !data) {
    throw new AudioSeparationError(
      'CORRUPT_WAV',
      'WAV file is missing required fmt or data chunk.'
    );
  }
  if (data.dataBytes <= 0) {
    throw new AudioSeparationError('EMPTY_AUDIO', 'WAV data chunk is empty.');
  }
  if (data.dataBytes % fmt.blockAlign !== 0) {
    throw new AudioSeparationError(
      'CORRUPT_WAV',
      `WAV data chunk (${data.dataBytes} bytes) contains a partial frame for blockAlign ${fmt.blockAlign}.`
    );
  }

  return {
    ...fmt,
    dataOffset: data.dataOffset,
    dataBytes: data.dataBytes,
    totalFrames: data.dataBytes / fmt.blockAlign,
  };
}

function readNormalizedSample(
  view: DataView,
  byteOffset: number,
  effectiveFormat: 1 | 3,
  bitsPerSample: number
): number {
  if (effectiveFormat === 3) {
    if (bitsPerSample !== 32) {
      throw new AudioSeparationError(
        'UNSUPPORTED_WAV_FORMAT',
        `Unsupported IEEE float bit depth: ${bitsPerSample}`
      );
    }
    const sample = view.getFloat32(byteOffset, true);
    if (!Number.isFinite(sample)) {
      throw new AudioSeparationError(
        'NON_FINITE_AUDIO',
        'WAV input contains NaN or Infinity float32 samples.'
      );
    }
    return Math.max(-1, Math.min(1, sample));
  }

  switch (bitsPerSample) {
    case 8:
      return (view.getUint8(byteOffset) - 128) / 128;
    case 16:
      return view.getInt16(byteOffset, true) / 32768;
    case 24: {
      const b0 = view.getUint8(byteOffset);
      const b1 = view.getUint8(byteOffset + 1);
      const b2 = view.getInt8(byteOffset + 2);
      const signed24 = (b2 << 16) | (b1 << 8) | b0;
      return signed24 / 8388608;
    }
    case 32:
      return view.getInt32(byteOffset, true) / 2147483648;
    default:
      throw new AudioSeparationError(
        'UNSUPPORTED_WAV_FORMAT',
        `Unsupported PCM bit depth: ${bitsPerSample}`
      );
  }
}

/**
 * Decode a RIFF/WAVE buffer (PCM 8/16/24/32 or IEEE float32, mono or stereo)
 * into planar stereo Float32Arrays in `[-1, 1]`.
 */
export function decodeWavToStereoFloat32(
  buffer: ArrayBuffer,
  options?: { expectedSampleRate?: number | null; maxFrames?: number }
): StereoFloat32Audio {
  const header = parseStrictWavDescriptor(buffer);
  if (
    options?.expectedSampleRate !== undefined &&
    options.expectedSampleRate !== null &&
    header.sampleRate !== options.expectedSampleRate
  ) {
    throw new AudioSeparationError(
      'SAMPLE_RATE_MISMATCH',
      `Expected ${formatDiagValue(options.expectedSampleRate)} Hz WAV, got ${header.sampleRate} Hz.`
    );
  }
  const maxFrames =
    options?.maxFrames ?? header.sampleRate * DEFAULT_MAX_AUDIO_SECONDS;
  if (!Number.isSafeInteger(maxFrames) || maxFrames <= 0) {
    throw new AudioSeparationError(
      'INVALID_AUDIO',
      `Invalid maxFrames decode cap: ${formatDiagValue(maxFrames)}.`
    );
  }
  if (header.totalFrames > maxFrames) {
    throw new AudioSeparationError(
      'INVALID_AUDIO',
      `WAV frame count (${header.totalFrames}) exceeds decode cap (${maxFrames} frames).`
    );
  }

  const bytesPerSample = header.bitsPerSample / 8;
  const view = new DataView(buffer);
  const totalFrames = header.totalFrames;
  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);

  for (let frame = 0; frame < totalFrames; frame++) {
    const frameOffset = header.dataOffset + frame * header.blockAlign;
    const l = readNormalizedSample(
      view,
      frameOffset,
      header.effectiveFormat,
      header.bitsPerSample
    );
    left[frame] = l;
    right[frame] =
      header.channels === 2
        ? readNormalizedSample(
            view,
            frameOffset + bytesPerSample,
            header.effectiveFormat,
            header.bitsPerSample
          )
        : l;
  }

  return {
    sampleRate: header.sampleRate,
    totalFrames,
    channels: 2,
    sourceChannels: header.channels,
    bitsPerSample: header.bitsPerSample,
    left,
    right,
  };
}

/** Encode planar stereo Float32 audio into a canonical PCM16 WAV byte array. */
export function encodeStereoPcm16Wav(audio: {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
}): Uint8Array {
  const { sampleRate, left, right } = audio;
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) {
    throw new AudioSeparationError(
      'INVALID_AUDIO',
      `Invalid sampleRate for WAV encoding: ${formatDiagValue(sampleRate)}`
    );
  }
  if (left.length === 0 || left.length !== right.length) {
    throw new AudioSeparationError(
      'INVALID_AUDIO',
      'Left and right channels must be non-empty and identical in frame count.'
    );
  }

  const totalFrames = left.length;
  const blockAlign = 4; // 2 channels * 2 bytes
  const dataBytes = totalFrames * blockAlign;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer);

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
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  for (let i = 0; i < totalFrames; i++) {
    const l = left[i];
    const r = right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) {
      throw new AudioSeparationError(
        'NON_FINITE_OUTPUT',
        `Non-finite audio sample detected at frame ${i}.`
      );
    }
    const lClamped = Math.max(-1, Math.min(1, l));
    const rClamped = Math.max(-1, Math.min(1, r));
    const lInt = Math.max(
      -32768,
      Math.min(32767, Math.round(lClamped < 0 ? lClamped * 32768 : lClamped * 32767))
    );
    const rInt = Math.max(
      -32768,
      Math.min(32767, Math.round(rClamped < 0 ? rClamped * 32768 : rClamped * 32767))
    );
    const offset = 44 + i * blockAlign;
    view.setInt16(offset, lInt, true);
    view.setInt16(offset + 2, rInt, true);
  }

  return out;
}

/**
 * Create a strictly-positive trapezoidal overlap-add window whose fade-in and
 * fade-out regions sum identically to 1.0 across adjacent chunks and never hit 0.
 */
export function createOverlapWindow(
  segmentSamples: number,
  overlapSamples: number
): Float32Array {
  if (!Number.isInteger(segmentSamples) || segmentSamples < 4) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `segmentSamples must be an integer >= 4 (got ${formatDiagValue(segmentSamples)}).`
    );
  }
  if (
    !Number.isInteger(overlapSamples) ||
    overlapSamples < 0 ||
    overlapSamples * 2 >= segmentSamples
  ) {
    throw new AudioSeparationError(
      'INVALID_DESCRIPTOR',
      `overlapSamples (${formatDiagValue(overlapSamples)}) must satisfy 0 <= overlapSamples < segmentSamples / 2.`
    );
  }

  const window = new Float32Array(segmentSamples);
  window.fill(1);
  if (overlapSamples === 0) {
    return window;
  }

  for (let k = 0; k < overlapSamples; k++) {
    const fadeIn = (k + 1) / (overlapSamples + 1);
    window[k] = fadeIn;
    window[segmentSamples - 1 - k] = fadeIn;
  }
  return window;
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function readJsHeapUsedBytes(): number | null {
  if (typeof performance === 'undefined') {
    return null;
  }
  const perfWithMemory = performance as Performance & {
    memory?: { usedJSHeapSize?: number };
  };
  const used = perfWithMemory.memory?.usedJSHeapSize;
  return typeof used === 'number' && Number.isFinite(used) ? used : null;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AudioSeparationError(
      'CANCELLED',
      'Audio separation was cancelled.'
    );
  }
}

async function resolveModelBytes(
  modelSource: OnnxModelSource,
  maxModelBytes: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  checkAborted(signal);
  if (typeof modelSource === 'string') {
    const trimmed = modelSource.trim();
    if (!trimmed) {
      throw new AudioSeparationError(
        'INVALID_MODEL_SOURCE',
        'Model URL must be non-empty.'
      );
    }
    const response = await fetch(trimmed, { signal });
    if (!response.ok) {
      throw new AudioSeparationError(
        'MODEL_LOAD_FAILED',
        `Failed to fetch ONNX model (${response.status} ${response.statusText}).`
      );
    }
    const bytes = await readBoundedResponseBytes(
      response,
      maxModelBytes,
      'INVALID_MODEL_SOURCE',
      'ONNX model'
    );
    if (bytes.byteLength === 0) {
      throw new AudioSeparationError(
        'MODEL_LOAD_FAILED',
        'Fetched ONNX model file is empty.'
      );
    }
    return bytes;
  }

  if (modelSource instanceof Uint8Array) {
    if (modelSource.byteLength === 0 || modelSource.byteLength > maxModelBytes) {
      throw new AudioSeparationError(
        'INVALID_MODEL_SOURCE',
        `Model Uint8Array byteLength (${modelSource.byteLength}) must be in (0, ${maxModelBytes}].`
      );
    }
    const snapshot = new Uint8Array(modelSource.byteLength);
    snapshot.set(modelSource);
    return snapshot;
  }

  if (modelSource instanceof ArrayBuffer) {
    if (modelSource.byteLength === 0 || modelSource.byteLength > maxModelBytes) {
      throw new AudioSeparationError(
        'INVALID_MODEL_SOURCE',
        `Model ArrayBuffer byteLength (${modelSource.byteLength}) must be in (0, ${maxModelBytes}].`
      );
    }
    const snapshot = new Uint8Array(modelSource.byteLength);
    snapshot.set(new Uint8Array(modelSource));
    return snapshot;
  }

  if (typeof Blob !== 'undefined' && modelSource instanceof Blob) {
    if (modelSource.size === 0 || modelSource.size > maxModelBytes) {
      throw new AudioSeparationError(
        'INVALID_MODEL_SOURCE',
        `Model Blob/File size (${modelSource.size}) must be in (0, ${maxModelBytes}].`
      );
    }
    const buf = await modelSource.arrayBuffer();
    checkAborted(signal);
    if (buf.byteLength === 0 || buf.byteLength > maxModelBytes) {
      throw new AudioSeparationError(
        'INVALID_MODEL_SOURCE',
        `Model Blob/File effective byteLength (${buf.byteLength}) must be in (0, ${maxModelBytes}].`
      );
    }
    const snapshot = new Uint8Array(buf.byteLength);
    snapshot.set(new Uint8Array(buf));
    return snapshot;
  }

  throw new AudioSeparationError(
    'INVALID_MODEL_SOURCE',
    'Unsupported ONNX model source.'
  );
}

interface VerifiedOrtSessionStamp {
  readonly descriptor: AudioSeparationModelDescriptor;
  readonly executionProvider: ExecutionProviderName;
  readonly ortVersion: string;
  readonly modelBytes: number;
  readonly modelSha256: string;
  readonly modelChecksumVerified: boolean;
  readonly runSegment: OnnxInferenceSessionHandle['runSegment'];
  readonly dispose: OnnxInferenceSessionHandle['dispose'];
}

const VERIFIED_ORT_SESSION_STAMPS = new WeakMap<
  OnnxInferenceSessionHandle,
  VerifiedOrtSessionStamp
>();
const reflectApply = Reflect.apply;

/**
 * Create a real browser ONNX Runtime Web session handle for a separation model
 * descriptor, enforcing pinned model checksums, bounded loads, and strict
 * tensor lifecycle disposal.
 */
export async function createOrtWebSessionAdapter(
  modelSource: OnnxModelSource,
  descriptor: AudioSeparationModelDescriptor = HTDEMUCS_6S_ONNX_DESCRIPTOR,
  options?: OrtWebSessionAdapterOptions & { signal?: AbortSignal }
): Promise<{
  session: OnnxInferenceSessionHandle;
  modelLoadMs: number;
}> {
  const frozenDescriptor = snapshotModelDescriptor(descriptor);
  checkAborted(options?.signal);

  const isPinned = Boolean(
    frozenDescriptor.expectedModelSha256 ||
      frozenDescriptor.expectedModelBytes !== undefined
  );
  const shouldVerify = options?.verifyModelChecksum ?? isPinned;
  if (isPinned && !shouldVerify) {
    throw new AudioSeparationError(
      'MODEL_CHECKSUM_MISMATCH',
      `Model "${frozenDescriptor.id}" has a pinned checksum/size and cannot be loaded without verification.`
    );
  }

  const maxModelBytes = options?.maxModelBytes ?? MAX_MODEL_BYTES;
  if (
    !Number.isSafeInteger(maxModelBytes) ||
    maxModelBytes <= 0 ||
    maxModelBytes > MAX_MODEL_BYTES
  ) {
    throw new AudioSeparationError(
      'INVALID_MODEL_SOURCE',
      `Invalid maxModelBytes (${formatDiagValue(maxModelBytes)}); must be an integer in (0, ${MAX_MODEL_BYTES}].`
    );
  }
  const loadStartMs = nowMs();
  const ort = await import('onnxruntime-web');
  checkAborted(options?.signal);

  ort.env.wasm.wasmPaths = options?.wasmPaths ?? '/ort/';
  ort.env.wasm.simd = options?.simd ?? true;
  ort.env.wasm.proxy = false;
  if (options?.numThreads !== undefined) {
    ort.env.wasm.numThreads = Math.max(1, Math.floor(options.numThreads));
  } else {
    const hardwareThreads =
      typeof navigator !== 'undefined' &&
      typeof navigator.hardwareConcurrency === 'number'
        ? navigator.hardwareConcurrency
        : 1;
    ort.env.wasm.numThreads =
      typeof globalThis !== 'undefined' &&
      (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated
        ? Math.min(4, Math.max(1, hardwareThreads))
        : 1;
  }

  let modelBytesArray: Uint8Array | null = await resolveModelBytes(
    modelSource,
    maxModelBytes,
    options?.signal
  );

  const modelBytes = modelBytesArray.byteLength;
  const modelSha256 = await computeSha256Hex(modelBytesArray);
  checkAborted(options?.signal);

  let checksumVerified = false;
  if (shouldVerify) {
    if (
      frozenDescriptor.expectedModelBytes !== undefined &&
      modelBytes !== frozenDescriptor.expectedModelBytes
    ) {
      throw new AudioSeparationError(
        'MODEL_CHECKSUM_MISMATCH',
        `Expected ${frozenDescriptor.expectedModelBytes} model bytes, got ${modelBytes}.`
      );
    }
    if (frozenDescriptor.expectedModelSha256) {
      if (modelSha256 !== frozenDescriptor.expectedModelSha256) {
        throw new AudioSeparationError(
          'MODEL_CHECKSUM_MISMATCH',
          `Model SHA-256 mismatch: expected ${frozenDescriptor.expectedModelSha256}, got ${modelSha256}.`
        );
      }
      checksumVerified = true;
    }
  }

  const providers =
    options?.preferredProviders && options.preferredProviders.length > 0
      ? options.preferredProviders
      : (['wasm'] as const);
  // Default to 'disabled' because ORT WASM aborts under 'all' across HTDemucs's 13,138 nodes.
  const graphOptimizationLevel = options?.graphOptimizationLevel ?? 'disabled';

  let createdSession: Awaited<ReturnType<typeof ort.InferenceSession.create>> | null =
    null;
  let activeProvider: ExecutionProviderName | null = null;
  let lastError: unknown = null;

  for (const provider of providers) {
    checkAborted(options?.signal);
    if (!frozenDescriptor.supportedExecutionProviders.includes(provider)) {
      continue;
    }
    if (
      provider === 'webgpu' &&
      (typeof navigator === 'undefined' ||
        !(navigator as Navigator & { gpu?: unknown }).gpu)
    ) {
      continue;
    }
    try {
      createdSession = await ort.InferenceSession.create(modelBytesArray, {
        executionProviders: [provider],
        graphOptimizationLevel,
      });
      if (options?.signal?.aborted) {
        try {
          await createdSession.release();
        } catch {
          // Ignore release errors on cancellation so CANCELLED is never masked.
        }
        checkAborted(options?.signal);
      }
      activeProvider = provider;
      break;
    } catch (err) {
      if (err instanceof AudioSeparationError && err.code === 'CANCELLED') {
        throw err;
      }
      checkAborted(options?.signal);
      lastError = err;
    }
  }

  // Release JS reference to raw model bytes once ORT holds its internal session buffer.
  modelBytesArray = null;

  if (!createdSession || !activeProvider) {
    const detail =
      lastError instanceof Error ? lastError.message : String(lastError ?? 'No provider succeeded');
    throw new AudioSeparationError(
      'MODEL_LOAD_FAILED',
      `Failed to initialize ONNX Runtime Web session (${providers.join(', ')}): ${detail}`
    );
  }

  const session = createdSession;
  const executionProvider = activeProvider;
  if (
    !session.inputNames.includes(frozenDescriptor.inputTensorName) ||
    !session.outputNames.includes(frozenDescriptor.outputTensorName)
  ) {
    try {
      await session.release();
    } catch {
      // Preserve MODEL_LOAD_FAILED contract error if release also throws.
    }
    throw new AudioSeparationError(
      'MODEL_LOAD_FAILED',
      `ONNX model graph tensors [${session.inputNames.join(', ')}] -> [${session.outputNames.join(', ')}] do not match descriptor "${frozenDescriptor.id}" (${frozenDescriptor.inputTensorName} -> ${frozenDescriptor.outputTensorName}).`
    );
  }
  const ortVersion =
    ort.env.versions?.web ?? ort.env.versions?.common ?? 'unknown';
  const modelLoadMs = Math.max(0, nowMs() - loadStartMs);

  const handle: OnnxInferenceSessionHandle = Object.freeze<OnnxInferenceSessionHandle>({
    executionProvider,
    inputNames: Object.freeze([...session.inputNames]),
    outputNames: Object.freeze([...session.outputNames]),
    descriptor: frozenDescriptor,
    modelId: frozenDescriptor.id,
    modelVersion: frozenDescriptor.version,
    modelBytes,
    modelSha256,
    modelChecksumVerified: checksumVerified,
    ortVersion,
    async runSegment(
      mixPlanarStereo: Float32Array,
      segmentSamples: number,
      activeDescriptor: AudioSeparationModelDescriptor
    ) {
      let callerDescriptor: AudioSeparationModelDescriptor;
      try {
        callerDescriptor = snapshotModelDescriptor(activeDescriptor);
      } catch {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          'Invalid model descriptor passed to session.runSegment().'
        );
      }
      if (
        segmentSamples !== frozenDescriptor.segmentSamples ||
        !descriptorsMatchContract(frozenDescriptor, callerDescriptor)
      ) {
        throw new AudioSeparationError(
          'INFERENCE_FAILED',
          `Descriptor or segmentSamples mismatch during runSegment for "${frozenDescriptor.id}@${frozenDescriptor.version}".`
        );
      }
      const inputTensor = new ort.Tensor('float32', mixPlanarStereo, [
        1,
        2,
        segmentSamples,
      ]);
      let results: Record<string, { data: unknown; dims?: readonly number[]; dispose?: () => void }> =
        {};
      try {
        results = await session.run(
          { [callerDescriptor.inputTensorName]: inputTensor },
          [callerDescriptor.outputTensorName]
        );
        const rawOut = results[callerDescriptor.outputTensorName];
        if (!rawOut) {
          throw new AudioSeparationError(
            'INVALID_OUTPUT_TENSOR',
            `Missing expected ONNX output tensor "${callerDescriptor.outputTensorName}".`
          );
        }
        const expectedLen =
          callerDescriptor.rawOutputStemOrder.length * 2 * segmentSamples;
        const dims = rawOut.dims ?? [];
        if (
          dims.length !== 4 ||
          dims[0] !== 1 ||
          dims[1] !== callerDescriptor.rawOutputStemOrder.length ||
          dims[2] !== 2 ||
          dims[3] !== segmentSamples
        ) {
          throw new AudioSeparationError(
            'INVALID_OUTPUT_TENSOR',
            `Unexpected ONNX output tensor dims [${dims.join(', ')}]; expected [1, ${callerDescriptor.rawOutputStemOrder.length}, 2, ${segmentSamples}].`
          );
        }
        if (!(rawOut.data instanceof Float32Array) || rawOut.data.length !== expectedLen) {
          throw new AudioSeparationError(
            'INVALID_OUTPUT_TENSOR',
            `Expected Float32Array output of length ${expectedLen}.`
          );
        }
        const copy = new Float32Array(rawOut.data.length);
        copy.set(rawOut.data);
        return copy;
      } finally {
        inputTensor.dispose();
        for (const tensor of Object.values(results)) {
          tensor?.dispose?.();
        }
      }
    },
    async dispose() {
      await session.release();
    },
  });
  Object.freeze(handle.runSegment);
  Object.freeze(handle.dispose);

  VERIFIED_ORT_SESSION_STAMPS.set(
    handle,
    Object.freeze({
      descriptor: frozenDescriptor,
      executionProvider,
      ortVersion,
      modelBytes,
      modelSha256,
      modelChecksumVerified: checksumVerified,
      runSegment: handle.runSegment,
      dispose: handle.dispose,
    })
  );

  return { session: handle, modelLoadMs };
}

interface ValidatedSessionAttestation {
  executionProvider: ExecutionProviderName;
  ortVersion: string;
  modelBytes: number | null;
  modelSha256: string | null;
  modelChecksumVerified: boolean;
  runSegment: OnnxInferenceSessionHandle['runSegment'];
  dispose: OnnxInferenceSessionHandle['dispose'];
}

function descriptorsMatchContract(
  a: AudioSeparationModelDescriptor,
  b: AudioSeparationModelDescriptor
): boolean {
  if (
    a.id !== b.id ||
    a.version !== b.version ||
    a.architecture !== b.architecture ||
    a.sampleRate !== b.sampleRate ||
    a.channels !== b.channels ||
    a.segmentSamples !== b.segmentSamples ||
    a.inputTensorName !== b.inputTensorName ||
    a.outputTensorName !== b.outputTensorName ||
    a.expectedModelBytes !== b.expectedModelBytes ||
    a.expectedModelSha256 !== b.expectedModelSha256 ||
    a.rawOutputStemOrder.length !== b.rawOutputStemOrder.length ||
    a.canonicalStemOrder.length !== b.canonicalStemOrder.length
  ) {
    return false;
  }
  for (let i = 0; i < a.rawOutputStemOrder.length; i++) {
    if (
      a.rawOutputStemOrder[i] !== b.rawOutputStemOrder[i] ||
      a.canonicalStemOrder[i] !== b.canonicalStemOrder[i]
    ) {
      return false;
    }
  }
  return true;
}

function validateSessionAttestation(
  session: OnnxInferenceSessionHandle,
  descriptor: AudioSeparationModelDescriptor
): ValidatedSessionAttestation {
  const executionProvider = session.executionProvider;
  if (
    (executionProvider !== 'wasm' && executionProvider !== 'webgpu') ||
    !descriptor.supportedExecutionProviders.includes(executionProvider)
  ) {
    throw new AudioSeparationError(
      'INFERENCE_FAILED',
      `Session executionProvider "${formatDiagValue(executionProvider)}" is not supported by descriptor "${descriptor.id}".`
    );
  }

  const inputNames = session.inputNames;
  const outputNames = session.outputNames;
  if (
    !Array.isArray(inputNames) ||
    !Array.isArray(outputNames) ||
    !inputNames.includes(descriptor.inputTensorName) ||
    !outputNames.includes(descriptor.outputTensorName)
  ) {
    throw new AudioSeparationError(
      'INFERENCE_FAILED',
      `Session tensor contract does not expose "${descriptor.inputTensorName}" -> "${descriptor.outputTensorName}".`
    );
  }

  const sessionDescriptorRaw = session.descriptor;
  let sessionDescriptor: AudioSeparationModelDescriptor | null = null;
  if (sessionDescriptorRaw !== undefined) {
    try {
      sessionDescriptor = snapshotModelDescriptor(sessionDescriptorRaw);
    } catch {
      throw new AudioSeparationError(
        'INFERENCE_FAILED',
        'Session bound descriptor is invalid.'
      );
    }
    if (
      !descriptorsMatchContract(sessionDescriptor, descriptor) ||
      !sessionDescriptor.supportedExecutionProviders.includes(executionProvider)
    ) {
      throw new AudioSeparationError(
        'INFERENCE_FAILED',
        `Session descriptor contract (${sessionDescriptor.id}@${sessionDescriptor.version}) does not match requested descriptor (${descriptor.id}@${descriptor.version}).`
      );
    }
  }

  const modelId = session.modelId;
  const modelVersion = session.modelVersion;
  const rawModelBytes = session.modelBytes;
  const modelBytes = rawModelBytes === undefined ? null : rawModelBytes;
  const rawModelSha256Field = session.modelSha256;
  const rawModelSha256 =
    rawModelSha256Field === undefined ? null : rawModelSha256Field;
  const rawChecksumVerified = session.modelChecksumVerified;
  const modelChecksumVerified =
    rawChecksumVerified === undefined ? false : rawChecksumVerified;
  const rawOrtVersion = session.ortVersion;
  const ortVersion =
    typeof rawOrtVersion === 'string' && rawOrtVersion.trim()
      ? rawOrtVersion
      : 'unknown';

  if (
    (modelBytes !== null &&
      (!Number.isSafeInteger(modelBytes) ||
        modelBytes <= 0 ||
        modelBytes > MAX_MODEL_BYTES)) ||
    (rawModelSha256 !== null &&
      (typeof rawModelSha256 !== 'string' ||
        !/^[0-9a-f]{64}$/i.test(rawModelSha256))) ||
    typeof modelChecksumVerified !== 'boolean' ||
    (modelChecksumVerified && rawModelSha256 === null)
  ) {
    throw new AudioSeparationError(
      'INFERENCE_FAILED',
      'Non-finite or invalid telemetry value detected.'
    );
  }

  const modelSha256 =
    rawModelSha256 !== null ? rawModelSha256.toLowerCase() : null;
  const isPinned =
    descriptor.expectedModelBytes !== undefined ||
    descriptor.expectedModelSha256 !== undefined;
  const runSegment = session.runSegment;
  const dispose = session.dispose;
  if (typeof runSegment !== 'function' || typeof dispose !== 'function') {
    throw new AudioSeparationError(
      'INFERENCE_FAILED',
      'Session handle must expose runSegment() and dispose() functions.'
    );
  }

  const stamp = VERIFIED_ORT_SESSION_STAMPS.get(session);

  if (stamp !== undefined) {
    if (
      !descriptorsMatchContract(stamp.descriptor, descriptor) ||
      !stamp.descriptor.supportedExecutionProviders.includes(
        stamp.executionProvider
      ) ||
      modelId !== stamp.descriptor.id ||
      modelVersion !== stamp.descriptor.version ||
      stamp.executionProvider !== executionProvider ||
      stamp.ortVersion !== ortVersion ||
      stamp.modelBytes !== modelBytes ||
      stamp.modelSha256 !== modelSha256 ||
      stamp.modelChecksumVerified !== modelChecksumVerified ||
      runSegment !== stamp.runSegment ||
      dispose !== stamp.dispose
    ) {
      throw new AudioSeparationError(
        'INFERENCE_FAILED',
        `Session verification stamp does not match requested descriptor "${descriptor.id}@${descriptor.version}".`
      );
    }
  }

  if (isPinned || modelChecksumVerified) {
    if (
      stamp === undefined ||
      sessionDescriptor === null ||
      !descriptorsMatchContract(sessionDescriptor, descriptor)
    ) {
      throw new AudioSeparationError(
        'INFERENCE_FAILED',
        `Attested/pinned model "${descriptor.id}@${descriptor.version}" requires an authentic createOrtWebSessionAdapter session verified against matching bytes.`
      );
    }
  }

  if (isPinned) {
    if (
      typeof modelId !== 'string' ||
      modelId !== descriptor.id ||
      typeof modelVersion !== 'string' ||
      modelVersion !== descriptor.version ||
      (descriptor.expectedModelBytes !== undefined &&
        modelBytes !== descriptor.expectedModelBytes) ||
      (descriptor.expectedModelSha256 !== undefined &&
        (modelChecksumVerified !== true ||
          modelSha256 !== descriptor.expectedModelSha256))
    ) {
      throw new AudioSeparationError(
        'INFERENCE_FAILED',
        `Pinned model "${descriptor.id}@${descriptor.version}" requires matching session attestation.`
      );
    }
  }

  const sessionMatchesDescriptor =
    (modelId === undefined || modelId === descriptor.id) &&
    (modelVersion === undefined || modelVersion === descriptor.version) &&
    (descriptor.expectedModelBytes === undefined ||
      modelBytes === null ||
      modelBytes === descriptor.expectedModelBytes) &&
    (descriptor.expectedModelSha256 === undefined ||
      modelSha256 === null ||
      modelSha256 === descriptor.expectedModelSha256);

  const checksumAttestationValid =
    !modelChecksumVerified ||
    (typeof modelId === 'string' &&
      modelId === descriptor.id &&
      typeof modelVersion === 'string' &&
      modelVersion === descriptor.version &&
      descriptor.expectedModelSha256 !== undefined &&
      modelSha256 === descriptor.expectedModelSha256 &&
      (descriptor.expectedModelBytes === undefined ||
        modelBytes === descriptor.expectedModelBytes));

  if (!sessionMatchesDescriptor || !checksumAttestationValid) {
    throw new AudioSeparationError(
      'INFERENCE_FAILED',
      'Session attestation does not match separation model descriptor.'
    );
  }

  return {
    executionProvider,
    ortVersion,
    modelBytes,
    modelSha256,
    modelChecksumVerified,
    runSegment,
    dispose,
  };
}

/**
 * Separate stereo 44.1 kHz audio into 6 canonical stems (`vocals`, `drums`,
 * `bass`, `guitar`, `piano`, `other`) using an ONNX inference session and
 * trapezoidal overlap-add stitching.
 */
export async function separateStereoAudio(
  audio: Pick<StereoFloat32Audio, 'sampleRate' | 'totalFrames' | 'left' | 'right'>,
  options: SeparateStereoAudioOptions
): Promise<SeparationResult> {
  const totalStartMs = nowMs();
  const descriptor = snapshotModelDescriptor(
    options.descriptor ?? HTDEMUCS_6S_ONNX_DESCRIPTOR
  );
  checkAborted(options.signal);

  const maxFrames =
    options.maxFrames ?? descriptor.sampleRate * DEFAULT_MAX_AUDIO_SECONDS;
  if (!Number.isSafeInteger(maxFrames) || maxFrames <= 0) {
    throw new AudioSeparationError(
      'INVALID_AUDIO',
      `Invalid maxFrames cap: ${formatDiagValue(maxFrames)}.`
    );
  }
  if (
    !Number.isInteger(audio.totalFrames) ||
    audio.totalFrames <= 0 ||
    audio.totalFrames > maxFrames ||
    audio.left.length !== audio.totalFrames ||
    audio.right.length !== audio.totalFrames
  ) {
    throw new AudioSeparationError(
      'INVALID_AUDIO',
      `Audio left/right Float32Arrays must match integer totalFrames in [1, ${maxFrames}].`
    );
  }
  if (audio.sampleRate !== descriptor.sampleRate) {
    throw new AudioSeparationError(
      'SAMPLE_RATE_MISMATCH',
      `Model ${descriptor.id} requires ${descriptor.sampleRate} Hz audio, got ${formatDiagValue(audio.sampleRate)} Hz.`
    );
  }
  for (let i = 0; i < audio.totalFrames; i++) {
    const l = audio.left[i];
    const r = audio.right[i];
    if (!Number.isFinite(l) || !Number.isFinite(r)) {
      throw new AudioSeparationError(
        'NON_FINITE_AUDIO',
        `Non-finite sample in input audio at frame ${i}.`
      );
    }
    if (Math.abs(l) > 1 || Math.abs(r) > 1) {
      throw new AudioSeparationError(
        'INVALID_AUDIO',
        `Input audio sample out of normalized [-1, 1] range at frame ${i}.`
      );
    }
  }

  const segmentSamples = descriptor.segmentSamples;
  const overlapSamples =
    options.overlapSamples ??
    Math.floor(segmentSamples * descriptor.defaultOverlapRatio);
  const window = createOverlapWindow(segmentSamples, overlapSamples);
  const stride = segmentSamples - overlapSamples;
  const totalFrames = audio.totalFrames;
  const totalChunks =
    totalFrames <= segmentSamples
      ? 1
      : Math.ceil((totalFrames - segmentSamples) / stride) + 1;

  // Allocate working buffers before acquiring an owned ONNX session so OOM fails before session creation.
  const stemAccumulators = new Map<
    CanonicalStemId,
    { left: Float32Array; right: Float32Array }
  >();
  for (const stemId of descriptor.canonicalStemOrder) {
    stemAccumulators.set(stemId, {
      left: new Float32Array(totalFrames),
      right: new Float32Array(totalFrames),
    });
  }
  const weightSum = new Float32Array(totalFrames);
  const sumLeft = new Float64Array(totalFrames);
  const sumRight = new Float64Array(totalFrames);
  const mixChunk = new Float32Array(2 * segmentSamples);
  const stemCount = descriptor.rawOutputStemOrder.length;
  const expectedSegmentOutputLen = stemCount * 2 * segmentSamples;

  let session = options.session ?? null;
  let ownedSession = false;
  let modelLoadMs = 0;
  let inferenceMs = 0;

  try {
    if (!session) {
      if (!options.createSession) {
        throw new AudioSeparationError(
          'MODEL_LOAD_FAILED',
          'Either an active session or createSession factory must be provided.'
        );
      }
      options.onProgress?.({
        phase: 'loading_model',
        chunkIndex: 0,
        totalChunks,
        fraction: 0,
        elapsedMs: nowMs() - totalStartMs,
      });
      const created = await options.createSession(descriptor);
      session = created.session;
      modelLoadMs = created.modelLoadMs ?? 0;
      ownedSession = true;
      checkAborted(options.signal);
    }

    const preAttestation = validateSessionAttestation(session, descriptor);

    for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
      checkAborted(options.signal);
      const start = chunkIdx * stride;
      const end = Math.min(start + segmentSamples, totalFrames);
      const copyLen = end - start;

      mixChunk.fill(0);
      mixChunk.set(audio.left.subarray(start, end), 0);
      mixChunk.set(audio.right.subarray(start, end), segmentSamples);

      const chunkInferStart = nowMs();
      const rawOutput = await reflectApply(preAttestation.runSegment, session, [
        mixChunk,
        segmentSamples,
        descriptor,
      ]);
      inferenceMs += Math.max(0, nowMs() - chunkInferStart);
      checkAborted(options.signal);

      if (rawOutput.length !== expectedSegmentOutputLen) {
        throw new AudioSeparationError(
          'INVALID_OUTPUT_TENSOR',
          `Model output length ${rawOutput.length} !== expected ${expectedSegmentOutputLen}.`
        );
      }
      for (let idx = 0; idx < expectedSegmentOutputLen; idx++) {
        if (!Number.isFinite(rawOutput[idx])) {
          throw new AudioSeparationError(
            'NON_FINITE_OUTPUT',
            `Model emitted non-finite tensor value at chunk ${chunkIdx}, index ${idx}.`
          );
        }
      }

      for (let rawStemIdx = 0; rawStemIdx < stemCount; rawStemIdx++) {
        const stemId = descriptor.rawOutputStemOrder[rawStemIdx];
        const acc = stemAccumulators.get(stemId)!;
        const leftBase = rawStemIdx * 2 * segmentSamples;
        const rightBase = (rawStemIdx * 2 + 1) * segmentSamples;

        for (let t = 0; t < copyLen; t++) {
          const sl = rawOutput[leftBase + t];
          const sr = rawOutput[rightBase + t];
          const w = window[t];
          acc.left[start + t] += sl * w;
          acc.right[start + t] += sr * w;
        }
      }

      for (let t = 0; t < copyLen; t++) {
        weightSum[start + t] += window[t];
      }

      options.onProgress?.({
        phase: 'separating',
        chunkIndex: chunkIdx + 1,
        totalChunks,
        fraction: (chunkIdx + 1) / totalChunks,
        elapsedMs: nowMs() - totalStartMs,
      });

      if (options.yieldBetweenChunks !== false && chunkIdx + 1 < totalChunks) {
        await yieldToEventLoop();
      }
    }

    const encodeStartMs = nowMs();
    options.onProgress?.({
      phase: 'encoding',
      chunkIndex: totalChunks,
      totalChunks,
      fraction: 1,
      elapsedMs: encodeStartMs - totalStartMs,
    });

    const stemsRecord = {} as Record<CanonicalStemId, SeparatedStemOutput>;
    const orderedStems: SeparatedStemOutput[] = [];

    for (const stemId of descriptor.canonicalStemOrder) {
      checkAborted(options.signal);
      const acc = stemAccumulators.get(stemId)!;
      let sumSquares = 0;
      let peak = 0;

      for (let t = 0; t < totalFrames; t++) {
        const w = weightSum[t];
        const l = acc.left[t] / w;
        const r = acc.right[t] / w;
        if (!Number.isFinite(l) || !Number.isFinite(r)) {
          throw new AudioSeparationError(
            'NON_FINITE_OUTPUT',
            `Normalized stem "${stemId}" produced non-finite sample at frame ${t}.`
          );
        }
        acc.left[t] = l;
        acc.right[t] = r;
        sumLeft[t] += l;
        sumRight[t] += r;
        sumSquares += l * l + r * r;
        const absMax = Math.max(Math.abs(l), Math.abs(r));
        if (absMax > peak) {
          peak = absMax;
        }
      }

      const wavBytes = encodeStereoPcm16Wav({
        sampleRate: descriptor.sampleRate,
        left: acc.left,
        right: acc.right,
      });
      const sha256 = await computeSha256Hex(wavBytes);
      checkAborted(options.signal);

      const rms = Math.sqrt(sumSquares / (totalFrames * 2));
      if (!Number.isFinite(rms) || !Number.isFinite(peak)) {
        throw new AudioSeparationError(
          'NON_FINITE_OUTPUT',
          `Non-finite signal diagnostics computed for stem "${stemId}".`
        );
      }

      const stemOutput: SeparatedStemOutput = {
        id: stemId,
        labelPtBr: STEM_DISPLAY_LABELS_PT_BR[stemId],
        sampleRate: descriptor.sampleRate,
        channels: 2,
        totalFrames,
        left: acc.left,
        right: acc.right,
        wavBytes,
        byteLength: wavBytes.byteLength,
        sha256,
        rms,
        peak,
      };
      stemsRecord[stemId] = stemOutput;
      orderedStems.push(stemOutput);
    }

    let reconstructionMaxAbsError = 0;
    for (let t = 0; t < totalFrames; t++) {
      const errL = Math.abs(audio.left[t] - sumLeft[t]);
      const errR = Math.abs(audio.right[t] - sumRight[t]);
      const frameErr = Math.max(errL, errR);
      if (!Number.isFinite(frameErr)) {
        throw new AudioSeparationError(
          'NON_FINITE_OUTPUT',
          `Non-finite reconstruction error at frame ${t}.`
        );
      }
      if (frameErr > reconstructionMaxAbsError) {
        reconstructionMaxAbsError = frameErr;
      }
    }

    // Release owned session BEFORE final abort check and BEFORE emitting 'complete'.
    if (ownedSession && session) {
      const sessionToDispose = session;
      ownedSession = false;
      try {
        await reflectApply(preAttestation.dispose, sessionToDispose, []);
      } catch (disposeErr) {
        checkAborted(options.signal);
        throw disposeErr;
      }
    }
    checkAborted(options.signal);

    const totalEndMs = nowMs();
    const encodeMs = Math.max(0, totalEndMs - encodeStartMs);
    const totalWallMs = Math.max(0, totalEndMs - totalStartMs);
    const audioDurationSeconds = totalFrames / descriptor.sampleRate;
    const rtf =
      audioDurationSeconds > 0 ? inferenceMs / 1000 / audioDurationSeconds : 0;
    const jsHeapUsedBytes = readJsHeapUsedBytes();
    const postAttestation = validateSessionAttestation(session, descriptor);
    if (
      postAttestation.executionProvider !== preAttestation.executionProvider ||
      postAttestation.ortVersion !== preAttestation.ortVersion ||
      postAttestation.modelBytes !== preAttestation.modelBytes ||
      postAttestation.modelSha256 !== preAttestation.modelSha256 ||
      postAttestation.modelChecksumVerified !==
        preAttestation.modelChecksumVerified ||
      postAttestation.runSegment !== preAttestation.runSegment ||
      postAttestation.dispose !== preAttestation.dispose
    ) {
      throw new AudioSeparationError(
        'INFERENCE_FAILED',
        'Session attestation mutated during audio separation.'
      );
    }
    const attestation = postAttestation;

    if (
      !Number.isFinite(modelLoadMs) ||
      modelLoadMs < 0 ||
      !Number.isFinite(inferenceMs) ||
      inferenceMs < 0 ||
      !Number.isFinite(encodeMs) ||
      encodeMs < 0 ||
      !Number.isFinite(totalWallMs) ||
      totalWallMs < 0 ||
      !Number.isFinite(rtf) ||
      rtf < 0 ||
      !Number.isFinite(audioDurationSeconds) ||
      audioDurationSeconds <= 0 ||
      !Number.isFinite(reconstructionMaxAbsError) ||
      reconstructionMaxAbsError < 0 ||
      (jsHeapUsedBytes !== null &&
        (!Number.isFinite(jsHeapUsedBytes) || jsHeapUsedBytes < 0))
    ) {
      throw new AudioSeparationError(
        'INFERENCE_FAILED',
        'Non-finite or invalid telemetry value detected.'
      );
    }

    options.onProgress?.({
      phase: 'complete',
      chunkIndex: totalChunks,
      totalChunks,
      fraction: 1,
      elapsedMs: totalWallMs,
    });

    return {
      descriptor,
      stems: stemsRecord,
      orderedStems,
      telemetry: {
        modelId: descriptor.id,
        modelVersion: descriptor.version,
        executionProvider: attestation.executionProvider,
        ortVersion: attestation.ortVersion,
        modelBytes: attestation.modelBytes,
        modelSha256: attestation.modelSha256,
        modelChecksumVerified: attestation.modelChecksumVerified,
        sampleRate: descriptor.sampleRate,
        totalFrames,
        audioDurationSeconds,
        segmentSamples,
        overlapSamples,
        chunksProcessed: totalChunks,
        modelLoadMs,
        inferenceMs,
        encodeMs,
        totalWallMs,
        rtf,
        jsHeapUsedBytes,
        jsHeapSnapshotKind:
          jsHeapUsedBytes !== null ? 'point_in_time_post_encode' : 'unavailable',
        reconstructionMaxAbsError,
        inputSha256: options.inputSha256 ?? null,
      },
    };
  } finally {
    if (ownedSession && session) {
      try {
        await session.dispose();
      } catch (disposeErr) {
        if (!options.signal?.aborted) {
          throw disposeErr;
        }
      }
    }
    checkAborted(options.signal);
  }
}
