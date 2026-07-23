import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export interface ClassificationRecord {
  id: string;
  ministry_id: string;
  name: string;
  description?: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_CLASSIFICATIONS: Array<{ name: string; description: string }> = [
  { name: 'Louvor', description: 'Músicas de exaltação, alegria e celebração.' },
  { name: 'Adoração', description: 'Músicas intimas de reverência e entrega.' },
  { name: 'Contemplação', description: 'Músicas de reflexão e meditação na palavra.' },
  { name: 'Convite', description: 'Músicas para momentos de apelo e decisão.' },
  { name: 'Consagração', description: 'Músicas de dedicação e santificação.' },
  { name: 'Júbilo', description: 'Músicas vibrantes e festivas de celebração.' },
  { name: 'Especiais', description: 'Músicas para datas comemorativas e momentos específicos.' },
];

export class ClassificationRepository {
  private readonly classificationsCol = db.collection('ministry_classifications');

  async getClassifications(ministryId: string): Promise<ClassificationRecord[]> {
    const snap = await this.classificationsCol.where('ministry_id', '==', ministryId).get();
    const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ClassificationRecord));
    return list.sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }

  async getClassificationById(id: string, ministryId: string): Promise<ClassificationRecord> {
    const doc = await this.classificationsCol.doc(id).get();
    if (!doc.exists) throw new AppError(404, 'Classificação não encontrada.');
    const data = { id: doc.id, ...doc.data() } as ClassificationRecord;
    if (data.ministry_id !== ministryId) throw new AppError(403, 'Classificação não pertence a este ministério.');
    return data;
  }

  async createClassification(
    ministryId: string,
    data: { name: string; description?: string; isDefault?: boolean }
  ): Promise<ClassificationRecord> {
    const now = new Date().toISOString();
    const ref = this.classificationsCol.doc();
    const record: ClassificationRecord = {
      id: ref.id,
      ministry_id: ministryId,
      name: data.name,
      description: data.description || null,
      is_default: data.isDefault || false,
      created_at: now,
      updated_at: now,
    };
    await ref.set(record);
    return record;
  }

  async updateClassification(
    id: string,
    ministryId: string,
    data: { name?: string; description?: string | null }
  ): Promise<ClassificationRecord> {
    const existing = await this.getClassificationById(id, ministryId);
    const now = new Date().toISOString();
    const updates: Partial<ClassificationRecord> & { updated_at: string } = { updated_at: now };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    await this.classificationsCol.doc(id).update(updates);
    return { ...existing, ...updates };
  }

  async deleteClassification(id: string, ministryId: string): Promise<void> {
    await this.getClassificationById(id, ministryId);
    await this.classificationsCol.doc(id).delete();
  }

  async seedDefaultClassifications(ministryId: string): Promise<ClassificationRecord[]> {
    const existing = await this.classificationsCol
      .where('ministry_id', '==', ministryId)
      .where('is_default', '==', true)
      .get();
    if (!existing.empty) return [];

    const now = new Date().toISOString();
    const batch = db.batch();
    const records: ClassificationRecord[] = [];

    for (const item of DEFAULT_CLASSIFICATIONS) {
      const ref = this.classificationsCol.doc();
      const record: ClassificationRecord = {
        id: ref.id,
        ministry_id: ministryId,
        name: item.name,
        description: item.description,
        is_default: true,
        created_at: now,
        updated_at: now,
      };
      batch.set(ref, record);
      records.push(record);
    }

    await batch.commit();
    return records;
  }
}
