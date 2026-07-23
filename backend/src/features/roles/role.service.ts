import { RoleRepository, RoleRecord } from '../../repositories/RoleRepository';

export class RoleService {
  constructor(private readonly repo: RoleRepository = new RoleRepository()) {}

  async getRoles(ministryId: string): Promise<RoleRecord[]> {
    // Auto-seed defaults on first access
    await this.repo.seedDefaultRoles(ministryId);
    return this.repo.getRoles(ministryId);
  }

  async getRoleById(roleId: string, ministryId: string): Promise<RoleRecord> {
    return this.repo.getRoleById(roleId, ministryId);
  }

  async createRole(ministryId: string, data: { name: string; icon: string }): Promise<RoleRecord> {
    return this.repo.createRole(ministryId, data);
  }

  async updateRole(roleId: string, ministryId: string, data: { name?: string; icon?: string }): Promise<RoleRecord> {
    return this.repo.updateRole(roleId, ministryId, data);
  }

  async deleteRole(roleId: string, ministryId: string): Promise<void> {
    return this.repo.deleteRole(roleId, ministryId);
  }
}
