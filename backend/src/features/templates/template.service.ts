import { TemplateRepository, ScheduleTemplateRecord, TemplateItemRecord } from '../../repositories/TemplateRepository';

export class TemplateService {
  constructor(private readonly repo: TemplateRepository = new TemplateRepository()) {}

  async getTemplates(ministryId: string): Promise<ScheduleTemplateRecord[]> {
    return this.repo.getTemplates(ministryId);
  }

  async getTemplateById(id: string, ministryId: string): Promise<ScheduleTemplateRecord> {
    return this.repo.getTemplateById(id, ministryId);
  }

  async createTemplate(
    ministryId: string,
    data: { name: string; items: TemplateItemRecord[] }
  ): Promise<ScheduleTemplateRecord> {
    return this.repo.createTemplate(ministryId, data);
  }

  async updateTemplate(
    id: string,
    ministryId: string,
    data: { name?: string; items?: TemplateItemRecord[] }
  ): Promise<ScheduleTemplateRecord> {
    return this.repo.updateTemplate(id, ministryId, data);
  }

  async deleteTemplate(id: string, ministryId: string): Promise<void> {
    return this.repo.deleteTemplate(id, ministryId);
  }
}
