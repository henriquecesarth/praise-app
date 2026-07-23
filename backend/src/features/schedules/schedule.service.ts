import { ScheduleRepository, ScheduleRecord } from '../../repositories/ScheduleRepository';

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
}
