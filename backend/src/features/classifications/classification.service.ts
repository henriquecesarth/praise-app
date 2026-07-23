import { ClassificationRepository, ClassificationRecord } from '../../repositories/ClassificationRepository';

export class ClassificationService {
  constructor(private readonly repo: ClassificationRepository = new ClassificationRepository()) {}

  async getClassifications(ministryId: string): Promise<ClassificationRecord[]> {
    await this.repo.seedDefaultClassifications(ministryId);
    return this.repo.getClassifications(ministryId);
  }

  async getClassificationById(id: string, ministryId: string): Promise<ClassificationRecord> {
    return this.repo.getClassificationById(id, ministryId);
  }

  async createClassification(
    ministryId: string,
    data: { name: string; description?: string }
  ): Promise<ClassificationRecord> {
    return this.repo.createClassification(ministryId, data);
  }

  async updateClassification(
    id: string,
    ministryId: string,
    data: { name?: string; description?: string | null }
  ): Promise<ClassificationRecord> {
    return this.repo.updateClassification(id, ministryId, data);
  }

  async deleteClassification(id: string, ministryId: string): Promise<void> {
    return this.repo.deleteClassification(id, ministryId);
  }
}
