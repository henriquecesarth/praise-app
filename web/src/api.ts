import { Song, Artist, Folder, Classification, RepertoireCounts, Group, GroupInvite, Liturgy } from './types';

// Usar variável de ambiente ou fallback para backend local/produção
const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3000/api/v1';
export const DEFAULT_MINISTRY_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const getHeaders = () => {
  const token = localStorage.getItem('praise_auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'x-user-id': 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

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
  ministryId: apiSong.ministry_id || apiSong.group_id,
  groupId: apiSong.group_id || apiSong.ministry_id,
  userId: apiSong.user_id,
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
  smartChord: apiSong.smart_chord ? {
    id: apiSong.smart_chord.id,
    originalKey: apiSong.smart_chord.original_key,
    content: apiSong.smart_chord.content,
  } : undefined,
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
  ministryId: apiArtist.ministry_id || apiArtist.group_id,
  groupId: apiArtist.group_id || apiArtist.ministry_id,
  name: apiArtist.name,
  createdAt: apiArtist.created_at,
  updatedAt: apiArtist.updated_at,
});

const mapClassificationFromApi = (apiClassification: any): Classification => ({
  id: apiClassification.id,
  ministryId: apiClassification.ministry_id || apiClassification.group_id,
  groupId: apiClassification.group_id || apiClassification.ministry_id,
  name: apiClassification.name,
  description: apiClassification.description || undefined,
  color: apiClassification.color || undefined,
  createdAt: apiClassification.created_at,
  updatedAt: apiClassification.updated_at,
});

const mapFolderFromApi = (apiFolder: any): Folder => ({
  id: apiFolder.id,
  ministryId: apiFolder.ministry_id || apiFolder.group_id,
  groupId: apiFolder.group_id || apiFolder.ministry_id,
  name: apiFolder.name,
  description: apiFolder.description || undefined,
  songCount: apiFolder.song_count || 0,
  songs: (apiFolder.songs || []).map(mapSongFromApi),
  createdAt: apiFolder.created_at,
  updatedAt: apiFolder.updated_at,
});

const mapGroupFromApi = (apiGroup: any): Group => ({
  id: apiGroup.id,
  name: apiGroup.name,
  slug: apiGroup.slug,
  ownerUserId: apiGroup.owner_user_id,
  subscriptionStatus: apiGroup.subscription_status,
  role: apiGroup.role || 'member',
  createdAt: apiGroup.created_at,
  updatedAt: apiGroup.updated_at,
});

const mapLiturgyFromApi = (apiLiturgy: any): Liturgy => ({
  id: apiLiturgy.id,
  groupId: apiLiturgy.group_id,
  title: apiLiturgy.title,
  date: apiLiturgy.date,
  description: apiLiturgy.description,
  createdBy: apiLiturgy.created_by,
  items: (apiLiturgy.liturgy_items || []).map((item: any) => ({
    id: item.id,
    liturgyId: item.liturgy_id,
    songId: item.song_id,
    song: item.song ? mapSongFromApi(item.song) : undefined,
    type: item.type,
    title: item.title,
    notes: item.notes,
    position: item.position,
  })),
  createdAt: apiLiturgy.created_at,
  updatedAt: apiLiturgy.updated_at,
});

export const api = {
  // Autenticação
  login: async (email: string, password: string): Promise<{ user: { id: string; email: string; name: string }; token: string }> => {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email, password }),
    });
    return handleResponse<any>(response);
  },

  signUp: async (name: string, email: string, password: string): Promise<{ user: { id: string; email: string; name: string }; token: string }> => {
    const response = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, email, password }),
    });
    return handleResponse<any>(response);
  },

  getMe: async (): Promise<{ id: string; email: string; name: string }> => {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: getHeaders(),
    });
    return handleResponse<any>(response);
  },

  // Grupos e Convites
  getMyGroups: async (): Promise<Group[]> => {
    const response = await fetch(`${API_URL}/groups/my-groups`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return (result || []).map(mapGroupFromApi);
  },

  createGroup: async (name: string): Promise<Group> => {
    const response = await fetch(`${API_URL}/groups`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<any>(response);
    return mapGroupFromApi(result);
  },

  joinGroupByCode: async (code: string): Promise<{ message: string; group: Group; role: string }> => {
    const response = await fetch(`${API_URL}/groups/join`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code }),
    });
    const result = await handleResponse<any>(response);
    return {
      message: result.message,
      group: mapGroupFromApi(result.group),
      role: result.role,
    };
  },

  createInviteCode: async (groupId: string, expiresInDays = 7): Promise<GroupInvite> => {
    const response = await fetch(`${API_URL}/groups/${groupId}/invites`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ expiresInDays }),
    });
    const result = await handleResponse<any>(response);
    return {
      id: result.id,
      groupId: result.group_id,
      code: result.code,
      createdBy: result.created_by,
      maxUses: result.max_uses,
      usesCount: result.uses_count,
      expiresAt: result.expires_at,
      createdAt: result.created_at,
    };
  },

  // Liturgias
  getLiturgies: async (groupId: string): Promise<Liturgy[]> => {
    const response = await fetch(`${API_URL}/groups/${groupId}/liturgies`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return (result || []).map(mapLiturgyFromApi);
  },

  createLiturgy: async (groupId: string, liturgyData: { title: string; date: string; description?: string; items?: any[] }): Promise<Liturgy> => {
    const response = await fetch(`${API_URL}/groups/${groupId}/liturgies`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(liturgyData),
    });
    const result = await handleResponse<any>(response);
    return mapLiturgyFromApi(result);
  },

  deleteLiturgy: async (groupId: string, liturgyId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/groups/${groupId}/liturgies/${liturgyId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },

  // Counts
  getCounts: async (ministryId = DEFAULT_MINISTRY_ID): Promise<RepertoireCounts> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/counts`, {
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
    params.append('limit', '100');
    
    if (filters.search) params.append('search', filters.search);
    if (filters.classificationId) params.append('classification_id', filters.classificationId);
    if (filters.originalKey) params.append('original_key', filters.originalKey);
    if (filters.artistId) params.append('artist_id', filters.artistId);
    if (filters.hasYoutube) params.append('has_youtube', 'true');

    const response = await fetch(`${API_URL}/groups/${ministryId}/songs?${params.toString()}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[]; total: number }>(response);
    return {
      songs: (result.data || []).map(mapSongFromApi),
      totalCount: result.total || 0
    };
  },

  getSongById: async (songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/songs/${songId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  createSong: async (songData: Partial<Song>, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/songs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(mapSongToApi(songData)),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  updateSong: async (songId: string, songData: Partial<Song>, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/songs/${songId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(mapSongToApi(songData)),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  deleteSong: async (songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/songs/${songId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },

  // Artists
  getArtists: async (ministryId = DEFAULT_MINISTRY_ID, search?: string): Promise<Artist[]> => {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    
    const response = await fetch(`${API_URL}/groups/${ministryId}/artists?${params.toString()}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[] }>(response);
    return (result.data || []).map(mapArtistFromApi);
  },

  createArtist: async (name: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Artist> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/artists`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapArtistFromApi(result.data);
  },

  updateArtist: async (artistId: string, name: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Artist> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/artists/${artistId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapArtistFromApi(result.data);
  },

  deleteArtist: async (artistId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/artists/${artistId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },

  // Classifications
  getClassifications: async (ministryId = DEFAULT_MINISTRY_ID): Promise<Classification[]> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/classifications`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[] }>(response);
    return (result.data || []).map(mapClassificationFromApi);
  },

  // Folders
  getFolders: async (ministryId = DEFAULT_MINISTRY_ID): Promise<Folder[]> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/folders`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[] }>(response);
    return (result.data || []).map(mapFolderFromApi);
  },

  getFolderById: async (folderId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/folders/${folderId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  createFolder: async (name: string, description?: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/folders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, description }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  updateFolder: async (folderId: string, data: { name: string; description?: string | null }, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/folders/${folderId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  deleteFolder: async (folderId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/folders/${folderId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },

  addSongToFolder: async (folderId: string, songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/folders/${folderId}/songs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ song_id: songId }),
    });
    await handleResponse<void>(response);
  },

  removeSongFromFolder: async (folderId: string, songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/groups/${ministryId}/folders/${folderId}/songs/${songId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },

  getSmartChords: async (search?: string): Promise<SmartChord[]> => {
    const url = new URL(`${API_URL}/smart-chords`);
    if (search) url.searchParams.append('search', search);
    const response = await fetch(url.toString(), {
      headers: getHeaders(),
    });
    return handleResponse<any>(response).then(res => res.data.map(mapSmartChordFromApi));
  },

  getSmartChordById: async (id: string): Promise<SmartChord> => {
    const response = await fetch(`${API_URL}/smart-chords/${id}`, {
      headers: getHeaders(),
    });
    return handleResponse<any>(response).then(mapSmartChordFromApi);
  },

  createSmartChord: async (sc: Partial<SmartChord>): Promise<SmartChord> => {
    const response = await fetch(`${API_URL}/smart-chords`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(mapSmartChordToApi(sc)),
    });
    return handleResponse<any>(response).then(mapSmartChordFromApi);
  },

  updateSmartChord: async (id: string, sc: Partial<SmartChord>): Promise<SmartChord> => {
    const response = await fetch(`${API_URL}/smart-chords/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(mapSmartChordToApi(sc)),
    });
    return handleResponse<any>(response).then(mapSmartChordFromApi);
  },

  deleteSmartChord: async (id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/smart-chords/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<void>(response);
  },
};

export interface SmartChord {
  id: string;
  userId: string;
  title: string;
  artistId?: string;
  songId?: string;
  originalKey: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  artist?: {
    id: string;
    name: string;
  };
  song?: {
    id: string;
    title: string;
  };
}

const mapSmartChordFromApi = (apiSC: any): SmartChord => ({
  id: apiSC.id,
  userId: apiSC.user_id,
  title: apiSC.title,
  artistId: apiSC.artist_id || undefined,
  songId: apiSC.song_id || undefined,
  originalKey: apiSC.original_key,
  content: apiSC.content,
  createdAt: apiSC.created_at,
  updatedAt: apiSC.updated_at,
  artist: apiSC.artist || undefined,
  song: apiSC.song || undefined,
});

const mapSmartChordToApi = (sc: Partial<SmartChord>): any => {
  const apiSC: any = {};
  if (sc.title !== undefined) apiSC.title = sc.title;
  if (sc.artistId !== undefined) apiSC.artist_id = sc.artistId || null;
  if (sc.songId !== undefined) apiSC.song_id = sc.songId || null;
  if (sc.originalKey !== undefined) apiSC.original_key = sc.originalKey;
  if (sc.content !== undefined) apiSC.content = sc.content;
  return apiSC;
};
