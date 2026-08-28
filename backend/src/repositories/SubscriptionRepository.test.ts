import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionRepository } from './SubscriptionRepository';
import { MinistryRepository } from './MinistryRepository';
import { AppError } from '../middleware/error-handler';

describe('SubscriptionRepository & Transactional Quota Checks', () => {
  let repo: SubscriptionRepository;

  beforeEach(() => {
    repo = new SubscriptionRepository();
  });

  describe('Validação de Quota e Idempotência de Membros', () => {
    it('deve rejeitar adição de membro quando quota do plano for atingida', async () => {
      const mockRunTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTransaction = {
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref.id === 'sub-1') {
              return {
                exists: true,
                data: () => ({ plan_id: 'free', member_addon_blocks: 0 }),
              };
            }
            if (ref.id === 'usage-1') {
              return {
                exists: true,
                data: () => ({ members_count: 10, songs_count: 5 }), // Limite Free é 10
              };
            }
            return { exists: false };
          }),
          set: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        };
        return callback(mockTransaction);
      });

      const { db } = await import('../lib/firebase');
      const originalRunTransaction = db.runTransaction;
      db.runTransaction = mockRunTransaction;

      (repo as any).subscriptionsCol = { doc: () => ({ id: 'sub-1' }) };
      (repo as any).usageCol = { doc: () => ({ id: 'usage-1' }) };
      (repo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ empty: true }),
            }),
          }),
        }),
        doc: () => ({ id: 'mem-new' }),
      };

      try {
        await expect(
          repo.addMemberTransactional({
            ministryId: 'min-1',
            userId: 'user-11',
            role: 'member',
          })
        ).rejects.toThrow(/Limite de membros do plano Free atingido \(10\/10\)/i);
      } finally {
        db.runTransaction = originalRunTransaction;
      }
    });

    it('deve BLOQUEAR adição do 86º membro durante período de GRACE em plano Free de 10 membros', async () => {
      const mockRunTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTransaction = {
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref.id === 'sub-1') {
              return {
                exists: true,
                data: () => ({
                  plan_id: 'free',
                  member_addon_blocks: 0,
                  grace_period_expires_at: '2026-09-04T00:00:00.000Z', // Grace ativo
                }),
              };
            }
            if (ref.id === 'usage-1') {
              return {
                exists: true,
                data: () => ({ members_count: 85, songs_count: 20 }), // Excedido (85 > 10)
              };
            }
            return { exists: false };
          }),
          set: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        };
        return callback(mockTransaction);
      });

      const { db } = await import('../lib/firebase');
      const originalRunTransaction = db.runTransaction;
      db.runTransaction = mockRunTransaction;

      (repo as any).subscriptionsCol = { doc: () => ({ id: 'sub-1' }) };
      (repo as any).usageCol = { doc: () => ({ id: 'usage-1' }) };
      (repo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ empty: true }),
            }),
          }),
        }),
        doc: () => ({ id: 'mem-86' }),
      };

      try {
        await expect(
          repo.addMemberTransactional({
            ministryId: 'min-1',
            userId: 'user-86',
            role: 'member',
          })
        ).rejects.toThrow(/Limite de membros do plano Free atingido \(85\/10\)/i);
      } finally {
        db.runTransaction = originalRunTransaction;
      }
    });

    it('deve BLOQUEAR criação da 151ª música durante período de GRACE em plano Free de 50 músicas', async () => {
      const mockRunTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTransaction = {
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref.id === 'sub-1') {
              return {
                exists: true,
                data: () => ({
                  plan_id: 'free',
                  member_addon_blocks: 0,
                  grace_period_expires_at: '2026-09-04T00:00:00.000Z',
                }),
              };
            }
            if (ref.id === 'usage-1') {
              return {
                exists: true,
                data: () => ({ members_count: 5, songs_count: 150 }), // Excedido (150 > 50)
              };
            }
            return { exists: false };
          }),
          set: vi.fn(),
          update: vi.fn(),
          delete: vi.fn(),
        };
        return callback(mockTransaction);
      });

      const { db } = await import('../lib/firebase');
      const originalRunTransaction = db.runTransaction;
      db.runTransaction = mockRunTransaction;

      (repo as any).subscriptionsCol = { doc: () => ({ id: 'sub-1' }) };
      (repo as any).usageCol = { doc: () => ({ id: 'usage-1' }) };
      (repo as any).songsCol = {
        doc: () => ({ id: 'song-151' }),
      };

      try {
        await expect(
          repo.createSongTransactional({
            ministryId: 'min-1',
            songData: { title: 'Música 151' },
          })
        ).rejects.toThrow(/Limite de músicas do plano Free atingido \(150\/50\)/i);
      } finally {
        db.runTransaction = originalRunTransaction;
      }
    });

    it('deve retornar membro existente sem incrementar uso quando usuário já pertencer ao ministério (idempotência)', async () => {
      const mockRunTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTransaction = {
          get: vi.fn().mockImplementation(async (ref: any) => {
            if (ref.id === 'sub-1') return { exists: true, data: () => ({ plan_id: 'free', member_addon_blocks: 0 }) };
            if (ref.id === 'usage-1') return { exists: true, data: () => ({ members_count: 7, songs_count: 5 }) };
            return { exists: false };
          }),
          set: vi.fn(),
        };
        return callback(mockTransaction);
      });

      const { db } = await import('../lib/firebase');
      const originalRunTransaction = db.runTransaction;
      db.runTransaction = mockRunTransaction;

      (repo as any).subscriptionsCol = { doc: () => ({ id: 'sub-1' }) };
      (repo as any).usageCol = { doc: () => ({ id: 'usage-1' }) };
      (repo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [{ id: 'existing-doc', data: () => ({ user_id: 'user-existing', role: 'member' }) }],
              }),
            }),
          }),
        }),
      };

      try {
        const result = await repo.addMemberTransactional({
          ministryId: 'min-1',
          userId: 'user-existing',
          role: 'member',
        });

        expect(result.member.id).toBe('existing-doc');
        expect(result.usage.members_count).toBe(7); // Não incrementou!
      } finally {
        db.runTransaction = originalRunTransaction;
      }
    });
  });

  describe('Deleções e Consistência de Uso', () => {
    it('deve lançar 404 e não alterar contador se membro a ser removido não existir', async () => {
      const mockRunTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTransaction = {
          get: vi.fn().mockResolvedValue({ exists: false }),
          delete: vi.fn(),
        };
        return callback(mockTransaction);
      });

      const { db } = await import('../lib/firebase');
      const originalRunTransaction = db.runTransaction;
      db.runTransaction = mockRunTransaction;

      (repo as any).membersCol = {
        doc: () => ({ id: 'not-found' }),
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ empty: true }),
            }),
          }),
        }),
      };

      try {
        await expect(
          repo.removeMemberTransactional({
            ministryId: 'min-1',
            memberUserIdOrDocId: 'not-found',
          })
        ).rejects.toThrow(/Membro não encontrado neste ministério/i);
      } finally {
        db.runTransaction = originalRunTransaction;
      }
    });

    it('deve lançar 404 e não alterar contador se música a ser excluída não pertencer ao ministério', async () => {
      const mockRunTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTransaction = {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'other-min' }), // Pertence a outro ministério!
          }),
          delete: vi.fn(),
        };
        return callback(mockTransaction);
      });

      const { db } = await import('../lib/firebase');
      const originalRunTransaction = db.runTransaction;
      db.runTransaction = mockRunTransaction;

      (repo as any).songsCol = {
        doc: () => ({ id: 'song-diff-tenant' }),
      };

      try {
        await expect(
          repo.deleteSongTransactional({
            ministryId: 'min-1',
            songId: 'song-diff-tenant',
          })
        ).rejects.toThrow(/Música não encontrada neste ministério/i);
      } finally {
        db.runTransaction = originalRunTransaction;
      }
    });
  });

  describe('Join por Código Transacional (MinistryRepository)', () => {
    it('deve barrar join por código quando o limite de membros do plano for atingido', async () => {
      const minRepo = new MinistryRepository();

      (minRepo as any).invitesCol = {
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [
                {
                  id: 'inv-1',
                  ref: { id: 'inv-1' },
                  data: () => ({
                    code: 'PR-TEST',
                    ministry_id: 'min-full',
                    expires_at: null,
                    max_uses: null,
                    uses_count: 0,
                  }),
                },
              ],
            }),
          }),
        }),
      };

      (minRepo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'min-full',
            data: () => ({ name: 'Full Ministry' }),
          }),
        }),
      };

      let getCallCount = 0;
      const mockRunTransaction = vi.fn().mockImplementation(async (callback) => {
        const mockTx = {
          get: vi.fn().mockImplementation(async (_ref: any) => {
            getCallCount++;
            // 1st get is subRef
            if (getCallCount === 1) {
              return { exists: true, data: () => ({ plan_id: 'free', member_addon_blocks: 0 }) };
            }
            // 2nd get is usageRef
            if (getCallCount === 2) {
              return { exists: true, data: () => ({ members_count: 10, songs_count: 5 }) };
            }
            // 3rd get is freshInviteDoc
            return {
              exists: true,
              data: () => ({
                code: 'PR-TEST',
                ministry_id: 'min-full',
                expires_at: null,
                max_uses: null,
                uses_count: 0,
              }),
            };
          }),
          set: vi.fn(),
          update: vi.fn(),
        };
        return callback(mockTx);
      });

      const { db } = await import('../lib/firebase');
      const originalRunTransaction = db.runTransaction;
      db.runTransaction = mockRunTransaction;

      // Mock membersCol
      (minRepo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ empty: true }),
            }),
          }),
          get: vi.fn().mockResolvedValue({ size: 10 }), // Já atingiu 10 membros
        }),
        doc: () => ({ id: 'mem-join' }),
      };

      try {
        await expect(minRepo.joinMinistryByCode('user-joiner', 'PR-TEST')).rejects.toThrow(
          /Limite de membros do plano Free atingido \(10\/10\)/i
        );
      } finally {
        db.runTransaction = originalRunTransaction;
      }
    });
  });
});
