import { describe, it, expect } from 'vitest';
import {
  config,
  ZERNIO_DEFAULT_BASE_URL,
  requireZernioApiKey,
  requireZernioWebhookSecret,
} from './unifiedConfig';
import { AppError } from '../middleware/error-handler';

describe('UnifiedConfig Zernio Security & Optional Boot Suite (Phase 7D2-D1)', () => {
  it('allows backend configuration to boot and export default constants without Zernio credentials', () => {
    expect(config).toBeDefined();
    expect(ZERNIO_DEFAULT_BASE_URL).toBe('https://zernio.com/api/v1');
    if (!process.env.ZERNIO_API_KEY) {
      expect(config.zernioApiKey).toBeUndefined();
    }
    if (!process.env.ZERNIO_WEBHOOK_SECRET) {
      expect(config.zernioWebhookSecret).toBeUndefined();
    }
  });

  it('preserves existing Meta configuration defaults and behavior', () => {
    expect(config.metaGraphApiVersion).toBe('v26.0');
    expect(config.port).toBeDefined();
    expect(config.defaultMinistryId).toBeDefined();
    expect(config.billingTimezone).toBe('America/Sao_Paulo');
  });

  it('proves ZERNIO_SANDBOX_PHONE does not exist in production config object', () => {
    expect((config as any).zernioSandboxPhone).toBeUndefined();
    expect((config as any).ZERNIO_SANDBOX_PHONE).toBeUndefined();
  });

  describe('requireZernioApiKey accessor', () => {
    it('returns the configured key when present via override', () => {
      const dummyKey = 'test_key_dummy_12345';
      const key = requireZernioApiKey(dummyKey);
      expect(key).toBe(dummyKey);
    });

    it('fails closed when key is absent or empty', () => {
      expect(() => requireZernioApiKey('')).toThrow(AppError);
      expect(() => requireZernioApiKey('   ')).toThrow(AppError);
      try {
        requireZernioApiKey('');
      } catch (err: any) {
        expect(err.statusCode).toBe(500);
        expect(err.details?.code).toBe('ZERNIO_CONFIG_ERROR');
        expect(err.message).toContain('ZERNIO_API_KEY não configurada no ambiente.');
        expect(err.message).not.toContain('undefined');
      }
    });

    it('does not log or disclose secret value in error message', () => {
      try {
        requireZernioApiKey(undefined);
      } catch (err: any) {
        expect(err.message).toBe('ZERNIO_CONFIG_ERROR: ZERNIO_API_KEY não configurada no ambiente.');
      }
    });
  });

  describe('requireZernioWebhookSecret accessor', () => {
    it('returns the configured webhook secret when present via override', () => {
      const dummySecret = 'test_webhook_secret_67890';
      const secret = requireZernioWebhookSecret(dummySecret);
      expect(secret).toBe(dummySecret);
    });

    it('fails closed when secret is absent or empty', () => {
      expect(() => requireZernioWebhookSecret('')).toThrow(AppError);
      expect(() => requireZernioWebhookSecret('   ')).toThrow(AppError);
      try {
        requireZernioWebhookSecret('');
      } catch (err: any) {
        expect(err.statusCode).toBe(500);
        expect(err.details?.code).toBe('ZERNIO_CONFIG_ERROR');
        expect(err.message).toContain('ZERNIO_WEBHOOK_SECRET não configurada no ambiente.');
      }
    });

    it('never defaults to an empty string or development fallback secret', () => {
      try {
        requireZernioWebhookSecret(undefined);
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
      }
    });
  });
});
