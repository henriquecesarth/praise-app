import { Song, Artist, Folder, Classification, RepertoireCounts } from './types';

// Use env variable or default production backend
const API_URL = (import.meta as any).env.VITE_API_URL || 'https://praise-app-gray.vercel.app/api/v1';
export const DEFAULT_MINISTRY_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const getHeaders = () => ({
  'Content-Type': 'application/json',
  'Accept': 'application/json',
});

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (response.status === 204) {
    return {} as T;
  }
  
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Erro de resposta do servidor (${response.status})`);
  }

  if (response.ok) {
    return body as T;
  }

  const errorMessage = body?.error?.message || `Erro desconhecido (${response.status})`;
  throw new Error(errorMessage);
};

const mapSongFromApi = (apiSong: any): Song => ({
  id: apiSong.id,
  ministryId: apiSong.ministry_id,
  title: apiSong.title,
  artistId: apiSong.artist_id || undefined,
  artistName: apiSong.artist?.name || undefined,
  classificationId: apiSong.classification_id || undefined,
  classificationName: apiSong.classification?.name || undefined,
  classificationColor: apiSong.classification?.color || undefined,
  originalKey: apiSong.original_key || undefined,
  bpm: apiSong.bpm || undefined,
  duration: apiSong.duration || undefined,
  lyrics: apiSong.lyrics || undefined,
  chordSheetUrl: apiSong.chord_sheet_url || undefined,
  youtubeUrl: apiSong.youtube_url || undefined,
  audioUrl: apiSong.audio_url || undefined,
  externalLinks: apiSong.external_links || {},
  createdAt: apiSong.created_at,
  updatedAt: apiSong.updated_at,
});

const mapSongToApi = (song: Partial<Song>): any => {
  const apiSong: any = {};
  if (song.title !== undefined) apiSong.title = song.title;
  if (song.artistId !== undefined) apiSong.artist_id = song.artistId || null;
  if (song.classificationId !== undefined) apiSong.classification_id = song.classificationId || null;
  if (song.originalKey !== undefined) apiSong.original_key = song.originalKey || null;
  if (song.bpm !== undefined) apiSong.bpm = song.bpm || null;
  if (song.duration !== undefined) apiSong.duration = song.duration || null;
  if (song.lyrics !== undefined) apiSong.lyrics = song.lyrics || null;
  if (song.chordSheetUrl !== undefined) apiSong.chord_sheet_url = song.chordSheetUrl || null;
  if (song.youtubeUrl !== undefined) apiSong.youtube_url = song.youtubeUrl || null;
  if (song.audioUrl !== undefined) apiSong.audio_url = song.audioUrl || null;
  if (song.externalLinks !== undefined) apiSong.external_links = song.externalLinks || {};
  return apiSong;
};

const mapArtistFromApi = (apiArtist: any): Artist => ({
  id: apiArtist.id,
  ministryId: apiArtist.ministry_id,
  name: apiArtist.name,
  createdAt: apiArtist.created_at,
  updatedAt: apiArtist.updated_at,
});

const mapClassificationFromApi = (apiClassification: any): Classification => ({
  id: apiClassification.id,
  ministryId: apiClassification.ministry_id,
  name: apiClassification.name,
  description: apiClassification.description || undefined,
  color: apiClassification.color || undefined,
  createdAt: apiClassification.created_at,
  updatedAt: apiClassification.updated_at,
});

const mapFolderFromApi = (apiFolder: any): Folder => ({
  id: apiFolder.id,
  ministryId: apiFolder.ministry_id,
  name: apiFolder.name,
  description: apiFolder.description || undefined,
  songCount: apiFolder.song_count || 0,
  songs: (apiFolder.songs || []).map(mapSongFromApi),
  createdAt: apiFolder.created_at,
  updatedAt: apiFolder.updated_at,
});

export const api = {
  // Counts
  getCounts: async (ministryId = DEFAULT_MINISTRY_ID): Promise<RepertoireCounts> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/counts`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: RepertoireCounts }>(response);
    return result.data;
  },

  // Songs
  getSongs: async (
    ministryId = DEFAULT_MINISTRY_ID,
    filters: {
      search?: string;
      classificationId?: string;
      originalKey?: string;
      artistId?: string;
      hasYoutube?: boolean;
    } = {}
  ): Promise<{ songs: Song[]; totalCount: number }> => {
    const params = new URLSearchParams();
    params.append('page', '1');
    params.append('limit', '100'); // Higher limit for web dashboard display
    
    if (filters.search) params.append('search', filters.search);
    if (filters.classificationId) params.append('classification_id', filters.classificationId);
    if (filters.originalKey) params.append('original_key', filters.originalKey);
    if (filters.artistId) params.append('artist_id', filters.artistId);
    if (filters.hasYoutube) params.append('has_youtube', 'true');

    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs?${params.toString()}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[]; total: number }>(response);
    return {
      songs: (result.data || []).map(mapSongFromApi),
      totalCount: result.total || 0
    };
  },

  getSongById: async (songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs/${songId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  createSong: async (songData: Partial<Song>, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(mapSongToApi(songData)),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  updateSong: async (songId: string, songData: Partial<Song>, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs/${songId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(mapSongToApi(songData)),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  deleteSong: async (songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs/${songId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },

  // Artists
  getArtists: async (ministryId = DEFAULT_MINISTRY_ID, search?: string): Promise<Artist[]> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists?${params.toString()}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[] }>(response);
    return (result.data || []).map(mapArtistFromApi);
  },

  createArtist: async (name: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Artist> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapArtistFromApi(result.data);
  },

  updateArtist: async (artistId: string, name: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Artist> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists/${artistId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapArtistFromApi(result.data);
  },

  deleteArtist: async (artistId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists/${artistId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },

  // Classifications
  getClassifications: async (ministryId = DEFAULT_MINISTRY_ID): Promise<Classification[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[] }>(response);
    return (result.data || []).map(mapClassificationFromApi);
  },

  // Folders
  getFolders: async (ministryId = DEFAULT_MINISTRY_ID): Promise<Folder[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[] }>(response);
    return (result.data || []).map(mapFolderFromApi);
  },

  getFolderById: async (folderId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  createFolder: async (name: string, description?: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, description }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  updateFolder: async (folderId: string, data: { name: string; description?: string | null }, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  deleteFolder: async (folderId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },

  addSongToFolder: async (folderId: string, songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}/songs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ song_id: songId }),
    });
    await handleResponse<void>(response);
  },

  removeSongFromFolder: async (folderId: string, songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}/songs/${songId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },
};
