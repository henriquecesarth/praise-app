import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartChordRepository } from '../../repositories/SmartChordRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { RepertoireRepository } from '../../repositories/RepertoireRepository';
import { SmartChordService } from './smart_chord.service';
import { SmartChordController } from './smart_chord.controller';
import smartChordRouter from './smart_chord.routes';
import { AppError } from '../../middleware/error-handler';

describe('Smart Chords Feature Test Suite', () => {
  let smartChordRepo: SmartChordRepository;
  let ministryRepo: MinistryRepository;
  let repertoireRepo: RepertoireRepository;
  let service: SmartChordService;
  let controller: SmartChordController;

  beforeEach(() => {
    vi.clearAllMocks();
    smartChordRepo = new SmartChordRepository();
    ministryRepo = new MinistryRepository();
    repertoireRepo = new RepertoireRepository();
    service = new SmartChordService(smartChordRepo, ministryRepo, repertoireRepo);
    controller = new SmartChordController();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. List isolation (User A vs User B)', () => {
    it('retorna apenas cifras pertencentes ao usuário autenticado', async () => {
      const mockChordsUserA = [
        { id: 'sc-1', user_id: 'user-a', title: 'Graça Maior', original_key: 'G', content: '[G]Graça' },
        { id: 'sc-2', user_id: 'user-a', title: 'Bondade', original_key: 'D', content: '[D]Bondade' },
      ];

      vi.spyOn(smartChordRepo, 'getSmartChords').mockImplementation(async (userId: string) => {
        if (userId === 'user-a') return mockChordsUserA as any;
        return [];
      });

      const resultUserA = await service.getSmartChords('user-a', {});
      expect(resultUserA.data).toHaveLength(2);
      expect(resultUserA.data.map(c => c.id)).toEqual(['sc-1', 'sc-2']);
      expect(resultUserA.data.every(c => c.user_id === 'user-a')).toBe(true);

      const resultUserB = await service.getSmartChords('user-b', {});
      expect(resultUserB.data).toHaveLength(0);
    });

    it('aplica filtro de busca por título no repositório isolado pelo usuário', async () => {
      const getSpy = vi.spyOn(smartChordRepo, 'getSmartChords').mockResolvedValue([
        { id: 'sc-1', user_id: 'user-a', title: 'Graça Maior', original_key: 'G', content: '[G]Graça' } as any
      ]);

      const result = await service.getSmartChords('user-a', { search: 'Graça' });
      expect(getSpy).toHaveBeenCalledWith('user-a', 'Graça');
      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe('2. Read IDOR protection (404 rejection on foreign chord)', () => {
    it('retorna 404 ao tentar buscar uma cifra cujo user_id pertence a outro usuário', async () => {
      vi.spyOn((smartChordRepo as any).smartChordsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'chord-victim',
          data: () => ({ user_id: 'usr-victim', title: 'Cifra Privada', original_key: 'C', content: '[C]' }),
        }),
      });

      await expect(smartChordRepo.getSmartChordById('chord-victim', 'usr-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404, message: 'Cifra inteligente não encontrada.' })
      );
    });

    it('retorna 404 quando o documento de cifra não existe no Firestore', async () => {
      vi.spyOn((smartChordRepo as any).smartChordsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: false,
          data: () => undefined,
        }),
      });

      await expect(smartChordRepo.getSmartChordById('chord-inexistente', 'usr-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });

    it('retorna a cifra com sucesso quando o user_id confere', async () => {
      vi.spyOn((smartChordRepo as any).smartChordsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'chord-owner',
          data: () => ({ user_id: 'usr-owner', title: 'Minha Cifra', original_key: 'A', content: '[A]' }),
        }),
      });

      const chord = await smartChordRepo.getSmartChordById('chord-owner', 'usr-owner');
      expect(chord).toBeDefined();
      expect(chord.id).toBe('chord-owner');
      expect(chord.title).toBe('Minha Cifra');
    });
  });

  describe('3. Update IDOR protection (404 and no mutation on foreign chord)', () => {
    it('rejeita com 404 e NÃO chama update ao tentar modificar cifra de outro usuário', async () => {
      const updateFn = vi.fn();
      vi.spyOn((smartChordRepo as any).smartChordsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'chord-victim',
          data: () => ({ user_id: 'usr-victim', title: 'Original' }),
        }),
        update: updateFn,
      });

      await expect(smartChordRepo.updateSmartChord('chord-victim', 'usr-attacker', { title: 'Modificado' })).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
      expect(updateFn).not.toHaveBeenCalled();
    });
  });

  describe('4. Delete IDOR protection (404 and no mutation on foreign chord)', () => {
    it('rejeita com 404 e NÃO chama delete ao tentar excluir cifra de outro usuário', async () => {
      const deleteFn = vi.fn();
      vi.spyOn((smartChordRepo as any).smartChordsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'chord-victim',
          data: () => ({ user_id: 'usr-victim', title: 'Original' }),
        }),
        delete: deleteFn,
      });

      await expect(smartChordRepo.deleteSmartChord('chord-victim', 'usr-attacker')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
      expect(deleteFn).not.toHaveBeenCalled();
    });
  });

  describe('5. Song lookup isolation and Model N', () => {
    it('retorna apenas as cifras do usuário para a música solicitada (isola User A de User B)', async () => {
      const chordA1 = { id: 'sc-a1', user_id: 'user-a', song_id: 'song-100', title: 'Versão Violão' };
      const chordA2 = { id: 'sc-a2', user_id: 'user-a', song_id: 'song-100', title: 'Versão Piano' };

      const getChordsSpy = vi.spyOn(smartChordRepo, 'getSmartChordsBySongId').mockImplementation(
        async (songId: string, userId: string) => {
          if (songId === 'song-100' && userId === 'user-a') {
            return [chordA1, chordA2] as any;
          }
          return [];
        }
      );

      const chordsUserA = await service.getSmartChordsBySong('song-100', 'user-a');
      expect(getChordsSpy).toHaveBeenCalledWith('song-100', 'user-a');
      expect(chordsUserA).toHaveLength(2);
      expect(chordsUserA.map(c => c.id)).toEqual(['sc-a1', 'sc-a2']);

      const chordsUserB = await service.getSmartChordsBySong('song-100', 'user-b');
      expect(chordsUserB).toHaveLength(0);
    });

    it('SmartChordRepository.getSmartChordsBySongId filtra simultaneamente por user_id e song_id', async () => {
      const mockDocs = [
        { id: 'sc-1', data: () => ({ user_id: 'user-a', song_id: 'song-1', title: 'Cifra 1' }) },
        { id: 'sc-2', data: () => ({ user_id: 'user-a', song_id: 'song-2', title: 'Cifra 2' }) },
        { id: 'sc-3', data: () => ({ user_id: 'user-b', song_id: 'song-1', title: 'Cifra 3' }) },
      ];

      let currentDocs = [...mockDocs];
      const createChainableQuery = (): any => ({
        where: vi.fn((...args: any[]) => {
          const [field, , val] = args;
          if (field === 'user_id') currentDocs = currentDocs.filter(d => d.data().user_id === val);
          if (field === 'song_id') currentDocs = currentDocs.filter(d => d.data().song_id === val);
          return createChainableQuery();
        }),
        get: vi.fn(async () => ({
          docs: currentDocs,
        })),
      });

      vi.spyOn((smartChordRepo as any).smartChordsCol, 'where').mockImplementation((...args: any[]) => {
        const [field, , val] = args;
        if (field === 'user_id') currentDocs = currentDocs.filter(d => d.data().user_id === val);
        if (field === 'song_id') currentDocs = currentDocs.filter(d => d.data().song_id === val);
        return createChainableQuery();
      });

      const results = await smartChordRepo.getSmartChordsBySongId('song-1', 'user-a');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('sc-1');
      expect(results[0].song_id).toBe('song-1');
      expect(results[0].user_id).toBe('user-a');
    });
  });

  describe('6. Cross-domain tenant isolation (Song & Artist access validation)', () => {
    it('lança 404 se a música vinculada não for encontrada', async () => {
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue(null);

      await expect(
        service.createSmartChord('user-a', {
          title: 'Cifra',
          original_key: 'C',
          content: '[C]',
          song_id: 'song-inexistente',
        })
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404, message: 'Música vinculada não encontrada.' }));
    });

    it('lança 403 se a música pertence a um ministério que o usuário não pode acessar', async () => {
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-locked',
        ministry_id: 'min-other',
        title: 'Música Inacessível',
      } as any);

      vi.spyOn(ministryRepo, 'getMinistryById').mockRejectedValue(
        new AppError(403, 'Acesso negado. Você não é integrante deste ministério.')
      );

      await expect(
        service.createSmartChord('user-attacker', {
          title: 'Cifra',
          original_key: 'C',
          content: '[C]',
          song_id: 'song-locked',
        })
      ).rejects.toThrow(expect.objectContaining({ statusCode: 403 }));
    });

    it('permite criar cifra quando o usuário é integrante do ministério da música', async () => {
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-valid',
        ministry_id: 'min-allowed',
        title: 'Música Permitida',
      } as any);

      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({
        id: 'min-allowed',
        name: 'Ministério Louvor',
      } as any);

      const createRepoSpy = vi.spyOn(smartChordRepo, 'createSmartChord').mockResolvedValue({
        id: 'new-chord-id',
        user_id: 'user-member',
        title: 'Cifra Permitida',
        song_id: 'song-valid',
        original_key: 'C',
        content: '[C]',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any);

      const created = await service.createSmartChord('user-member', {
        title: 'Cifra Permitida',
        original_key: 'C',
        content: '[C]',
        song_id: 'song-valid',
      });

      expect(createRepoSpy).toHaveBeenCalled();
      expect(created.id).toBe('new-chord-id');
    });

    it('lança 404 se o artista vinculado não for encontrado', async () => {
      vi.spyOn(repertoireRepo, 'findArtistById').mockResolvedValue(null);

      await expect(
        service.createSmartChord('user-a', {
          title: 'Cifra',
          original_key: 'C',
          content: '[C]',
          artist_id: 'artist-inexistente',
        })
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404, message: 'Artista vinculado não encontrado.' }));
    });

    it('valida acesso à música na atualização (updateSmartChord)', async () => {
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-alien',
        ministry_id: 'min-alien',
        title: 'Música de Outro',
      } as any);

      vi.spyOn(ministryRepo, 'getMinistryById').mockRejectedValue(
        new AppError(403, 'Acesso negado. Você não é integrante deste ministério.')
      );

      await expect(
        service.updateSmartChord('chord-1', 'user-a', { song_id: 'song-alien' })
      ).rejects.toThrow(expect.objectContaining({ statusCode: 403 }));
    });
  });

  describe('7. Legacy document handling (missing optional fields)', () => {
    it('lida com documentos Firestore legados sem artist_id, song_id ou timestamps', async () => {
      vi.spyOn((smartChordRepo as any).smartChordsCol, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'chord-legacy',
          data: () => ({
            user_id: 'usr-legacy',
            title: 'Cifra Legada',
            original_key: 'E',
            content: '[E]Graça antiga',
          }),
        }),
      });

      const chord = await smartChordRepo.getSmartChordById('chord-legacy', 'usr-legacy');
      expect(chord).toBeDefined();
      expect(chord.id).toBe('chord-legacy');
      expect(chord.artist_id).toBeNull();
      expect(chord.song_id).toBeNull();
      expect(chord.artist).toBeNull();
      expect(chord.song).toBeNull();
      expect(chord.created_at).toBeDefined();
      expect(chord.updated_at).toBeDefined();
    });
  });

  describe('8. Route precedence & registration order', () => {
    it('garante que /song/:songId é registrado ANTES de /:id no router', () => {
      const routes = smartChordRouter.stack
        .filter((layer: any) => layer.route)
        .map((layer: any) => ({
          path: layer.route.path,
          method: Object.keys(layer.route.methods)[0].toUpperCase(),
        }));

      const songRouteIndex = routes.findIndex(r => r.path === '/song/:songId' && r.method === 'GET');
      const idRouteIndex = routes.findIndex(r => r.path === '/:id' && r.method === 'GET');

      expect(songRouteIndex).toBeGreaterThanOrEqual(0);
      expect(idRouteIndex).toBeGreaterThanOrEqual(0);
      expect(songRouteIndex).toBeLessThan(idRouteIndex);
    });
  });

  describe('9. SmartChordController actions and responses', () => {
    let mockReq: any;
    let mockRes: any;
    let mockNext: any;

    beforeEach(() => {
      mockReq = {
        user: { id: 'usr-controller' },
        params: {},
        query: {},
        body: {},
      };
      mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
      };
      mockNext = vi.fn();
    });

    it('getSmartChordsBySong retorna envelope { data: SmartChord[] } com status 200', async () => {
      mockReq.params.songId = 'song-abc';
      const mockList = [
        { id: 'sc-1', user_id: 'usr-controller', song_id: 'song-abc', title: 'Cifra 1' }
      ];

      vi.spyOn(SmartChordService.prototype, 'getSmartChordsBySong').mockResolvedValue(mockList as any);

      await controller.getSmartChordsBySong(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ data: mockList });
    });

    it('rejeita com 401 se req.user estiver ausente', async () => {
      mockReq.user = undefined;

      await controller.listSmartChords(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, message: 'Usuário não autenticado.' })
      );
    });
  });
});
