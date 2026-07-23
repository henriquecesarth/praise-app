import { UserRepository } from '../../repositories/UserRepository';
import { SignupInput, LoginInput } from './auth.types';
import { AppError } from '../../middleware/error-handler';

export class AuthService {
  constructor(private readonly userRepository: UserRepository = new UserRepository()) {}

  /**
   * Realiza cadastro de novo usuário no Firebase Auth + Firestore
   */
  async signUp(input: SignupInput) {
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
    const user = await this.userRepository.findByEmail(input.email);

    if (!user) {
      throw new AppError(401, 'E-mail ou senha incorretos.');
    }

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
   * Obter usuário autenticado atual via token JWT
   */
  async getMe(token: string) {
    if (!token) {
      throw new AppError(401, 'Token de autenticação não fornecido.');
    }

    const decoded = this.userRepository.verifyAuthToken(token);
    const user = await this.userRepository.findById(decoded.uid);

    if (!user) {
      throw new AppError(404, 'Perfil de usuário não encontrado.');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  }
}
