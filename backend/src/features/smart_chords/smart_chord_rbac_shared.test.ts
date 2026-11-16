import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { config } from '../../config/unifiedConfig';
import { AppError } from '../../middleware/error-handler';
import { AccountDeletionRepository } from '../../repositories/AccountDeletionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { RepertoireRepository } from '../../repositories/RepertoireRepository';
import { SmartChordLinkRepository } from '../../repositories/SmartChordLinkRepository';
import { SmartChordRepository } from '../../repositories/SmartChordRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { SmartChordService } from './smart_chord.service';

async function startTestServer() {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind test HTTP server');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function makeAuthHeader(uid: string, email = `${uid}@louvaio.test`): string {
  const token = jwt.sign({ uid, email }, config.jwtSecret, { expiresIn: '1h' });
  return `Bearer ${token}`;
}

describe('Smart Chords R2.2: RBAC Admin vs Member & Shared Ministry Visibility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AccountDeletionRepository.prototype, 'isDeletionPending').mockResolvedValue(false);
    vi.spyOn(RepertoireRepository.prototype, 'findArtistById').mockResolvedValue(null);
    vi.spyOn(RepertoireRepository.prototype, 'findSongById').mockResolvedValue(null);
    vi.spyOn(UserRepository.prototype, 'verifyToken').mockImplementation(async (token: string) => {
      const decoded = jwt.verify(token, config.jwtSecret) as { uid: string; email: string };
      return decoded as any;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTTP Route Enforcement (App + Auth + RBAC + Controller)', () => {
    it('blocks member (403) from PUT/DELETE repertoire-link while allowing admin (200/204) including legacy groups alias', async () => {
      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockImplementation(
        async (ministryId: string, userId?: string) => {
          if (ministryId !== 'min-alpha') {
            throw new AppError(403, 'Acesso negado a este ministério.');
          }
          if (userId === 'usr-admin') {
            return { id: 'min-alpha', name: 'Louvor', role: 'admin' } as any;
          }
          if (userId === 'usr-member') {
            return { id: 'min-alpha', name: 'Louvor', role: 'member' } as any;
          }
          throw new AppError(403, 'Usuário não pertence a este ministério.');
        }
      );
      vi.spyOn(RepertoireRepository.prototype, 'findSongById').mockResolvedValue({
        id: 'song-1',
        ministry_id: 'min-alpha',
        title: 'Santo Espírito',
        artist_id: 'art-1',
        versions: [{ id: 'ver-1', name: 'Original', key: 'E' }],
      } as any);
      vi.spyOn(RepertoireRepository.prototype, 'findArtistById').mockResolvedValue({
        id: 'art-1',
        ministry_id: 'min-alpha',
        name: 'Laura Souguellis',
      } as any);
      vi.spyOn(SmartChordRepository.prototype, 'getSmartChordById').mockResolvedValue({
        id: 'chord-admin',
        user_id: 'usr-admin',
        title: 'Santo Espírito',
        original_key: 'E',
        content: '[E]Santo',
        song_id: null,
        created_at: '2026-11-15T10:00:00Z',
        updated_at: '2026-11-15T10:00:00Z',
      } as any);
      vi.spyOn(SmartChordRepository.prototype, 'updateSmartChord').mockResolvedValue({
        id: 'chord-admin',
        user_id: 'usr-admin',
        title: 'Santo Espírito',
        original_key: 'E',
        content: '[E]Santo',
        song_id: 'song-1',
      } as any);
      const setLinkSpy = vi.spyOn(SmartChordLinkRepository.prototype, 'setLink').mockResolvedValue({
        id: 'lnk-1',
        user_id: 'usr-admin',
        smart_chord_id: 'chord-admin',
        ministry_id: 'min-alpha',
        song_id: 'song-1',
        version_id: 'ver-1',
        link_status: 'active',
        pending_reason: null,
        created_at: '2026-11-15T10:00:00Z',
        updated_at: '2026-11-15T10:00:00Z',
      });
      vi.spyOn(SmartChordLinkRepository.prototype, 'getLink').mockResolvedValue({
        id: 'lnk-1',
        user_id: 'usr-admin',
        smart_chord_id: 'chord-admin',
        ministry_id: 'min-alpha',
        song_id: 'song-1',
        version_id: 'ver-1',
        link_status: 'active',
        pending_reason: null,
        created_at: '2026-11-15T10:00:00Z',
        updated_at: '2026-11-15T10:00:00Z',
      });
      const deleteLinkSpy = vi.spyOn(SmartChordLinkRepository.prototype, 'deleteLink').mockResolvedValue(true);

      const server = await startTestServer();
      try {
        // Member attempts PUT via canonical and legacy /groups/ routes -> 403
        const memberPutRes = await fetch(
          `${server.baseUrl}/api/v1/ministries/min-alpha/smart-chords/chord-admin/repertoire-link`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: makeAuthHeader('usr-member'),
            },
            body: JSON.stringify({ song_id: 'song-1', version_id: 'ver-1' }),
          }
        );
        expect(memberPutRes.status).toBe(403);
        expect(setLinkSpy).not.toHaveBeenCalled();

        const memberLegacyPutRes = await fetch(
          `${server.baseUrl}/api/v1/groups/min-alpha/smart-chords/chord-admin/repertoire-link`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: makeAuthHeader('usr-member'),
            },
            body: JSON.stringify({ song_id: 'song-1', version_id: 'ver-1' }),
          }
        );
        expect(memberLegacyPutRes.status).toBe(403);
        expect(setLinkSpy).not.toHaveBeenCalled();

        // Member attempts DELETE -> 403
        const memberDeleteRes = await fetch(
          `${server.baseUrl}/api/v1/ministries/min-alpha/smart-chords/chord-admin/repertoire-link`,
          {
            method: 'DELETE',
            headers: { Authorization: makeAuthHeader('usr-member') },
          }
        );
        expect(memberDeleteRes.status).toBe(403);
        expect(deleteLinkSpy).not.toHaveBeenCalled();

        // Admin PUT -> 200 and DELETE -> 204
        const adminPutRes = await fetch(
          `${server.baseUrl}/api/v1/ministries/min-alpha/smart-chords/chord-admin/repertoire-link`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Authorization: makeAuthHeader('usr-admin'),
            },
            body: JSON.stringify({ song_id: 'song-1', version_id: 'ver-1' }),
          }
        );
        expect(adminPutRes.status).toBe(200);
        expect(setLinkSpy).toHaveBeenCalledTimes(1);

        const adminDeleteRes = await fetch(
          `${server.baseUrl}/api/v1/groups/min-alpha/smart-chords/chord-admin/repertoire-link`,
          {
            method: 'DELETE',
            headers: { Authorization: makeAuthHeader('usr-admin') },
          }
        );
        expect(adminDeleteRes.status).toBe(204);
        expect(deleteLinkSpy).toHaveBeenCalledTimes(1);
      } finally {
        await server.close();
      }
    });

    it('blocks member (403) when linking or unlinking via POST/PUT /smart-chords while preserving personal CRUD and 404 IDOR protection', async () => {
      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockImplementation(
        async (ministryId: string, userId?: string) => {
          if (userId === 'usr-member') {
            return { id: ministryId, name: 'Louvor', role: 'member' } as any;
          }
          return { id: ministryId, name: 'Louvor', role: 'admin' } as any;
        }
      );
      vi.spyOn(RepertoireRepository.prototype, 'findSongById').mockResolvedValue({
        id: 'song-1',
        ministry_id: 'min-alpha',
        title: 'Santo Espírito',
        versions: [{ id: 'ver-1', name: 'Original', key: 'C' }],
      } as any);
      vi.spyOn(SmartChordRepository.prototype, 'getSmartChordById').mockImplementation(
        async (id: string, userId: string) => {
          if (id === 'chord-member' && userId === 'usr-member') {
            return {
              id: 'chord-member',
              user_id: 'usr-member',
              title: 'Cifra Pessoal',
              original_key: 'G',
              content: '[G]Teste',
              ministry_id: 'min-alpha',
              song_id: null,
            } as any;
          }
          if (id === 'chord-member-linked' && userId === 'usr-member') {
            return {
              id: 'chord-member-linked',
              user_id: 'usr-member',
              title: 'Cifra Antiga Vinculada',
              original_key: 'C',
              content: '[C]Teste',
              ministry_id: 'min-alpha',
              song_id: 'song-1',
            } as any;
          }
          throw new AppError(404, 'Cifra não encontrada.');
        }
      );
      const createSpy = vi.spyOn(SmartChordRepository.prototype, 'createSmartChord').mockResolvedValue({
        id: 'chord-personal-new',
        user_id: 'usr-member',
        title: 'Estudo Pessoal',
        original_key: 'C',
        content: '[C]Estudo',
        song_id: null,
      } as any);
      const updateSpy = vi.spyOn(SmartChordRepository.prototype, 'updateSmartChord').mockResolvedValue({
        id: 'chord-member',
        user_id: 'usr-member',
        title: 'Editada Pessoal',
        original_key: 'G',
        content: '[G]Teste',
        song_id: null,
      } as any);

      const server = await startTestServer();
      try {
        // 1) Member trying to create a repertoire-linked chord -> 403
        const createLinkedRes = await fetch(`${server.baseUrl}/api/v1/smart-chords`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: makeAuthHeader('usr-member'),
          },
          body: JSON.stringify({
            title: 'Vinculada Indevida',
            original_key: 'C',
            content: '[C]Letra',
            ministry_id: 'min-alpha',
            song_id: 'song-1',
            version_id: 'ver-1',
          }),
        });
        expect(createLinkedRes.status).toBe(403);
        expect(createSpy).not.toHaveBeenCalled();

        // 2) Member creating a pure personal chord (no song_id/version_id) -> 201
        const createPersonalRes = await fetch(`${server.baseUrl}/api/v1/smart-chords`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: makeAuthHeader('usr-member'),
          },
          body: JSON.stringify({
            title: 'Estudo Pessoal',
            original_key: 'C',
            content: '[C]Estudo',
          }),
        });
        expect(createPersonalRes.status).toBe(201);
        expect(createSpy).toHaveBeenCalledTimes(1);

        // 3) Member trying to link via PUT /smart-chords/:id -> 403
        const updateLinkRes = await fetch(`${server.baseUrl}/api/v1/smart-chords/chord-member`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: makeAuthHeader('usr-member'),
          },
          body: JSON.stringify({
            ministry_id: 'min-alpha',
            song_id: 'song-1',
          }),
        });
        expect(updateLinkRes.status).toBe(403);
        expect(updateSpy).not.toHaveBeenCalled();

        // 4) Member trying to unlink an already-linked chord via PUT /smart-chords/:id with song_id: null -> 403
        const deleteLinkSpy = vi.spyOn(SmartChordLinkRepository.prototype, 'deleteLink');
        const updateUnlinkRes = await fetch(`${server.baseUrl}/api/v1/smart-chords/chord-member-linked`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: makeAuthHeader('usr-member'),
          },
          body: JSON.stringify({
            ministry_id: 'min-alpha',
            song_id: null,
          }),
        });
        expect(updateUnlinkRes.status).toBe(403);
        expect(deleteLinkSpy).not.toHaveBeenCalled();
        expect(updateSpy).not.toHaveBeenCalled();

        // 5) Member editing own personal content without song_id/version_id -> 200
        const updatePersonalRes = await fetch(`${server.baseUrl}/api/v1/smart-chords/chord-member`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: makeAuthHeader('usr-member'),
          },
          body: JSON.stringify({
            title: 'Editada Pessoal',
          }),
        });
        expect(updatePersonalRes.status).toBe(200);
        expect(updateSpy).toHaveBeenCalledTimes(1);

        // 6) Member attempting personal IDOR GET /smart-chords/chord-admin -> 404
        const foreignReadRes = await fetch(`${server.baseUrl}/api/v1/smart-chords/chord-admin`, {
          headers: { Authorization: makeAuthHeader('usr-member') },
        });
        expect(foreignReadRes.status).toBe(404);
      } finally {
        await server.close();
      }
    });

    it('exposes admin-published chords to ministry members via /songs/:songId/my-smart-chords while hiding pending classification from members', async () => {
      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockImplementation(
        async (ministryId: string, userId?: string) => {
          if (ministryId !== 'min-alpha') {
            throw new AppError(403, 'Acesso negado a este ministério.');
          }
          if (userId === 'usr-admin-1' || userId === 'usr-admin-2') {
            return { id: 'min-alpha', name: 'Louvor', role: 'admin' } as any;
          }
          if (userId === 'usr-member') {
            return { id: 'min-alpha', name: 'Louvor', role: 'member' } as any;
          }
          throw new AppError(403, 'Sem vínculo com o ministério.');
        }
      );
      vi.spyOn(MinistryRepository.prototype, 'getAdminUserIds').mockResolvedValue(
        new Set(['usr-admin-1', 'usr-admin-2'])
      );
      vi.spyOn(RepertoireRepository.prototype, 'findSongById').mockResolvedValue({
        id: 'song-1',
        ministry_id: 'min-alpha',
        title: 'A Casa É Sua',
        versions: [
          { id: 'ver-1', name: 'Ao Vivo', key: 'G' },
          { id: 'ver-2', name: 'Acústico', key: 'D' },
        ],
      } as any);
      vi.spyOn(SmartChordLinkRepository.prototype, 'getLinksBySongIdForMinistry').mockResolvedValue([
        {
          id: 'lnk-a1',
          user_id: 'usr-admin-1',
          smart_chord_id: 'chord-a1',
          ministry_id: 'min-alpha',
          song_id: 'song-1',
          version_id: 'ver-1',
          link_status: 'active',
          pending_reason: null,
          created_at: '2026-11-15T10:00:00Z',
          updated_at: '2026-11-15T10:00:00Z',
        },
        {
          id: 'lnk-a2',
          user_id: 'usr-admin-2',
          smart_chord_id: 'chord-a2',
          ministry_id: 'min-alpha',
          song_id: 'song-1',
          version_id: 'ver-2',
          link_status: 'active',
          pending_reason: null,
          created_at: '2026-11-15T11:00:00Z',
          updated_at: '2026-11-15T11:00:00Z',
        },
        {
          id: 'lnk-nonadmin',
          user_id: 'usr-member',
          smart_chord_id: 'chord-member-stale',
          ministry_id: 'min-alpha',
          song_id: 'song-1',
          version_id: 'ver-1',
          link_status: 'active',
          pending_reason: null,
          created_at: '2026-11-15T12:00:00Z',
          updated_at: '2026-11-15T12:00:00Z',
        },
      ]);
      vi.spyOn(SmartChordRepository.prototype, 'getSmartChordsBySongIdForMinistry').mockResolvedValue([]);
      vi.spyOn(SmartChordRepository.prototype, 'getSmartChordByIdForMinistryRead').mockImplementation(
        async (id: string) => ({
          id,
          user_id: 'usr-admin-1',
          title: 'A Casa É Sua - Admin',
          original_key: 'G',
          content: '[G]Você é bem-vindo aqui',
          created_at: '2026-11-15T10:00:00Z',
          updated_at: '2026-11-15T10:00:00Z',
        } as any)
      );
      vi.spyOn(SmartChordLinkRepository.prototype, 'getLinksBySongId').mockResolvedValue([
        {
          id: 'lnk-pend',
          user_id: 'usr-admin-1',
          smart_chord_id: 'chord-pend',
          ministry_id: 'min-alpha',
          song_id: 'song-1',
          version_id: null,
          link_status: 'pending_classification',
          pending_reason: 'legacy_ambiguous',
          created_at: '2026-11-15T09:00:00Z',
          updated_at: '2026-11-15T09:00:00Z',
        },
      ]);
      vi.spyOn(SmartChordRepository.prototype, 'getSmartChordsBySongId').mockResolvedValue([]);
      vi.spyOn(SmartChordRepository.prototype, 'getSmartChordById').mockResolvedValue({
        id: 'chord-pend',
        user_id: 'usr-admin-1',
        title: 'Pendente',
        original_key: 'G',
        content: '[G]Pendente',
      } as any);

      const server = await startTestServer();
      try {
        // Member reads ver-1 shared admin chords -> sees ONLY chord-a1 (not ver-2, not non-admin chord-member-stale)
        const memberV1Res = await fetch(
          `${server.baseUrl}/api/v1/ministries/min-alpha/songs/song-1/my-smart-chords?version_id=ver-1`,
          { headers: { Authorization: makeAuthHeader('usr-member') } }
        );
        expect(memberV1Res.status).toBe(200);
        const memberV1Json = await memberV1Res.json();
        expect(memberV1Json.data.map((c: any) => c.id)).toEqual(['chord-a1']);
        expect(memberV1Json.data[0].repertoire_link).toMatchObject({
          ministry_id: 'min-alpha',
          song_id: 'song-1',
          version_id: 'ver-1',
          link_status: 'active',
        });

        // Member queries pending_classification -> receives [] (does not see admin queue)
        const memberPendingRes = await fetch(
          `${server.baseUrl}/api/v1/ministries/min-alpha/songs/song-1/my-smart-chords?link_status=pending_classification`,
          { headers: { Authorization: makeAuthHeader('usr-member') } }
        );
        expect(memberPendingRes.status).toBe(200);
        const memberPendingJson = await memberPendingRes.json();
        expect(memberPendingJson.data).toEqual([]);

        // Admin queries pending_classification -> receives pending chord
        const adminPendingRes = await fetch(
          `${server.baseUrl}/api/v1/ministries/min-alpha/songs/song-1/my-smart-chords?link_status=pending_classification`,
          { headers: { Authorization: makeAuthHeader('usr-admin-1') } }
        );
        expect(adminPendingRes.status).toBe(200);
        const adminPendingJson = await adminPendingRes.json();
        expect(adminPendingJson.data.map((c: any) => c.id)).toEqual(['chord-pend']);

        // Cross-ministry outsider gets 403
        const outsiderRes = await fetch(
          `${server.baseUrl}/api/v1/ministries/min-beta/songs/song-1/my-smart-chords`,
          { headers: { Authorization: makeAuthHeader('usr-member') } }
        );
        expect(outsiderRes.status).toBe(403);
      } finally {
        await server.close();
      }
    });
  });

  describe('Service-level Shared Visibility & Isolation Guarantees', () => {
    it('blocks unpublished personal chords from leaking and isolates multiple ministries', async () => {
      const smartChordRepo = new SmartChordRepository();
      const ministryRepo = new MinistryRepository();
      const repertoireRepo = new RepertoireRepository();
      const smartChordLinkRepo = new SmartChordLinkRepository();
      const service = new SmartChordService(
        smartChordRepo,
        ministryRepo,
        repertoireRepo,
        smartChordLinkRepo
      );

      vi.spyOn(ministryRepo, 'getMinistryById').mockImplementation(async (minId, userId) => {
        if (minId === 'min-alpha' && userId === 'usr-member-alpha') {
          return { id: 'min-alpha', name: 'Alfa', role: 'member' } as any;
        }
        throw new AppError(403, 'Acesso negado ao ministério.');
      });
      vi.spyOn(ministryRepo, 'getAdminUserIds').mockResolvedValue(new Set(['usr-admin-alpha']));
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-alpha',
        ministry_id: 'min-alpha',
        title: 'Hino Alfa',
        original_key: 'C',
      } as any);
      // Unpublished personal chord has no link and no song_id; admin legacy chord on another song is in ministry list only if queried
      vi.spyOn(smartChordLinkRepo, 'getLinksBySongIdForMinistry').mockResolvedValue([]);
      vi.spyOn(smartChordRepo, 'getSmartChordsBySongIdForMinistry').mockResolvedValue([
        // Non-admin legacy chord must NEVER be returned even if song_id matches
        { id: 'chord-member-legacy', user_id: 'usr-other-member', song_id: 'song-alpha', title: 'Privada' } as any,
      ]);

      const memberAlphaChords = await service.getMySmartChordsForSong(
        'usr-member-alpha',
        'min-alpha',
        'song-alpha'
      );
      expect(memberAlphaChords).toEqual([]);

      await expect(
        service.getMySmartChordsForSong('usr-member-alpha', 'min-beta', 'song-alpha')
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('fails closed with zero writes when membership lookup errors during legacy song_id unlink (song_id: null)', async () => {
      const smartChordRepo = new SmartChordRepository();
      const ministryRepo = new MinistryRepository();
      const repertoireRepo = new RepertoireRepository();
      const smartChordLinkRepo = new SmartChordLinkRepository();
      const service = new SmartChordService(
        smartChordRepo,
        ministryRepo,
        repertoireRepo,
        smartChordLinkRepo
      );

      vi.spyOn(smartChordRepo, 'getSmartChordById').mockResolvedValue({
        id: 'own-chord',
        user_id: 'usr-member',
        song_id: 'song-a',
      } as any);
      vi.spyOn(repertoireRepo, 'findSongById').mockResolvedValue({
        id: 'song-a',
        ministry_id: 'min-a',
      } as any);
      vi.spyOn(ministryRepo, 'getMinistryById').mockRejectedValue(
        new Error('membership lookup unavailable')
      );
      const updateSpy = vi.spyOn(smartChordRepo, 'updateSmartChord');
      const deleteLinkSpy = vi.spyOn(smartChordLinkRepo, 'deleteLink');

      await expect(
        service.updateSmartChord('own-chord', 'usr-member', { song_id: null })
      ).rejects.toThrow('membership lookup unavailable');

      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteLinkSpy).not.toHaveBeenCalled();
    });

    it('prevents a secondary ministry admin from reading, updating, deleting or reclassifying another admin chord (404 & zero writes)', async () => {
      vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockImplementation(
        async (ministryId: string, userId?: string) => {
          if (ministryId === 'min-alpha' && (userId === 'usr-admin-1' || userId === 'usr-admin-2')) {
            return { id: 'min-alpha', name: 'Louvor', role: 'admin' } as any;
          }
          throw new AppError(403, 'Sem vínculo com o ministério.');
        }
      );
      vi.spyOn(SmartChordRepository.prototype, 'getSmartChordById').mockImplementation(
        async (id: string, userId: string) => {
          if (id === 'chord-a1' && userId === 'usr-admin-1') {
            return {
              id: 'chord-a1',
              user_id: 'usr-admin-1',
              title: 'Cifra Admin 1',
              original_key: 'G',
              content: '[G]Aleluia',
            } as any;
          }
          throw new AppError(404, 'Cifra inteligente não encontrada.');
        }
      );
      const updateSpy = vi.spyOn(SmartChordRepository.prototype, 'updateSmartChord');
      const deleteSpy = vi.spyOn(SmartChordRepository.prototype, 'deleteSmartChord').mockImplementation(
        async (id: string, userId: string) => {
          if (userId !== 'usr-admin-1' || id !== 'chord-a1') {
            throw new AppError(404, 'Cifra inteligente não encontrada.');
          }
          return true as any;
        }
      );
      const setLinkSpy = vi.spyOn(SmartChordLinkRepository.prototype, 'setLink');

      const server = await startTestServer();
      try {
        const foreignGet = await fetch(`${server.baseUrl}/api/v1/smart-chords/chord-a1`, {
          headers: { Authorization: makeAuthHeader('usr-admin-2') },
        });
        expect(foreignGet.status).toBe(404);

        const foreignPut = await fetch(`${server.baseUrl}/api/v1/smart-chords/chord-a1`, {
          method: 'PUT',
          headers: {
            Authorization: makeAuthHeader('usr-admin-2'),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title: 'Sequestrada' }),
        });
        expect(foreignPut.status).toBe(404);
        expect(updateSpy).not.toHaveBeenCalled();

        const foreignDel = await fetch(`${server.baseUrl}/api/v1/smart-chords/chord-a1`, {
          method: 'DELETE',
          headers: { Authorization: makeAuthHeader('usr-admin-2') },
        });
        expect(foreignDel.status).toBe(404);
        expect(deleteSpy).toHaveBeenCalledTimes(1);

        const foreignReclassify = await fetch(
          `${server.baseUrl}/api/v1/ministries/min-alpha/smart-chords/chord-a1/repertoire-link`,
          {
            method: 'PUT',
            headers: {
              Authorization: makeAuthHeader('usr-admin-2'),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ song_id: 'song-1', version_id: 'ver-1' }),
          }
        );
        expect(foreignReclassify.status).toBe(404);
        expect(setLinkSpy).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });
  });
});
