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

  async updateParticipantConfirmation(
    scheduleId: string,
    userId: string,
    userName: string,
    confirmed: boolean
  ): Promise<ScheduleRecord> {
    const ref = this.schedulesCol.doc(scheduleId);
    const doc = await ref.get();
    if (!doc.exists) {
      throw new AppError(404, 'Escala não encontrada.');
    }
    const schedule = doc.data() as ScheduleRecord;

    // Buscar memberId na coleção group_members e nome do usuário na coleção users
    let memberId: string | null = null;
    let userRealName: string = userName || '';
    if (schedule.ministry_id) {
      const memberSnap = await db.collection('group_members')
        .where('group_id', '==', schedule.ministry_id)
        .where('user_id', '==', userId)
        .limit(1)
        .get();
      if (!memberSnap.empty) {
        memberId = memberSnap.docs[0].id;
      }
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
      if (schedule.participants && schedule.participants.length > 0) {
        const targetIndex = schedule.participants.findIndex((p) => p.confirmed === undefined) !== -1
          ? schedule.participants.findIndex((p) => p.confirmed === undefined)
          : 0;

        schedule.participants[targetIndex] = {
          ...schedule.participants[targetIndex],
          confirmed,
        };
        updatedCount = 1;
      } else {
        throw new AppError(403, 'Você não está listado como participante desta escala.');
      }
    }

    const now = new Date().toISOString();
    const finalParticipants = updatedCount === 1 && schedule.participants.length > 0 && updatedParticipants.every(p => p.confirmed === undefined)
      ? schedule.participants
      : updatedParticipants;

    await ref.update({
      participants: finalParticipants,
      updated_at: now,
    });

    const updatedDoc = await ref.get();
    return { id: updatedDoc.id, ...updatedDoc.data() } as ScheduleRecord;
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
