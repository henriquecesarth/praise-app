import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

const { verifyIdToken } = vi.hoisted(() => ({ verifyIdToken: vi.fn() }));
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../lib/firebase', () => ({
  db: { collection: vi.fn(() => ({})) },
  authAdmin: { verifyIdToken },
}));
vi.mock('../repositories/AccountDeletionRepository', () => ({
  AccountDeletionRepository: class { isDeletionPending = vi.fn().mockResolvedValue(false); },
}));

// Public development fallback and isolated test fixtures, never deployed credentials.
const developmentDefault = 'praise-app-jwt-secret-key-change-in-production';
const secureFixture = 'isolated-jwt-regression-fixture-not-a-deployed-secret';
const stagingConfig = {
  FIREBASE_STAGING_PROJECT_ID: 'louvaio-staging',
  FIREBASE_STAGING_CLIENT_EMAIL: 'isolated-staging@example.test',
  FIREBASE_STAGING_PRIVATE_KEY: 'isolated-staging-private-key-fixture',
  FIREBASE_STAGING_WEB_API_KEY: 'isolated-staging-web-api-key-fixture',
};

beforeEach(() => {
  vi.resetModules();
  verifyIdToken.mockReset().mockRejectedValue(new Error('Invalid Firebase fixture'));
  for (const key of ['VERCEL_ENV', 'VERCEL', 'PREVIEW_MODE', 'JWT_SECRET', ...Object.keys(stagingConfig)]) vi.stubEnv(key, undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

for (const stage of ['production', 'preview']) {
  for (const [label, secret] of [['missing', undefined], ['default', developmentDefault], ['empty', ''], ['blank', '   ']] as const) {
    it(`${stage} rejects ${label} JWT configuration without exposing values`, async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VERCEL_ENV', stage);
      if (stage === 'preview') {
        for (const [key, value] of Object.entries(stagingConfig)) vi.stubEnv(key, value);
      }
      vi.stubEnv('JWT_SECRET', secret);
      await expect(import('./unifiedConfig')).rejects.toThrow(/JWT_SECRET inseguro/);
    });
  }
  it(`${stage} accepts an explicitly configured nondefault JWT secret`, async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', stage);
    if (stage === 'preview') {
      for (const [key, value] of Object.entries(stagingConfig)) vi.stubEnv(key, value);
    }
    vi.stubEnv('JWT_SECRET', secureFixture);
    const { config } = await import('./unifiedConfig');
    expect(config.jwtSecret === secureFixture).toBe(true);
  });
}

for (const flag of ['1', 'true']) {
  it(`VERCEL=${flag} rejects missing secret even with NODE_ENV=development`, async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VERCEL', flag);
    await expect(import('./unifiedConfig')).rejects.toThrow(/JWT_SECRET inseguro/);
  });
}
for (const nodeEnv of ['development', 'test']) {
  it(`${nodeEnv} remains possible without remote/Preview flags`, async () => {
    vi.stubEnv('NODE_ENV', nodeEnv);
    const { config } = await import('./unifiedConfig');
    expect(config.nodeEnv).toBe(nodeEnv);
  });
}

it('production configuration preserves guards and reconciliation configuration', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('JWT_SECRET', secureFixture);
  vi.stubEnv('BILLING_RECONCILIATION_ENABLED', 'true');
  const { isPreviewEnvironment, config } = await import('./unifiedConfig');
  expect(isPreviewEnvironment()).toBe(false);
  expect(config.billingReconciliationEnabled).toBe(true);
});

describe('M20-C8B: Vercel environment detection and fail-closed isolation matrix', () => {
  it('VERCEL=1, VERCEL_ENV=production, PREVIEW_MODE=ausente -> Produção', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PREVIEW_MODE', undefined);
    vi.stubEnv('JWT_SECRET', secureFixture);
    const { isPreviewEnvironment } = await import('./unifiedConfig');
    expect(isPreviewEnvironment()).toBe(false);
  });

  it('VERCEL=1, VERCEL_ENV=preview, PREVIEW_MODE=ausente -> Preview', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PREVIEW_MODE', undefined);
    vi.stubEnv('JWT_SECRET', secureFixture);
    for (const [key, value] of Object.entries(stagingConfig)) vi.stubEnv(key, value);
    const { isPreviewEnvironment } = await import('./unifiedConfig');
    expect(isPreviewEnvironment()).toBe(true);
  });

  it('VERCEL=1, VERCEL_ENV=production, PREVIEW_MODE=true -> Erro de configuração (fail closed)', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('PREVIEW_MODE', 'true');
    vi.stubEnv('JWT_SECRET', secureFixture);
    await expect(import('./unifiedConfig')).rejects.toThrow(/CONFIG_CONFLICT/);
  });

  it('VERCEL=1, VERCEL_ENV=preview, PREVIEW_MODE=true -> Preview', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('PREVIEW_MODE', 'true');
    vi.stubEnv('JWT_SECRET', secureFixture);
    for (const [key, value] of Object.entries(stagingConfig)) vi.stubEnv(key, value);
    const { isPreviewEnvironment } = await import('./unifiedConfig');
    expect(isPreviewEnvironment()).toBe(true);
  });

  it('VERCEL=ausente, VERCEL_ENV=ausente, PREVIEW_MODE=true -> Preview local explícito', async () => {
    vi.stubEnv('VERCEL', undefined);
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('PREVIEW_MODE', 'true');
    vi.stubEnv('JWT_SECRET', secureFixture);
    for (const [key, value] of Object.entries(stagingConfig)) vi.stubEnv(key, value);
    const { isPreviewEnvironment } = await import('./unifiedConfig');
    expect(isPreviewEnvironment()).toBe(true);
  });

  it('VERCEL=1, VERCEL_ENV=ausente, PREVIEW_MODE=ausente -> Não presumir Preview', async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('PREVIEW_MODE', undefined);
    vi.stubEnv('JWT_SECRET', secureFixture);
    const { isPreviewEnvironment } = await import('./unifiedConfig');
    expect(isPreviewEnvironment()).toBe(false);
  });
});

it('secure Preview rejects crafted development-secret tokens through the auth middleware', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'preview');
  for (const [key, value] of Object.entries(stagingConfig)) vi.stubEnv(key, value);
  vi.stubEnv('JWT_SECRET', secureFixture);
  vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'fixture-user,firebase-user');
  const { authenticate } = await import('../middleware/auth');
  const crafted = jwt.sign({ uid: 'fixture-user' }, developmentDefault, { expiresIn: '1h' });
  const next = vi.fn();
  await authenticate({ headers: { authorization: `Bearer ${crafted}` }, originalUrl: '/api/v1/auth/me' } as any, {} as any, next);
  expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
});

it('secure Preview preserves legitimate JWT and Firebase ID-token authentication', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'preview');
  for (const [key, value] of Object.entries(stagingConfig)) vi.stubEnv(key, value);
  vi.stubEnv('JWT_SECRET', secureFixture);
  vi.stubEnv('PREVIEW_ALLOWED_UIDS', 'fixture-user,firebase-user');
  const { UserRepository } = await import('../repositories/UserRepository');
  const repository = new UserRepository();
  const legitimate = jwt.sign({ uid: 'fixture-user' }, secureFixture, { expiresIn: '1h' });
  await expect(repository.verifyToken(legitimate)).resolves.toMatchObject({ uid: 'fixture-user' });
  expect(verifyIdToken).not.toHaveBeenCalled();
  verifyIdToken.mockResolvedValueOnce({ uid: 'firebase-user', email: 'fixture@example.test' });
  await expect(repository.verifyToken('isolated-firebase-token-fixture')).resolves.toMatchObject({ uid: 'firebase-user' });
});

for (const [flagKey, flagValue] of [['PREVIEW_MODE', 'true'], ['VERCEL_ENV', 'preview']] as const) {
  it(`Preview mode (${flagKey}=${flagValue}) never falls back to production Firebase credentials and fails closed without staging config`, async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv(flagKey, flagValue);
    vi.stubEnv('JWT_SECRET', secureFixture);
    vi.stubEnv('FIREBASE_PROJECT_ID', 'praise-app-7a362');
    vi.stubEnv('FIREBASE_CLIENT_EMAIL', 'prod@example.test');
    vi.stubEnv('FIREBASE_PRIVATE_KEY', 'prod-private-key-fixture');
    vi.stubEnv('FIREBASE_WEB_API_KEY', 'prod-web-api-key-fixture');
    await expect(import('./unifiedConfig')).rejects.toThrow(
      /Preview requires dedicated Firebase staging Admin credentials/,
    );
  });
}

it('production environment on Vercel (VERCEL=1, VERCEL_ENV=production) allows production Firebase credentials and is not treated as Preview', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('JWT_SECRET', secureFixture);
  vi.stubEnv('FIREBASE_PROJECT_ID', 'praise-app-7a362');
  vi.stubEnv('FIREBASE_CLIENT_EMAIL', 'prod@example.test');
  vi.stubEnv('FIREBASE_PRIVATE_KEY', 'prod-private-key-fixture');
  vi.stubEnv('FIREBASE_WEB_API_KEY', 'prod-web-api-key-fixture');
  const { config, isPreviewEnvironment } = await import('./unifiedConfig');
  expect(isPreviewEnvironment()).toBe(false);
  expect(config.firebase.projectId).toBe('praise-app-7a362');
});
