import { TeamRepository, TeamRecord } from '../../repositories/TeamRepository';

export class TeamService {
  constructor(private readonly repo: TeamRepository = new TeamRepository()) {}

  async getTeams(ministryId: string): Promise<TeamRecord[]> {
    return this.repo.getTeams(ministryId);
  }

  async getTeamById(teamId: string, ministryId: string): Promise<TeamRecord> {
    return this.repo.getTeamById(teamId, ministryId);
  }

  async createTeam(
    ministryId: string,
    createdBy: string,
    data: { name: string; description?: string; memberIds?: string[] }
  ): Promise<TeamRecord> {
    return this.repo.createTeam(ministryId, createdBy, data);
  }

  async updateTeam(
    teamId: string,
    ministryId: string,
    data: { name?: string; description?: string | null; memberIds?: string[] }
  ): Promise<TeamRecord> {
    return this.repo.updateTeam(teamId, ministryId, data);
  }

  async deleteTeam(teamId: string, ministryId: string): Promise<void> {
    return this.repo.deleteTeam(teamId, ministryId);
  }
}
