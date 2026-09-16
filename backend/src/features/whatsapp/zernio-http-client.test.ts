import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZernioHttpClient } from './zernio-http-client';
import { ZernioError } from './zernio.types';
import { WhatsAppExecutionDeadline } from './whatsapp-execution-deadline';
import { AppError } from '../../middleware/error-handler';

describe('ZernioHttpClient Suite (Phase 7D2-D2)', () => {
  const dummyApiKey = 'test_zernio_key_abc123';
  const customBaseUrl = 'https://mock.zernio.internal/api/v1';

  let client: ZernioHttpClient;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new ZernioHttpClient({
      apiKey: dummyApiKey,
      baseUrl: customBaseUrl,
      defaultTimeoutMs: 5000,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Low-Level HTTP Primitives & Transport', () => {
    it('injects Authorization: Bearer <key> and Accept: application/json', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ message: 'ok' }),
      } as any);

      const res = await client.request<any>('test-endpoint');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const call = fetchSpy.mock.calls[0];
      expect(call[0]).toBe('https://mock.zernio.internal/api/v1/test-endpoint');
      expect(call[1].headers.Authorization).toBe(`Bearer ${dummyApiKey}`);
      expect(call[1].headers.Accept).toBe('application/json');
      expect(res).toEqual({ message: 'ok' });
    });

    it('uses default ZERNIO_DEFAULT_BASE_URL when baseUrl is not overridden', async () => {
      const defaultClient = new ZernioHttpClient({ apiKey: dummyApiKey });
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ ok: true }),
      } as any);

      await defaultClient.request('health');

      const callUrl = fetchSpy.mock.calls[0][0];
      expect(callUrl).toBe('https://zernio.com/api/v1/health');
    });

    it('serializes JSON body with Content-Type: application/json', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ success: true }),
      } as any);

      const bodyData = { name: 'louvaio_wac_test', color: '#B85A3C' };
      await client.request('profiles', {
        method: 'POST',
        body: bodyData,
      });

      const call = fetchSpy.mock.calls[0];
      expect(call[1].method).toBe('POST');
      expect(call[1].headers['Content-Type']).toBe('application/json');
      expect(call[1].body).toBe(JSON.stringify(bodyData));
    });

    it('injects Idempotency-Key header when supplied in options', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => JSON.stringify({ success: true }),
      } as any);

      await client.request('profiles', {
        method: 'POST',
        body: { name: 'test' },
        idempotencyKey: 'profile_wac_12345',
      });

      const headers = fetchSpy.mock.calls[0][1].headers;
      expect(headers['Idempotency-Key']).toBe('profile_wac_12345');
    });

    it('tolerates empty response bodies (204 No Content or content-length: 0)', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 204,
        headers: new Headers({ 'content-length': '0' }),
        text: async () => '',
      } as any);

      const res = await client.request('noop');
      expect(res).toBeUndefined();
    });

    it('rejects malformed non-empty JSON with sanitized ZERNIO_PROTOCOL_ERROR', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers(),
        text: async () => '<html>Not Valid JSON</html>',
      } as any);

      try {
        await client.request('bad-json');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(502);
        expect(err.kind).toBe('TRANSIENT_PROVIDER_ERROR');
        expect(err.providerCode).toBe('MALFORMED_JSON');
        expect(err.message).toContain('ZERNIO_PROTOCOL_ERROR');
      }
    });

    it('fails closed before network dispatch when API key is absent or empty', async () => {
      const unauthedClient = new ZernioHttpClient({ apiKey: '' });
      fetchSpy = vi.spyOn(global, 'fetch');

      await expect(unauthedClient.request('profiles')).rejects.toThrow(AppError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('honors caller AbortSignal pre-aborted before dispatch', async () => {
      fetchSpy = vi.spyOn(global, 'fetch');
      const controller = new AbortController();
      controller.abort();

      await expect(
        client.request('profiles', { signal: controller.signal })
      ).rejects.toThrow(ZernioError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('honors caller AbortSignal triggered during fetch', async () => {
      const controller = new AbortController();
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementationOnce(async () => {
        controller.abort();
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      });

      await expect(
        client.request('profiles', { signal: controller.signal })
      ).rejects.toThrow(ZernioError);
    });

    it('enforces request timeout when fetch exceeds budget', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            }, 50);
          })
      );

      try {
        await client.request('slow', { timeoutMs: 10 });
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(504);
        expect(err.kind).toBe('TIMEOUT');
      }
    });

    it('fails before network dispatch when execution deadline is exhausted', async () => {
      fetchSpy = vi.spyOn(global, 'fetch');
      const exhaustedDeadline = new WhatsAppExecutionDeadline({
        startTime: Date.now() - 30_000,
        budgetMs: 24_000,
        safetyMarginMs: 1_500,
      });

      await expect(
        client.request('profiles', { deadline: exhaustedDeadline })
      ).rejects.toThrow(ZernioError);
      expect(fetchSpy).not.toHaveBeenCalled();

      try {
        await client.request('profiles', { deadline: exhaustedDeadline });
      } catch (err: any) {
        expect(err.statusCode).toBe(504);
        expect(err.kind).toBe('TIMEOUT');
        expect(err.providerCode).toBe('INSUFFICIENT_EXECUTION_BUDGET');
      }
    });

    it('fails before network dispatch when deadlineAt leaves < 1000ms', async () => {
      fetchSpy = vi.spyOn(global, 'fetch');
      await expect(
        client.request('profiles', { deadlineAt: Date.now() + 500 })
      ).rejects.toThrow(ZernioError);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('normalizes network exceptions into TRANSIENT_PROVIDER_ERROR (502)', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed: ECONNREFUSED'));

      try {
        await client.request('profiles');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err.statusCode).toBe(502);
        expect(err.kind).toBe('TRANSIENT_PROVIDER_ERROR');
        expect(err.providerCode).toBe('NETWORK_ERROR');
        expect(err.message).toContain('WHATSAPP_PROVIDER_UNAVAILABLE');
      }
    });
  });

  describe('HTTP Status Error Normalization Matrix', () => {
    const errorMatrix: Array<{
      status: number;
      body: any;
      expectedKind: string;
      expectedStatus: number;
      expectedMessageFragment: string;
    }> = [
      {
        status: 400,
        body: { error: { message: 'Invalid payload parameter' } },
        expectedKind: 'VALIDATION',
        expectedStatus: 400,
        expectedMessageFragment: 'ZERNIO_VALIDATION_ERROR',
      },
      {
        status: 401,
        body: { error: { message: 'Invalid or expired API token' } },
        expectedKind: 'AUTH',
        expectedStatus: 401,
        expectedMessageFragment: 'ZERNIO_AUTH_ERROR',
      },
      {
        status: 402,
        body: { error: { message: 'Subscription tier requires payment' } },
        expectedKind: 'PAYMENT_REQUIRED',
        expectedStatus: 402,
        expectedMessageFragment: 'ZERNIO_PAYMENT_REQUIRED',
      },
      {
        status: 403,
        body: { error: { message: 'Forbidden account action' } },
        expectedKind: 'AUTH',
        expectedStatus: 403,
        expectedMessageFragment: 'ZERNIO_AUTH_ERROR',
      },
      {
        status: 404,
        body: { error: { message: 'Profile not found' } },
        expectedKind: 'NOT_FOUND',
        expectedStatus: 404,
        expectedMessageFragment: 'ZERNIO_NOT_FOUND',
      },
      {
        status: 409,
        body: { error: { code: 'profilenameconflict', message: 'Name in use' } },
        expectedKind: 'CONFLICT',
        expectedStatus: 409,
        expectedMessageFragment: 'ZERNIO_CONFLICT',
      },
      {
        status: 422,
        body: { error: { message: 'Idempotency key body mismatch' } },
        expectedKind: 'VALIDATION',
        expectedStatus: 422,
        expectedMessageFragment: 'ZERNIO_VALIDATION_ERROR',
      },
      {
        status: 429,
        body: { error: { message: 'Rate limit exceeded' } },
        expectedKind: 'RATE_LIMITED',
        expectedStatus: 429,
        expectedMessageFragment: 'ZERNIO_RATE_LIMITED',
      },
      {
        status: 500,
        body: { error: { message: 'Internal upstream error' } },
        expectedKind: 'TRANSIENT_PROVIDER_ERROR',
        expectedStatus: 500,
        expectedMessageFragment: 'ZERNIO_PROVIDER_UNAVAILABLE',
      },
      {
        status: 502,
        body: { error: { message: 'Bad Gateway upstream' } },
        expectedKind: 'TRANSIENT_PROVIDER_ERROR',
        expectedStatus: 502,
        expectedMessageFragment: 'ZERNIO_PROVIDER_UNAVAILABLE',
      },
      {
        status: 503,
        body: { error: { message: 'Service unavailable' } },
        expectedKind: 'TRANSIENT_PROVIDER_ERROR',
        expectedStatus: 503,
        expectedMessageFragment: 'ZERNIO_PROVIDER_UNAVAILABLE',
      },
      {
        status: 418,
        body: { error: { message: 'I am a teapot' } },
        expectedKind: 'UNKNOWN_PROVIDER_ERROR',
        expectedStatus: 418,
        expectedMessageFragment: 'ZERNIO_PROVIDER_ERROR',
      },
    ];

    for (const testCase of errorMatrix) {
      it(`maps HTTP ${testCase.status} to ${testCase.expectedKind}`, async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: testCase.status,
          headers: new Headers(),
          text: async () => JSON.stringify(testCase.body),
        } as any);

        try {
          await client.request('error-test');
          expect.unreachable('Should have thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(ZernioError);
          expect(err.statusCode).toBe(testCase.expectedStatus);
          expect(err.kind).toBe(testCase.expectedKind);
          expect(err.message).toContain(testCase.expectedMessageFragment);
        }
      });
    }

    it('parses Retry-After header on 429 rate limited responses', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers({ 'Retry-After': '12' }),
        text: async () => JSON.stringify({ message: 'Slow down' }),
      } as any);

      try {
        await client.request('rate-limited');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(429);
        expect(err.kind).toBe('RATE_LIMITED');
        expect(err.retryAfterSeconds).toBe(12);
      }
    });

    it('parses flat canonical error envelope with top-level type, code, param, and platform', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            error: 'Invalid phone number parameter.',
            type: 'invalid_request_error',
            code: 'parameter_invalid',
            param: 'phone_number',
            platform: 'whatsapp',
          }),
      } as any);

      try {
        await client.request('flat-envelope-test');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(400);
        expect(err.kind).toBe('VALIDATION');
        expect(err.providerType).toBe('invalid_request_error');
        expect(err.providerCode).toBe('parameter_invalid');
        expect(err.providerParam).toBe('phone_number');
        expect(err.providerPlatform).toBe('whatsapp');
      }
    });

    it('classifies 502 + type=platform_error as PLATFORM_ERROR, preserving code and platform', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 502,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            error: 'Upstream Meta Cloud API rejected phone registration.',
            type: 'platform_error',
            code: 'meta_registration_rejected',
            platform: 'meta',
            platformError: {
              code: 131031,
              error_subcode: 460,
              type: 'OAuthException',
            },
          }),
      } as any);

      try {
        await client.request('platform-502');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(502);
        expect(err.kind).toBe('PLATFORM_ERROR');
        expect(err.providerType).toBe('platform_error');
        expect(err.providerCode).toBe('meta_registration_rejected');
        expect(err.providerPlatform).toBe('meta');
        expect(err.safeDetails?.platformError).toEqual({
          code: 131031,
          error_subcode: 460,
          type: 'OAuthException',
        });
      }
    });

    it('classifies 400 + type=platform_error as PLATFORM_ERROR (upstream platform input rejection)', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            error: 'Upstream platform rejected parameters.',
            type: 'platform_error',
            code: 'platform_input_rejected',
            platform: 'meta',
          }),
      } as any);

      try {
        await client.request('platform-400');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(400);
        expect(err.kind).toBe('PLATFORM_ERROR');
        expect(err.providerType).toBe('platform_error');
        expect(err.providerCode).toBe('platform_input_rejected');
      }
    });

    it('classifies 500 + type=api_error as TRANSIENT_PROVIDER_ERROR', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            error: 'An internal API error occurred.',
            type: 'api_error',
            code: 'internal_error',
          }),
      } as any);

      try {
        await client.request('api-error-500');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(500);
        expect(err.kind).toBe('TRANSIENT_PROVIDER_ERROR');
        expect(err.providerType).toBe('api_error');
        expect(err.providerCode).toBe('internal_error');
      }
    });

    it('classifies 503 + type=api_error + code=temporarily_unavailable and preserves Retry-After', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: new Headers({ 'Retry-After': '30' }),
        text: async () =>
          JSON.stringify({
            error: 'Service temporarily unavailable.',
            type: 'api_error',
            code: 'temporarily_unavailable',
          }),
      } as any);

      try {
        await client.request('api-error-503');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(503);
        expect(err.kind).toBe('TRANSIENT_PROVIDER_ERROR');
        expect(err.providerType).toBe('api_error');
        expect(err.providerCode).toBe('temporarily_unavailable');
        expect(err.retryAfterSeconds).toBe(30);
      }
    });

    it('extracts safeDetails.existingProfileId on 409 conflict responses from flat or nested details', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            error: 'Profile name already exists',
            code: 'profilenameconflict',
            details: {
              existingProfileId: 'prof_existing_abc999',
            },
          }),
      } as any);

      try {
        await client.request('conflict-test');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(409);
        expect(err.kind).toBe('CONFLICT');
        expect(err.providerCode).toBe('profilenameconflict');
        expect(err.safeDetails?.existingProfileId).toBe('prof_existing_abc999');
      }
    });
  });


  describe('Profile API Operations (createProfile, getProfile, findProfileByExactName)', () => {
    describe('createProfile', () => {
      it('sends POST /profiles, passes Idempotency-Key and body, parses profile._id', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              message: 'Profile created',
              profile: {
                _id: 'prof_67890abcdef',
                name: 'louvaio_wac_conn_123',
                description: 'Ministry WhatsApp Profile',
                color: '#0F2A1F',
              },
            }),
        } as any);

        const profile = await client.createProfile(
          {
            name: 'louvaio_wac_conn_123',
            description: 'Ministry WhatsApp Profile',
            color: '#0F2A1F',
          },
          { idempotencyKey: 'profile_wac_conn_123' }
        );

        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const call = fetchSpy.mock.calls[0];
        expect(call[0]).toBe('https://mock.zernio.internal/api/v1/profiles');
        expect(call[1].method).toBe('POST');
        expect(call[1].headers['Idempotency-Key']).toBe('profile_wac_conn_123');

        expect(profile._id).toBe('prof_67890abcdef');
        expect((profile as any).id).toBeUndefined();
        expect(profile.name).toBe('louvaio_wac_conn_123');
      });

      it('fails closed with ZERNIO_PROTOCOL_ERROR if provider returns profile.id instead of profile._id', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              message: 'Profile created',
              profile: {
                id: 'prof_bad_property',
                name: 'louvaio_wac_conn_123',
              },
            }),
        } as any);

        await expect(
          client.createProfile({ name: 'louvaio_wac_conn_123' })
        ).rejects.toThrow(ZernioError);
      });
    });

    describe('getProfile', () => {
      it('rejects empty profileId before network dispatch', async () => {
        fetchSpy = vi.spyOn(global, 'fetch');
        await expect(client.getProfile('')).rejects.toThrow(AppError);
        await expect(client.getProfile('   ')).rejects.toThrow(AppError);
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('sends GET /profiles/{profileId} and handles wrapped { profile: ... } format', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_target_456',
                name: 'louvaio_wac_target',
                isDefault: false,
              },
            }),
        } as any);

        const profile = await client.getProfile('prof_target_456');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][0]).toBe('https://mock.zernio.internal/api/v1/profiles/prof_target_456');
        expect(profile._id).toBe('prof_target_456');
        expect(profile.name).toBe('louvaio_wac_target');
      });

      it('sends GET /profiles/{profileId} and handles direct profile object format', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              _id: 'prof_direct_789',
              name: 'louvaio_wac_direct',
            }),
        } as any);

        const profile = await client.getProfile('prof_direct_789');
        expect(profile._id).toBe('prof_direct_789');
        expect(profile.name).toBe('louvaio_wac_direct');
      });

      it('URL-encodes profileId containing special characters', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              _id: 'prof/special:123',
              name: 'test',
            }),
        } as any);

        await client.getProfile('prof/special:123');
        expect(fetchSpy.mock.calls[0][0]).toBe(
          'https://mock.zernio.internal/api/v1/profiles/prof%2Fspecial%3A123'
        );
      });
    });

    describe('findProfileByExactName', () => {
      it('rejects empty name before network dispatch', async () => {
        fetchSpy = vi.spyOn(global, 'fetch');
        await expect(client.findProfileByExactName('')).rejects.toThrow(AppError);
        await expect(client.findProfileByExactName('   ')).rejects.toThrow(AppError);
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('sends GET /profiles?name=<URL-encoded> and returns single exact match', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profiles: [
                {
                  _id: 'prof_match_1',
                  name: 'louvaio_wac_conn_xyz',
                },
              ],
            }),
        } as any);

        const found = await client.findProfileByExactName('louvaio_wac_conn_xyz');
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        expect(fetchSpy.mock.calls[0][0]).toBe(
          'https://mock.zernio.internal/api/v1/profiles?name=louvaio_wac_conn_xyz'
        );
        expect(found?._id).toBe('prof_match_1');
        expect(found?.name).toBe('louvaio_wac_conn_xyz');
      });

      it('properly URL-encodes profile search query', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify([]),
        } as any);

        await client.findProfileByExactName('louvaio wac special&test=1');
        const queryUrl = fetchSpy.mock.calls[0][0];
        expect(queryUrl).toContain('name=louvaio+wac+special%26test%3D1');
      });

      it('returns null when provider returns zero results or no exact match', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () => JSON.stringify({ profiles: [] }),
        } as any);

        const found = await client.findProfileByExactName('louvaio_wac_not_found');
        expect(found).toBeNull();
      });

      it('fails closed with 409 ZERNIO_AMBIGUOUS_PROFILE_MATCH when multiple exact matches exist', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profiles: [
                { _id: 'prof_dup_1', name: 'louvaio_wac_dup' },
                { _id: 'prof_dup_2', name: 'louvaio_wac_dup' },
              ],
            }),
        } as any);

        await expect(client.findProfileByExactName('louvaio_wac_dup')).rejects.toThrow(
          /ZERNIO_AMBIGUOUS_PROFILE_MATCH/
        );
      });
    });
  });

  describe('Security & Information Leakage Defense', () => {
    it('does not expose API key in serialized error output or details', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers(),
        text: async () => JSON.stringify({ error: { message: 'Unauthorized access' } }),
      } as any);

      try {
        await client.request('secure-call');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        const str = JSON.stringify(err);
        expect(str).not.toContain(dummyApiKey);
        expect(err.message).not.toContain(dummyApiKey);
      }
    });

    it('does not include Authorization header in error objects or error details', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => 'Internal Server Error',
      } as any);

      try {
        await client.request('upstream-fail');
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect((err as any).headers).toBeUndefined();
        expect(JSON.stringify(err)).not.toContain('Bearer');
      }
    });
  });
});
