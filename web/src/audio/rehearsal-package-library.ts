import {
  LIMITS_V1,
  REQUIRED_STEM_IDS_V1,
  Sha256Hasher,
  validateAndExtractRehearsalPackage,
  validateRehearsalPackage,
  type ExistingPackageRecord,
  type RehearsalEntryWritableSink,
  type RehearsalPackageValidationResult,
  type RequiredStemId,
  type VerifiedRehearsalEntry,
} from './rehearsal-package-validator';

/**
 * Web local rehearsal package library manager (OPFS + ephemeral in-memory fallback).
 *
 * Security & retention invariants:
 * - Zero IndexedDB, zero localStorage, zero sessionStorage, zero network/upload calls,
 *   zero auto-playback, and zero SongVersion binding (`bindingStatus: 'unlinked'` only).
 * - `index.json` stores metadata only (zero audio bytes, zero Base64 blobs).
 * - Internal filenames on OPFS are derived strictly by `resolveInternalFileName(entry)`
 *   from `(entry.role, entry.stemId, entry.audioInfo.container)`, never from ZIP paths.
 * - Browser storage (including OPFS) never guarantees permanent retention or OS-level
 *   hardware `fsync`: logical commit ordering (`staging -> packages/<id> files -> commit.json
 *   -> index.json`) provides logical consistency and crash/reload recovery only; users
 *   should still export backups (`exportPackage`) for durable safekeeping.
 */

export type RehearsalStorageMode = 'opfs' | 'ephemeral-fallback';

export type RehearsalPackageIntegrityState =
  | 'verified'
  | 'corrupted'
  | 'incomplete'
  | 'missingFiles'
  | 'permissionDenied'
  | 'unverified';

export type RehearsalOperationPhase =
  | 'idle'
  | 'picking'
  | 'preflight'
  | 'stagingCopy'
  | 'validating'
  | 'extracting'
  | 'committing'
  | 'revalidating'
  | 'exporting'
  | 'deleting';

export type RehearsalOutcomeCategory =
  | 'imported'
  | 'idempotentNoop'
  | 'conflict'
  | 'incompatible'
  | 'corrupted'
  | 'insufficientSpace'
  | 'permissionDenied'
  | 'cancelled'
  | 'exported'
  | 'deleted'
  | 'renamed'
  | 'revalidated'
  | 'recoverableFailure';

export interface LocalWebRehearsalStemMetadata {
  id: RequiredStemId | 'original';
  internalFileName: string;
  container: string;
  codec: string;
  byteLength: number;
  sha256: string;
  decodedFrames: number;
  sampleRate: number;
  channels: number;
}

export interface LocalWebRehearsalPackageRecord {
  packageId: string;
  accountNamespaceHash: string;
  revision: number;
  title: string;
  customLabel: string | null;
  displayName: string;
  format: string;
  formatVersion: number;
  createdAt: string;
  importedAt: string;
  lastValidatedAt: string;
  integrityState: RehearsalPackageIntegrityState;
  integrityCode: string | null;
  integrityMessage: string | null;
  sampleRate: number;
  channels: number;
  totalFrames: number;
  durationSeconds: number;
  archiveBytes: number;
  extractedBytes: number;
  totalOccupiedBytes: number;
  manifestSha256: string;
  compositeSha256: string;
  stems: Record<RequiredStemId, LocalWebRehearsalStemMetadata>;
  original: LocalWebRehearsalStemMetadata | null;
  storageMode: RehearsalStorageMode;
  storageLocationLabel: string;
  bindingStatus: 'unlinked';
  usageRightsDeclaration: string;
  isReadyForLocalUse: boolean;
}

export interface RehearsalOperationProgress {
  operationId: string;
  phase: RehearsalOperationPhase;
  phaseLabel: string;
  bytesProcessed: number;
  totalBytes: number | null;
  detailMessage?: string;
}

export interface RehearsalConflictDetails {
  packageId: string;
  pendingTransactionId: string;
  existingRecord: LocalWebRehearsalPackageRecord;
  incomingDisplayName: string;
  incomingRevision: number;
  incomingCompositeSha256: string;
}

export interface RehearsalStorageSummary {
  storageMode: RehearsalStorageMode;
  persistentGranted: boolean;
  persistentWarning: string;
  accountNamespaceHash: string;
  quotaBytes: number | null;
  usageBytes: number | null;
  availableBytes: number | null;
  occupiedByAccountBytes: number;
  requiredReserveBytes: number;
  packageCount: number;
}

export interface RehearsalLibrarySnapshot {
  packages: LocalWebRehearsalPackageRecord[];
  storageSummary: RehearsalStorageSummary;
  recoveredOrphanedCount: number;
  corruptedOrIncompleteCount: number;
}

export interface RehearsalOperationOutcome {
  category: RehearsalOutcomeCategory;
  title: string;
  message: string;
  errorCode?: string;
  record?: LocalWebRehearsalPackageRecord;
  conflict?: RehearsalConflictDetails;
  recoveredOrphanedCount?: number;
  exportedBlob?: Blob;
  exportedFileName?: string;
}

export interface ExternalFileHandleLike {
  name?: string;
  getFile(): Promise<File>;
  queryPermission?(desc?: { mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?(desc?: { mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export interface SaveFileHandleLike {
  createWritable(): Promise<{
    write(data: Blob | Uint8Array | string): Promise<void>;
    close(): Promise<void>;
    abort?(reason?: unknown): Promise<void>;
  }>;
}

export interface OpfsWritableStreamLike {
  write(data: Uint8Array | Blob | string): Promise<void>;
  close(): Promise<void>;
  abort?(reason?: unknown): Promise<void>;
}

export interface OpfsFileHandleLike {
  readonly kind?: 'file';
  readonly name: string;
  getFile(): Promise<File | Blob>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<OpfsWritableStreamLike>;
}

export interface OpfsDirectoryHandleLike {
  readonly kind?: 'directory';
  readonly name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OpfsDirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OpfsFileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, OpfsDirectoryHandleLike | OpfsFileHandleLike]>;
}

export interface QuotaEstimateResult {
  quota: number | null;
  usage: number | null;
}

export interface TestSinkContext {
  stage: 'staging' | 'extracting' | 'committing' | 'backup' | 'rollback' | 'index';
  fileName: string;
  packageId?: string;
  txId?: string;
}

export interface RehearsalLibraryManagerOptions {
  getOpfsRoot?: () => Promise<OpfsDirectoryHandleLike | null>;
  quotaEstimator?: () => Promise<QuotaEstimateResult>;
  persistenceChecker?: () => Promise<boolean>;
  now?: () => Date;
  txIdGenerator?: () => string;
  testSinkWrapper?: (
    context: TestSinkContext,
    sink: RehearsalEntryWritableSink,
  ) => RehearsalEntryWritableSink;
  isFileSystemAccessSupported?: () => boolean;
}

export interface LoadRehearsalLibraryOptions {
  userId: string;
}

export interface ImportRehearsalPackageOptions {
  userId: string;
  file?: File | Blob;
  externalHandle?: ExternalFileHandleLike;
  onProgress?: (progress: RehearsalOperationProgress) => void;
}

export interface ConfirmConflictReplaceOptions {
  userId: string;
  pendingTransactionId: string;
  onProgress?: (progress: RehearsalOperationProgress) => void;
}

export interface DiscardPendingConflictOptions {
  userId: string;
  pendingTransactionId: string;
}

export interface RevalidateRehearsalPackageOptions {
  userId: string;
  packageId: string;
  onProgress?: (progress: RehearsalOperationProgress) => void;
}

export interface RenameRehearsalPackageLabelOptions {
  userId: string;
  packageId: string;
  label: string;
}

export interface ExportRehearsalPackageOptions {
  userId: string;
  packageId: string;
  saveHandle?: SaveFileHandleLike;
  onProgress?: (progress: RehearsalOperationProgress) => void;
}

export interface DeleteRehearsalPackageOptions {
  userId: string;
  packageId: string;
  confirmedScope: boolean;
}

const ROOT_LIBRARY_DIR = 'louvaio-rehearsal-v1';
const INDEX_FILE_NAME = 'index.json';
const INDEX_TMP_FILE_NAME = 'index.tmp.json';
const COMMIT_FILE_NAME = 'commit.json';
const BACKUP_READY_FILE_NAME = 'backup.ready.json';
const ARCHIVE_FILE_NAME = 'package.louvaio-rehearsal.zip';
const STAGING_DIR_NAME = 'staging';
const EXTRACTED_DIR_NAME = 'extracted';
const PACKAGES_DIR_NAME = 'packages';
const BACKUPS_DIR_NAME = 'backups';
const CHUNK_BYTES = LIMITS_V1.defaultMaxChunkBytes;

const ALLOWED_STEM_CONTAINERS = new Set(['wav', 'flac', 'ogg', 'm4a']);
const ALLOWED_ORIGINAL_CONTAINERS = new Set(['wav', 'flac', 'ogg', 'm4a', 'mp3']);
const REQUIRED_STEM_SET = new Set<string>(REQUIRED_STEM_IDS_V1);

const OPFS_PERSISTENT_WARNING =
  'Os arquivos locais ficam armazenados no armazenamento interno do navegador (OPFS), sem garantia de retenção permanente pelo sistema operacional; exporte backups regularmente para evitar perda por limpeza de dados ou pressão de espaço.';
const EPHEMERAL_PERSISTENT_WARNING =
  'OPFS indisponível neste navegador/contexto. Os pacotes são mantidos apenas em memória para esta sessão temporária e não são persistidos entre recarregamentos.';

interface RehearsalIndexFileV1 {
  schemaVersion: 1;
  accountNamespaceHash: string;
  updatedAt: string;
  packages: LocalWebRehearsalPackageRecord[];
}

interface RehearsalCommitFileEntry {
  fileName: string;
  byteLength: number;
  sha256: string;
}

interface RehearsalCommitMarkerV1 {
  schemaVersion: 1;
  packageId: string;
  accountNamespaceHash: string;
  revision: number;
  manifestSha256: string;
  compositeSha256: string;
  archiveBytes: number;
  extractedBytes: number;
  committedAt: string;
  files: RehearsalCommitFileEntry[];
}

interface RehearsalBackupMarkerV1 {
  schemaVersion: 1;
  packageId: string;
  accountNamespaceHash: string;
  revision: number;
  manifestSha256: string;
  compositeSha256: string;
  record: LocalWebRehearsalPackageRecord;
  createdAt: string;
}

interface ParsedManifestCrossCheck {
  packageId: string;
  revision: number;
  sampleRate: number;
  channels: number;
  totalFrames: number;
  usageRightsDeclaration: string;
}

interface PendingConflict {
  txId: string;
  accountNamespaceHash: string;
  packageId: string;
  storageMode: RehearsalStorageMode;
  existingRecord: LocalWebRehearsalPackageRecord;
  validation: RehearsalPackageValidationResult;
  archiveBytes: number;
  ephemeralSourceFile?: File | Blob;
  ephemeralExternalHandle?: ExternalFileHandleLike;
}

interface EphemeralPackageEntry {
  record: LocalWebRehearsalPackageRecord;
  sourceFile: File | Blob;
  externalHandle?: ExternalFileHandleLike;
}

interface EphemeralAccountStore {
  packages: Map<string, EphemeralPackageEntry>;
}

/**
 * In-memory ephemeral backend used automatically when OPFS is unavailable
 * (`SecurityError`, `NotSupportedError`, or missing `navigator.storage.getDirectory`).
 */
export class EphemeralMemoryRehearsalStorageBackend {
  private readonly accounts = new Map<string, EphemeralAccountStore>();

  getOrCreateAccount(accountNamespaceHash: string): EphemeralAccountStore {
    let store = this.accounts.get(accountNamespaceHash);
    if (!store) {
      store = { packages: new Map() };
      this.accounts.set(accountNamespaceHash, store);
    }
    return store;
  }

  getAccount(accountNamespaceHash: string): EphemeralAccountStore | undefined {
    return this.accounts.get(accountNamespaceHash);
  }

  clearAll(): void {
    this.accounts.clear();
  }
}

class SessionStaleError extends Error {
  constructor(message = 'Session invalidated during operation.') {
    super(message);
    this.name = 'SessionStaleError';
  }
}

class OperationCancelledError extends Error {
  constructor(message = 'Operation cancelled.') {
    super(message);
    this.name = 'OperationCancelledError';
  }
}

/**
 * Strictly maps a verified ZIP entry to its canonical internal OPFS filename.
 * Never derives filenames or subdirectories from untrusted `entry.path`.
 */
export function resolveInternalFileName(entry: VerifiedRehearsalEntry): string {
  if (entry.role === 'manifest') {
    return 'manifest.json';
  }
  if (entry.role === 'stem') {
    if (!entry.stemId || !REQUIRED_STEM_SET.has(entry.stemId)) {
      throw new Error(`Invalid required stemId: ${String(entry.stemId)}`);
    }
    const container = entry.audioInfo?.container;
    if (!container || !ALLOWED_STEM_CONTAINERS.has(container)) {
      throw new Error(`Unsupported stem container: ${String(container)}`);
    }
    return `stem_${entry.stemId}.${container}`;
  }
  if (entry.role === 'original') {
    const container = entry.audioInfo?.container;
    if (!container || !ALLOWED_ORIGINAL_CONTAINERS.has(container)) {
      throw new Error(`Unsupported original container: ${String(container)}`);
    }
    return `original.${container}`;
  }
  throw new Error(`Unsupported entry role: ${String((entry as { role?: unknown }).role)}`);
}

function assertNonEmptyUserId(userId: string): string {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new Error('userId must be a non-empty string.');
  }
  return userId.trim();
}

function getDomErrorName(err: unknown): string | null {
  if (err && typeof err === 'object' && 'name' in err && typeof (err as { name: unknown }).name === 'string') {
    return (err as { name: string }).name;
  }
  return null;
}

function isQuotaExceededError(err: unknown): boolean {
  const name = getDomErrorName(err);
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
    return true;
  }
  if (err instanceof Error && /quotaexceeded/i.test(err.message)) {
    return true;
  }
  return false;
}

function isNotAllowedError(err: unknown): boolean {
  const name = getDomErrorName(err);
  return name === 'NotAllowedError' || name === 'SecurityError';
}

function isNotFoundError(err: unknown): boolean {
  const name = getDomErrorName(err);
  return name === 'NotFoundError';
}

function isAbortError(err: unknown): boolean {
  if (err instanceof OperationCancelledError || err instanceof SessionStaleError) {
    return true;
  }
  return getDomErrorName(err) === 'AbortError';
}

function validateCustomLabel(rawLabel: string): { valid: true; label: string } | { valid: false; message: string } {
  if (typeof rawLabel !== 'string') {
    return { valid: false, message: 'O rótulo deve ser uma string entre 1 e 120 caracteres.' };
  }
  const trimmed = rawLabel.trim();
  if (trimmed.length < 1 || trimmed.length > 120) {
    return { valid: false, message: 'O rótulo deve ter entre 1 e 120 caracteres.' };
  }
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (
      code < 0x20 ||
      code === 0x7f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return { valid: false, message: 'O rótulo contém caracteres de controle inválidos.' };
    }
  }
  return { valid: true, label: trimmed };
}

function sanitizeExportFileName(displayName: string, packageId: string): string {
  const cleaned = displayName
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9._ -]/g, '-')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80);
  const base = cleaned.length > 0 ? cleaned : packageId;
  return `${base}.louvaio-rehearsal.zip`;
}

function clonePackageRecord(record: LocalWebRehearsalPackageRecord): LocalWebRehearsalPackageRecord {
  return {
    ...record,
    stems: {
      vocals: { ...record.stems.vocals },
      drums: { ...record.stems.drums },
      bass: { ...record.stems.bass },
      other: { ...record.stems.other },
    },
    original: record.original ? { ...record.original } : null,
  };
}

function parseManifestForCrossCheck(manifestBytes: Uint8Array): ParsedManifestCrossCheck {
  if (manifestBytes.byteLength > LIMITS_V1.maxManifestBytes) {
    throw new Error(`manifest.json exceeded ${LIMITS_V1.maxManifestBytes} bytes.`);
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (!raw || typeof raw !== 'object') {
    throw new Error('manifest.json root is not an object.');
  }
  const packageId = typeof raw.packageId === 'string' ? raw.packageId.toLowerCase() : '';
  const revision = typeof raw.revision === 'number' ? raw.revision : NaN;
  const timeline = raw.timeline as Record<string, unknown> | undefined;
  const rights = raw.rights as Record<string, unknown> | undefined;

  if (!packageId || !Number.isInteger(revision) || revision < 1) {
    throw new Error('manifest.json missing valid packageId or revision.');
  }
  if (
    !timeline ||
    typeof timeline.sampleRate !== 'number' ||
    typeof timeline.channels !== 'number' ||
    typeof timeline.totalFrames !== 'number'
  ) {
    throw new Error('manifest.json missing valid timeline.');
  }
  const declaration = typeof rights?.declaration === 'string' ? rights.declaration.trim() : '';
  if (!declaration) {
    throw new Error('manifest.json missing rights.declaration.');
  }

  return {
    packageId,
    revision,
    sampleRate: timeline.sampleRate,
    channels: timeline.channels,
    totalFrames: timeline.totalFrames,
    usageRightsDeclaration: declaration,
  };
}

async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader did not return an ArrayBuffer.'));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed.'));
    reader.readAsArrayBuffer(blob);
  });
}

async function readBlobAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') {
    return blob.text();
  }
  const buf = await readBlobAsArrayBuffer(blob);
  return new TextDecoder('utf-8').decode(new Uint8Array(buf));
}

async function computeBlobSha256AndSize(blob: Blob): Promise<{ sha256: string; byteLength: number }> {
  const hasher = new Sha256Hasher();
  let pos = 0;
  while (pos < blob.size) {
    const slice = blob.slice(pos, Math.min(blob.size, pos + CHUNK_BYTES));
    const buf = new Uint8Array(await readBlobAsArrayBuffer(slice));
    hasher.update(buf);
    pos += buf.byteLength;
  }
  return {
    sha256: hasher.digestHex(),
    byteLength: blob.size,
  };
}

async function defaultGetOpfsRoot(): Promise<OpfsDirectoryHandleLike | null> {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return null;
  }
  const storage = navigator.storage as unknown as {
    getDirectory?: () => Promise<OpfsDirectoryHandleLike>;
  };
  if (typeof storage.getDirectory !== 'function') {
    return null;
  }
  return storage.getDirectory();
}

async function defaultQuotaEstimator(): Promise<QuotaEstimateResult> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.estimate !== 'function') {
    return { quota: null, usage: null };
  }
  try {
    const est = await navigator.storage.estimate();
    const quota = typeof est.quota === 'number' && Number.isFinite(est.quota) ? est.quota : null;
    const usage = typeof est.usage === 'number' && Number.isFinite(est.usage) ? est.usage : null;
    return { quota, usage };
  } catch {
    return { quota: null, usage: null };
  }
}

async function defaultPersistenceChecker(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persisted !== 'function') {
    return false;
  }
  try {
    return await navigator.storage.persisted();
  } catch {
    return false;
  }
}

function defaultTxIdGenerator(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function tryGetDirectoryHandle(
  parent: OpfsDirectoryHandleLike,
  name: string,
): Promise<OpfsDirectoryHandleLike | null> {
  try {
    return await parent.getDirectoryHandle(name, { create: false });
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

async function tryGetFileHandle(
  parent: OpfsDirectoryHandleLike,
  name: string,
): Promise<OpfsFileHandleLike | null> {
  try {
    return await parent.getFileHandle(name, { create: false });
  } catch (err) {
    if (isNotFoundError(err)) {
      return null;
    }
    throw err;
  }
}

async function removeEntryIfExists(
  parent: OpfsDirectoryHandleLike,
  name: string,
  recursive = true,
): Promise<boolean> {
  try {
    await parent.removeEntry(name, { recursive });
    return true;
  } catch (err) {
    if (isNotFoundError(err)) {
      return false;
    }
    throw err;
  }
}

async function listDirectoryEntries(
  dir: OpfsDirectoryHandleLike,
): Promise<Array<[string, OpfsDirectoryHandleLike | OpfsFileHandleLike]>> {
  const entries: Array<[string, OpfsDirectoryHandleLike | OpfsFileHandleLike]> = [];
  for await (const entry of dir.entries()) {
    entries.push(entry);
  }
  return entries;
}

async function clearDirectoryContents(dir: OpfsDirectoryHandleLike): Promise<void> {
  const entries = await listDirectoryEntries(dir);
  for (const [name] of entries) {
    await removeEntryIfExists(dir, name, true);
  }
}

async function readJsonFileIfPresent<T>(
  dir: OpfsDirectoryHandleLike,
  fileName: string,
): Promise<{ exists: boolean; data: T | null; invalidJson: boolean }> {
  const handle = await tryGetFileHandle(dir, fileName);
  if (!handle) {
    return { exists: false, data: null, invalidJson: false };
  }
  const file = await handle.getFile();
  if (file.size > LIMITS_V1.maxManifestBytes * 4) {
    return { exists: true, data: null, invalidJson: true };
  }
  try {
    const text = await readBlobAsText(file);
    const parsed = JSON.parse(text) as T;
    return { exists: true, data: parsed, invalidJson: false };
  } catch {
    return { exists: true, data: null, invalidJson: true };
  }
}

function isValidIndexFile(
  raw: unknown,
  expectedAccountHash: string,
): raw is RehearsalIndexFileV1 {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.schemaVersion === 1 &&
    obj.accountNamespaceHash === expectedAccountHash &&
    typeof obj.updatedAt === 'string' &&
    Array.isArray(obj.packages)
  );
}

function isValidCommitMarker(
  raw: unknown,
  expectedAccountHash: string,
  expectedPackageId: string,
): raw is RehearsalCommitMarkerV1 {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.schemaVersion === 1 &&
    obj.accountNamespaceHash === expectedAccountHash &&
    obj.packageId === expectedPackageId &&
    typeof obj.revision === 'number' &&
    typeof obj.manifestSha256 === 'string' &&
    typeof obj.compositeSha256 === 'string' &&
    typeof obj.archiveBytes === 'number' &&
    Array.isArray(obj.files)
  );
}

function isValidBackupMarker(
  raw: unknown,
  expectedAccountHash: string,
): raw is RehearsalBackupMarkerV1 {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    obj.schemaVersion === 1 &&
    obj.accountNamespaceHash === expectedAccountHash &&
    typeof obj.packageId === 'string' &&
    typeof obj.revision === 'number' &&
    typeof obj.manifestSha256 === 'string' &&
    typeof obj.compositeSha256 === 'string' &&
    Boolean(obj.record && typeof obj.record === 'object')
  );
}

export class RehearsalPackageLibraryManager {
  private readonly _getOpfsRoot: () => Promise<OpfsDirectoryHandleLike | null>;
  private readonly _quotaEstimator: () => Promise<QuotaEstimateResult>;
  private readonly _persistenceChecker: () => Promise<boolean>;
  private readonly _now: () => Date;
  private readonly _txIdGenerator: () => string;
  private readonly _testSinkWrapper?: RehearsalLibraryManagerOptions['testSinkWrapper'];
  private readonly _isFileSystemAccessSupported: () => boolean;

  private readonly _accountQueues = new Map<string, Promise<unknown>>();
  private readonly _activeStagingTxIds = new Set<string>();
  private readonly _pendingConflicts = new Map<string, PendingConflict>();
  private readonly _activeAbortControllers = new Map<string, { accountHash: string; controller: AbortController }>();
  private readonly _ephemeralBackend = new EphemeralMemoryRehearsalStorageBackend();

  private _sessionGeneration = 1;

  constructor(options: RehearsalLibraryManagerOptions = {}) {
    this._getOpfsRoot = options.getOpfsRoot ?? defaultGetOpfsRoot;
    this._quotaEstimator = options.quotaEstimator ?? defaultQuotaEstimator;
    this._persistenceChecker = options.persistenceChecker ?? defaultPersistenceChecker;
    this._now = options.now ?? (() => new Date());
    this._txIdGenerator = options.txIdGenerator ?? defaultTxIdGenerator;
    this._testSinkWrapper = options.testSinkWrapper;
    this._isFileSystemAccessSupported =
      options.isFileSystemAccessSupported ??
      (() => typeof window !== 'undefined' && 'showOpenFilePicker' in window);
  }

  /**
   * Computes an isolated account namespace hash using SHA-256 over
   * `louvaio-rehearsal-ns-v1:<trimmedUserId>`.
   */
  static computeAccountNamespaceHash(userId: string): string {
    const trimmed = assertNonEmptyUserId(userId);
    const hasher = new Sha256Hasher();
    hasher.update(new TextEncoder().encode(`louvaio-rehearsal-ns-v1:${trimmed}`));
    return hasher.digestHex();
  }

  get isFileSystemAccessSupported(): boolean {
    return this._isFileSystemAccessSupported();
  }

  /**
   * Invalidates the active UI/auth session:
   * - Increments generation so any in-flight async step aborts cleanly.
   * - Aborts all active operation controllers.
   * - Clears pending conflicts, active staging markers, and in-memory fallback files/handles.
   * - Never deletes persisted OPFS packages on disk.
   */
  invalidateSession(): void {
    this._sessionGeneration += 1;
    for (const { controller } of this._activeAbortControllers.values()) {
      controller.abort();
    }
    this._activeAbortControllers.clear();
    this._pendingConflicts.clear();
    this._activeStagingTxIds.clear();
    this._ephemeralBackend.clearAll();
  }

  /**
   * Cooperatively cancels an active operation (or all active operations if omitted).
   */
  cancelActiveOperation(operationId?: string): boolean {
    if (operationId !== undefined) {
      const active = this._activeAbortControllers.get(operationId);
      if (!active) {
        return false;
      }
      active.controller.abort();
      return true;
    }
    let cancelledAny = false;
    for (const { controller } of this._activeAbortControllers.values()) {
      controller.abort();
      cancelledAny = true;
    }
    return cancelledAny;
  }

  private _isStale(sessionGen: number, userId: string): boolean {
    if (sessionGen !== this._sessionGeneration) {
      return true;
    }
    try {
      assertNonEmptyUserId(userId);
      return false;
    } catch {
      return true;
    }
  }

  private _assertNotStaleOrAborted(sessionGen: number, userId: string, signal?: AbortSignal): void {
    if (this._isStale(sessionGen, userId)) {
      throw new SessionStaleError();
    }
    if (signal?.aborted) {
      throw new OperationCancelledError();
    }
  }

  private _enqueueAccountMutation<T>(accountHash: string, fn: () => Promise<T>): Promise<T> {
    const previous = this._accountQueues.get(accountHash) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this._accountQueues.set(accountHash, settled);
    return next.finally(() => {
      if (this._accountQueues.get(accountHash) === settled) {
        this._accountQueues.delete(accountHash);
      }
    });
  }

  private async _resolveBackend(): Promise<
    { mode: 'opfs'; opfsRoot: OpfsDirectoryHandleLike } | { mode: 'ephemeral-fallback' }
  > {
    try {
      const root = await this._getOpfsRoot();
      if (!root) {
        return { mode: 'ephemeral-fallback' };
      }
      return { mode: 'opfs', opfsRoot: root };
    } catch {
      return { mode: 'ephemeral-fallback' };
    }
  }

  private async _getAccountRootDirs(
    opfsRoot: OpfsDirectoryHandleLike,
    accountHash: string,
  ): Promise<{
    accountDir: OpfsDirectoryHandleLike;
    packagesDir: OpfsDirectoryHandleLike;
    stagingDir: OpfsDirectoryHandleLike;
    backupsDir: OpfsDirectoryHandleLike;
  }> {
    const libDir = await opfsRoot.getDirectoryHandle(ROOT_LIBRARY_DIR, { create: true });
    const accountDir = await libDir.getDirectoryHandle(accountHash, { create: true });
    const packagesDir = await accountDir.getDirectoryHandle(PACKAGES_DIR_NAME, { create: true });
    const stagingDir = await accountDir.getDirectoryHandle(STAGING_DIR_NAME, { create: true });
    const backupsDir = await accountDir.getDirectoryHandle(BACKUPS_DIR_NAME, { create: true });
    return { accountDir, packagesDir, stagingDir, backupsDir };
  }

  private async _openOpfsSink(
    context: TestSinkContext,
    fileHandle: OpfsFileHandleLike,
  ): Promise<RehearsalEntryWritableSink> {
    const writable = await fileHandle.createWritable({ keepExistingData: false });
    const baseSink: RehearsalEntryWritableSink = {
      write: (chunk) => writable.write(chunk),
      close: () => writable.close(),
      abort: (reason) => (writable.abort ? writable.abort(reason) : Promise.resolve()),
    };
    return this._testSinkWrapper ? this._testSinkWrapper(context, baseSink) : baseSink;
  }

  private async _writeBytesToOpfsFile(
    context: TestSinkContext,
    dir: OpfsDirectoryHandleLike,
    fileName: string,
    bytes: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const sink = await this._openOpfsSink(context, fileHandle);
    let closed = false;
    try {
      for (let off = 0; off < bytes.byteLength; off += CHUNK_BYTES) {
        if (signal?.aborted) {
          throw new OperationCancelledError();
        }
        const chunk = bytes.subarray(off, Math.min(bytes.byteLength, off + CHUNK_BYTES));
        await sink.write(chunk);
      }
      if (bytes.byteLength === 0) {
        await sink.write(new Uint8Array(0));
      }
      await sink.close();
      closed = true;
    } catch (err) {
      if (!closed && sink.abort) {
        try {
          await sink.abort(err);
        } catch {
          // Preserve primary error
        }
      }
      throw err;
    }
  }

  private async _copyBlobToOpfsFile(
    context: TestSinkContext,
    dir: OpfsDirectoryHandleLike,
    fileName: string,
    blob: Blob,
    options: {
      sessionGen: number;
      userId: string;
      signal?: AbortSignal;
      onChunk?: (writtenBytes: number, totalBytes: number) => void;
    },
  ): Promise<void> {
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const sink = await this._openOpfsSink(context, fileHandle);
    let closed = false;
    let pos = 0;
    try {
      while (pos < blob.size) {
        this._assertNotStaleOrAborted(options.sessionGen, options.userId, options.signal);
        const end = Math.min(blob.size, pos + CHUNK_BYTES);
        const slice = blob.slice(pos, end);
        const buf = new Uint8Array(await readBlobAsArrayBuffer(slice));
        await sink.write(buf);
        pos = end;
        options.onChunk?.(pos, blob.size);
      }
      if (blob.size === 0) {
        await sink.write(new Uint8Array(0));
      }
      this._assertNotStaleOrAborted(options.sessionGen, options.userId, options.signal);
      await sink.close();
      closed = true;
    } catch (err) {
      if (!closed && sink.abort) {
        try {
          await sink.abort(err);
        } catch {
          // Preserve primary error
        }
      }
      throw err;
    }
  }

  private async _writeIndexAtomic(
    accountDir: OpfsDirectoryHandleLike,
    accountHash: string,
    packages: LocalWebRehearsalPackageRecord[],
  ): Promise<void> {
    const payload: RehearsalIndexFileV1 = {
      schemaVersion: 1,
      accountNamespaceHash: accountHash,
      updatedAt: this._now().toISOString(),
      packages: packages.map(clonePackageRecord),
    };
    const encoded = new TextEncoder().encode(JSON.stringify(payload, null, 2));
    await this._writeBytesToOpfsFile(
      { stage: 'index', fileName: INDEX_TMP_FILE_NAME },
      accountDir,
      INDEX_TMP_FILE_NAME,
      encoded,
    );
    await this._writeBytesToOpfsFile(
      { stage: 'index', fileName: INDEX_FILE_NAME },
      accountDir,
      INDEX_FILE_NAME,
      encoded,
    );
    await removeEntryIfExists(accountDir, INDEX_TMP_FILE_NAME, false);
  }

  private async _readOrInitIndex(
    accountDir: OpfsDirectoryHandleLike,
    accountHash: string,
  ): Promise<{ index: RehearsalIndexFileV1; recoveredTmp: number }> {
    const mainRead = await readJsonFileIfPresent<unknown>(accountDir, INDEX_FILE_NAME);
    const tmpRead = await readJsonFileIfPresent<unknown>(accountDir, INDEX_TMP_FILE_NAME);
    let recoveredTmp = 0;

    let resolved: RehearsalIndexFileV1 | null = null;
    if (mainRead.exists && isValidIndexFile(mainRead.data, accountHash)) {
      resolved = mainRead.data;
    } else if (tmpRead.exists && isValidIndexFile(tmpRead.data, accountHash)) {
      resolved = tmpRead.data;
      const encoded = new TextEncoder().encode(JSON.stringify(resolved, null, 2));
      await this._writeBytesToOpfsFile(
        { stage: 'index', fileName: INDEX_FILE_NAME },
        accountDir,
        INDEX_FILE_NAME,
        encoded,
      );
    }

    if (tmpRead.exists) {
      await removeEntryIfExists(accountDir, INDEX_TMP_FILE_NAME, false);
      recoveredTmp += 1;
    }

    if (!resolved) {
      resolved = {
        schemaVersion: 1,
        accountNamespaceHash: accountHash,
        updatedAt: this._now().toISOString(),
        packages: [],
      };
      if (!mainRead.exists || mainRead.invalidJson) {
        await this._writeIndexAtomic(accountDir, accountHash, resolved.packages);
      }
    }

    return { index: resolved, recoveredTmp };
  }

  private async _queryQuota(occupiedByAccountBytes: number, packageCount: number, accountHash: string, storageMode: RehearsalStorageMode): Promise<RehearsalStorageSummary> {
    const est = await this._quotaEstimator();
    const persistentGranted =
      storageMode === 'opfs' ? await this._persistenceChecker() : false;
    const availableBytes =
      est.quota !== null && est.usage !== null ? Math.max(0, est.quota - est.usage) : null;
    return {
      storageMode,
      persistentGranted,
      persistentWarning:
        storageMode === 'opfs' ? OPFS_PERSISTENT_WARNING : EPHEMERAL_PERSISTENT_WARNING,
      accountNamespaceHash: accountHash,
      quotaBytes: est.quota,
      usageBytes: est.usage,
      availableBytes,
      occupiedByAccountBytes,
      requiredReserveBytes: LIMITS_V1.minFreeSpaceReserveBytes,
      packageCount,
    };
  }

  private async _reconcileOpfsPackageMetadata(
    packagesDir: OpfsDirectoryHandleLike,
    accountHash: string,
    record: LocalWebRehearsalPackageRecord,
  ): Promise<{ record: LocalWebRehearsalPackageRecord; changed: boolean }> {
    const next = clonePackageRecord(record);
    next.storageMode = 'opfs';
    next.bindingStatus = 'unlinked';

    try {
      const pkgDir = await tryGetDirectoryHandle(packagesDir, record.packageId);
      if (!pkgDir) {
        next.integrityState = 'missingFiles';
        next.integrityCode = 'MISSING_PACKAGE_DIRECTORY';
        next.integrityMessage = 'Diretório do pacote não encontrado no armazenamento local.';
        next.isReadyForLocalUse = false;
        return { record: next, changed: true };
      }

      const commitRead = await readJsonFileIfPresent<unknown>(pkgDir, COMMIT_FILE_NAME);
      if (!commitRead.exists) {
        next.integrityState = 'incomplete';
        next.integrityCode = 'MISSING_COMMIT_MARKER';
        next.integrityMessage = 'Marcador de commit ausente; pacote incompleto.';
        next.isReadyForLocalUse = false;
        return { record: next, changed: true };
      }
      if (
        commitRead.invalidJson ||
        !isValidCommitMarker(commitRead.data, accountHash, record.packageId) ||
        commitRead.data.compositeSha256 !== record.compositeSha256 ||
        commitRead.data.manifestSha256 !== record.manifestSha256 ||
        commitRead.data.revision !== record.revision
      ) {
        next.integrityState = 'corrupted';
        next.integrityCode = 'INVALID_COMMIT_MARKER';
        next.integrityMessage = 'Marcador de commit inválido ou divergente do índice.';
        next.isReadyForLocalUse = false;
        return { record: next, changed: true };
      }

      const expectedFiles: Array<{ fileName: string; expectedBytes: number | null }> = [
        { fileName: 'manifest.json', expectedBytes: null },
        { fileName: ARCHIVE_FILE_NAME, expectedBytes: record.archiveBytes },
        ...REQUIRED_STEM_IDS_V1.map((id) => ({
          fileName: record.stems[id].internalFileName,
          expectedBytes: record.stems[id].byteLength,
        })),
      ];
      if (record.original) {
        expectedFiles.push({
          fileName: record.original.internalFileName,
          expectedBytes: record.original.byteLength,
        });
      }

      const commitFileMap = new Map(
        commitRead.data.files.map((f) => [f.fileName, f.byteLength] as const),
      );

      const resolvedHandles: Array<{
        expected: { fileName: string; expectedBytes: number | null };
        handle: OpfsFileHandleLike;
      }> = [];

      for (const expected of expectedFiles) {
        const handle = await tryGetFileHandle(pkgDir, expected.fileName);
        if (!handle) {
          next.integrityState = 'missingFiles';
          next.integrityCode = 'MISSING_PACKAGE_FILES';
          next.integrityMessage = `Arquivo obrigatório ausente: ${expected.fileName}.`;
          next.isReadyForLocalUse = false;
          return { record: next, changed: true };
        }
        resolvedHandles.push({ expected, handle });
      }

      for (const { expected, handle } of resolvedHandles) {
        const file = await handle.getFile();
        const targetBytes =
          expected.expectedBytes ?? commitFileMap.get(expected.fileName) ?? null;
        if (
          file.size === 0 ||
          (targetBytes !== null && file.size !== targetBytes) ||
          (expected.fileName === 'manifest.json' && file.size > LIMITS_V1.maxManifestBytes)
        ) {
          next.integrityState = 'incomplete';
          next.integrityCode = 'TRUNCATED_OR_SIZE_MISMATCH';
          next.integrityMessage = `Tamanho divergente em ${expected.fileName} (esperado ${targetBytes}, encontrado ${file.size}).`;
          next.isReadyForLocalUse = false;
          return { record: next, changed: true };
        }
      }

      // Preserve 'corrupted' if deep SHA-256 verification previously failed on disk.
      if (record.integrityState === 'corrupted') {
        next.isReadyForLocalUse = false;
        return { record: next, changed: false };
      }

      const wasNotVerified =
        record.integrityState !== 'verified' || !record.isReadyForLocalUse;
      next.integrityState = 'verified';
      next.integrityCode = null;
      next.integrityMessage = null;
      next.isReadyForLocalUse = true;
      return { record: next, changed: wasNotVerified };
    } catch (err) {
      if (isNotAllowedError(err)) {
        next.integrityState = 'permissionDenied';
        next.integrityCode = 'PERMISSION_DENIED';
        next.integrityMessage = 'Permissão negada para ler os arquivos locais do pacote.';
        next.isReadyForLocalUse = false;
        return { record: next, changed: true };
      }
      next.integrityState = 'incomplete';
      next.integrityCode = 'RECONCILIATION_ERROR';
      next.integrityMessage = err instanceof Error ? err.message : String(err);
      next.isReadyForLocalUse = false;
      return { record: next, changed: true };
    }
  }

  private async _restoreBackupToPackageDir(
    backupsDir: OpfsDirectoryHandleLike,
    packagesDir: OpfsDirectoryHandleLike,
    backupDirName: string,
    packageId: string,
    sessionGen: number,
    userId: string,
  ): Promise<void> {
    const backupDir = await backupsDir.getDirectoryHandle(backupDirName, { create: false });
    const pkgDir = await packagesDir.getDirectoryHandle(packageId, { create: true });

    await clearDirectoryContents(pkgDir);

    const backupEntries = await listDirectoryEntries(backupDir);
    let commitHandle: OpfsFileHandleLike | null = null;
    for (const [name, handle] of backupEntries) {
      if (name === BACKUP_READY_FILE_NAME) continue;
      if (name === COMMIT_FILE_NAME) {
        commitHandle = handle as OpfsFileHandleLike;
        continue;
      }
      if ('getFile' in handle) {
        const file = await handle.getFile();
        await this._copyBlobToOpfsFile(
          { stage: 'rollback', fileName: name, packageId },
          pkgDir,
          name,
          file,
          { sessionGen, userId },
        );
      }
    }

    if (commitHandle) {
      const commitFile = await commitHandle.getFile();
      await this._copyBlobToOpfsFile(
        { stage: 'rollback', fileName: COMMIT_FILE_NAME, packageId },
        pkgDir,
        COMMIT_FILE_NAME,
        commitFile,
        { sessionGen, userId },
      );
    }

    await removeEntryIfExists(backupsDir, backupDirName, true);
  }

  /**
   * Loads the library for a given user account, performing crash/reload recovery
   * and reconciling indexed packages against disk state.
   */
  async loadLibrary(options: LoadRehearsalLibraryOptions): Promise<RehearsalLibrarySnapshot> {
    const userId = assertNonEmptyUserId(options.userId);
    const sessionGen = this._sessionGeneration;
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
    const backend = await this._resolveBackend();

    if (backend.mode === 'ephemeral-fallback') {
      return this._enqueueAccountMutation(accountHash, async () => {
        this._assertNotStaleOrAborted(sessionGen, userId);
        const store = this._ephemeralBackend.getOrCreateAccount(accountHash);
        const packages = Array.from(store.packages.values()).map((entry) =>
          clonePackageRecord(entry.record),
        );
        const occupied = packages.reduce((sum, p) => sum + p.totalOccupiedBytes, 0);
        const storageSummary = await this._queryQuota(
          occupied,
          packages.length,
          accountHash,
          'ephemeral-fallback',
        );
        const corruptedOrIncompleteCount = packages.filter((p) => !p.isReadyForLocalUse).length;
        return {
          packages,
          storageSummary,
          recoveredOrphanedCount: 0,
          corruptedOrIncompleteCount,
        };
      });
    }

    return this._enqueueAccountMutation(accountHash, async () => {
      this._assertNotStaleOrAborted(sessionGen, userId);
      const { accountDir, packagesDir, stagingDir, backupsDir } = await this._getAccountRootDirs(
        backend.opfsRoot,
        accountHash,
      );

      let recoveredOrphanedCount = 0;
      const { index, recoveredTmp } = await this._readOrInitIndex(accountDir, accountHash);
      recoveredOrphanedCount += recoveredTmp;

      const indexByPackageId = new Map(index.packages.map((p) => [p.packageId, p] as const));

      // 1. Recover interrupted backups/*.backup
      const backupEntries = await listDirectoryEntries(backupsDir);
      for (const [entryName, entryHandle] of backupEntries) {
        if (!entryName.endsWith('.backup') || !('getDirectoryHandle' in entryHandle)) {
          await removeEntryIfExists(backupsDir, entryName, true);
          recoveredOrphanedCount += 1;
          continue;
        }
        const readyRead = await readJsonFileIfPresent<unknown>(
          entryHandle,
          BACKUP_READY_FILE_NAME,
        );
        if (!readyRead.exists || !isValidBackupMarker(readyRead.data, accountHash)) {
          await removeEntryIfExists(backupsDir, entryName, true);
          recoveredOrphanedCount += 1;
          continue;
        }

        const backupMarker = readyRead.data;
        const indexed = indexByPackageId.get(backupMarker.packageId);
        const pkgDir = await tryGetDirectoryHandle(packagesDir, backupMarker.packageId);
        const commitRead = pkgDir
          ? await readJsonFileIfPresent<unknown>(pkgDir, COMMIT_FILE_NAME)
          : { exists: false, data: null, invalidJson: false };

        const commitMatchesIndexed =
          Boolean(indexed) &&
          commitRead.exists &&
          isValidCommitMarker(commitRead.data, accountHash, backupMarker.packageId) &&
          commitRead.data.compositeSha256 === indexed!.compositeSha256 &&
          commitRead.data.manifestSha256 === indexed!.manifestSha256 &&
          commitRead.data.revision === indexed!.revision;

        if (
          indexed &&
          !commitMatchesIndexed &&
          backupMarker.compositeSha256 === indexed.compositeSha256 &&
          backupMarker.manifestSha256 === indexed.manifestSha256 &&
          backupMarker.revision === indexed.revision
        ) {
          await this._restoreBackupToPackageDir(
            backupsDir,
            packagesDir,
            entryName,
            backupMarker.packageId,
            sessionGen,
            userId,
          );
          recoveredOrphanedCount += 1;
        } else {
          await removeEntryIfExists(backupsDir, entryName, true);
          recoveredOrphanedCount += 1;
        }
      }

      // 2. Recover orphaned staging/* (preserving active staging txIds & pending conflicts)
      const activeTxSet = new Set<string>(this._activeStagingTxIds);
      for (const pending of this._pendingConflicts.values()) {
        if (pending.accountNamespaceHash === accountHash) {
          activeTxSet.add(pending.txId);
        }
      }
      const stagingEntries = await listDirectoryEntries(stagingDir);
      for (const [txName] of stagingEntries) {
        if (!activeTxSet.has(txName)) {
          await removeEntryIfExists(stagingDir, txName, true);
          recoveredOrphanedCount += 1;
        }
      }

      // 3. Remove orphaned packages/<unindexedId>
      const packageDirEntries = await listDirectoryEntries(packagesDir);
      for (const [pkgId] of packageDirEntries) {
        if (!indexByPackageId.has(pkgId)) {
          await removeEntryIfExists(packagesDir, pkgId, true);
          recoveredOrphanedCount += 1;
        }
      }

      // 4. Reconcile all indexed packages against disk
      let indexChanged = false;
      const reconciledPackages: LocalWebRehearsalPackageRecord[] = [];
      for (const pkg of index.packages) {
        const res = await this._reconcileOpfsPackageMetadata(packagesDir, accountHash, pkg);
        if (res.changed) {
          indexChanged = true;
        }
        reconciledPackages.push(res.record);
      }

      if (indexChanged) {
        this._assertNotStaleOrAborted(sessionGen, userId);
        await this._writeIndexAtomic(accountDir, accountHash, reconciledPackages);
      }

      const occupied = reconciledPackages.reduce((sum, p) => sum + p.totalOccupiedBytes, 0);
      const storageSummary = await this._queryQuota(
        occupied,
        reconciledPackages.length,
        accountHash,
        'opfs',
      );
      const corruptedOrIncompleteCount = reconciledPackages.filter(
        (p) => !p.isReadyForLocalUse,
      ).length;

      return {
        packages: reconciledPackages,
        storageSummary,
        recoveredOrphanedCount,
        corruptedOrIncompleteCount,
      };
    });
  }

  private _buildPackageRecord(params: {
    accountNamespaceHash: string;
    validation: RehearsalPackageValidationResult;
    manifestCheck: ParsedManifestCrossCheck;
    archiveBytes: number;
    storageMode: RehearsalStorageMode;
    customLabel?: string | null;
    storageLocationLabel: string;
    nowIso: string;
  }): LocalWebRehearsalPackageRecord {
    const { validation, manifestCheck } = params;
    const identity = validation.packageIdentity!;
    const summary = validation.manifestSummary!;

    const stemMap: Partial<Record<RequiredStemId, LocalWebRehearsalStemMetadata>> = {};
    let originalMeta: LocalWebRehearsalStemMetadata | null = null;

    for (const entry of validation.verifiedEntries) {
      if (entry.role === 'stem' && entry.stemId && entry.audioInfo) {
        stemMap[entry.stemId] = {
          id: entry.stemId,
          internalFileName: resolveInternalFileName(entry),
          container: entry.audioInfo.container,
          codec: entry.audioInfo.codec,
          byteLength: entry.uncompressedBytes,
          sha256: entry.sha256,
          decodedFrames: entry.audioInfo.decodedFrames,
          sampleRate: entry.audioInfo.sampleRate,
          channels: entry.audioInfo.channels,
        };
      } else if (entry.role === 'original' && entry.audioInfo) {
        originalMeta = {
          id: 'original',
          internalFileName: resolveInternalFileName(entry),
          container: entry.audioInfo.container,
          codec: entry.audioInfo.codec,
          byteLength: entry.uncompressedBytes,
          sha256: entry.sha256,
          decodedFrames: entry.audioInfo.decodedFrames,
          sampleRate: entry.audioInfo.sampleRate,
          channels: entry.audioInfo.channels,
        };
      }
    }

    for (const stemId of REQUIRED_STEM_IDS_V1) {
      if (!stemMap[stemId]) {
        throw new Error(`Missing verified stem metadata for ${stemId}.`);
      }
    }

    const customLabel = params.customLabel ?? null;
    const extractedBytes = validation.budget.actualExtractedBytes;
    const totalOccupiedBytes =
      params.storageMode === 'opfs' ? params.archiveBytes + extractedBytes : params.archiveBytes;

    return {
      packageId: identity.packageId,
      accountNamespaceHash: params.accountNamespaceHash,
      revision: manifestCheck.revision,
      title: summary.displayName,
      customLabel,
      displayName: customLabel ?? summary.displayName,
      format: summary.format,
      formatVersion: summary.formatVersion,
      createdAt: summary.createdAt,
      importedAt: params.nowIso,
      lastValidatedAt: params.nowIso,
      integrityState: 'verified',
      integrityCode: null,
      integrityMessage: null,
      sampleRate: manifestCheck.sampleRate,
      channels: manifestCheck.channels,
      totalFrames: manifestCheck.totalFrames,
      durationSeconds: summary.durationSeconds,
      archiveBytes: params.archiveBytes,
      extractedBytes,
      totalOccupiedBytes,
      manifestSha256: identity.manifestSha256,
      compositeSha256: identity.compositeSha256!,
      stems: stemMap as Record<RequiredStemId, LocalWebRehearsalStemMetadata>,
      original: originalMeta,
      storageMode: params.storageMode,
      storageLocationLabel: params.storageLocationLabel,
      bindingStatus: 'unlinked',
      usageRightsDeclaration: manifestCheck.usageRightsDeclaration,
      isReadyForLocalUse: true,
    };
  }

  private _mapValidationFailureOutcome(
    validation: RehearsalPackageValidationResult,
  ): RehearsalOperationOutcome {
    const code = validation.errorCode ?? undefined;
    const detail = validation.errorMessage ?? 'Pacote inválido.';
    if (validation.status === 'cancelled') {
      return {
        category: 'cancelled',
        title: 'Importação cancelada',
        message: detail,
        errorCode: code ?? 'VALIDATION_CANCELLED',
      };
    }
    if (validation.status === 'insufficientSpace') {
      return {
        category: 'insufficientSpace',
        title: 'Espaço insuficiente',
        message: detail,
        errorCode: code ?? 'INSUFFICIENT_STORAGE_SPACE',
      };
    }
    if (validation.status === 'unsupported') {
      return {
        category: 'incompatible',
        title: 'Pacote incompatível',
        message: detail,
        errorCode: code,
      };
    }
    return {
      category: 'corrupted',
      title: 'Pacote corrompido ou incompleto',
      message: detail,
      errorCode: code,
    };
  }

  private _mapCaughtErrorOutcome(err: unknown, defaultTitle: string): RehearsalOperationOutcome {
    if (err instanceof SessionStaleError || err instanceof OperationCancelledError || isAbortError(err)) {
      return {
        category: 'cancelled',
        title: 'Operação cancelada',
        message: 'A operação foi cancelada ou a sessão foi alterada.',
        errorCode: 'VALIDATION_CANCELLED',
      };
    }
    if (isQuotaExceededError(err)) {
      return {
        category: 'insufficientSpace',
        title: 'Espaço insuficiente no navegador',
        message: 'O navegador atingiu o limite de armazenamento local (QuotaExceededError).',
        errorCode: 'INSUFFICIENT_STORAGE_SPACE',
      };
    }
    if (isNotAllowedError(err)) {
      return {
        category: 'permissionDenied',
        title: 'Permissão negada',
        message: 'Permissão negada para acessar o arquivo ou armazenamento local.',
        errorCode: 'PERMISSION_DENIED',
      };
    }
    if (isNotFoundError(err)) {
      return {
        category: 'corrupted',
        title: 'Arquivo não encontrado',
        message: 'O arquivo de origem ou destino não foi encontrado.',
        errorCode: 'MISSING_PACKAGE_FILES',
      };
    }
    return {
      category: 'recoverableFailure',
      title: defaultTitle,
      message: err instanceof Error ? err.message : String(err),
      errorCode: 'OPERATION_FAILED',
    };
  }

  private async _readCurrentExistingPackages(
    backend: { mode: 'opfs'; opfsRoot: OpfsDirectoryHandleLike } | { mode: 'ephemeral-fallback' },
    accountHash: string,
  ): Promise<{ existingRecords: LocalWebRehearsalPackageRecord[]; existingMatchInput: ExistingPackageRecord[] }> {
    if (backend.mode === 'ephemeral-fallback') {
      const store = this._ephemeralBackend.getOrCreateAccount(accountHash);
      const records = Array.from(store.packages.values()).map((e) => clonePackageRecord(e.record));
      return {
        existingRecords: records,
        existingMatchInput: records.map((r) => ({
          packageId: r.packageId,
          manifestSha256: r.manifestSha256,
          compositeSha256: r.compositeSha256,
        })),
      };
    }

    const { accountDir } = await this._getAccountRootDirs(backend.opfsRoot, accountHash);
    const { index } = await this._readOrInitIndex(accountDir, accountHash);
    return {
      existingRecords: index.packages.map(clonePackageRecord),
      existingMatchInput: index.packages.map((r) => ({
        packageId: r.packageId,
        manifestSha256: r.manifestSha256,
        compositeSha256: r.compositeSha256,
      })),
    };
  }

  private async _extractAndVerifyInOpfsStaging(params: {
    stagedZipFile: File | Blob;
    txStagingDir: OpfsDirectoryHandleLike;
    txId: string;
    existingPackages: ExistingPackageRecord[];
    signal: AbortSignal;
    availableStorageBytes: number | null;
    sessionGen: number;
    userId: string;
    operationId: string;
    onProgress?: (progress: RehearsalOperationProgress) => void;
  }): Promise<{
    extractionResult: RehearsalPackageValidationResult;
    manifestCheck: ParsedManifestCrossCheck;
    extractedFileEntries: RehearsalCommitFileEntry[];
  }> {
    const extractedDir = await params.txStagingDir.getDirectoryHandle(EXTRACTED_DIR_NAME, {
      create: true,
    });
    await clearDirectoryContents(extractedDir);

    const extractedInternalNames = new Map<string, VerifiedRehearsalEntry>();

    const extractionResult = await validateAndExtractRehearsalPackage(params.stagedZipFile, {
      signal: params.signal,
      availableStorageBytes: params.availableStorageBytes ?? undefined,
      includeSourceCopy: false,
      existingPackages: params.existingPackages,
      onExtractProgress: (extractedBytes, totalBytes) => {
        params.onProgress?.({
          operationId: params.operationId,
          phase: 'extracting',
          phaseLabel: 'Extraindo e verificando arquivos em staging...',
          bytesProcessed: extractedBytes,
          totalBytes,
        });
      },
      openTargetSink: async (entry) => {
        this._assertNotStaleOrAborted(params.sessionGen, params.userId, params.signal);
        const internalFileName = resolveInternalFileName(entry);
        extractedInternalNames.set(internalFileName, entry);
        const fileHandle = await extractedDir.getFileHandle(internalFileName, { create: true });
        return this._openOpfsSink(
          { stage: 'extracting', fileName: internalFileName, txId: params.txId },
          fileHandle,
        );
      },
    });

    if (!extractionResult.readyForPublication || extractionResult.status !== 'valid') {
      return {
        extractionResult,
        manifestCheck: {
          packageId: '',
          revision: 0,
          sampleRate: 0,
          channels: 0,
          totalFrames: 0,
          usageRightsDeclaration: '',
        },
        extractedFileEntries: [],
      };
    }

    // Read back extracted files from staging to verify actual persisted SHA-256 and byteLength
    const extractedFileEntries: RehearsalCommitFileEntry[] = [];
    let manifestBytes: Uint8Array | null = null;

    for (const [internalFileName, entry] of extractedInternalNames.entries()) {
      this._assertNotStaleOrAborted(params.sessionGen, params.userId, params.signal);
      const handle = await tryGetFileHandle(extractedDir, internalFileName);
      if (!handle) {
        throw new Error(`Extracted file missing in staging: ${internalFileName}`);
      }
      const file = await handle.getFile();
      if (internalFileName === 'manifest.json') {
        if (file.size > LIMITS_V1.maxManifestBytes) {
          throw new Error(`manifest.json exceeds ${LIMITS_V1.maxManifestBytes} bytes.`);
        }
        manifestBytes = new Uint8Array(await readBlobAsArrayBuffer(file));
      }
      const { sha256, byteLength } = await computeBlobSha256AndSize(file);
      if (byteLength !== entry.uncompressedBytes || sha256 !== entry.sha256) {
        throw new Error(`Staging readback verification failed for ${internalFileName}.`);
      }
      extractedFileEntries.push({
        fileName: internalFileName,
        byteLength,
        sha256,
      });
    }

    if (!manifestBytes) {
      throw new Error('manifest.json missing after staging extraction.');
    }

    const manifestCheck = parseManifestForCrossCheck(manifestBytes);
    const identity = extractionResult.packageIdentity!;
    const summary = extractionResult.manifestSummary!;
    if (
      manifestCheck.packageId !== identity.packageId.toLowerCase() ||
      manifestCheck.revision !== summary.revision ||
      manifestCheck.sampleRate !== summary.sampleRate ||
      manifestCheck.channels !== summary.channels ||
      manifestCheck.totalFrames !== summary.totalFrames
    ) {
      throw new Error('Manifest cross-check mismatch with validated summary.');
    }

    return {
      extractionResult,
      manifestCheck,
      extractedFileEntries,
    };
  }

  private async _extractManifestOnlyInMemory(
    sourceFile: File | Blob,
    signal: AbortSignal,
    existingPackages: ExistingPackageRecord[],
  ): Promise<{
    extractionResult: RehearsalPackageValidationResult;
    manifestCheck: ParsedManifestCrossCheck;
  }> {
    const manifestChunks: Uint8Array[] = [];
    let manifestBytesLen = 0;

    const extractionResult = await validateAndExtractRehearsalPackage(sourceFile, {
      signal,
      includeSourceCopy: false,
      existingPackages,
      openTargetSink: async (entry) => {
        // Always resolve canonical name to verify entry role/container invariants
        resolveInternalFileName(entry);
        if (entry.role === 'manifest') {
          return {
            async write(chunk) {
              if (manifestBytesLen + chunk.byteLength > LIMITS_V1.maxManifestBytes) {
                throw new Error(`manifest.json exceeds ${LIMITS_V1.maxManifestBytes} bytes.`);
              }
              manifestChunks.push(new Uint8Array(chunk));
              manifestBytesLen += chunk.byteLength;
            },
            async close() {
              // no-op
            },
            async abort() {
              manifestChunks.length = 0;
              manifestBytesLen = 0;
            },
          };
        }
        return {
          async write() {
            // Discarding media stream in ephemeral-fallback after hash/CRC verification
          },
          async close() {
            // no-op
          },
        };
      },
    });

    if (!extractionResult.readyForPublication || extractionResult.status !== 'valid') {
      return {
        extractionResult,
        manifestCheck: {
          packageId: '',
          revision: 0,
          sampleRate: 0,
          channels: 0,
          totalFrames: 0,
          usageRightsDeclaration: '',
        },
      };
    }

    const manifestBytes = new Uint8Array(manifestBytesLen);
    let offset = 0;
    for (const c of manifestChunks) {
      manifestBytes.set(c, offset);
      offset += c.byteLength;
    }

    const manifestCheck = parseManifestForCrossCheck(manifestBytes);
    return { extractionResult, manifestCheck };
  }

  private async _commitStagedToPackageDir(params: {
    txStagingDir: OpfsDirectoryHandleLike;
    packagesDir: OpfsDirectoryHandleLike;
    packageId: string;
    accountHash: string;
    record: LocalWebRehearsalPackageRecord;
    extractedFileEntries: RehearsalCommitFileEntry[];
    sessionGen: number;
    userId: string;
    signal: AbortSignal;
    clearExistingFirst: boolean;
  }): Promise<void> {
    const pkgDir = await params.packagesDir.getDirectoryHandle(params.packageId, { create: true });
    if (params.clearExistingFirst) {
      await removeEntryIfExists(pkgDir, COMMIT_FILE_NAME, false);
      const keepNames = new Set([
        ARCHIVE_FILE_NAME,
        ...params.extractedFileEntries.map((e) => e.fileName),
      ]);
      const existingEntries = await listDirectoryEntries(pkgDir);
      for (const [name] of existingEntries) {
        if (!keepNames.has(name)) {
          await removeEntryIfExists(pkgDir, name, true);
        }
      }
    }

    const extractedDir = await params.txStagingDir.getDirectoryHandle(EXTRACTED_DIR_NAME, {
      create: false,
    });
    for (const entry of params.extractedFileEntries) {
      this._assertNotStaleOrAborted(params.sessionGen, params.userId, params.signal);
      const srcHandle = await extractedDir.getFileHandle(entry.fileName, { create: false });
      const srcFile = await srcHandle.getFile();
      await this._copyBlobToOpfsFile(
        { stage: 'committing', fileName: entry.fileName, packageId: params.packageId },
        pkgDir,
        entry.fileName,
        srcFile,
        { sessionGen: params.sessionGen, userId: params.userId, signal: params.signal },
      );
    }

    // Copy archive ZIP into package dir
    const stagedZipHandle = await params.txStagingDir.getFileHandle(ARCHIVE_FILE_NAME, {
      create: false,
    });
    const stagedZipFile = await stagedZipHandle.getFile();
    const zipHash = await computeBlobSha256AndSize(stagedZipFile);
    await this._copyBlobToOpfsFile(
      { stage: 'committing', fileName: ARCHIVE_FILE_NAME, packageId: params.packageId },
      pkgDir,
      ARCHIVE_FILE_NAME,
      stagedZipFile,
      { sessionGen: params.sessionGen, userId: params.userId, signal: params.signal },
    );

    this._assertNotStaleOrAborted(params.sessionGen, params.userId, params.signal);

    const commitMarker: RehearsalCommitMarkerV1 = {
      schemaVersion: 1,
      packageId: params.packageId,
      accountNamespaceHash: params.accountHash,
      revision: params.record.revision,
      manifestSha256: params.record.manifestSha256,
      compositeSha256: params.record.compositeSha256,
      archiveBytes: params.record.archiveBytes,
      extractedBytes: params.record.extractedBytes,
      committedAt: this._now().toISOString(),
      files: [
        ...params.extractedFileEntries,
        {
          fileName: ARCHIVE_FILE_NAME,
          byteLength: zipHash.byteLength,
          sha256: zipHash.sha256,
        },
      ],
    };

    const commitBytes = new TextEncoder().encode(JSON.stringify(commitMarker, null, 2));
    await this._writeBytesToOpfsFile(
      { stage: 'committing', fileName: COMMIT_FILE_NAME, packageId: params.packageId },
      pkgDir,
      COMMIT_FILE_NAME,
      commitBytes,
      params.signal,
    );
  }

  /**
   * Imports a `.louvaio-rehearsal.zip` package into the user's isolated account library.
   */
  async importPackage(options: ImportRehearsalPackageOptions): Promise<RehearsalOperationOutcome> {
    const userId = assertNonEmptyUserId(options.userId);
    const sessionGen = this._sessionGeneration;
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
    const txId = this._txIdGenerator();
    const operationId = txId;
    const abortController = new AbortController();
    this._activeAbortControllers.set(operationId, { accountHash, controller: abortController });

    let stagingDirRef: OpfsDirectoryHandleLike | null = null;
    let preserveStagingForConflict = false;

    try {
      options.onProgress?.({
        operationId,
        phase: 'picking',
        phaseLabel: 'Preparando arquivo selecionado...',
        bytesProcessed: 0,
        totalBytes: options.file?.size ?? null,
      });

      let sourceFile = options.file;
      if (!sourceFile && options.externalHandle) {
        if (options.externalHandle.queryPermission) {
          const perm = await options.externalHandle.queryPermission({ mode: 'read' });
          if (perm === 'denied') {
            return {
              category: 'permissionDenied',
              title: 'Permissão negada',
              message: 'A permissão de leitura para o arquivo selecionado foi negada.',
              errorCode: 'PERMISSION_DENIED',
            };
          }
          if (perm === 'prompt' && options.externalHandle.requestPermission) {
            const reqPerm = await options.externalHandle.requestPermission({ mode: 'read' });
            if (reqPerm !== 'granted') {
              return {
                category: 'permissionDenied',
                title: 'Permissão negada',
                message: 'A permissão de leitura não foi concedida.',
                errorCode: 'PERMISSION_DENIED',
              };
            }
          }
        }
        sourceFile = await options.externalHandle.getFile();
      }
      if (!sourceFile) {
        return {
          category: 'recoverableFailure',
          title: 'Arquivo ausente',
          message: 'Nenhum arquivo de pacote foi fornecido para importação.',
          errorCode: 'MISSING_SOURCE_FILE',
        };
      }

      this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

      // Step 2: Preflight quota check
      options.onProgress?.({
        operationId,
        phase: 'preflight',
        phaseLabel: 'Verificando espaço disponível...',
        bytesProcessed: 0,
        totalBytes: sourceFile.size,
      });

      const preflightQuota = await this._quotaEstimator();
      const preflightAvailable =
        preflightQuota.quota !== null && preflightQuota.usage !== null
          ? Math.max(0, preflightQuota.quota - preflightQuota.usage)
          : null;

      if (
        preflightAvailable !== null &&
        preflightAvailable < sourceFile.size + LIMITS_V1.minFreeSpaceReserveBytes
      ) {
        return {
          category: 'insufficientSpace',
          title: 'Espaço insuficiente',
          message: `Espaço disponível (${preflightAvailable} B) é insuficiente para o arquivo (${sourceFile.size} B) mais a reserva mínima de segurança.`,
          errorCode: 'INSUFFICIENT_STORAGE_SPACE',
        };
      }

      const backend = await this._resolveBackend();
      this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

      if (backend.mode === 'ephemeral-fallback') {
        const { existingRecords, existingMatchInput } = await this._readCurrentExistingPackages(
          backend,
          accountHash,
        );

        options.onProgress?.({
          operationId,
          phase: 'validating',
          phaseLabel: 'Validando pacote (sessão temporária)...',
          bytesProcessed: 0,
          totalBytes: sourceFile.size,
        });

        const validation = await validateRehearsalPackage(sourceFile, {
          signal: abortController.signal,
          availableStorageBytes: preflightAvailable ?? undefined,
          includeSourceCopy: false,
          existingPackages: existingMatchInput,
          onProgress: (processed, total) => {
            options.onProgress?.({
              operationId,
              phase: 'validating',
              phaseLabel: 'Validando manifesto e integridade do pacote...',
              bytesProcessed: processed,
              totalBytes: total,
            });
          },
        });

        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

        if (validation.status === 'valid' && validation.idempotencyDisposition === 'idempotent_noop') {
          const existing = existingRecords.find(
            (r) => r.packageId === validation.packageIdentity?.packageId,
          );
          return {
            category: 'idempotentNoop',
            title: 'Pacote já importado',
            message: 'Este pacote já existe localmente com o mesmo conteúdo verificado.',
            record: existing ? clonePackageRecord(existing) : undefined,
          };
        }

        if (validation.status === 'conflict') {
          const packageId = validation.packageIdentity!.packageId;
          const existingRecord = existingRecords.find((r) => r.packageId === packageId)!;
          this._pendingConflicts.set(txId, {
            txId,
            accountNamespaceHash: accountHash,
            packageId,
            storageMode: 'ephemeral-fallback',
            existingRecord: clonePackageRecord(existingRecord),
            validation,
            archiveBytes: sourceFile.size,
            ephemeralSourceFile: sourceFile,
            ephemeralExternalHandle: options.externalHandle,
          });
          return {
            category: 'conflict',
            title: 'Conflito de pacote local',
            message: `Já existe uma versão local do pacote ${packageId}. Confirme para substituir ou descarte.`,
            errorCode: 'PACKAGE_IDENTITY_CONFLICT',
            conflict: {
              packageId,
              pendingTransactionId: txId,
              existingRecord: clonePackageRecord(existingRecord),
              incomingDisplayName: validation.manifestSummary!.displayName,
              incomingRevision: validation.manifestSummary!.revision,
              incomingCompositeSha256: validation.packageIdentity!.compositeSha256!,
            },
          };
        }

        if (!validation.readyForPublication || validation.status !== 'valid') {
          return this._mapValidationFailureOutcome(validation);
        }

        const { extractionResult, manifestCheck } = await this._extractManifestOnlyInMemory(
          sourceFile,
          abortController.signal,
          existingMatchInput,
        );
        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

        if (!extractionResult.readyForPublication || extractionResult.status !== 'valid') {
          return this._mapValidationFailureOutcome(extractionResult);
        }

        const locationLabel = options.externalHandle
          ? 'Arquivo local selecionado (sessão temporária sem OPFS)'
          : 'Sessão temporária em memória (sem OPFS)';

        const newRecord = this._buildPackageRecord({
          accountNamespaceHash: accountHash,
          validation: extractionResult,
          manifestCheck,
          archiveBytes: sourceFile.size,
          storageMode: 'ephemeral-fallback',
          storageLocationLabel: locationLabel,
          nowIso: this._now().toISOString(),
        });

        return this._enqueueAccountMutation(accountHash, async () => {
          this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
          const store = this._ephemeralBackend.getOrCreateAccount(accountHash);
          const existing = store.packages.get(newRecord.packageId)?.record;
          if (existing) {
            if (
              existing.compositeSha256 === newRecord.compositeSha256 &&
              existing.manifestSha256 === newRecord.manifestSha256
            ) {
              return {
                category: 'idempotentNoop',
                title: 'Pacote já importado',
                message: 'Este pacote já existe localmente com o mesmo conteúdo verificado.',
                record: clonePackageRecord(existing),
              };
            }
            this._pendingConflicts.set(txId, {
              txId,
              accountNamespaceHash: accountHash,
              packageId: newRecord.packageId,
              storageMode: 'ephemeral-fallback',
              existingRecord: clonePackageRecord(existing),
              validation: extractionResult,
              archiveBytes: sourceFile.size,
              ephemeralSourceFile: sourceFile,
              ephemeralExternalHandle: options.externalHandle,
            });
            return {
              category: 'conflict',
              title: 'Conflito de pacote local',
              message: `Já existe uma versão local do pacote ${newRecord.packageId}.`,
              errorCode: 'PACKAGE_IDENTITY_CONFLICT',
              conflict: {
                packageId: newRecord.packageId,
                pendingTransactionId: txId,
                existingRecord: clonePackageRecord(existing),
                incomingDisplayName: newRecord.displayName,
                incomingRevision: newRecord.revision,
                incomingCompositeSha256: newRecord.compositeSha256,
              },
            };
          }

          store.packages.set(newRecord.packageId, {
            record: clonePackageRecord(newRecord),
            sourceFile,
            externalHandle: options.externalHandle,
          });
          return {
            category: 'imported',
            title: 'Pacote importado na sessão temporária',
            message: 'Pacote validado e disponível apenas durante esta sessão.',
            record: clonePackageRecord(newRecord),
          };
        });
      }

      // OPFS Mode
      const { accountDir, packagesDir, stagingDir } = await this._getAccountRootDirs(
        backend.opfsRoot,
        accountHash,
      );
      stagingDirRef = stagingDir;
      this._activeStagingTxIds.add(txId);

      const txStagingDir = await stagingDir.getDirectoryHandle(txId, { create: true });

      options.onProgress?.({
        operationId,
        phase: 'stagingCopy',
        phaseLabel: 'Copiando arquivo para área temporária (OPFS)...',
        bytesProcessed: 0,
        totalBytes: sourceFile.size,
      });

      await this._copyBlobToOpfsFile(
        { stage: 'staging', fileName: ARCHIVE_FILE_NAME, txId },
        txStagingDir,
        ARCHIVE_FILE_NAME,
        sourceFile,
        {
          sessionGen,
          userId,
          signal: abortController.signal,
          onChunk: (written, total) => {
            options.onProgress?.({
              operationId,
              phase: 'stagingCopy',
              phaseLabel: 'Copiando arquivo para área temporária (OPFS)...',
              bytesProcessed: written,
              totalBytes: total,
            });
          },
        },
      );

      this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

      const stagedZipHandle = await txStagingDir.getFileHandle(ARCHIVE_FILE_NAME, { create: false });
      const stagedZipFile = await stagedZipHandle.getFile();

      // Step 4: Query remaining storage & validate staged archive
      const afterStagingQuota = await this._quotaEstimator();
      const availableAfterStaging =
        afterStagingQuota.quota !== null && afterStagingQuota.usage !== null
          ? Math.max(0, afterStagingQuota.quota - afterStagingQuota.usage)
          : null;

      const { existingRecords, existingMatchInput } = await this._readCurrentExistingPackages(
        backend,
        accountHash,
      );

      options.onProgress?.({
        operationId,
        phase: 'validating',
        phaseLabel: 'Validando manifesto e integridade do pacote...',
        bytesProcessed: 0,
        totalBytes: stagedZipFile.size,
      });

      const validation = await validateRehearsalPackage(stagedZipFile, {
        signal: abortController.signal,
        availableStorageBytes: availableAfterStaging ?? undefined,
        includeSourceCopy: false,
        existingPackages: existingMatchInput,
        onProgress: (processed, total) => {
          options.onProgress?.({
            operationId,
            phase: 'validating',
            phaseLabel: 'Validando manifesto e integridade do pacote...',
            bytesProcessed: processed,
            totalBytes: total,
          });
        },
      });

      this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

      if (validation.status === 'valid' && validation.idempotencyDisposition === 'idempotent_noop') {
        const existing = existingRecords.find(
          (r) => r.packageId === validation.packageIdentity?.packageId,
        );
        return {
          category: 'idempotentNoop',
          title: 'Pacote já importado',
          message: 'Este pacote já existe localmente com o mesmo conteúdo verificado.',
          record: existing ? clonePackageRecord(existing) : undefined,
        };
      }

      if (
        validation.status !== 'valid' &&
        validation.status !== 'conflict'
      ) {
        return this._mapValidationFailureOutcome(validation);
      }

      // Step 5: Extra storage check after inspecting declaredExtractedBytes
      const archiveBytes = stagedZipFile.size;
      const declaredExtractedBytes = validation.budget.declaredExtractedBytes;
      const peakBytes = archiveBytes + declaredExtractedBytes;
      const reserveBytes = Math.max(
        LIMITS_V1.minFreeSpaceReserveBytes,
        Math.ceil(peakBytes * LIMITS_V1.minFreeSpaceReserveRatio),
      );
      if (
        availableAfterStaging !== null &&
        availableAfterStaging < declaredExtractedBytes + reserveBytes
      ) {
        return {
          category: 'insufficientSpace',
          title: 'Espaço insuficiente para extração',
          message: `Espaço disponível (${availableAfterStaging} B) é insuficiente para extrair (${declaredExtractedBytes} B) mantendo reserva de segurança (${reserveBytes} B).`,
          errorCode: 'INSUFFICIENT_STORAGE_SPACE',
        };
      }

      // Step 6: Conflict preservation
      if (validation.status === 'conflict') {
        const packageId = validation.packageIdentity!.packageId;
        const existingRecord = existingRecords.find((r) => r.packageId === packageId)!;
        preserveStagingForConflict = true;
        this._pendingConflicts.set(txId, {
          txId,
          accountNamespaceHash: accountHash,
          packageId,
          storageMode: 'opfs',
          existingRecord: clonePackageRecord(existingRecord),
          validation,
          archiveBytes,
        });
        return {
          category: 'conflict',
          title: 'Conflito de pacote local',
          message: `Já existe uma versão local do pacote ${packageId}. Confirme para substituir ou descarte.`,
          errorCode: 'PACKAGE_IDENTITY_CONFLICT',
          conflict: {
            packageId,
            pendingTransactionId: txId,
            existingRecord: clonePackageRecord(existingRecord),
            incomingDisplayName: validation.manifestSummary!.displayName,
            incomingRevision: validation.manifestSummary!.revision,
            incomingCompositeSha256: validation.packageIdentity!.compositeSha256!,
          },
        };
      }

      // Step 7 & 8: Extract and verify readback in staging
      const { extractionResult, manifestCheck, extractedFileEntries } =
        await this._extractAndVerifyInOpfsStaging({
          stagedZipFile,
          txStagingDir,
          txId,
          existingPackages: existingMatchInput,
          signal: abortController.signal,
          availableStorageBytes: availableAfterStaging,
          sessionGen,
          userId,
          operationId,
          onProgress: options.onProgress,
        });

      this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

      if (!extractionResult.readyForPublication || extractionResult.status !== 'valid') {
        return this._mapValidationFailureOutcome(extractionResult);
      }

      const newRecord = this._buildPackageRecord({
        accountNamespaceHash: accountHash,
        validation: extractionResult,
        manifestCheck,
        archiveBytes,
        storageMode: 'opfs',
        storageLocationLabel: 'Armazenamento interno do navegador (OPFS)',
        nowIso: this._now().toISOString(),
      });

      // Step 9: Atomic commit under account single-writer lock
      options.onProgress?.({
        operationId,
        phase: 'committing',
        phaseLabel: 'Confirmando pacote no armazenamento local...',
        bytesProcessed: 0,
        totalBytes: newRecord.totalOccupiedBytes,
      });

      return await this._enqueueAccountMutation(accountHash, async () => {
        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
        const { index } = await this._readOrInitIndex(accountDir, accountHash);
        const latestMatch = index.packages.find((p) => p.packageId === newRecord.packageId);

        if (latestMatch) {
          if (
            latestMatch.compositeSha256 === newRecord.compositeSha256 &&
            latestMatch.manifestSha256 === newRecord.manifestSha256
          ) {
            return {
              category: 'idempotentNoop',
              title: 'Pacote já importado',
              message: 'Este pacote já existe localmente com o mesmo conteúdo verificado.',
              record: clonePackageRecord(latestMatch),
            };
          }
          preserveStagingForConflict = true;
          this._pendingConflicts.set(txId, {
            txId,
            accountNamespaceHash: accountHash,
            packageId: newRecord.packageId,
            storageMode: 'opfs',
            existingRecord: clonePackageRecord(latestMatch),
            validation: extractionResult,
            archiveBytes,
          });
          return {
            category: 'conflict',
            title: 'Conflito de pacote local',
            message: `Já existe uma versão local do pacote ${newRecord.packageId}. Confirme para substituir ou descarte.`,
            errorCode: 'PACKAGE_IDENTITY_CONFLICT',
            conflict: {
              packageId: newRecord.packageId,
              pendingTransactionId: txId,
              existingRecord: clonePackageRecord(latestMatch),
              incomingDisplayName: newRecord.displayName,
              incomingRevision: newRecord.revision,
              incomingCompositeSha256: newRecord.compositeSha256,
            },
          };
        }

        try {
          await this._commitStagedToPackageDir({
            txStagingDir,
            packagesDir,
            packageId: newRecord.packageId,
            accountHash,
            record: newRecord,
            extractedFileEntries,
            sessionGen,
            userId,
            signal: abortController.signal,
            clearExistingFirst: false,
          });

          const updatedPackages = [...index.packages, clonePackageRecord(newRecord)];
          await this._writeIndexAtomic(accountDir, accountHash, updatedPackages);
        } catch (commitErr) {
          try {
            await removeEntryIfExists(packagesDir, newRecord.packageId, true);
          } catch {
            // Best-effort cleanup of uncommitted package directory
          }
          throw commitErr;
        }

        return {
          category: 'imported',
          title: 'Pacote importado com sucesso',
          message: `Pacote "${newRecord.displayName}" verificado e salvo localmente.`,
          record: clonePackageRecord(newRecord),
        };
      });
    } catch (err) {
      return this._mapCaughtErrorOutcome(err, 'Falha na importação do pacote');
    } finally {
      this._activeAbortControllers.delete(operationId);
      if (!preserveStagingForConflict) {
        this._activeStagingTxIds.delete(txId);
        if (stagingDirRef) {
          try {
            await removeEntryIfExists(stagingDirRef, txId, true);
          } catch {
            // Best-effort staging cleanup
          }
        }
      }
    }
  }

  /**
   * Confirms replacement of an existing package in conflict using the staged v2 transaction.
   * Creates a `.backup` snapshot before touching `packages/<id>` and rolls back on failure.
   */
  async confirmConflictReplace(
    options: ConfirmConflictReplaceOptions,
  ): Promise<RehearsalOperationOutcome> {
    const userId = assertNonEmptyUserId(options.userId);
    const sessionGen = this._sessionGeneration;
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
    const pending = this._pendingConflicts.get(options.pendingTransactionId);

    if (!pending || pending.accountNamespaceHash !== accountHash) {
      return {
        category: 'recoverableFailure',
        title: 'Conflito não encontrado',
        message: 'A transação pendente expirou, foi descartada ou pertence a outra conta.',
        errorCode: 'PENDING_CONFLICT_NOT_FOUND',
      };
    }

    const txId = pending.txId;
    const operationId = txId;
    const abortController = new AbortController();
    this._activeAbortControllers.set(operationId, { accountHash, controller: abortController });

    const backend = await this._resolveBackend();

    try {
      if (backend.mode === 'ephemeral-fallback' || pending.storageMode === 'ephemeral-fallback') {
        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
        if (!pending.ephemeralSourceFile) {
          return {
            category: 'recoverableFailure',
            title: 'Arquivo temporário indisponível',
            message: 'O arquivo de origem não está mais disponível na sessão.',
            errorCode: 'MISSING_SOURCE_FILE',
          };
        }

        const { extractionResult, manifestCheck } = await this._extractManifestOnlyInMemory(
          pending.ephemeralSourceFile,
          abortController.signal,
          [],
        );
        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
        if (!extractionResult.readyForPublication || extractionResult.status !== 'valid') {
          return this._mapValidationFailureOutcome(extractionResult);
        }

        const updatedRecord = this._buildPackageRecord({
          accountNamespaceHash: accountHash,
          validation: extractionResult,
          manifestCheck,
          archiveBytes: pending.archiveBytes,
          storageMode: 'ephemeral-fallback',
          customLabel: pending.existingRecord.customLabel,
          storageLocationLabel: pending.existingRecord.storageLocationLabel,
          nowIso: this._now().toISOString(),
        });

        return await this._enqueueAccountMutation(accountHash, async () => {
          this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
          const store = this._ephemeralBackend.getOrCreateAccount(accountHash);
          store.packages.set(updatedRecord.packageId, {
            record: clonePackageRecord(updatedRecord),
            sourceFile: pending.ephemeralSourceFile!,
            externalHandle: pending.ephemeralExternalHandle,
          });
          this._pendingConflicts.delete(txId);
          return {
            category: 'imported',
            title: 'Pacote substituído na sessão',
            message: `Pacote "${updatedRecord.displayName}" atualizado na sessão temporária.`,
            record: clonePackageRecord(updatedRecord),
          };
        });
      }

      const { accountDir, packagesDir, stagingDir, backupsDir } = await this._getAccountRootDirs(
        backend.opfsRoot,
        accountHash,
      );

      return await this._enqueueAccountMutation(accountHash, async () => {
        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
        const txStagingDir = await tryGetDirectoryHandle(stagingDir, txId);
        if (!txStagingDir) {
          this._pendingConflicts.delete(txId);
          this._activeStagingTxIds.delete(txId);
          return {
            category: 'recoverableFailure',
            title: 'Staging expirado',
            message: 'Os arquivos temporários de staging não estão mais disponíveis.',
            errorCode: 'MISSING_STAGING_FILES',
          };
        }

        const stagedZipHandle = await tryGetFileHandle(txStagingDir, ARCHIVE_FILE_NAME);
        if (!stagedZipHandle) {
          this._pendingConflicts.delete(txId);
          this._activeStagingTxIds.delete(txId);
          await removeEntryIfExists(stagingDir, txId, true);
          return {
            category: 'recoverableFailure',
            title: 'Staging incompleto',
            message: 'O arquivo compactado em staging foi perdido.',
            errorCode: 'MISSING_STAGING_FILES',
          };
        }
        const stagedZipFile = await stagedZipHandle.getFile();

        const quotaEst = await this._quotaEstimator();
        const availableBytes =
          quotaEst.quota !== null && quotaEst.usage !== null
            ? Math.max(0, quotaEst.quota - quotaEst.usage)
            : null;

        const { extractionResult, manifestCheck, extractedFileEntries } =
          await this._extractAndVerifyInOpfsStaging({
            stagedZipFile,
            txStagingDir,
            txId,
            existingPackages: [],
            signal: abortController.signal,
            availableStorageBytes: availableBytes,
            sessionGen,
            userId,
            operationId,
            onProgress: options.onProgress,
          });

        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
        if (!extractionResult.readyForPublication || extractionResult.status !== 'valid') {
          return this._mapValidationFailureOutcome(extractionResult);
        }

        const { index } = await this._readOrInitIndex(accountDir, accountHash);
        const currentRecord = index.packages.find((p) => p.packageId === pending.packageId);
        if (!currentRecord) {
          return {
            category: 'recoverableFailure',
            title: 'Pacote original não encontrado',
            message: 'O pacote anterior foi removido antes da substituição.',
            errorCode: 'PACKAGE_NOT_FOUND',
          };
        }

        const v2Record = this._buildPackageRecord({
          accountNamespaceHash: accountHash,
          validation: extractionResult,
          manifestCheck,
          archiveBytes: stagedZipFile.size,
          storageMode: 'opfs',
          customLabel: currentRecord.customLabel,
          storageLocationLabel: 'Armazenamento interno do navegador (OPFS)',
          nowIso: this._now().toISOString(),
        });

        options.onProgress?.({
          operationId,
          phase: 'committing',
          phaseLabel: 'Realizando backup e substituindo versão local...',
          bytesProcessed: 0,
          totalBytes: v2Record.totalOccupiedBytes,
        });

        // Step 1: Create backup of v1 inside backups/<packageId>.backup/ with backup.ready.json last
        const backupDirName = `${pending.packageId}.backup`;
        await removeEntryIfExists(backupsDir, backupDirName, true);
        const backupDir = await backupsDir.getDirectoryHandle(backupDirName, { create: true });

        let backupWritten = false;
        const currentPkgDir = await tryGetDirectoryHandle(packagesDir, pending.packageId);
        if (currentPkgDir) {
          const v1Entries = await listDirectoryEntries(currentPkgDir);
          for (const [name, handle] of v1Entries) {
            if ('getFile' in handle) {
              const file = await handle.getFile();
              await this._copyBlobToOpfsFile(
                { stage: 'backup', fileName: name, packageId: pending.packageId },
                backupDir,
                name,
                file,
                { sessionGen, userId, signal: abortController.signal },
              );
            }
          }
          const backupMarker: RehearsalBackupMarkerV1 = {
            schemaVersion: 1,
            packageId: currentRecord.packageId,
            accountNamespaceHash: accountHash,
            revision: currentRecord.revision,
            manifestSha256: currentRecord.manifestSha256,
            compositeSha256: currentRecord.compositeSha256,
            record: clonePackageRecord(currentRecord),
            createdAt: this._now().toISOString(),
          };
          const markerBytes = new TextEncoder().encode(JSON.stringify(backupMarker, null, 2));
          await this._writeBytesToOpfsFile(
            { stage: 'backup', fileName: BACKUP_READY_FILE_NAME, packageId: pending.packageId },
            backupDir,
            BACKUP_READY_FILE_NAME,
            markerBytes,
            abortController.signal,
          );
          backupWritten = true;
        }

        // Step 2: Overwrite packages/<packageId> with v2 & rollback if any write fails
        try {
          await this._commitStagedToPackageDir({
            txStagingDir,
            packagesDir,
            packageId: pending.packageId,
            accountHash,
            record: v2Record,
            extractedFileEntries,
            sessionGen,
            userId,
            signal: abortController.signal,
            clearExistingFirst: true,
          });

          const updatedPackages = index.packages.map((p) =>
            p.packageId === pending.packageId ? clonePackageRecord(v2Record) : p,
          );
          await this._writeIndexAtomic(accountDir, accountHash, updatedPackages);
        } catch (replaceErr) {
          if (backupWritten) {
            try {
              await this._restoreBackupToPackageDir(
                backupsDir,
                packagesDir,
                backupDirName,
                pending.packageId,
                sessionGen,
                userId,
              );
            } catch {
              // If rollback is also interrupted, loadLibrary will restore from backup.ready.json
            }
          }
          throw replaceErr;
        }

        // Step 3: Clean up backup and staging only after v2 index.json is committed
        await removeEntryIfExists(backupsDir, backupDirName, true);
        await removeEntryIfExists(stagingDir, txId, true);
        this._pendingConflicts.delete(txId);
        this._activeStagingTxIds.delete(txId);

        return {
          category: 'imported',
          title: 'Pacote substituído com sucesso',
          message: `Pacote "${v2Record.displayName}" atualizado para revisão ${v2Record.revision}.`,
          record: clonePackageRecord(v2Record),
        };
      });
    } catch (err) {
      // Clean staging/pending conflict after failure (backup rollback has preserved v1)
      this._pendingConflicts.delete(txId);
      this._activeStagingTxIds.delete(txId);
      if (backend.mode === 'opfs') {
        try {
          const { stagingDir } = await this._getAccountRootDirs(backend.opfsRoot, accountHash);
          await removeEntryIfExists(stagingDir, txId, true);
        } catch {
          // Best-effort cleanup
        }
      }
      return this._mapCaughtErrorOutcome(err, 'Falha ao substituir pacote');
    } finally {
      this._activeAbortControllers.delete(operationId);
    }
  }

  /**
   * Discards a pending conflict and removes its staged files.
   */
  async discardPendingConflict(
    options: DiscardPendingConflictOptions,
  ): Promise<RehearsalOperationOutcome> {
    const userId = assertNonEmptyUserId(options.userId);
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
    const pending = this._pendingConflicts.get(options.pendingTransactionId);

    if (!pending || pending.accountNamespaceHash !== accountHash) {
      return {
        category: 'recoverableFailure',
        title: 'Conflito não encontrado',
        message: 'A transação pendente não pertence a esta conta ou já foi encerrada.',
        errorCode: 'PENDING_CONFLICT_NOT_FOUND',
      };
    }

    this._pendingConflicts.delete(pending.txId);
    this._activeStagingTxIds.delete(pending.txId);

    const backend = await this._resolveBackend();
    if (backend.mode === 'opfs') {
      await this._enqueueAccountMutation(accountHash, async () => {
        const { stagingDir } = await this._getAccountRootDirs(backend.opfsRoot, accountHash);
        await removeEntryIfExists(stagingDir, pending.txId, true);
      });
    }

    return {
      category: 'cancelled',
      title: 'Substituição descartada',
      message: 'A versão existente do pacote foi preservada sem alterações.',
      errorCode: 'CONFLICT_DISCARDED',
    };
  }

  private async _verifyOpfsPackageDeep(
    packagesDir: OpfsDirectoryHandleLike,
    accountHash: string,
    record: LocalWebRehearsalPackageRecord,
    signal?: AbortSignal,
    onProgress?: (bytesProcessed: number, totalBytes: number) => void,
  ): Promise<{
    ok: boolean;
    integrityState: RehearsalPackageIntegrityState;
    integrityCode: string | null;
    integrityMessage: string | null;
    zipFile?: File | Blob;
  }> {
    const pkgDir = await tryGetDirectoryHandle(packagesDir, record.packageId);
    if (!pkgDir) {
      return {
        ok: false,
        integrityState: 'missingFiles',
        integrityCode: 'MISSING_PACKAGE_DIRECTORY',
        integrityMessage: 'Diretório do pacote não encontrado no armazenamento local.',
      };
    }

    const commitRead = await readJsonFileIfPresent<unknown>(pkgDir, COMMIT_FILE_NAME);
    if (!commitRead.exists) {
      return {
        ok: false,
        integrityState: 'incomplete',
        integrityCode: 'MISSING_COMMIT_MARKER',
        integrityMessage: 'Marcador de commit ausente.',
      };
    }
    if (
      commitRead.invalidJson ||
      !isValidCommitMarker(commitRead.data, accountHash, record.packageId) ||
      commitRead.data.compositeSha256 !== record.compositeSha256 ||
      commitRead.data.manifestSha256 !== record.manifestSha256 ||
      commitRead.data.revision !== record.revision
    ) {
      return {
        ok: false,
        integrityState: 'corrupted',
        integrityCode: 'INVALID_COMMIT_MARKER',
        integrityMessage: 'Marcador de commit inválido ou divergente.',
      };
    }

    const totalExpectedBytes = record.archiveBytes + record.extractedBytes;
    let processedBytes = 0;

    // 1. Check manifest.json
    const manifestHandle = await tryGetFileHandle(pkgDir, 'manifest.json');
    if (!manifestHandle) {
      return {
        ok: false,
        integrityState: 'missingFiles',
        integrityCode: 'MISSING_PACKAGE_FILES',
        integrityMessage: 'manifest.json ausente.',
      };
    }
    const manifestFile = await manifestHandle.getFile();
    if (manifestFile.size > LIMITS_V1.maxManifestBytes) {
      return {
        ok: false,
        integrityState: 'corrupted',
        integrityCode: 'MANIFEST_SIZE_LIMIT_EXCEEDED',
        integrityMessage: 'manifest.json excede o tamanho máximo permitido.',
      };
    }
    const manifestHash = await computeBlobSha256AndSize(manifestFile);
    if (manifestHash.sha256 !== record.manifestSha256) {
      return {
        ok: false,
        integrityState: 'corrupted',
        integrityCode: 'SHA256_MISMATCH',
        integrityMessage: 'SHA-256 de manifest.json divergente.',
      };
    }
    processedBytes += manifestHash.byteLength;
    onProgress?.(processedBytes, totalExpectedBytes);

    // 2. Check stems + optional original
    const mediaToVerify: LocalWebRehearsalStemMetadata[] = [
      ...REQUIRED_STEM_IDS_V1.map((id) => record.stems[id]),
      ...(record.original ? [record.original] : []),
    ];

    for (const meta of mediaToVerify) {
      if (signal?.aborted) {
        throw new OperationCancelledError();
      }
      const fileHandle = await tryGetFileHandle(pkgDir, meta.internalFileName);
      if (!fileHandle) {
        return {
          ok: false,
          integrityState: 'missingFiles',
          integrityCode: 'MISSING_PACKAGE_FILES',
          integrityMessage: `Arquivo ausente: ${meta.internalFileName}.`,
        };
      }
      const file = await fileHandle.getFile();
      if (file.size !== meta.byteLength) {
        return {
          ok: false,
          integrityState: 'incomplete',
          integrityCode: 'TRUNCATED_PACKAGE_FILE',
          integrityMessage: `Tamanho divergente em ${meta.internalFileName} (esperado ${meta.byteLength}, encontrado ${file.size}).`,
        };
      }
      const { sha256 } = await computeBlobSha256AndSize(file);
      if (sha256 !== meta.sha256) {
        return {
          ok: false,
          integrityState: 'corrupted',
          integrityCode: 'SHA256_MISMATCH',
          integrityMessage: `Integridade SHA-256 falhou para ${meta.internalFileName}.`,
        };
      }
      processedBytes += file.size;
      onProgress?.(processedBytes, totalExpectedBytes);
    }

    // 3. Check stored archive ZIP
    const zipHandle = await tryGetFileHandle(pkgDir, ARCHIVE_FILE_NAME);
    if (!zipHandle) {
      return {
        ok: false,
        integrityState: 'missingFiles',
        integrityCode: 'MISSING_PACKAGE_FILES',
        integrityMessage: 'Arquivo compactado do pacote ausente.',
      };
    }
    const zipFile = await zipHandle.getFile();
    if (zipFile.size !== record.archiveBytes) {
      return {
        ok: false,
        integrityState: 'incomplete',
        integrityCode: 'TRUNCATED_PACKAGE_FILE',
        integrityMessage: 'Tamanho do arquivo compactado divergente.',
      };
    }

    const zipValidation = await validateRehearsalPackage(zipFile, {
      signal,
      includeSourceCopy: false,
    });
    if (
      zipValidation.status !== 'valid' ||
      zipValidation.packageIdentity?.compositeSha256 !== record.compositeSha256
    ) {
      return {
        ok: false,
        integrityState: 'corrupted',
        integrityCode: zipValidation.errorCode ?? 'SHA256_MISMATCH',
        integrityMessage:
          zipValidation.errorMessage ?? 'O arquivo compactado local está corrompido.',
      };
    }
    processedBytes += zipFile.size;
    onProgress?.(processedBytes, totalExpectedBytes);

    return {
      ok: true,
      integrityState: 'verified',
      integrityCode: null,
      integrityMessage: null,
      zipFile,
    };
  }

  private async _verifyEphemeralEntry(
    entry: EphemeralPackageEntry,
    signal?: AbortSignal,
  ): Promise<{
    ok: boolean;
    integrityState: RehearsalPackageIntegrityState;
    integrityCode: string | null;
    integrityMessage: string | null;
    file?: File | Blob;
  }> {
    let currentFile: File | Blob = entry.sourceFile;
    if (entry.externalHandle) {
      try {
        if (entry.externalHandle.queryPermission) {
          const perm = await entry.externalHandle.queryPermission({ mode: 'read' });
          if (perm === 'denied') {
            return {
              ok: false,
              integrityState: 'permissionDenied',
              integrityCode: 'PERMISSION_DENIED',
              integrityMessage: 'Permissão de leitura revogada pelo navegador ou usuário.',
            };
          }
          if (perm === 'prompt' && entry.externalHandle.requestPermission) {
            const req = await entry.externalHandle.requestPermission({ mode: 'read' });
            if (req !== 'granted') {
              return {
                ok: false,
                integrityState: 'permissionDenied',
                integrityCode: 'PERMISSION_DENIED',
                integrityMessage: 'Permissão de leitura não concedida.',
              };
            }
          }
        }
        currentFile = await entry.externalHandle.getFile();
        entry.sourceFile = currentFile;
      } catch (err) {
        if (isNotAllowedError(err)) {
          return {
            ok: false,
            integrityState: 'permissionDenied',
            integrityCode: 'PERMISSION_DENIED',
            integrityMessage: 'Permissão negada para ler o arquivo externo.',
          };
        }
        if (isNotFoundError(err)) {
          return {
            ok: false,
            integrityState: 'missingFiles',
            integrityCode: 'MISSING_PACKAGE_FILES',
            integrityMessage: 'O arquivo externo não foi encontrado.',
          };
        }
        throw err;
      }
    }

    const validation = await validateRehearsalPackage(currentFile, {
      signal,
      includeSourceCopy: false,
    });
    if (
      validation.status !== 'valid' ||
      validation.packageIdentity?.compositeSha256 !== entry.record.compositeSha256 ||
      validation.packageIdentity?.manifestSha256 !== entry.record.manifestSha256
    ) {
      return {
        ok: false,
        integrityState: 'corrupted',
        integrityCode: validation.errorCode ?? 'SHA256_MISMATCH',
        integrityMessage: validation.errorMessage ?? 'O arquivo de origem foi alterado ou corrompido.',
      };
    }

    return {
      ok: true,
      integrityState: 'verified',
      integrityCode: null,
      integrityMessage: null,
      file: currentFile,
    };
  }

  /**
   * Performs a deep SHA-256 and structural revalidation of a stored package.
   */
  async revalidatePackage(
    options: RevalidateRehearsalPackageOptions,
  ): Promise<RehearsalOperationOutcome> {
    const userId = assertNonEmptyUserId(options.userId);
    const sessionGen = this._sessionGeneration;
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
    const operationId = this._txIdGenerator();
    const abortController = new AbortController();
    this._activeAbortControllers.set(operationId, { accountHash, controller: abortController });

    try {
      const backend = await this._resolveBackend();
      return await this._enqueueAccountMutation(accountHash, async () => {
        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
        const nowIso = this._now().toISOString();

        if (backend.mode === 'ephemeral-fallback') {
          const store = this._ephemeralBackend.getOrCreateAccount(accountHash);
          const entry = store.packages.get(options.packageId);
          if (!entry) {
            return {
              category: 'recoverableFailure',
              title: 'Pacote não encontrado',
              message: 'O pacote solicitado não existe nesta conta.',
              errorCode: 'PACKAGE_NOT_FOUND',
            };
          }

          options.onProgress?.({
            operationId,
            phase: 'revalidating',
            phaseLabel: 'Revalidando arquivo da sessão...',
            bytesProcessed: 0,
            totalBytes: entry.record.archiveBytes,
          });

          const check = await this._verifyEphemeralEntry(entry, abortController.signal);
          this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
          entry.record.integrityState = check.integrityState;
          entry.record.integrityCode = check.integrityCode;
          entry.record.integrityMessage = check.integrityMessage;
          entry.record.lastValidatedAt = nowIso;
          entry.record.isReadyForLocalUse = check.ok;

          if (!check.ok) {
            return {
              category:
                check.integrityState === 'permissionDenied' ? 'permissionDenied' : 'corrupted',
              title:
                check.integrityState === 'permissionDenied'
                  ? 'Permissão negada'
                  : 'Integridade comprometida',
              message: check.integrityMessage ?? 'Falha na revalidação.',
              errorCode: check.integrityCode ?? undefined,
              record: clonePackageRecord(entry.record),
            };
          }

          return {
            category: 'revalidated',
            title: 'Pacote íntegro',
            message: 'Todos os dados do pacote foram revalidados com sucesso.',
            record: clonePackageRecord(entry.record),
          };
        }

        const { accountDir, packagesDir } = await this._getAccountRootDirs(
          backend.opfsRoot,
          accountHash,
        );
        const { index } = await this._readOrInitIndex(accountDir, accountHash);
        const existingIdx = index.packages.findIndex((p) => p.packageId === options.packageId);
        if (existingIdx < 0) {
          return {
            category: 'recoverableFailure',
            title: 'Pacote não encontrado',
            message: 'O pacote solicitado não existe nesta conta.',
            errorCode: 'PACKAGE_NOT_FOUND',
          };
        }

        const targetRecord = clonePackageRecord(index.packages[existingIdx]);
        const check = await this._verifyOpfsPackageDeep(
          packagesDir,
          accountHash,
          targetRecord,
          abortController.signal,
          (processed, total) => {
            options.onProgress?.({
              operationId,
              phase: 'revalidating',
              phaseLabel: 'Verificando checksums SHA-256 no armazenamento local...',
              bytesProcessed: processed,
              totalBytes: total,
            });
          },
        );

        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

        targetRecord.integrityState = check.integrityState;
        targetRecord.integrityCode = check.integrityCode;
        targetRecord.integrityMessage = check.integrityMessage;
        targetRecord.lastValidatedAt = nowIso;
        targetRecord.isReadyForLocalUse = check.ok;

        const updatedPackages = index.packages.map((p, idx) =>
          idx === existingIdx ? targetRecord : p,
        );
        await this._writeIndexAtomic(accountDir, accountHash, updatedPackages);

        if (!check.ok) {
          return {
            category:
              check.integrityState === 'permissionDenied' ? 'permissionDenied' : 'corrupted',
            title: 'Integridade comprometida',
            message: check.integrityMessage ?? 'Falha na verificação de integridade.',
            errorCode: check.integrityCode ?? undefined,
            record: clonePackageRecord(targetRecord),
          };
        }

        return {
          category: 'revalidated',
          title: 'Pacote revalidado',
          message: 'Todos os arquivos e hashes SHA-256 do pacote estão íntegros.',
          record: clonePackageRecord(targetRecord),
        };
      });
    } catch (err) {
      return this._mapCaughtErrorOutcome(err, 'Falha ao revalidar pacote');
    } finally {
      this._activeAbortControllers.delete(operationId);
    }
  }

  /**
   * Renames the local custom label (`1..120` chars) without mutating the underlying package manifest or audio.
   */
  async renamePackageLabel(
    options: RenameRehearsalPackageLabelOptions,
  ): Promise<RehearsalOperationOutcome> {
    const userId = assertNonEmptyUserId(options.userId);
    const sessionGen = this._sessionGeneration;
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
    const validated = validateCustomLabel(options.label);
    if (!validated.valid) {
      return {
        category: 'recoverableFailure',
        title: 'Rótulo inválido',
        message: validated.message,
        errorCode: 'INVALID_PACKAGE_LABEL',
      };
    }

    try {
      const backend = await this._resolveBackend();
      return await this._enqueueAccountMutation(accountHash, async () => {
        this._assertNotStaleOrAborted(sessionGen, userId);

        if (backend.mode === 'ephemeral-fallback') {
          const store = this._ephemeralBackend.getOrCreateAccount(accountHash);
          const entry = store.packages.get(options.packageId);
          if (!entry) {
            return {
              category: 'recoverableFailure',
              title: 'Pacote não encontrado',
              message: 'O pacote solicitado não existe nesta conta.',
              errorCode: 'PACKAGE_NOT_FOUND',
            };
          }
          entry.record.customLabel = validated.label;
          entry.record.displayName = validated.label;
          return {
            category: 'renamed',
            title: 'Rótulo atualizado',
            message: `Rótulo local alterado para "${validated.label}".`,
            record: clonePackageRecord(entry.record),
          };
        }

        const { accountDir } = await this._getAccountRootDirs(backend.opfsRoot, accountHash);
        const { index } = await this._readOrInitIndex(accountDir, accountHash);
        const idx = index.packages.findIndex((p) => p.packageId === options.packageId);
        if (idx < 0) {
          return {
            category: 'recoverableFailure',
            title: 'Pacote não encontrado',
            message: 'O pacote solicitado não existe nesta conta.',
            errorCode: 'PACKAGE_NOT_FOUND',
          };
        }

        const updated = clonePackageRecord(index.packages[idx]);
        updated.customLabel = validated.label;
        updated.displayName = validated.label;

        const updatedPackages = index.packages.map((p, i) => (i === idx ? updated : p));
        this._assertNotStaleOrAborted(sessionGen, userId);
        await this._writeIndexAtomic(accountDir, accountHash, updatedPackages);

        return {
          category: 'renamed',
          title: 'Rótulo atualizado',
          message: `Rótulo local alterado para "${validated.label}".`,
          record: clonePackageRecord(updated),
        };
      });
    } catch (err) {
      return this._mapCaughtErrorOutcome(err, 'Falha ao renomear pacote');
    }
  }

  /**
   * Exports a verified package archive either by streaming into a user-selected `SaveFileHandleLike`
   * or returning `exportedBlob` + `exportedFileName` for `<a download>` fallback.
   * Refuses export if the package is corrupted, incomplete, missing files, or permission-denied.
   */
  async exportPackage(options: ExportRehearsalPackageOptions): Promise<RehearsalOperationOutcome> {
    const userId = assertNonEmptyUserId(options.userId);
    const sessionGen = this._sessionGeneration;
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);
    const operationId = this._txIdGenerator();
    const abortController = new AbortController();
    this._activeAbortControllers.set(operationId, { accountHash, controller: abortController });

    try {
      const backend = await this._resolveBackend();
      return await this._enqueueAccountMutation(accountHash, async () => {
        this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
        const nowIso = this._now().toISOString();

        let sourceBlob: Blob | undefined;
        let record: LocalWebRehearsalPackageRecord;

        if (backend.mode === 'ephemeral-fallback') {
          const store = this._ephemeralBackend.getOrCreateAccount(accountHash);
          const entry = store.packages.get(options.packageId);
          if (!entry) {
            return {
              category: 'recoverableFailure',
              title: 'Pacote não encontrado',
              message: 'O pacote solicitado não existe nesta conta.',
              errorCode: 'PACKAGE_NOT_FOUND',
            };
          }

          if (
            entry.record.integrityState === 'corrupted' ||
            entry.record.integrityState === 'incomplete' ||
            entry.record.integrityState === 'missingFiles'
          ) {
            return {
              category: 'corrupted',
              title: 'Exportação bloqueada',
              message: 'Não é possível exportar um pacote corrompido ou incompleto.',
              errorCode: entry.record.integrityCode ?? 'CORRUPTED_PACKAGE',
              record: clonePackageRecord(entry.record),
            };
          }

          const check = await this._verifyEphemeralEntry(entry, abortController.signal);
          this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
          entry.record.integrityState = check.integrityState;
          entry.record.integrityCode = check.integrityCode;
          entry.record.integrityMessage = check.integrityMessage;
          entry.record.lastValidatedAt = nowIso;
          entry.record.isReadyForLocalUse = check.ok;

          if (!check.ok || !check.file) {
            return {
              category:
                check.integrityState === 'permissionDenied' ? 'permissionDenied' : 'corrupted',
              title: 'Exportação bloqueada',
              message: check.integrityMessage ?? 'Pacote indisponível para exportação.',
              errorCode: check.integrityCode ?? undefined,
              record: clonePackageRecord(entry.record),
            };
          }

          sourceBlob = check.file;
          record = clonePackageRecord(entry.record);
        } else {
          const { accountDir, packagesDir } = await this._getAccountRootDirs(
            backend.opfsRoot,
            accountHash,
          );
          const { index } = await this._readOrInitIndex(accountDir, accountHash);
          const idx = index.packages.findIndex((p) => p.packageId === options.packageId);
          if (idx < 0) {
            return {
              category: 'recoverableFailure',
              title: 'Pacote não encontrado',
              message: 'O pacote solicitado não existe nesta conta.',
              errorCode: 'PACKAGE_NOT_FOUND',
            };
          }

          const current = clonePackageRecord(index.packages[idx]);
          if (
            current.integrityState === 'corrupted' ||
            current.integrityState === 'incomplete' ||
            current.integrityState === 'missingFiles'
          ) {
            return {
              category: 'corrupted',
              title: 'Exportação bloqueada',
              message: 'Não é possível exportar um pacote corrompido ou incompleto.',
              errorCode: current.integrityCode ?? 'CORRUPTED_PACKAGE',
              record: current,
            };
          }

          const check = await this._verifyOpfsPackageDeep(
            packagesDir,
            accountHash,
            current,
            abortController.signal,
          );
          this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);

          current.integrityState = check.integrityState;
          current.integrityCode = check.integrityCode;
          current.integrityMessage = check.integrityMessage;
          current.lastValidatedAt = nowIso;
          current.isReadyForLocalUse = check.ok;

          const updatedPackages = index.packages.map((p, i) => (i === idx ? current : p));
          await this._writeIndexAtomic(accountDir, accountHash, updatedPackages);

          if (!check.ok || !check.zipFile) {
            return {
              category:
                check.integrityState === 'permissionDenied' ? 'permissionDenied' : 'corrupted',
              title: 'Exportação bloqueada',
              message: check.integrityMessage ?? 'Integridade do pacote comprometida.',
              errorCode: check.integrityCode ?? undefined,
              record: clonePackageRecord(current),
            };
          }

          sourceBlob = check.zipFile;
          record = clonePackageRecord(current);
        }

        const exportedFileName = sanitizeExportFileName(record.displayName, record.packageId);

        if (options.saveHandle) {
          const writable = await options.saveHandle.createWritable();
          let closed = false;
          let pos = 0;
          try {
            while (pos < sourceBlob.size) {
              this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
              const end = Math.min(sourceBlob.size, pos + CHUNK_BYTES);
              const slice = sourceBlob.slice(pos, end);
              const chunk = new Uint8Array(await readBlobAsArrayBuffer(slice));
              await writable.write(chunk);
              pos = end;
              options.onProgress?.({
                operationId,
                phase: 'exporting',
                phaseLabel: 'Exportando pacote de ensaio...',
                bytesProcessed: pos,
                totalBytes: sourceBlob.size,
              });
            }
            this._assertNotStaleOrAborted(sessionGen, userId, abortController.signal);
            await writable.close();
            closed = true;
          } catch (writeErr) {
            if (!closed && writable.abort) {
              try {
                await writable.abort(writeErr);
              } catch {
                // Preserve primary error
              }
            }
            throw writeErr;
          }

          return {
            category: 'exported',
            title: 'Backup exportado',
            message: `Pacote exportado como "${exportedFileName}".`,
            record,
            exportedFileName,
          };
        }

        options.onProgress?.({
          operationId,
          phase: 'exporting',
          phaseLabel: 'Preparando download do pacote...',
          bytesProcessed: sourceBlob.size,
          totalBytes: sourceBlob.size,
        });

        return {
          category: 'exported',
          title: 'Backup pronto para download',
          message: `Arquivo "${exportedFileName}" pronto para download.`,
          record,
          exportedBlob: sourceBlob,
          exportedFileName,
        };
      });
    } catch (err) {
      return this._mapCaughtErrorOutcome(err, 'Falha ao exportar pacote');
    } finally {
      this._activeAbortControllers.delete(operationId);
    }
  }

  /**
   * Deletes a package from the user's account scope only when `confirmedScope === true`.
   */
  async deletePackage(options: DeleteRehearsalPackageOptions): Promise<RehearsalOperationOutcome> {
    const userId = assertNonEmptyUserId(options.userId);
    if (options.confirmedScope !== true) {
      return {
        category: 'cancelled',
        title: 'Exclusão não confirmada',
        message: 'A exclusão requer confirmação explícita de escopo (`confirmedScope: true`).',
        errorCode: 'DELETE_CONFIRMATION_REQUIRED',
      };
    }

    const sessionGen = this._sessionGeneration;
    const accountHash = RehearsalPackageLibraryManager.computeAccountNamespaceHash(userId);

    try {
      const backend = await this._resolveBackend();
      return await this._enqueueAccountMutation(accountHash, async () => {
        this._assertNotStaleOrAborted(sessionGen, userId);

        if (backend.mode === 'ephemeral-fallback') {
          const store = this._ephemeralBackend.getOrCreateAccount(accountHash);
          const entry = store.packages.get(options.packageId);
          if (!entry) {
            return {
              category: 'recoverableFailure',
              title: 'Pacote não encontrado',
              message: 'O pacote solicitado não existe nesta conta.',
              errorCode: 'PACKAGE_NOT_FOUND',
            };
          }
          const removed = clonePackageRecord(entry.record);
          store.packages.delete(options.packageId);
          return {
            category: 'deleted',
            title: 'Pacote excluído',
            message: `Pacote "${removed.displayName}" removido da sessão local.`,
            record: removed,
          };
        }

        const { accountDir, packagesDir, backupsDir } = await this._getAccountRootDirs(
          backend.opfsRoot,
          accountHash,
        );
        const { index } = await this._readOrInitIndex(accountDir, accountHash);
        const existing = index.packages.find((p) => p.packageId === options.packageId);
        if (!existing) {
          return {
            category: 'recoverableFailure',
            title: 'Pacote não encontrado',
            message: 'O pacote solicitado não existe nesta conta.',
            errorCode: 'PACKAGE_NOT_FOUND',
          };
        }

        const updatedPackages = index.packages.filter((p) => p.packageId !== options.packageId);
        await this._writeIndexAtomic(accountDir, accountHash, updatedPackages);
        await removeEntryIfExists(packagesDir, options.packageId, true);
        await removeEntryIfExists(backupsDir, `${options.packageId}.backup`, true);

        return {
          category: 'deleted',
          title: 'Pacote excluído',
          message: `Pacote "${existing.displayName}" excluído localmente.`,
          record: clonePackageRecord(existing),
        };
      });
    } catch (err) {
      return this._mapCaughtErrorOutcome(err, 'Falha ao excluir pacote');
    }
  }
}

let defaultManagerInstance: RehearsalPackageLibraryManager | null = null;

export function getDefaultRehearsalPackageLibraryManager(): RehearsalPackageLibraryManager {
  if (!defaultManagerInstance) {
    defaultManagerInstance = new RehearsalPackageLibraryManager();
  }
  return defaultManagerInstance;
}

export function invalidateActiveRehearsalLibrarySession(): void {
  if (defaultManagerInstance) {
    defaultManagerInstance.invalidateSession();
  }
}
