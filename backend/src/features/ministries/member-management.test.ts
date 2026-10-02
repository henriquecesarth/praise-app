import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { MinistryService } from './ministry.service';
import { MinistryController } from './ministry.controller';
import { AppError } from '../../middleware/error-handler';

describe('Member Management Feature Test Suite (M12A-R2)', () => {
  let repo: MinistryRepository;
  let service: MinistryService;
  let controller: MinistryController;

  beforeEach(async () => {
    vi.clearAllMocks();
    repo = new MinistryRepository();
    service = new MinistryService(repo);
    controller = new MinistryController(service);

    // Default mock for usersCol
    vi.spyOn((repo as any).usersCol, 'doc').mockReturnValue({
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({ name: 'Carlos Oliveira', email: 'carlos@louvaio.com', birth_date: '1990-05-20' }),
      }),
    });

    // Default mock for ministriesCol
    (repo as any).ministriesCol = {
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ owner_user_id: 'owner-user' }),
        }),
      }),
    };

    // Default mock for db.getAll
    const { db } = await import('../../lib/firebase');
    db.getAll = vi.fn().mockImplementation((...refs: any[]) => {
      return Promise.resolve(
        refs.map((r) => ({
          id: r?.id || 'mock-user-id',
          exists: true,
          data: () => ({ name: 'Mock Name', email: 'mock@louvaio.com' }),
        }))
      );
    }) as any;

    // Default mock for db.runTransaction
    db.runTransaction = vi.fn().mockImplementation(async (callback: any) => {
      const mockTransaction = {
        get: vi.fn().mockImplementation(async (refOrQuery: any) => {
          if (refOrQuery && typeof refOrQuery.get === 'function') {
            return await refOrQuery.get();
          }
          return { exists: false, data: () => ({}) };
        }),
        set: vi.fn(),
        update: vi.fn().mockImplementation((ref: any, updates: any) => {
          if (ref && typeof ref.update === 'function') {
            return ref.update(updates);
          }
        }),
        delete: vi.fn(),
      };
      return await callback(mockTransaction);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. getMinistryMemberById (Strict DTOs and Privacy)', () => {
    it('returns full administrative allowlist DTO to an authorized admin viewer', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem-123',
          data: () => ({
            ministry_id: 'min-1',
            user_id: 'user-456',
            role: 'member',
            name: 'Carlos Oliveira',
            email: 'carlos@louvaio.com',
            birth_date: '1990-05-20',
            phone: '11999998888',
            role_ids: ['role-guitar'],
            joined_at: '2025-01-01T00:00:00Z',
            is_manual: false,
          }),
        }),
      });

      vi.spyOn((repo as any).membersCol, 'where').mockImplementation(() => {
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ role: 'admin' }) }],
              }),
            }),
          }),
        } as any;
      });

      const member = await repo.getMinistryMemberById('min-1', 'mem-123', 'admin-user');

      expect(member).toBeDefined();
      expect(member.id).toBe('mem-123');
      expect(member.name).toBe('Carlos Oliveira');
      expect(member.email).toBe('carlos@louvaio.com');
      expect(member.phone).toBe('11999998888');
      expect(member.birth_date).toBe('1990-05-20');
      expect(member.role).toBe('member');
      expect(member.role_ids).toEqual(['role-guitar']);
      expect(member.is_manual).toBe(false);
      expect(member.user_id).toBe('user-456');
      expect(member.joined_at).toBe('2025-01-01T00:00:00Z');
    });

    it('returns minimal peer view DTO (no private fields, user_id, or is_manual) for ordinary peer viewer', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem-123',
          data: () => ({
            ministry_id: 'min-1',
            user_id: 'user-other',
            role: 'member',
            name: 'Carlos Oliveira',
            email: 'carlos@louvaio.com',
            birth_date: '1990-05-20',
            phone: '11999998888',
            role_ids: ['role-guitar'],
            joined_at: '2025-01-01T00:00:00Z',
            is_manual: false,
          }),
        }),
      });

      vi.spyOn((repo as any).membersCol, 'where').mockImplementation(() => {
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ role: 'member' }) }],
              }),
            }),
          }),
        } as any;
      });

      const member = await repo.getMinistryMemberById('min-1', 'mem-123', 'ordinary-user');

      // Allowed public fields
      expect(member.id).toBe('mem-123');
      expect(member.name).toBe('Carlos Oliveira');
      expect(member.role).toBe('member');
      expect(member.role_ids).toEqual(['role-guitar']);

      // Private fields strictly omitted from peer DTO
      expect(member.email).toBeUndefined();
      expect(member.phone).toBeUndefined();
      expect(member.birth_date).toBeUndefined();
      expect(member.user_id).toBeUndefined();
      expect(member.is_manual).toBeUndefined();
      expect(member.joined_at).toBeUndefined();
      expect(member.ministry_id).toBeUndefined();
    });

    it('preserves self contact fields only via canonical user_id (not doc ID fallback)', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'doc-different-id',
          data: () => ({
            ministry_id: 'min-1',
            user_id: 'user-self-actual',
            role: 'member',
            name: 'Meu Nome',
            email: 'eu@louvaio.com',
            birth_date: '1995-10-10',
            role_ids: [],
            is_manual: false,
          }),
        }),
      });

      vi.spyOn((repo as any).usersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => ({ name: 'Meu Nome', email: 'eu@louvaio.com', birth_date: '1995-10-10' }),
        }),
      });

      vi.spyOn((repo as any).membersCol, 'where').mockImplementation(() => {
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ role: 'member' }) }],
              }),
            }),
          }),
        } as any;
      });

      // 1. Matched by canonical user_id -> Self DTO
      const selfMember = await repo.getMinistryMemberById('min-1', 'doc-different-id', 'user-self-actual');
      expect(selfMember.email).toBe('eu@louvaio.com');
      expect(selfMember.birth_date).toBe('1995-10-10');

      // 2. Caller has doc ID 'doc-different-id' but different user_id -> MUST NOT be self!
      const notSelfMember = await repo.getMinistryMemberById('min-1', 'doc-different-id', 'doc-different-id');
      expect(notSelfMember.email).toBeUndefined();
      expect(notSelfMember.birth_date).toBeUndefined();
    });

    it('rejects soft-removed member with 404', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem-removed',
          data: () => ({
            ministry_id: 'min-1',
            status: 'removed',
            removed_at: '2026-10-01T00:00:00Z',
          }),
        }),
      });

      await expect(
        repo.getMinistryMemberById('min-1', 'mem-removed', 'admin-user')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          message: 'Membro não encontrado.',
        })
      );
    });

    it('enforces anti-IDOR: rejects member belonging to another ministry with 404', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem-wrong',
          data: () => ({
            ministry_id: 'min-2',
            user_id: 'user-x',
            name: 'Outro',
          }),
        }),
      });

      vi.spyOn((repo as any).membersCol, 'where').mockImplementation(() => {
        return {
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
            }),
          }),
        } as any;
      });

      await expect(
        repo.getMinistryMemberById('min-1', 'mem-wrong', 'admin-user')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          message: 'Membro não encontrado.',
        })
      );
    });
  });

  describe('2. getMinistryMembers (Directory Privacy)', () => {
    it('returns peer allowlist DTO (no contact info) when called by ordinary member', async () => {
      const mockMembers = [
        { id: 'm1', ministry_id: 'min-1', user_id: 'u1', role: 'admin', is_manual: false, name: 'Admin User', email: 'admin@louvaio.com' },
        { id: 'm2', ministry_id: 'min-1', user_id: 'u2', role: 'member', is_manual: false, name: 'Peer User', email: 'peer@louvaio.com' },
        { id: 'm-removed', ministry_id: 'min-1', user_id: 'u-rem', role: 'member', status: 'removed' },
      ];

      (repo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: mockMembers.map((m) => ({ id: m.id, data: () => m })),
          }),
        }),
      };

      (repo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ owner_user_id: 'u1' }),
          }),
        }),
      };

      const { db } = await import('../../lib/firebase');
      db.getAll = vi.fn().mockImplementation((...refs: any[]) => {
        return Promise.resolve([
          { id: 'u1', exists: true, data: () => ({ name: 'Admin User', email: 'admin@louvaio.com' }) },
          { id: 'u2', exists: true, data: () => ({ name: 'Peer User', email: 'peer@louvaio.com' }) },
        ]);
      }) as any;

      // Ordinary member u2 calling directory
      const results = await repo.getMinistryMembers('min-1', 'u2');

      // Soft-removed member m-removed must be filtered out
      expect(results.length).toBe(2);

      // u1 is peer to u2 -> peer view (no email)
      expect(results[0].id).toBe('m1');
      expect(results[0].name).toBe('Admin User');
      expect(results[0].email).toBeUndefined();
      expect(results[0].phone).toBeUndefined();
      expect(results[0].user_id).toBeUndefined();

      // u2 is self -> self view (email included)
      expect(results[1].id).toBe('m2');
      expect(results[1].email).toBe('peer@louvaio.com');
    });
  });

  describe('3. Canonical roleIds validation', () => {
    beforeEach(() => {
      (repo as any).rolesCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: id === 'role-valid-1' || id === 'role-valid-2',
            data: () => ({ ministry_id: 'min-1' }),
          }),
        })),
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: [
              { id: 'role-valid-1' },
              { id: 'role-valid-2' },
            ],
          }),
        }),
      };
      (repo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ owner_user_id: 'owner-id' }),
          }),
        }),
      };
    });

    it('rejects unknown or cross-ministry roleIds with 400 AppError', async () => {
      (repo as any).membersCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-1', role: 'member' }),
            ref: { update: vi.fn() },
          }),
        }),
      };

      await expect(
        repo.updateMemberDetails('min-1', 'mem-1', {
          roleIds: ['role-valid-1', 'role-fake-cross-ministry'],
        }, 'owner-id')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: 'Função musical inválida ou não pertencente a este ministério.',
        })
      );
    });

    it('normalizes and deduplicates valid roleIds before persisting', async () => {
      const updateMock = vi.fn().mockResolvedValue(undefined);
      (repo as any).membersCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-1', role: 'member', role_ids: [] }),
            ref: {
              update: updateMock,
              get: vi.fn().mockResolvedValue({
                id: 'mem-1',
                data: () => ({ ministry_id: 'min-1', role: 'member', role_ids: ['role-valid-1'] }),
              }),
            },
          }),
        }),
      };

      await repo.updateMemberDetails('min-1', 'mem-1', {
        roleIds: ['role-valid-1', 'role-valid-1 ', 'role-valid-1'],
      }, 'owner-id');

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          role_ids: ['role-valid-1'],
        })
      );
    });
  });

  describe('4. RBAC Privilege Escalation Prevention', () => {
    beforeEach(() => {
      (repo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ owner_user_id: 'owner-1' }),
          }),
        }),
      };
      (repo as any).membersCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-1', user_id: 'target-user', role: 'member' }),
            ref: { update: vi.fn() },
          }),
        }),
      };
    });

    it('forbids ordinary admin from promoting another member to admin (403)', async () => {
      await expect(
        repo.updateMemberDetails('min-1', 'mem-target', {
          role: 'admin',
        }, 'ordinary-admin-id') // requester is NOT owner
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          message: 'Apenas o proprietário do ministério pode promover integrantes a administrador.',
        })
      );
    });

    it('forbids ordinary admin from adding a new member with admin role (403)', async () => {
      await expect(
        repo.addMemberManually('min-1', {
          name: 'Novo Admin',
          email: 'admin@louvaio.com',
          role: 'admin',
        }, 'ordinary-admin-id')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          message: 'Apenas o proprietário do ministério pode adicionar novos administradores.',
        })
      );
    });

    it('allows ministry owner to promote member to admin', async () => {
      const updateMock = vi.fn().mockResolvedValue(undefined);
      (repo as any).membersCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-1', user_id: 'target-user', role: 'member' }),
            ref: {
              update: updateMock,
              get: vi.fn().mockResolvedValue({
                id: 'mem-target',
                data: () => ({ role: 'admin' }),
              }),
            },
          }),
        }),
      };

      const result = await repo.updateMemberDetails('min-1', 'mem-target', {
        role: 'admin',
      }, 'owner-1'); // requester IS owner

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' })
      );
      expect(result.role).toBe('admin');
    });

    it('forbids assigning owner role through member endpoints (403)', async () => {
      await expect(
        repo.updateMemberDetails('min-1', 'mem-target', {
          role: 'owner' as any,
        }, 'owner-1')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          message: 'Não é permitido atribuir a função de proprietário.',
        })
      );
    });
  });

  describe('5. Real Soft Removal & Guardrails', () => {
    it('forbids ordinary admin from removing another admin (403)', async () => {
      (repo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ owner_user_id: 'owner-id' }),
          }),
        }),
      };

      (repo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ ministry_id: 'min-1', user_id: 'target-admin', role: 'admin' }) }],
              }),
            }),
          }),
        }),
      };

      await expect(
        repo.removeMember('min-1', 'target-admin', 'other-admin-id')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 403,
          message: 'Apenas o proprietário pode remover outro administrador do ministério.',
        })
      );
    });

    it('forbids removing the ministry owner (400)', async () => {
      (repo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ owner_user_id: 'owner-user' }),
          }),
        }),
      };

      (repo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                empty: false,
                docs: [{ data: () => ({ user_id: 'owner-user', role: 'admin' }) }],
              }),
            }),
          }),
        }),
      };

      await expect(
        repo.removeMember('min-1', 'owner-user', 'owner-user')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: 'O proprietário do ministério não pode ser removido.',
        })
      );
    });
  });

  describe('6. Controller delegation', () => {
    it('getMinistryMemberById extracts params and delegates to service with requesting user ID', async () => {
      const mockMember = { id: 'm1', name: 'Ana', role: 'member' };
      vi.spyOn(service, 'getMinistryMemberById').mockResolvedValue(mockMember);

      const req: any = {
        params: { ministryId: 'min-1', memberId: 'm1' },
        user: { id: 'usr-admin' },
      };
      const res: any = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      await controller.getMinistryMemberById(req, res, next);

      expect(service.getMinistryMemberById).toHaveBeenCalledWith('min-1', 'm1', 'usr-admin');
      expect(res.json).toHaveBeenCalledWith(mockMember);
    });
  });
});
