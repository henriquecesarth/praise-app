import { getSupabaseClient } from '../../lib/supabase';
import { AppError } from '../../middleware/error-handler';
import { CreateLiturgyInput, UpdateLiturgyInput } from './liturgy.types';

export class LiturgyService {
  /**
   * Listar todas as liturgias de um grupo
   */
  static async listLiturgies(groupId: string) {
    const supabase = getSupabaseClient();

    const { data: liturgies, error } = await supabase
      .from('liturgies')
      .select('*, liturgy_items(*, song:songs(*))')
      .eq('group_id', groupId)
      .order('date', { ascending: false });

    if (error) {
      throw new AppError(500, 'Erro ao listar liturgias do grupo', error);
    }

    return liturgies || [];
  }

  /**
   * Buscar detalhes de uma liturgia específica por ID
   */
  static async getLiturgyById(groupId: string, liturgyId: string) {
    const supabase = getSupabaseClient();

    const { data: liturgy, error } = await supabase
      .from('liturgies')
      .select('*, liturgy_items(*, song:songs(*, artist:artists(*)))')
      .eq('group_id', groupId)
      .eq('id', liturgyId)
      .single();

    if (error || !liturgy) {
      throw new AppError(404, 'Liturgia não encontrada.');
    }

    return liturgy;
  }

  /**
   * Criar nova liturgia com itens (Somente Admin)
   */
  static async createLiturgy(groupId: string, userId: string, input: CreateLiturgyInput) {
    const supabase = getSupabaseClient();

    const { data: liturgy, error } = await supabase
      .from('liturgies')
      .insert({
        group_id: groupId,
        title: input.title,
        date: input.date,
        description: input.description,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !liturgy) {
      throw new AppError(500, 'Erro ao criar liturgia', error);
    }

    if (input.items && input.items.length > 0) {
      const itemsToInsert = input.items.map((item, index) => ({
        liturgy_id: liturgy.id,
        song_id: item.songId || null,
        type: item.type || 'song',
        title: item.title,
        notes: item.notes || null,
        position: item.position ?? index,
      }));

      const { error: itemsErr } = await supabase
        .from('liturgy_items')
        .insert(itemsToInsert);

      if (itemsErr) {
        console.error('Erro ao adicionar itens à liturgia:', itemsErr);
      }
    }

    return this.getLiturgyById(groupId, liturgy.id);
  }

  /**
   * Atualizar liturgia (Somente Admin)
   */
  static async updateLiturgy(groupId: string, liturgyId: string, input: UpdateLiturgyInput) {
    const supabase = getSupabaseClient();

    const updatePayload: Record<string, any> = {};
    if (input.title !== undefined) updatePayload.title = input.title;
    if (input.date !== undefined) updatePayload.date = input.date;
    if (input.description !== undefined) updatePayload.description = input.description;

    if (Object.keys(updatePayload).length > 0) {
      const { error } = await supabase
        .from('liturgies')
        .update(updatePayload)
        .eq('group_id', groupId)
        .eq('id', liturgyId);

      if (error) {
        throw new AppError(500, 'Erro ao atualizar liturgia', error);
      }
    }

    if (input.items !== undefined) {
      // Substituir itens existentes
      await supabase.from('liturgy_items').delete().eq('liturgy_id', liturgyId);

      if (input.items.length > 0) {
        const itemsToInsert = input.items.map((item, index) => ({
          liturgy_id: liturgyId,
          song_id: item.songId || null,
          type: item.type || 'song',
          title: item.title,
          notes: item.notes || null,
          position: item.position ?? index,
        }));

        await supabase.from('liturgy_items').insert(itemsToInsert);
      }
    }

    return this.getLiturgyById(groupId, liturgyId);
  }

  /**
   * Deletar liturgia (Somente Admin)
   */
  static async deleteLiturgy(groupId: string, liturgyId: string) {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('liturgies')
      .delete()
      .eq('group_id', groupId)
      .eq('id', liturgyId);

    if (error) {
      throw new AppError(500, 'Erro ao deletar liturgia', error);
    }

    return { message: 'Liturgia removida com sucesso.' };
  }
}
