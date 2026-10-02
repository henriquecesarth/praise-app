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
        // Admin viewer: should receive enriched metadata including email
        const adminMembers = await repo.getMinistryMembers('min-1', 'u1');

        expect(adminMembers.length).toBe(3);
        expect(adminMembers[0].name).toBe('Henrique César');
        expect(adminMembers[0].email).toBe('henrique@example.com');
        expect(adminMembers[1].name).toBe('Lívia Santos');
        expect(adminMembers[1].email).toBe('livia@example.com');
        expect(adminMembers[2].name).toBe('Convidado Manual');

        // Confirma que db.getAll() foi chamado em lote uma única vez com 2 referências
        expect(mockGetAll).toHaveBeenCalledTimes(1);

        // Ordinary peer viewer: should NOT receive email for other members
        const peerMembers = await repo.getMinistryMembers('min-1', 'u-stranger');
        expect(peerMembers[0].email).toBeUndefined();
        expect(peerMembers[1].email).toBeUndefined();
      } finally {
        db.getAll = originalGetAll;
      }
    });
  });
});
