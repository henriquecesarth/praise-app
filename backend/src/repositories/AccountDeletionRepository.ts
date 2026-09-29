import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  AccountDeletionJobRecord,
  AccountDeletionBlocker,
  AccountDeletionCheckpoints,
} from '../features/account_deletion/account-deletion.types';
import { SubscriptionRepository } from './SubscriptionRepository';

export class AccountDeletionRepository {
  private readonly jobsCol = db.collection('account_deletion_jobs');
  private readonly usersCol = db.collection('users');
  private readonly smartChordsCol = db.collection('smart_chords');
  private readonly unavailabilitiesCol = db.collection('member_unavailabilities');
  private readonly commentsCol = db.collection('schedule_comments');
  private readonly invitesCol = db.collection('ministry_invites');
  private readonly groupInvitesCol = db.collection('group_invites');
  private readonly membersCol = db.collection('ministry_members');
  private readonly orgMembersCol = db.collection('organization_members');
  private readonly groupMembersCol = db.collection('group_members');
  private readonly ministriesCol = db.collection('ministries');
  private readonly groupsCol = db.collection('groups');
  private readonly orgsCol = db.collection('organizations');
  private readonly teamsCol = db.collection('ministry_teams');
  private readonly schedulesCol = db.collection('schedules');
  private readonly songsCol = db.collection('songs');
  private readonly liturgiesCol = db.collection('liturgies');
  private readonly announcementsCol = db.collection('ministry_announcements');
  private readonly planChangesCol = db.collection('billing_plan_changes');
  private readonly customersCol = db.collection('billing_customers');
  private readonly ministrySubsCol = db.collection('ministry_subscriptions');
  private readonly whatsappConnectionsCol = db.collection('whatsapp_connections');

  private readonly subscriptionRepo = new SubscriptionRepository();

  async getJob(userId: string): Promise<AccountDeletionJobRecord | null> {
    const docId = `del_${userId}`;
    const doc = await this.jobsCol.doc(docId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as AccountDeletionJobRecord;
  }

  async saveJob(job: AccountDeletionJobRecord): Promise<void> {
    await this.jobsCol.doc(job.id).set(job, { merge: true });
  }

  async isDeletionPending(userId: string): Promise<boolean> {
    const job = await this.getJob(userId);
    if (!job) return false;
    const blockingStatuses = [
      'cleanup_in_progress',
      'auth_delete_pending',
      'completed',
      'attention_required',
    ];
    return blockingStatuses.includes(job.status);
  }

  // --------------------------------------------------------------------------
  // Preflight Evaluators
  // --------------------------------------------------------------------------

  async findOwnedMinistries(userId: string): Promise<Array<{ id: string; name: string }>> {
    const [minSnap, groupSnap] = await Promise.all([
      this.ministriesCol.where('owner_user_id', '==', userId).get(),
      this.groupsCol.where('owner_user_id', '==', userId).get(),
    ]);

    const map = new Map<string, { id: string; name: string }>();
    minSnap.docs.forEach((doc) => {
      map.set(doc.id, { id: doc.id, name: (doc.data()?.name as string) || `Ministério ${doc.id}` });
    });
    groupSnap.docs.forEach((doc) => {
      if (!map.has(doc.id)) {
        map.set(doc.id, { id: doc.id, name: (doc.data()?.name as string) || `Grupo ${doc.id}` });
      }
    });

    return Array.from(map.values());
  }

  async findOwnedOrganizations(userId: string): Promise<Array<{ id: string; name: string }>> {
    const [orgSnap, memberSnap] = await Promise.all([
      this.orgsCol.where('owner_user_id', '==', userId).get(),
      this.orgMembersCol.where('user_id', '==', userId).where('role', '==', 'owner').get(),
    ]);

    const map = new Map<string, { id: string; name: string }>();
    orgSnap.docs.forEach((doc) => {
      map.set(doc.id, { id: doc.id, name: (doc.data()?.name as string) || `Organização ${doc.id}` });
    });

    for (const mDoc of memberSnap.docs) {
      const orgId = mDoc.data()?.organization_id;
      if (orgId && !map.has(orgId)) {
        const orgDoc = await this.orgsCol.doc(orgId).get();
        const orgName = orgDoc.exists ? (orgDoc.data()?.name as string) : `Organização ${orgId}`;
        map.set(orgId, { id: orgId, name: orgName });
      }
    }

    return Array.from(map.values());
  }

  async findSoleAdminMinistries(userId: string): Promise<Array<{ id: string; name: string }>> {
    const adminMembersSnap = await this.membersCol
      .where('user_id', '==', userId)
      .where('role', '==', 'admin')
      .get();

    const results: Array<{ id: string; name: string }> = [];

    for (const doc of adminMembersSnap.docs) {
      const ministryId = doc.data()?.ministry_id;
      if (!ministryId) continue;

      const allAdminsSnap = await this.membersCol
        .where('ministry_id', '==', ministryId)
        .where('role', '==', 'admin')
        .get();

      if (allAdminsSnap.size <= 1) {
        const mDoc = await this.ministriesCol.doc(ministryId).get();
        const mName = mDoc.exists ? (mDoc.data()?.name as string) : `Ministério ${ministryId}`;
        results.push({ id: ministryId, name: mName });
      }
    }

    return results;
  }

  async findBillingContactMinistries(
    userId: string,
    userEmail?: string
  ): Promise<Array<{ id: string; name: string }>> {
    const membersSnap = await this.membersCol.where('user_id', '==', userId).get();
    const ministryIds = Array.from(new Set(membersSnap.docs.map((d) => d.data()?.ministry_id).filter(Boolean)));

    const results: Array<{ id: string; name: string }> = [];

    for (const mId of ministryIds) {
      // 1. Verificar se a assinatura é paga e ativa
      const subDoc = await this.ministrySubsCol.doc(mId).get();
      if (!subDoc.exists) continue;
      const subData = subDoc.data() as any;
      const isPaidActive =
        subData?.subscription_mode === 'paid' &&
        ['active', 'past_due', 'pending'].includes(subData?.billing_status);

      if (!isPaidActive) continue;

      // 2. Verificar se o cliente Asaas está associado ao usuário
      const custDoc = await this.customersCol.doc(`${mId}_asaas`).get();
      let isUserContact = false;
      if (custDoc.exists) {
        const cData = custDoc.data() as any;
        if (cData?.billing_contact_user_id === userId) {
          isUserContact = true;
        } else if (userEmail && cData?.email && cData.email.toLowerCase().trim() === userEmail.toLowerCase().trim()) {
          isUserContact = true;
        }
      }

      // 3. Verificar se há transições vivas iniciadas pelo usuário
      if (!isUserContact) {
        const transitionSnap = await this.planChangesCol
          .where('ministry_id', '==', mId)
          .where('requested_by_user_id', '==', userId)
          .get();
        const nonTerminal = [
          'pending_initial_purchase',
          'pending_future_authorization',
          'future_target_prepared',
          'awaiting_old_inactivation',
          'scheduled',
        ];
        isUserContact = transitionSnap.docs.some((d) => nonTerminal.includes(d.data()?.transition_status));
      }

      if (isUserContact) {
        const mDoc = await this.ministriesCol.doc(mId).get();
        const mName = mDoc.exists ? (mDoc.data()?.name as string) : `Ministério ${mId}`;
        results.push({ id: mId, name: mName });
      }
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Deletion Saga Checkpoints
  // --------------------------------------------------------------------------

  async deletePersonalData(userId: string): Promise<void> {
    // 1. users profile
    await this.usersCol.doc(userId).delete();

    // Helper para deletar em batches de até 400
    const deleteQueryDocs = async (query: FirebaseFirestore.Query) => {
      const snap = await query.get();
      if (snap.empty) return;
      const chunks: FirebaseFirestore.DocumentReference[][] = [];
      let currentChunk: FirebaseFirestore.DocumentReference[] = [];
      snap.docs.forEach((doc) => {
        currentChunk.push(doc.ref);
        if (currentChunk.length >= 400) {
          chunks.push(currentChunk);
          currentChunk = [];
        }
      });
      if (currentChunk.length > 0) chunks.push(currentChunk);

      for (const chunk of chunks) {
        const batch = db.batch();
        chunk.forEach((ref) => batch.delete(ref));
        await batch.commit();
      }
    };

    // 2. smart_chords
    await deleteQueryDocs(this.smartChordsCol.where('user_id', '==', userId));

    // 3. self-service unavailabilities
    await deleteQueryDocs(this.unavailabilitiesCol.where('user_id', '==', userId));

    // 4. schedule_comments
    await deleteQueryDocs(this.commentsCol.where('user_id', '==', userId));

    // 5. ministry_invites
    await deleteQueryDocs(this.invitesCol.where('created_by', '==', userId));

    // 6. group_invites (legacy)
    await deleteQueryDocs(this.groupInvitesCol.where('created_by', '==', userId));
  }

  async detachMemberships(userId: string): Promise<string[]> {
    const memberDocIds: string[] = [];

    // 1. ministry_members
    const membersSnap = await this.membersCol.where('user_id', '==', userId).get();
    for (const doc of membersSnap.docs) {
      memberDocIds.push(doc.id);
      const ministryId = doc.data()?.ministry_id;
      if (ministryId) {
        try {
          await this.subscriptionRepo.removeMemberTransactional({
            ministryId,
            memberUserIdOrDocId: doc.id,
          });
        } catch {
          // Se falhar (ex: já deletado ou concorrência), deleta direto
          await doc.ref.delete().catch(() => {});
        }
      } else {
        await doc.ref.delete().catch(() => {});
      }
    }

    // 2. organization_members
    const orgMembersSnap = await this.orgMembersCol.where('user_id', '==', userId).get();
    const orgBatch = db.batch();
    orgMembersSnap.docs.forEach((d) => orgBatch.delete(d.ref));
    if (!orgMembersSnap.empty) await orgBatch.commit();

    // 3. group_members (legacy)
    const groupMembersSnap = await this.groupMembersCol.where('user_id', '==', userId).get();
    const groupBatch = db.batch();
    groupMembersSnap.docs.forEach((d) => groupBatch.delete(d.ref));
    if (!groupMembersSnap.empty) await groupBatch.commit();

    // 4. ministry_teams: remover referências em member_ids
    const allIdsToScrub = [userId, ...memberDocIds];
    const teamsSnap = await this.teamsCol.get();
    for (const tDoc of teamsSnap.docs) {
      const data = tDoc.data();
      const memberIds = Array.isArray(data?.member_ids) ? (data.member_ids as string[]) : [];
      const hasMatch = memberIds.some((id) => allIdsToScrub.includes(id));
      if (hasMatch) {
        const cleaned = memberIds.filter((id) => !allIdsToScrub.includes(id));
        await tDoc.ref.update({
          member_ids: cleaned,
          updated_at: new Date().toISOString(),
        });
      }
    }

    return memberDocIds;
  }

  async cleanFutureSchedulesAndAnonymizeHistorical(
    userId: string,
    memberDocIds: string[]
  ): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const allIds = [userId, ...memberDocIds];

    const isUserMatch = (p: any): boolean => {
      if (!p) return false;
      const pId = String(p.id || '');
      const pUserId = String(p.userId || p.user_id || '');
      return allIds.includes(pId) || Boolean(pUserId && pUserId === userId);
    };

    const snap = await this.schedulesCol.get();

    for (const doc of snap.docs) {
      const s = doc.data() as any;
      const isFuture = (s.date || '') >= today;
      const participants = Array.isArray(s.participants) ? s.participants : [];

      if (isFuture) {
        const hadMatch = participants.some(isUserMatch);
        const creatorMatch = s.created_by === userId;

        if (hadMatch || creatorMatch) {
          const filtered = participants.filter((p: any) => !isUserMatch(p));
          const updates: any = {
            participants: filtered,
            updated_at: new Date().toISOString(),
          };
          if (creatorMatch) {
            updates.created_by = 'DELETED_USER';
          }
          await doc.ref.update(updates);
        }
      } else {
        // Histórico
        let updated = false;
        const updates: any = {};

        if (s.created_by === userId) {
          updates.created_by = 'DELETED_USER';
          updated = true;
        }

        const anonymized = participants.map((p: any) => {
          if (isUserMatch(p)) {
            updated = true;
            return {
              ...p,
              id: 'deleted_user',
              name: 'Usuário excluído',
              userId: null,
              user_id: null,
            };
          }
          return p;
        });

        if (updated) {
          updates.participants = anonymized;
          updates.updated_at = new Date().toISOString();
          await doc.ref.update(updates);
        }
      }
    }
  }

  async anonymizeHistoricalSharedContent(userId: string): Promise<void> {
    const anonymizeQuery = async (query: FirebaseFirestore.Query, updateFields: Record<string, any>) => {
      const snap = await query.get();
      if (snap.empty) return;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.update(d.ref, updateFields));
      await batch.commit();
    };

    // 1. songs
    await anonymizeQuery(this.songsCol.where('user_id', '==', userId), {
      user_id: null,
      created_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
    await anonymizeQuery(this.songsCol.where('created_by', '==', userId), {
      created_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 2. liturgies
    await anonymizeQuery(this.liturgiesCol.where('created_by', '==', userId), {
      created_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 3. teams created_by
    await anonymizeQuery(this.teamsCol.where('created_by', '==', userId), {
      created_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 4. announcements
    await anonymizeQuery(this.announcementsCol.where('created_by', '==', userId), {
      created_by: 'DELETED_USER',
      author: 'Usuário excluído',
      updated_at: new Date().toISOString(),
    });

    // 5. admin_manual member_unavailabilities
    await anonymizeQuery(this.unavailabilitiesCol.where('created_by_user_id', '==', userId), {
      created_by_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
    await anonymizeQuery(this.unavailabilitiesCol.where('updated_by_user_id', '==', userId), {
      updated_by_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 6. billing_plan_changes
    await anonymizeQuery(this.planChangesCol.where('requested_by_user_id', '==', userId), {
      requested_by_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
  }

  async anonymizeWhatsAppReferences(userId: string): Promise<void> {
    const snap = await this.whatsappConnectionsCol.where('created_by_user_id', '==', userId).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((doc) => {
      batch.update(doc.ref, {
        created_by_user_id: 'DELETED_USER',
        updated_at: new Date().toISOString(),
      });
    });
    await batch.commit();
  }
}
