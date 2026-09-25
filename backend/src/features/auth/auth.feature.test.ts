import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { config } from '../../config/unifiedConfig';
import { authAdmin, db } from '../../lib/firebase';
import { UserRepository } from '../../repositories/UserRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { AuthService } from './auth.service';
import { AppError } from '../../middleware/error-handler';

describe('Auth Feature & Mobile V1-M0 Firebase ID Token Compatibility Suite', () => {
  let server: http.Server;
  let baseUrl: string;

  const validLegacyUid = 'usr-legacy-001';
  const validLegacyEmail = 'legacy.user@louvaio.com';
  const validLegacyName = 'Legacy LouvAIO User';

  const validFirebaseUid = 'fb-uid-mobile-002';
  const validFirebaseEmail = 'flutter.mobile@louvaio.com';
  const validFirebaseName = 'Flutter Mobile User';

  const validLegacyToken = jwt.sign(
    { uid: validLegacyUid, email: validLegacyEmail },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  const expiredLegacyToken = jwt.sign(
    { uid: 'usr-expired', email: 'expired@louvaio.com' },
    config.jwtSecret,
    { expiresIn: '-10s' }
  );

  const validFirebaseToken = 'mock.firebase.idtoken.header.payload.signature';
  const invalidFirebaseToken = 'mock.invalid.token.header.payload.signature';

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default authAdmin.verifyIdToken spy
    vi.spyOn(authAdmin, 'verifyIdToken').mockImplementation(async (token: string) => {
      if (token === validFirebaseToken) {
        return {
          uid: validFirebaseUid,
          email: validFirebaseEmail,
        } as any;
      }
      throw new Error('Firebase ID token verification failed');
    });
  });

  describe('1. Full HTTP Express Pipeline & Route Integration (/api/v1/auth/me)', () => {
    beforeEach(() => {
      vi.spyOn(UserRepository.prototype, 'findById').mockImplementation(async (uid: string) => {
        if (uid === validLegacyUid) {
          return {
            id: validLegacyUid,
            email: validLegacyEmail,
            name: validLegacyName,
          };
        }
        if (uid === validFirebaseUid) {
          return {
            id: validFirebaseUid,
            email: validFirebaseEmail,
            name: validFirebaseName,
          };
        }
        return null;
      });
    });

    it('Scenario A: valid legacy LouvAIO JWT returns 200 with user profile', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validLegacyToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data).toEqual({
        id: validLegacyUid,
        email: validLegacyEmail,
        name: validLegacyName,
      });
    });

    it('Scenario B: valid Firebase ID token returns 200 without redundant JWT rejection', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validFirebaseToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data).toBeDefined();
    });

    it('Scenario C: response identity strictly matches authenticated Firebase UID and profile', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validFirebaseToken}`,
        },
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as any;
      expect(data.id).toBe(validFirebaseUid);
      expect(data.email).toBe(validFirebaseEmail);
      expect(data.name).toBe(validFirebaseName);
    });

    it('Scenario D: malformed bearer token returns 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer invalid.malformed.token',
        },
      });

      expect(response.status).toBe(401);
      const data = (await response.json()) as any;
      expect(data.error?.message).toMatch(/Sessão inválida ou expirada/i);
    });

    it('Scenario E: invalid Firebase token returns 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${invalidFirebaseToken}`,
        },
      });

      expect(response.status).toBe(401);
      const data = (await response.json()) as any;
      expect(data.error?.message).toMatch(/Sessão inválida ou expirada/i);
    });

    it('Scenario F: expired legacy JWT returns 401', async () => {
      const response = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${expiredLegacyToken}`,
        },
      });

      expect(response.status).toBe(401);
      const data = (await response.json()) as any;
      expect(data.error?.message).toMatch(/Sessão inválida ou expirada/i);
    });

    it('Scenario G: no bearer token or non-Bearer scheme returns 401', async () => {
      // 1. Missing header
      const resMissing = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
      });
      expect(resMissing.status).toBe(401);
      const dataMissing = (await resMissing.json()) as any;
      expect(dataMissing.error?.message).toMatch(/Token de autenticação não fornecido/i);

      // 2. Non-Bearer scheme
      const resBasic = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: 'Basic dXNlcm5hbWU6cGFzc3dvcmQ=',
        },
      });
      expect(resBasic.status).toBe(401);

      // 3. Empty Bearer token
      const resEmpty = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: 'Bearer ',
        },
      });
      expect(resEmpty.status).toBe(401);
    });

    it('Scenario H: Firebase-authenticated caller cannot select another user through request parameters', async () => {
      const attackerAttemptingVictimLookup = await fetch(
        `${baseUrl}/api/v1/auth/me?userId=victim-user-999&id=victim-user-999`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${validFirebaseToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      expect(attackerAttemptingVictimLookup.status).toBe(200);
      const data = (await attackerAttemptingVictimLookup.json()) as any;
      // Must strictly return the authenticated Firebase user, ignoring query parameters
      expect(data.id).toBe(validFirebaseUid);
      expect(data.id).not.toBe('victim-user-999');
    });

    it('Scenario I: existing /auth/login PWA flow remains green and authorizes /auth/me', async () => {
      const pwaUid = 'pwa-user-login-777';
      const pwaEmail = 'pwa.member@louvaio.com';
      const pwaName = 'PWA Active Member';

      // Mock verifyPassword for standard PWA login
      vi.spyOn(UserRepository.prototype, 'verifyPassword').mockResolvedValue({
        uid: pwaUid,
        email: pwaEmail,
        name: pwaName,
      });

      // 1. POST /api/v1/auth/login
      const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: pwaEmail,
          password: 'securePassword123!',
        }),
      });

      expect(loginRes.status).toBe(200);
      const loginBody = (await loginRes.json()) as any;
      expect(loginBody.user).toEqual({
        id: pwaUid,
        email: pwaEmail,
        name: pwaName,
      });
      expect(typeof loginBody.token).toBe('string');
      expect(loginBody.token.length).toBeGreaterThan(20);

      // Mock findById for the newly logged-in PWA user
      vi.spyOn(UserRepository.prototype, 'findById').mockImplementation(async (uid: string) => {
        if (uid === pwaUid) {
          return { id: pwaUid, email: pwaEmail, name: pwaName };
        }
        return null;
      });

      // 2. GET /api/v1/auth/me with the issued token
      const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${loginBody.token}`,
        },
      });

      expect(meRes.status).toBe(200);
      const meBody = (await meRes.json()) as any;
      expect(meBody).toEqual({
        id: pwaUid,
        email: pwaEmail,
        name: pwaName,
      });
    });

    it('Scenario J: representative protected ministry route accepts Firebase ID token without regression', async () => {
      // Mock MinistryRepository to return ministry list for the Firebase user
      vi.spyOn(MinistryRepository.prototype, 'getUserMinistries').mockResolvedValue([
        {
          id: 'min-test-100',
          name: 'Ministério de Louvor Central',
          role: 'member',
          created_at: new Date().toISOString(),
        } as any,
      ]);

      const ministryRes = await fetch(`${baseUrl}/api/v1/ministries/my-ministries`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${validFirebaseToken}`,
        },
      });

      expect(ministryRes.status).toBe(200);
      const ministryList = (await ministryRes.json()) as any;
      expect(Array.isArray(ministryList)).toBe(true);
      expect(ministryList).toHaveLength(1);
      expect(ministryList[0].id).toBe('min-test-100');
    });
  });

  describe('2. Unit: AuthService.getMe', () => {
    let authService: AuthService;
    let userRepo: UserRepository;

    beforeEach(() => {
      userRepo = new UserRepository();
      authService = new AuthService(userRepo);
    });

    it('fetches profile directly when passed a verified userId without redundant verification', async () => {
      const verifyTokenSpy = vi.spyOn(userRepo, 'verifyToken');
      const findByIdSpy = vi.spyOn(userRepo, 'findById').mockResolvedValue({
        id: 'usr-direct-1',
        email: 'direct@louvaio.com',
        name: 'Direct User',
      });

      const result = await authService.getMe('usr-direct-1');

      expect(result).toEqual({
        id: 'usr-direct-1',
        email: 'direct@louvaio.com',
        name: 'Direct User',
      });
      // Crucial: verifyToken must NOT have been called when userId is provided directly
      expect(verifyTokenSpy).not.toHaveBeenCalled();
      expect(findByIdSpy).toHaveBeenCalledWith('usr-direct-1');
    });

    it('supports dual-verification if passed a compact token (retrocompatibility)', async () => {
      vi.spyOn(userRepo, 'verifyToken').mockResolvedValue({
        uid: 'usr-from-token',
        email: 'token@louvaio.com',
      });
      vi.spyOn(userRepo, 'findById').mockResolvedValue({
        id: 'usr-from-token',
        email: 'token@louvaio.com',
        name: 'Token User',
      });

      const result = await authService.getMe('header.payload.sig');
      expect(result.id).toBe('usr-from-token');
    });

    it('throws AppError 404 when user profile does not exist', async () => {
      vi.spyOn(userRepo, 'findById').mockResolvedValue(null);

      await expect(authService.getMe('usr-nonexistent')).rejects.toThrow(
        expect.objectContaining({ statusCode: 404 })
      );
    });

    it('throws AppError 401 when userId is empty', async () => {
      await expect(authService.getMe('')).rejects.toThrow(
        expect.objectContaining({ statusCode: 401 })
      );
    });
  });

  describe('3. Unit: UserRepository.findById', () => {
    let userRepo: UserRepository;

    beforeEach(() => {
      userRepo = new UserRepository();
    });

    it('returns document with id guaranteed from doc.id if id field is missing in Firestore data', async () => {
      vi.spyOn((userRepo as any).usersCollection, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: true,
          id: 'usr-doc-key-123',
          data: () => ({
            email: 'profile@louvaio.com',
            name: 'Profile Without Explicit Id Field',
          }),
        }),
      });

      const user = await userRepo.findById('usr-doc-key-123');
      expect(user).toBeDefined();
      expect(user!.id).toBe('usr-doc-key-123');
      expect(user!.email).toBe('profile@louvaio.com');
      expect(user!.name).toBe('Profile Without Explicit Id Field');
    });

    it('falls back to authAdmin.getUser when document does not exist in Firestore', async () => {
      vi.spyOn((userRepo as any).usersCollection, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: false,
        }),
      });

      vi.spyOn(authAdmin, 'getUser').mockResolvedValue({
        uid: 'fb-user-auth-only',
        email: 'authonly@louvaio.com',
        displayName: 'Firebase Display Name',
      } as any);

      const user = await userRepo.findById('fb-user-auth-only');
      expect(user).toBeDefined();
      expect(user!.id).toBe('fb-user-auth-only');
      expect(user!.email).toBe('authonly@louvaio.com');
      expect(user!.name).toBe('Firebase Display Name');
    });

    it('returns null if neither Firestore nor authAdmin finds the user', async () => {
      vi.spyOn((userRepo as any).usersCollection, 'doc').mockReturnValue({
        get: vi.fn().mockResolvedValue({
          exists: false,
        }),
      });

      vi.spyOn(authAdmin, 'getUser').mockRejectedValue(new Error('User not found in Firebase Auth'));

      const user = await userRepo.findById('non-existent-uid');
      expect(user).toBeNull();
    });
  });

  describe('4. Unit: UserRepository.verifyToken', () => {
    let userRepo: UserRepository;

    beforeEach(() => {
      userRepo = new UserRepository();
    });

    it('verifies valid application-signed JWT', async () => {
      const token = jwt.sign({ uid: 'usr-jwt-1', email: 'jwt1@test.com' }, config.jwtSecret);
      const decoded = await userRepo.verifyToken(token);
      expect(decoded.uid).toBe('usr-jwt-1');
      expect(decoded.email).toBe('jwt1@test.com');
    });

    it('verifies valid Firebase ID Token when JWT verification fails', async () => {
      vi.spyOn(authAdmin, 'verifyIdToken').mockResolvedValue({
        uid: 'fb-token-uid-2',
        email: 'fb2@test.com',
      } as any);

      const decoded = await userRepo.verifyToken('valid-firebase-token-here');
      expect(decoded.uid).toBe('fb-token-uid-2');
      expect(decoded.email).toBe('fb2@test.com');
    });

    it('throws AppError 401 when both JWT and Firebase verifiers fail', async () => {
      vi.spyOn(authAdmin, 'verifyIdToken').mockRejectedValue(new Error('Invalid token'));

      await expect(userRepo.verifyToken('completely-invalid-token')).rejects.toThrow(
        expect.objectContaining({ statusCode: 401 })
      );
    });
  });
});
