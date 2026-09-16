import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { db } from '../../lib/firebase';
import { PublicWhatsAppController } from './public-whatsapp.controller';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppOnboardingSessionRepository } from '../../repositories/WhatsAppOnboardingSessionRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { ZernioHttpClient } from './zernio-http-client';
import { getZernioAccountClaimId, getZernioPhoneClaimId } from './whatsapp.types';
import { config } from '../../config/unifiedConfig';
import { AppError } from '../../middleware/error-handler';

describe('Zernio Hosted Onboarding & Verified Callback Integration (Phase 7D2-D4)', { timeout: 20000 }, () => {
  const connectionRepo = new WhatsAppConnectionRepository();
  const sessionRepo = new WhatsAppOnboardingSessionRepository();
  const claimRepo = new WhatsAppProviderIdentityClaimRepository();

  function uniqueId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async function setupTestOrganization(orgId: string, anchorMinistryId: string, adminUserId: string) {
    const now = new Date().toISOString();
    await db.collection('organizations').doc(orgId).set({
      id: orgId,
      name: 'Org ' + orgId,
      slug: 'org-' + orgId,
      owner_user_id: adminUserId,
      billing_anchor_ministry_id: anchorMinistryId,
      default_whatsapp_connection_id: null,
      created_at: now,
      updated_at: now,
    });

    await db.collection('organization_members').doc(`${orgId}_${adminUserId}`).set({
      id: `${orgId}_${adminUserId}`,
      organization_id: orgId,
      user_id: adminUserId,
      role: 'admin',
      invited_by_user_id: null,
      created_at: now,
      updated_at: now,
    });

    await db.collection('ministry_subscriptions').doc(anchorMinistryId).set({
      id: anchorMinistryId,
      ministry_id: anchorMinistryId,
      plan_id: 'pro',
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'paid',
      created_at: now,
      updated_at: now,
    });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('1. Start Onboarding (Clean Allocation & Capacity Enforcement)', () => {
    it('allocates a pending connection, ensures/binds Zernio profile, creates session wabs_z_${tokenHash}, and returns authUrl', async () => {
      const orgId = uniqueId('org');
      const ministryId = uniqueId('min');
      const adminUserId = uniqueId('user_admin');

      await setupTestOrganization(orgId, ministryId, adminUserId);

      let capturedConnectUrlParams: any;
      let lastCreatedProfileName = '';
      const fakeFetch = vi.fn(async (url: string, init?: any) => {
        const urlObj = new URL(url);
        if (urlObj.pathname.includes('/profiles')) {
          if (init?.body) {
            try {
              const body = JSON.parse(init.body as string);
              if (body.name) lastCreatedProfileName = body.name;
            } catch {}
          }
          return {
            ok: true,
            status: 201,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                profile: {
                  _id: 'prof_zernio_auto_1',
                  name: lastCreatedProfileName,
                },
              }),
          } as any;
        }
        if (urlObj.pathname.includes('/connect/whatsapp')) {
          capturedConnectUrlParams = {
            profileId: urlObj.searchParams.get('profileId'),
            redirectUrl: urlObj.searchParams.get('redirect_url'),
            onboarding: urlObj.searchParams.get('onboarding'),
            signup: urlObj.searchParams.get('signup'),
          };
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                authUrl: 'https://zernio.com/connect/whatsapp?session=sess_123',
              }),
          } as any;
        }
        return { ok: false, status: 404, text: async () => 'Not found' } as any;
      });

      const zernioClient = new ZernioHttpClient({
        apiKey: 'test_key',
        fetchFn: fakeFetch as any,
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        zernioClient
      );

      const result = await service.startOnboarding(orgId, adminUserId, {
        displayName: 'Zernio Test Line',
        provider: 'zernio',
      });

      expect(result.provider).toBe('zernio');
      expect(result.connectionId).toMatch(/^wac_/);
      expect(result.sessionId).toMatch(/^wabs_z_[0-9a-f]{64}$/);
      expect(result.authUrl).toBe('https://zernio.com/connect/whatsapp?session=sess_123');
      expect(result.mode).toBe('start');
      expect(result.stateNonce).toBeUndefined();
      const expectedMinExpiresAt = Date.now() + 59 * 60 * 1000;
      const expectedMaxExpiresAt = Date.now() + 61 * 60 * 1000;
      expect(new Date(result.expiresAt).getTime()).toBeGreaterThanOrEqual(expectedMinExpiresAt);
      expect(new Date(result.expiresAt).getTime()).toBeLessThanOrEqual(expectedMaxExpiresAt);

      // Verify connection in Firestore
      const conn = await connectionRepo.getConnectionById(result.connectionId);
      expect(conn).not.toBeNull();
      expect(conn?.provider).toBe('zernio');
      expect(conn?.status).toBe('pending');
      expect(conn?.provider_profile_id).toBe('prof_zernio_auto_1');
      expect(conn?.current_onboarding_session_id).toBe(result.sessionId);

      // Verify session in Firestore
      const session = await sessionRepo.getSessionById(result.sessionId);
      expect(session).not.toBeNull();
      expect(session?.status).toBe('active');
      expect(session?.connection_id).toBe(result.connectionId);
      expect(session?.organization_id).toBe(orgId);

      // Verify redirectUrl contains token
      expect(capturedConnectUrlParams.profileId).toBe('prof_zernio_auto_1');
      expect(capturedConnectUrlParams.onboarding).toBe('api');
      expect(capturedConnectUrlParams.signup).toBe('hosted');
      expect(capturedConnectUrlParams.redirectUrl).toContain('/api/v1/whatsapp/zernio/callback?token=');
    });

    it('rejects non-admin member from starting onboarding with 403', async () => {
      const orgId = uniqueId('org');
      const ministryId = uniqueId('min');
      const adminUserId = uniqueId('user_admin');
      const normalMemberUserId = uniqueId('user_member');

      await setupTestOrganization(orgId, ministryId, adminUserId);

      // Add normal member
      await db.collection('organization_members').doc(`${orgId}_${normalMemberUserId}`).set({
        id: `${orgId}_${normalMemberUserId}`,
        organization_id: orgId,
        user_id: normalMemberUserId,
        role: 'member',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService();

      await expect(
        service.startOnboarding(orgId, normalMemberUserId, { provider: 'zernio' })
      ).rejects.toThrow('Apenas administradores da organização podem iniciar o onboarding');
    });

    it('rejects startOnboarding when commercial capacity limit is reached with 403', async () => {
      const orgId = uniqueId('org');
      const ministryId = uniqueId('min');
      const adminUserId = uniqueId('user_admin');

      await setupTestOrganization(orgId, ministryId, adminUserId);

      // Create an already active connected connection (Pro plan included = 1)
      await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Existing Line',
        created_by_user_id: adminUserId,
        provider: 'zernio',
        status: 'connected',
      });

      const service = new WhatsAppConnectionService();

      await expect(
        service.startOnboarding(orgId, adminUserId, { provider: 'zernio' })
      ).rejects.toThrow('Limite de capacidade comercial de conexões WhatsApp atingido');
    });
  });

  describe('2. Start Onboarding (Resume Existing Reservation)', () => {
    it('resumes a clean pending connection, assigns a new session, and expires the previous session', async () => {
      const orgId = uniqueId('org');
      const ministryId = uniqueId('min');
      const adminUserId = uniqueId('user_admin');

      await setupTestOrganization(orgId, ministryId, adminUserId);

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line To Resume',
        created_by_user_id: adminUserId,
        provider: 'zernio',
        status: 'pending',
        pending_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        current_onboarding_session_id: 'wabs_old_session',
      });

      // Old session doc
      await db.collection('whatsapp_onboarding_sessions').doc('wabs_old_session').set({
        id: 'wabs_old_session',
        status: 'active',
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: adminUserId,
        state_nonce_hash: 'old_hash',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      let lastProfileName = '';
      const fakeFetch = vi.fn(async (url: string, init?: any) => {
        const urlObj = new URL(url);
        if (urlObj.pathname.includes('/profiles')) {
          if (init?.body) {
            try {
              const body = JSON.parse(init.body as string);
              if (body.name) lastProfileName = body.name;
            } catch {}
          }
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () => JSON.stringify({ profile: { _id: 'prof_resumed_1', name: lastProfileName } }),
          } as any;
        }
        if (urlObj.pathname.includes('/connect/whatsapp')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text: async () =>
              JSON.stringify({
                authUrl: 'https://zernio.com/connect/whatsapp?resumed=1',
              }),
          } as any;
        }
        return { ok: false, status: 404, text: async () => 'Not found' } as any;
      });

      const zernioClient = new ZernioHttpClient({ apiKey: 'k', fetchFn: fakeFetch as any });
      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        zernioClient
      );

      const result = await service.startOnboarding(orgId, adminUserId, {
        resumeConnectionId: conn.id,
        provider: 'zernio',
      });

      expect(result.mode).toBe('resume_clean');
      expect(result.connectionId).toBe(conn.id);
      expect(result.sessionId).not.toBe('wabs_old_session');

      // Check old session is now expired
      const oldSession = await sessionRepo.getSessionById('wabs_old_session');
      expect(oldSession?.status).toBe('expired');

      // Check connection points to new session
      const updatedConn = await connectionRepo.getConnectionById(conn.id);
      expect(updatedConn?.current_onboarding_session_id).toBe(result.sessionId);
    });

    it('rejects resume if connection is already connected with 409', async () => {
      const orgId = uniqueId('org');
      const ministryId = uniqueId('min');
      const adminUserId = uniqueId('user_admin');

      await setupTestOrganization(orgId, ministryId, adminUserId);

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Connected Line',
        created_by_user_id: adminUserId,
        provider: 'zernio',
        status: 'connected',
      });

      const service = new WhatsAppConnectionService();
      await expect(
        service.startOnboarding(orgId, adminUserId, {
          resumeConnectionId: conn.id,
          provider: 'zernio',
        })
      ).rejects.toThrow('CONNECTION_ALREADY_CONNECTED');
    });

    it('rejects resume if connection belongs to a different provider with 400', async () => {
      const orgId = uniqueId('org');
      const ministryId = uniqueId('min');
      const adminUserId = uniqueId('user_admin');

      await setupTestOrganization(orgId, ministryId, adminUserId);

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Meta Line',
        created_by_user_id: adminUserId,
        provider: 'meta_cloud_api',
        status: 'pending',
      });

      const service = new WhatsAppConnectionService();
      await expect(
        service.startOnboarding(orgId, adminUserId, {
          resumeConnectionId: conn.id,
          provider: 'zernio',
        })
      ).rejects.toThrow('não pertence ao provedor Zernio');
    });
  });

  describe('3. Verified Callback (Happy Path & Identity Materialization)', () => {
    it('validates token, verifies account & live number, materializes claims, transitions to connected, and consumes session', async () => {
      const orgId = uniqueId('org');
      const ministryId = uniqueId('min');
      const adminUserId = uniqueId('user_admin');

      await setupTestOrganization(orgId, ministryId, adminUserId);

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const boundProfileId = 'prof_bound_test_1';
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Zernio Happy Path Line',
        created_by_user_id: adminUserId,
        provider: 'zernio',
        status: 'pending',
        provider_profile_id: boundProfileId,
        current_onboarding_session_id: sessionId,
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: adminUserId,
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const candidateAccountId = uniqueId('acc_verified');
      const candidatePhone = `+55119${Math.floor(10000000 + Math.random() * 90000000)}`;

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
                    _id: candidateAccountId,
                    profileId: boundProfileId, // MATCHES!
                    platform: 'whatsapp',
                    status: 'connected',
                    username: 'ministry_praise',
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
                  display_phone_number: candidatePhone,
                  status: 'CONNECTED',
                  platform_type: 'CLOUD_API',
                  quality_rating: 'GREEN',
                },
                waba: {
                  id: 'waba_happy_1',
                  name: 'LouvAIO Ministry',
                },
              }),
          } as any;
        }
        return { ok: false, status: 404, text: async () => 'Not found' } as any;
      });

      const zernioClient = new ZernioHttpClient({ apiKey: 'k', fetchFn: fakeFetch as any });
      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        zernioClient
      );

      const redirectUrl = await service.handleZernioCallback({
        token: rawToken,
        accountId: candidateAccountId,
        connected: 'whatsapp',
      });

      // Verify redirect target
      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirectUrl).toBe(`${expectedPrefix}/whatsapp/callback?status=success&connectionId=${conn.id}`);

      // Verify connection in Firestore transitioned: pending -> connecting -> connected
      const updatedConn = await connectionRepo.getConnectionById(conn.id);
      expect(updatedConn?.status).toBe('connected');
      expect(updatedConn?.provider_account_id).toBe(candidateAccountId);
      expect(updatedConn?.phone_number).toBe(candidatePhone);
      expect(updatedConn?.last_connected_at).not.toBeNull();
      expect(updatedConn?.pending_expires_at).toBeNull();

      // Verify claims created in Firestore
      const accountClaim = await claimRepo.getClaim(getZernioAccountClaimId(candidateAccountId));
      expect(accountClaim).not.toBeNull();
      expect(accountClaim?.connection_id).toBe(conn.id);

      const phoneClaim = await claimRepo.getClaim(getZernioPhoneClaimId(candidatePhone));
      expect(phoneClaim).not.toBeNull();
      expect(phoneClaim?.connection_id).toBe(conn.id);

      // Verify session consumed
      const updatedSession = await sessionRepo.getSessionById(sessionId);
      expect(updatedSession?.status).toBe('consumed');
      expect(updatedSession?.consumed_at).not.toBeNull();
      expect(updatedSession?.retention_expires_at).not.toBeNull();
    });
  });

  describe('4. Replay Idempotency', () => {
    it('returns success redirect immediately without re-materializing when called with an already consumed token for a connected line', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Already Connected Line',
        created_by_user_id: 'user',
        provider: 'zernio',
        status: 'connected',
        provider_profile_id: 'prof_done',
        provider_account_id: 'acc_done',
        phone_number: '+5511999990000',
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'consumed',
        consumed_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const redirectUrl = await service.handleZernioCallback({
        token: rawToken,
        accountId: 'acc_done',
      });

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirectUrl).toBe(`${expectedPrefix}/whatsapp/callback?status=success&connectionId=${conn.id}`);
    });

    it('redirects to status=identity_conflict when consumed session is replayed with a different accountId', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Already Connected Line',
        created_by_user_id: 'user',
        provider: 'zernio',
        status: 'connected',
        provider_profile_id: 'prof_done',
        provider_account_id: 'acc_done',
        phone_number: '+5511999990000',
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'consumed',
        consumed_at: new Date().toISOString(),
        expires_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const redirectUrl = await service.handleZernioCallback({
        token: rawToken,
        accountId: 'acc_DIFFERENT_CONFLICT',
      });

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirectUrl).toBe(`${expectedPrefix}/whatsapp/callback?status=identity_conflict`);
    });

    it('handles session finalization failure by leaving session active and returns finalization_failed, then retry converges to success', async () => {
      const orgId = uniqueId('org');
      const ministryId = uniqueId('min');
      const adminUserId = uniqueId('user_admin');

      await setupTestOrganization(orgId, ministryId, adminUserId);

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const boundProfileId = 'prof_bound_failinj';
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Finalization Failure Line',
        created_by_user_id: adminUserId,
        provider: 'zernio',
        status: 'pending',
        provider_profile_id: boundProfileId,
        current_onboarding_session_id: sessionId,
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: adminUserId,
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const candidateAccountId = uniqueId('acc_failinj');
      const candidatePhone = `+55119${Math.floor(10000000 + Math.random() * 90000000)}`;

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
                    _id: candidateAccountId,
                    profileId: boundProfileId,
                    platform: 'whatsapp',
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
                  display_phone_number: candidatePhone,
                  status: 'CONNECTED',
                  platform_type: 'CLOUD_API',
                },
                waba: { id: 'waba_failinj' },
              }),
          } as any;
        }
        return { ok: false, status: 404, text: async () => 'Not found' } as any;
      });

      const zernioClient = new ZernioHttpClient({ apiKey: 'k', fetchFn: fakeFetch as any });
      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        zernioClient
      );

      // Inject transient failure into updateSession during Step 5
      const realUpdateSession = sessionRepo.updateSession.bind(sessionRepo);
      let injectionActive = true;
      vi.spyOn(sessionRepo, 'updateSession').mockImplementation(async (id: string, updates: any) => {
        if (injectionActive && updates.status === 'consumed') {
          throw new Error('Transient Firestore error during session consumption');
        }
        return realUpdateSession(id, updates);
      });

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');

      // First attempt: should fail at Step 5, session remains active (NOT failed)
      const res1 = await service.handleZernioCallback({
        token: rawToken,
        accountId: candidateAccountId,
        connected: 'whatsapp',
      });
      expect(res1).toBe(`${expectedPrefix}/whatsapp/callback?status=finalization_failed`);

      // Verify connection IS connected in Firestore
      const connAfterFirst = await connectionRepo.getConnectionById(conn.id);
      expect(connAfterFirst?.status).toBe('connected');
      expect(connAfterFirst?.provider_account_id).toBe(candidateAccountId);

      // Verify session is still active (NOT marked failed)
      const sessionAfterFirst = await sessionRepo.getSessionById(sessionId);
      expect(sessionAfterFirst?.status).toBe('active');

      // Now remove injection and retry with the same callback parameters
      injectionActive = false;
      const res2 = await service.handleZernioCallback({
        token: rawToken,
        accountId: candidateAccountId,
        connected: 'whatsapp',
      });
      expect(res2).toBe(`${expectedPrefix}/whatsapp/callback?status=success&connectionId=${conn.id}`);

      // Session is now consumed
      const sessionAfterRetry = await sessionRepo.getSessionById(sessionId);
      expect(sessionAfterRetry?.status).toBe('consumed');
    });
  });

  describe('5. Security, Session & Token Validation', () => {
    it('redirects to status=invalid_token when token is missing, not hex, or length !== 64', async () => {
      const service = new WhatsAppConnectionService();
      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');

      expect(await service.handleZernioCallback({})).toBe(`${expectedPrefix}/whatsapp/callback?status=invalid_token`);
      expect(await service.handleZernioCallback({ token: 'short' })).toBe(
        `${expectedPrefix}/whatsapp/callback?status=invalid_token`
      );
      expect(
        await service.handleZernioCallback({ token: 'g'.repeat(64) })
      ).toBe(`${expectedPrefix}/whatsapp/callback?status=invalid_token`);
    });

    it('redirects to status=session_not_found when token does not match any session', async () => {
      const service = new WhatsAppConnectionService();
      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      const nonExistentToken = crypto.randomBytes(32).toString('hex');

      const redirect = await service.handleZernioCallback({ token: nonExistentToken });
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=session_not_found`);
    });

    it('redirects to status=session_expired and marks session expired when now >= expires_at', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: 'wac_dummy',
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() - 5000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const redirect = await service.handleZernioCallback({ token: rawToken, accountId: 'acc_1' });
      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=session_expired`);

      const session = await sessionRepo.getSessionById(sessionId);
      expect(session?.status).toBe('expired');
    });
  });

  describe('6. Failure Redirects & Cancellation Hints', () => {
    it('redirects to status=connection_cancelled and marks session failed when connection_cancelled is passed', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: 'wac_dummy',
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const redirect = await service.handleZernioCallback({
        token: rawToken,
        connection_cancelled: 'true',
      });

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=connection_cancelled`);

      const session = await sessionRepo.getSessionById(sessionId);
      expect(session?.status).toBe('failed');
    });

    it('redirects to custom error status when Zernio returns error code', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: 'wac_dummy',
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const redirect = await service.handleZernioCallback({
        token: rawToken,
        error: 'one_whatsapp_per_profile',
      });

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=one_whatsapp_per_profile`);
    });

    it('maps unknown error code to provider_error and known error code to its normalized code', async () => {
      const orgId = uniqueId('org');
      const rawToken1 = crypto.randomBytes(32).toString('hex');
      const tokenHash1 = crypto.createHash('sha256').update(rawToken1).digest('hex');
      const sessionId1 = `wabs_z_${tokenHash1}`;

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId1).set({
        id: sessionId1,
        organization_id: orgId,
        connection_id: 'wac_dummy',
        actor_user_id: 'user',
        state_nonce_hash: tokenHash1,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const rawToken2 = crypto.randomBytes(32).toString('hex');
      const tokenHash2 = crypto.createHash('sha256').update(rawToken2).digest('hex');
      const sessionId2 = `wabs_z_${tokenHash2}`;

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId2).set({
        id: sessionId2,
        organization_id: orgId,
        connection_id: 'wac_dummy',
        actor_user_id: 'user',
        state_nonce_hash: tokenHash2,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');

      // Unknown attacker payload maps to provider_error
      const redirectUnknown = await service.handleZernioCallback({
        token: rawToken1,
        error: 'attacker_xss_<script>alert(1)</script>',
      });
      expect(redirectUnknown).toBe(`${expectedPrefix}/whatsapp/callback?status=provider_error`);

      // Known provider error maps to normalized error string
      const redirectKnown = await service.handleZernioCallback({
        token: rawToken2,
        error: 'WHATSAPP_NUMBER_ALREADY_CONNECTED',
      });
      expect(redirectKnown).toBe(`${expectedPrefix}/whatsapp/callback?status=whatsapp_number_already_connected`);
    });

    it('redirects to status=missing_account_id when accountId is missing or has slash', async () => {
      const orgId = uniqueId('org');
      const rawToken1 = crypto.randomBytes(32).toString('hex');
      const tokenHash1 = crypto.createHash('sha256').update(rawToken1).digest('hex');
      const sessionId1 = `wabs_z_${tokenHash1}`;

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId1).set({
        id: sessionId1,
        organization_id: orgId,
        connection_id: 'wac_dummy',
        actor_user_id: 'user',
        state_nonce_hash: tokenHash1,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const rawToken2 = crypto.randomBytes(32).toString('hex');
      const tokenHash2 = crypto.createHash('sha256').update(rawToken2).digest('hex');
      const sessionId2 = `wabs_z_${tokenHash2}`;

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId2).set({
        id: sessionId2,
        organization_id: orgId,
        connection_id: 'wac_dummy',
        actor_user_id: 'user',
        state_nonce_hash: tokenHash2,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');

      expect(await service.handleZernioCallback({ token: rawToken1 })).toBe(
        `${expectedPrefix}/whatsapp/callback?status=missing_account_id`
      );

      expect(await service.handleZernioCallback({ token: rawToken2, accountId: 'bad/slash' })).toBe(
        `${expectedPrefix}/whatsapp/callback?status=missing_account_id`
      );
    });
  });

  describe('7. Server-Side Verification Defenses', () => {
    it('redirects to status=account_verification_failed when account profileId diverges', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line Divergent Profile',
        created_by_user_id: 'user',
        provider: 'zernio',
        status: 'pending',
        provider_profile_id: 'prof_expected',
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const fakeFetch = vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              accounts: [
                {
                  _id: 'acc_target',
                  profileId: 'prof_DIFFERENT_ATTACK',
                  platform: 'whatsapp',
                  status: 'connected',
                },
              ],
            }),
        } as any;
      });

      const zernioClient = new ZernioHttpClient({ apiKey: 'k', fetchFn: fakeFetch });
      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        zernioClient
      );

      const redirect = await service.handleZernioCallback({
        token: rawToken,
        accountId: 'acc_target',
      });

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=account_verification_failed`);

      // Connection must remain pending
      const checkConn = await connectionRepo.getConnectionById(conn.id);
      expect(checkConn?.status).toBe('pending');
      expect(checkConn?.phone_number).toBeNull();
    });

    it('redirects to status=account_verification_failed when account platform is not whatsapp', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line Non-WA',
        created_by_user_id: 'user',
        provider: 'zernio',
        status: 'pending',
        provider_profile_id: 'prof_expected',
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const fakeFetch = vi.fn(async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          text: async () =>
            JSON.stringify({
              accounts: [
                {
                  _id: 'acc_target',
                  profileId: 'prof_expected',
                  platform: 'telegram',
                  status: 'connected',
                },
              ],
            }),
        } as any;
      });

      const zernioClient = new ZernioHttpClient({ apiKey: 'k', fetchFn: fakeFetch });
      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        zernioClient
      );

      const redirect = await service.handleZernioCallback({
        token: rawToken,
        accountId: 'acc_target',
      });

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=account_verification_failed`);
    });

    it('redirects to status=account_verification_failed when query connected parameter is not whatsapp', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line Precheck Conn',
        created_by_user_id: 'user',
        provider: 'zernio',
        status: 'pending',
        provider_profile_id: 'prof_precheck',
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      const redirect = await service.handleZernioCallback({
        token: rawToken,
        accountId: 'acc_123',
        connected: 'instagram',
      });
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=account_verification_failed`);
    });

    it('redirects to status=account_verification_failed when query profileId does not match conn.provider_profile_id', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line Precheck Prof',
        created_by_user_id: 'user',
        provider: 'zernio',
        status: 'pending',
        provider_profile_id: 'prof_expected',
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo
      );

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      const redirect = await service.handleZernioCallback({
        token: rawToken,
        accountId: 'acc_123',
        connected: 'whatsapp',
        profileId: 'prof_mismatch_attack',
      });
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=account_verification_failed`);
    });
  });

  describe('8. Identity Collision Defense', () => {
    it('redirects to status=identity_conflict when candidate account is already claimed by another connection', async () => {
      const orgId = uniqueId('org');
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      const existingAccountId = uniqueId('acc_colliding');
      const boundProfileId = 'prof_bound_coll';

      // Pre-claim the account with another connection
      const accountClaimId = getZernioAccountClaimId(existingAccountId);
      await db.collection('whatsapp_provider_identity_claims').doc(accountClaimId).set({
        id: accountClaimId,
        provider: 'zernio',
        organization_id: orgId,
        connection_id: 'wac_first_claimer',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line Colliding',
        created_by_user_id: 'user',
        provider: 'zernio',
        status: 'pending',
        provider_profile_id: boundProfileId,
      });

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: orgId,
        connection_id: conn.id,
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'active',
        expires_at: new Date(Date.now() + 600000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

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
                    _id: existingAccountId,
                    profileId: boundProfileId,
                    platform: 'whatsapp',
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
                  display_phone_number: '+5511999991111',
                  status: 'CONNECTED',
                  platform_type: 'CLOUD_API',
                },
                waba: { id: 'waba_coll_1' },
              }),
          } as any;
        }
        return { ok: false, status: 404, text: async () => 'Not found' } as any;
      });

      const zernioClient = new ZernioHttpClient({ apiKey: 'k', fetchFn: fakeFetch as any });
      const service = new WhatsAppConnectionService(
        connectionRepo,
        undefined,
        claimRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        sessionRepo,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        zernioClient
      );

      const redirect = await service.handleZernioCallback({
        token: rawToken,
        accountId: existingAccountId,
      });

      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirect).toBe(`${expectedPrefix}/whatsapp/callback?status=identity_conflict`);
    });
  });

  describe('9. HTTP Express Route Execution (GET /api/v1/whatsapp/zernio/callback)', () => {
    it('executes PublicWhatsAppController.handleZernioCallback and responds with HTTP 302 redirect', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const sessionId = `wabs_z_${tokenHash}`;

      await db.collection('whatsapp_onboarding_sessions').doc(sessionId).set({
        id: sessionId,
        organization_id: 'org_dummy',
        connection_id: 'wac_dummy',
        actor_user_id: 'user',
        state_nonce_hash: tokenHash,
        status: 'expired',
        expires_at: new Date(Date.now() - 10000).toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const controller = new PublicWhatsAppController();
      let capturedStatusCode = 0;
      let redirectedUrl = '';
      const req: any = {
        query: { token: rawToken },
      };
      const res: any = {
        redirect: (statusOrUrl: number | string, url?: string) => {
          if (typeof statusOrUrl === 'number') {
            capturedStatusCode = statusOrUrl;
            redirectedUrl = url || '';
          } else {
            capturedStatusCode = 302;
            redirectedUrl = statusOrUrl;
          }
        },
      };
      const next = vi.fn();

      await controller.handleZernioCallback(req, res, next);

      expect(capturedStatusCode).toBe(302);
      const expectedPrefix = (config.webAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
      expect(redirectedUrl).toBe(`${expectedPrefix}/whatsapp/callback?status=session_expired`);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
