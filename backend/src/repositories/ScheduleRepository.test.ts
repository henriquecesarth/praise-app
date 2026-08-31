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
});
