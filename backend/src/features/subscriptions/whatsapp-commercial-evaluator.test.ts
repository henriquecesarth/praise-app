import { describe, it, expect } from 'vitest';
import {
  evaluateWhatsAppCommercialEntitlement,
  consumesCommercialCapacity,
  verifyServerOwnedStagedReservation,
  WhatsAppCommercialFacts,
} from './whatsapp-commercial-evaluator';
import { OrganizationRecord } from '../organizations/organization.types';
import { MinistrySubscriptionRecord } from './subscription.types';
import { WhatsAppConnectionRecord } from '../whatsapp/whatsapp.types';

describe('evaluateWhatsAppCommercialEntitlement — Pure Evaluator Suite (Phase 7D2-D8)', () => {
  const orgId = 'org-entitlement-1';
  const anchorMinId = 'min-anchor-1';

  const validOrg: OrganizationRecord = {
    id: orgId,
    name: 'Igreja Central',
    slug: 'igreja-central',
    owner_user_id: 'user-1',
    billing_anchor_ministry_id: anchorMinId,
    default_whatsapp_connection_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const validAnchorMinistry = {
    id: anchorMinId,
    organization_id: orgId,
  };

  const premiumSub: MinistrySubscriptionRecord = {
    id: anchorMinId,
    ministry_id: anchorMinId,
    plan_id: 'premium',
    member_addon_blocks: 0,
    subscription_mode: 'paid',
    billing_status: 'active',
    administratively_suspended: false,
    suspended_at: null,
    suspension_reason: null,
    grace_period_expires_at: null,
    current_period_start: '2026-09-01T00:00:00.000Z',
    current_period_end: '2026-10-01T00:00:00.000Z',
    cancel_at_period_end: false,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const baseNow = new Date('2026-09-15T12:00:00.000Z');

  // --- Integrity Failure (Scenarios 1-4) ---
  describe('Integrity Failure Guards', () => {
    it('Scenario 1: Organization is null/undefined -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: null,
        anchorMinistry: validAnchorMinistry,
        subscription: premiumSub,
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(false);
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
      expect(res.allowedConnections).toBe(0);
    });

    it('Scenario 2: Anchor ministry is null/undefined -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: null,
        subscription: premiumSub,
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(false);
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 3: Anchor ministry belongs to different organization -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: { id: anchorMinId, organization_id: 'other-org' },
        subscription: premiumSub,
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 4: Anchor ministry ID does not match org.billing_anchor_ministry_id -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: { id: 'wrong-min-id', organization_id: orgId },
        subscription: premiumSub,
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });
  });

  // --- Administrative Suspension (Scenario 5) ---
  describe('Administrative Suspension', () => {
    it('Scenario 5: Administratively suspended subscription blocks all actions', () => {
      const suspendedSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        administratively_suspended: true,
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: suspendedSub,
        now: baseNow,
      });

      expect(res.state).toBe('administratively_suspended');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(false);
      expect(res.restrictionReason).toBe('ADMINISTRATIVELY_SUSPENDED');
    });
  });

  // --- Plan Exclusion (Scenarios 6-14) ---
  describe('Plan Exclusion (Quota = 0)', () => {
    it('Scenario 6: Missing subscription defaults to free -> plan_excluded', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: null,
        now: baseNow,
      });

      expect(res.state).toBe('plan_excluded');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(false);
      expect(res.allowedConnections).toBe(0);
      expect(res.restrictionReason).toBe('PLAN_EXCLUDED');
    });

    const nonPremiumPlans = ['free', 'lite', 'lite_plus', 'essential', 'pro'] as const;
    for (const [idx, planId] of nonPremiumPlans.entries()) {
      it(`Scenario ${7 + idx}: Plan ${planId} has quota 0 -> plan_excluded`, () => {
        const sub: MinistrySubscriptionRecord = {
          ...premiumSub,
          plan_id: planId,
        };

        const res = evaluateWhatsAppCommercialEntitlement({
          organization: validOrg,
          anchorMinistry: validAnchorMinistry,
          subscription: sub,
          now: baseNow,
        });

        expect(res.state).toBe('plan_excluded');
        expect(res.allowedConnections).toBe(0);
        expect(res.canSendMessages).toBe(false);
        expect(res.canCreateConnection).toBe(false);
        expect(res.restrictionReason).toBe('PLAN_EXCLUDED');
      });
    }

    it('Scenario 12: Unknown plan ID -> plan_excluded', () => {
      const sub: MinistrySubscriptionRecord = {
        ...premiumSub,
        plan_id: 'enterprise_ultra' as any,
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: sub,
        now: baseNow,
      });

      expect(res.state).toBe('plan_excluded');
      expect(res.allowedConnections).toBe(0);
    });

    it('Scenario 13: Legacy cancellation period expired on Premium -> reverts to free -> plan_excluded', () => {
      const expiredCancelSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        cancel_at_period_end: true,
        current_period_end: '2026-09-10T00:00:00.000Z',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: expiredCancelSub,
        now: new Date('2026-09-15T00:00:00.000Z'),
      });

      expect(res.state).toBe('plan_excluded');
      expect(res.allowedConnections).toBe(0);
    });

    it('Scenario 14: Expired complimentary grant on Premium -> reverts to free -> plan_excluded', () => {
      const expiredCompSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        subscription_mode: 'complimentary',
        expires_at: '2026-09-10T00:00:00.000Z',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: expiredCompSub,
        now: new Date('2026-09-15T00:00:00.000Z'),
      });

      expect(res.state).toBe('plan_excluded');
      expect(res.allowedConnections).toBe(0);
    });
  });

  // --- Payment Grace Period (Scenarios 15-20) ---
  describe('Payment Grace Period & Post-Grace Cutoff', () => {
    // Current commercial date: 2026-09-15
    // Grace period expires billing date: 2026-09-20 (end of grace)
    const graceSub: MinistrySubscriptionRecord = {
      ...premiumSub,
      billing_status: 'past_due',
      grace_period_expires_billing_date: '2026-09-20',
      grace_period_expires_at: '2026-09-20T03:00:00.000Z',
    };

    it('Scenario 15: Within payment grace [start, end) -> payment_grace (canSend=true, canCreate=false, canResume=true)', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: graceSub,
        consumingConnectionsCount: 1,
        now: new Date('2026-09-16T12:00:00.000Z'), // 2026-09-16 < 2026-09-20
      });

      expect(res.state).toBe('payment_grace');
      expect(res.canSendMessages).toBe(true);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(true);
      expect(res.allowedConnections).toBe(1);
      expect(res.consumingConnections).toBe(1);
      expect(res.availableSlots).toBe(0);
    });

    it('Scenario 16: Last day before grace expiration -> payment_grace', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: graceSub,
        consumingConnectionsCount: 0,
        now: new Date('2026-09-19T23:00:00.000Z'), // America/Sao_Paulo 2026-09-19 < 2026-09-20
      });

      expect(res.state).toBe('payment_grace');
      expect(res.canSendMessages).toBe(true);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(true);
    });

    it('Scenario 17: On exact cutoff commercial date -> post_payment_grace (canSend=false)', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: graceSub,
        consumingConnectionsCount: 1,
        now: new Date('2026-09-20T12:00:00.000Z'), // 2026-09-20 == 2026-09-20 (grace expired)
      });

      expect(res.state).toBe('post_payment_grace');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(false);
      expect(res.restrictionReason).toBe('SUBSCRIPTION_PAST_DUE');
    });

    it('Scenario 18: After grace cutoff date -> post_payment_grace', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: graceSub,
        consumingConnectionsCount: 1,
        now: new Date('2026-09-22T12:00:00.000Z'),
      });

      expect(res.state).toBe('post_payment_grace');
      expect(res.canSendMessages).toBe(false);
    });

    it('Scenario 19: Past due without grace dates -> post_payment_grace', () => {
      const noGraceSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        billing_status: 'past_due',
        grace_period_expires_billing_date: undefined,
        grace_period_expires_at: null,
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: noGraceSub,
        consumingConnectionsCount: 1,
        now: baseNow,
      });

      expect(res.state).toBe('post_payment_grace');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
    });

    it('Scenario 20: Inactive status (unpaid or canceled) -> post_payment_grace', () => {
      const unpaidSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        billing_status: 'canceled',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: unpaidSub,
        now: baseNow,
      });

      expect(res.state).toBe('post_payment_grace');
      expect(res.canSendMessages).toBe(false);
    });
  });

  // --- Healthy vs Restricted Over Limit (Scenarios 21-25) ---
  describe('Healthy vs Restricted Over Limit', () => {
    it('Scenario 21: Premium active, 0 consuming connections -> healthy (canSend=true, canCreate=true, slots=1)', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: premiumSub,
        consumingConnectionsCount: 0,
        now: baseNow,
      });

      expect(res.state).toBe('healthy');
      expect(res.canSendMessages).toBe(true);
      expect(res.canCreateConnection).toBe(true);
      expect(res.canResumeAuthorizedOnboarding).toBe(true);
      expect(res.allowedConnections).toBe(1);
      expect(res.consumingConnections).toBe(0);
      expect(res.availableSlots).toBe(1);
      expect(res.restrictionReason).toBeUndefined();
    });

    it('Scenario 22: Premium active, 1 consuming connection -> healthy (canSend=true, canCreate=false, slots=0)', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: premiumSub,
        consumingConnectionsCount: 1,
        now: baseNow,
      });

      expect(res.state).toBe('healthy');
      expect(res.canSendMessages).toBe(true);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(true);
      expect(res.allowedConnections).toBe(1);
      expect(res.consumingConnections).toBe(1);
      expect(res.availableSlots).toBe(0);
      expect(res.restrictionReason).toBe('CAPACITY_LIMIT_REACHED');
    });

    it('Scenario 23: Premium active, 2 consuming connections -> restricted_over_limit (canSend=false, canCreate=false)', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: premiumSub,
        consumingConnectionsCount: 2,
        now: baseNow,
      });

      expect(res.state).toBe('restricted_over_limit');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(false);
      expect(res.allowedConnections).toBe(1);
      expect(res.consumingConnections).toBe(2);
      expect(res.availableSlots).toBe(0);
      expect(res.restrictionReason).toBe('RESTRICTED_OVER_LIMIT');
    });

    it('Scenario 24: Premium past_due in grace, 2 consuming connections -> restricted_over_limit takes precedence', () => {
      const graceSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        billing_status: 'past_due',
        grace_period_expires_billing_date: '2026-09-20',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: graceSub,
        consumingConnectionsCount: 2,
        now: new Date('2026-09-16T00:00:00.000Z'),
      });

      expect(res.state).toBe('restricted_over_limit');
      expect(res.canSendMessages).toBe(false);
      expect(res.restrictionReason).toBe('RESTRICTED_OVER_LIMIT');
    });

    it('Scenario 25: Complimentary active Premium plan -> healthy', () => {
      const compSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        subscription_mode: 'complimentary',
        expires_at: '2026-12-31T00:00:00.000Z',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: compSub,
        consumingConnectionsCount: 0,
        now: baseNow,
      });

      expect(res.state).toBe('healthy');
      expect(res.canSendMessages).toBe(true);
      expect(res.canCreateConnection).toBe(true);
      expect(res.allowedConnections).toBe(1);
    });
  });

  // --- Consumes Commercial Capacity Predicate (Scenarios 26-27) ---
  describe('consumesCommercialCapacity Predicate', () => {
    it('Scenario 26: Consuming and non-consuming lifecycle statuses', () => {
      const now = new Date('2026-09-15T12:00:00.000Z');

      expect(consumesCommercialCapacity({ status: 'connecting', pending_expires_at: null }, now)).toBe(true);
      expect(consumesCommercialCapacity({ status: 'connected', pending_expires_at: null }, now)).toBe(true);
      expect(consumesCommercialCapacity({ status: 'error', pending_expires_at: null }, now)).toBe(true);
      expect(consumesCommercialCapacity({ status: 'disabled_by_user', pending_expires_at: null }, now)).toBe(true);
      expect(consumesCommercialCapacity({ status: 'disconnected', pending_expires_at: null }, now)).toBe(false);
      expect(consumesCommercialCapacity(null as any, now)).toBe(false);
    });

    it('Scenario 27: Pending reservation TTL evaluation and fail-closed edge cases', () => {
      const now = new Date('2026-09-15T12:00:00.000Z');

      // Future expiration -> active, consumes
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: '2026-09-15T14:00:00.000Z' },
          now
        )
      ).toBe(true);

      // Past expiration -> expired, does not consume
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: '2026-09-15T10:00:00.000Z' },
          now
        )
      ).toBe(false);

      // Exact expiration -> expired, does not consume
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: '2026-09-15T12:00:00.000Z' },
          now
        )
      ).toBe(false);

      // Missing / null expiration -> fails closed, consumes
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: null },
          now
        )
      ).toBe(true);

      // Malformed expiration string -> fails closed, consumes
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: 'invalid-date-string' },
          now
        )
      ).toBe(true);
    });
  });

  // --- Staged Reservation Verification (Scenario 28) ---
  describe('verifyServerOwnedStagedReservation', () => {
    const baseConn: WhatsAppConnectionRecord = {
      id: 'wac-test-1',
      organization_id: orgId,
      display_name: 'Main Line',
      phone_number: null,
      provider: 'meta_cloud_api',
      provider_waba_id: null,
      provider_phone_number_id: null,
      status: 'pending',
      status_reason: null,
      assigned_ministry_id: null,
      created_by_user_id: 'user-1',
      pending_expires_at: '2026-09-16T12:00:00.000Z',
      last_connected_at: null,
      last_health_check_at: null,
      created_at: '2026-09-15T12:00:00.000Z',
      updated_at: '2026-09-15T12:00:00.000Z',
    };

    const healthyEntitlement = evaluateWhatsAppCommercialEntitlement({
      organization: validOrg,
      anchorMinistry: validAnchorMinistry,
      subscription: premiumSub,
      consumingConnectionsCount: 1,
      now: baseNow,
    });

    it('Scenario 28a: Valid staged reservation passes verification', () => {
      const result = verifyServerOwnedStagedReservation({
        conn: baseConn,
        organizationId: orgId,
        entitlement: healthyEntitlement,
        now: baseNow,
      });

      expect(result.valid).toBe(true);
    });

    it('Scenario 28b: Organization mismatch throws 404', () => {
      expect(() =>
        verifyServerOwnedStagedReservation({
          conn: baseConn,
          organizationId: 'other-org',
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/CONNECTION_NOT_FOUND/);
    });

    it('Scenario 28c: Already connected throws 409', () => {
      expect(() =>
        verifyServerOwnedStagedReservation({
          conn: { ...baseConn, status: 'connected' },
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/CONNECTION_ALREADY_CONNECTED/);
    });

    it('Scenario 28d: Disconnected reservation throws 410', () => {
      expect(() =>
        verifyServerOwnedStagedReservation({
          conn: { ...baseConn, status: 'disconnected' },
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/CONNECTION_RESERVATION_EXPIRED/);
    });

    it('Scenario 28e: Expired pending reservation throws 410', () => {
      expect(() =>
        verifyServerOwnedStagedReservation({
          conn: { ...baseConn, pending_expires_at: '2026-09-14T00:00:00.000Z' },
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/Prazo de 24 horas da reserva expirado/);
    });

    it('Scenario 28f: Restricted commercial entitlement throws 403', () => {
      const restrictedEntitlement = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: { ...premiumSub, administratively_suspended: true },
        consumingConnectionsCount: 1,
        now: baseNow,
      });

      expect(() =>
        verifyServerOwnedStagedReservation({
          conn: baseConn,
          organizationId: orgId,
          entitlement: restrictedEntitlement,
          now: baseNow,
        })
      ).toThrowError(/WHATSAPP_RESTRICTED/);
    });
  });
});
