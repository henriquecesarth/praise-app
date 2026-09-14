import { describe, it, expect } from 'vitest';
import { assertTestIsolationGuard } from './firebase';

describe('Phase 7D1-C-R1: Firestore Test Isolation & Live Data Safety Guard', () => {
  it('1. Throws TEST_ISOLATION_ERROR when NODE_ENV=test targets live praise-app-7a362 without emulator', () => {
    expect(() => {
      assertTestIsolationGuard({
        nodeEnv: 'test',
        projectId: 'praise-app-7a362',
        emulatorHost: undefined,
      });
    }).toThrow(/TEST_ISOLATION_ERROR: Automated tests must NEVER target live Firestore project/);
  });

  it('2. Throws TEST_ISOLATION_ERROR when NODE_ENV=test has empty emulator host', () => {
    expect(() => {
      assertTestIsolationGuard({
        nodeEnv: 'test',
        projectId: 'praise-app-7a362',
        emulatorHost: '',
      });
    }).toThrow(/TEST_ISOLATION_ERROR/);
  });

  it('3. Succeeds when NODE_ENV=test targets emulator', () => {
    expect(() => {
      assertTestIsolationGuard({
        nodeEnv: 'test',
        projectId: 'praise-app-7a362',
        emulatorHost: '127.0.0.1:8080',
      });
    }).not.toThrow();
  });

  it('4. Does not throw in production mode (normal production initialization unaffected)', () => {
    expect(() => {
      assertTestIsolationGuard({
        nodeEnv: 'production',
        projectId: 'praise-app-7a362',
        emulatorHost: undefined,
      });
    }).not.toThrow();
  });

  it('5. Does not throw in development mode without emulator', () => {
    expect(() => {
      assertTestIsolationGuard({
        nodeEnv: 'development',
        projectId: 'praise-app-dev',
        emulatorHost: undefined,
      });
    }).not.toThrow();
  });
});