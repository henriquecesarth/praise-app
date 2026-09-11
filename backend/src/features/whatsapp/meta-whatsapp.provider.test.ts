import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';

describe('MetaWhatsAppProvider Suite (Phase 7D1)', () => {
  const appId = 'meta-app-123';
  const appSecret = 'meta-secret-456';
  const graphApiVersion = 'v26.0';

  let provider: MetaWhatsAppProvider;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new MetaWhatsAppProvider({ appId, appSecret, graphApiVersion });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('exchangeOAuthCode', () => {
    it('throws 500 WHATSAPP_PROVIDER_CONFIG_INVALID_OR_MISSING if credentials are missing', async () => {
      const badProvider = new MetaWhatsAppProvider({ appId: '', appSecret: '' });
      await expect(badProvider.exchangeOAuthCode('valid-code')).rejects.toThrow(
        /WHATSAPP_PROVIDER_CONFIG_INVALID_OR_MISSING/
      );
    });

    it('successfully exchanges code for business_token using versioned Graph API URL', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'EAAG_test_business_token_789',
          token_type: 'bearer',
          expires_in: 5184000,
        }),
      } as any);

      const result = await provider.exchangeOAuthCode('my-oauth-code');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const callUrl = fetchSpy.mock.calls[0][0];
      expect(callUrl).toContain('https://graph.facebook.com/v26.0/oauth/access_token');
      expect(callUrl).toContain('client_id=meta-app-123');
      expect(callUrl).toContain('client_secret=meta-secret-456');
      expect(callUrl).toContain('code=my-oauth-code');

      expect(result.accessToken).toBe('EAAG_test_business_token_789');
      expect(result.tokenType).toBe('business_token');
      expect(result.expiresAt).toBeDefined();
    });

    it('throws 400 WHATSAPP_OAUTH_EXCHANGE_FAILED when Meta response is not ok', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: {
            message: 'Invalid verification code',
            type: 'OAuthException',
            code: 100,
          },
        }),
      } as any);

      await expect(provider.exchangeOAuthCode('bad-code')).rejects.toThrow(
        /WHATSAPP_INVALID_PARAMETER|WHATSAPP_OAUTH_EXCHANGE_FAILED/
      );
    });

    it('throws 400 WHATSAPP_OAUTH_EXCHANGE_FAILED when response is missing access_token', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as any);

      await expect(provider.exchangeOAuthCode('code')).rejects.toThrow(
        /WHATSAPP_OAUTH_EXCHANGE_FAILED/
      );
    });
  });

  describe('verifyMessagingAccountAccess', () => {
    it('returns true when WABA container ID matches response', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 'waba-123', name: 'Test WABA' }),
      } as any);

      const isAuth = await provider.verifyMessagingAccountAccess('token-xyz', 'waba-123');
      expect(isAuth).toBe(true);

      const callUrl = fetchSpy.mock.calls[0][0];
      expect(callUrl).toContain('https://graph.facebook.com/v26.0/waba-123');
      expect(fetchSpy.mock.calls[0][1].headers.Authorization).toBe('Bearer token-xyz');
    });

    it('returns false when response is not ok or error occurred', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: { message: 'Permissions error', code: 200 },
        }),
      } as any);

      const isAuth = await provider.verifyMessagingAccountAccess('token-xyz', 'waba-forbidden');
      expect(isAuth).toBe(false);
    });
  });

  describe('listAuthorizedPhoneNumbers', () => {
    it('returns list of authorized phone numbers for WABA', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            { id: 'phone-001', display_phone_number: '+55 11 98888-7771', verified_name: 'Praise Line 1' },
            { id: 'phone-002', display_phone_number: '+55 11 98888-7772', verified_name: 'Praise Line 2' },
          ],
        }),
      } as any);

      const phones = await provider.listAuthorizedPhoneNumbers('token-xyz', 'waba-123');
      expect(phones).toHaveLength(2);
      expect(phones[0]).toEqual({
        id: 'phone-001',
        displayPhoneNumber: '+55 11 98888-7771',
        verifiedName: 'Praise Line 1',
      });
    });

    it('throws normalized error when phone numbers edge query fails', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Invalid container', code: 100 },
        }),
      } as any);

      await expect(provider.listAuthorizedPhoneNumbers('token-xyz', 'bad-waba')).rejects.toThrow(
        /WHATSAPP_INVALID_PARAMETER/
      );
    });
  });

  describe('getPhoneNumberDetails', () => {
    it('returns quality and messaging limits for phone number', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'phone-001',
          display_phone_number: '+55 11 98888-7771',
          verified_name: 'Praise Line 1',
          quality_rating: 'GREEN',
          messaging_limit_tier: 'TIER_10K',
        }),
      } as any);

      const details = await provider.getPhoneNumberDetails('token-xyz', 'phone-001');
      expect(details.displayPhoneNumber).toBe('+55 11 98888-7771');
      expect(details.verifiedName).toBe('Praise Line 1');
      expect(details.qualityRating).toBe('GREEN');
      expect(details.messagingLimitTier).toBe('TIER_10K');
    });
  });

  describe('registerPhoneNumber', () => {
    it('sends pin in body with application/json without leaking pin on failure', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as any);

      await provider.registerPhoneNumber('token-xyz', 'phone-001', '123456');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toContain('https://graph.facebook.com/v26.0/phone-001/register');
      expect(JSON.parse(call[1].body)).toEqual({
        messaging_product: 'whatsapp',
        pin: '123456',
      });
    });

    it('throws 502 PROVIDER_REGISTRATION_FAILED on failure without leaking PIN', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Failed to register' } }),
      } as any);

      try {
        await provider.registerPhoneNumber('token-xyz', 'phone-001', '654321');
        expect.unreachable();
      } catch (err: any) {
        expect(err.statusCode).toBe(502);
        expect(err.message).toContain('PROVIDER_REGISTRATION_FAILED');
        expect(err.message).not.toContain('654321');
      }
    });
  });

  describe('subscribeMessagingAccountApps', () => {
    it('calls POST /v26.0/{wabaId}/subscribed_apps with Bearer auth', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as any);

      await provider.subscribeMessagingAccountApps('token-xyz', 'waba-123');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toContain('https://graph.facebook.com/v26.0/waba-123/subscribed_apps');
      expect(call[1].method).toBe('POST');
    });

    it('throws 502 PROVIDER_SUBSCRIPTION_FAILED when subscription fails', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Sub failed' } }),
      } as any);

      await expect(provider.subscribeMessagingAccountApps('token-xyz', 'waba-123')).rejects.toThrow(
        /PROVIDER_SUBSCRIPTION_FAILED/
      );
    });
  });

  describe('Two-Tier Error Normalization (DEC-7D-10)', () => {
    it('code 190 maps to 401 WHATSAPP_TOKEN_INVALID', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 190, message: 'Access token expired' } }),
      } as any);

      await expect(provider.listAuthorizedPhoneNumbers('tok', 'waba')).rejects.toMatchObject({
        statusCode: 401,
        details: { code: 'WHATSAPP_TOKEN_INVALID' },
      });
    });

    it('code 131053 maps to 429 WHATSAPP_RATE_LIMITED', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: { code: 131053, message: 'Rate limit hit' } }),
      } as any);

      await expect(provider.listAuthorizedPhoneNumbers('tok', 'waba')).rejects.toMatchObject({
        statusCode: 429,
        details: { code: 'WHATSAPP_RATE_LIMITED' },
      });
    });

    it('OAuthException subcode 463 maps to 401 WHATSAPP_TOKEN_INVALID', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { type: 'OAuthException', error_subcode: 463, message: 'Session expired' },
        }),
      } as any);

      await expect(provider.listAuthorizedPhoneNumbers('tok', 'waba')).rejects.toMatchObject({
        statusCode: 401,
        details: { code: 'WHATSAPP_TOKEN_INVALID' },
      });
    });

    it('HTTP 500 maps to 502 WHATSAPP_PROVIDER_UNAVAILABLE', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Internal error' } }),
      } as any);

      await expect(provider.listAuthorizedPhoneNumbers('tok', 'waba')).rejects.toMatchObject({
        statusCode: 502,
        details: { code: 'WHATSAPP_PROVIDER_UNAVAILABLE' },
      });
    });
  });
});
