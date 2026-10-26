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

beforeEach(() => {
  vi.resetModules();
  verifyIdToken.mockReset().mockRejectedValue(new Error('Invalid Firebase fixture'));
  for (const key of ['VERCEL_ENV', 'VERCEL', 'PREVIEW_MODE', 'JWT_SECRET']) vi.stubEnv(key, undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

for (const stage of ['production', 'preview']) {
  for (const [label, secret] of [['missing', undefined], ['default', developmentDefault], ['empty', ''], ['blank', '   ']] as const) {
    it(`${stage} rejects ${label} JWT configuration without exposing values`, async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('VERCEL_ENV', stage);
      vi.stubEnv('JWT_SECRET', secret);
      await expect(import('./unifiedConfig')).rejects.toThrow(/JWT_SECRET inseguro/);
    });
  }
  it(`${stage} accepts an explicitly configured nondefault JWT secret`, async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VERCEL_ENV', stage);
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

it('production precedence preserves guards and reconciliation configuration', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('PREVIEW_MODE', 'true');
  vi.stubEnv('JWT_SECRET', secureFixture);
  vi.stubEnv('BILLING_RECONCILIATION_ENABLED', 'true');
  const { isPreviewEnvironment, config } = await import('./unifiedConfig');
  expect(isPreviewEnvironment()).toBe(false);
  expect(config.billingReconciliationEnabled).toBe(true);
});

it('secure Preview rejects crafted development-secret tokens through the auth middleware', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('JWT_SECRET', secureFixture);
  const { authenticate } = await import('../middleware/auth');
  const crafted = jwt.sign({ uid: 'fixture-user' }, developmentDefault, { expiresIn: '1h' });
  const next = vi.fn();
  await authenticate({ headers: { authorization: `Bearer ${crafted}` }, originalUrl: '/api/v1/auth/me' } as any, {} as any, next);
  expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
});

it('secure Preview preserves legitimate JWT and Firebase ID-token authentication', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('JWT_SECRET', secureFixture);
  const { UserRepository } = await import('../repositories/UserRepository');
  const repository = new UserRepository();
  const legitimate = jwt.sign({ uid: 'fixture-user' }, secureFixture, { expiresIn: '1h' });
  await expect(repository.verifyToken(legitimate)).resolves.toMatchObject({ uid: 'fixture-user' });
  expect(verifyIdToken).not.toHaveBeenCalled();
  verifyIdToken.mockResolvedValueOnce({ uid: 'firebase-user', email: 'fixture@example.test' });
  await expect(repository.verifyToken('isolated-firebase-token-fixture')).resolves.toMatchObject({ uid: 'firebase-user' });
});
