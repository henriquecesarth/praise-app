import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { MinistryService } from './ministry.service';
import { MinistryController } from './ministry.controller';
import { AppError } from '../../middleware/error-handler';

describe('Member Management Feature Test Suite (M12A)', () => {
  let repo: MinistryRepository;
  let service: MinistryService;
  let controller: MinistryController;

  beforeEach(() => {
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. getMinistryMemberById', () => {
    it('returns full member details to an authorized admin viewer', async () => {
      // Mock member doc lookup
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
            role_ids: ['role-guitar'],
            joined_at: '2025-01-01T00:00:00Z',
            is_manual: false,
          }),
        }),
      });

      // Mock requester lookup (admin)
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
      expect(member.birth_date).toBe('1990-05-20');
      expect(member.role_ids).toEqual(['role-guitar']);
    });

    it('redacts private fields (email, birth_date) for ordinary member viewing another member', async () => {
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
            role_ids: ['role-guitar'],
            joined_at: '2025-01-01T00:00:00Z',
            is_manual: false,
          }),
        }),
      });

      // Mock requester lookup (ordinary member)
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

      expect(member.id).toBe('mem-123');
      expect(member.name).toBe('Carlos Oliveira');
      expect(member.role).toBe('member');
      expect(member.role_ids).toEqual(['role-guitar']);
      // Sensitive fields redacted
      expect(member.email).toBe('');
      expect(member.birth_date).toBeNull();
    });

    it('preserves private fields when an ordinary member views their own profile (self view)', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem-self',
          data: () => ({
            ministry_id: 'min-1',
            user_id: 'user-self',
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

      const member = await repo.getMinistryMemberById('min-1', 'mem-self', 'user-self');

      expect(member.email).toBe('eu@louvaio.com');
      expect(member.birth_date).toBe('1995-10-10');
    });

    it('enforces anti-IDOR: rejects member belonging to another ministry with 404', async () => {
      // Doc exists but belongs to min-2, requested from min-1
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'mem-wrong',
          data: () => ({
            ministry_id: 'min-2', // different ministry
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

    it('rejects non-existent member with 404', async () => {
      vi.spyOn((repo as any).membersCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
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
        repo.getMinistryMemberById('min-1', 'mem-nonexistent', 'admin-user')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 404,
          message: 'Membro não encontrado.',
        })
      );
    });
  });

  describe('2. addMemberManually with roleIds', () => {
    it('passes roleIds to addMemberTransactional', async () => {
      const mockMember = {
        id: 'new-mem-1',
        name: 'Novo Membro',
        email: 'novo@louvaio.com',
        role: 'member',
        role_ids: ['role-voc', 'role-violao'],
        is_manual: true,
      };

      const spy = vi.spyOn(repo, 'addMemberManually').mockResolvedValue(mockMember);

      const result = await service.addMemberManually('min-1', {
        name: 'Novo Membro',
        email: 'novo@louvaio.com',
        role: 'member',
        roleIds: ['role-voc', 'role-violao'],
      });

      expect(spy).toHaveBeenCalledWith('min-1', {
        name: 'Novo Membro',
        email: 'novo@louvaio.com',
        role: 'member',
        roleIds: ['role-voc', 'role-violao'],
      });
      expect(result).toEqual(mockMember);
    });
  });

  describe('3. Controller delegation', () => {
    it('getMinistryMemberById extracts params and delegates to service', async () => {
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
