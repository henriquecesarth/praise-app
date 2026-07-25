import { ScheduleRepository, ScheduleRecord, ScheduleCommentRecord } from '../../repositories/ScheduleRepository';

export class ScheduleService {
  constructor(private readonly scheduleRepository: ScheduleRepository = new ScheduleRepository()) {}

  async listSchedules(ministryId: string): Promise<ScheduleRecord[]> {
    return this.scheduleRepository.getSchedulesByMinistry(ministryId);
  }

  async getScheduleById(scheduleId: string): Promise<ScheduleRecord> {
    return this.scheduleRepository.getScheduleById(scheduleId);
  }

  async createSchedule(ministryId: string, userId: string, data: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    return this.scheduleRepository.createSchedule(ministryId, userId, data);
  }

  async updateSchedule(scheduleId: string, data: Partial<ScheduleRecord>): Promise<ScheduleRecord> {
    return this.scheduleRepository.updateSchedule(scheduleId, data);
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    await this.scheduleRepository.deleteSchedule(scheduleId);
  }

  async updateConfirmation(
    scheduleId: string,
    userId: string,
    userName: string,
    confirmed: boolean
  ): Promise<ScheduleRecord> {
    return this.scheduleRepository.updateParticipantConfirmation(scheduleId, userId, userName, confirmed);
  }

  async getScheduleComments(
    scheduleId: string,
    userId: string,
    userName: string,
    userRole?: string
  ): Promise<ScheduleCommentRecord[]> {
    return this.scheduleRepository.getScheduleComments(scheduleId, userId, userName, userRole);
  }

  async addScheduleComment(
    ministryId: string,
    scheduleId: string,
    userId: string,
    userName: string,
    content: string,
    userRole?: string
  ): Promise<ScheduleCommentRecord> {
    return this.scheduleRepository.addScheduleComment(ministryId, scheduleId, userId, userName, content, userRole);
  }
}
