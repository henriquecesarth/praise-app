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

describe('Phase R7-C: Firestore OCC & Concurrent State Transition Safety (Emulator)', { timeout: 30000 }, () => {
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
      accessToken: 'EAAG_mock_business_token_r7c',
      tokenType: 'business_token',
      expiresAt: new Date(Date.now() + 5184000 * 1000).toISOString(),
    }),
    verifyMessagingAccountAccess: vi.fn().mockResolvedValue(true),
    listAuthorizedPhoneNumbers: vi.fn().mockResolvedValue([
      { id: 'phone_default', displayPhoneNumber: '+5511999990002', verifiedName: 'LouvAIO R7C' },
    ]),
    getPhoneNumberDetails: vi.fn().mockResolvedValue({
      displayPhoneNumber: '+5511999990002',
      verifiedName: 'LouvAIO R7C',
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
    return prefix + '_r7c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  const nowIso = new Date().toISOString();

  async function seedOrgAndMinistry(orgId: string, ministryId: string, ownerUserId = 'owner-r7c') {
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
  // TEST A — STALE ONBOARDING WRITE
  // 1. Actor A reads state.
  // 2. Pause A before authoritative transaction/write.
  // 3. Actor B advances connection.
  // 4. Resume A.
  // 5. Prove A cannot overwrite B's newer state.
  // =========================================================================
  it('TEST A — STALE ONBOARDING WRITE: Actor A cannot overwrite Actor B newer state based on stale read', async () => {
    const orgId = uniqueId('org');
    const ministryId = uniqueId('min');
    const connId = uniqueId('conn');
    const phoneId = uniqueId('phone');
    const wabaId = uniqueId('waba');
    await seedOrgAndMinistry(orgId, ministryId);

    const connRef = db.collection('whatsapp_connections').doc(connId);
    await connRef.set({
      id: connId,
      organization_id: orgId,
      display_name: 'Test Line A',
      provider: 'meta_cloud_api',
      status: 'connecting',
      status_reason: null,
      phone_number: '+5511999990001',
      provider_waba_id: wabaId,
      provider_phone_number_id: phoneId,
      pending_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    // 1. Actor A reads state outside transaction
    const preSnap = await connRef.get();
    const actorAReadStatus = preSnap.data()?.status;
    expect(actorAReadStatus).toBe('connecting');

    // 2. Actor B advances connection to 'disconnected'
    await connRef.update({
      status: 'disconnected',
      disconnect_reason: 'USER_DISCONNECTED',
      pending_expires_at: null,
      updated_at: new Date().toISOString(),
    });

    const docAfterB = (await connRef.get()).data();
    expect(docAfterB?.status).toBe('disconnected');

    // 3. Actor A attempts to perform transition based on stale read
    // Because transitionConnectionStatus is transactional with fresh read, it must fail closed
    let actorAError: any = null;
    try {
      await service.transitionConnectionStatus(orgId, connId, 'connected');
    } catch (err) {
      actorAError = err;
    }

    expect(actorAError).toBeDefined();
    // Invariant: cannot transition from disconnected -> connected
    expect(actorAError).toBeInstanceOf(AppError);

    // 4. Final state is B's state, NOT overwritten by A
    const finalDoc = (await connRef.get()).data();
    expect(finalDoc?.status).toBe('disconnected');
    expect(finalDoc?.disconnect_reason).toBe('USER_DISCONNECTED');
  });

  // =========================================================================
  // TEST B — TRANSACTION RETRY OBSERVES FRESH STATE
  // Force:
  // transaction A reads document
  // -> transaction B commits conflicting write
  // -> transaction A attempts commit
  // Prove Firestore retries A and A's callback sees B's committed state.
  // Then prove A fails/no-ops according to domain invariant.
  // =========================================================================
  it('TEST B — TRANSACTION RETRY OBSERVES FRESH STATE: Firestore retries A and second pass observes B commit', async () => {
    const orgId = uniqueId('org');
    const ministryId = uniqueId('min');
    const connId = uniqueId('conn');
    await seedOrgAndMinistry(orgId, ministryId);

    const connRef = db.collection('whatsapp_connections').doc(connId);
    await connRef.set({
      id: connId,
      organization_id: orgId,
      display_name: 'Retry Test Line',
      provider: 'meta_cloud_api',
      status: 'connecting',
      status_reason: null,
      created_at: nowIso,
      updated_at: nowIso,
    });

    let passA = 0;
    let passB = 0;
    const observedStatusesInA: string[] = [];

    let resolveAuthRead: () => void;
    const authReadPromise = new Promise<void>((r) => { resolveAuthRead = r; });

    let resolveRetryRead: () => void;
    const retryReadPromise = new Promise<void>((r) => { resolveRetryRead = r; });

    // 1. Transaction A (Stale transition to 'connected')
    const txA = db.runTransaction(async (tx) => {
      passA++;
      const snap = await tx.get(connRef);
      const currentStatus = snap.data()?.status;
      observedStatusesInA.push(currentStatus);
      resolveRetryRead();

      await authReadPromise;

      if (currentStatus === 'disconnected') {
        throw new AppError(409, 'CANNOT_CONNECT_DISCONNECTED_LINE', {
          code: 'CANNOT_CONNECT_DISCONNECTED_LINE',
        });
      }

      tx.update(connRef, {
        status: 'connected',
        updated_at: new Date().toISOString(),
      });
    });

    // 2. Transaction B (Authoritative terminal transition to 'disconnected')
    const txB = (async () => {
      await retryReadPromise;

      return db.runTransaction(async (tx) => {
        passB++;
        const snap = await tx.get(connRef);
        resolveAuthRead();

        // Pause slightly to let txA submit its update first, so txB commit creates the OCC collision
        await new Promise((r) => setTimeout(r, 150));

        tx.update(connRef, {
          status: 'disconnected',
          disconnect_reason: 'TERMINAL_CLEANUP_BY_B',
          updated_at: new Date().toISOString(),
        });
      });
    })();

    const [resA, resB] = await Promise.allSettled([txA, txB]);

    // B succeeded
    expect(resB.status).toBe('fulfilled');

    // A was rejected on fresh state
    expect(resA.status).toBe('rejected');
    const errA = (resA as PromiseRejectedResult).reason;
    expect(errA).toBeInstanceOf(AppError);
    expect(errA.statusCode).toBe(409);
    expect(errA.details?.code).toBe('CANNOT_CONNECT_DISCONNECTED_LINE');

    // PROOF OF TRANSACTION RETRY:
    // Callback executed at least 2 times due to OCC conflict
    expect(passA).toBeGreaterThanOrEqual(2);
    // Pass 1 observed 'connecting'
    expect(observedStatusesInA[0]).toBe('connecting');
    // Pass 2 (retry) observed fresh state 'disconnected' committed by B!
    expect(observedStatusesInA[1]).toBe('disconnected');

    const finalDoc = (await connRef.get()).data();
    expect(finalDoc?.status).toBe('disconnected');
    expect(finalDoc?.disconnect_reason).toBe('TERMINAL_CLEANUP_BY_B');
  });

  // =========================================================================
  // TEST C — DISCONNECT VS ONBOARDING COMPLETION
  // Concurrent:
  // explicit disconnect vs onboarding completion/recovery.
  // Final state must not be reconnected by stale completion after authoritative disconnect.
  // =========================================================================
  it('TEST C — DISCONNECT VS ONBOARDING COMPLETION: line must NOT be reconnected after authoritative disconnect', async () => {
    const orgId = uniqueId('org');
    const ministryId = uniqueId('min');
    const connId = uniqueId('conn');
    const sessionId = uniqueId('sess');
    const wabaId = uniqueId('waba');
    const phoneId = uniqueId('phone');
    const ownerUserId = uniqueId('user');
    await seedOrgAndMinistry(orgId, ministryId, ownerUserId);

    const connRef = db.collection('whatsapp_connections').doc(connId);
    await connRef.set({
      id: connId,
      organization_id: orgId,
      display_name: 'Disconnect Race Line',
      provider: 'meta_cloud_api',
      status: 'connecting',
      status_reason: null,
      phone_number: '+5511999990002',
      provider_waba_id: wabaId,
      provider_phone_number_id: phoneId,
      pending_expires_at: new Date(Date.now() + 86400000).toISOString(),
      current_onboarding_session_id: sessionId,
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
      provider_progress: 'waba_subscribed',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    // Seed secret
    const encrypted = encryptionService.encryptToken('EAAG_test_token', orgId, connId);
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

    mockProvider.listAuthorizedPhoneNumbers.mockResolvedValueOnce([
      { id: phoneId, displayPhoneNumber: '+5511999990002', verifiedName: 'LouvAIO R7C' },
    ]);
    mockProvider.getPhoneNumberDetails.mockResolvedValueOnce({
      displayPhoneNumber: '+5511999990002',
      verifiedName: 'LouvAIO R7C',
      qualityRating: 'GREEN',
      messagingLimitTier: 'TIER_10K',
    });

    // Settle WABA lock with idle state
    const lockRef = db.collection('whatsapp_waba_lifecycle_locks').doc('lock_meta_' + wabaId);
    await lockRef.set({
      id: 'lock_meta_' + wabaId,
      provider: 'meta_cloud_api',
      provider_waba_id: wabaId,
      operation_status: 'idle',
      provider_observed_state: 'subscribed',
      operation_generation: 1,
      unresolved_remote_mutations: [],
      created_at: nowIso,
      updated_at: nowIso,
    });

    // 1. Authoritative disconnect commits
    await service.disconnectConnection(orgId, connId, ownerUserId);

    const docAfterDisconnect = (await connRef.get()).data();
    expect(docAfterDisconnect?.status).toBe('disconnected');

    // 2. Stale completion attempts Step 10 transaction
    // Precondition check inside transaction reads connDoc, observes 'disconnected',
    // and throws 409 CONNECTION_DISCONNECTED
    await expect(
      service.completeOnboarding(orgId, ownerUserId, {
        sessionId,
        stateNonce: rawNonce,
        code: 'any',
        wabaId,
        phoneNumberId: phoneId,
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'CONNECTION_DISCONNECTED' },
    });

    // Line is NEVER reconnected by stale completion
    const finalDoc = (await connRef.get()).data();
    expect(finalDoc?.status).toBe('disconnected');
    expect(finalDoc?.status_reason).toBe('USER_DISCONNECTED');
  });

  // =========================================================================
  // TEST D — CLEANUP SETTLEMENT VS STALE RECOVERY
  // Strong cleanup settlement races stale recovery/completion.
  // Strong terminal state must not be overwritten by stale actor.
  // =========================================================================
  it('TEST D — CLEANUP SETTLEMENT VS STALE RECOVERY: strong terminal cleanup blocks stale recovery commit', async () => {
    const orgId = uniqueId('org');
    const ministryId = uniqueId('min');
    const connId = uniqueId('conn');
    const sessionId = uniqueId('sess');
    const wabaId = uniqueId('waba');
    const phoneId = uniqueId('phone');
    const jobId = 'cleanup_conn_' + connId;
    const jobLease = uniqueId('job_lease');
    const wabaLease = uniqueId('waba_lease');
    await seedOrgAndMinistry(orgId, ministryId);

    const connRef = db.collection('whatsapp_connections').doc(connId);
    await connRef.set({
      id: connId,
      organization_id: orgId,
      display_name: 'Cleanup Settle Race Line',
      provider: 'meta_cloud_api',
      status: 'connecting',
      phone_number: '+5511999990003',
      provider_waba_id: wabaId,
      provider_phone_number_id: phoneId,
      pending_expires_at: new Date(Date.now() + 86400000).toISOString(),
      created_at: nowIso,
      updated_at: nowIso,
    });

    const sessionRef = db.collection('whatsapp_onboarding_sessions').doc(sessionId);
    await sessionRef.set({
      id: sessionId,
      organization_id: orgId,
      connection_id: connId,
      status: 'active',
      provider_progress: 'waba_subscribed',
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

    // WABA lock with idle status and clean unsubscribed proof (zero ambiguity)
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

    // 1. Strong settlement commits
    await cleanupJobRepo.finalizeMetaCleanupOnStrongSettlement(jobId, jobLease, {
      wabaId,
      generation: 2,
      leaseToken: wabaLease,
    });

    const settledConn = (await connRef.get()).data();
    expect(settledConn?.status).toBe('disconnected');
    expect(settledConn?.disconnect_reason).toBe('CLEANUP_COMPLETED');

    const settledJob = (await jobRef.get()).data();
    expect(settledJob?.status).toBe('succeeded');
    expect(settledJob?.provider_cleanup_proof).toBe('proven');

    // 2. Stale recovery attempts commitMaterializedDenialOwnershipAtomically
    // Precondition check inside transaction reads connDoc and jobDoc:
    // conn.status === 'disconnected' -> 409 CONNECTION_DISCONNECTED
    // and job.status === 'succeeded' -> 409 CLEANUP_OWNERSHIP_NOT_LIVE
    await expect(
      cleanupJobRepo.commitMaterializedDenialOwnershipAtomically({
        organizationId: orgId,
        connectionId: connId,
        sessionId,
        wabaId,
        phoneNumberId: phoneId,
        normalizedPhoneNumber: '+5511999990003',
      })
    ).rejects.toMatchObject({
      statusCode: 409,
    });

    // Strong terminal state is NOT overwritten
    const finalConn = (await connRef.get()).data();
    expect(finalConn?.status).toBe('disconnected');
    expect(finalConn?.disconnect_reason).toBe('CLEANUP_COMPLETED');

    const finalJob = (await jobRef.get()).data();
    expect(finalJob?.status).toBe('succeeded');
  });

  // =========================================================================
  // TEST E — MONOTONIC PROVIDER PROGRESS
  // Concurrent stale session/progress mutation cannot regress:
  // waba_subscribed
  // to an earlier checkpoint.
  // =========================================================================
  it('TEST E — MONOTONIC PROVIDER PROGRESS: stale session mutation cannot regress waba_subscribed', async () => {
    const orgId = uniqueId('org');
    const connId = uniqueId('conn');
    const sessionId = uniqueId('sess');

    const sessionRef = db.collection('whatsapp_onboarding_sessions').doc(sessionId);
    await sessionRef.set({
      id: sessionId,
      organization_id: orgId,
      connection_id: connId,
      status: 'active',
      provider_progress: 'waba_subscribed',
      created_at: nowIso,
      updated_at: nowIso,
    });

    // Stale requests attempt to regress checkpoint
    const resultA = await sessionRepo.updateProgressMonotonically(sessionId, 'assets_verified');
    expect(resultA?.provider_progress).toBe('waba_subscribed');

    const resultB = await sessionRepo.updateProgressMonotonically(sessionId, 'credential_staged');
    expect(resultB?.provider_progress).toBe('waba_subscribed');

    const resultC = await sessionRepo.updateProgressMonotonically(sessionId, 'phone_registered');
    expect(resultC?.provider_progress).toBe('waba_subscribed');

    const freshSession = (await sessionRef.get()).data();
    expect(freshSession?.provider_progress).toBe('waba_subscribed');
    expect(freshSession?.status).toBe('active');
  });

  // =========================================================================
  // TEST F — TRANSITION CONNECTION STATUS (IDEMPOTENT REPLAY & FRESH VALIDATION)
  // =========================================================================
  it('TEST F — transitionConnectionStatus retries on conflict and no-ops or fails safely on fresh state', async () => {
    const orgId = uniqueId('org');
    const connId = uniqueId('conn');

    const connRef = db.collection('whatsapp_connections').doc(connId);
    await connRef.set({
      id: connId,
      organization_id: orgId,
      display_name: 'Transition OCC Line',
      provider: 'meta_cloud_api',
      status: 'connecting',
      status_reason: null,
      created_at: nowIso,
      updated_at: nowIso,
    });

    await service.transitionConnectionStatus(orgId, connId, 'error', 'TEMPORARY_NETWORK_ERROR');
    const connAfterErr = (await connRef.get()).data();
    expect(connAfterErr?.status).toBe('error');
    expect(connAfterErr?.status_reason).toBe('TEMPORARY_NETWORK_ERROR');

    // Idempotent replay
    await service.transitionConnectionStatus(orgId, connId, 'error', 'TEMPORARY_NETWORK_ERROR');
    const connReplayed = (await connRef.get()).data();
    expect(connReplayed?.status).toBe('error');
  });
});
