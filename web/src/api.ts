import { Song, Artist, Folder, Classification, RepertoireCounts, Ministry, MinistryInvite, Liturgy } from './types';

export type SmartChord = any;

// Usar variável de ambiente ou fallback para backend local/produção
const getCleanApiUrl = (): string => {
  const envUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;
  let rawUrl = (envUrl && envUrl.trim()) ? envUrl.trim() : 'http://localhost:3000/api/v1';

  // Remove barras iniciais acidentais (ex: /praise-app-gray.vercel.app/api/v1)
  rawUrl = rawUrl.replace(/^\/+/, '');

  // Garante o protocolo http:// ou https://
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    rawUrl = `https://${rawUrl}`;
  }

  // Remove barras no final para evitar dupla barra na concatenação de rotas
  return rawUrl.replace(/\/+$/, '');
};

export const DEFAULT_MINISTRY_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
export const API_URL = getCleanApiUrl();

const getHeaders = () => {
  const token = localStorage.getItem('praise_auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
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
  name: apiArtist.name,
  createdAt: apiArtist.created_at,
  updatedAt: apiArtist.updated_at,
});

const mapClassificationFromApi = (apiClassification: any): Classification => ({
  id: apiClassification.id,
  ministryId: apiClassification.ministry_id || apiClassification.group_id,
  name: apiClassification.name,
  description: apiClassification.description || undefined,
  color: apiClassification.color || undefined,
  createdAt: apiClassification.created_at,
  updatedAt: apiClassification.updated_at,
});

const mapFolderFromApi = (apiFolder: any): Folder => ({
  id: apiFolder.id,
  ministryId: apiFolder.ministry_id || apiFolder.group_id,
  name: apiFolder.name,
  description: apiFolder.description || undefined,
  songCount: apiFolder.song_count || 0,
  songs: (apiFolder.songs || []).map(mapSongFromApi),
  createdAt: apiFolder.created_at,
  updatedAt: apiFolder.updated_at,
});

const mapMinistryFromApi = (apiMinistry: any): Ministry => ({
  id: apiMinistry.id,
  name: apiMinistry.name,
  slug: apiMinistry.slug,
  ownerUserId: apiMinistry.owner_user_id,
  subscriptionStatus: apiMinistry.subscription_status,
  role: apiMinistry.role || 'member',
  createdAt: apiMinistry.created_at,
  updatedAt: apiMinistry.updated_at,
});

const mapLiturgyFromApi = (apiLiturgy: any): Liturgy => ({
  id: apiLiturgy.id,
  ministryId: apiLiturgy.ministry_id || apiLiturgy.group_id,
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

  // Ministérios e Convites
  getMyMinistries: async (): Promise<Ministry[]> => {
    const response = await fetch(`${API_URL}/ministries/my-ministries`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return (result || []).map(mapMinistryFromApi);
  },

  getMyGroups: async (): Promise<Ministry[]> => {
    return api.getMyMinistries();
  },

  createMinistry: async (name: string): Promise<Ministry> => {
    const response = await fetch(`${API_URL}/ministries`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<any>(response);
    return mapMinistryFromApi(result);
  },

  createGroup: async (name: string): Promise<Ministry> => {
    return api.createMinistry(name);
  },

  joinMinistryByCode: async (code: string): Promise<{ message: string; ministry: Ministry; group: Ministry; role: string }> => {
    const response = await fetch(`${API_URL}/ministries/join`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code }),
    });
    const result = await handleResponse<any>(response);
    const mapped = mapMinistryFromApi(result.ministry || result.group);
    return {
      message: result.message,
      ministry: mapped,
      group: mapped,
      role: result.role,
    };
  },

  joinGroupByCode: async (code: string) => {
    return api.joinMinistryByCode(code);
  },

  createInviteCode: async (ministryId: string, expiresInDays = 7): Promise<MinistryInvite> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/invites`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ expiresInDays }),
    });
    const result = await handleResponse<any>(response);
    return {
      id: result.id,
      ministryId: result.ministry_id || result.group_id,
      code: result.code,
      createdBy: result.created_by,
      maxUses: result.max_uses,
      usesCount: result.uses_count,
      expiresAt: result.expires_at,
      createdAt: result.created_at,
    };
  },

  getMinistryMembers: async (ministryId: string): Promise<Array<{ id: string; userId: string; name: string; email: string; role: string; birthDate?: string; isManual?: boolean; roleIds?: string[] }>> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return (result || []).map((m: any) => ({
      id: m.id || m.user_id,
      userId: m.user_id,
      name: m.name || m.user_id || 'Integrante',
      email: m.email || '',
      role: m.role || 'member',
      birthDate: m.birth_date || undefined,
      isManual: m.is_manual || false,
      roleIds: m.role_ids || m.roleIds || [],
    }));
  },

  getGroupMembers: async (groupId: string) => {
    return api.getMinistryMembers(groupId);
  },

  updateMinistry: async (ministryId: string, data: { name: string }): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    const result = await handleResponse<any>(response);
    return mapMinistryFromApi(result);
  },

  deleteMinistry: async (ministryId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  leaveMinistry: async (ministryId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/leave`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  removeMember: async (ministryId: string, memberId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members/${memberId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  updateMemberRole: async (ministryId: string, memberId: string, role: 'admin' | 'member'): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members/${memberId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ role }),
    });
    return handleResponse<any>(response);
  },

  updateMember: async (
    ministryId: string,
    memberId: string,
    data: {
      name?: string;
      email?: string;
      birthDate?: string;
      role?: 'admin' | 'member';
      roleIds?: string[];
      password?: string;
    }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members/${memberId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  addMemberManually: async (
    ministryId: string,
    data: { name: string; email: string; role?: 'admin' | 'member'; birthDate?: string }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  // Equipes
  getTeams: async (ministryId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return result || [];
  },

  getTeamById: async (ministryId: string, teamId: string): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams/${teamId}`, {
      headers: getHeaders(),
    });
    return handleResponse<any>(response);
  },

  createTeam: async (
    ministryId: string,
    data: { name: string; description?: string; memberIds?: string[] }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  updateTeam: async (
    ministryId: string,
    teamId: string,
    data: { name?: string; description?: string | null; memberIds?: string[] }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams/${teamId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  deleteTeam: async (ministryId: string, teamId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams/${teamId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Funções (Roles)
  getRoles: async (ministryId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/roles`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return result || [];
  },

  createRole: async (ministryId: string, data: { name: string; icon: string }): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/roles`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  updateRole: async (ministryId: string, roleId: string, data: { name?: string; icon?: string }): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/roles/${roleId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  deleteRole: async (ministryId: string, roleId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/roles/${roleId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Classificações
  getClassifications: async (ministryId: string): Promise<Classification[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    const list = Array.isArray(result) ? result : (result?.data || []);
    return list.map(mapClassificationFromApi);
  },

  createClassification: async (
    ministryId: string,
    data: { name: string; description?: string }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  updateClassification: async (
    ministryId: string,
    id: string,
    data: { name?: string; description?: string | null }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  deleteClassification: async (ministryId: string, id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Modelos de Roteiro (Schedule Templates)
  getScheduleTemplates: async (ministryId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedule-templates`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return result || [];
  },

  createScheduleTemplate: async (
    ministryId: string,
    data: { name: string; items: any[] }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedule-templates`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  updateScheduleTemplate: async (
    ministryId: string,
    id: string,
    data: { name?: string; items?: any[] }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedule-templates/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  deleteScheduleTemplate: async (ministryId: string, id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedule-templates/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Escalas
  getSchedules: async (ministryId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return result || [];
  },

  createSchedule: async (ministryId: string, scheduleData: any): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(scheduleData),
    });
    return handleResponse<any>(response);
  },

  updateSchedule: async (ministryId: string, scheduleId: string, scheduleData: any): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(scheduleData),
    });
    return handleResponse<any>(response);
  },

  deleteSchedule: async (scheduleId: string, ministryId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  confirmSchedulePresence: async (ministryId: string, scheduleId: string, confirmed: boolean): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}/confirmation`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ confirmed }),
    });
    return handleResponse<any>(response);
  },

  // Liturgias
  getLiturgies: async (ministryId = DEFAULT_MINISTRY_ID): Promise<Liturgy[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/liturgies`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return (result || []).map(mapLiturgyFromApi);
  },

  getLiturgyById: async (liturgyId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Liturgy> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/liturgies/${liturgyId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    return mapLiturgyFromApi(result);
  },

  createLiturgy: async (param1: any, param2?: any): Promise<Liturgy> => {
    let ministryId = DEFAULT_MINISTRY_ID;
    let liturgyData: Partial<Liturgy> = {};
    if (typeof param1 === 'string') {
      ministryId = param1;
      liturgyData = param2 || {};
    } else {
      liturgyData = param1 || {};
      ministryId = param2 || DEFAULT_MINISTRY_ID;
    }
    const payload = {
      title: liturgyData.title,
      date: liturgyData.date,
      description: liturgyData.description,
      items: (liturgyData.items || []).map((item) => ({
        song_id: item.songId || null,
        type: item.type,
        title: item.title,
        notes: item.notes || null,
        position: item.position,
      })),
    };

    const response = await fetch(`${API_URL}/ministries/${ministryId}/liturgies`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await handleResponse<any>(response);
    return mapLiturgyFromApi(result);
  },

  updateLiturgy: async (liturgyId: string, liturgyData: Partial<Liturgy>, ministryId = DEFAULT_MINISTRY_ID): Promise<Liturgy> => {
    const payload = {
      title: liturgyData.title,
      date: liturgyData.date,
      description: liturgyData.description,
      items: (liturgyData.items || []).map((item) => ({
        song_id: item.songId || null,
        type: item.type,
        title: item.title,
        notes: item.notes || null,
        position: item.position,
      })),
    };

    const response = await fetch(`${API_URL}/ministries/${ministryId}/liturgies/${liturgyId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await handleResponse<any>(response);
    return mapLiturgyFromApi(result);
  },

  deleteLiturgy: async (liturgyId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/liturgies/${liturgyId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Contadores do Repertório
  getCounts: async (ministryId = DEFAULT_MINISTRY_ID): Promise<RepertoireCounts> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/counts`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: RepertoireCounts }>(response);
    return result.data;
  },

  // Músicas
  getSongs: async (
    ministryId = DEFAULT_MINISTRY_ID,
    filters?: {
      search?: string;
      classificationId?: string;
      originalKey?: string;
      artistId?: string;
      hasYoutube?: boolean;
      page?: number;
      limit?: number;
    }
  ): Promise<{ songs: Song[]; totalCount: number }> => {
    const queryParams = new URLSearchParams();
    if (filters?.search) queryParams.append('search', filters.search);
    if (filters?.classificationId) queryParams.append('classification_id', filters.classificationId);
    if (filters?.originalKey) queryParams.append('original_key', filters.originalKey);
    if (filters?.artistId) queryParams.append('artist_id', filters.artistId);
    if (filters?.hasYoutube !== undefined && filters?.hasYoutube !== null) {
      queryParams.append('has_youtube', String(filters.hasYoutube));
    }
    if (filters?.page) queryParams.append('page', String(filters.page));
    if (filters?.limit) queryParams.append('limit', String(filters.limit));

    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs${queryString}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[]; total: number }>(response);
    return {
      songs: (result.data || []).map(mapSongFromApi),
      totalCount: result.total || 0,
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
    return handleResponse<void>(response);
  },

  // Artistas
  getArtists: async (ministryId = DEFAULT_MINISTRY_ID, search?: string): Promise<Artist[]> => {
    const queryString = search ? `?search=${encodeURIComponent(search)}` : '';
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists${queryString}`, {
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
    return handleResponse<void>(response);
  },
  // Pastas
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

  updateFolder: async (folderId: string, data: { name?: string; description?: string }, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
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
    return handleResponse<void>(response);
  },

  addSongToFolder: async (folderId: string, songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}/songs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ song_id: songId }),
    });
    return handleResponse<void>(response);
  },

  removeSongFromFolder: async (folderId: string, songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}/songs/${songId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Cifras Inteligentes
  getSmartChordBySongId: async (songId: string): Promise<any> => {
    const response = await fetch(`${API_URL}/smart-chords/song/${songId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any }>(response);
    return result.data;
  },

  getSmartChords: async (_searchQuery?: string): Promise<any[]> => {
    return [];
  },

  upsertSmartChord: async (songId: string, originalKey: string, content: string): Promise<any> => {
    const response = await fetch(`${API_URL}/smart-chords/song/${songId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ original_key: originalKey, content }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return result.data;
  },

  updateSmartChord: async (id: string, payload: any): Promise<any> => {
    const songId = payload?.songId || id;
    return api.upsertSmartChord(songId, payload?.originalKey || 'C', payload?.content || '');
  },

  createSmartChord: async (payload: any): Promise<any> => {
    const songId = payload?.songId || 'standalone';
    return api.upsertSmartChord(songId, payload?.originalKey || 'C', payload?.content || '');
  },

  deleteSmartChord: async (songId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/smart-chords/song/${songId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Comentários da Escala
  getScheduleComments: async (ministryId: string, scheduleId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}/comments`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    return Array.isArray(result) ? result : (result?.data || []);
  },

  createScheduleComment: async (ministryId: string, scheduleId: string, content: string): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}/comments`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ content }),
    });
    return handleResponse<any>(response);
  },
};
