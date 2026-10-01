import { ScheduleRepository, ScheduleRecord, ScheduleCommentRecord } from '../../repositories/ScheduleRepository';
import { NotificationService } from '../notifications/notification.service';
import { AppError } from '../../middleware/error-handler';

export class ScheduleService {
  constructor(
    private readonly scheduleRepository: ScheduleRepository = new ScheduleRepository(),
    private readonly notificationService: NotificationService = new NotificationService()
  ) {}

  private validateParticipantUniqueness(participants?: Array<{ id: string }>): void {
    if (!participants || participants.length <= 1) return;
    const seen = new Set<string>();
    for (const p of participants) {
      const id = p.id?.trim();
      if (!id) continue;
      if (seen.has(id)) {
        throw new AppError(400, 'Não é permitido adicionar o mesmo participante mais de uma vez na escala.', {
          code: 'DUPLICATE_PARTICIPANT',
        });
      }
      seen.add(id);
    }
  }

  async listSchedules(ministryId: string): Promise<ScheduleRecord[]> {
    return this.scheduleRepository.getSchedulesByMinistry(ministryId);
  }

  async getScheduleById(scheduleId: string, ministryId: string): Promise<ScheduleRecord> {
    return this.scheduleRepository.getScheduleById(scheduleId, ministryId);
  }

  async createSchedule(ministryId: string, userId: string, data: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    this.validateParticipantUniqueness(data.participants);
    const created = await this.scheduleRepository.createSchedule(ministryId, userId, data);

    if (created.participants && created.participants.length > 0) {
      try {
        const participantUserIds = await this.notificationService.resolveParticipantUserIds(
          ministryId,
          created.participants
        );
        await this.notificationService.notifyScheduleAssigned(
          ministryId,
          created,
          participantUserIds,
          userId
        );
      } catch (err) {
        console.warn('Falha não-bloqueante ao processar notificações de criação da escala:', err);
      }
    }

    return created;
  }

  async updateSchedule(
    scheduleId: string,
    ministryId: string,
    data: Partial<ScheduleRecord>,
    actorId?: string
  ): Promise<ScheduleRecord> {
    if (data.participants !== undefined) {
      this.validateParticipantUniqueness(data.participants);
    }
    let previous: ScheduleRecord | null = null;
    try {
      previous = await this.scheduleRepository.getScheduleById(scheduleId, ministryId);
    } catch {
      // If get fails, let updateSchedule handle repository error
    }

    const updated = await this.scheduleRepository.updateSchedule(scheduleId, ministryId, data);

    if (previous) {
      try {
        await this.notificationService.notifyScheduleUpdated(
          ministryId,
          previous,
          updated,
          actorId
        );
      } catch (err) {
        console.warn('Falha não-bloqueante ao processar notificações de atualização da escala:', err);
      }
    }

    return updated;
  }

  async deleteSchedule(scheduleId: string, ministryId: string): Promise<void> {
    await this.scheduleRepository.deleteSchedule(scheduleId, ministryId);
  }

  async updateConfirmation(
    scheduleId: string,
    ministryId: string,
    userId: string,
    userName: string,
    confirmed: boolean
  ): Promise<ScheduleRecord> {
    return this.scheduleRepository.updateParticipantConfirmation(scheduleId, ministryId, userId, userName, confirmed);
  }

  async getScheduleComments(
    scheduleId: string,
    ministryId: string,
    limitCount = 50,
    olderCursor?: string
  ): Promise<ScheduleCommentRecord[]> {
    return this.scheduleRepository.getScheduleComments(scheduleId, ministryId, limitCount, olderCursor);
  }

  async addScheduleComment(
    ministryId: string,
    scheduleId: string,
    userId: string,
    userName: string,
    content: string
  ): Promise<ScheduleCommentRecord> {
    const comment = await this.scheduleRepository.addScheduleComment(ministryId, scheduleId, userId, userName, content);

    try {
      const schedule = await this.scheduleRepository.getScheduleById(scheduleId, ministryId);
      await this.notificationService.notifyScheduleComment(
        ministryId,
        schedule,
        comment,
        userId,
        userName
      );
    } catch (err) {
      console.warn('Falha não-bloqueante ao processar notificações de comentário na escala:', err);
    }

    return comment;
  }
}

