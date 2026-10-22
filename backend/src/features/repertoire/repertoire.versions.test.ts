import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createSongSchema, updateSongSchema } from './repertoire.types';
import { RepertoireRepository, normalizeSongVersions } from '../../repositories/RepertoireRepository';
import { AppError } from '../../middleware/error-handler';

describe('Repertoire Song Versions Persistence & Schema Hardening', () => {
  let repo: RepertoireRepository;

  beforeEach(() => {
    repo = new RepertoireRepository();
    vi.restoreAllMocks();
  });

  describe('Zod Validation: createSongSchema, updateSongSchema & Security Hardening', () => {
    it('deve aceitar payload com múltiplas versões, notas e links customizados', () => {
      const payload = {
        title: 'Vitorioso És',
        artist: 'Gabriel Guedes',
        notes: 'Música para o momento de celebração',
        versions: [
          {
            id: 'v1',
            name: 'Original',
            classificationIds: ['class-jubilo', 'class-abertura'],
            notes: 'Versão de estúdio com introdução de teclado',
            key: 'G',
            bpm: 130,
            duration: '04:45',
            links: [
              { label: 'Letra', url: 'https://letras.test/vitorioso' },
              { label: 'Cifra', url: 'https://cifras.test/vitorioso' },
              { label: 'Áudio', url: 'https://audio.test/vitorioso.mp3' },
              { label: 'Vídeo', url: 'https://youtube.com/watch?v=vit123' },
              { label: 'Multitrack', url: 'https://multitracks.test/vit', isCustom: true },
            ],
          },
          {
            id: 'v2',
            name: 'Versão Reduzida',
            classification_ids: ['class-comunhao'],
            notes: 'Sem a segunda estrofe',
            key: 'F',
            bpm: '125',
            duration: '03:15',
            links: [
              { label: 'Cifra', url: 'https://cifras.test/vitorioso-f' },
            ],
          },
        ],
      };

      const parsed = createSongSchema.parse(payload);
      expect(parsed.title).toBe('Vitorioso És');
      expect(parsed.artist).toBe('Gabriel Guedes');
      expect(parsed.notes).toBe('Música para o momento de celebração');
      expect(parsed.versions).toHaveLength(2);
      expect(parsed.versions![0].name).toBe('Original');
      expect(parsed.versions![0].classificationIds).toEqual(['class-jubilo', 'class-abertura']);
      expect(parsed.versions![0].links).toHaveLength(5);
      expect(parsed.versions![1].name).toBe('Versão Reduzida');
      expect(parsed.versions![1].classificationIds).toEqual(['class-comunhao']);
      expect(parsed.versions![1].key).toBe('F');
    });

    it('deve aceitar payload legada sem array versions (retrocompatibilidade)', () => {
      const legacyPayload = {
        title: 'Porque Ele Vive',
        artist_id: 'artist-tradicional',
        classification_id: 'class-tradicional',
        original_key: 'A',
        bpm: 80,
        duration: '04:00',
        lyrics: 'Deus enviou seu filho amado...',
        chord_sheet_url: 'https://cifras.test/porque-ele-vive',
        youtube_url: 'https://youtube.com/watch?v=pev',
        audio_url: 'https://audio.test/pev.mp3',
      };

      const parsed = createSongSchema.parse(legacyPayload);
      expect(parsed.title).toBe('Porque Ele Vive');
      expect(parsed.original_key).toBe('A');
      expect(parsed.bpm).toBe(80);
      expect(parsed.versions).toBeUndefined();
    });

    it('deve REJEITAR versions com array vazio (mínimo de 1 versão)', () => {
      expect(() => createSongSchema.parse({ title: 'Música Sem Versão', versions: [] })).toThrow();
    });

    it('deve REJEITAR link sem rótulo obrigatório no nested schema', () => {
      const invalidLinkPayload = {
        title: 'Música Com Link Inválido',
        versions: [{ name: 'Original', links: [{ label: '', url: 'https://exemplo.com' }] }],
      };
      expect(() => createSongSchema.parse(invalidLinkPayload)).toThrow();
    });

    it('deve REJEITAR URLs com esquemas inseguros como javascript: ou data:', () => {
      const xssPayload = {
        title: 'Música Maliciosa',
        versions: [
          {
            name: 'Original',
            links: [{ label: 'Link Malicioso', url: 'javascript:alert(document.cookie)' }],
          },
        ],
      };
      expect(() => createSongSchema.parse(xssPayload)).toThrow(/URL inválida ou esquema inseguro/i);

      const dataUriPayload = {
        title: 'Música Maliciosa 2',
        versions: [
          {
            name: 'Original',
            links: [{ label: 'Data URI', url: 'data:text/html,<script>alert(1)</script>' }],
          },
        ],
      };
      expect(() => createSongSchema.parse(dataUriPayload)).toThrow(/URL inválida ou esquema inseguro/i);
    });

    it('deve PRESERVAR links opcionais vazios legítimos', () => {
      const validEmptyLink = {
        title: 'Música com link vazio',
        versions: [
          {
            name: 'Original',
            links: [{ label: 'Letra', url: '' }, { label: 'Cifra', url: null }],
          },
        ],
      };
      const parsed = createSongSchema.parse(validEmptyLink);
      expect(parsed.versions![0].links).toHaveLength(2);
      expect(parsed.versions![0].links![0].url).toBe('');
    });

    it('deve REJEITAR IDs de versões duplicados no mesmo array', () => {
      const duplicateIdsPayload = {
        title: 'Música com IDs Duplicados',
        versions: [
          { id: 'v_dup', name: 'Original', key: 'C' },
          { id: 'v_dup', name: 'Segunda Versão', key: 'D' },
        ],
      };
      expect(() => createSongSchema.parse(duplicateIdsPayload)).toThrow(/IDs de versões duplicados/i);
      expect(() => updateSongSchema.parse(duplicateIdsPayload)).toThrow(/IDs de versões duplicados/i);
    });

    it('deve REJEITAR exceder limites de cole��es (max 20 vers�es, max 10 tags, max 20 links)', () => {
      const excessVersions = Array.from({ length: 21 }, (_, i) => ({
        id: 'v_' + (i + 1),
        name: 'Vers�o ' + (i + 1),
      }));
      expect(() => createSongSchema.parse({ title: 'Muitas Vers�es', versions: excessVersions })).toThrow(/20 vers/i);

      const excessTags = Array.from({ length: 11 }, (_, i) => 'tag-' + i);
      expect(() => createSongSchema.parse({
        title: 'Muitas Tags',
        versions: [{ name: 'Original', classificationIds: excessTags }],
      })).toThrow(/10 class/i);

      const excessLinks = Array.from({ length: 21 }, (_, i) => ({ label: 'Link ' + i, url: 'https://exemplo.com' }));
      expect(() => createSongSchema.parse({
        title: 'Muitos Links',
        versions: [{ name: 'Original', links: excessLinks }],
      })).toThrow(/20 link/i);
    });
  });

  describe('F-R1-01: Free-text Artist Normalization & Safety', () => {
    it('deve normalizar artista free-text (string) em create e update sem crashar estrutura de objeto', async () => {
      let createdData: any = null;
      class MockSubscriptionRepository {
        createSongTransactional = vi.fn().mockImplementation(async ({ songData, ministryId }) => {
          createdData = { id: 's-art-1', ministry_id: ministryId, ...songData };
          return { song: createdData, usage: {} };
        });
      }
      vi.doMock('../../repositories/SubscriptionRepository', () => ({
        SubscriptionRepository: MockSubscriptionRepository,
      }));

      (repo as any).classificationsCol = {
        doc: vi.fn().mockImplementation((id) => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({ ministry_id: 'min-alpha', name: 'Tag Especial' }),
          }),
        })),
      };

      const result = await repo.createSong('min-alpha', 'user-1', {
        title: 'Águas Purificadoras',
        artist: 'Diante do Trono',
      });

      expect(result.artist).toEqual({ id: '', name: 'Diante do Trono' });
      expect(result.artist_name).toBe('Diante do Trono');
      expect(createdData.artist_name).toBe('Diante do Trono');
    });

    it('deve normalizar artista quando enviado como objeto { id, name } ou artist_name', async () => {
      let stored: any = {
        id: 's-art-2',
        ministry_id: 'min-alpha',
        title: 'Música',
        artist: { id: '', name: 'Antigo Artista' },
        artist_name: 'Antigo Artista',
        versions: [{ id: 'v1', name: 'Original', key: 'C' }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: stored.id, data: () => stored })),
          update: vi.fn().mockImplementation(async (up: any) => { stored = { ...stored, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      const updated = await repo.updateSong('s-art-2', 'min-alpha', {
        artist: { id: '', name: 'Novo Artista' },
      });

      expect(updated.artist).toEqual({ id: '', name: 'Novo Artista' });
      expect(updated.artist_name).toBe('Novo Artista');
    });
  });

  describe('F-R1-02: Multi-Tenant Anti-IDOR for Version Classifications', () => {
    it('createSong deve REJEITAR quando QUALQUER versão tiver classificação de outro ministério', async () => {
      (repo as any).classificationsCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({
              ministry_id: id === 'class-valid' ? 'min-alpha' : 'min-foreign', // IDOR em versão secundária
              name: 'Tag',
            }),
          }),
        })),
      };

      const payload = {
        title: 'Música com Tag Estrangeira',
        versions: [
          { name: 'Original', classificationIds: ['class-valid'] },
          { name: 'Versão 2', classificationIds: ['class-foreign-idor'] },
        ],
      };

      await expect(repo.createSong('min-alpha', 'user-1', payload)).rejects.toThrow(AppError);
    });

    it('updateSong deve REJEITAR quando versão atualizada contiver classificação inexistente ou de outro tenant', async () => {
      const storedSong = {
        id: 'song-tag-test',
        ministry_id: 'min-alpha',
        title: 'Música Atual',
        versions: [{ id: 'v1', name: 'Original', classificationIds: ['class-alpha'] }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: true, id: storedSong.id, data: () => storedSong }),
          update: vi.fn(),
        }),
      };

      (repo as any).classificationsCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: id !== 'class-not-found',
            id,
            data: () => ({ ministry_id: 'min-bravo' }), // Foreign tenant
          }),
        })),
      };

      await expect(
        repo.updateSong('song-tag-test', 'min-alpha', {
          versions: [{ id: 'v1', name: 'Original', classificationIds: ['class-foreign'] }],
        })
      ).rejects.toThrow(AppError);
    });

    it('R2-05: updateSong com payload parcial que NÃO altera versions deve REJEITAR (404) se versões existentes contiverem classificação de outro tenant', async () => {
      const storedSongWithForeignTag = {
        id: 'song-stored-foreign',
        ministry_id: 'min-alpha',
        title: 'Música com Tag Estrangeira Pré-Existente',
        versions: [{ id: 'v1', name: 'Original', classificationIds: ['class-foreign-idor'] }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id: storedSongWithForeignTag.id,
            data: () => storedSongWithForeignTag,
          }),
          update: vi.fn(),
        }),
      };

      (repo as any).classificationsCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({ ministry_id: 'min-bravo' }), // Outro ministério!
          }),
        })),
      };

      // Atualiza APENAS o título, sem passar versions no payload
      await expect(
        repo.updateSong('song-stored-foreign', 'min-alpha', {
          title: 'Novo Título Qualquer',
        })
      ).rejects.toThrow(AppError);
    });
  });

  describe('R2-01: Mixed Updates, Primary-Version Synchronization and Key Clearing', () => {
    it('deve rejeitar com erro 400 quando houver conflito entre original_key plano e versions[0].key', async () => {
      let storedSong = {
        id: 'song-conflict-1',
        ministry_id: 'min-alpha',
        title: 'Música Conflito',
        original_key: 'C',
        versions: [{ id: 'v1', name: 'Original', key: 'C' }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn(),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      await expect(
        repo.updateSong('song-conflict-1', 'min-alpha', {
          original_key: 'G',
          versions: [{ id: 'v1', name: 'Original', key: 'D' }], // Conflito explícito: G != D
        })
      ).rejects.toThrow(AppError);
    });

    it('deve rejeitar com erro 400 quando houver conflito entre BPM plano e versions[0].bpm', async () => {
      let storedSong = {
        id: 'song-conflict-2',
        ministry_id: 'min-alpha',
        title: 'Música Conflito BPM',
        bpm: 100,
        versions: [{ id: 'v1', name: 'Original', bpm: 100 }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn(),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      await expect(
        repo.updateSong('song-conflict-2', 'min-alpha', {
          bpm: 120,
          versions: [{ id: 'v1', name: 'Original', bpm: 140 }],
        })
      ).rejects.toThrow(AppError);
    });

    it('Direction 1: Atualização de versions deve sincronizar primary version com campos planos e PRESERVAR original_key: null (sem converter para "C")', async () => {
      let storedSong = {
        id: 'song-sync-1',
        ministry_id: 'min-alpha',
        title: 'Grande é o Senhor',
        original_key: 'A',
        bpm: 120,
        duration: '05:00',
        classification_id: 'class-louvor',
        versions: [
          {
            id: 'v1',
            name: 'Original',
            key: 'A',
            bpm: 120,
            duration: '05:00',
            classificationIds: ['class-louvor'],
            links: [],
          },
        ],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      // Limpar explicitamente key para null, além de bpm, duration e classificações
      const updated = await repo.updateSong('song-sync-1', 'min-alpha', {
        versions: [
          {
            id: 'v1',
            name: 'Original',
            key: null,
            bpm: null,
            duration: '',
            classificationIds: [],
          },
        ],
      });

      // Validar que o tom foi limpo para null e NÃO regrediu para 'C'
      expect(updated.original_key).toBeNull();
      expect(updated.versions[0].key).toBeNull();
      expect(updated.bpm).toBeNull();
      expect(updated.duration).toBeNull();
      expect(updated.classification_id).toBeNull();
      expect(storedSong.original_key).toBeNull();
      expect(storedSong.bpm).toBeNull();
    });

    it('Direction 2: Atualização APENAS de campos planos legados deve sincronizar versions[0] e PRESERVAR original_key: null sem afetar outras versões', async () => {
      let storedSong = {
        id: 'song-sync-2',
        ministry_id: 'min-alpha',
        title: 'Música com Várias Versões',
        original_key: 'C',
        bpm: 70,
        duration: '04:00',
        classification_id: 'class-1',
        versions: [
          { id: 'v1', name: 'Original', key: 'C', bpm: 70, duration: '04:00', classificationIds: ['class-1'], links: [] },
          { id: 'v2', name: 'Acústico', key: 'E', bpm: 65, duration: '03:45', classificationIds: ['class-2'], links: [] },
        ],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockResolvedValue({ exists: true, id, data: () => ({ ministry_id: 'min-alpha', name: 'Nova Tag' }) }),
        })),
      };

      // Limpar tom plano via original_key: null
      const updated = await repo.updateSong('song-sync-2', 'min-alpha', {
        original_key: null,
        bpm: 78,
      });

      expect(updated.original_key).toBeNull();
      expect(updated.bpm).toBe(78);

      // Primary version deve ter sido atualizada com tom null e NÃO 'C'
      expect(updated.versions[0].key).toBeNull();
      expect(updated.versions[0].bpm).toBe(78);

      // Versão secundária v2 deve permanecer 100% INTACTA
      expect(updated.versions[1].id).toBe('v2');
      expect(updated.versions[1].name).toBe('Acústico');
      expect(updated.versions[1].key).toBe('E');
      expect(updated.versions[1].bpm).toBe(65);
    });
  });

  describe('R2-02: Link Clearing & Primary-Version Synchronization', () => {
    it('deve limpar links legados (chord_sheet_url, youtube_url, audio_url, external_links) quando primary version passar links: []', async () => {
      let storedSong = {
        id: 'song-links-1',
        ministry_id: 'min-alpha',
        title: 'Música com Links',
        chord_sheet_url: 'https://cifras.test/link1',
        youtube_url: 'https://youtube.com/watch?v=123',
        audio_url: 'https://audio.test/som.mp3',
        external_links: { Letra: 'https://letras.test/123' },
        versions: [
          {
            id: 'v1',
            name: 'Original',
            key: 'C',
            links: [
              { label: 'Cifra', url: 'https://cifras.test/link1' },
              { label: 'Vídeo', url: 'https://youtube.com/watch?v=123' },
              { label: 'Áudio', url: 'https://audio.test/som.mp3' },
              { label: 'Letra', url: 'https://letras.test/123' },
            ],
          },
        ],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      // Limpar explicitamente todos os links na versão primária
      const updated = await repo.updateSong('song-links-1', 'min-alpha', {
        versions: [{ id: 'v1', name: 'Original', links: [] }],
      });

      // Links legados e externos devem estar limpos e não ressuscitar
      expect(updated.chord_sheet_url).toBeNull();
      expect(updated.youtube_url).toBeNull();
      expect(updated.audio_url).toBeNull();
      expect(storedSong.chord_sheet_url).toBeNull();
      expect(storedSong.youtube_url).toBeNull();
      expect(storedSong.audio_url).toBeNull();
      expect(storedSong.external_links).toEqual({});
      expect(updated.versions[0].links).toEqual([]);
    });

    it('deve sincronizar novos links da versão primária para campos legados correspondentes', async () => {
      let storedSong: any = {
        id: 'song-links-2',
        ministry_id: 'min-alpha',
        title: 'Música Links Sync',
        versions: [{ id: 'v1', name: 'Original', key: 'C', links: [] }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      const updated = await repo.updateSong('song-links-2', 'min-alpha', {
        versions: [
          {
            id: 'v1',
            name: 'Original',
            links: [
              { label: 'Cifra', url: 'https://cifras.test/nova' },
              { label: 'Vídeo', url: 'https://youtube.com/watch?v=novo' },
              { label: 'Partitura', url: 'https://sheets.test/part' },
            ],
          },
        ],
      });

      expect(updated.chord_sheet_url).toBe('https://cifras.test/nova');
      expect(updated.youtube_url).toBe('https://youtube.com/watch?v=novo');
      expect(storedSong.external_links).toEqual({ Partitura: 'https://sheets.test/part' });
    });
  });

  describe('R2-03 & F-R1-04: Partial Version Data Loss Prevention & Serialization Compatibility', () => {
    it('Rename-only update vindo do Web deve preservar key, bpm, notes, links e tags existentes sem regredir para defaults', async () => {
      let storedSong = {
        id: 'song-part-1',
        ministry_id: 'min-alpha',
        title: 'Música Completa',
        versions: [
          {
            id: 'v1',
            name: 'Original',
            key: 'F#m',
            bpm: 128,
            duration: '04:32',
            notes: 'Observação crítica que não pode ser perdida',
            classificationIds: ['tag-especial'],
            links: [{ label: 'Cifra', url: 'https://cifras.test/fsharp' }],
          },
        ],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockImplementation((id: string) => ({
          get: vi.fn().mockResolvedValue({
            exists: true,
            id,
            data: () => ({ ministry_id: 'min-alpha', name: 'Tag Especial' }),
          }),
        })),
      };

      // Envia APENAS { id: 'v1', name: 'Original Renovada' } (omitindo todos os outros campos, como o Web faz agora)
      const updated = await repo.updateSong('song-part-1', 'min-alpha', {
        versions: [{ id: 'v1', name: 'Original Renovada' }],
      });

      expect(updated.versions[0].name).toBe('Original Renovada');
      expect(updated.versions[0].key).toBe('F#m'); // NÃO regrediu para 'C'
      expect(updated.versions[0].bpm).toBe(128); // NÃO perdeu BPM
      expect(updated.versions[0].duration).toBe('04:32');
      expect(updated.versions[0].notes).toBe('Observação crítica que não pode ser perdida');
      expect(updated.versions[0].classificationIds).toEqual(['tag-especial']);
      expect(updated.versions[0].links).toHaveLength(1);
      expect(updated.versions[0].links[0].url).toBe('https://cifras.test/fsharp');
    });
  });

  describe('R2-04: Version ID Generation, Reservation, and Uniqueness', () => {
    it('deve rejeitar com erro 400 quando usuário enviar IDs duplicados no payload de versions', async () => {
      let storedSong = {
        id: 'song-dup-id',
        ministry_id: 'min-alpha',
        title: 'Música IDs Duplicados',
        versions: [{ id: 'v1', name: 'Original' }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn(),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      await expect(
        repo.updateSong('song-dup-id', 'min-alpha', {
          versions: [
            { id: 'custom-id', name: 'Versão 1' },
            { id: 'custom-id', name: 'Versão 2' }, // ID duplicado!
          ],
        })
      ).rejects.toThrow(AppError);
    });

    it('deve gerar IDs únicos para novas versões sem colidir com IDs já reservados pelo usuário', async () => {
      let storedSong = {
        id: 'song-id-gen',
        ministry_id: 'min-alpha',
        title: 'Música Geração IDs',
        versions: [{ id: 'song-id-gen_v1', name: 'Original', key: 'C' }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      // Adiciona uma nova versão sem ID enquanto a versão existente já possui o candidate v1
      const updated = await repo.updateSong('song-id-gen', 'min-alpha', {
        versions: [
          { id: 'song-id-gen_v1', name: 'Original' },
          { name: 'Nova Versão Sem ID' }, // deve gerar v2 para não colidir com v1
        ],
      });

      expect(updated.versions).toHaveLength(2);
      expect(updated.versions[0].id).toBe('song-id-gen_v1');
      expect(updated.versions[1].id).toMatch(/^song-id-gen_v_/);
      expect(updated.versions[1].id).not.toBe(updated.versions[0].id);
    });

    it('deve preservar a ordem especificada das versões após clonagem e reordenação', async () => {
      let storedSong = {
        id: 'song-order-1',
        ministry_id: 'min-alpha',
        title: 'Música para Reordenar',
        versions: [
          { id: 'v1', name: 'Versão 1', key: 'C', links: [] },
          { id: 'v2', name: 'Versão 2', key: 'D', links: [] },
          { id: 'v3', name: 'Versão 3', key: 'E', links: [] },
        ],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      // Inverter ordem: v3, v1, v2
      const updated = await repo.updateSong('song-order-1', 'min-alpha', {
        versions: [
          { id: 'v3', name: 'Versão 3' },
          { id: 'v1', name: 'Versão 1' },
          { id: 'v2', name: 'Versão 2' },
        ],
      });

      expect(updated.versions[0].id).toBe('v3');
      expect(updated.versions[1].id).toBe('v1');
      expect(updated.versions[2].id).toBe('v2');
      // A nova versão primária v3 deve sincronizar o tom 'E' com os flat fields
      expect(updated.original_key).toBe('E');
    });
  });

  describe('Realistic In-Memory Firestore Double: API → Validation → Persistence → Reload Integration', () => {
    it('deve executar o ciclo completo com deep cloning no double prevenindo vazamento de referências em memória', async () => {
      // Banco de dados em memória simulado com isolamento estrito via structuredClone / deepClone
      const deepClone = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));
      const inMemoryDb = new Map<string, any>();
      const classificationsDb = new Map<string, any>([
        ['class-adoracao', { id: 'class-adoracao', ministry_id: 'min-test', name: 'Adoração' }],
        ['class-celebracao', { id: 'class-celebracao', ministry_id: 'min-test', name: 'Celebração' }],
      ]);

      const testRepo = new RepertoireRepository();

      (testRepo as any).classificationsCol = {
        doc: (id: string) => ({
          get: async () => ({
            exists: classificationsDb.has(id),
            id,
            data: () => (classificationsDb.has(id) ? deepClone(classificationsDb.get(id)) : undefined),
          }),
        }),
      };

      (testRepo as any).songsCol = {
        doc: (id: string) => ({
          get: async () => ({
            exists: inMemoryDb.has(id),
            id,
            data: () => (inMemoryDb.has(id) ? deepClone(inMemoryDb.get(id)) : undefined),
          }),
          update: async (data: any) => {
            if (!inMemoryDb.has(id)) throw new Error('Not found');
            const current = inMemoryDb.get(id);
            inMemoryDb.set(id, deepClone({ ...current, ...data }));
          },
        }),
      };

      class MockSubRepo {
        createSongTransactional = async ({ songData, ministryId }: any) => {
          const id = 'simulated-song-99';
          const savedDoc = deepClone({ id, ministry_id: ministryId, ...songData, created_at: new Date().toISOString() });
          inMemoryDb.set(id, savedDoc);
          return { song: deepClone(savedDoc), usage: {} };
        };
      }
      vi.doMock('../../repositories/SubscriptionRepository', () => ({
        SubscriptionRepository: MockSubRepo,
      }));

      // Passo 1: Validação de input com createSongSchema
      const rawApiRequest = {
        title: 'Bondade de Deus',
        artist: 'Isaías Saad',
        notes: 'Versão em português de Goodness of God',
        versions: [
          {
            id: 'v_principal',
            name: 'Principal',
            key: 'G',
            bpm: 70,
            duration: '04:55',
            classificationIds: ['class-adoracao'],
            links: [{ label: 'Cifra', url: 'https://cifras.test/bdd' }],
          },
        ],
      };

      const validatedBody = createSongSchema.parse(rawApiRequest);

      // Passo 2: Escrita via repository
      const created = await testRepo.createSong('min-test', 'user-test', validatedBody);
      expect(created.id).toBe('simulated-song-99');
      expect(created.title).toBe('Bondade de Deus');
      expect(created.original_key).toBe('G');

      // Passo 3: Reload da música persistida no double (confirma desvinculação de referências)
      const reloaded1 = await testRepo.getSongById('simulated-song-99', 'min-test');
      expect(reloaded1.versions).toHaveLength(1);
      expect(reloaded1.versions[0].name).toBe('Principal');
      expect(reloaded1.versions[0].classificationIds).toEqual(['class-adoracao']);

      // Passo 4: Clonar versão e atualizar via updateSongSchema
      const updateRequest = {
        versions: [
          reloaded1.versions[0],
          {
            id: 'v_clonada',
            name: 'Voz e Piano',
            key: 'A',
            bpm: 68,
            duration: '04:30',
            classificationIds: ['class-celebracao'],
            links: [{ label: 'Cifra', url: 'https://cifras.test/bdd-piano' }],
          },
        ],
      };

      const validatedUpdate = updateSongSchema.parse(updateRequest);
      const afterUpdate = await testRepo.updateSong('simulated-song-99', 'min-test', validatedUpdate);
      expect(afterUpdate.versions).toHaveLength(2);

      // Passo 5: Reload final confirmando integridade e ordem persistida
      const finalReload = await testRepo.getSongById('simulated-song-99', 'min-test');
      expect(finalReload.versions).toHaveLength(2);
      expect(finalReload.versions[0].id).toBe('v_principal');
      expect(finalReload.versions[1].id).toBe('v_clonada');
      expect(finalReload.versions[1].name).toBe('Voz e Piano');
      expect(finalReload.versions[1].key).toBe('A');
    });

    it('deve simular falha de escrita no Firestore e garantir que erro é propagado sem corromper estado', async () => {
      const inMemoryDb = new Map<string, any>([
        [
          'song-fail-test',
          {
            id: 'song-fail-test',
            ministry_id: 'min-test',
            title: 'Música Intacta',
            original_key: 'D',
            versions: [{ id: 'v1', name: 'Original', key: 'D' }],
          },
        ],
      ]);

      const testRepo = new RepertoireRepository();

      (testRepo as any).classificationsCol = {
        doc: () => ({ get: async () => ({ exists: false }) }),
      };

      (testRepo as any).songsCol = {
        doc: (id: string) => ({
          get: async () => ({
            exists: inMemoryDb.has(id),
            id,
            data: () => inMemoryDb.get(id),
          }),
          update: async () => {
            throw new Error('Simulated Firestore Unavailable / Network Timeout');
          },
        }),
      };

      // Tentar atualizar deve falhar e propagar a exceção
      await expect(
        testRepo.updateSong('song-fail-test', 'min-test', {
          title: 'Tentativa de Novo Título',
          versions: [{ id: 'v1', name: 'Original Modificada', key: 'G' }],
        })
      ).rejects.toThrow('Simulated Firestore Unavailable');

      // Estado do documento no banco simulado permanece INTACTO
      const uncorruptedDoc = inMemoryDb.get('song-fail-test');
      expect(uncorruptedDoc.title).toBe('Música Intacta');
      expect(uncorruptedDoc.original_key).toBe('D');
      expect(uncorruptedDoc.versions[0].key).toBe('D');
    });
  });

  describe('Codex R3 Regression Reproduction Tests (BEFORE FIX)', () => {
    it('R3-01: { original_key: "D", versions: [{ id: "v1", name: "Original" }] } deve sincronizar ambos os campos para "D"', async () => {
      let storedSong = {
        id: 'song-r3-01',
        ministry_id: 'min-alpha',
        title: 'Música R3-01',
        original_key: 'C',
        versions: [{ id: 'v1', name: 'Original', key: 'C' }],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      const updated = await repo.updateSong('song-r3-01', 'min-alpha', {
        original_key: 'D',
        versions: [{ id: 'v1', name: 'Original' }], // key omitido na versão primária
      });

      expect(updated.original_key).toBe('D');
      expect(updated.versions[0].key).toBe('D');
    });

    it('R3-02: Conflito explícito entre chave plana e chave nula em versions[0] deve retornar HTTP 400 sem writes', async () => {
      let storedSong = {
        id: 'song-r3-02a',
        ministry_id: 'min-alpha',
        title: 'Música R3-02A',
        original_key: 'C',
        versions: [{ id: 'v1', name: 'Original', key: 'C' }],
      };

      const updateMock = vi.fn();
      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: updateMock,
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      await expect(
        repo.updateSong('song-r3-02a', 'min-alpha', {
          original_key: 'D',
          versions: [{ id: 'v1', name: 'Original', key: null }],
        })
      ).rejects.toThrow(AppError);

      expect(updateMock).not.toHaveBeenCalled();
      expect(storedSong.original_key).toBe('C');
      expect(storedSong.versions[0].key).toBe('C');
    });

    it('R3-02: Conflito explícito entre classification_id e classificationIds vazio [] deve retornar HTTP 400 sem writes', async () => {
      let storedSong = {
        id: 'song-r3-02b',
        ministry_id: 'min-alpha',
        title: 'Música R3-02B',
        classification_id: 'class-1',
        versions: [{ id: 'v1', name: 'Original', classificationIds: ['class-1'] }],
      };

      const updateMock = vi.fn();
      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: updateMock,
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({ exists: true, id: 'class-1', data: () => ({ ministry_id: 'min-alpha' }) }),
        }),
      };

      await expect(
        repo.updateSong('song-r3-02b', 'min-alpha', {
          classification_id: 'class-1',
          versions: [{ id: 'v1', name: 'Original', classificationIds: [] }],
        })
      ).rejects.toThrow(AppError);

      expect(updateMock).not.toHaveBeenCalled();
      expect(storedSong.classification_id).toBe('class-1');
      expect(storedSong.versions[0].classificationIds).toEqual(['class-1']);
    });

    it('R3-04: Nova versão sem ID NÃO deve reutilizar silenciosamente ID de versão existente não enviada', async () => {
      let storedSong = {
        id: 'song-r3-04',
        ministry_id: 'min-alpha',
        title: 'Música R3-04',
        versions: [
          { id: 'song-r3-04_v1', name: 'V1', key: 'C' },
          { id: 'song-r3-04_v2', name: 'V2', key: 'D' },
        ],
      };

      (repo as any).songsCol = {
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockImplementation(async () => ({ exists: true, id: storedSong.id, data: () => storedSong })),
          update: vi.fn().mockImplementation(async (up: any) => { storedSong = { ...storedSong, ...up }; }),
        }),
      };
      (repo as any).classificationsCol = {
        doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
      };

      // Atualiza mantendo v2 e adicionando nova versão sem ID.
      // v1 é omitida. O gerador NÃO pode atribuir song-r3-04_v1 para a nova versão!
      const updated = await repo.updateSong('song-r3-04', 'min-alpha', {
        versions: [
          { id: 'song-r3-04_v2', name: 'V2' },
          { name: 'V3 Nova Versão' },
        ],
      });

      expect(updated.versions).toHaveLength(2);
      expect(updated.versions[0].id).toBe('song-r3-04_v2');
      // ID da nova versão não pode ser o ID de v1 que existia
      expect(updated.versions[1].id).not.toBe('song-r3-04_v1');
    });
  });
});
