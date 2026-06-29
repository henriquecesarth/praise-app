import { getSupabaseClient } from '../../lib/supabase';
import { AppError } from '../../middleware/error-handler';
import type {
  Song,
  Artist,
  Folder,
  Classification,
  PaginatedResponse,
  RepertoireCounts,
} from './repertoire.types';

const supabase = () => getSupabaseClient();

// ============================================================
// SONGS
// ============================================================

export async function getSongs(
  ministryId: string,
  filters: {
    search?: string;
    classification_id?: string;
    original_key?: string;
    artist_id?: string;
    has_youtube?: string;
    page?: string;
    limit?: string;
  }
): Promise<PaginatedResponse<Song>> {
  const page = parseInt(filters.page || '1', 10);
  const limit = parseInt(filters.limit || '50', 10);
  const offset = (page - 1) * limit;

  let query = supabase()
    .from('songs')
    .select('*, artist:artists(id, name), classification:classifications(id, name, color)', {
      count: 'exact',
    })
    .eq('ministry_id', ministryId)
    .order('title', { ascending: true })
    .range(offset, offset + limit - 1);

  if (filters.search) {
    // PostgREST limits cross-table filtering inside .or() conditions.
    // Fetch matching artist IDs first
    const { data: matchingArtists } = await supabase()
      .from('artists')
      .select('id')
      .eq('ministry_id', ministryId)
      .ilike('name', `%${filters.search}%`);

    const artistIds = (matchingArtists || []).map(a => a.id);

    if (artistIds.length > 0) {
      query = query.or(
        `title.ilike.%${filters.search}%,artist_id.in.(${artistIds.map(id => `"${id}"`).join(',')})`
      );
    } else {
      query = query.ilike('title', `%${filters.search}%`);
    }
  }

  if (filters.classification_id) {
    query = query.eq('classification_id', filters.classification_id);
  }

  if (filters.original_key) {
    query = query.eq('original_key', filters.original_key);
  }

  if (filters.artist_id) {
    query = query.eq('artist_id', filters.artist_id);
  }

  if (filters.has_youtube === 'true') {
    query = query.not('youtube_url', 'is', null).neq('youtube_url', '');
  }

  const { data, error, count } = await query;

  if (error) throw new AppError(500, 'Erro ao buscar músicas.', error);

  const total = count || 0;
  return {
    data: (data as Song[]) || [],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

export async function getSongById(
  ministryId: string,
  songId: string
): Promise<Song> {
  const { data, error } = await supabase()
    .from('songs')
    .select('*, artist:artists(id, name), classification:classifications(id, name, color)')
    .eq('id', songId)
    .eq('ministry_id', ministryId)
    .single();

  if (error || !data) throw new AppError(404, 'Música não encontrada.');

  return data as Song;
}

export async function createSong(
  ministryId: string,
  songData: Partial<Song>
): Promise<Song> {
  const { data, error } = await supabase()
    .from('songs')
    .insert({
      ...songData,
      ministry_id: ministryId,
      chord_sheet_url: songData.chord_sheet_url || null,
      youtube_url: songData.youtube_url || null,
      audio_url: songData.audio_url || null,
      external_links: songData.external_links || {},
    })
    .select('*, artist:artists(id, name), classification:classifications(id, name, color)')
    .single();

  if (error) throw new AppError(400, 'Erro ao criar música.', error);

  return data as Song;
}

export async function updateSong(
  ministryId: string,
  songId: string,
  songData: Partial<Song>
): Promise<Song> {
  const { data, error } = await supabase()
    .from('songs')
    .update({
      ...songData,
      chord_sheet_url: songData.chord_sheet_url || null,
      youtube_url: songData.youtube_url || null,
      audio_url: songData.audio_url || null,
      external_links: songData.external_links !== undefined ? songData.external_links : undefined,
    })
    .eq('id', songId)
    .eq('ministry_id', ministryId)
    .select('*, artist:artists(id, name), classification:classifications(id, name, color)')
    .single();

  if (error) throw new AppError(400, 'Erro ao atualizar música.', error);

  return data as Song;
}

export async function deleteSong(
  ministryId: string,
  songId: string
): Promise<void> {
  const { error } = await supabase()
    .from('songs')
    .delete()
    .eq('id', songId)
    .eq('ministry_id', ministryId);

  if (error) throw new AppError(400, 'Erro ao excluir música.', error);
}

// ============================================================
// ARTISTS
// ============================================================

export async function getArtists(
  ministryId: string,
  search?: string
): Promise<Artist[]> {
  let query = supabase()
    .from('artists')
    .select('*')
    .eq('ministry_id', ministryId)
    .order('name', { ascending: true });

  if (search) {
    query = query.ilike('name', `%${search}%`);
  }

  const { data, error } = await query;

  if (error) throw new AppError(500, 'Erro ao buscar artistas.', error);

  return (data as Artist[]) || [];
}

export async function createArtist(
  ministryId: string,
  artistData: { name: string }
): Promise<Artist> {
  const { data, error } = await supabase()
    .from('artists')
    .insert({
      ministry_id: ministryId,
      name: artistData.name,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new AppError(409, 'Artista com este nome já existe neste ministério.');
    }
    throw new AppError(400, 'Erro ao criar artista.', error);
  }

  return data as Artist;
}

export async function updateArtist(
  ministryId: string,
  artistId: string,
  artistData: { name?: string }
): Promise<Artist> {
  const { data, error } = await supabase()
    .from('artists')
    .update(artistData)
    .eq('id', artistId)
    .eq('ministry_id', ministryId)
    .select('*')
    .single();

  if (error) throw new AppError(400, 'Erro ao atualizar artista.', error);

  return data as Artist;
}

export async function deleteArtist(
  ministryId: string,
  artistId: string
): Promise<void> {
  const { error } = await supabase()
    .from('artists')
    .delete()
    .eq('id', artistId)
    .eq('ministry_id', ministryId);

  if (error) throw new AppError(400, 'Erro ao excluir artista.', error);
}

// ============================================================
// CLASSIFICATIONS
// ============================================================

export async function getClassifications(
  ministryId: string
): Promise<Classification[]> {
  const { data, error } = await supabase()
    .from('classifications')
    .select('*')
    .eq('ministry_id', ministryId)
    .order('name', { ascending: true });

  if (error) throw new AppError(500, 'Erro ao buscar classificações.', error);

  return (data as Classification[]) || [];
}

export async function createClassification(
  ministryId: string,
  classificationData: { name: string; description?: string | null; color?: string | null }
): Promise<Classification> {
  const { data, error } = await supabase()
    .from('classifications')
    .insert({
      ministry_id: ministryId,
      ...classificationData,
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new AppError(409, 'Classificação com este nome já existe neste ministério.');
    }
    throw new AppError(400, 'Erro ao criar classificação.', error);
  }

  return data as Classification;
}

export async function updateClassification(
  ministryId: string,
  classificationId: string,
  classificationData: { name?: string; description?: string | null; color?: string | null }
): Promise<Classification> {
  const { data, error } = await supabase()
    .from('classifications')
    .update(classificationData)
    .eq('id', classificationId)
    .eq('ministry_id', ministryId)
    .select('*')
    .single();

  if (error) throw new AppError(400, 'Erro ao atualizar classificação.', error);

  return data as Classification;
}

export async function deleteClassification(
  ministryId: string,
  classificationId: string
): Promise<void> {
  const { error } = await supabase()
    .from('classifications')
    .delete()
    .eq('id', classificationId)
    .eq('ministry_id', ministryId);

  if (error) throw new AppError(400, 'Erro ao excluir classificação.', error);
}

// ============================================================
// FOLDERS
// ============================================================

export async function getFolders(
  ministryId: string
): Promise<Folder[]> {
  const { data, error } = await supabase()
    .from('folders')
    .select('*, folder_songs(count)')
    .eq('ministry_id', ministryId)
    .order('name', { ascending: true });

  if (error) throw new AppError(500, 'Erro ao buscar pastas.', error);

  return ((data as any[]) || []).map((folder) => ({
    ...folder,
    song_count: folder.folder_songs?.[0]?.count || 0,
    folder_songs: undefined,
  })) as Folder[];
}

export async function getFolderById(
  ministryId: string,
  folderId: string
): Promise<Folder & { songs: Song[] }> {
  const { data: folder, error: folderError } = await supabase()
    .from('folders')
    .select('*')
    .eq('id', folderId)
    .eq('ministry_id', ministryId)
    .single();

  if (folderError || !folder) throw new AppError(404, 'Pasta não encontrada.');

  const { data: folderSongs, error: songsError } = await supabase()
    .from('folder_songs')
    .select('position, song:songs(*, artist:artists(id, name), classification:classifications(id, name, color))')
    .eq('folder_id', folderId)
    .order('position', { ascending: true });

  if (songsError) throw new AppError(500, 'Erro ao buscar músicas da pasta.', songsError);

  return {
    ...(folder as Folder),
    songs: (folderSongs || []).map((fs: any) => ({ ...fs.song, position: fs.position })),
  };
}

export async function createFolder(
  ministryId: string,
  folderData: { name: string; description?: string | null }
): Promise<Folder> {
  const { data, error } = await supabase()
    .from('folders')
    .insert({
      ministry_id: ministryId,
      ...folderData,
    })
    .select('*')
    .single();

  if (error) throw new AppError(400, 'Erro ao criar pasta.', error);

  return { ...(data as Folder), song_count: 0 };
}

export async function updateFolder(
  ministryId: string,
  folderId: string,
  folderData: { name?: string; description?: string | null }
): Promise<Folder> {
  const { data, error } = await supabase()
    .from('folders')
    .update(folderData)
    .eq('id', folderId)
    .eq('ministry_id', ministryId)
    .select('*')
    .single();

  if (error) throw new AppError(400, 'Erro ao atualizar pasta.', error);

  return data as Folder;
}

export async function deleteFolder(
  ministryId: string,
  folderId: string
): Promise<void> {
  const { error } = await supabase()
    .from('folders')
    .delete()
    .eq('id', folderId)
    .eq('ministry_id', ministryId);

  if (error) throw new AppError(400, 'Erro ao excluir pasta.', error);
}

export async function addSongToFolder(
  folderId: string,
  songId: string,
  position?: number
): Promise<void> {
  const pos = position ?? 0;

  const { error } = await supabase()
    .from('folder_songs')
    .insert({
      folder_id: folderId,
      song_id: songId,
      position: pos,
    });

  if (error) {
    if (error.code === '23505') {
      throw new AppError(409, 'Música já está nesta pasta.');
    }
    throw new AppError(400, 'Erro ao adicionar música à pasta.', error);
  }
}

export async function removeSongFromFolder(
  folderId: string,
  songId: string
): Promise<void> {
  const { error } = await supabase()
    .from('folder_songs')
    .delete()
    .eq('folder_id', folderId)
    .eq('song_id', songId);

  if (error) throw new AppError(400, 'Erro ao remover música da pasta.', error);
}

// ============================================================
// COUNTS (for tab badges)
// ============================================================

export async function getRepertoireCounts(
  ministryId: string
): Promise<RepertoireCounts> {
  const [songsRes, foldersRes, artistsRes] = await Promise.all([
    supabase().from('songs').select('id', { count: 'exact', head: true }).eq('ministry_id', ministryId),
    supabase().from('folders').select('id', { count: 'exact', head: true }).eq('ministry_id', ministryId),
    supabase().from('artists').select('id', { count: 'exact', head: true }).eq('ministry_id', ministryId),
  ]);

  return {
    songs: songsRes.count || 0,
    folders: foldersRes.count || 0,
    artists: artistsRes.count || 0,
  };
}
