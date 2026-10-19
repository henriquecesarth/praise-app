import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SmartChordRepository } from '../../repositories/SmartChordRepository';
import { SmartChordLinkRepository } from '../../repositories/SmartChordLinkRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { RepertoireRepository } from '../../repositories/RepertoireRepository';
import { SmartChordService } from './smart_chord.service';
import { SmartChordController } from './smart_chord.controller';
import {
  setSmartChordRepertoireLinkSchema,
  createSmartChordSchema,
  updateSmartChordSchema,
} from './smart_chord.types';
import { AppError } from '../../middleware/error-handler';

describe('Smart Chord Repertoire Linking (M19)', () => {
  let smartChordRepo: SmartChordRepository;
  let smartChordLinkRepo: SmartChordLinkRepository;
  let ministryRepo: MinistryRepository;
  let repertoireRepo: RepertoireRepository;
  let service: SmartChordService;
  let controller: SmartChordController;

  beforeEach(() => {
    vi.clearAllMocks();
    smartChordRepo = new SmartChordRepository();
    smartChordLinkRepo = new SmartChordLinkRepository();
    ministryRepo = new MinistryRepository();
    repertoireRepo = new RepertoireRepository();

    vi.spyOn(smartChordLinkRepo, 'setLink').mockImplementation(
      async (userId, smartChordId, ministryId, songId) => ({
        id: smartChordLinkRepo.buildLinkId(userId, smartChordId, ministryId),
        user_id: userId,
        smart_chord_id: smartChordId,
        ministry_id: ministryId,
        song_id: songId,
        created_at: '2026-10-16T12:00:00Z',
        updated_at: '2026-10-16T12:00:00Z',
      })
    );
    vi.spyOn(smartChordLinkRepo, 'deleteLink').mockResolvedValue(true);

    service = new SmartChordService(smartChordRepo, ministryRepo, repertoireRepo, smartChordLinkRepo);
    controller = new SmartChordController(service as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Zod Schema Validation', () => {
    it('setSmartChordRepertoireLinkSchema accepts valid song_id', () => {
      const parsed = setSmartChordRepertoireLinkSchema.parse({ song_id: 'song-valid-123' });
      expect(parsed.song_id).toBe('song-valid-123');
    });

    it('setSmartChordRepertoireLinkSchema rejects empty, whitespace-only, and path-like IDs', () => {
      expect(() => setSmartChordRepertoireLinkSchema.parse({ song_id: '' })).toThrow();
      expect(() => setSmartChordRepertoireLinkSchema.parse({ song_id: '   ' })).toThrow();
      expect(() => setSmartChordRepertoireLinkSchema.parse({ song_id: 'folder/song-1' })).toThrow();
      expect(() => setSmartChordRepertoireLinkSchema.parse({ song_id: 'a'.repeat(101) })).toThrow();
      expect(() => setSmartChordRepertoireLinkSchema.parse({})).toThrow();
    });

    it('createSmartChordSchema and updateSmartChordSchema accept artist_name and validate length', () => {
      const parsedCreate = createSmartChordSchema.parse({
        title: 'Nova Cifra',
        original_key: 'A',
        content: '[A]Louvai',
        artist_name: '  Gabriela Rocha  ',
      });
      expect(parsedCreate.artist_name).toBe('Gabriela Rocha');

      const parsedNull = updateSmartChordSchema.parse({
        artist_name: null,
      });
      expect(parsedNull.artist_name).toBeNull();

      expect(() =>
        createSmartChordSchema.parse({
          title: 'Nova Cifra',
          original_key: 'A',
          content: '[A]Louvai',
          artist_name: 'x'.repeat(256),
        })
      ).toThrow();
    });
  });

  describe('2. Canonical Link PUT (setRepertoireLink)', () => {
    it('creates canonical link when song belongs to target ministry and user is member', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
        title: 'Cifra Pessoal',
        original_key: 'D',
        content: '[D]Graça',
      } as any);

      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({
        id: 'min-alpha',
        name: 'Ministério Alfa',
      } as any);

      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-1',
        ministry_id: 'min-alpha',
        title: 'Música Alfa',
        artist_id: 'art-1',
      } as any);

      vi.spyOn(repertoireRepo, 'findArtistById').mockResolvedValue({
        id: 'art-1',
        ministry_id: 'min-alpha',
        name: 'Artista Alfa',
      } as any);

      const result = await service.setRepertoireLink('usr-1', 'chord-1', 'min-alpha', 'song-1');

      expect(result.link).not.toBeNull();
      expect(result.link?.song_id).toBe('song-1');
      expect(result.link?.ministry_id).toBe('min-alpha');
      expect(result.song?.id).toBe('song-1');
      expect(result.song?.title).toBe('Música Alfa');
      expect(result.song?.artist_name).toBe('Artista Alfa');
    });

    it('idempotent: linking to same song again succeeds and returns canonical link', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
        title: 'Cifra Pessoal',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-1',
        ministry_id: 'min-alpha',
        title: 'Música Alfa',
      } as any);

      const result = await service.setRepertoireLink('usr-1', 'chord-1', 'min-alpha', 'song-1');
      expect(result.link?.song_id).toBe('song-1');
      expect(result.song?.title).toBe('Música Alfa');
    });

    it('atomic replace: linking to a different song in same ministry replaces the link', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-2',
        ministry_id: 'min-alpha',
        title: 'Nova Música',
      } as any);

      const result = await service.setRepertoireLink('usr-1', 'chord-1', 'min-alpha', 'song-2');
      expect(result.link?.song_id).toBe('song-2');
      expect(result.song?.title).toBe('Nova Música');
    });

    it('anti-IDOR: rejects with 404 if chord belongs to another user', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockRejectedValue(
        new AppError(404, 'Cifra inteligente não encontrada.')
      );

      await expect(
        service.setRepertoireLink('usr-attacker', 'chord-victim', 'min-alpha', 'song-1')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('anti-IDOR: rejects with 404 if song does not belong to target ministry', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-foreign',
        ministry_id: 'min-beta', // DIVERGENT TENANT
        title: 'Música de Outro Ministério',
      } as any);

      await expect(
        service.setRepertoireLink('usr-1', 'chord-1', 'min-alpha', 'song-foreign')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('anti-IDOR: rejects with 404 if song does not exist', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue(null);

      await expect(
        service.setRepertoireLink('usr-1', 'chord-1', 'min-alpha', 'song-missing')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });
  });

  describe('3. Canonical Link GET (DUAL_READ_ONLY semantics)', () => {
    it('returns canonical link when present', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(smartChordLinkRepo, 'getLink').mockResolvedValue({
        id: 'usr-1_chord-1_min-alpha',
        user_id: 'usr-1',
        smart_chord_id: 'chord-1',
        ministry_id: 'min-alpha',
        song_id: 'song-canon',
        created_at: '2026-10-16T12:00:00Z',
        updated_at: '2026-10-16T12:00:00Z',
      });
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-canon',
        ministry_id: 'min-alpha',
        title: 'Canção Canônica',
      } as any);

      const result = await service.getRepertoireLink('usr-1', 'chord-1', 'min-alpha');
      expect(result.link?.song_id).toBe('song-canon');
      expect(result.song?.title).toBe('Canção Canônica');
    });

    it('dual-read: falls back to legacy song_id strictly read-only without persisting canonical link', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-legacy',
        user_id: 'usr-1',
        song_id: 'song-legacy',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(smartChordLinkRepo, 'getLink').mockResolvedValue(null); // No canonical link
      const setLinkSpy = vi.spyOn(smartChordLinkRepo, 'setLink');

      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-legacy',
        ministry_id: 'min-alpha', // matches ministry
        title: 'Música Legada',
      } as any);

      const result = await service.getRepertoireLink('usr-1', 'chord-legacy', 'min-alpha');
      expect(result.link).not.toBeNull();
      expect(result.link?.song_id).toBe('song-legacy');
      expect(result.song?.title).toBe('Música Legada');
      // STRICTLY DUAL_READ_ONLY: NO WRITE ON GET
      expect(setLinkSpy).not.toHaveBeenCalled();
    });

    it('canonical link takes precedence over legacy song_id', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
        song_id: 'song-old-legacy',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(smartChordLinkRepo, 'getLink').mockResolvedValue({
        id: 'usr-1_chord-1_min-alpha',
        user_id: 'usr-1',
        smart_chord_id: 'chord-1',
        ministry_id: 'min-alpha',
        song_id: 'song-new-canonical',
        created_at: '2026-10-16T12:00:00Z',
        updated_at: '2026-10-16T12:00:00Z',
      });
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-new-canonical',
        ministry_id: 'min-alpha',
        title: 'Canção Nova',
      } as any);

      const result = await service.getRepertoireLink('usr-1', 'chord-1', 'min-alpha');
      expect(result.link?.song_id).toBe('song-new-canonical');
      expect(result.song?.title).toBe('Canção Nova');
    });

    it('returns link: null, song: null when chord has no link and no legacy song for this ministry', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-unlinked',
        user_id: 'usr-1',
        song_id: null,
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(smartChordLinkRepo, 'getLink').mockResolvedValue(null);

      const result = await service.getRepertoireLink('usr-1', 'chord-unlinked', 'min-alpha');
      expect(result).toEqual({ link: null, song: null });
    });

    it('returns link: null, song: null when legacy song_id belongs to a different ministry', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
        song_id: 'song-in-beta',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(smartChordLinkRepo, 'getLink').mockResolvedValue(null);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-in-beta',
        ministry_id: 'min-beta', // DIFFERENT MINISTRY
        title: 'Música no Beta',
      } as any);

      const result = await service.getRepertoireLink('usr-1', 'chord-1', 'min-alpha');
      expect(result).toEqual({ link: null, song: null });
    });
  });

  describe('4. Canonical Link DELETE (removeRepertoireLink & Legacy Resurrection Prevention)', () => {
    it('deletes canonical link and nullifies legacy song_id if it pointed to same ministry', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
        song_id: 'song-alpha-legacy',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-alpha-legacy',
        ministry_id: 'min-alpha',
      } as any);

      const deleteLinkSpy = vi.spyOn(smartChordLinkRepo, 'deleteLink').mockResolvedValue(true);
      const updateChordSpy = vi.spyOn(smartChordRepo, 'updateSmartChord').mockResolvedValue({} as any);

      await service.removeRepertoireLink('usr-1', 'chord-1', 'min-alpha');

      expect(deleteLinkSpy).toHaveBeenCalledWith('usr-1', 'chord-1', 'min-alpha');
      // Resurrect prevention: nullifies legacy song_id
      expect(updateChordSpy).toHaveBeenCalledWith('chord-1', 'usr-1', { song_id: null });
    });

    it('deletes canonical link and preserves legacy song_id if it belongs to a DIFFERENT ministry', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-1',
        user_id: 'usr-1',
        song_id: 'song-beta-legacy',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-beta-legacy',
        ministry_id: 'min-beta', // DIFFERENT MINISTRY
      } as any);

      const deleteLinkSpy = vi.spyOn(smartChordLinkRepo, 'deleteLink').mockResolvedValue(true);
      const updateChordSpy = vi.spyOn(smartChordRepo, 'updateSmartChord');

      await service.removeRepertoireLink('usr-1', 'chord-1', 'min-alpha');

      expect(deleteLinkSpy).toHaveBeenCalledWith('usr-1', 'chord-1', 'min-alpha');
      // Does NOT clear song_id of different ministry!
      expect(updateChordSpy).not.toHaveBeenCalled();
    });
  });

  describe('5. getMySmartChordsForSong (Union & User Isolation)', () => {
    it('returns union of canonical and legacy links for authenticated user', async () => {
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-target',
        ministry_id: 'min-alpha',
      } as any);

      // Canonical links for this user
      vi.spyOn(smartChordLinkRepo, 'getLinksBySongId').mockResolvedValue([
        {
          id: 'usr-1_chord-canon_min-alpha',
          user_id: 'usr-1',
          smart_chord_id: 'chord-canon',
          ministry_id: 'min-alpha',
          song_id: 'song-target',
          created_at: '2026-10-16T10:00:00Z',
          updated_at: '2026-10-16T10:00:00Z',
        },
        // Another user's link to the same song
        {
          id: 'usr-2_chord-other_min-alpha',
          user_id: 'usr-2',
          smart_chord_id: 'chord-other',
          ministry_id: 'min-alpha',
          song_id: 'song-target',
          created_at: '2026-10-16T10:00:00Z',
          updated_at: '2026-10-16T10:00:00Z',
        },
      ]);

      // Legacy chords owned by usr-1
      vi.spyOn(smartChordRepo, 'getSmartChordsBySongId').mockResolvedValue([
        { id: 'chord-legacy', user_id: 'usr-1', title: 'Cifra Legada', original_key: 'E', content: '[E]' } as any,
      ]);

      vi.spyOn(smartChordRepo, 'getSmartChordById').mockImplementation(async (chordId: string, userId: string) => {
        if (chordId === 'chord-canon' && userId === 'usr-1') {
          return { id: 'chord-canon', user_id: 'usr-1', title: 'Cifra Canônica', original_key: 'A', content: '[A]' } as any;
        }
        throw new AppError(404, 'Not found');
      });

      const result = await service.getMySmartChordsForSong('usr-1', 'min-alpha', 'song-target');

      // User 2's chord is NOT returned!
      expect(result).toHaveLength(2);
      expect(result.map(c => c.id).sort()).toEqual(['chord-canon', 'chord-legacy']);
    });

    it('deduplicates when chord has both canonical link and legacy song_id', async () => {
      vi.spyOn(ministryRepo, 'getMinistryById').mockResolvedValue({ id: 'min-alpha' } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-target',
        ministry_id: 'min-alpha',
      } as any);

      vi.spyOn(smartChordLinkRepo, 'getLinksBySongId').mockResolvedValue([
        {
          id: 'usr-1_chord-dup_min-alpha',
          user_id: 'usr-1',
          smart_chord_id: 'chord-dup',
          ministry_id: 'min-alpha',
          song_id: 'song-target',
          created_at: '2026-10-16T10:00:00Z',
          updated_at: '2026-10-16T10:00:00Z',
        },
      ]);

      vi.spyOn(smartChordRepo, 'getSmartChordsBySongId').mockResolvedValue([
        { id: 'chord-dup', user_id: 'usr-1', title: 'Cifra Dupla', original_key: 'C', content: '[C]' } as any,
      ]);

      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-dup',
        user_id: 'usr-1',
        title: 'Cifra Dupla',
        original_key: 'C',
        content: '[C]',
      } as any);

      const result = await service.getMySmartChordsForSong('usr-1', 'min-alpha', 'song-target');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('chord-dup');
    });
  });

  describe('6. Multi-ministry Coexistence & Personal Chord Portability', () => {
    it('user can link same chord to Song Alpha in Ministry Alpha and Song Beta in Ministry Beta', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-portable',
        user_id: 'usr-1',
      } as any);

      vi.spyOn(ministryRepo, 'getMinistryById').mockImplementation(async (minId) => ({ id: minId } as any));

      vi.spyOn(repertoireRepo, 'findSongById').mockImplementation(async (songId) => {
        if (songId === 'song-alpha') return { id: 'song-alpha', ministry_id: 'min-alpha', title: 'Song Alpha' } as any;
        if (songId === 'song-beta') return { id: 'song-beta', ministry_id: 'min-beta', title: 'Song Beta' } as any;
        return null;
      });

      const linkAlpha = await service.setRepertoireLink('usr-1', 'chord-portable', 'min-alpha', 'song-alpha');
      const linkBeta = await service.setRepertoireLink('usr-1', 'chord-portable', 'min-beta', 'song-beta');

      expect(linkAlpha.link?.song_id).toBe('song-alpha');
      expect(linkBeta.link?.song_id).toBe('song-beta');
    });

    it('updating chord text/key succeeds even if chord contains an orphaned or foreign artist_id', async () => {
      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'chord-with-foreign-artist',
        user_id: 'usr-1',
        artist_id: 'art-foreign-orphaned',
        song_id: 'song-foreign-orphaned',
        title: 'Original Title',
      } as any);

      const updateSpy = vi.spyOn(smartChordRepo, 'updateSmartChord').mockResolvedValue({
        id: 'chord-with-foreign-artist',
        user_id: 'usr-1',
        title: 'Updated Title',
        artist_name: 'Novo Artista Texto',
      } as any);

      // Payload updates only title and artist_name without sending artist_id or song_id
      const result = await service.updateSmartChord('chord-with-foreign-artist', 'usr-1', {
        title: 'Updated Title',
        artist_name: 'Novo Artista Texto',
      });

      expect(updateSpy).toHaveBeenCalledWith('chord-with-foreign-artist', 'usr-1', {
        title: 'Updated Title',
        artist_name: 'Novo Artista Texto',
      });
      expect(result.title).toBe('Updated Title');
    });
  });

  describe('7. Controller Route Integration & Error Mapping', () => {
    it('getRepertoireLink controller returns 200 with result', async () => {
      const getSpy = vi.spyOn(service, 'getRepertoireLink').mockResolvedValue({
        link: {
          id: 'link-1',
          user_id: 'usr-1',
          smart_chord_id: 'chord-1',
          ministry_id: 'min-1',
          song_id: 'song-1',
          created_at: '2026-10-16T12:00:00Z',
          updated_at: '2026-10-16T12:00:00Z',
        },
        song: {
          id: 'song-1',
          ministry_id: 'min-1',
          title: 'Música 1',
        },
      });

      const req = {
        user: { id: 'usr-1' },
        params: { ministryId: 'min-1', chordId: 'chord-1' },
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as any;
      const next = vi.fn();

      await controller.getRepertoireLink(req, res, next);

      expect(getSpy).toHaveBeenCalledWith('usr-1', 'chord-1', 'min-1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ link: expect.objectContaining({ song_id: 'song-1' }) })
      );
    });

    it('setRepertoireLink controller validates schema and forwards AppError on invalid payload', async () => {
      const req = {
        user: { id: 'usr-1' },
        params: { ministryId: 'min-1', chordId: 'chord-1' },
        body: { song_id: '   ' }, // invalid whitespace
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next = vi.fn();

      await controller.setRepertoireLink(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    });

    it('removeRepertoireLink controller returns 204 No Content', async () => {
      const removeSpy = vi.spyOn(service, 'removeRepertoireLink').mockResolvedValue(undefined);

      const req = {
        user: { id: 'usr-1' },
        params: { ministryId: 'min-1', chordId: 'chord-1' },
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as any;
      const next = vi.fn();

      await controller.removeRepertoireLink(req, res, next);

      expect(removeSpy).toHaveBeenCalledWith('usr-1', 'chord-1', 'min-1');
      expect(res.status).toHaveBeenCalledWith(204);
    });

    it('getMySmartChordsForSong controller returns 200 with data envelope', async () => {
      const getSpy = vi.spyOn(service, 'getMySmartChordsForSong').mockResolvedValue([
        { id: 'chord-1', title: 'Cifra 1' } as any,
      ]);

      const req = {
        user: { id: 'usr-1' },
        params: { ministryId: 'min-1', songId: 'song-1' },
      } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      } as any;
      const next = vi.fn();

      await controller.getMySmartChordsForSong(req, res, next);

      expect(getSpy).toHaveBeenCalledWith('usr-1', 'min-1', 'song-1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        data: [{ id: 'chord-1', title: 'Cifra 1' }],
      });
    });
  });

  describe('7. Collision Safety & Defensive Tuple Validation (F-M19-01 & F-M19-07)', () => {
    it('COLLISION_TEST: generates unique SHA-256 document IDs for ambiguous underscore tuples', () => {
      const realLinkRepo = new SmartChordLinkRepository();
      const tuples: [string, string, string][] = [
        ['usr', 'c_1', 'm1'],
        ['usr_c', '1', 'm1'],
        ['usr', 'c', '1_m1'],
        ['u_a', 'b', 'c'],
        ['u', 'a_b', 'c'],
        ['user_1', 'chord', 'min1'],
        ['user', '1_chord', 'min1'],
        ['user', 'chord', '1_min1'],
      ];

      const ids = tuples.map(([u, c, m]) => realLinkRepo.buildLinkId(u, c, m));
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(tuples.length);
      ids.forEach((id) => {
        expect(id).toMatch(/^[a-f0-9]{64}$/);
      });
    });

    it('DEFENSIVE_TUPLE_GUARD_TEST: getLink fails closed if stored document fields diverge from requested tuple', async () => {
      const realLinkRepo = new SmartChordLinkRepository();
      const mockDoc = {
        exists: true,
        id: 'some-hash',
        data: () => ({
          user_id: 'attacker-user',
          smart_chord_id: 'chord-1',
          ministry_id: 'min-1',
          song_id: 'song-1',
        }),
      };
      const docRef = { get: vi.fn().mockResolvedValue(mockDoc) };
      (realLinkRepo as any).linksCol = { doc: vi.fn().mockReturnValue(docRef) };

      const result = await realLinkRepo.getLink('legitimate-user', 'chord-1', 'min-1');
      expect(result).toBeNull();
    });

    it('DEFENSIVE_TUPLE_GUARD_TEST: deleteLink refuses to delete and returns false if stored document belongs to another tuple', async () => {
      const realLinkRepo = new SmartChordLinkRepository();
      const deleteFn = vi.fn().mockResolvedValue(undefined);
      const mockDoc = {
        exists: true,
        data: () => ({
          user_id: 'other-user',
          smart_chord_id: 'chord-1',
          ministry_id: 'min-1',
        }),
      };
      const docRef = {
        get: vi.fn().mockResolvedValue(mockDoc),
        delete: deleteFn,
      };
      (realLinkRepo as any).linksCol = { doc: vi.fn().mockReturnValue(docRef) };

      const deleted = await realLinkRepo.deleteLink('target-user', 'chord-1', 'min-1');
      expect(deleted).toBe(false);
      expect(deleteFn).not.toHaveBeenCalled();
    });
  });

  describe('8. Firestore Cascade Batch Safety for 505+ documents (F-M19-03)', () => {
    it('CASCADE_505_PLUS_TEST: deleteLinksByMinistryId chunks 505 documents into batches <= 450 without throwing', async () => {
      const realLinkRepo = new SmartChordLinkRepository();
      const commits: any[][] = [];

      // Create 505 fake document references
      const totalDocs = 505;
      const fakeDocs = Array.from({ length: totalDocs }, (_, i) => ({
        id: `link-doc-${i}`,
        ref: { id: `link-doc-${i}` },
      }));

      let cursor = 0;
      const mockQuery = {
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockImplementation((chunkSize: number) => ({
          get: vi.fn().mockImplementation(async () => {
            const chunk = fakeDocs.slice(cursor, cursor + chunkSize);
            cursor += chunk.length;
            return {
              empty: chunk.length === 0,
              size: chunk.length,
              docs: chunk,
            };
          }),
        })),
      };

      (realLinkRepo as any).linksCol = mockQuery;

      // Mock Firestore batch
      const { db } = await import('../../lib/firebase');
      const originalBatch = db.batch;
      vi.spyOn(db, 'batch').mockImplementation(() => {
        const deletedInThisBatch: any[] = [];
        return {
          delete: (ref: any) => {
            deletedInThisBatch.push(ref);
          },
          commit: async () => {
            expect(deletedInThisBatch.length).toBeLessThanOrEqual(450);
            commits.push([...deletedInThisBatch]);
          },
        } as any;
      });

      await realLinkRepo.deleteLinksByMinistryId('target-min');

      // Verify that 505 items were processed in multiple batches (450 + 55)
      expect(commits.length).toBe(2);
      expect(commits[0].length).toBe(450);
      expect(commits[1].length).toBe(55);

      const totalDeleted = commits.reduce((sum, batch) => sum + batch.length, 0);
      expect(totalDeleted).toBe(505);

      db.batch = originalBatch;
    });
  });
});
