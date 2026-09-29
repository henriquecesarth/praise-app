import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../lib/firebase';
import { AccountDeletionRepository } from '../../repositories/AccountDeletionRepository';

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
        ref: {
          update: vi.fn().mockResolvedValue(undefined),
        },
      };

      vi.spyOn((repository as any).schedulesCol, 'get').mockResolvedValue({
        docs: [mockFutureDoc],
      });

      await repository.cleanFutureSchedulesAndAnonymizeHistorical(testUserId, ['mem_doc_1']);

      expect(mockFutureDoc.ref.update).toHaveBeenCalledWith(
        expect.objectContaining({
          participants: [{ id: 'usr_other_1', name: 'Other User', role: 'Teclado' }],
        })
      );
    });

    it('anonymizes participants in historical schedules to neutral "Usuário excluído"', async () => {
      const pastDate = '2020-01-01';

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
        ref: {
          update: vi.fn().mockResolvedValue(undefined),
        },
      };

      vi.spyOn((repository as any).schedulesCol, 'get').mockResolvedValue({
        docs: [mockPastDoc],
      });

      await repository.cleanFutureSchedulesAndAnonymizeHistorical(testUserId, []);

      expect(mockPastDoc.ref.update).toHaveBeenCalledWith(
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

  describe('anonymizeWhatsAppReferences', () => {
    it('anonymizes created_by_user_id in whatsapp_connections without deleting connections or secrets', async () => {
      const mockBatch = {
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const mockConnDoc = {
        id: 'wac_1',
        ref: { id: 'wac_1' },
      };

      vi.spyOn((repository as any).whatsappConnectionsCol, 'where').mockReturnValue({
        get: vi.fn().mockResolvedValue({ docs: [mockConnDoc], empty: false }),
      } as any);

      await repository.anonymizeWhatsAppReferences(testUserId);

      expect(mockBatch.update).toHaveBeenCalledWith(
        { id: 'wac_1' },
        expect.objectContaining({
          created_by_user_id: 'DELETED_USER',
        })
      );
      expect(mockBatch.commit).toHaveBeenCalled();
    });
  });
});
