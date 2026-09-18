import { describe, it, expect } from 'vitest';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import {
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
  getClaimId,
} from './whatsapp.types';
import { AppError } from '../../middleware/error-handler';

describe('Zernio Persistence & Identity Claims Suite (Phase 7D2-D3)', { timeout: 15000 }, () => {
  const connectionRepo = new WhatsAppConnectionRepository();
  const claimRepo = new WhatsAppProviderIdentityClaimRepository();
  const service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);

  function uniqueId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  let phoneCounter = 1;
  function uniquePhone(): string {
    const seed = Math.floor(10000000 + Math.random() * 90000000) + (phoneCounter++);
    return `+55119${String(seed).slice(-8)}`;
  }

  describe('STEP 2 & 3: Profile Binding Persistence & Immutability', () => {
    it('binds a Zernio profile to a pending connection successfully', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Zernio Line 1',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      expect(conn.provider_profile_id).toBeNull();
      expect(conn.provider_account_id).toBeNull();
      expect(conn.phone_number).toBeNull();

      const bound = await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_zernio_101');

      expect(bound.provider_profile_id).toBe('prof_zernio_101');
      expect(bound.provider_account_id).toBeNull();
      expect(bound.phone_number).toBeNull();
      expect(bound.status).toBe('pending'); // does not mark connected

      const reloaded = await connectionRepo.getConnectionById(conn.id);
      expect(reloaded?.provider_profile_id).toBe('prof_zernio_101');
    });

    it('is idempotent when re-binding the same profile ID', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Zernio Line 2',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_zernio_same');
      const boundAgain = await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_zernio_same');

      expect(boundAgain.provider_profile_id).toBe('prof_zernio_same');
    });

    it('fails closed with 409 conflict when attempting to bind a different profile ID', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Zernio Line 3',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_zernio_original');

      await expect(
        service.bindZernioProfileToConnection(orgId, conn.id, 'prof_zernio_hijack')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'ZERNIO_PROFILE_ALREADY_BOUND' }),
        })
      );

      // Verify original profile was not modified
      const reloaded = await connectionRepo.getConnectionById(conn.id);
      expect(reloaded?.provider_profile_id).toBe('prof_zernio_original');
    });

    it('fails with 404 when connection does not belong to the supplied organization', async () => {
      const orgA = uniqueId('org_a');
      const orgB = uniqueId('org_b');
      const conn = await connectionRepo.createConnection({
        organization_id: orgA,
        display_name: 'Zernio Line Org A',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await expect(
        service.bindZernioProfileToConnection(orgB, conn.id, 'prof_123')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });

    it('fails with 400 when attempting to bind profile to a Meta connection', async () => {
      const orgId = uniqueId('org');
      const metaConn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Meta Line',
        created_by_user_id: 'user-1',
        provider: 'meta_cloud_api',
      });

      await expect(
        service.bindZernioProfileToConnection(orgId, metaConn.id, 'prof_meta_rejected')
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'INVALID_PROVIDER' }),
        })
      );
    });

    it('fails with 400 when profileId is empty or whitespace', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Zernio Line Blank',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await expect(
        service.bindZernioProfileToConnection(orgId, conn.id, '')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 400 }));

      await expect(
        service.bindZernioProfileToConnection(orgId, conn.id, '   ')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 400 }));
    });

    it('fails with 404 when connectionId does not exist', async () => {
      const orgId = uniqueId('org');
      await expect(
        service.bindZernioProfileToConnection(orgId, 'wac_nonexistent_999', 'prof_123')
      ).rejects.toThrow(expect.objectContaining({ statusCode: 404 }));
    });
  });

  describe('STEP 4, 5, 6, 8, 10: Atomic Materialization, Idempotency & Claims', () => {
    it('materializes Zernio identity, atomically creates account and phone claims, and updates connection', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Zernio To Materialize',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_mat_01');

      const basePhone = uniquePhone();
      const rawPhone = `${basePhone.slice(0, 3)} ${basePhone.slice(3, 5)} ${basePhone.slice(5, 10)}-${basePhone.slice(10)}`;
      const accId = uniqueId('acc_zernio');

      const materialized = await service.materializeZernioProviderIdentity(orgId, conn.id, {
        providerProfileId: 'prof_mat_01',
        providerAccountId: accId,
        phoneNumber: rawPhone, // raw with formatting
      });

      expect(materialized.provider_account_id).toBe(accId);
      expect(materialized.phone_number).toBe(basePhone); // normalized E.164
      expect(materialized.provider_profile_id).toBe('prof_mat_01');
      expect(materialized.provider_waba_id).toBeNull(); // no Meta fields
      expect(materialized.provider_phone_number_id).toBeNull();

      // Check account claim record
      const accClaim = await claimRepo.getZernioAccountClaim(accId);
      expect(accClaim).toBeDefined();
      expect(accClaim?.connection_id).toBe(conn.id);
      expect(accClaim?.organization_id).toBe(orgId);
      expect(accClaim?.provider).toBe('zernio');
      expect(accClaim?.provider_phone_number_id).toBe(accId);

      // Check phone claim record
      const phoneClaim = await claimRepo.getZernioPhoneClaim(basePhone);
      expect(phoneClaim).toBeDefined();
      expect(phoneClaim?.connection_id).toBe(conn.id);
      expect(phoneClaim?.organization_id).toBe(orgId);
      expect(phoneClaim?.provider).toBe('zernio');
      expect(phoneClaim?.provider_phone_number_id).toBe(basePhone);
    });

    it('rejects materialization when profile is not yet bound', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Unbound Connection',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await expect(
        service.materializeZernioProviderIdentity(orgId, conn.id, {
          providerProfileId: 'prof_any',
          providerAccountId: uniqueId('acc_any'),
          phoneNumber: uniquePhone(),
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'ZERNIO_PROFILE_NOT_BOUND' }),
        })
      );
    });

    it('rejects materialization when supplied profileId does not match bound profileId', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Profile Mismatch',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_real_bound');

      await expect(
        service.materializeZernioProviderIdentity(orgId, conn.id, {
          providerProfileId: 'prof_fake_divergent',
          providerAccountId: uniqueId('acc_any'),
          phoneNumber: uniquePhone(),
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'ZERNIO_PROFILE_IDENTITY_MISMATCH' }),
        })
      );
    });

    it('is strictly idempotent for repeated materialization with identical data', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Idempotent Line',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_idem_01');
      const idemAccId = uniqueId('acc_idem');
      const idemPhone = uniquePhone();

      const mat1 = await service.materializeZernioProviderIdentity(orgId, conn.id, {
        providerProfileId: 'prof_idem_01',
        providerAccountId: idemAccId,
        phoneNumber: idemPhone,
      });

      const mat2 = await service.materializeZernioProviderIdentity(orgId, conn.id, {
        providerProfileId: 'prof_idem_01',
        providerAccountId: idemAccId,
        phoneNumber: idemPhone,
      });

      expect(mat1.provider_account_id).toBe(mat2.provider_account_id);
      expect(mat1.phone_number).toBe(mat2.phone_number);
    });

    it('rejects materialization with divergent accountId on already materialized connection', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Fixed Account Line',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      const originalAcc = uniqueId('acc_original');
      const divergentAcc = uniqueId('acc_divergent');
      const phone = uniquePhone();

      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_fixed_acc');
      await service.materializeZernioProviderIdentity(orgId, conn.id, {
        providerProfileId: 'prof_fixed_acc',
        providerAccountId: originalAcc,
        phoneNumber: phone,
      });

      await expect(
        service.materializeZernioProviderIdentity(orgId, conn.id, {
          providerProfileId: 'prof_fixed_acc',
          providerAccountId: divergentAcc,
          phoneNumber: phone,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'ZERNIO_ACCOUNT_IDENTITY_MISMATCH' }),
        })
      );
    });

    it('rejects materialization with divergent phone number on already materialized connection', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Fixed Phone Line',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      const acc = uniqueId('acc_original_p');
      const phone1 = uniquePhone();
      const phone2 = uniquePhone();

      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_fixed_phone');
      await service.materializeZernioProviderIdentity(orgId, conn.id, {
        providerProfileId: 'prof_fixed_phone',
        providerAccountId: acc,
        phoneNumber: phone1,
      });

      await expect(
        service.materializeZernioProviderIdentity(orgId, conn.id, {
          providerProfileId: 'prof_fixed_phone',
          providerAccountId: acc,
          phoneNumber: phone2,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'PROVIDER_PHONE_IDENTITY_MISMATCH' }),
        })
      );
    });

    it('rejects invalid or non-E.164 phone number with 400 INVALID_PHONE_E164', async () => {
      const orgId = uniqueId('org');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Invalid Phone Line',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_inv_phone');

      await expect(
        service.materializeZernioProviderIdentity(orgId, conn.id, {
          providerProfileId: 'prof_inv_phone',
          providerAccountId: 'acc_any',
          phoneNumber: 'not-a-number',
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'INVALID_PHONE_E164' }),
        })
      );
    });
  });

  describe('STEP 9: Claim Collisions & Multi-Tenant Boundary', () => {
    it('rejects account collision across different connections in the SAME organization', async () => {
      const orgId = uniqueId('org');
      const sharedAccountId = uniqueId('acc_coll_same');

      const conn1 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Conn 1',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      const conn2 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Conn 2',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn1.id, 'prof_c1');
      await service.bindZernioProfileToConnection(orgId, conn2.id, 'prof_c2');

      // Conn 1 claims sharedAccountId
      await service.materializeZernioProviderIdentity(orgId, conn1.id, {
        providerProfileId: 'prof_c1',
        providerAccountId: sharedAccountId,
        phoneNumber: uniquePhone(),
      });

      // Conn 2 attempts to claim sharedAccountId
      await expect(
        service.materializeZernioProviderIdentity(orgId, conn2.id, {
          providerProfileId: 'prof_c2',
          providerAccountId: sharedAccountId,
          phoneNumber: uniquePhone(),
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'ZERNIO_ACCOUNT_ALREADY_REGISTERED' }),
        })
      );
    });

    it('rejects cross-tenant account collision (Org B cannot claim Org A account)', async () => {
      const orgA = uniqueId('org_a');
      const orgB = uniqueId('org_b');
      const sharedAccountId = uniqueId('acc_coll_cross');

      const connA = await connectionRepo.createConnection({
        organization_id: orgA,
        display_name: 'Org A Line',
        created_by_user_id: 'user-a',
        provider: 'zernio',
      });
      const connB = await connectionRepo.createConnection({
        organization_id: orgB,
        display_name: 'Org B Line',
        created_by_user_id: 'user-b',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgA, connA.id, 'prof_oa');
      await service.bindZernioProfileToConnection(orgB, connB.id, 'prof_ob');

      // Org A claims account
      await service.materializeZernioProviderIdentity(orgA, connA.id, {
        providerProfileId: 'prof_oa',
        providerAccountId: sharedAccountId,
        phoneNumber: uniquePhone(),
      });

      // Org B attempts to claim account
      await expect(
        service.materializeZernioProviderIdentity(orgB, connB.id, {
          providerProfileId: 'prof_ob',
          providerAccountId: sharedAccountId,
          phoneNumber: uniquePhone(),
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'ZERNIO_ACCOUNT_ALREADY_REGISTERED' }),
        })
      );
    });

    it('rejects phone collision across different connections in the SAME organization', async () => {
      const orgId = uniqueId('org');
      const sharedPhone = uniquePhone();

      const conn1 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Conn 1 Phone',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      const conn2 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Conn 2 Phone',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn1.id, 'prof_p1');
      await service.bindZernioProfileToConnection(orgId, conn2.id, 'prof_p2');

      await service.materializeZernioProviderIdentity(orgId, conn1.id, {
        providerProfileId: 'prof_p1',
        providerAccountId: uniqueId('acc_p1'),
        phoneNumber: sharedPhone,
      });

      await expect(
        service.materializeZernioProviderIdentity(orgId, conn2.id, {
          providerProfileId: 'prof_p2',
          providerAccountId: uniqueId('acc_p2'),
          phoneNumber: sharedPhone,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'PROVIDER_PHONE_ALREADY_REGISTERED' }),
        })
      );
    });

    it('rejects cross-tenant phone collision (Org B cannot claim Org A phone)', async () => {
      const orgA = uniqueId('org_a');
      const orgB = uniqueId('org_b');
      const sharedPhone = uniquePhone();

      const connA = await connectionRepo.createConnection({
        organization_id: orgA,
        display_name: 'Org A Phone',
        created_by_user_id: 'user-a',
        provider: 'zernio',
      });
      const connB = await connectionRepo.createConnection({
        organization_id: orgB,
        display_name: 'Org B Phone',
        created_by_user_id: 'user-b',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgA, connA.id, 'prof_poa');
      await service.bindZernioProfileToConnection(orgB, connB.id, 'prof_pob');

      await service.materializeZernioProviderIdentity(orgA, connA.id, {
        providerProfileId: 'prof_poa',
        providerAccountId: uniqueId('acc_poa'),
        phoneNumber: sharedPhone,
      });

      await expect(
        service.materializeZernioProviderIdentity(orgB, connB.id, {
          providerProfileId: 'prof_pob',
          providerAccountId: uniqueId('acc_pob'),
          phoneNumber: sharedPhone,
        })
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'PROVIDER_PHONE_ALREADY_REGISTERED' }),
        })
      );
    });

    it('MIXED COLLISION: when account is free but phone is occupied, entire tx aborts and NO orphan account claim is written', async () => {
      const orgId = uniqueId('org');
      const occupiedPhone = uniquePhone();
      const freeAccountId = uniqueId('acc_free_test');

      // Pre-claim the phone
      const connPre = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Pre-existing line',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgId, connPre.id, 'prof_pre');
      await service.materializeZernioProviderIdentity(orgId, connPre.id, {
        providerProfileId: 'prof_pre',
        providerAccountId: uniqueId('acc_pre'),
        phoneNumber: occupiedPhone,
      });

      // Target connection attempts freeAccountId + occupiedPhone
      const connTarget = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Target line',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgId, connTarget.id, 'prof_target');

      await expect(
        service.materializeZernioProviderIdentity(orgId, connTarget.id, {
          providerProfileId: 'prof_target',
          providerAccountId: freeAccountId,
          phoneNumber: occupiedPhone,
        })
      ).rejects.toThrow(/PROVIDER_PHONE_ALREADY_REGISTERED/);

      // Verify ZERO orphan account claim was written!
      const orphanAccountClaim = await claimRepo.getZernioAccountClaim(freeAccountId);
      expect(orphanAccountClaim).toBeNull();
    });

    it('MIXED COLLISION: when account is occupied but phone is free, entire tx aborts and NO orphan phone claim is written', async () => {
      const orgId = uniqueId('org');
      const occupiedAccountId = uniqueId('acc_occupied_test');
      const freePhone = uniquePhone();

      // Pre-claim the account
      const connPre = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Pre-existing account line',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgId, connPre.id, 'prof_pre_acc');
      await service.materializeZernioProviderIdentity(orgId, connPre.id, {
        providerProfileId: 'prof_pre_acc',
        providerAccountId: occupiedAccountId,
        phoneNumber: uniquePhone(),
      });

      // Target connection attempts occupiedAccountId + freePhone
      const connTarget = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Target line 2',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgId, connTarget.id, 'prof_target_2');

      await expect(
        service.materializeZernioProviderIdentity(orgId, connTarget.id, {
          providerProfileId: 'prof_target_2',
          providerAccountId: occupiedAccountId,
          phoneNumber: freePhone,
        })
      ).rejects.toThrow(/ZERNIO_ACCOUNT_ALREADY_REGISTERED/);

      // Verify ZERO orphan phone claim was written!
      const orphanPhoneClaim = await claimRepo.getZernioPhoneClaim(freePhone);
      expect(orphanPhoneClaim).toBeNull();
    });
  });

  describe('STEP 13: Profile Lookup Query (findByZernioProfileId)', () => {
    it('finds connection by exact provider_profile_id', async () => {
      const orgId = uniqueId('org');
      const profileId = uniqueId('prof_lookup');

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Lookup Conn',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgId, conn.id, profileId);

      const found = await connectionRepo.findByZernioProfileId(profileId, orgId);
      expect(found).toBeDefined();
      expect(found?.id).toBe(conn.id);
      expect(found?.provider_profile_id).toBe(profileId);
    });

    it('returns null when profileId does not match any connection', async () => {
      const found = await connectionRepo.findByZernioProfileId('prof_nonexistent_xyz');
      expect(found).toBeNull();
    });

    it('returns null when organizationId filter diverges', async () => {
      const orgA = uniqueId('org_a');
      const orgB = uniqueId('org_b');
      const profileId = uniqueId('prof_scoped');

      const conn = await connectionRepo.createConnection({
        organization_id: orgA,
        display_name: 'Org A Lookup',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgA, conn.id, profileId);

      const found = await connectionRepo.findByZernioProfileId(profileId, orgB);
      expect(found).toBeNull();
    });
  });

  describe('Terminal Disconnect Lifecycle & Claim Retention', () => {
    it('retains both Zernio account and phone claims on disconnect; prevents reacquisition by other connections', async () => {
      const orgId = uniqueId('org');
      const accountId = uniqueId('acc_retained');
      const phoneNumber = uniquePhone();

      // 1. Create Zernio Connection A
      const connA = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Conn To Disconnect',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      // 2. Bind Profile A
      await service.bindZernioProfileToConnection(orgId, connA.id, 'prof_disc_1');
      // 3. Materialize account X + phone P
      await service.materializeZernioProviderIdentity(orgId, connA.id, {
        providerProfileId: 'prof_disc_1',
        providerAccountId: accountId,
        phoneNumber,
      });

      // Verify claims exist and point to connA
      const preAccClaim = await claimRepo.getZernioAccountClaim(accountId);
      const prePhoneClaim = await claimRepo.getZernioPhoneClaim(phoneNumber);
      expect(preAccClaim?.connection_id).toBe(connA.id);
      expect(prePhoneClaim?.connection_id).toBe(connA.id);

      // 4. Locally disconnect Connection A
      await connectionRepo.disconnectConnection(orgId, connA.id);

      // 5. Assert: Connection A is locally disconnected; claims STILL exist and point to Conn A
      const updatedConnA = await connectionRepo.getConnectionById(connA.id);
      expect(updatedConnA?.status).toBe('disconnected');

      const postAccClaim = await claimRepo.getZernioAccountClaim(accountId);
      const postPhoneClaim = await claimRepo.getZernioPhoneClaim(phoneNumber);
      expect(postAccClaim).not.toBeNull();
      expect(postAccClaim?.connection_id).toBe(connA.id);
      expect(postAccClaim?.organization_id).toBe(orgId);
      expect(postPhoneClaim).not.toBeNull();
      expect(postPhoneClaim?.connection_id).toBe(connA.id);
      expect(postPhoneClaim?.organization_id).toBe(orgId);

      // 6. Create Connection B (same org)
      const connB = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Conn B Reclaim Attempt',
        created_by_user_id: 'user-2',
        provider: 'zernio',
      });
      // 7. Bind Profile B
      await service.bindZernioProfileToConnection(orgId, connB.id, 'prof_disc_2');

      // 8. Attempt materialization using retained account X -> must fail 409
      await expect(
        service.materializeZernioProviderIdentity(orgId, connB.id, {
          providerProfileId: 'prof_disc_2',
          providerAccountId: accountId,
          phoneNumber: uniquePhone(),
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('ZERNIO_ACCOUNT_ALREADY_REGISTERED'),
      });

      // 9. Attempt materialization using retained phone P with another account -> must fail 409
      await expect(
        service.materializeZernioProviderIdentity(orgId, connB.id, {
          providerProfileId: 'prof_disc_2',
          providerAccountId: uniqueId('acc_another'),
          phoneNumber,
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('PROVIDER_PHONE_ALREADY_REGISTERED'),
      });

      // 10. Attempt materialization across another Organization -> must fail 409
      const otherOrgId = uniqueId('org_other');
      const connC = await connectionRepo.createConnection({
        organization_id: otherOrgId,
        display_name: 'Conn C Cross Org',
        created_by_user_id: 'user-3',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(otherOrgId, connC.id, 'prof_disc_3');

      await expect(
        service.materializeZernioProviderIdentity(otherOrgId, connC.id, {
          providerProfileId: 'prof_disc_3',
          providerAccountId: accountId,
          phoneNumber: uniquePhone(),
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('ZERNIO_ACCOUNT_ALREADY_REGISTERED'),
      });

      // 11. Inspect final Firestore state
      const finalConnB = await connectionRepo.getConnectionById(connB.id);
      expect(finalConnB?.provider_account_id).toBeNull();
      expect(finalConnB?.phone_number).toBeNull();

      const finalAccClaim = await claimRepo.getZernioAccountClaim(accountId);
      const finalPhoneClaim = await claimRepo.getZernioPhoneClaim(phoneNumber);
      expect(finalAccClaim?.connection_id).toBe(connA.id);
      expect(finalPhoneClaim?.connection_id).toBe(connA.id);
    });
  });

  describe('STEP 14: Adversarial Concurrency Races on Emulator', () => {
    it('RACE 1: Two connections concurrently claiming the SAME providerAccountId - exactly ONE wins', async () => {
      const orgId = uniqueId('org_race1');
      const sharedAccountId = uniqueId('acc_race1');
      const phone1 = uniquePhone();
      const phone2 = uniquePhone();

      const conn1 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Racer 1',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      const conn2 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Racer 2',
        created_by_user_id: 'user-2',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn1.id, 'prof_race_1a');
      await service.bindZernioProfileToConnection(orgId, conn2.id, 'prof_race_1b');

      const [res1, res2] = await Promise.allSettled([
        service.materializeZernioProviderIdentity(orgId, conn1.id, {
          providerProfileId: 'prof_race_1a',
          providerAccountId: sharedAccountId,
          phoneNumber: phone1,
        }),
        service.materializeZernioProviderIdentity(orgId, conn2.id, {
          providerProfileId: 'prof_race_1b',
          providerAccountId: sharedAccountId,
          phoneNumber: phone2,
        }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const winningConn = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;

      expect(rejectionReason).toBeInstanceOf(AppError);
      expect(rejectionReason.statusCode).toBe(409);
      expect(rejectionReason.message).toContain('ZERNIO_ACCOUNT_ALREADY_REGISTERED');

      // Assert winning connection owns account claim
      const claim = await claimRepo.getZernioAccountClaim(sharedAccountId);
      expect(claim?.connection_id).toBe(winningConn.id);

      // Assert losing connection has NO partial claim
      const losingConnId = winningConn.id === conn1.id ? conn2.id : conn1.id;
      const losingPhone = winningConn.id === conn1.id ? phone2 : phone1;
      const orphanPhoneClaim = await claimRepo.getZernioPhoneClaim(losingPhone);
      expect(orphanPhoneClaim).toBeNull();

      const losingConn = await connectionRepo.getConnectionById(losingConnId);
      expect(losingConn?.provider_account_id).toBeNull();
      expect(losingConn?.phone_number).toBeNull();
    });

    it('RACE 2: Two connections concurrently claiming the SAME phone with different accounts - exactly ONE wins', async () => {
      const orgId = uniqueId('org_race2');
      const sharedPhone = uniquePhone();

      const conn1 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Racer Phone 1',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      const conn2 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Racer Phone 2',
        created_by_user_id: 'user-2',
        provider: 'zernio',
      });

      await service.bindZernioProfileToConnection(orgId, conn1.id, 'prof_race_2a');
      await service.bindZernioProfileToConnection(orgId, conn2.id, 'prof_race_2b');

      const acc1 = uniqueId('acc_race2_1');
      const acc2 = uniqueId('acc_race2_2');

      const [res1, res2] = await Promise.allSettled([
        service.materializeZernioProviderIdentity(orgId, conn1.id, {
          providerProfileId: 'prof_race_2a',
          providerAccountId: acc1,
          phoneNumber: sharedPhone,
        }),
        service.materializeZernioProviderIdentity(orgId, conn2.id, {
          providerProfileId: 'prof_race_2b',
          providerAccountId: acc2,
          phoneNumber: sharedPhone,
        }),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const winningConn = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;

      expect(rejectionReason).toBeInstanceOf(AppError);
      expect(rejectionReason.statusCode).toBe(409);
      expect(rejectionReason.message).toContain('PROVIDER_PHONE_ALREADY_REGISTERED');

      // Assert winning connection owns phone claim
      const claim = await claimRepo.getZernioPhoneClaim(sharedPhone);
      expect(claim?.connection_id).toBe(winningConn.id);

      // Assert losing connection has NO orphan account claim
      const losingAcc = winningConn.id === conn1.id ? acc2 : acc1;
      const orphanAccClaim = await claimRepo.getZernioAccountClaim(losingAcc);
      expect(orphanAccClaim).toBeNull();
    });

    it('RACE 3: Two concurrent profile binds on the SAME connection with DIFFERENT profile IDs - exactly ONE wins', async () => {
      const orgId = uniqueId('org_race3');
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Racer Profile Bind',
        created_by_user_id: 'user-race3',
        provider: 'zernio',
      });

      const [res1, res2] = await Promise.allSettled([
        service.bindZernioProfileToConnection(orgId, conn.id, 'prof_race_3a'),
        service.bindZernioProfileToConnection(orgId, conn.id, 'prof_race_3b'),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const rejectionReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectionReason).toBeInstanceOf(AppError);
      expect(rejectionReason.statusCode).toBe(409);
      expect(rejectionReason.message).toContain('ZERNIO_PROFILE_ALREADY_BOUND');

      const winningConn = (fulfilled[0] as PromiseFulfilledResult<any>).value;
      const winningProfileId = winningConn.provider_profile_id;
      expect(['prof_race_3a', 'prof_race_3b']).toContain(winningProfileId);

      // Inspect final Firestore state
      const finalConn = await connectionRepo.getConnectionById(conn.id);
      expect(finalConn?.provider_profile_id).toBe(winningProfileId);
      expect(finalConn?.provider_account_id).toBeNull();
      expect(finalConn?.phone_number).toBeNull();
      expect(finalConn?.status).toBe('pending');
    });
  });

  describe('STEP 11: Meta Regression & Namespace Isolation', () => {
    it('Meta and Zernio identity claims with identical raw string IDs do not collide', async () => {
      const orgId = uniqueId('org_meta_iso');
      const sharedRawId = uniqueId('shared_identical_id');

      // 1. Meta connection claims sharedRawId as provider_phone_number_id
      const metaConn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Meta Connection',
        created_by_user_id: 'user-meta',
        provider: 'meta_cloud_api',
      });
      await service.materializeProviderIdentity(orgId, metaConn.id, {
        phoneNumber: uniquePhone(),
        providerWabaId: 'waba-meta-iso',
        providerPhoneNumberId: sharedRawId,
      });

      // 2. Zernio connection claims sharedRawId as provider_account_id
      const zernioConn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Zernio Connection',
        created_by_user_id: 'user-zernio',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgId, zernioConn.id, 'prof_meta_iso');
      await service.materializeZernioProviderIdentity(orgId, zernioConn.id, {
        providerProfileId: 'prof_meta_iso',
        providerAccountId: sharedRawId,
        phoneNumber: uniquePhone(),
      });

      // Both claims peacefully coexist in whatsapp_provider_identity_claims
      const metaClaimId = getClaimId('meta_cloud_api', sharedRawId);
      const zernioAccountClaimId = getZernioAccountClaimId(sharedRawId);

      expect(metaClaimId).toBe(`claim_meta_cloud_api_${sharedRawId}`);
      expect(zernioAccountClaimId).toBe(`claim_zernio_account_${sharedRawId}`);
      expect(metaClaimId).not.toBe(zernioAccountClaimId);

      const metaClaimDoc = await claimRepo.getClaim(metaClaimId);
      const zernioClaimDoc = await claimRepo.getClaim(zernioAccountClaimId);

      expect(metaClaimDoc?.connection_id).toBe(metaConn.id);
      expect(zernioClaimDoc?.connection_id).toBe(zernioConn.id);
    });
  });

  describe('STEP 15: Account ID Path Safety & Slash Rejection', () => {
    it('rejects providerAccountId containing "/" in getZernioAccountClaimId with sanitized error', () => {
      expect(() => getZernioAccountClaimId('acc/123')).toThrowError(AppError);
      try {
        getZernioAccountClaimId('acc/123');
      } catch (err: any) {
        expect(err.statusCode).toBe(400);
        expect((err.details as any)?.code).toBe('INVALID_ACCOUNT_ID');
        expect(err.message).toContain('não pode conter barra');
        expect(err.message).not.toContain('acc/123');
      }
    });

    it('rejects empty or whitespace providerAccountId in getZernioAccountClaimId', () => {
      expect(() => getZernioAccountClaimId('')).toThrowError(AppError);
      expect(() => getZernioAccountClaimId('   ')).toThrowError(AppError);
    });

    it('generates correct deterministic claim ID for valid alphanumeric and hyphenated IDs', () => {
      expect(getZernioAccountClaimId('acc_test_123')).toBe('claim_zernio_account_acc_test_123');
      expect(getZernioAccountClaimId('65f0a1b2c3d4e5f6a7b8c9d0')).toBe('claim_zernio_account_65f0a1b2c3d4e5f6a7b8c9d0');
      expect(getZernioAccountClaimId('org-acc-999')).toBe('claim_zernio_account_org-acc-999');
    });

    it('rejects providerAccountId containing "/" in materializeZernioProviderIdentity before writes (no partial write)', async () => {
      const orgId = uniqueId('org_slash');
      const testPhone = uniquePhone();
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Conn Slash Test',
        created_by_user_id: 'user-1',
        provider: 'zernio',
      });
      await service.bindZernioProfileToConnection(orgId, conn.id, 'prof_slash');

      await expect(
        service.materializeZernioProviderIdentity(orgId, conn.id, {
          providerProfileId: 'prof_slash',
          providerAccountId: 'invalid/account/id',
          phoneNumber: testPhone,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining('não pode conter barra'),
      });

      // Verify no partial write occurred on connection or claims
      const checkedConn = await connectionRepo.getConnectionById(conn.id);
      expect(checkedConn?.provider_account_id).toBeNull();
      expect(checkedConn?.phone_number).toBeNull();

      const phoneClaim = await claimRepo.getZernioPhoneClaim(testPhone);
      expect(phoneClaim).toBeNull();
    });
  });
});
