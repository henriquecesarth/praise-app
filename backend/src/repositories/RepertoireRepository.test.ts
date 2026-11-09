import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RepertoireRepository, encodeSongCursor, decodeSongCursor } from './RepertoireRepository';
import { createSongSchema, updateSongSchema } from '../features/repertoire/repertoire.types';
import { AppError } from '../middleware/error-handler';
import { SubscriptionRepository } from './SubscriptionRepository';

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
        'artist_name',
        'classification_id',
        'classification',
        'original_key',
        'bpm',
        'duration',
        'youtube_url',
        'audio_url',
        'chord_sheet_url',
        'external_links',
        'versions',
        'notes',
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

  describe('Multi-Tenant Anti-IDOR: Foreign Artist & Classification Relations', () => {
    it('createSong deve REJEITAR artist_id pertencente a outro ministério com 404', async () => {
      (repo as any).artistsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-beta', name: 'Foreign Artist' }),
          }),
        }),
      };

      await expect(
        repo.createSong('min-alpha', 'user-1', {
          title: 'Nova Música',
          artist_id: 'artist-from-beta',
        })
      ).rejects.toThrow(AppError);
    });

    it('createSong deve REJEITAR classification_id pertencente a outro ministério com 404', async () => {
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-beta', name: 'Foreign Tag' }),
          }),
        }),
      };

      await expect(
        repo.createSong('min-alpha', 'user-1', {
          title: 'Nova Música',
          classification_id: 'tag-from-beta',
        })
      ).rejects.toThrow(AppError);
    });

    it('updateSong deve REJEITAR artist_id pertencente a outro ministério com 404', async () => {
      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'song-1',
            data: () => ({ ministry_id: 'min-alpha', title: 'Minha Música' }),
          }),
          update: vi.fn(),
        }),
      };

      (repo as any).artistsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-beta', name: 'Foreign Artist' }),
          }),
        }),
      };

      await expect(
        repo.updateSong('song-1', 'min-alpha', {
          artist_id: 'artist-from-beta',
        })
      ).rejects.toThrow(AppError);
    });

    it('updateSong deve REJEITAR classification_id pertencente a outro ministério com 404', async () => {
      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'song-1',
            data: () => ({ ministry_id: 'min-alpha', title: 'Minha Música' }),
          }),
          update: vi.fn(),
        }),
      };

      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ ministry_id: 'min-beta', name: 'Foreign Tag' }),
          }),
        }),
      };

      await expect(
        repo.updateSong('song-1', 'min-alpha', {
          classification_id: 'tag-from-beta',
        })
      ).rejects.toThrow(AppError);
    });

    it('updateSong deve REJEITAR classificationIds em versions pertencente a outro ministério com 404', async () => {
      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: 'song-1',
            data: () => ({ ministry_id: 'min-alpha', title: 'Minha Música' }),
          }),
          update: vi.fn(),
        }),
      };

      (repo as any).classificationsCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              ministry_id: id === 'tag-foreign' ? 'min-beta' : 'min-alpha',
              name: 'Tag',
            }),
          }),
        })),
      };

      await expect(
        repo.updateSong('song-1', 'min-alpha', {
          versions: [
            {
              id: 'ver-1',
              name: 'Original',
              key: 'G',
              classificationIds: ['tag-foreign'],
            },
          ],
        })
      ).rejects.toThrow(AppError);
    });
  });

  describe('Multi-Version Persistence Lifecycle (D2-B Delivery 3)', () => {
    it('executa ciclo completo: criar música multi-versão, buscar, editar 1 versão, clonar, excluir versão e reabrir preservando IDs e campos opcionais', async () => {
      const store = new Map<string, any>();

      (repo as any).songsCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockImplementation(async () => {
            const found = store.get(id);
            return {
              exists: Boolean(found),
              id,
              data: () => (found ? { ...found } : undefined),
            };
          }),
          update: vi.fn().mockImplementation(async (patch: any) => {
            const current = store.get(id);
            if (!current) throw new Error('Document not found');
            store.set(id, { ...current, ...patch });
          }),
        })),
      };

      (repo as any).classificationsCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({ ministry_id: 'min-alpha', name: id === 'cls-1' ? 'Adoração' : 'Celebração' }),
          }),
        })),
      };

      const createTransactionalSpy = vi
        .spyOn(SubscriptionRepository.prototype, 'createSongTransactional')
        .mockImplementation(async ({ ministryId, songData }) => {
          const created = {
            id: 'song-multi-1',
            ministry_id: ministryId,
            ...songData,
            created_at: '2026-11-09T12:00:00.000Z',
            updated_at: '2026-11-09T12:00:00.000Z',
          };
          store.set(created.id, created);
          return { song: created, usage: { currentSongs: 1 } as any };
        });

      try {
        // 1. Validar schema de criação com múltiplas versões, notas e links customizados
        const createPayload = createSongSchema.parse({
          title: 'Santo Pra Sempre',
          artist: 'Gabriel Guedes',
          artist_name: 'Gabriel Guedes',
          notes: 'Subir dinâmica no refrão final.',
          original_key: 'G',
          bpm: 72,
          duration: '05:40',
          classification_id: 'cls-1',
          youtube_url: 'https://youtube.com/watch?v=santo1',
          external_links: { letras: 'https://letras.mus.br/santo', Multitrack: 'https://loops.com/santo' },
          versions: [
            {
              id: 'ver-orig-1',
              name: 'Original (Estúdio)',
              key: 'G',
              bpm: 72,
              duration: '05:40',
              notes: 'Arranjo base com piano',
              classificationIds: ['cls-1'],
              links: [
                { label: 'Letra', url: 'https://letras.mus.br/santo' },
                { label: 'Cifra', url: '' },
                { label: 'Áudio', url: '' },
                { label: 'Vídeo', url: 'https://youtube.com/watch?v=santo1' },
                { label: 'Multitrack', url: 'https://loops.com/santo', isCustom: true },
              ],
            },
            {
              id: 'ver-acust-2',
              name: 'Acústica Jovens',
              key: 'E',
              bpm: 68,
              duration: '04:30',
              classificationIds: ['cls-2'],
              links: [
                { label: 'Letra', url: '' },
                { label: 'Cifra', url: 'https://cifraclub.com.br/santo-acustico' },
                { label: 'Áudio', url: '' },
                { label: 'Vídeo', url: '' },
              ],
            },
          ],
        });

        const created = await repo.createSong('min-alpha', 'user-leader-1', createPayload);
        expect(created.id).toBe('song-multi-1');
        expect(created.versions).toHaveLength(2);
        expect(created.versions[0].id).toBe('ver-orig-1');
        expect(created.versions[1].id).toBe('ver-acust-2');

        // 2. Buscar pela API/Repositório e verificar integridade
        const fetched1 = await repo.getSongById('song-multi-1', 'min-alpha');
        expect(fetched1.title).toBe('Santo Pra Sempre');
        expect(fetched1.notes).toBe('Subir dinâmica no refrão final.');
        expect(fetched1.versions).toHaveLength(2);

        // 3. Editar apenas a versão 2 e clonar a versão 1 em uma versão 3
        const clonedVersion = {
          ...fetched1.versions[0],
          id: 'ver-clone-3',
          name: 'Original (Estúdio) (Cópia)',
          key: 'F',
        };
        const editedVersion2 = {
          ...fetched1.versions[1],
          bpm: 70,
          notes: 'Violão com capotraste na 2ª casa',
        };

        const updatePayload1 = updateSongSchema.parse({
          versions: [fetched1.versions[0], editedVersion2, clonedVersion],
        });

        await repo.updateSong('song-multi-1', 'min-alpha', updatePayload1);

        const fetched2 = await repo.getSongById('song-multi-1', 'min-alpha');
        expect(fetched2.versions).toHaveLength(3);
        // Versão 1 intacta com mesmo ID
        expect(fetched2.versions[0].id).toBe('ver-orig-1');
        expect(fetched2.versions[0].key).toBe('G');
        expect(fetched2.versions[0].notes).toBe('Arranjo base com piano');
        // Versão 2 atualizada com mesmo ID
        expect(fetched2.versions[1].id).toBe('ver-acust-2');
        expect(fetched2.versions[1].bpm).toBe(70);
        expect(fetched2.versions[1].notes).toBe('Violão com capotraste na 2ª casa');
        // Versão 3 clonada com novo ID único
        expect(fetched2.versions[2].id).toBe('ver-clone-3');
        expect(fetched2.versions[2].name).toBe('Original (Estúdio) (Cópia)');
        expect(fetched2.versions[2].key).toBe('F');

        // 4. Excluir a versão 2 mantendo as versões 1 e 3 e a música intacta
        const updatePayload2 = updateSongSchema.parse({
          versions: [fetched2.versions[0], fetched2.versions[2]],
        });
        await repo.updateSong('song-multi-1', 'min-alpha', updatePayload2);

        // 5. Reabrir a música e confirmar estado persistido
        const reopened = await repo.getSongById('song-multi-1', 'min-alpha');
        expect(reopened.title).toBe('Santo Pra Sempre');
        expect(reopened.notes).toBe('Subir dinâmica no refrão final.');
        expect(reopened.versions).toHaveLength(2);
        expect(reopened.versions.map((v: any) => v.id)).toEqual(['ver-orig-1', 'ver-clone-3']);
        expect(reopened.versions[0].links).toHaveLength(5);
      } finally {
        createTransactionalSpy.mockRestore();
      }
    });
  });
});
