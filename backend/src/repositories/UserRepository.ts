import { db, authAdmin } from '../lib/firebase';
import { assertPreviewUidAllowed, config, isPreviewEnvironment } from '../config/unifiedConfig';
import { AppError } from '../middleware/error-handler';
import jwt from 'jsonwebtoken';

export interface UserPreferences {
  chord_font_family?: string;
  [key: string]: any;
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
    if (isPreviewEnvironment()) {
      throw new AppError(403, 'Cadastro desabilitado no ambiente de Preview.', { code: 'PREVIEW_MODE_BLOCKED' });
    }
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
      const apiKey = config.firebaseWebApiKey || (!isPreviewEnvironment() ? process.env.FIREBASE_WEB_API_KEY : undefined);
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
        if (isPreviewEnvironment()) {
          // Never forward provider messages/details: they may contain credentials or personal data.
          const safeCodes = new Set([
            'OPERATION_NOT_ALLOWED', 'USER_DISABLED', 'TOO_MANY_ATTEMPTS_TRY_LATER',
            'API_KEY_INVALID', 'API_KEY_HTTP_REFERRER_BLOCKED', 'API_KEY_SERVICE_BLOCKED',
            'CONFIGURATION_NOT_FOUND', 'PROJECT_NOT_FOUND', 'SERVICE_DISABLED',
          ]);
          const reason = Array.isArray(errorData?.error?.details)
            ? errorData.error.details.find((detail: unknown) =>
              typeof detail === 'object' && detail !== null && 'reason' in detail &&
              typeof detail.reason === 'string' && safeCodes.has(detail.reason))?.reason
            : undefined;
          const providerCode = typeof message === 'string' && safeCodes.has(message)
            ? message
            : reason || 'UNKNOWN';
          throw new AppError(400, 'Falha ao autenticar no Firebase.', {
            code: 'FIREBASE_AUTH_UPSTREAM_REJECTED', providerCode, providerStatus: response.status,
          });
        }
        throw new AppError(400, 'Falha ao autenticar no Firebase.');
      }

      const data = (await response.json()) as any;
      if (!data?.idToken || !data?.localId) {
        throw new AppError(401, 'Falha ao autenticar no Firebase.');
      }
      let verified: Awaited<ReturnType<typeof authAdmin.verifyIdToken>>;
      try {
        verified = await authAdmin.verifyIdToken(data.idToken);
      } catch {
        throw new AppError(401, 'Falha ao autenticar no Firebase.');
      }
      if (!verified?.uid || verified.uid !== data.localId) {
        throw new AppError(401, 'Falha ao autenticar no Firebase.');
      }
      assertPreviewUidAllowed(verified.uid);
      const doc = await this.usersCollection.doc(verified.uid).get();
      const userData = doc.exists ? (doc.data() as UserRecordData) : null;

      return {
        uid: verified.uid,
        email: verified.email || '',
        name: userData?.name || (typeof verified.name === 'string' && verified.name) || (verified.email ? verified.email.split('@')[0] : 'Usuário'),
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
          preferences: undefined,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Atualiza preferências do usuário autenticado no Firestore com preservação estrita de campos existentes
   */
  async updatePreferences(userId: string, patch: Partial<UserPreferences>): Promise<UserPreferences> {
    const userDocRef = this.usersCollection.doc(userId);
    const doc = await userDocRef.get();
    if (!doc.exists) {
      throw new AppError(404, 'Perfil de usuário não encontrado.');
    }

    const currentData = doc.data() as Partial<UserRecordData> | undefined;
    const currentPreferences = (currentData?.preferences && typeof currentData.preferences === 'object')
      ? currentData.preferences
      : {};

    const updatedPreferences: UserPreferences = {
      ...currentPreferences,
      ...patch,
    };

    await userDocRef.set(
      {
        preferences: updatedPreferences,
      },
      { merge: true }
    );

    return updatedPreferences;
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
   * Valida e decodifica o token JWT da API de forma síncrona
   * @deprecated Utilize verifyToken() para suporte dual a JWT legado e Firebase ID Token.
   */
  verifyAuthToken(token: string): { uid: string; email?: string } {
    try {
      const decoded = jwt.verify(token, config.jwtSecret) as { uid: string; email?: string };
      assertPreviewUidAllowed(decoded.uid);
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
    let decodedJwt: { uid: string; email?: string } | undefined;
    try {
      decodedJwt = jwt.verify(token, config.jwtSecret) as { uid: string; email?: string };
    } catch {
      // Falha no JWT próprio, tentar verificar como Firebase ID Token
    }
    if (decodedJwt?.uid) {
      assertPreviewUidAllowed(decodedJwt.uid);
      return decodedJwt;
    }

    // 2. Tentar verificar como Firebase ID Token se o Admin SDK estiver inicializado
    try {
      if (authAdmin && typeof authAdmin.verifyIdToken === 'function') {
        const decodedFb = await authAdmin.verifyIdToken(token);
        if (decodedFb && decodedFb.uid) {
          assertPreviewUidAllowed(decodedFb.uid);
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

