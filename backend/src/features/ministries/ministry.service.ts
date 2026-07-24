import { MinistryRepository, MinistryRecord, MinistryInviteRecord } from '../../repositories/MinistryRepository';

export class MinistryService {
  constructor(private readonly repo: MinistryRepository = new MinistryRepository()) {}

  async getUserMinistries(userId: string): Promise<MinistryRecord[]> {
    return this.repo.getUserMinistries(userId);
  }

  async getMinistryById(ministryId: string, userId: string): Promise<MinistryRecord> {
    return this.repo.getMinistryById(ministryId, userId);
  }

  async createMinistry(userId: string, data: { name: string; slug?: string }): Promise<MinistryRecord> {
    return this.repo.createMinistry(userId, data.name, data.slug);
  }

  async updateMinistry(ministryId: string, userId: string, data: { name?: string }): Promise<MinistryRecord> {
    return this.repo.updateMinistry(ministryId, userId, data);
  }

  async deleteMinistry(ministryId: string, userId: string): Promise<void> {
    return this.repo.deleteMinistry(ministryId, userId);
  }

  async createInviteCode(
    ministryId: string,
    userId: string,
    data: { expiresInDays?: number; maxUses?: number }
  ): Promise<MinistryInviteRecord> {
    return this.repo.createInviteCode(ministryId, userId, data.expiresInDays || 7, data.maxUses);
  }

  async joinMinistryByCode(
    userId: string,
    data: { code: string }
  ): Promise<{ message: string; ministry: MinistryRecord; role: string }> {
    return this.repo.joinMinistryByCode(userId, data.code);
  }

  async getMinistryMembers(ministryId: string): Promise<any[]> {
    return this.repo.getMinistryMembers(ministryId);
  }

  async removeMember(ministryId: string, memberUserId: string, requestingUserId: string): Promise<void> {
    return this.repo.removeMember(ministryId, memberUserId, requestingUserId);
  }

  async updateMemberRole(
    ministryId: string,
    memberUserId: string,
    data: any
  ): Promise<any> {
    if (typeof data === 'string') {
      return this.repo.updateMemberDetails(ministryId, memberUserId, { role: data as any });
    }
    return this.repo.updateMemberDetails(ministryId, memberUserId, data);
  }

  async updateMemberDetails(
    ministryId: string,
    memberUserId: string,
    data: {
      name?: string;
      email?: string;
      birthDate?: string | null;
      role?: 'admin' | 'member';
      roleIds?: string[];
      password?: string;
    }
  ): Promise<any> {
    return this.repo.updateMemberDetails(ministryId, memberUserId, data);
  }

  async addMemberManually(
    ministryId: string,
    memberData: { name: string; email: string; role?: 'admin' | 'member'; birthDate?: string }
  ): Promise<any> {
    return this.repo.addMemberManually(ministryId, memberData);
  }

  async leaveMinistry(ministryId: string, userId: string): Promise<void> {
    return this.repo.leaveMinistry(ministryId, userId);
  }
}
