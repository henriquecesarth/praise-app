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

  describe('joinMinistryByCode Invite Race & Fresh Transaction Revalidation (H04)', () => {
    it('incrementa uses_count com base no freshInvite da transação e rejeita convite esgotado concorrentemente', async () => {
      const { db } = await import('../lib/firebase');
      const originalRunTransaction = db.runTransaction;

      // Shared mutable invite state: initially 0 uses out of max 2
      const liveInviteState = {
        code: 'PR-RACE',
        ministry_id: 'min-1',
        expires_at: null,
        max_uses: 2,
        uses_count: 0,
      };

      const inviteRef = {
        id: 'inv-1',
        get: vi.fn().mockImplementation(async () => ({
          exists: true,
          id: 'inv-1',
          data: () => ({ ...liveInviteState }),
        })),
      };

      (repo as any).invitesCol = {
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            get: vi.fn().mockImplementation(async () => ({
              empty: false,
              // All callers read stale initial uses_count: 0 before entering transaction
              docs: [{ id: 'inv-1', ref: inviteRef, data: () => ({ ...liveInviteState, uses_count: 0 }) }],
            })),
          }),
        }),
      };

      (repo as any).ministriesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: true, id: 'min-1', data: () => ({ name: 'Min 1' }) }),
        }),
      };

      const membersSet = new Map<string, any>();
      (repo as any).membersCol = {
        where: vi.fn().mockImplementation((_f: string, _op: string, val: string) => ({
          where: vi.fn().mockImplementation((_f2: string, _op2: string, uid: string) => ({
            limit: vi.fn().mockReturnValue({
              get: vi.fn().mockImplementation(async () => {
                const found = Array.from(membersSet.values()).find((m) => m.user_id === uid);
                return found ? { empty: false, docs: [{ id: found.id, data: () => found }] } : { empty: true, docs: [] };
              }),
            }),
          })),
          get: vi.fn().mockResolvedValue({ size: membersSet.size, docs: [] }),
        })),
        doc: vi.fn().mockImplementation(() => ({ id: `mem_${membersSet.size + 1}` })),
      };

      let txQueue = Promise.resolve();
      db.runTransaction = vi.fn().mockImplementation((cb: any) => {
        const next = txQueue.then(async () => {
          const mockTx = {
            get: vi.fn().mockImplementation(async (ref: any) => {
              if (ref === inviteRef) {
                return { exists: true, id: 'inv-1', data: () => ({ ...liveInviteState }) };
              }
              if (ref?.path?.includes('ministry_subscriptions') || ref?.id === 'sub') {
                return { exists: true, data: () => ({ plan_id: 'lite', member_addon_blocks: 0 }) };
              }
              if (ref?.path?.includes('ministry_usage') || ref?.id === 'usage') {
                return { exists: true, data: () => ({ members_count: membersSet.size, songs_count: 0 }) };
              }
              return { exists: true, data: () => ({ plan_id: 'lite', member_addon_blocks: 0 }) };
            }),
            set: vi.fn().mockImplementation((ref: any, data: any) => {
              if (data?.ministry_id && data?.user_id) {
                membersSet.set(ref.id, data);
              }
            }),
            update: vi.fn().mockImplementation((ref: any, patch: any) => {
              if (ref === inviteRef && patch.uses_count !== undefined) {
                liveInviteState.uses_count = patch.uses_count;
              }
            }),
          };
          return cb(mockTx);
        });
        txQueue = next.then(() => undefined, () => undefined);
        return next;
      });

      const subDocMock = { id: 'sub', path: 'ministry_subscriptions/min-1' };
      const usageDocMock = { id: 'usage', path: 'ministry_usage/min-1' };
      const colSpy = vi.spyOn(db, 'collection').mockImplementation((name: string): any => {
        if (name === 'ministry_subscriptions') return { doc: vi.fn().mockReturnValue(subDocMock) };
        if (name === 'ministry_usage') return { doc: vi.fn().mockReturnValue(usageDocMock) };
        return { doc: vi.fn() };
      });

      try {
        await repo.joinMinistryByCode('user-a', 'PR-RACE');
        expect(liveInviteState.uses_count).toBe(1);

        await repo.joinMinistryByCode('user-b', 'PR-RACE');
        // Must advance to 2, not overwrite with stale (0 + 1) = 1
        expect(liveInviteState.uses_count).toBe(2);

        await expect(repo.joinMinistryByCode('user-c', 'PR-RACE')).rejects.toMatchObject({
          statusCode: 400,
        });
      } finally {
        db.runTransaction = originalRunTransaction;
        colSpy.mockRestore();
      }
    });
  });
});
