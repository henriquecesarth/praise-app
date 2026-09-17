import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppOutboundDispatchRepository } from '../../repositories/WhatsAppOutboundDispatchRepository';
import { WhatsAppZernioWebhookRepository } from '../../repositories/WhatsAppZernioWebhookRepository';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppOutboundService } from './whatsapp-outbound.service';
import { ZernioHttpClient } from './zernio-http-client';
import { getClaimId } from './whatsapp.types';
import {
  buildZernioProviderMessageDocId,
  formatZernioParticipantId,
  ZernioError,
} from './zernio.types';
import { AppError } from '../../middleware/error-handler';

describe('Zernio Outbound Dispatch & Message Delivery Lifecycle Suite (Phase 7D2-D6)', { timeout: 25000 }, () => {
  const connectionRepo = new WhatsAppConnectionRepository();
  const claimRepo = new WhatsAppProviderIdentityClaimRepository();
  const outboundRepo = new WhatsAppOutboundDispatchRepository();
  const webhookRepo = new WhatsAppZernioWebhookRepository();

  let zernioClient: ZernioHttpClient;
  let connectionService: WhatsAppConnectionService;
  let outboundService: WhatsAppOutboundService;
  let fetchSpy: any;

  const testWebhookSecret = 'test_webhook_secret_d6_secure_key_1234567890';
  const testApiKey = 'test_api_key_d6_val';

  let testOrgId: string;
  let testMinistryId: string;
  let testConnId: string;
  let testAccountId: string;
  let testProfileId: string;
  const testPhoneNumber = '+5511988887777';
  let testPhoneNumberId: string;

  function signPayload(body: Buffer | string, secret: string = testWebhookSecret): string {
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
    return crypto.createHmac('sha256', secret).update(buf).digest('hex');
  }

  function uniqueId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    process.env.ZERNIO_WEBHOOK_SECRET = testWebhookSecret;
    process.env.ZERNIO_API_KEY = testApiKey;

    testOrgId = uniqueId('org');
    testMinistryId = uniqueId('min');
    testConnId = uniqueId('conn');
    testAccountId = uniqueId('acc_wa');
    testProfileId = uniqueId('prof_zernio');
    testPhoneNumberId = uniqueId('phone_id');

    zernioClient = new ZernioHttpClient({
      apiKey: testApiKey,
      baseUrl: 'https://mock.zernio.internal/api/v1',
    });

    connectionService = new WhatsAppConnectionService(
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
      zernioClient,
      webhookRepo,
      outboundRepo
    );

    outboundService = new WhatsAppOutboundService(
      outboundRepo,
      connectionRepo,
      claimRepo,
      undefined,
      zernioClient,
      connectionService
    );

    // Seed test fixtures
    await db.collection('ministries').doc(testMinistryId).set({
      id: testMinistryId,
      name: 'Test Outbound Ministry',
      organization_id: testOrgId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db.collection('organizations').doc(testOrgId).set({
      id: testOrgId,
      name: 'Test Outbound Organization',
      default_whatsapp_connection_id: testConnId,
      billing_anchor_ministry_id: testMinistryId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db.collection('ministry_subscriptions').doc(testMinistryId).set({
      id: testMinistryId,
      ministry_id: testMinistryId,
      plan_id: 'pro',
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'paid',
      administratively_suspended: false,
      suspended_at: null,
      suspension_reason: null,
      grace_period_expires_at: null,
      current_period_start: new Date().toISOString(),
      current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    await db.collection('whatsapp_connections').doc(testConnId).set({
      id: testConnId,
      organization_id: testOrgId,
      display_name: 'Test WhatsApp Line',
      phone_number: testPhoneNumber,
      provider: 'zernio',
      provider_profile_id: testProfileId,
      provider_account_id: testAccountId,
      provider_waba_id: 'waba_123',
      provider_phone_number_id: testPhoneNumberId,
      status: 'connected',
      status_reason: null,
      assigned_ministry_id: testMinistryId,
      created_by_user_id: 'user_admin',
      current_onboarding_session_id: null,
      pending_expires_at: null,
      last_connected_at: new Date().toISOString(),
      last_health_check_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const claimId = getClaimId('zernio', testPhoneNumberId);
    await db.collection('whatsapp_provider_identity_claims').doc(claimId).set({
      id: claimId,
      provider: 'zernio',
      provider_phone_number_id: testPhoneNumberId,
      connection_id: testConnId,
      organization_id: testOrgId,
      acquired_at: new Date().toISOString(),
      expires_at: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Section 1: Recipient Phone Normalization & Formatting', () => {
    it('normalizes formatted phone number to digits-only E.164 format without plus', () => {
      expect(formatZernioParticipantId('+55 (11) 99999-8888')).toBe('5511999998888');
      expect(formatZernioParticipantId('+1 (415) 555-2671')).toBe('14155552671');
      expect(formatZernioParticipantId('5511999998888')).toBe('5511999998888');
    });

    it('rejects invalid or non-numeric participant IDs', () => {
      expect(() => formatZernioParticipantId('not-a-number')).toThrow();
      expect(() => formatZernioParticipantId('')).toThrow();
      expect(() => formatZernioParticipantId('+')).toThrow();
    });
  });

  describe('Section 2: Approved Template Verification', () => {
    it('passes verification when template is APPROVED with matching name and language', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () =>
          JSON.stringify({
            templates: [
              {
                id: 'tmpl_1',
                name: 'rehearsal_reminder',
                language: 'pt_BR',
                status: 'APPROVED',
                category: 'UTILITY',
              },
            ],
          }),
      } as any);

      const result = await outboundService.verifyApprovedTemplate({
        accountId: testAccountId,
        templateName: 'rehearsal_reminder',
        templateLanguage: 'pt_BR',
      });

      expect(result.name).toBe('rehearsal_reminder');
      expect(result.status).toBe('APPROVED');
    });

    it('rejects template verification when status is PENDING, REJECTED or PAUSED', async () => {
      for (const unapprovedStatus of ['PENDING', 'REJECTED', 'PAUSED']) {
        fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              templates: [
                {
                  id: 'tmpl_unapproved',
                  name: 'rehearsal_reminder',
                  language: 'pt_BR',
                  status: unapprovedStatus,
                  category: 'UTILITY',
                },
              ],
            }),
        } as any);

        await expect(
          outboundService.verifyApprovedTemplate({
            accountId: testAccountId,
            templateName: 'rehearsal_reminder',
            templateLanguage: 'pt_BR',
          })
        ).rejects.toThrow('TEMPLATE_NOT_APPROVED');
      }
    });

    it('rejects template verification when template is not found in provider list', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify({ templates: [] }),
      } as any);

      await expect(
        outboundService.verifyApprovedTemplate({
          accountId: testAccountId,
          templateName: 'non_existent_template',
          templateLanguage: 'pt_BR',
        })
      ).rejects.toThrow('TEMPLATE_NOT_APPROVED');
    });
  });

  describe('Section 3: Proactive Initial Template Conversation Send', () => {
    it('dispatches initial template WITHOUT Idempotency-Key header and creates shadow', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  {
                    id: 'tmpl_ok',
                    name: 'schedule_notice',
                    language: 'pt_BR',
                    status: 'APPROVED',
                    category: 'UTILITY',
                  },
                ],
              }),
          } as any;
        }

        if (urlStr.includes('/inbox/conversations')) {
          // STRICT INVARIANT: Must NOT include Idempotency-Key header on conversation create
          expect(opts.headers['Idempotency-Key']).toBeUndefined();
          expect(opts.method).toBe('POST');
          const body = JSON.parse(opts.body);
          expect(body.accountId).toBe(testAccountId);
          expect(body.participantId).toBe('5511999991111');
          expect(body.templateName).toBe('schedule_notice');
          expect(body.templateLanguage).toBe('pt_BR');

          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                conversation: {
                  id: 'conv_wa_test_1',
                },
                message: {
                  id: 'msg_wa_test_1',
                  providerMessageId: 'wamid.HBgLtest1',
                },
              }),
          } as any;
        }

        return { ok: false, status: 404 } as any;
      });

      const dispatchId = uniqueId('disp_proactive');
      const result = await outboundService.sendProactiveTemplate({
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: '+55 (11) 99999-1111',
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
      });

      expect(result.id).toBe(dispatchId);
      expect(result.status).toBe('accepted');
      expect(result.phase).toBe('completed');
      expect(result.provider_message_id).toBe('wamid.HBgLtest1');
      expect(result.provider_conversation_id).toBe('conv_wa_test_1');

      // Verify Provider Message Shadow was created deterministically
      const shadowDocId = buildZernioProviderMessageDocId('wamid.HBgLtest1');
      const shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow).not.toBeNull();
      expect(shadow!.provider_message_id).toBe('wamid.HBgLtest1');
      expect(shadow!.outbound_dispatch_id).toBe(dispatchId);
      expect(shadow!.status).toBe('sent');
      expect(shadow!.organization_id).toBe(testOrgId);
    });

    it('is idempotent upon identical replay and returns existing accepted dispatch', async () => {
      let networkSendCount = 0;
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  {
                    id: 'tmpl_ok',
                    name: 'schedule_notice',
                    language: 'pt_BR',
                    status: 'APPROVED',
                    category: 'UTILITY',
                  },
                ],
              }),
          } as any;
        }

        if (urlStr.includes('/inbox/conversations')) {
          networkSendCount++;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                conversation: { id: 'conv_replay_1' },
                message: { id: 'msg_replay_1', providerMessageId: 'wamid.replay1' },
              }),
          } as any;
        }

        return { ok: false, status: 404 } as any;
      });

      const dispatchId = uniqueId('disp_replay');
      const params = {
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: '+55 (11) 99999-2222',
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
      };

      const firstResult = await outboundService.sendProactiveTemplate(params);
      expect(firstResult.status).toBe('accepted');
      expect(networkSendCount).toBe(1);

      // Replay with identical parameters
      const secondResult = await outboundService.sendProactiveTemplate(params);
      expect(secondResult.status).toBe('accepted');
      expect(secondResult.id).toBe(dispatchId);
      // Zero extra network calls to POST /inbox/conversations
      expect(networkSendCount).toBe(1);
    });

    it('rejects replay with altered parameters (fingerprint mismatch) with 422', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  { id: 'tmpl_1', name: 'schedule_notice', language: 'pt_BR', status: 'APPROVED' },
                  { id: 'tmpl_2', name: 'other_notice', language: 'pt_BR', status: 'APPROVED' },
                ],
              }),
          } as any;
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              conversation: { id: 'conv_1' },
              message: { id: 'msg_1', providerMessageId: 'wamid.fp1' },
            }),
        } as any;
      });

      const dispatchId = uniqueId('disp_fingerprint');
      await outboundService.sendProactiveTemplate({
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: '+55 (11) 99999-3333',
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
      });

      // Altered recipient phone
      await expect(
        outboundService.sendProactiveTemplate({
          dispatchId,
          ministryId: testMinistryId,
          recipientPhone: '+55 (11) 99999-4444',
          templateName: 'schedule_notice',
          templateLanguage: 'pt_BR',
        })
      ).rejects.toThrow('DISPATCH_FINGERPRINT_MISMATCH');
    });
  });

  describe('Section 4: Crash Windows A and B Threat Model', () => {
    it('Crash Window A: Dispatch in phase=prepared is safe to execute on retry', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  { id: 't1', name: 'schedule_notice', language: 'pt_BR', status: 'APPROVED' },
                ],
              }),
          } as any;
        }

        if (urlStr.includes('/inbox/conversations')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                conversation: { id: 'conv_crash_a' },
                message: { id: 'msg_crash_a', providerMessageId: 'wamid.crashA' },
              }),
          } as any;
        }

        return { ok: false, status: 404 } as any;
      });

      const dispatchId = uniqueId('disp_crash_a');
      const recipientE164 = '+5511999995555';
      const participantId = '5511999995555';
      const requestFingerprint = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            accountId: testAccountId,
            recipient: participantId,
            templateName: 'schedule_notice',
            templateLanguage: 'pt_BR',
            templateParams: null,
          })
        )
        .digest('hex');

      // Simulate crash right after prepareDispatch (phase: prepared)
      await outboundRepo.prepareDispatch({
        id: dispatchId,
        organizationId: testOrgId,
        ministryId: testMinistryId,
        connectionId: testConnId,
        providerAccountId: testAccountId,
        recipientE164,
        recipientParticipantId: participantId,
        dispatchKind: 'proactive_template',
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
        requestFingerprint,
      });

      // Verify phase is prepared
      const preparedRecord = await outboundRepo.getDispatchById(dispatchId);
      expect(preparedRecord!.phase).toBe('prepared');

      // Redelivery executes and completes
      const result = await outboundService.sendProactiveTemplate({
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: recipientE164,
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
      });

      expect(result.status).toBe('accepted');
      expect(result.phase).toBe('completed');
      expect(result.provider_message_id).toBe('wamid.crashA');
    });

    it('Crash Window B: Dispatch in phase=request_started refuses automatic resend and transitions to outcome_unknown', async () => {
      let networkCalled = false;
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  { id: 't1', name: 'schedule_notice', language: 'pt_BR', status: 'APPROVED' },
                ],
              }),
          } as any;
        }

        if (urlStr.includes('/inbox/conversations')) {
          networkCalled = true;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => JSON.stringify({ conversation: { id: 'c' }, message: { id: 'm' } }),
          } as any;
        }

        return { ok: false, status: 404 } as any;
      });

      const dispatchId = uniqueId('disp_crash_b');
      const recipientE164 = '+5511999996666';
      const participantId = '5511999996666';
      const requestFingerprint = crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            accountId: testAccountId,
            recipient: participantId,
            templateName: 'schedule_notice',
            templateLanguage: 'pt_BR',
            templateParams: null,
          })
        )
        .digest('hex');

      // Prepare dispatch and advance to request_started
      await outboundRepo.prepareDispatch({
        id: dispatchId,
        organizationId: testOrgId,
        ministryId: testMinistryId,
        connectionId: testConnId,
        providerAccountId: testAccountId,
        recipientE164,
        recipientParticipantId: participantId,
        dispatchKind: 'proactive_template',
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
        requestFingerprint,
      });
      await outboundRepo.markRequestStarted(dispatchId);

      // Verify phase is request_started
      const startedRecord = await outboundRepo.getDispatchById(dispatchId);
      expect(startedRecord!.phase).toBe('request_started');

      // Now caller/worker attempts redelivery:
      // Invariant: MUST NOT initiate network call to Zernio!
      const result = await outboundService.sendProactiveTemplate({
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: recipientE164,
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
      });

      expect(networkCalled).toBe(false);
      expect(result.status).toBe('outcome_unknown');
      expect(result.phase).toBe('completed');
    });
  });

  describe('Section 5: Ambiguous Failures and Zero Blind Retries', () => {
    it('marks dispatch as outcome_unknown when Zernio returns 500/502/504 or network error', async () => {
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  { id: 't1', name: 'schedule_notice', language: 'pt_BR', status: 'APPROVED' },
                ],
              }),
          } as any;
        }

        if (urlStr.includes('/inbox/conversations')) {
          return {
            ok: false,
            status: 500,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => JSON.stringify({ error: { message: 'Internal Server Error' } }),
          } as any;
        }

        return { ok: false, status: 404 } as any;
      });

      const dispatchId = uniqueId('disp_ambiguous');
      await expect(
        outboundService.sendProactiveTemplate({
          dispatchId,
          ministryId: testMinistryId,
          recipientPhone: '+55 (11) 99999-7777',
          templateName: 'schedule_notice',
          templateLanguage: 'pt_BR',
        })
      ).rejects.toThrow('WHATSAPP_SEND_OUTCOME_UNKNOWN');

      const record = await outboundRepo.getDispatchById(dispatchId);
      expect(record!.status).toBe('outcome_unknown');
      expect(record!.phase).toBe('completed');
    });
  });

  describe('Section 6: Existing-Conversation Text Message Dispatch', () => {
    it('dispatches existing conversation message WITH Idempotency-Key header', async () => {
      let receivedIdempotencyKey: string | null = null;
      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any, opts: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/inbox/conversations/conv_exist_1/messages')) {
          receivedIdempotencyKey = opts.headers['Idempotency-Key'];
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                message: {
                  id: 'msg_exist_resp_1',
                  providerMessageId: 'wamid.exist123',
                },
              }),
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const dispatchId = uniqueId('disp_existing');
      const result = await outboundService.sendExistingConversationText({
        dispatchId,
        conversationId: 'conv_exist_1',
        ministryId: testMinistryId,
        messageText: 'Ensaio confirmado para amanhã às 19h!',
      });

      expect(result.status).toBe('accepted');
      expect(result.provider_message_id).toBe('wamid.exist123');
      expect(receivedIdempotencyKey).toBeTruthy();
      expect(receivedIdempotencyKey).toMatch(/^idemp_[a-f0-9]{32}$/);

      // Verify shadow was created
      const shadowDocId = buildZernioProviderMessageDocId('wamid.exist123');
      const shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow).not.toBeNull();
      expect(shadow!.status).toBe('sent');
      expect(shadow!.outbound_dispatch_id).toBe(dispatchId);
    });
  });

  describe('Section 7: Webhook Delivery Tracking & Monotonic Shadow Convergence', () => {
    it('monotonically updates status: pending -> sent -> delivered -> read', async () => {
      const providerMsgId = 'wamid.lifecycle.mono.' + Date.now();
      const dispatchId = uniqueId('disp_lifecycle');

      // Create initial dispatch & shadow
      await outboundRepo.prepareDispatch({
        id: dispatchId,
        organizationId: testOrgId,
        ministryId: testMinistryId,
        connectionId: testConnId,
        providerAccountId: testAccountId,
        recipientE164: testPhoneNumber,
        recipientParticipantId: '5511988887777',
        dispatchKind: 'proactive_template',
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
        requestFingerprint: 'dummy_fp',
      });
      await outboundRepo.markAccepted(dispatchId, {
        providerMessageId: providerMsgId,
        providerConversationId: 'conv_life_1',
      });

      // 1. Ingest message.delivered
      const deliveredEvent = {
        id: uniqueId('evt_delivered'),
        event: 'message.delivered',
        data: {
          accountId: testAccountId,
          messageId: providerMsgId,
          timestamp: new Date().toISOString(),
        },
      };
      const deliveredBody = JSON.stringify(deliveredEvent);
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(deliveredBody, 'utf8'),
        signature: signPayload(deliveredBody),
      });

      let shadow = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId(providerMsgId)
      );
      expect(shadow!.status).toBe('delivered');
      let dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('delivered');

      // 2. Ingest message.read
      const readEvent = {
        id: uniqueId('evt_read'),
        event: 'message.read',
        data: {
          accountId: testAccountId,
          messageId: providerMsgId,
          timestamp: new Date().toISOString(),
        },
      };
      const readBody = JSON.stringify(readEvent);
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(readBody, 'utf8'),
        signature: signPayload(readBody),
      });

      shadow = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId(providerMsgId)
      );
      expect(shadow!.status).toBe('read');
      dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('read');

      // 3. Out-of-order late message.sent or message.delivered must NOT regress read
      const lateSentEvent = {
        id: uniqueId('evt_late_sent'),
        event: 'message.sent',
        data: {
          accountId: testAccountId,
          messageId: providerMsgId,
          timestamp: new Date().toISOString(),
        },
      };
      const lateBody = JSON.stringify(lateSentEvent);
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(lateBody, 'utf8'),
        signature: signPayload(lateBody),
      });

      shadow = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId(providerMsgId)
      );
      expect(shadow!.status).toBe('read');
      dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('read');
    });

    it('handles race where webhook arrives BEFORE outbound send commits to DB', async () => {
      const providerMsgId = 'wamid.race.before.' + Date.now();
      const dispatchId = uniqueId('disp_race');

      // Webhook arrives first
      const deliveredEvent = {
        id: uniqueId('evt_race_delivered'),
        event: 'message.delivered',
        data: {
          accountId: testAccountId,
          messageId: providerMsgId,
          timestamp: new Date().toISOString(),
        },
      };
      const deliveredBody = JSON.stringify(deliveredEvent);
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(deliveredBody, 'utf8'),
        signature: signPayload(deliveredBody),
      });

      const shadowBeforeCommit = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId(providerMsgId)
      );
      expect(shadowBeforeCommit).not.toBeNull();
      expect(shadowBeforeCommit!.status).toBe('delivered');
      expect(shadowBeforeCommit!.outbound_dispatch_id).toBeNull();

      // Now outbound send finally commits to DB
      await outboundRepo.prepareDispatch({
        id: dispatchId,
        organizationId: testOrgId,
        ministryId: testMinistryId,
        connectionId: testConnId,
        providerAccountId: testAccountId,
        recipientE164: testPhoneNumber,
        recipientParticipantId: '5511988887777',
        dispatchKind: 'proactive_template',
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
        requestFingerprint: 'race_fp',
      });
      const committedDispatch = await outboundRepo.markAccepted(dispatchId, {
        providerMessageId: providerMsgId,
        providerConversationId: 'conv_race',
      });

      // Invariant: Status stays delivered (does not regress to sent) and dispatch is linked!
      expect(committedDispatch.status).toBe('delivered');
      const shadowAfterCommit = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId(providerMsgId)
      );
      expect(shadowAfterCommit!.status).toBe('delivered');
      expect(shadowAfterCommit!.outbound_dispatch_id).toBe(dispatchId);
    });

    it('records message.failed and marks dispatch and shadow as failed', async () => {
      const providerMsgId = 'wamid.fail.test.' + Date.now();
      const dispatchId = uniqueId('disp_fail');

      await outboundRepo.prepareDispatch({
        id: dispatchId,
        organizationId: testOrgId,
        ministryId: testMinistryId,
        connectionId: testConnId,
        providerAccountId: testAccountId,
        recipientE164: testPhoneNumber,
        recipientParticipantId: '5511988887777',
        dispatchKind: 'proactive_template',
        templateName: 'schedule_notice',
        templateLanguage: 'pt_BR',
        requestFingerprint: 'fail_fp',
      });
      await outboundRepo.markAccepted(dispatchId, {
        providerMessageId: providerMsgId,
        providerConversationId: 'conv_fail',
      });

      const failedEvent = {
        id: uniqueId('evt_failed'),
        event: 'message.failed',
        data: {
          accountId: testAccountId,
          messageId: providerMsgId,
          error: {
            code: '131026',
            message: 'Message undeliverable to recipient',
          },
          timestamp: new Date().toISOString(),
        },
      };
      const failedBody = JSON.stringify(failedEvent);
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(failedBody, 'utf8'),
        signature: signPayload(failedBody),
      });

      const shadow = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId(providerMsgId)
      );
      expect(shadow!.status).toBe('failed');
      expect(shadow!.failure_code).toBe('131026');

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('failed');
      expect(dispatch!.last_error_code).toBe('131026');
    });

    it('Cross-tenant isolation: Webhook with foreign accountId is rejected and does not mutate shadow', async () => {
      const providerMsgId = 'wamid.crosstenant.' + Date.now();
      const foreignAccountId = 'acc_foreign_tenant_999';

      const deliveredEvent = {
        id: uniqueId('evt_foreign'),
        event: 'message.delivered',
        data: {
          accountId: foreignAccountId,
          messageId: providerMsgId,
          timestamp: new Date().toISOString(),
        },
      };
      const deliveredBody = JSON.stringify(deliveredEvent);

      const response = await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(deliveredBody, 'utf8'),
        signature: signPayload(deliveredBody),
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toBe('ignored');

      const shadow = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId(providerMsgId)
      );
      expect(shadow).toBeNull();
    });
  });

  describe('Section 8: Hardened Concurrency, Execution Leases & Ambiguity Edge Cases (Phase 7D2-D6-R2)', () => {
    it('Concurrent proactive dispatch: exactly ONE provider HTTP request and safe winner/loser convergence', async () => {
      const dispatchId = uniqueId('disp_concurrent_pro');
      let callCount = 0;

      let releaseFirstHttp: () => void = () => {};
      const firstHttpStarted = new Promise<void>((resolve) => {
        releaseFirstHttp = resolve;
      });

      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  {
                    id: 'tmpl_1',
                    name: 'rehearsal_reminder',
                    language: 'pt_BR',
                    status: 'APPROVED',
                    category: 'UTILITY',
                  },
                ],
              }),
          } as any;
        }
        if (urlStr.includes('inbox/conversations')) {
          callCount++;
          // Caller 1 holds execution lease in flight until Caller 2 attempts
          await firstHttpStarted;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                message: { id: 'msg_concur_1', providerMessageId: 'wamid.concur1' },
                conversation: { id: 'conv_concur_1', providerConversationId: 'conv_concur_1' },
              }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' } as any;
      });

      const p1 = outboundService.sendProactiveTemplate({
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: '+5511999998888',
        templateName: 'rehearsal_reminder',
        templateLanguage: 'pt_BR',
      });

      while (callCount === 0) {
        await new Promise((r) => setTimeout(r, 10));
      }

      let caller2Error: any = null;
      try {
        await outboundService.sendProactiveTemplate({
          dispatchId,
          ministryId: testMinistryId,
          recipientPhone: '+5511999998888',
          templateName: 'rehearsal_reminder',
          templateLanguage: 'pt_BR',
        });
      } catch (err: any) {
        caller2Error = err;
      }

      releaseFirstHttp();
      const p1Result = await p1;

      expect(callCount).toBe(1);
      expect(caller2Error).not.toBeNull();
      expect(caller2Error.statusCode).toBe(409);
      expect(caller2Error.message).toContain('WHATSAPP_DISPATCH_IN_PROGRESS');
      expect(p1Result.status).toBe('accepted');

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('accepted');
      expect(dispatch!.phase).toBe('completed');
      expect(dispatch!.provider_message_id).toBe('wamid.concur1');

      const shadow = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId('wamid.concur1')
      );
      expect(shadow).not.toBeNull();
      expect(shadow!.outbound_dispatch_id).toBe(dispatchId);
    });

    it('Concurrent existing-conversation dispatch: exactly ONE provider call, no overwrite of accepted status', async () => {
      const dispatchId = uniqueId('disp_concurrent_exist');
      const conversationId = 'conv_existing_concurrent';
      let callCount = 0;

      let releaseFirstHttp: () => void = () => {};
      const firstHttpStarted = new Promise<void>((resolve) => {
        releaseFirstHttp = resolve;
      });

      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('messages')) {
          callCount++;
          await firstHttpStarted;
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                message: { id: 'msg_exist_concur_1', providerMessageId: 'wamid.existconcur1' },
                conversationId,
              }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' } as any;
      });

      const p1 = outboundService.sendExistingConversationText({
        dispatchId,
        conversationId,
        ministryId: testMinistryId,
        messageText: 'Olá equipe',
      });

      while (callCount === 0) {
        await new Promise((r) => setTimeout(r, 10));
      }

      let caller2Error: any = null;
      try {
        await outboundService.sendExistingConversationText({
          dispatchId,
          conversationId,
          ministryId: testMinistryId,
          messageText: 'Olá equipe',
        });
      } catch (err: any) {
        caller2Error = err;
      }

      releaseFirstHttp();
      const p1Result = await p1;

      expect(callCount).toBe(1);
      expect(caller2Error).not.toBeNull();
      expect(caller2Error.statusCode).toBe(409);
      expect(caller2Error.message).toContain('WHATSAPP_DISPATCH_IN_PROGRESS');
      expect(p1Result.status).toBe('accepted');

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('accepted');
      expect(dispatch!.phase).toBe('completed');
    });

    it('Active execution lease blocks duplicate send with 409 WHATSAPP_DISPATCH_IN_PROGRESS and leaves record untouched', async () => {
      const dispatchId = uniqueId('disp_active_lease');

      await db.collection('whatsapp_outbound_dispatches').doc(dispatchId).set({
        id: dispatchId,
        organization_id: testOrgId,
        ministry_id: testMinistryId,
        connection_id: testConnId,
        provider: 'zernio',
        provider_account_id: testAccountId,
        recipient_e164: '+5511999998888',
        recipient_participant_id: '5511999998888',
        dispatch_kind: 'proactive_template',
        template_name: 'rehearsal_reminder',
        template_language: 'pt_BR',
        request_fingerprint: crypto
          .createHash('sha256')
          .update(
            JSON.stringify({
              accountId: testAccountId,
              recipient: '5511999998888',
              templateName: 'rehearsal_reminder',
              templateLanguage: 'pt_BR',
              templateParams: null,
            })
          )
          .digest('hex'),
        status: 'pending',
        phase: 'request_started',
        request_execution_id: 'exec_active_123',
        request_lease_until: new Date(Date.now() + 60000).toISOString(),
        send_started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  {
                    id: 'tmpl_1',
                    name: 'rehearsal_reminder',
                    language: 'pt_BR',
                    status: 'APPROVED',
                    category: 'UTILITY',
                  },
                ],
              }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' } as any;
      });

      await expect(
        outboundService.sendProactiveTemplate({
          dispatchId,
          ministryId: testMinistryId,
          recipientPhone: '+5511999998888',
          templateName: 'rehearsal_reminder',
          templateLanguage: 'pt_BR',
        })
      ).rejects.toThrow('WHATSAPP_DISPATCH_IN_PROGRESS');

      const conversationCalls = fetchSpy.mock.calls.filter((call: any[]) =>
        String(call[0]).includes('/inbox/conversations')
      );
      expect(conversationCalls.length).toBe(0);

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('pending');
      expect(dispatch!.phase).toBe('request_started');
      expect(dispatch!.request_execution_id).toBe('exec_active_123');
    });

    it('Expired execution lease: converges atomically to outcome_unknown and never grants permission to resend', async () => {
      const dispatchId = uniqueId('disp_expired_lease');

      await db.collection('whatsapp_outbound_dispatches').doc(dispatchId).set({
        id: dispatchId,
        organization_id: testOrgId,
        ministry_id: testMinistryId,
        connection_id: testConnId,
        provider: 'zernio',
        provider_account_id: testAccountId,
        recipient_e164: '+5511999998888',
        recipient_participant_id: '5511999998888',
        dispatch_kind: 'proactive_template',
        template_name: 'rehearsal_reminder',
        template_language: 'pt_BR',
        request_fingerprint: crypto
          .createHash('sha256')
          .update(
            JSON.stringify({
              accountId: testAccountId,
              recipient: '5511999998888',
              templateName: 'rehearsal_reminder',
              templateLanguage: 'pt_BR',
              templateParams: null,
            })
          )
          .digest('hex'),
        status: 'pending',
        phase: 'request_started',
        request_execution_id: 'exec_stale_old',
        request_lease_until: new Date(Date.now() - 5000).toISOString(),
        send_started_at: new Date(Date.now() - 65000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('/whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  {
                    id: 'tmpl_1',
                    name: 'rehearsal_reminder',
                    language: 'pt_BR',
                    status: 'APPROVED',
                    category: 'UTILITY',
                  },
                ],
              }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' } as any;
      });

      const result = await outboundService.sendProactiveTemplate({
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: '+5511999998888',
        templateName: 'rehearsal_reminder',
        templateLanguage: 'pt_BR',
      });

      const conversationCalls = fetchSpy.mock.calls.filter((call: any[]) =>
        String(call[0]).includes('/inbox/conversations')
      );
      expect(conversationCalls.length).toBe(0);
      expect(result.status).toBe('outcome_unknown');
      expect(result.phase).toBe('completed');
      expect(result.outcome_unknown_reason).toContain('EXECUTION_LEASE_EXPIRED');

      // Subsequent attempt still makes ZERO provider calls
      const retryResult = await outboundService.sendProactiveTemplate({
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: '+5511999998888',
        templateName: 'rehearsal_reminder',
        templateLanguage: 'pt_BR',
      });
      expect(fetchSpy.mock.calls.filter((call: any[]) => String(call[0]).includes('/inbox/conversations')).length).toBe(0);
      expect(retryResult.status).toBe('outcome_unknown');
    });

    it('Late original executor: authoritative provider 2xx converges outcome_unknown to accepted', async () => {
      const dispatchId = uniqueId('disp_late_exec');
      const executionId = 'exec_late_original_777';

      await db.collection('whatsapp_outbound_dispatches').doc(dispatchId).set({
        id: dispatchId,
        organization_id: testOrgId,
        ministry_id: testMinistryId,
        connection_id: testConnId,
        provider: 'zernio',
        provider_account_id: testAccountId,
        recipient_e164: '+5511999998888',
        recipient_participant_id: '5511999998888',
        dispatch_kind: 'proactive_template',
        template_name: 'rehearsal_reminder',
        template_language: 'pt_BR',
        request_fingerprint: 'fp_late',
        status: 'outcome_unknown',
        phase: 'completed',
        request_execution_id: executionId,
        outcome_unknown_reason: 'EXECUTION_LEASE_EXPIRED...',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const updated = await outboundRepo.markAccepted(dispatchId, {
        providerMessageId: 'wamid.late.recovered',
        providerConversationId: 'conv_late_recovered',
        executionId,
      });

      expect(updated.status).toBe('accepted');
      expect(updated.phase).toBe('completed');
      expect(updated.provider_message_id).toBe('wamid.late.recovered');
      expect(updated.outcome_unknown_reason).toBeNull();
    });

    it('Proactive send 503: marks outcome_unknown and subsequent retry causes ZERO provider calls', async () => {
      const dispatchId = uniqueId('disp_proactive_503');
      let callCount = 0;

      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('whatsapp/templates')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                templates: [
                  {
                    id: 'tmpl_1',
                    name: 'rehearsal_reminder',
                    language: 'pt_BR',
                    status: 'APPROVED',
                    category: 'UTILITY',
                  },
                ],
              }),
          } as any;
        }
        if (urlStr.includes('inbox/conversations')) {
          callCount++;
          return {
            ok: false,
            status: 503,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                error: {
                  type: 'api_error',
                  message: 'Service Temporarily Unavailable',
                },
              }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' } as any;
      });

      await expect(
        outboundService.sendProactiveTemplate({
          dispatchId,
          ministryId: testMinistryId,
          recipientPhone: '+5511999998888',
          templateName: 'rehearsal_reminder',
          templateLanguage: 'pt_BR',
        })
      ).rejects.toThrow('WHATSAPP_SEND_OUTCOME_UNKNOWN');

      expect(callCount).toBe(1);

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('outcome_unknown');
      expect(dispatch!.phase).toBe('completed');

      const retryResult = await outboundService.sendProactiveTemplate({
        dispatchId,
        ministryId: testMinistryId,
        recipientPhone: '+5511999998888',
        templateName: 'rehearsal_reminder',
        templateLanguage: 'pt_BR',
      });

      expect(callCount).toBe(1);
      expect(retryResult.status).toBe('outcome_unknown');
    });

    it('Existing-conversation send 503: marks outcome_unknown and replay causes ZERO second provider call', async () => {
      const dispatchId = uniqueId('disp_exist_503');
      const conversationId = 'conv_503_test';
      let callCount = 0;

      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('messages')) {
          callCount++;
          return {
            ok: false,
            status: 503,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                error: {
                  type: 'api_error',
                  message: 'Service Unavailable',
                },
              }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' } as any;
      });

      await expect(
        outboundService.sendExistingConversationText({
          dispatchId,
          conversationId,
          ministryId: testMinistryId,
          messageText: 'Mensagem 503',
        })
      ).rejects.toThrow('WHATSAPP_SEND_OUTCOME_UNKNOWN');

      expect(callCount).toBe(1);

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('outcome_unknown');

      const replay = await outboundService.sendExistingConversationText({
        dispatchId,
        conversationId,
        ministryId: testMinistryId,
        messageText: 'Mensagem 503',
      });

      expect(callCount).toBe(1);
      expect(replay.status).toBe('outcome_unknown');
    });

    it('Existing-conversation provider 409: idempotency in-flight marks outcome_unknown and does NOT mark failed', async () => {
      const dispatchId = uniqueId('disp_exist_409');
      const conversationId = 'conv_409_test';

      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('messages')) {
          return {
            ok: false,
            status: 409,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                error: {
                  type: 'conflict_error',
                  message: 'A request with this idempotency key is currently being processed.',
                },
              }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' } as any;
      });

      await expect(
        outboundService.sendExistingConversationText({
          dispatchId,
          conversationId,
          ministryId: testMinistryId,
          messageText: 'Mensagem 409',
        })
      ).rejects.toThrow('WHATSAPP_DISPATCH_PROVIDER_IN_FLIGHT');

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('outcome_unknown');
      expect(dispatch!.status).not.toBe('failed');
    });

    it('Existing-conversation provider 500: marks outcome_unknown and replay causes ZERO second provider call', async () => {
      const dispatchId = uniqueId('disp_exist_500');
      const conversationId = 'conv_500_test';
      let callCount = 0;

      fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (url: any) => {
        const urlStr = String(url);
        if (urlStr.includes('messages')) {
          callCount++;
          return {
            ok: false,
            status: 500,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                error: {
                  type: 'api_error',
                  message: 'Internal Server Error',
                },
              }),
          } as any;
        }
        return { ok: false, status: 404, headers: new Headers(), text: async () => '{}' } as any;
      });

      await expect(
        outboundService.sendExistingConversationText({
          dispatchId,
          conversationId,
          ministryId: testMinistryId,
          messageText: 'Mensagem 500',
        })
      ).rejects.toThrow('WHATSAPP_SEND_OUTCOME_UNKNOWN');

      expect(callCount).toBe(1);

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.status).toBe('outcome_unknown');

      const replay = await outboundService.sendExistingConversationText({
        dispatchId,
        conversationId,
        ministryId: testMinistryId,
        messageText: 'Mensagem 500',
      });

      expect(callCount).toBe(1);
      expect(replay.status).toBe('outcome_unknown');
    });

    it('Cross-tenant dispatch ID replay: rejected with 403 and zero provider calls', async () => {
      const dispatchId = uniqueId('disp_cross_tenant_test');
      const otherOrgId = uniqueId('org_other');

      await db.collection('whatsapp_outbound_dispatches').doc(dispatchId).set({
        id: dispatchId,
        organization_id: testOrgId,
        ministry_id: testMinistryId,
        connection_id: testConnId,
        provider: 'zernio',
        provider_account_id: testAccountId,
        recipient_e164: '+5511999998888',
        recipient_participant_id: '5511999998888',
        dispatch_kind: 'proactive_template',
        template_name: 'rehearsal_reminder',
        template_language: 'pt_BR',
        request_fingerprint: 'fp_org_a',
        status: 'accepted',
        phase: 'completed',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      fetchSpy = vi.spyOn(global, 'fetch');

      await expect(
        outboundRepo.prepareDispatch({
          id: dispatchId,
          organizationId: otherOrgId,
          connectionId: 'conn_other',
          providerAccountId: 'acc_other',
          recipientE164: '+5511999998888',
          recipientParticipantId: '5511999998888',
          dispatchKind: 'proactive_template',
          requestFingerprint: 'fp_org_a',
        })
      ).rejects.toThrow('FORBIDDEN_DISPATCH_TENANT_MISMATCH');

      const dispatch = await outboundRepo.getDispatchById(dispatchId);
      expect(dispatch!.organization_id).toBe(testOrgId);
      expect(dispatch!.status).toBe('accepted');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('Ambiguous account lookup: two connections with same provider_account_id fails closed with 500', async () => {
      const duplicateAccountId = uniqueId('acc_ambiguous');
      const conn1Id = uniqueId('conn_amb_1');
      const conn2Id = uniqueId('conn_amb_2');

      await db.collection('whatsapp_connections').doc(conn1Id).set({
        id: conn1Id,
        organization_id: testOrgId,
        provider: 'zernio',
        provider_account_id: duplicateAccountId,
        status: 'connected',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await db.collection('whatsapp_connections').doc(conn2Id).set({
        id: conn2Id,
        organization_id: testOrgId,
        provider: 'zernio',
        provider_account_id: duplicateAccountId,
        status: 'connected',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await expect(
        connectionRepo.findByZernioAccountId(duplicateAccountId)
      ).rejects.toThrow('AMBIGUOUS_ZERNIO_ACCOUNT_MAPPING');
    });

    it('Unknown provider message webhook: creates shadow only, outbound_dispatch_id null, zero fake dispatches', async () => {
      const unknownMsgId = 'wamid.unknown.' + Date.now();

      const deliveredEvent = {
        id: uniqueId('evt_unknown_msg'),
        event: 'message.delivered',
        data: {
          accountId: testAccountId,
          messageId: unknownMsgId,
          timestamp: new Date().toISOString(),
        },
      };
      const deliveredBody = JSON.stringify(deliveredEvent);

      const response = await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(deliveredBody, 'utf8'),
        signature: signPayload(deliveredBody),
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toBe('processed');

      const shadow = await outboundRepo.getProviderMessageShadow(
        buildZernioProviderMessageDocId(unknownMsgId)
      );
      expect(shadow).not.toBeNull();
      expect(shadow!.outbound_dispatch_id).toBeNull();
      expect(shadow!.status).toBe('delivered');
    });

    it('Out-of-order: read -> delivered -> sent preserves status=read', async () => {
      const providerMsgId = 'wamid.ooo.read.deliv.sent.' + Date.now();
      const shadowDocId = buildZernioProviderMessageDocId(providerMsgId);

      // 1. read arrives first
      const readEvent = {
        id: uniqueId('evt_read_first'),
        event: 'message.read',
        data: { accountId: testAccountId, messageId: providerMsgId, timestamp: new Date().toISOString() },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(readEvent), 'utf8'),
        signature: signPayload(JSON.stringify(readEvent)),
      });
      let shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('read');

      // 2. delivered arrives second
      const delivEvent = {
        id: uniqueId('evt_deliv_second'),
        event: 'message.delivered',
        data: { accountId: testAccountId, messageId: providerMsgId, timestamp: new Date().toISOString() },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(delivEvent), 'utf8'),
        signature: signPayload(JSON.stringify(delivEvent)),
      });
      shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('read');
      expect(shadow!.delivered_at).not.toBeNull();

      // 3. sent arrives third
      const sentEvent = {
        id: uniqueId('evt_sent_third'),
        event: 'message.sent',
        data: { accountId: testAccountId, messageId: providerMsgId, timestamp: new Date().toISOString() },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(sentEvent), 'utf8'),
        signature: signPayload(JSON.stringify(sentEvent)),
      });
      shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('read');
      expect(shadow!.sent_at).not.toBeNull();
    });

    it('Out-of-order: delivered -> sent preserves status=delivered', async () => {
      const providerMsgId = 'wamid.ooo.deliv.sent.' + Date.now();
      const shadowDocId = buildZernioProviderMessageDocId(providerMsgId);

      // 1. delivered arrives first
      const delivEvent = {
        id: uniqueId('evt_deliv_1'),
        event: 'message.delivered',
        data: { accountId: testAccountId, messageId: providerMsgId, timestamp: new Date().toISOString() },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(delivEvent), 'utf8'),
        signature: signPayload(JSON.stringify(delivEvent)),
      });
      let shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('delivered');

      // 2. sent arrives second
      const sentEvent = {
        id: uniqueId('evt_sent_2'),
        event: 'message.sent',
        data: { accountId: testAccountId, messageId: providerMsgId, timestamp: new Date().toISOString() },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(sentEvent), 'utf8'),
        signature: signPayload(JSON.stringify(sentEvent)),
      });
      shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('delivered');
    });

    it('Out-of-order: read -> failed preserves status=read and records failure diagnostics', async () => {
      const providerMsgId = 'wamid.ooo.read.failed.' + Date.now();
      const shadowDocId = buildZernioProviderMessageDocId(providerMsgId);

      // 1. read arrives first
      const readEvent = {
        id: uniqueId('evt_read_1'),
        event: 'message.read',
        data: { accountId: testAccountId, messageId: providerMsgId, timestamp: new Date().toISOString() },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(readEvent), 'utf8'),
        signature: signPayload(JSON.stringify(readEvent)),
      });
      let shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('read');

      // 2. stale message.failed arrives later
      const failEvent = {
        id: uniqueId('evt_fail_stale'),
        event: 'message.failed',
        data: {
          accountId: testAccountId,
          messageId: providerMsgId,
          error: { code: '131026', message: 'Undeliverable' },
          timestamp: new Date().toISOString(),
        },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(failEvent), 'utf8'),
        signature: signPayload(JSON.stringify(failEvent)),
      });
      shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('read');
      expect(shadow!.failure_code).toBe('131026');
    });

    it('Out-of-order: delivered -> failed preserves status=delivered and records failure diagnostics', async () => {
      const providerMsgId = 'wamid.ooo.deliv.failed.' + Date.now();
      const shadowDocId = buildZernioProviderMessageDocId(providerMsgId);

      // 1. delivered arrives first
      const delivEvent = {
        id: uniqueId('evt_deliv_1'),
        event: 'message.delivered',
        data: { accountId: testAccountId, messageId: providerMsgId, timestamp: new Date().toISOString() },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(delivEvent), 'utf8'),
        signature: signPayload(JSON.stringify(delivEvent)),
      });
      let shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('delivered');

      // 2. stale message.failed arrives later
      const failEvent = {
        id: uniqueId('evt_fail_stale_deliv'),
        event: 'message.failed',
        data: {
          accountId: testAccountId,
          messageId: providerMsgId,
          error: { code: '131026', message: 'Undeliverable' },
          timestamp: new Date().toISOString(),
        },
      };
      await connectionService.handleZernioWebhook({
        rawBody: Buffer.from(JSON.stringify(failEvent), 'utf8'),
        signature: signPayload(JSON.stringify(failEvent)),
      });
      shadow = await outboundRepo.getProviderMessageShadow(shadowDocId);
      expect(shadow!.status).toBe('delivered');
      expect(shadow!.failure_code).toBe('131026');
    });
  });
});
