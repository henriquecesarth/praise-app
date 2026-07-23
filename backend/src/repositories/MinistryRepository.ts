import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import crypto from 'crypto';

export interface MinistryRecord {
  id: string;
  name: string;
  slug?: string;
  owner_user_id: string;
  subscription_status: string;
  subscription_expires_at?: string;
  created_at: string;
  updated_at: string;
  role?: 'admin' | 'member';
}

export interface MinistryMemberRecord {
  id: string;
  ministry_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface MinistryInviteRecord {
  id: string;
  ministry_id: string;
  code: string;
  created_by: string;
  max_uses: number | null;
  uses_count: number;
  expires_at?: string;
  created_at: string;
}

export class MinistryRepository {
  private readonly ministriesCol = db.collection('ministries');
  private readonly membersCol = db.collection('ministry_members');
  private readonly invitesCol = db.collection('ministry_invites');

  async getUserMinistries(userId: string): Promise<MinistryRecord[]> {
    // 1. Buscar pertencimentos na coleção ministry_members
    const memberSnap = await this.membersCol.where('user_id', '==', userId).get();
    const memberRows = memberSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as MinistryMemberRecord));

    // 2. Buscar ministérios onde o usuário é proprietário
    const ownerSnap = await this.ministriesCol.where('owner_user_id', '==', userId).get();
    const ownerMinistries = ownerSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as MinistryRecord));

    const ministryMap = new Map<string, MinistryRecord>();

    ownerMinistries.forEach((m) => {
      ministryMap.set(m.id, { ...m, role: 'admin' });
    });

    // 3. Carregar os ministérios dos quais o usuário é membro
    for (const member of memberRows) {
      if (!ministryMap.has(member.ministry_id)) {
        const doc = await this.ministriesCol.doc(member.ministry_id).get();
        if (doc.exists) {
          const mData = { id: doc.id, ...doc.data() } as MinistryRecord;
          ministryMap.set(doc.id, {
            ...mData,
            role: member.role || 'member',
          });
        }
      }
    }

    return Array.from(ministryMap.values());
  }

  async getMinistryById(ministryId: string, userId: string): Promise<MinistryRecord> {
    const doc = await this.ministriesCol.doc(ministryId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Ministério não encontrado.');
    }

    const mData = { id: doc.id, ...doc.data() } as MinistryRecord;
    const isOwner = mData.owner_user_id === userId;

    if (isOwner) {
      return { ...mData, role: 'admin' };
    }

    const memberSnap = await this.membersCol
      .where('ministry_id', '==', ministryId)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    const role = !memberSnap.empty ? (memberSnap.docs[0].data().role as 'admin' | 'member') : 'member';

    return { ...mData, role };
  }

  async createMinistry(userId: string, name: string, slugInput?: string): Promise<MinistryRecord> {
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ministerio';
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const slug = slugInput || `${baseSlug}-${randomSuffix}`;
    const now = new Date().toISOString();

    const ref = this.ministriesCol.doc();
    const data: MinistryRecord = {
      id: ref.id,
      name,
      slug,
      owner_user_id: userId,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
      role: 'admin',
    };

    await ref.set(data);

    // Adicionar proprietário como admin na coleção ministry_members
    const memberRef = this.membersCol.doc();
    await memberRef.set({
      id: memberRef.id,
      ministry_id: ref.id,
      user_id: userId,
      role: 'admin',
      joined_at: now,
    });

    // Criar funções e classificações padrão automaticamente para o novo ministério
    try {
      const { RoleRepository } = await import('./RoleRepository');
      const roleRepo = new RoleRepository();
      await roleRepo.seedDefaultRoles(ref.id);
    } catch (err) {
      console.error('Erro ao semear funções padrão para o novo ministério:', err);
    }

    try {
      const { ClassificationRepository } = await import('./ClassificationRepository');
      const classificationRepo = new ClassificationRepository();
      await classificationRepo.seedDefaultClassifications(ref.id);
    } catch (err) {
      console.error('Erro ao semear classificações padrão para o novo ministério:', err);
    }

    return data;
  }

  async createInviteCode(ministryId: string, userId: string, expiresInDays = 7, maxUses?: number): Promise<MinistryInviteRecord> {
    const rawCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const code = `PR-${rawCode}`;
    const now = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const inviteRef = this.invitesCol.doc();
    const inviteData: MinistryInviteRecord = {
      id: inviteRef.id,
      ministry_id: ministryId,
      code,
      created_by: userId,
      max_uses: maxUses || null,
      uses_count: 0,
      expires_at: expiresAt.toISOString(),
      created_at: now.toISOString(),
    };

    await inviteRef.set(inviteData);
    return inviteData;
  }

  async joinMinistryByCode(userId: string, code: string): Promise<{ message: string; ministry: MinistryRecord; role: string }> {
    const cleanCode = code.trim().toUpperCase();
    const inviteSnap = await this.invitesCol.where('code', '==', cleanCode).limit(1).get();

    if (inviteSnap.empty) {
      throw new AppError(404, 'Código de convite inválido ou não encontrado.');
    }

    const inviteDoc = inviteSnap.docs[0];
    const invite = inviteDoc.data() as MinistryInviteRecord;

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new AppError(400, 'Este código de convite já expirou.');
    }

    if (invite.max_uses !== null && invite.uses_count >= invite.max_uses) {
      throw new AppError(400, 'Este código de convite atingiu o limite máximo de usos.');
    }

    const doc = await this.ministriesCol.doc(invite.ministry_id).get();
    if (!doc.exists) {
      throw new AppError(404, 'Ministério associado a este convite não foi encontrado.');
    }

    // Verificar pertencimento prévio
    const existingSnap = await this.membersCol
      .where('ministry_id', '==', invite.ministry_id)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    if (existingSnap.empty) {
      const memberRef = this.membersCol.doc();
      await memberRef.set({
        id: memberRef.id,
        ministry_id: invite.ministry_id,
        user_id: userId,
        role: 'member',
        joined_at: new Date().toISOString(),
      });
    }

    // Incrementar contagem de uso
    await inviteDoc.ref.update({
      uses_count: (invite.uses_count || 0) + 1,
    });

    const ministry = { id: doc.id, ...doc.data() } as MinistryRecord;

    return {
      message: 'Você ingressou no ministério com sucesso!',
      ministry: { ...ministry, role: 'member' },
      role: 'member',
    };
  }

  async getMinistryMembers(ministryId: string): Promise<any[]> {
    const snap = await this.membersCol.where('ministry_id', '==', ministryId).get();
    const members = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
    const usersCol = db.collection('users');

    const enrichedMembers = await Promise.all(
      members.map(async (member) => {
        let name = member.name || 'Integrante';
        let email = member.email || '';
        let birthDate = member.birth_date || null;

        if (member.user_id && !member.is_manual) {
          const userDoc = await usersCol.doc(member.user_id).get();
          if (userDoc.exists) {
            const uData = userDoc.data();
            name = uData?.name || uData?.displayName || name;
            email = uData?.email || email;
            birthDate = uData?.birth_date || birthDate;
          }
        }

        return {
          ...member,
          name,
          email,
          birth_date: birthDate,
        };
      })
    );

    return enrichedMembers;
  }

  async updateMinistry(ministryId: string, userId: string, data: { name?: string }): Promise<MinistryRecord> {
    const doc = await this.ministriesCol.doc(ministryId).get();
    if (!doc.exists) throw new AppError(404, 'Ministério não encontrado.');

    const mData = doc.data() as MinistryRecord;
    if (mData.owner_user_id !== userId) {
      const memberSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('user_id', '==', userId)
        .where('role', '==', 'admin')
        .limit(1)
        .get();
      if (memberSnap.empty) throw new AppError(403, 'Apenas administradores podem atualizar o ministério.');
    }

    const now = new Date().toISOString();
    const updates: any = { updated_at: now };
    if (data.name) updates.name = data.name;

    await this.ministriesCol.doc(ministryId).update(updates);
    const updated = await this.ministriesCol.doc(ministryId).get();
    return { id: updated.id, ...updated.data() } as MinistryRecord;
  }

  async removeMember(ministryId: string, memberUserId: string, requestingUserId: string): Promise<void> {
    const doc = await this.ministriesCol.doc(ministryId).get();
    if (!doc.exists) throw new AppError(404, 'Ministério não encontrado.');

    const mData = doc.data() as MinistryRecord;
    if (mData.owner_user_id === memberUserId) {
      throw new AppError(400, 'O proprietário do ministério não pode ser removido.');
    }

    // Try doc directly first
    const directDoc = await this.membersCol.doc(memberUserId).get();
    if (directDoc.exists && directDoc.data()?.ministry_id === ministryId) {
      await directDoc.ref.delete();
      return;
    }

    // Query by user_id
    const memberSnap = await this.membersCol
      .where('ministry_id', '==', ministryId)
      .where('user_id', '==', memberUserId)
      .limit(1)
      .get();

    if (!memberSnap.empty) {
      await memberSnap.docs[0].ref.delete();
    }
  }

  async updateMemberRole(ministryId: string, memberUserId: string, role: 'admin' | 'member'): Promise<any> {
    // Try doc directly first
    const directDoc = await this.membersCol.doc(memberUserId).get();
    if (directDoc.exists && directDoc.data()?.ministry_id === ministryId) {
      await directDoc.ref.update({ role });
      return { id: directDoc.id, ...directDoc.data(), role };
    }

    // Query by user_id
    const memberSnap = await this.membersCol
      .where('ministry_id', '==', ministryId)
      .where('user_id', '==', memberUserId)
      .limit(1)
      .get();

    if (memberSnap.empty) throw new AppError(404, 'Membro não encontrado.');

    await memberSnap.docs[0].ref.update({ role });
    return { id: memberSnap.docs[0].id, ...memberSnap.docs[0].data(), role };
  }

  async deleteMinistry(ministryId: string, userId: string): Promise<void> {
    const doc = await this.ministriesCol.doc(ministryId).get();
    if (!doc.exists) throw new AppError(404, 'Ministério não encontrado.');

    const mData = doc.data() as MinistryRecord;
    if (mData.owner_user_id !== userId) {
      throw new AppError(403, 'Apenas o proprietário pode excluir o ministério.');
    }

    // Remove all members
    const membersSnap = await this.membersCol.where('ministry_id', '==', ministryId).get();
    const memberDeletes = membersSnap.docs.map((d) => d.ref.delete());
    await Promise.all(memberDeletes);

    // Remove all invites
    const invitesSnap = await this.invitesCol.where('ministry_id', '==', ministryId).get();
    const inviteDeletes = invitesSnap.docs.map((d) => d.ref.delete());
    await Promise.all(inviteDeletes);

    await this.ministriesCol.doc(ministryId).delete();
  }

  async addMemberManually(
    ministryId: string,
    memberData: { name: string; email: string; role?: 'admin' | 'member'; birthDate?: string }
  ): Promise<any> {
    const now = new Date().toISOString();
    const memberRef = this.membersCol.doc();
    const record: any = {
      id: memberRef.id,
      ministry_id: ministryId,
      user_id: memberRef.id, // synthetic user_id for manual members
      name: memberData.name,
      email: memberData.email,
      role: memberData.role || 'member',
      is_manual: true,
      birth_date: memberData.birthDate || null,
      joined_at: now,
    };
    await memberRef.set(record);
    return record;
  }

  async leaveMinistry(ministryId: string, userId: string): Promise<void> {
    const doc = await this.ministriesCol.doc(ministryId).get();
    if (!doc.exists) throw new AppError(404, 'Ministério não encontrado.');

    const mData = doc.data() as MinistryRecord;
    if (mData.owner_user_id === userId) {
      throw new AppError(400, 'O proprietário não pode sair do próprio ministério. Use "Excluir Ministério" para removê-lo.');
    }

    const memberSnap = await this.membersCol
      .where('ministry_id', '==', ministryId)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    if (!memberSnap.empty) {
      await memberSnap.docs[0].ref.delete();
    }
  }
}
