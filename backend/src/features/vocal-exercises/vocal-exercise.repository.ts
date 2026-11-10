import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import { assertPreviewUidAllowed } from '../../config/unifiedConfig';
import type { CustomVocalExercise, CustomVocalExerciseInput, UpdateCustomVocalExerciseInput } from './vocal-exercise.types';

export class VocalExerciseRepository {
  private getCollection(userId: string) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }
    assertPreviewUidAllowed(userId);
    return db.collection('users').doc(userId).collection('custom_vocal_exercises');
  }

  async listByUserId(userId: string): Promise<CustomVocalExercise[]> {
    const col = this.getCollection(userId);
    const snapshot = await col.orderBy('createdAt', 'desc').get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as Omit<CustomVocalExercise, 'id'>),
    }));
  }

  async getById(userId: string, exerciseId: string): Promise<CustomVocalExercise | null> {
    const col = this.getCollection(userId);
    const doc = await col.doc(exerciseId).get();
    if (!doc.exists) {
      return null;
    }
    return {
      id: doc.id,
      ...(doc.data() as Omit<CustomVocalExercise, 'id'>),
    };
  }

  async create(
    userId: string,
    data: CustomVocalExerciseInput & { category: 'ascendente' | 'descendente' | 'misto' }
  ): Promise<CustomVocalExercise> {
    const col = this.getCollection(userId);
    const exerciseRef = col.doc();
    const now = new Date().toISOString();

    const record: CustomVocalExercise = {
      id: exerciseRef.id,
      userId,
      title: data.title,
      description: data.description || '',
      notes: data.notes,
      noteDurations: data.noteDurations,
      minTranspose: data.minTranspose ?? -12,
      maxTranspose: data.maxTranspose ?? 12,
      category: data.category,
      isCustom: true,
      createdAt: now,
      updatedAt: now,
    };

    await exerciseRef.set(record);
    return record;
  }

  async update(
    userId: string,
    exerciseId: string,
    patch: UpdateCustomVocalExerciseInput & { category?: 'ascendente' | 'descendente' | 'misto' }
  ): Promise<CustomVocalExercise> {
    const col = this.getCollection(userId);
    const docRef = col.doc(exerciseId);
    const existing = await docRef.get();

    if (!existing.exists) {
      throw new AppError(404, 'Exercício vocal não encontrado.');
    }

    const existingData = existing.data() as CustomVocalExercise;
    if (existingData.userId && existingData.userId !== userId) {
      throw new AppError(403, 'Acesso não autorizado a este exercício vocal.');
    }

    const now = new Date().toISOString();
    const updatedRecord: CustomVocalExercise = {
      ...existingData,
      ...patch,
      id: exerciseId,
      userId,
      updatedAt: now,
    };

    // Revalidação de consistência se apenas notes ou apenas durations forem alterados
    if (updatedRecord.notes.length !== updatedRecord.noteDurations.length) {
      throw new AppError(400, 'A quantidade de notas deve corresponder à quantidade de durações.');
    }
    if (updatedRecord.minTranspose > updatedRecord.maxTranspose) {
      throw new AppError(400, 'minTranspose não pode ser maior que maxTranspose.');
    }

    await docRef.set(updatedRecord, { merge: true });
    return updatedRecord;
  }

  async delete(userId: string, exerciseId: string): Promise<void> {
    const col = this.getCollection(userId);
    const docRef = col.doc(exerciseId);
    const existing = await docRef.get();

    if (!existing.exists) {
      throw new AppError(404, 'Exercício vocal não encontrado.');
    }

    const existingData = existing.data() as CustomVocalExercise;
    if (existingData.userId && existingData.userId !== userId) {
      throw new AppError(403, 'Acesso não autorizado a este exercício vocal.');
    }

    await docRef.delete();
  }
}
