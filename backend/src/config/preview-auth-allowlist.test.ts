import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const { verifyIdToken, createUser } = vi.hoisted(() => ({ verifyIdToken: vi.fn(), createUser: vi.fn() }));
vi.mock('../repositories/AccountDeletionRepository', () => ({
  AccountDeletionRepository: class { isDeletionPending = vi.fn().mockResolvedValue(false); },
}));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../lib/firebase', () => ({
  db: { collection: vi.fn(() => ({ doc: vi.fn(() => ({
    get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ id: 'allowed', email: 'a@test', name: 'A' }) }),
  })) })) },
  authAdmin: { verifyIdToken, createUser },
}));

const secret = 'isolated-preview-auth-test-secret';
const staging = {
  NODE_ENV: 'production', VERCEL_ENV: 'preview', JWT_SECRET: secret,
  FIREBASE_STAGING_PROJECT_ID: 'louvaio-staging', FIREBASE_STAGING_CLIENT_EMAIL: 'staging@example.test',
  FIREBASE_STAGING_PRIVATE_KEY: 'private-fixture', FIREBASE_STAGING_WEB_API_KEY: 'web-key-fixture',
};

beforeEach(() => {
  verifyIdToken.mockReset().mockRejectedValue(new Error('Invalid isolated Firebase token'));
  createUser.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); vi.restoreAllMocks(); });

describe('Preview auth allowlist', () => {
  it.each([
    ['OPERATION_NOT_ALLOWED', undefined, 'OPERATION_NOT_ALLOWED'],
    ['untrusted message with private fixture', [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }], 'API_KEY_HTTP_REFERRER_BLOCKED'],
    ['untrusted message with private fixture', [{ reason: 'private fixture' }], 'UNKNOWN'],
  ])('sanitizes upstream Preview login error %s before identity and allowlist checks', async (message, details, providerCode) => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    const { db } = await import('../lib/firebase');
    vi.mocked(db.collection).mockClear();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { message, details } }),
    }));
    const { UserRepository } = await import('../repositories/UserRepository');
    const repo = new UserRepository();
    const issueToken = vi.spyOn(repo, 'generateAuthToken');
    const error = await repo.verifyPassword('fixture@example.test', 'fixture').catch((value: unknown) => value);
    expect(error).toMatchObject({ statusCode: 400 });
    expect((error as { details: unknown }).details).toEqual({
      code: 'FIREBASE_AUTH_UPSTREAM_REJECTED', providerCode, providerStatus: 400,
    });
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('preserves generic upstream error details in Production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PREVIEW_MODE', 'false');
    vi.stubEnv('JWT_SECRET', secret);
    vi.stubEnv('FIREBASE_WEB_API_KEY', 'production-key-fixture');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: { message: 'OPERATION_NOT_ALLOWED' } }),
    }));
    const { UserRepository } = await import('../repositories/UserRepository');
    const error = await new UserRepository().verifyPassword('fixture@example.test', 'fixture').catch((value: unknown) => value);
    expect(error).toMatchObject({ statusCode: 400, message: 'Falha ao autenticar no Firebase.' });
    expect((error as { details: unknown }).details).toBeUndefined();
  });

  it('rejects missing/empty allowlist before password login calls Firebase', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', ' ');
    const { AuthService } = await import('../features/auth/auth.service');
    const repo = { verifyPassword: vi.fn(), createUser: vi.fn() } as any;
    await expect(new AuthService(repo).login({ email: 'x@test', password: 'pw' })).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.verifyPassword).not.toHaveBeenCalled();
  });

  it('rejects signup before Firebase or Firestore writes', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    const { AuthService } = await import('../features/auth/auth.service');
    const repo = { createUser: vi.fn() } as any;
    await expect(new AuthService(repo).signUp({ email: 'x@test', password: 'pw', name: 'X' })).rejects.toMatchObject({ statusCode: 403 });
    expect(repo.createUser).not.toHaveBeenCalled();
  });

  it('validates Identity Toolkit ID token and uid before reading profile; rejects UID mismatch', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    vi.stubEnv('FIREBASE_STAGING_WEB_API_KEY', 'isolated-key');
    const get = vi.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'Allowed' }) });
    const { db } = await import('../lib/firebase');
    vi.mocked(db.collection).mockReturnValue({ doc: vi.fn(() => ({ get })) } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ localId: 'allowed', idToken: 'token', email: 'a@test' }) }));
    verifyIdToken.mockResolvedValue({ uid: 'other' });
    const { UserRepository } = await import('../repositories/UserRepository');
    await expect(new UserRepository().verifyPassword('a@test', 'pw')).rejects.toMatchObject({ statusCode: 401 });
    expect(get).not.toHaveBeenCalled();
  });

  it('requires a Firebase ID token and rejects it before profile reads when verification fails', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    const get = vi.fn();
    const { db } = await import('../lib/firebase');
    vi.mocked(db.collection).mockReturnValue({ doc: vi.fn(() => ({ get })) } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ localId: 'allowed', email: 'a@test' }) }));
    const { UserRepository } = await import('../repositories/UserRepository');
    await expect(new UserRepository().verifyPassword('a@test', 'pw')).rejects.toMatchObject({ statusCode: 401 });
    expect(verifyIdToken).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired ID token before profile access or API session issuance', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    const get = vi.fn();
    const { db } = await import('../lib/firebase');
    vi.mocked(db.collection).mockReturnValue({ doc: vi.fn(() => ({ get })) } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ localId: 'allowed', idToken: 'expired-token-fixture', email: 'a@test' }) }));
    verifyIdToken.mockRejectedValueOnce(new Error('expired, invalid signature, or wrong project'));
    const { UserRepository } = await import('../repositories/UserRepository');
    const { AuthService } = await import('../features/auth/auth.service');
    const repo = new UserRepository();
    const issueToken = vi.spyOn(repo, 'generateAuthToken');
    await expect(new AuthService(repo).login({ email: 'a@test', password: 'pw' })).rejects.toMatchObject({ statusCode: 401 });
    expect(get).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('verifies the sign-in token and allowlisted UID before profile read and API JWT issuance', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    const order: string[] = [];
    const get = vi.fn(async () => {
      order.push('profile');
      return { exists: true, data: () => ({ id: 'allowed', email: 'a@test', name: 'Allowed' }) };
    });
    const { db } = await import('../lib/firebase');
    vi.mocked(db.collection).mockReturnValue({ doc: vi.fn(() => ({ get })) } as any);
    verifyIdToken.mockImplementationOnce(async () => {
      order.push('verify');
      return { uid: 'allowed', email: 'a@test', name: 'Allowed' };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ localId: 'allowed', idToken: 'verified-token-fixture', email: 'a@test' }) }));
    const { UserRepository } = await import('../repositories/UserRepository');
    const { AuthService } = await import('../features/auth/auth.service');
    const repo = new UserRepository();
    const issueToken = vi.spyOn(repo, 'generateAuthToken').mockImplementation(() => {
      order.push('jwt');
      return 'isolated-api-jwt';
    });
    const result = await new AuthService(repo).login({ email: 'a@test', password: 'pw' });
    expect(order).toEqual(['verify', 'profile', 'jwt']);
    expect(issueToken).toHaveBeenCalledWith('allowed', 'a@test');
    expect(result.token).toBe('isolated-api-jwt');
  });

  it('requires the staging Firebase project id exactly in Preview', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('FIREBASE_STAGING_PROJECT_ID', 'other-staging-project');
    await expect(import('./unifiedConfig')).rejects.toThrow(/dedicated Firebase staging Admin credentials/);
  });

  it('checks allowlist for app JWT and direct Firebase ID tokens', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    const { UserRepository } = await import('../repositories/UserRepository');
    const repo = new UserRepository();
    const jwtForDenied = jwt.sign({ uid: 'denied' }, secret);
    await expect(repo.verifyToken(jwtForDenied)).rejects.toMatchObject({ statusCode: 403 });
    verifyIdToken.mockResolvedValueOnce({ uid: 'denied' });
    await expect(repo.verifyToken('firebase-denied-token')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('does not read a denied user profile or mint an API JWT after a valid Firebase login', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    const get = vi.fn();
    const { db } = await import('../lib/firebase');
    vi.mocked(db.collection).mockReturnValue({ doc: vi.fn(() => ({ get })) } as any);
    verifyIdToken.mockResolvedValueOnce({ uid: 'denied', email: 'denied@test' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ localId: 'denied', idToken: 'valid-but-denied-fixture', email: 'denied@test' }) }));
    const { UserRepository } = await import('../repositories/UserRepository');
    const { AuthService } = await import('../features/auth/auth.service');
    const repo = new UserRepository();
    const issueToken = vi.spyOn(repo, 'generateAuthToken');
    await expect(new AuthService(repo).login({ email: 'denied@test', password: 'pw' })).rejects.toMatchObject({ statusCode: 403 });
    expect(get).not.toHaveBeenCalled();
    expect(issueToken).not.toHaveBeenCalled();
  });

  it('checks the same allowlist on recent Firebase reauthentication', async () => {
    vi.resetModules();
    for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'allowed');
    verifyIdToken.mockResolvedValueOnce({ uid: 'denied', auth_time: Math.floor(Date.now() / 1000) });
    const { requireRecentFirebaseAuth } = await import('../middleware/auth');
    const next = vi.fn();
    await requireRecentFirebaseAuth({ headers: { authorization: 'Bearer denied-firebase-token' } } as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('preserves Production login response with verified Firebase identity and no Preview allowlist', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('JWT_SECRET', secret);
    vi.stubEnv('FIREBASE_PROJECT_ID', 'isolated-production-project-fixture');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', 'isolated-prod@example.test');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', 'isolated-production-private-key-fixture');
    vi.stubEnv('FIREBASE_WEB_API_KEY', 'isolated-production-web-key-fixture');
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', undefined);
    const calls: string[] = [];
    const get = vi.fn(async () => {
      calls.push('profile');
      return { exists: false, data: () => undefined };
    });
    const { db } = await import('../lib/firebase');
    vi.mocked(db.collection).mockReturnValue({ doc: vi.fn(() => ({ get })) } as any);
    verifyIdToken.mockImplementationOnce(async () => {
      calls.push('verify');
      return { uid: 'production-user-fixture', email: 'prod@example.test', name: 'Verified Production Name' };
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ localId: 'production-user-fixture', idToken: 'production-id-token-fixture', email: 'prod@example.test' }),
    }));
    const { UserRepository } = await import('../repositories/UserRepository');
    const { AuthService } = await import('../features/auth/auth.service');
    const result = await new AuthService(new UserRepository()).login({ email: 'prod@example.test', password: 'fixture-password' });
    expect(calls).toEqual(['verify', 'profile']);
    expect(result.user).toEqual({ id: 'production-user-fixture', email: 'prod@example.test', name: 'Verified Production Name' });
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(20);
  });

  it('preserves Production signup with isolated Firebase Auth and Firestore writes', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('JWT_SECRET', secret);
    vi.stubEnv('FIREBASE_PROJECT_ID', 'isolated-production-project-fixture');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', 'isolated-prod@example.test');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', 'isolated-production-private-key-fixture');
    vi.stubEnv('PREVIEW_ALLOWED_UIDS', undefined);
    createUser.mockResolvedValueOnce({ uid: 'new-production-user-fixture' });
    const set = vi.fn().mockResolvedValue(undefined);
    const { db, authAdmin } = await import('../lib/firebase');
    vi.mocked(db.collection).mockReturnValue({ doc: vi.fn(() => ({ set })) } as any);
    const { AuthService } = await import('../features/auth/auth.service');
    const result = await new AuthService().signUp({ email: 'new@example.test', password: 'fixture-password', name: 'New User' });
    expect(vi.mocked(authAdmin.createUser)).toHaveBeenCalledWith({ email: 'new@example.test', password: 'fixture-password', displayName: 'New User' });
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-production-user-fixture', email: 'new@example.test', name: 'New User' }));
    expect(result.user).toEqual({ id: 'new-production-user-fixture', email: 'new@example.test', name: 'New User' });
    expect(typeof result.token).toBe('string');
    expect(result.token.length).toBeGreaterThan(20);
  });
});
