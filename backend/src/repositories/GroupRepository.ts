import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import crypto from 'crypto';

export interface GroupRecord {
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

export interface GroupMemberRecord {
  id: string;
  group_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface GroupInviteRecord {
  id: string;
  group_id: string;
  code: string;
  created_by: string;
  max_uses: number | null;
  uses_count: number;
  expires_at?: string;
  created_at: string;
}

export class GroupRepository {
  private readonly groupsCol = db.collection('groups');
  private readonly membersCol = db.collection('group_members');
  private readonly invitesCol = db.collection('group_invites');

  async getUserGroups(userId: string): Promise<GroupRecord[]> {
    // 1. Buscar pertencimentos na coleção group_members
    const memberSnap = await this.membersCol.where('user_id', '==', userId).get();
    const memberRows = memberSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as GroupMemberRecord));
    const memberGroupIds = memberRows.map((m) => m.group_id);

    // 2. Buscar grupos onde o usuário é proprietário
    const ownerSnap = await this.groupsCol.where('owner_user_id', '==', userId).get();
    const ownerGroups = ownerSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as GroupRecord));

    const groupMap = new Map<string, GroupRecord>();

    ownerGroups.forEach((g) => {
      groupMap.set(g.id, { ...g, role: 'admin' });
    });

    // 3. Carregar os grupos dos quais o usuário é membro
    for (const member of memberRows) {
      if (!groupMap.has(member.group_id)) {
        const groupDoc = await this.groupsCol.doc(member.group_id).get();
        if (groupDoc.exists) {
          const groupData = { id: groupDoc.id, ...groupDoc.data() } as GroupRecord;
          groupMap.set(groupDoc.id, {
            ...groupData,
            role: member.role || 'member',
          });
        }
      }
    }

    return Array.from(groupMap.values());
  }

  async getGroupById(groupId: string, userId: string): Promise<GroupRecord> {
    const doc = await this.groupsCol.doc(groupId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Grupo de louvor não encontrado.');
    }

    const groupData = { id: doc.id, ...doc.data() } as GroupRecord;
    const isOwner = groupData.owner_user_id === userId;

    if (isOwner) {
      return { ...groupData, role: 'admin' };
    }

    const memberSnap = await this.membersCol
      .where('group_id', '==', groupId)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    const role = !memberSnap.empty ? (memberSnap.docs[0].data().role as 'admin' | 'member') : 'member';

    return { ...groupData, role };
  }

  async createGroup(userId: string, name: string, slugInput?: string): Promise<GroupRecord> {
    const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grupo';
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const slug = slugInput || `${baseSlug}-${randomSuffix}`;
    const now = new Date().toISOString();

    const groupRef = this.groupsCol.doc();
    const groupData: GroupRecord = {
      id: groupRef.id,
      name,
      slug,
      owner_user_id: userId,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
      role: 'admin',
    };

    await groupRef.set(groupData);

    // Adicionar integrante como admin em group_members
    const memberRef = this.membersCol.doc();
    await memberRef.set({
      id: memberRef.id,
      group_id: groupRef.id,
      user_id: userId,
      role: 'admin',
      joined_at: now,
    });

    return groupData;
  }

  async createInviteCode(groupId: string, userId: string, expiresInDays = 7, maxUses?: number): Promise<GroupInviteRecord> {
    const rawCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const code = `PR-${rawCode}`;
    const now = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const inviteRef = this.invitesCol.doc();
    const inviteData: GroupInviteRecord = {
      id: inviteRef.id,
      group_id: groupId,
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

  async joinGroupByCode(userId: string, code: string): Promise<{ message: string; group: GroupRecord; role: string }> {
    const cleanCode = code.trim().toUpperCase();
    const inviteSnap = await this.invitesCol.where('code', '==', cleanCode).limit(1).get();

    if (inviteSnap.empty) {
      throw new AppError(404, 'Código de convite inválido ou não encontrado.');
    }

    const inviteDoc = inviteSnap.docs[0];
    const invite = inviteDoc.data() as GroupInviteRecord;

    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new AppError(400, 'Este código de convite já expirou.');
    }

    if (invite.max_uses !== null && invite.uses_count >= invite.max_uses) {
      throw new AppError(400, 'Este código de convite atingiu o limite máximo de usos.');
    }

    const groupDoc = await this.groupsCol.doc(invite.group_id).get();
    if (!groupDoc.exists) {
      throw new AppError(404, 'Grupo associado a este convite não foi encontrado.');
    }

    // Verificar pertencimento prévio
    const existingSnap = await this.membersCol
      .where('group_id', '==', invite.group_id)
      .where('user_id', '==', userId)
      .limit(1)
      .get();

    if (existingSnap.empty) {
      const memberRef = this.membersCol.doc();
      await memberRef.set({
        id: memberRef.id,
        group_id: invite.group_id,
        user_id: userId,
        role: 'member',
        joined_at: new Date().toISOString(),
      });
    }

    // Incrementar contagem de uso do convite
    await inviteDoc.ref.update({
      uses_count: (invite.uses_count || 0) + 1,
    });

    const group = { id: groupDoc.id, ...groupDoc.data() } as GroupRecord;

    return {
      message: 'Você ingressou no grupo de louvor com sucesso!',
      group: { ...group, role: 'member' },
      role: 'member',
    };
  }

  async getGroupMembers(groupId: string): Promise<any[]> {
    const snap = await this.membersCol.where('group_id', '==', groupId).get();
    const members = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as any));
    const usersCol = db.collection('users');

    const enrichedMembers = await Promise.all(
      members.map(async (member) => {
        let name = 'Integrante';
        let email = '';

        if (member.user_id) {
          const userDoc = await usersCol.doc(member.user_id).get();
          if (userDoc.exists) {
            const uData = userDoc.data();
            name = uData?.name || uData?.displayName || name;
            email = uData?.email || email;
          }
        }

        return {
          ...member,
          userId: member.user_id || member.id,
          name,
          email,
        };
      })
    );

    return enrichedMembers;
  }
}
