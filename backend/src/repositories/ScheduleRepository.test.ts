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
});
