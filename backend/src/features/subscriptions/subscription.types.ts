import {
  PlanId,
  BillingStatus,
  AccessMode,
  QuotaLimit,
  PlanDefinition,
  EffectiveQuotas,
} from '../../config/plans.config';

export interface MinistrySubscriptionRecord {
  id: string; // ministry_id
  ministry_id: string;
  plan_id: PlanId;
  member_addon_blocks: number;
  billing_status: BillingStatus;
  administratively_suspended: boolean;
  suspended_at: string | null;
  suspension_reason: string | null;
  grace_period_expires_at: string | null;
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface MinistryUsageRecord {
  id: string; // ministry_id
  ministry_id: string;
  members_count: number;
  songs_count: number;
  created_at: string;
  updated_at: string;
}

export interface MinistrySubscriptionStatusSummary {
  plan: PlanDefinition;
  subscription: {
    planId: PlanId;
    memberAddonBlocks: number;
    billingStatus: BillingStatus;
    administrativelySuspended: boolean;
    suspendedAt: string | null;
    suspensionReason: string | null;
    accessMode: AccessMode;
    gracePeriodExpiresAt: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  };
  quotas: EffectiveQuotas;
  usage: {
    membersCount: number;
    songsCount: number;
  };
  isOverLimit: boolean;
  overLimitDetails: {
    membersOver: boolean;
    songsOver: boolean;
  };
  graceDaysRemaining: number | null;
}
