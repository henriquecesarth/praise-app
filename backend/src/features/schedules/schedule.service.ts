import { ScheduleRepository, ScheduleRecord, ScheduleCommentRecord } from '../../repositories/ScheduleRepository';

export class ScheduleService {
  constructor(private readonly scheduleRepository: ScheduleRepository = new ScheduleRepository()) {}

  async listSchedules(ministryId: string): Promise<ScheduleRecord[]> {
    return this.scheduleRepository.getSchedulesByMinistry(ministryId);
  }

  async getScheduleById(scheduleId: string, ministryId: string): Promise<ScheduleRecord> {
    return this.scheduleRepository.getScheduleById(scheduleId, ministryId);
  }

  async createSchedule(ministryId: string, userId: string, data: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    return this.scheduleRepository.createSchedule(ministryId, userId, data);
  }

  async updateSchedule(scheduleId: string, ministryId: string, data: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    return this.scheduleRepository.updateSchedule(scheduleId, ministryId, data);
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
    return this.scheduleRepository.addScheduleComment(ministryId, scheduleId, userId, userName, content);
  }
}

