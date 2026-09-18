import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppOutboundDispatchRepository } from '../../repositories/WhatsAppOutboundDispatchRepository';
import { SubscriptionService } from './subscription.service';
import { WhatsAppOutboundService } from '../whatsapp/whatsapp-outbound.service';
import { WhatsAppConnectionRecord } from '../whatsapp/whatsapp.types';
import { WhatsAppOutboundDispatchRecord } from '../whatsapp/zernio.types';
import { OrganizationRecord } from '../organizations/organization.types';
import { MinistrySubscriptionRecord } from './subscription.types';
import { AppError } from '../../middleware/error-handler';
import { getBillingDate } from '../../utils/billing-date';

describe('WhatsApp Commercial Entitlement Integration Suite (Phase 7D2-D8)', { timeout: 30000 }, () => {
  const connectionRepo = new WhatsAppConnectionRepository();
  const dispatchRepo = new WhatsAppOutboundDispatchRepository();
  const subService = new SubscriptionService();

  function uniqueId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  async function setupTestOrganization(params: {
    orgId: string;
    anchorMinistryId: string;
    planId?: 'free' | 'pro' | 'premium';
    billingStatus?: 'active' | 'past_due' | 'canceled';
    administrativelySuspended?: boolean;
    graceDate?: string | null;
    mismatchedAnchorOrgId?: string;
  }) {
    const nowIso = new Date().toISOString();
    const orgRecord: OrganizationRecord = {
      id: params.orgId,
      name: `Org ${params.orgId}`,
      slug: `org-${params.orgId}`,
      owner_user_id: 'user-1',
      billing_anchor_ministry_id: params.anchorMinistryId,
      default_whatsapp_connection_id: null,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await db.collection('organizations').doc(params.orgId).set(orgRecord);

    const ministryRecord = {
      id: params.anchorMinistryId,
      name: `Ministry ${params.anchorMinistryId}`,
      organization_id: params.mismatchedAnchorOrgId || params.orgId,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await db.collection('ministries').doc(params.anchorMinistryId).set(ministryRecord);

    const subRecord: MinistrySubscriptionRecord = {
      id: params.anchorMinistryId,
      ministry_id: params.anchorMinistryId,
      plan_id: params.planId || 'premium',
      member_addon_blocks: 0,
      subscription_mode: params.planId === 'free' ? 'free' : 'paid',
      billing_status: params.billingStatus || 'active',
      current_period_start: nowIso,
      current_period_end: null,
      cancel_at_period_end: false,
      grace_period_expires_at: null,
      grace_period_expires_billing_date: params.graceDate || null,
      administratively_suspended: Boolean(params.administrativelySuspended),
      suspended_at: null,
      suspension_reason: null,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await db.collection('ministry_subscriptions').doc(params.anchorMinistryId).set(subRecord);

    return { orgRecord, ministryRecord, subRecord };
  }

  // ============================================================================
  // 1. CAPACITY QUERY PARTITIONING & COUNTING (Scenarios 28-40)
  // ============================================================================
  describe('1. Partitioned Bounded Queries in WhatsAppConnectionRepository', () => {
    it('correctly partitions and counts consuming vs non-consuming connections with expired/null pending dates', async () => {
      const orgId = uniqueId('org_part');
      const anchorMinId = uniqueId('min_part');
      await setupTestOrganization({ orgId, anchorMinistryId: anchorMinId });

      const now = new Date('2026-09-18T12:00:00.000Z');
      const futureExpiry = new Date(now.getTime() + 2 * 3600 * 1000).toISOString();
      const pastExpiry = new Date(now.getTime() - 2 * 3600 * 1000).toISOString();

      // Non-pending consuming: connecting, connected, error, disabled_by_user
      const conn1 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line 1 Connected',
        status: 'connected',
        provider: 'meta_cloud_api',
        created_by_user_id: 'user_1',
      });
      const c1 = conn1.id;

      const conn2 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line 2 Connecting',
        status: 'connecting',
        provider: 'zernio',
        created_by_user_id: 'user_1',
      });
      const c2 = conn2.id;

      const conn3 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line 3 Error',
        status: 'error',
        provider: 'meta_cloud_api',
        created_by_user_id: 'user_1',
      });
      const c3 = conn3.id;

      const conn4 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line 4 Disabled by user',
        status: 'disabled_by_user',
        provider: 'zernio',
        created_by_user_id: 'user_1',
      });
      const c4 = conn4.id;

      // Pending consuming: future expiry
      const c5 = uniqueId('wac_5');
      await db.collection('whatsapp_connections').doc(c5).set({
        id: c5,
        organization_id: orgId,
        display_name: 'Line 5 Pending Future',
        status: 'pending',
        pending_expires_at: futureExpiry,
        provider: 'meta_cloud_api',
        created_by_user_id: 'user_1',
        created_at: new Date(now.getTime() - 5000).toISOString(),
        updated_at: new Date(now.getTime() - 5000).toISOString(),
      });

      // Pending consuming: null expiry (fail-closed)
      const c6 = uniqueId('wac_6');
      await db.collection('whatsapp_connections').doc(c6).set({
        id: c6,
        organization_id: orgId,
        display_name: 'Line 6 Pending Null Expiry',
        status: 'pending',
        pending_expires_at: null,
        provider: 'zernio',
        created_by_user_id: 'user_1',
        created_at: new Date(now.getTime() - 4000).toISOString(),
        updated_at: new Date(now.getTime() - 4000).toISOString(),
      });

      // Pending NOT consuming: expired
      const c7 = uniqueId('wac_7');
      await db.collection('whatsapp_connections').doc(c7).set({
        id: c7,
        organization_id: orgId,
        display_name: 'Line 7 Pending Expired',
        status: 'pending',
        pending_expires_at: pastExpiry,
        provider: 'meta_cloud_api',
        created_by_user_id: 'user_1',
        created_at: new Date(now.getTime() - 10000).toISOString(),
        updated_at: new Date(now.getTime() - 10000).toISOString(),
      });

      // Non-consuming: disconnected
      const conn8 = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line 8 Disconnected',
        status: 'disconnected',
        provider: 'zernio',
        created_by_user_id: 'user_1',
      });
      const c8 = conn8.id;

      // Verify countConsumingConnections
      const count = await connectionRepo.countConsumingConnections(orgId, now);
      expect(count).toBe(6); // c1, c2, c3, c4, c5, c6

      // Verify getConsumingConnections
      const consumingList = await connectionRepo.getConsumingConnections(orgId, now);
      expect(consumingList.length).toBe(6);
      const returnedIds = consumingList.map((c) => c.id);
      expect(returnedIds).toContain(c1);
      expect(returnedIds).toContain(c2);
      expect(returnedIds).toContain(c3);
      expect(returnedIds).toContain(c4);
      expect(returnedIds).toContain(c5);
      expect(returnedIds).toContain(c6);
      expect(returnedIds).not.toContain(c7);
      expect(returnedIds).not.toContain(c8);
    });
  });

  // ============================================================================
  // 2. COMMERCIAL ENTITLEMENT PROJECTION MATRIX (Scenarios 41-55)
  // ============================================================================
  describe('2. Commercial Entitlement Projection Matrix via SubscriptionService', () => {
    it('evaluates Free plan as plan_excluded with 0 capacity', async () => {
      const orgId = uniqueId('org_free');
      const minId = uniqueId('min_free');
      await setupTestOrganization({ orgId, anchorMinistryId: minId, planId: 'free' });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId);
      expect(ent.state).toBe('plan_excluded');
      expect(ent.allowedConnections).toBe(0);
      expect(ent.canSendMessages).toBe(false);
      expect(ent.canCreateConnection).toBe(false);
      expect(ent.canResumeAuthorizedOnboarding).toBe(false);
      expect(ent.restrictionReason).toBe('PLAN_EXCLUDED');
    });

    it('evaluates Pro plan as plan_excluded with 0 capacity', async () => {
      const orgId = uniqueId('org_pro');
      const minId = uniqueId('min_pro');
      await setupTestOrganization({ orgId, anchorMinistryId: minId, planId: 'pro' });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId);
      expect(ent.state).toBe('plan_excluded');
      expect(ent.allowedConnections).toBe(0);
      expect(ent.canSendMessages).toBe(false);
      expect(ent.canCreateConnection).toBe(false);
      expect(ent.restrictionReason).toBe('PLAN_EXCLUDED');
    });

    it('evaluates Premium plan with 0 connections as healthy with 1 slot available', async () => {
      const orgId = uniqueId('org_prem_empty');
      const minId = uniqueId('min_prem_empty');
      await setupTestOrganization({ orgId, anchorMinistryId: minId, planId: 'premium' });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId);
      expect(ent.state).toBe('healthy');
      expect(ent.allowedConnections).toBe(1);
      expect(ent.consumingConnections).toBe(0);
      expect(ent.availableSlots).toBe(1);
      expect(ent.canCreateConnection).toBe(true);
      expect(ent.canSendMessages).toBe(true);
      expect(ent.canResumeAuthorizedOnboarding).toBe(true);
    });

    it('evaluates Premium plan with 1 connection as healthy at capacity (0 new slots)', async () => {
      const orgId = uniqueId('org_prem_full');
      const minId = uniqueId('min_prem_full');
      await setupTestOrganization({ orgId, anchorMinistryId: minId, planId: 'premium' });

      await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line 1',
        status: 'connected',
        provider: 'zernio',
        created_by_user_id: 'u1',
      });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId);
      expect(ent.state).toBe('healthy');
      expect(ent.allowedConnections).toBe(1);
      expect(ent.consumingConnections).toBe(1);
      expect(ent.availableSlots).toBe(0);
      expect(ent.canCreateConnection).toBe(false);
      expect(ent.canSendMessages).toBe(true);
      expect(ent.canResumeAuthorizedOnboarding).toBe(true);
    });

    it('evaluates Premium plan with 2 connections as restricted_over_limit', async () => {
      const orgId = uniqueId('org_prem_over');
      const minId = uniqueId('min_prem_over');
      await setupTestOrganization({ orgId, anchorMinistryId: minId, planId: 'premium' });

      await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line 1',
        status: 'connected',
        provider: 'zernio',
        created_by_user_id: 'u1',
      });
      await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Line 2',
        status: 'connecting',
        provider: 'meta_cloud_api',
        created_by_user_id: 'u1',
      });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId);
      expect(ent.state).toBe('restricted_over_limit');
      expect(ent.allowedConnections).toBe(1);
      expect(ent.consumingConnections).toBe(2);
      expect(ent.availableSlots).toBe(0);
      expect(ent.canCreateConnection).toBe(false);
      expect(ent.canSendMessages).toBe(false);
      expect(ent.canResumeAuthorizedOnboarding).toBe(false);
      expect(ent.restrictionReason).toBe('RESTRICTED_OVER_LIMIT');
    });

    it('evaluates administratively_suspended with highest priority over healthy plan', async () => {
      const orgId = uniqueId('org_admin_susp');
      const minId = uniqueId('min_admin_susp');
      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        planId: 'premium',
        administrativelySuspended: true,
      });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId);
      expect(ent.state).toBe('administratively_suspended');
      expect(ent.canSendMessages).toBe(false);
      expect(ent.canCreateConnection).toBe(false);
      expect(ent.canResumeAuthorizedOnboarding).toBe(false);
      expect(ent.restrictionReason).toBe('ADMINISTRATIVELY_SUSPENDED');
    });

    it('detects cross-tenant integrity failure when anchor ministry belongs to a different organization', async () => {
      const orgId = uniqueId('org_victim');
      const attackerOrgId = uniqueId('org_attacker');
      const minId = uniqueId('min_idor');

      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        mismatchedAnchorOrgId: attackerOrgId,
      });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId);
      expect(ent.state).toBe('integrity_failure');
      expect(ent.canSendMessages).toBe(false);
      expect(ent.canCreateConnection).toBe(false);
      expect(ent.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });
  });

  // ============================================================================
  // 3. PAYMENT GRACE LIFECYCLE (Scenarios 56-65)
  // ============================================================================
  describe('3. Payment Grace Lifecycle Evaluation', () => {
    it('evaluates past_due within grace period as payment_grace (sends allowed, resumes allowed, new blocked)', async () => {
      const orgId = uniqueId('org_grace_active');
      const minId = uniqueId('min_grace_active');

      const now = new Date();
      const futureGraceDate = getBillingDate(new Date(now.getTime() + 4 * 24 * 3600 * 1000));

      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        planId: 'premium',
        billingStatus: 'past_due',
        graceDate: futureGraceDate,
      });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId, now);
      expect(ent.state).toBe('payment_grace');
      expect(ent.canSendMessages).toBe(true);
      expect(ent.canResumeAuthorizedOnboarding).toBe(true);
      expect(ent.canCreateConnection).toBe(false);
      expect(ent.restrictionReason).toBeUndefined();
    });

    it('evaluates past_due past grace cutoff date as post_payment_grace (all operations blocked)', async () => {
      const orgId = uniqueId('org_grace_expired');
      const minId = uniqueId('min_grace_expired');

      const now = new Date();
      const pastGraceDate = getBillingDate(new Date(now.getTime() - 2 * 24 * 3600 * 1000));

      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        planId: 'premium',
        billingStatus: 'past_due',
        graceDate: pastGraceDate,
      });

      const ent = await subService.getOrganizationCommercialEntitlement(orgId, now);
      expect(ent.state).toBe('post_payment_grace');
      expect(ent.canSendMessages).toBe(false);
      expect(ent.canResumeAuthorizedOnboarding).toBe(false);
      expect(ent.canCreateConnection).toBe(false);
      expect(ent.restrictionReason).toBe('SUBSCRIPTION_PAST_DUE');
    });
  });

  // ============================================================================
  // 4. D6 OUTBOUND DISPATCH LINEARIZATION IN acquireDispatchExecution (Scenarios 66-78)
  // ============================================================================
  describe('4. D6 Outbound Dispatch Linearization in acquireDispatchExecution', () => {
    async function createPreparedDispatch(orgId: string, connId: string): Promise<WhatsAppOutboundDispatchRecord> {
      const dispatchId = uniqueId('disp');
      const idempotencyKey = `idem_${dispatchId}`;
      const { record } = await dispatchRepo.prepareDispatch({
        id: dispatchId,
        organizationId: orgId,
        connectionId: connId,
        providerAccountId: 'acc_123',
        recipientE164: '+5511988887777',
        recipientParticipantId: '5511988887777@s.whatsapp.net',
        dispatchKind: 'proactive_template',
        templateName: 'service_reminder',
        templateLanguage: 'pt_BR',
        templateParams: { name: 'João' },
        requestFingerprint: crypto.createHash('sha256').update(dispatchId).digest('hex'),
        providerIdempotencyKey: idempotencyKey,
      });
      return record;
    }

    it('allows send execution for healthy Premium organization and transitions phase to request_started', async () => {
      const orgId = uniqueId('org_d6_healthy');
      const minId = uniqueId('min_d6_healthy');

      await setupTestOrganization({ orgId, anchorMinistryId: minId, planId: 'premium' });
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Active Sender',
        status: 'connected',
        provider: 'zernio',
        created_by_user_id: 'u1',
      });

      const dispatch = await createPreparedDispatch(orgId, conn.id);
      expect(dispatch.phase).toBe('prepared');

      const lease = await dispatchRepo.acquireDispatchExecution({
        dispatchId: dispatch.id,
        connectionId: conn.id,
        organizationId: orgId,
        requestFingerprint: dispatch.request_fingerprint,
        leaseDurationMs: 30000,
      });

      expect(lease.outcome).toBe('acquired');
      expect(lease.record.phase).toBe('request_started');

      const updated = await dispatchRepo.getDispatchById(dispatch.id);
      expect(updated?.phase).toBe('request_started');
    });

    it('rejects send execution with 403 for Free plan and rolls back transaction (dispatch stays prepared)', async () => {
      const orgId = uniqueId('org_d6_free');
      const minId = uniqueId('min_d6_free');

      await setupTestOrganization({ orgId, anchorMinistryId: minId, planId: 'free' });
      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Free Sender',
        status: 'connected',
        provider: 'zernio',
        created_by_user_id: 'u1',
      });

      const dispatch = await createPreparedDispatch(orgId, conn.id);

      await expect(
        dispatchRepo.acquireDispatchExecution({
          dispatchId: dispatch.id,
          connectionId: conn.id,
          organizationId: orgId,
          requestFingerprint: dispatch.request_fingerprint,
          leaseDurationMs: 30000,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'PLAN_EXCLUDED' },
      });

      const unchanged = await dispatchRepo.getDispatchById(dispatch.id);
      expect(unchanged?.phase).toBe('prepared');
    });

    it('rejects send execution with 403 for post-grace past_due subscription', async () => {
      const orgId = uniqueId('org_d6_past_grace');
      const minId = uniqueId('min_d6_past_grace');

      const pastGraceDate = getBillingDate(new Date(Date.now() - 3 * 24 * 3600 * 1000));
      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        planId: 'premium',
        billingStatus: 'past_due',
        graceDate: pastGraceDate,
      });

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Overdue Sender',
        status: 'connected',
        provider: 'zernio',
        created_by_user_id: 'u1',
      });

      const dispatch = await createPreparedDispatch(orgId, conn.id);

      await expect(
        dispatchRepo.acquireDispatchExecution({
          dispatchId: dispatch.id,
          connectionId: conn.id,
          organizationId: orgId,
          requestFingerprint: dispatch.request_fingerprint,
          leaseDurationMs: 30000,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'SUBSCRIPTION_PAST_DUE' },
      });

      const unchanged = await dispatchRepo.getDispatchById(dispatch.id);
      expect(unchanged?.phase).toBe('prepared');
    });

    it('rejects send execution with 403 for administratively suspended subscription', async () => {
      const orgId = uniqueId('org_d6_admin_susp');
      const minId = uniqueId('min_d6_admin_susp');

      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        planId: 'premium',
        administrativelySuspended: true,
      });

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Suspended Sender',
        status: 'connected',
        provider: 'zernio',
        created_by_user_id: 'u1',
      });

      const dispatch = await createPreparedDispatch(orgId, conn.id);

      await expect(
        dispatchRepo.acquireDispatchExecution({
          dispatchId: dispatch.id,
          connectionId: conn.id,
          organizationId: orgId,
          requestFingerprint: dispatch.request_fingerprint,
          leaseDurationMs: 30000,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'ADMINISTRATIVELY_SUSPENDED' },
      });

      const unchanged = await dispatchRepo.getDispatchById(dispatch.id);
      expect(unchanged?.phase).toBe('prepared');
    });

    it('allows send execution during active payment grace period', async () => {
      const orgId = uniqueId('org_d6_grace');
      const minId = uniqueId('min_d6_grace');

      const futureGraceDate = getBillingDate(new Date(Date.now() + 5 * 24 * 3600 * 1000));
      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        planId: 'premium',
        billingStatus: 'past_due',
        graceDate: futureGraceDate,
      });

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'Grace Sender',
        status: 'connected',
        provider: 'zernio',
        created_by_user_id: 'u1',
      });

      const dispatch = await createPreparedDispatch(orgId, conn.id);

      const lease = await dispatchRepo.acquireDispatchExecution({
        dispatchId: dispatch.id,
        connectionId: conn.id,
        organizationId: orgId,
        requestFingerprint: dispatch.request_fingerprint,
        leaseDurationMs: 30000,
      });

      expect(lease.outcome).toBe('acquired');
      expect(lease.record.phase).toBe('request_started');
    });

    it('rejects send execution with 403 COMMERCIAL_INTEGRITY_VIOLATION when anchor ministry organization diverges', async () => {
      const orgId = uniqueId('org_d6_idor');
      const attackerOrgId = uniqueId('org_d6_attacker');
      const minId = uniqueId('min_d6_idor');

      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        mismatchedAnchorOrgId: attackerOrgId,
      });

      const conn = await connectionRepo.createConnection({
        organization_id: orgId,
        display_name: 'IDOR Sender',
        status: 'connected',
        provider: 'zernio',
        created_by_user_id: 'u1',
      });

      const dispatch = await createPreparedDispatch(orgId, conn.id);

      await expect(
        dispatchRepo.acquireDispatchExecution({
          dispatchId: dispatch.id,
          connectionId: conn.id,
          organizationId: orgId,
          requestFingerprint: dispatch.request_fingerprint,
          leaseDurationMs: 30000,
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        details: { code: 'COMMERCIAL_INTEGRITY_VIOLATION' },
      });
    });
  });

  // ============================================================================
  // 5. OUTBOUND SERVICE SENDER RESOLUTION GATING (Scenarios 79-82)
  // ============================================================================
  describe('5. WhatsAppOutboundService Sender Resolution Admission Gating', () => {
    it('rejects message send with 400 when organization has commercial suspension or over limit', async () => {
      const orgId = uniqueId('org_outbound_gate');
      const minId = uniqueId('min_outbound_gate');
      const connId = uniqueId('conn_outbound_gate');

      await setupTestOrganization({
        orgId,
        anchorMinistryId: minId,
        planId: 'free',
      });

      const outboundService = new WhatsAppOutboundService();

      await expect(
        outboundService.resolveSenderConnection({
          organizationId: orgId,
          connectionId: connId,
        })
      ).rejects.toMatchObject({
        statusCode: 400,
      });
    });
  });
});

