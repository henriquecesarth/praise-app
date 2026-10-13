import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiturgyRepository } from '../../repositories/LiturgyRepository';
import { LiturgyService } from './liturgy.service';
import { LiturgyController } from './liturgy.controller';
import { createLiturgySchema, updateLiturgySchema, liturgyItemSchema } from './liturgy.types';
import { AppError } from '../../middleware/error-handler';
import { db } from '../../lib/firebase';
import { requireMinistryRole } from '../../middleware/rbac';
import { MinistryRepository } from '../../repositories/MinistryRepository';

describe('Liturgy Feature & Security Test Suite (M13)', () => {
  let repo: LiturgyRepository;
  let service: LiturgyService;
  let controller: LiturgyController;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new LiturgyRepository();
    service = new LiturgyService(repo);
    controller = new LiturgyController(service);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Zod Schema Validation & ID Flexibility', () => {
    it('accepts Firestore document IDs (non-UUID 20-char strings) for songId and song_id', () => {
      const validItem1 = {
        title: 'Porque Ele Vive',
        type: 'song',
        songId: '5kL2qssw4PCi2irzC25X',
        position: 0,
      };
      const validItem2 = {
        title: 'Oração Inicial',
        type: 'prayer',
        song_id: null,
        notes: 'Momento de intercessão pastoral',
        position: 1,
      };

      const parsed1 = liturgyItemSchema.safeParse(validItem1);
      const parsed2 = liturgyItemSchema.safeParse(validItem2);

      expect(parsed1.success).toBe(true);
      expect(parsed2.success).toBe(true);
    });

    it('rejects liturgy with empty title or invalid bounds', () => {
      const invalid = {
        title: ' ',
        date: '2026-10-05',
      };
      const result = createLiturgySchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('accepts valid liturgy input with items', () => {
      const valid = {
        title: 'Culto da Família',
        date: '2026-10-05T19:00:00.000Z',
        description: 'Culto de celebração',
        items: [
          {
            title: 'Abertura',
            type: 'custom',
            notes: 'Avisos da liderança',
            position: 0,
          },
        ],
      };
      const result = createLiturgySchema.safeParse(valid);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.title).toBe('Culto da Família');
      }
    });
  });

  describe('2. Multi-Tenant List Isolation & Song Data Enrichment', () => {
    it('enriches only songs belonging to the target ministry', async () => {
      const mockLiturgiesDocs = [
        {
          id: 'lit-1',
          data: () => ({
            id: 'lit-1',
            group_id: 'min-alpha',
            ministry_id: 'min-alpha',
            title: 'Culto de Domingo',
            date: '2026-10-05',
          }),
        },
      ];

      const mockItemsDocs = [
        {
          id: 'item-1',
          data: () => ({
            id: 'item-1',
            liturgy_id: 'lit-1',
            song_id: 'song-alpha-1',
            type: 'song',
            title: 'Música Alpha',
          }),
        },
        {
          id: 'item-2',
          data: () => ({
            id: 'item-2',
            liturgy_id: 'lit-1',
            song_id: 'song-beta-foreign',
            type: 'song',
            title: 'Música Forasteira',
          }),
        },
      ];

      (repo as any).liturgiesCol = {
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: mockLiturgiesDocs }),
        }),
      };

      (repo as any).itemsCol = {
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: mockItemsDocs }),
        }),
      };

      (repo as any).songsCol = {
        doc: (id: string) => ({
          get: vi.fn().mockImplementation(async () => {
            if (id === 'song-alpha-1') {
              return {
                exists: true,
                id: 'song-alpha-1',
                data: () => ({ id: 'song-alpha-1', ministry_id: 'min-alpha', title: 'Música Alpha' }),
              };
            }
            if (id === 'song-beta-foreign') {
              return {
                exists: true,
                id: 'song-beta-foreign',
                data: () => ({ id: 'song-beta-foreign', ministry_id: 'min-beta', title: 'Música Beta' }),
              };
            }
            return { exists: false };
          }),
        }),
      };

      const list = await repo.getLiturgiesByGroup('min-alpha');
      expect(list).toHaveLength(1);
      const items = list[0].liturgy_items;
      expect(items).toHaveLength(2);
      // Item 1 song is enriched because it matches min-alpha
      expect(items[0].song).toBeDefined();
      expect(items[0].song.id).toBe('song-alpha-1');
      // Item 2 song is NOT enriched because ministry_id is min-beta
      expect(items[1].song).toBeUndefined();
    });
  });

  describe('3. Anti-IDOR & Fail-Closed Tenant Security', () => {
    it('throws 404 when liturgy does not exist', async () => {
      (repo as any).liturgiesCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({ exists: false }),
        }),
      };

      await expect(repo.getLiturgyById('non-existent', 'min-alpha')).rejects.toThrow(
        new AppError(404, 'Liturgia não encontrada.')
      );
    });

    it('throws 404 fail-closed when liturgy belongs to a different ministry', async () => {
      (repo as any).liturgiesCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'lit-beta',
            data: () => ({ id: 'lit-beta', group_id: 'min-beta', ministry_id: 'min-beta' }),
          }),
        }),
      };

      // Request from min-alpha must fail with 404 (anti-IDOR)
      await expect(repo.getLiturgyById('lit-beta', 'min-alpha')).rejects.toThrow(
        new AppError(404, 'Liturgia não encontrada.')
      );
    });

    it('throws 404 fail-closed when Alpha attempts to update Beta liturgy', async () => {
      (repo as any).liturgiesCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'lit-beta',
            data: () => ({ id: 'lit-beta', group_id: 'min-beta', ministry_id: 'min-beta' }),
          }),
        }),
      };

      await expect(
        repo.updateLiturgy('lit-beta', 'min-alpha', { title: 'Novo Título' })
      ).rejects.toThrow(new AppError(404, 'Liturgia não encontrada.'));
    });

    it('throws 404 fail-closed when Alpha attempts to delete Beta liturgy', async () => {
      (repo as any).liturgiesCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'lit-beta',
            data: () => ({ id: 'lit-beta', group_id: 'min-beta', ministry_id: 'min-beta' }),
          }),
        }),
      };

      await expect(repo.deleteLiturgy('lit-beta', 'min-alpha')).rejects.toThrow(
        new AppError(404, 'Liturgia não encontrada.')
      );
    });

    it('detail (getLiturgyById) does not enrich items with foreign songs', async () => {
      (repo as any).liturgiesCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'lit-alpha',
            data: () => ({ id: 'lit-alpha', group_id: 'min-alpha', ministry_id: 'min-alpha', title: 'Culto Alpha' }),
          }),
        }),
      };

      (repo as any).itemsCol = {
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            docs: [
              {
                id: 'item-foreign',
                data: () => ({
                  id: 'item-foreign',
                  liturgy_id: 'lit-alpha',
                  song_id: 'song-beta',
                  type: 'song',
                  title: 'Música Estranha',
                }),
              },
            ],
          }),
        }),
      };

      (repo as any).songsCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'song-beta',
            data: () => ({ id: 'song-beta', ministry_id: 'min-beta', title: 'Música Beta' }),
          }),
        }),
      };

      const result = await repo.getLiturgyById('lit-alpha', 'min-alpha');
      expect(result.id).toBe('lit-alpha');
      expect(result.liturgy_items[0].song).toBeUndefined();
    });
  });

  describe('4. Cross-Tenant Song Reference Validation', () => {
    it('rejects liturgy creation if referenced song belongs to a different ministry', async () => {
      (repo as any).songsCol = {
        doc: (id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({ id, ministry_id: 'min-beta', title: 'Foreign Song' }),
          }),
        }),
      };

      await expect(
        repo.createLiturgy('min-alpha', 'user-1', {
          title: 'Culto',
          date: '2026-10-05',
          items: [{ title: 'Música', songId: 'song-foreign' }],
        })
      ).rejects.toThrow(new AppError(400, 'Uma ou mais músicas selecionadas não pertencem a este ministério.'));
    });

    it('rejects liturgy creation if referenced song does not exist', async () => {
      (repo as any).songsCol = {
        doc: (id: string) => ({
          get: vi.fn().mockResolvedValue({ exists: false }),
        }),
      };

      await expect(
        repo.createLiturgy('min-alpha', 'user-1', {
          title: 'Culto',
          date: '2026-10-05',
          items: [{ title: 'Música', songId: 'missing-song' }],
        })
      ).rejects.toThrow(new AppError(404, "Música referenciada 'missing-song' não encontrada."));
    });

    it('rejects liturgy update if updated items reference song from another ministry', async () => {
      (repo as any).liturgiesCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'lit-1',
            data: () => ({ id: 'lit-1', group_id: 'min-alpha', ministry_id: 'min-alpha' }),
          }),
        }),
      };
      (repo as any).itemsCol = {
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: [] }),
        }),
      };
      (repo as any).songsCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-other' }),
          }),
        }),
      };

      await expect(
        repo.updateLiturgy('lit-1', 'min-alpha', {
          items: [{ title: 'Música', songId: 'song-other' }],
        })
      ).rejects.toThrow(new AppError(400, 'Uma ou mais músicas selecionadas não pertencem a este ministério.'));
    });
  });

  describe('5. Write Atomicity Audit (Batch Writes)', () => {
    it('commits createLiturgy in a single atomic batch', async () => {
      const mockBatch = {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      (repo as any).songsCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-alpha' }),
          }),
        }),
      };
      (repo as any).liturgiesCol = {
        doc: () => ({ id: 'mock-liturgies-id' }),
      };
      (repo as any).itemsCol = {
        doc: () => ({ id: 'mock-items-id' }),
      };

      const result = await repo.createLiturgy('min-alpha', 'user-1', {
        title: 'Culto com Batismo',
        date: '2026-10-05',
        description: 'Liturgia completa',
        items: [
          { title: 'Louvor 1', type: 'song', songId: 'song-1', position: 0 },
          { title: 'Mensagem', type: 'reading', position: 1 },
        ],
      });

      expect(mockBatch.set).toHaveBeenCalledTimes(3); // 1 liturgy + 2 items
      expect(mockBatch.commit).toHaveBeenCalledTimes(1); // single atomic commit
      expect(result.group_id).toBe('min-alpha');
      expect(result.ministry_id).toBe('min-alpha');
      expect(result.liturgy_items).toHaveLength(2);
    });

    it('commits deleteLiturgy in a single atomic batch', async () => {
      const mockBatch = {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      const mockOldItemDocs = [
        { id: 'old-item-1', ref: { id: 'old-item-1' }, data: () => ({ id: 'old-item-1' }) },
        { id: 'old-item-2', ref: { id: 'old-item-2' }, data: () => ({ id: 'old-item-2' }) },
      ];

      (repo as any).liturgiesCol = {
        doc: (id: string) => ({
          id,
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'lit-1',
            data: () => ({ id: 'lit-1', group_id: 'min-alpha', ministry_id: 'min-alpha' }),
          }),
        }),
      };
      (repo as any).itemsCol = {
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: mockOldItemDocs }),
        }),
      };

      await repo.deleteLiturgy('lit-1', 'min-alpha');

      expect(mockBatch.delete).toHaveBeenCalledTimes(3); // 2 items + 1 liturgy
      expect(mockBatch.commit).toHaveBeenCalledTimes(1); // atomic commit
    });

    it('commits updateLiturgy in a single atomic batch', async () => {
      const mockBatch = {
        set: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      vi.spyOn(db, 'batch').mockReturnValue(mockBatch as any);

      (repo as any).liturgiesCol = {
        doc: (id: string) => ({
          id,
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'lit-1',
            data: () => ({ id: 'lit-1', group_id: 'min-alpha', ministry_id: 'min-alpha', title: 'Old Title' }),
          }),
        }),
      };

      const mockOldItems = [
        { id: 'old-1', ref: { id: 'old-1' }, data: () => ({ id: 'old-1' }) },
        { id: 'old-2', ref: { id: 'old-2' }, data: () => ({ id: 'old-2' }) },
      ];
      (repo as any).itemsCol = {
        doc: () => ({ id: 'new-item-id' }),
        where: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ docs: mockOldItems }),
        }),
      };

      (repo as any).songsCol = {
        doc: () => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-alpha' }),
          }),
        }),
      };

      await repo.updateLiturgy('lit-1', 'min-alpha', {
        title: 'Updated Title',
        items: [
          { title: 'New Item 1', type: 'song', songId: 'song-1', position: 0 },
        ],
      });

      expect(mockBatch.update).toHaveBeenCalledTimes(1); // liturgy title update
      expect(mockBatch.delete).toHaveBeenCalledTimes(2); // 2 old items deleted
      expect(mockBatch.set).toHaveBeenCalledTimes(1); // 1 new item inserted
      expect(mockBatch.commit).toHaveBeenCalledTimes(1); // single atomic commit
    });
  });

  describe('6. RBAC & Active Membership Authorization for Liturgies', () => {
    it('allows member role for read routes (GET)', async () => {
      const mockReq: any = {
        user: { id: 'usr-member' },
        params: { ministryId: 'min-alpha' },
      };
      const mockRes: any = {};
      const mockNext = vi.fn();

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: 'min-alpha',
        name: 'Alpha Ministry',
        role: 'member',
      } as any);

      const middleware = requireMinistryRole('member');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('denies member role for admin write routes (POST/PUT/DELETE) with 403', async () => {
      const mockReq: any = {
        user: { id: 'usr-member' },
        params: { ministryId: 'min-alpha' },
      };
      const mockRes: any = {};
      const mockNext = vi.fn();

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: 'min-alpha',
        name: 'Alpha Ministry',
        role: 'member',
      } as any);

      const middleware = requireMinistryRole('admin');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
      expect(err.message).toMatch(/Ação restrita a administradores/i);
    });

    it('allows admin role for admin write routes (POST/PUT/DELETE)', async () => {
      const mockReq: any = {
        user: { id: 'usr-admin' },
        params: { ministryId: 'min-alpha' },
      };
      const mockRes: any = {};
      const mockNext = vi.fn();

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockResolvedValue({
        id: 'min-alpha',
        name: 'Alpha Ministry',
        role: 'admin',
      } as any);

      const middleware = requireMinistryRole('admin');
      await middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith();
    });

    it('denies removed member with 403 MINISTRY_ACCESS_DENIED across all liturgy routes', async () => {
      const mockReq: any = {
        user: { id: 'usr-removed' },
        params: { ministryId: 'min-alpha' },
      };
      const mockRes: any = {};
      const mockNext = vi.fn();

      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockRejectedValue(
        new AppError(403, 'Acesso negado. Você não é integrante deste ministério.', {
          code: 'MINISTRY_ACCESS_DENIED',
          ministryId: 'min-alpha',
        })
      );

      const readMiddleware = requireMinistryRole('member');
      await readMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const readErr = mockNext.mock.calls[0][0];
      expect(readErr.statusCode).toBe(403);
      expect(readErr.details.code).toBe('MINISTRY_ACCESS_DENIED');

      mockNext.mockClear();

      const writeMiddleware = requireMinistryRole('admin');
      await writeMiddleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(AppError));
      const writeErr = mockNext.mock.calls[0][0];
      expect(writeErr.statusCode).toBe(403);
      expect(writeErr.details.code).toBe('MINISTRY_ACCESS_DENIED');
    });
  });
});

