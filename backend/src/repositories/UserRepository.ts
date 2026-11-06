import { db, authAdmin } from '../lib/firebase';
import { config } from '../config/unifiedConfig';
import { AppError } from '../middleware/error-handler';
import jwt from 'jsonwebtoken';

export interface UserPreferences {
  chord_font_family?: string;
  chord_line_spacing_px?: number;
  [key: string]: unknown;
}

export interface UserRecordData {
  id: string;
  email: string;
  name: string;
  createdAt?: string;
  preferences?: UserPreferences;
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
   * Autentica usuário por e-mail e senha no Firebase Auth e recupera seu perfil.
   * Exige obrigatoriamente validação criptográfica de credenciais no Firebase.
   */
  async verifyPassword(email: string, password: string): Promise<{ uid: string; email: string; name: string } | null> {
    try {
      const apiKey = config.firebaseWebApiKey || process.env.FIREBASE_WEB_API_KEY;
      if (!apiKey) {
        throw new AppError(500, 'Configuração de autenticação incompleta no servidor (FIREBASE_WEB_API_KEY necessária para login por senha).');
      }

      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as any;
        const message = errorData?.error?.message;
        if (message === 'EMAIL_NOT_FOUND' || message === 'INVALID_PASSWORD' || message === 'INVALID_LOGIN_CREDENTIALS') {
          throw new AppError(401, 'E-mail ou senha incorretos.');
        }
        throw new AppError(400, 'Falha ao autenticar no Firebase.');
      }

      const data = (await response.json()) as any;
      if (typeof data.idToken !== 'string') throw new AppError(401, 'Invalid Firebase identity response.');
      const identity = await authAdmin.verifyIdToken(data.idToken);
      if (!identity.uid || identity.uid !== data.localId) throw new AppError(401, 'Firebase identity mismatch.');
      const doc = await this.usersCollection.doc(identity.uid).get();
      const userData = doc.exists ? (doc.data() as UserRecordData) : null;

      return {
        uid: identity.uid,
        email: data.email,
        name: userData?.name || data.displayName || data.email.split('@')[0],
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
        const data = doc.data() as Partial<UserRecordData> | undefined;
        return {
          id: data?.id || doc.id,
          email: data?.email || '',
          name: data?.name || (data?.email ? data.email.split('@')[0] : 'Usuário'),
          createdAt: data?.createdAt,
          preferences: data?.preferences,
        };
      }
      if (authAdmin && typeof authAdmin.getUser === 'function') {
        const userRecord = await authAdmin.getUser(uid);
        return {
          id: userRecord.uid,
          email: userRecord.email || '',
          name: userRecord.displayName || (userRecord.email ? userRecord.email.split('@')[0] : 'Usuário'),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Gera token JWT assinado para autenticação de sessões da API
   */
  async updatePreferences(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences> {
    if (!userId) {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }

    const userDocRef = this.usersCollection.doc(userId);
    const fields = Object.fromEntries(
      Object.entries(patch).map(([key, value]) => [`preferences.${key}`, value])
    );
    try {
      // Dotted field updates keep unrelated preferences and avoid lost updates when
      // font and spacing are changed concurrently by separate clients.
      await userDocRef.update(fields);
    } catch (error) {
      const code = (error as { code?: string | number })?.code;
      if (code !== 5 && code !== '5' && code !== 'not-found') {
        throw error;
      }

      let verifiedRecord;
      try {
        verifiedRecord = await authAdmin.getUser(userId);
      } catch (authError) {
        const authCode = (authError as { code?: string })?.code;
        if (authCode === 'auth/user-not-found') {
          throw new AppError(404, 'Perfil de usuário não encontrado.');
        }
        throw authError;
      }
      if (verifiedRecord.uid !== userId) {
        throw new AppError(403, 'Identidade do usuário inválida.');
      }
      if (verifiedRecord.disabled) {
        throw new AppError(403, 'Conta de usuário desabilitada.');
      }


      const email = verifiedRecord.email || '';
      const profile: UserRecordData = {
        id: verifiedRecord.uid,
        email,
        name: verifiedRecord.displayName || (email ? email.split('@')[0] : 'Usuário'),
        createdAt: new Date().toISOString(),
        preferences: patch,
      };
      try {
        // create is atomic: one concurrent first writer wins; losers patch only
        // their requested fields and never replace the winning profile.
        await userDocRef.create(profile);
      } catch (createError) {
        const createCode = (createError as { code?: string | number })?.code;
        if (createCode !== 6 && createCode !== '6' && createCode !== 'already-exists') {
          throw createError;
        }
        await userDocRef.update(fields);
      }
    }

    const doc = await userDocRef.get();
    const currentData = doc.data() as Partial<UserRecordData> | undefined;
    return (currentData?.preferences && typeof currentData.preferences === 'object')
      ? currentData.preferences
      : {};
  }


  generateAuthToken(userId: string, email: string): string {
    return jwt.sign(
      { uid: userId, email },
      config.jwtSecret,
      { expiresIn: '7d' }
    );
  }

  /**
   * Valida e decodifica o token JWT da API de forma síncrona
   * @deprecated Utilize verifyToken() para suporte dual a JWT legado e Firebase ID Token.
   */
  verifyAuthToken(token: string): { uid: string; email?: string } {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { uid: string; email?: string };
      return decoded;
    } catch {
      throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
    }
  }

  /**
   * Valida token JWT assinado pela aplicação OU Firebase ID Token
   */
  async verifyToken(token: string): Promise<{ uid: string; email?: string }> {
    // 1. Tentar verificar como JWT próprio da aplicação
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { uid: string; email?: string };
      if (decoded && decoded.uid) {
        return decoded;
      }
    } catch {
      // Falha no JWT próprio, tentar verificar como Firebase ID Token
    }

    // 2. Tentar verificar como Firebase ID Token se o Admin SDK estiver inicializado
    try {
      if (authAdmin && typeof authAdmin.verifyIdToken === 'function') {
        const decodedFb = await authAdmin.verifyIdToken(token);
        if (decodedFb && decodedFb.uid) {
          return {
            uid: decodedFb.uid,
            email: decodedFb.email,
          };
        }
      }
    } catch {
      // Falha na verificação do Firebase ID Token
    }

    throw new AppError(401, 'Sessão inválida ou expirada. Faça login novamente.');
  }
}

