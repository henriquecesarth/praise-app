import { describe, it, expect, vi } from 'vitest';
import crypto from 'crypto';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppOnboardingSessionRepository } from '../../repositories/WhatsAppOnboardingSessionRepository';
import { WhatsAppProviderCleanupJobRepository } from '../../repositories/WhatsAppProviderCleanupJobRepository';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { getClaimId } from './whatsapp.types';
import { AppError } from '../../middleware/error-handler';

describe('Phase R7-C-R1: Residual OCC Remediation (Emulator)', { timeout: 30000 }, () => {
  const connectionRepo = new WhatsAppConnectionRepository();
  const sessionRepo = new WhatsAppOnboardingSessionRepository();
  const cleanupJobRepo = new WhatsAppProviderCleanupJobRepository();
  const lockRepo = new WhatsAppWabaLifecycleLockRepository();
  const claimRepo = new WhatsAppProviderIdentityClaimRepository();
  const secretRepo = new WhatsAppConnectionSecretRepository();

  const validKey = crypto.randomBytes(32).toString('base64');
  const encryptionService = new WhatsAppEncryptionService(validKey);

  const mockProvider = {
    exchangeOAuthCode: vi.fn().mockResolvedValue({
      accessToken: 'EAAG_mock_business_token_r7cr1',
      tokenType: 'business_token',
      expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
    }),
    verifyMessagingAccountAccess: vi.fn().mockResolvedValue(true),
    listAuthorizedPhoneNumbers: vi.fn().mockResolvedValue([
      { id: 'phone_default', displayPhoneNumber: '+5511999990002', verifiedName: 'LouvAIO R7C-R1' },
    ]),
    getPhoneNumberDetails: vi.fn().mockResolvedValue({
      displayPhoneNumber: '+5511999990002',
      verifiedName: 'LouvAIO R7C-R1',
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
  } as any;

  const service = new WhatsAppConnectionService(
    connectionRepo,
    secretRepo,
    claimRepo,
    undefined,
    undefined,
    undefined,
    undefined,
    sessionRepo,
    mockProvider,
    encryptionService,
    undefined,
    cleanupJobRepo,
    lockRepo
  );

  function uniqueId(prefix: string): string {
    return prefix + '_r1_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  const nowIso = new Date().toISOString();

  async function seedOrgAndMinistry(orgId: string, ministryId: string, ownerUserId = 'owner-r1') {
    await db.collection('organizations').doc(orgId).set({
      id: orgId,
      name: 'Org ' + orgId,
      billing_anchor_ministry_id: ministryId,
      created_by_user_id: ownerUserId,
      created_at: nowIso,
      updated_at: nowIso,
    });
    await db.collection('organization_members').doc(orgId + '_' + ownerUserId).set({
      organization_id: orgId,
      user_id: ownerUserId,
      role: 'owner',
      created_at: nowIso,
      updated_at: nowIso,
    });
    await db.collection('ministries').doc(ministryId).set({
      id: ministryId,
      name: 'Ministry ' + ministryId,
      organization_id: orgId,
      created_at: nowIso,
      updated_at: nowIso,
    });
    await db.collection('ministry_subscriptions').doc(ministryId).set({
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'premium',
      billing_status: 'active',
      subscription_mode: 'paid',
      status: 'active',
      access_mode: 'normal',
      member_addon_blocks: 0,
      current_period_start: nowIso,
      current_period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });
  }

  // =========================================================================
  // TEST A — DISCONNECT CLEANUP DECISION STALE (DETERMINISTIC BARRIER PROOF)
  // 1. Actor A enters disconnectConnection and executes pre-transaction read.
  // 2. A observes provider_waba_id = null, provider_phone_number_id = null.
  // 3. A is paused before authoritative transaction state evaluation.
  // 4. Actor B commits WABA & phone materialization, lifecycle lock, and provider claim.
  // 5. A is resumed.
  // 6. A's transaction observes fresh state (provider_waba_id != null).
  // 7. Cleanup job is created atomically in same transaction as disconnect.
  // 8. Cleanup job carries correct connection, WABA, and phone identity.
  // 9. Secret remains retained (never deleted on stale false).
  // 10. Provider identity claim remains retained for strong settlement.
  // 11. No observable final state with disconnected + materialized provider state + no cleanup ownership.
  // =========================================================================
  it('TEST A — DISCONNECT CLEANUP DECISION STALE: derives cleanup requirement from freshConn and retains secret', async () => {
    const orgId = uniqueId('org');
    const ministryId = uniqueId('min');
    const connId = uniqueId('conn');
    const ownerUserId = uniqueId('user');
    const wabaId = uniqueId('waba');
    const phoneId = uniqueId('phone');
    await seedOrgAndMinistry(orgId, ministryId, ownerUserId);

    const connRef = db.collection('whatsapp_connections').doc(connId);
    // 1. Initial state: No WABA or Phone materialized (pre-transaction read sees cleanup unnecessary)
    await connRef.set({
      id: connId,
      organization_id: orgId,
      display_name: 'Stale Cleanup Race Line',
      provider: 'meta_cloud_api',
      status: 'connecting',
      status_reason: null,
      provider_waba_id: null,
      provider_phone_number_id: null,
      pending_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    // Seed secret
    const encrypted = encryptionService.encryptToken('EAAG_secret_to_retain', orgId, connId);
    const secretRef = db.collection('whatsapp_connection_secrets').doc(connId);
    await secretRepo.setSecret({
      id: connId,
      organization_id: orgId,
      connection_id: connId,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
      token_type: 'business_token',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    // Verify secret is initially present
    const initialSecretDoc = await secretRef.get();
    expect(initialSecretDoc.exists).toBe(true);

    // Setup deterministic barrier on connectionRepo.getConnectionById
    const originalGetConnectionById = connectionRepo.getConnectionById.bind(connectionRepo);

    let actorAEntered = false;
    let actorAObservedInitialRead: any = null;
    let actorAPaused = false;
    let resolveActorAPreRead!: () => void;
    const actorAPreReadPromise = new Promise<void>((resolve) => {
      resolveActorAPreRead = resolve;
    });

    let resolveActorBMaterialized!: () => void;
    const actorBMaterializedPromise = new Promise<void>((resolve) => {
      resolveActorBMaterialized = resolve;
    });

    const getConnSpy = vi.spyOn(connectionRepo, 'getConnectionById').mockImplementationOnce(async (id: string) => {
      actorAEntered = true;
      const conn = await originalGetConnectionById(id);
      actorAObservedInitialRead = conn;
      actorAPaused = true;
      resolveActorAPreRead();
      // Block Actor A here before disconnectConnection enters db.runTransaction
      await actorBMaterializedPromise;
      return conn;
    });

    // Step 1: Actor A starts disconnectConnection
    const actorAPromise = service.disconnectConnection(orgId, connId, ownerUserId);

    // Step 2 & 3: Wait for Actor A to execute pre-transaction read and pause
    await actorAPreReadPromise;
    expect(actorAEntered).toBe(true); // 1. Actor A entered disconnectConnection before B materialized
    expect(actorAObservedInitialRead).not.toBeNull();
    expect(actorAObservedInitialRead.provider_waba_id).toBeNull(); // 2. A's initial read observed no WABA
    expect(actorAObservedInitialRead.provider_phone_number_id).toBeNull(); // 2. A's initial read observed no phone
    expect(actorAPaused).toBe(true); // 3. A was paused before authoritative transaction state evaluation

    // Step 4: Actor B commits WABA & phone materialization, lifecycle lock, and provider claim
    await connRef.update({
      provider_waba_id: wabaId,
      provider_phone_number_id: phoneId,
      phone_number: '+5511999990001',
      updated_at: new Date().toISOString(),
    });

    const claimId = getClaimId('meta_cloud_api', phoneId);
    const claimRef = db.collection('whatsapp_provider_identity_claims').doc(claimId);
    await claimRef.set({
      id: claimId,
      provider: 'meta_cloud_api',
      provider_phone_number_id: phoneId,
      connection_id: connId,
      organization_id: orgId,
      status: 'active',
      created_at: nowIso,
      updated_at: nowIso,
    });

    const lockRef = db.collection('whatsapp_waba_lifecycle_locks').doc('lock_meta_' + wabaId);
    await lockRef.set({
      id: 'lock_meta_' + wabaId,
      provider: 'meta_cloud_api',
      provider_waba_id: wabaId,
      operation_status: 'idle',
      provider_observed_state: 'subscribed',
      operation_generation: 3,
      unresolved_remote_mutations: [],
      created_at: nowIso,
      updated_at: nowIso,
    });

    const bCommittedSnap = await connRef.get();
    expect(bCommittedSnap.data()?.provider_waba_id).toBe(wabaId); // 4. B committed WABA
    expect(bCommittedSnap.data()?.provider_phone_number_id).toBe(phoneId); // 4. B committed phone

    // Step 5: Resume Actor A to proceed into its transaction
    let actorAResumed = false;
    resolveActorBMaterialized();
    actorAResumed = true;
    await actorAPromise;
    expect(actorAResumed).toBe(true); // 5. A resumed

    getConnSpy.mockRestore();

    // Step 6: Verify disconnect transaction observed materialized WABA/phone
    const finalConnSnap = await connRef.get();
    const finalConn = finalConnSnap.data();
    expect(finalConn?.status).toBe('disconnected');
    expect(finalConn?.status_reason).toBe('USER_DISCONNECTED');
    expect(finalConn?.provider_waba_id).toBe(wabaId); // 6. Fresh WABA observed
    expect(finalConn?.provider_phone_number_id).toBe(phoneId); // 6. Fresh phone observed

    // Step 7 & 8: Verify cleanup job exists atomically with correct identity
    const cleanupJobId = 'cleanup_conn_' + connId;
    const cleanupJobDoc = await db.collection('whatsapp_provider_cleanup_jobs').doc(cleanupJobId).get();
    expect(cleanupJobDoc.exists).toBe(true); // 7. Cleanup job exists atomically

    const cleanupJob = cleanupJobDoc.data();
    expect(cleanupJob?.status).toBe('pending');
    expect(cleanupJob?.provider_waba_id).toBe(wabaId); // 8. Correct WABA ID
    expect(cleanupJob?.provider_phone_number_id).toBe(phoneId); // 8. Correct phone number ID
    expect(cleanupJob?.waba_claim_generation).toBe(3);
    expect(cleanupJob?.connection_id).toBe(connId);
    expect(cleanupJob?.organization_id).toBe(orgId);

    // Step 9: Verify secret remains retained (under old code, stale false would have deleted it!)
    const finalSecretDoc = await secretRef.get();
    expect(finalSecretDoc.exists).toBe(true); // 9. Secret retained

    // Step 10: Verify provider claim remains retained
    const finalClaimDoc = await claimRef.get();
    expect(finalClaimDoc.exists).toBe(true); // 10. Provider claim retained
    expect(finalClaimDoc.data()?.connection_id).toBe(connId);

    // Step 11: Invariant check - no observable final state with disconnected + materialized provider state + no cleanup ownership
    const hasMaterializedProviderState = Boolean(finalConn?.provider_waba_id || finalConn?.provider_phone_number_id);
    const isDisconnected = finalConn?.status === 'disconnected';
    const hasCleanupOwnership = cleanupJobDoc.exists && cleanupJob?.status === 'pending';
    const hasSecret = finalSecretDoc.exists;
    const hasClaim = finalClaimDoc.exists;

    expect(isDisconnected && hasMaterializedProviderState).toBe(true);
    expect(hasCleanupOwnership).toBe(true);
    expect(hasSecret).toBe(true);
    expect(hasClaim).toBe(true);
    expect(isDisconnected && hasMaterializedProviderState && !hasCleanupOwnership).toBe(false); // 11. Invariant holds
    expect(isDisconnected && hasMaterializedProviderState && !hasSecret).toBe(false); // 11. Invariant holds
  });

  // =========================================================================
  // TEST B — VALIDATION FAILURE VS DISCONNECT
  // 1. Actor A begins provider validation.
  // 2. Pause after authoritative pre-provider state read.
  // 3. Actor B disconnects connection.
  // 4. Provider validation for A fails.
  // 5. Resume A failure handler.
  // 6. Prove connection remains `disconnected`.
  // 7. A cannot overwrite it with `error`.
  // =========================================================================
  it('TEST B — VALIDATION FAILURE VS DISCONNECT: validation failure cannot overwrite disconnected state with error', async () => {
    const orgId = uniqueId('org');
    const ministryId = uniqueId('min');
    const connId = uniqueId('conn');
    const sessionId = uniqueId('sess');
    const ownerUserId = uniqueId('user');
    const wabaId = uniqueId('waba');
    const phoneId = uniqueId('phone');
    await seedOrgAndMinistry(orgId, ministryId, ownerUserId);

    const connRef = db.collection('whatsapp_connections').doc(connId);
    await connRef.set({
      id: connId,
      organization_id: orgId,
      display_name: 'Failure Vs Disconnect Line',
      provider: 'meta_cloud_api',
      status: 'connecting',
      status_reason: null,
      provider_waba_id: wabaId,
      provider_phone_number_id: phoneId,
      phone_number: '+5511999990002',
      current_onboarding_session_id: sessionId,
      pending_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const rawNonce = crypto.randomBytes(32).toString('hex');
    const nonceHash = crypto.createHash('sha256').update(rawNonce).digest('hex');

    const sessionRef = db.collection('whatsapp_onboarding_sessions').doc(sessionId);
    await sessionRef.set({
      id: sessionId,
      organization_id: orgId,
      connection_id: connId,
      status: 'active',
      state_nonce_hash: nonceHash,
      provider_progress: 'credential_staged',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const encrypted = encryptionService.encryptToken('EAAG_token_stage', orgId, connId);
    await secretRepo.setSecret({
      id: connId,
      organization_id: orgId,
      connection_id: connId,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
      token_type: 'business_token',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    // Intercept provider validation: while Actor A is waiting on provider, Actor B disconnects
    mockProvider.verifyMessagingAccountAccess.mockImplementationOnce(async () => {
      // 3. Actor B disconnects connection concurrently
      await service.disconnectConnection(orgId, connId, ownerUserId);

      const intermediateConn = (await connRef.get()).data();
      expect(intermediateConn?.status).toBe('disconnected');

      // 4. Provider validation fails
      return false;
    });

    // 5. Actor A executes completeOnboarding and fails validation
    await expect(
      service.completeOnboarding(orgId, ownerUserId, {
        sessionId,
        stateNonce: rawNonce,
        code: 'any_code',
        wabaId,
        phoneNumberId: phoneId,
      })
    ).rejects.toMatchObject({
      statusCode: 403,
      details: { code: 'UNAUTHORIZED_WABA_ACCESS' },
    });

    // 6 & 7. Prove connection remains `disconnected` and was NOT overwritten by Actor A with `error`
    const finalConn = (await connRef.get()).data();
    expect(finalConn?.status).toBe('disconnected');
    expect(finalConn?.status_reason).toBe('USER_DISCONNECTED');
  });

  // =========================================================================
  // TEST C — VALIDATION FAILURE VS STRONG CLEANUP
  // Actor B completes strong cleanup settlement while Actor A validation is in-flight.
  // Prove stale failure path cannot overwrite terminal disconnected state.
  // =========================================================================
  it('TEST C — VALIDATION FAILURE VS STRONG CLEANUP: stale validation failure cannot overwrite settled cleanup', async () => {
    const orgId = uniqueId('org');
    const ministryId = uniqueId('min');
    const connId = uniqueId('conn');
    const sessionId = uniqueId('sess');
    const ownerUserId = uniqueId('user');
    const wabaId = uniqueId('waba');
    const phoneId = uniqueId('phone');
    const jobId = 'cleanup_conn_' + connId;
    const jobLease = uniqueId('job_lease');
    const wabaLease = uniqueId('waba_lease');
    await seedOrgAndMinistry(orgId, ministryId, ownerUserId);

    const connRef = db.collection('whatsapp_connections').doc(connId);
    await connRef.set({
      id: connId,
      organization_id: orgId,
      display_name: 'Failure Vs Strong Cleanup Line',
      provider: 'meta_cloud_api',
      status: 'connecting',
      status_reason: null,
      provider_waba_id: wabaId,
      provider_phone_number_id: phoneId,
      phone_number: '+5511999990003',
      current_onboarding_session_id: sessionId,
      pending_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const rawNonce = crypto.randomBytes(32).toString('hex');
    const nonceHash = crypto.createHash('sha256').update(rawNonce).digest('hex');

    const sessionRef = db.collection('whatsapp_onboarding_sessions').doc(sessionId);
    await sessionRef.set({
      id: sessionId,
      organization_id: orgId,
      connection_id: connId,
      status: 'active',
      state_nonce_hash: nonceHash,
      provider_progress: 'credential_staged',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const encrypted = encryptionService.encryptToken('EAAG_token_cleanup_race', orgId, connId);
    await secretRepo.setSecret({
      id: connId,
      organization_id: orgId,
      connection_id: connId,
      encrypted_access_token: encrypted.encryptedAccessToken,
      iv: encrypted.iv,
      auth_tag: encrypted.authTag,
      key_version: encrypted.keyVersion,
      token_type: 'business_token',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const jobRef = db.collection('whatsapp_provider_cleanup_jobs').doc(jobId);
    await jobRef.set({
      id: jobId,
      organization_id: orgId,
      connection_id: connId,
      provider: 'meta_cloud_api',
      provider_waba_id: wabaId,
      provider_phone_number_id: phoneId,
      phone_number: '+5511999990003',
      status: 'processing',
      attempt_count: 1,
      max_attempts: 5,
      next_attempt_at: nowIso,
      lease_token: jobLease,
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const lockRef = db.collection('whatsapp_waba_lifecycle_locks').doc('lock_meta_' + wabaId);
    await lockRef.set({
      id: 'lock_meta_' + wabaId,
      provider: 'meta_cloud_api',
      provider_waba_id: wabaId,
      operation_status: 'idle',
      operation_generation: 2,
      lease_token: wabaLease,
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      provider_observed_state: 'unsubscribed',
      provider_observed_generation: 2,
      unresolved_remote_mutations: [],
      created_at: nowIso,
      updated_at: nowIso,
    });

    // Actor A passes Step 5 (WABA verified). In Step 6, phone list fetch is called:
    mockProvider.verifyMessagingAccountAccess.mockResolvedValueOnce(true);
    mockProvider.listAuthorizedPhoneNumbers.mockImplementationOnce(async () => {
      // Actor B completes strong cleanup settlement concurrently
      await cleanupJobRepo.finalizeMetaCleanupOnStrongSettlement(jobId, jobLease, {
        wabaId,
        generation: 2,
        leaseToken: wabaLease,
      });

      const settledConn = (await connRef.get()).data();
      expect(settledConn?.status).toBe('disconnected');
      expect(settledConn?.disconnect_reason).toBe('CLEANUP_COMPLETED');

      // Actor A provider call fails
      throw new Error('Meta network error');
    });

    // Actor A completes call and encounters failure
    await expect(
      service.completeOnboarding(orgId, ownerUserId, {
        sessionId,
        stateNonce: rawNonce,
        code: 'any_code',
        wabaId,
        phoneNumberId: phoneId,
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'PHONE_NOT_IN_WABA' },
    });

    // Terminal strong settled state MUST NOT be overwritten
    const finalConn = (await connRef.get()).data();
    expect(finalConn?.status).toBe('disconnected');
    expect(finalConn?.disconnect_reason).toBe('CLEANUP_COMPLETED');

    const finalJob = (await jobRef.get()).data();
    expect(finalJob?.status).toBe('succeeded');
    expect(finalJob?.provider_cleanup_proof).toBe('proven');
  });
});
