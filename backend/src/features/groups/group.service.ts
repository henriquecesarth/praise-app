import { getSupabaseClient } from '../../lib/supabase';
import { AppError } from '../../middleware/error-handler';
import { CreateGroupInput, CreateInviteInput, JoinGroupInput } from './group.types';
import crypto from 'crypto';

export class GroupService {
  /**
   * Listar todos os grupos em que o usuário é membro ou dono
   */
  static async getUserGroups(userId: string) {
    const supabase = getSupabaseClient();

    // 1. Buscar memberships do usuário
    const { data: memberRows, error: memberErr } = await supabase
      .from('group_members')
      .select('group_id, role')
      .eq('user_id', userId);

    if (memberErr) {
      console.error('Erro ao buscar memberships:', memberErr);
    }

    const groupIds = (memberRows || []).map((m) => m.group_id);

    // 2. Buscar grupos onde o usuário é dono ou integrante
    const { data: groups, error } = await supabase
      .from('groups')
      .select('*')
      .or(`owner_user_id.eq.${userId}${groupIds.length > 0 ? `,id.in.(${groupIds.join(',')})` : ''}`);

    if (error) {
      throw new AppError(500, 'Erro ao carregar grupos do usuário', error);
    }

    // Mapear papel (admin/member) para cada grupo
    return (groups || []).map((group) => {
      const membership = memberRows?.find((m) => m.group_id === group.id);
      const isOwner = group.owner_user_id === userId;
      return {
        ...group,
        role: isOwner ? 'admin' : membership?.role || 'member',
      };
    });
  }

  /**
   * Obter detalhes de um grupo
   */
  static async getGroupById(groupId: string, userId: string) {
    const supabase = getSupabaseClient();

    const { data: group, error } = await supabase
      .from('groups')
      .select('*')
      .eq('id', groupId)
      .single();

    if (error || !group) {
      throw new AppError(404, 'Grupo de louvor não encontrado.');
    }

    const { data: member } = await supabase
      .from('group_members')
      .select('role')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();

    const isOwner = group.owner_user_id === userId;

    return {
      ...group,
      role: isOwner ? 'admin' : member?.role || 'member',
    };
  }

  /**
   * Criar um novo grupo (operação restrita/atrelada a plano de assinatura)
   */
  static async createGroup(userId: string, input: CreateGroupInput) {
    const supabase = getSupabaseClient();

    const baseSlug = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grupo';
    const randomSuffix = Math.random().toString(36).substring(2, 7);
    const slug = input.slug || `${baseSlug}-${randomSuffix}`;

    // Criar registro na tabela groups
    const { data: group, error } = await supabase
      .from('groups')
      .insert({
        name: input.name,
        slug,
        owner_user_id: userId,
        subscription_status: 'active',
      })
      .select()
      .single();

    if (error || !group) {
      throw new AppError(500, 'Falha ao criar o grupo de louvor', error);
    }

    // Adicionar o dono como admin em group_members
    await supabase.from('group_members').insert({
      group_id: group.id,
      user_id: userId,
      role: 'admin',
    });

    return group;
  }

  /**
   * Gerar um código curto de convite (ex: PR-8X2K)
   */
  static async createInviteCode(groupId: string, userId: string, input: CreateInviteInput) {
    const supabase = getSupabaseClient();

    // Gerar código aleatório curto de 6 caracteres
    const rawCode = crypto.randomBytes(3).toString('hex').toUpperCase();
    const code = `PR-${rawCode}`;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + (input.expiresInDays || 7));

    const { data: invite, error } = await supabase
      .from('group_invites')
      .insert({
        group_id: groupId,
        code,
        created_by: userId,
        max_uses: input.maxUses || null,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error || !invite) {
      throw new AppError(500, 'Falha ao gerar o código de convite', error);
    }

    return invite;
  }

  /**
   * Resgatar convite usando o código curto e entrar no grupo como 'member'
   */
  static async joinGroupByCode(userId: string, input: JoinGroupInput) {
    const supabase = getSupabaseClient();
    const cleanCode = input.code.trim().toUpperCase();

    // Buscar convite válido
    const { data: invite, error } = await supabase
      .from('group_invites')
      .select('*, groups(*)')
      .eq('code', cleanCode)
      .single();

    if (error || !invite) {
      throw new AppError(404, 'Código de convite inválido ou não encontrado.');
    }

    // Validar expiração
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      throw new AppError(400, 'Este código de convite já expirou.');
    }

    // Validar limite de usos
    if (invite.max_uses !== null && invite.uses_count >= invite.max_uses) {
      throw new AppError(400, 'Este código de convite atingiu o limite máximo de usos.');
    }

    // Adicionar usuário ao grupo como 'member' (sem permissão de edição)
    const { error: joinErr } = await supabase
      .from('group_members')
      .upsert(
        {
          group_id: invite.group_id,
          user_id: userId,
          role: 'member',
        },
        { onConflict: 'group_id,user_id' }
      );

    if (joinErr) {
      throw new AppError(500, 'Falha ao ingressar no grupo de louvor', joinErr);
    }

    // Incrementar contagem de usos do convite
    await supabase
      .from('group_invites')
      .update({ uses_count: invite.uses_count + 1 })
      .eq('id', invite.id);

    return {
      message: 'Você ingressou no grupo de louvor com sucesso!',
      group: invite.groups,
      role: 'member',
    };
  }

  /**
   * Listar membros de um grupo
   */
  static async getGroupMembers(groupId: string) {
    const supabase = getSupabaseClient();

    const { data: members, error } = await supabase
      .from('group_members')
      .select('*')
      .eq('group_id', groupId);

    if (error) {
      throw new AppError(500, 'Erro ao obter membros do grupo', error);
    }

    return members || [];
  }
}
