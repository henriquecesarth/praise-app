import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepertoireRepository, encodeSongCursor, decodeSongCursor } from './RepertoireRepository';
import { AppError } from '../middleware/error-handler';

describe('RepertoireRepository Hardened Cursor Pagination & Performance', () => {
  let repo: RepertoireRepository;

  beforeEach(() => {
    repo = new RepertoireRepository();
  });

  describe('Cursor Security, Serialization & Tenant Defense', () => {
    it('deve serializar e desserializar cursor com timestamp ISO e ID único', () => {
      const token = encodeSongCursor({
        id: 'song-123',
        u: '2026-08-29T12:00:00.000Z',
        m: 'min-alpha',
      });

      const decoded = decodeSongCursor(token, 'min-alpha');
      expect(decoded.id).toBe('song-123');
      expect(decoded.u).toBe('2026-08-29T12:00:00.000Z');
      expect(decoded.m).toBe('min-alpha');
    });

    it('deve REJEITAR cursor com tenant diferente (Cross-Tenant Tampering Check)', () => {
      const foreignToken = encodeSongCursor({
        id: 'song-secret',
        u: '2026-08-29T12:00:00.000Z',
        m: 'min-bravo', // Pertence a outro ministério
      });

      expect(() => decodeSongCursor(foreignToken, 'min-alpha')).toThrow(AppError);
    });

    it('deve rejeitar token de cursor corrompido, truncado ou inválido', () => {
      expect(() => decodeSongCursor('invalid-base64-payload', 'min-alpha')).toThrow(AppError);
      expect(() => decodeSongCursor(Buffer.from('{}').toString('base64url'), 'min-alpha')).toThrow(AppError);
    });

    it('deve garantir que o tenant scope da query Firestore é SEMPRE derivado do contexto autorizado', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }),
        }),
        limit: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: [] }),
        }),
      };

      const mockCol = {
        where: vi.fn().mockReturnValue(mockQuery),
      };

      (repo as any).songsCol = mockCol;

      await repo.getSongs('authorized-min-999', { limit: 20 });

      // O filtro de tenant no Firestore é SEMPRE o ministério autorizado
      expect(mockCol.where).toHaveBeenCalledWith('ministry_id', '==', 'authorized-min-999');
    });
  });

  describe('getCounts - Firestore Aggregation Derivation', () => {
    it('deve utilizar agregação count().get() e retornar contagens exatas', async () => {
      const mockCountGet = vi.fn().mockResolvedValue({
        data: () => ({ count: 1500 }),
      });

      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnValue({ get: mockCountGet }),
      };

      (repo as any).songsCol = mockQuery;
      (repo as any).foldersCol = mockQuery;
      (repo as any).artistsCol = mockQuery;
      (repo as any).classificationsCol = mockQuery;

      const counts = await repo.getCounts('min-alpha');

      expect(counts).toEqual({
        songs: 1500,
        folders: 1500,
        artists: 1500,
        classifications: 1500,
      });
      expect(mockCountGet).toHaveBeenCalledTimes(4);
    });
  });

  describe('getSongs - Cursor Pagination, Select Projection & Document Fetch Accounting', () => {
    it('deve utilizar query.select() no Firestore e buscar limit + 1 documentos para detectar hasMore', async () => {
      const mockDocs = [
        {
          id: 'song-1',
          title: 'Grande é o Senhor',
          updated_at: '2026-08-29T10:00:00Z',
          ministry_id: 'min-alpha',
        },
        {
          id: 'song-2',
          title: 'Em Teus Braços',
          updated_at: '2026-08-29T09:00:00Z',
          ministry_id: 'min-alpha',
        },
        {
          id: 'song-3',
          title: 'A Casa é Sua',
          updated_at: '2026-08-29T08:00:00Z',
          ministry_id: 'min-alpha',
        },
      ];

      const mockLimit = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: mockDocs.map((s) => ({ id: s.id, data: () => s })),
        }),
      });

      const mockOrderByDocId = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockOrderByUpdated = vi.fn().mockReturnValue({ orderBy: mockOrderByDocId });
      const mockSelect = vi.fn().mockReturnValue({ orderBy: mockOrderByUpdated });

      const mockBaseQuery = {
        where: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ data: () => ({ count: 100 }) }),
        }),
        select: mockSelect,
      };

      (repo as any).songsCol = mockBaseQuery;

      const result = await repo.getSongs('min-alpha', {
        limit: 2,
      });

      // Validar que .select() foi aplicado com campos do SongSummary
      expect(mockSelect).toHaveBeenCalledWith(
        'ministry_id',
        'user_id',
        'title',
        'artist_id',
        'artist',
        'classification_id',
        'classification',
        'original_key',
        'bpm',
        'duration',
        'youtube_url',
        'audio_url',
        'created_at',
        'updated_at'
      );

      // Page size pedido = 2, mas buscou 3 (limit+1) para determinar hasMore
      expect(mockLimit).toHaveBeenCalledWith(3);
      expect(result.total).toBe(100);
      expect(result.data.length).toBe(2);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBeDefined();

      // Projeção SongSummary
      expect(result.data[0].title).toBe('Grande é o Senhor');
      expect(result.data[1].id).toBe('song-2');

      const decodedNext = decodeSongCursor(result.nextCursor!, 'min-alpha');
      expect(decodedNext.id).toBe('song-2');
      expect(decodedNext.u).toBe('2026-08-29T09:00:00Z');
    });

    it('deve aplicar startAfter quando cursor for informado', async () => {
      const cursor = encodeSongCursor({
        id: 'song-2',
        u: '2026-08-29T09:00:00Z',
        m: 'min-alpha',
      });

      const mockDocsPage2 = [
        {
          id: 'song-3',
          title: 'A Casa é Sua',
          updated_at: '2026-08-29T08:00:00Z',
          ministry_id: 'min-alpha',
        },
      ];

      const mockLimit = vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          docs: mockDocsPage2.map((s) => ({ id: s.id, data: () => s })),
        }),
      });

      const mockStartAfter = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockOrderByDocId = vi.fn().mockReturnValue({ startAfter: mockStartAfter });
      const mockOrderByUpdated = vi.fn().mockReturnValue({ orderBy: mockOrderByDocId });
      const mockSelect = vi.fn().mockReturnValue({ orderBy: mockOrderByUpdated });

      const mockBaseQuery = {
        where: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ data: () => ({ count: 3 }) }),
        }),
        select: mockSelect,
      };

      (repo as any).songsCol = mockBaseQuery;

      const result = await repo.getSongs('min-alpha', {
        cursor,
        limit: 2,
      });

      expect(mockStartAfter).toHaveBeenCalledWith('2026-08-29T09:00:00Z', 'song-2');
      expect(result.data.length).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('NÃO deve fazer full collection scan em produção caso ocorra erro na query indexada', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const mockLimit = vi.fn().mockReturnValue({
        get: vi.fn().mockRejectedValue(new Error('The query requires an index: FAILED_PRECONDITION')),
      });
      const mockOrderByDocId = vi.fn().mockReturnValue({ limit: mockLimit });
      const mockOrderByUpdated = vi.fn().mockReturnValue({ orderBy: mockOrderByDocId });
      const mockSelect = vi.fn().mockReturnValue({ orderBy: mockOrderByUpdated });

      const mockBaseQuery = {
        where: vi.fn().mockReturnThis(),
        count: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ data: () => ({ count: 50 }) }),
        }),
        select: mockSelect,
      };

      (repo as any).songsCol = mockBaseQuery;

      try {
        await expect(
          repo.getSongs('min-alpha', { limit: 20 })
        ).rejects.toThrow(/Erro ao consultar repertório/i);
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });
  });
});
