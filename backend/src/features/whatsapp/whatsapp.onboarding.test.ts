import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppMinistryAssignmentClaimRepository } from '../../repositories/WhatsAppMinistryAssignmentClaimRepository';
import { WhatsAppOnboardingSessionRepository } from '../../repositories/WhatsAppOnboardingSessionRepository';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import {
  WhatsAppProvider,
  WhatsAppOAuthResult,
  WhatsAppAuthorizedPhoneNumber,
  WhatsAppPhoneNumberDetails,
  WhatsAppConnectionRecord,
  getClaimId,
} from './whatsapp.types';
import { OrganizationRecord, OrganizationMemberRecord } from '../organizations/organization.types';
import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';

describe('WhatsApp Onboarding, Sessions & Credential Acquisition Suite (Phase 7D1)', () => {
  let organizationsStore: Map<string, OrganizationRecord>;
  let orgMembersStore: Map<string, OrganizationMemberRecord>;
  let subscriptionsStore: Map<string, any>;
  let connectionsStore: Map<string, WhatsAppConnectionRecord>;
  let sessionsStore: Map<string, any>;
  let secretsStore: Map<string, any>;
  let claimsStore: Map<string, any>;
  let ministriesStore: Map<string, any>;

  let mockProvider: WhatsAppProvider;
  let encryptionService: WhatsAppEncryptionService;
  let connectionRepo: WhatsAppConnectionRepository;
  let connectionService: WhatsAppConnectionService;
  let controller: WhatsAppController;

  const validKey = crypto.randomBytes(32).toString('base64');
  const orgId = 'org-test-onboard';
  const anchorMinistryId = 'min-anchor-onboard';
  const ownerUserId = 'user-owner';
  const adminUserId = 'user-admin';
  const memberUserId = 'user-member';
  const outsiderUserId = 'user-outsider';

  beforeEach(() => {
    vi.clearAllMocks();

    process.env.META_APP_ID = 'test-meta-app-id';
    process.env.META_APP_SECRET = 'test-meta-app-secret';
    process.env.META_CONFIG_ID = 'test-config-id';

    organizationsStore = new Map();
    orgMembersStore = new Map();
    subscriptionsStore = new Map();
    ministriesStore = new Map();
    connectionsStore = new Map();
    sessionsStore = new Map();
    secretsStore = new Map();
    claimsStore = new Map();

    const now = new Date().toISOString();

    ministriesStore.set(anchorMinistryId, {
      id: anchorMinistryId,
      name: 'Anchor Ministry',
      organization_id: orgId,
      created_at: now,
      updated_at: now,
    });

    // 1. Organization
    organizationsStore.set(orgId, {
      id: orgId,
      name: 'Igreja Onboarding',
      slug: 'igreja-onboarding',
      owner_user_id: ownerUserId,
      billing_anchor_ministry_id: anchorMinistryId,
      default_whatsapp_connection_id: null,
      created_at: now,
      updated_at: now,
    });

    // 2. Org Memberships
    orgMembersStore.set(`${orgId}_${ownerUserId}`, {
      id: `${orgId}_${ownerUserId}`,
      organization_id: orgId,
      user_id: ownerUserId,
      role: 'owner',
      invited_by_user_id: null,
      created_at: now,
      updated_at: now,
    });

    orgMembersStore.set(`${orgId}_${adminUserId}`, {
      id: `${orgId}_${adminUserId}`,
      organization_id: orgId,
      user_id: adminUserId,
      role: 'admin',
      invited_by_user_id: ownerUserId,
      created_at: now,
      updated_at: now,
    });

    orgMembersStore.set(`${orgId}_${memberUserId}`, {
      id: `${orgId}_${memberUserId}`,
      organization_id: orgId,
      user_id: memberUserId,
      role: 'member' as any,
      invited_by_user_id: ownerUserId,
      created_at: now,
      updated_at: now,
    });

    // 3. Subscription (Premium plan -> 1 included connection)
    subscriptionsStore.set(anchorMinistryId, {
      id: anchorMinistryId,
      ministry_id: anchorMinistryId,
      plan_id: 'premium',
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'paid',
      created_at: now,
      updated_at: now,
    });

    // 4. Mock Firestore
    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      const getStore = () => {
        switch (colName) {
          case 'organizations':
            return organizationsStore;
          case 'organization_members':
            return orgMembersStore;
          case 'ministry_subscriptions':
            return subscriptionsStore;
          case 'ministries':
            return ministriesStore;
          case 'whatsapp_connections':
            return connectionsStore;
          case 'whatsapp_onboarding_sessions':
            return sessionsStore;
          case 'whatsapp_connection_secrets':
            return secretsStore;
          case 'whatsapp_provider_identity_claims':
            return claimsStore;
          default:
            return new Map();
        }
      };

      return {
        doc: (id: string) => ({
          id,
          get: vi.fn().mockImplementation(async () => {
            const store = getStore();
            const data = store.get(id);
            return {
              exists: Boolean(data),
              id,
              data: () => data,
            };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            const store = getStore();
            store.set(id, { id, ...data });
          }),
          update: vi.fn().mockImplementation(async (data: any) => {
            const store = getStore();
            const current = store.get(id) || {};
            store.set(id, { ...current, ...data });
          }),
          delete: vi.fn().mockImplementation(async () => {
            const store = getStore();
            store.delete(id);
          }),
        }),
        where: vi.fn().mockImplementation((field: string, op: string, val: any) => {
          let filters: Array<{ field: string; op: string; val: any }> = [{ field, op, val }];
          const queryObj: any = {
            where: vi.fn().mockImplementation((f2: string, op2: string, v2: any) => {
              filters.push({ field: f2, op: op2, val: v2 });
              return queryObj;
            }),
            limit: vi.fn().mockImplementation(() => queryObj),
            get: vi.fn().mockImplementation(async () => {
              const store = getStore();
              let items = Array.from(store.values()).filter((item: any) =>
                filters.every((f) => {
                  if (f.op === '==') return item[f.field] === f.val;
                  if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(item[f.field]);
                  return true;
                })
              );
              return {
                docs: items.map((d: any) => ({
                  id: d.id,
                  ref: {
                    id: d.id,
                    update: vi.fn().mockImplementation(async (up: any) => {
                      const current = store.get(d.id) || {};
                      store.set(d.id, { ...current, ...up });
                    }),
                  },
                  data: () => d,
                })),
                size: items.length,
                empty: items.length === 0,
              };
            }),
          };
          return queryObj;
        }),
      };
    });

    vi.spyOn(db, 'runTransaction').mockImplementation(async (callback: any) => {
      const tx: any = {
        get: vi.fn().mockImplementation(async (ref: any) => {
          if (ref.get) {
            return ref.get();
          }
          return { exists: false, data: () => null };
        }),
        set: vi.fn().mockImplementation((ref: any, data: any) => {
          if (ref.id) {
            // Find store
            for (const store of [organizationsStore, connectionsStore, sessionsStore, secretsStore, claimsStore]) {
              if (ref.id.startsWith('wac_') || ref.id.startsWith('wabs_') || ref.id.startsWith('claim_')) {
                // matching target
              }
            }
            if (ref.id.startsWith('wac_')) connectionsStore.set(ref.id, { id: ref.id, ...data });
            else if (ref.id.startsWith('wabs_')) sessionsStore.set(ref.id, { id: ref.id, ...data });
            else if (ref.id.startsWith('claim_')) claimsStore.set(ref.id, { id: ref.id, ...data });
            else if (ref.id.startsWith('org-')) organizationsStore.set(ref.id, { id: ref.id, ...data });
          }
        }),
        update: vi.fn().mockImplementation((ref: any, data: any) => {
          if (ref.id) {
            if (ref.id.startsWith('wac_')) {
              const cur = connectionsStore.get(ref.id) || ({} as any);
              connectionsStore.set(ref.id, { ...cur, ...data });
            } else if (ref.id.startsWith('wabs_')) {
              const cur = sessionsStore.get(ref.id) || ({} as any);
              sessionsStore.set(ref.id, { ...cur, ...data });
            } else if (ref.id.startsWith('org-')) {
              const cur = organizationsStore.get(ref.id) || ({} as any);
              organizationsStore.set(ref.id, { ...cur, ...data });
            }
          }
        }),
        delete: vi.fn().mockImplementation((ref: any) => {
          if (ref.id) {
            if (ref.id.startsWith('claim_')) claimsStore.delete(ref.id);
            if (ref.id.startsWith('wac_')) secretsStore.delete(ref.id);
          }
        }),
      };
      return await callback(tx);
    });

    // 5. Mock Provider
    mockProvider = {
      exchangeOAuthCode: vi.fn().mockResolvedValue({
        accessToken: 'EAAG_mock_business_token_123',
        tokenType: 'business_token',
        expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
      }),
      verifyMessagingAccountAccess: vi.fn().mockResolvedValue(true),
      listAuthorizedPhoneNumbers: vi.fn().mockResolvedValue([
        {
          id: 'phone-001',
          displayPhoneNumber: '+55 11 98888-7771',
          verifiedName: 'LouvAIO Ministério',
        },
      ]),
      getPhoneNumberDetails: vi.fn().mockResolvedValue({
        displayPhoneNumber: '+55 11 98888-7771',
        verifiedName: 'LouvAIO Ministério',
        qualityRating: 'GREEN',
        messagingLimitTier: 'TIER_10K',
      }),
      registerPhoneNumber: vi.fn().mockResolvedValue(undefined),
      subscribeMessagingAccountApps: vi.fn().mockResolvedValue(undefined),
      unsubscribeMessagingAccountApps: vi.fn().mockResolvedValue({ success: true }),
      checkMessagingAccountSubscribedApps: vi.fn().mockResolvedValue({
        status: 'PROVEN_SUBSCRIBED',
        appId: '1234567890',
        pagesTraversed: 1,
        totalAppsObserved: 1,
      }),
    };

    encryptionService = new WhatsAppEncryptionService(validKey);

    connectionRepo = new WhatsAppConnectionRepository();
    connectionService = new WhatsAppConnectionService(
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppProviderIdentityClaimRepository(),
      new OrganizationRepository(),
      new SubscriptionService(),
      new MinistryRepository(),
      new WhatsAppMinistryAssignmentClaimRepository(),
      new WhatsAppOnboardingSessionRepository(),
      mockProvider,
      encryptionService
    );

    controller = new WhatsAppController(connectionService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /onboarding/start (Capacity reservation, session allocation & CSRF nonce)', () => {
    it('rejects non-admin/non-owner member with 403', async () => {
      await expect(
        connectionService.startOnboarding(orgId, memberUserId, {})
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rejects unknown organization with 404', async () => {
      await expect(
        connectionService.startOnboarding('unknown-org', adminUserId, {})
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('rejects if organization subscription has 0 allowed connections (Free plan) with 403', async () => {
      subscriptionsStore.set(anchorMinistryId, {
        id: anchorMinistryId,
        ministry_id: anchorMinistryId,
        plan_id: 'free',
        billing_status: 'active',
        subscription_mode: 'free',
      });

      await expect(
        connectionService.startOnboarding(orgId, adminUserId, {})
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });
    });

    it('successfully creates pending connection and 15m session, returning raw nonce strictly once', async () => {
      const res = await connectionService.startOnboarding(orgId, adminUserId, {
        displayName: 'Linha Culto Principal',
      });

      expect(res.sessionId).toBeDefined();
      expect(res.connectionId).toBeDefined();
      expect(res.stateNonce).toBeDefined();
      expect(res.stateNonce!.length).toBe(64); // 32 bytes hex
      expect(res.expiresAt).toBeDefined();

      // Check pending connection in store
      const conn = connectionsStore.get(res.connectionId);
      expect(conn).toBeDefined();
      expect(conn?.status).toBe('pending');
      expect(conn?.display_name).toBe('Linha Culto Principal');
      expect(conn?.provider).toBe('meta_cloud_api');
      expect(conn?.pending_expires_at).toBeDefined();

      // Check session in store
      const session = sessionsStore.get(res.sessionId);
      expect(session).toBeDefined();
      expect(session?.status).toBe('active');
      expect(session?.connection_id).toBe(res.connectionId);
      expect(session?.organization_id).toBe(orgId);
      expect(session?.actor_user_id).toBe(adminUserId);

      // Verify SHA-256 state_nonce_hash
      const expectedHash = crypto.createHash('sha256').update(res.stateNonce!).digest('hex');
      expect(session?.state_nonce_hash).toBe(expectedHash);
    });

    it('aborts with 403 WHATSAPP_CAPACITY_LIMIT_REACHED when active connections meet plan limit', async () => {
      // Premium plan allows 1 connection. Pre-occupy it:
      connectionsStore.set('wac_existing', {
        id: 'wac_existing',
        organization_id: orgId,
        display_name: 'Existing Line',
        status: 'connected',
        phone_number: '+5511999990000',
        provider: 'meta_cloud_api',
        provider_waba_id: 'waba-1',
        provider_phone_number_id: 'phone-1',
        created_by_user_id: ownerUserId,
        assigned_ministry_id: null,
        pending_expires_at: null,
        last_connected_at: new Date().toISOString(),
        last_health_check_at: null,
        status_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await expect(
        connectionService.startOnboarding(orgId, adminUserId, {})
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });
    });

    it('lazy cleanup: expired pending connection is transitioned to disconnected and releases capacity', async () => {
      const past = new Date(Date.now() - 3600 * 1000).toISOString();
      connectionsStore.set('wac_expired_pending', {
        id: 'wac_expired_pending',
        organization_id: orgId,
        display_name: 'Expired Pending Line',
        status: 'pending',
        phone_number: null,
        provider: 'meta_cloud_api',
        provider_waba_id: null,
        provider_phone_number_id: null,
        created_by_user_id: ownerUserId,
        assigned_ministry_id: null,
        pending_expires_at: past,
        last_connected_at: null,
        last_health_check_at: null,
        status_reason: null,
        created_at: past,
        updated_at: past,
      });

      // Should succeed because expired pending connection is lazily disconnected
      const res = await connectionService.startOnboarding(orgId, adminUserId, {});
      expect(res.connectionId).toBeDefined();

      const oldConn = connectionsStore.get('wac_expired_pending');
      expect(oldConn?.status).toBe('disconnected');
      expect(oldConn?.status_reason).toBe('PENDING_EXPIRED');
      expect(oldConn?.pending_expires_at).toBeNull();

      const newConn = connectionsStore.get(res.connectionId);
      expect(newConn?.status).toBe('pending');

      // Check capacity consistency (Section 8 & 9)
      const configuredCount = await connectionRepo.countConfiguredConnections(orgId);
      expect(configuredCount).toBe(1);

      const capacityUsage = await connectionService.getOrganizationCapacityUsage(orgId);
      expect(capacityUsage.configuredConnectionsCount).toBe(1);
      expect(capacityUsage.totalAllowedConnections).toBe(1);
      expect(capacityUsage.connectionAccessMode).toBe('normal');

      // A second start attempt before the new pending expires must be rejected as full capacity
      await expect(
        connectionService.startOnboarding(orgId, adminUserId, {})
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });
    });

    it('Grace Start Matrix: rejects start with 403 when organization is in grace mode even with available slot', async () => {
      subscriptionsStore.set(anchorMinistryId, {
        id: anchorMinistryId,
        ministry_id: anchorMinistryId,
        plan_id: 'premium',
        billing_status: 'past_due',
        subscription_mode: 'paid',
        grace_period_expires_billing_date: '2099-12-31',
      });

      await expect(
        connectionService.startOnboarding(orgId, adminUserId, {})
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });
    });

    it('Grace Start Matrix: rejects start with 403 when subscription is suspended', async () => {
      subscriptionsStore.set(anchorMinistryId, {
        id: anchorMinistryId,
        ministry_id: anchorMinistryId,
        plan_id: 'premium',
        billing_status: 'canceled',
        subscription_mode: 'paid',
        administratively_suspended: true,
      });

      await expect(
        connectionService.startOnboarding(orgId, adminUserId, {})
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });
    });
  });

  describe('POST /onboarding/complete (13-step Credential Staging Saga & Failure Matrix)', () => {
    let activeSessionId: string;
    let activeConnectionId: string;
    let activeRawNonce: string;

    beforeEach(async () => {
      const started = await connectionService.startOnboarding(orgId, adminUserId, {
        displayName: 'Linha para Completar',
      });
      activeSessionId = started.sessionId;
      activeConnectionId = started.connectionId;
      activeRawNonce = started.stateNonce!;
    });

    it('Case 1: Session not found or expired fails with 400 ONBOARDING_SESSION_EXPIRED', async () => {
      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: 'wabs_non_existent',
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'ONBOARDING_SESSION_EXPIRED' },
      });
    });

    it('Case 1B: Session expired by timestamp transitions session to expired, disconnects pending connection, and releases capacity', async () => {
      const past = new Date(Date.now() - 3600 * 1000).toISOString();
      const session = sessionsStore.get(activeSessionId);
      session.expires_at = past;
      sessionsStore.set(activeSessionId, session);

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'ONBOARDING_SESSION_EXPIRED' },
      });

      expect(sessionsStore.get(activeSessionId)?.status).toBe('expired');
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('disconnected');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('ONBOARDING_SESSION_EXPIRED');
      expect(connectionsStore.get(activeConnectionId)?.pending_expires_at).toBeNull();

      const configuredCount = await connectionRepo.countConfiguredConnections(orgId);
      expect(configuredCount).toBe(0);

      // Immediately start onboarding again -> SUCCESS!
      const restarted = await connectionService.startOnboarding(orgId, adminUserId, {});
      expect(restarted.connectionId).toBeDefined();
    });

    it('Replay protection: Re-submitting already consumed session fails with 409 ONBOARDING_SESSION_ALREADY_CONSUMED', async () => {
      const session = sessionsStore.get(activeSessionId);
      session.status = 'consumed';
      sessionsStore.set(activeSessionId, session);

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'ONBOARDING_SESSION_ALREADY_CONSUMED' },
      });
    });

    it('Case 2: CSRF Nonce mismatch marks session failed, disconnects pending connection, and releases capacity', async () => {
      const wrongNonce = crypto.randomBytes(32).toString('hex');

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: wrongNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'INVALID_ONBOARDING_STATE' },
      });

      expect(sessionsStore.get(activeSessionId)?.status).toBe('failed');
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('disconnected');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('INVALID_ONBOARDING_STATE');
      expect(connectionsStore.get(activeConnectionId)?.pending_expires_at).toBeNull();

      const configuredCount = await connectionRepo.countConfiguredConnections(orgId);
      expect(configuredCount).toBe(0);

      // Immediately start onboarding again -> SUCCESS!
      const restarted = await connectionService.startOnboarding(orgId, adminUserId, {});
      expect(restarted.connectionId).toBeDefined();
    });

    it('Case 3: Downgrade race (subscription suspended) transitions connection to disconnected and aborts with 403', async () => {
      subscriptionsStore.set(anchorMinistryId, {
        id: anchorMinistryId,
        ministry_id: anchorMinistryId,
        plan_id: 'premium',
        billing_status: 'canceled',
        subscription_mode: 'paid',
        administratively_suspended: true,
      });

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED' },
      });

      expect(connectionsStore.get(activeConnectionId)?.status).toBe('disconnected');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      expect(sessionsStore.get(activeSessionId)?.status).toBe('failed');
    });

    it('Grace Completion: start in normal -> reservation exists -> subscription enters grace -> complete succeeds', async () => {
      subscriptionsStore.set(anchorMinistryId, {
        id: anchorMinistryId,
        ministry_id: anchorMinistryId,
        plan_id: 'premium',
        billing_status: 'past_due',
        subscription_mode: 'paid',
        grace_period_expires_billing_date: '2099-12-31',
      });

      const res = await connectionService.completeOnboarding(orgId, adminUserId, {
        sessionId: activeSessionId,
        stateNonce: activeRawNonce,
        code: 'valid_code',
        wabaId: 'waba-001',
        phoneNumberId: 'phone-001',
      });

      expect(res.id).toBe(activeConnectionId);
      expect(res.status).toBe('connected');
      expect(res.phoneNumber).toBe('+5511988887771');
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('connected');
      expect(sessionsStore.get(activeSessionId)?.status).toBe('consumed');
      expect(secretsStore.get(activeConnectionId)).toBeDefined();
      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalled();
    });

    it('Entitlement Race: downgrade between start and commit rejects completion with 403, acquires zero claims and purges secret', async () => {
      // Pre-occupy 1 connection so configured total becomes 2, exceeding Premium capacity of 1
      connectionsStore.set('wac_conn_1', {
        id: 'wac_conn_1',
        organization_id: orgId,
        display_name: 'Existing Line 1',
        status: 'connected',
        phone_number: '+5511999990001',
        provider: 'meta_cloud_api',
        provider_waba_id: 'waba-001',
        provider_phone_number_id: 'phone-existing-1',
        created_by_user_id: ownerUserId,
        assigned_ministry_id: null,
        pending_expires_at: null,
        last_connected_at: new Date().toISOString(),
        last_health_check_at: null,
        status_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });

      // Assert G: No claim was acquired
      const claimId = getClaimId('meta_cloud_api', 'phone-001');
      expect(claimsStore.get(claimId)).toBeUndefined();

      // Assert H: No secret was persisted / staged secret was purged
      expect(secretsStore.get(activeConnectionId)).toBeUndefined();

      // Assert I: Connection did not become connected
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('disconnected');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('SUBSCRIPTION_RESTRICTED');

      // Assert J: Session did not become consumed
      expect(sessionsStore.get(activeSessionId)?.status).toBe('failed');

      // Assert K (Phase 7D2-D8-R5): 0 provider calls were made before Step 4/8/9
      expect(mockProvider.exchangeOAuthCode).not.toHaveBeenCalled();
      expect(mockProvider.registerPhoneNumber).not.toHaveBeenCalled();
      expect(mockProvider.subscribeMessagingAccountApps).not.toHaveBeenCalled();
    });

    it('Case 4: OAuth code exchange failure marks session failed, disconnects pending connection, and releases capacity', async () => {
      (mockProvider.exchangeOAuthCode as any).mockRejectedValueOnce(new Error('Invalid code'));

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'bad_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'WHATSAPP_OAUTH_EXCHANGE_FAILED' },
      });

      expect(sessionsStore.get(activeSessionId)?.status).toBe('failed');
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('disconnected');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('OAUTH_EXCHANGE_FAILED');
      expect(connectionsStore.get(activeConnectionId)?.pending_expires_at).toBeNull();

      const configuredCount = await connectionRepo.countConfiguredConnections(orgId);
      expect(configuredCount).toBe(0);

      // Immediately start onboarding again -> SUCCESS!
      const restarted = await connectionService.startOnboarding(orgId, adminUserId, {});
      expect(restarted.connectionId).toBeDefined();
    });

    it('Case 5: WABA authority mismatch purges staged secret, marks connection error UNAUTHORIZED_WABA_ACCESS', async () => {
      (mockProvider.verifyMessagingAccountAccess as any).mockResolvedValueOnce(false);

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'untrusted-waba-999',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'UNAUTHORIZED_WABA_ACCESS' },
      });

      // Crucial: Secret must be PURGED so no orphan encrypted token remains
      expect(secretsStore.get(activeConnectionId)).toBeUndefined();
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('error');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('UNAUTHORIZED_WABA_ACCESS');
      expect(sessionsStore.get(activeSessionId)?.status).toBe('failed');
    });

    it('Case 6: Phone not in WABA edge check purges staged secret, marks connection error PHONE_NOT_IN_WABA', async () => {
      // Mock returns phone-001, but client requested phone-999
      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-999',
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'PHONE_NOT_IN_WABA' },
      });

      expect(secretsStore.get(activeConnectionId)).toBeUndefined();
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('error');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('PHONE_NOT_IN_WABA');
      expect(sessionsStore.get(activeSessionId)?.status).toBe('failed');
    });

    it('Case 7: Registration PIN failure RETAINS staged secret and allows retry', async () => {
      (mockProvider.registerPhoneNumber as any).mockRejectedValueOnce(
        new AppError(502, 'PIN error', { code: 'PROVIDER_REGISTRATION_FAILED' })
      );

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
          pin: '123456',
        })
      ).rejects.toMatchObject({
        statusCode: 502,
        details: { code: 'PROVIDER_REGISTRATION_FAILED' },
      });

      // Secret is retained for retry!
      expect(secretsStore.get(activeConnectionId)).toBeDefined();
      expect(sessionsStore.get(activeSessionId)?.status).toBe('credential_staged');
    });

    it('Case 8: Webhook subscription failure RETAINS staged secret and allows retry', async () => {
      (mockProvider.subscribeMessagingAccountApps as any).mockRejectedValueOnce(
        new AppError(502, 'Sub error', {
          code: 'PROVIDER_SUBSCRIPTION_FAILED',
          providerRejection: true,
        })
      );

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 502,
        details: { code: 'PROVIDER_SUBSCRIPTION_FAILED' },
      });

      expect(secretsStore.get(activeConnectionId)).toBeDefined();
      expect(sessionsStore.get(activeSessionId)?.status).toBe('credential_staged');
    });

    it('Safe Retry: After Case 8 failure, retry decrypts staged token without burning OAuth code', async () => {
      // First attempt fails at webhook subscription (authoritative provider rejection)
      (mockProvider.subscribeMessagingAccountApps as any).mockRejectedValueOnce(
        new AppError(502, 'Sub error', {
          code: 'PROVIDER_SUBSCRIPTION_FAILED',
          providerRejection: true,
        })
      );

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'single_use_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toThrow();

      expect(sessionsStore.get(activeSessionId)?.status).toBe('credential_staged');
      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalledTimes(1);

      // Second attempt (retry)
      (mockProvider.subscribeMessagingAccountApps as any).mockResolvedValueOnce(undefined);

      const result = await connectionService.completeOnboarding(orgId, adminUserId, {
        sessionId: activeSessionId,
        stateNonce: activeRawNonce,
        code: 'already_used_code', // should NOT be exchanged again!
        wabaId: 'waba-001',
        phoneNumberId: 'phone-001',
      });

      expect(result.status).toBe('connected');
      // Verify exchangeOAuthCode was NOT called a second time
      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
    });

    it('Case 9: Claim collision in transaction purges staged secret, marks connection error', async () => {
      // Pre-claim phone-001 by another connection
      const claimId = getClaimId('meta_cloud_api', 'phone-001');
      claimsStore.set(claimId, {
        id: claimId,
        provider: 'meta_cloud_api',
        provider_phone_number_id: 'phone-001',
        organization_id: 'other-org',
        connection_id: 'other-conn',
      });

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'PROVIDER_PHONE_ALREADY_REGISTERED' },
      });

      expect(secretsStore.get(activeConnectionId)).toBeUndefined();
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('error');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('PHONE_ALREADY_REGISTERED');
      expect(sessionsStore.get(activeSessionId)?.status).toBe('failed');
    });

    it('Happy Path: Complete onboarding materializes connection, claim, stages secret, consumes session', async () => {
      const result = await connectionService.completeOnboarding(orgId, adminUserId, {
        sessionId: activeSessionId,
        stateNonce: activeRawNonce,
        code: 'valid_single_use_code',
        wabaId: 'waba-001',
        phoneNumberId: 'phone-001',
        pin: '123456',
      });

      expect(result.id).toBe(activeConnectionId);
      expect(result.status).toBe('connected');
      expect(result.phoneNumber).toBe('+5511988887771'); // canonical E.164
      expect(result.organizationId).toBe(orgId);

      // Verify connection in store
      const conn = connectionsStore.get(activeConnectionId);
      expect(conn?.status).toBe('connected');
      expect(conn?.phone_number).toBe('+5511988887771');
      expect(conn?.provider_waba_id).toBe('waba-001');
      expect(conn?.provider_phone_number_id).toBe('phone-001');
      expect(conn?.pending_expires_at).toBeNull();
      expect(conn?.last_connected_at).toBeDefined();

      // Verify session is consumed
      const session = sessionsStore.get(activeSessionId);
      expect(session?.status).toBe('consumed');
      expect(session?.consumed_at).toBeDefined();

      // Verify secret is staged with token_type business_token
      const secret = secretsStore.get(activeConnectionId);
      expect(secret).toBeDefined();
      expect(secret?.token_type).toBe('business_token');
      expect(secret?.encrypted_access_token).toBeDefined();

      // Verify claim is acquired
      const claimId = getClaimId('meta_cloud_api', 'phone-001');
      const claim = claimsStore.get(claimId);
      expect(claim).toBeDefined();
      expect(claim?.connection_id).toBe(activeConnectionId);
      expect(claim?.organization_id).toBe(orgId);
    });

    it('Step 10 Commercial Restriction: Meta registration and webhook subscription succeed, commercial restriction occurs -> secret retained, connection connecting, session waba_subscribed, resumption succeeds after plan upgrade', async () => {
      // Step 8 & Step 9 succeed, but right before Step 10 transaction commits,
      // subscription is downgraded to Pro (0 whatsapp connections allowed)
      (mockProvider.subscribeMessagingAccountApps as any).mockImplementationOnce(async () => {
        subscriptionsStore.set(anchorMinistryId, {
          ...subscriptionsStore.get(anchorMinistryId),
          plan_id: 'pro',
        });
      });

      // Complete onboarding attempt 1 — hits Step 10 commercial restriction
      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'single_use_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
          pin: '123456',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });

      // Assert: Secret is RETAINED (not deleted)
      expect(secretsStore.get(activeConnectionId)).toBeDefined();

      // Assert: Connection is in 'connecting' with status_reason 'SUBSCRIPTION_RESTRICTED',
      // preserving remote provider identifiers
      const connBeforeUpgrade = connectionsStore.get(activeConnectionId);
      expect(connBeforeUpgrade?.status).toBe('connecting');
      expect(connBeforeUpgrade?.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      expect(connBeforeUpgrade?.provider_waba_id).toBe('waba-001');
      expect(connBeforeUpgrade?.provider_phone_number_id).toBe('phone-001');
      expect(connBeforeUpgrade?.phone_number).toBe('+5511988887771');

      // Assert: Session is NOT failed; provider_progress is 'waba_subscribed'
      const sessionBeforeUpgrade = sessionsStore.get(activeSessionId);
      expect(sessionBeforeUpgrade?.status).not.toBe('failed');
      expect(sessionBeforeUpgrade?.provider_progress).toBe('waba_subscribed');

      // Verify provider call counts for attempt 1
      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
      expect(mockProvider.registerPhoneNumber).toHaveBeenCalledTimes(1);
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);

      // Now: Organization upgrades plan to Premium (1 WhatsApp connection included)
      subscriptionsStore.set(anchorMinistryId, {
        ...subscriptionsStore.get(anchorMinistryId),
        plan_id: 'premium',
      });

      // Attempt 2: Resumption after plan upgrade
      const resumed = await connectionService.completeOnboarding(orgId, adminUserId, {
        sessionId: activeSessionId,
        stateNonce: activeRawNonce,
        code: 'already_used_code',
        wabaId: 'waba-001',
        phoneNumberId: 'phone-001',
        pin: '123456',
      });

      // Assert: Resumption succeeded
      expect(resumed.id).toBe(activeConnectionId);
      expect(resumed.status).toBe('connected');

      const connAfterUpgrade = connectionsStore.get(activeConnectionId);
      expect(connAfterUpgrade?.status).toBe('connected');
      expect(connAfterUpgrade?.status_reason).toBeNull();
      expect(connAfterUpgrade?.last_connected_at).toBeDefined();

      const sessionAfterUpgrade = sessionsStore.get(activeSessionId);
      expect(sessionAfterUpgrade?.status).toBe('consumed');

      // Assert: Secret is still retained
      expect(secretsStore.get(activeConnectionId)).toBeDefined();

      // Assert: Provider OAuth exchange and PIN registration were SKIPPED on resumption!
      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
      expect(mockProvider.registerPhoneNumber).toHaveBeenCalledTimes(1);
    });

    it('Step 10 Capacity Limit: competing connection created before commit triggers WHATSAPP_CAPACITY_LIMIT_REACHED in Step 10, retains secret and sets connecting', async () => {
      (mockProvider.subscribeMessagingAccountApps as any).mockImplementationOnce(async () => {
        // Competing connection created right before Step 10 transaction runs
        connectionsStore.set('wac_competing_step10', {
          id: 'wac_competing_step10',
          organization_id: orgId,
          display_name: 'Competing Line Step 10',
          status: 'connected',
          phone_number: '+5511999990099',
          provider: 'meta_cloud_api',
          provider_waba_id: 'waba-001',
          provider_phone_number_id: 'phone-competing-step10',
          created_by_user_id: ownerUserId,
          assigned_ministry_id: null,
          pending_expires_at: null,
          last_connected_at: new Date().toISOString(),
          last_health_check_at: null,
          status_reason: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      });

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });

      expect(secretsStore.get(activeConnectionId)).toBeDefined();
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('connecting');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      expect(sessionsStore.get(activeSessionId)?.provider_progress).toBe('waba_subscribed');
    });

    it('Generic Provider 403: provider-side 403 error is NOT misclassified as commercial restriction', async () => {
      vi.spyOn(connectionRepo, 'countConsumingConnections').mockRejectedValueOnce(
        new AppError(403, 'Meta permission denied', { code: 'PROVIDER_FORBIDDEN' })
      );

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'valid_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'PROVIDER_FORBIDDEN' },
      });

      // Should NOT have set status: 'connecting' with status_reason: 'SUBSCRIPTION_RESTRICTED'
      expect(connectionsStore.get(activeConnectionId)?.status).not.toBe('connecting');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).not.toBe('SUBSCRIPTION_RESTRICTED');
    });
  });

  // --------------------------------------------------------------------------
  // R7-B2.2 — Repeated Commercial Restriction & Step 9 Idempotency
  // --------------------------------------------------------------------------
  describe('R7-B2.2: Repeated Commercial Restriction, Step 9 Idempotency & Commercial Recovery', () => {
    let activeSessionId: string;
    let activeConnectionId: string;
    let activeRawNonce: string;

    beforeEach(async () => {
      const started = await connectionService.startOnboarding(orgId, adminUserId, {
        displayName: 'Linha R7-B2.2',
      });
      activeSessionId = started.sessionId;
      activeConnectionId = started.connectionId;
      activeRawNonce = started.stateNonce!;
    });

    // Produces the durable recoverable state after provider materialization:
    //   connection.status = connecting / status_reason = SUBSCRIPTION_RESTRICTED
    //   session.provider_progress = waba_subscribed
    //   provider WABA ID, phone ID, normalized phone, encrypted secret retained
    async function restrictAtStep10() {
      (mockProvider.subscribeMessagingAccountApps as any).mockImplementationOnce(async () => {
        subscriptionsStore.set(anchorMinistryId, {
          ...subscriptionsStore.get(anchorMinistryId),
          plan_id: 'pro', // 0 included WhatsApp connections
        });
      });

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'single_use_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
          pin: '123456',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' },
      });

      const conn = connectionsStore.get(activeConnectionId);
      expect(conn?.status).toBe('connecting');
      expect(conn?.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      const session = sessionsStore.get(activeSessionId);
      expect(session?.provider_progress).toBe('waba_subscribed');
      const pendingTtl = conn?.pending_expires_at;
      expect(pendingTtl).toBeDefined();
      return pendingTtl;
    }

    function expectRecoverableStatePreserved(pendingTtl: any) {
      const conn = connectionsStore.get(activeConnectionId);
      expect(conn?.status).toBe('connecting');
      expect(conn?.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      expect(conn?.provider_waba_id).toBe('waba-001');
      expect(conn?.provider_phone_number_id).toBe('phone-001');
      expect(conn?.phone_number).toBe('+5511988887771');
      expect(conn?.pending_expires_at).toBe(pendingTtl);
      const session = sessionsStore.get(activeSessionId);
      expect(session?.status).not.toBe('failed');
      expect(session?.provider_progress).toBe('waba_subscribed');
      // Secret and provider identity retained
      expect(secretsStore.get(activeConnectionId)).toBeDefined();
    }

    it('A. second restricted retry after waba_subscribed preserves the recoverable state (no lifecycle settlement)', async () => {
      const pendingTtl = await restrictAtStep10();

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'already_used_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED' },
      });

      expectRecoverableStatePreserved(pendingTtl);
    });

    it('B. third restricted retry preserves the same recoverable state', async () => {
      const pendingTtl = await restrictAtStep10();

      for (let attempt = 2; attempt <= 3; attempt++) {
        await expect(
          connectionService.completeOnboarding(orgId, adminUserId, {
            sessionId: activeSessionId,
            stateNonce: activeRawNonce,
            code: `already_used_code_${attempt}`,
            wabaId: 'waba-001',
            phoneNumberId: 'phone-001',
          })
        ).rejects.toMatchObject({
          statusCode: 403,
          details: { code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED' },
        });
        expectRecoverableStatePreserved(pendingTtl);
      }
    });

    it('C. repeated restricted retries perform ZERO additional OAuth/phone-registration/WABA-subscription calls', async () => {
      const pendingTtl = await restrictAtStep10();

      // Attempts 2 and 3 (still restricted)
      for (let attempt = 2; attempt <= 3; attempt++) {
        await expect(
          connectionService.completeOnboarding(orgId, adminUserId, {
            sessionId: activeSessionId,
            stateNonce: activeRawNonce,
            code: `already_used_code_${attempt}`,
            wabaId: 'waba-001',
            phoneNumberId: 'phone-001',
          })
        ).rejects.toMatchObject({
          statusCode: 403,
          details: { code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED' },
        });
      }

      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
      expect(mockProvider.registerPhoneNumber).toHaveBeenCalledTimes(1);
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
    });

    it('D. provider_progress=waba_subscribed skips Step 9 subscribeMessagingAccountApps on resumption', async () => {
      await restrictAtStep10();

      // Entitlement becomes allowed again
      subscriptionsStore.set(anchorMinistryId, {
        ...subscriptionsStore.get(anchorMinistryId),
        plan_id: 'premium',
      });

      const resumed = await connectionService.completeOnboarding(orgId, adminUserId, {
        sessionId: activeSessionId,
        stateNonce: activeRawNonce,
        code: 'already_used_code',
        wabaId: 'waba-001',
        phoneNumberId: 'phone-001',
      });

      expect(resumed.id).toBe(activeConnectionId);
      expect(resumed.status).toBe('connected');
      // Step 9 must NOT be repeated for a waba_subscribed checkpoint
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
      // OAuth exchange and PIN registration also not repeated
      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
      expect(mockProvider.registerPhoneNumber).toHaveBeenCalledTimes(1);
    });

    it('E. provider_progress=phone_registered may execute Step 9 exactly once and persists waba_subscribed only after provider success', async () => {
      const nowIso = new Date().toISOString();
      const session = sessionsStore.get(activeSessionId);
      sessionsStore.set(activeSessionId, {
        ...session,
        status: 'active',
        provider_progress: 'phone_registered',
      });
      const encrypted = encryptionService.encryptToken('EAAG_resume_token_456', orgId, activeConnectionId);
      secretsStore.set(activeConnectionId, {
        id: activeConnectionId,
        organization_id: orgId,
        connection_id: activeConnectionId,
        encrypted_access_token: encrypted.encryptedAccessToken,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        key_version: encrypted.keyVersion,
        token_type: 'business_token',
        expires_at: new Date(Date.now() + 5184000 * 1000).toISOString(),
        created_at: nowIso,
        updated_at: nowIso,
      });

      const resumed = await connectionService.completeOnboarding(orgId, adminUserId, {
        sessionId: activeSessionId,
        stateNonce: activeRawNonce,
        code: 'already_used_code',
        wabaId: 'waba-001',
        phoneNumberId: 'phone-001',
        pin: '123456',
      });

      expect(resumed.status).toBe('connected');
      // Step 9 executed exactly once for the phone_registered checkpoint
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
      expect(mockProvider.registerPhoneNumber).not.toHaveBeenCalled();
      // waba_subscribed only persisted after provider success (session consumed with progress)
      expect(sessionsStore.get(activeSessionId)?.status).toBe('consumed');
      expect(sessionsStore.get(activeSessionId)?.provider_progress).toBe('waba_subscribed');
    });

    it('F. commercial recovery from waba_subscribed reaches connected without repeating completed provider mutations', async () => {
      await restrictAtStep10();

      subscriptionsStore.set(anchorMinistryId, {
        ...subscriptionsStore.get(anchorMinistryId),
        plan_id: 'premium',
      });

      const resumed = await connectionService.completeOnboarding(orgId, adminUserId, {
        sessionId: activeSessionId,
        stateNonce: activeRawNonce,
        code: 'already_used_code',
        wabaId: 'waba-001',
        phoneNumberId: 'phone-001',
      });

      const conn = connectionsStore.get(activeConnectionId);
      expect(resumed.status).toBe('connected');
      expect(conn?.status).toBe('connected');
      expect(conn?.status_reason).toBeNull();
      expect(conn?.last_connected_at).toBeDefined();
      expect(conn?.provider_waba_id).toBe('waba-001');
      expect(conn?.provider_phone_number_id).toBe('phone-001');
      expect(conn?.phone_number).toBe('+5511988887771');
      // Secret retained after connection
      expect(secretsStore.get(activeConnectionId)).toBeDefined();
      // No completed provider mutation repeated
      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
      expect(mockProvider.registerPhoneNumber).toHaveBeenCalledTimes(1);
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
    });

    it('G. mismatched persisted WABA/phone checkpoint fails closed instead of being reused', async () => {
      await restrictAtStep10();

      subscriptionsStore.set(anchorMinistryId, {
        ...subscriptionsStore.get(anchorMinistryId),
        plan_id: 'premium',
      });

      // Wrong WABA identity for the same checkpoint
      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'already_used_code',
          wabaId: 'waba-002',
          phoneNumberId: 'phone-001',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'PROVIDER_IDENTITY_CONFLICT' },
      });

      // Must not have reused the checkpoint to connect with the wrong identity
      expect(connectionsStore.get(activeConnectionId)?.status).toBe('connecting');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('SUBSCRIPTION_RESTRICTED');

      // Wrong phone identity for the same checkpoint
      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'already_used_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-999',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'PROVIDER_IDENTITY_CONFLICT' },
      });

      expect(connectionsStore.get(activeConnectionId)?.status).toBe('connecting');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      // No additional provider mutation from the rejected attempts
      expect(mockProvider.exchangeOAuthCode).toHaveBeenCalledTimes(1);
      expect(mockProvider.registerPhoneNumber).toHaveBeenCalledTimes(1);
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
    });

    it('H. generic provider HTTP 403 stays a PROVIDER error and is NOT treated as SUBSCRIPTION_RESTRICTED', async () => {
      const nowIso = new Date().toISOString();
      const session = sessionsStore.get(activeSessionId);
      sessionsStore.set(activeSessionId, {
        ...session,
        status: 'active',
        provider_progress: 'phone_registered',
      });
      const encrypted = encryptionService.encryptToken('EAAG_resume_token_789', orgId, activeConnectionId);
      secretsStore.set(activeConnectionId, {
        id: activeConnectionId,
        organization_id: orgId,
        connection_id: activeConnectionId,
        encrypted_access_token: encrypted.encryptedAccessToken,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        key_version: encrypted.keyVersion,
        token_type: 'business_token',
        expires_at: new Date(Date.now() + 5184000 * 1000).toISOString(),
        created_at: nowIso,
        updated_at: nowIso,
      });

      (mockProvider.subscribeMessagingAccountApps as any).mockRejectedValueOnce(
        new AppError(403, 'Meta permission denied', {
          code: 'PROVIDER_FORBIDDEN',
          providerRejection: true,
        })
      );

      await expect(
        connectionService.completeOnboarding(orgId, adminUserId, {
          sessionId: activeSessionId,
          stateNonce: activeRawNonce,
          code: 'already_used_code',
          wabaId: 'waba-001',
          phoneNumberId: 'phone-001',
          pin: '123456',
        })
      ).rejects.toMatchObject({
        statusCode: 502,
        details: { code: 'PROVIDER_SUBSCRIPTION_FAILED' },
      });

      // NOT reclassified as commercial restriction: connection must not flip to connecting/SUBSCRIPTION_RESTRICTED
      expect(connectionsStore.get(activeConnectionId)?.status).not.toBe('connecting');
      expect(connectionsStore.get(activeConnectionId)?.status_reason).not.toBe('SUBSCRIPTION_RESTRICTED');
      // Session did NOT persist waba_subscribed (provider never confirmed)
      expect(sessionsStore.get(activeSessionId)?.provider_progress).not.toBe('waba_subscribed');
    });
  });
});
