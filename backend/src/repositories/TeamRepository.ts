import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export interface TeamRecord {
  id: string;
  ministry_id: string;
  name: string;
  description?: string | null;
  member_ids: string[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export class TeamRepository {
  private readonly teamsCol = db.collection('ministry_teams');

  async getTeams(ministryId: string): Promise<TeamRecord[]> {
    const snap = await this.teamsCol
      .where('ministry_id', '==', ministryId)
      .get();
    const teams = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as TeamRecord));
    // Sort in memory to avoid requiring a composite Firestore index
    return teams.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async getTeamById(teamId: string, ministryId: string): Promise<TeamRecord> {
    const doc = await this.teamsCol.doc(teamId).get();
    if (!doc.exists) throw new AppError(404, 'Equipe não encontrada.');
    const data = { id: doc.id, ...doc.data() } as TeamRecord;
    if (data.ministry_id !== ministryId) throw new AppError(403, 'Equipe não pertence a este ministério.');
    return data;
  }

  async createTeam(
    ministryId: string,
    createdBy: string,
    data: { name: string; description?: string; memberIds?: string[] }
  ): Promise<TeamRecord> {
    const now = new Date().toISOString();
    const ref = this.teamsCol.doc();
    const record: TeamRecord = {
      id: ref.id,
      ministry_id: ministryId,
      name: data.name,
      description: data.description || null,
      member_ids: data.memberIds || [],
      created_by: createdBy,
      created_at: now,
      updated_at: now,
    };
    await ref.set(record);
    return record;
  }

  async updateTeam(
    teamId: string,
    ministryId: string,
    data: { name?: string; description?: string | null; memberIds?: string[] }
  ): Promise<TeamRecord> {
    const existing = await this.getTeamById(teamId, ministryId);
    const now = new Date().toISOString();
    const updates: Partial<TeamRecord> & { updated_at: string } = { updated_at: now };
    if (data.name !== undefined) updates.name = data.name;
    if (data.description !== undefined) updates.description = data.description;
    if (data.memberIds !== undefined) updates.member_ids = data.memberIds;

    await this.teamsCol.doc(teamId).update(updates);
    return { ...existing, ...updates };
  }

  async deleteTeam(teamId: string, ministryId: string): Promise<void> {
    await this.getTeamById(teamId, ministryId); // validates ownership
    await this.teamsCol.doc(teamId).delete();
  }
}
