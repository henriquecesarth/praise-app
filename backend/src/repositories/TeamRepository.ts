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
  private readonly membersCol = db.collection('ministry_members');

  private async validateMemberIds(ministryId: string, memberIds: string[]): Promise<string[]> {
    if (!memberIds || memberIds.length === 0) {
      return [];
    }
    // Deterministic canonical uniqueness preserving appearance order
    const uniqueIds = Array.from(new Set(memberIds));

    // Validate that every submitted member belongs to the target ministry and is active
    let docs: any[] = [];
    if (typeof db.getAll === 'function') {
      try {
        const refs = uniqueIds.map((id) => this.membersCol.doc(id));
        docs = await db.getAll(...refs);
      } catch {
        docs = [];
      }
    }

    if (docs.length === uniqueIds.length) {
      for (const doc of docs) {
        if (!doc.exists) {
          throw new AppError(400, 'Um ou mais integrantes selecionados são inválidos ou não pertencem a este ministério.');
        }
        const data = doc.data();
        if (!data || data.ministry_id !== ministryId || data.status === 'removed') {
          throw new AppError(400, 'Um ou mais integrantes selecionados são inválidos ou não pertencem a este ministério.');
        }
      }
    } else {
      for (const id of uniqueIds) {
        const doc = await this.membersCol.doc(id).get();
        if (!doc.exists) {
          throw new AppError(400, 'Um ou mais integrantes selecionados são inválidos ou não pertencem a este ministério.');
        }
        const data = doc.data();
        if (!data || data.ministry_id !== ministryId || data.status === 'removed') {
          throw new AppError(400, 'Um ou mais integrantes selecionados são inválidos ou não pertencem a este ministério.');
        }
      }
    }

    return uniqueIds;
  }

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
    if (data.ministry_id !== ministryId) throw new AppError(404, 'Equipe não encontrada.');
    return data;
  }

  async createTeam(
    ministryId: string,
    createdBy: string,
    data: { name: string; description?: string | null; memberIds?: string[] }
  ): Promise<TeamRecord> {
    const validatedMemberIds = await this.validateMemberIds(ministryId, data.memberIds || []);
    const now = new Date().toISOString();
    const ref = this.teamsCol.doc();
    const record: TeamRecord = {
      id: ref.id,
      ministry_id: ministryId,
      name: data.name.trim(),
      description: data.description ? data.description.trim() : null,
      member_ids: validatedMemberIds,
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
    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.description !== undefined) {
      updates.description = data.description ? data.description.trim() : null;
    }
    if (data.memberIds !== undefined) {
      updates.member_ids = await this.validateMemberIds(ministryId, data.memberIds);
    }

    await this.teamsCol.doc(teamId).update(updates);
    return { ...existing, ...updates };
  }

  async deleteTeam(teamId: string, ministryId: string): Promise<void> {
    await this.getTeamById(teamId, ministryId); // validates ownership and non-enumerating 404
    await this.teamsCol.doc(teamId).delete();
  }
}
