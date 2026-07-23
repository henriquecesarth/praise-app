import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export interface TemplateItemRecord {
  id: string;
  type: 'song' | 'event';
  title: string;
  description?: string | null;
  durationSeconds?: number | null;
  icon?: string | null;
  order: number;
}

export interface ScheduleTemplateRecord {
  id: string;
  ministry_id: string;
  name: string;
  items: TemplateItemRecord[];
  created_at: string;
  updated_at: string;
}

export class TemplateRepository {
  private readonly templatesCol = db.collection('ministry_schedule_templates');

  async getTemplates(ministryId: string): Promise<ScheduleTemplateRecord[]> {
    const snap = await this.templatesCol.where('ministry_id', '==', ministryId).get();
    const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ScheduleTemplateRecord));
    return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getTemplateById(id: string, ministryId: string): Promise<ScheduleTemplateRecord> {
    const doc = await this.templatesCol.doc(id).get();
    if (!doc.exists) throw new AppError(404, 'Modelo de roteiro não encontrado.');
    const data = { id: doc.id, ...doc.data() } as ScheduleTemplateRecord;
    if (data.ministry_id !== ministryId) throw new AppError(403, 'Modelo de roteiro não pertence a este ministério.');
    return data;
  }

  async createTemplate(
    ministryId: string,
    data: { name: string; items: TemplateItemRecord[] }
  ): Promise<ScheduleTemplateRecord> {
    const now = new Date().toISOString();
    const ref = this.templatesCol.doc();
    const record: ScheduleTemplateRecord = {
      id: ref.id,
      ministry_id: ministryId,
      name: data.name,
      items: data.items || [],
      created_at: now,
      updated_at: now,
    };
    await ref.set(record);
    return record;
  }

  async updateTemplate(
    id: string,
    ministryId: string,
    data: { name?: string; items?: TemplateItemRecord[] }
  ): Promise<ScheduleTemplateRecord> {
    const existing = await this.getTemplateById(id, ministryId);
    const now = new Date().toISOString();
    const updates: Partial<ScheduleTemplateRecord> & { updated_at: string } = { updated_at: now };
    if (data.name !== undefined) updates.name = data.name;
    if (data.items !== undefined) updates.items = data.items;
    await this.templatesCol.doc(id).update(updates);
    return { ...existing, ...updates };
  }

  async deleteTemplate(id: string, ministryId: string): Promise<void> {
    await this.getTemplateById(id, ministryId);
    await this.templatesCol.doc(id).delete();
  }
}
