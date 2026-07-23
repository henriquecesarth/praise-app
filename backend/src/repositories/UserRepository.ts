import { db, authAdmin } from '../lib/firebase';
import { config } from '../config/unifiedConfig';
import { AppError } from '../middleware/error-handler';
import jwt from 'jsonwebtoken';

export interface UserRecordData {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
}

export class UserRepository {
  private readonly usersCollection = db.collection('users');

  /**
   * Cria um novo usuário no Firebase Auth e salva o perfil no Firestore
   */
  async createUser(input: { email: string; password: string; name: string }): Promise<UserRecordData> {
    try {
      // 1. Criar usuário no Firebase Auth
      const userRecord = await authAdmin.createUser({
        email: input.email,
        password: input.password,
        displayName: input.name,
      });

      const userData: UserRecordData = {
        id: userRecord.uid,
        email: input.email,
        name: input.name,
        createdAt: new Date().toISOString(),
      };

      // 2. Salvar documento de perfil no Firestore
      await this.usersCollection.doc(userRecord.uid).set(userData);

      return userData;
    } catch (error: any) {
      if (error.code === 'auth/email-already-exists') {
        throw new AppError(400, 'Este endereço de e-mail já está cadastrado.');
      }
      throw new AppError(400, error.message || 'Erro ao criar usuário no Firebase.');
    }
  }

  /**
   * Autentica usuário por e-mail e gera token JWT da API
   */
  async findByEmail(email: string): Promise<UserRecordData | null> {
    try {
      const userRecord = await authAdmin.getUserByEmail(email);
      const doc = await this.usersCollection.doc(userRecord.uid).get();

      if (doc.exists) {
        return doc.data() as UserRecordData;
      }

      return {
        id: userRecord.uid,
        email: userRecord.email || email,
        name: userRecord.displayName || email.split('@')[0],
      };
    } catch {
      return null;
    }
  }

  /**
   * Buscar perfil do usuário pelo UID
   */
  async findById(uid: string): Promise<UserRecordData | null> {
    try {
      const doc = await this.usersCollection.doc(uid).get();
      if (doc.exists) {
        return doc.data() as UserRecordData;
      }
      const userRecord = await authAdmin.getUser(uid);
      return {
        id: userRecord.uid,
        email: userRecord.email || '',
        name: userRecord.displayName || 'Usuário',
      };
    } catch {
      return null;
    }
  }

  /**
   * Gera token JWT assinado para autenticação de sessões da API
   */
  generateAuthToken(userId: string, email: string): string {
    return jwt.sign(
      { uid: userId, email },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
  }

  /**
   * Valida e decodifica o token JWT da API
   */
  verifyAuthToken(token: string): { uid: string; email?: string } {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { uid: string; email?: string };
      return decoded;
    } catch {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }
  }
}
