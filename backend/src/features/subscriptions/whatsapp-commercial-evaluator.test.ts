import { describe, it, expect } from 'vitest';
import {
  evaluateWhatsAppCommercialEntitlement,
  consumesCommercialCapacity,
  verifyServerOwnedStagedReservation,
  verifyServerOwnedAdmission,
  WhatsAppCommercialFacts,
} from './whatsapp-commercial-evaluator';
import { OrganizationRecord } from '../organizations/organization.types';
import { MinistrySubscriptionRecord } from './subscription.types';
import {
  WhatsAppConnectionRecord,
  WhatsAppOnboardingSessionRecord,
} from '../whatsapp/whatsapp.types';

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

  // --- Integrity Failure (Scenarios 1-4 & Phase 7D2-D8-R3 Requirements) ---
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

    it('Scenario 2: Organization missing billing anchor ID -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: { ...validOrg, billing_anchor_ministry_id: '' },
        anchorMinistry: validAnchorMinistry,
        subscription: premiumSub,
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 3: Anchor ministry is null/undefined -> integrity_failure', () => {
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

    it('Scenario 4: Anchor ministry belongs to different organization -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: { id: anchorMinId, organization_id: 'other-org' },
        subscription: premiumSub,
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 4b: Anchor ministry ID does not match org.billing_anchor_ministry_id -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: { id: 'wrong-min-id', organization_id: orgId },
        subscription: premiumSub,
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 4c: Subscription is absent (null/undefined) -> integrity_failure (BLOCKER 2)', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: null,
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(false);
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 4d: Subscription ministry_id does not match anchor ministry -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: { ...premiumSub, ministry_id: 'other-min' },
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 4e: Subscription with missing or empty plan_id -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: { ...premiumSub, plan_id: '' as any },
        now: baseNow,
      });

      expect(res.state).toBe('integrity_failure');
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 4f: Subscription with missing or empty billing_status -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: { ...premiumSub, billing_status: '' as any },
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
    it('Scenario 6: Valid Free plan subscription -> plan_excluded', () => {
      const freeSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        plan_id: 'free',
        subscription_mode: 'free',
        billing_status: 'active',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: freeSub,
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

    it('Scenario 13: Premium subscription with cancel_at_period_end and past current_period_end does NOT independently cut over to Free in D8', () => {
      const cancelSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        cancel_at_period_end: true,
        current_period_end: '2026-09-10T00:00:00.000Z',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: cancelSub,
        now: new Date('2026-09-15T00:00:00.000Z'),
      });

      // Retains Premium entitlement until Billing V1 reconciler completes cutover
      expect(res.state).toBe('healthy');
      expect(res.allowedConnections).toBe(1);
    });

    it('Scenario 14: Premium subscription with past expires_at does NOT independently cut over to Free in D8', () => {
      const compSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        subscription_mode: 'complimentary',
        expires_at: '2026-09-10T00:00:00.000Z',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: compSub,
        now: new Date('2026-09-15T00:00:00.000Z'),
      });

      // Retains Premium entitlement until Billing/complimentary service updates effective subscription projection
      expect(res.state).toBe('healthy');
      expect(res.allowedConnections).toBe(1);
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

    it('Scenario 19a: Past due with missing grace authority (null/undefined) -> integrity_failure (test 13)', () => {
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

      expect(res.state).toBe('integrity_failure');
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
      expect(res.canResumeAuthorizedOnboarding).toBe(false);
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
    });

    it('Scenario 19b: Past due with malformed grace string (test 9) -> integrity_failure', () => {
      for (const badStr of ['2026-9-8', 'garbage', '', '2026-09']) {
        const res = evaluateWhatsAppCommercialEntitlement({
          organization: validOrg,
          anchorMinistry: validAnchorMinistry,
          subscription: { ...premiumSub, billing_status: 'past_due', grace_period_expires_billing_date: badStr },
          now: baseNow,
        });
        expect(res.state).toBe('integrity_failure');
        expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
      }
    });

    it('Scenario 19c: Past due with impossible calendar date (test 10) -> integrity_failure', () => {
      for (const badDate of ['2026-09-31', '2026-13-01', '2025-02-29', '2026-00-10', '2026-04-31']) {
        const res = evaluateWhatsAppCommercialEntitlement({
          organization: validOrg,
          anchorMinistry: validAnchorMinistry,
          subscription: { ...premiumSub, billing_status: 'past_due', grace_period_expires_billing_date: badDate },
          now: baseNow,
        });
        expect(res.state).toBe('integrity_failure');
        expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
      }
    });

    it('Scenario 19d: Past due with whitespace grace string (test 11) -> integrity_failure', () => {
      for (const badWhitespace of ['   ', ' 2026-09-20 ', '2026-09-20 ']) {
        const res = evaluateWhatsAppCommercialEntitlement({
          organization: validOrg,
          anchorMinistry: validAnchorMinistry,
          subscription: { ...premiumSub, billing_status: 'past_due', grace_period_expires_billing_date: badWhitespace },
          now: baseNow,
        });
        expect(res.state).toBe('integrity_failure');
        expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
      }
    });

    it('Scenario 19e: Past due with wrong runtime type (test 12) -> integrity_failure', () => {
      for (const badType of [12345, true, {}, []]) {
        const res = evaluateWhatsAppCommercialEntitlement({
          organization: validOrg,
          anchorMinistry: validAnchorMinistry,
          subscription: { ...premiumSub, billing_status: 'past_due', grace_period_expires_billing_date: badType as any },
          now: baseNow,
        });
        expect(res.state).toBe('integrity_failure');
        expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
      }
    });

    it('Scenario 19f: Past due with timestamp format instead of civil date -> integrity_failure', () => {
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: { ...premiumSub, billing_status: 'past_due', grace_period_expires_billing_date: '2026-09-20T12:00:00.000Z' },
        now: baseNow,
      });
      expect(res.state).toBe('integrity_failure');
      expect(res.restrictionReason).toBe('COMMERCIAL_INTEGRITY_VIOLATION');
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

      // Undefined expiration -> fails closed, consumes
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: undefined as any },
          now
        )
      ).toBe(true);

      // Empty string / whitespace expiration -> fails closed, consumes
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: '' },
          now
        )
      ).toBe(true);
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: '   ' },
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

      // Non-string runtime types -> fails closed, consumes
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: 1726660800000 as any },
          now
        )
      ).toBe(true);
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: true as any },
          now
        )
      ).toBe(true);
      expect(
        consumesCommercialCapacity(
          { status: 'pending', pending_expires_at: {} as any },
          now
        )
      ).toBe(true);

      // Unknown status -> fails closed, consumes
      expect(
        consumesCommercialCapacity(
          { status: 'unknown_status' as any, pending_expires_at: null },
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

  // --- 11-Point Durable Reservation Proof Suite (Phase 7D2-D8-R1) ---
  describe('verifyServerOwnedAdmission — 11-Point Durable Proof', () => {
    const validSessionId = 'wabs-valid-1';
    const baseConnWithSession: WhatsAppConnectionRecord = {
      id: 'wac-test-11',
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
      current_onboarding_session_id: validSessionId,
      pending_expires_at: '2026-09-16T12:00:00.000Z',
      last_connected_at: null,
      last_health_check_at: null,
      created_at: '2026-09-15T12:00:00.000Z',
      updated_at: '2026-09-15T12:00:00.000Z',
    };

    const validSession: WhatsAppOnboardingSessionRecord = {
      id: validSessionId,
      organization_id: orgId,
      connection_id: 'wac-test-11',
      actor_user_id: 'user-1',
      state_nonce_hash: 'hash-1',
      status: 'active',
      provider_progress: 'none',
      expires_at: '2026-09-15T13:00:00.000Z',
      retention_expires_at: '2026-10-15T12:00:00.000Z',
      consumed_at: null,
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

    it('Scenario 29a: Valid 11-point proof with linked session passes verification', () => {
      const result = verifyServerOwnedAdmission({
        conn: baseConnWithSession,
        session: validSession,
        organizationId: orgId,
        entitlement: healthyEntitlement,
        now: baseNow,
      });

      expect(result.valid).toBe(true);
    });

    it('Scenario 29b: In-flight connecting status reservation passes verification', () => {
      const result = verifyServerOwnedAdmission({
        conn: { ...baseConnWithSession, status: 'connecting' },
        session: validSession,
        organizationId: orgId,
        entitlement: healthyEntitlement,
        now: baseNow,
      });

      expect(result.valid).toBe(true);
    });

    it('Scenario 29c: Status not pending and not connecting (e.g. error) throws 400', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: { ...baseConnWithSession, status: 'error' },
          session: validSession,
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/INVALID_CONNECTION_STATUS/);
    });

    it('Scenario 29d: Missing pending_expires_at throws 410', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: { ...baseConnWithSession, pending_expires_at: null },
          session: validSession,
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/CONNECTION_RESERVATION_EXPIRED/);
    });

    it('Scenario 29e: Empty string pending_expires_at throws 410', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: { ...baseConnWithSession, pending_expires_at: '   ' },
          session: validSession,
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/CONNECTION_RESERVATION_EXPIRED/);
    });

    it('Scenario 29f: Unparseable pending_expires_at throws 410', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: { ...baseConnWithSession, pending_expires_at: 'invalid-date' },
          session: validSession,
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/CONNECTION_RESERVATION_EXPIRED/);
    });

    it('Scenario 29g: Session provided but conn.current_onboarding_session_id missing throws 400', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: { ...baseConnWithSession, current_onboarding_session_id: null },
          session: validSession,
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/INVALID_ONBOARDING_SESSION/);
    });

    it('Scenario 29h: Linked session not found (session is null) throws 404', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: baseConnWithSession,
          session: null,
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/SESSION_NOT_FOUND/);
    });

    it('Scenario 29i: Session ID mismatch throws 409', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: baseConnWithSession,
          session: { ...validSession, id: 'wabs-mismatched-id' },
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/SESSION_MISMATCH/);
    });

    it('Scenario 29j: Connection ID mismatch in session throws 409', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: baseConnWithSession,
          session: { ...validSession, connection_id: 'wac-other-conn' },
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/SESSION_MISMATCH/);
    });

    it('Scenario 29k: Organization ID mismatch in session throws 404', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: baseConnWithSession,
          session: { ...validSession, organization_id: 'other-org' },
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/SESSION_NOT_FOUND/);
    });

    it('Scenario 29l: Session status consumed throws 410', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: baseConnWithSession,
          session: { ...validSession, status: 'consumed' },
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/SESSION_EXPIRED/);
    });

    it('Scenario 29m: Session status failed throws 410', () => {
      expect(() =>
        verifyServerOwnedAdmission({
          conn: baseConnWithSession,
          session: { ...validSession, status: 'failed' },
          organizationId: orgId,
          entitlement: healthyEntitlement,
          now: baseNow,
        })
      ).toThrowError(/SESSION_EXPIRED/);
    });

    it('Scenario 29n: Resumption under payment_grace succeeds when valid reservation is held', () => {
      const graceEntitlement = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: {
          ...premiumSub,
          billing_status: 'past_due',
          grace_period_expires_billing_date: '2026-09-22',
        },
        consumingConnectionsCount: 1,
        now: baseNow,
      });

      expect(graceEntitlement.state).toBe('payment_grace');
      expect(graceEntitlement.canCreateConnection).toBe(false);
      expect(graceEntitlement.canResumeAuthorizedOnboarding).toBe(true);

      const result = verifyServerOwnedAdmission({
        conn: baseConnWithSession,
        session: validSession,
        organizationId: orgId,
        entitlement: graceEntitlement,
        now: baseNow,
      });

      expect(result.valid).toBe(true);
    });
  });

  // ============================================================================
  // SCHEDULED TRANSITIONS & EXACT CIVIL BOUNDARY HARDENING (Phase 7D2-D8-R3)
  // ============================================================================
  describe('Scheduled Transitions & Exact Civil Boundary (Phase 7D2-D8-R3)', () => {
    it('test 7 & 8: Exact civil grace boundary in America/Sao_Paulo', () => {
      const graceSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        billing_status: 'past_due',
        grace_period_expires_billing_date: '2026-09-20',
      };

      // 2026-09-19T23:59:59.999-03:00 -> 2026-09-20T02:59:59.999Z in UTC
      const lastInstantBeforeExpiry = new Date('2026-09-20T02:59:59.999Z');
      const resBefore = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: graceSub,
        consumingConnectionsCount: 1,
        now: lastInstantBeforeExpiry,
      });
      expect(resBefore.state).toBe('payment_grace');
      expect(resBefore.canSendMessages).toBe(true);

      // 2026-09-20T00:00:00.000-03:00 -> 2026-09-20T03:00:00.000Z in UTC (exact boundary)
      const exactExpiryBoundary = new Date('2026-09-20T03:00:00.000Z');
      const resAtBoundary = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: graceSub,
        consumingConnectionsCount: 1,
        now: exactExpiryBoundary,
      });
      expect(resAtBoundary.state).toBe('post_payment_grace');
      expect(resAtBoundary.canSendMessages).toBe(false);
    });

    it('test 18: Premium effective subscription with future scheduled cancel/downgrade remains Premium-entitled', () => {
      const scheduledSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        cancel_at_period_end: true,
        active_cancellation_transition_id: 'trans_v1_cancel_123',
        current_period_end: '2026-10-01T00:00:00.000Z',
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: scheduledSub,
        now: new Date('2026-09-20T12:00:00.000Z'),
      });

      expect(res.state).toBe('healthy');
      expect(res.allowedConnections).toBe(1);
      expect(res.canSendMessages).toBe(true);
      expect(res.canCreateConnection).toBe(true);
    });

    it('test 19: current_period_end passes but Billing V1 has not yet converged -> D8 does NOT cut over independently', () => {
      const unconvergedSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        cancel_at_period_end: true,
        active_cancellation_transition_id: 'trans_v1_cancel_123',
        current_period_end: '2026-09-15T00:00:00.000Z',
      };

      // Evaluated at a time AFTER current_period_end
      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: unconvergedSub,
        now: new Date('2026-09-18T12:00:00.000Z'),
      });

      // Retains Premium entitlement until Billing V1 reconciler completes cutover
      expect(res.state).toBe('healthy');
      expect(res.allowedConnections).toBe(1);
      expect(res.canSendMessages).toBe(true);
    });

    it('test 20: Billing V1 projected downgrade converges to Free -> D8 reflects that state (plan_excluded)', () => {
      const convergedFreeSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        plan_id: 'free',
        subscription_mode: 'free',
        cancel_at_period_end: false,
        active_cancellation_transition_id: null,
        current_period_end: null,
      };

      const res = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: convergedFreeSub,
        now: new Date('2026-09-18T12:00:00.000Z'),
      });

      expect(res.state).toBe('plan_excluded');
      expect(res.allowedConnections).toBe(0);
      expect(res.canSendMessages).toBe(false);
      expect(res.canCreateConnection).toBe(false);
    });

    it('test 21: Scheduled paid-to-paid downgrade follows projected effective plan, not target metadata or clock', () => {
      // Premium subscription with a scheduled downgrade to Essential
      const scheduledDowngradeSub: MinistrySubscriptionRecord = {
        ...premiumSub,
        cancel_at_period_end: false,
        current_period_end: '2026-09-15T00:00:00.000Z',
      };

      // Before Billing V1 converges effective subscription, sub.plan_id is still premium
      const resBefore = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: scheduledDowngradeSub,
        now: new Date('2026-09-18T12:00:00.000Z'),
      });

      expect(resBefore.state).toBe('healthy');
      expect(resBefore.allowedConnections).toBe(1);

      // Once Billing V1 updates effective subscription projection to Essential (non-Premium)
      const convergedEssentialSub: MinistrySubscriptionRecord = {
        ...scheduledDowngradeSub,
        plan_id: 'essential',
      };

      const resAfter = evaluateWhatsAppCommercialEntitlement({
        organization: validOrg,
        anchorMinistry: validAnchorMinistry,
        subscription: convergedEssentialSub,
        now: new Date('2026-09-18T12:00:00.000Z'),
      });

      expect(resAfter.state).toBe('plan_excluded');
      expect(resAfter.allowedConnections).toBe(0);
    });
  });
});
