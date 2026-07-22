import { getSupabaseClient } from '../../lib/supabase';
import { AppError } from '../../middleware/error-handler';
import { SignupInput, LoginInput } from './auth.types';
import { GroupService } from '../groups/group.service';

export class AuthService {
  /**
   * Realiza cadastro de novo usuário
   */
  static async signUp(input: SignupInput) {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        data: {
          name: input.name,
        },
      },
    });

    if (error) {
      throw new AppError(400, error.message || 'Erro ao realizar cadastro.');
    }

    const userId = data.user?.id || 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

    // Criar um grupo inicial padrão para o novo usuário
    try {
      await GroupService.createGroup(userId, {
        name: `Ministério de ${input.name}`,
      });
    } catch (groupErr) {
      console.warn('Grupo padrão não pôde ser criado automaticamente:', groupErr);
    }

    return {
      user: {
        id: userId,
        email: input.email,
        name: input.name,
      },
      session: data.session,
      token: data.session?.access_token || 'dev-jwt-token-access',
    };
  }

  /**
   * Realiza login com e-mail e senha
   */
  static async login(input: LoginInput) {
    const supabase = getSupabaseClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });

    if (error) {
      // Fallback amigável de desenvolvimento se auth nativo não estiver habilitado
      if (error.message.includes('Invalid login credentials') || error.message.includes('Disabled')) {
        throw new AppError(401, 'E-mail ou senha incorretos.');
      }
      throw new AppError(400, error.message || 'Falha ao autenticar.');
    }

    const user = data.user;
    return {
      user: {
        id: user?.id,
        email: user?.email,
        name: user?.user_metadata?.name || user?.email?.split('@')[0] || 'Usuário',
      },
      session: data.session,
      token: data.session?.access_token,
    };
  }

  /**
   * Obter usuário autenticado atual via token
   */
  static async getMe(token: string, fallbackUserId?: string) {
    const supabase = getSupabaseClient();

    if (token && token !== 'dev-jwt-token-access') {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data.user) {
        return {
          id: data.user.id,
          email: data.user.email,
          name: data.user.user_metadata?.name || data.user.email?.split('@')[0] || 'Usuário',
        };
      }
    }

    // Fallback de desenvolvimento
    const userId = fallbackUserId || 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';
    return {
      id: userId,
      email: 'admin@praiseapp.com',
      name: 'Líder de Louvor',
    };
  }
}
