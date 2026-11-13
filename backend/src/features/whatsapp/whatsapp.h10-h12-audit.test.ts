import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppReconciliationService } from './whatsapp-reconciliation.service';
import { WhatsAppCleanupService } from './whatsapp-cleanup.service';
import { ZernioHttpClient } from './zernio-http-client';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppProviderCleanupJobRepository } from '../../repositories/WhatsAppProviderCleanupJobRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { BillingRepository } from '../../repositories/BillingRepository';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { WhatsAppExecutionDeadline } from './whatsapp-execution-deadline';
import { getZernioAccountClaimId, getZernioPhoneClaimId } from './whatsapp.types';

describe('WhatsApp H10 / H11 / H12 Adversarial Audit Regressions', () => {
  const orgId = 'org-audit-wa-1';
  const adminUserId = 'user-admin-wa-1';
  const now = '2026-11-13T10:00:00.000Z';

  let stores: Record<string, Map<string, any>>;
  let connectionRepo: WhatsAppConnectionRepository;
  let cleanupJobRepo: WhatsAppProviderCleanupJobRepository;
  let reconJobRepo: WhatsAppWabaReconciliationJobRepository;
  let whatsappService: WhatsAppConnectionService;

  beforeEach(() => {
    vi.clearAllMocks();
    stores = {
      organizations: new Map(),
      organization_members: new Map(),
      ministries: new Map(),
      ministry_subscriptions: new Map(),
      whatsapp_connections: new Map(),
      whatsapp_connection_secrets: new Map(),
      whatsapp_provider_identity_claims: new Map(),
      whatsapp_ministry_assignment_claims: new Map(),
      whatsapp_provider_cleanup_jobs: new Map(),
      whatsapp_waba_reconciliation_jobs: new Map(),
    };

    stores.organizations.set(orgId, {
      id: orgId,
      name: 'Igreja Teste',
      slug: 'igreja-teste',
      owner_user_id: adminUserId,
      billing_anchor_ministry_id: 'min-wa-1',
      default_whatsapp_connection_id: null,
      created_at: now,
      updated_at: now,
    });
    stores.organization_members.set(`${orgId}_${adminUserId}`, {
      id: `${orgId}_${adminUserId}`,
      organization_id: orgId,
      user_id: adminUserId,
      role: 'owner',
    });

    const makeDocRef = (colName: string, docId: string) => ({
      id: docId,
      get: vi.fn(async () => {
        const store = stores[colName] || new Map();
        const data = store.get(docId);
        return {
          exists: Boolean(data),
          id: docId,
          data: () => (data ? { ...data } : undefined),
        };
      }),
      set: vi.fn(async (data: any) => {
        const store = (stores[colName] ||= new Map());
        store.set(docId, { id: docId, ...data });
      }),
      update: vi.fn(async (data: any) => {
        const store = (stores[colName] ||= new Map());
        const current = store.get(docId) || {};
        store.set(docId, { ...current, ...data, id: docId });
      }),
      delete: vi.fn(async () => {
        stores[colName]?.delete(docId);
      }),
    });

    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      const store = (stores[colName] ||= new Map());
      return {
        doc: vi.fn((docId: string) => makeDocRef(colName, docId)),
        where: vi.fn((field: string, op: string, val: any) => {
          const filters = [{ field, op, val }];
          const q: any = {
            where: vi.fn((f2: string, o2: string, v2: any) => {
              filters.push({ field: f2, op: o2, val: v2 });
              return q;
            }),
            orderBy: vi.fn(() => q),
            limit: vi.fn(() => q),
            get: vi.fn(async () => {
              let docs = Array.from(store.values());
              for (const f of filters) {
                if (f.op === '==') docs = docs.filter((d) => d[f.field] === f.val);
                if (f.op === 'in') docs = docs.filter((d) => Array.isArray(f.val) && f.val.includes(d[f.field]));
                if (f.op === '<=') docs = docs.filter((d) => d[f.field] <= f.val);
              }
              return {
                docs: docs.map((d) => ({
                  id: d.id,
                  exists: true,
                  ref: makeDocRef(colName, d.id),
                  data: () => ({ ...d }),
                })),
                empty: docs.length === 0,
              };
            }),
          };
          return q;
        }),
      };
    });

    vi.spyOn(db, 'runTransaction').mockImplementation(async (callback: any) => {
      const tx: any = {
        get: vi.fn(async (docRef: any) => await docRef.get()),
        set: vi.fn((docRef: any, data: any) => {
          docRef.set(data);
        }),
        update: vi.fn((docRef: any, data: any) => {
          docRef.update(data);
        }),
        delete: vi.fn((docRef: any) => {
          docRef.delete();
        }),
      };
      return await callback(tx);
    });

    connectionRepo = new WhatsAppConnectionRepository();
    cleanupJobRepo = new WhatsAppProviderCleanupJobRepository();
    reconJobRepo = new WhatsAppWabaReconciliationJobRepository();
    const orgRepo = new OrganizationRepository();
    const subService = new SubscriptionService(new SubscriptionRepository(), new BillingRepository(), orgRepo);
    whatsappService = new WhatsAppConnectionService(
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppProviderIdentityClaimRepository(),
      orgRepo,
      subService,
      new MinistryRepository()
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('H10a: transitionZernioConnectedAtomically refuses to resurrect a USER_DISCONNECTED connection back to connected', async () => {
    const connId = 'conn-h10-disc';
    const accountId = 'acc_h10_1';
    const phone = '+5511999990010';
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_1',
      provider_account_id: accountId,
      phone_number: phone,
      status: 'disconnected',
      status_reason: 'USER_DISCONNECTED',
      created_at: now,
      updated_at: now,
    });
    stores.whatsapp_provider_identity_claims.set(getZernioAccountClaimId(accountId), {
      id: getZernioAccountClaimId(accountId),
      organization_id: orgId,
      connection_id: connId,
    });
    stores.whatsapp_provider_identity_claims.set(getZernioPhoneClaimId(phone), {
      id: getZernioPhoneClaimId(phone),
      organization_id: orgId,
      connection_id: connId,
    });

    await expect(
      whatsappService.transitionZernioConnectedAtomically({
        orgId,
        connectionId: connId,
        providerAccountId: accountId,
        providerProfileId: 'prof_1',
        phoneNumber: phone,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(stores.whatsapp_connections.get(connId)?.status).toBe('disconnected');
    expect(stores.whatsapp_waba_reconciliation_jobs.has(`recon_zernio_${connId}`)).toBe(false);
  });

  it('H10b: materializeZernioProviderIdentity rejects if connection was already disconnected by the user', async () => {
    const connId = 'conn-h10-mat';
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_1',
      provider_account_id: null,
      phone_number: null,
      status: 'disconnected',
      status_reason: 'USER_DISCONNECTED',
      created_at: now,
      updated_at: now,
    });

    await expect(
      connectionRepo.materializeZernioProviderIdentity({
        organizationId: orgId,
        connectionId: connId,
        providerProfileId: 'prof_1',
        providerAccountId: 'acc_late_mat',
        phoneNumber: '+5511999990011',
      })
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(stores.whatsapp_connections.get(connId)?.provider_account_id).toBeNull();
  });

  it('H10c: WhatsAppReconciliationService does not resurrect connection disconnected while getWhatsAppNumberInfo is in flight', async () => {
    const connId = 'conn-h10-recon';
    const accountId = 'acc_recon_1';
    const phone = '+5511999990012';
    const jobId = `recon_zernio_${connId}`;

    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_recon',
      provider_account_id: accountId,
      phone_number: phone,
      status: 'error',
      status_reason: 'ZERNIO_RECONCILIATION_REMOTE_DEAD',
      created_at: now,
      updated_at: now,
    });

    stores.whatsapp_waba_reconciliation_jobs.set(jobId, {
      id: jobId,
      provider: 'zernio',
      provider_waba_id: null,
      organization_id: orgId,
      connection_id: connId,
      provider_account_id: accountId,
      provider_profile_id: 'prof_recon',
      phone_number: phone,
      desired_state: 'connected',
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at: '2026-11-13T09:00:00.000Z',
      lease_token: null,
      lease_expires_at: null,
    });

    const mockZernioClient = {
      getWhatsAppNumberInfo: vi.fn(async () => {
        // Simulate concurrent user disconnect while remote health check was in flight!
        const c = stores.whatsapp_connections.get(connId);
        stores.whatsapp_connections.set(connId, {
          ...c,
          status: 'disconnected',
          status_reason: 'USER_DISCONNECTED',
          updated_at: new Date().toISOString(),
        });
        return {
          phone: {
            display_phone_number: phone,
            status: 'CONNECTED',
            platform_type: 'CLOUD_API',
          },
        };
      }),
    };

    const reconService = new WhatsAppReconciliationService(
      reconJobRepo,
      new WhatsAppWabaLifecycleLockRepository(),
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
      undefined as any,
      mockZernioClient as any,
      cleanupJobRepo
    );

    const summary = await reconService.executeDueJobs({
      batchSize: 5,
      deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
    });

    expect(summary.processedCount).toBe(1);
    expect(stores.whatsapp_connections.get(connId)?.status).toBe('disconnected');
    expect(stores.whatsapp_connections.get(connId)?.status_reason).toBe('USER_DISCONNECTED');
  });

  it('H11: disconnectConnection reads freshConn.provider_account_id inside transaction and creates cleanup job when materialized concurrently', async () => {
    const connId = 'conn-h11-race';
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_h11',
      provider_account_id: null,
      phone_number: null,
      assigned_ministry_id: null,
      status: 'pending',
      status_reason: null,
      created_at: now,
      updated_at: now,
    });

    // Simulate materialization occurring AFTER initial connection lookup in disconnectConnection
    // and BEFORE db.runTransaction starts
    vi.spyOn(connectionRepo, 'getConnectionById').mockImplementationOnce(async () => {
      const initialSnapshot = { ...stores.whatsapp_connections.get(connId) };
      stores.whatsapp_connections.set(connId, {
        ...initialSnapshot,
        provider_account_id: 'acc_materialized_in_race',
        phone_number: '+5511999990013',
      });
      return initialSnapshot;
    });

    await whatsappService.disconnectConnection(orgId, connId, adminUserId);

    const finalConn = stores.whatsapp_connections.get(connId);
    expect(finalConn?.status).toBe('disconnected');
    expect(finalConn?.status_reason).toBe('USER_DISCONNECTED');

    const cleanupJob = stores.whatsapp_provider_cleanup_jobs.get(`cleanup_conn_${connId}`);
    expect(cleanupJob).toBeDefined();
    expect(cleanupJob?.provider_account_id).toBe('acc_materialized_in_race');
    expect(cleanupJob?.status).toBe('pending');
  });

  it('H12: WhatsAppCleanupService does NOT settle cleanup when deleteAccount returns { success: false } or {}', async () => {
    const connId = 'conn-h12-cleanup';
    const jobId = `cleanup_conn_${connId}`;
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_h12',
      provider_account_id: 'acc_h12_1',
      phone_number: '+5511999990014',
      status: 'disconnected',
    });

    for (const deceptiveResponse of [{ success: false }, {}]) {
      stores.whatsapp_provider_cleanup_jobs.set(jobId, {
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: 'acc_h12_1',
        provider_profile_id: 'prof_h12',
        phone_number: '+5511999990014',
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: '2026-11-13T09:00:00.000Z',
        lease_token: null,
        lease_expires_at: null,
        unresolved_remote_mutations: [],
      });

      const mockZernioClient = {
        deleteAccount: vi.fn().mockResolvedValue(deceptiveResponse),
        listAccounts: vi.fn().mockResolvedValue([{ _id: 'acc_h12_1', platform: 'whatsapp' }]),
      };

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        new WhatsAppWabaLifecycleLockRepository(),
        reconJobRepo,
        connectionRepo,
        new WhatsAppConnectionSecretRepository(),
        new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
        undefined as any,
        mockZernioClient as any
      );

      const summary = await cleanupService.executeDueJobs({
        batchSize: 5,
        deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
      });

      expect(summary.succeededCount).toBe(0);
      expect(summary.retryWaitCount).toBe(1);
      const job = stores.whatsapp_provider_cleanup_jobs.get(jobId);
      expect(job?.status).not.toBe('succeeded');
    }
  });

  it('H12-FR1: WhatsAppCleanupService refuses settlement on negative/error message payload even with truthy message string', async () => {
    const connId = 'conn-h12-fr1';
    const jobId = `cleanup_conn_${connId}`;
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_h12_fr1',
      provider_account_id: 'acc_h12_fr1',
      phone_number: '+5511999990019',
      status: 'disconnected',
    });
    stores.whatsapp_provider_cleanup_jobs.set(jobId, {
      id: jobId,
      organization_id: orgId,
      connection_id: connId,
      provider: 'zernio',
      provider_waba_id: null,
      provider_phone_number_id: null,
      provider_account_id: 'acc_h12_fr1',
      provider_profile_id: 'prof_h12_fr1',
      phone_number: '+5511999990019',
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at: '2026-11-13T09:00:00.000Z',
      lease_token: null,
      lease_expires_at: null,
      unresolved_remote_mutations: [],
    });

    const mockZernioClient = {
      deleteAccount: vi.fn().mockResolvedValue({ message: 'Deletion failed', error: 'provider refused' }),
      listAccounts: vi.fn().mockResolvedValue([{ _id: 'acc_h12_fr1', platform: 'whatsapp' }]),
    };

    const cleanupService = new WhatsAppCleanupService(
      cleanupJobRepo,
      new WhatsAppWabaLifecycleLockRepository(),
      reconJobRepo,
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
      undefined as any,
      mockZernioClient as any
    );

    const summary = await cleanupService.executeDueJobs({
      batchSize: 5,
      deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
    });

    expect(summary.succeededCount).toBe(0);
    expect(summary.retryWaitCount).toBe(1);
    expect(stores.whatsapp_provider_cleanup_jobs.get(jobId)?.status).not.toBe('succeeded');
  });

  it('H10-FR2: disconnect before materialization durably schedules cleanup job for late remote account while preserving disconnected state', async () => {
    const connId = 'conn-h10-fr2';
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_fr2',
      provider_account_id: null,
      phone_number: null,
      status: 'disconnected',
      status_reason: 'USER_DISCONNECTED',
      created_at: now,
      updated_at: now,
    });

    await expect(
      connectionRepo.materializeZernioProviderIdentity({
        organizationId: orgId,
        connectionId: connId,
        providerProfileId: 'prof_fr2',
        providerAccountId: 'acc_late_orphan_1',
        phoneNumber: '+5511999990015',
      })
    ).rejects.toMatchObject({ statusCode: 409, details: { code: 'CONNECTION_DISCONNECTED' } });

    const conn = stores.whatsapp_connections.get(connId);
    expect(conn?.status).toBe('disconnected');
    expect(conn?.status_reason).toBe('USER_DISCONNECTED');
    expect(stores.whatsapp_provider_identity_claims.size).toBe(0);

    const cleanupJob = stores.whatsapp_provider_cleanup_jobs.get(`cleanup_conn_${connId}`);
    expect(cleanupJob).toBeDefined();
    expect(cleanupJob?.status).toBe('pending');
    expect(cleanupJob?.provider_account_id).toBe('acc_late_orphan_1');
    expect(cleanupJob?.provider_profile_id).toBe('prof_fr2');
    expect(cleanupJob?.phone_number).toBe('+5511999990015');

    // FR2-1: Subsequent cleanup execution MUST NOT stall in PROVIDER_ACCOUNT_ID_MISMATCH
    const mockZernioCleanupClient = {
      deleteAccount: vi.fn().mockResolvedValue({ message: 'Account deleted successfully' }),
      listAccounts: vi.fn().mockResolvedValue([]),
    };
    const cleanupService = new WhatsAppCleanupService(
      cleanupJobRepo,
      new WhatsAppWabaLifecycleLockRepository(),
      reconJobRepo,
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
      undefined as any,
      mockZernioCleanupClient as any
    );

    const cleanupSummary = await cleanupService.executeDueJobs({
      batchSize: 5,
      deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
    });

    expect(mockZernioCleanupClient.deleteAccount).toHaveBeenCalledWith(
      'acc_late_orphan_1',
      expect.any(Object)
    );
    expect(cleanupSummary.succeededCount).toBe(1);
    expect(cleanupSummary.exhaustedCount).toBe(0);
    expect(stores.whatsapp_provider_cleanup_jobs.get(`cleanup_conn_${connId}`)?.status).toBe('succeeded');
    expect(stores.whatsapp_connections.get(connId)?.provider_account_id).toBeNull();
    expect(stores.whatsapp_connections.get(connId)?.status).toBe('disconnected');
    expect(stores.whatsapp_connections.get(connId)?.status_reason).toBe('USER_DISCONNECTED');
  });

  describe('H10-FR3: independent transactional stale-worker guards in reconciliation', () => {
    const setupHealableReconciliation = (connId: string, accountId: string, phone: string) => {
      const jobId = `recon_zernio_${connId}`;
      stores.whatsapp_connections.set(connId, {
        id: connId,
        organization_id: orgId,
        provider: 'zernio',
        provider_profile_id: `prof_${connId}`,
        provider_account_id: accountId,
        phone_number: phone,
        status: 'error',
        status_reason: 'ZERNIO_RECONCILIATION_REMOTE_DEAD',
        created_at: now,
        updated_at: now,
      });

      stores.whatsapp_waba_reconciliation_jobs.set(jobId, {
        id: jobId,
        provider: 'zernio',
        provider_waba_id: null,
        organization_id: orgId,
        connection_id: connId,
        provider_account_id: accountId,
        provider_profile_id: `prof_${connId}`,
        phone_number: phone,
        desired_state: 'connected',
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: '2026-11-13T09:00:00.000Z',
        lease_token: null,
        lease_expires_at: null,
      });

      return jobId;
    };

    const runWithMidFlightMutation = async (
      connId: string,
      phone: string,
      mutate: (jobId: string) => void,
      jobId: string
    ) => {
      const mockZernioClient = {
        getWhatsAppNumberInfo: vi.fn(async () => {
          mutate(jobId);
          return {
            phone: {
              display_phone_number: phone,
              status: 'CONNECTED',
              platform_type: 'CLOUD_API',
            },
          };
        }),
      };

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        new WhatsAppWabaLifecycleLockRepository(),
        connectionRepo,
        new WhatsAppConnectionSecretRepository(),
        new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
        undefined as any,
        mockZernioClient as any,
        cleanupJobRepo
      );

      return await reconService.executeDueJobs({
        batchSize: 5,
        deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
      });
    };

    it('FR3a: superseded lease_token alone blocks stale worker from healing connection', async () => {
      const connId = 'conn-h10-fr3a';
      const phone = '+5511999990016';
      const jobId = setupHealableReconciliation(connId, 'acc_recon_fr3a', phone);

      const summary = await runWithMidFlightMutation(
        connId,
        phone,
        (jId) => {
          const job = stores.whatsapp_waba_reconciliation_jobs.get(jId);
          stores.whatsapp_waba_reconciliation_jobs.set(jId, {
            ...job,
            lease_token: 'newer-superseding-lease-token',
          });
        },
        jobId
      );

      expect(summary.repairedCount).toBe(0);
      expect(stores.whatsapp_connections.get(connId)?.status).toBe('error');
      expect(stores.whatsapp_connections.get(connId)?.status_reason).toBe('ZERNIO_RECONCILIATION_REMOTE_DEAD');
    });

    it('FR3b: recon job status !== processing (with matching lease_token) blocks stale worker', async () => {
      const connId = 'conn-h10-fr3b';
      const phone = '+5511999990017';
      const jobId = setupHealableReconciliation(connId, 'acc_recon_fr3b', phone);

      const summary = await runWithMidFlightMutation(
        connId,
        phone,
        (jId) => {
          const job = stores.whatsapp_waba_reconciliation_jobs.get(jId);
          stores.whatsapp_waba_reconciliation_jobs.set(jId, {
            ...job,
            status: 'pending',
          });
        },
        jobId
      );

      expect(summary.repairedCount).toBe(0);
      expect(stores.whatsapp_connections.get(connId)?.status).toBe('error');
    });

    it('FR3c: desired_state !== connected (with matching lease_token and processing) blocks stale worker', async () => {
      const connId = 'conn-h10-fr3c';
      const phone = '+5511999990018';
      const jobId = setupHealableReconciliation(connId, 'acc_recon_fr3c', phone);

      const summary = await runWithMidFlightMutation(
        connId,
        phone,
        (jId) => {
          const job = stores.whatsapp_waba_reconciliation_jobs.get(jId);
          stores.whatsapp_waba_reconciliation_jobs.set(jId, {
            ...job,
            desired_state: 'disconnected',
          });
        },
        jobId
      );

      expect(summary.repairedCount).toBe(0);
      expect(stores.whatsapp_connections.get(connId)?.status).toBe('error');
    });

    it('FR3d: provider_account_id drift alone (with valid lease & healable reason) blocks stale worker', async () => {
      const connId = 'conn-h10-fr3d';
      const phone = '+5511999990019';
      const jobId = setupHealableReconciliation(connId, 'acc_recon_fr3d', phone);

      const summary = await runWithMidFlightMutation(
        connId,
        phone,
        () => {
          const c = stores.whatsapp_connections.get(connId);
          stores.whatsapp_connections.set(connId, {
            ...c,
            provider_account_id: 'acc_replaced_by_new_session',
          });
        },
        jobId
      );

      expect(summary.repairedCount).toBe(0);
      expect(stores.whatsapp_connections.get(connId)?.status).toBe('error');
      expect(stores.whatsapp_connections.get(connId)?.provider_account_id).toBe('acc_replaced_by_new_session');
    });

    it('FR3e: phone_number drift alone (with valid lease, matching account & healable reason) blocks stale worker', async () => {
      const connId = 'conn-h10-fr3e';
      const phone = '+5511999990020';
      const jobId = setupHealableReconciliation(connId, 'acc_recon_fr3e', phone);

      const summary = await runWithMidFlightMutation(
        connId,
        phone,
        () => {
          const c = stores.whatsapp_connections.get(connId);
          stores.whatsapp_connections.set(connId, {
            ...c,
            phone_number: '+5511888887777',
          });
        },
        jobId
      );

      expect(summary.repairedCount).toBe(0);
      expect(stores.whatsapp_connections.get(connId)?.status).toBe('error');
      expect(stores.whatsapp_connections.get(connId)?.phone_number).toBe('+5511888887777');
    });

    it('FR3f: requireHealableStatusReason alone (same lease_token, status=processing, matching identity) blocks healing after non-healable status_reason', async () => {
      const connId = 'conn-h10-fr3f';
      const phone = '+5511999990021';
      const jobId = setupHealableReconciliation(connId, 'acc_recon_fr3f', phone);

      const summary = await runWithMidFlightMutation(
        connId,
        phone,
        () => {
          const c = stores.whatsapp_connections.get(connId);
          stores.whatsapp_connections.set(connId, {
            ...c,
            status_reason: 'PROVIDER_AUTH_REVOKED_NEWER',
          });
        },
        jobId
      );

      expect(summary.repairedCount).toBe(0);
      expect(stores.whatsapp_connections.get(connId)?.status).toBe('error');
      expect(stores.whatsapp_connections.get(connId)?.status_reason).toBe('PROVIDER_AUTH_REVOKED_NEWER');
    });
  });

  it('H10-R3: late materialization of account B preserves active processing cleanup/ownership of account A and executes separate orphan job for B', async () => {
    const connId = 'conn-h10-r3-orphan';
    const primaryJobId = `cleanup_conn_${connId}`;
    const leaseExpiresFuture = new Date(Date.now() + 120_000).toISOString();

    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_r3',
      provider_account_id: 'acc_A_original',
      phone_number: '+5511999990001',
      status: 'disconnected',
      status_reason: 'USER_DISCONNECTED',
      created_at: now,
      updated_at: now,
    });
    stores.whatsapp_provider_identity_claims.set(getZernioAccountClaimId('acc_A_original'), {
      id: getZernioAccountClaimId('acc_A_original'),
      provider: 'zernio',
      provider_phone_number_id: 'acc_A_original',
      organization_id: orgId,
      connection_id: connId,
    });
    stores.whatsapp_connection_secrets.set(connId, { id: connId, encrypted_token: 'enc_secret' });
    stores.whatsapp_provider_cleanup_jobs.set(primaryJobId, {
      id: primaryJobId,
      organization_id: orgId,
      connection_id: connId,
      provider: 'zernio',
      provider_waba_id: null,
      provider_phone_number_id: null,
      provider_account_id: 'acc_A_original',
      provider_profile_id: 'prof_r3',
      phone_number: '+5511999990001',
      status: 'processing',
      attempt_count: 1,
      max_attempts: 5,
      next_attempt_at: '2026-11-13T09:00:00.000Z',
      lease_token: 'lease_A_active',
      lease_expires_at: leaseExpiresFuture,
      unresolved_remote_mutations: [],
    });

    await expect(
      connectionRepo.materializeZernioProviderIdentity({
        organizationId: orgId,
        connectionId: connId,
        providerProfileId: 'prof_r3',
        providerAccountId: 'acc_B_late_race',
        phoneNumber: '+5511999990002',
      })
    ).rejects.toMatchObject({ statusCode: 409, details: { code: 'CONNECTION_DISCONNECTED' } });

    // Primary cleanup job for A is completely preserved with its active processing lease
    const primaryJob = stores.whatsapp_provider_cleanup_jobs.get(primaryJobId);
    expect(primaryJob?.provider_account_id).toBe('acc_A_original');
    expect(primaryJob?.status).toBe('processing');
    expect(primaryJob?.lease_token).toBe('lease_A_active');

    // A separate durable orphan cleanup job was scheduled for B
    const orphanJobs = Array.from(stores.whatsapp_provider_cleanup_jobs.values()).filter((j) =>
      j.id.startsWith(`cleanup_orphan_${connId}_`)
    );
    expect(orphanJobs).toHaveLength(1);
    expect(orphanJobs[0].provider_account_id).toBe('acc_B_late_race');
    expect(orphanJobs[0].status).toBe('pending');
    expect(orphanJobs[0].cleanup_scope).toBe('late_orphan');

    // Execute due cleanup jobs -> cleans up B without touching A's lease, claim, or connection secret
    const mockZernioClient = {
      deleteAccount: vi.fn().mockResolvedValue({ message: 'Account deleted successfully' }),
      listAccounts: vi.fn().mockResolvedValue([]),
    };
    const cleanupService = new WhatsAppCleanupService(
      cleanupJobRepo,
      new WhatsAppWabaLifecycleLockRepository(),
      reconJobRepo,
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
      undefined as any,
      mockZernioClient as any
    );

    const summary = await cleanupService.executeDueJobs({
      batchSize: 5,
      deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
    });

    expect(summary.succeededCount).toBe(1);
    expect(mockZernioClient.deleteAccount).toHaveBeenCalledTimes(1);
    expect(mockZernioClient.deleteAccount).toHaveBeenCalledWith('acc_B_late_race', expect.anything());
    expect(stores.whatsapp_provider_cleanup_jobs.get(orphanJobs[0].id)?.status).toBe('succeeded');
    // Primary A job, claim, and connection secret remain untouched
    expect(stores.whatsapp_provider_cleanup_jobs.get(primaryJobId)?.status).toBe('processing');
    expect(stores.whatsapp_provider_cleanup_jobs.get(primaryJobId)?.lease_token).toBe('lease_A_active');
    expect(stores.whatsapp_provider_identity_claims.has(getZernioAccountClaimId('acc_A_original'))).toBe(true);
    expect(stores.whatsapp_connection_secrets.has(connId)).toBe(true);
  });

  it('H12-R3: WhatsAppCleanupService + ZernioHttpClient refuse settlement on HTTP 202 empty body or future-tense delete messages', async () => {
    const connId = 'conn-h12-r3';
    const jobId = `cleanup_conn_${connId}`;
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_h12_r3',
      provider_account_id: 'acc_h12_r3',
      phone_number: '+5511999990029',
      status: 'disconnected',
    });

    const cases = [
      { status: 202, body: '' },
      { status: 200, body: JSON.stringify({ message: 'Account will be deleted shortly' }) },
      { status: 200, body: JSON.stringify({ message: 'Account may be deleted after approval' }) },
    ];

    for (const c of cases) {
      stores.whatsapp_provider_cleanup_jobs.set(jobId, {
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: 'acc_h12_r3',
        provider_profile_id: 'prof_h12_r3',
        phone_number: '+5511999990029',
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: '2026-11-13T09:00:00.000Z',
        lease_token: null,
        lease_expires_at: null,
        unresolved_remote_mutations: [],
      });

      const fetchMock = vi.fn().mockImplementation(async (_url: string, init: any) => {
        if (init?.method === 'DELETE') {
          return {
            ok: true,
            status: c.status,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => c.body,
          };
        }
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () => JSON.stringify([{ _id: 'acc_h12_r3', platform: 'whatsapp', status: 'connected' }]),
        };
      });

      const realClient = new ZernioHttpClient({ apiKey: 'test_key', fetchFn: fetchMock as any });
      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        new WhatsAppWabaLifecycleLockRepository(),
        reconJobRepo,
        connectionRepo,
        new WhatsAppConnectionSecretRepository(),
        new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
        undefined as any,
        realClient
      );

      const summary = await cleanupService.executeDueJobs({
        batchSize: 5,
        deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
      });

      expect(summary.succeededCount).toBe(0);
      expect(summary.retryWaitCount).toBe(1);
      expect(stores.whatsapp_provider_cleanup_jobs.get(jobId)?.status).toBe('retry_wait');
    }
  });

  it('H12-R4: WhatsAppCleanupService + ZernioHttpClient refuse settlement and retain claims & secrets on conditional messages or structured non-string state', async () => {
    const connId = 'conn-h12-r4';
    const jobId = `cleanup_conn_${connId}`;
    const accountId = 'acc_h12_r4';
    const phone = '+5511999990044';
    stores.whatsapp_connections.set(connId, {
      id: connId,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_h12_r4',
      provider_account_id: accountId,
      phone_number: phone,
      status: 'disconnected',
    });
    stores.whatsapp_provider_identity_claims.set(getZernioAccountClaimId(accountId), {
      id: getZernioAccountClaimId(accountId),
      provider: 'zernio',
      provider_phone_number_id: accountId,
      organization_id: orgId,
      connection_id: connId,
    });
    stores.whatsapp_provider_identity_claims.set(getZernioPhoneClaimId(phone), {
      id: getZernioPhoneClaimId(phone),
      provider: 'zernio',
      provider_phone_number_id: phone,
      organization_id: orgId,
      connection_id: connId,
    });
    stores.whatsapp_connection_secrets.set(connId, { id: connId, encrypted_token: 'secret_r4' });

    const conditionalCases = [
      { message: 'Account deleted once you confirm' },
      { message: 'Account deleted only after confirmation' },
      { deleted: true, message: 'Account deleted once you confirm' },
      { state: { status: 'pending' }, deleted: true },
    ];

    for (const payload of conditionalCases) {
      stores.whatsapp_provider_cleanup_jobs.set(jobId, {
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: 'prof_h12_r4',
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: '2026-11-13T09:00:00.000Z',
        lease_token: null,
        lease_expires_at: null,
        unresolved_remote_mutations: [],
      });

      const fetchMock = vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => JSON.stringify(payload),
      }));

      const realClient = new ZernioHttpClient({ apiKey: 'test_key', fetchFn: fetchMock as any });
      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        new WhatsAppWabaLifecycleLockRepository(),
        reconJobRepo,
        connectionRepo,
        new WhatsAppConnectionSecretRepository(),
        new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
        undefined as any,
        realClient
      );

      const summary = await cleanupService.executeDueJobs({
        batchSize: 5,
        deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
      });

      expect(summary.succeededCount).toBe(0);
      expect(summary.retryWaitCount).toBe(1);
      expect(stores.whatsapp_provider_cleanup_jobs.get(jobId)?.status).toBe('retry_wait');
      expect(stores.whatsapp_provider_identity_claims.has(getZernioAccountClaimId(accountId))).toBe(true);
      expect(stores.whatsapp_provider_identity_claims.has(getZernioPhoneClaimId(phone))).toBe(true);
      expect(stores.whatsapp_connection_secrets.has(connId)).toBe(true);
    }
  });

  it('H10-R4: blocks orphan enqueue and fences before DELETE when competing connection D owns account B', async () => {
    const connC = 'conn-c-disconnected';
    const connD = 'conn-d-active-competitor';
    const phoneC = '+5511999990071';
    const phoneD = '+5511999990072';

    // Disconnected C retains A; active D already owns B
    stores.whatsapp_connections.set(connC, {
      id: connC,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_c',
      provider_account_id: 'acc_A_c',
      phone_number: phoneC,
      status: 'disconnected',
      status_reason: 'USER_DISCONNECTED',
      created_at: now,
      updated_at: now,
    });
    stores.whatsapp_connections.set(connD, {
      id: connD,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_d',
      provider_account_id: 'acc_B_live',
      phone_number: phoneD,
      status: 'connected',
      created_at: now,
      updated_at: now,
    });
    stores.whatsapp_provider_identity_claims.set(getZernioAccountClaimId('acc_B_live'), {
      id: getZernioAccountClaimId('acc_B_live'),
      provider: 'zernio',
      provider_phone_number_id: 'acc_B_live',
      organization_id: orgId,
      connection_id: connD,
    });
    stores.whatsapp_provider_identity_claims.set(getZernioPhoneClaimId(phoneD), {
      id: getZernioPhoneClaimId(phoneD),
      provider: 'zernio',
      provider_phone_number_id: phoneD,
      organization_id: orgId,
      connection_id: connD,
    });

    // 1) Enqueue-time conflict: late callback for disconnected C targeting acc_B_live MUST NOT queue orphan job
    await expect(
      connectionRepo.materializeZernioProviderIdentity({
        organizationId: orgId,
        connectionId: connC,
        providerProfileId: 'prof_c',
        providerAccountId: 'acc_B_live',
        phoneNumber: phoneD,
      })
    ).rejects.toMatchObject({ statusCode: 409, details: { code: 'CONNECTION_DISCONNECTED' } });

    const orphanJobsAfterEnqueue = Array.from(stores.whatsapp_provider_cleanup_jobs.values()).filter((j) =>
      j.id.startsWith(`cleanup_orphan_${connC}_`)
    );
    expect(orphanJobsAfterEnqueue).toHaveLength(0);

    // 2) Post-enqueue race / pre-existing orphan job: even if an orphan job already existed before D claimed B,
    // cleanup MUST fence before calling deleteAccount('acc_B_live')!
    const syntheticOrphanId = `cleanup_orphan_${connC}_racecheck`;
    stores.whatsapp_provider_cleanup_jobs.set(syntheticOrphanId, {
      id: syntheticOrphanId,
      cleanup_scope: 'late_orphan',
      organization_id: orgId,
      connection_id: connC,
      provider: 'zernio',
      provider_waba_id: null,
      provider_phone_number_id: null,
      provider_account_id: 'acc_B_live',
      provider_profile_id: 'prof_c',
      phone_number: phoneD,
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at: '2026-11-13T09:00:00.000Z',
      lease_token: null,
      lease_expires_at: null,
      unresolved_remote_mutations: [],
    });

    const mockDelete = vi.fn().mockResolvedValue({ message: 'Account deleted successfully' });
    const mockZernioClient = {
      deleteAccount: mockDelete,
      listAccounts: vi.fn().mockResolvedValue([]),
    };
    const cleanupService = new WhatsAppCleanupService(
      cleanupJobRepo,
      new WhatsAppWabaLifecycleLockRepository(),
      reconJobRepo,
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
      undefined as any,
      mockZernioClient as any
    );

    const summary = await cleanupService.executeDueJobs({
      batchSize: 5,
      deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
    });

    expect(summary.exhaustedCount).toBe(1);
    expect(mockDelete).not.toHaveBeenCalled();
    expect(stores.whatsapp_provider_cleanup_jobs.get(syntheticOrphanId)?.status).toBe('exhausted');
    expect(stores.whatsapp_provider_cleanup_jobs.get(syntheticOrphanId)?.last_error_code).toBe('CLAIM_OWNERSHIP_CONFLICT');
    // Competitor D's claim and connected record remain untouched
    expect(stores.whatsapp_provider_identity_claims.get(getZernioAccountClaimId('acc_B_live'))?.connection_id).toBe(connD);
    expect(stores.whatsapp_connections.get(connD)?.status).toBe('connected');

    // 3) Mid-DELETE fencing: when an unclaimed orphan account is deleting remotely, concurrent materialization
    // on competitor D MUST fail closed against the atomic fencing claim until DELETE finishes & settles.
    const unclaimedOrphanId = `cleanup_orphan_${connC}_inflight`;
    stores.whatsapp_provider_cleanup_jobs.set(unclaimedOrphanId, {
      id: unclaimedOrphanId,
      cleanup_scope: 'late_orphan',
      organization_id: orgId,
      connection_id: connC,
      provider: 'zernio',
      provider_waba_id: null,
      provider_phone_number_id: null,
      provider_account_id: 'acc_B_inflight',
      provider_profile_id: 'prof_c',
      phone_number: '+5511999990079',
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at: '2026-11-13T09:00:00.000Z',
      lease_token: null,
      lease_expires_at: null,
      unresolved_remote_mutations: [],
    });
    const connD2 = 'conn-d2-concurrent';
    stores.whatsapp_connections.set(connD2, {
      id: connD2,
      organization_id: orgId,
      provider: 'zernio',
      provider_profile_id: 'prof_d2',
      provider_account_id: null,
      phone_number: null,
      status: 'connecting',
      created_at: now,
      updated_at: now,
    });

    let competitorErrorDuringDelete: any = null;
    const inflightClient = {
      deleteAccount: vi.fn().mockImplementation(async () => {
        // Simulate competitor D2 trying to claim acc_B_inflight while DELETE is in-flight
        try {
          await connectionRepo.materializeZernioProviderIdentity({
            organizationId: orgId,
            connectionId: connD2,
            providerProfileId: 'prof_d2',
            providerAccountId: 'acc_B_inflight',
            phoneNumber: '+5511999990079',
          });
        } catch (err) {
          competitorErrorDuringDelete = err;
        }
        return { message: 'Account deleted successfully' };
      }),
      listAccounts: vi.fn().mockResolvedValue([]),
    };
    const inflightCleanupService = new WhatsAppCleanupService(
      cleanupJobRepo,
      new WhatsAppWabaLifecycleLockRepository(),
      reconJobRepo,
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
      undefined as any,
      inflightClient as any
    );

    const inflightSummary = await inflightCleanupService.executeDueJobs({
      batchSize: 5,
      deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
    });

    expect(competitorErrorDuringDelete).toMatchObject({
      statusCode: 409,
      details: { code: 'ZERNIO_ACCOUNT_ALREADY_REGISTERED' },
    });
    expect(inflightSummary.succeededCount).toBe(1);
    expect(stores.whatsapp_provider_cleanup_jobs.get(unclaimedOrphanId)?.status).toBe('succeeded');
    // Fence claim released cleanly after settlement
    expect(stores.whatsapp_provider_identity_claims.has(getZernioAccountClaimId('acc_B_inflight'))).toBe(false);
  });

  it('H10-R5: late_orphan job sharing conn.phone_number aborts with CLAIM_OWNERSHIP_CONFLICT when competitor D owns phone claim, and preserves primary phone claim on valid C settlement', async () => {
    const orgC = 'org-h10-r5-c';
    const orgD = 'org-h10-r5-d';
    const connC = 'conn-c-r5';
    const connD = 'conn-d-r5';
    const sharedPhone = '+5511999990081';
    const now = '2026-11-13T10:00:00.000Z';

    stores.whatsapp_connections.set(connC, {
      id: connC,
      organization_id: orgC,
      provider: 'zernio',
      provider_profile_id: 'prof_c_r5',
      provider_account_id: 'acc_A_primary_r5',
      phone_number: sharedPhone,
      status: 'disconnected',
      created_at: now,
      updated_at: now,
    });

    // Primary cleanup already released acc_A and phone P; competitor D legitimately holds phone claim P.
    const phoneClaimId = getZernioPhoneClaimId(sharedPhone);
    stores.whatsapp_provider_identity_claims.set(phoneClaimId, {
      id: phoneClaimId,
      provider: 'zernio',
      phone_number: sharedPhone,
      organization_id: orgD,
      connection_id: connD,
      created_at: now,
      updated_at: now,
    });

    const orphanJobId = `cleanup_orphan_${connC}_acc_B_r5`;
    stores.whatsapp_provider_cleanup_jobs.set(orphanJobId, {
      id: orphanJobId,
      cleanup_scope: 'late_orphan',
      organization_id: orgC,
      connection_id: connC,
      provider: 'zernio',
      provider_waba_id: null,
      provider_phone_number_id: null,
      provider_account_id: 'acc_B_orphan_r5',
      provider_profile_id: 'prof_c_r5',
      phone_number: sharedPhone,
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at: '2026-11-13T09:00:00.000Z',
      lease_token: null,
      lease_expires_at: null,
      unresolved_remote_mutations: [],
    });

    const mockDelete = vi.fn().mockResolvedValue({ message: 'Account deleted successfully' });
    const mockList = vi.fn().mockResolvedValue([]);
    const cleanupService = new WhatsAppCleanupService(
      cleanupJobRepo,
      new WhatsAppWabaLifecycleLockRepository(),
      reconJobRepo,
      connectionRepo,
      new WhatsAppConnectionSecretRepository(),
      new WhatsAppEncryptionService('YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY='),
      undefined as any,
      { deleteAccount: mockDelete, listAccounts: mockList } as any
    );

    const summary = await cleanupService.executeDueJobs({
      batchSize: 5,
      deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
    });

    expect(summary.exhaustedCount).toBe(1);
    expect(mockList).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(stores.whatsapp_provider_cleanup_jobs.get(orphanJobId)?.status).toBe('exhausted');
    expect(stores.whatsapp_provider_cleanup_jobs.get(orphanJobId)?.last_error_code).toBe('CLAIM_OWNERSHIP_CONFLICT');
    // D's phone claim preserved untouched & B was not fenced
    expect(stores.whatsapp_provider_identity_claims.get(phoneClaimId)?.connection_id).toBe(connD);
    expect(stores.whatsapp_provider_identity_claims.get(phoneClaimId)?.organization_id).toBe(orgD);
    expect(stores.whatsapp_provider_identity_claims.has(getZernioAccountClaimId('acc_B_orphan_r5'))).toBe(false);

    // Part 2: When C still owns sharedPhone, orphan settles B WITHOUT deleting C's primary phone claim
    stores.whatsapp_provider_identity_claims.set(phoneClaimId, {
      id: phoneClaimId,
      provider: 'zernio',
      phone_number: sharedPhone,
      organization_id: orgC,
      connection_id: connC,
      created_at: now,
      updated_at: now,
    });
    const secondOrphanJobId = `cleanup_orphan_${connC}_acc_B2_r5`;
    stores.whatsapp_provider_cleanup_jobs.set(secondOrphanJobId, {
      id: secondOrphanJobId,
      cleanup_scope: 'late_orphan',
      organization_id: orgC,
      connection_id: connC,
      provider: 'zernio',
      provider_waba_id: null,
      provider_phone_number_id: null,
      provider_account_id: 'acc_B2_orphan_r5',
      provider_profile_id: 'prof_c_r5',
      phone_number: sharedPhone,
      status: 'pending',
      attempt_count: 0,
      max_attempts: 5,
      next_attempt_at: '2026-11-13T09:00:00.000Z',
      lease_token: null,
      lease_expires_at: null,
      unresolved_remote_mutations: [],
    });

    const summary2 = await cleanupService.executeDueJobs({
      batchSize: 5,
      deadline: new WhatsAppExecutionDeadline({ startTime: Date.now(), budgetMs: 24_000, safetyMarginMs: 1_500 }),
    });
    expect(summary2.succeededCount).toBe(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(stores.whatsapp_provider_cleanup_jobs.get(secondOrphanJobId)?.status).toBe('succeeded');
    expect(stores.whatsapp_provider_identity_claims.get(phoneClaimId)?.connection_id).toBe(connC);
  });
});
