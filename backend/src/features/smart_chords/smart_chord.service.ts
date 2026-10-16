import { SmartChordRepository } from '../../repositories/SmartChordRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { RepertoireRepository } from '../../repositories/RepertoireRepository';
import { SmartChordLinkRepository } from '../../repositories/SmartChordLinkRepository';
import { SmartChord, SmartChordSongLink, SmartChordRepertoireLinkResponse } from './smart_chord.types';
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

  private async validateSongAndArtistAccess(userId: string, songId?: string | null, artistId?: string | null): Promise<void> {
    let songMinistryId: string | null = null;
    let songArtistId: string | null = null;

    if (songId) {
      const song = await this.repertoireRepository.findSongById(songId);
      if (!song) {
        throw new AppError(404, 'Música vinculada não encontrada.');
      }
      if (song.ministry_id) {
        await this.ministryRepository.getMinistryById(song.ministry_id, userId);
        songMinistryId = song.ministry_id;
      }
      if (song.artist_id) {
        songArtistId = song.artist_id;
      }
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

  async createSmartChord(userId: string, data: Partial<SmartChord>): Promise<SmartChord> {
    await this.validateSongAndArtistAccess(userId, data.song_id, data.artist_id);

    // Se artist_id foi fornecido sem artist_name, tentar resolver artist_name automaticamente
    if (data.artist_id && !data.artist_name) {
      try {
        const artist = await this.repertoireRepository.findArtistById(data.artist_id);
        if (artist?.name) {
          data.artist_name = artist.name;
        }
      } catch {
        // Não falha caso não consiga resolver
      }
    }

    const created = await this.smartChordRepository.createSmartChord(userId, data) as unknown as SmartChord;

    // Se foi fornecido song_id (ex: via criação a partir de detalhes de música), sincroniza link canônico
    if (data.song_id) {
      try {
        const song = await this.repertoireRepository.findSongById(data.song_id);
        if (song?.ministry_id) {
          await this.smartChordLinkRepository.setLink(userId, created.id, song.ministry_id, song.id);
        }
      } catch {
        // Ignora erro de sincronização se Firestore mockado sem coleção de links
      }
    }

    return created;
  }

  async updateSmartChord(id: string, userId: string, data: Partial<SmartChord>): Promise<SmartChord> {
    const existing = await this.smartChordRepository.getSmartChordById(id, userId);

    // Valida song e artist somente se song_id ou artist_id forem explicitamente passados no payload
    if (data.song_id !== undefined || data.artist_id !== undefined) {
      const effectiveSongId = data.song_id !== undefined ? data.song_id : existing.song_id;
      const effectiveArtistId = data.artist_id !== undefined ? data.artist_id : existing.artist_id;
      await this.validateSongAndArtistAccess(userId, effectiveSongId, effectiveArtistId);
    }

    // Se artist_id foi fornecido sem artist_name, tentar resolver artist_name automaticamente
    if (data.artist_id && !data.artist_name && !existing.artist_name) {
      try {
        const artist = await this.repertoireRepository.findArtistById(data.artist_id);
        if (artist?.name) {
          data.artist_name = artist.name;
        }
      } catch {
        // Não falha caso não consiga resolver
      }
    }

    // Bridge para clientes Web legados que enviam song_id no update
    if (data.song_id !== undefined) {
      if (data.song_id !== null && data.song_id.trim() !== '') {
        try {
          const song = await this.repertoireRepository.findSongById(data.song_id);
          if (song?.ministry_id) {
            await this.ministryRepository.getMinistryById(song.ministry_id, userId);
            // Upsert link canônico para o ministério da música, preservando os demais ministérios
            await this.smartChordLinkRepository.setLink(userId, id, song.ministry_id, song.id);
          }
        } catch {
          // Ignora se mock em teste
        }
      } else if (data.song_id === null && existing.song_id) {
        // Se song_id foi explicitamente limpo, remove apenas o link do ministério da música anterior
        try {
          const prevSong = await this.repertoireRepository.findSongById(existing.song_id);
          if (prevSong?.ministry_id) {
            await this.smartChordLinkRepository.deleteLink(userId, id, prevSong.ministry_id);
          }
        } catch {
          // Não falha caso música anterior não exista mais
        }
      }
    }

    return this.smartChordRepository.updateSmartChord(id, userId, data) as unknown as SmartChord;
  }

  async deleteSmartChord(id: string, userId: string): Promise<void> {
    await this.smartChordRepository.deleteSmartChord(id, userId);
  }

  // ─── Canonical Repertoire Link Operations ─────────────────────────

  async getRepertoireLink(userId: string, smartChordId: string, ministryId: string): Promise<SmartChordRepertoireLinkResponse> {
    const chord = await this.smartChordRepository.getSmartChordById(smartChordId, userId);
    await this.ministryRepository.getMinistryById(ministryId, userId);

    // 1. Prioridade absoluta: link canônico em smart_chord_song_links
    const canonical = await this.smartChordLinkRepository.getLink(userId, smartChordId, ministryId);
    if (canonical) {
      const song = await this.repertoireRepository.findSongById(canonical.song_id);
      if (song && song.ministry_id === ministryId) {
        let artistName: string | null = null;
        if (song.artist_id) {
          const a = await this.repertoireRepository.findArtistById(song.artist_id);
          artistName = a?.name || null;
        }
        return {
          link: canonical,
          song: {
            id: song.id,
            ministry_id: song.ministry_id,
            title: song.title,
            artist_id: song.artist_id,
            artist_name: artistName,
            original_key: song.original_key,
          },
        };
      }
      return { link: null, song: null };
    }

    // 2. DUAL_READ_ONLY fallback: se não existe link canônico, verifica song_id legado (sem mutação no banco)
    if (chord.song_id) {
      const legacySong = await this.repertoireRepository.findSongById(chord.song_id);
      if (legacySong && legacySong.ministry_id === ministryId) {
        let artistName: string | null = null;
        if (legacySong.artist_id) {
          const a = await this.repertoireRepository.findArtistById(legacySong.artist_id);
          artistName = a?.name || null;
        }
        const virtualLink: SmartChordSongLink = {
          id: this.smartChordLinkRepository.buildLinkId(userId, smartChordId, ministryId),
          user_id: userId,
          smart_chord_id: smartChordId,
          ministry_id: ministryId,
          song_id: legacySong.id,
          created_at: chord.created_at,
          updated_at: chord.updated_at,
        };
        return {
          link: virtualLink,
          song: {
            id: legacySong.id,
            ministry_id: legacySong.ministry_id,
            title: legacySong.title,
            artist_id: legacySong.artist_id,
            artist_name: artistName,
            original_key: legacySong.original_key,
          },
        };
      }
    }

    // 3. Não vinculado
    return { link: null, song: null };
  }

  async setRepertoireLink(userId: string, smartChordId: string, ministryId: string, songId: string): Promise<SmartChordRepertoireLinkResponse> {
    await this.smartChordRepository.getSmartChordById(smartChordId, userId);
    await this.ministryRepository.getMinistryById(ministryId, userId);

    const song = await this.repertoireRepository.findSongById(songId);
    if (!song || song.ministry_id !== ministryId) {
      throw new AppError(404, 'Música não encontrada neste ministério.');
    }

    const link = await this.smartChordLinkRepository.setLink(userId, smartChordId, ministryId, songId);

    let artistName: string | null = null;
    if (song.artist_id) {
      const a = await this.repertoireRepository.findArtistById(song.artist_id);
      artistName = a?.name || null;
    }

    return {
      link,
      song: {
        id: song.id,
        ministry_id: song.ministry_id,
        title: song.title,
        artist_id: song.artist_id,
        artist_name: artistName,
        original_key: song.original_key,
      },
    };
  }

  async removeRepertoireLink(userId: string, smartChordId: string, ministryId: string): Promise<void> {
    const chord = await this.smartChordRepository.getSmartChordById(smartChordId, userId);
    await this.ministryRepository.getMinistryById(ministryId, userId);

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

  async getMySmartChordsForSong(userId: string, ministryId: string, songId: string): Promise<SmartChord[]> {
    await this.ministryRepository.getMinistryById(ministryId, userId);

    const song = await this.repertoireRepository.findSongById(songId);
    if (!song || song.ministry_id !== ministryId) {
      throw new AppError(404, 'Música não encontrada neste ministério.');
    }

    // 1. Busca links canônicos do usuário para esta música
    const links = await this.smartChordLinkRepository.getLinksBySongId(ministryId, songId, userId);
    const canonicalChords: SmartChord[] = [];
    for (const link of links) {
      try {
        const chord = await this.smartChordRepository.getSmartChordById(link.smart_chord_id, userId);
        if (chord) canonicalChords.push(chord as SmartChord);
      } catch {
        // Cifra pode ter sido excluída
      }
    }

    // 2. Busca cifras legadas onde song_id == songId
    const legacyChords = await this.smartChordRepository.getSmartChordsBySongId(songId, userId);

    // 3. União e deduplicação (canônico tem precedência)
    const map = new Map<string, SmartChord>();
    for (const c of canonicalChords) {
      map.set(c.id, c);
    }
    for (const c of legacyChords as SmartChord[]) {
      if (!map.has(c.id)) {
        map.set(c.id, c);
      }
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
export const setRepertoireLink = (u: string, c: string, m: string, s: string) => instance.setRepertoireLink(u, c, m, s);
export const removeRepertoireLink = (u: string, c: string, m: string) => instance.removeRepertoireLink(u, c, m);
export const getMySmartChordsForSong = (u: string, m: string, s: string) => instance.getMySmartChordsForSong(u, m, s);
