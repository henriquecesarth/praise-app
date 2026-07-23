import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';

export interface RoleRecord {
  id: string;
  ministry_id: string;
  name: string;
  icon: string; // emoji string
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export const DEFAULT_ROLES: Array<{ name: string; icon: string }> = [
  { name: 'Ministro', icon: '👑' },
  { name: 'Vocalista', icon: '🎤' },
  { name: 'Backing Vocal', icon: '🎙️' },
  { name: 'Violão', icon: '🪕' },
  { name: 'Guitarra', icon: '🎸' },
  { name: 'Baixo', icon: '🎵' },
  { name: 'Teclado', icon: '🎹' },
  { name: 'Piano', icon: '🎹' },
  { name: 'Bateria', icon: '🥁' },
  { name: 'Percussão', icon: '🪘' },
  { name: 'Mesa de Som', icon: '🎚️' },
];

export class RoleRepository {
  private readonly rolesCol = db.collection('ministry_roles');

  async getRoles(ministryId: string): Promise<RoleRecord[]> {
    const snap = await this.rolesCol.where('ministry_id', '==', ministryId).get();
    const roles = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as RoleRecord));
    return roles.sort((a, b) => {
      // Default roles first, then by name
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return a.name.localeCompare(b.name, 'pt-BR');
    });
  }

  async getRoleById(roleId: string, ministryId: string): Promise<RoleRecord> {
    const doc = await this.rolesCol.doc(roleId).get();
    if (!doc.exists) throw new AppError(404, 'Função não encontrada.');
    const data = { id: doc.id, ...doc.data() } as RoleRecord;
    if (data.ministry_id !== ministryId) throw new AppError(403, 'Função não pertence a este ministério.');
    return data;
  }

  async createRole(
    ministryId: string,
    data: { name: string; icon: string; isDefault?: boolean }
  ): Promise<RoleRecord> {
    const now = new Date().toISOString();
    const ref = this.rolesCol.doc();
    const record: RoleRecord = {
      id: ref.id,
      ministry_id: ministryId,
      name: data.name,
      icon: data.icon,
      is_default: data.isDefault || false,
      created_at: now,
      updated_at: now,
    };
    await ref.set(record);
    return record;
  }

  async updateRole(
    roleId: string,
    ministryId: string,
    data: { name?: string; icon?: string }
  ): Promise<RoleRecord> {
    const existing = await this.getRoleById(roleId, ministryId);
    const now = new Date().toISOString();
    const updates: Partial<RoleRecord> & { updated_at: string } = { updated_at: now };
    if (data.name !== undefined) updates.name = data.name;
    if (data.icon !== undefined) updates.icon = data.icon;
    await this.rolesCol.doc(roleId).update(updates);
    return { ...existing, ...updates };
  }

  async deleteRole(roleId: string, ministryId: string): Promise<void> {
    await this.getRoleById(roleId, ministryId);
    await this.rolesCol.doc(roleId).delete();
  }

  async seedDefaultRoles(ministryId: string): Promise<RoleRecord[]> {
    // Check if defaults already exist
    const existing = await this.rolesCol
      .where('ministry_id', '==', ministryId)
      .where('is_default', '==', true)
      .get();
    if (!existing.empty) return []; // already seeded

    const now = new Date().toISOString();
    const batch = db.batch();
    const records: RoleRecord[] = [];

    for (const role of DEFAULT_ROLES) {
      const ref = this.rolesCol.doc();
      const record: RoleRecord = {
        id: ref.id,
        ministry_id: ministryId,
        name: role.name,
        icon: role.icon,
        is_default: true,
        created_at: now,
        updated_at: now,
      };
      batch.set(ref, record);
      records.push(record);
    }

    await batch.commit();
    return records;
  }
}
