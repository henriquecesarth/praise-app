import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import jwt from 'jsonwebtoken';
import app from '../../app';
import { config } from '../../config/unifiedConfig';
import { authAdmin, db } from '../../lib/firebase';
import { AccountDeletionRepository } from '../../repositories/AccountDeletionRepository';
import { UserRepository } from '../../repositories/UserRepository';

describe('Account Deletion Feature & Lifecycle Suite (PLAY-COMPLIANCE-PC1)', () => {
  let server: http.Server;
  let baseUrl: string;

  const ordinaryUserId = 'usr_ordinary_member';
  const ordinaryEmail = 'member@louvaio.com';

  const ministryOwnerUserId = 'usr_ministry_owner';
  const orgOwnerUserId = 'usr_org_owner';
  const soleAdminUserId = 'usr_sole_admin';
  const billingContactUserId = 'usr_billing_contact';

  const nowSeconds = Math.floor(Date.now() / 1000);

  // Fresh Firebase ID token (auth_time within 5 minutes)
  const createFirebaseToken = (uid: string, email: string, authTime = Math.floor(Date.now() / 1000)) => {
    return `firebase:token:${uid}:${authTime}`;
  };

  // Stale Firebase ID token (auth_time 10 minutes ago)
  const staleAuthTime = nowSeconds - 600;

  // Legacy LouvAIO JWT
  const legacyJwt = jwt.sign(
    { uid: ordinaryUserId, email: ordinaryEmail },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default verifyIdToken spy
    vi.spyOn(authAdmin, 'verifyIdToken').mockImplementation(async (token: string) => {
      if (token.startsWith('firebase:token:')) {
        const parts = token.split(':');
        const uid = parts[2];
        const authTime = parseInt(parts[3] || String(Math.floor(Date.now() / 1000)), 10);
        return {
          uid,
          email: `${uid}@louvaio.com`,
          auth_time: authTime,
        } as any;
      }
      throw new Error('Invalid Firebase ID Token');
    });

    // Default deleteUser spy
    vi.spyOn(authAdmin, 'deleteUser').mockImplementation(async () => {});

    // Default AccountDeletionRepository mocks (prevents hanging on network when emulator is offline)
    vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue(null);
    vi.spyOn(AccountDeletionRepository.prototype, 'isDeletionPending').mockResolvedValue(false);
    vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
    vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
    vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
    vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
    vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockResolvedValue();
    vi.spyOn(AccountDeletionRepository.prototype, 'createManifest').mockResolvedValue({
      created_at: new Date().toISOString(),
      ministry_member_doc_ids: ['mem_123'],
      organization_member_doc_ids: [],
      group_member_doc_ids: [],
      member_ids: ['mem_123'],
      ministry_ids: ['min_123'],
    });
    vi.spyOn(AccountDeletionRepository.prototype, 'deletePersonalData').mockResolvedValue();
    vi.spyOn(AccountDeletionRepository.prototype, 'detachMemberships').mockResolvedValue();
    vi.spyOn(AccountDeletionRepository.prototype, 'cleanFutureSchedulesAndAnonymizeHistorical').mockResolvedValue();
    vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeHistoricalSharedContent').mockResolvedValue();
    vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeBillingReferences').mockResolvedValue();
    vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeWhatsAppReferences').mockResolvedValue();
  });

  // ==========================================================================
  // 1. PREFLIGHT TESTS
  // ==========================================================================
  describe('1. Preflight Evaluation (/api/v1/auth/account-deletion/preflight)', () => {
    it('Scenario 1.1: Ordinary member with no blockers returns deletionAllowed=true and empty blockers', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue(null);

      const token = createFirebaseToken(ordinaryUserId, ordinaryEmail);
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/preflight`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.deletionAllowed).toBe(true);
      expect(body.blockers).toEqual([]);
      expect(body.activeJob).toBeNull();
    });

    it('Scenario 1.2: Ministry owner is blocked with MINISTRY_OWNER', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([
        { id: 'min_101', name: 'Ministério Emanuel' },
      ]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);

      const token = createFirebaseToken(ministryOwnerUserId, 'owner@min.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/preflight`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.deletionAllowed).toBe(false);
      expect(body.blockers).toHaveLength(1);
      expect(body.blockers[0].code).toBe('MINISTRY_OWNER');
      expect(body.blockers[0].details.ministryId).toBe('min_101');
      expect(body.blockers[0].details.ministryName).toBe('Ministério Emanuel');
    });

    it('Scenario 1.3: Organization owner is blocked with ORGANIZATION_OWNER', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([
        { id: 'org_201', name: 'Igreja Central' },
      ]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);

      const token = createFirebaseToken(orgOwnerUserId, 'owner@org.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/preflight`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.deletionAllowed).toBe(false);
      expect(body.blockers).toHaveLength(1);
      expect(body.blockers[0].code).toBe('ORGANIZATION_OWNER');
      expect(body.blockers[0].details.organizationId).toBe('org_201');
      expect(body.blockers[0].details.organizationName).toBe('Igreja Central');
    });

    it('Scenario 1.4: Sole ministry admin is blocked with SOLE_MINISTRY_ADMIN', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([
        { id: 'min_301', name: 'Ministério Louvor Kids' },
      ]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);

      const token = createFirebaseToken(soleAdminUserId, 'sole@min.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/preflight`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.deletionAllowed).toBe(false);
      expect(body.blockers).toHaveLength(1);
      expect(body.blockers[0].code).toBe('SOLE_MINISTRY_ADMIN');
      expect(body.blockers[0].details.ministryId).toBe('min_301');
    });

    it('Scenario 1.5: Active billing contact is blocked with BILLING_CONTACT_REPLACEMENT_REQUIRED', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([
        { id: 'min_401', name: 'Ministério Betel' },
      ]);

      const token = createFirebaseToken(billingContactUserId, 'payer@betel.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/preflight`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.deletionAllowed).toBe(false);
      expect(body.blockers).toHaveLength(1);
      expect(body.blockers[0].code).toBe('BILLING_CONTACT_REPLACEMENT_REQUIRED');
      expect(body.blockers[0].details.ministryId).toBe('min_401');
    });

    it('Scenario 1.6: Legacy billing contact with no user reference is treated as UNKNOWN and does NOT block (no email guessing)', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      // When billing_contact_user_id is missing, findBillingContactMinistries returns [] without guessing by email
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);

      const token = createFirebaseToken('usr_legacy_billing', 'billing@legacy.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/preflight`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.deletionAllowed).toBe(true);
      expect(body.blockers).toEqual([]);
    });
  });

  // ==========================================================================
  // 2. AUTHENTICATION & RECENT AUTH REQUIREMENTS
  // ==========================================================================
  describe('2. Authentication and Freshness Guards', () => {
    it('Scenario 2.1: Legacy long-lived app JWT is rejected for destructive deletion', async () => {
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${legacyJwt}` },
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      const code = body.error?.details?.code || body.error?.code;
      expect(code).toBe('REAUTHENTICATION_REQUIRED');
    });

    it('Scenario 2.2: Stale Firebase token (auth_time > 300s) is rejected with REAUTHENTICATION_REQUIRED', async () => {
      const staleToken = createFirebaseToken(ordinaryUserId, ordinaryEmail, staleAuthTime);
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${staleToken}` },
      });

      expect(res.status).toBe(401);
      const body = (await res.json()) as any;
      const code = body.error?.details?.code || body.error?.code;
      expect(code).toBe('REAUTHENTICATION_REQUIRED');
    });

    it('Scenario 2.3: Target identity always derives from auth; body payload cannot override target UID', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
      const deletePersonalSpy = vi.spyOn(AccountDeletionRepository.prototype, 'deletePersonalData').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'detachMemberships').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'cleanFutureSchedulesAndAnonymizeHistorical').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeHistoricalSharedContent').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeWhatsAppReferences').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue(null);
      vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockResolvedValue();

      const freshToken = createFirebaseToken('target_auth_user', 'target@test.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${freshToken}`,
        },
        body: JSON.stringify({
          userId: 'attacker_specified_victim_id',
          uid: 'attacker_specified_victim_id',
        }),
      });

      expect(res.status).toBe(200);
      // Confirma que a exclusão foi executada para target_auth_user, NÃO para o victim_id
      expect(deletePersonalSpy).toHaveBeenCalledWith('target_auth_user');
    });
  });

  // ==========================================================================
  // 3. EXECUTION SAGA, IDEMPOTENCY & CHECKPOINTS
  // ==========================================================================
  describe('3. Execution Saga, Checkpoints and Idempotency', () => {
    it('Scenario 3.1: Preflight blockers prevent destructive deletion with 409 PREFLIGHT_BLOCKED', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([
        { id: 'min_block', name: 'Ministério Bloqueado' },
      ]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
      const saveJobSpy = vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockResolvedValue();

      const freshToken = createFirebaseToken(ministryOwnerUserId, 'owner@min.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freshToken}` },
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as any;
      const code = body.error?.details?.code || body.error?.code;
      expect(code).toBe('PREFLIGHT_BLOCKED');
      expect(saveJobSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'preflight_blocked',
          blockers: expect.arrayContaining([expect.objectContaining({ code: 'MINISTRY_OWNER' })]),
        })
      );
    });

    it('Scenario 3.2: Complete happy path executes all checkpoints and deletes Firebase user', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
      const deletePersonalSpy = vi.spyOn(AccountDeletionRepository.prototype, 'deletePersonalData').mockResolvedValue();
      const detachSpy = vi.spyOn(AccountDeletionRepository.prototype, 'detachMemberships').mockResolvedValue();
      const scheduleSpy = vi.spyOn(AccountDeletionRepository.prototype, 'cleanFutureSchedulesAndAnonymizeHistorical').mockResolvedValue();
      const anonymizeSpy = vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeHistoricalSharedContent').mockResolvedValue();
      const billingSpy = vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeBillingReferences').mockResolvedValue();
      const whatsappSpy = vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeWhatsAppReferences').mockResolvedValue();
      const deleteUserSpy = vi.spyOn(authAdmin, 'deleteUser').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue(null);
      const saveJobSpy = vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockResolvedValue();

      const freshToken = createFirebaseToken('user_clean_1', 'clean@test.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freshToken}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.success).toBe(true);
      expect(body.job.status).toBe('completed');
      expect(body.job.user_email).toBeNull();
      expect(body.job.manifest).toBeNull();
      expect(body.job.blockers).toBeNull();
      expect(body.job.error_details).toBeNull();

      expect(deletePersonalSpy).toHaveBeenCalledWith('user_clean_1');
      expect(detachSpy).toHaveBeenCalledWith('user_clean_1', expect.anything());
      expect(scheduleSpy).toHaveBeenCalledWith('user_clean_1', ['mem_123']);
      expect(anonymizeSpy).toHaveBeenCalledWith('user_clean_1');
      expect(billingSpy).toHaveBeenCalledWith('user_clean_1');
      expect(whatsappSpy).toHaveBeenCalledWith('user_clean_1');
      expect(deleteUserSpy).toHaveBeenCalledWith('user_clean_1');
      expect(saveJobSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    });

    it('Scenario 3.3: Job idempotency: repeated request on completed job returns success without re-executing', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
      const deletePersonalSpy = vi.spyOn(AccountDeletionRepository.prototype, 'deletePersonalData').mockResolvedValue();

      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue({
        id: 'del_user_already_done',
        user_id: 'user_already_done',
        user_email: 'done@test.com',
        status: 'completed',
        checkpoints: {
          manifest_created: true,
          personal_data_deleted: true,
          memberships_detached: true,
          future_schedules_cleaned: true,
          historical_anonymized: true,
          billing_references_anonymized: true,
          whatsapp_anonymized: true,
          auth_deleted: true,
        },
        requested_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const freshToken = createFirebaseToken('user_already_done', 'done@test.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freshToken}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.job.status).toBe('completed');
      expect(deletePersonalSpy).not.toHaveBeenCalled();
    });

    it('Scenario 3.4: Safe retry after partial cleanup resumes from uncompleted checkpoint', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);

      const deletePersonalSpy = vi.spyOn(AccountDeletionRepository.prototype, 'deletePersonalData').mockResolvedValue();
      const detachSpy = vi.spyOn(AccountDeletionRepository.prototype, 'detachMemberships').mockResolvedValue();
      const scheduleSpy = vi.spyOn(AccountDeletionRepository.prototype, 'cleanFutureSchedulesAndAnonymizeHistorical').mockResolvedValue();
      const anonymizeSpy = vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeHistoricalSharedContent').mockResolvedValue();
      const whatsappSpy = vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeWhatsAppReferences').mockResolvedValue();
      const deleteUserSpy = vi.spyOn(authAdmin, 'deleteUser').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockResolvedValue();

      // Já concluiu personal_data_deleted e memberships_detached
      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue({
        id: 'del_user_resume',
        user_id: 'user_resume',
        user_email: 'resume@test.com',
        status: 'cleanup_in_progress',
        manifest: {
          created_at: new Date().toISOString(),
          ministry_member_doc_ids: ['m1'],
          organization_member_doc_ids: [],
          group_member_doc_ids: [],
          member_ids: ['m1'],
          ministry_ids: ['min_1'],
        },
        checkpoints: {
          manifest_created: true,
          personal_data_deleted: true,
          memberships_detached: true,
        },
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const freshToken = createFirebaseToken('user_resume', 'resume@test.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freshToken}` },
      });

      expect(res.status).toBe(200);
      // personal_data_deleted e memberships_detached já estavam true -> não rodam de novo
      expect(deletePersonalSpy).not.toHaveBeenCalled();
      expect(detachSpy).not.toHaveBeenCalled();
      // checkpoints pendentes são executados
      expect(scheduleSpy).toHaveBeenCalledWith('user_resume', ['m1']);
      expect(anonymizeSpy).toHaveBeenCalled();
      expect(whatsappSpy).toHaveBeenCalled();
      expect(deleteUserSpy).toHaveBeenCalled();
    });

    it('Scenario 3.5: Firebase user-not-found error on retry is handled idempotently as completed', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockResolvedValue();

      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue({
        id: 'del_user_not_found',
        user_id: 'user_not_found',
        user_email: 'nf@test.com',
        status: 'auth_delete_pending',
        manifest: {
          created_at: new Date().toISOString(),
          ministry_member_doc_ids: ['m1'],
          organization_member_doc_ids: [],
          group_member_doc_ids: [],
          member_ids: ['m1'],
          ministry_ids: ['min_1'],
        },
        checkpoints: {
          manifest_created: true,
          personal_data_deleted: true,
          memberships_detached: true,
          future_schedules_cleaned: true,
          historical_anonymized: true,
          billing_references_anonymized: true,
          whatsapp_anonymized: true,
        },
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      vi.spyOn(authAdmin, 'deleteUser').mockRejectedValue({
        code: 'auth/user-not-found',
        message: 'User does not exist',
      });

      const freshToken = createFirebaseToken('user_not_found', 'nf@test.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freshToken}` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.job.status).toBe('completed');
    });

    it('Scenario 3.6: Deletion manifest survives membership detach and preserves schedule cleanup', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
      const scheduleSpy = vi.spyOn(AccountDeletionRepository.prototype, 'cleanFutureSchedulesAndAnonymizeHistorical').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeHistoricalSharedContent').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeBillingReferences').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeWhatsAppReferences').mockResolvedValue();
      vi.spyOn(authAdmin, 'deleteUser').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockResolvedValue();

      // O manifesto gravado no início continha o member_id 'mem_from_manifest'
      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue({
        id: 'del_user_manifest_survives',
        user_id: 'user_manifest_survives',
        user_email: 'manifest@test.com',
        status: 'cleanup_in_progress',
        manifest: {
          created_at: new Date().toISOString(),
          ministry_member_doc_ids: ['mem_from_manifest'],
          organization_member_doc_ids: [],
          group_member_doc_ids: [],
          member_ids: ['mem_from_manifest'],
          ministry_ids: ['min_1'],
        },
        checkpoints: {
          manifest_created: true,
          personal_data_deleted: true,
          memberships_detached: true, // Já desvinculado
        },
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const freshToken = createFirebaseToken('user_manifest_survives', 'manifest@test.com');
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freshToken}` },
      });

      expect(res.status).toBe(200);
      // Confirma que a limpeza de escalas usou os IDs preservados no manifesto, mesmo após desvinculação
      expect(scheduleSpy).toHaveBeenCalledWith('user_manifest_survives', ['mem_from_manifest']);
    });

    it('Scenario 3.7: Failure injection between checkpoints resumes from exact uncompleted stage', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findOwnedOrganizations').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findSoleAdminMinistries').mockResolvedValue([]);
      vi.spyOn(AccountDeletionRepository.prototype, 'findBillingContactMinistries').mockResolvedValue([]);
      const deletePersonalSpy = vi.spyOn(AccountDeletionRepository.prototype, 'deletePersonalData').mockResolvedValue();
      const detachSpy = vi.spyOn(AccountDeletionRepository.prototype, 'detachMemberships').mockResolvedValue();
      const scheduleSpy = vi.spyOn(AccountDeletionRepository.prototype, 'cleanFutureSchedulesAndAnonymizeHistorical').mockRejectedValueOnce(
        new Error('Transient Firestore error')
      );
      const savedJobs: any[] = [];
      vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockImplementation(async (j) => {
        savedJobs.push(JSON.parse(JSON.stringify(j)));
      });
      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue(null);

      const freshToken = createFirebaseToken('user_fail_resume', 'fail@test.com');
      // 1ª tentativa: falha em cleanFutureSchedulesAndAnonymizeHistorical
      const res1 = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      expect(res1.status).toBe(500);

      // Checa se checkpoints prévios foram persistidos com sucesso
      const lastSavedBeforeFail = savedJobs[savedJobs.length - 1];
      expect(lastSavedBeforeFail.checkpoints.manifest_created).toBe(true);
      expect(lastSavedBeforeFail.checkpoints.personal_data_deleted).toBe(true);
      expect(lastSavedBeforeFail.checkpoints.memberships_detached).toBe(true);
      expect(lastSavedBeforeFail.checkpoints.future_schedules_cleaned).toBeUndefined();

      // Reset dos spies para a 2ª tentativa (retomada)
      deletePersonalSpy.mockClear();
      detachSpy.mockClear();
      scheduleSpy.mockResolvedValueOnce(undefined);
      vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeHistoricalSharedContent').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeBillingReferences').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'anonymizeWhatsAppReferences').mockResolvedValue();
      vi.spyOn(authAdmin, 'deleteUser').mockResolvedValue();
      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue(lastSavedBeforeFail);

      const res2 = await fetch(`${baseUrl}/api/v1/auth/account-deletion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freshToken}` },
      });
      expect(res2.status).toBe(200);

      // Stages 1, 2, 3 NÃO são executados novamente
      expect(deletePersonalSpy).not.toHaveBeenCalled();
      expect(detachSpy).not.toHaveBeenCalled();
      // Stage 4 em diante é executado
      expect(scheduleSpy).toHaveBeenCalledWith('user_fail_resume', expect.any(Array));
    });

    it('Scenario 3.8: Post-auth-delete crash recovery via POST /internal/reconcile/:userId completes job and minimizes PII', async () => {
      const originalCron = process.env.CRON_SECRET;
      process.env.CRON_SECRET = 'test-recovery-secret-123';
      try {
        const authUserNotFoundErr: any = new Error('User does not exist');
        authUserNotFoundErr.code = 'auth/user-not-found';
        vi.spyOn(authAdmin, 'deleteUser').mockRejectedValue(authUserNotFoundErr);

        vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue({
          id: 'del_crash_user',
          user_id: 'crash_user',
          user_email: 'crash@louvaio.com',
          status: 'auth_delete_pending',
          blockers: null,
          manifest: {
            created_at: new Date().toISOString(),
            ministry_member_doc_ids: ['m1'],
            organization_member_doc_ids: [],
            group_member_doc_ids: [],
            member_ids: ['m1'],
            ministry_ids: ['min_1'],
          },
          checkpoints: {
            manifest_created: true,
            personal_data_deleted: true,
            memberships_detached: true,
            future_schedules_cleaned: true,
            historical_anonymized: true,
            billing_references_anonymized: true,
            whatsapp_anonymized: true,
          },
          step_progress: 'auth_delete_pending',
          error_details: null,
          requested_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          completed_at: null,
          updated_at: new Date().toISOString(),
        });

        const saveJobSpy = vi.spyOn(AccountDeletionRepository.prototype, 'saveJob').mockResolvedValue();

        const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/internal/reconcile/crash_user`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-recovery-secret-123',
          },
        });

        expect(res.status).toBe(200);
        const body = (await res.json()) as any;
        expect(body.success).toBe(true);
        expect(body.job.status).toBe('completed');
        // PII Minimizada
        expect(body.job.user_email).toBeNull();
        expect(body.job.manifest).toBeNull();
        expect(body.job.error_details).toBeNull();

        expect(saveJobSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'completed',
            user_email: null,
            manifest: null,
          })
        );
      } finally {
        process.env.CRON_SECRET = originalCron;
      }
    });

    it('Scenario 3.9: Unauthorized caller without valid CRON_SECRET is rejected with 401', async () => {
      const originalCron = process.env.CRON_SECRET;
      process.env.CRON_SECRET = 'test-recovery-secret-123';
      try {
        // Sem header
        const res1 = await fetch(`${baseUrl}/api/v1/auth/account-deletion/internal/reconcile/crash_user`, {
          method: 'POST',
        });
        expect(res1.status).toBe(401);
        const body1 = (await res1.json()) as any;
        expect(body1.error?.details?.code || body1.error?.code).toBe('UNAUTHORIZED');

        // Com token incorreto
        const res2 = await fetch(`${baseUrl}/api/v1/auth/account-deletion/internal/reconcile/crash_user`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer wrong-secret',
          },
        });
        expect(res2.status).toBe(401);
        const body2 = (await res2.json()) as any;
        expect(body2.error?.details?.code || body2.error?.code).toBe('UNAUTHORIZED');
      } finally {
        process.env.CRON_SECRET = originalCron;
      }
    });
  });

  // ==========================================================================
  // 4. ACCESS GUARD & STATUS INSPECTION
  // ==========================================================================
  describe('4. Access Guard & Status Inspection', () => {
    it('Scenario 4.1: User with deletion in progress is denied access to normal authenticated routes with 403', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'isDeletionPending').mockResolvedValue(true);
      vi.spyOn(UserRepository.prototype, 'verifyToken').mockResolvedValue({
        uid: 'user_in_progress',
        email: 'progress@test.com',
      });

      const res = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer some_valid_token` },
      });

      expect(res.status).toBe(403);
      const body = (await res.json()) as any;
      const code = body.error?.details?.code || body.error?.code;
      expect(code).toBe('ACCOUNT_DELETION_IN_PROGRESS');
    });

    it('Scenario 4.2: User with deletion in progress CAN access /account-deletion/status', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'isDeletionPending').mockResolvedValue(true);
      vi.spyOn(UserRepository.prototype, 'verifyToken').mockResolvedValue({
        uid: 'user_in_progress',
        email: 'progress@test.com',
      });

      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue({
        id: 'del_user_in_progress',
        user_id: 'user_in_progress',
        user_email: 'progress@test.com',
        status: 'cleanup_in_progress',
        checkpoints: { personal_data_deleted: true },
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/status`, {
        headers: { Authorization: `Bearer some_valid_token` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.job.status).toBe('cleanup_in_progress');
    });

    it('Scenario 4.3: Query string injection bypass attempt is rejected by Access Guard', async () => {
      vi.spyOn(AccountDeletionRepository.prototype, 'isDeletionPending').mockResolvedValue(true);
      vi.spyOn(UserRepository.prototype, 'verifyToken').mockResolvedValue({
        uid: 'user_in_progress',
        email: 'progress@test.com',
      });

      // 1. Injeção de query param com rota de bypass
      const res1 = await fetch(`${baseUrl}/api/v1/auth/me?next=/auth/account-deletion`, {
        headers: { Authorization: `Bearer some_valid_token` },
      });
      expect(res1.status).toBe(403);
      const body1 = (await res1.json()) as any;
      expect(body1.error?.details?.code || body1.error?.code).toBe('ACCOUNT_DELETION_IN_PROGRESS');

      // 2. Injeção de prefixo com parâmetro
      const res2 = await fetch(`${baseUrl}/api/v1/auth/me?param=/api/v1/auth/account-deletion`, {
        headers: { Authorization: `Bearer some_valid_token` },
      });
      expect(res2.status).toBe(403);

      // 3. Injeção de query param contendo caminho de status de exclusão
      const res3 = await fetch(`${baseUrl}/api/v1/auth/me?returnTo=/api/v1/auth/account-deletion/status`, {
        headers: { Authorization: `Bearer some_valid_token` },
      });
      expect(res3.status).toBe(403);

      // 4. Rota legítima com query params não é bloqueada pelo Access Guard
      vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue({
        id: 'del_user_in_progress',
        user_id: 'user_in_progress',
        user_email: 'progress@test.com',
        status: 'cleanup_in_progress',
        checkpoints: {},
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      const res4 = await fetch(`${baseUrl}/api/v1/auth/account-deletion/status?cacheBust=123`, {
        headers: { Authorization: `Bearer some_valid_token` },
      });
      expect(res4.status).toBe(200);
    });

    it('Scenario 4.4: Cross-user isolation: user cannot inspect or delete another user data', async () => {
      const getJobSpy = vi.spyOn(AccountDeletionRepository.prototype, 'getJob').mockResolvedValue({
        id: 'del_user_alice',
        user_id: 'user_alice',
        user_email: 'alice@test.com',
        status: 'cleanup_in_progress',
        checkpoints: {},
        requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      vi.spyOn(UserRepository.prototype, 'verifyToken').mockResolvedValue({
        uid: 'user_alice',
        email: 'alice@test.com',
      });

      // Tentativa de passar userId de outro usuário por query params
      const res = await fetch(`${baseUrl}/api/v1/auth/account-deletion/status?userId=victim_bob`, {
        headers: { Authorization: `Bearer token_alice` },
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      // Confirma que consultou o job de alice, derivado da sessão autenticada, e não bob
      expect(getJobSpy).toHaveBeenCalledWith('user_alice');
      expect(body.job.user_id).toBe('user_alice');
    });
  });
});
