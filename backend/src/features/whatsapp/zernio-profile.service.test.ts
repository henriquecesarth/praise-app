import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZernioProfileService } from './zernio-profile.service';
import { ZernioHttpClient } from './zernio-http-client';
import {
  buildZernioProfileName,
  buildZernioProfileIdempotencyKey,
  ZernioError,
} from './zernio.types';
import { WhatsAppExecutionDeadline } from './whatsapp-execution-deadline';
import { AppError } from '../../middleware/error-handler';

describe('ZernioProfileService & Lifecycle Suite (Phase 7D2-D2)', () => {
  const dummyApiKey = 'test_key_dummy_12345';
  const connectionId = 'conn_test_998877';
  const expectedProfileName = 'louvaio_wac_conn_test_998877';
  const expectedIdempotencyKey = 'profile_wac_conn_test_998877';

  let httpClient: ZernioHttpClient;
  let service: ZernioProfileService;
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    httpClient = new ZernioHttpClient({
      apiKey: dummyApiKey,
      baseUrl: 'https://zernio.com/api/v1',
      defaultTimeoutMs: 5000,
    });
    service = new ZernioProfileService(httpClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Deterministic Profile Identity (Step 6)', () => {
    it('generates canonical profile name with louvaio_wac_${connectionId}', () => {
      const name = buildZernioProfileName('abc123xyz');
      expect(name).toBe('louvaio_wac_abc123xyz');
    });

    it('generates canonical idempotency key with profile_wac_${connectionId}', () => {
      const key = buildZernioProfileIdempotencyKey('abc123xyz');
      expect(key).toBe('profile_wac_abc123xyz');
    });

    it('is strictly deterministic: identical connectionId always yields identical name and key', () => {
      const id = 'conn_stable_uuid_456';
      const name1 = buildZernioProfileName(id);
      const name2 = buildZernioProfileName(id);
      const key1 = buildZernioProfileIdempotencyKey(id);
      const key2 = buildZernioProfileIdempotencyKey(id);

      expect(name1).toBe(name2);
      expect(key1).toBe(key2);
      expect(name1).toBe('louvaio_wac_conn_stable_uuid_456');
      expect(key1).toBe('profile_wac_conn_stable_uuid_456');
    });

    it('does not contain secrets, phone numbers, email addresses, or organization names', () => {
      const id = 'wac_id_pure_001';
      const name = buildZernioProfileName(id);
      const key = buildZernioProfileIdempotencyKey(id);

      expect(name).not.toContain('@');
      expect(name).not.toContain('+55');
      expect(name).not.toContain('secret');
      expect(key).not.toContain('@');
      expect(key).not.toContain('+55');
    });

    it('rejects empty or whitespace connectionId with 400 ZERNIO_INVALID_CONNECTION_ID', () => {
      expect(() => buildZernioProfileName('')).toThrow(AppError);
      expect(() => buildZernioProfileName('   ')).toThrow(AppError);
      expect(() => buildZernioProfileIdempotencyKey('')).toThrow(AppError);
      expect(() => buildZernioProfileIdempotencyKey('   ')).toThrow(AppError);

      try {
        buildZernioProfileName('');
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect(err.details?.code).toBe('ZERNIO_INVALID_CONNECTION_ID');
      }
    });
  });

  describe('Profile Creation Happy Path (Step 8)', () => {
    it('creates profile with deterministic name & idempotency key, verifies candidate, and returns it', async () => {
      // Call 1: POST /profiles -> candidate profile
      // Call 2: GET /profiles/prof_cand_123 -> verified profile
      fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              message: 'Profile created',
              profile: {
                _id: 'prof_cand_123',
                name: expectedProfileName,
              },
            }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_cand_123',
                name: expectedProfileName,
                createdAt: '2026-09-16T12:00:00Z',
              },
            }),
        } as any);

      const verified = await service.ensureProfileForConnection(connectionId);

      expect(fetchSpy).toHaveBeenCalledTimes(2);

      // Verify POST call
      const postCall = fetchSpy.mock.calls[0];
      expect(postCall[0]).toBe('https://zernio.com/api/v1/profiles');
      expect(postCall[1].method).toBe('POST');
      expect(postCall[1].headers['Idempotency-Key']).toBe(expectedIdempotencyKey);
      expect(JSON.parse(postCall[1].body)).toEqual({ name: expectedProfileName });

      // Verify GET call
      const getCall = fetchSpy.mock.calls[1];
      expect(getCall[0]).toBe('https://zernio.com/api/v1/profiles/prof_cand_123');
      expect(getCall[1].method).toBe('GET');

      // Verify returned result
      expect(verified._id).toBe('prof_cand_123');
      expect((verified as any).id).toBeUndefined();
      expect(verified.name).toBe(expectedProfileName);
    });

    it('fails closed with 409 ZERNIO_PROFILE_IDENTITY_MISMATCH if verified name diverges from expectedName', async () => {
      fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_cand_mismatch_1',
                name: expectedProfileName,
              },
            }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_cand_mismatch_1',
                name: 'divergent_profile_name_attack',
              },
            }),
        } as any);

      await expect(service.ensureProfileForConnection(connectionId)).rejects.toThrow(
        /ZERNIO_PROFILE_IDENTITY_MISMATCH/
      );
    });

    it('fails closed with 409 ZERNIO_PROFILE_IDENTITY_MISMATCH if verified ID diverges from candidate ID', async () => {
      fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_cand_orig',
                name: expectedProfileName,
              },
            }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_different_swapped_id',
                name: expectedProfileName,
              },
            }),
        } as any);

      await expect(service.ensureProfileForConnection(connectionId)).rejects.toThrow(
        /ZERNIO_PROFILE_IDENTITY_MISMATCH/
      );
    });
  });

  describe('409 Conflict Recovery & In-Flight Discrimination (Step 9)', () => {
    describe('Case A: Positive Idempotency In-Flight & Unknown 409 Discrimination', () => {
      it('treats 409 with stable in-flight code as in-flight and throws retryable ZERNIO_OPERATION_IN_FLIGHT', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: 409,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              code: 'idempotency_key_in_progress',
              error: 'Request with this Idempotency-Key is currently being processed.',
            }),
        } as any);

        try {
          await service.ensureProfileForConnection(connectionId);
          expect.unreachable('Should have thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(AppError);
          expect(err.statusCode).toBe(409);
          expect(err.details?.code).toBe('ZERNIO_OPERATION_IN_FLIGHT');
          expect(err.details?.retryable).toBe(true);
        }

        // Must NOT attempt name lookup or candidate recovery
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      it('treats 409 with request_in_progress code as in-flight without generating new key', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: 409,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              code: 'request_in_progress',
              error: 'Still processing.',
            }),
        } as any);

        await expect(service.ensureProfileForConnection(connectionId)).rejects.toThrow(
          /ZERNIO_OPERATION_IN_FLIGHT/
        );
        const headers = fetchSpy.mock.calls[0][1].headers;
        expect(headers['Idempotency-Key']).toBe(expectedIdempotencyKey);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      it('treats unknown 409 as generic non-retryable CONFLICT, performs ZERO lookups, and does NOT become in-flight', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: 409,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              code: 'profile_limit_exceeded',
              error: 'Account profile limit reached.',
            }),
        } as any);

        try {
          await service.ensureProfileForConnection(connectionId);
          expect.unreachable('Should have thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(ZernioError);
          expect(err.statusCode).toBe(409);
          expect(err.kind).toBe('CONFLICT');
          expect(err.details?.code).not.toBe('ZERNIO_OPERATION_IN_FLIGHT');
          expect(err.details?.retryable).toBeUndefined();
        }

        // ZERO lookups performed
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });

      it('does NOT classify as in-flight solely because human-readable message contains words like "processing"', async () => {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: false,
          status: 409,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              error: 'Request still processing in queue.',
            }),
        } as any);

        try {
          await service.ensureProfileForConnection(connectionId);
          expect.unreachable('Should have thrown');
        } catch (err: any) {
          expect(err).toBeInstanceOf(ZernioError);
          expect(err.statusCode).toBe(409);
          expect(err.kind).toBe('CONFLICT');
          expect(err.details?.code).not.toBe('ZERNIO_OPERATION_IN_FLIGHT');
        }

        // Must NOT attempt name lookup or candidate recovery
        expect(fetchSpy).toHaveBeenCalledTimes(1);
      });
    });

    describe('Case B1: Profile Name Conflict with existingProfileId', () => {
      it('recovers candidate using existingProfileId, verifies identity, and returns verified profile', async () => {
        // Call 1: POST /profiles -> 409 with details.existingProfileId
        // Call 2: GET /profiles/prof_existing_999 -> candidate verified
        fetchSpy = vi
          .spyOn(global, 'fetch')
          .mockResolvedValueOnce({
            ok: false,
            status: 409,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                error: {
                  code: 'profilenameconflict',
                  message: 'A profile with this name already exists.',
                  details: {
                    existingProfileId: 'prof_existing_999',
                  },
                },
              }),
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                profile: {
                  _id: 'prof_existing_999',
                  name: expectedProfileName,
                  color: '#B85A3C',
                },
              }),
          } as any);

        const recovered = await service.ensureProfileForConnection(connectionId);

        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(fetchSpy.mock.calls[1][0]).toBe('https://zernio.com/api/v1/profiles/prof_existing_999');
        expect(recovered._id).toBe('prof_existing_999');
        expect(recovered.name).toBe(expectedProfileName);
      });

      it('fails closed if candidate returned from existingProfileId has divergent name', async () => {
        fetchSpy = vi
          .spyOn(global, 'fetch')
          .mockResolvedValueOnce({
            ok: false,
            status: 409,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                error: {
                  code: 'profilenameconflict',
                  details: {
                    existingProfileId: 'prof_alien_888',
                  },
                },
              }),
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                profile: {
                  _id: 'prof_alien_888',
                  name: 'some_other_church_profile',
                },
              }),
          } as any);

        await expect(service.ensureProfileForConnection(connectionId)).rejects.toThrow(
          /ZERNIO_PROFILE_IDENTITY_MISMATCH/
        );
      });
    });

    describe('Case B2: Profile Name Conflict without existingProfileId (Exact Name Lookup)', () => {
      it('looks up candidate by exact name, verifies via GET profile, and returns verified profile', async () => {
        // Call 1: POST /profiles -> 409 profilenameconflict without details.existingProfileId
        // Call 2: GET /profiles?name=louvaio_wac_conn_test_998877 -> candidate found
        // Call 3: GET /profiles/prof_discovered_777 -> verified
        fetchSpy = vi
          .spyOn(global, 'fetch')
          .mockResolvedValueOnce({
            ok: false,
            status: 409,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                error: {
                  code: 'profilenameconflict',
                  message: 'Name already exists',
                },
              }),
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                profiles: [
                  {
                    _id: 'prof_discovered_777',
                    name: expectedProfileName,
                  },
                ],
              }),
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                profile: {
                  _id: 'prof_discovered_777',
                  name: expectedProfileName,
                },
              }),
          } as any);

        const recovered = await service.ensureProfileForConnection(connectionId);

        expect(fetchSpy).toHaveBeenCalledTimes(3);
        expect(fetchSpy.mock.calls[1][0]).toBe(
          `https://zernio.com/api/v1/profiles?name=${encodeURIComponent(expectedProfileName)}`
        );
        expect(fetchSpy.mock.calls[2][0]).toBe('https://zernio.com/api/v1/profiles/prof_discovered_777');
        expect(recovered._id).toBe('prof_discovered_777');
        expect(recovered.name).toBe(expectedProfileName);
      });

      it('fails closed with 404 ZERNIO_PROFILE_RECOVERY_FAILED when name lookup yields zero results', async () => {
        fetchSpy = vi
          .spyOn(global, 'fetch')
          .mockResolvedValueOnce({
            ok: false,
            status: 409,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                error: {
                  code: 'profilenameconflict',
                  message: 'Duplicate name',
                },
              }),
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () => JSON.stringify({ profiles: [] }),
          } as any);

        await expect(service.ensureProfileForConnection(connectionId)).rejects.toThrow(
          /ZERNIO_PROFILE_RECOVERY_FAILED/
        );
      });

      it('fails closed if exact name lookup yields multiple results', async () => {
        fetchSpy = vi
          .spyOn(global, 'fetch')
          .mockResolvedValueOnce({
            ok: false,
            status: 409,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                error: {
                  code: 'profilenameconflict',
                },
              }),
          } as any)
          .mockResolvedValueOnce({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: async () =>
              JSON.stringify({
                profiles: [
                  { _id: 'prof_1', name: expectedProfileName },
                  { _id: 'prof_2', name: expectedProfileName },
                ],
              }),
          } as any);

        await expect(service.ensureProfileForConnection(connectionId)).rejects.toThrow(
          /ZERNIO_AMBIGUOUS_PROFILE_MATCH/
        );
      });
    });
  });

  describe('Idempotency & Failure Rules (Step 10)', () => {
    it('retries create on network timeout with the SAME idempotency key and SAME body', async () => {
      // Call 1: POST times out (504 TIMEOUT)
      // Call 2: POST retried with same key and body -> 201 success
      // Call 3: GET verified
      fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockRejectedValueOnce(
          Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
        )
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_timeout_recovered',
                name: expectedProfileName,
              },
            }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_timeout_recovered',
                name: expectedProfileName,
              },
            }),
        } as any);

      const verified = await service.ensureProfileForConnection(connectionId, {
        maxTimeoutRetries: 1,
      });

      expect(fetchSpy).toHaveBeenCalledTimes(3);

      // Verify first POST and second POST used identical keys and bodies
      const call1 = fetchSpy.mock.calls[0];
      const call2 = fetchSpy.mock.calls[1];

      expect(call1[1].headers['Idempotency-Key']).toBe(expectedIdempotencyKey);
      expect(call2[1].headers['Idempotency-Key']).toBe(expectedIdempotencyKey);
      expect(call1[1].body).toBe(call2[1].body);

      expect(verified._id).toBe('prof_timeout_recovered');
    });

    it('does not retry when remaining execution deadline budget is insufficient', async () => {
      const deadline = new WhatsAppExecutionDeadline({
        startTime: Date.now(),
        budgetMs: 10_000,
        safetyMarginMs: 1_500,
      });

      // Allow initial dispatch, but indicate budget exhaustion before retry
      vi.spyOn(deadline, 'hasRemaining').mockReturnValue(false);

      fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })
      );

      await expect(
        service.ensureProfileForConnection(connectionId, {
          deadline,
          maxTimeoutRetries: 1,
        })
      ).rejects.toThrow(ZernioError);

      // Should have attempted first dispatch, but aborted before retry
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('fails closed immediately on 422 idempotency key / body mismatch without retrying', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: new Headers(),
        text: async () =>
          JSON.stringify({
            error: {
              message: 'Idempotency-Key reuse with different request parameters',
            },
          }),
      } as any);

      try {
        await service.ensureProfileForConnection(connectionId);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ZernioError);
        expect(err.statusCode).toBe(422);
        expect(err.kind).toBe('VALIDATION');
      }

      // No retries on 422
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Client-Service Delegation', () => {
    it('allows ensureProfileForConnection directly on ZernioHttpClient', async () => {
      fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce({
          ok: true,
          status: 201,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_via_client',
                name: expectedProfileName,
              },
            }),
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers(),
          text: async () =>
            JSON.stringify({
              profile: {
                _id: 'prof_via_client',
                name: expectedProfileName,
              },
            }),
        } as any);

      const verified = await httpClient.ensureProfileForConnection(connectionId);
      expect(verified._id).toBe('prof_via_client');
      expect(verified.name).toBe(expectedProfileName);
    });
  });
});
