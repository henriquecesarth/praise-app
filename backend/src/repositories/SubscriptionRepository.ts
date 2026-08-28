import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  PLANS_CATALOG,
  DEFAULT_PLAN_ID,
  getPlanDefinition,
  getEffectiveMemberQuota,
  getEffectiveSongQuota,
  PlanId,
} from '../config/plans.config';
import {
  MinistrySubscriptionRecord,
  MinistryUsageRecord,
} from '../features/subscriptions/subscription.types';

export class SubscriptionRepository {
  private readonly subscriptionsCol = db.collection('ministry_subscriptions');
  private readonly usageCol = db.collection('ministry_usage');
  private readonly membersCol = db.collection('ministry_members');
  private readonly songsCol = db.collection('songs');
  private readonly ministriesCol = db.collection('ministries');

  async getSubscription(ministryId: string): Promise<MinistrySubscriptionRecord | null> {
    const doc = await this.subscriptionsCol.doc(ministryId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as MinistrySubscriptionRecord;
  }

  async setSubscription(subscription: MinistrySubscriptionRecord): Promise<void> {
    await this.subscriptionsCol.doc(subscription.ministry_id).set(subscription, { merge: true });
  }

  async getUsage(ministryId: string): Promise<MinistryUsageRecord | null> {
    const doc = await this.usageCol.doc(ministryId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as MinistryUsageRecord;
  }

  async setUsage(usage: MinistryUsageRecord): Promise<void> {
    await this.usageCol.doc(usage.ministry_id).set(usage, { merge: true });
  }

  /**
   * Conta os documentos reais existentes em ministry_members e songs
   * sem alterar o banco de dados (leitura pura).
   */
  async countRealData(ministryId: string): Promise<{ realMembersCount: number; realSongsCount: number }> {
    const [membersSnap, songsSnap] = await Promise.all([
      this.membersCol.where('ministry_id', '==', ministryId).get(),
      this.songsCol.where('ministry_id', '==', ministryId).get(),
    ]);
    return {
      realMembersCount: membersSnap.size,
      realSongsCount: songsSnap.size,
    };
  }

  /**
   * Garante a materialização de Subscription e Usage para um ministério legado
   * antes de uma operação de escrita controlada.
   */
  async ensureSubscriptionAndUsage(ministryId: string): Promise<{
    subscription: MinistrySubscriptionRecord;
    usage: MinistryUsageRecord;
  }> {
    const now = new Date().toISOString();

    // 1. Subscription
    let subscription = await this.getSubscription(ministryId);
    if (!subscription) {
      subscription = {
        id: ministryId,
        ministry_id: ministryId,
        plan_id: DEFAULT_PLAN_ID,
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
      await this.setSubscription(subscription);
    }

    // 2. Usage
    let usage = await this.getUsage(ministryId);
    if (!usage) {
      const realCounts = await this.countRealData(ministryId);
      usage = {
        id: ministryId,
        ministry_id: ministryId,
        members_count: realCounts.realMembersCount,
        songs_count: realCounts.realSongsCount,
        created_at: now,
        updated_at: now,
      };
      await this.setUsage(usage);
    }

    return { subscription, usage };
  }

  /**
   * Reconcilia os contadores de usage com os dados reais de ministry_members e songs.
   * Execução puramente síncrona e testável, sem background workers.
   */
  async reconcileMinistryUsage(ministryId: string): Promise<MinistryUsageRecord> {
    const realCounts = await this.countRealData(ministryId);
    const now = new Date().toISOString();

    const usageRecord: MinistryUsageRecord = {
      id: ministryId,
      ministry_id: ministryId,
      members_count: realCounts.realMembersCount,
      songs_count: realCounts.realSongsCount,
      created_at: now,
      updated_at: now,
    };

    await this.setUsage(usageRecord);
    return usageRecord;
  }

  /**
   * Adiciona um membro executando validação atômica de quota contra o usage materializado.
   */
  async addMemberTransactional(params: {
    ministryId: string;
    userId?: string;
    role: 'admin' | 'member';
    name?: string;
    email?: string;
    birthDate?: string | null;
    isManual?: boolean;
    roleIds?: string[];
  }): Promise<{ member: any; usage: MinistryUsageRecord }> {
    const { ministryId, userId, role, name, email, birthDate, isManual, roleIds } = params;

    return await db.runTransaction(async (transaction) => {
      const subRef = this.subscriptionsCol.doc(ministryId);
      const usageRef = this.usageCol.doc(ministryId);

      const [subDoc, usageDoc] = await Promise.all([
        transaction.get(subRef),
        transaction.get(usageRef),
      ]);

      const now = new Date().toISOString();

      let subData: MinistrySubscriptionRecord;
      if (!subDoc.exists) {
        subData = {
          id: ministryId,
          ministry_id: ministryId,
          plan_id: DEFAULT_PLAN_ID,
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
        transaction.set(subRef, subData);
      } else {
        subData = subDoc.data() as MinistrySubscriptionRecord;
      }

      let currentMembersCount = 0;
      let currentSongsCount = 0;

      if (usageDoc.exists) {
        const uData = usageDoc.data() as MinistryUsageRecord;
        currentMembersCount = uData.members_count || 0;
        currentSongsCount = uData.songs_count || 0;
      } else {
        // Se usage ainda não existe, calcula a contagem real
        const membersSnap = await this.membersCol.where('ministry_id', '==', ministryId).get();
        currentMembersCount = membersSnap.size;
      }

      // Idempotency: se for usuário autenticado, verificar se já é membro
      if (userId && !isManual) {
        const existingMemberSnap = await this.membersCol
          .where('ministry_id', '==', ministryId)
          .where('user_id', '==', userId)
          .limit(1)
          .get();

        if (!existingMemberSnap.empty) {
          const existing = existingMemberSnap.docs[0];
          return {
            member: { id: existing.id, ...existing.data() },
            usage: {
              id: ministryId,
              ministry_id: ministryId,
              members_count: currentMembersCount,
              songs_count: currentSongsCount,
              created_at: now,
              updated_at: now,
            },
          };
        }
      }

      // Validação de quota
      const plan = getPlanDefinition(subData.plan_id);
      const effectiveMemberQuota = getEffectiveMemberQuota(plan, subData.member_addon_blocks);

      if (effectiveMemberQuota !== 'unlimited' && currentMembersCount + 1 > effectiveMemberQuota) {
        throw new AppError(
          403,
          `Limite de membros do plano ${plan.name} atingido (${currentMembersCount}/${effectiveMemberQuota}). Faça um upgrade para adicionar mais integrantes.`,
          {
            code: 'PLAN_MEMBER_QUOTA_REACHED',
            resource: 'members',
            limit: effectiveMemberQuota,
            current: currentMembersCount,
            planId: plan.id,
          }
        );
      }

      // Criar documento do membro
      const memberRef = this.membersCol.doc();
      const memberData: any = {
        id: memberRef.id,
        ministry_id: ministryId,
        user_id: userId || null,
        role: role || 'member',
        name: name || null,
        email: email || null,
        birth_date: birthDate || null,
        is_manual: Boolean(isManual),
        role_ids: roleIds || [],
        joined_at: now,
      };

      transaction.set(memberRef, memberData);

      // Incrementar contador de membros atomicamente
      const newMembersCount = currentMembersCount + 1;
      const updatedUsage: MinistryUsageRecord = {
        id: ministryId,
        ministry_id: ministryId,
        members_count: newMembersCount,
        songs_count: currentSongsCount,
        created_at: usageDoc.exists ? (usageDoc.data() as any).created_at || now : now,
        updated_at: now,
      };

      transaction.set(usageRef, updatedUsage);

      return {
        member: memberData,
        usage: updatedUsage,
      };
    });
  }

  /**
   * Remove um membro decrementando atomicamente o usage apenas se o membro realmente existir.
   */
  async removeMemberTransactional(params: {
    ministryId: string;
    memberUserIdOrDocId: string;
  }): Promise<{ removed: boolean; usage: MinistryUsageRecord }> {
    const { ministryId, memberUserIdOrDocId } = params;

    return await db.runTransaction(async (transaction) => {
      // 1. Localizar o documento do membro
      const directRef = this.membersCol.doc(memberUserIdOrDocId);
      const directDoc = await transaction.get(directRef);

      let targetRef: FirebaseFirestore.DocumentReference | null = null;

      if (directDoc.exists && directDoc.data()?.ministry_id === ministryId) {
        targetRef = directRef;
      } else {
        const querySnap = await this.membersCol
          .where('ministry_id', '==', ministryId)
          .where('user_id', '==', memberUserIdOrDocId)
          .limit(1)
          .get();

        if (!querySnap.empty) {
          targetRef = querySnap.docs[0].ref;
        }
      }

      if (!targetRef) {
        throw new AppError(404, 'Membro não encontrado neste ministério.');
      }

      const usageRef = this.usageCol.doc(ministryId);
      const usageDoc = await transaction.get(usageRef);
      const now = new Date().toISOString();

      let currentMembersCount = 1;
      let currentSongsCount = 0;

      if (usageDoc.exists) {
        const uData = usageDoc.data() as MinistryUsageRecord;
        currentMembersCount = uData.members_count || 1;
        currentSongsCount = uData.songs_count || 0;
      } else {
        const membersSnap = await this.membersCol.where('ministry_id', '==', ministryId).get();
        currentMembersCount = membersSnap.size;
      }

      // Deletar membro dentro da transação
      transaction.delete(targetRef);

      const newMembersCount = Math.max(0, currentMembersCount - 1);
      const updatedUsage: MinistryUsageRecord = {
        id: ministryId,
        ministry_id: ministryId,
        members_count: newMembersCount,
        songs_count: currentSongsCount,
        created_at: usageDoc.exists ? (usageDoc.data() as any).created_at || now : now,
        updated_at: now,
      };

      transaction.set(usageRef, updatedUsage);

      return {
        removed: true,
        usage: updatedUsage,
      };
    });
  }

  /**
   * Cria uma música validando a quota de músicas atomicamente.
   */
  async createSongTransactional(params: {
    ministryId: string;
    songData: any;
  }): Promise<{ song: any; usage: MinistryUsageRecord }> {
    const { ministryId, songData } = params;

    return await db.runTransaction(async (transaction) => {
      const subRef = this.subscriptionsCol.doc(ministryId);
      const usageRef = this.usageCol.doc(ministryId);

      const [subDoc, usageDoc] = await Promise.all([
        transaction.get(subRef),
        transaction.get(usageRef),
      ]);

      const now = new Date().toISOString();

      let subData: MinistrySubscriptionRecord;
      if (!subDoc.exists) {
        subData = {
          id: ministryId,
          ministry_id: ministryId,
          plan_id: DEFAULT_PLAN_ID,
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
        transaction.set(subRef, subData);
      } else {
        subData = subDoc.data() as MinistrySubscriptionRecord;
      }

      let currentMembersCount = 0;
      let currentSongsCount = 0;

      if (usageDoc.exists) {
        const uData = usageDoc.data() as MinistryUsageRecord;
        currentMembersCount = uData.members_count || 0;
        currentSongsCount = uData.songs_count || 0;
      } else {
        const songsSnap = await this.songsCol.where('ministry_id', '==', ministryId).get();
        currentSongsCount = songsSnap.size;
      }

      // Validação de quota de músicas
      const plan = getPlanDefinition(subData.plan_id);
      const effectiveSongQuota = getEffectiveSongQuota(plan);

      if (effectiveSongQuota !== 'unlimited' && currentSongsCount + 1 > effectiveSongQuota) {
        throw new AppError(
          403,
          `Limite de músicas do plano ${plan.name} atingido (${currentSongsCount}/${effectiveSongQuota}). Faça um upgrade para cadastrar mais músicas.`,
          {
            code: 'PLAN_SONG_QUOTA_REACHED',
            resource: 'songs',
            limit: effectiveSongQuota,
            current: currentSongsCount,
            planId: plan.id,
          }
        );
      }

      const songRef = this.songsCol.doc();
      const newSong = {
        id: songRef.id,
        ministry_id: ministryId,
        ...songData,
        created_at: now,
        updated_at: now,
      };

      transaction.set(songRef, newSong);

      const newSongsCount = currentSongsCount + 1;
      const updatedUsage: MinistryUsageRecord = {
        id: ministryId,
        ministry_id: ministryId,
        members_count: currentMembersCount,
        songs_count: newSongsCount,
        created_at: usageDoc.exists ? (usageDoc.data() as any).created_at || now : now,
        updated_at: now,
      };

      transaction.set(usageRef, updatedUsage);

      return {
        song: newSong,
        usage: updatedUsage,
      };
    });
  }

  /**
   * Remove uma música decrementando o contador apenas se a música realmente existir.
   */
  async deleteSongTransactional(params: {
    ministryId: string;
    songId: string;
  }): Promise<{ deleted: boolean; usage: MinistryUsageRecord }> {
    const { ministryId, songId } = params;

    return await db.runTransaction(async (transaction) => {
      const songRef = this.songsCol.doc(songId);
      const songDoc = await transaction.get(songRef);

      if (!songDoc.exists || songDoc.data()?.ministry_id !== ministryId) {
        throw new AppError(404, 'Música não encontrada neste ministério.');
      }

      const usageRef = this.usageCol.doc(ministryId);
      const usageDoc = await transaction.get(usageRef);
      const now = new Date().toISOString();

      let currentMembersCount = 0;
      let currentSongsCount = 1;

      if (usageDoc.exists) {
        const uData = usageDoc.data() as MinistryUsageRecord;
        currentMembersCount = uData.members_count || 0;
        currentSongsCount = uData.songs_count || 1;
      } else {
        const songsSnap = await this.songsCol.where('ministry_id', '==', ministryId).get();
        currentSongsCount = songsSnap.size;
      }

      transaction.delete(songRef);

      const newSongsCount = Math.max(0, currentSongsCount - 1);
      const updatedUsage: MinistryUsageRecord = {
        id: ministryId,
        ministry_id: ministryId,
        members_count: currentMembersCount,
        songs_count: newSongsCount,
        created_at: usageDoc.exists ? (usageDoc.data() as any).created_at || now : now,
        updated_at: now,
      };

      transaction.set(usageRef, updatedUsage);

      return {
        deleted: true,
        usage: updatedUsage,
      };
    });
  }
}
