import { AnnouncementRepository, AnnouncementRecord } from '../../repositories/AnnouncementRepository';

export interface CreateAnnouncementDTO {
  title: string;
  content: string;
  author?: string | null;
  important?: boolean;
}

export interface UpdateAnnouncementDTO {
  title?: string;
  content?: string;
  author?: string | null;
  important?: boolean;
}

export class AnnouncementService {
  constructor(private readonly repo: AnnouncementRepository = new AnnouncementRepository()) {}

  async getAnnouncements(ministryId: string, limitCount = 20): Promise<AnnouncementRecord[]> {
    return this.repo.getAnnouncementsByMinistry(ministryId, limitCount);
  }

  async getAnnouncementById(id: string, ministryId: string): Promise<AnnouncementRecord> {
    return this.repo.getAnnouncementById(id, ministryId);
  }

  async createAnnouncement(
    ministryId: string,
    input: CreateAnnouncementDTO,
    userId: string,
    fallbackAuthorName?: string
  ): Promise<AnnouncementRecord> {
    const author = input.author?.trim() || fallbackAuthorName?.trim() || 'Liderança';

    return this.repo.createAnnouncement({
      ministry_id: ministryId,
      title: input.title,
      content: input.content,
      author,
      important: Boolean(input.important),
      created_by: userId,
    });
  }

  async updateAnnouncement(
    id: string,
    ministryId: string,
    input: UpdateAnnouncementDTO
  ): Promise<AnnouncementRecord> {
    return this.repo.updateAnnouncement(id, ministryId, {
      title: input.title,
      content: input.content,
      author: input.author === null ? undefined : input.author,
      important: input.important,
    });
  }

  async deleteAnnouncement(id: string, ministryId: string): Promise<void> {
    return this.repo.deleteAnnouncement(id, ministryId);
  }
}
