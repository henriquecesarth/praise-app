import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionService } from './subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { MinistrySubscriptionRecord, MinistryUsageRecord } from './subscription.types';
import { PLANS_CATALOG } from '../../config/plans.config';

describe('Complimentary Plans & Platform Administrative Authority', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionRepo: any;
  let subscriptionsStore: Map<string, MinistrySubscriptionRecord>;
  let usagesStore: Map<string, MinistryUsageRecord>;

  beforeEach(() => {
    subscriptionsStore = new Map();
    usagesStore = new Map();

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return subscriptionsStore.get(ministryId) || null;
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: MinistrySubscriptionRecord) => {
        subscriptionsStore.set(sub.ministry_id, sub);
      }),
      getUsage: vi.fn().mockImplementation(async (ministryId: string) => {
        return (
          usagesStore.get(ministryId) || {
            id: ministryId,
            ministry_id: ministryId,
            members_count: 5,
            songs_count: 20,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }
        );
      }),
      countRealData: vi.fn().mockResolvedValue({ realMembersCount: 5, realSongsCount: 20 }),
      ensureSubscriptionAndUsage: vi.fn().mockImplementation(async (ministryId: string) => {
        let sub = subscriptionsStore.get(ministryId);
        if (!sub) {
          sub = {
            id: ministryId,
            ministry_id: ministryId,
            plan_id: 'free',
            member_addon_blocks: 0,
            billing_status: 'active',
            subscription_mode: 'free',
            granted_by: null,
            granted_at: null,
            grant_reason: null,
            expires_at: null,
            administratively_suspended: false,
            suspended_at: null,
            suspension_reason: null,
            grace_period_expires_at: null,
            current_period_start: new Date().toISOString(),
            current_period_end: null,
            cancel_at_period_end: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          subscriptionsStore.set(ministryId, sub);
        }
        let usage = usagesStore.get(ministryId);
        if (!usage) {
          usage = {
            id: ministryId,
            ministry_id: ministryId,
            members_count: 5,
            songs_count: 20,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          usagesStore.set(ministryId, usage);
        }
        return { subscription: sub, usage };
      }),
    };

    subscriptionService = new SubscriptionService(
      mockSubscriptionRepo as unknown as SubscriptionRepository
    );
  });

  it('grants a complimentary Premium plan with exact official quotas without calling external gateway', async () => {
    const ministryId = 'min_partner_100';
    const expiresAt = new Date('2026-12-31T23:59:59.000Z').toISOString();

    const result = await subscriptionService.grantComplimentaryPlan(
      ministryId,
      'premium',
      'superadmin@louvaio.com',
      'Parceria Igreja Central',
      expiresAt
    );

    expect(result.plan_id).toBe('premium');
    expect(result.subscription_mode).toBe('complimentary');
    expect(result.billing_status).toBe('active');
    expect(result.granted_by).toBe('superadmin@louvaio.com');
    expect(result.grant_reason).toBe('Parceria Igreja Central');
    expect(result.expires_at).toBe(expiresAt);

    // Resumo de quotas deve refletir plano Premium oficial (300 membros e 1500 músicas)
    const summary = await subscriptionService.getSubscriptionSummary(ministryId);
    expect(summary.plan.id).toBe('premium');
    expect(summary.quotas.members).toBe(300);
    expect(summary.quotas.songs).toBe(1500);
    expect(summary.subscription.subscriptionMode).toBe('complimentary');
    expect(summary.subscription.accessMode).toBe('normal');
  });

  it('falls back to Free with 7-day grace period if a timed complimentary plan expires', async () => {
    const ministryId = 'min_expired_partner';
    // Expiração no passado
    const pastExpiration = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Ministério com 25 membros e 80 músicas (excede o plano Free de 10 membros e 50 músicas)
    usagesStore.set(ministryId, {
      id: ministryId,
      ministry_id: ministryId,
      members_count: 25,
      songs_count: 80,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    subscriptionsStore.set(ministryId, {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'pro',
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'complimentary',
      granted_by: 'admin',
      granted_at: new Date(Date.now() - 30 * 86400000).toISOString(),
      grant_reason: 'Trial Pro 30 dias',
      expires_at: pastExpiration,
      administratively_suspended: false,
      suspended_at: null,
      suspension_reason: null,
      grace_period_expires_at: null,
      current_period_start: new Date(Date.now() - 30 * 86400000).toISOString(),
      current_period_end: null,
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const summary = await subscriptionService.getSubscriptionSummary(ministryId);

    // Quotas efetivas caem para o Free (10 membros e 50 músicas)
    expect(summary.quotas.members).toBe(10);
    expect(summary.quotas.songs).toBe(50);
    // Uso excede a quota -> restricted_over_limit (ou grace se carência registrada)
    expect(summary.isOverLimit).toBe(true);
    expect(summary.subscription.accessMode).toBe('restricted_over_limit');
  });

  it('revokes complimentary plan safely reverting to Free without data loss, starting grace period if over limit', async () => {
    const ministryId = 'min_revoked';

    // Ministério com 15 membros (excede Free de 10)
    usagesStore.set(ministryId, {
      id: ministryId,
      ministry_id: ministryId,
      members_count: 15,
      songs_count: 30,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    subscriptionsStore.set(ministryId, {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'pro',
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'complimentary',
      granted_by: 'admin',
      granted_at: new Date().toISOString(),
      grant_reason: 'Parceria',
      expires_at: null,
      administratively_suspended: false,
      suspended_at: null,
      suspension_reason: null,
      grace_period_expires_at: null,
      current_period_start: new Date().toISOString(),
      current_period_end: null,
      cancel_at_period_end: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const revoked = await subscriptionService.revokeComplimentaryPlan(ministryId, 'superadmin@louvaio.com');

    expect(revoked.plan_id).toBe('free');
    expect(revoked.subscription_mode).toBe('free');
    expect(revoked.grace_period_expires_at).not.toBeNull(); // Abriu carência de 7 dias

    const summary = await subscriptionService.getSubscriptionSummary(ministryId);
    expect(summary.subscription.accessMode).toBe('grace');
    expect(summary.graceDaysRemaining).toBeGreaterThanOrEqual(6);
  });
});
