import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleRepository, encodeCommentCursor, decodeCommentCursor } from './ScheduleRepository';
import { AppError } from '../middleware/error-handler';

describe('ScheduleRepository Hardened Comments Pagination', () => {
  let repo: ScheduleRepository;

  beforeEach(() => {
    repo = new ScheduleRepository();
  });

  describe('Comment Cursor Security & Validation', () => {
    it('deve codificar e decodificar token de cursor de comentário corretamente', () => {
      const token = encodeCommentCursor({
        id: 'comm-123',
        c: '2026-08-29T11:00:00.000Z',
        s: 'sched-1',
      });

      const decoded = decodeCommentCursor(token, 'sched-1');
      expect(decoded.id).toBe('comm-123');
      expect(decoded.c).toBe('2026-08-29T11:00:00.000Z');
      expect(decoded.s).toBe('sched-1');
    });

    it('deve REJEITAR cursor com schedule_id diferente (Cross-Schedule Injection)', () => {
      const foreignToken = encodeCommentCursor({
        id: 'comm-999',
        c: '2026-08-29T11:00:00.000Z',
        s: 'sched-2', // Outra escala
      });

      expect(() => decodeCommentCursor(foreignToken, 'sched-1')).toThrow(AppError);
    });
  });

  describe('getScheduleComments', () => {
    it('deve buscar comentários ordenados e invertidos para exibição cronológica', async () => {
      (repo as any).schedulesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: true, id: 'sched-1', data: () => ({ id: 'sched-1', ministry_id: 'min-1' }) }),
        }),
      };

      const mockDocs = [
        { id: 'c3', content: 'Terceira msg', created_at: '2026-08-29T10:05:00Z' },
        { id: 'c2', content: 'Segunda msg', created_at: '2026-08-29T10:02:00Z' },
        { id: 'c1', content: 'Primeira msg', created_at: '2026-08-29T10:00:00Z' },
      ];

      const mockLimit = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: mockDocs.map((d) => ({ id: d.id, data: () => d })),
        }),
      });

      const mockOrderByDocId = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockOrderByCreated = vi.fn().mockReturnValue({ orderBy: mockOrderByDocId });

      (repo as any).commentsCol = {
        where: vi.fn().mockReturnValue({
          orderBy: mockOrderByCreated,
        }),
      };

      const comments = await repo.getScheduleComments('sched-1', 'min-1', 50);

      // Deve estar ordenado cronologicamente (c1 -> c2 -> c3)
      expect(comments.length).toBe(3);
      expect(comments[0].id).toBe('c1');
      expect(comments[1].id).toBe('c2');
      expect(comments[2].id).toBe('c3');
    });
  });

  describe('Schedule Duration & Persistence (Phase 6C)', () => {
    it('persiste duration_minutes: 120 por padrão quando omitido na criação', async () => {
      let savedData: any = null;
      const mockDocRef = {
        id: 'sched-new-1',
        set: vi.fn().mockImplementation(async (data) => {
          savedData = data;
        }),
      };
      (repo as any).schedulesCol = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      const result = await repo.createSchedule('min-1', 'user-1', {
        title: 'Culto Noturno',
        date: '2026-09-20',
        time: '19:00',
      });

      expect(result.duration_minutes).toBe(120);
      expect(result.durationMinutes).toBe(120);
      expect(savedData.duration_minutes).toBe(120);
    });

    it('persiste duration_minutes customizado quando fornecido', async () => {
      let savedData: any = null;
      const mockDocRef = {
        id: 'sched-new-2',
        set: vi.fn().mockImplementation(async (data) => {
          savedData = data;
        }),
      };
      (repo as any).schedulesCol = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      const result = await repo.createSchedule('min-1', 'user-1', {
        title: 'Vigília',
        date: '2026-09-20',
        time: '22:00',
        durationMinutes: 240,
      });

      expect(result.duration_minutes).toBe(240);
      expect(result.durationMinutes).toBe(240);
      expect(savedData.duration_minutes).toBe(240);
    });

    it('retorna durationMinutes mapeado a partir de duration_minutes no getScheduleById', async () => {
      (repo as any).schedulesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'sched-existing',
            data: () => ({
              id: 'sched-existing',
              ministry_id: 'min-1',
              title: 'Culto',
              duration_minutes: 90,
            }),
          }),
        }),
      };

      const sched = await repo.getScheduleById('sched-existing', 'min-1');
      expect(sched.duration_minutes).toBe(90);
      expect(sched.durationMinutes).toBe(90);
    });

    it('lida com escalas legadas sem duration_minutes preservando integridade (fallback não-mutante)', async () => {
      (repo as any).schedulesCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'sched-legacy',
            data: () => ({
              id: 'sched-legacy',
              ministry_id: 'min-1',
              title: 'Culto Antigo',
              // duration_minutes ausente
            }),
          }),
        }),
      };

      const sched = await repo.getScheduleById('sched-legacy', 'min-1');
      expect(sched.duration_minutes).toBeUndefined();
      expect(sched.durationMinutes).toBeUndefined();
    });

    it('atualiza duration_minutes corretamente no updateSchedule', async () => {
      let updatePayload: any = null;
      const mockDocRef = {
        id: 'sched-edit-1',
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'sched-edit-1',
          data: () => ({
            id: 'sched-edit-1',
            ministry_id: 'min-1',
            title: 'Culto',
            duration_minutes: 180,
          }),
        }),
        update: vi.fn().mockImplementation(async (payload) => {
          updatePayload = payload;
        }),
      };

      (repo as any).schedulesCol = {
        doc: vi.fn().mockReturnValue(mockDocRef),
      };

      const updated = await repo.updateSchedule('sched-edit-1', 'min-1', {
        durationMinutes: 180,
      });

      expect(updatePayload.duration_minutes).toBe(180);
      expect(updatePayload.durationMinutes).toBeUndefined();
      expect(updated.duration_minutes).toBe(180);
    });
  });

  describe('Participant Confirmation Security & Concurrency (H02 + M01)', () => {
    it('rejeita correspondência por substring de userId (p.id.includes(userId)) com 403', async () => {
      const { db } = await import('../lib/firebase');
      const scheduleStore = {
        id: 'sched-h02-1',
        ministry_id: 'min-1',
        date: '2099-12-20',
        participants: [{ id: 'u10', name: 'Outro Integrante', role: 'Baixo', confirmed: undefined }],
      };

      const docRef = {
        id: 'sched-h02-1',
        get: vi.fn().mockResolvedValue({ exists: true, id: 'sched-h02-1', data: () => ({ ...scheduleStore }) }),
        update: vi.fn().mockImplementation(async (patch: any) => Object.assign(scheduleStore, patch)),
      };
      (repo as any).schedulesCol = { doc: vi.fn().mockReturnValue(docRef) };

      const colSpy = vi.spyOn(db, 'collection').mockImplementation((name: string): any => {
        if (name === 'ministry_members') {
          return {
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [{ id: 'mem-u1', data: () => ({ user_id: 'u1', status: 'active' }) }],
            }),
          };
        }
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Alguem' }) }),
          }),
        };
      });

      const txSpy = vi.spyOn(db, 'runTransaction').mockImplementation(async (fn: any) => {
        const tx = {
          get: async (target: any) => target.get(),
          update: (ref: any, data: any) => ref.update(data),
        };
        return fn(tx);
      });

      try {
        await expect(
          repo.updateParticipantConfirmation('sched-h02-1', 'min-1', 'u1', 'Alguem', true)
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(scheduleStore.participants[0].confirmed).toBeUndefined();
      } finally {
        colSpy.mockRestore();
        txSpy.mockRestore();
      }
    });

    it('rejeita correspondência por nome parcial ou homônimo (matchName) com 403', async () => {
      const { db } = await import('../lib/firebase');
      const scheduleStore = {
        id: 'sched-h02-2',
        ministry_id: 'min-1',
        date: '2099-12-20',
        participants: [
          { id: 'mem-ana-clara', name: 'Ana Clara Silva', role: 'Voz', confirmed: undefined },
          { id: 'mem-joao-2', name: 'João Silva', role: 'Violão', confirmed: undefined },
        ],
      };

      const docRef = {
        id: 'sched-h02-2',
        get: vi.fn().mockResolvedValue({ exists: true, id: 'sched-h02-2', data: () => ({ ...scheduleStore }) }),
        update: vi.fn().mockImplementation(async (patch: any) => Object.assign(scheduleStore, patch)),
      };
      (repo as any).schedulesCol = { doc: vi.fn().mockReturnValue(docRef) };

      const colSpy = vi.spyOn(db, 'collection').mockImplementation((name: string): any => {
        if (name === 'ministry_members') {
          return {
            where: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [{ id: 'mem-attacker', data: () => ({ user_id: 'usr-attacker', status: 'active' }) }],
            }),
          };
        }
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'João Silva' }) }),
          }),
        };
      });

      const txSpy = vi.spyOn(db, 'runTransaction').mockImplementation(async (fn: any) => {
        const tx = {
          get: async (target: any) => target.get(),
          update: (ref: any, data: any) => ref.update(data),
        };
        return fn(tx);
      });

      try {
        await expect(
          repo.updateParticipantConfirmation('sched-h02-2', 'min-1', 'usr-attacker', 'Ana', true)
        ).rejects.toMatchObject({ statusCode: 403 });
        expect(scheduleStore.participants[0].confirmed).toBeUndefined();
        expect(scheduleStore.participants[1].confirmed).toBeUndefined();
      } finally {
        colSpy.mockRestore();
        txSpy.mockRestore();
      }
    });

    it('preserva confirmações simultâneas de participantes distintos sem lost update (M01)', async () => {
      const { db } = await import('../lib/firebase');
      let persistedParticipants = [
        { id: 'mem-1', user_id: 'u-1', name: 'Membro Um', role: 'Voz' },
        { id: 'mem-2', user_id: 'u-2', name: 'Membro Dois', role: 'Guitarra' },
      ];

      const docRef = {
        id: 'sched-m01',
        get: vi.fn().mockImplementation(async () => ({
          exists: true,
          id: 'sched-m01',
          data: () => ({
            id: 'sched-m01',
            ministry_id: 'min-1',
            date: '2099-12-20',
            participants: persistedParticipants.map((p) => ({ ...p })),
          }),
        })),
        update: vi.fn().mockImplementation(async (patch: any) => {
          persistedParticipants = patch.participants.map((p: any) => ({ ...p }));
        }),
      };
      (repo as any).schedulesCol = { doc: vi.fn().mockReturnValue(docRef) };

      let lastQueriedUser = '';
      const colSpy = vi.spyOn(db, 'collection').mockImplementation((name: string): any => {
        if (name === 'ministry_members') {
          const query: any = {
            where: vi.fn().mockImplementation((field: string, _op: string, val: string) => {
              if (field === 'user_id') lastQueriedUser = val;
              return query;
            }),
            limit: vi.fn().mockReturnThis(),
            get: vi.fn().mockImplementation(async () => {
              await new Promise((r) => setTimeout(r, 15));
              const memberDocId = lastQueriedUser === 'u-1' ? 'mem-1' : 'mem-2';
              return {
                empty: false,
                docs: [{ id: memberDocId, data: () => ({ user_id: lastQueriedUser, status: 'active' }) }],
              };
            }),
          };
          return query;
        }
        return {
          doc: vi.fn().mockImplementation((uid: string) => ({
            get: vi.fn().mockImplementation(async () => {
              await new Promise((r) => setTimeout(r, 15));
              return { exists: true, data: () => ({ name: uid === 'u-1' ? 'Membro Um' : 'Membro Dois' }) };
            }),
          })),
        };
      });

      let txQueue = Promise.resolve();
      const txSpy = vi.spyOn(db, 'runTransaction').mockImplementation((fn: any) => {
        const next = txQueue.then(() =>
          fn({
            get: async (target: any) => target.get(),
            update: (ref: any, data: any) => ref.update(data),
          })
        );
        txQueue = next.then(() => undefined, () => undefined);
        return next;
      });

      try {
        await Promise.all([
          repo.updateParticipantConfirmation('sched-m01', 'min-1', 'u-1', 'Membro Um', true),
          repo.updateParticipantConfirmation('sched-m01', 'min-1', 'u-2', 'Membro Dois', false),
        ]);

        const p1 = persistedParticipants.find((p) => p.id === 'mem-1') as any;
        const p2 = persistedParticipants.find((p) => p.id === 'mem-2') as any;
        expect(p1.confirmed).toBe(true);
        expect(p2.confirmed).toBe(false);
      } finally {
        colSpy.mockRestore();
        txSpy.mockRestore();
      }
    });
  });
});
