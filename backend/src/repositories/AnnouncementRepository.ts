import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export interface AnnouncementRecord {
  id: string;
  ministry_id: string;
  title: string;
  content: string;
  author: string;
  important: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateAnnouncementData {
  ministry_id: string;
  title: string;
  content: string;
  author: string;
  important: boolean;
  created_by: string;
}

export interface UpdateAnnouncementData {
  title?: string;
  content?: string;
  author?: string;
  important?: boolean;
}

export class AnnouncementRepository {
  private readonly announcementsCol = db.collection('ministry_announcements');

  async getAnnouncementsByMinistry(ministryId: string, limitCount = 20): Promise<AnnouncementRecord[]> {
    const boundedLimit = Math.min(Math.max(1, limitCount), 50);
    const snap = await this.announcementsCol
      .where('ministry_id', '==', ministryId)
      .orderBy('created_at', 'desc')
      .limit(boundedLimit)
      .get();

    return snap.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        ministry_id: data.ministry_id || ministryId,
        title: data.title || '',
        content: data.content || '',
        author: data.author || 'Liderança',
        important: Boolean(data.important),
        created_by: data.created_by || '',
        created_at: data.created_at || new Date().toISOString(),
        updated_at: data.updated_at || data.created_at || new Date().toISOString(),
      } as AnnouncementRecord;
    });
  }

  async getAnnouncementById(id: string, ministryId: string): Promise<AnnouncementRecord> {
    const doc = await this.announcementsCol.doc(id).get();
    if (!doc.exists) {
      throw new AppError(404, 'Aviso não encontrado.');
    }

    const data = doc.data();
    if (!data || data.ministry_id !== ministryId) {
      // Fail closed to prevent IDOR existence disclosure across tenants
      throw new AppError(404, 'Aviso não encontrado.');
    }

    return {
      id: doc.id,
      ministry_id: data.ministry_id,
      title: data.title || '',
      content: data.content || '',
      author: data.author || 'Liderança',
      important: Boolean(data.important),
      created_by: data.created_by || '',
      created_at: data.created_at || new Date().toISOString(),
      updated_at: data.updated_at || data.created_at || new Date().toISOString(),
    } as AnnouncementRecord;
  }

  async createAnnouncement(data: CreateAnnouncementData): Promise<AnnouncementRecord> {
    const now = new Date().toISOString();
    const ref = this.announcementsCol.doc();
    const record: AnnouncementRecord = {
      id: ref.id,
      ministry_id: data.ministry_id,
      title: data.title.trim(),
      content: data.content.trim(),
      author: data.author?.trim() || 'Liderança',
      important: Boolean(data.important),
      created_by: data.created_by,
      created_at: now,
      updated_at: now,
    };

    await ref.set(record);
    return record;
  }

  async updateAnnouncement(
    id: string,
    ministryId: string,
    data: UpdateAnnouncementData
  ): Promise<AnnouncementRecord> {
    const existing = await this.getAnnouncementById(id, ministryId);
    const now = new Date().toISOString();

    const updates: Partial<AnnouncementRecord> & { updated_at: string } = {
      updated_at: now,
    };

    if (data.title !== undefined) {
      updates.title = data.title.trim();
    }
    if (data.content !== undefined) {
      updates.content = data.content.trim();
    }
    if (data.author !== undefined) {
      updates.author = data.author.trim();
    }
    if (data.important !== undefined) {
      updates.important = Boolean(data.important);
    }

    // Security: strictly reject altering ministry_id, created_by, or created_at
    delete (updates as any).ministry_id;
    delete (updates as any).created_by;
    delete (updates as any).created_at;

    await this.announcementsCol.doc(id).update(updates);
    return { ...existing, ...updates };
  }

  async deleteAnnouncement(id: string, ministryId: string): Promise<void> {
    await this.getAnnouncementById(id, ministryId);
    await this.announcementsCol.doc(id).delete();
  }
}
