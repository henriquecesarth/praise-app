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
  organization_id?: string | null;
}

export interface MinistryMemberRecord {
  id: string;
  ministry_id: string;
  user_id: string;
  role: 'admin' | 'member';
  joined_at: string;
  status?: 'active' | 'removed';
  removed_at?: string | null;
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
  private readonly usersCol = db.collection('users');
  private readonly rolesCol = db.collection('ministry_roles');

  async getUserMinistries(userId: string): Promise<MinistryRecord[]> {
    // 1. Buscar pertencimentos ativos na coleção ministry_members
    const memberSnap = await this.membersCol.where('user_id', '==', userId).get();
    const memberRows = memberSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as MinistryMemberRecord))
      .filter((m) => m.status !== 'removed');

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

    const activeMemberDoc = memberSnap?.docs?.find((d: any) => d.data()?.status !== 'removed');

    if (!activeMemberDoc) {
      throw new AppError(403, 'Acesso negado. Você não é integrante deste ministério.', {
        code: 'MINISTRY_ACCESS_DENIED',
        ministryId,
      });
    }

    const role = (activeMemberDoc.data().role as 'admin' | 'member') || 'member';

    return { ...mData, role };
  }

  async findById(ministryId: string): Promise<MinistryRecord | null> {
    const doc = await this.ministriesCol.doc(ministryId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as MinistryRecord;
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
      // 1. Verificar pertencimento prévio para idempotência ou reativação (R4-8, R4-10)
      const existingMembers = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('user_id', '==', userId)
        .limit(1)
        .get();

      const docs = existingMembers?.docs || [];
      const activeMember = docs.find((d: any) => d.data()?.status !== 'removed');
      if (activeMember) {
        return;
      }

      const removedMember = docs.find((d: any) => d.data()?.status === 'removed');

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
      if (!plan) {
        throw new AppError(500, 'A assinatura do ministério possui um plano inválido.', {
          code: 'PLAN_DEFINITION_NOT_FOUND',
        });
      }
      const effectiveQuota = getEffectiveMemberQuota(plan, subData?.member_addon_blocks || 0);

      let currentMembersCount = 0;
      let currentSongsCount = 0;

      if (usageDoc.exists) {
        const uData = usageDoc.data() as any;
        currentMembersCount = uData?.members_count || 0;
        currentSongsCount = uData?.songs_count || 0;
      } else {
        const snap = await this.membersCol.where('ministry_id', '==', ministryId).get();
        currentMembersCount = snap.docs.filter((d) => d.data()?.status !== 'removed').length;
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

      // Criar ou reativar membership (R4-10)
      const memberRef = removedMember ? removedMember.ref : this.membersCol.doc();
      const existingData = removedMember ? removedMember.data() : null;
      transaction.set(memberRef, {
        id: memberRef.id,
        ministry_id: ministryId,
        user_id: userId,
        role: 'member',
        name: existingData?.name || null,
        email: existingData?.email || null,
        phone: existingData?.phone || null,
        birth_date: existingData?.birth_date || null,
        is_manual: false,
        role_ids: existingData?.role_ids || [],
        joined_at: now,
        status: 'active',
        removed_at: null,
        created_at: existingData?.created_at || now,
        updated_at: now,
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

  private async validateRoleIds(
    ministryId: string,
    roleIds?: string[],
    transaction?: FirebaseFirestore.Transaction
  ): Promise<string[]> {
    if (!roleIds || !Array.isArray(roleIds) || roleIds.length === 0) {
      return [];
    }
    const unique = Array.from(
      new Set(roleIds.map((r) => (typeof r === 'string' ? r.trim() : '')).filter(Boolean))
    );
    if (unique.length === 0) {
      return [];
    }

    if (transaction) {
      for (const id of unique) {
        const roleDoc = await transaction.get(this.rolesCol.doc(id));
        if (!roleDoc.exists || roleDoc.data()?.ministry_id !== ministryId) {
          throw new AppError(400, 'Função musical inválida ou não pertencente a este ministério.');
        }
      }
    } else {
      const rolesSnap = await this.rolesCol.where('ministry_id', '==', ministryId).get();
      const validIds = new Set(rolesSnap.docs.map((d) => d.id));
      for (const id of unique) {
        if (!validIds.has(id)) {
          throw new AppError(400, 'Função musical inválida ou não pertencente a este ministério.');
        }
      }
    }
    return unique;
  }

  async getMinistryMembers(ministryId: string, requestingUserId?: string): Promise<any[]> {
    const snap = await this.membersCol.where('ministry_id', '==', ministryId).get();
    // Excluir membros soft-removed
    const activeDocs = snap.docs.filter((doc) => doc.data()?.status !== 'removed');
    const members = activeDocs.map((doc) => ({ id: doc.id, ...doc.data() } as any));

    // Determinar permissões do visualizador
    let isRequesterAdmin = false;
    if (requestingUserId) {
      const requesterMember = members.find(
        (m: any) => m.user_id && m.user_id === requestingUserId && m.status !== 'removed'
      );
      if (requesterMember?.role === 'admin') {
        isRequesterAdmin = true;
      } else {
        const ministryDoc = await this.ministriesCol.doc(ministryId).get();
        isRequesterAdmin = ministryDoc.exists && ministryDoc.data()?.owner_user_id === requestingUserId;
      }
    }

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

    const shapedMembers = members.map((member: any) => {
      let name = member.name || 'Integrante';
      let email = member.email || null;
      let birthDate = member.birth_date || null;

      if (member.user_id && userMap.has(member.user_id)) {
        const uData = userMap.get(member.user_id);
        name = uData?.name || uData?.displayName || name;
        email = uData?.email || email;
        birthDate = uData?.birth_date || birthDate;
      }

      // Self view determinado ESTRITAMENTE pela vinculação canônica user_id (sem fallback doc.id)
      const isSelf = Boolean(
        requestingUserId &&
        member.user_id &&
        member.user_id === requestingUserId
      );

      // 1. Visão de Administrador (Allowlist DTO)
      if (isRequesterAdmin) {
        return {
          id: member.id,
          name,
          email,
          phone: member.phone || null,
          birth_date: birthDate,
          role: member.role || 'member',
          role_ids: member.role_ids || [],
          is_manual: Boolean(member.is_manual),
          joined_at: member.joined_at || member.created_at || null,
          user_id: member.user_id || null,
        };
      }

      // 2. Visão Própria (Self DTO)
      if (isSelf) {
        return {
          id: member.id,
          name,
          email,
          phone: member.phone || null,
          birth_date: birthDate,
          role: member.role || 'member',
          role_ids: member.role_ids || [],
          joined_at: member.joined_at || member.created_at || null,
        };
      }

      // 3. Visão Pública de Pares (Peer View DTO estrito - sem contatos, user_id, datas privadas ou metadados)
      return {
        id: member.id,
        name,
        role: member.role || 'member',
        role_ids: member.role_ids || [],
      };
    });

    return shapedMembers;
  }

  async getMinistryMemberById(
    ministryId: string,
    memberId: string,
    requestingUserId?: string
  ): Promise<any> {
    let memberDoc: any = null;
    let memberData: any = null;

    // 1. Tentar por ID de documento direto
    const directDoc = await this.membersCol.doc(memberId).get();
    if (directDoc.exists && directDoc.data()?.ministry_id === ministryId) {
      memberDoc = directDoc;
      memberData = directDoc.data();
    } else {
      // 2. Tentar por user_id
      const memberSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('user_id', '==', memberId)
        .limit(1)
        .get();

      if (!memberSnap.empty) {
        const d = memberSnap.docs[0];
        if (d.data()?.status !== 'removed') {
          memberDoc = d;
          memberData = d.data();
        }
      }
    }

    if (!memberDoc || !memberData || memberData.ministry_id !== ministryId || memberData.status === 'removed') {
      throw new AppError(404, 'Membro não encontrado.');
    }

    // Determinar se o requisitante é admin ou owner
    let isRequesterAdmin = false;
    if (requestingUserId) {
      const requesterSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('user_id', '==', requestingUserId)
        .limit(1)
        .get();

      const rData = !requesterSnap.empty ? requesterSnap.docs[0].data() : null;
      if (rData?.status !== 'removed' && rData?.role === 'admin') {
        isRequesterAdmin = true;
      } else {
        const ministryDoc = await this.ministriesCol.doc(ministryId).get();
        isRequesterAdmin = ministryDoc.exists && ministryDoc.data()?.owner_user_id === requestingUserId;
      }
    }

    // Self view determinado ESTRITAMENTE pela vinculação canônica user_id (sem fallback doc.id)
    const isSelf = Boolean(
      requestingUserId &&
      memberData.user_id &&
      memberData.user_id === requestingUserId
    );

    let name = memberData.name || 'Integrante';
    let email = memberData.email || null;
    let birthDate = memberData.birth_date || null;

    if (memberData.user_id && !memberData.is_manual) {
      const uDoc = await this.usersCol.doc(memberData.user_id).get();
      if (uDoc.exists) {
        const uData = uDoc.data();
        name = uData?.name || uData?.displayName || name;
        email = uData?.email || email;
        birthDate = uData?.birth_date || birthDate;
      }
    }

    // 1. Visão de Administrador (Allowlist DTO)
    if (isRequesterAdmin) {
      return {
        id: memberDoc.id,
        name,
        email,
        phone: memberData.phone || null,
        birth_date: birthDate,
        role: memberData.role || 'member',
        role_ids: memberData.role_ids || [],
        is_manual: Boolean(memberData.is_manual),
        joined_at: memberData.joined_at || memberData.created_at || null,
        user_id: memberData.user_id || null,
      };
    }

    // 2. Visão Própria (Self DTO)
    if (isSelf) {
      return {
        id: memberDoc.id,
        name,
        email,
        phone: memberData.phone || null,
        birth_date: birthDate,
        role: memberData.role || 'member',
        role_ids: memberData.role_ids || [],
        joined_at: memberData.joined_at || memberData.created_at || null,
      };
    }

    // 3. Visão Pública de Pares (Peer View DTO estrito)
    return {
      id: memberDoc.id,
      name,
      role: memberData.role || 'member',
      role_ids: memberData.role_ids || [],
    };
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

    // Verificar membro alvo
    let targetMemberData: any = null;
    if (typeof this.membersCol.doc === 'function' && typeof memberUserId === 'string' && memberUserId.trim().length > 0) {
      const dDoc = await this.membersCol.doc(memberUserId).get().catch(() => null);
      if (dDoc?.exists && dDoc.data()?.ministry_id === ministryId) {
        targetMemberData = dDoc.data();
      }
    }

    if (!targetMemberData) {
      const memberSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('user_id', '==', memberUserId)
        .limit(1)
        .get();

      if (!memberSnap.empty) {
        targetMemberData = memberSnap.docs[0].data();
      }
    }

    if (!targetMemberData || targetMemberData.status === 'removed') {
      throw new AppError(404, 'Membro não encontrado neste ministério.');
    }

    if (mData.owner_user_id === memberUserId || targetMemberData.user_id === mData.owner_user_id) {
      throw new AppError(400, 'O proprietário do ministério não pode ser removido.');
    }

    const isMemberAdmin = targetMemberData.role === 'admin';
    if (isMemberAdmin) {
      if (mData.owner_user_id !== requestingUserId && targetMemberData.user_id !== requestingUserId) {
        throw new AppError(403, 'Apenas o proprietário pode remover outro administrador do ministério.');
      }

      const adminSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('role', '==', 'admin')
        .get();
      const activeAdmins = adminSnap.docs.filter((d: any) => d.data()?.status !== 'removed');
      if (activeAdmins.length <= 1) {
        throw new AppError(400, 'Não é possível remover o único administrador do ministério. Promova outro integrante antes.');
      }
    }

    const { SubscriptionRepository } = await import('./SubscriptionRepository');
    const subRepo = new SubscriptionRepository();
    await subRepo.removeMemberTransactional({
      ministryId,
      memberUserIdOrDocId: memberUserId,
      requestingUserId,
    });
  }

  async updateMemberRole(
    ministryId: string,
    memberUserId: string,
    role: 'admin' | 'member',
    requestingUserId?: string
  ): Promise<any> {
    return this.updateMemberDetails(ministryId, memberUserId, { role }, requestingUserId);
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
    },
    requestingUserId?: string
  ): Promise<any> {
    let memberRef: any = null;
    let memberData: any = null;

    // Try doc directly first
    if (typeof this.membersCol.doc === 'function' && typeof memberUserId === 'string' && memberUserId.trim().length > 0) {
      const directDoc = await this.membersCol.doc(memberUserId).get().catch(() => null);
      if (directDoc?.exists && directDoc.data()?.ministry_id === ministryId) {
        memberRef = directDoc.ref;
        memberData = directDoc.data();
      }
    }

    if (!memberRef) {
      // Query by user_id
      const memberSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('user_id', '==', memberUserId)
        .limit(1)
        .get();

      if (!memberSnap.empty) {
        const d = memberSnap.docs[0];
        if (d.data()?.status !== 'removed') {
          memberRef = d.ref;
          memberData = d.data();
        }
      }
    }

    if (!memberRef || !memberData || memberData.status === 'removed') {
      throw new AppError(404, 'Membro não encontrado.');
    }

    const ministryDoc = await this.ministriesCol.doc(ministryId).get();
    if (!ministryDoc.exists) throw new AppError(404, 'Ministério não encontrado.');
    const mData = ministryDoc.data() as MinistryRecord;
    const isOwner = requestingUserId ? mData.owner_user_id === requestingUserId : false;

    // Proteção contra escalonamento de privilégios (R2-4)
    if (data.role !== undefined) {
      if ((data.role as any) === 'owner') {
        throw new AppError(403, 'Não é permitido atribuir a função de proprietário.');
      }

      // Proteger função do proprietário do ministério
      if (memberData.user_id === mData.owner_user_id && data.role !== 'admin') {
        throw new AppError(400, 'Não é possível alterar a função de administrador do proprietário do ministério.');
      }

      // Promover a admin requer ser owner
      if (data.role === 'admin' && memberData.role !== 'admin' && !isOwner) {
        throw new AppError(403, 'Apenas o proprietário do ministério pode promover integrantes a administrador.');
      }

      // Rebaixar admin requer ser owner
      if (data.role === 'member' && memberData.role === 'admin') {
        if (!isOwner) {
          throw new AppError(403, 'Apenas o proprietário do ministério pode rebaixar administradores.');
        }

        const adminSnap = await this.membersCol
          .where('ministry_id', '==', ministryId)
          .where('role', '==', 'admin')
          .get();
        const activeAdmins = adminSnap.docs.filter((d: any) => d.data()?.status !== 'removed');
        if (activeAdmins.length <= 1) {
          throw new AppError(400, 'Não é possível rebaixar o único administrador do ministério.');
        }
      }
    }

    // Validação canônica de roleIds (R2-3 / R4-13)
    let validatedRoleIds: string[] | undefined;
    if (data.roleIds !== undefined) {
      validatedRoleIds = await this.validateRoleIds(ministryId, data.roleIds);
    }

    const updates: any = { updated_at: new Date().toISOString() };
    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.email !== undefined) updates.email = data.email.trim();
    if (data.birthDate !== undefined) updates.birth_date = data.birthDate;
    if (data.role !== undefined) updates.role = data.role;
    if (validatedRoleIds !== undefined) updates.role_ids = validatedRoleIds;

    await memberRef.update(updates);

    // Se o membro é uma conta manual local (is_manual), sincronizar metadados locais
    const userId = memberData.user_id;
    if (userId && !memberData.is_manual) {
      try {
        const usersCol = db.collection('users');
        const userUpdates: any = {};
        if (data.name) userUpdates.name = data.name.trim();
        if (data.birthDate !== undefined) userUpdates.birth_date = data.birthDate;

        if (Object.keys(userUpdates).length > 0) {
          await usersCol.doc(userId).set(userUpdates, { merge: true });
        }
      } catch (err) {
        console.warn('Nota: Erro ao sincronizar dados de usuário no Firestore:', err);
      }
    }

    const merged = { ...memberData, ...updates };
    return {
      id: memberRef.id,
      name: merged.name || null,
      email: merged.email || null,
      phone: merged.phone || null,
      birth_date: merged.birth_date || null,
      role: merged.role || 'member',
      role_ids: merged.role_ids || [],
      is_manual: Boolean(merged.is_manual),
      joined_at: merged.joined_at || merged.created_at || null,
      user_id: merged.user_id || null,
    };
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
    memberData: { name: string; email: string; role?: 'admin' | 'member'; birthDate?: string; roleIds?: string[] },
    requestingUserId?: string
  ): Promise<any> {
    const ministryDoc = await this.ministriesCol.doc(ministryId).get();
    if (!ministryDoc.exists) throw new AppError(404, 'Ministério não encontrado.');
    const mData = ministryDoc.data() as MinistryRecord;
    const isOwner = requestingUserId ? mData.owner_user_id === requestingUserId : false;

    // Proteção contra escalonamento de privilégios (R2-4)
    if (memberData.role === 'admin' && !isOwner) {
      throw new AppError(403, 'Apenas o proprietário do ministério pode adicionar novos administradores.');
    }
    if ((memberData as any).role === 'owner') {
      throw new AppError(403, 'Não é permitido atribuir a função de proprietário.');
    }

    // Validação canônica de roleIds (R2-3)
    const validatedRoleIds = await this.validateRoleIds(ministryId, memberData.roleIds);

    const { SubscriptionRepository } = await import('./SubscriptionRepository');
    const subRepo = new SubscriptionRepository();
    const { member } = await subRepo.addMemberTransactional({
      ministryId,
      name: memberData.name.trim(),
      email: memberData.email.trim(),
      role: memberData.role || 'member',
      birthDate: memberData.birthDate || null,
      isManual: true,
      roleIds: validatedRoleIds,
    });

    return {
      id: member.id,
      name: member.name || null,
      email: member.email || null,
      phone: member.phone || null,
      birth_date: member.birth_date || null,
      role: member.role || 'member',
      role_ids: member.role_ids || [],
      is_manual: Boolean(member.is_manual),
      joined_at: member.joined_at || member.created_at || null,
      user_id: member.user_id || null,
    };
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
      requestingUserId: userId,
    });
  }
}

