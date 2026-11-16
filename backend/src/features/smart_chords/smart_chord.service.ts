import { SmartChordRepository } from '../../repositories/SmartChordRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { RepertoireRepository } from '../../repositories/RepertoireRepository';
import { SmartChordLinkRepository } from '../../repositories/SmartChordLinkRepository';
import {
  SmartChord,
  SmartChordSongLink,
  SmartChordSongLinkPendingReason,
  SmartChordSongLinkStatus,
  SmartChordRepertoireLinkResponse,
  SmartChordSongSummary,
} from './smart_chord.types';
import {
  extractEffectiveSongVersions,
  normalizeRequestedVersionId,
  resolveVersionForLink,
  toPublicSongVersions,
} from './smart_chord_version';
import { AppError } from '../../middleware/error-handler';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export class SmartChordService {
  constructor(
    private readonly smartChordRepository: SmartChordRepository = new SmartChordRepository(),
    private readonly ministryRepository: MinistryRepository = new MinistryRepository(),
    private readonly repertoireRepository: RepertoireRepository = new RepertoireRepository(),
    private readonly smartChordLinkRepository: SmartChordLinkRepository = new SmartChordLinkRepository(),
  ) {}

  private async resolveArtistName(song: any): Promise<string | null> {
    if (!song?.artist_id) return null;
    const artist = await this.repertoireRepository.findArtistById(song.artist_id);
    return artist?.name || null;
  }

  private buildSongSummary(song: any, artistName: string | null): SmartChordSongSummary {
    return {
      id: song.id,
      ministry_id: song.ministry_id,
      title: song.title,
      artist_id: song.artist_id,
      artist_name: artistName,
      original_key: song.original_key,
      versions: toPublicSongVersions(song),
    };
  }

  private assertMinistryAdminRole(ministry: { role?: string } | null | undefined): void {
    if (ministry?.role !== 'admin') {
      throw new AppError(
        403,
        'Ação restrita a administradores do ministério. Seu perfil possui permissão apenas de leitura.'
      );
    }
  }

  private async validateSongAndArtistAccess(
    userId: string,
    songId?: string | null,
    artistId?: string | null,
    versionId?: string | null,
    options?: { requireSongAdmin?: boolean }
  ): Promise<void> {
    let songMinistryId: string | null = null;
    let songArtistId: string | null = null;

    if (songId) {
      const song = await this.repertoireRepository.findSongById(songId);
      if (!song) {
        throw new AppError(404, 'Música vinculada não encontrada.');
      }
      if (song.ministry_id) {
        const ministry = await this.ministryRepository.getMinistryById(song.ministry_id, userId);
        if (options?.requireSongAdmin) {
          this.assertMinistryAdminRole(ministry);
        }
        songMinistryId = song.ministry_id;
      }
      if (song.artist_id) {
        songArtistId = song.artist_id;
      }
      if (versionId !== undefined && versionId !== null && versionId.trim() !== '') {
        const normalizedVersion = normalizeRequestedVersionId(song, versionId);
        if (!normalizedVersion) {
          throw new AppError(404, 'Versão não encontrada nesta música.');
        }
      }
    } else if (versionId !== undefined && versionId !== null && versionId.trim() !== '') {
      throw new AppError(400, 'version_id exige song_id correspondente.');
    }

    if (artistId) {
      const artist = await this.repertoireRepository.findArtistById(artistId);
      if (!artist) {
        throw new AppError(404, 'Artista vinculado não encontrado.');
      }
      if (artist.ministry_id) {
        await this.ministryRepository.getMinistryById(artist.ministry_id, userId);
        if (songMinistryId && artist.ministry_id !== songMinistryId) {
          throw new AppError(400, 'A música e o artista vinculados devem pertencer ao mesmo ministério.');
        }
      }
      if (songArtistId && artistId !== songArtistId) {
        throw new AppError(400, 'O artista vinculado diverge do artista da música selecionada.');
      }
    }
  }

  async getSmartChords(
    userId: string,
    filters: {
      search?: string;
      page?: number;
      limit?: number;
    }
  ): Promise<PaginatedResponse<SmartChord>> {
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(Math.max(1, filters.limit || 50), 100);

    const list = await this.smartChordRepository.getSmartChords(userId, filters.search);
    const total = list.length;
    const startIndex = (page - 1) * limit;
    const pagedList = list.slice(startIndex, startIndex + limit);

    return {
      data: pagedList as SmartChord[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async getSmartChordsBySong(songId: string, userId: string): Promise<SmartChord[]> {
    const list = await this.smartChordRepository.getSmartChordsBySongId(songId, userId);
    return list as SmartChord[];
  }

  async getSmartChordById(id: string, userId: string): Promise<SmartChord> {
    return this.smartChordRepository.getSmartChordById(id, userId) as unknown as SmartChord;
  }

  private async syncCanonicalBridgeLink(
    userId: string,
    smartChordId: string,
    song: any,
    explicitVersionId?: string | null
  ): Promise<void> {
    if (!song?.ministry_id) return;

    if (explicitVersionId === undefined) {
      let existingCanonical: SmartChordSongLink | null = null;
      try {
        existingCanonical = await this.smartChordLinkRepository.getLink(userId, smartChordId, song.ministry_id);
      } catch {
        existingCanonical = null;
      }

      if (existingCanonical && existingCanonical.song_id === song.id) {
        if (existingCanonical.link_status === 'pending_classification') {
          return;
        }
        if (
          existingCanonical.version_id &&
          extractEffectiveSongVersions(song).some((v) => v.id === existingCanonical!.version_id)
        ) {
          return;
        }
      }
    }

    const resolution = resolveVersionForLink(song, explicitVersionId);
    if (resolution.status === 'resolved') {
      await this.smartChordLinkRepository.setLink(userId, smartChordId, song.ministry_id, song.id, {
        versionId: resolution.versionId,
        linkStatus: 'active',
        pendingReason: null,
      });
    } else if (resolution.status === 'version_required') {
      await this.smartChordLinkRepository.setLink(userId, smartChordId, song.ministry_id, song.id, {
        versionId: null,
        linkStatus: 'pending_classification',
        pendingReason: 'legacy_ambiguous',
      });
    } else {
      throw new AppError(404, 'Versão não encontrada nesta música.');
    }
  }

  async createSmartChord(
    userId: string,
    data: Partial<SmartChord> & { version_id?: string | null }
  ): Promise<SmartChord> {
    const { version_id: explicitVersionId, ...chordData } = data;
    await this.validateSongAndArtistAccess(userId, chordData.song_id, chordData.artist_id, explicitVersionId, {
      requireSongAdmin: Boolean(chordData.song_id || explicitVersionId),
    });

    // Se artist_id foi fornecido sem artist_name, tentar resolver artist_name automaticamente
    if (chordData.artist_id && !chordData.artist_name) {
      try {
        const artist = await this.repertoireRepository.findArtistById(chordData.artist_id);
        if (artist?.name) {
          chordData.artist_name = artist.name;
        }
      } catch {
        // Não falha caso não consiga resolver
      }
    }

    const created = await this.smartChordRepository.createSmartChord(userId, chordData) as unknown as SmartChord;

    // Se foi fornecido song_id (ex: via criação a partir de detalhes de música), sincroniza link canônico
    if (chordData.song_id) {
      const hasExplicitVersion = explicitVersionId !== undefined && explicitVersionId !== null;
      try {
        const song = await this.repertoireRepository.findSongById(chordData.song_id);
        if (song?.ministry_id) {
          await this.syncCanonicalBridgeLink(userId, created.id, song, explicitVersionId);
        }
      } catch (err) {
        if (hasExplicitVersion || err instanceof AppError) {
          if (hasExplicitVersion) {
            try {
              await this.smartChordRepository.deleteSmartChord(created.id, userId);
            } catch {
              // Melhor esforço para evitar cifra órfã sem a versão solicitada
            }
          }
          throw err;
        }
        // Ignora erro de infraestrutura apenas no auto-vínculo legado sem version_id explícito
      }
    }

    return created;
  }

  async updateSmartChord(
    id: string,
    userId: string,
    data: Partial<SmartChord> & { version_id?: string | null }
  ): Promise<SmartChord> {
    const { version_id: explicitVersionId, ...chordData } = data;
    const existing = await this.smartChordRepository.getSmartChordById(id, userId);

    const isMutatingSongLink = chordData.song_id !== undefined || explicitVersionId !== undefined;

    // Valida song e artist somente se song_id, artist_id ou version_id forem explicitamente passados no payload
    if (isMutatingSongLink || chordData.artist_id !== undefined) {
      const effectiveSongId = chordData.song_id !== undefined ? chordData.song_id : existing.song_id;
      const effectiveArtistId = chordData.artist_id !== undefined ? chordData.artist_id : existing.artist_id;
      await this.validateSongAndArtistAccess(userId, effectiveSongId, effectiveArtistId, explicitVersionId, {
        requireSongAdmin: isMutatingSongLink,
      });
    }

    // Se artist_id foi fornecido sem artist_name, tentar resolver artist_name automaticamente
    if (chordData.artist_id && !chordData.artist_name && !existing.artist_name) {
      try {
        const artist = await this.repertoireRepository.findArtistById(chordData.artist_id);
        if (artist?.name) {
          chordData.artist_name = artist.name;
        }
      } catch {
        // Não falha caso não consiga resolver
      }
    }

    // Bridge para clientes Web legados e clientes com version_id no update
    if (chordData.song_id !== undefined || (explicitVersionId !== undefined && existing.song_id)) {
      const targetSongId = chordData.song_id !== undefined ? chordData.song_id : existing.song_id;
      const hasExplicitVersion = explicitVersionId !== undefined && explicitVersionId !== null;
      if (targetSongId !== null && typeof targetSongId === 'string' && targetSongId.trim() !== '') {
        try {
          const song = await this.repertoireRepository.findSongById(targetSongId);
          if (song?.ministry_id) {
            const ministry = await this.ministryRepository.getMinistryById(song.ministry_id, userId);
            this.assertMinistryAdminRole(ministry);
            await this.syncCanonicalBridgeLink(userId, id, song, explicitVersionId);
          }
        } catch (err) {
          if (hasExplicitVersion || err instanceof AppError) {
            throw err;
          }
          // Ignora erro de infraestrutura apenas no auto-vínculo legado sem version_id explícito
        }
      } else if (chordData.song_id === null && existing.song_id) {
        // Se song_id foi explicitamente limpo, remove apenas o link do ministério da música anterior (somente admin)
        const prevSong = await this.repertoireRepository.findSongById(existing.song_id);
        if (prevSong?.ministry_id) {
          const ministry = await this.ministryRepository.getMinistryById(prevSong.ministry_id, userId);
          this.assertMinistryAdminRole(ministry);
          await this.smartChordLinkRepository.deleteLink(userId, id, prevSong.ministry_id);
        }
      }
    }

    return this.smartChordRepository.updateSmartChord(id, userId, chordData) as unknown as SmartChord;
  }

  async deleteSmartChord(id: string, userId: string): Promise<void> {
    await this.smartChordRepository.deleteSmartChord(id, userId);
  }

  // ─── Canonical Repertoire Link Operations ─────────────────────────

  private evaluateCanonicalLinkForSong(
    canonical: SmartChordSongLink,
    song: any
  ): {
    effectiveLink: SmartChordSongLink;
    isPending: boolean;
  } {
    const effectiveVersions = extractEffectiveSongVersions(song);
    const validVersionIds = new Set(effectiveVersions.map((v) => v.id));

    if (canonical.link_status === 'pending_classification') {
      return {
        isPending: true,
        effectiveLink: {
          ...canonical,
          version_id: null,
          link_status: 'pending_classification',
          pending_reason: canonical.pending_reason === 'version_removed' ? 'version_removed' : 'legacy_ambiguous',
        },
      };
    }

    const storedVersionId =
      typeof canonical.version_id === 'string' && canonical.version_id.trim() !== ''
        ? canonical.version_id.trim()
        : null;

    if (storedVersionId) {
      if (validVersionIds.has(storedVersionId)) {
        return {
          isPending: false,
          effectiveLink: {
            ...canonical,
            version_id: storedVersionId,
            link_status: 'active',
            pending_reason: null,
          },
        };
      }

      return {
        isPending: true,
        effectiveLink: {
          ...canonical,
          version_id: null,
          link_status: 'pending_classification',
          pending_reason: 'version_removed',
        },
      };
    }

    if (effectiveVersions.length === 1) {
      return {
        isPending: false,
        effectiveLink: {
          ...canonical,
          version_id: effectiveVersions[0].id,
          link_status: 'active',
          pending_reason: null,
        },
      };
    }

    return {
      isPending: true,
      effectiveLink: {
        ...canonical,
        version_id: null,
        link_status: 'pending_classification',
        pending_reason: 'legacy_ambiguous',
      },
    };
  }

  async getRepertoireLink(userId: string, smartChordId: string, ministryId: string): Promise<SmartChordRepertoireLinkResponse> {
    const chord = await this.smartChordRepository.getSmartChordById(smartChordId, userId);
    await this.ministryRepository.getMinistryById(ministryId, userId);

    // 1. Prioridade absoluta: link canônico em smart_chord_song_links
    const canonical = await this.smartChordLinkRepository.getLink(userId, smartChordId, ministryId);
    if (canonical) {
      const song = await this.repertoireRepository.findSongById(canonical.song_id);
      if (song && song.ministry_id === ministryId) {
        const artistName = await this.resolveArtistName(song);
        const songSummary = this.buildSongSummary(song, artistName);
        const evaluated = this.evaluateCanonicalLinkForSong(canonical, song);

        if (evaluated.isPending) {
          return {
            link: null,
            song: songSummary,
            pending_link: evaluated.effectiveLink,
            requires_version_selection: true,
          };
        }

        return {
          link: evaluated.effectiveLink,
          song: songSummary,
        };
      }
      return { link: null, song: null };
    }

    // 2. DUAL_READ_ONLY fallback: se não existe link canônico, verifica song_id legado (sem mutação no banco)
    if (chord.song_id) {
      const legacySong = await this.repertoireRepository.findSongById(chord.song_id);
      if (legacySong && legacySong.ministry_id === ministryId) {
        const artistName = await this.resolveArtistName(legacySong);
        const songSummary = this.buildSongSummary(legacySong, artistName);
        const effectiveVersions = extractEffectiveSongVersions(legacySong);
        const virtualBase: SmartChordSongLink = {
          id: this.smartChordLinkRepository.buildLinkId(userId, smartChordId, ministryId),
          user_id: userId,
          smart_chord_id: smartChordId,
          ministry_id: ministryId,
          song_id: legacySong.id,
          version_id: effectiveVersions.length === 1 ? effectiveVersions[0].id : null,
          link_status: effectiveVersions.length === 1 ? 'active' : 'pending_classification',
          pending_reason: effectiveVersions.length === 1 ? null : 'legacy_ambiguous',
          created_at: chord.created_at,
          updated_at: chord.updated_at,
        };

        if (virtualBase.link_status === 'pending_classification') {
          return {
            link: null,
            song: songSummary,
            pending_link: virtualBase,
            requires_version_selection: true,
          };
        }

        return {
          link: virtualBase,
          song: songSummary,
        };
      }
    }

    // 3. Não vinculado
    return { link: null, song: null };
  }

  async setRepertoireLink(
    userId: string,
    smartChordId: string,
    ministryId: string,
    songId: string,
    versionId?: string | null
  ): Promise<SmartChordRepertoireLinkResponse> {
    await this.smartChordRepository.getSmartChordById(smartChordId, userId);
    const ministry = await this.ministryRepository.getMinistryById(ministryId, userId);
    this.assertMinistryAdminRole(ministry);

    const song = await this.repertoireRepository.findSongById(songId);
    if (!song || song.ministry_id !== ministryId) {
      throw new AppError(404, 'Música não encontrada neste ministério.');
    }

    const resolution = resolveVersionForLink(song, versionId);
    if (resolution.status === 'version_not_found') {
      throw new AppError(404, 'Versão não encontrada nesta música.');
    }
    if (resolution.status === 'version_required') {
      throw new AppError(
        409,
        'Esta música possui múltiplas versões. Selecione uma versão para vincular a cifra.',
        {
          code: 'VERSION_SELECTION_REQUIRED',
          song_id: song.id,
          versions: toPublicSongVersions(song),
        }
      );
    }

    const link = await this.smartChordLinkRepository.setLink(userId, smartChordId, ministryId, songId, {
      versionId: resolution.versionId,
      linkStatus: 'active',
      pendingReason: null,
    });

    const artistName = await this.resolveArtistName(song);

    return {
      link,
      song: this.buildSongSummary(song, artistName),
    };
  }

  async removeRepertoireLink(userId: string, smartChordId: string, ministryId: string): Promise<void> {
    const chord = await this.smartChordRepository.getSmartChordById(smartChordId, userId);
    const ministry = await this.ministryRepository.getMinistryById(ministryId, userId);
    this.assertMinistryAdminRole(ministry);

    await this.smartChordLinkRepository.deleteLink(userId, smartChordId, ministryId);

    // Proteção contra ressurreição de vínculo legado:
    // Se a cifra continha song_id apontando para uma música deste mesmo ministério, limpa o song_id legado
    if (chord.song_id) {
      try {
        const legacySong = await this.repertoireRepository.findSongById(chord.song_id);
        if (legacySong?.ministry_id === ministryId) {
          await this.smartChordRepository.updateSmartChord(smartChordId, userId, { song_id: null });
        }
      } catch {
        // Não falha caso a música legada não exista mais
      }
    }
  }

  async getMySmartChordsForSong(
    userId: string,
    ministryId: string,
    songId: string,
    options?: { versionId?: string; linkStatus?: SmartChordSongLinkStatus }
  ): Promise<SmartChord[]> {
    const ministry = await this.ministryRepository.getMinistryById(ministryId, userId);

    const song = await this.repertoireRepository.findSongById(songId);
    if (!song || song.ministry_id !== ministryId) {
      throw new AppError(404, 'Música não encontrada neste ministério.');
    }

    if (options?.versionId && options?.linkStatus === 'pending_classification') {
      throw new AppError(400, 'Não é permitido combinar version_id com link_status=pending_classification.');
    }

    let filterVersionId: string | null = null;
    if (options?.versionId) {
      const normalizedVersion = normalizeRequestedVersionId(song, options.versionId);
      if (!normalizedVersion) {
        throw new AppError(404, 'Versão não encontrada nesta música.');
      }
      filterVersionId = normalizedVersion;
    }

    const requestedStatus: SmartChordSongLinkStatus = options?.linkStatus ?? 'active';
    const effectiveVersions = extractEffectiveSongVersions(song);

    // Membros comuns nunca gerenciam nem visualizam fila administrativa de classificação pendente
    if (requestedStatus === 'pending_classification') {
      if (ministry.role !== 'admin') {
        return [];
      }
      return this.getAdminPendingSmartChordsForSong(userId, ministryId, songId, song, effectiveVersions.length);
    }

    // Leitura compartilhada no ministério: somente vínculos ativos publicados por administradores ativos do ministério
    const adminUserIds = await this.ministryRepository.getAdminUserIds(ministryId);
    if (ministry.role === 'admin') {
      adminUserIds.add(userId);
    }
    if (typeof ministry.owner_user_id === 'string' && ministry.owner_user_id.trim()) {
      adminUserIds.add(ministry.owner_user_id.trim());
    }

    const allLinks = await this.smartChordLinkRepository.getLinksBySongIdForMinistry(ministryId, songId);
    const authorizedLinks = allLinks.filter(
      (l) => l.ministry_id === ministryId && l.song_id === songId && adminUserIds.has(l.user_id)
    );
    const canonicalChordIdsForSong = new Set(authorizedLinks.map((l) => l.smart_chord_id));

    const map = new Map<string, SmartChord>();
    for (const link of authorizedLinks) {
      const evaluated = this.evaluateCanonicalLinkForSong(link, song);
      if (evaluated.effectiveLink.link_status !== 'active') {
        continue;
      }
      if (filterVersionId && evaluated.effectiveLink.version_id !== filterVersionId) {
        continue;
      }

      try {
        const chord =
          link.user_id === userId
            ? await this.smartChordRepository.getSmartChordById(link.smart_chord_id, userId)
            : await this.smartChordRepository.getSmartChordByIdForMinistryRead(link.smart_chord_id, link.user_id);
        if (chord) {
          map.set(chord.id, {
            ...(chord as SmartChord),
            repertoire_link: evaluated.effectiveLink,
          });
        }
      } catch {
        // Cifra pode ter sido excluída
      }
    }

    // Fallback legado administrativo: somente song_id legado de admin com versão única inequívoca e não movido via vínculo canônico
    const legacyChords = await this.smartChordRepository.getSmartChordsBySongIdForMinistry(songId);
    for (const c of legacyChords as SmartChord[]) {
      if (!adminUserIds.has(c.user_id) || canonicalChordIdsForSong.has(c.id) || map.has(c.id)) {
        continue;
      }

      // Precedência canônica: checa no dono do registro se a cifra já foi movida para outra música neste ministério
      const canonicalElsewhere = await this.smartChordLinkRepository.getLink(c.user_id, c.id, ministryId);
      if (canonicalElsewhere) {
        continue;
      }

      const isSingleEffectiveVersion = effectiveVersions.length === 1;
      if (!isSingleEffectiveVersion) {
        continue;
      }
      const virtualVersionId: string = effectiveVersions[0].id;
      if (filterVersionId && virtualVersionId !== filterVersionId) {
        continue;
      }

      const virtualLink: SmartChordSongLink = {
        id: this.smartChordLinkRepository.buildLinkId(c.user_id, c.id, ministryId),
        user_id: c.user_id,
        smart_chord_id: c.id,
        ministry_id: ministryId,
        song_id: songId,
        version_id: virtualVersionId,
        link_status: 'active',
        pending_reason: null,
        created_at: c.created_at || '',
        updated_at: c.updated_at || '',
      };

      map.set(c.id, {
        ...c,
        repertoire_link: virtualLink,
      });
    }

    const result = Array.from(map.values());
    return result.sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
  }

  private async getAdminPendingSmartChordsForSong(
    userId: string,
    ministryId: string,
    songId: string,
    song: any,
    effectiveVersionsCount: number
  ): Promise<SmartChord[]> {
    const links = await this.smartChordLinkRepository.getLinksBySongId(ministryId, songId, userId);
    const userLinks = links.filter((l) => l.user_id === userId);
    const canonicalChordIdsForSong = new Set(userLinks.map((l) => l.smart_chord_id));

    const map = new Map<string, SmartChord>();
    for (const link of userLinks) {
      const evaluated = this.evaluateCanonicalLinkForSong(link, song);
      if (evaluated.effectiveLink.link_status !== 'pending_classification') {
        continue;
      }

      try {
        const chord = await this.smartChordRepository.getSmartChordById(link.smart_chord_id, userId);
        if (chord) {
          map.set(chord.id, {
            ...(chord as SmartChord),
            repertoire_link: evaluated.effectiveLink,
          });
        }
      } catch {
        // Cifra pode ter sido excluída
      }
    }

    const legacyChords = await this.smartChordRepository.getSmartChordsBySongId(songId, userId);
    for (const c of legacyChords as SmartChord[]) {
      if (canonicalChordIdsForSong.has(c.id) || map.has(c.id)) {
        continue;
      }

      const canonicalElsewhere = await this.smartChordLinkRepository.getLink(userId, c.id, ministryId);
      if (canonicalElsewhere) {
        continue;
      }

      if (effectiveVersionsCount === 1) {
        continue;
      }

      const virtualLink: SmartChordSongLink = {
        id: this.smartChordLinkRepository.buildLinkId(userId, c.id, ministryId),
        user_id: userId,
        smart_chord_id: c.id,
        ministry_id: ministryId,
        song_id: songId,
        version_id: null,
        link_status: 'pending_classification',
        pending_reason: 'legacy_ambiguous',
        created_at: c.created_at || '',
        updated_at: c.updated_at || '',
      };

      map.set(c.id, {
        ...c,
        repertoire_link: virtualLink,
      });
    }

    const result = Array.from(map.values());
    return result.sort((a, b) => (b.updated_at || b.created_at || '').localeCompare(a.updated_at || a.created_at || ''));
  }
}

const instance = new SmartChordService();

export const getSmartChords = (u: string, f: any) => instance.getSmartChords(u, f);
export const getSmartChordsBySong = (s: string, u: string) => instance.getSmartChordsBySong(s, u);
export const getSmartChordById = (id: string, u: string) => instance.getSmartChordById(id, u);
export const createSmartChord = (u: string, d: any) => instance.createSmartChord(u, d);
export const updateSmartChord = (id: string, u: string, d: any) => instance.updateSmartChord(id, u, d);
export const deleteSmartChord = (id: string, u: string) => instance.deleteSmartChord(id, u);
export const getRepertoireLink = (u: string, c: string, m: string) => instance.getRepertoireLink(u, c, m);
export const setRepertoireLink = (u: string, c: string, m: string, s: string, v?: string | null) =>
  instance.setRepertoireLink(u, c, m, s, v);
export const removeRepertoireLink = (u: string, c: string, m: string) => instance.removeRepertoireLink(u, c, m);
export const getMySmartChordsForSong = (
  u: string,
  m: string,
  s: string,
  options?: { versionId?: string; linkStatus?: SmartChordSongLinkStatus }
) => instance.getMySmartChordsForSong(u, m, s, options);
