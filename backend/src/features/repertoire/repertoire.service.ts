import { RepertoireRepository } from '../../repositories/RepertoireRepository';
import { PaginatedResponse, Song, SongSummary, Artist, Folder, Classification, RepertoireCounts } from './repertoire.types';

export class RepertoireService {
  constructor(private readonly repertoireRepository: RepertoireRepository = new RepertoireRepository()) {}

  async getCounts(ministryId: string): Promise<RepertoireCounts> {
    return this.repertoireRepository.getCounts(ministryId);
  }

  async getSongs(
    ministryId: string,
    _userId: string,
    filters: {
      search?: string;
      classification_id?: string;
      original_key?: string;
      artist_id?: string;
      has_youtube?: string;
      cursor?: string;
      page?: string;
      limit?: number | string;
    }
  ): Promise<PaginatedResponse<SongSummary>> {
    const page = typeof filters.page === 'string' ? parseInt(filters.page || '1', 10) : 1;
    const limit = typeof filters.limit === 'number' ? filters.limit : parseInt(String(filters.limit || '20'), 10);

    const result = await this.repertoireRepository.getSongs(ministryId, {
      search: filters.search,
      classification_id: filters.classification_id,
      original_key: filters.original_key,
      artist_id: filters.artist_id,
      has_youtube: filters.has_youtube === 'true',
      cursor: filters.cursor,
      page,
      limit,
    });

    return result as PaginatedResponse<SongSummary>;
  }

  async getSongById(ministryId: string, songId: string, _userId: string): Promise<any> {
    return this.repertoireRepository.getSongById(songId, ministryId);
  }

  async createSong(ministryId: string, userId: string, songData: any): Promise<Song> {
    return this.repertoireRepository.createSong(ministryId, userId, songData) as unknown as Song;
  }

  async updateSong(ministryId: string, songId: string, _userId: string, songData: any): Promise<Song> {
    return this.repertoireRepository.updateSong(songId, ministryId, songData) as unknown as Song;
  }

  async deleteSong(ministryId: string, songId: string, _userId: string): Promise<void> {
    await this.repertoireRepository.deleteSong(songId, ministryId);
  }

  async getArtists(ministryId: string, search?: string): Promise<Artist[]> {
    return this.repertoireRepository.getArtists(ministryId, search) as unknown as Artist[];
  }

  async createArtist(ministryId: string, name: string): Promise<Artist> {
    return this.repertoireRepository.createArtist(ministryId, name) as unknown as Artist;
  }

  async updateArtist(ministryId: string, artistId: string, name: string): Promise<Artist> {
    return this.repertoireRepository.updateArtist(artistId, ministryId, name) as unknown as Artist;
  }

  async deleteArtist(ministryId: string, artistId: string): Promise<void> {
    await this.repertoireRepository.deleteArtist(artistId, ministryId);
  }

  async getClassifications(ministryId: string): Promise<Classification[]> {
    return this.repertoireRepository.getClassifications(ministryId) as unknown as Classification[];
  }

  async createClassification(ministryId: string, data: { name: string; description?: string; color?: string }): Promise<Classification> {
    return this.repertoireRepository.createClassification(ministryId, data) as unknown as Classification;
  }

  async updateClassification(ministryId: string, id: string, data: { name: string; description?: string; color?: string }): Promise<Classification> {
    return this.repertoireRepository.updateClassification(id, ministryId, data) as unknown as Classification;
  }

  async deleteClassification(ministryId: string, id: string): Promise<void> {
    await this.repertoireRepository.deleteClassification(id, ministryId);
  }

  async getFolders(ministryId: string): Promise<Folder[]> {
    return this.repertoireRepository.getFolders(ministryId) as unknown as Folder[];
  }

  async getFolderById(ministryId: string, folderId: string): Promise<Folder> {
    return this.repertoireRepository.getFolderById(folderId, ministryId) as unknown as Folder;
  }

  async createFolder(ministryId: string, name: string, description?: string): Promise<Folder> {
    return this.repertoireRepository.createFolder(ministryId, name, description) as unknown as Folder;
  }

  async updateFolder(ministryId: string, folderId: string, data: { name: string; description?: string | null }): Promise<Folder> {
    return this.repertoireRepository.updateFolder(folderId, ministryId, data.name, data.description) as unknown as Folder;
  }

  async deleteFolder(ministryId: string, folderId: string): Promise<void> {
    await this.repertoireRepository.deleteFolder(folderId, ministryId);
  }

  async addSongToFolder(ministryId: string, folderId: string, songId: string): Promise<void> {
    await this.repertoireRepository.addSongToFolder(folderId, songId, ministryId);
  }

  async removeSongFromFolder(ministryId: string, folderId: string, songId: string): Promise<void> {
    await this.repertoireRepository.removeSongFromFolder(folderId, songId, ministryId);
  }
}

const serviceInstance = new RepertoireService();

export const getCounts = (m: string) => serviceInstance.getCounts(m);
export const getSongs = (m: string, u: string, f: any) => serviceInstance.getSongs(m, u, f);
export const getSongById = (m: string, s: string, u: string) => serviceInstance.getSongById(m, s, u);
export const createSong = (m: string, u: string, d: any) => serviceInstance.createSong(m, u, d);
export const updateSong = (m: string, s: string, u: string, d: any) => serviceInstance.updateSong(m, s, u, d);
export const deleteSong = (m: string, s: string, u: string) => serviceInstance.deleteSong(m, s, u);
export const getArtists = (m: string, s?: string) => serviceInstance.getArtists(m, s);
export const createArtist = (m: string, n: string) => serviceInstance.createArtist(m, n);
export const updateArtist = (m: string, a: string, n: string) => serviceInstance.updateArtist(m, a, n);
export const deleteArtist = (m: string, a: string) => serviceInstance.deleteArtist(m, a);
export const getClassifications = (m: string) => serviceInstance.getClassifications(m);
export const createClassification = (m: string, d: any) => serviceInstance.createClassification(m, d);
export const updateClassification = (m: string, id: string, d: any) => serviceInstance.updateClassification(m, id, d);
export const deleteClassification = (m: string, id: string) => serviceInstance.deleteClassification(m, id);
export const getFolders = (m: string) => serviceInstance.getFolders(m);
export const getFolderById = (m: string, f: string) => serviceInstance.getFolderById(m, f);
export const createFolder = (m: string, n: string, d?: string) => serviceInstance.createFolder(m, n, d);
export const updateFolder = (m: string, f: string, d: any) => serviceInstance.updateFolder(m, f, d);
export const deleteFolder = (m: string, f: string) => serviceInstance.deleteFolder(m, f);
export const addSongToFolder = (m: string, f: string, s: string) => serviceInstance.addSongToFolder(m, f, s);
export const removeSongFromFolder = (m: string, f: string, s: string) => serviceInstance.removeSongFromFolder(m, f, s);

