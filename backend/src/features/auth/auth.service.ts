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
   * Obter usuário autenticado atual pelo ID de usuário verificado (ou token para retrocompatibilidade)
   */
  async getMe(userIdOrToken: string) {
    if (!userIdOrToken) {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }

    let userId = userIdOrToken;

    // Se fornecido um token compacto (3 partes separadas por ponto: header.payload.sig),
    // decodifica com suporte dual (JWT legado + Firebase ID Token)
    if (userIdOrToken.split('.').length === 3) {
      const decoded = await this.userRepository.verifyToken(userIdOrToken);
      userId = decoded.uid;
    }

    const user = await this.userRepository.findById(userId);

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
