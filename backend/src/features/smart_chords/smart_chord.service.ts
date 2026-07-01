import { getSupabaseClient } from '../../lib/supabase';
import { SmartChord } from './smart_chord.types';
import { AppError } from '../../middleware/error-handler';

// Local paginated response definition to avoid coupling
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const supabase = () => getSupabaseClient();

export async function getSmartChords(
  userId: string,
  filters: {
    search?: string;
    page?: number;
    limit?: number;
  }
): Promise<PaginatedResponse<SmartChord>> {
  const page = filters.page || 1;
  const limit = filters.limit || 50;
  const offset = (page - 1) * limit;

  let query = supabase()
    .from('smart_chords')
    .select('*, artist:artists(id, name), song:songs(id, title)', { count: 'exact' })
    .eq('user_id', userId);

  if (filters.search) {
    query = query.ilike('title', `%${filters.search}%`);
  }

  const { data, count, error } = await query
    .order('title', { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) throw new AppError(500, 'Erro ao buscar cifras inteligentes.', error);

  const total = count || 0;
  const totalPages = Math.ceil(total / limit);

  return {
    data: (data || []) as SmartChord[],
    total,
    page,
    limit,
    totalPages,
  };
}

export async function getSmartChordById(
  id: string,
  userId: string
): Promise<SmartChord> {
  const { data, error } = await supabase()
    .from('smart_chords')
    .select('*, artist:artists(id, name), song:songs(id, title)')
    .eq('id', id)
    .eq('user_id', userId)
    .single();

  if (error || !data) throw new AppError(404, 'Cifra inteligente não encontrada.');

  return data as SmartChord;
}

export async function createSmartChord(
  userId: string,
  data: Partial<SmartChord>
): Promise<SmartChord> {
  const { data: created, error } = await supabase()
    .from('smart_chords')
    .insert({
      ...data,
      user_id: userId,
    })
    .select('*, artist:artists(id, name), song:songs(id, title)')
    .single();

  if (error) throw new AppError(400, 'Erro ao criar cifra inteligente.', error);

  return created as SmartChord;
}

export async function updateSmartChord(
  id: string,
  userId: string,
  data: Partial<SmartChord>
): Promise<SmartChord> {
  const { data: updated, error } = await supabase()
    .from('smart_chords')
    .update({
      title: data.title,
      artist_id: data.artist_id,
      song_id: data.song_id,
      original_key: data.original_key,
      content: data.content,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId)
    .select('*, artist:artists(id, name), song:songs(id, title)')
    .single();

  if (error) throw new AppError(400, 'Erro ao atualizar cifra inteligente.', error);

  return updated as SmartChord;
}

export async function deleteSmartChord(
  id: string,
  userId: string
): Promise<void> {
  const { error } = await supabase()
    .from('smart_chords')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) throw new AppError(400, 'Erro ao excluir cifra inteligente.', error);
}
