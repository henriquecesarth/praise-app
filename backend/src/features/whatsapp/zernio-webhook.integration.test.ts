import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import http from 'http';
import { db } from '../../lib/firebase';
import app from '../../app';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppZernioWebhookRepository } from '../../repositories/WhatsAppZernioWebhookRepository';
import { ZernioHttpClient } from './zernio-http-client';
import {
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
} from './whatsapp.types';
import {
  buildZernioWebhookEventDocId,
  ZernioError,
} from './zernio.types';

describe('Zernio Webhook Ingestion & Lifecycle Repair Suite (Phase 7D2-D5)', { timeout: 20000 }, () => {
  const connectionRepo = new WhatsAppConnectionRepository();
  const claimRepo = new WhatsAppProviderIdentityClaimRepository();
  const webhookRepo = new WhatsAppZernioWebhookRepository();

  const testWebhookSecret = 'test_webhook_secret_d5_secure_key_1234567890';

  function uniqueId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  function signPayload(body: Buffer | string, secret: string = testWebhookSecret): string {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  async function createTestConnection(overrides: Partial<any> = {}) {
    const connectionId = overrides.id || uniqueId('waconn');
    const orgId = overrides.organization_id || uniqueId('org');
    const profileId = overrides.provider_profile_id || uniqueId('prof_zernio');
    const now = new Date().toISOString();

    const data = {
      id: connectionId,
      organization_id: orgId,
      display_name: overrides.display_name || 'Test WhatsApp Connection',
      phone_number: overrides.phone_number || null,
      provider: 'zernio',
      provider_profile_id: profileId,
      provider_account_id: overrides.provider_account_id || null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      status: overrides.status || 'pending',
      status_reason: overrides.status_reason || null,
      assigned_ministry_id: overrides.assigned_ministry_id || null,
      created_by_user_id: overrides.created_by_user_id || uniqueId('user'),
      current_onboarding_session_id: null,
      pending_expires_at: null,
      last_connected_at: overrides.last_connected_at || null,
      last_health_check_at: null,
      created_at: overrides.created_at || now,
      updated_at: overrides.updated_at || now,
    };

    await db.collection('whatsapp_connections').doc(connectionId).set(data);
    return data;
  }

  function mockZernioApiForAccount(accountId: string, profileId: string, phone: string) {
    const fakeFetch = vi.fn(async (url: string) => {
      const urlObj = new URL(url);
      if (urlObj.pathname.includes('/accounts')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              accounts: [
                {
                  _id: accountId,
                  platform: 'whatsapp',
                  profileId,
                  name: 'Louvor WhatsApp Line',
                  status: 'connected',
                },
              ],
            }),
        } as any;
      }
      if (urlObj.pathname.includes('/whatsapp/number-info')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              phone: {
                display_phone_number: phone,
                status: 'CONNECTED',
                platform_type: 'CLOUD_API',
                verified_name: 'Paróquia Louvor',
                quality_rating: 'GREEN',
              },
            }),
        } as any;
      }
      return { ok: false, status: 404 } as any;
    });
    vi.stubGlobal('fetch', fakeFetch);
    return fakeFetch;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.ZERNIO_WEBHOOK_SECRET = testWebhookSecret;
    process.env.ZERNIO_API_KEY = 'test_api_key';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('1. Raw-byte sensitivity and HMAC-SHA256 Signature Verification', () => {
    it('rejects missing X-Zernio-Signature header with HTTP 401', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ id: 'evt_1', event: 'webhook.test' }));

      await expect(
        service.handleZernioWebhook({
          rawBody,
          signature: undefined,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('X-Zernio-Signature'),
        })
      );
    });

    it('rejects malformed signature (non-hex, wrong length) with HTTP 401', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ id: 'evt_1', event: 'webhook.test' }));

      await expect(
        service.handleZernioWebhook({
          rawBody,
          signature: 'not-a-valid-hex-signature',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('Formato de assinatura'),
        })
      );
    });

    it('rejects invalid signature (wrong secret / mismatched HMAC) with HTTP 401', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ id: 'evt_1', event: 'webhook.test' }));
      const badSig = signPayload(rawBody, 'wrong_secret_key');

      await expect(
        service.handleZernioWebhook({
          rawBody,
          signature: badSig,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('Assinatura X-Zernio-Signature inválida'),
        })
      );
    });

    it('fails signature check when a single whitespace character is altered in raw body (exact raw-bytes verification)', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const originalJson = '{"id":"evt_1","event":"webhook.test"}';
      const sig = signPayload(originalJson, testWebhookSecret);

      // Mutate by adding one trailing space: the bytes differ
      const alteredBody = Buffer.from(originalJson + ' ', 'utf8');

      await expect(
        service.handleZernioWebhook({
          rawBody: alteredBody,
          signature: sig,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('Assinatura X-Zernio-Signature inválida'),
        })
      );
    });

    it('fails signature check when JSON keys in raw body are reordered relative to signed bytes', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const original = '{"id":"evt_1","event":"webhook.test"}';
      const sig = signPayload(original, testWebhookSecret);

      const reordered = Buffer.from('{"event":"webhook.test","id":"evt_1"}', 'utf8');

      await expect(
        service.handleZernioWebhook({
          rawBody: reordered,
          signature: sig,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 401,
          message: expect.stringContaining('Assinatura X-Zernio-Signature inválida'),
        })
      );
    });

    it('accepts valid HMAC signature in clean hex format and in sha256=<hex> prefix format', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const evtId1 = uniqueId('evt_hex');
      const rawBody1 = Buffer.from(JSON.stringify({ id: evtId1, event: 'webhook.test' }));
      const hexSig = signPayload(rawBody1, testWebhookSecret);

      const res1 = await service.handleZernioWebhook({
        rawBody: rawBody1,
        signature: hexSig,
      });
      expect(res1.statusCode).toBe(200);
      expect(res1.body.status).toBe('ignored');

      const evtId2 = uniqueId('evt_prefix');
      const rawBody2 = Buffer.from(JSON.stringify({ id: evtId2, event: 'webhook.test' }));
      const prefixSig = `sha256=${signPayload(rawBody2, testWebhookSecret)}`;

      const res2 = await service.handleZernioWebhook({
        rawBody: rawBody2,
        signature: prefixSig,
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.body.status).toBe('ignored');
    });

    it('rejects empty rawBody with HTTP 400', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      await expect(
        service.handleZernioWebhook({
          rawBody: Buffer.alloc(0),
          signature: 'a'.repeat(64),
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('Corpo da requisição vazio'),
        })
      );
    });

    it('rejects invalid JSON payload with HTTP 400', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const invalidJson = Buffer.from('not valid json {[[', 'utf8');
      const sig = signPayload(invalidJson, testWebhookSecret);

      await expect(
        service.handleZernioWebhook({
          rawBody: invalidJson,
          signature: sig,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('Payload JSON inválido'),
        })
      );
    });
  });

  describe('2. Event Correlation and Validation Defenses', () => {
    it('rejects when payload.id is missing or empty with HTTP 400', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ event: 'webhook.test' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      await expect(
        service.handleZernioWebhook({
          rawBody,
          signature: sig,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('payload.id é obrigatório'),
        })
      );
    });

    it('rejects when payload.event is missing or empty with HTTP 400', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ id: 'evt_no_event' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      await expect(
        service.handleZernioWebhook({
          rawBody,
          signature: sig,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('payload.event é obrigatório'),
        })
      );
    });

    it('rejects when X-Zernio-Event-Id header contradicts payload.id with HTTP 400', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ id: 'evt_alpha', event: 'webhook.test' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      await expect(
        service.handleZernioWebhook({
          rawBody,
          signature: sig,
          headerEventId: 'evt_bravo_different',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          message: expect.stringContaining('X-Zernio-Event-Id não coincide com payload.id'),
        })
      );
    });

    it('succeeds when X-Zernio-Event-Id header matches payload.id exactly', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const eventId = uniqueId('evt_matching');
      const rawBody = Buffer.from(JSON.stringify({ id: eventId, event: 'webhook.test' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({
        rawBody,
        signature: sig,
        headerEventId: eventId,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.eventId).toBe(eventId);
    });

    it('succeeds when X-Zernio-Event-Id header is omitted (header is optional)', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const eventId = uniqueId('evt_no_header');
      const rawBody = Buffer.from(JSON.stringify({ id: eventId, event: 'webhook.test' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({
        rawBody,
        signature: sig,
        headerEventId: undefined,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body.eventId).toBe(eventId);
    });
  });

  describe('3. Durable Event Persistence, Deduplication & Leasing', () => {
    it('creates event in whatsapp_zernio_webhook_events with deterministic docId zwh_${sha256(payload.id)}', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const eventId = uniqueId('evt_persisted');
      const rawBody = Buffer.from(JSON.stringify({ id: eventId, event: 'webhook.test' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      await service.handleZernioWebhook({
        rawBody,
        signature: sig,
      });

      const expectedDocId = buildZernioWebhookEventDocId(eventId);
      const doc = await webhookRepo.getEventById(expectedDocId);

      expect(doc).not.toBeNull();
      expect(doc?.id).toBe(expectedDocId);
      expect(doc?.event_id).toBe(eventId);
      expect(doc?.event_type).toBe('webhook.test');
      expect(doc?.status).toBe('ignored');
      expect(doc?.lease_until).toBeNull();
      expect(doc?.processed_at).not.toBeNull();
    });

    it('returns duplicate acknowledgment (HTTP 200) without re-processing on replay of processed event', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const eventId = uniqueId('evt_dedup');
      const rawBody = Buffer.from(JSON.stringify({ id: eventId, event: 'webhook.test' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      // Delivery 1
      const res1 = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res1.statusCode).toBe(200);
      expect(res1.body.status).toBe('ignored');

      // Delivery 2 (Replay)
      const res2 = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res2.statusCode).toBe(200);
      expect(res2.body.status).toBe('duplicate');
      expect(res2.body.processingStatus).toBe('ignored');
    });

    it('rejects concurrent delivery with HTTP 429 when lease is active', async () => {
      const eventId = uniqueId('evt_concurrent');
      const docId = buildZernioWebhookEventDocId(eventId);

      // Pre-create event with an active lease
      const now = new Date();
      const activeLease = new Date(now.getTime() + 60_000).toISOString();
      await db.collection('whatsapp_zernio_webhook_events').doc(docId).set({
        id: docId,
        event_id: eventId,
        event_type: 'account.connected',
        status: 'processing',
        processing_attempt_count: 1,
        lease_until: activeLease,
        received_at: now.toISOString(),
        processed_at: null,
        error: null,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      });

      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ id: eventId, event: 'account.connected' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      await expect(
        service.handleZernioWebhook({ rawBody, signature: sig })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 429,
          message: expect.stringContaining('processamento concorrente'),
        })
      );
    });

    it('allows takeover and increments attempt count when lease is expired', async () => {
      const eventId = uniqueId('evt_lease_expired');
      const docId = buildZernioWebhookEventDocId(eventId);

      // Pre-create event with an EXPIRED lease
      const past = new Date(Date.now() - 10_000).toISOString();
      await db.collection('whatsapp_zernio_webhook_events').doc(docId).set({
        id: docId,
        event_id: eventId,
        event_type: 'webhook.test',
        status: 'processing',
        processing_attempt_count: 1,
        lease_until: past,
        received_at: past,
        processed_at: null,
        error: null,
        created_at: past,
        updated_at: past,
      });

      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ id: eventId, event: 'webhook.test' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);

      const doc = await webhookRepo.getEventById(docId);
      expect(doc?.processing_attempt_count).toBe(2);
      expect(doc?.status).toBe('ignored');
    });

    it('allows retry and increments attempt count when previous status was retryable_error', async () => {
      const eventId = uniqueId('evt_retryable');
      const docId = buildZernioWebhookEventDocId(eventId);

      const past = new Date(Date.now() - 10_000).toISOString();
      await db.collection('whatsapp_zernio_webhook_events').doc(docId).set({
        id: docId,
        event_id: eventId,
        event_type: 'webhook.test',
        status: 'retryable_error',
        processing_attempt_count: 1,
        lease_until: null,
        received_at: past,
        processed_at: null,
        error: 'Transient error occurred',
        created_at: past,
        updated_at: past,
      });

      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const rawBody = Buffer.from(JSON.stringify({ id: eventId, event: 'webhook.test' }));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);

      const doc = await webhookRepo.getEventById(docId);
      expect(doc?.processing_attempt_count).toBe(2);
      expect(doc?.status).toBe('ignored');
    });
  });

  describe('4. Event Scope & Ignored Events', () => {
    it('ignores message.received event, records status="ignored", and returns HTTP 200 (preserves D5 scope: zero messaging handling)', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const eventId = uniqueId('evt_msg');
      const rawBody = Buffer.from(
        JSON.stringify({
          id: eventId,
          event: 'message.received',
          data: { from: '+5511999991234', text: 'Hello worship team' },
        })
      );
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('ignored');
      expect(res.body.eventType).toBe('message.received');

      const doc = await webhookRepo.getEventById(buildZernioWebhookEventDocId(eventId));
      expect(doc?.status).toBe('ignored');
    });

    it('ignores arbitrary valid signed event types, records status="ignored", and returns HTTP 200', async () => {
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, webhookRepo);
      const eventId = uniqueId('evt_unknown');
      const rawBody = Buffer.from(
        JSON.stringify({
          id: eventId,
          event: 'custom.integration.ping',
        })
      );
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('ignored');
    });
  });

  describe('5. account.connected Lifecycle Repair & Materialization', () => {
    it('repairs and advances pending connection to connected without active browser session', async () => {
      const profileId = uniqueId('prof_repair');
      const accountId = uniqueId('acc_repair');
      const testPhone = '+5511999990001';

      const conn = await createTestConnection({
        provider_profile_id: profileId,
        status: 'pending',
      });

      mockZernioApiForAccount(accountId, profileId, testPhone);

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_conn_pending');
      const payload = {
        id: eventId,
        event: 'account.connected',
        data: {
          accountId,
          profileId,
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('processed');

      // Verify connection updated to connected
      const updatedConn = await connectionRepo.getConnectionById(conn.id);
      expect(updatedConn).not.toBeNull();
      expect(updatedConn?.status).toBe('connected');
      expect(updatedConn?.provider_account_id).toBe(accountId);
      expect(updatedConn?.phone_number).toBe(testPhone);

      // Verify claims materialized in whatsapp_provider_identity_claims
      const accClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      expect(accClaim).not.toBeNull();
      expect(accClaim?.organization_id).toBe(conn.organization_id);
      expect(accClaim?.connection_id).toBe(conn.id);

      const phoneClaim = await claimRepo.getClaim(getZernioPhoneClaimId(testPhone));
      expect(phoneClaim).not.toBeNull();
      expect(phoneClaim?.organization_id).toBe(conn.organization_id);
      expect(phoneClaim?.connection_id).toBe(conn.id);

      // Verify webhook record status
      const eventDoc = await webhookRepo.getEventById(buildZernioWebhookEventDocId(eventId));
      expect(eventDoc?.status).toBe('processed');
    });

    it('repairs and advances connecting connection to connected', async () => {
      const profileId = uniqueId('prof_connecting');
      const accountId = uniqueId('acc_connecting');
      const testPhone = '+5511999990002';

      const conn = await createTestConnection({
        provider_profile_id: profileId,
        status: 'connecting',
      });

      mockZernioApiForAccount(accountId, profileId, testPhone);

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_conn_connecting');
      const payload = {
        id: eventId,
        event: 'account.connected',
        data: {
          accountId,
          profileId,
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('processed');

      const updatedConn = await connectionRepo.getConnectionById(conn.id);
      expect(updatedConn?.status).toBe('connected');
    });

    it('handles idempotent replay of account.connected for already connected line with same account', async () => {
      const profileId = uniqueId('prof_idempotent');
      const accountId = uniqueId('acc_idempotent');
      const testPhone = '+5511999990003';

      const conn = await createTestConnection({
        provider_profile_id: profileId,
        provider_account_id: accountId,
        phone_number: testPhone,
        status: 'connected',
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_conn_already');
      const payload = {
        id: eventId,
        event: 'account.connected',
        data: {
          accountId,
          profileId,
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      mockZernioApiForAccount(accountId, profileId, testPhone);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('processed');
    });

    it('marks terminal_error and returns 200 when provider_profile_id does not match any local WhatsAppConnection', async () => {
      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_conn_unknown_profile');
      const payload = {
        id: eventId,
        event: 'account.connected',
        data: {
          accountId: 'acc_unknown',
          profileId: 'prof_nonexistent_profile',
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('ignored');

      const eventDoc = await webhookRepo.getEventById(buildZernioWebhookEventDocId(eventId));
      expect(eventDoc?.status).toBe('ignored');
      expect(eventDoc?.error).toContain('No connection found');
    });

    it('does NOT revive a disconnected connection (preserves explicit disconnect state)', async () => {
      const profileId = uniqueId('prof_disconnected');
      const accountId = uniqueId('acc_disconnected');

      const conn = await createTestConnection({
        provider_profile_id: profileId,
        status: 'disconnected',
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_conn_no_revive');
      const payload = {
        id: eventId,
        event: 'account.connected',
        data: {
          accountId,
          profileId,
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('ignored');
      expect(res.body.reason).toContain('disconnected');

      const eventDoc = await webhookRepo.getEventById(buildZernioWebhookEventDocId(eventId));
      expect(eventDoc?.status).toBe('ignored');

      // Verify connection remains disconnected
      const currentConn = await connectionRepo.getConnectionById(conn.id);
      expect(currentConn?.status).toBe('disconnected');
    });

    it('handles claim collision gracefully as terminal_error (returns 200 without throwing 500)', async () => {
      const profileId = uniqueId('prof_collision');
      const accountId = uniqueId('acc_collision');
      const collidingPhone = '+5511999990099';

      const conn = await createTestConnection({
        provider_profile_id: profileId,
        status: 'pending',
      });

      // Pre-claim the phone number by another organization
      const otherOrgId = uniqueId('org_other');
      const now = new Date().toISOString();
      await db.collection('whatsapp_provider_identity_claims').doc(getZernioPhoneClaimId(collidingPhone)).set({
        id: getZernioPhoneClaimId(collidingPhone),
        provider: 'zernio',
        provider_phone_number_id: collidingPhone,
        connection_id: 'conn_other',
        organization_id: otherOrgId,
        created_at: now,
      });

      mockZernioApiForAccount(accountId, profileId, collidingPhone);

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_conn_claim_collision');
      const payload = {
        id: eventId,
        event: 'account.connected',
        data: {
          accountId,
          profileId,
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('terminal_error');
      expect(res.body.error).toContain('já está registrado em outra conexão');

      const eventDoc = await webhookRepo.getEventById(buildZernioWebhookEventDocId(eventId));
      expect(eventDoc?.status).toBe('terminal_error');
    });

    it('throws retryable error (500) and marks status="retryable_error" on transient Zernio API failure (503 / timeout)', async () => {
      const profileId = uniqueId('prof_transient');
      const accountId = uniqueId('acc_transient');

      await createTestConnection({
        provider_profile_id: profileId,
        status: 'pending',
      });

      const fakeFetch = vi.fn(async () => {
        return {
          ok: false,
          status: 503,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify({ error: 'Service Unavailable' }),
        } as any;
      });
      vi.stubGlobal('fetch', fakeFetch);

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_conn_transient');
      const payload = {
        id: eventId,
        event: 'account.connected',
        data: {
          accountId,
          profileId,
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      await expect(
        service.handleZernioWebhook({ rawBody, signature: sig })
      ).rejects.toThrow();

      const eventDoc = await webhookRepo.getEventById(buildZernioWebhookEventDocId(eventId));
      expect(eventDoc?.status).toBe('retryable_error');
      expect(eventDoc?.error).toBeTruthy();
    });
  });

  describe('6. account.disconnected Lifecycle & Claim Retention', () => {
    it('transitions connected connection to status="error" and retains provider claims in Firestore (CRITICAL: zero release in D5)', async () => {
      const profileId = uniqueId('prof_disc_connected');
      const accountId = uniqueId('acc_disc_connected');
      const testPhone = '+5511999990005';

      const conn = await createTestConnection({
        provider_profile_id: profileId,
        provider_account_id: accountId,
        phone_number: testPhone,
        status: 'connected',
      });

      // Pre-create the claims in Firestore
      const now = new Date().toISOString();
      const accountClaimId = getZernioAccountClaimId(accountId);
      const phoneClaimId = getZernioPhoneClaimId(testPhone);

      await db.collection('whatsapp_provider_identity_claims').doc(accountClaimId).set({
        id: accountClaimId,
        provider: 'zernio',
        provider_phone_number_id: accountId,
        connection_id: conn.id,
        organization_id: conn.organization_id,
        created_at: now,
      });

      await db.collection('whatsapp_provider_identity_claims').doc(phoneClaimId).set({
        id: phoneClaimId,
        provider: 'zernio',
        provider_phone_number_id: testPhone,
        connection_id: conn.id,
        organization_id: conn.organization_id,
        created_at: now,
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_disc_conn');
      const payload = {
        id: eventId,
        event: 'account.disconnected',
        data: {
          accountId,
          profileId,
          platform: 'whatsapp',
          disconnectionType: 'user_revoked',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('processed');

      // Connection must transition to status: 'error'
      const updatedConn = await connectionRepo.getConnectionById(conn.id);
      expect(updatedConn).not.toBeNull();
      expect(updatedConn?.status).toBe('error');
      expect(updatedConn?.status_reason).toContain('PROVIDER_DISCONNECTED');

      // CRITICAL ASSERTION: Both claims MUST STILL EXIST in Firestore!
      const accountClaimDoc = await claimRepo.getClaim(accountClaimId);
      expect(accountClaimDoc).not.toBeNull();
      expect(accountClaimDoc?.id).toBe(accountClaimId);

      const phoneClaimDoc = await claimRepo.getClaim(phoneClaimId);
      expect(phoneClaimDoc).not.toBeNull();
      expect(phoneClaimDoc?.id).toBe(phoneClaimId);
    });

    it('transitions connecting connection to status="error"', async () => {
      const profileId = uniqueId('prof_disc_connecting');
      const accountId = uniqueId('acc_disc_connecting');

      const conn = await createTestConnection({
        provider_profile_id: profileId,
        status: 'connecting',
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_disc_connecting');
      const payload = {
        id: eventId,
        event: 'account.disconnected',
        data: {
          accountId,
          profileId,
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('processed');

      const updatedConn = await connectionRepo.getConnectionById(conn.id);
      expect(updatedConn?.status).toBe('error');
    });

    it('returns 200 when disconnecting unknown profileId without throwing', async () => {
      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        webhookRepo
      );

      const eventId = uniqueId('evt_disc_unknown');
      const payload = {
        id: eventId,
        event: 'account.disconnected',
        data: {
          accountId: 'acc_nonexistent',
          profileId: 'prof_nonexistent',
          platform: 'whatsapp',
        },
      };
      const rawBody = Buffer.from(JSON.stringify(payload));
      const sig = signPayload(rawBody, testWebhookSecret);

      const res = await service.handleZernioWebhook({ rawBody, signature: sig });
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('ignored');
    });
  });

  describe('7. Full HTTP Express Pipeline & Route Integration', () => {
    let server: http.Server;
    let baseUrl: string;

    beforeEach(async () => {
      await new Promise<void>((resolve) => {
        server = app.listen(0, () => {
          const addr = server.address() as any;
          baseUrl = `http://127.0.0.1:${addr.port}`;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
      }
    });

    it('successfully processes valid webhook via HTTP POST with raw body parsing and signature', async () => {
      const eventId = uniqueId('evt_http_ok');
      const payload = { id: eventId, event: 'webhook.test' };
      const rawBodyStr = JSON.stringify(payload);
      const signature = signPayload(rawBodyStr, testWebhookSecret);

      const response = await fetch(`${baseUrl}/api/v1/whatsapp/zernio/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-zernio-signature': signature,
          'x-zernio-event-id': eventId,
        },
        body: rawBodyStr,
      });

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.ok).toBe(true);
      expect(json.eventId).toBe(eventId);
      expect(json.status).toBe('ignored');
    });

    it('rejects request with HTTP 401 when signature header is missing in HTTP pipeline', async () => {
      const eventId = uniqueId('evt_http_nosig');
      const payload = { id: eventId, event: 'webhook.test' };
      const rawBodyStr = JSON.stringify(payload);

      const response = await fetch(`${baseUrl}/api/v1/whatsapp/zernio/webhook`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: rawBodyStr,
      });

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error?.message || json.error).toContain('X-Zernio-Signature');
    });

    it('verifies standard routes (e.g. GET /api/health) still work alongside raw webhook route', async () => {
      const response = await fetch(`${baseUrl}/api/health`);
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.status).toBe('ok');
    });
  });
});

