import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  AccountDeletionJobRecord,
  AccountDeletionBlocker,
  AccountDeletionCheckpoints,
  DeletionManifest,
} from '../features/account_deletion/account-deletion.types';
import { SubscriptionRepository } from './SubscriptionRepository';

export const BATCH_CHUNK_SIZE = 250;

export interface BillingContactDeletionBlocker {
  id: string;
  name: string;
  reason?: 'CURRENT_USER' | 'UNKNOWN_LEGACY';
}

export async function chunkedBatchDelete(
  refs: FirebaseFirestore.DocumentReference[],
  chunkSize = BATCH_CHUNK_SIZE
): Promise<void> {
  if (refs.length === 0) return;
  for (let i = 0; i < refs.length; i += chunkSize) {
    const chunk = refs.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const ref of chunk) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

export async function chunkedBatchUpdate(
  items: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }>,
  chunkSize = BATCH_CHUNK_SIZE
): Promise<void> {
  if (items.length === 0) return;
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const batch = db.batch();
    for (const item of chunk) {
      batch.update(item.ref, item.data);
    }
    await batch.commit();
  }
}

export async function deleteQueryDocsChunked(
  query: FirebaseFirestore.Query,
  chunkSize = BATCH_CHUNK_SIZE
): Promise<void> {
  const snap = await query.get();
  if (snap.empty) return;
  const refs = snap.docs.map((d) => d.ref);
  await chunkedBatchDelete(refs, chunkSize);
}

export async function updateQueryDocsChunked(
  query: FirebaseFirestore.Query,
  data: Record<string, any>,
  chunkSize = BATCH_CHUNK_SIZE
): Promise<void> {
  const snap = await query.get();
  if (snap.empty) return;
  const items = snap.docs.map((d) => ({ ref: d.ref, data }));
  await chunkedBatchUpdate(items, chunkSize);
}

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
  private readonly billingSubscriptionsCol = db.collection('billing_subscriptions');
  private readonly ministrySubsCol = db.collection('ministry_subscriptions');
  private readonly whatsappConnectionsCol = db.collection('whatsapp_connections');
  private readonly whatsappOnboardingSessionsCol = db.collection('whatsapp_onboarding_sessions');

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

  async findBillingContactMinistries(userId: string): Promise<BillingContactDeletionBlocker[]> {
    // Explicit contacts block even if the user has already left the ministry.
    // Unknown legacy contacts are evaluated only for the user's memberships,
    // because there is no safe identity correlation outside that boundary.
    const [customersSnap, appSubsSnap, membershipsSnap] = await Promise.all([
      this.customersCol.where('billing_contact_user_id', '==', userId).get(),
      this.ministrySubsCol.where('billing_contact_user_id', '==', userId).get(),
      this.membersCol.where('user_id', '==', userId).get(),
    ]);

    const candidateMinistryIds = new Set<string>();
    const memberMinistryIds = new Set<string>();
    for (const doc of customersSnap.docs) {
      const ministryId = doc.data()?.ministry_id;
      if (ministryId) candidateMinistryIds.add(ministryId);
    }
    for (const doc of appSubsSnap.docs) {
      const ministryId = doc.data()?.ministry_id || doc.id;
      if (ministryId) candidateMinistryIds.add(ministryId);
    }
    for (const doc of membershipsSnap.docs) {
      const ministryId = doc.data()?.ministry_id;
      if (ministryId) {
        candidateMinistryIds.add(ministryId);
        memberMinistryIds.add(ministryId);
      }
    }

    const results: BillingContactDeletionBlocker[] = [];
    for (const ministryId of candidateMinistryIds) {
      const [customerDoc, appSubDoc, billingSubDoc, legacyBillingSubDoc] = await Promise.all([
        this.customersCol.doc(`${ministryId}_asaas`).get(),
        this.ministrySubsCol.doc(ministryId).get(),
        this.billingSubscriptionsCol.doc(`${ministryId}_asaas`).get(),
        this.billingSubscriptionsCol.doc(`asaas_${ministryId}`).get(),
      ]);

      const customer = customerDoc.exists ? (customerDoc.data() as any) : null;
      const appSub = appSubDoc.exists ? (appSubDoc.data() as any) : null;
      const billingSubscriptions = [billingSubDoc, legacyBillingSubDoc]
        .filter((doc) => doc.exists)
        .map((doc) => doc.data() as any);
      const isPaidAppRelationship =
        appSub?.subscription_mode === 'paid' &&
        ['active', 'past_due', 'pending'].includes(appSub?.billing_status);
      const isLiveAsaasSubscription = billingSubscriptions.some(
        (billingSub) =>
          billingSub?.provider === 'asaas' &&
          ['active', 'pending', 'past_due'].includes(billingSub?.status)
      );

      if (!isPaidAppRelationship && !isLiveAsaasSubscription) continue;

      const explicitContacts = [customer?.billing_contact_user_id, appSub?.billing_contact_user_id]
        .filter((contact): contact is string => typeof contact === 'string' && contact.trim().length > 0);
      const reason = explicitContacts.includes(userId)
        ? 'CURRENT_USER'
        : explicitContacts.length === 0 && memberMinistryIds.has(ministryId)
          ? 'UNKNOWN_LEGACY'
          : null;

      if (!reason) continue;

      const ministryDoc = await this.ministriesCol.doc(ministryId).get();
      const name = ministryDoc.exists
        ? (ministryDoc.data()?.name as string)
        : `Ministério ${ministryId}`;
      results.push({ id: ministryId, name, reason });
    }

    return results;
  }

  // --------------------------------------------------------------------------
  // Deletion Manifest
  // --------------------------------------------------------------------------

  async createManifest(userId: string): Promise<DeletionManifest> {
    const [membersSnap, orgMembersSnap, groupMembersSnap] = await Promise.all([
      this.membersCol.where('user_id', '==', userId).get(),
      this.orgMembersCol.where('user_id', '==', userId).get(),
      this.groupMembersCol.where('user_id', '==', userId).get(),
    ]);

    const ministryMemberDocIds = membersSnap.docs.map((d) => d.id);
    const orgMemberDocIds = orgMembersSnap.docs.map((d) => d.id);
    const groupMemberDocIds = groupMembersSnap.docs.map((d) => d.id);
    const ministryIds = Array.from(
      new Set(membersSnap.docs.map((d) => d.data()?.ministry_id).filter(Boolean))
    );

    return {
      created_at: new Date().toISOString(),
      ministry_member_doc_ids: ministryMemberDocIds,
      organization_member_doc_ids: orgMemberDocIds,
      group_member_doc_ids: groupMemberDocIds,
      member_ids: ministryMemberDocIds,
      ministry_ids: ministryIds,
    };
  }

  // --------------------------------------------------------------------------
  // Deletion Saga Checkpoints
  // --------------------------------------------------------------------------

  async deletePersonalData(userId: string): Promise<void> {
    // 1. users profile
    await this.usersCol.doc(userId).delete();

    // 2. smart_chords
    await deleteQueryDocsChunked(this.smartChordsCol.where('user_id', '==', userId));

    // 3. self-service unavailabilities
    await deleteQueryDocsChunked(this.unavailabilitiesCol.where('user_id', '==', userId));

    // 4. schedule_comments
    await deleteQueryDocsChunked(this.commentsCol.where('user_id', '==', userId));

    // 5. ministry_invites
    await deleteQueryDocsChunked(this.invitesCol.where('created_by', '==', userId));

    // 6. group_invites (legacy)
    await deleteQueryDocsChunked(this.groupInvitesCol.where('created_by', '==', userId));
  }

  async detachMemberships(userId: string, manifest?: DeletionManifest | null): Promise<void> {
    // 1. ministry_members: decrementa quota e remove documento
    const ministryMemberDocIds = manifest?.ministry_member_doc_ids || [];
    if (ministryMemberDocIds.length > 0) {
      for (const docId of ministryMemberDocIds) {
        const doc = await this.membersCol.doc(docId).get();
        if (doc.exists) {
          const ministryId = doc.data()?.ministry_id;
          if (ministryId) {
            try {
              await this.subscriptionRepo.removeMemberTransactional({
                ministryId,
                memberUserIdOrDocId: doc.id,
              });
            } catch {
              await doc.ref.delete().catch(() => {});
            }
          } else {
            await doc.ref.delete().catch(() => {});
          }
        }
      }
    } else {
      // Fallback dinâmico se executado sem manifesto
      const membersSnap = await this.membersCol.where('user_id', '==', userId).get();
      for (const doc of membersSnap.docs) {
        const ministryId = doc.data()?.ministry_id;
        if (ministryId) {
          try {
            await this.subscriptionRepo.removeMemberTransactional({
              ministryId,
              memberUserIdOrDocId: doc.id,
            });
          } catch {
            await doc.ref.delete().catch(() => {});
          }
        } else {
          await doc.ref.delete().catch(() => {});
        }
      }
    }

    // 2. organization_members (chunked delete)
    if (manifest?.organization_member_doc_ids && manifest.organization_member_doc_ids.length > 0) {
      const refs = manifest.organization_member_doc_ids.map((id) => this.orgMembersCol.doc(id));
      await chunkedBatchDelete(refs);
    } else {
      await deleteQueryDocsChunked(this.orgMembersCol.where('user_id', '==', userId));
    }

    // 3. group_members (legacy chunked delete)
    if (manifest?.group_member_doc_ids && manifest.group_member_doc_ids.length > 0) {
      const refs = manifest.group_member_doc_ids.map((id) => this.groupMembersCol.doc(id));
      await chunkedBatchDelete(refs);
    } else {
      await deleteQueryDocsChunked(this.groupMembersCol.where('user_id', '==', userId));
    }

    // 4. ministry_teams: remover referências em member_ids (chunked)
    const allIdsToScrub = [userId, ...(manifest?.member_ids || [])];
    const teamsSnap = await this.teamsCol.get();
    const teamUpdates: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }> = [];

    for (const tDoc of teamsSnap.docs) {
      const data = tDoc.data();
      const memberIds = Array.isArray(data?.member_ids) ? (data.member_ids as string[]) : [];
      const hasMatch = memberIds.some((id) => allIdsToScrub.includes(id));
      if (hasMatch) {
        const cleaned = memberIds.filter((id) => !allIdsToScrub.includes(id));
        teamUpdates.push({
          ref: tDoc.ref,
          data: {
            member_ids: cleaned,
            updated_at: new Date().toISOString(),
          },
        });
      }
    }

    await chunkedBatchUpdate(teamUpdates);
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
    const scheduleUpdates: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, any> }> = [];

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
          scheduleUpdates.push({ ref: doc.ref, data: updates });
        }
      } else {
        // Histórico: preserva integridade, anonimiza identificadores
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
          scheduleUpdates.push({ ref: doc.ref, data: updates });
        }
      }
    }

    await chunkedBatchUpdate(scheduleUpdates);
  }

  async anonymizeHistoricalSharedContent(userId: string): Promise<void> {
    // 1. songs
    await updateQueryDocsChunked(this.songsCol.where('user_id', '==', userId), {
      user_id: null,
      created_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
    await updateQueryDocsChunked(this.songsCol.where('created_by', '==', userId), {
      created_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 2. liturgies
    await updateQueryDocsChunked(this.liturgiesCol.where('created_by', '==', userId), {
      created_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 3. teams created_by
    await updateQueryDocsChunked(this.teamsCol.where('created_by', '==', userId), {
      created_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 4. announcements
    await updateQueryDocsChunked(this.announcementsCol.where('created_by', '==', userId), {
      created_by: 'DELETED_USER',
      author: 'Usuário excluído',
      updated_at: new Date().toISOString(),
    });

    // 5. admin_manual member_unavailabilities
    await updateQueryDocsChunked(this.unavailabilitiesCol.where('created_by_user_id', '==', userId), {
      created_by_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
    await updateQueryDocsChunked(this.unavailabilitiesCol.where('updated_by_user_id', '==', userId), {
      updated_by_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
  }

  async anonymizeBillingReferences(userId: string): Promise<void> {
    // 1. billing_plan_changes: requested_by_user_id
    await updateQueryDocsChunked(this.planChangesCol.where('requested_by_user_id', '==', userId), {
      requested_by_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 2. billing_plan_changes: cancellation_reversal_requested_by
    await updateQueryDocsChunked(this.planChangesCol.where('cancellation_reversal_requested_by', '==', userId), {
      cancellation_reversal_requested_by: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 3. billing_customers: billing_contact_user_id (se houver histórico)
    await updateQueryDocsChunked(this.customersCol.where('billing_contact_user_id', '==', userId), {
      billing_contact_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
  }

  async anonymizeWhatsAppReferences(userId: string): Promise<void> {
    // 1. whatsapp_onboarding_sessions: actor_user_id
    await updateQueryDocsChunked(this.whatsappOnboardingSessionsCol.where('actor_user_id', '==', userId), {
      actor_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });

    // 2. whatsapp_connections: created_by_user_id & claimed_by_user_id
    await updateQueryDocsChunked(this.whatsappConnectionsCol.where('created_by_user_id', '==', userId), {
      created_by_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
    await updateQueryDocsChunked(this.whatsappConnectionsCol.where('claimed_by_user_id', '==', userId), {
      claimed_by_user_id: 'DELETED_USER',
      updated_at: new Date().toISOString(),
    });
  }
}
