import { FieldPath, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import type { AudioManifest, RecordingMetadata, StemId } from './ministry-audio.schema';

export interface AudioScope {
  ministryId: string;
  userId: string;
}

export interface AudioRecording extends RecordingMetadata {
  id: string;
  ministryId: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  status: 'uploading' | 'published' | 'archived' | 'expired';
  manifest: AudioManifest;
  requestHash: string;
  uploadedStemIds: StemId[];
  expiresAt: number;
  uploadDeadline?: number;
  publishedAt?: number;
  archivedAt?: number;
  cleanupAfter?: number;
  cleanupPasses?: number;
}

export interface AudioCursor {
  publishedAt: number;
  id: string;
}

export class MinistryAudioRepository {
  private readonly ministries = new MinistryRepository();

  private recordings(ministryId: string) {
    return db.collection('ministries').doc(ministryId).collection('audio_recordings');
  }

  async authorize(scope: AudioScope, admin: boolean, transaction?: Transaction): Promise<void> {
    const ministry = await this.ministries.getMinistryById(scope.ministryId, scope.userId, transaction);
    if (admin && ministry.role !== 'admin') {
      throw new AppError(403, 'Ação restrita a administradores do ministério.');
    }
  }

  private toRecording(data: FirebaseFirestore.DocumentData | undefined, scope: AudioScope, id: string) {
    if (!data || data.ministryId !== scope.ministryId || data.id !== id) {
      throw new AppError(404, 'Gravação não encontrada.');
    }
    return data as AudioRecording;
  }

  async read(scope: AudioScope, id: string, admin: boolean): Promise<AudioRecording> {
    return db.runTransaction(async (transaction) => {
      await this.authorize(scope, admin, transaction);
      const snapshot = await transaction.get(this.recordings(scope.ministryId).doc(id));
      return this.toRecording(snapshot.data(), scope, id);
    }, { readOnly: true });
  }

  async reserve(scope: AudioScope, proposed: AudioRecording, now: () => number): Promise<AudioRecording> {
    const collection = this.recordings(scope.ministryId);
    const ref = collection.doc(proposed.id);
    return db.runTransaction(async (transaction) => {
      await this.authorize(scope, true, transaction);
      const snapshot = await transaction.get(ref);
      if (snapshot.exists) {
        const existing = this.toRecording(snapshot.data(), scope, ref.id);
        if (existing.requestHash !== proposed.requestHash) {
          throw new AppError(409, 'Esta chave de idempotência já foi usada com outros dados.');
        }
        return existing;
      }
      const createdAt = now();
      const active = await transaction.get(collection.where('uploadDeadline', '>', createdAt).limit(8));
      if (active.size >= 8) {
        throw new AppError(429, 'O ministério tem oito uploads em andamento.');
      }
      const expiresAt = createdAt + (proposed.expiresAt - proposed.createdAt);
      const created = {
        ...proposed, createdAt, updatedAt: createdAt, expiresAt,
        uploadDeadline: expiresAt, cleanupAfter: expiresAt,
      };
      transaction.create(ref, created);
      return created;
    });
  }

  async update(
    scope: AudioScope,
    id: string,
    change: (record: AudioRecording) => Partial<AudioRecording> | undefined
  ): Promise<AudioRecording> {
    const ref = this.recordings(scope.ministryId).doc(id);
    return db.runTransaction(async (transaction) => {
      await this.authorize(scope, true, transaction);
      const record = this.toRecording((await transaction.get(ref)).data(), scope, id);
      const update = change(record);
      if (!update) return record;
      const fields = Object.fromEntries(
        Object.entries(update).map(([key, value]) => [key, value === undefined ? FieldValue.delete() : value])
      );
      transaction.update(ref, fields);
      return { ...record, ...update };
    });
  }

  async list(scope: AudioScope, cursor: AudioCursor | undefined, limit: number): Promise<AudioRecording[]> {
    return db.runTransaction(async (transaction) => {
      await this.authorize(scope, false, transaction);
      let query = this.recordings(scope.ministryId).orderBy('publishedAt', 'desc').orderBy(FieldPath.documentId(), 'desc');
      if (cursor) query = query.startAfter(cursor.publishedAt, cursor.id);
      const snapshot = await transaction.get(query.limit(limit));
      return snapshot.docs.flatMap((doc) => {
        const record = doc.data() as AudioRecording;
        return record.status === 'published' && record.ministryId === scope.ministryId && record.id === doc.id
          ? [record]
          : [];
      });
    }, { readOnly: true });
  }

  async listDue(scope: AudioScope, at: number): Promise<string[]> {
    await this.authorize(scope, true);
    const due = await this.recordings(scope.ministryId).where('cleanupAfter', '<=', at).orderBy('cleanupAfter').limit(10).get();
    return due.docs.map((doc) => doc.id);
  }
}
