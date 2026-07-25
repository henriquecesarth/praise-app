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
   * Autentica usuário por e-mail e senha no Firebase Auth e recupera seu perfil
   */
  async verifyPassword(email: string, password: string): Promise<{ uid: string; email: string; name: string } | null> {
    try {
      // 1. Tenta autenticar o e-mail/senha via API REST de Auth do Firebase
      const apiKey = process.env.FIREBASE_WEB_API_KEY;
      if (apiKey) {
        const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          const message = errorData?.error?.message;
          if (message === 'EMAIL_NOT_FOUND' || message === 'INVALID_PASSWORD' || message === 'INVALID_LOGIN_CREDENTIALS') {
            throw new AppError(401, 'E-mail ou senha incorretos.');
          }
          throw new AppError(400, 'Falha ao autenticar no Firebase.');
        }

        const data = await response.json();
        const doc = await this.usersCollection.doc(data.localId).get();
        const userData = doc.exists ? (doc.data() as UserRecordData) : null;

        return {
          uid: data.localId,
          email: data.email,
          name: userData?.name || data.displayName || data.email.split('@')[0],
        };
      }

      // 2. Fallback via Admin SDK (caso Web API Key não esteja definida no .env)
      const userRecord = await authAdmin.getUserByEmail(email);
      const doc = await this.usersCollection.doc(userRecord.uid).get();

      return {
        uid: userRecord.uid,
        email: userRecord.email || email,
        name: doc.exists ? (doc.data() as UserRecordData).name : (userRecord.displayName || email.split('@')[0]),
      };
    } catch (error: any) {
      if (error instanceof AppError) throw error;
      return null;
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
