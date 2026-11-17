export const REHEARSAL_PACKAGE_FORMAT = 'louvaio-rehearsal' as const;
export const REHEARSAL_PACKAGE_FORMAT_VERSION = 1 as const;

export const LIMITS_V1 = {
  maxCompressedBytes: 2147483648,
  maxExtractedBytes: 4294967296,
  maxEntries: 32,
  maxManifestBytes: 262144,
  maxPathDepth: 3,
  maxCompressionRatio: 100,
  maxDurationSeconds: 1800,
  maxDurationFrames: 79380000,
  minFreeSpaceReserveBytes: 268435456,
  minFreeSpaceReserveRatio: 0.1,
  defaultMaxChunkBytes: 65536,
  defaultMaxMemoryBudgetBytes: 67108864,
} as const;

export const SUPPORTED_REQUIRED_FEATURES_V1 = [
  'stems-4',
  'timeline-v1',
  'alignment-v1',
  'practice-v1',
  'original-optional',
] as const;

export const REQUIRED_STEM_IDS_V1 = ['vocals', 'drums', 'bass', 'other'] as const;

export type RequiredStemId = (typeof REQUIRED_STEM_IDS_V1)[number];

const FORBIDDEN_AUTHORITY_KEYS = new Set([
  'ministryId',
  'groupId',
  'songId',
  'versionId',
  'userId',
  'accountId',
  'uid',
  'email',
  'authToken',
  'accessToken',
  'bearer',
  'role',
  'permissions',
]);

const NESTED_ARCHIVE_EXTENSIONS = ['.zip', '.tar', '.gz', '.7z', '.rar'] as const;

const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const ZIP_METHOD_AES = 99;

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const CD_HEADER_SIGNATURE = 0x02014b50;
const LFH_HEADER_SIGNATURE = 0x04034b50;

const HEAD_TAIL_CAPTURE_BYTES = 4096;
const DEFLATE_SLICE_BYTES = 4096;

export type RehearsalPackageStatus =
  | 'valid'
  | 'incomplete'
  | 'unsupported'
  | 'corrupted'
  | 'insufficientSpace'
  | 'conflict'
  | 'cancelled';

export type RehearsalPackagePublicationState = 'staged_validated' | 'rejected';

export type RehearsalPackageIdempotencyDisposition =
  | 'new_package'
  | 'idempotent_noop'
  | 'conflict_detected'
  | 'not_applicable';

export type RehearsalPackageErrorCode =
  | 'VALIDATION_CANCELLED'
  | 'EMPTY_ARCHIVE'
  | 'ARCHIVE_SIZE_LIMIT_EXCEEDED'
  | 'EXTRACTED_SIZE_LIMIT_EXCEEDED'
  | 'ENTRY_COUNT_LIMIT_EXCEEDED'
  | 'MANIFEST_SIZE_LIMIT_EXCEEDED'
  | 'INVALID_ZIP_ARCHIVE'
  | 'TRUNCATED_ARCHIVE'
  | 'ENCRYPTED_ENTRY_FORBIDDEN'
  | 'SPECIAL_FILE_OR_SYMLINK_FORBIDDEN'
  | 'PATH_TRAVERSAL_OR_UNSAFE_PATH'
  | 'PATH_DEPTH_EXCEEDED'
  | 'DUPLICATE_OR_COLLIDING_ENTRY'
  | 'NESTED_ARCHIVE_FORBIDDEN'
  | 'HEADER_MISMATCH'
  | 'OVERLAPPING_ZIP_ENTRIES'
  | 'MISSING_MANIFEST'
  | 'UNDECLARED_ZIP_ENTRY'
  | 'ZIP_BOMB_RATIO_EXCEEDED'
  | 'CRC_MISMATCH'
  | 'INVALID_MANIFEST_JSON'
  | 'FORBIDDEN_AUTHORITY_FIELD'
  | 'DURATION_LIMIT_EXCEEDED'
  | 'CORRUPTED_AUDIO_HEADER'
  | 'UNSUPPORTED_COMPRESSION_METHOD'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_FORMAT_VERSION'
  | 'UNSUPPORTED_REQUIRED_FEATURE'
  | 'UNSUPPORTED_CODEC'
  | 'MISSING_REQUIRED_STEM'
  | 'MISSING_ORIGINAL_ENTRY'
  | 'SHA256_MISMATCH'
  | 'TIMELINE_MISMATCH'
  | 'INSUFFICIENT_STORAGE_SPACE'
  | 'MEMORY_BUDGET_EXCEEDED'
  | 'PACKAGE_IDENTITY_CONFLICT';

export interface RandomAccessByteSource {
  readonly byteLength: number;
  readSlice(offset: number, length: number): Promise<Uint8Array>;
}

export type RehearsalPackageInput =
  | Blob
  | File
  | Uint8Array
  | ArrayBuffer
  | RandomAccessByteSource;

export interface ExistingPackageRecord {
  packageId: string;
  manifestSha256?: string;
  compositeSha256: string;
}

export interface ValidateRehearsalPackageOptions {
  signal?: AbortSignal;
  availableStorageBytes?: number;
  includeSourceCopy?: boolean;
  maxChunkBytes?: number;
  maxMemoryBudgetBytes?: number;
  existingPackages?: readonly ExistingPackageRecord[];
  onProgress?: (processedBytes: number, totalBytes: number) => void;
}

export interface RehearsalEntryWritableSink {
  write(chunk: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface ExtractValidatedRehearsalPackageOptions extends ValidateRehearsalPackageOptions {
  openTargetSink: (entry: VerifiedRehearsalEntry) => Promise<RehearsalEntryWritableSink>;
  onExtractProgress?: (extractedBytes: number, totalBytes: number) => void;
}

export interface RehearsalPackageIdentity {
  packageId: string;
  revision: number;
  manifestSha256: string;
  compositeSha256: string | null;
}

export interface RehearsalManifestSummary {
  packageId: string;
  revision: number;
  createdAt: string;
  displayName: string;
  format: string;
  formatVersion: number;
  requiredFeatures: string[];
  sampleRate: number;
  channels: number;
  totalFrames: number;
  durationSeconds: number;
  includesOriginal: boolean;
  stemIds: string[];
}

export interface RehearsalValidationBudget {
  compressedBytes: number;
  declaredExtractedBytes: number;
  actualExtractedBytes: number;
  entryCount: number;
  requiredFreeStorageBytes: number;
  availableStorageBytes: number | null;
  maxChunkBytes: number;
  maxMemoryBudgetBytes: number;
  peakWorkingMemoryBytes: number;
  maxObservedSingleReadBytes: number;
}

export interface VerifiedAudioInfo {
  container: string;
  codec: string;
  sampleRate: number;
  channels: number;
  bitsPerSample?: number;
  decodedFrames: number;
}

export interface VerifiedRehearsalEntry {
  role: 'manifest' | 'stem' | 'original';
  stemId?: RequiredStemId;
  path: string;
  compressionMethod: number;
  compressedBytes: number;
  uncompressedBytes: number;
  crc32: number;
  sha256: string;
  audioInfo?: VerifiedAudioInfo;
}

export interface RehearsalPackageValidationResult {
  format: typeof REHEARSAL_PACKAGE_FORMAT;
  formatVersion: typeof REHEARSAL_PACKAGE_FORMAT_VERSION;
  status: RehearsalPackageStatus;
  errorCode: RehearsalPackageErrorCode | null;
  errorMessage: string | null;
  readyForPublication: boolean;
  publicationState: RehearsalPackagePublicationState;
  songVersionBindingAuthorized: false;
  idempotencyDisposition: RehearsalPackageIdempotencyDisposition;
  packageIdentity: RehearsalPackageIdentity | null;
  manifestSummary: RehearsalManifestSummary | null;
  budget: RehearsalValidationBudget;
  verifiedEntries: VerifiedRehearsalEntry[];
}

class ValidationFailure extends Error {
  readonly status: Exclude<RehearsalPackageStatus, 'valid'>;
  readonly errorCode: RehearsalPackageErrorCode;

  constructor(
    status: Exclude<RehearsalPackageStatus, 'valid'>,
    errorCode: RehearsalPackageErrorCode,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.errorCode = errorCode;
  }
}

interface ParsedZipCdEntry {
  rawPath: string;
  canonicalPath: string;
  flags: number;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  diskNumberStart: number;
  externalAttrs: number;
  localHeaderOffset: number;
  fileNameLength: number;
  dataOffset: number;
  physicalEnd: number;
}

interface ParsedMediaDeclaration {
  role: 'stem' | 'original';
  stemId?: RequiredStemId;
  path: string;
  container: string;
  codec: string;
  bitsPerSample?: number;
  byteLength: number;
  sha256: string;
  sampleRate: number;
  channels: number;
  decodedFrames: number;
}

interface ParsedManifest {
  packageId: string;
  revision: number;
  createdAt: string;
  displayName: string;
  format: string;
  formatVersion: number;
  requiredFeatures: string[];
  sampleRate: number;
  channels: number;
  totalFrames: number;
  includesOriginal: boolean;
  stems: ParsedMediaDeclaration[];
  original: ParsedMediaDeclaration | null;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export class Crc32Hasher {
  private crc = 0xffffffff;

  update(chunk: Uint8Array): void {
    let c = this.crc;
    for (let i = 0; i < chunk.length; i++) {
      c = CRC32_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
    }
    this.crc = c;
  }

  digest(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class Sha256Hasher {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly w = new Uint32Array(64);
  private blockOffset = 0;
  private totalBytes = 0;
  private finalized = false;

  update(chunk: Uint8Array): void {
    if (this.finalized) {
      throw new Error('Sha256Hasher cannot update after digest');
    }
    this.totalBytes += chunk.length;
    let offset = 0;

    if (this.blockOffset > 0) {
      const needed = 64 - this.blockOffset;
      if (chunk.length < needed) {
        this.block.set(chunk, this.blockOffset);
        this.blockOffset += chunk.length;
        return;
      }
      this.block.set(chunk.subarray(0, needed), this.blockOffset);
      this.compress(this.block, 0);
      this.blockOffset = 0;
      offset = needed;
    }

    while (offset + 64 <= chunk.length) {
      this.compress(chunk, offset);
      offset += 64;
    }

    if (offset < chunk.length) {
      const rem = chunk.length - offset;
      this.block.set(chunk.subarray(offset), 0);
      this.blockOffset = rem;
    }
  }

  digestHex(): string {
    if (!this.finalized) {
      this.finalized = true;
      const totalBits = this.totalBytes * 8;
      const hiBits = Math.floor(totalBits / 0x100000000) >>> 0;
      const loBits = totalBits >>> 0;

      this.block[this.blockOffset++] = 0x80;
      if (this.blockOffset > 56) {
        this.block.fill(0, this.blockOffset, 64);
        this.compress(this.block, 0);
        this.blockOffset = 0;
      }
      this.block.fill(0, this.blockOffset, 56);

      const view = new DataView(this.block.buffer, this.block.byteOffset, 64);
      view.setUint32(56, hiBits, false);
      view.setUint32(60, loBits, false);
      this.compress(this.block, 0);
    }

    let hex = '';
    for (let i = 0; i < 8; i++) {
      hex += this.state[i].toString(16).padStart(8, '0');
    }
    return hex;
  }

  private compress(buf: Uint8Array, baseOffset: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const idx = baseOffset + i * 4;
      w[i] =
        ((buf[idx] << 24) | (buf[idx + 1] << 16) | (buf[idx + 2] << 8) | buf[idx + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 =
        ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^
        ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^
        (w[i - 15] >>> 3);
      const s1 =
        ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^
        ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^
        (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = this.state[0];
    let b = this.state[1];
    let c = this.state[2];
    let d = this.state[3];
    let e = this.state[4];
    let f = this.state[5];
    let g = this.state[6];
    let h = this.state[7];

    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    this.state[0] = (this.state[0] + a) >>> 0;
    this.state[1] = (this.state[1] + b) >>> 0;
    this.state[2] = (this.state[2] + c) >>> 0;
    this.state[3] = (this.state[3] + d) >>> 0;
    this.state[4] = (this.state[4] + e) >>> 0;
    this.state[5] = (this.state[5] + f) >>> 0;
    this.state[6] = (this.state[6] + g) >>> 0;
    this.state[7] = (this.state[7] + h) >>> 0;
  }
}

function toRandomAccessByteSource(input: RehearsalPackageInput): RandomAccessByteSource {
  if (input instanceof Uint8Array) {
    return {
      byteLength: input.byteLength,
      async readSlice(offset: number, length: number): Promise<Uint8Array> {
        const clampedStart = Math.max(0, Math.min(offset, input.byteLength));
        const clampedEnd = Math.max(clampedStart, Math.min(offset + length, input.byteLength));
        return input.subarray(clampedStart, clampedEnd);
      },
    };
  }
  if (input instanceof ArrayBuffer) {
    const view = new Uint8Array(input);
    return {
      byteLength: view.byteLength,
      async readSlice(offset: number, length: number): Promise<Uint8Array> {
        const clampedStart = Math.max(0, Math.min(offset, view.byteLength));
        const clampedEnd = Math.max(clampedStart, Math.min(offset + length, view.byteLength));
        return view.subarray(clampedStart, clampedEnd);
      },
    };
  }
  if (typeof Blob !== 'undefined' && input instanceof Blob) {
    return {
      byteLength: input.size,
      async readSlice(offset: number, length: number): Promise<Uint8Array> {
        const clampedStart = Math.max(0, Math.min(offset, input.size));
        const clampedEnd = Math.max(clampedStart, Math.min(offset + length, input.size));
        const sliced = input.slice(clampedStart, clampedEnd);
        if (typeof sliced.arrayBuffer === 'function') {
          const buffer = await sliced.arrayBuffer();
          return new Uint8Array(buffer);
        }
        const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (reader.result instanceof ArrayBuffer) {
              resolve(reader.result);
            } else {
              reject(new Error('FileReader did not produce an ArrayBuffer.'));
            }
          };
          reader.onerror = () => reject(reader.error ?? new Error('FileReader failed.'));
          reader.readAsArrayBuffer(sliced);
        });
        return new Uint8Array(buffer);
      },
    };
  }
  if (
    input &&
    typeof input === 'object' &&
    typeof (input as RandomAccessByteSource).byteLength === 'number' &&
    typeof (input as RandomAccessByteSource).readSlice === 'function'
  ) {
    return input as RandomAccessByteSource;
  }
  throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Invalid archive input source.');
}

class BudgetedByteSource {
  readonly byteLength: number;
  private readonly inner: RandomAccessByteSource;
  private readonly maxChunkBytes: number;
  private readonly maxMemoryBudgetBytes: number;
  private readonly signal?: AbortSignal;
  private currentWorkingBytes = 0;
  peakWorkingMemoryBytes = 0;
  maxObservedSingleReadBytes = 0;

  constructor(
    inner: RandomAccessByteSource,
    maxChunkBytes: number,
    maxMemoryBudgetBytes: number,
    signal?: AbortSignal,
  ) {
    this.inner = inner;
    this.byteLength = inner.byteLength;
    this.maxChunkBytes = maxChunkBytes;
    this.maxMemoryBudgetBytes = maxMemoryBudgetBytes;
    this.signal = signal;
  }

  checkAborted(): void {
    if (this.signal?.aborted) {
      throw new ValidationFailure('cancelled', 'VALIDATION_CANCELLED', 'Validation cancelled by caller.');
    }
  }

  allocateWorkingMemory(bytes: number): void {
    this.currentWorkingBytes += bytes;
    if (this.currentWorkingBytes > this.peakWorkingMemoryBytes) {
      this.peakWorkingMemoryBytes = this.currentWorkingBytes;
    }
    if (this.peakWorkingMemoryBytes > this.maxMemoryBudgetBytes) {
      throw new ValidationFailure(
        'insufficientSpace',
        'MEMORY_BUDGET_EXCEEDED',
        `Working memory budget exceeded (${this.peakWorkingMemoryBytes} > ${this.maxMemoryBudgetBytes}).`,
      );
    }
  }

  releaseWorkingMemory(bytes: number): void {
    this.currentWorkingBytes = Math.max(0, this.currentWorkingBytes - bytes);
  }

  async readSliceExact(
    offset: number,
    length: number,
  ): Promise<{ bytes: Uint8Array; release: () => void }> {
    this.checkAborted();
    if (offset < 0 || length < 0 || offset + length > this.byteLength) {
      throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', 'Archive read out of bounds.');
    }
    if (length === 0) {
      return { bytes: new Uint8Array(0), release: () => undefined };
    }
    if (length <= this.maxChunkBytes) {
      const bytes = await this.readSingleBounded(offset, length);
      return { bytes, release: () => undefined };
    }

    this.allocateWorkingMemory(length);
    const out = new Uint8Array(length);
    let pos = 0;
    try {
      while (pos < length) {
        const sliceLen = Math.min(this.maxChunkBytes, length - pos);
        const chunk = await this.readSingleBounded(offset + pos, sliceLen);
        out.set(chunk, pos);
        pos += sliceLen;
      }
      return {
        bytes: out,
        release: () => this.releaseWorkingMemory(length),
      };
    } catch (err) {
      this.releaseWorkingMemory(length);
      throw err;
    }
  }

  async readSingleBounded(offset: number, length: number): Promise<Uint8Array> {
    this.checkAborted();
    const boundedLen = Math.min(length, this.maxChunkBytes);
    if (offset < 0 || boundedLen < 0 || offset + boundedLen > this.byteLength) {
      throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', 'Archive slice out of bounds.');
    }
    this.allocateWorkingMemory(boundedLen);
    try {
      const chunk = await this.inner.readSlice(offset, boundedLen);
      this.checkAborted();
      if (chunk.byteLength > this.maxObservedSingleReadBytes) {
        this.maxObservedSingleReadBytes = chunk.byteLength;
      }
      if (chunk.byteLength !== boundedLen) {
        throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', 'Short read from byte source.');
      }
      return chunk;
    } finally {
      this.releaseWorkingMemory(boundedLen);
    }
  }
}

function makeView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function readUint64LE(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  if (hi > 0x1fffff) {
    return Number.MAX_SAFE_INTEGER;
  }
  return hi * 0x100000000 + lo;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  const end = Math.min(bytes.length, offset + length);
  for (let i = offset; i < end; i++) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function hasControlOrBidiChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
    if (
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

function isSpecialOrSymlinkEntry(rawPath: string, externalAttrs: number): boolean {
  if (rawPath.endsWith('/') || rawPath.endsWith('\\')) {
    return true;
  }
  if ((externalAttrs & 0x10) !== 0) {
    return true;
  }
  const posixType = (externalAttrs >>> 16) & 0o170000;
  return (
    posixType === 0o010000 || // S_IFIFO
    posixType === 0o020000 || // S_IFCHR
    posixType === 0o040000 || // S_IFDIR
    posixType === 0o060000 || // S_IFBLK
    posixType === 0o120000 || // S_IFLNK
    posixType === 0o140000 // S_IFSOCK
  );
}

function validateAndCanonicalizePath(rawPath: string): { canonicalPath: string; depth: number } {
  if (!rawPath || hasControlOrBidiChars(rawPath)) {
    throw new ValidationFailure('corrupted', 'PATH_TRAVERSAL_OR_UNSAFE_PATH', `Unsafe ZIP path: ${rawPath}`);
  }
  if (rawPath.includes('\\') || rawPath.includes(':') || rawPath.startsWith('/') || rawPath.includes('//')) {
    throw new ValidationFailure('corrupted', 'PATH_TRAVERSAL_OR_UNSAFE_PATH', `Unsafe ZIP path: ${rawPath}`);
  }
  const segments = rawPath.split('/');
  for (const segment of segments) {
    if (
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.trim() !== segment ||
      segment.endsWith('.')
    ) {
      throw new ValidationFailure('corrupted', 'PATH_TRAVERSAL_OR_UNSAFE_PATH', `Unsafe path segment in ${rawPath}`);
    }
  }
  if (segments.length > LIMITS_V1.maxPathDepth) {
    throw new ValidationFailure(
      'corrupted',
      'PATH_DEPTH_EXCEEDED',
      `Path depth ${segments.length} exceeds limit ${LIMITS_V1.maxPathDepth}: ${rawPath}`,
    );
  }
  const canonicalPath = rawPath.normalize('NFC').toLowerCase();
  return { canonicalPath, depth: segments.length };
}

function hasNestedArchiveExtension(canonicalPath: string): boolean {
  return NESTED_ARCHIVE_EXTENSIONS.some((ext) => canonicalPath.endsWith(ext));
}

function hasNestedArchiveMagic(firstBytes: Uint8Array): boolean {
  if (firstBytes.length >= 4) {
    if (
      firstBytes[0] === 0x50 &&
      firstBytes[1] === 0x4b &&
      ((firstBytes[2] === 0x03 && firstBytes[3] === 0x04) ||
        (firstBytes[2] === 0x05 && firstBytes[3] === 0x06))
    ) {
      return true;
    }
  }
  if (firstBytes.length >= 2 && firstBytes[0] === 0x1f && firstBytes[1] === 0x8b) {
    return true;
  }
  if (
    firstBytes.length >= 6 &&
    firstBytes[0] === 0x37 &&
    firstBytes[1] === 0x7a &&
    firstBytes[2] === 0xbc &&
    firstBytes[3] === 0xaf &&
    firstBytes[4] === 0x27 &&
    firstBytes[5] === 0x1c
  ) {
    return true;
  }
  return false;
}

interface EocdInfo {
  eocdOffset: number;
  cdOffset: number;
  cdSize: number;
  totalEntries: number;
  metadataStartOffset: number;
}

async function locateEocdAndCd(
  source: BudgetedByteSource,
  maxChunkBytes: number,
): Promise<EocdInfo> {
  if (source.byteLength < 22) {
    throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Archive smaller than minimum ZIP EOCD.');
  }

  const maxSearchWindow = Math.min(source.byteLength, 22 + 65535);
  let searchEnd = source.byteLength;
  let foundEocdOffset = -1;
  let foundEocdBytes: Uint8Array | null = null;

  while (searchEnd > source.byteLength - maxSearchWindow) {
    const windowStart = Math.max(source.byteLength - maxSearchWindow, searchEnd - maxChunkBytes);
    const windowLen = searchEnd - windowStart;
    const chunk = await source.readSingleBounded(windowStart, windowLen);
    const view = makeView(chunk);

    for (let rel = chunk.byteLength - 22; rel >= 0; rel--) {
      if (view.getUint32(rel, true) === EOCD_SIGNATURE) {
        const commentLen = view.getUint16(rel + 20, true);
        if (windowStart + rel + 22 + commentLen === source.byteLength) {
          foundEocdOffset = windowStart + rel;
          foundEocdBytes = chunk.subarray(rel, rel + 22);
          break;
        }
      }
    }
    if (foundEocdOffset >= 0) {
      break;
    }
    if (windowStart <= source.byteLength - maxSearchWindow) {
      break;
    }
    searchEnd = Math.min(source.byteLength, windowStart + 21);
  }

  if (foundEocdOffset < 0 || !foundEocdBytes) {
    throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'ZIP End of Central Directory not found.');
  }

  const eocdView = makeView(foundEocdBytes);
  const diskNumber = eocdView.getUint16(4, true);
  const cdStartDisk = eocdView.getUint16(6, true);
  const entriesOnDisk = eocdView.getUint16(8, true);
  let totalEntries = eocdView.getUint16(10, true);
  let cdSize = eocdView.getUint32(12, true);
  let cdOffset = eocdView.getUint32(16, true);

  if (diskNumber !== 0 || cdStartDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Multi-disk ZIP archives are not supported.');
  }

  let metadataStartOffset = foundEocdOffset;
  const needsZip64 =
    entriesOnDisk === 0xffff || totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;

  if (foundEocdOffset >= 20) {
    const locatorBytes = await source.readSingleBounded(foundEocdOffset - 20, 20);
    const locatorView = makeView(locatorBytes);
    if (locatorView.getUint32(0, true) === ZIP64_LOCATOR_SIGNATURE) {
      const zip64Disk = locatorView.getUint32(4, true);
      const zip64EocdOffset = readUint64LE(locatorView, 8);
      const totalDisks = locatorView.getUint32(16, true);
      if (zip64Disk !== 0 || totalDisks !== 1) {
        throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Multi-disk ZIP64 archives are not supported.');
      }
      if (zip64EocdOffset < 0 || zip64EocdOffset + 56 > foundEocdOffset - 20) {
        throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', 'ZIP64 EOCD offset out of bounds.');
      }
      const z64 = await source.readSingleBounded(zip64EocdOffset, 56);
      const z64View = makeView(z64);
      if (z64View.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
        throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Invalid ZIP64 EOCD signature.');
      }
      const z64Disk = z64View.getUint32(16, true);
      const z64CdDisk = z64View.getUint32(20, true);
      const z64EntriesDisk = readUint64LE(z64View, 24);
      const z64TotalEntries = readUint64LE(z64View, 32);
      const z64CdSize = readUint64LE(z64View, 40);
      const z64CdOffset = readUint64LE(z64View, 48);

      if (z64Disk !== 0 || z64CdDisk !== 0 || z64EntriesDisk !== z64TotalEntries) {
        throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Multi-disk ZIP64 records are forbidden.');
      }
      totalEntries = z64TotalEntries;
      cdSize = z64CdSize;
      cdOffset = z64CdOffset;
      metadataStartOffset = zip64EocdOffset;
    } else if (needsZip64) {
      throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'ZIP64 EOCD locator missing.');
    }
  } else if (needsZip64) {
    throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'ZIP64 EOCD locator out of bounds.');
  }

  if (totalEntries === 0) {
    throw new ValidationFailure('corrupted', 'EMPTY_ARCHIVE', 'ZIP archive contains zero entries.');
  }
  if (totalEntries > LIMITS_V1.maxEntries) {
    throw new ValidationFailure(
      'corrupted',
      'ENTRY_COUNT_LIMIT_EXCEEDED',
      `Entry count ${totalEntries} exceeds limit ${LIMITS_V1.maxEntries}.`,
    );
  }
  if (cdOffset < 0 || cdSize < 0 || cdOffset + cdSize > metadataStartOffset) {
    throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', 'Central Directory extends past archive bounds.');
  }

  return {
    eocdOffset: foundEocdOffset,
    cdOffset,
    cdSize,
    totalEntries,
    metadataStartOffset,
  };
}

function parseZip64ExtraField(
  extraBytes: Uint8Array,
  needUncompressed: boolean,
  needCompressed: boolean,
  needOffset: boolean,
  needDisk: boolean,
): { uncompressedSize?: number; compressedSize?: number; localHeaderOffset?: number; diskNumberStart?: number } {
  const view = makeView(extraBytes);
  let pos = 0;
  while (pos + 4 <= extraBytes.byteLength) {
    const tag = view.getUint16(pos, true);
    const size = view.getUint16(pos + 2, true);
    pos += 4;
    if (pos + size > extraBytes.byteLength) {
      break;
    }
    if (tag === 0x0001) {
      let inner = pos;
      const result: {
        uncompressedSize?: number;
        compressedSize?: number;
        localHeaderOffset?: number;
        diskNumberStart?: number;
      } = {};
      if (needUncompressed && inner + 8 <= pos + size) {
        result.uncompressedSize = readUint64LE(view, inner);
        inner += 8;
      }
      if (needCompressed && inner + 8 <= pos + size) {
        result.compressedSize = readUint64LE(view, inner);
        inner += 8;
      }
      if (needOffset && inner + 8 <= pos + size) {
        result.localHeaderOffset = readUint64LE(view, inner);
        inner += 8;
      }
      if (needDisk && inner + 4 <= pos + size) {
        result.diskNumberStart = view.getUint32(inner, true);
      }
      return result;
    }
    pos += size;
  }
  return {};
}

async function parseAndValidateCentralDirectory(
  source: BudgetedByteSource,
  eocd: EocdInfo,
): Promise<{ entries: ParsedZipCdEntry[]; declaredExtractedBytes: number }> {
  const cdHandle = await source.readSliceExact(eocd.cdOffset, eocd.cdSize);
  const cdBytes = cdHandle.bytes;
  try {
    const view = makeView(cdBytes);
    const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
    const entries: ParsedZipCdEntry[] = [];
    const seenCanonicalPaths = new Set<string>();
    let offset = 0;

    for (let i = 0; i < eocd.totalEntries; i++) {
      source.checkAborted();
      if (offset + 46 > cdBytes.byteLength) {
        throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', 'Central Directory entry truncated.');
      }
      if (view.getUint32(offset, true) !== CD_HEADER_SIGNATURE) {
        throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Invalid Central Directory entry signature.');
      }

      const flags = view.getUint16(offset + 8, true);
      const compressionMethod = view.getUint16(offset + 10, true);
      const crc32 = view.getUint32(offset + 16, true);
      let compressedSize = view.getUint32(offset + 20, true);
      let uncompressedSize = view.getUint32(offset + 24, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraFieldLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      let diskNumberStart = view.getUint16(offset + 34, true);
      const externalAttrs = view.getUint32(offset + 38, true);
      let localHeaderOffset = view.getUint32(offset + 42, true);

      const headerEnd = offset + 46 + fileNameLength + extraFieldLength + commentLength;
      if (headerEnd > cdBytes.byteLength) {
        throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', 'Central Directory entry fields truncated.');
      }

      const rawNameBytes = cdBytes.subarray(offset + 46, offset + 46 + fileNameLength);
      const extraBytes = cdBytes.subarray(
        offset + 46 + fileNameLength,
        offset + 46 + fileNameLength + extraFieldLength,
      );

      if (
        uncompressedSize === 0xffffffff ||
        compressedSize === 0xffffffff ||
        localHeaderOffset === 0xffffffff ||
        diskNumberStart === 0xffff
      ) {
        const z64 = parseZip64ExtraField(
          extraBytes,
          uncompressedSize === 0xffffffff,
          compressedSize === 0xffffffff,
          localHeaderOffset === 0xffffffff,
          diskNumberStart === 0xffff,
        );
        if (z64.uncompressedSize !== undefined) uncompressedSize = z64.uncompressedSize;
        if (z64.compressedSize !== undefined) compressedSize = z64.compressedSize;
        if (z64.localHeaderOffset !== undefined) localHeaderOffset = z64.localHeaderOffset;
        if (z64.diskNumberStart !== undefined) diskNumberStart = z64.diskNumberStart;
      }

      if (diskNumberStart !== 0) {
        throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Multi-disk entry start is forbidden.');
      }

      if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0 || compressionMethod === ZIP_METHOD_AES) {
        throw new ValidationFailure('corrupted', 'ENCRYPTED_ENTRY_FORBIDDEN', 'Encrypted ZIP entries are forbidden.');
      }

      let rawPath: string;
      try {
        rawPath = utf8Decoder.decode(rawNameBytes);
      } catch {
        throw new ValidationFailure(
          'corrupted',
          'PATH_TRAVERSAL_OR_UNSAFE_PATH',
          'Invalid UTF-8 encoding in ZIP entry path.',
        );
      }

      if (isSpecialOrSymlinkEntry(rawPath, externalAttrs)) {
        throw new ValidationFailure(
          'corrupted',
          'SPECIAL_FILE_OR_SYMLINK_FORBIDDEN',
          `Directory, symlink, or special file entry is forbidden: ${rawPath}`,
        );
      }

      const { canonicalPath } = validateAndCanonicalizePath(rawPath);

      if (seenCanonicalPaths.has(canonicalPath)) {
        throw new ValidationFailure(
          'corrupted',
          'DUPLICATE_OR_COLLIDING_ENTRY',
          `Duplicate or colliding ZIP entry path: ${rawPath}`,
        );
      }
      seenCanonicalPaths.add(canonicalPath);

      if (hasNestedArchiveExtension(canonicalPath)) {
        throw new ValidationFailure(
          'corrupted',
          'NESTED_ARCHIVE_FORBIDDEN',
          `Nested archive extension is forbidden: ${rawPath}`,
        );
      }

      entries.push({
        rawPath,
        canonicalPath,
        flags,
        compressionMethod,
        crc32,
        compressedSize,
        uncompressedSize,
        diskNumberStart,
        externalAttrs,
        localHeaderOffset,
        fileNameLength,
        dataOffset: 0,
        physicalEnd: 0,
      });

      offset = headerEnd;
    }

    if (offset !== cdBytes.byteLength) {
      throw new ValidationFailure('corrupted', 'INVALID_ZIP_ARCHIVE', 'Central Directory size mismatch.');
    }

    const manifestEntry = entries.find((entry) => entry.rawPath === 'manifest.json');
    if (!manifestEntry) {
      throw new ValidationFailure('corrupted', 'MISSING_MANIFEST', 'Missing required manifest.json at archive root.');
    }

    let declaredExtractedBytes = 0;
    for (const entry of entries) {
      if (entry.rawPath === 'manifest.json') {
        if (entry.compressionMethod !== ZIP_METHOD_STORE && entry.compressionMethod !== ZIP_METHOD_DEFLATE) {
          throw new ValidationFailure(
            'unsupported',
            'UNSUPPORTED_COMPRESSION_METHOD',
            `Unsupported compression method ${entry.compressionMethod} for manifest.json.`,
          );
        }
        if (entry.compressionMethod === ZIP_METHOD_DEFLATE) {
          if (
            (entry.compressedSize === 0 && entry.uncompressedSize > 0) ||
            entry.uncompressedSize > entry.compressedSize * LIMITS_V1.maxCompressionRatio
          ) {
            throw new ValidationFailure(
              'corrupted',
              'ZIP_BOMB_RATIO_EXCEEDED',
              'Manifest compression ratio exceeds 100:1.',
            );
          }
        } else if (entry.compressedSize !== entry.uncompressedSize) {
          throw new ValidationFailure(
            'corrupted',
            'HEADER_MISMATCH',
            'STORE manifest entry compressedSize differs from uncompressedSize.',
          );
        }
        if (entry.uncompressedSize > LIMITS_V1.maxManifestBytes) {
          throw new ValidationFailure(
            'corrupted',
            'MANIFEST_SIZE_LIMIT_EXCEEDED',
            `manifest.json size ${entry.uncompressedSize} exceeds ${LIMITS_V1.maxManifestBytes} bytes.`,
          );
        }
      } else {
        if (entry.compressionMethod !== ZIP_METHOD_STORE) {
          throw new ValidationFailure(
            'unsupported',
            'UNSUPPORTED_COMPRESSION_METHOD',
            `Media entry ${entry.rawPath} must use STORE (0), got ${entry.compressionMethod}.`,
          );
        }
        if (entry.compressedSize !== entry.uncompressedSize) {
          throw new ValidationFailure(
            'corrupted',
            'HEADER_MISMATCH',
            `STORE entry ${entry.rawPath} compressedSize differs from uncompressedSize.`,
          );
        }
      }

      declaredExtractedBytes += entry.uncompressedSize;
      if (declaredExtractedBytes > LIMITS_V1.maxExtractedBytes) {
        throw new ValidationFailure(
          'corrupted',
          'EXTRACTED_SIZE_LIMIT_EXCEEDED',
          `Total extracted bytes exceed ${LIMITS_V1.maxExtractedBytes}.`,
        );
      }
    }

    const byOffset = entries.slice().sort((a, b) => a.localHeaderOffset - b.localHeaderOffset);
    for (let i = 0; i < byOffset.length; i++) {
      const curr = byOffset[i];
      if (curr.localHeaderOffset < 0 || curr.localHeaderOffset + 30 > eocd.cdOffset) {
        throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', `LFH out of bounds for ${curr.rawPath}.`);
      }
      if (i > 0) {
        const prev = byOffset[i - 1];
        if (prev.localHeaderOffset === curr.localHeaderOffset) {
          throw new ValidationFailure(
            'corrupted',
            'OVERLAPPING_ZIP_ENTRIES',
            `Overlapping LFH offsets for ${prev.rawPath} and ${curr.rawPath}.`,
          );
        }
        const prevMinEnd = prev.localHeaderOffset + 30 + prev.fileNameLength + prev.compressedSize;
        if (prevMinEnd > curr.localHeaderOffset) {
          throw new ValidationFailure(
            'corrupted',
            'OVERLAPPING_ZIP_ENTRIES',
            `ZIP entry ${prev.rawPath} overlaps ${curr.rawPath}.`,
          );
        }
      }
    }

    for (const entry of byOffset) {
      source.checkAborted();
      const lfhFixed = await source.readSingleBounded(entry.localHeaderOffset, 30);
      const lfhView = makeView(lfhFixed);
      if (lfhView.getUint32(0, true) !== LFH_HEADER_SIGNATURE) {
        throw new ValidationFailure('corrupted', 'HEADER_MISMATCH', `Invalid LFH signature for ${entry.rawPath}.`);
      }
      const lfhFlags = lfhView.getUint16(6, true);
      const lfhMethod = lfhView.getUint16(8, true);
      const lfhCrc = lfhView.getUint32(14, true);
      let lfhCompSize = lfhView.getUint32(18, true);
      let lfhUncompSize = lfhView.getUint32(22, true);
      const lfhNameLen = lfhView.getUint16(26, true);
      const lfhExtraLen = lfhView.getUint16(28, true);

      const dataOffset = entry.localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
      const physicalEnd = dataOffset + entry.compressedSize;
      if (physicalEnd > eocd.cdOffset) {
        if (physicalEnd > source.byteLength) {
          throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', `Entry ${entry.rawPath} extends past EOF.`);
        }
        throw new ValidationFailure(
          'corrupted',
          'OVERLAPPING_ZIP_ENTRIES',
          `Entry ${entry.rawPath} overlaps Central Directory.`,
        );
      }

      if (lfhNameLen + lfhExtraLen > 0) {
        const lfhVarHandle = await source.readSliceExact(
          entry.localHeaderOffset + 30,
          lfhNameLen + lfhExtraLen,
        );
        try {
          const lfhName = utf8Decoder.decode(lfhVarHandle.bytes.subarray(0, lfhNameLen));
          if (lfhName !== entry.rawPath) {
            throw new ValidationFailure(
              'corrupted',
              'HEADER_MISMATCH',
              `LFH path ${lfhName} mismatches CD path ${entry.rawPath}.`,
            );
          }
          if (lfhCompSize === 0xffffffff || lfhUncompSize === 0xffffffff) {
            const z64 = parseZip64ExtraField(
              lfhVarHandle.bytes.subarray(lfhNameLen),
              lfhUncompSize === 0xffffffff,
              lfhCompSize === 0xffffffff,
              false,
              false,
            );
            if (z64.uncompressedSize !== undefined) lfhUncompSize = z64.uncompressedSize;
            if (z64.compressedSize !== undefined) lfhCompSize = z64.compressedSize;
          }
        } finally {
          lfhVarHandle.release();
        }
      }

      if (lfhFlags !== entry.flags || lfhMethod !== entry.compressionMethod) {
        throw new ValidationFailure('corrupted', 'HEADER_MISMATCH', `LFH flags/method mismatch for ${entry.rawPath}.`);
      }

      const usesDataDescriptor = (entry.flags & 0x08) !== 0;
      if (!usesDataDescriptor || lfhCrc !== 0 || lfhCompSize !== 0 || lfhUncompSize !== 0) {
        if (
          lfhCrc !== entry.crc32 ||
          lfhCompSize !== entry.compressedSize ||
          lfhUncompSize !== entry.uncompressedSize
        ) {
          throw new ValidationFailure(
            'corrupted',
            'HEADER_MISMATCH',
            `LFH CRC or size mismatch against CD for ${entry.rawPath}.`,
          );
        }
      }

      entry.dataOffset = dataOffset;
      entry.physicalEnd = physicalEnd;
    }

    for (let i = 1; i < byOffset.length; i++) {
      if (byOffset[i - 1].physicalEnd > byOffset[i].localHeaderOffset) {
        throw new ValidationFailure(
          'corrupted',
          'OVERLAPPING_ZIP_ENTRIES',
          `Overlapping entry ranges: ${byOffset[i - 1].rawPath} and ${byOffset[i].rawPath}.`,
        );
      }
    }

    return { entries, declaredExtractedBytes };
  } finally {
    cdHandle.release();
  }
}

class SinkIoError extends Error {
  readonly originalError: unknown;

  constructor(originalError: unknown) {
    super(originalError instanceof Error ? originalError.message : String(originalError));
    this.originalError = originalError;
  }
}

async function runSinkIo<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    throw new SinkIoError(err);
  }
}

async function streamDeflateEntry(
  source: BudgetedByteSource,
  entry: ParsedZipCdEntry,
  maxChunkBytes: number,
  onOutputChunk: (chunk: Uint8Array) => void | Promise<void>,
): Promise<void> {
  if (typeof DecompressionStream !== 'function') {
    throw new ValidationFailure(
      'unsupported',
      'UNSUPPORTED_COMPRESSION_METHOD',
      'Web DecompressionStream is unavailable in this environment.',
    );
  }
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  let failure: unknown = null;
  let aborted = false;

  const readerPromise = (async () => {
    try {
      while (!aborted) {
        source.checkAborted();
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          await onOutputChunk(value);
        }
      }
    } catch (err) {
      if (!aborted) {
        failure = err;
        aborted = true;
        await reader.cancel().catch(() => undefined);
        await writer.abort().catch(() => undefined);
      }
    }
  })();

  const writerPromise = (async () => {
    try {
      let pos = 0;
      const sliceSize = Math.min(DEFLATE_SLICE_BYTES, maxChunkBytes);
      while (pos < entry.compressedSize && !aborted) {
        source.checkAborted();
        const len = Math.min(sliceSize, entry.compressedSize - pos);
        const slice = await source.readSingleBounded(entry.dataOffset + pos, len);
        if (aborted) break;
        await writer.write(slice as unknown as BufferSource);
        pos += slice.byteLength;
      }
      if (!aborted) {
        await writer.close();
      }
    } catch (err) {
      if (!aborted) {
        failure = err;
        aborted = true;
        await reader.cancel().catch(() => undefined);
        await writer.abort().catch(() => undefined);
      }
    }
  })();

  await Promise.all([writerPromise, readerPromise]);
  if (failure) {
    if (failure instanceof SinkIoError || failure instanceof ValidationFailure) {
      throw failure;
    }
    throw new ValidationFailure(
      'corrupted',
      'INVALID_ZIP_ARCHIVE',
      `Corrupted DEFLATE stream in ${entry.rawPath}: ${failure instanceof Error ? failure.message : String(failure)}`,
    );
  }
}

async function streamAndVerifyManifest(
  source: BudgetedByteSource,
  entry: ParsedZipCdEntry,
  maxChunkBytes: number,
  onChunkBytes?: (delta: number) => void,
): Promise<{ bytes: Uint8Array; sha256: string; actualUncompressedBytes: number }> {
  const crc32 = new Crc32Hasher();
  const sha256 = new Sha256Hasher();
  let actualUncompressedBytes = 0;

  const chunks: Uint8Array[] = [];
  let allocatedManifestBytes = 0;
  let checkedFirstMagic = false;
  const firstMagicWindow = new Uint8Array(6);
  let firstMagicLen = 0;

  const appendOutputChunk = (chunk: Uint8Array): void => {
    if (chunk.byteLength === 0) return;

    if (!checkedFirstMagic) {
      const copyCount = Math.min(6 - firstMagicLen, chunk.byteLength);
      firstMagicWindow.set(chunk.subarray(0, copyCount), firstMagicLen);
      firstMagicLen += copyCount;
      if (firstMagicLen >= 2 && hasNestedArchiveMagic(firstMagicWindow.subarray(0, firstMagicLen))) {
        throw new ValidationFailure(
          'corrupted',
          'NESTED_ARCHIVE_FORBIDDEN',
          'Nested archive magic bytes detected in manifest.json.',
        );
      }
      if (firstMagicLen === 6) {
        checkedFirstMagic = true;
      }
    }

    actualUncompressedBytes += chunk.byteLength;

    if (entry.compressionMethod === ZIP_METHOD_DEFLATE) {
      const maxAllowedByRatio = entry.compressedSize * LIMITS_V1.maxCompressionRatio;
      if (actualUncompressedBytes > maxAllowedByRatio) {
        throw new ValidationFailure(
          'corrupted',
          'ZIP_BOMB_RATIO_EXCEEDED',
          `DEFLATE manifest stream exceeded 100:1 ratio (${actualUncompressedBytes} > ${maxAllowedByRatio}).`,
        );
      }
    }

    if (actualUncompressedBytes > LIMITS_V1.maxManifestBytes) {
      throw new ValidationFailure(
        'corrupted',
        'MANIFEST_SIZE_LIMIT_EXCEEDED',
        `manifest.json exceeded ${LIMITS_V1.maxManifestBytes} bytes.`,
      );
    }

    source.allocateWorkingMemory(chunk.byteLength);
    allocatedManifestBytes += chunk.byteLength;
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(chunk);
    chunks.push(copy);
    crc32.update(copy);
    sha256.update(copy);
    onChunkBytes?.(copy.byteLength);
  };

  try {
    if (entry.compressionMethod === ZIP_METHOD_STORE) {
      let pos = 0;
      while (pos < entry.compressedSize) {
        source.checkAborted();
        const sliceLen = Math.min(maxChunkBytes, entry.compressedSize - pos);
        const chunk = await source.readSingleBounded(entry.dataOffset + pos, sliceLen);
        appendOutputChunk(chunk);
        pos += chunk.byteLength;
      }
    } else {
      await streamDeflateEntry(source, entry, maxChunkBytes, appendOutputChunk);
    }

    if (actualUncompressedBytes !== entry.uncompressedSize) {
      throw new ValidationFailure(
        'corrupted',
        'HEADER_MISMATCH',
        `manifest.json decompressed byte count ${actualUncompressedBytes} differs from header ${entry.uncompressedSize}.`,
      );
    }

    if (crc32.digest() !== entry.crc32) {
      throw new ValidationFailure('corrupted', 'CRC_MISMATCH', 'manifest.json CRC-32 mismatch.');
    }

    source.allocateWorkingMemory(actualUncompressedBytes);
    allocatedManifestBytes += actualUncompressedBytes;
    const assembled = new Uint8Array(actualUncompressedBytes);
    let writePos = 0;
    for (const part of chunks) {
      assembled.set(part, writePos);
      writePos += part.byteLength;
    }
    chunks.length = 0;

    return {
      bytes: assembled,
      sha256: sha256.digestHex(),
      actualUncompressedBytes,
    };
  } finally {
    if (allocatedManifestBytes > 0) {
      source.releaseWorkingMemory(allocatedManifestBytes);
    }
  }
}

function findForbiddenAuthorityKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findForbiddenAuthorityKey(item);
      if (found) return found;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_AUTHORITY_KEYS.has(key)) {
        return key;
      }
      const found = findForbiddenAuthorityKey(nested);
      if (found) return found;
    }
  }
  return null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{64}$/.test(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
  );
}

function isIso8601WithTimezone(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isSupportedMediaCombo(container: string, codec: string, isOriginal: boolean): boolean {
  if (container === 'wav' && (codec === 'pcm_s16le' || codec === 'pcm_s24le')) {
    return true;
  }
  if (container === 'flac' && codec === 'flac') {
    return true;
  }
  if (container === 'ogg' && codec === 'opus') {
    return true;
  }
  if (container === 'm4a' && (codec === 'aac' || codec === 'aac_lc' || codec === 'aac-lc' || codec === 'mp4a')) {
    return true;
  }
  if (isOriginal && container === 'mp3' && codec === 'mp3') {
    return true;
  }
  return false;
}

function parseMediaEntryDecl(
  raw: unknown,
  role: 'stem' | 'original',
  stemId?: RequiredStemId,
): ParsedMediaDeclaration {
  if (!isPlainRecord(raw)) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Invalid ${role} object.`);
  }
  if (typeof raw.path !== 'string') {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Missing ${role}.path.`);
  }
  validateAndCanonicalizePath(raw.path);

  if (typeof raw.container !== 'string' || typeof raw.codec !== 'string') {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Missing container/codec on ${role}.`);
  }
  const container = raw.container.toLowerCase();
  const codec = raw.codec.toLowerCase();

  if (role === 'stem' && (codec === 'mp3' || container === 'mp3')) {
    throw new ValidationFailure('unsupported', 'UNSUPPORTED_CODEC', 'MP3 codec is forbidden for stems.');
  }
  if (!isSupportedMediaCombo(container, codec, role === 'original')) {
    throw new ValidationFailure(
      'unsupported',
      'UNSUPPORTED_CODEC',
      `Unsupported ${role} container/codec: ${container}/${codec}.`,
    );
  }

  if (
    typeof raw.byteLength !== 'number' ||
    !Number.isInteger(raw.byteLength) ||
    raw.byteLength <= 0 ||
    !isHex64(raw.sha256)
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Invalid byteLength/sha256 on ${role}.`);
  }

  if (
    typeof raw.sampleRate !== 'number' ||
    !Number.isInteger(raw.sampleRate) ||
    typeof raw.channels !== 'number' ||
    !Number.isInteger(raw.channels)
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Invalid sampleRate/channels on ${role}.`);
  }

  const validChannels = role === 'original' ? raw.channels === 1 || raw.channels === 2 : raw.channels === 2;
  if (raw.sampleRate !== 44100 || !validChannels) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `${role} sampleRate/channels invalid: ${raw.sampleRate}/${raw.channels}.`,
    );
  }

  if (typeof raw.decodedFrames !== 'number' || !Number.isInteger(raw.decodedFrames) || raw.decodedFrames <= 0) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Invalid decodedFrames on ${role}.`);
  }
  if (raw.decodedFrames > LIMITS_V1.maxDurationFrames) {
    throw new ValidationFailure(
      'corrupted',
      'DURATION_LIMIT_EXCEEDED',
      `${role} duration ${raw.decodedFrames} frames exceeds limit ${LIMITS_V1.maxDurationFrames}.`,
    );
  }

  let bitsPerSample: number | undefined;
  if (raw.bitsPerSample !== undefined && raw.bitsPerSample !== null) {
    if (typeof raw.bitsPerSample !== 'number' || !Number.isInteger(raw.bitsPerSample)) {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Invalid bitsPerSample on ${role}.`);
    }
    bitsPerSample = raw.bitsPerSample;
  }

  return {
    role,
    stemId,
    path: raw.path,
    container,
    codec,
    bitsPerSample,
    byteLength: raw.byteLength,
    sha256: raw.sha256.toLowerCase(),
    sampleRate: raw.sampleRate,
    channels: raw.channels,
    decodedFrames: raw.decodedFrames,
  };
}

function parseAndValidateManifest(manifestBytes: Uint8Array): ParsedManifest {
  if (
    manifestBytes.length >= 3 &&
    manifestBytes[0] === 0xef &&
    manifestBytes[1] === 0xbb &&
    manifestBytes[2] === 0xbf
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'UTF-8 BOM is forbidden in manifest.json.');
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  } catch {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'manifest.json is not valid UTF-8.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'manifest.json is not valid JSON.');
  }

  if (!isPlainRecord(raw)) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'manifest.json root must be a JSON object.');
  }

  const forbiddenKey = findForbiddenAuthorityKey(raw);
  if (forbiddenKey) {
    throw new ValidationFailure(
      'corrupted',
      'FORBIDDEN_AUTHORITY_FIELD',
      `Forbidden authority field "${forbiddenKey}" found in manifest.json.`,
    );
  }

  if (typeof raw.format !== 'string') {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'format must be a string.');
  }
  if (raw.format !== REHEARSAL_PACKAGE_FORMAT) {
    throw new ValidationFailure(
      'unsupported',
      'UNSUPPORTED_FORMAT',
      `Unsupported package format: ${String(raw.format)}.`,
    );
  }

  if (typeof raw.formatVersion !== 'number' || !Number.isInteger(raw.formatVersion) || raw.formatVersion < 1) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'formatVersion must be an integer >= 1.');
  }
  if (raw.formatVersion !== REHEARSAL_PACKAGE_FORMAT_VERSION) {
    throw new ValidationFailure(
      'unsupported',
      'UNSUPPORTED_FORMAT_VERSION',
      `Unsupported formatVersion: ${String(raw.formatVersion)}.`,
    );
  }

  if (!Array.isArray(raw.requiredFeatures)) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'requiredFeatures must be an array.');
  }
  const allowedFeatures = new Set<string>(SUPPORTED_REQUIRED_FEATURES_V1);
  const requiredFeatures: string[] = [];
  for (const feature of raw.requiredFeatures) {
    if (typeof feature !== 'string') {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'requiredFeatures entries must be strings.');
    }
    if (!allowedFeatures.has(feature)) {
      throw new ValidationFailure(
        'unsupported',
        'UNSUPPORTED_REQUIRED_FEATURE',
        `Unsupported required feature: ${feature}.`,
      );
    }
    requiredFeatures.push(feature);
  }

  if (!isUuid(raw.packageId)) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'packageId must be a valid UUID.');
  }
  const packageId = raw.packageId.toLowerCase();

  if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 1) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'revision must be an integer >= 1.');
  }

  if (!isIso8601WithTimezone(raw.createdAt)) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'createdAt must be ISO-8601 with timezone.');
  }

  if (
    typeof raw.displayName !== 'string' ||
    raw.displayName.trim().length < 1 ||
    raw.displayName.length > 200 ||
    hasControlOrBidiChars(raw.displayName)
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid displayName.');
  }

  if (
    !isPlainRecord(raw.source) ||
    !isHex64(raw.source.sha256) ||
    typeof raw.source.sanitizedFileName !== 'string' ||
    raw.source.sanitizedFileName.trim().length === 0 ||
    raw.source.sanitizedFileName.includes('/') ||
    raw.source.sanitizedFileName.includes('\\') ||
    raw.source.sanitizedFileName.includes(':') ||
    raw.source.sanitizedFileName.includes('..') ||
    typeof raw.source.durationFrames !== 'number' ||
    !Number.isInteger(raw.source.durationFrames) ||
    raw.source.durationFrames < 1 ||
    typeof raw.source.usageRightEvidence !== 'string' ||
    raw.source.usageRightEvidence.trim().length === 0
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid source metadata.');
  }

  if (
    !isPlainRecord(raw.provenance) ||
    typeof raw.provenance.toolName !== 'string' ||
    raw.provenance.toolName.trim().length === 0 ||
    typeof raw.provenance.toolVersion !== 'string' ||
    raw.provenance.toolVersion.trim().length === 0 ||
    typeof raw.provenance.modelName !== 'string' ||
    raw.provenance.modelName.trim().length === 0 ||
    typeof raw.provenance.checkpointId !== 'string' ||
    raw.provenance.checkpointId.trim().length === 0 ||
    !isHex64(raw.provenance.checkpointSha256) ||
    !isPlainRecord(raw.provenance.parameters) ||
    !Array.isArray(raw.provenance.licenseReferences) ||
    raw.provenance.licenseReferences.length === 0 ||
    raw.provenance.licenseReferences.some((ref) => typeof ref !== 'string' || ref.trim().length === 0)
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid provenance metadata.');
  }

  if (
    !isPlainRecord(raw.rights) ||
    typeof raw.rights.declaration !== 'string' ||
    raw.rights.declaration.trim().length === 0 ||
    (raw.rights.scope !== 'personal-local' && raw.rights.scope !== 'rehearsal-local') ||
    typeof raw.rights.exportAllowed !== 'boolean' ||
    !Array.isArray(raw.rights.attributions) ||
    raw.rights.isLegalProof !== false ||
    raw.rights.isDrm !== false
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid rights metadata.');
  }

  if (!isPlainRecord(raw.timeline)) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Missing timeline object.');
  }
  const { sampleRate, totalFrames, channels, timeOriginFrame } = raw.timeline;
  if (
    typeof sampleRate !== 'number' ||
    !Number.isInteger(sampleRate) ||
    typeof totalFrames !== 'number' ||
    !Number.isInteger(totalFrames) ||
    totalFrames < 1 ||
    typeof channels !== 'number' ||
    !Number.isInteger(channels) ||
    typeof timeOriginFrame !== 'number' ||
    !Number.isInteger(timeOriginFrame)
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid timeline numeric fields.');
  }

  if (totalFrames > LIMITS_V1.maxDurationFrames) {
    throw new ValidationFailure(
      'corrupted',
      'DURATION_LIMIT_EXCEEDED',
      `Duration ${totalFrames} frames exceeds max ${LIMITS_V1.maxDurationFrames}.`,
    );
  }

  if (sampleRate !== 44100 || channels !== 2 || timeOriginFrame !== 0) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `Timeline must be 44100 Hz / 2 ch / origin 0, got ${sampleRate}/${channels}/${timeOriginFrame}.`,
    );
  }

  if (raw.practice !== undefined && raw.practice !== null) {
    if (!isPlainRecord(raw.practice)) {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'practice must be an object.');
    }
    const { bpm, timeSignature, firstBeatOffsetFrames, loopAFrame, loopBFrame } = raw.practice;
    if (
      bpm !== undefined &&
      bpm !== null &&
      (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 20 || bpm > 300)
    ) {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid practice.bpm.');
    }
    if (timeSignature !== undefined && timeSignature !== null) {
      if (
        !isPlainRecord(timeSignature) ||
        typeof timeSignature.numerator !== 'number' ||
        !Number.isInteger(timeSignature.numerator) ||
        timeSignature.numerator < 1 ||
        timeSignature.numerator > 32 ||
        typeof timeSignature.denominator !== 'number' ||
        ![2, 4, 8, 16].includes(timeSignature.denominator)
      ) {
        throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid practice.timeSignature.');
      }
    }
    if (
      firstBeatOffsetFrames !== undefined &&
      firstBeatOffsetFrames !== null &&
      (typeof firstBeatOffsetFrames !== 'number' ||
        !Number.isInteger(firstBeatOffsetFrames) ||
        firstBeatOffsetFrames < 0 ||
        firstBeatOffsetFrames >= totalFrames)
    ) {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid practice.firstBeatOffsetFrames.');
    }
    const hasA = loopAFrame !== undefined && loopAFrame !== null;
    const hasB = loopBFrame !== undefined && loopBFrame !== null;
    if (hasA !== hasB) {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Both loopAFrame and loopBFrame are required.');
    }
    if (hasA && hasB) {
      if (
        typeof loopAFrame !== 'number' ||
        !Number.isInteger(loopAFrame) ||
        typeof loopBFrame !== 'number' ||
        !Number.isInteger(loopBFrame) ||
        loopAFrame < 0 ||
        loopBFrame > totalFrames ||
        loopBFrame - loopAFrame < 4410
      ) {
        throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid practice loop range.');
      }
    }
  }

  if (!Array.isArray(raw.stems)) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'stems must be an array.');
  }

  const stemMap = new Map<RequiredStemId, ParsedMediaDeclaration>();
  const requiredSet = new Set<string>(REQUIRED_STEM_IDS_V1);

  for (const item of raw.stems) {
    if (!isPlainRecord(item) || typeof item.id !== 'string') {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid stem entry.');
    }
    if (!requiredSet.has(item.id)) {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Unexpected stem id: ${item.id}.`);
    }
    const stemId = item.id as RequiredStemId;
    if (stemMap.has(stemId)) {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Duplicate stem id: ${stemId}.`);
    }
    stemMap.set(stemId, parseMediaEntryDecl(item, 'stem', stemId));
  }

  for (const reqId of REQUIRED_STEM_IDS_V1) {
    if (!stemMap.has(reqId)) {
      throw new ValidationFailure('incomplete', 'MISSING_REQUIRED_STEM', `Missing required stem: ${reqId}.`);
    }
  }

  if (!isPlainRecord(raw.alignment)) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Missing alignment object.');
  }
  if (raw.alignment.method !== 'explicit-trim' || raw.alignment.timeOriginFrame !== 0) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `Alignment method must be explicit-trim with origin 0, got ${String(raw.alignment.method)}.`,
    );
  }
  const initialTrim = raw.alignment.initialTrimFrames;
  const trailingTrim = raw.alignment.trailingTrimFrames;
  if (
    typeof initialTrim !== 'number' ||
    !Number.isInteger(initialTrim) ||
    initialTrim < 0 ||
    typeof trailingTrim !== 'number' ||
    !Number.isInteger(trailingTrim) ||
    trailingTrim < 0
  ) {
    throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid alignment trim frames.');
  }

  const perStemTrim = isPlainRecord(raw.alignment.perStem) ? raw.alignment.perStem : null;
  const stems: ParsedMediaDeclaration[] = [];
  for (const reqId of REQUIRED_STEM_IDS_V1) {
    const stem = stemMap.get(reqId)!;
    let stemInit = initialTrim;
    let stemTrail = trailingTrim;
    if (perStemTrim && perStemTrim[reqId] !== undefined) {
      if (!isPlainRecord(perStemTrim[reqId])) {
        throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', `Invalid perStem alignment for ${reqId}.`);
      }
      const override = perStemTrim[reqId] as Record<string, unknown>;
      if (override.initialTrimFrames !== undefined) {
        if (
          typeof override.initialTrimFrames !== 'number' ||
          !Number.isInteger(override.initialTrimFrames) ||
          override.initialTrimFrames < 0
        ) {
          throw new ValidationFailure(
            'incomplete',
            'TIMELINE_MISMATCH',
            `Invalid initialTrimFrames for ${reqId}.`,
          );
        }
        stemInit = override.initialTrimFrames;
      }
      if (override.trailingTrimFrames !== undefined) {
        if (
          typeof override.trailingTrimFrames !== 'number' ||
          !Number.isInteger(override.trailingTrimFrames) ||
          override.trailingTrimFrames < 0
        ) {
          throw new ValidationFailure(
            'incomplete',
            'TIMELINE_MISMATCH',
            `Invalid trailingTrimFrames for ${reqId}.`,
          );
        }
        stemTrail = override.trailingTrimFrames;
      }
    }
    if (stem.decodedFrames - stemInit - stemTrail !== totalFrames) {
      throw new ValidationFailure(
        'incomplete',
        'TIMELINE_MISMATCH',
        `Stem ${reqId} trimmed frames (${stem.decodedFrames} - ${stemInit} - ${stemTrail}) !== timeline.totalFrames (${totalFrames}).`,
      );
    }
    stems.push(stem);
  }

  let original: ParsedMediaDeclaration | null = null;
  let includesOriginal = false;
  if (raw.original !== undefined && raw.original !== null) {
    if (!isPlainRecord(raw.original) || typeof raw.original.included !== 'boolean') {
      throw new ValidationFailure('corrupted', 'INVALID_MANIFEST_JSON', 'Invalid original descriptor.');
    }
    if (raw.original.included) {
      includesOriginal = true;
      original = parseMediaEntryDecl(raw.original, 'original');
    }
  }

  return {
    packageId,
    revision: raw.revision,
    createdAt: raw.createdAt,
    displayName: raw.displayName,
    format: raw.format,
    formatVersion: raw.formatVersion,
    requiredFeatures,
    sampleRate,
    channels,
    totalFrames,
    includesOriginal,
    stems,
    original,
  };
}

function inspectWavBinary(head: Uint8Array, totalBytes: number, decl: ParsedMediaDeclaration): VerifiedAudioInfo {
  if (head.length < 44 || readAscii(head, 0, 4) !== 'RIFF' || readAscii(head, 8, 4) !== 'WAVE') {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid RIFF/WAVE header in ${decl.path}.`);
  }

  const view = makeView(head);
  const riffSize = view.getUint32(4, true);
  if (riffSize + 8 > totalBytes || riffSize < 36) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid RIFF chunk size in ${decl.path}.`);
  }

  let pos = 12;
  let fmtFound = false;
  let dataFound = false;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let blockAlign = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (pos + 8 <= head.length) {
    const chunkId = readAscii(head, pos, 4);
    const chunkSize = view.getUint32(pos + 4, true);
    const payloadPos = pos + 8;

    if (chunkId === 'fmt ') {
      if (chunkSize < 16 || payloadPos + 16 > head.length) {
        throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Truncated fmt chunk in ${decl.path}.`);
      }
      const audioFormat = view.getUint16(payloadPos, true);
      channels = view.getUint16(payloadPos + 2, true);
      sampleRate = view.getUint32(payloadPos + 4, true);
      blockAlign = view.getUint16(payloadPos + 12, true);
      bitsPerSample = view.getUint16(payloadPos + 14, true);

      if (audioFormat === 0xfffe) {
        if (chunkSize < 40 || payloadPos + 40 > head.length) {
          throw new ValidationFailure(
            'corrupted',
            'CORRUPTED_AUDIO_HEADER',
            `Truncated extensible WAV fmt chunk in ${decl.path}.`,
          );
        }
        const subFormat = view.getUint32(payloadPos + 24, true);
        if (subFormat !== 1) {
          throw new ValidationFailure(
            'unsupported',
            'UNSUPPORTED_CODEC',
            `Unsupported extensible WAV subformat in ${decl.path}.`,
          );
        }
      } else if (audioFormat !== 1) {
        throw new ValidationFailure(
          'unsupported',
          'UNSUPPORTED_CODEC',
          `Unsupported WAV audioFormat=${audioFormat} in ${decl.path}.`,
        );
      }
      if (bitsPerSample !== 16 && bitsPerSample !== 24) {
        throw new ValidationFailure(
          'unsupported',
          'UNSUPPORTED_CODEC',
          `Unsupported WAV bitsPerSample ${bitsPerSample} in ${decl.path}.`,
        );
      }
      const expectedBits = decl.codec === 'pcm_s24le' ? 24 : 16;
      if (bitsPerSample !== expectedBits) {
        throw new ValidationFailure(
          'corrupted',
          'CORRUPTED_AUDIO_HEADER',
          `WAV bit depth ${bitsPerSample} disagrees with codec ${decl.codec} in ${decl.path}.`,
        );
      }
      if (blockAlign !== channels * (bitsPerSample / 8)) {
        throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid WAV blockAlign in ${decl.path}.`);
      }
      fmtFound = true;
    } else if (chunkId === 'data') {
      dataOffset = payloadPos;
      dataSize = chunkSize;
      dataFound = true;
      break;
    }

    const step = 8 + chunkSize + (chunkSize & 1);
    if (step <= 8) break;
    pos += step;
  }

  if (!fmtFound || !dataFound || dataOffset + dataSize > totalBytes) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Missing/truncated fmt or data in ${decl.path}.`);
  }

  const frames = Math.floor(dataSize / blockAlign);
  if (
    sampleRate !== decl.sampleRate ||
    channels !== decl.channels ||
    dataSize % blockAlign !== 0 ||
    frames !== decl.decodedFrames
  ) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `WAV timeline mismatch in ${decl.path}: ${sampleRate}Hz/${channels}ch/${frames}f.`,
    );
  }

  if (decl.bitsPerSample !== undefined && decl.bitsPerSample !== bitsPerSample) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `WAV bit depth mismatch in ${decl.path}.`);
  }

  return {
    container: 'wav',
    codec: bitsPerSample === 24 ? 'pcm_s24le' : 'pcm_s16le',
    sampleRate,
    channels,
    bitsPerSample,
    decodedFrames: frames,
  };
}

function inspectFlacBinary(head: Uint8Array, totalBytes: number, decl: ParsedMediaDeclaration): VerifiedAudioInfo {
  if (totalBytes <= 42 || head.length < 42 || readAscii(head, 0, 4) !== 'fLaC') {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid fLaC header in ${decl.path}.`);
  }

  const blockType = head[4] & 0x7f;
  const blockLen = (head[5] << 16) | (head[6] << 8) | head[7];
  if (blockType !== 0 || blockLen !== 34) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid FLAC STREAMINFO block in ${decl.path}.`);
  }

  const minBlockSize = (head[8] << 8) | head[9];
  const maxBlockSize = (head[10] << 8) | head[11];
  if (minBlockSize < 16 || maxBlockSize < minBlockSize) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid FLAC block sizes in ${decl.path}.`);
  }

  const b18 = head[18];
  const b19 = head[19];
  const b20 = head[20];
  const b21 = head[21];
  const b22 = head[22];
  const b23 = head[23];
  const b24 = head[24];
  const b25 = head[25];

  const sampleRate = (b18 << 12) | (b19 << 4) | (b20 >>> 4);
  const channels = ((b20 >>> 1) & 0x07) + 1;
  const bitsPerSample = (((b20 & 0x01) << 4) | (b21 >>> 4)) + 1;
  const totalSamples =
    (b21 & 0x0f) * 0x100000000 + (((b22 << 24) | (b23 << 16) | (b24 << 8) | b25) >>> 0);

  if (bitsPerSample !== 16 && bitsPerSample !== 24) {
    throw new ValidationFailure(
      'unsupported',
      'UNSUPPORTED_CODEC',
      `Unsupported FLAC bit depth ${bitsPerSample} in ${decl.path}.`,
    );
  }
  if (decl.bitsPerSample !== undefined && decl.bitsPerSample !== bitsPerSample) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `FLAC bit depth mismatch in ${decl.path}.`);
  }

  if (sampleRate !== decl.sampleRate || channels !== decl.channels || totalSamples !== decl.decodedFrames) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `FLAC STREAMINFO mismatch in ${decl.path}: ${sampleRate}Hz/${channels}ch/${totalSamples}f.`,
    );
  }

  return {
    container: 'flac',
    codec: 'flac',
    sampleRate,
    channels,
    bitsPerSample,
    decodedFrames: totalSamples,
  };
}

function inspectOggOpusBinary(
  head: Uint8Array,
  tail: Uint8Array,
  decl: ParsedMediaDeclaration,
): VerifiedAudioInfo {
  if (head.length < 48 || readAscii(head, 0, 4) !== 'OggS' || head[4] !== 0 || (head[5] & 0x02) === 0) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid Ogg BOS header in ${decl.path}.`);
  }

  const page0Segs = head[26];
  const page0TableStart = 27;
  const page0PayloadStart = page0TableStart + page0Segs;
  if (page0PayloadStart + 19 > head.length) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Truncated OpusHead page in ${decl.path}.`);
  }

  let page0PayloadLen = 0;
  for (let i = 0; i < page0Segs; i++) {
    page0PayloadLen += head[page0TableStart + i];
  }

  if (readAscii(head, page0PayloadStart, 8) !== 'OpusHead' || head[page0PayloadStart + 8] !== 1) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid OpusHead packet in ${decl.path}.`);
  }

  const channels = head[page0PayloadStart + 9];
  const view = makeView(head);
  const preSkip = view.getUint16(page0PayloadStart + 10, true);
  const inputSampleRate = view.getUint32(page0PayloadStart + 12, true);

  if (channels !== decl.channels) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `Opus channel count mismatch in ${decl.path}: ${channels} !== ${decl.channels}.`,
    );
  }
  if (inputSampleRate !== 0 && inputSampleRate !== decl.sampleRate && inputSampleRate !== 48000) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `Opus inputSampleRate mismatch in ${decl.path}: ${inputSampleRate}.`,
    );
  }

  const page1Offset = page0PayloadStart + page0PayloadLen;
  if (page1Offset + 27 > head.length || readAscii(head, page1Offset, 4) !== 'OggS' || head[page1Offset + 4] !== 0) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Missing OpusTags page in ${decl.path}.`);
  }
  const page1Segs = head[page1Offset + 26];
  const page1PayloadStart = page1Offset + 27 + page1Segs;
  if (page1PayloadStart + 8 > head.length || readAscii(head, page1PayloadStart, 8) !== 'OpusTags') {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid OpusTags packet in ${decl.path}.`);
  }

  let eosGranule = -1;
  const tailView = makeView(tail);
  for (let i = tail.length - 27; i >= 0; i--) {
    if (
      tail[i] === 0x4f &&
      tail[i + 1] === 0x67 &&
      tail[i + 2] === 0x67 &&
      tail[i + 3] === 0x53 &&
      tail[i + 4] === 0 &&
      (tail[i + 5] & 0x04) !== 0
    ) {
      const segs = tail[i + 26];
      if (i + 27 + segs <= tail.length) {
        let pagePayload = 0;
        for (let j = 0; j < segs; j++) {
          pagePayload += tail[i + 27 + j];
        }
        if (i + 27 + segs + pagePayload <= tail.length) {
          const gHi = tailView.getUint32(i + 10, true);
          if ((gHi & 0x80000000) !== 0) {
            eosGranule = -1;
          } else {
            eosGranule = readUint64LE(tailView, i + 6);
          }
          break;
        }
      }
    }
  }

  if (eosGranule < preSkip) {
    throw new ValidationFailure(
      'corrupted',
      'CORRUPTED_AUDIO_HEADER',
      `Missing or invalid Ogg EOS granulePosition in ${decl.path}.`,
    );
  }

  const netSamples48k = eosGranule - preSkip;
  const expected48k = Math.round((decl.decodedFrames * 48000) / decl.sampleRate);
  if (Math.abs(netSamples48k - expected48k) > 960) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `Opus EOS granule frames (${netSamples48k}) mismatch expected 48k frames (${expected48k}).`,
    );
  }

  return {
    container: 'ogg',
    codec: 'opus',
    sampleRate: decl.sampleRate,
    channels,
    decodedFrames: decl.decodedFrames,
  };
}

function readUint64BE(view: DataView, offset: number): number {
  const hi = view.getUint32(offset, false);
  const lo = view.getUint32(offset + 4, false);
  if (hi > 0x1fffff) {
    return Number.MAX_SAFE_INTEGER;
  }
  return hi * 0x100000000 + lo;
}

function findIsoBox(
  buf: Uint8Array,
  start: number,
  end: number,
  targetType: string,
): { offset: number; contentStart: number; end: number } | null {
  const view = makeView(buf);
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos, false);
    const type = readAscii(buf, pos + 4, 4);
    let hdrLen = 8;
    if (size === 1) {
      if (pos + 16 > end) return null;
      size = readUint64BE(view, pos + 8);
      hdrLen = 16;
    }
    if (size < hdrLen || pos + size > end) {
      return null;
    }
    if (type === targetType) {
      return { offset: pos, contentStart: pos + hdrLen, end: pos + size };
    }
    pos += size;
  }
  return null;
}

function inspectM4aBinary(
  head: Uint8Array,
  tail: Uint8Array,
  decl: ParsedMediaDeclaration,
): VerifiedAudioInfo {
  if (head.length < 24 || readAscii(head, 4, 4) !== 'ftyp') {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid M4A ftyp box in ${decl.path}.`);
  }

  let moov = findIsoBox(head, 0, head.length, 'moov');
  let moovBuf = head;
  if (!moov) {
    const tailView = makeView(tail);
    for (let i = 0; i + 8 <= tail.length; i++) {
      if (readAscii(tail, i + 4, 4) === 'moov') {
        const moovSize = tailView.getUint32(i, false);
        if (moovSize >= 8 && i + moovSize <= tail.length) {
          moov = { offset: i, contentStart: i + 8, end: i + moovSize };
          moovBuf = tail;
          break;
        }
      }
    }
  }
  if (!moov) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Missing M4A moov box in ${decl.path}.`);
  }

  const trak = findIsoBox(moovBuf, moov.contentStart, moov.end, 'trak');
  const mdia = trak ? findIsoBox(moovBuf, trak.contentStart, trak.end, 'mdia') : null;
  const mdhd = mdia ? findIsoBox(moovBuf, mdia.contentStart, mdia.end, 'mdhd') : null;
  const minf = mdia ? findIsoBox(moovBuf, mdia.contentStart, mdia.end, 'minf') : null;
  const stbl = minf ? findIsoBox(moovBuf, minf.contentStart, minf.end, 'stbl') : null;
  const stsd = stbl ? findIsoBox(moovBuf, stbl.contentStart, stbl.end, 'stsd') : null;

  if (!mdhd || !stsd || stsd.contentStart + 8 >= stsd.end) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Missing mdhd/stsd in M4A ${decl.path}.`);
  }

  const mp4a = findIsoBox(moovBuf, stsd.contentStart + 8, stsd.end, 'mp4a');
  if (!mp4a || mp4a.contentStart + 28 > mp4a.end) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Missing mp4a entry in M4A ${decl.path}.`);
  }

  const view = makeView(moovBuf);
  const mdhdVersion = moovBuf[mdhd.contentStart];
  let timescale = 0;
  let duration = 0;
  if (mdhdVersion === 0 && mdhd.contentStart + 20 <= mdhd.end) {
    timescale = view.getUint32(mdhd.contentStart + 12, false);
    duration = view.getUint32(mdhd.contentStart + 16, false);
  } else if (mdhdVersion === 1 && mdhd.contentStart + 32 <= mdhd.end) {
    timescale = view.getUint32(mdhd.contentStart + 20, false);
    duration = readUint64BE(view, mdhd.contentStart + 24);
  } else {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Truncated mdhd box in M4A ${decl.path}.`);
  }

  if (timescale === 0) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Zero mdhd timescale in M4A ${decl.path}.`);
  }

  const mp4aChannels = view.getUint16(mp4a.contentStart + 16, false);
  const mp4aSampleRate = view.getUint32(mp4a.contentStart + 24, false) >>> 16;
  const estimatedFrames = Math.round((duration * decl.sampleRate) / timescale);
  const frameTolerance = Math.ceil(decl.sampleRate * 0.05);

  if (
    mp4aSampleRate !== decl.sampleRate ||
    mp4aChannels !== decl.channels ||
    Math.abs(estimatedFrames - decl.decodedFrames) > frameTolerance
  ) {
    throw new ValidationFailure(
      'incomplete',
      'TIMELINE_MISMATCH',
      `M4A timeline mismatch in ${decl.path}: ${timescale}Hz/${mp4aChannels}ch/${estimatedFrames}f.`,
    );
  }

  return {
    container: 'm4a',
    codec: decl.codec,
    sampleRate: mp4aSampleRate,
    channels: mp4aChannels,
    decodedFrames: decl.decodedFrames,
  };
}

function inspectMp3Binary(head: Uint8Array, decl: ParsedMediaDeclaration): VerifiedAudioInfo {
  if (head.length < 4) {
    throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `MP3 too small in ${decl.path}.`);
  }

  let scanStart = 0;
  if (readAscii(head, 0, 3) === 'ID3') {
    if (head.length < 10 || head[3] === 0xff || head[4] === 0xff) {
      throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `Invalid ID3v2 header in ${decl.path}.`);
    }
    const id3Size =
      ((head[6] & 0x7f) << 21) | ((head[7] & 0x7f) << 14) | ((head[8] & 0x7f) << 7) | (head[9] & 0x7f);
    const hasFooter = (head[5] & 0x10) !== 0;
    scanStart = 10 + id3Size + (hasFooter ? 10 : 0);
  }

  const mpeg1Rates = [44100, 48000, 32000];
  const mpeg2Rates = [22050, 24000, 16000];
  const mpeg25Rates = [11025, 12000, 8000];

  for (let i = scanStart; i + 4 <= head.length; i++) {
    const b0 = head[i];
    const b1 = head[i + 1];
    const b2 = head[i + 2];
    const b3 = head[i + 3];
    if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) continue;

    const versionBits = (b1 >>> 3) & 0x03;
    const layerBits = (b1 >>> 1) & 0x03;
    const bitrateIdx = (b2 >>> 4) & 0x0f;
    const srIdx = (b2 >>> 2) & 0x03;
    const channelMode = (b3 >>> 6) & 0x03;

    if (versionBits === 1 || layerBits !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) {
      continue;
    }

    const sampleRate =
      versionBits === 3 ? mpeg1Rates[srIdx] : versionBits === 2 ? mpeg2Rates[srIdx] : mpeg25Rates[srIdx];
    const channels = channelMode === 3 ? 1 : 2;

    if (sampleRate !== decl.sampleRate || channels !== decl.channels) {
      throw new ValidationFailure(
        'incomplete',
        'TIMELINE_MISMATCH',
        `MP3 header mismatch in ${decl.path}: ${sampleRate}Hz/${channels}ch.`,
      );
    }

    return {
      container: 'mp3',
      codec: 'mp3',
      sampleRate,
      channels,
      decodedFrames: decl.decodedFrames,
    };
  }

  throw new ValidationFailure('corrupted', 'CORRUPTED_AUDIO_HEADER', `No valid MPEG Layer III frame in ${decl.path}.`);
}

function inspectAudioBinary(
  head: Uint8Array,
  tail: Uint8Array,
  totalBytes: number,
  decl: ParsedMediaDeclaration,
): VerifiedAudioInfo {
  switch (decl.container) {
    case 'wav':
      return inspectWavBinary(head, totalBytes, decl);
    case 'flac':
      return inspectFlacBinary(head, totalBytes, decl);
    case 'ogg':
      return inspectOggOpusBinary(head, tail, decl);
    case 'm4a':
      return inspectM4aBinary(head, tail, decl);
    case 'mp3':
      if (decl.role !== 'original') {
        throw new ValidationFailure('unsupported', 'UNSUPPORTED_CODEC', 'MP3 is only allowed for original entry.');
      }
      return inspectMp3Binary(head, decl);
    default:
      throw new ValidationFailure(
        'unsupported',
        'UNSUPPORTED_CODEC',
        `Unsupported container ${decl.container} for ${decl.path}.`,
      );
  }
}

async function streamAndVerifyMediaEntry(
  source: BudgetedByteSource,
  zipEntry: ParsedZipCdEntry,
  decl: ParsedMediaDeclaration,
  maxChunkBytes: number,
  getTotalExtractedSoFar: () => number,
  onChunkBytes: (delta: number) => void,
): Promise<VerifiedRehearsalEntry> {
  if (zipEntry.uncompressedSize !== decl.byteLength) {
    throw new ValidationFailure(
      'corrupted',
      'HEADER_MISMATCH',
      `Manifest byteLength ${decl.byteLength} !== ZIP uncompressedSize ${zipEntry.uncompressedSize} for ${decl.path}.`,
    );
  }
  const crc32 = new Crc32Hasher();
  const sha256 = new Sha256Hasher();
  const head = new Uint8Array(Math.min(HEAD_TAIL_CAPTURE_BYTES, zipEntry.compressedSize));
  let headFilled = 0;

  const tailBuf = new Uint8Array(HEAD_TAIL_CAPTURE_BYTES);
  let tailWritePos = 0;
  let tailTotal = 0;

  let actualBytesRead = 0;
  let checkedFirstMagic = false;
  const firstMagicWindow = new Uint8Array(6);
  let firstMagicLen = 0;

  source.allocateWorkingMemory(head.byteLength + tailBuf.byteLength);
  try {
    let pos = 0;
    while (pos < zipEntry.compressedSize) {
      source.checkAborted();
      const sliceLen = Math.min(maxChunkBytes, zipEntry.compressedSize - pos);
      const chunk = await source.readSingleBounded(zipEntry.dataOffset + pos, sliceLen);

      if (!checkedFirstMagic) {
        const copyCount = Math.min(6 - firstMagicLen, chunk.byteLength);
        firstMagicWindow.set(chunk.subarray(0, copyCount), firstMagicLen);
        firstMagicLen += copyCount;
        if (firstMagicLen >= 2 && hasNestedArchiveMagic(firstMagicWindow.subarray(0, firstMagicLen))) {
          throw new ValidationFailure(
            'corrupted',
            'NESTED_ARCHIVE_FORBIDDEN',
            `Nested archive magic bytes detected inside ${decl.path}.`,
          );
        }
        if (firstMagicLen === 6) {
          checkedFirstMagic = true;
        }
      }

      if (headFilled < head.byteLength) {
        const take = Math.min(head.byteLength - headFilled, chunk.byteLength);
        head.set(chunk.subarray(0, take), headFilled);
        headFilled += take;
      }

      if (chunk.byteLength >= HEAD_TAIL_CAPTURE_BYTES) {
        tailBuf.set(chunk.subarray(chunk.byteLength - HEAD_TAIL_CAPTURE_BYTES), 0);
        tailWritePos = 0;
        tailTotal += chunk.byteLength;
      } else {
        const firstPart = Math.min(chunk.byteLength, HEAD_TAIL_CAPTURE_BYTES - tailWritePos);
        tailBuf.set(chunk.subarray(0, firstPart), tailWritePos);
        const rem = chunk.byteLength - firstPart;
        if (rem > 0) {
          tailBuf.set(chunk.subarray(firstPart), 0);
        }
        tailWritePos = (tailWritePos + chunk.byteLength) % HEAD_TAIL_CAPTURE_BYTES;
        tailTotal += chunk.byteLength;
      }

      crc32.update(chunk);
      sha256.update(chunk);

      actualBytesRead += chunk.byteLength;
      pos += chunk.byteLength;
      onChunkBytes(chunk.byteLength);

      if (getTotalExtractedSoFar() > LIMITS_V1.maxExtractedBytes) {
        throw new ValidationFailure(
          'corrupted',
          'EXTRACTED_SIZE_LIMIT_EXCEEDED',
          `Total extracted bytes exceed ${LIMITS_V1.maxExtractedBytes}.`,
        );
      }
    }

    if (actualBytesRead !== zipEntry.uncompressedSize) {
      throw new ValidationFailure('corrupted', 'TRUNCATED_ARCHIVE', `Entry ${decl.path} truncated.`);
    }

    const actualCrc = crc32.digest();
    if (actualCrc !== zipEntry.crc32) {
      throw new ValidationFailure('corrupted', 'CRC_MISMATCH', `CRC-32 mismatch for ${decl.path}.`);
    }

    const actualSha256 = sha256.digestHex();
    if (actualSha256 !== decl.sha256) {
      throw new ValidationFailure('incomplete', 'SHA256_MISMATCH', `SHA-256 mismatch for ${decl.path}.`);
    }

    if (actualBytesRead !== decl.byteLength) {
      throw new ValidationFailure(
        'corrupted',
        'HEADER_MISMATCH',
        `Declared byteLength ${decl.byteLength} !== actual ${actualBytesRead} for ${decl.path}.`,
      );
    }

    let orderedTail: Uint8Array;
    if (tailTotal <= HEAD_TAIL_CAPTURE_BYTES) {
      orderedTail = tailBuf.subarray(0, tailTotal);
    } else {
      orderedTail = new Uint8Array(HEAD_TAIL_CAPTURE_BYTES);
      const rightLen = HEAD_TAIL_CAPTURE_BYTES - tailWritePos;
      orderedTail.set(tailBuf.subarray(tailWritePos), 0);
      orderedTail.set(tailBuf.subarray(0, tailWritePos), rightLen);
    }

    const audioInfo = inspectAudioBinary(head.subarray(0, headFilled), orderedTail, actualBytesRead, decl);

    return {
      role: decl.role,
      stemId: decl.stemId,
      path: decl.path,
      compressionMethod: zipEntry.compressionMethod,
      compressedBytes: zipEntry.compressedSize,
      uncompressedBytes: actualBytesRead,
      crc32: actualCrc,
      sha256: actualSha256,
      audioInfo,
    };
  } finally {
    source.releaseWorkingMemory(head.byteLength + tailBuf.byteLength);
  }
}

function computeRequiredStorageBytes(
  compressedBytes: number,
  extractedBytes: number,
  includeSourceCopy: boolean,
): number {
  const stagingPeak = (includeSourceCopy ? compressedBytes : 0) + extractedBytes;
  const reserve = Math.max(
    LIMITS_V1.minFreeSpaceReserveBytes,
    Math.ceil(stagingPeak * LIMITS_V1.minFreeSpaceReserveRatio),
  );
  return stagingPeak + reserve;
}

function computeCompositeSha256(
  manifestSha256: string,
  verifiedEntries: readonly VerifiedRehearsalEntry[],
): string {
  const encoder = new TextEncoder();
  const hasher = new Sha256Hasher();
  hasher.update(encoder.encode(`${manifestSha256}\n`));

  const mediaEntries = verifiedEntries
    .filter((entry) => entry.role !== 'manifest')
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const entry of mediaEntries) {
    hasher.update(
      encoder.encode(`${entry.role}:${entry.path}:${entry.sha256}:${entry.uncompressedBytes}\n`),
    );
  }

  return hasher.digestHex();
}

function resolveBudgetOptions(options: ValidateRehearsalPackageOptions): {
  maxChunkBytes: number;
  maxMemoryBudgetBytes: number;
} {
  const requestedChunkBytes =
    typeof options.maxChunkBytes === 'number' && Number.isFinite(options.maxChunkBytes)
      ? Math.floor(options.maxChunkBytes)
      : LIMITS_V1.defaultMaxChunkBytes;
  const maxChunkBytes = Math.min(
    Math.max(1024, requestedChunkBytes),
    LIMITS_V1.defaultMaxChunkBytes,
  );
  const maxMemoryBudgetBytes =
    typeof options.maxMemoryBudgetBytes === 'number' && Number.isFinite(options.maxMemoryBudgetBytes)
      ? Math.floor(options.maxMemoryBudgetBytes)
      : LIMITS_V1.defaultMaxMemoryBudgetBytes;
  return { maxChunkBytes, maxMemoryBudgetBytes };
}

export async function validateRehearsalPackage(
  input: RehearsalPackageInput,
  options: ValidateRehearsalPackageOptions = {},
): Promise<RehearsalPackageValidationResult> {
  const { maxChunkBytes, maxMemoryBudgetBytes } = resolveBudgetOptions(options);
  const includeSourceCopy = options.includeSourceCopy ?? false;
  const availableStorageBytes =
    options.availableStorageBytes !== undefined ? options.availableStorageBytes : null;

  const verifiedEntries: VerifiedRehearsalEntry[] = [];
  let compressedBytes = 0;
  let declaredExtractedBytes = 0;
  let actualExtractedBytes = 0;
  let entryCount = 0;
  let requiredFreeStorageBytes = computeRequiredStorageBytes(0, 0, includeSourceCopy);
  let packageIdentity: RehearsalPackageIdentity | null = null;
  let manifestSummary: RehearsalManifestSummary | null = null;
  let budgetedSource: BudgetedByteSource | null = null;

  const buildResult = (
    status: RehearsalPackageStatus,
    errorCode: RehearsalPackageErrorCode | null,
    errorMessage: string | null,
    idempotencyDisposition: RehearsalPackageIdempotencyDisposition,
  ): RehearsalPackageValidationResult => {
    const isValid = status === 'valid';
    const effectiveStorageExtracted = Math.max(declaredExtractedBytes, actualExtractedBytes);
    const computedRequiredStorage = computeRequiredStorageBytes(
      compressedBytes,
      effectiveStorageExtracted,
      includeSourceCopy,
    );
    return {
      format: REHEARSAL_PACKAGE_FORMAT,
      formatVersion: REHEARSAL_PACKAGE_FORMAT_VERSION,
      status,
      errorCode,
      errorMessage,
      readyForPublication: isValid,
      publicationState: isValid ? 'staged_validated' : 'rejected',
      songVersionBindingAuthorized: false,
      idempotencyDisposition,
      packageIdentity,
      manifestSummary,
      budget: {
        compressedBytes,
        declaredExtractedBytes,
        actualExtractedBytes,
        entryCount,
        requiredFreeStorageBytes: Math.max(requiredFreeStorageBytes, computedRequiredStorage),
        availableStorageBytes,
        maxChunkBytes,
        maxMemoryBudgetBytes,
        peakWorkingMemoryBytes: budgetedSource?.peakWorkingMemoryBytes ?? 0,
        maxObservedSingleReadBytes: budgetedSource?.maxObservedSingleReadBytes ?? 0,
      },
      verifiedEntries,
    };
  };

  try {
    if (options.signal?.aborted) {
      throw new ValidationFailure('cancelled', 'VALIDATION_CANCELLED', 'Validation cancelled before preflight.');
    }

    const rawSource = toRandomAccessByteSource(input);
    compressedBytes = rawSource.byteLength;
    requiredFreeStorageBytes = computeRequiredStorageBytes(compressedBytes, 0, includeSourceCopy);

    if (compressedBytes === 0) {
      throw new ValidationFailure('corrupted', 'EMPTY_ARCHIVE', 'Archive is empty (0 bytes).');
    }
    if (compressedBytes > LIMITS_V1.maxCompressedBytes) {
      throw new ValidationFailure(
        'corrupted',
        'ARCHIVE_SIZE_LIMIT_EXCEEDED',
        `Archive compressed size ${compressedBytes} exceeds ${LIMITS_V1.maxCompressedBytes}.`,
      );
    }

    budgetedSource = new BudgetedByteSource(
      rawSource,
      maxChunkBytes,
      maxMemoryBudgetBytes,
      options.signal,
    );

    budgetedSource.allocateWorkingMemory(maxChunkBytes);
    budgetedSource.releaseWorkingMemory(maxChunkBytes);

    const eocd = await locateEocdAndCd(budgetedSource, maxChunkBytes);
    entryCount = eocd.totalEntries;

    const cd = await parseAndValidateCentralDirectory(budgetedSource, eocd);
    declaredExtractedBytes = cd.declaredExtractedBytes;
    requiredFreeStorageBytes = computeRequiredStorageBytes(
      compressedBytes,
      declaredExtractedBytes,
      includeSourceCopy,
    );

    if (
      availableStorageBytes !== null &&
      (!Number.isFinite(availableStorageBytes) ||
        availableStorageBytes < 0 ||
        availableStorageBytes < requiredFreeStorageBytes)
    ) {
      throw new ValidationFailure(
        'insufficientSpace',
        'INSUFFICIENT_STORAGE_SPACE',
        `Available storage (${availableStorageBytes} B) is below required (${requiredFreeStorageBytes} B).`,
      );
    }

    const entryByPath = new Map<string, ParsedZipCdEntry>();
    for (const entry of cd.entries) {
      entryByPath.set(entry.rawPath, entry);
    }

    const manifestZipEntry = entryByPath.get('manifest.json')!;
    let manifestStreamedBytes = 0;
    const manifestStreamResult = await streamAndVerifyManifest(
      budgetedSource,
      manifestZipEntry,
      maxChunkBytes,
      (delta) => {
        manifestStreamedBytes += delta;
        options.onProgress?.(
          Math.min(manifestStreamedBytes, declaredExtractedBytes),
          declaredExtractedBytes,
        );
      },
    );

    actualExtractedBytes += manifestStreamResult.actualUncompressedBytes;

    verifiedEntries.push({
      role: 'manifest',
      path: 'manifest.json',
      compressionMethod: manifestZipEntry.compressionMethod,
      compressedBytes: manifestZipEntry.compressedSize,
      uncompressedBytes: manifestStreamResult.actualUncompressedBytes,
      crc32: manifestZipEntry.crc32,
      sha256: manifestStreamResult.sha256,
    });

    const manifest = parseAndValidateManifest(manifestStreamResult.bytes);
    packageIdentity = {
      packageId: manifest.packageId,
      revision: manifest.revision,
      manifestSha256: manifestStreamResult.sha256,
      compositeSha256: null,
    };
    manifestSummary = {
      packageId: manifest.packageId,
      revision: manifest.revision,
      createdAt: manifest.createdAt,
      displayName: manifest.displayName,
      format: manifest.format,
      formatVersion: manifest.formatVersion,
      requiredFeatures: manifest.requiredFeatures,
      sampleRate: manifest.sampleRate,
      channels: manifest.channels,
      totalFrames: manifest.totalFrames,
      durationSeconds: manifest.totalFrames / manifest.sampleRate,
      includesOriginal: manifest.includesOriginal,
      stemIds: manifest.stems.map((s) => s.stemId!),
    };

    const expectedPaths = new Set<string>(['manifest.json']);
    for (const stem of manifest.stems) {
      if (expectedPaths.has(stem.path)) {
        throw new ValidationFailure(
          'corrupted',
          'DUPLICATE_OR_COLLIDING_ENTRY',
          `Duplicate declared media path in manifest: ${stem.path}.`,
        );
      }
      if (!entryByPath.has(stem.path)) {
        throw new ValidationFailure(
          'incomplete',
          'MISSING_REQUIRED_STEM',
          `Stem ${stem.stemId} declared at ${stem.path} is missing from ZIP.`,
        );
      }
      expectedPaths.add(stem.path);
    }

    if (manifest.original) {
      if (expectedPaths.has(manifest.original.path)) {
        throw new ValidationFailure(
          'corrupted',
          'DUPLICATE_OR_COLLIDING_ENTRY',
          `Duplicate declared media path in manifest: ${manifest.original.path}.`,
        );
      }
      if (!entryByPath.has(manifest.original.path)) {
        throw new ValidationFailure(
          'incomplete',
          'MISSING_ORIGINAL_ENTRY',
          `Original audio declared at ${manifest.original.path} is missing from ZIP.`,
        );
      }
      expectedPaths.add(manifest.original.path);
    }

    for (const entry of cd.entries) {
      if (!expectedPaths.has(entry.rawPath)) {
        throw new ValidationFailure(
          'corrupted',
          'UNDECLARED_ZIP_ENTRY',
          `ZIP contains undeclared entry: ${entry.rawPath}.`,
        );
      }
    }

    const mediaToVerify: ParsedMediaDeclaration[] = [...manifest.stems];
    if (manifest.original) {
      mediaToVerify.push(manifest.original);
    }

    for (const decl of mediaToVerify) {
      const zipEntry = entryByPath.get(decl.path)!;
      const verified = await streamAndVerifyMediaEntry(
        budgetedSource,
        zipEntry,
        decl,
        maxChunkBytes,
        () => actualExtractedBytes,
        (delta) => {
          actualExtractedBytes += delta;
          options.onProgress?.(
            Math.min(actualExtractedBytes, declaredExtractedBytes),
            declaredExtractedBytes,
          );
        },
      );
      verifiedEntries.push(verified);
    }

    const compositeSha256 = computeCompositeSha256(manifestStreamResult.sha256, verifiedEntries);
    packageIdentity = {
      ...packageIdentity,
      compositeSha256,
    };

    const existingMatch = options.existingPackages?.find(
      (pkg) => pkg.packageId.toLowerCase() === manifest.packageId,
    );

    if (existingMatch) {
      if (
        existingMatch.compositeSha256.toLowerCase() === compositeSha256 &&
        (existingMatch.manifestSha256 === undefined ||
          existingMatch.manifestSha256.toLowerCase() === manifestStreamResult.sha256)
      ) {
        return buildResult('valid', null, null, 'idempotent_noop');
      }
      return buildResult(
        'conflict',
        'PACKAGE_IDENTITY_CONFLICT',
        `Package ${manifest.packageId} already exists with a different content hash.`,
        'conflict_detected',
      );
    }

    return buildResult('valid', null, null, 'new_package');
  } catch (err) {
    if (err instanceof ValidationFailure) {
      return buildResult(err.status, err.errorCode, err.message, 'not_applicable');
    }
    const message = err instanceof Error ? err.message : String(err);
    return buildResult('corrupted', 'INVALID_ZIP_ARCHIVE', message, 'not_applicable');
  }
}

export async function validateAndExtractRehearsalPackage(
  input: RehearsalPackageInput,
  options: ExtractValidatedRehearsalPackageOptions,
): Promise<RehearsalPackageValidationResult> {
  const validation = await validateRehearsalPackage(input, options);
  if (!validation.readyForPublication) {
    return validation;
  }

  const { maxChunkBytes, maxMemoryBudgetBytes } = resolveBudgetOptions(options);
  let budgetedSource: BudgetedByteSource | null = null;

  const buildRejectedResult = (
    status: Exclude<RehearsalPackageStatus, 'valid'>,
    errorCode: RehearsalPackageErrorCode,
    errorMessage: string,
  ): RehearsalPackageValidationResult => ({
    ...validation,
    status,
    errorCode,
    errorMessage,
    readyForPublication: false,
    publicationState: 'rejected',
    songVersionBindingAuthorized: false,
    idempotencyDisposition: 'not_applicable',
    budget: {
      ...validation.budget,
      peakWorkingMemoryBytes: Math.max(
        validation.budget.peakWorkingMemoryBytes,
        budgetedSource?.peakWorkingMemoryBytes ?? 0,
      ),
      maxObservedSingleReadBytes: Math.max(
        validation.budget.maxObservedSingleReadBytes,
        budgetedSource?.maxObservedSingleReadBytes ?? 0,
      ),
    },
    verifiedEntries: [],
  });

  try {
    if (options.signal?.aborted) {
      throw new ValidationFailure('cancelled', 'VALIDATION_CANCELLED', 'Extraction cancelled before Phase 2.');
    }

    const rawSource = toRandomAccessByteSource(input);
    budgetedSource = new BudgetedByteSource(
      rawSource,
      maxChunkBytes,
      maxMemoryBudgetBytes,
      options.signal,
    );
    budgetedSource.allocateWorkingMemory(maxChunkBytes);
    budgetedSource.releaseWorkingMemory(maxChunkBytes);

    const eocd = await locateEocdAndCd(budgetedSource, maxChunkBytes);
    const cd = await parseAndValidateCentralDirectory(budgetedSource, eocd);

    const entryByPath = new Map<string, ParsedZipCdEntry>();
    for (const entry of cd.entries) {
      entryByPath.set(entry.rawPath, entry);
    }

    const totalExtractBytes = validation.verifiedEntries.reduce(
      (sum, entry) => sum + entry.uncompressedBytes,
      0,
    );
    let extractedBytes = 0;

    for (const entry of validation.verifiedEntries) {
      budgetedSource.checkAborted();
      const zipEntry = entryByPath.get(entry.path);
      if (
        !zipEntry ||
        zipEntry.compressionMethod !== entry.compressionMethod ||
        zipEntry.crc32 !== entry.crc32 ||
        zipEntry.compressedSize !== entry.compressedBytes ||
        zipEntry.uncompressedSize !== entry.uncompressedBytes
      ) {
        throw new ValidationFailure(
          'corrupted',
          'HEADER_MISMATCH',
          `ZIP entry metadata changed before extraction for ${entry.path}.`,
        );
      }

      if (entry.role !== 'manifest' && zipEntry.compressionMethod !== ZIP_METHOD_STORE) {
        throw new ValidationFailure(
          'unsupported',
          'UNSUPPORTED_COMPRESSION_METHOD',
          `Media entry ${entry.path} must use STORE (0), got ${zipEntry.compressionMethod}.`,
        );
      }

      const sink = await runSinkIo(() => options.openTargetSink(entry));
      let closed = false;
      let closeAttempted = false;
      let lastErr: unknown = null;

      try {
        const crc32 = new Crc32Hasher();
        const sha256 = new Sha256Hasher();
        let entryWritten = 0;

        if (zipEntry.compressionMethod === ZIP_METHOD_STORE) {
          let pos = 0;
          while (pos < zipEntry.compressedSize) {
            budgetedSource.checkAborted();
            const sliceLen = Math.min(maxChunkBytes, zipEntry.compressedSize - pos);
            const chunk = await budgetedSource.readSingleBounded(zipEntry.dataOffset + pos, sliceLen);
            crc32.update(chunk);
            sha256.update(chunk);
            await runSinkIo(() => sink.write(chunk));
            entryWritten += chunk.byteLength;
            pos += chunk.byteLength;
            extractedBytes += chunk.byteLength;
            options.onExtractProgress?.(
              Math.min(extractedBytes, totalExtractBytes),
              totalExtractBytes,
            );
          }
        } else if (entry.role === 'manifest' && zipEntry.compressionMethod === ZIP_METHOD_DEFLATE) {
          await streamDeflateEntry(
            budgetedSource,
            zipEntry,
            maxChunkBytes,
            async (decompressedChunk) => {
              if (decompressedChunk.byteLength === 0) return;
              if (entryWritten + decompressedChunk.byteLength > zipEntry.compressedSize * LIMITS_V1.maxCompressionRatio) {
                throw new ValidationFailure(
                  'corrupted',
                  'ZIP_BOMB_RATIO_EXCEEDED',
                  `DEFLATE manifest stream exceeded 100:1 ratio (${entryWritten + decompressedChunk.byteLength} > ${zipEntry.compressedSize * LIMITS_V1.maxCompressionRatio}).`,
                );
              }
              if (entryWritten + decompressedChunk.byteLength > LIMITS_V1.maxManifestBytes) {
                throw new ValidationFailure(
                  'corrupted',
                  'MANIFEST_SIZE_LIMIT_EXCEEDED',
                  `manifest.json exceeded ${LIMITS_V1.maxManifestBytes} bytes.`,
                );
              }

              for (let off = 0; off < decompressedChunk.byteLength; off += maxChunkBytes) {
                budgetedSource!.checkAborted();
                const piece = decompressedChunk.subarray(
                  off,
                  Math.min(decompressedChunk.byteLength, off + maxChunkBytes),
                );
                crc32.update(piece);
                sha256.update(piece);
                await runSinkIo(() => sink.write(piece));
                entryWritten += piece.byteLength;
                extractedBytes += piece.byteLength;
                options.onExtractProgress?.(
                  Math.min(extractedBytes, totalExtractBytes),
                  totalExtractBytes,
                );
              }
            },
          );
        } else {
          throw new ValidationFailure(
            'unsupported',
            'UNSUPPORTED_COMPRESSION_METHOD',
            `Unsupported compression method ${zipEntry.compressionMethod} for ${entry.path}.`,
          );
        }

        budgetedSource.checkAborted();

        if (entryWritten !== entry.uncompressedBytes) {
          throw new ValidationFailure(
            'corrupted',
            'HEADER_MISMATCH',
            `Extracted byte count ${entryWritten} differs from verified ${entry.uncompressedBytes} for ${entry.path}.`,
          );
        }
        if (crc32.digest() !== entry.crc32) {
          throw new ValidationFailure(
            'corrupted',
            'CRC_MISMATCH',
            `CRC-32 mismatch during extraction for ${entry.path}.`,
          );
        }
        if (sha256.digestHex() !== entry.sha256) {
          throw new ValidationFailure(
            'incomplete',
            'SHA256_MISMATCH',
            `SHA-256 mismatch during extraction for ${entry.path}.`,
          );
        }

        await runSinkIo(() => {
          closeAttempted = true;
          return sink.close();
        });
        closed = true;
      } catch (sinkOrVerifyErr) {
        lastErr = sinkOrVerifyErr;
        throw sinkOrVerifyErr;
      } finally {
        if (!closed) {
          const abortReason = lastErr instanceof SinkIoError ? lastErr.originalError : lastErr;
          if (sink.abort) {
            try {
              await sink.abort(abortReason);
            } catch {
              // Preserve primary error
            }
          } else if (!closeAttempted) {
            try {
              await sink.close();
            } catch {
              // Preserve primary error
            }
          }
        }
      }
    }

    return {
      ...validation,
      budget: {
        ...validation.budget,
        peakWorkingMemoryBytes: Math.max(
          validation.budget.peakWorkingMemoryBytes,
          budgetedSource.peakWorkingMemoryBytes,
        ),
        maxObservedSingleReadBytes: Math.max(
          validation.budget.maxObservedSingleReadBytes,
          budgetedSource.maxObservedSingleReadBytes,
        ),
      },
    };
  } catch (err) {
    if (err instanceof SinkIoError) {
      throw err.originalError;
    }
    if (err instanceof ValidationFailure) {
      return buildRejectedResult(err.status, err.errorCode, err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    return buildRejectedResult('corrupted', 'INVALID_ZIP_ARCHIVE', message);
  }
}
