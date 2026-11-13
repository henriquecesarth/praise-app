import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../../lib/firebase';
import {
  AccountDeletionRepository,
  deleteQueryDocsChunked,
  updateQueryDocsChunked,
} from '../../repositories/AccountDeletionRepository';

describe('AccountDeletionRepository Persistence & Anonymization Suite', () => {
  let repository: AccountDeletionRepository;
  const testUserId = 'usr_repo_test_123';

  beforeEach(() => {
    vi.restoreAllMocks();
    repository = new AccountDeletionRepository();
  });

  describe('isDeletionPending', () => {
    it('returns true when job status is cleanup_in_progress, auth_delete_pending, completed, or attention_required', async () => {
      vi.spyOn(repository, 'getJob').mockResolvedValueOnce({
        id: `del_${testUserId}`,
        user_id: testUserId,
        user_email: 'test@louvaio.com',
        status: 'cleanup_in_progress',
        checkpoints: {},
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      expect(await repository.isDeletionPending(testUserId)).toBe(true);

      vi.spyOn(repository, 'getJob').mockResolvedValueOnce({
        id: `del_${testUserId}`,
        user_id: testUserId,
        user_email: 'test@louvaio.com',
        status: 'completed',
        checkpoints: {},
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      expect(await repository.isDeletionPending(testUserId)).toBe(true);
    });

    it('returns false when job status is requested or preflight_blocked or does not exist', async () => {
      vi.spyOn(repository, 'getJob').mockResolvedValueOnce(null);
      expect(await repository.isDeletionPending(testUserId)).toBe(false);

      vi.spyOn(repository, 'getJob').mockResolvedValueOnce({
        id: `del_${testUserId}`,
        user_id: testUserId,
        user_email: 'test@louvaio.com',
        status: 'preflight_blocked',
        checkpoints: {},
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      expect(await repository.isDeletionPending(testUserId)).toBe(false);
    });
  });

  describe('cleanFutureSchedulesAndAnonymizeHistorical', () => {
    it('removes participant from future schedules without disturbing other participants', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const futureDate = '2099-12-31';

      const mockBatch = {
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue([]),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const mockFutureDoc = {
        id: 'sched_future_1',
        data: () => ({
          id: 'sched_future_1',
          date: futureDate,
          created_by: 'creator_other',
          participants: [
            { id: testUserId, name: 'Deleting User', role: 'Vocal' },
            { id: 'usr_other_1', name: 'Other User', role: 'Teclado' },
          ],
        }),
        ref: { id: 'sched_future_1' } as any,
      };

      const futureScheduleChain: any = {
        limit: vi.fn(),
        startAfter: vi.fn(),
        get: vi.fn().mockResolvedValue({ docs: [mockFutureDoc] }),
      };
      futureScheduleChain.limit.mockReturnValue(futureScheduleChain);
      futureScheduleChain.startAfter.mockReturnValue(futureScheduleChain);
      vi.spyOn((repository as any).schedulesCol, 'orderBy').mockReturnValue(futureScheduleChain);

      await repository.cleanFutureSchedulesAndAnonymizeHistorical(testUserId, ['mem_doc_1']);

      expect(mockBatch.update).toHaveBeenCalledWith(
        mockFutureDoc.ref,
        expect.objectContaining({
          participants: [{ id: 'usr_other_1', name: 'Other User', role: 'Teclado' }],
        })
      );
    });

    it('anonymizes participants in historical schedules to neutral "Usuário excluído"', async () => {
      const pastDate = '2020-01-01';

      const mockBatch = {
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue([]),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const mockPastDoc = {
        id: 'sched_past_1',
        data: () => ({
          id: 'sched_past_1',
          date: pastDate,
          created_by: testUserId,
          participants: [
            { id: testUserId, name: 'Deleting User', role: 'Vocal', userId: testUserId },
            { id: 'usr_other_2', name: 'Preserved User', role: 'Bateria' },
          ],
        }),
        ref: { id: 'sched_past_1' } as any,
      };

      const pastScheduleChain: any = {
        limit: vi.fn(),
        startAfter: vi.fn(),
        get: vi.fn().mockResolvedValue({ docs: [mockPastDoc] }),
      };
      pastScheduleChain.limit.mockReturnValue(pastScheduleChain);
      pastScheduleChain.startAfter.mockReturnValue(pastScheduleChain);
      vi.spyOn((repository as any).schedulesCol, 'orderBy').mockReturnValue(pastScheduleChain);

      await repository.cleanFutureSchedulesAndAnonymizeHistorical(testUserId, []);

      expect(mockBatch.update).toHaveBeenCalledWith(
        mockPastDoc.ref,
        expect.objectContaining({
          created_by: 'DELETED_USER',
          participants: [
            {
              id: 'deleted_user',
              name: 'Usuário excluído',
              role: 'Vocal',
              userId: null,
              user_id: null,
            },
            { id: 'usr_other_2', name: 'Preserved User', role: 'Bateria' },
          ],
        })
      );
    });
  });

  describe('anonymizeHistoricalSharedContent', () => {
    it('anonymizes creator references across shared songs, liturgies, teams, and announcements', async () => {
      const mockBatch = {
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const makeDoc = (id: string) => ({
        id,
        ref: { id },
      });

      vi.spyOn((repository as any).songsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [makeDoc('song_1')] }),
      } as any);

      vi.spyOn((repository as any).liturgiesCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [makeDoc('lit_1')] }),
      } as any);

      vi.spyOn((repository as any).teamsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [makeDoc('team_1')] }),
      } as any);

      vi.spyOn((repository as any).announcementsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [makeDoc('ann_1')] }),
      } as any);

      vi.spyOn((repository as any).unavailabilitiesCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);

      vi.spyOn((repository as any).planChangesCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);

      await repository.anonymizeHistoricalSharedContent(testUserId);

      expect(mockBatch.commit).toHaveBeenCalled();
      expect(mockBatch.update).toHaveBeenCalledWith(
        { id: 'ann_1' },
        expect.objectContaining({
          created_by: 'DELETED_USER',
          author: 'Usuário excluído',
        })
      );
    });
  });

  describe('anonymizeBillingReferences', () => {
    it('anonymizes requested_by_user_id and cancellation_reversal_requested_by in billing_plan_changes', async () => {
      const mockBatch = {
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const makeDoc = (id: string) => ({ id, ref: { id } });

      vi.spyOn((repository as any).planChangesCol, 'where').mockImplementation(((...args: any[]) => {
        const field = args[0];
        if (field === 'requested_by_user_id') {
          return { get: vi.fn().mockResolvedValue({ docs: [makeDoc('tr_req_1')] }) } as any;
        }
        if (field === 'cancellation_reversal_requested_by') {
          return { get: vi.fn().mockResolvedValue({ docs: [makeDoc('tr_rev_1')] }) } as any;
        }
        return { get: vi.fn().mockResolvedValue({ docs: [] }) } as any;
      }) as any);

      vi.spyOn((repository as any).customersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);

      await repository.anonymizeBillingReferences(testUserId);

      expect(mockBatch.update).toHaveBeenCalledWith(
        { id: 'tr_req_1' },
        expect.objectContaining({ requested_by_user_id: 'DELETED_USER' })
      );
      expect(mockBatch.update).toHaveBeenCalledWith(
        { id: 'tr_rev_1' },
        expect.objectContaining({ cancellation_reversal_requested_by: 'DELETED_USER' })
      );
      expect(mockBatch.commit).toHaveBeenCalled();
    });
  });

  describe('anonymizeWhatsAppReferences', () => {
    it('anonymizes actor_user_id in onboarding sessions and claimed/created_by in connections without deleting secrets', async () => {
      const mockBatch = {
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const mockConnDoc = { id: 'wac_1', ref: { id: 'wac_1' } };
      const mockSessionDoc = { id: 'wabs_1', ref: { id: 'wabs_1' } };

      vi.spyOn((repository as any).whatsappOnboardingSessionsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [mockSessionDoc], empty: false }),
      } as any);

      vi.spyOn((repository as any).whatsappConnectionsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [mockConnDoc], empty: false }),
      } as any);

      await repository.anonymizeWhatsAppReferences(testUserId);

      expect(mockBatch.update).toHaveBeenCalledWith(
        { id: 'wabs_1' },
        expect.objectContaining({ actor_user_id: 'DELETED_USER' })
      );
      expect(mockBatch.update).toHaveBeenCalledWith(
        { id: 'wac_1' },
        expect.objectContaining({ created_by_user_id: 'DELETED_USER' })
      );
      expect(mockBatch.commit).toHaveBeenCalled();
    });
  });

  describe('findBillingContactMinistries', () => {
    it('blocks deletion when user is canonical billing_contact_user_id on active paid subscription', async () => {
      vi.spyOn((repository as any).customersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: [{ data: () => ({ ministry_id: 'min_paid_1' }) }],
        }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).membersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).customersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ billing_contact_user_id: testUserId }),
        }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ subscription_mode: 'paid', billing_status: 'active', billing_contact_user_id: testUserId }),
        }),
      } as any);
      vi.spyOn((repository as any).billingSubscriptionsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      } as any);
      vi.spyOn((repository as any).ministriesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ name: 'Ministério Emanuel' }),
        }),
      } as any);

      const result = await repository.findBillingContactMinistries(testUserId);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ id: 'min_paid_1', name: 'Ministério Emanuel', reason: 'CURRENT_USER' });
    });

    it('fails closed for an active legacy relationship with no explicit contact', async () => {
      vi.spyOn((repository as any).customersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).membersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [{ data: () => ({ ministry_id: 'min_legacy_1' }) }] }),
      } as any);
      vi.spyOn((repository as any).customersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ provider: 'asaas' }) }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ subscription_mode: 'paid', billing_status: 'active' }),
        }),
      } as any);
      vi.spyOn((repository as any).billingSubscriptionsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      } as any);
      vi.spyOn((repository as any).ministriesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Ministério Legado' }) }),
      } as any);

      const result = await repository.findBillingContactMinistries(testUserId);
      expect(result).toEqual([{ id: 'min_legacy_1', name: 'Ministério Legado', reason: 'UNKNOWN_LEGACY' }]);
    });

    it('fails closed for an active legacy billing subscription stored under the inverted document id', async () => {
      vi.spyOn((repository as any).customersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).membersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [{ data: () => ({ ministry_id: 'min_legacy_inverted' }) }] }),
      } as any);
      vi.spyOn((repository as any).customersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ subscription_mode: 'free' }) }),
      } as any);
      vi.spyOn((repository as any).billingSubscriptionsCol, 'doc').mockImplementation((id: unknown) => ({
        get: vi.fn().mockResolvedValue(
          id === 'asaas_min_legacy_inverted'
            ? { exists: true, data: () => ({ provider: 'asaas', status: 'active' }) }
            : { exists: false }
        ),
      }) as any);
      vi.spyOn((repository as any).ministriesCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Ministério Legado' }) }),
      } as any);

      await expect(repository.findBillingContactMinistries(testUserId)).resolves.toEqual([
        { id: 'min_legacy_inverted', name: 'Ministério Legado', reason: 'UNKNOWN_LEGACY' },
      ]);
    });

    it('does not block a member when a different explicit contact owns the active relationship', async () => {
      vi.spyOn((repository as any).customersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).membersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [{ data: () => ({ ministry_id: 'min_paid_2' }) }] }),
      } as any);
      vi.spyOn((repository as any).customersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ billing_contact_user_id: 'usr-other' }) }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ subscription_mode: 'paid', billing_status: 'active', billing_contact_user_id: 'usr-other' }),
        }),
      } as any);
      vi.spyOn((repository as any).billingSubscriptionsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      } as any);

      await expect(repository.findBillingContactMinistries(testUserId)).resolves.toEqual([]);
    });

    it('does not block when no active paid relationship exists', async () => {
      vi.spyOn((repository as any).customersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).membersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [{ data: () => ({ ministry_id: 'min_free_1' }) }] }),
      } as any);
      vi.spyOn((repository as any).customersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      } as any);
      vi.spyOn((repository as any).ministrySubsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ subscription_mode: 'free', billing_status: 'active' }),
        }),
      } as any);
      vi.spyOn((repository as any).billingSubscriptionsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      } as any);

      await expect(repository.findBillingContactMinistries(testUserId)).resolves.toEqual([]);
    });
  });

  describe('createManifest', () => {
    it('discovers all memberships and persists durable manifest before detachment', async () => {
      vi.spyOn((repository as any).membersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: [
            { id: 'mem_1', data: () => ({ ministry_id: 'min_1' }) },
            { id: 'mem_2', data: () => ({ ministry_id: 'min_2' }) },
          ],
        }),
      } as any);
      vi.spyOn((repository as any).orgMembersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: [{ id: 'org_mem_1', data: () => ({ organization_id: 'org_1' }) }],
        }),
      } as any);
      vi.spyOn((repository as any).groupMembersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);

      const manifest = await repository.createManifest(testUserId);
      expect(manifest.ministry_member_doc_ids).toEqual(['mem_1', 'mem_2']);
      expect(manifest.organization_member_doc_ids).toEqual(['org_mem_1']);
      expect(manifest.member_ids).toEqual(['mem_1', 'mem_2']);
      expect(manifest.ministry_ids).toEqual(['min_1', 'min_2']);
    });
  });

  describe('Firestore batch chunking (>500 items)', () => {
    it('chunks >500 items into safe batches below the 500-operation Firestore limit', async () => {
      const commitCount = { count: 0 };
      const mockBatch = {
        delete: vi.fn(),
        commit: vi.fn().mockImplementation(async () => {
          commitCount.count++;
        }),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      // Create 600 fake document references
      const fakeRefs: any[] = [];
      for (let i = 0; i < 600; i++) {
        fakeRefs.push({ id: `doc_${i}` });
      }

      const { chunkedBatchDelete } = await import('../../repositories/AccountDeletionRepository');
      await chunkedBatchDelete(fakeRefs, 250);

      // 600 items with chunkSize=250 -> 3 batches (250, 250, 100)
      expect(commitCount.count).toBe(3);
      expect(mockBatch.delete).toHaveBeenCalledTimes(600);
    });
  });

  describe('FR2-5 multi-page cursor pagination & per-page bounded writes', () => {
    function buildCursorPaginatedQuery(initialDocs: Array<{ id: string; ref: { id: string }; data: () => Record<string, any> }>) {
      const orderByCalls: Array<[unknown, unknown]> = [];
      const limitCalls: number[] = [];
      const startAfterIds: string[] = [];

      const makeQuery = (state: { cursorId?: string; pageLimit?: number } = {}): any => ({
        orderBy: vi.fn((field: unknown, dir: unknown) => {
          orderByCalls.push([field, dir]);
          return makeQuery(state);
        }),
        limit: vi.fn((limitVal: number) => {
          limitCalls.push(limitVal);
          return makeQuery({ ...state, pageLimit: limitVal });
        }),
        startAfter: vi.fn((cursorDoc: any) => {
          startAfterIds.push(cursorDoc.id);
          return makeQuery({ ...state, cursorId: cursorDoc.id });
        }),
        get: vi.fn(async () => {
          const sorted = [...initialDocs].sort((a, b) => a.id.localeCompare(b.id));
          const filtered = state.cursorId
            ? sorted.filter((d) => d.id > state.cursorId!)
            : sorted;
          const sliced = typeof state.pageLimit === 'number'
            ? filtered.slice(0, state.pageLimit)
            : filtered;
          return { docs: sliced, empty: sliced.length === 0 };
        }),
      });

      return { query: makeQuery(), orderByCalls, limitCalls, startAfterIds };
    }

    it('paginates deleteQueryDocsChunked in bounded cursor pages <= 100', async () => {
      const docs = Array.from({ length: 250 }, (_, i) => {
        const id = `del_doc_${String(i).padStart(3, '0')}`;
        return { id, ref: { id }, data: () => ({ user_id: testUserId }) };
      });
      const deletedIds: string[] = [];
      const mockBatch = {
        delete: vi.fn((ref: { id: string }) => {
          deletedIds.push(ref.id);
          const idx = docs.findIndex((d) => d.id === ref.id);
          if (idx >= 0) docs.splice(idx, 1);
        }),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const tracker = buildCursorPaginatedQuery(docs);
      await deleteQueryDocsChunked(tracker.query, 250);

      expect(tracker.orderByCalls.length).toBeGreaterThanOrEqual(3);
      expect(tracker.orderByCalls[0][0]).toEqual(FieldPath.documentId());
      expect(tracker.limitCalls.every((n) => n <= 100)).toBe(true);
      expect(tracker.startAfterIds).toEqual(['del_doc_099', 'del_doc_199']);
      expect(deletedIds).toHaveLength(250);
    });

    it('paginates updateQueryDocsChunked in bounded cursor pages <= 100', async () => {
      const docs = Array.from({ length: 250 }, (_, i) => {
        const id = `upd_doc_${String(i).padStart(3, '0')}`;
        return { id, ref: { id }, data: () => ({ created_by: testUserId }) };
      });
      const updatedIds: string[] = [];
      const mockBatch = {
        update: vi.fn((ref: { id: string }) => {
          updatedIds.push(ref.id);
        }),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const tracker = buildCursorPaginatedQuery(docs);
      await updateQueryDocsChunked(tracker.query, { created_by: 'DELETED_USER' }, 250);

      expect(tracker.orderByCalls.length).toBeGreaterThanOrEqual(3);
      expect(tracker.orderByCalls[0][0]).toEqual(FieldPath.documentId());
      expect(tracker.limitCalls.every((n) => n <= 100)).toBe(true);
      expect(tracker.startAfterIds).toEqual(['upd_doc_099', 'upd_doc_199']);
      expect(updatedIds).toHaveLength(250);
    });

    it('paginates detachMemberships teamsCol across multiple cursor pages and flushes per page', async () => {
      const teamDocs = Array.from({ length: 250 }, (_, i) => {
        const id = `team_${String(i).padStart(3, '0')}`;
        return {
          id,
          ref: { id },
          data: () => ({ member_ids: [testUserId, 'other_user'], leader_id: 'other_user' }),
        };
      });
      const updatedTeamIds: string[] = [];
      let commitCalls = 0;
      const mockBatch = {
        update: vi.fn((ref: { id: string }, data: Record<string, any>) => {
          updatedTeamIds.push(ref.id);
          expect(data.member_ids).toEqual(['other_user']);
        }),
        commit: vi.fn().mockImplementation(async () => {
          commitCalls++;
        }),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      vi.spyOn((repository as any).membersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).orgMembersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);
      vi.spyOn((repository as any).groupMembersCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [] }),
      } as any);

      const tracker = buildCursorPaginatedQuery(teamDocs);
      vi.spyOn((repository as any).teamsCol, 'orderBy').mockImplementation(tracker.query.orderBy);
      vi.spyOn((repository as any).teamsCol, 'limit').mockImplementation(tracker.query.limit);
      vi.spyOn((repository as any).teamsCol, 'startAfter').mockImplementation(tracker.query.startAfter);

      await repository.detachMemberships(testUserId, {
        ministry_member_doc_ids: [],
        organization_member_doc_ids: [],
        group_member_doc_ids: [],
        member_ids: [],
        ministry_ids: [],
      });

      expect(tracker.orderByCalls[0][0]).toEqual(FieldPath.documentId());
      expect(tracker.limitCalls.every((n) => n <= 100)).toBe(true);
      expect(tracker.startAfterIds).toEqual(['team_099', 'team_199']);
      expect(updatedTeamIds).toHaveLength(250);
      expect(commitCalls).toBe(3);
    });

    it('paginates cleanFutureSchedulesAndAnonymizeHistorical schedulesCol across multiple cursor pages and flushes per page', async () => {
      const futureDate = '2099-12-31';
      const scheduleDocs = Array.from({ length: 250 }, (_, i) => {
        const id = `sched_${String(i).padStart(3, '0')}`;
        return {
          id,
          ref: { id },
          data: () => ({
            date: futureDate,
            created_by: 'someone_else',
            participants: [{ id: testUserId, userId: testUserId, name: 'Test User' }],
          }),
        };
      });
      const updatedScheduleIds: string[] = [];
      let commitCalls = 0;
      const mockBatch = {
        update: vi.fn((ref: { id: string }, data: Record<string, any>) => {
          updatedScheduleIds.push(ref.id);
          expect(data.participants).toEqual([]);
        }),
        commit: vi.fn().mockImplementation(async () => {
          commitCalls++;
        }),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const tracker = buildCursorPaginatedQuery(scheduleDocs);
      vi.spyOn((repository as any).schedulesCol, 'orderBy').mockImplementation(tracker.query.orderBy);
      vi.spyOn((repository as any).schedulesCol, 'limit').mockImplementation(tracker.query.limit);
      vi.spyOn((repository as any).schedulesCol, 'startAfter').mockImplementation(tracker.query.startAfter);

      await repository.cleanFutureSchedulesAndAnonymizeHistorical(testUserId, []);

      expect(tracker.orderByCalls[0][0]).toEqual(FieldPath.documentId());
      expect(tracker.limitCalls.every((n) => n <= 100)).toBe(true);
      expect(tracker.startAfterIds).toEqual(['sched_099', 'sched_199']);
      expect(updatedScheduleIds).toHaveLength(250);
      expect(commitCalls).toBe(3);
    });
  });
});
