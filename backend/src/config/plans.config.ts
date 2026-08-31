export type PlanId = 'free' | 'lite' | 'lite_plus' | 'essential' | 'pro' | 'premium';
export type QuotaLimit = number | 'unlimited';
export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled';
export type AccessMode = 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';
export type BillingInterval = 'monthly' | 'annual';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  baseMembers: QuotaLimit;
  baseSongs: QuotaLimit;
  allowMemberAddons: boolean;
  maxMemberAddonBlocks: number;
  monthlyPriceCents: number;
  annualPriceCents: number;
  addonBlockMonthlyPriceCents: number;
  addonBlockAnnualPriceCents: number;
}

export interface EffectiveQuotas {
  members: QuotaLimit;
  songs: QuotaLimit;
}

export interface MinistryUsageData {
  members_count: number;
  songs_count: number;
}

export type SubscriptionMode = 'free' | 'paid' | 'complimentary';

export interface SubscriptionStateData {
  plan_id: PlanId;
  member_addon_blocks: number;
  billing_status: BillingStatus;
  subscription_mode?: SubscriptionMode;
  granted_by?: string | null;
  granted_at?: string | null;
  grant_reason?: string | null;
  expires_at?: string | null;
  administratively_suspended?: boolean;
  grace_period_expires_at?: string | null;
  cancel_at_period_end?: boolean;
  current_period_start?: string | null;
  current_period_end?: string | null;
}


export const MEMBER_ADDON_BLOCK_SIZE = 10;
export const DEFAULT_GRACE_PERIOD_DAYS = 7;
export const DEFAULT_PLAN_ID: PlanId = 'free';
export const ANNUAL_DISCOUNT_PERCENTAGE = 10;

/**
 * Calcula deterministamente o valor anual com 10% de desconto a partir do valor mensal (em centavos)
 * Ex: R$ 14,90 (1490 cents) * 12 * 0.90 = R$ 160,92 (16092 cents)
 */
export function calculateAnnualDiscountPriceCents(monthlyPriceCents: number): number {
  if (monthlyPriceCents <= 0) return 0;
  return Math.round(monthlyPriceCents * 12 * (1 - ANNUAL_DISCOUNT_PERCENTAGE / 100));
}

export const PLANS_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: 'free',
    name: 'Free',
    baseMembers: 10,
    baseSongs: 50,
    allowMemberAddons: false,
    maxMemberAddonBlocks: 0,
    monthlyPriceCents: 0,
    annualPriceCents: 0,
    addonBlockMonthlyPriceCents: 0,
    addonBlockAnnualPriceCents: 0,
  },
  lite: {
    id: 'lite',
    name: 'Lite',
    baseMembers: 20,
    baseSongs: 100,
    allowMemberAddons: false,
    maxMemberAddonBlocks: 0,
    monthlyPriceCents: 1490, // R$ 14,90
    annualPriceCents: calculateAnnualDiscountPriceCents(1490), // R$ 160,92
    addonBlockMonthlyPriceCents: 0,
    addonBlockAnnualPriceCents: 0,
  },
  lite_plus: {
    id: 'lite_plus',
    name: 'Lite+',
    baseMembers: 30,
    baseSongs: 150,
    allowMemberAddons: false,
    maxMemberAddonBlocks: 0,
    monthlyPriceCents: 2490, // R$ 24,90
    annualPriceCents: calculateAnnualDiscountPriceCents(2490), // R$ 268,92
    addonBlockMonthlyPriceCents: 0,
    addonBlockAnnualPriceCents: 0,
  },
  essential: {
    id: 'essential',
    name: 'Essential',
    baseMembers: 40,
    baseSongs: 200,
    allowMemberAddons: true,
    maxMemberAddonBlocks: 4, // Max 80 members (40 + 4*10)
    monthlyPriceCents: 3490, // R$ 34,90
    annualPriceCents: calculateAnnualDiscountPriceCents(3490), // R$ 376,92
    addonBlockMonthlyPriceCents: 990, // +10 membros = R$ 9,90/mês
    addonBlockAnnualPriceCents: calculateAnnualDiscountPriceCents(990), // R$ 106,92/ano
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    baseMembers: 100,
    baseSongs: 500,
    allowMemberAddons: true,
    maxMemberAddonBlocks: 10, // Max 200 members (100 + 10*10)
    monthlyPriceCents: 8990, // R$ 89,90
    annualPriceCents: calculateAnnualDiscountPriceCents(8990), // R$ 970,92
    addonBlockMonthlyPriceCents: 690, // +10 membros = R$ 6,90/mês
    addonBlockAnnualPriceCents: calculateAnnualDiscountPriceCents(690), // R$ 74,52/ano
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    baseMembers: 300,
    baseSongs: 1500,
    allowMemberAddons: false,
    maxMemberAddonBlocks: 0,
    monthlyPriceCents: 21490, // R$ 214,90
    annualPriceCents: calculateAnnualDiscountPriceCents(21490), // R$ 2.320,92
    addonBlockMonthlyPriceCents: 0,
    addonBlockAnnualPriceCents: 0,
  },
};

export function getPlanDefinition(planId: string): PlanDefinition {
  if (planId in PLANS_CATALOG) {
    return PLANS_CATALOG[planId as PlanId];
  }
  return PLANS_CATALOG[DEFAULT_PLAN_ID];
}

export interface PlanPriceCalculation {
  planId: PlanId;
  interval: BillingInterval;
  addonBlocks: number;
  basePriceCents: number;
  addonsPriceCents: number;
  totalPriceCents: number;
  fullMonthlyEquivalentCents: number;
  annualSavingsCents: number;
  currency: 'BRL';
}

/**
 * Calcula o valor total e decomposição financeira de um plano com base no ciclo e blocos de add-ons
 */
export function calculatePlanPriceCents(
  planId: PlanId,
  interval: BillingInterval,
  requestedAddonBlocks: number = 0
): PlanPriceCalculation {
  const plan = getPlanDefinition(planId);
  const addonBlocks = plan.allowMemberAddons
    ? Math.min(Math.max(0, requestedAddonBlocks), plan.maxMemberAddonBlocks)
    : 0;

  const isAnnual = interval === 'annual';
  const basePriceCents = isAnnual ? plan.annualPriceCents : plan.monthlyPriceCents;
  const unitAddonPriceCents = isAnnual ? plan.addonBlockAnnualPriceCents : plan.addonBlockMonthlyPriceCents;
  const addonsPriceCents = addonBlocks * unitAddonPriceCents;
  const totalPriceCents = basePriceCents + addonsPriceCents;

  const monthlyBaseTotal = plan.monthlyPriceCents + addonBlocks * plan.addonBlockMonthlyPriceCents;
  const fullYearWithoutDiscountCents = monthlyBaseTotal * 12;
  const annualSavingsCents = isAnnual ? Math.max(0, fullYearWithoutDiscountCents - totalPriceCents) : 0;
  const fullMonthlyEquivalentCents = isAnnual ? Math.round(totalPriceCents / 12) : totalPriceCents;

  return {
    planId: plan.id,
    interval,
    addonBlocks,
    basePriceCents,
    addonsPriceCents,
    totalPriceCents,
    fullMonthlyEquivalentCents,
    annualSavingsCents,
    currency: 'BRL',
  };
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
  // 0. Se for cancelamento agendado cujo período já expirou, ou cortesia com prazo expirada, o direito de uso volta ao plano Free
  let activePlan = plan;
  let activeAddonBlocks = subscription.member_addon_blocks || 0;
  if (subscription.cancel_at_period_end && subscription.current_period_end) {
    const periodEnd = new Date(subscription.current_period_end);
    if (!isNaN(periodEnd.getTime()) && now > periodEnd) {
      activePlan = PLANS_CATALOG.free;
      activeAddonBlocks = 0;
    }
  } else if (subscription.subscription_mode === 'complimentary' && subscription.expires_at) {
    const grantExpires = new Date(subscription.expires_at);
    if (!isNaN(grantExpires.getTime()) && now > grantExpires) {
      activePlan = PLANS_CATALOG.free;
      activeAddonBlocks = 0;
    }
  }

  const effectiveQuotas: EffectiveQuotas = {
    members: getEffectiveMemberQuota(activePlan, activeAddonBlocks),
    songs: getEffectiveSongQuota(activePlan),
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
