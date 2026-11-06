import { UserRepository } from '../../repositories/UserRepository';
import {
  SignupInput,
  LoginInput,
  UpdatePreferencesInput,
  SUPPORTED_CHORD_FONTS,
  DEFAULT_CHORD_FONT,
} from './auth.types';
import { AppError } from '../../middleware/error-handler';
import { config, isPreviewEnvironment } from '../../config/unifiedConfig';

export class AuthService {
  constructor(private readonly userRepository: UserRepository = new UserRepository()) {}

  /**
   * Realiza cadastro de novo usuário no Firebase Auth + Firestore
   */
  async signUp(input: SignupInput) {
    if (isPreviewEnvironment()) {
      throw new AppError(403, 'Cadastro desabilitado no ambiente de Preview.', { code: 'PREVIEW_MODE_BLOCKED' });
    }
    const user = await this.userRepository.createUser({
      email: input.email,
      password: input.password,
      name: input.name,
    });

    const token = this.userRepository.generateAuthToken(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      token,
    };
  }

  /**
   * Realiza login de usuário
   */
  async login(input: LoginInput) {
    if (isPreviewEnvironment() && !(config.previewAllowedUids || '').trim()) {
      throw new AppError(403, 'Acesso restrito no ambiente de Preview.', { code: 'PREVIEW_UID_NOT_ALLOWED' });
    }
    const user = await this.userRepository.verifyPassword(input.email, input.password);

    if (!user) {
      throw new AppError(401, 'E-mail ou senha incorretos.');
    }

    const token = this.userRepository.generateAuthToken(user.uid, user.email);

    return {
      user: {
        id: user.uid,
        email: user.email,
        name: user.name,
      },
      token,
    };
  }

  /**
   * Obter perfil do usuário autenticado atual pelo ID de usuário verificado
   */
  async getMe(userId: string) {
    if (!userId) {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }

    const user = await this.userRepository.findById(userId);

    if (!user) {
      throw new AppError(404, 'Perfil de usuário não encontrado.');
    }

    const userPrefs = user.preferences && typeof user.preferences === 'object' ? user.preferences : {};
    const effectiveChordFont = (
      typeof userPrefs.chord_font_family === 'string' &&
      SUPPORTED_CHORD_FONTS.includes(userPrefs.chord_font_family as any)
    )
      ? userPrefs.chord_font_family
      : DEFAULT_CHORD_FONT;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      preferences: {
        ...userPrefs,
        chord_font_family: effectiveChordFont,
      },
    };
  }

  /**
   * Atualiza preferências do usuário autenticado preservando campos preexistentes
   */
  async updatePreferences(userId: string, input: UpdatePreferencesInput) {
    if (!userId) {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }

    const updatedPreferences = await this.userRepository.updatePreferences(userId, input);

    const effectiveChordFont = (
      typeof updatedPreferences.chord_font_family === 'string' &&
      SUPPORTED_CHORD_FONTS.includes(updatedPreferences.chord_font_family as any)
    )
      ? updatedPreferences.chord_font_family
      : DEFAULT_CHORD_FONT;

    return {
      ...updatedPreferences,
      chord_font_family: effectiveChordFont,
    };
  }
}
