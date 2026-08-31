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

    if (memberSnap.empty) {
      throw new AppError(403, 'Acesso negado. Você não é integrante deste ministério.', {
        code: 'MINISTRY_ACCESS_DENIED',
        ministryId,
      });
    }

    const role = (memberSnap.docs[0].data().role as 'admin' | 'member') || 'member';

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

    const memberRef = this.membersCol.doc();
    const memberData = {
      id: memberRef.id,
      ministry_id: ref.id,
      user_id: userId,
      role: 'admin',
      joined_at: now,
    };

    const subRef = db.collection('ministry_subscriptions').doc(ref.id);
    const subData = {
      id: ref.id,
      ministry_id: ref.id,
      plan_id: 'free',
      member_addon_blocks: 0,
      billing_status: 'active',
      administratively_suspended: false,
      suspended_at: null,
      suspension_reason: null,
      grace_period_expires_at: null,
      current_period_start: now,
      current_period_end: null,
      cancel_at_period_end: false,
      created_at: now,
      updated_at: now,
    };

    const usageRef = db.collection('ministry_usage').doc(ref.id);
    const usageData = {
      id: ref.id,
      ministry_id: ref.id,
      members_count: 1, // Proprietário inicial
      songs_count: 0,
      created_at: now,
      updated_at: now,
    };

    const batch = db.batch();
    batch.set(ref, data);
    batch.set(memberRef, memberData);
    batch.set(subRef, subData);
    batch.set(usageRef, usageData);
    await batch.commit();

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

    const ministryId = invite.ministry_id;
    const doc = await this.ministriesCol.doc(ministryId).get();
    if (!doc.exists) {
      throw new AppError(404, 'Ministério associado a este convite não foi encontrado.');
    }

    const { getPlanDefinition, getEffectiveMemberQuota, DEFAULT_PLAN_ID } = await import('../config/plans.config');
    const subRef = db.collection('ministry_subscriptions').doc(ministryId);
    const usageRef = db.collection('ministry_usage').doc(ministryId);
    const now = new Date().toISOString();

    await db.runTransaction(async (transaction) => {
      // 1. Verificar pertencimento prévio para idempotência
      const existingMembers = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('user_id', '==', userId)
        .limit(1)
        .get();

      if (!existingMembers.empty) {
        return;
      }

      const [subDoc, usageDoc, freshInviteDoc] = await Promise.all([
        transaction.get(subRef),
        transaction.get(usageRef),
        transaction.get(inviteDoc.ref),
      ]);

      if (freshInviteDoc.exists) {
        const freshInvite = freshInviteDoc.data() as MinistryInviteRecord;
        if (freshInvite.max_uses !== null && freshInvite.uses_count >= freshInvite.max_uses) {
          throw new AppError(400, 'Este código de convite atingiu o limite máximo de usos.');
        }
      }

      const subData = subDoc.exists ? (subDoc.data() as any) : null;
      const planId = subData?.plan_id || DEFAULT_PLAN_ID;
      const plan = getPlanDefinition(planId);
      const effectiveQuota = getEffectiveMemberQuota(plan, subData?.member_addon_blocks || 0);

      let currentMembersCount = 0;
      let currentSongsCount = 0;

      if (usageDoc.exists) {
        const uData = usageDoc.data() as any;
        currentMembersCount = uData?.members_count || 0;
        currentSongsCount = uData?.songs_count || 0;
      } else {
        const snap = await this.membersCol.where('ministry_id', '==', ministryId).get();
        currentMembersCount = snap.size;
      }

      if (effectiveQuota !== 'unlimited' && currentMembersCount + 1 > effectiveQuota) {
        throw new AppError(
          403,
          `Limite de membros do plano ${plan.name} atingido (${currentMembersCount}/${effectiveQuota}). O ministério não pode receber novos integrantes no momento.`,
          {
            code: 'PLAN_MEMBER_QUOTA_REACHED',
            resource: 'members',
            limit: effectiveQuota,
            current: currentMembersCount,
            planId: plan.id,
          }
        );
      }

      // Criar membership
      const memberRef = this.membersCol.doc();
      transaction.set(memberRef, {
        id: memberRef.id,
        ministry_id: ministryId,
        user_id: userId,
        role: 'member',
        joined_at: now,
      });

      // Incrementar uso materializado
      transaction.set(
        usageRef,
        {
          id: ministryId,
          ministry_id: ministryId,
          members_count: currentMembersCount + 1,
          songs_count: currentSongsCount,
          created_at: usageDoc.exists ? (usageDoc.data() as any)?.created_at || now : now,
          updated_at: now,
        },
        { merge: true }
      );

      // Atualizar contagem de usos do convite
      transaction.update(inviteDoc.ref, {
        uses_count: (invite.uses_count || 0) + 1,
      });
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

    const userIdsToFetch = Array.from(
      new Set(
        members
          .filter((m: any) => m.user_id && !m.is_manual)
          .map((m: any) => m.user_id as string)
      )
    );

    const userMap = new Map<string, any>();

    if (userIdsToFetch.length > 0) {
      try {
        const userRefs = userIdsToFetch.map((uId) => usersCol.doc(uId));
        const userDocs = await db.getAll(...userRefs);
        userDocs.forEach((uDoc: any) => {
          if (uDoc.exists) {
            userMap.set(uDoc.id, uDoc.data());
          }
        });
      } catch (err) {
        await Promise.all(
          userIdsToFetch.map(async (uId) => {
            const uDoc = await usersCol.doc(uId).get();
            if (uDoc.exists) {
              userMap.set(uId, uDoc.data());
            }
          })
        );
      }
    }

    const enrichedMembers = members.map((member: any) => {
      let name = member.name || 'Integrante';
      let email = member.email || '';
      let birthDate = member.birth_date || null;

      if (member.user_id && userMap.has(member.user_id)) {
        const uData = userMap.get(member.user_id);
        name = uData?.name || uData?.displayName || name;
        email = uData?.email || email;
        birthDate = uData?.birth_date || birthDate;
      }

      return {
        ...member,
        name,
        email,
        birth_date: birthDate,
        role_ids: member.role_ids || [],
      };
    });

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

    // Verificar se o membro é o único administrador restante
    const memberSnap = await this.membersCol
      .where('ministry_id', '==', ministryId)
      .where('user_id', '==', memberUserId)
      .limit(1)
      .get();

    const isMemberAdmin = !memberSnap.empty && memberSnap.docs[0].data()?.role === 'admin';
    if (isMemberAdmin) {
      const adminSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('role', '==', 'admin')
        .get();
      if (adminSnap.size <= 1) {
        throw new AppError(400, 'Não é possível remover o único administrador do ministério. Promova outro integrante antes.');
      }
    }

    const { SubscriptionRepository } = await import('./SubscriptionRepository');
    const subRepo = new SubscriptionRepository();
    await subRepo.removeMemberTransactional({
      ministryId,
      memberUserIdOrDocId: memberUserId,
    });
  }

  async updateMemberRole(ministryId: string, memberUserId: string, role: 'admin' | 'member'): Promise<any> {
    return this.updateMemberDetails(ministryId, memberUserId, { role });
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
    let memberRef: any = null;
    let memberData: any = null;

    // Try doc directly first
    const directDoc = await this.membersCol.doc(memberUserId).get();
    if (directDoc.exists && directDoc.data()?.ministry_id === ministryId) {
      memberRef = directDoc.ref;
      memberData = directDoc.data();
    } else {
      // Query by user_id
      const memberSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('user_id', '==', memberUserId)
        .limit(1)
        .get();

      if (!memberSnap.empty) {
        memberRef = memberSnap.docs[0].ref;
        memberData = memberSnap.docs[0].data();
      }
    }

    if (!memberRef) throw new AppError(404, 'Membro não encontrado.');

    // Proteger contra rebaixamento do último administrador
    if (data.role === 'member' && memberData.role === 'admin') {
      const adminSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('role', '==', 'admin')
        .get();
      if (adminSnap.size <= 1) {
        throw new AppError(400, 'Não é possível rebaixar o único administrador do ministério.');
      }
    }

    const updates: any = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.email !== undefined) updates.email = data.email;
    if (data.birthDate !== undefined) updates.birth_date = data.birthDate;
    if (data.role !== undefined) updates.role = data.role;
    if (data.roleIds !== undefined) updates.role_ids = data.roleIds;

    await memberRef.update(updates);

    // Se o membro é uma conta manual local (is_manual), sincronizar metadados locais
    // NUNCA permitir que admin de ministério altere senha de contas reais de outros usuários no Firebase Auth
    const userId = memberData.user_id;
    if (userId && !memberData.is_manual) {
      try {
        const usersCol = db.collection('users');
        const userUpdates: any = {};
        if (data.name) userUpdates.name = data.name;
        if (data.birthDate !== undefined) userUpdates.birth_date = data.birthDate;

        if (Object.keys(userUpdates).length > 0) {
          await usersCol.doc(userId).set(userUpdates, { merge: true });
        }
      } catch (err) {
        console.warn('Nota: Erro ao sincronizar dados de usuário no Firestore:', err);
      }
    }

    const updatedDoc = await memberRef.get();
    return { id: updatedDoc.id, ...updatedDoc.data() };
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
    const { SubscriptionRepository } = await import('./SubscriptionRepository');
    const subRepo = new SubscriptionRepository();
    const { member } = await subRepo.addMemberTransactional({
      ministryId,
      name: memberData.name,
      email: memberData.email,
      role: memberData.role || 'member',
      birthDate: memberData.birthDate || null,
      isManual: true,
    });
    return member;
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

    if (!memberSnap.empty && memberSnap.docs[0].data()?.role === 'admin') {
      const adminSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('role', '==', 'admin')
        .get();
      if (adminSnap.size <= 1) {
        throw new AppError(400, 'Você é o único administrador do ministério. Promova outro membro antes de sair.');
      }
    }

    const { SubscriptionRepository } = await import('./SubscriptionRepository');
    const subRepo = new SubscriptionRepository();
    await subRepo.removeMemberTransactional({
      ministryId,
      memberUserIdOrDocId: userId,
    });
  }
}

