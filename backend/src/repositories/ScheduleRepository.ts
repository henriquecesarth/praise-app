import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export interface CommentCursorData {
  id: string;
  c: string; // created_at
  s: string; // schedule_id
}

export function encodeCommentCursor(data: CommentCursorData): string {
  return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function decodeCommentCursor(token: string, expectedScheduleId: string): CommentCursorData {
  try {
    const raw = Buffer.from(token, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.c || !parsed.s) {
      throw new Error('Formato de cursor inválido');
    }
    if (parsed.s !== expectedScheduleId) {
      throw new AppError(403, 'Acesso negado: cursor pertence a outra escala.', {
        code: 'CROSS_SCHEDULE_CURSOR_REJECTED',
      });
    }
    return parsed as CommentCursorData;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(400, 'Token de cursor inválido.');
  }
}

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

  async getScheduleById(scheduleId: string, ministryId: string): Promise<ScheduleRecord> {
    const doc = await this.schedulesCol.doc(scheduleId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Escala não encontrada.');
    }
    const data = { id: doc.id, ...doc.data() } as ScheduleRecord;
    if (data.ministry_id !== ministryId) {
      throw new AppError(404, 'Escala não encontrada.');
    }
    return data;
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

  async updateSchedule(scheduleId: string, ministryId: string, data: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    const existing = await this.getScheduleById(scheduleId, ministryId);

    const ref = this.schedulesCol.doc(scheduleId);
    const now = new Date().toISOString();
    const updatePayload: any = {
      ...data,
      updated_at: now,
    };

    // Mass assignment guard
    delete updatePayload.id;
    delete updatePayload.ministry_id;
    delete updatePayload.created_by;

    await ref.update(updatePayload);
    const updatedDoc = await ref.get();
    return { id: updatedDoc.id, ...updatedDoc.data() } as ScheduleRecord;
  }

  async deleteSchedule(scheduleId: string, ministryId: string): Promise<void> {
    await this.getScheduleById(scheduleId, ministryId);

    // Excluir comentários associados à escala
    const commentsSnap = await this.commentsCol.where('schedule_id', '==', scheduleId).get();
    const commentDeletes = commentsSnap.docs.map((d) => d.ref.delete());
    await Promise.all(commentDeletes);

    await this.schedulesCol.doc(scheduleId).delete();
  }

  async updateParticipantConfirmation(
    scheduleId: string,
    ministryId: string,
    userId: string,
    userName: string,
    confirmed: boolean
  ): Promise<ScheduleRecord> {
    const schedule = await this.getScheduleById(scheduleId, ministryId);
    const ref = this.schedulesCol.doc(scheduleId);

    const todayStr = new Date().toISOString().split('T')[0];
    if (schedule.date < todayStr) {
      throw new AppError(400, 'Não é possível alterar a confirmação de presença de uma escala que já passou.');
    }

    let memberId: string | null = null;
    let userRealName: string = userName || '';

    // Consultar pertencimento oficial na coleção ministry_members
    const memberSnap = await db.collection('ministry_members')
      .where('ministry_id', '==', ministryId)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    if (!memberSnap.empty) {
      memberId = memberSnap.docs[0].id;
    }

    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const uData = userDoc.data();
      if (uData?.name || uData?.displayName) {
        userRealName = uData.name || uData.displayName;
      }
    }

    const normName = userRealName.toLowerCase().trim();

    let updatedCount = 0;
    const updatedParticipants = (schedule.participants || []).map((p) => {
      const pId = String(p.id || '');
      const pUserId = String((p as any).userId || (p as any).user_id || '');
      const pNormName = (p.name || '').toLowerCase().trim();

      const matchId =
        pId === userId ||
        pUserId === userId ||
        (memberId && pId === memberId) ||
        (userId && pId.includes(userId));

      const matchName =
        pNormName &&
        normName &&
        (pNormName === normName || pNormName.includes(normName) || normName.includes(pNormName));

      if (matchId || matchName) {
        updatedCount++;
        return {
          ...p,
          confirmed,
        };
      }
      return p;
    });

    if (updatedCount === 0) {
      throw new AppError(403, 'Você não está listado como participante desta escala.');
    }

    const now = new Date().toISOString();

    await ref.update({
      participants: updatedParticipants,
      updated_at: now,
    });

    const updatedDoc = await ref.get();
    return { id: updatedDoc.id, ...updatedDoc.data() } as ScheduleRecord;
  }

  async getScheduleComments(
    scheduleId: string,
    ministryId: string,
    limitCount = 50,
    olderCursor?: string
  ): Promise<ScheduleCommentRecord[]> {
    await this.getScheduleById(scheduleId, ministryId);

    let query: any = this.commentsCol
      .where('schedule_id', '==', scheduleId)
      .orderBy('created_at', 'desc')
      .orderBy(FieldPath.documentId(), 'desc');

    if (olderCursor) {
      const cursorData = decodeCommentCursor(olderCursor, scheduleId);
      query = query.startAfter(cursorData.c, cursorData.id);
    }

    try {
      const snap = await query.limit(limitCount).get();
      const list = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as ScheduleCommentRecord));
      list.reverse();
      return list;
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        console.error('Erro na query de comentários do Firestore:', err);
        throw new AppError(500, 'Erro ao consultar comentários da escala. Verifique os índices do banco de dados.', {
          code: 'INDEX_REQUIRED_OR_QUERY_ERROR',
        });
      }

      console.warn('Fallback de desenvolvimento para comentários:', err?.message);
      const snap = await this.commentsCol.where('schedule_id', '==', scheduleId).get();
      const list = snap.docs.map((doc: any) => ({ id: doc.id, ...doc.data() } as ScheduleCommentRecord));
      list.sort((a, b) => (a.created_at > b.created_at ? 1 : -1));
      return list.slice(-limitCount);
    }
  }

  async addScheduleComment(
    ministryId: string,
    scheduleId: string,
    userId: string,
    userName: string,
    content: string
  ): Promise<ScheduleCommentRecord> {
    await this.getScheduleById(scheduleId, ministryId);

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

