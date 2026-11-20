import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { AppError } from '../../middleware/error-handler';
import {
  MinistryAudioRepository, type AudioCursor, type AudioRecording, type AudioScope,
} from './ministry-audio.repository';
import { MAX_DIRECT_ATTEMPTS, recordingIdSchema, requirePublishableStems, STEM_IDS, type ListInput, type RecordingMetadata, type StemId, type UploadInput, type UploadInputV2 } from './ministry-audio.schema';
import { assertEnabledCodecs, assertPublishableMp3Set, buildManifest, hash, isVisibleManifest, requestHashOf } from './audio-manifest';
import { mp3FactsMatch } from './stem-codec';
import type { StemStorage } from './storage';
import { stemExtension } from './stem-codec';
import type { DirectStemStorage, ObjectReceipt, VerifiedStaging } from './direct-storage';

const DAY_MS = 24 * 60 * 60 * 1000;
const TICKET_TTL_MS = 120_000;
const CLEANUP_LEASE_MS = 300_000;
const DIRECT_UPLOAD_TTL_SECONDS = 300;
const DIRECT_CLEANUP_GRACE_MS = 900_000;
const SEARCH_BATCH_SIZE = 49;
const searchText = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

// The extension follows the codec of the persisted manifest stem (always PCM/`wav` today: v1 keys are unchanged).
const extensionOf = (record: AudioRecording, stem: StemId) => {
  const manifestStem = record.manifest.stems.find((candidate) => candidate.id === stem);
  if (!manifestStem) throw new AppError(404, 'Faixa não encontrada.');
  return stemExtension(manifestStem);
};
const objectKey = (record: AudioRecording, stem: StemId) =>
  `${record.ministryId}/${record.id}/${stem}.${extensionOf(record, stem)}`;
const finalKey = (record: AudioRecording, stem: StemId) =>
  `objects/ministry-audio/${objectKey(record, stem)}`;
const stagingKey = (record: AudioRecording, stem: StemId, attempt: number) =>
  `staging/ministry-audio/${record.ministryId}/${record.id}/${stem}/${attempt}.${extensionOf(record, stem)}`;

function summary(record: AudioRecording) {
  const { id, title, artist, version, status, updatedAt } = record;
  return { id, title, artist, version, status, updatedAt };
}

function parseCursor(value: string | undefined, binding: string): AudioCursor | undefined {
  if (!value) return undefined;
  try {
    const [publishedAt, id, cursorBinding] = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (Number.isSafeInteger(publishedAt) && recordingIdSchema.safeParse(id).success && cursorBinding === binding) {
      return { publishedAt, id };
    }
  } catch {
    // Keep malformed and mismatched cursors on the same error path.
  }
  throw new AppError(400, 'Cursor de gravações inválido.');
}

export class MinistryAudioService {
  private readonly repository = new MinistryAudioRepository();

  constructor(
    private readonly storage: StemStorage,
    private readonly now: () => number = Date.now,
    private readonly ticketSecret: Buffer = randomBytes(32),
    private readonly directStorage?: DirectStemStorage
  ) {}

  private uploadView(record: AudioRecording) {
    const { id, status, uploadedStemIds, expiresAt } = record;
    return {
      id, status: status === 'uploading' && expiresAt <= this.now() ? 'expired' : status,
      uploadedStemIds, expiresAt, ...(record.transfer ? { transfer: record.transfer } : {}),
    };
  }

  private assertUploading(record: AudioRecording) {
    if (record.status !== 'uploading' || record.expiresAt <= this.now()) {
      throw new AppError(409, 'A sessão de upload já foi encerrada.');
    }
  }

  private assertReadyToPublish(record: AudioRecording) {
    this.assertUploading(record);
    if (!STEM_IDS.every((stem) => record.uploadedStemIds.includes(stem))) {
      throw new AppError(409, 'O envio das seis faixas precisa ser confirmado antes da publicação.');
    }
  }

  private getDirect(record: AudioRecording): DirectStemStorage {
    if (record.transfer !== 'direct') throw new AppError(409, 'Esta sessão usa envio pelo servidor.');
    if (!this.directStorage) throw new AppError(503, 'Armazenamento direto indisponível.');
    return this.directStorage;
  }

  private getReceipt(record: AudioRecording, stemId: StemId): ObjectReceipt {
    const receipt = record.directAttempts?.[stemId]?.receipt;
    if (!receipt) throw new AppError(409, 'A faixa ainda precisa ser confirmada.');
    return receipt;
  }

  private async assertDirectObjects(record: AudioRecording, storage: DirectStemStorage) {
    await Promise.all(record.manifest.stems.map((stem) =>
      storage.assertObject(finalKey(record, stem.id), stem, this.getReceipt(record, stem.id))
    ));
  }

  private async published(scope: AudioScope, id: string) {
    const record = await this.repository.read(scope, id, false);
    // A recording of a codec that is not enabled is never visible, even if a record of it exists.
    if (record.status !== 'published' || !isVisibleManifest(record.manifest)) throw new AppError(404, 'Gravação não encontrada.');
    return record;
  }

  async reserve(scope: AudioScope, input: UploadInput | UploadInputV2) {
    const { idempotencyKey, title, artist, version, model } = input;
    await this.repository.authorize(scope, true); // authorization first; read-only, no writes
    const stems = requirePublishableStems(input.stems);
    const id = hash([scope.ministryId, scope.userId, idempotencyKey]);
    const manifest = buildManifest(id, version, model, stems);
    const direct = this.directStorage !== undefined;
    if (!direct && stems.some((stem) => stem.codec !== 'pcm_s16le')) {
      throw new AppError(409, 'Este codec exige armazenamento de envio direto.');
    }
    const now = this.now();
    const record = await this.repository.reserve(scope, {
      id, ministryId: scope.ministryId, createdBy: scope.userId, createdAt: now, updatedAt: now,
      title, artist, version, requestHash: requestHashOf({ title, artist, version }, manifest), status: 'uploading',
      manifest, uploadedStemIds: [], expiresAt: now + DAY_MS,
      ...(direct ? { transfer: 'direct' as const } : {}),
    }, this.now, direct ? DIRECT_CLEANUP_GRACE_MS : 0);
    return this.uploadView(record);
  }

  async uploadStatus(scope: AudioScope, id: string) {
    return this.uploadView(await this.repository.read(scope, id, true));
  }

  async upload(scope: AudioScope, id: string, stemId: StemId, bytes: Readable, length: string | undefined) {
    const record = await this.repository.read(scope, id, true);
    this.assertUploading(record);
    if (record.transfer === 'direct') throw new AppError(409, 'Esta sessão usa URL de envio direto.');
    const expected = this.getStem(record, stemId);
    if (length !== undefined && Number(length) !== expected.sizeBytes) {
      throw new AppError(422, 'O tamanho da faixa difere do manifesto.');
    }
    if (expected.codec !== 'pcm_s16le') throw new AppError(409, 'Este codec exige URL de envio direto.');
    await this.storage.put(objectKey(record, stemId), bytes, expected);
    return this.uploadView(await this.repository.update(scope, id, (current) => {
      if (current.status === 'published') return;
      this.assertUploading(current);
      if (current.uploadedStemIds.includes(stemId)) return;
      return {
        uploadedStemIds: STEM_IDS.filter((stem) => stem === stemId || current.uploadedStemIds.includes(stem)),
        updatedAt: this.now(),
      };
    }));
  }

  async issueUploadUrl(scope: AudioScope, id: string, stemId: StemId) {
    const record = await this.repository.update(scope, id, (current) => {
      this.getDirect(current);
      this.assertUploading(current);
      const attempt = current.directAttempts?.[stemId];
      if (attempt?.receipt) throw new AppError(409, 'A faixa já foi confirmada.');
      if (attempt && !attempt.invalid) return;
      const number = (attempt?.number ?? 0) + 1;
      if (number > MAX_DIRECT_ATTEMPTS) {
        throw new AppError(409, 'Limite de tentativas da faixa atingido. Inicie uma nova reserva.');
      }
      return { directAttempts: { ...current.directAttempts, [stemId]: { number } } };
    });
    const attempt = record.directAttempts![stemId]!.number;
    const now = this.now();
    const seconds = Math.min(DIRECT_UPLOAD_TTL_SECONDS, Math.floor((record.expiresAt - now) / 1000));
    if (seconds < 1) throw new AppError(409, 'A sessão de upload já foi encerrada.');
    const grant = await this.getDirect(record).signUpload(stagingKey(record, stemId, attempt), this.getStem(record, stemId), seconds);
    return { attempt, ...grant, expiresAt: now + seconds * 1000 };
  }

  async completeUpload(scope: AudioScope, id: string, stemId: StemId, attempt: number) {
    const record = await this.repository.read(scope, id, true);
    const storage = this.getDirect(record);
    const currentAttempt = record.directAttempts?.[stemId];
    if (currentAttempt?.number === attempt && currentAttempt.receipt) return this.uploadView(record);
    this.assertUploading(record);
    if (currentAttempt?.number !== attempt || currentAttempt.invalid) {
      throw new AppError(409, 'Solicite a URL vigente desta faixa.');
    }
    let receipt: ObjectReceipt;
    try {
      receipt = await storage.seal(stagingKey(record, stemId, attempt), finalKey(record, stemId), this.getStem(record, stemId), {
        // Only a verification this service persisted for this very attempt is offered back, never client input.
        verified: currentAttempt.verified,
        onVerified: (verified) => this.rememberVerification(scope, id, stemId, attempt, verified),
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 422) {
        await this.repository.update(scope, id, (current) => {
          this.assertUploading(current);
          const storedAttempt = current.directAttempts?.[stemId];
          if (storedAttempt?.number !== attempt || storedAttempt.receipt) return;
          return { directAttempts: { ...current.directAttempts, [stemId]: { number: attempt, invalid: true } } };
        });
      }
      throw error;
    }
    // An MP3 receipt is only trusted with the facts the adapter derived from the bytes of this very stem.
    if (!mp3FactsMatch(this.getStem(record, stemId), receipt.mp3)) {
      throw new AppError(409, 'A verificação da faixa MP3 não pôde ser confirmada.');
    }
    const completed = await this.repository.update(scope, id, (current) => {
      const storedAttempt = current.directAttempts?.[stemId];
      if (storedAttempt?.number === attempt && storedAttempt.receipt) return;
      this.assertUploading(current);
      if (storedAttempt?.number !== attempt || storedAttempt.invalid) {
        throw new AppError(409, 'Solicite a URL vigente desta faixa.');
      }
      return {
        directAttempts: { ...current.directAttempts, [stemId]: { number: attempt, receipt } },
        uploadedStemIds: STEM_IDS.filter((stem) => stem === stemId || current.uploadedStemIds.includes(stem)),
        updatedAt: this.now(),
      };
    });
    return this.uploadView(completed);
  }

  // Keeps a finished verification so that a timeout or failure during promotion does not discard it. Best effort:
  // a stale or concurrent state is ignored, and a failure here never changes the outcome of the seal.
  private async rememberVerification(scope: AudioScope, id: string, stemId: StemId, attempt: number, verified: VerifiedStaging) {
    try {
      await this.repository.update(scope, id, (current) => {
        this.assertUploading(current);
        const stored = current.directAttempts?.[stemId];
        if (stored?.number !== attempt || stored.receipt || stored.invalid) return;
        if (stored.verified?.etag === verified.etag && stored.verified.lastModified === verified.lastModified) return;
        return { directAttempts: { ...current.directAttempts, [stemId]: { number: attempt, verified } } };
      });
    } catch {
      // The next completion simply verifies again.
    }
  }

  async finalize(scope: AudioScope, id: string) {
    const record = await this.repository.read(scope, id, true);
    if (record.status === 'published') return summary(record);
    this.assertReadyToPublish(record);
    assertEnabledCodecs(record.manifest);
    if (record.transfer === 'direct') {
      assertPublishableMp3Set(record);
      await this.assertDirectObjects(record, this.getDirect(record));
    } else {
      for (const stem of record.manifest.stems) {
        if (stem.codec !== 'pcm_s16le') throw new AppError(409, 'Este codec exige envio direto.');
        await this.storage.verify(objectKey(record, stem.id), stem);
      }
    }
    const published = await this.repository.update(scope, id, (current) => {
      if (current.status === 'published') return;
      this.assertReadyToPublish(current);
      assertEnabledCodecs(current.manifest);
      assertPublishableMp3Set(current); // re-checked inside the transaction: a concurrent change cannot slip past
      const now = this.now();
      return {
        status: 'published', publishedAt: now, updatedAt: now, uploadedStemIds: [...STEM_IDS],
        uploadDeadline: undefined, cleanupAfter: current.transfer === 'direct' ? current.cleanupAfter : undefined,
      };
    });
    return summary(published);
  }

  async list(scope: AudioScope, input: ListInput) {
    const limit = input.limit ?? 15;
    const query = searchText(input.q);
    const binding = hash([scope.ministryId, query]);
    const cursor = parseCursor(input.cursor, binding);
    const rows = (await this.repository.list(scope, cursor, (query ? SEARCH_BATCH_SIZE : limit) + 1))
      .filter((row) => isVisibleManifest(row.manifest));
    const items = [];
    let nextCursor: string | null = null;
    for (const [index, row] of rows.entries()) {
      if ([row.title, row.artist, row.version].some((value) => searchText(value).includes(query))) {
        items.push(summary(row));
      }
      if (items.length === limit || index === SEARCH_BATCH_SIZE - 1) {
        if (index + 1 < rows.length) {
          nextCursor = Buffer.from(JSON.stringify([row.publishedAt, row.id, binding])).toString('base64url');
        }
        break;
      }
    }
    return { items, nextCursor };
  }

  async edit(scope: AudioScope, id: string, metadata: RecordingMetadata) {
    const record = await this.repository.update(scope, id, (current) => {
      if (current.status !== 'published') throw new AppError(404, 'Gravação não encontrada.');
      return { ...metadata, updatedAt: this.now() };
    });
    return summary(record);
  }

  async archive(scope: AudioScope, id: string) {
    const record = await this.repository.update(scope, id, (current) => {
      if (current.status === 'archived') return;
      if (current.status !== 'published') throw new AppError(404, 'Gravação não encontrada.');
      const now = this.now();
      return { status: 'archived', archivedAt: now, updatedAt: now, publishedAt: undefined };
    });
    return summary(record);
  }

  private signature(scope: AudioScope, id: string, stemId: StemId, expiresAt: number) {
    return createHmac('sha256', this.ticketSecret)
      .update(JSON.stringify([scope.ministryId, scope.userId, id, stemId, expiresAt])).digest();
  }

  private assertTicket(scope: AudioScope, id: string, stemId: StemId, ticket: string) {
    const [expiry, encoded] = ticket.split('.');
    const expiresAt = Number(expiry);
    const signature = Buffer.from(encoded ?? '', 'base64url');
    const expected = this.signature(scope, id, stemId, expiresAt);
    if (!/^\d{1,16}\.[A-Za-z0-9_-]{43}$/.test(ticket) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= this.now() ||
      signature.length !== expected.length || !timingSafeEqual(signature, expected)) {
      throw new AppError(403, 'URL de reprodução expirada ou inválida.');
    }
  }

  private getStem(record: AudioRecording, id: StemId) {
    const stem = record.manifest.stems.find((candidate) => candidate.id === id);
    if (!stem) throw new AppError(404, 'Faixa não encontrada.');
    return stem;
  }

  async playback(scope: AudioScope, id: string) {
    const record = await this.published(scope, id);
    const { manifest } = record;
    if (record.transfer === 'direct') {
      const storage = this.getDirect(record);
      await this.assertDirectObjects(record, storage);
      await this.published(scope, id);
      const expiresAt = this.now() + TICKET_TTL_MS;
      const tracks = await Promise.all(manifest.stems.map(async (stem) => ({
        id: stem.id,
        ...await storage.signDownload(finalKey(record, stem.id), this.getReceipt(record, stem.id), TICKET_TTL_MS / 1000),
      })));
      return { manifest, expiresAt, tracks, transfer: record.transfer };
    }
    const expiresAt = this.now() + TICKET_TTL_MS;
    return {
      manifest, expiresAt,
      tracks: manifest.stems.map((stem) => ({
        id: stem.id,
        url: `/${id}/stems/${stem.id}?ticket=${expiresAt}.${this.signature(scope, id, stem.id, expiresAt).toString('base64url')}`,
      })),
    };
  }

  async open(scope: AudioScope, id: string, stemId: StemId, ticket: string) {
    this.assertTicket(scope, id, stemId, ticket);
    const record = await this.published(scope, id);
    if (record.transfer === 'direct') throw new AppError(404, 'Faixa não encontrada.');
    const stem = this.getStem(record, stemId);
    if (stem.codec !== 'pcm_s16le') throw new AppError(404, 'Faixa não encontrada.');
    const stream = await this.storage.open(objectKey(record, stemId), stem);
    try {
      await this.published(scope, id);
      this.assertTicket(scope, id, stemId, ticket);
      return { stream, sizeBytes: stem.sizeBytes };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }

  async cleanup(scope: AudioScope) {
    let cleaned = 0;
    for (const id of await this.repository.listDue(scope, this.now())) {
      let claimed = false;
      const record = await this.repository.update(scope, id, (current) => {
        const now = this.now();
        const unpublished = current.status === 'uploading' || current.status === 'expired';
        claimed = (unpublished || current.transfer === 'direct') && current.expiresAt <= now &&
          current.cleanupAfter !== undefined && current.cleanupAfter <= now;
        if (!claimed) return;
        const lease = { cleanupAfter: now + CLEANUP_LEASE_MS };
        return unpublished
          ? { ...lease, status: 'expired', uploadDeadline: undefined, updatedAt: now }
          : lease;
      });
      if (!claimed) continue;
      // A failed removal leaves the lease eligible for retry after the timeout.
      if (record.transfer === 'direct') {
        const storage = this.getDirect(record);
        const keys = STEM_IDS.flatMap((stem) => {
          const attempts = record.directAttempts?.[stem]?.number ?? 0;
          const candidates = Array.from({ length: attempts }, (_, index) => stagingKey(record, stem, index + 1));
          if (record.status === 'expired' && attempts > 0) candidates.push(finalKey(record, stem));
          return candidates;
        });
        const removed = await Promise.allSettled(keys.map((key) => storage.remove(key)));
        const failure = removed.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      } else {
        for (const stem of STEM_IDS) await this.storage.remove(objectKey(record, stem));
      }
      await this.repository.update(scope, id, (current) => {
        if (current.cleanupAfter !== record.cleanupAfter) return;
        const cleanupPasses = (current.cleanupPasses ?? 0) + 1;
        // Revisit once after the upload time limit to collect objects from an in-flight write.
        return { cleanupPasses, cleanupAfter: cleanupPasses === 1 ? this.now() + DAY_MS : undefined };
      });
      cleaned += 1;
      // Bound the number of S3 operations per invocation.
      if (record.transfer === 'direct') break;
    }
    return { cleaned };
  }
}
