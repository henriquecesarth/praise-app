import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveComplianceConfig } from './compliance.config';

describe('preview reauthentication safety', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('rejects before fetch even when a production Firebase key is configured', async () => {
    const previewConfig = resolveComplianceConfig({
      vercelEnv: 'preview',
      mode: 'production',
      env: {
        VITE_PUBLIC_SUPPORT_EMAIL: 'preview-support@example.test',
        VITE_CONTROLLER_DISPLAY_NAME: 'Preview Controller',
        VITE_FIREBASE_API_KEY: 'production-looking-public-key',
      },
    });
    vi.doMock('../config/compliance.config', () => ({ COMPLIANCE_CONFIG: previewConfig }));
    const { api, ApiError } = await import('../api');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = api.reauthenticateAndGetFreshToken('person@example.test', 'password');
    await expect(result).rejects.toBeInstanceOf(ApiError);
    await expect(result).rejects.toMatchObject({
      statusCode: 500,
      message: expect.stringMatching(/Chave da API de autenticação não configurada/i),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
