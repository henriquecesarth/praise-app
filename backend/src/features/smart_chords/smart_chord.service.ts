import { SmartChordRepository } from '../../repositories/SmartChordRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { RepertoireRepository } from '../../repositories/RepertoireRepository';
import { SmartChord } from './smart_chord.types';
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
  ) {}

  private async validateSongAndArtistAccess(userId: string, songId?: string | null, artistId?: string | null): Promise<void> {
    if (songId) {
      const song = await this.repertoireRepository.findSongById(songId);
      if (!song) {
        throw new AppError(404, 'Música vinculada não encontrada.');
      }
      if (song.ministry_id) {
        await this.ministryRepository.getMinistryById(song.ministry_id, userId);
      }
    }

    if (artistId) {
      const artist = await this.repertoireRepository.findArtistById(artistId);
      if (!artist) {
        throw new AppError(404, 'Artista vinculado não encontrado.');
      }
      if (artist.ministry_id) {
        await this.ministryRepository.getMinistryById(artist.ministry_id, userId);
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
    const page = filters.page || 1;
    const limit = filters.limit || 50;

    const list = await this.smartChordRepository.getSmartChords(userId, filters.search);
    const total = list.length;

    return {
      data: list as SmartChord[],
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
    return this.smartChordRepository.createSmartChord(userId, data) as unknown as SmartChord;
  }

  async updateSmartChord(id: string, userId: string, data: Partial<SmartChord>): Promise<SmartChord> {
    if (data.song_id !== undefined || data.artist_id !== undefined) {
      await this.validateSongAndArtistAccess(userId, data.song_id, data.artist_id);
    }
    return this.smartChordRepository.updateSmartChord(id, userId, data) as unknown as SmartChord;
  }

  async deleteSmartChord(id: string, userId: string): Promise<void> {
    await this.smartChordRepository.deleteSmartChord(id, userId);
  }
}

const instance = new SmartChordService();

export const getSmartChords = (u: string, f: any) => instance.getSmartChords(u, f);
export const getSmartChordsBySong = (s: string, u: string) => instance.getSmartChordsBySong(s, u);
export const getSmartChordById = (id: string, u: string) => instance.getSmartChordById(id, u);
export const createSmartChord = (u: string, d: any) => instance.createSmartChord(u, d);
export const updateSmartChord = (id: string, u: string, d: any) => instance.updateSmartChord(id, u, d);
export const deleteSmartChord = (id: string, u: string) => instance.deleteSmartChord(id, u);
