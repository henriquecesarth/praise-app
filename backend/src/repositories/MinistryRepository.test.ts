import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MinistryRepository } from './MinistryRepository';

describe('MinistryRepository Batch Optimization', () => {
  let repo: MinistryRepository;

  beforeEach(() => {
    repo = new MinistryRepository();
  });

  describe('getMinistryMembers', () => {
    it('deve buscar metadados de usuários em lote com db.getAll()', async () => {
      const mockMembers = [
        { id: 'm1', ministry_id: 'min-1', user_id: 'u1', role: 'admin', is_manual: false },
        { id: 'm2', ministry_id: 'min-1', user_id: 'u2', role: 'member', is_manual: false },
        { id: 'm3', ministry_id: 'min-1', user_id: null, name: 'Convidado Manual', role: 'member', is_manual: true },
      ];

      (repo as any).membersCol = {
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: mockMembers.map((m) => ({ id: m.id, data: () => m })),
          }),
        }),
      };

      const mockUsers = [
        { id: 'u1', exists: true, data: () => ({ name: 'Henrique César', email: 'henrique@example.com' }) },
        { id: 'u2', exists: true, data: () => ({ name: 'Lívia Santos', email: 'livia@example.com' }) },
      ];

      const { db } = await import('../lib/firebase');
      const originalGetAll = db.getAll;
      const mockGetAll = vi.fn().mockResolvedValue(mockUsers);
      db.getAll = mockGetAll as any;

      try {
        const enriched = await repo.getMinistryMembers('min-1');

        expect(enriched.length).toBe(3);
        expect(enriched[0].name).toBe('Henrique César');
        expect(enriched[0].email).toBe('henrique@example.com');
        expect(enriched[1].name).toBe('Lívia Santos');
        expect(enriched[2].name).toBe('Convidado Manual');

        // Confirma que db.getAll() foi chamado em lote uma única vez com 2 referências
        expect(mockGetAll).toHaveBeenCalledTimes(1);
      } finally {
        db.getAll = originalGetAll;
      }
    });
  });
});
