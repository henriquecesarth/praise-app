import { describe, expect, it } from 'vitest';
import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import {
  getClaimId,
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
  normalizeToE164,
  WhatsAppConnectionRecord,
  WhatsAppProviderIdentityClaimRecord,
} from './whatsapp.types';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppOutboundService } from './whatsapp-outbound.service';
import { WhatsAppProviderIdentityVerificationService } from './whatsapp-provider-identity-verification.service';

describe('Provider-polymorphic WhatsApp identity claim verification (7D2-PR2)', { timeout: 20000 }, () => {
  const claimRepo = new WhatsAppProviderIdentityClaimRepository();
  const verifier = new WhatsAppProviderIdentityVerificationService(claimRepo);

  function uniqueId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function connection(overrides: Partial<WhatsAppConnectionRecord> = {}): WhatsAppConnectionRecord {
    const now = new Date().toISOString();
    return {
      id: uniqueId('conn'),
      organization_id: uniqueId('org'),
      display_name: 'Provider claim verification',
      phone_number: '+5511999998888',
      provider: 'zernio',
      provider_profile_id: 'profile_1',
      provider_account_id: uniqueId('account'),
      provider_waba_id: null,
      provider_phone_number_id: null,
      status: 'connected',
      status_reason: null,
      assigned_ministry_id: null,
      created_by_user_id: 'actor_1',
      current_onboarding_session_id: null,
      pending_expires_at: null,
      last_connected_at: now,
      last_health_check_at: null,
      created_at: now,
      updated_at: now,
      ...overrides,
    };
  }

  async function putClaim(params: {
    id: string;
    provider: 'meta_cloud_api' | 'zernio';
    providerIdentity: string;
    organizationId: string;
    connectionId: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const record: WhatsAppProviderIdentityClaimRecord = {
      id: params.id,
      provider: params.provider,
      provider_phone_number_id: params.providerIdentity,
      organization_id: params.organizationId,
      connection_id: params.connectionId,
      created_at: now,
      updated_at: now,
    };
    await db.collection('whatsapp_provider_identity_claims').doc(params.id).set(record);
  }

  async function putZernioClaims(conn: WhatsAppConnectionRecord, overrides: {
    accountOrganizationId?: string;
    accountConnectionId?: string;
    phoneOrganizationId?: string;
    phoneConnectionId?: string;
  } = {}): Promise<void> {
    const accountId = getZernioAccountClaimId(conn.provider_account_id!);
    const phoneId = getZernioPhoneClaimId(conn.phone_number!);
    await putClaim({
      id: accountId,
      provider: 'zernio',
      providerIdentity: conn.provider_account_id!,
      organizationId: overrides.accountOrganizationId || conn.organization_id,
      connectionId: overrides.accountConnectionId || conn.id,
    });
    await putClaim({
      id: phoneId,
      provider: 'zernio',
      providerIdentity: conn.phone_number!,
      organizationId: overrides.phoneOrganizationId || conn.organization_id,
      connectionId: overrides.phoneConnectionId || conn.id,
    });
  }

  async function expectInvalid(conn: WhatsAppConnectionRecord): Promise<void> {
    await expect(
      verifier.verifyProviderIdentityClaims({ connection: conn, organizationId: conn.organization_id })
    ).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'INVALID_PROVIDER_CLAIM' },
    });
  }

  it('accepts a valid Meta claim', async () => {
    const conn = connection({
      provider: 'meta_cloud_api',
      provider_waba_id: 'waba_1',
      provider_phone_number_id: 'meta_phone_1',
      provider_account_id: null,
      provider_profile_id: null,
    });
    await putClaim({
      id: getClaimId('meta_cloud_api', conn.provider_phone_number_id!),
      provider: 'meta_cloud_api',
      providerIdentity: conn.provider_phone_number_id!,
      organizationId: conn.organization_id,
      connectionId: conn.id,
    });

    await expect(verifier.verifyProviderIdentityClaims({ connection: conn, organizationId: conn.organization_id }))
      .resolves.toBeUndefined();
  });

  it('rejects missing, cross-org, cross-connection, and missing-identity Meta claims', async () => {
    const missing = connection({ provider: 'meta_cloud_api', provider_phone_number_id: 'meta_missing' });
    await expectInvalid(missing);

    const wrongOrg = connection({ provider: 'meta_cloud_api', provider_phone_number_id: 'meta_wrong_org' });
    await putClaim({
      id: getClaimId('meta_cloud_api', wrongOrg.provider_phone_number_id!),
      provider: 'meta_cloud_api',
      providerIdentity: wrongOrg.provider_phone_number_id!,
      organizationId: uniqueId('foreign_org'),
      connectionId: wrongOrg.id,
    });
    await expectInvalid(wrongOrg);

    const wrongConnection = connection({ provider: 'meta_cloud_api', provider_phone_number_id: 'meta_wrong_conn' });
    await putClaim({
      id: getClaimId('meta_cloud_api', wrongConnection.provider_phone_number_id!),
      provider: 'meta_cloud_api',
      providerIdentity: wrongConnection.provider_phone_number_id!,
      organizationId: wrongConnection.organization_id,
      connectionId: uniqueId('foreign_conn'),
    });
    await expectInvalid(wrongConnection);
    await expectInvalid(connection({ provider: 'meta_cloud_api', provider_phone_number_id: null }));
  });

  it('accepts both valid D3-style Zernio claims', async () => {
    const conn = connection();
    await putZernioClaims(conn);

    await expect(verifier.verifyProviderIdentityClaims({ connection: conn, organizationId: conn.organization_id }))
      .resolves.toBeUndefined();
  });

  it('rejects each missing Zernio claim', async () => {
    const missingAccount = connection();
    await putClaim({
      id: getZernioPhoneClaimId(missingAccount.phone_number!),
      provider: 'zernio',
      providerIdentity: missingAccount.phone_number!,
      organizationId: missingAccount.organization_id,
      connectionId: missingAccount.id,
    });
    await expectInvalid(missingAccount);

    const missingPhone = connection();
    await putClaim({
      id: getZernioAccountClaimId(missingPhone.provider_account_id!),
      provider: 'zernio',
      providerIdentity: missingPhone.provider_account_id!,
      organizationId: missingPhone.organization_id,
      connectionId: missingPhone.id,
    });
    await expectInvalid(missingPhone);
  });

  it('rejects Zernio account and phone claims with cross-tenant or cross-connection owners', async () => {
    const accountWrongOrg = connection();
    await putZernioClaims(accountWrongOrg, { accountOrganizationId: uniqueId('foreign_org') });
    await expectInvalid(accountWrongOrg);

    const accountWrongConnection = connection();
    await putZernioClaims(accountWrongConnection, { accountConnectionId: uniqueId('foreign_conn') });
    await expectInvalid(accountWrongConnection);

    const phoneWrongOrg = connection();
    await putZernioClaims(phoneWrongOrg, { phoneOrganizationId: uniqueId('foreign_org') });
    await expectInvalid(phoneWrongOrg);

    const phoneWrongConnection = connection();
    await putZernioClaims(phoneWrongConnection, { phoneConnectionId: uniqueId('foreign_conn') });
    await expectInvalid(phoneWrongConnection);
  });

  it('rejects a valid Zernio account claim paired with an invalid phone claim and the inverse', async () => {
    const phoneInvalid = connection();
    await putZernioClaims(phoneInvalid, { phoneOrganizationId: uniqueId('foreign_org') });
    await expectInvalid(phoneInvalid);

    const accountInvalid = connection();
    await putZernioClaims(accountInvalid, { accountConnectionId: uniqueId('foreign_conn') });
    await expectInvalid(accountInvalid);
  });

  it('rejects missing Zernio account, missing phone, malformed phone, and unknown providers', async () => {
    await expectInvalid(connection({ provider_account_id: null }));
    await expectInvalid(connection({ phone_number: null }));
    await expectInvalid(connection({ phone_number: 'invalid-number' }));
    await expectInvalid(connection({ provider: 'unknown' as WhatsAppConnectionRecord['provider'] }));
  });

  it('uses the exact D3 E.164 canonical phone claim and rejects a non-canonical stored phone', async () => {
    const rawPhone = '+55 (11) 99999-8888';
    expect(normalizeToE164(rawPhone)).toBe('+5511999998888');

    const canonical = connection({ phone_number: normalizeToE164(rawPhone) });
    await putZernioClaims(canonical);
    await expect(verifier.verifyProviderIdentityClaims({ connection: canonical, organizationId: canonical.organization_id }))
      .resolves.toBeUndefined();

    const nonCanonical = connection({ phone_number: rawPhone });
    await putZernioClaims({ ...nonCanonical, phone_number: normalizeToE164(rawPhone) });
    await expectInvalid(nonCanonical);
  });

  async function materializeConnectedZernioFixture(): Promise<{
    orgId: string;
    ministryId: string;
    actorUserId: string;
    connection: WhatsAppConnectionRecord;
    service: WhatsAppConnectionService;
  }> {
    const orgId = uniqueId('org');
    const ministryId = uniqueId('ministry');
    const actorUserId = uniqueId('actor');
    const phoneNumber = `+55119${`${Date.now()}${Math.floor(Math.random() * 10_000_000)}`.slice(-8)}`;
    const now = new Date().toISOString();
    const connectionRepo = new WhatsAppConnectionRepository();
    const orgRepo = new OrganizationRepository();
    const ministryRepo = new MinistryRepository();
    const capacityService = {
      getOrganizationWhatsAppCapacity: async () => ({
        organizationId: orgId,
        billingAnchorMinistryId: ministryId,
        enabled: true,
        includedConnections: 1,
        additionalConnections: 0,
        totalAllowedConnections: 1,
        billingAccessMode: 'active',
      }),
    } as unknown as SubscriptionService;
    const service = new WhatsAppConnectionService(
      connectionRepo,
      undefined,
      claimRepo,
      orgRepo,
      capacityService,
      ministryRepo
    );

    await db.collection('organizations').doc(orgId).set({
      id: orgId,
      name: 'PR2 Organization',
      owner_user_id: actorUserId,
      billing_anchor_ministry_id: ministryId,
      default_whatsapp_connection_id: null,
      created_at: now,
      updated_at: now,
    });
    await db.collection('organization_members').doc(`${orgId}_${actorUserId}`).set({
      id: `${orgId}_${actorUserId}`,
      organization_id: orgId,
      user_id: actorUserId,
      role: 'owner',
      created_at: now,
      updated_at: now,
    });
    await db.collection('ministries').doc(ministryId).set({
      id: ministryId,
      name: 'PR2 Ministry',
      owner_user_id: actorUserId,
      organization_id: orgId,
      created_at: now,
      updated_at: now,
    });

    const pending = await connectionRepo.createConnection({
      organization_id: orgId,
      display_name: 'D3 materialized Zernio',
      created_by_user_id: actorUserId,
      provider: 'zernio',
      status: 'pending',
    });
    await service.bindZernioProfileToConnection(orgId, pending.id, uniqueId('profile'));
    await service.materializeZernioProviderIdentity(orgId, pending.id, {
      providerProfileId: (await connectionRepo.getConnectionById(pending.id))!.provider_profile_id!,
      providerAccountId: uniqueId('account'),
      phoneNumber,
    });
    await service.transitionConnectionStatus(orgId, pending.id, 'connecting');
    await service.transitionConnectionStatus(orgId, pending.id, 'connected');
    const materialized = (await connectionRepo.getConnectionById(pending.id))!;
    return { orgId, ministryId, actorUserId, connection: materialized, service };
  }

  it('resolves, assigns, and validates an outbound sender for a materialized Zernio connection without provider_phone_number_id', async () => {
    const fixture = await materializeConnectedZernioFixture();
    expect(fixture.connection.provider_phone_number_id).toBeNull();

    await db.collection('organizations').doc(fixture.orgId).update({
      default_whatsapp_connection_id: fixture.connection.id,
    });

    await expect(fixture.service.resolveWhatsAppConnection(fixture.ministryId)).resolves.toMatchObject({
      success: true,
      connection: { id: fixture.connection.id },
    });
    await db.collection('organizations').doc(fixture.orgId).update({ default_whatsapp_connection_id: null });
    await expect(fixture.service.assignMinistry(
      fixture.orgId,
      fixture.connection.id,
      fixture.ministryId,
      fixture.actorUserId
    )).resolves.toBeUndefined();
    await fixture.service.unassignMinistry(fixture.orgId, fixture.connection.id, fixture.actorUserId);
    await db.collection('organizations').doc(fixture.orgId).update({
      default_whatsapp_connection_id: fixture.connection.id,
    });

    const outbound = new WhatsAppOutboundService(
      undefined,
      undefined,
      claimRepo,
      undefined,
      undefined,
      fixture.service
    );
    await expect(outbound.resolveSenderConnection({ organizationId: fixture.orgId }))
      .resolves.toMatchObject({ id: fixture.connection.id });
  });

  it('rejects forged cross-tenant Zernio account and phone claims and never accepts claim_zernio_undefined', async () => {
    const accountForged = await materializeConnectedZernioFixture();
    await db.collection('organizations').doc(accountForged.orgId).update({
      default_whatsapp_connection_id: accountForged.connection.id,
    });
    await putClaim({
      id: getZernioAccountClaimId(accountForged.connection.provider_account_id!),
      provider: 'zernio',
      providerIdentity: accountForged.connection.provider_account_id!,
      organizationId: uniqueId('foreign_org'),
      connectionId: accountForged.connection.id,
    });
    await expect(accountForged.service.resolveWhatsAppConnection(accountForged.ministryId)).resolves.toMatchObject({
      success: false,
      code: 'CONNECTION_NOT_ACTIVE',
    });

    const phoneForged = await materializeConnectedZernioFixture();
    await db.collection('organizations').doc(phoneForged.orgId).update({
      default_whatsapp_connection_id: phoneForged.connection.id,
    });
    await putClaim({
      id: getZernioPhoneClaimId(phoneForged.connection.phone_number!),
      provider: 'zernio',
      providerIdentity: phoneForged.connection.phone_number!,
      organizationId: uniqueId('foreign_org'),
      connectionId: phoneForged.connection.id,
    });
    await expect(phoneForged.service.resolveWhatsAppConnection(phoneForged.ministryId)).resolves.toMatchObject({
      success: false,
      code: 'CONNECTION_NOT_ACTIVE',
    });

    const legacyOnly = connection();
    await putClaim({
      id: 'claim_zernio_undefined',
      provider: 'zernio',
      providerIdentity: 'undefined',
      organizationId: legacyOnly.organization_id,
      connectionId: legacyOnly.id,
    });
    await expectInvalid(legacyOnly);
  });
});
