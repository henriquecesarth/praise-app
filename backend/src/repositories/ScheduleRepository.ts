import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export interface ScheduleRecord {
  id: string;
  ministry_id: string;
  created_by: string;
  title: string;
  date: string;
  time: string;
  notes?: string;
  isVisible: boolean;
  colorPalette?: string;
  clothingPieces?: any[];
  requireConfirmation?: boolean;
  participants: Array<{ id: string; name: string; role: string; confirmed?: boolean }>;
  songs: any[];
  timeline: Array<{ id: string; title: string; time?: string; type: string }>;
  created_at: string;
  updated_at: string;
}

export interface ScheduleCommentRecord {
  id: string;
  schedule_id: string;
  ministry_id: string;
  user_id: string;
  user_name: string;
  content: string;
  created_at: string;
}

export class ScheduleRepository {
  private readonly schedulesCol = db.collection('schedules');
  private readonly commentsCol = db.collection('schedule_comments');

  async getSchedulesByMinistry(ministryId: string): Promise<ScheduleRecord[]> {
    const snap = await this.schedulesCol.where('ministry_id', '==', ministryId).get();
    const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ScheduleRecord));
    list.sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1));
    return list;
  }

  async getScheduleById(scheduleId: string): Promise<ScheduleRecord> {
    const doc = await this.schedulesCol.doc(scheduleId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Escala não encontrada.');
    }
    return { id: doc.id, ...doc.data() } as ScheduleRecord;
  }

  async createSchedule(ministryId: string, userId: string, data: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    const now = new Date().toISOString();
    const ref = this.schedulesCol.doc();

    const scheduleData: ScheduleRecord = {
      id: ref.id,
      ministry_id: ministryId,
      created_by: userId,
      title: data.title || 'Novo Culto',
      date: data.date || now.split('T')[0],
      time: data.time || '19:00',
      notes: data.notes || '',
      isVisible: data.isVisible !== undefined ? data.isVisible : true,
      colorPalette: data.colorPalette || '#7C3AED',
      clothingPieces: data.clothingPieces || [],
      requireConfirmation: data.requireConfirmation || false,
      participants: data.participants || [],
      songs: data.songs || [],
      timeline: data.timeline || [],
      created_at: now,
      updated_at: now,
    };

    await ref.set(scheduleData);
    return scheduleData;
  }

  async updateSchedule(scheduleId: string, data: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    const ref = this.schedulesCol.doc(scheduleId);
    const doc = await ref.get();
    if (!doc.exists) {
      throw new AppError(404, 'Escala não encontrada.');
    }

    const now = new Date().toISOString();
    const updatePayload = {
      ...data,
      updated_at: now,
    };

    await ref.update(updatePayload);
    const updatedDoc = await ref.get();
    return { id: updatedDoc.id, ...updatedDoc.data() } as ScheduleRecord;
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.schedulesCol.doc(scheduleId).delete();
  }

  async getScheduleComments(
    scheduleId: string,
    userId: string,
    userName: string,
    userRole?: string
  ): Promise<ScheduleCommentRecord[]> {
    const scheduleDoc = await this.schedulesCol.doc(scheduleId).get();
    if (!scheduleDoc.exists) {
      throw new AppError(404, 'Escala não encontrada.');
    }
    const schedule = scheduleDoc.data() as ScheduleRecord;

    const isParticipant = (schedule.participants || []).some(
      (p) => p.id === userId || (p as any).userId === userId || (p.name && p.name.toLowerCase().trim() === userName.toLowerCase().trim())
    );
    const isOwnerOrAdmin = schedule.created_by === userId || userRole === 'admin';

    if (!isParticipant && !isOwnerOrAdmin) {
      throw new AppError(403, 'Apenas participantes escalados nesta escala têm acesso aos comentários.');
    }

    const snap = await this.commentsCol.where('schedule_id', '==', scheduleId).get();
    const list = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as ScheduleCommentRecord));
    list.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
    return list;
  }

  async addScheduleComment(
    ministryId: string,
    scheduleId: string,
    userId: string,
    userName: string,
    content: string,
    userRole?: string
  ): Promise<ScheduleCommentRecord> {
    const scheduleDoc = await this.schedulesCol.doc(scheduleId).get();
    if (!scheduleDoc.exists) {
      throw new AppError(404, 'Escala não encontrada.');
    }
    const schedule = scheduleDoc.data() as ScheduleRecord;

    const isParticipant = (schedule.participants || []).some(
      (p) => p.id === userId || (p as any).userId === userId || (p.name && p.name.toLowerCase().trim() === userName.toLowerCase().trim())
    );
    const isOwnerOrAdmin = schedule.created_by === userId || userRole === 'admin';

    if (!isParticipant && !isOwnerOrAdmin) {
      throw new AppError(403, 'Apenas participantes escalados nesta escala têm acesso aos comentários.');
    }

    const now = new Date().toISOString();
    const ref = this.commentsCol.doc();
    const commentData: ScheduleCommentRecord = {
      id: ref.id,
      schedule_id: scheduleId,
      ministry_id: ministryId,
      user_id: userId,
      user_name: userName,
      content,
      created_at: now,
    };

    await ref.set(commentData);
    return commentData;
  }
}
