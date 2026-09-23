import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppCleanupService } from './whatsapp-cleanup.service';
import { WhatsAppReconciliationService } from './whatsapp-reconciliation.service';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppMinistryAssignmentClaimRepository } from '../../repositories/WhatsAppMinistryAssignmentClaimRepository';
import { WhatsAppOnboardingSessionRepository } from '../../repositories/WhatsAppOnboardingSessionRepository';
import { WhatsAppProviderCleanupJobRepository } from '../../repositories/WhatsAppProviderCleanupJobRepository';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { WhatsAppProvider, WhatsAppProviderCleanupJobRecord, getClaimId, normalizeToE164 } from './whatsapp.types';
import { OrganizationRecord, OrganizationMemberRecord } from '../organizations/organization.types';
import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';

// ---------------------------------------------------------------------------
// PHASE R7-B2.3 — Step 9 ambiguity, D7 TTL ownership & strong settlement
//
// These regressions are mock-isolated (no Firestore Emulator required).
// ---------------------------------------------------------------------------

const ORG_ID = 'org-r7b23';
const ANCHOR_MINISTRY_ID = 'min-r7b23';
const OWNER_USER_ID = 'user-owner-r7b23';
const ADMIN_USER_ID = 'user-admin-r7b23';
const WABA_ID = 'waba-r7b23-001';
const PHONE_NUMBER_ID = 'phone-r7b23-001';
const DISPLAY_PHONE = '+55 11 97777-6666';
const CANONICAL_PHONE = '+5511977776666';

type Stores = Record<string, Map<string, any>>;

function makeStores(): Stores {
  return {
    organizations: new Map(),
    organization_members: new Map(),
    ministry_subscriptions: new Map(),
    ministries: new Map(),
    whatsapp_connections: new Map(),
    whatsapp_onboarding_sessions: new Map(),
    whatsapp_connection_secrets: new Map(),
    whatsapp_provider_identity_claims: new Map(),
    whatsapp_ministry_assignment_claims: new Map(),
    whatsapp_waba_lifecycle_locks: new Map(),
    whatsapp_provider_cleanup_jobs: new Map(),
    whatsapp_waba_reconciliation_jobs: new Map(),
  };
}

function installFirestoreMock(stores: Stores): void {
  const storeOf = (col: string): Map<string, any> => {
    if (!stores[col]) stores[col] = new Map();
    return stores[col];
  };

  const makeDocRef = (col: string, id: string): any => {
    const ref: any = {
      id,
      __col: col,
      get: vi.fn().mockImplementation(async () => {
        const data = storeOf(col).get(id);
        return { exists: Boolean(data), id, data: () => data, ref };
      }),
      set: vi.fn().mockImplementation(async (data: any) => {
        storeOf(col).set(id, { id, ...data });
      }),
      update: vi.fn().mockImplementation(async (data: any) => {
        const current = storeOf(col).get(id) || {};
        storeOf(col).set(id, { ...current, ...data });
      }),
      delete: vi.fn().mockImplementation(async () => {
        storeOf(col).delete(id);
      }),
    };
    return ref;
  };

  const makeQuery = (col: string, filters: Array<{ field: string; op: string; val: any }>): any => {
    const q: any = {
      where: vi.fn().mockImplementation((field: string, op: string, val: any) => {
        return makeQuery(col, [...filters, { field, op, val }]);
      }),
      orderBy: vi.fn().mockImplementation(() => q),
      startAfter: vi.fn().mockImplementation(() => q),
      limit: vi.fn().mockImplementation(() => q),
      get: vi.fn().mockImplementation(async () => {
        const items = Array.from(storeOf(col).values()).filter((item: any) =>
          filters.every((f) => {
            if (f.op === '==') return item[f.field] === f.val;
            if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(item[f.field]);
            if (f.op === '<=') return item[f.field] <= f.val;
            if (f.op === '>=') return item[f.field] >= f.val;
            if (f.op === '<') return item[f.field] < f.val;
            return true;
          })
        );
        return {
          docs: items.map((d: any) => ({ id: d.id, ref: makeDocRef(col, d.id), data: () => d })),
          size: items.length,
          empty: items.length === 0,
        };
      }),
    };
    return q;
  };

  vi.spyOn(db, 'collection').mockImplementation((col: string): any => {
    return {
      doc: (id: string) => makeDocRef(col, id),
      where: (field: string, op: string, val: any) => makeQuery(col, [{ field, op, val }]),
    };
  });

  vi.spyOn(db, 'runTransaction').mockImplementation(async (callback: any) => {
    // R7-B2.3R — transactional mock: writes are buffered and applied atomically only if the
    // callback resolves. Reads inside the transaction observe prior writes (read-your-writes),
    // and a thrown error discards ALL buffered writes (true rollback semantics).
    const pendingOps: Array<() => void> = [];
    const overlay = new Map<string, any>();
    const keyOf = (ref: any) => `${ref.__col}/${ref.id}`;
    const readData = (ref: any) => {
      const key = keyOf(ref);
      if (overlay.has(key)) return overlay.get(key);
      return storeOf(ref.__col).get(ref.id);
    };
    const tx: any = {
      get: vi.fn().mockImplementation(async (ref: any) => {
        // Query targets (no `__col`) delegate to their own snapshot; document refs use the overlay.
        if (ref && ref.__col === undefined && typeof ref.get === 'function') {
          return await ref.get();
        }
        const data = readData(ref);
        return { exists: Boolean(data), id: ref.id, data: () => data, ref };
      }),
      set: vi.fn().mockImplementation(async (ref: any, data: any) => {
        const record = { id: ref.id, ...data };
        overlay.set(keyOf(ref), record);
        pendingOps.push(() => storeOf(ref.__col).set(ref.id, record));
      }),
      update: vi.fn().mockImplementation(async (ref: any, data: any) => {
        const current = readData(ref) || {};
        const record = { ...current, ...data };
        overlay.set(keyOf(ref), record);
        pendingOps.push(() => storeOf(ref.__col).set(ref.id, record));
      }),
      delete: vi.fn().mockImplementation(async (ref: any) => {
        overlay.set(keyOf(ref), undefined);
        pendingOps.push(() => storeOf(ref.__col).delete(ref.id));
      }),
    };
    const result = await callback(tx);
    for (const op of pendingOps) op();
    return result;
  });
}

describe('R7-B2.3 — Step 9 Ambiguity, D7 TTL Ownership & Strong Settlement', () => {
  let stores: Stores;
  let mockProvider: WhatsAppProvider;
  let encryptionService: WhatsAppEncryptionService;
  let connectionRepo: WhatsAppConnectionRepository;
  let connectionService: WhatsAppConnectionService;
  let cleanupService: WhatsAppCleanupService;
  let reconciliationService: WhatsAppReconciliationService;
  let cleanupJobRepo: WhatsAppProviderCleanupJobRepository;
  let reconJobRepo: WhatsAppWabaReconciliationJobRepository;
  let lockRepo: WhatsAppWabaLifecycleLockRepository;
  let secretRepo: WhatsAppConnectionSecretRepository;

  const validKey = crypto.randomBytes(32).toString('base64');

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.META_APP_ID = 'test-meta-app-id';
    process.env.META_APP_SECRET = 'test-meta-app-secret';
    process.env.META_CONFIG_ID = 'test-config-id';

    stores = makeStores();
    installFirestoreMock(stores);

    const now = new Date().toISOString();

    stores.ministries.set(ANCHOR_MINISTRY_ID, {
      id: ANCHOR_MINISTRY_ID,
      name: 'Anchor Ministry',
      organization_id: ORG_ID,
      created_at: now,
      updated_at: now,
    });

    const org: OrganizationRecord = {
      id: ORG_ID,
      name: 'Igreja R7B23',
      slug: 'igreja-r7b23',
      owner_user_id: OWNER_USER_ID,
      billing_anchor_ministry_id: ANCHOR_MINISTRY_ID,
      default_whatsapp_connection_id: null,
      created_at: now,
      updated_at: now,
    } as OrganizationRecord;
    stores.organizations.set(ORG_ID, org);

    const ownerMember: OrganizationMemberRecord = {
      id: `${ORG_ID}_${OWNER_USER_ID}`,
      organization_id: ORG_ID,
      user_id: OWNER_USER_ID,
      role: 'owner',
      invited_by_user_id: null,
      created_at: now,
      updated_at: now,
    } as OrganizationMemberRecord;
    stores.organization_members.set(ownerMember.id, ownerMember);

    const adminMember: OrganizationMemberRecord = {
      id: `${ORG_ID}_${ADMIN_USER_ID}`,
      organization_id: ORG_ID,
      user_id: ADMIN_USER_ID,
      role: 'admin',
      invited_by_user_id: OWNER_USER_ID,
      created_at: now,
      updated_at: now,
    } as OrganizationMemberRecord;
    stores.organization_members.set(adminMember.id, adminMember);

    stores.ministry_subscriptions.set(ANCHOR_MINISTRY_ID, {
      id: ANCHOR_MINISTRY_ID,
      ministry_id: ANCHOR_MINISTRY_ID,
      plan_id: 'premium', // Premium = 1 included WhatsApp connection
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'paid',
      created_at: now,
      updated_at: now,
    });

    mockProvider = {
      exchangeOAuthCode: vi.fn().mockResolvedValue({
        accessToken: 'EAAG_mock_business_token_r7b23',
        tokenType: 'business_token',
        expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
      }),
      verifyMessagingAccountAccess: vi.fn().mockResolvedValue(true),
      listAuthorizedPhoneNumbers: vi.fn().mockResolvedValue([
        { id: PHONE_NUMBER_ID, displayPhoneNumber: DISPLAY_PHONE, verifiedName: 'LouvAIO R7B23' },
      ]),
      getPhoneNumberDetails: vi.fn().mockResolvedValue({
        displayPhoneNumber: DISPLAY_PHONE,
        verifiedName: 'LouvAIO R7B23',
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
    secretRepo = new WhatsAppConnectionSecretRepository();
    cleanupJobRepo = new WhatsAppProviderCleanupJobRepository();
    reconJobRepo = new WhatsAppWabaReconciliationJobRepository();
    lockRepo = new WhatsAppWabaLifecycleLockRepository();

    connectionService = new WhatsAppConnectionService(
      connectionRepo,
      secretRepo,
      new WhatsAppProviderIdentityClaimRepository(),
      new OrganizationRepository(),
      new SubscriptionService(),
      new MinistryRepository(),
      new WhatsAppMinistryAssignmentClaimRepository(),
      new WhatsAppOnboardingSessionRepository(),
      mockProvider,
      encryptionService,
      undefined as any, // wabaCoordinator (default)
      cleanupJobRepo,
      lockRepo,
      undefined as any, // zernioClient
      undefined as any, // webhookRepo
      undefined as any, // outboundRepo
      reconJobRepo
    );

    cleanupService = new WhatsAppCleanupService(
      cleanupJobRepo,
      lockRepo,
      reconJobRepo,
      connectionRepo,
      secretRepo,
      encryptionService,
      mockProvider,
      undefined as any
    );

    reconciliationService = new WhatsAppReconciliationService(
      reconJobRepo,
      lockRepo,
      connectionRepo,
      secretRepo,
      encryptionService,
      mockProvider,
      undefined as any,
      cleanupJobRepo
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function startOnboarding(): Promise<{
    sessionId: string;
    connectionId: string;
    nonce: string;
    originalTtl: string;
  }> {
    const started = await connectionService.startOnboarding(ORG_ID, ADMIN_USER_ID, {
      displayName: 'Linha R7B23',
    });
    const sessionId = started.sessionId;
    const connectionId = started.connectionId;
    const nonce = started.stateNonce!;
    const originalTtl = stores.whatsapp_connections.get(connectionId)!.pending_expires_at;
    return { sessionId, connectionId, nonce, originalTtl };
  }

  function stageSecret(connectionId: string): void {
    const now = new Date().toISOString();
    const encrypted = encryptionService.encryptToken('EAAG_staged_resume_token', ORG_ID, connectionId);
    stores.whatsapp_connection_secrets.set(connectionId, {
      id: connectionId,
      organization_id: ORG_ID,
      connection_id: connectionId,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
      token_type: 'business_token',
      expires_at: new Date(Date.now() + 5184000 * 1000).toISOString(),
      created_at: now,
      updated_at: now,
    });
  }

  function seedLock(params: {
    operationStatus: 'idle' | 'in_flight' | 'unknown_outcome';
    leaseExpiresAt?: string | null;
    unresolved?: Array<{
      operation_generation: number;
      operation: 'subscribe' | 'unsubscribe';
      dispatched_at: string;
      status: 'unknown_outcome' | 'settled';
      connection_id: string;
    }>;
    providerObservedState?: 'subscribed' | 'unsubscribed' | 'unknown';
  }): void {
    const now = new Date().toISOString();
    stores.whatsapp_waba_lifecycle_locks.set(`lock_meta_${WABA_ID}`, {
      id: `lock_meta_${WABA_ID}`,
      provider: 'meta',
      provider_waba_id: WABA_ID,
      operation_generation: 3,
      desired_subscription_state: 'subscribed',
      operation_status: params.operationStatus,
      current_holder_id: params.operationStatus === 'in_flight' ? 'onboarding_session_prev' : null,
      lease_token: params.operationStatus === 'in_flight' ? 'lease-token-prev' : null,
      lease_expires_at:
        params.leaseExpiresAt !== undefined
          ? params.leaseExpiresAt
          : params.operationStatus === 'in_flight'
            ? new Date(Date.now() - 5000).toISOString() // expired in-flight (crash window)
            : null,
      provider_observed_state: params.providerObservedState || 'unknown',
      provider_observed_at: null,
      provider_observed_generation: null,
      unresolved_remote_mutations: params.unresolved || [],
      last_settled_at: null,
      created_at: now,
      updated_at: now,
    });
  }

  /**
   * Reproduces the durable recoverable state after remote materialization under
   * commercial restriction (B2.2). Returns the ORIGINAL pending TTL.
   */
  async function restrictAtStep10(): Promise<{ sessionId: string; connectionId: string; nonce: string; originalTtl: string }> {
    const started = await startOnboarding();

    (mockProvider.subscribeMessagingAccountApps as any).mockImplementationOnce(async () => {
      const sub = stores.ministry_subscriptions.get(ANCHOR_MINISTRY_ID);
      stores.ministry_subscriptions.set(ANCHOR_MINISTRY_ID, { ...sub, plan_id: 'pro' }); // 0 connections
    });

    await expect(
      connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
        sessionId: started.sessionId,
        stateNonce: started.nonce,
        code: 'single_use_code',
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
        pin: '123456',
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    const conn = stores.whatsapp_connections.get(started.connectionId)!;
    expect(conn.status).toBe('connecting');
    expect(conn.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
    expect(stores.whatsapp_onboarding_sessions.get(started.sessionId)!.provider_progress).toBe('waba_subscribed');

    return started;
  }

  function upgradeToPremium(): void {
    const sub = stores.ministry_subscriptions.get(ANCHOR_MINISTRY_ID);
    stores.ministry_subscriptions.set(ANCHOR_MINISTRY_ID, { ...sub, plan_id: 'premium' });
  }

  // =========================================================================
  // A / B / C — Step 9 remote-success crash window & D7 reconciliation owner
  // =========================================================================

  describe('Step 9 ambiguity (remote success, missing local checkpoint)', () => {
    it('A. does NOT re-issue subscribeMessagingAccountApps when the checkpoint is missing and the prior attempt is unresolved', async () => {
      const started = await startOnboarding();
      stores.whatsapp_onboarding_sessions.set(started.sessionId, {
        ...stores.whatsapp_onboarding_sessions.get(started.sessionId),
        status: 'credential_staged',
        provider_progress: 'phone_registered',
      });
      stageSecret(started.connectionId);
      // Crash window: subscribe remotely succeeded, process died before the local checkpoint.
      seedLock({ operationStatus: 'in_flight', leaseExpiresAt: new Date(Date.now() - 5000).toISOString() });

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(mockProvider.subscribeMessagingAccountApps).not.toHaveBeenCalled();
      // Fail-closed: the materialized secret is retained.
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
    });

    it('B. creates/reuses recon_meta_${wabaId} via the existing D7 reconciliation mechanism', async () => {
      const started = await startOnboarding();
      stores.whatsapp_onboarding_sessions.set(started.sessionId, {
        ...stores.whatsapp_onboarding_sessions.get(started.sessionId),
        status: 'credential_staged',
        provider_progress: 'phone_registered',
      });
      stageSecret(started.connectionId);
      seedLock({ operationStatus: 'in_flight', leaseExpiresAt: new Date(Date.now() - 5000).toISOString() });

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 409 });

      const recon = await reconJobRepo.getJob(WABA_ID);
      expect(recon).not.toBeNull();
      expect(recon!.id).toBe(`recon_meta_${WABA_ID}`);
      expect(recon!.status).toBe('pending');
      expect(recon!.desired_state).toBe('subscribed');
    });

    it('C. an unresolved/expired in-flight lifecycle lock does not permit blind re-subscribe (and reuses an existing recon job)', async () => {
      const started = await startOnboarding();
      stores.whatsapp_onboarding_sessions.set(started.sessionId, {
        ...stores.whatsapp_onboarding_sessions.get(started.sessionId),
        status: 'credential_staged',
        provider_progress: 'phone_registered',
      });
      stageSecret(started.connectionId);
      seedLock({ operationStatus: 'in_flight', leaseExpiresAt: new Date(Date.now() - 1000).toISOString() });

      // Pre-existing exhausted recon job must be re-activated, not duplicated.
      const nowIso = new Date().toISOString();
      stores.whatsapp_waba_reconciliation_jobs.set(`recon_meta_${WABA_ID}`, {
        id: `recon_meta_${WABA_ID}`,
        provider: 'meta',
        provider_waba_id: WABA_ID,
        desired_state: 'subscribed',
        status: 'exhausted',
        attempt_count: 5,
        next_attempt_at: nowIso,
        lease_token: null,
        lease_expires_at: null,
        last_error_code: 'MAX_RETRIES_EXCEEDED',
        last_error_message: null,
        consecutive_stable_observations: 0,
        last_observed_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 409 });

      expect(mockProvider.subscribeMessagingAccountApps).not.toHaveBeenCalled();
      const recon = await reconJobRepo.getJob(WABA_ID);
      expect(recon!.status).toBe('pending');
      // No duplicate job was created.
      expect(stores.whatsapp_waba_reconciliation_jobs.size).toBe(1);
    });
  });

  // =========================================================================
  // D — provider observation does not erase historical UNKNOWN
  // =========================================================================

  it('D. current provider observation does not erase historical UNKNOWN subscribe debt without D7 strong settlement', async () => {
    const connId = `wac_${crypto.randomBytes(8).toString('hex')}`;
    const nowIso = new Date().toISOString();
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: ORG_ID,
      display_name: 'Conn D',
      status: 'connecting',
      phone_number: CANONICAL_PHONE,
      provider: 'meta_cloud_api',
      provider_waba_id: WABA_ID,
      provider_phone_number_id: PHONE_NUMBER_ID,
      status_reason: 'SUBSCRIPTION_RESTRICTED',
      assigned_ministry_id: null,
      created_by_user_id: ADMIN_USER_ID,
      current_onboarding_session_id: null,
      pending_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      last_connected_at: null,
      last_health_check_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    });
    stageSecret(connId);
    seedLock({
      operationStatus: 'unknown_outcome',
      unresolved: [
        {
          operation_generation: 2,
          operation: 'subscribe',
          dispatched_at: nowIso,
          status: 'unknown_outcome',
          connection_id: connId,
        },
      ],
      providerObservedState: 'subscribed',
    });
    stores.whatsapp_waba_reconciliation_jobs.set(`recon_meta_${WABA_ID}`, {
      id: `recon_meta_${WABA_ID}`,
      provider: 'meta',
      provider_waba_id: WABA_ID,
      desired_state: 'subscribed',
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: nowIso,
      lease_token: null,
      lease_expires_at: null,
      last_error_code: null,
      last_error_message: null,
      consecutive_stable_observations: 0,
      last_observed_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    });

    const summary = await reconciliationService.executeDueJobs({ batchSize: 5 });
    expect(summary.processedCount).toBeGreaterThanOrEqual(1);

    const lock = await lockRepo.getLock(WABA_ID);
    // A fresh provider observation is not strong settlement of the historical UNKNOWN.
    expect(lock!.unresolved_remote_mutations.length).toBe(1);
    expect(lock!.unresolved_remote_mutations[0].status).toBe('unknown_outcome');
    expect(lock!.unresolved_remote_mutations[0].operation).toBe('subscribe');
  });

  // =========================================================================
  // E / F — durable waba_subscribed checkpoint integrity
  // =========================================================================

  describe('Durable waba_subscribed checkpoint integrity', () => {
    it('E. waba_subscribed with a missing retained secret fails closed with ZERO duplicate subscribe calls', async () => {
      const started = await startOnboarding();
      stores.whatsapp_onboarding_sessions.set(started.sessionId, {
        ...stores.whatsapp_onboarding_sessions.get(started.sessionId),
        status: 'active',
        provider_progress: 'waba_subscribed',
      });
      stores.whatsapp_connections.set(started.connectionId, {
        ...stores.whatsapp_connections.get(started.connectionId),
        status: 'connecting',
        status_reason: 'SUBSCRIPTION_RESTRICTED',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        phone_number: CANONICAL_PHONE,
      });
      // Secret deliberately missing.

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 400 });

      expect(mockProvider.subscribeMessagingAccountApps).not.toHaveBeenCalled();
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeUndefined();
    });

    it('F. waba_subscribed recovery with unresolved lifecycle debt routes to D7 ownership instead of bypassing it', async () => {
      const started = await restrictAtStep10();
      upgradeToPremium();

      // Historical UNKNOWN subscribe debt recorded on the WABA lifecycle lock.
      seedLock({
        operationStatus: 'unknown_outcome',
        unresolved: [
          {
            operation_generation: 3,
            operation: 'subscribe',
            dispatched_at: new Date().toISOString(),
            status: 'unknown_outcome',
            connection_id: started.connectionId,
          },
        ],
        providerObservedState: 'subscribed',
      });

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 409 });

      // No new provider subscribe mutation.
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
      // Connection was NOT materialized as connected; recoverable state retained.
      const conn = stores.whatsapp_connections.get(started.connectionId)!;
      expect(conn.status).toBe('connecting');
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
      // D7 reconciliation ownership ensured.
      const recon = await reconJobRepo.getJob(WABA_ID);
      expect(recon).not.toBeNull();
      expect(recon!.status).toBe('pending');
    });
  });

  // =========================================================================
  // G / H / I — deterministic pre-TTL cleanup ownership
  // =========================================================================

  describe('Deterministic pre-TTL cleanup ownership', () => {
    it('G. first remote-materialized commercial denial ensures cleanup_conn_${connectionId}', async () => {
      const started = await restrictAtStep10();
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${started.connectionId}`);
      expect(job).not.toBeNull();
      expect(job!.provider).toBe('meta_cloud_api');
      expect(job!.status).toBe('pending');
      expect(job!.provider_waba_id).toBe(WABA_ID);
      expect(job!.provider_phone_number_id).toBe(PHONE_NUMBER_ID);
    });

    it('H. cleanup job next_attempt_at equals the ORIGINAL pending_expires_at', async () => {
      const started = await restrictAtStep10();
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${started.connectionId}`);
      expect(job!.next_attempt_at).toBe(started.originalTtl);
      // The original onboarding deadline is immutable and retained on the connection.
      expect(stores.whatsapp_connections.get(started.connectionId)!.pending_expires_at).toBe(started.originalTtl);
    });

    it('I. second/third restricted retries do NOT move the deadline and do not create duplicate cleanup jobs', async () => {
      const started = await restrictAtStep10();
      const jobBefore = await cleanupJobRepo.getJob(`cleanup_conn_${started.connectionId}`);

      for (let attempt = 2; attempt <= 3; attempt++) {
        await expect(
          connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
            sessionId: started.sessionId,
            stateNonce: started.nonce,
            code: `already_used_code_${attempt}`,
            wabaId: WABA_ID,
            phoneNumberId: PHONE_NUMBER_ID,
          })
        ).rejects.toMatchObject({ statusCode: 403 });
      }

      const jobAfter = await cleanupJobRepo.getJob(`cleanup_conn_${started.connectionId}`);
      expect(jobAfter!.next_attempt_at).toBe(jobBefore!.next_attempt_at);
      expect(jobAfter!.next_attempt_at).toBe(started.originalTtl);
      // Exactly one deterministic cleanup job exists.
      expect(stores.whatsapp_provider_cleanup_jobs.size).toBe(1);
      // Provider mutations were not repeated.
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
    });

    it('J. before TTL, cleanup does not destructively settle merely because billing is restricted', async () => {
      const started = await restrictAtStep10();
      const conn = stores.whatsapp_connections.get(started.connectionId)!;

      // Force the cleanup job to be due while the connection deadline is still in the future.
      stores.whatsapp_provider_cleanup_jobs.set(`cleanup_conn_${started.connectionId}`, {
        ...stores.whatsapp_provider_cleanup_jobs.get(`cleanup_conn_${started.connectionId}`),
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect(new Date(conn.pending_expires_at).getTime()).toBeGreaterThan(Date.now());

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.candidateCount).toBeGreaterThanOrEqual(1);
      expect(summary.succeededCount).toBe(0);

      // No destructive settlement occurred.
      expect(mockProvider.unsubscribeMessagingAccountApps).not.toHaveBeenCalled();
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
      expect(stores.whatsapp_connections.get(started.connectionId)!.status).toBe('connecting');
      // Capacity still consumed.
      const consuming = await connectionRepo.countConfiguredConnections(ORG_ID);
      expect(consuming).toBe(1);
    });

    it('K. successful recovery before TTL reaches connected and durably cancels cleanup_conn_${connectionId}', async () => {
      const started = await restrictAtStep10();
      upgradeToPremium();

      const resumed = await connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
        sessionId: started.sessionId,
        stateNonce: started.nonce,
        code: 'already_used_code',
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
      });

      expect(resumed.status).toBe('connected');
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${started.connectionId}`);
      expect(job!.status).toBe('cancelled');
      expect(job!.provider_cleanup_proof).toBe('not_needed');
      // The original TTL was never slid before cancellation.
      expect(job!.next_attempt_at).toBe(started.originalTtl);
      // Provider subscribe not repeated on recovery.
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // L / M / N / O — post-TTL D7 handoff & strong-settlement-only release
  // =========================================================================

  describe('Post-TTL D7 handoff & strong settlement', () => {
    function seedMaterializedConnecting(params?: {
      lockUnresolvedSubscribe?: boolean;
      claimOwnedByOther?: boolean;
      claimPresent?: boolean;
    }): { connId: string } {
      const connId = `wac_${crypto.randomBytes(8).toString('hex')}`;
      const nowIso = new Date().toISOString();
      const expired = new Date(Date.now() - 3600_000).toISOString();

      stores.whatsapp_connections.set(connId, {
        id: connId,
        organization_id: ORG_ID,
        display_name: 'Conn Materialized',
        status: 'connecting',
        phone_number: CANONICAL_PHONE,
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        status_reason: 'SUBSCRIPTION_RESTRICTED',
        assigned_ministry_id: null,
        created_by_user_id: ADMIN_USER_ID,
        current_onboarding_session_id: null,
        pending_expires_at: expired,
        last_connected_at: null,
        last_health_check_at: null,
        created_at: expired,
        updated_at: nowIso,
      });
      stageSecret(connId);

      stores.whatsapp_provider_cleanup_jobs.set(`cleanup_conn_${connId}`, {
        id: `cleanup_conn_${connId}`,
        organization_id: ORG_ID,
        connection_id: connId,
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        phone_number: CANONICAL_PHONE,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: expired,
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: expired,
        updated_at: expired,
        completed_at: null,
        retention_expires_at: null,
      });

      const unresolved = params?.lockUnresolvedSubscribe
        ? [
            {
              operation_generation: 2,
              operation: 'subscribe' as const,
              dispatched_at: nowIso,
              status: 'unknown_outcome' as const,
              connection_id: connId,
            },
          ]
        : [];
      seedLock({ operationStatus: unresolved.length ? 'unknown_outcome' : 'idle', unresolved });

      if (params?.claimPresent !== false) {
        const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
        stores.whatsapp_provider_identity_claims.set(claimId, {
          id: claimId,
          provider: 'meta_cloud_api',
          provider_phone_number_id: PHONE_NUMBER_ID,
          organization_id: params?.claimOwnedByOther ? 'other-org' : ORG_ID,
          connection_id: params?.claimOwnedByOther ? 'other-conn' : connId,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }

      return { connId };
    }

    it('L. after TTL without strong D7 proof, secret/connection/evidence/capacity remain retained', async () => {
      const { connId } = seedMaterializedConnecting();
      // Uncertain remote outcome: unsubscribe ambiguous and post-condition unproven.
      (mockProvider.unsubscribeMessagingAccountApps as any).mockResolvedValueOnce({ success: false });
      (mockProvider.checkMessagingAccountSubscribedApps as any).mockResolvedValueOnce({
        status: 'UNPROVEN',
        proof: 'UNPROVEN',
        isSubscribed: false,
        pagesTraversed: 1,
        totalAppsObserved: 0,
      });

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.processedCount).toBeGreaterThanOrEqual(1);
      expect(summary.succeededCount).toBe(0);

      expect(stores.whatsapp_connections.get(connId)!.status).toBe('connecting');
      expect(stores.whatsapp_connection_secrets.get(connId)).toBeDefined();
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(job!.status).not.toBe('succeeded');
      // Capacity still consumed.
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
      // Evidence retained.
      const lock = await lockRepo.getLock(WABA_ID);
      expect(lock!.unresolved_remote_mutations.length).toBeGreaterThanOrEqual(1);
    });

    it('M. proven D7 strong settlement transitions the materialized connection to disconnected and releases capacity', async () => {
      const { connId } = seedMaterializedConnecting();
      (mockProvider.unsubscribeMessagingAccountApps as any).mockResolvedValueOnce({ success: true });

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.succeededCount).toBeGreaterThanOrEqual(1);

      const conn = stores.whatsapp_connections.get(connId)!;
      expect(conn.status).toBe('disconnected');
      expect(conn.pending_expires_at).toBeNull();
      // Secret purged (no unresolved subscribe debt).
      expect(stores.whatsapp_connection_secrets.get(connId)).toBeUndefined();
      // Owned claim released.
      const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
      expect(stores.whatsapp_provider_identity_claims.get(claimId)).toBeUndefined();
      // Capacity released because the connection became disconnected.
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(0);
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(job!.status).toBe('succeeded');
    });

    it('N. unresolved subscribe debt prevents secret deletion even if current provider state looks clean', async () => {
      const { connId } = seedMaterializedConnecting({ lockUnresolvedSubscribe: true });
      (mockProvider.unsubscribeMessagingAccountApps as any).mockResolvedValueOnce({ success: true });

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.exhaustedCount).toBeGreaterThanOrEqual(1);

      expect(stores.whatsapp_connection_secrets.get(connId)).toBeDefined();
      expect(stores.whatsapp_connections.get(connId)!.status).toBe('connecting');
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(job!.status).toBe('exhausted');
      expect(job!.last_error_code).toBe('UNRESOLVED_REMOTE_SUBSCRIBE_DEBT');
      expect(job!.retention_expires_at).toBeNull();
      // Capacity retained.
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });

    it('O. a foreign-owned provider claim is never released', async () => {
      const { connId } = seedMaterializedConnecting({ claimOwnedByOther: true });
      (mockProvider.unsubscribeMessagingAccountApps as any).mockResolvedValueOnce({ success: true });

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.succeededCount).toBeGreaterThanOrEqual(1);

      const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
      const claim = stores.whatsapp_provider_identity_claims.get(claimId);
      expect(claim).toBeDefined();
      expect(claim!.organization_id).toBe('other-org');
      expect(claim!.connection_id).toBe('other-conn');
    });
  });

  // =========================================================================
  // R7-B2.3R — CRASH-SAFETY REMEDIATION
  // =========================================================================

  describe('R7-B2.3R — crash-safety remediation', () => {
    function seedMaterializedConnectingLocal(params?: {
      lockUnresolvedSubscribe?: boolean;
      claimOwnedByOther?: boolean;
      claimPresent?: boolean;
    }): { connId: string } {
      const connId = `wac_${crypto.randomBytes(8).toString('hex')}`;
      const nowIso = new Date().toISOString();
      const expired = new Date(Date.now() - 3600_000).toISOString();

      stores.whatsapp_connections.set(connId, {
        id: connId,
        organization_id: ORG_ID,
        display_name: 'Conn Materialized R',
        status: 'connecting',
        phone_number: CANONICAL_PHONE,
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        status_reason: 'SUBSCRIPTION_RESTRICTED',
        assigned_ministry_id: null,
        created_by_user_id: ADMIN_USER_ID,
        current_onboarding_session_id: null,
        pending_expires_at: expired,
        last_connected_at: null,
        last_health_check_at: null,
        created_at: expired,
        updated_at: nowIso,
      });
      stageSecret(connId);

      stores.whatsapp_provider_cleanup_jobs.set(`cleanup_conn_${connId}`, {
        id: `cleanup_conn_${connId}`,
        organization_id: ORG_ID,
        connection_id: connId,
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        phone_number: CANONICAL_PHONE,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: expired,
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: expired,
        updated_at: expired,
        completed_at: null,
        retention_expires_at: null,
      });

      const unresolved = params?.lockUnresolvedSubscribe
        ? [
            {
              operation_generation: 2,
              operation: 'subscribe' as const,
              dispatched_at: nowIso,
              status: 'unknown_outcome' as const,
              connection_id: connId,
            },
          ]
        : [];
      seedLock({ operationStatus: unresolved.length ? 'unknown_outcome' : 'idle', unresolved });

      if (params?.claimPresent !== false) {
        const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
        stores.whatsapp_provider_identity_claims.set(claimId, {
          id: claimId,
          provider: 'meta_cloud_api',
          provider_phone_number_id: PHONE_NUMBER_ID,
          organization_id: params?.claimOwnedByOther ? 'other-org' : ORG_ID,
          connection_id: params?.claimOwnedByOther ? 'other-conn' : connId,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }

      return { connId };
    }

    async function materializedDenialWithTtl(
      ttl: string | null | 'missing'
    ): Promise<{ sessionId: string; connectionId: string; nonce: string }> {
      const started = await startOnboarding();
      const conn = stores.whatsapp_connections.get(started.connectionId)!;
      if (ttl === 'missing') {
        delete (conn as any).pending_expires_at;
      } else {
        conn.pending_expires_at = ttl;
      }

      (mockProvider.subscribeMessagingAccountApps as any).mockImplementationOnce(async () => {
        const sub = stores.ministry_subscriptions.get(ANCHOR_MINISTRY_ID);
        stores.ministry_subscriptions.set(ANCHOR_MINISTRY_ID, { ...sub, plan_id: 'pro' });
      });

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'single_use_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          pin: '123456',
        })
      ).rejects.toMatchObject({
        statusCode: 500,
        details: { code: 'ONBOARDING_DEADLINE_INTEGRITY_VIOLATION' },
      });

      return started;
    }

    it('R7B23R-A. materialized denial commits connection, session and cleanup ownership in ONE transaction', async () => {
      const original = (db.runTransaction as any).getMockImplementation();
      const transactions: string[][] = [];
      (db.runTransaction as any).mockImplementation(async (cb: any) => {
        const refs: string[] = [];
        const result = await original(async (tx: any) => {
          const wrapped = {
            get: tx.get,
            set: (r: any, d: any) => {
              refs.push(`${r.__col}/${r.id}`);
              return tx.set(r, d);
            },
            update: (r: any, d: any) => {
              refs.push(`${r.__col}/${r.id}`);
              return tx.update(r, d);
            },
            delete: (r: any) => {
              refs.push(`${r.__col}/${r.id}`);
              return tx.delete(r);
            },
          };
          return cb(wrapped);
        });
        transactions.push(refs);
        return result;
      });

      const started = await restrictAtStep10();

      const connKey = `whatsapp_connections/${started.connectionId}`;
      const sessionKey = `whatsapp_onboarding_sessions/${started.sessionId}`;
      const jobKey = `whatsapp_provider_cleanup_jobs/cleanup_conn_${started.connectionId}`;

      const owningTransaction = transactions.find((refs) => refs.includes(jobKey));
      expect(owningTransaction).toBeDefined();
      // The SAME transaction that establishes cleanup ownership also commits the restricted
      // connection state and the session checkpoint — no crash window between them.
      expect(owningTransaction).toContain(connKey);
      expect(owningTransaction).toContain(sessionKey);
      expect(owningTransaction).toContain(jobKey);

      const conn = stores.whatsapp_connections.get(started.connectionId)!;
      expect(conn.status).toBe('connecting');
      expect(conn.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      expect(conn.pending_expires_at).toBe(started.originalTtl);
      expect(stores.whatsapp_onboarding_sessions.get(started.sessionId)!.provider_progress).toBe(
        'waba_subscribed'
      );
    });

    it('R7B23R-B. a cleanup-ownership conflict fails the transaction with ZERO partial connection/session commit', async () => {
      const started = await startOnboarding();

      // Conflicting deterministic cleanup ownership: belongs to another organization.
      stores.whatsapp_provider_cleanup_jobs.set(`cleanup_conn_${started.connectionId}`, {
        id: `cleanup_conn_${started.connectionId}`,
        organization_id: 'other-org',
        connection_id: started.connectionId,
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        phone_number: CANONICAL_PHONE,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: started.originalTtl,
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        retention_expires_at: null,
      });

      (mockProvider.subscribeMessagingAccountApps as any).mockImplementationOnce(async () => {
        const sub = stores.ministry_subscriptions.get(ANCHOR_MINISTRY_ID);
        stores.ministry_subscriptions.set(ANCHOR_MINISTRY_ID, { ...sub, plan_id: 'pro' });
      });

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'single_use_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          pin: '123456',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'CLEANUP_OWNERSHIP_CONFLICT' },
      });

      // ZERO partial commit: connection/session were NOT moved to the restricted state.
      expect(stores.whatsapp_connections.get(started.connectionId)!.status).toBe('pending');
      expect(stores.whatsapp_connections.get(started.connectionId)!.status_reason).not.toBe(
        'SUBSCRIPTION_RESTRICTED'
      );
      expect(
        stores.whatsapp_onboarding_sessions.get(started.sessionId)!.provider_progress
      ).not.toBe('waba_subscribed');
      // Secret/evidence retained; capacity retained.
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
      // Conflicting ownership untouched.
      expect(
        stores.whatsapp_provider_cleanup_jobs.get(`cleanup_conn_${started.connectionId}`)!
          .organization_id
      ).toBe('other-org');
    });

    it('R7B23R-C. strong-settlement evidence invalidation fails closed with ZERO partial settlement', async () => {
      const { connId } = seedMaterializedConnectingLocal();
      // Simulate a concurrent worker rotating the WABA lease after provider cleanup was proven.
      (mockProvider.unsubscribeMessagingAccountApps as any).mockImplementationOnce(async () => {
        const lock = stores.whatsapp_waba_lifecycle_locks.get(`lock_meta_${WABA_ID}`);
        stores.whatsapp_waba_lifecycle_locks.set(`lock_meta_${WABA_ID}`, {
          ...lock,
          lease_token: 'mutated-by-concurrent-worker',
        });
        return { success: true };
      });

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.succeededCount).toBe(0);

      // Secret still exists; connection still connecting; claim remains; job not succeeded.
      expect(stores.whatsapp_connection_secrets.get(connId)).toBeDefined();
      expect(stores.whatsapp_connections.get(connId)!.status).toBe('connecting');
      const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
      expect(stores.whatsapp_provider_identity_claims.get(claimId)).toBeDefined();
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(job!.status).not.toBe('succeeded');
      expect(job!.provider_cleanup_proof).not.toBe('proven');
      // Capacity retained.
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });

    it('R7B23R-D. successful strong settlement atomically settles lock, deletes secret, disconnects, marks job succeeded', async () => {
      const { connId } = seedMaterializedConnectingLocal();
      (mockProvider.unsubscribeMessagingAccountApps as any).mockResolvedValueOnce({ success: true });

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.succeededCount).toBeGreaterThanOrEqual(1);

      const lock = await lockRepo.getLock(WABA_ID);
      expect(lock!.operation_status).toBe('idle');
      expect(lock!.provider_observed_state).toBe('unsubscribed');
      expect(lock!.lease_token).toBeNull();

      expect(stores.whatsapp_connection_secrets.get(connId)).toBeUndefined();
      const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
      expect(stores.whatsapp_provider_identity_claims.get(claimId)).toBeUndefined();

      const conn = stores.whatsapp_connections.get(connId)!;
      expect(conn.status).toBe('disconnected');
      expect(conn.pending_expires_at).toBeNull();

      const job = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(job!.status).toBe('succeeded');
      expect(job!.provider_cleanup_proof).toBe('proven');

      // Capacity released strictly because disconnected is committed.
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(0);
    });

    it('R7B23R-E. a foreign-owned claim survives a successful strong settlement', async () => {
      const { connId } = seedMaterializedConnectingLocal({ claimOwnedByOther: true });
      (mockProvider.unsubscribeMessagingAccountApps as any).mockResolvedValueOnce({ success: true });

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.succeededCount).toBeGreaterThanOrEqual(1);

      const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
      const claim = stores.whatsapp_provider_identity_claims.get(claimId);
      expect(claim).toBeDefined();
      expect(claim!.organization_id).toBe('other-org');
      expect(claim!.connection_id).toBe('other-conn');
      // The owned settlement still completed.
      expect(stores.whatsapp_connection_secrets.get(connId)).toBeUndefined();
      expect((await cleanupJobRepo.getJob(`cleanup_conn_${connId}`))!.status).toBe('succeeded');
    });

    it('R7B23R-F. unresolved subscribe debt prevents ALL destructive local settlement', async () => {
      const { connId } = seedMaterializedConnectingLocal({ lockUnresolvedSubscribe: true });
      (mockProvider.unsubscribeMessagingAccountApps as any).mockResolvedValueOnce({ success: true });

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.exhaustedCount).toBeGreaterThanOrEqual(1);

      expect(stores.whatsapp_connection_secrets.get(connId)).toBeDefined();
      expect(stores.whatsapp_connections.get(connId)!.status).toBe('connecting');
      const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
      expect(stores.whatsapp_provider_identity_claims.get(claimId)).toBeDefined();
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(job!.status).toBe('exhausted');
      expect(job!.last_error_code).toBe('UNRESOLVED_REMOTE_SUBSCRIBE_DEBT');
      const lock = await lockRepo.getLock(WABA_ID);
      expect(
        lock!.unresolved_remote_mutations.some(
          (m) => m.operation === 'subscribe' && m.status === 'unknown_outcome'
        )
      ).toBe(true);
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });

    it('R7B23R-G. transport/network uncertainty after dispatch is UNKNOWN and retry performs ZERO additional subscribe calls', async () => {
      const started = await startOnboarding();
      stores.whatsapp_onboarding_sessions.set(started.sessionId, {
        ...stores.whatsapp_onboarding_sessions.get(started.sessionId),
        status: 'credential_staged',
        provider_progress: 'phone_registered',
      });
      stageSecret(started.connectionId);

      (mockProvider.subscribeMessagingAccountApps as any).mockRejectedValueOnce(
        new AppError(502, 'socket hang up', {
          code: 'PROVIDER_SUBSCRIPTION_FAILED',
          transportUncertainty: true,
        })
      );

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 502, details: { code: 'PROVIDER_SUBSCRIPTION_FAILED' } });

      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
      const lock = await lockRepo.getLock(WABA_ID);
      expect(lock!.operation_status).toBe('unknown_outcome');
      expect(
        lock!.unresolved_remote_mutations.some(
          (m) => m.operation === 'subscribe' && m.status === 'unknown_outcome'
        )
      ).toBe(true);
      const recon = await reconJobRepo.getJob(WABA_ID);
      expect(recon).not.toBeNull();
      expect(recon!.status).toBe('pending');

      // Retry: no blind re-subscribe; D7 reconciliation owns convergence.
      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
    });

    it.each([500, 503])('R7B23R-N. HTTP %i after subscribe dispatch is UNKNOWN and retry performs ZERO additional subscribes', async (httpStatus) => {
      const started = await startOnboarding();
      stores.whatsapp_onboarding_sessions.set(started.sessionId, {
        ...stores.whatsapp_onboarding_sessions.get(started.sessionId),
        status: 'credential_staged',
        provider_progress: 'phone_registered',
      });
      stageSecret(started.connectionId);

      (mockProvider.subscribeMessagingAccountApps as any).mockRejectedValueOnce(
        new AppError(502, `Meta HTTP ${httpStatus}`, {
          code: 'PROVIDER_SUBSCRIPTION_FAILED',
          httpStatus,
          providerRejection: false,
        })
      );

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 502 });

      const lock = await lockRepo.getLock(WABA_ID);
      expect(lock!.operation_status).toBe('unknown_outcome');
      expect(lock!.unresolved_remote_mutations.some((m) => m.operation === 'subscribe' && m.status === 'unknown_outcome')).toBe(true);
      expect((await reconJobRepo.getJob(WABA_ID))!.id).toBe(`recon_meta_${WABA_ID}`);

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 409 });
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
    });

    it('R7B23R-H. an authoritative provider rejection remains safely retryable', async () => {
      const started = await startOnboarding();
      stores.whatsapp_onboarding_sessions.set(started.sessionId, {
        ...stores.whatsapp_onboarding_sessions.get(started.sessionId),
        status: 'credential_staged',
        provider_progress: 'phone_registered',
      });
      stageSecret(started.connectionId);

      (mockProvider.subscribeMessagingAccountApps as any).mockRejectedValueOnce(
        new AppError(502, 'Meta rejected subscribe', {
          code: 'PROVIDER_SUBSCRIPTION_FAILED',
          providerRejection: true,
        })
      );

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 502 });

      // The lease is released as idle: no ambiguity debt.
      const lock = await lockRepo.getLock(WABA_ID);
      expect(lock!.operation_status).toBe('idle');
      expect(
        lock!.unresolved_remote_mutations.some((m) => m.status === 'unknown_outcome')
      ).toBe(false);

      const result = await connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
        sessionId: started.sessionId,
        stateNonce: started.nonce,
        code: 'already_used_code',
        wabaId: WABA_ID,
        phoneNumberId: PHONE_NUMBER_ID,
      });
      expect(result.status).toBe('connected');
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(2);
    });

    it('R7B23R-I. TOCTOU: ambiguity appearing after the pre-flight read rejects the lease acquisition before dispatch', async () => {
      const started = await startOnboarding();
      stores.whatsapp_onboarding_sessions.set(started.sessionId, {
        ...stores.whatsapp_onboarding_sessions.get(started.sessionId),
        status: 'credential_staged',
        provider_progress: 'phone_registered',
      });
      stageSecret(started.connectionId);
      seedLock({
        operationStatus: 'unknown_outcome',
        unresolved: [
          {
            operation_generation: 2,
            operation: 'subscribe',
            dispatched_at: new Date().toISOString(),
            status: 'unknown_outcome',
            connection_id: started.connectionId,
          },
        ],
      });

      // Earlier observation is stale/clean; the ambiguity is only visible at acquisition time.
      vi.spyOn(lockRepo, 'getLock').mockResolvedValueOnce(null as any);

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED' },
      });

      expect(mockProvider.subscribeMessagingAccountApps).not.toHaveBeenCalled();
      const recon = await reconJobRepo.getJob(WABA_ID);
      expect(recon).not.toBeNull();
      expect(recon!.status).toBe('pending');
    });

    it('R7B23R-J. missing pending_expires_at never creates a cleanup job due "now" and never releases capacity', async () => {
      const started = await materializedDenialWithTtl('missing');

      expect(
        stores.whatsapp_provider_cleanup_jobs.get(`cleanup_conn_${started.connectionId}`)
      ).toBeUndefined();
      // Connection preserved (not committed to the restricted state), capacity retained.
      expect(stores.whatsapp_connections.get(started.connectionId)!.status).toBe('pending');
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });

    it('R7B23R-K. malformed pending_expires_at behaves fail-closed identically', async () => {
      const started = await materializedDenialWithTtl('not-a-valid-date');

      expect(
        stores.whatsapp_provider_cleanup_jobs.get(`cleanup_conn_${started.connectionId}`)
      ).toBeUndefined();
      expect(stores.whatsapp_connections.get(started.connectionId)!.status).toBe('pending');
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });

    it('R7B23R-L. valid original pending_expires_at schedules cleanup_conn exactly at the immutable timestamp', async () => {
      const started = await restrictAtStep10();

      const job = await cleanupJobRepo.getJob(`cleanup_conn_${started.connectionId}`);
      expect(job).not.toBeNull();
      expect(job!.next_attempt_at).toBe(started.originalTtl);
      expect(new Date(job!.next_attempt_at).getTime()).toBe(new Date(started.originalTtl).getTime());
      // The connection retains the ORIGINAL immutable deadline (non-sliding).
      expect(stores.whatsapp_connections.get(started.connectionId)!.pending_expires_at).toBe(
        started.originalTtl
      );
      expect(new Date(started.originalTtl).getTime()).toBeGreaterThan(Date.now());
    });

    it('R7B23R-M. cleanup worker fails closed when the materialized deadline is missing (no destructive settlement)', async () => {
      const { connId } = seedMaterializedConnectingLocal();
      const conn = stores.whatsapp_connections.get(connId)!;
      delete (conn as any).pending_expires_at;

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.succeededCount).toBe(0);
      expect(mockProvider.unsubscribeMessagingAccountApps).not.toHaveBeenCalled();

      expect(stores.whatsapp_connection_secrets.get(connId)).toBeDefined();
      expect(stores.whatsapp_connections.get(connId)!.status).toBe('connecting');
      const job = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(job!.status).toBe('retry_wait');
      expect(job!.last_error_code).toBe('ONBOARDING_DEADLINE_INTEGRITY_VIOLATION');
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });

    it('R7B23R-O. matching lease/generation without a durable cleanup observation cannot destructively settle', async () => {
      const { connId } = seedMaterializedConnectingLocal();
      const jobId = `cleanup_conn_${connId}`;
      const jobLease = 'job-lease-no-proof';
      const wabaLease = 'waba-lease-no-proof';
      const job = stores.whatsapp_provider_cleanup_jobs.get(jobId)!;
      stores.whatsapp_provider_cleanup_jobs.set(jobId, { ...job, status: 'processing', lease_token: jobLease });
      const lock = stores.whatsapp_waba_lifecycle_locks.get(`lock_meta_${WABA_ID}`)!;
      stores.whatsapp_waba_lifecycle_locks.set(`lock_meta_${WABA_ID}`, {
        ...lock,
        lease_token: wabaLease,
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        current_holder_id: 'cleanup-owner',
      });

      await expect(
        cleanupJobRepo.finalizeMetaCleanupOnStrongSettlement(jobId, jobLease, {
          wabaId: WABA_ID,
          generation: lock.operation_generation,
          leaseToken: wabaLease,
        })
      ).rejects.toMatchObject({ statusCode: 409, details: { code: 'WABA_STRONG_CLEANUP_PROOF_MISSING' } });
      expect(stores.whatsapp_connection_secrets.get(connId)).toBeDefined();
      expect(stores.whatsapp_provider_identity_claims.get(getClaimId('meta_cloud_api', PHONE_NUMBER_ID))).toBeDefined();
      expect(stores.whatsapp_connections.get(connId)!.status).toBe('connecting');
      expect((await cleanupJobRepo.getJob(jobId))!.status).not.toBe('succeeded');
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });

    it('R7B23R-P. an older-generation provider observation cannot settle the current WABA generation', async () => {
      const { connId } = seedMaterializedConnectingLocal();
      const jobId = `cleanup_conn_${connId}`;
      const jobLease = 'job-lease-old-proof';
      const wabaLease = 'waba-lease-old-proof';
      const job = stores.whatsapp_provider_cleanup_jobs.get(jobId)!;
      stores.whatsapp_provider_cleanup_jobs.set(jobId, { ...job, status: 'processing', lease_token: jobLease });
      const lock = stores.whatsapp_waba_lifecycle_locks.get(`lock_meta_${WABA_ID}`)!;
      stores.whatsapp_waba_lifecycle_locks.set(`lock_meta_${WABA_ID}`, {
        ...lock,
        lease_token: wabaLease,
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        current_holder_id: 'cleanup-owner',
        provider_observed_state: 'unsubscribed',
        provider_observed_at: new Date().toISOString(),
        provider_observed_generation: lock.operation_generation - 1,
      });

      await expect(
        cleanupJobRepo.finalizeMetaCleanupOnStrongSettlement(jobId, jobLease, {
          wabaId: WABA_ID,
          generation: lock.operation_generation,
          leaseToken: wabaLease,
        })
      ).rejects.toMatchObject({ statusCode: 409, details: { code: 'WABA_STRONG_CLEANUP_PROOF_MISSING' } });
      expect(stores.whatsapp_connection_secrets.get(connId)).toBeDefined();
      expect(stores.whatsapp_connections.get(connId)!.status).toBe('connecting');
      expect((await cleanupJobRepo.getJob(jobId))!.status).not.toBe('succeeded');
    });

    it('R7B23R-Q. a durable same-generation provider proof survives a crash before destructive finalization', async () => {
      const { connId } = seedMaterializedConnectingLocal();
      (mockProvider.unsubscribeMessagingAccountApps as any).mockResolvedValueOnce({ success: false });
      (mockProvider.checkMessagingAccountSubscribedApps as any).mockResolvedValueOnce({
        status: 'PROVEN_UNSUBSCRIBED',
        proof: 'PROVEN_CLEAN',
      });
      vi.spyOn(cleanupJobRepo, 'finalizeMetaCleanupOnStrongSettlement').mockRejectedValueOnce(
        new AppError(500, 'simulated process crash before destructive finalization')
      );

      const summary = await cleanupService.executeDueJobs({ batchSize: 5 });
      expect(summary.succeededCount).toBe(0);
      const lock = await lockRepo.getLock(WABA_ID);
      expect(lock!.provider_observed_state).toBe('unsubscribed');
      expect(lock!.provider_observed_generation).toBe(lock!.operation_generation);
      expect(lock!.lease_token).not.toBeNull();
      expect(stores.whatsapp_connection_secrets.get(connId)).toBeDefined();
      expect(stores.whatsapp_connections.get(connId)!.status).toBe('connecting');
      expect((await cleanupJobRepo.getJob(`cleanup_conn_${connId}`))!.status).not.toBe('succeeded');
    });

    it.each(['cancelled', 'succeeded', 'abandoned', 'exhausted'] as const)(
      'R7B23R-R. terminal/inert %s cleanup ownership blocks materialized denial without resurrection or partial writes',
      async (status) => {
        const started = await startOnboarding();
        const existing = {
          id: `cleanup_conn_${started.connectionId}`,
          organization_id: ORG_ID,
          connection_id: started.connectionId,
          provider: 'meta_cloud_api',
          provider_waba_id: WABA_ID,
          provider_phone_number_id: PHONE_NUMBER_ID,
          phone_number: CANONICAL_PHONE,
          status,
          attempt_count: status === 'exhausted' ? 5 : 1,
          max_attempts: 5,
          next_attempt_at: started.originalTtl,
          lease_token: null,
          lease_expires_at: null,
          last_attempt_started_at: null,
          last_error_code: status === 'exhausted' ? 'MAX_RETRIES_EXCEEDED' : null,
          last_error_at: null,
          provider_cleanup_proof: status === 'succeeded' ? 'proven' : status === 'cancelled' ? 'not_needed' : status === 'abandoned' ? 'overridden' : 'unproven',
          override_reason: null,
          manual_action_by: null,
          manual_action_at: null,
          manual_action_reason: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: status === 'exhausted' ? null : new Date().toISOString(),
          retention_expires_at: status === 'exhausted' ? null : new Date().toISOString(),
        };
        stores.whatsapp_provider_cleanup_jobs.set(existing.id, existing);

        await expect(
          cleanupJobRepo.commitMaterializedDenialOwnershipAtomically({
            organizationId: ORG_ID,
            connectionId: started.connectionId,
            sessionId: started.sessionId,
            wabaId: WABA_ID,
            phoneNumberId: PHONE_NUMBER_ID,
            normalizedPhoneNumber: CANONICAL_PHONE,
          })
        ).rejects.toMatchObject({ statusCode: 409, details: { code: 'CLEANUP_OWNERSHIP_NOT_LIVE' } });

        const jobAfter = stores.whatsapp_provider_cleanup_jobs.get(existing.id)!;
        expect(jobAfter.status).toBe(status);
        expect(jobAfter.attempt_count).toBe(status === 'exhausted' ? 5 : 1);
        expect(jobAfter.next_attempt_at).toBe(started.originalTtl);
        expect(stores.whatsapp_connections.get(started.connectionId)!.status).toBe('pending');
        expect(stores.whatsapp_onboarding_sessions.get(started.sessionId)!.provider_progress).not.toBe('waba_subscribed');
      }
    );

    it.each(['pending', 'retry_wait', 'processing'] as const)(
      'R7B23R-S. live %s cleanup ownership is reused without duplicate or deadline slide',
      async (status) => {
        const started = await startOnboarding();
        const originalDeadline = new Date(Date.now() + 3600_000).toISOString();
        const existing = {
          id: `cleanup_conn_${started.connectionId}`,
          organization_id: ORG_ID,
          connection_id: started.connectionId,
          provider: 'meta_cloud_api',
          provider_waba_id: WABA_ID,
          provider_phone_number_id: PHONE_NUMBER_ID,
          phone_number: CANONICAL_PHONE,
          status,
          attempt_count: 1,
          max_attempts: 5,
          next_attempt_at: originalDeadline,
          lease_token: status === 'processing' ? 'active-job-lease' : null,
          lease_expires_at: status === 'processing' ? new Date(Date.now() + 60_000).toISOString() : null,
          last_attempt_started_at: null,
          last_error_code: null,
          last_error_at: null,
          provider_cleanup_proof: null,
          override_reason: null,
          manual_action_by: null,
          manual_action_at: null,
          manual_action_reason: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: null,
          retention_expires_at: null,
        };
        stores.whatsapp_provider_cleanup_jobs.set(existing.id, existing);

        await cleanupJobRepo.commitMaterializedDenialOwnershipAtomically({
          organizationId: ORG_ID,
          connectionId: started.connectionId,
          sessionId: started.sessionId,
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          normalizedPhoneNumber: CANONICAL_PHONE,
        });

        const reused = stores.whatsapp_provider_cleanup_jobs.get(existing.id)!;
        expect(reused.status).toBe(status);
        expect(reused.next_attempt_at).toBe(originalDeadline);
        expect(stores.whatsapp_provider_cleanup_jobs.size).toBe(1);
        expect(stores.whatsapp_connections.get(started.connectionId)!.status).toBe('connecting');
      }
    );

    it('R7B24-A. pre-TTL commercial recovery under D7 subscribe ambiguity preserves the atomically materialized restricted lifecycle', async () => {
      const started = await restrictAtStep10();
      const cleanupJobId = `cleanup_conn_${started.connectionId}`;
      const originalTtl = started.originalTtl;

      // Commercial authority recovers, but D7 records an unresolved prior subscribe outcome before
      // recovery can advance. The onboarding path must route convergence to recon, never re-dispatch.
      upgradeToPremium();
      seedLock({
        operationStatus: 'unknown_outcome',
        unresolved: [
          {
            operation_generation: 9,
            operation: 'subscribe',
            dispatched_at: new Date().toISOString(),
            status: 'unknown_outcome',
            connection_id: started.connectionId,
          },
        ],
      });

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED' },
      });

      const conn = stores.whatsapp_connections.get(started.connectionId)!;
      const cleanup = await cleanupJobRepo.getJob(cleanupJobId);
      expect(conn.status).toBe('connecting');
      expect(conn.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      expect(conn.pending_expires_at).toBe(originalTtl);
      expect(stores.whatsapp_onboarding_sessions.get(started.sessionId)!.provider_progress).toBe('waba_subscribed');
      expect(cleanup!.status).toBe('pending');
      expect(cleanup!.next_attempt_at).toBe(originalTtl);
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
      expect((await reconJobRepo.getJob(WABA_ID))!.id).toBe(`recon_meta_${WABA_ID}`);
      expect(mockProvider.subscribeMessagingAccountApps).toHaveBeenCalledTimes(1);
    });

    it('R7B24-B. an invalid-CSRF completion attempt cannot terminalize a materialized restricted lifecycle without its cleanup owner', async () => {
      const started = await restrictAtStep10();
      const cleanupJobId = `cleanup_conn_${started.connectionId}`;

      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: 'invalid-nonce-from-untrusted-client',
          code: 'already_used_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
        })
      ).rejects.toMatchObject({ statusCode: 403, details: { code: 'INVALID_ONBOARDING_STATE' } });

      const conn = stores.whatsapp_connections.get(started.connectionId)!;
      const cleanup = await cleanupJobRepo.getJob(cleanupJobId);
      expect(conn.status).toBe('connecting');
      expect(conn.status_reason).toBe('SUBSCRIPTION_RESTRICTED');
      expect(conn.pending_expires_at).toBe(started.originalTtl);
      expect(stores.whatsapp_onboarding_sessions.get(started.sessionId)!.provider_progress).toBe('waba_subscribed');
      expect(cleanup!.status).toBe('pending');
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });

    it('R7B24-C. existing exhausted cleanup job fails closed on materialized commercial denial without re-arm or partial writes', async () => {
      const started = await startOnboarding();
      const cleanupJobId = `cleanup_conn_${started.connectionId}`;
      const originalDeadline = started.originalTtl;

      // 1. Existing cleanup_conn_${connectionId} with status='exhausted'
      const existingJob: WhatsAppProviderCleanupJobRecord = {
        id: cleanupJobId,
        organization_id: ORG_ID,
        connection_id: started.connectionId,
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        phone_number: CANONICAL_PHONE,
        status: 'exhausted',
        attempt_count: 5,
        max_attempts: 5,
        next_attempt_at: originalDeadline,
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: new Date(Date.now() - 3600_000).toISOString(),
        last_error_code: 'MAX_RETRIES_EXCEEDED',
        last_error_message: 'Max retries reached',
        last_error_at: new Date(Date.now() - 3600_000).toISOString(),
        provider_cleanup_proof: 'unproven',
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: new Date(Date.now() - 7200_000).toISOString(),
        updated_at: new Date(Date.now() - 3600_000).toISOString(),
        completed_at: null,
        retention_expires_at: null,
      };
      stores.whatsapp_provider_cleanup_jobs.set(cleanupJobId, existingJob);

      // Verify secret is staged
      stageSecret(started.connectionId);
      expect(stores.whatsapp_connection_secrets.get(started.connectionId)).toBeDefined();
      const secretBefore = JSON.stringify(stores.whatsapp_connection_secrets.get(started.connectionId));
      const connBefore = stores.whatsapp_connections.get(started.connectionId)!;
      const sessionBefore = stores.whatsapp_onboarding_sessions.get(started.sessionId)!;

      // 2. Materialized Step 10 commercial denial occurs
      (mockProvider.subscribeMessagingAccountApps as any).mockImplementationOnce(async () => {
        const sub = stores.ministry_subscriptions.get(ANCHOR_MINISTRY_ID);
        stores.ministry_subscriptions.set(ANCHOR_MINISTRY_ID, { ...sub, plan_id: 'pro' }); // 0 included connections
      });

      // 3. Operation fails closed
      await expect(
        connectionService.completeOnboarding(ORG_ID, ADMIN_USER_ID, {
          sessionId: started.sessionId,
          stateNonce: started.nonce,
          code: 'single_use_code',
          wabaId: WABA_ID,
          phoneNumberId: PHONE_NUMBER_ID,
          pin: '123456',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'CLEANUP_OWNERSHIP_NOT_LIVE' },
      });

      // 4. Connection/session are not changed to new restricted materialized state
      const connAfter = stores.whatsapp_connections.get(started.connectionId)!;
      expect(connAfter.status).toBe('pending');
      expect(connAfter.status).toBe(connBefore.status);
      expect(connAfter.status_reason).toBe(connBefore.status_reason);
      expect(connAfter.pending_expires_at).toBe(connBefore.pending_expires_at);

      const sessionAfter = stores.whatsapp_onboarding_sessions.get(started.sessionId)!;
      expect(sessionAfter.provider_progress).not.toBe('waba_subscribed');
      expect(sessionAfter.status).not.toBe('consumed');
      expect(sessionAfter.status).toBe('credential_staged');

      // 5. Job is not re-armed
      const jobAfter = stores.whatsapp_provider_cleanup_jobs.get(cleanupJobId)!;
      expect(jobAfter.status).toBe('exhausted');

      // 6. Attempt_count is unchanged
      expect(jobAfter.attempt_count).toBe(5);

      // 7. Next_attempt_at is unchanged
      expect(jobAfter.next_attempt_at).toBe(originalDeadline);

      // 8. Secret, provider evidence and commercial capacity remain intact
      const secret = stores.whatsapp_connection_secrets.get(started.connectionId)!;
      expect(secret).toBeDefined();
      expect(
        encryptionService.decryptToken(
          secret,
          ORG_ID,
          started.connectionId
        )
      ).toBe('EAAG_mock_business_token_r7b23');
      expect(stores.whatsapp_connections.size).toBe(1);
      // Commercial capacity: connection remains pending reservation, capacity usage preserved
      expect(await connectionRepo.countConfiguredConnections(ORG_ID)).toBe(1);
    });
  });

  // =========================================================================
  // R7-B2.4R2A — Meta Disconnect Cleanup Ownership Atomicity
  // =========================================================================

  describe('R7-B2.4R2A — Meta Disconnect Cleanup Ownership Atomicity', () => {
    async function seedConnectedMetaConnection(params?: {
      pendingExpiresAt?: string | null;
    }): Promise<{
      conn: any;
      claimId: string;
    }> {
      const conn = await connectionRepo.createConnection({
        organization_id: ORG_ID,
        display_name: 'Linha Meta Teste',
        created_by_user_id: ADMIN_USER_ID,
        status: 'connected',
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        phone_number: CANONICAL_PHONE,
        pending_expires_at: params?.pendingExpiresAt ?? null,
      });

      const claimId = getClaimId('meta_cloud_api', PHONE_NUMBER_ID);
      stores.whatsapp_provider_identity_claims.set(claimId, {
        id: claimId,
        provider: 'meta_cloud_api',
        provider_phone_number_id: PHONE_NUMBER_ID,
        organization_id: ORG_ID,
        connection_id: conn.id,
        phone_number: CANONICAL_PHONE,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      stageSecret(conn.id);
      seedLock({ operationStatus: 'idle' });

      return { conn, claimId };
    }

    it('A. transaction failure while creating/updating cleanup ownership: local disconnect does NOT commit, claim remains, connection remains in prior state', async () => {
      const { conn, claimId } = await seedConnectedMetaConnection();
      const cleanupJobId = `cleanup_conn_${conn.id}`;

      // Simulate a failure during cleanup job write inside the transaction
      const origRunTx = db.runTransaction.bind(db);
      vi.spyOn(db, 'runTransaction').mockImplementationOnce(async (callback: any) => {
        return await origRunTx(async (tx: any) => {
          const origSet = tx.set.bind(tx);
          tx.set = vi.fn().mockImplementation((ref: any, data: any) => {
            if (ref.id === cleanupJobId) {
              throw new Error('SIMULATED_FIRESTORE_CLEANUP_JOB_WRITE_CRASH');
            }
            return origSet(ref, data);
          });
          return await callback(tx);
        });
      });

      await expect(
        connectionService.disconnectConnection(ORG_ID, conn.id, ADMIN_USER_ID)
      ).rejects.toThrow('SIMULATED_FIRESTORE_CLEANUP_JOB_WRITE_CRASH');

      // Local disconnect did NOT commit
      const connAfter = stores.whatsapp_connections.get(conn.id)!;
      expect(connAfter.status).toBe('connected');
      expect(connAfter.status_reason).not.toBe('USER_DISCONNECTED');

      // Claim remains
      expect(stores.whatsapp_provider_identity_claims.get(claimId)).toBeDefined();
      expect(stores.whatsapp_provider_identity_claims.get(claimId)?.connection_id).toBe(conn.id);

      // Secret remains intact
      expect(stores.whatsapp_connection_secrets.get(conn.id)).toBeDefined();

      // No partial cleanup job created
      expect(stores.whatsapp_provider_cleanup_jobs.get(cleanupJobId)).toBeUndefined();
    });

    it('B. successful explicit Meta disconnect: connection disconnected, cleanup ownership exists atomically, secret/evidence/capacity retained', async () => {
      const { conn, claimId } = await seedConnectedMetaConnection();
      const cleanupJobId = `cleanup_conn_${conn.id}`;
      const nowBefore = new Date().toISOString();

      await connectionService.disconnectConnection(ORG_ID, conn.id, ADMIN_USER_ID);

      // Connection is disconnected
      const connAfter = stores.whatsapp_connections.get(conn.id)!;
      expect(connAfter.status).toBe('disconnected');
      expect(connAfter.status_reason).toBe('USER_DISCONNECTED');
      expect(connAfter.pending_expires_at).toBeNull();

      // Cleanup ownership exists atomically
      const job = stores.whatsapp_provider_cleanup_jobs.get(cleanupJobId);
      expect(job).toBeDefined();
      expect(job.status).toBe('pending');
      expect(job.provider).toBe('meta_cloud_api');
      expect(job.provider_waba_id).toBe(WABA_ID);
      expect(job.provider_phone_number_id).toBe(PHONE_NUMBER_ID);
      expect(job.waba_claim_generation).toBe(3);
      expect(new Date(job.next_attempt_at).getTime()).toBeGreaterThanOrEqual(new Date(nowBefore).getTime());

      // Provider claim remains (DEFECT 2 fix verification)
      expect(stores.whatsapp_provider_identity_claims.get(claimId)).toBeDefined();
      expect(stores.whatsapp_provider_identity_claims.get(claimId)?.connection_id).toBe(conn.id);

      // Secret is retained for cleanup execution (deleted upon strong settlement proof)
      expect(stores.whatsapp_connection_secrets.get(conn.id)).toBeDefined();
    });

    it('C. existing compatible live cleanup job: no duplicate, no blind overwrite of evidence, processing status not clobbered', async () => {
      const { conn } = await seedConnectedMetaConnection();
      const cleanupJobId = `cleanup_conn_${conn.id}`;
      const createdAt = new Date(Date.now() - 3600_000).toISOString();
      const lastErrorAt = new Date(Date.now() - 1800_000).toISOString();

      // Case C1: Existing job is retry_wait with accumulated attempts and error evidence
      stores.whatsapp_provider_cleanup_jobs.set(cleanupJobId, {
        id: cleanupJobId,
        organization_id: ORG_ID,
        connection_id: conn.id,
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        phone_number: CANONICAL_PHONE,
        status: 'retry_wait',
        attempt_count: 3,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() + 600_000).toISOString(), // 10m in future
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: lastErrorAt,
        last_error_code: 'RATE_LIMIT_EXCEEDED',
        last_error_at: lastErrorAt,
        provider_cleanup_proof: 'unproven',
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: createdAt,
        updated_at: lastErrorAt,
        completed_at: null,
        retention_expires_at: null,
      });

      const disconnectStart = new Date().toISOString();
      await connectionService.disconnectConnection(ORG_ID, conn.id, ADMIN_USER_ID);

      const jobAfter = stores.whatsapp_provider_cleanup_jobs.get(cleanupJobId)!;
      // No duplicate job created
      expect(stores.whatsapp_provider_cleanup_jobs.size).toBe(1);
      // Status updated to pending for immediate execution
      expect(jobAfter.status).toBe('pending');
      expect(new Date(jobAfter.next_attempt_at).getTime()).toBeGreaterThanOrEqual(new Date(disconnectStart).getTime());
      // Prior evidence is NOT blindly overwritten
      expect(jobAfter.attempt_count).toBe(3);
      expect(jobAfter.last_error_code).toBe('RATE_LIMIT_EXCEEDED');
      expect(jobAfter.last_error_at).toBe(lastErrorAt);
      expect(jobAfter.created_at).toBe(createdAt);
      expect(jobAfter.provider_cleanup_proof).toBe('unproven');

      // Case C2: Existing job is processing (worker currently executing)
      const leaseToken = 'lease-active-xyz';
      const leaseExpiresAt = new Date(Date.now() + 30_000).toISOString();
      jobAfter.status = 'processing';
      jobAfter.lease_token = leaseToken;
      jobAfter.lease_expires_at = leaseExpiresAt;
      stores.whatsapp_connections.set(conn.id, { ...conn, status: 'connected' }); // re-arm connection

      await connectionService.disconnectConnection(ORG_ID, conn.id, ADMIN_USER_ID);

      const jobProcessing = stores.whatsapp_provider_cleanup_jobs.get(cleanupJobId)!;
      // Processing status and lease MUST NOT be clobbered by disconnect
      expect(jobProcessing.status).toBe('processing');
      expect(jobProcessing.lease_token).toBe(leaseToken);
      expect(jobProcessing.lease_expires_at).toBe(leaseExpiresAt);
      expect(jobProcessing.attempt_count).toBe(3);
    });

    it('D. existing incompatible/terminal cleanup job: fails closed, no partial disconnect', async () => {
      const { conn, claimId } = await seedConnectedMetaConnection();
      const cleanupJobId = `cleanup_conn_${conn.id}`;

      // Case D1: Terminal job (exhausted)
      stores.whatsapp_provider_cleanup_jobs.set(cleanupJobId, {
        id: cleanupJobId,
        organization_id: ORG_ID,
        connection_id: conn.id,
        provider: 'meta_cloud_api',
        provider_waba_id: WABA_ID,
        provider_phone_number_id: PHONE_NUMBER_ID,
        phone_number: CANONICAL_PHONE,
        status: 'exhausted',
        attempt_count: 5,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 3600_000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: 'MAX_RETRIES_EXCEEDED',
        last_error_at: null,
        provider_cleanup_proof: 'unproven',
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: new Date(Date.now() - 7200_000).toISOString(),
        updated_at: new Date(Date.now() - 3600_000).toISOString(),
        completed_at: null,
        retention_expires_at: null,
      });

      await expect(
        connectionService.disconnectConnection(ORG_ID, conn.id, ADMIN_USER_ID)
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'CLEANUP_OWNERSHIP_NOT_LIVE' },
      });

      // No partial disconnect
      const connAfterExhausted = stores.whatsapp_connections.get(conn.id)!;
      expect(connAfterExhausted.status).toBe('connected');
      expect(stores.whatsapp_provider_identity_claims.get(claimId)).toBeDefined();
      expect(stores.whatsapp_connection_secrets.get(conn.id)).toBeDefined();
      expect(stores.whatsapp_provider_cleanup_jobs.get(cleanupJobId)!.status).toBe('exhausted');

      // Case D2: Conflicting ownership (wrong WABA ID)
      stores.whatsapp_provider_cleanup_jobs.set(cleanupJobId, {
        ...stores.whatsapp_provider_cleanup_jobs.get(cleanupJobId)!,
        status: 'pending',
        provider_waba_id: 'waba-foreign-conflict',
      });

      await expect(
        connectionService.disconnectConnection(ORG_ID, conn.id, ADMIN_USER_ID)
      ).rejects.toMatchObject({
        statusCode: 409,
        details: { code: 'CLEANUP_OWNERSHIP_CONFLICT' },
      });

      // No partial disconnect
      const connAfterConflict = stores.whatsapp_connections.get(conn.id)!;
      expect(connAfterConflict.status).toBe('connected');
      expect(stores.whatsapp_provider_identity_claims.get(claimId)).toBeDefined();
      expect(stores.whatsapp_connection_secrets.get(conn.id)).toBeDefined();
    });

    it('E. explicit disconnect scheduling is immediate and does not pretend original recovery TTL still governs', async () => {
      const in24Hours = new Date(Date.now() + 86400_000).toISOString();
      const { conn } = await seedConnectedMetaConnection();
      stores.whatsapp_connections.set(conn.id, {
        ...stores.whatsapp_connections.get(conn.id),
        status: 'connecting',
        status_reason: 'SUBSCRIPTION_RESTRICTED',
        pending_expires_at: in24Hours,
      });
      const cleanupJobId = `cleanup_conn_${conn.id}`;

      expect(stores.whatsapp_connections.get(conn.id)!.pending_expires_at).toBe(in24Hours);

      const beforeDisconnect = new Date().toISOString();
      await connectionService.disconnectConnection(ORG_ID, conn.id, ADMIN_USER_ID);

      const connAfter = stores.whatsapp_connections.get(conn.id)!;
      expect(connAfter.status).toBe('disconnected');
      expect(connAfter.pending_expires_at).toBeNull();

      const job = stores.whatsapp_provider_cleanup_jobs.get(cleanupJobId)!;
      expect(job.status).toBe('pending');
      // Next attempt at is immediate (around now), NOT in 24 hours!
      expect(new Date(job.next_attempt_at).getTime()).toBeGreaterThanOrEqual(new Date(beforeDisconnect).getTime());
      expect(new Date(job.next_attempt_at).getTime()).toBeLessThan(new Date(in24Hours).getTime() - 80000_000);
    });
  });
});

