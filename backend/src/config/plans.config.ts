export type PlanId = 'free' | 'lite' | 'lite_plus' | 'essential' | 'pro' | 'premium';
export type QuotaLimit = number | 'unlimited';
export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled';
export type AccessMode = 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  baseMembers: QuotaLimit;
  baseSongs: QuotaLimit;
  allowMemberAddons: boolean;
  maxMemberAddonBlocks: number;
}

export interface EffectiveQuotas {
  members: QuotaLimit;
  songs: QuotaLimit;
}

export interface MinistryUsageData {
  members_count: number;
  songs_count: number;
}

export interface SubscriptionStateData {
  plan_id: PlanId;
  member_addon_blocks: number;
  billing_status: BillingStatus;
  administratively_suspended?: boolean;
  grace_period_expires_at?: string | null;
}

export const MEMBER_ADDON_BLOCK_SIZE = 10;
export const DEFAULT_GRACE_PERIOD_DAYS = 7;
export const DEFAULT_PLAN_ID: PlanId = 'free';

export const PLANS_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    baseMembers: 10,
    baseSongs: 50,
    allowMemberAddons: false,
    maxMemberAddonBlocks: 0,
  },
  lite: {
    id: 'lite',
    name: 'Lite',
    baseMembers: 20,
    baseSongs: 100,
    allowMemberAddons: false,
    maxMemberAddonBlocks: 0,
  },
  lite_plus: {
    id: 'lite_plus',
    name: 'Lite+',
    baseMembers: 30,
    baseSongs: 150,
    allowMemberAddons: false,
    maxMemberAddonBlocks: 0,
  },
  essential: {
    id: 'essential',
    name: 'Essential',
    baseMembers: 40,
    baseSongs: 200,
    allowMemberAddons: true,
    maxMemberAddonBlocks: 4, // Max 80 members (40 + 4*10)
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    baseMembers: 100,
    baseSongs: 500,
    allowMemberAddons: true,
    maxMemberAddonBlocks: 10, // Max 200 members (100 + 10*10)
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    baseMembers: 'unlimited',
    baseSongs: 'unlimited',
    allowMemberAddons: false,
    maxMemberAddonBlocks: 0,
  },
};

export function getPlanDefinition(planId: string): PlanDefinition {
  if (planId in PLANS_CATALOG) {
    return PLANS_CATALOG[planId as PlanId];
  }
  return PLANS_CATALOG[DEFAULT_PLAN_ID];
}

export function getEffectiveMemberQuota(plan: PlanDefinition, addonBlocks: number = 0): QuotaLimit {
  if (plan.baseMembers === 'unlimited') {
    return 'unlimited';
  }
  if (!plan.allowMemberAddons || plan.maxMemberAddonBlocks <= 0) {
    return plan.baseMembers;
  }
  const validBlocks = Math.min(Math.max(0, addonBlocks), plan.maxMemberAddonBlocks);
  return plan.baseMembers + validBlocks * MEMBER_ADDON_BLOCK_SIZE;
}

export function getEffectiveSongQuota(plan: PlanDefinition): QuotaLimit {
  return plan.baseSongs;
}

export function isUsageOverLimit(
  usage: MinistryUsageData,
  quotas: EffectiveQuotas
): { isOverLimit: boolean; membersOver: boolean; songsOver: boolean } {
  const membersOver = quotas.members !== 'unlimited' && usage.members_count > quotas.members;
  const songsOver = quotas.songs !== 'unlimited' && usage.songs_count > quotas.songs;
  return {
    isOverLimit: membersOver || songsOver,
    membersOver,
    songsOver,
  };
}

export function resolveAccessMode(
  subscription: SubscriptionStateData,
  plan: PlanDefinition,
  usage: MinistryUsageData,
  now: Date = new Date()
): {
  accessMode: AccessMode;
  isOverLimit: boolean;
  overLimitDetails: { membersOver: boolean; songsOver: boolean };
  graceDaysRemaining: number | null;
  effectiveQuotas: EffectiveQuotas;
} {
  const effectiveQuotas: EffectiveQuotas = {
    members: getEffectiveMemberQuota(plan, subscription.member_addon_blocks),
    songs: getEffectiveSongQuota(plan),
  };

  const overLimitInfo = isUsageOverLimit(usage, effectiveQuotas);

  // 1. Suspensão administrativa tem prioridade máxima
  if (subscription.administratively_suspended) {
    return {
      accessMode: 'suspended',
      isOverLimit: overLimitInfo.isOverLimit,
      overLimitDetails: overLimitInfo,
      graceDaysRemaining: null,
      effectiveQuotas,
    };
  }

  // 2. Se o uso está dentro das quotas, o acesso é normal
  if (!overLimitInfo.isOverLimit) {
    return {
      accessMode: 'normal',
      isOverLimit: false,
      overLimitDetails: overLimitInfo,
      graceDaysRemaining: null,
      effectiveQuotas,
    };
  }

  // 3. Uso excede a quota: avaliar carência explícita registrada
  if (subscription.grace_period_expires_at) {
    const expiresAt = new Date(subscription.grace_period_expires_at);
    if (!isNaN(expiresAt.getTime()) && now <= expiresAt) {
      const diffMs = expiresAt.getTime() - now.getTime();
      const graceDaysRemaining = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
      return {
        accessMode: 'grace',
        isOverLimit: true,
        overLimitDetails: overLimitInfo,
        graceDaysRemaining,
        effectiveQuotas,
      };
    }
  }

  // 4. Fail-safe: Se o uso excede a quota e não há carência ativa válida, entra em restricted_over_limit
  return {
    accessMode: 'restricted_over_limit',
    isOverLimit: true,
    overLimitDetails: overLimitInfo,
    graceDaysRemaining: 0,
    effectiveQuotas,
  };
}
