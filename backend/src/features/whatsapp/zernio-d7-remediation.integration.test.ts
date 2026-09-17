import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppProviderCleanupJobRepository } from '../../repositories/WhatsAppProviderCleanupJobRepository';
import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppCleanupService } from './whatsapp-cleanup.service';
import { WhatsAppReconciliationService } from './whatsapp-reconciliation.service';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { ZernioHttpClient } from './zernio-http-client';
import {
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
  WhatsAppConnectionRecord,
  WhatsAppProviderCleanupJobRecord,
  WhatsAppProvider,
} from './whatsapp.types';
import {
  ZernioError,
  ZernioAccount,
  isZernioAccountProvenAbsent,
} from './zernio.types';
import { AppError } from '../../middleware/error-handler';

const TEST_KEY = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';

describe('Zernio D7-R2 Remediation & Settlement Matrix (Firestore Emulator)', { timeout: 30000 }, () => {
  let connectionRepo: WhatsAppConnectionRepository;
  let cleanupJobRepo: WhatsAppProviderCleanupJobRepository;
  let reconJobRepo: WhatsAppWabaReconciliationJobRepository;
  let claimRepo: WhatsAppProviderIdentityClaimRepository;
  let secretRepo: WhatsAppConnectionSecretRepository;
  let lockRepo: WhatsAppWabaLifecycleLockRepository;
  let encryptionService: WhatsAppEncryptionService;

  beforeEach(async () => {
    connectionRepo = new WhatsAppConnectionRepository();
    cleanupJobRepo = new WhatsAppProviderCleanupJobRepository();
    reconJobRepo = new WhatsAppWabaReconciliationJobRepository();
    claimRepo = new WhatsAppProviderIdentityClaimRepository();
    secretRepo = new WhatsAppConnectionSecretRepository();
    lockRepo = new WhatsAppWabaLifecycleLockRepository();
    encryptionService = new WhatsAppEncryptionService(TEST_KEY);

    const [cleanupDocs, reconDocs] = await Promise.all([
      db.collection('whatsapp_provider_cleanup_jobs').listDocuments(),
      db.collection('whatsapp_waba_reconciliation_jobs').listDocuments(),
    ]);
    await Promise.all([
      ...cleanupDocs.map((d) => d.delete()),
      ...reconDocs.map((d) => d.delete()),
    ]);
  });

  function uniqueId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async function seedMaterializedZernioConnection(params?: {
    orgId?: string;
    connId?: string;
    accountId?: string;
    profileId?: string;
    phone?: string;
    status?: 'connected' | 'disconnected' | 'pending' | 'error';
  }) {
    const orgId = params?.orgId || uniqueId('org');
    const connId = params?.connId || uniqueId('conn');
    const accountId = params?.accountId || uniqueId('acc');
    const profileId = params?.profileId || uniqueId('prof');
    const phone = params?.phone || `+551199${Math.floor(1000000 + Math.random() * 9000000)}`;
    const status = params?.status || 'connected';
    const nowIso = new Date().toISOString();

    const conn: WhatsAppConnectionRecord = {
      id: connId,
      organization_id: orgId,
      display_name: 'Zernio Line',
      status,
      phone_number: phone,
      provider: 'zernio',
      provider_waba_id: null,
      provider_phone_number_id: null,
      provider_account_id: accountId,
      provider_profile_id: profileId,
      status_reason: null,
      assigned_ministry_id: null,
      pending_expires_at: null,
      last_connected_at: null,
      last_health_check_at: null,
      created_by_user_id: 'user_test',
      created_at: nowIso,
      updated_at: nowIso,
    };

    await db.collection('whatsapp_connections').doc(connId).set(conn);

    // Seed admin member for service-level authorization
    const actorUserId = 'admin_user';
    await db.collection('organization_members').doc(`${orgId}_${actorUserId}`).set({
      organization_id: orgId,
      user_id: actorUserId,
      role: 'admin',
      created_at: nowIso,
      updated_at: nowIso,
    });

    // Seed claims directly into collection
    const accountClaimId = getZernioAccountClaimId(accountId);
    const phoneClaimId = getZernioPhoneClaimId(phone);

    await db.collection('whatsapp_provider_identity_claims').doc(accountClaimId).set({
      id: accountClaimId,
      claim_type: 'zernio_account',
      target_identifier: accountId,
      provider: 'zernio',
      organization_id: orgId,
      connection_id: connId,
      created_at: nowIso,
    });

    await db.collection('whatsapp_provider_identity_claims').doc(phoneClaimId).set({
      id: phoneClaimId,
      claim_type: 'zernio_phone',
      target_identifier: phone,
      provider: 'zernio',
      organization_id: orgId,
      connection_id: connId,
      created_at: nowIso,
    });

    // Seed secret
    const enc = encryptionService.encryptToken('zernio_secret_token_123', orgId, connId);
    await secretRepo.setSecret({
      id: connId,
      connection_id: connId,
      organization_id: orgId,
      key_version: enc.keyVersion,
      encrypted_access_token: enc.encryptedAccessToken,
      iv: enc.iv,
      auth_tag: enc.authTag,
      token_type: 'business_token',
      expires_at: null,
      created_at: nowIso,
      updated_at: nowIso,
    });

    return { orgId, connId, accountId, profileId, phone, conn, actorUserId };
  }

  // =========================================================================
  // SECTION A: Disconnect Durability (Tests 1-4)
  // =========================================================================
  describe('SECTION A: Disconnect Durability', () => {
    it('1. Atomic disconnect + cleanup job + claims retained', async () => {
      const { orgId, connId, accountId, phone, actorUserId } = await seedMaterializedZernioConnection();
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);

      await service.disconnectConnection(orgId, connId, actorUserId);

      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('disconnected');

      const cleanupJob = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(cleanupJob).not.toBeNull();
      expect(cleanupJob?.status).toBe('pending');
      expect(cleanupJob?.provider).toBe('zernio');
      expect(cleanupJob?.provider_account_id).toBe(accountId);
      expect(cleanupJob?.phone_number).toBe(phone);

      // BLOCKER 1: Claims MUST be retained after local disconnect
      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      const phoneClaim = await claimRepo.getClaim(getZernioPhoneClaimId(phone));
      expect(accountClaim).not.toBeNull();
      expect(phoneClaim).not.toBeNull();

      // Secret must be preserved for D7 cleanup worker
      const secret = await secretRepo.getSecret(orgId, connId);
      expect(secret).not.toBeNull();
    });

    it('2. Transaction abort preserves neither', async () => {
      const { orgId, connId, accountId, phone, actorUserId } = await seedMaterializedZernioConnection();

      // Attempt disconnect with mismatching orgId -> must fail, transaction aborts
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);
      await expect(
        service.disconnectConnection('wrong_org_id', connId, actorUserId)
      ).rejects.toThrow();

      // Connection remains connected
      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('connected');

      // Cleanup job was NOT created
      const cleanupJob = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(cleanupJob).toBeNull();

      // Claims intact
      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      expect(accountClaim).not.toBeNull();
    });

    it('3. Idempotent duplicate disconnect', async () => {
      const { orgId, connId, accountId, actorUserId } = await seedMaterializedZernioConnection();
      const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);

      await service.disconnectConnection(orgId, connId, actorUserId);
      await service.disconnectConnection(orgId, connId, actorUserId); // Second disconnect call

      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('disconnected');

      const cleanupJob = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(cleanupJob).not.toBeNull();
      expect(cleanupJob?.status).toBe('pending');

      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      expect(accountClaim).not.toBeNull();
    });

    it('4. Reconciliation ensures cleanup, never revives disconnected connection', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      // Ensure recon job is present with desired_state: disconnected
      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'disconnected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const mockZernioClient = {
        listAccounts: vi.fn().mockResolvedValue([
          { id: accountId, name: 'Active Acc', platform: 'whatsapp', status: 'connected' },
        ]),
      } as unknown as ZernioHttpClient;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        mockZernioClient,
        cleanupJobRepo
      );

      const summary = await reconService.executeDueJobs({ batchSize: 5 });

      // Connection MUST remain disconnected
      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('disconnected');

      // Cleanup job must exist
      const cleanupJob = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(cleanupJob).not.toBeNull();
      expect(cleanupJob?.provider_account_id).toBe(accountId);
    });
  });

  // =========================================================================
  // SECTION B: Cleanup Identity (Tests 5-9)
  // =========================================================================
  describe('SECTION B: Cleanup Identity', () => {
    it('5. Provider mismatch: fails closed with no remote DELETE', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });
      // Mutate connection provider to meta
      await db.collection('whatsapp_connections').doc(connId).update({ provider: 'meta' });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const mockDelete = vi.fn();
      const mockZernioClient = {
        deleteAccount: mockDelete,
        listAccounts: vi.fn(),
      } as unknown as ZernioHttpClient;

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        mockZernioClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).not.toHaveBeenCalled();
      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('exhausted');
      expect(job?.last_error_code).toBe('NON_ZERNIO_PROVIDER');
    });

    it('6. Account mismatch: conn.provider_account_id != job.provider_account_id', async () => {
      const { orgId, connId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: 'acc_mismatched_999',
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const mockDelete = vi.fn();
      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: vi.fn() } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).not.toHaveBeenCalled();
      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('exhausted');
      expect(job?.last_error_code).toBe('PROVIDER_ACCOUNT_ID_MISMATCH');
    });

    it('7. Profile mismatch: conn.provider_profile_id != job.provider_profile_id', async () => {
      const { orgId, connId, accountId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: 'prof_mismatched_888',
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const mockDelete = vi.fn();
      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: vi.fn() } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).not.toHaveBeenCalled();
      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('exhausted');
      expect(job?.last_error_code).toBe('PROVIDER_PROFILE_ID_MISMATCH');
    });

    it('8. Phone mismatch: conn.phone_number != job.phone_number', async () => {
      const { orgId, connId, accountId, profileId } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: '+5511999999999',
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const mockDelete = vi.fn();
      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: vi.fn() } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).not.toHaveBeenCalled();
      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('exhausted');
      expect(job?.last_error_code).toBe('PHONE_NUMBER_MISMATCH');
    });

    it('9. Cross-org mismatch: job.organization_id != conn.organization_id', async () => {
      const { connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: 'org_different_777',
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const mockDelete = vi.fn();
      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: vi.fn() } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).not.toHaveBeenCalled();
      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('exhausted');
      expect(job?.last_error_code).toBe('CROSS_TENANT_MISMATCH');
    });
  });

  // =========================================================================
  // SECTION C: First Delete (Tests 10-14)
  // =========================================================================
  describe('SECTION C: First Delete', () => {
    it('10. Reservation before DELETE: attempt count incremented before HTTP DELETE', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      let attemptDuringDelete = -1;
      const mockDelete = vi.fn().mockImplementation(async () => {
        const snap = await db.collection('whatsapp_provider_cleanup_jobs').doc(jobId).get();
        attemptDuringDelete = snap.data()?.attempt_count;
        return { success: true };
      });

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: vi.fn() } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(attemptDuringDelete).toBe(1); // Reserved BEFORE the HTTP call
    });

    it('11. 200 OK -> settlement (claims deleted, secret deleted, job succeeded)', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        {
          deleteAccount: vi.fn().mockResolvedValue({ success: true }),
          listAccounts: vi.fn(),
        } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('succeeded');
      expect(['proven', 'proven_absent']).toContain(job?.provider_cleanup_proof);

      // Claims deleted
      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      const phoneClaim = await claimRepo.getClaim(getZernioPhoneClaimId(phone));
      expect(accountClaim).toBeNull();
      expect(phoneClaim).toBeNull();

      // Secret deleted
      const secret = await secretRepo.getSecret(orgId, connId);
      expect(secret).toBeNull();
    });

    it('12. 404 + proven absence -> settlement succeeds', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      // listAccounts returns empty array with conclusive total: 0
      const emptyAccounts: any = [];
      emptyAccounts.total = 0;
      emptyAccounts.hasMore = false;
      emptyAccounts.totalPages = 1;
      emptyAccounts.page = 1;
      emptyAccounts.limit = 100;

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        {
          deleteAccount: vi.fn().mockRejectedValue(
            new ZernioError({
              statusCode: 404,
              kind: 'NOT_FOUND',
              message: 'Account not found',
            })
          ),
          listAccounts: vi.fn().mockResolvedValue(emptyAccounts),
        } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('succeeded');
      expect(job?.provider_cleanup_proof).toBe('proven_absent');

      // Claims deleted
      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      expect(accountClaim).toBeNull();
    });

    it('13. 404 + still present -> retry_wait (does not settle)', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      // listAccounts returns the target account still present!
      const presentAccounts: any = [{ id: accountId, name: 'Still Here', platform: 'whatsapp' }];
      presentAccounts.total = 1;
      presentAccounts.hasMore = false;
      presentAccounts.totalPages = 1;
      presentAccounts.page = 1;
      presentAccounts.limit = 100;

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        {
          deleteAccount: vi.fn().mockRejectedValue(
            new ZernioError({
              statusCode: 404,
              kind: 'NOT_FOUND',
              message: 'Account not found',
            })
          ),
          listAccounts: vi.fn().mockResolvedValue(presentAccounts),
        } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('retry_wait');
      expect(job?.last_error_code).toBe('ZERNIO_ACCOUNT_STILL_PRESENT_AFTER_404');

      // Claims must NOT be deleted
      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      expect(accountClaim).not.toBeNull();
    });

    it('14. 404 + probe error -> retry_wait (does not settle)', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        {
          deleteAccount: vi.fn().mockRejectedValue(
            new ZernioError({
              statusCode: 404,
              kind: 'NOT_FOUND',
              message: 'Account not found',
            })
          ),
          listAccounts: vi.fn().mockRejectedValue(new Error('Network probe timeout')),
        } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('retry_wait');
      expect(job?.last_error_code).toBe('ZERNIO_ABSENCE_PROBE_FAILED');

      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      expect(accountClaim).not.toBeNull();
    });
  });

  // =========================================================================
  // SECTION D: Ambiguous Delete (Tests 15-20)
  // =========================================================================
  describe('SECTION D: Ambiguous Delete', () => {
    it('15. 5xx/timeout -> unresolved recorded, no same-run delete', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const mockDelete = vi.fn().mockRejectedValue(
        new ZernioError({
          statusCode: 504,
          kind: 'TIMEOUT',
          message: 'Upstream gateway timeout',
        })
      );
      const mockList = vi.fn();

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: mockList } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockList).not.toHaveBeenCalled(); // No same-run probe on ambiguous error!

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('retry_wait');
      expect(job?.last_error_code).toBe('UNKNOWN_OUTCOME');
    });

    it('16. Next run + proven absent -> settlement with zero remote DELETE', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      // Seed job in retry_wait from prior attempt with last_error_code: UNKNOWN_OUTCOME
      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'retry_wait',
        attempt_count: 1,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: 'UNKNOWN_OUTCOME',
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

      const emptyAccounts: any = [];
      emptyAccounts.total = 0;
      emptyAccounts.hasMore = false;
      emptyAccounts.totalPages = 1;
      emptyAccounts.page = 1;
      emptyAccounts.limit = 100;

      const mockDelete = vi.fn();
      const mockList = vi.fn().mockResolvedValue(emptyAccounts);

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: mockList } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      // ZERO remote DELETE attempted!
      expect(mockDelete).not.toHaveBeenCalled();
      expect(mockList).toHaveBeenCalledTimes(1);

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('succeeded');
      expect(job?.provider_cleanup_proof).toBe('proven_absent');

      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      expect(accountClaim).toBeNull();
    });

    it('17. Next run + present -> executes bounded new DELETE', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'retry_wait',
        attempt_count: 1,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: 'UNKNOWN_OUTCOME',
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

      const presentAccounts: any = [{ id: accountId, name: 'Live Acc', platform: 'whatsapp' }];
      presentAccounts.total = 1;
      presentAccounts.hasMore = false;
      presentAccounts.totalPages = 1;
      presentAccounts.page = 1;
      presentAccounts.limit = 100;

      const mockDelete = vi.fn().mockResolvedValue({ success: true });
      const mockList = vi.fn().mockResolvedValue(presentAccounts);

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: mockList } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockList).toHaveBeenCalledTimes(1);
      expect(mockDelete).toHaveBeenCalledTimes(1);

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('succeeded');
    });

    it('18. Next run + timeout on presence check -> retry_wait, ZERO DELETE', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'retry_wait',
        attempt_count: 1,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: 'UNKNOWN_OUTCOME',
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

      const mockDelete = vi.fn();
      const mockList = vi.fn().mockRejectedValue(
        new ZernioError({
          statusCode: 504,
          kind: 'TIMEOUT',
          message: 'Probe timeout',
        })
      );

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: mockList } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      // BLOCKER 2: ZERO DELETE must be called on probe timeout!
      expect(mockDelete).not.toHaveBeenCalled();

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('retry_wait');
      expect(job?.last_error_code).toBe('ZERNIO_PRESENCE_CHECK_FAILED');
    });

    it('19. Next run + 5xx on presence check -> retry_wait, ZERO DELETE', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'retry_wait',
        attempt_count: 1,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: 'UNKNOWN_OUTCOME',
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

      const mockDelete = vi.fn();
      const mockList = vi.fn().mockRejectedValue(
        new ZernioError({
          statusCode: 502,
          kind: 'TRANSIENT_PROVIDER_ERROR',
          message: 'Zernio 502 Bad Gateway',
        })
      );

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: mockList } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).not.toHaveBeenCalled();

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('retry_wait');
      expect(job?.last_error_code).toBe('ZERNIO_PRESENCE_CHECK_FAILED');
    });

    it('20. Next run + malformed presence response -> retry_wait, ZERO DELETE', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'retry_wait',
        attempt_count: 1,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: 'UNKNOWN_OUTCOME',
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

      const mockDelete = vi.fn();
      const mockList = vi.fn().mockRejectedValue(
        new ZernioError({
          statusCode: 502,
          kind: 'TRANSIENT_PROVIDER_ERROR',
          message: 'ZERNIO_PROTOCOL_ERROR: Resposta malformada',
        })
      );

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { deleteAccount: mockDelete, listAccounts: mockList } as unknown as ZernioHttpClient
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockDelete).not.toHaveBeenCalled();

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('retry_wait');
      expect(job?.last_error_code).toBe('ZERNIO_PRESENCE_CHECK_FAILED');
    });
  });

  // =========================================================================
  // SECTION E: Strong Settlement (Tests 21-27)
  // =========================================================================
  describe('SECTION E: Strong Settlement', () => {
    it('21. Both claims owned -> removed, secret deleted, job succeeded', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const leaseToken = await cleanupJobRepo.acquireJobLeaseInTransaction(jobId, 60_000);

      await cleanupJobRepo.settleZernioCleanupInTransaction(jobId, leaseToken!, {
        providerCleanupProof: 'proven_absent',
      });

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('succeeded');
      expect(job?.provider_cleanup_proof).toBe('proven_absent');

      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      const phoneClaim = await claimRepo.getClaim(getZernioPhoneClaimId(phone));
      expect(accountClaim).toBeNull();
      expect(phoneClaim).toBeNull();

      const secret = await secretRepo.getSecret(orgId, connId);
      expect(secret).toBeNull();
    });

    it('22. Wrong connection owns account claim -> 409 conflict, fail closed', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      // Tamper account claim to point to other connection
      const accountClaimId = getZernioAccountClaimId(accountId);
      await db.collection('whatsapp_provider_identity_claims').doc(accountClaimId).update({
        connection_id: 'other_conn_id',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const leaseToken = await cleanupJobRepo.acquireJobLeaseInTransaction(jobId, 60_000);

      // Must throw AppError 409 CLAIM_OWNERSHIP_CONFLICT
      await expect(
        cleanupJobRepo.settleZernioCleanupInTransaction(jobId, leaseToken!, {
          providerCleanupProof: 'proven_absent',
        })
      ).rejects.toThrowError(/CLAIM_OWNERSHIP_CONFLICT/);

      // Claims and secret must be preserved
      const accountClaim = await claimRepo.getClaim(accountClaimId);
      expect(accountClaim).not.toBeNull();
      const secret = await secretRepo.getSecret(orgId, connId);
      expect(secret).not.toBeNull();
    });

    it('23. Wrong connection owns phone claim -> 409 conflict, fail closed', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      // Tamper phone claim
      const phoneClaimId = getZernioPhoneClaimId(phone);
      await db.collection('whatsapp_provider_identity_claims').doc(phoneClaimId).update({
        connection_id: 'other_conn_id',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const leaseToken = await cleanupJobRepo.acquireJobLeaseInTransaction(jobId, 60_000);

      await expect(
        cleanupJobRepo.settleZernioCleanupInTransaction(jobId, leaseToken!, {
          providerCleanupProof: 'proven_absent',
        })
      ).rejects.toThrowError(/CLAIM_OWNERSHIP_CONFLICT/);

      const phoneClaim = await claimRepo.getClaim(phoneClaimId);
      expect(phoneClaim).not.toBeNull();
    });

    it('24. Wrong org owns account claim -> 409 conflict', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const accountClaimId = getZernioAccountClaimId(accountId);
      await db.collection('whatsapp_provider_identity_claims').doc(accountClaimId).update({
        organization_id: 'other_org_id',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const leaseToken = await cleanupJobRepo.acquireJobLeaseInTransaction(jobId, 60_000);

      await expect(
        cleanupJobRepo.settleZernioCleanupInTransaction(jobId, leaseToken!, {
          providerCleanupProof: 'proven_absent',
        })
      ).rejects.toThrowError(/CLAIM_OWNERSHIP_CONFLICT/);
    });

    it('25. Wrong org owns phone claim -> 409 conflict', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const phoneClaimId = getZernioPhoneClaimId(phone);
      await db.collection('whatsapp_provider_identity_claims').doc(phoneClaimId).update({
        organization_id: 'other_org_id',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const leaseToken = await cleanupJobRepo.acquireJobLeaseInTransaction(jobId, 60_000);

      await expect(
        cleanupJobRepo.settleZernioCleanupInTransaction(jobId, leaseToken!, {
          providerCleanupProof: 'proven_absent',
        })
      ).rejects.toThrowError(/CLAIM_OWNERSHIP_CONFLICT/);
    });

    it('26. No read-after-write under Firestore emulator during settlement', async () => {
      // Direct execution of settleZernioCleanupInTransaction under the real Firestore emulator
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const leaseToken = await cleanupJobRepo.acquireJobLeaseInTransaction(jobId, 60_000);

      // BLOCKER 3: If any tx.get happened after tx.delete/tx.update, the Firestore emulator throws:
      // "Firestore transactions require all reads to be executed before all writes"
      await expect(
        cleanupJobRepo.settleZernioCleanupInTransaction(jobId, leaseToken!, {
          providerCleanupProof: 'proven_absent',
        })
      ).resolves.not.toThrow();
    });

    it('27. Failure is atomic: conflict leaves job not succeeded and secret intact', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const accountClaimId = getZernioAccountClaimId(accountId);
      await db.collection('whatsapp_provider_identity_claims').doc(accountClaimId).update({
        connection_id: 'conflict_conn',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const leaseToken = await cleanupJobRepo.acquireJobLeaseInTransaction(jobId, 60_000);

      try {
        await cleanupJobRepo.settleZernioCleanupInTransaction(jobId, leaseToken!, {
          providerCleanupProof: 'proven_absent',
        });
      } catch {
        // Expected conflict error
      }

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).not.toBe('succeeded');

      const secret = await secretRepo.getSecret(orgId, connId);
      expect(secret).not.toBeNull();
    });
  });

  // =========================================================================
  // SECTION F: Multi-Generation Uncertainty Ledger (Tests 28-31)
  // =========================================================================
  describe('SECTION F: Multi-Generation Uncertainty Ledger', () => {
    it('28. Records UNKNOWN outcome in unresolved ledger when < 20', async () => {
      const wabaId = uniqueId('waba_ledg');
      await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
        operation_generation: 1,
        operation: 'unsubscribe',
        connection_id: 'conn-1',
      });

      const lock = await lockRepo.getLock(wabaId);
      expect(lock).not.toBeNull();
      expect(lock?.unresolved_remote_mutations.length).toBe(1);
      expect(lock?.unresolved_remote_mutations[0].status).toBe('unknown_outcome');
    });

    it('29. 20 unresolved entries -> fails closed with 500 without silent eviction', async () => {
      const wabaId = uniqueId('waba_sat');

      for (let i = 1; i <= 20; i++) {
        await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
          operation_generation: i,
          operation: 'unsubscribe',
          connection_id: `conn-${i}`,
        });
      }

      const lock = await lockRepo.getLock(wabaId);
      expect(lock?.unresolved_remote_mutations.length).toBe(20);

      // 21st insertion must throw 500
      await expect(
        lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
          operation_generation: 21,
          operation: 'unsubscribe',
          connection_id: 'conn-21',
        })
      ).rejects.toThrowError(/WABA_UNCERTAINTY_LEDGER_SATURATED/);
    });

    it('30. Settled FIFO eviction: evicts oldest settled to stay <= 20', async () => {
      const wabaId = uniqueId('waba_fifo');

      // Seed 20 mutations
      for (let i = 1; i <= 20; i++) {
        await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
          operation_generation: i,
          operation: 'unsubscribe',
          connection_id: `conn-${i}`,
        });
      }

      // Mark the first one settled
      const docRef = lockRepo.getLockRef(wabaId);
      const snap = await docRef.get();
      const data = snap.data()!;
      data.unresolved_remote_mutations[0].status = 'settled';
      await docRef.set(data);

      // 21st insertion should evict the settled entry
      await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
        operation_generation: 21,
        operation: 'unsubscribe',
        connection_id: 'conn-21',
      });

      const lock = await lockRepo.getLock(wabaId);
      expect(lock?.unresolved_remote_mutations.length).toBe(20);
      expect(lock?.unresolved_remote_mutations.some((m) => m.operation_generation === 1)).toBe(false);
      expect(lock?.unresolved_remote_mutations.some((m) => m.operation_generation === 21)).toBe(true);
    });

    it('31. Unresolved outcome suppresses retention TTL', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      const jobId = `cleanup_conn_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'zernio',
        provider_waba_id: null,
        provider_phone_number_id: null,
        provider_account_id: accountId,
        provider_profile_id: profileId,
        phone_number: phone,
        status: 'pending',
        attempt_count: 4,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
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

      const leaseToken = await cleanupJobRepo.acquireJobLeaseInTransaction(jobId, 60_000);

      // Record exhaustion with unresolved proof
      await cleanupJobRepo.recordExhaustionInTransaction(
        jobId,
        leaseToken!,
        { errorCode: 'PROVIDER_TIMEOUT', errorMessage: 'Provider timed out' }
      );

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('exhausted');
      // DEC-7D-51: retention_expires_at must be null when unproven
      expect(job?.retention_expires_at).toBeNull();
      expect(job?.provider_cleanup_proof).toBe('unproven');
    });
  });

  // =========================================================================
  // SECTION G: Reconciliation Edge Cases (Tests 32-42)
  // =========================================================================
  describe('SECTION G: Reconciliation Edge Cases', () => {
    it('32. Hosted callback transition asserts ownership', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'pending',
      });

      const connService = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);

      await connService.transitionZernioConnectedAtomically({
        orgId,
        connectionId: connId,
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('connected');

      // Reconciliation job created with desired_state: connected
      const reconJob = await reconJobRepo.getJobById(`recon_zernio_${connId}`);
      expect(reconJob).not.toBeNull();
      expect(reconJob?.desired_state).toBe('connected');
    });

    it('33. account.connected webhook transition asserts ownership', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'pending',
      });

      const connService = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);

      await connService.transitionZernioConnectedAtomically({
        orgId,
        connectionId: connId,
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const reconJob = await reconJobRepo.getJobById(`recon_zernio_${connId}`);
      expect(reconJob?.desired_state).toBe('connected');
      expect(reconJob?.provider_account_id).toBe(accountId);
    });

    it('34. Valid live connected: stable observation', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'connected',
      });

      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'connected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const liveAccounts: any = [{ id: accountId, name: 'Main Line', platform: 'whatsapp', status: 'connected' }];
      liveAccounts.total = 1;

      const mockZernio = {
        listAccounts: vi.fn().mockResolvedValue(liveAccounts),
        getWhatsAppNumberInfo: vi.fn().mockResolvedValue({
          phone: {
            status: 'CONNECTED',
            platform_type: 'CLOUD_API',
            display_phone_number: phone,
          },
        }),
      } as unknown as ZernioHttpClient;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        mockZernio,
        cleanupJobRepo
      );

      const summary = await reconService.executeDueJobs({ batchSize: 5 });
      expect(summary.stableCount).toBe(1);

      const reconJob = await reconJobRepo.getJobById(`recon_zernio_${connId}`);
      expect(reconJob?.consecutive_stable_observations).toBe(1);
    });

    it('35. Identity drift -> error recorded, no silent overwrite', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'connected',
      });

      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'connected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const liveAccounts: any = [{ id: accountId, name: 'Main Line', platform: 'whatsapp', status: 'connected' }];
      liveAccounts.total = 1;

      // Remote returns different phone number!
      const mockZernio = {
        listAccounts: vi.fn().mockResolvedValue(liveAccounts),
        getWhatsAppNumberInfo: vi.fn().mockResolvedValue({
          phone: {
            status: 'CONNECTED',
            platform_type: 'CLOUD_API',
            display_phone_number: '+5511888888888', // Drift!
          },
        }),
      } as unknown as ZernioHttpClient;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        mockZernio,
        cleanupJobRepo
      );

      const summary = await reconService.executeDueJobs({ batchSize: 5 });
      expect(summary.failedCount).toBe(1);

      const reconJob = await reconJobRepo.getJobById(`recon_zernio_${connId}`);
      expect(reconJob?.last_error_code).toBe('IDENTITY_DRIFT');

      // Local connection phone number was NOT overwritten silently
      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.phone_number).toBe(phone);
    });

    it('36. Transient error -> does not mark connection disconnected', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'connected',
      });

      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'connected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const mockZernio = {
        listAccounts: vi.fn().mockRejectedValue(
          new ZernioError({
            statusCode: 503,
            kind: 'TRANSIENT_PROVIDER_ERROR',
            message: 'Service Unavailable',
          })
        ),
      } as unknown as ZernioHttpClient;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        mockZernio,
        cleanupJobRepo
      );

      const summary = await reconService.executeDueJobs({ batchSize: 5 });
      expect(summary.failedCount).toBe(1);

      // Connection status MUST stay connected
      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('connected');
    });

    it('37. Remote dead code 404 -> records failure and provider disconnected', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'connected',
      });

      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'connected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const mockZernio = {
        listAccounts: vi.fn().mockResolvedValue([]),
        getWhatsAppNumberInfo: vi.fn().mockRejectedValue(
          new ZernioError({
            kind: 'PLATFORM_ERROR' as any,
            statusCode: 400,
            message: 'Channel dead',
            safeDetails: { platformError: { code: '100', error_subcode: '33' } },
          })
        ),
      } as unknown as ZernioHttpClient;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        mockZernio,
        cleanupJobRepo
      );

      const summary = await reconService.executeDueJobs({ batchSize: 5 });
      expect(summary.failedCount).toBe(1);

      const reconJob = await reconJobRepo.getJobById(`recon_zernio_${connId}`);
      expect(reconJob?.last_error_code).toBe('ZERNIO_RECONCILIATION_REMOTE_DEAD');
    });

    it('38. Disconnected connection is NEVER revived to connected by reconciliation', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      // Even if recon job has desiredState 'connected' (e.g. stale job)
      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'connected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const liveAccounts: any = [{ id: accountId, name: 'Live', platform: 'whatsapp', status: 'connected' }];
      liveAccounts.total = 1;

      const mockZernio = {
        listAccounts: vi.fn().mockResolvedValue(liveAccounts),
        getWhatsAppNumberInfo: vi.fn().mockResolvedValue({ phoneNumber: phone }),
      } as unknown as ZernioHttpClient;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        mockZernio,
        cleanupJobRepo
      );

      await reconService.executeDueJobs({ batchSize: 5 });

      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('disconnected');
    });

    it('39. Disconnected + remote identity -> ensures cleanup job exists', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'disconnected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const mockZernio = {
        listAccounts: vi.fn().mockResolvedValue([{ id: accountId, platform: 'whatsapp' }]),
      } as unknown as ZernioHttpClient;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        mockZernio,
        cleanupJobRepo
      );

      await reconService.executeDueJobs({ batchSize: 5 });

      const cleanupJob = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(cleanupJob).not.toBeNull();
      expect(cleanupJob?.provider_account_id).toBe(accountId);
    });

    it('40. Claims never deleted by reconciliation', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'disconnected',
      });

      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'disconnected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        { listAccounts: vi.fn().mockResolvedValue([]) } as unknown as ZernioHttpClient,
        cleanupJobRepo
      );

      await reconService.executeDueJobs({ batchSize: 5 });

      // Claims must NEVER be deleted by reconciliation
      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      const phoneClaim = await claimRepo.getClaim(getZernioPhoneClaimId(phone));
      expect(accountClaim).not.toBeNull();
      expect(phoneClaim).not.toBeNull();
    });

    it('41. Arbitrary error not healed', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'error',
      });

      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'connected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const liveAccounts: any = [{ id: accountId, platform: 'whatsapp', status: 'connected' }];
      liveAccounts.total = 1;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        {
          listAccounts: vi.fn().mockResolvedValue(liveAccounts),
          getWhatsAppNumberInfo: vi.fn().mockResolvedValue({ phoneNumber: phone }),
        } as unknown as ZernioHttpClient,
        cleanupJobRepo
      );

      await reconService.executeDueJobs({ batchSize: 5 });

      // Only PROVIDER_DISCONNECTED is healable; generic error stays error
      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('error');
    });

    it('42. Eligible PROVIDER_DISCONNECTED heals only on live proof', async () => {
      const { orgId, connId, accountId, profileId, phone } = await seedMaterializedZernioConnection({
        status: 'error',
      });

      // Set status_reason to PROVIDER_DISCONNECTED
      await db.collection('whatsapp_connections').doc(connId).update({
        status_reason: 'PROVIDER_DISCONNECTED',
      });

      await reconJobRepo.ensureZernioJobPending({
        connectionId: connId,
        organizationId: orgId,
        desiredState: 'connected',
        providerAccountId: accountId,
        providerProfileId: profileId,
        phoneNumber: phone,
      });

      const liveAccounts: any = [{ id: accountId, platform: 'whatsapp', status: 'connected' }];
      liveAccounts.total = 1;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        undefined,
        {
          listAccounts: vi.fn().mockResolvedValue(liveAccounts),
          getWhatsAppNumberInfo: vi.fn().mockResolvedValue({
            phone: {
              status: 'CONNECTED',
              platform_type: 'CLOUD_API',
              display_phone_number: phone,
            },
          }),
        } as unknown as ZernioHttpClient,
        cleanupJobRepo
      );

      const summary = await reconService.executeDueJobs({ batchSize: 5 });
      expect(summary.repairedCount).toBe(1);

      const conn = await connectionRepo.getConnectionById(connId);
      expect(conn?.status).toBe('connected');
    });
  });

  // =========================================================================
  // SECTION H: Meta Regression (Tests 43-44)
  // =========================================================================
  describe('SECTION H: Meta Regression', () => {
    it('43. Existing Meta cleanup behavior unchanged', async () => {
      const orgId = uniqueId('org');
      const connId = uniqueId('conn');
      const wabaId = uniqueId('waba');
      const phoneId = uniqueId('phone');
      const nowIso = new Date().toISOString();

      await db.collection('whatsapp_connections').doc(connId).set({
        id: connId,
        organization_id: orgId,
        display_name: 'Meta Line',
        status: 'disconnected',
        provider: 'meta',
        provider_waba_id: wabaId,
        provider_phone_number_id: phoneId,
        created_at: nowIso,
        updated_at: nowIso,
      });

      const jobId = `cleanup_meta_${connId}`;
      await cleanupJobRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'meta',
        provider_waba_id: wabaId,
        provider_phone_number_id: phoneId,
        provider_account_id: null,
        provider_profile_id: null,
        phone_number: null,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: nowIso,
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
        created_at: nowIso,
        updated_at: nowIso,
        completed_at: null,
        retention_expires_at: null,
      });

      const enc = encryptionService.encryptToken('meta_token_val', orgId, connId);
      await secretRepo.setSecret({
        id: connId,
        connection_id: connId,
        organization_id: orgId,
        key_version: enc.keyVersion,
        encrypted_access_token: enc.encryptedAccessToken,
        iv: enc.iv,
        auth_tag: enc.authTag,
        token_type: 'business_token',
        expires_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

      const mockMetaProvider: WhatsAppProvider = {
        name: 'meta',
        capabilities: { supportsOffboardingCleanup: true, supportsActiveReconciliation: true } as any,
        validateConfiguration: vi.fn(),
        verifyWebhookPayload: vi.fn(),
        parseWebhookEvent: vi.fn(),
        sendMessage: vi.fn(),
        unsubscribeMessagingAccountApps: vi.fn().mockResolvedValue({
          success: true,
        }),
        checkMessagingAccountSubscribedApps: vi.fn().mockResolvedValue({
          status: 'PROVEN_UNSUBSCRIBED',
          proof: 'PROVEN_CLEAN',
        }),
      } as any;

      const cleanupService = new WhatsAppCleanupService(
        cleanupJobRepo,
        lockRepo,
        reconJobRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        mockMetaProvider,
        new ZernioHttpClient()
      );

      await cleanupService.executeDueJobs({ batchSize: 5 });

      expect(mockMetaProvider.unsubscribeMessagingAccountApps).toHaveBeenCalledTimes(1);

      const job = await cleanupJobRepo.getJob(jobId);
      expect(job?.status).toBe('succeeded');
    });

    it('44. Meta reconciliation behavior unchanged', async () => {
      const orgId = uniqueId('org');
      const connId = uniqueId('conn');
      const wabaId = uniqueId('waba');
      const nowIso = new Date().toISOString();

      await db.collection('whatsapp_connections').doc(connId).set({
        id: connId,
        organization_id: orgId,
        display_name: 'Meta Line',
        status: 'connected',
        provider: 'meta',
        provider_waba_id: wabaId,
        provider_phone_number_id: 'phone-1',
        created_at: nowIso,
        updated_at: nowIso,
      });

      const encRecon = encryptionService.encryptToken('meta_token_val', orgId, connId);
      await secretRepo.setSecret({
        id: connId,
        connection_id: connId,
        organization_id: orgId,
        key_version: encRecon.keyVersion,
        encrypted_access_token: encRecon.encryptedAccessToken,
        iv: encRecon.iv,
        auth_tag: encRecon.authTag,
        token_type: 'business_token',
        expires_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      });

      const jobId = `recon_meta_${wabaId}`;
      await db.collection('whatsapp_waba_reconciliation_jobs').doc(jobId).set({
        id: jobId,
        provider: 'meta',
        provider_waba_id: wabaId,
        organization_id: orgId,
        connection_id: connId,
        desired_state: 'connected',
        status: 'pending',
        attempt_count: 0,
        next_attempt_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      });

      const mockMetaProvider: WhatsAppProvider = {
        name: 'meta',
        capabilities: { supportsActiveReconciliation: true } as any,
        validateConfiguration: vi.fn(),
        verifyWebhookPayload: vi.fn(),
        parseWebhookEvent: vi.fn(),
        sendMessage: vi.fn(),
        checkMessagingAccountSubscribedApps: vi.fn().mockResolvedValue({
          status: 'PROVEN_SUBSCRIBED',
        }),
      } as any;

      const reconService = new WhatsAppReconciliationService(
        reconJobRepo,
        lockRepo,
        connectionRepo,
        secretRepo,
        encryptionService,
        mockMetaProvider,
        new ZernioHttpClient(),
        cleanupJobRepo
      );

      const summary = await reconService.executeDueJobs({ batchSize: 5 });
      expect(mockMetaProvider.checkMessagingAccountSubscribedApps).toHaveBeenCalledTimes(1);
      expect(summary.stableCount).toBe(1);
    });
  });

  // =========================================================================
  // SECTION I: Pagination and Absence Proof (Tests 45-46)
  // =========================================================================
  describe('SECTION I: Pagination and Absence Proof', () => {
    it('45. Incomplete page / total > returned: cannot settle, returns false', () => {
      const accounts: any[] = [
        { id: 'acc_other_1', name: 'Other 1', platform: 'whatsapp' },
        { id: 'acc_other_2', name: 'Other 2', platform: 'whatsapp' },
      ];
      // Total says 15, but only 2 returned, limit was 10
      (accounts as any).total = 15;
      (accounts as any).hasMore = true;
      (accounts as any).limit = 10;
      (accounts as any).page = 1;

      // Cannot prove absent fail-closed because pages remain un-probed
      const provenAbsent = isZernioAccountProvenAbsent(accounts as any, 'acc_target_missing', 10);
      expect(provenAbsent).toBe(false);
    });

    it('46. Complete page: total == returned length and target absent -> proven absent', () => {
      const accounts: any[] = [
        { id: 'acc_other_1', name: 'Other 1', platform: 'whatsapp' },
        { id: 'acc_other_2', name: 'Other 2', platform: 'whatsapp' },
      ];
      (accounts as any).total = 2;
      (accounts as any).hasMore = false;
      (accounts as any).limit = 10;
      (accounts as any).page = 1;

      const provenAbsent = isZernioAccountProvenAbsent(accounts, 'acc_target_missing', 10);
      expect(provenAbsent).toBe(true);
    });
  });

  // =========================================================================
  // SECTION 18: Concurrency & Lease Fencing
  // =========================================================================
  describe('SECTION 18: Concurrency & Lease Fencing', () => {
    it('Concurrent disconnect calls produce exact 1 cleanup job with claims retained', async () => {
      const { orgId, connId, accountId, phone, actorUserId } = await seedMaterializedZernioConnection();
      const service1 = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);
      const service2 = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);

      // Trigger 2 concurrent disconnect calls
      const results = await Promise.allSettled([
        service1.disconnectConnection(orgId, connId, actorUserId),
        service2.disconnectConnection(orgId, connId, actorUserId),
      ]);

      // Both must succeed (or one succeeds and second is idempotent)
      for (const res of results) {
        expect(res.status).toBe('fulfilled');
      }

      // Exact 1 cleanup job exists
      const cleanupJob = await cleanupJobRepo.getJob(`cleanup_conn_${connId}`);
      expect(cleanupJob).not.toBeNull();
      expect(cleanupJob?.id).toBe(`cleanup_conn_${connId}`);

      // Claims must still be retained
      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(accountId));
      const phoneClaim = await claimRepo.getClaim(getZernioPhoneClaimId(phone));
      expect(accountClaim).not.toBeNull();
      expect(phoneClaim).not.toBeNull();
    });
  });
});
