import {
  PlanId,
  BillingInterval,
  PLANS_CATALOG,
  getPlanDefinition,
  calculatePlanPriceCents,
  getEffectiveMemberQuota,
  getEffectiveSongQuota,
  QuotaLimit,
} from '../../config/plans.config';
import { getBillingDate } from '../../utils/billing-date';
import { AppError } from '../../middleware/error-handler';
import {
  BillingEarlyActivationQuote,
  EntitlementSnapshot,
  BillingTransitionType,
  BillingTransitionStatus,
  BillingTransitionV1Record,
  BillingProviderName,
  BillingCheckoutAttempt,
  BillingTransactionRecord,
  mapTransitionStatusToLegacyStatus,
  validateBillingTransitionV1,
} from './billing.types';
import {
  SourceContractInput,
  TargetContractRequest,
  EffectiveCapabilities,
  EntitlementComparisonResult,
  TransitionClassificationResult,
  TransitionCommercialSnapshot,
  ProrationCalculationResult,
  CreateQuoteOptions,
  BillingTransitionExecutionStrategy,
  BuildBillingTransitionRecordParams,
  PaidToPaidTargetReadyParams,
  PaidToPaidTargetReadyResult,
  CapabilityEligibilityClassification,
  CapabilityEligibilityResult,
  EarlyAdjustmentFinancialState,
  EarlyActivationBoundarySafeResult,
  EarlyActivationCheckoutEligibilityResult,
  EarlyActivationCompletionGateParams,
  EarlyActivationCompletionGateResult,
} from './billing-transition-domain.types';

export const BILLING_TIMEZONE_DEFAULT = 'America/Sao_Paulo';

/**
 * Valida o contrato de destino contra o catálogo oficial de planos.
 */
export function validateTargetContract(target: TargetContractRequest): void {
  if (!target || typeof target !== 'object') {
    throw new AppError(400, 'Objeto de destino de transição inválido.', { code: 'INVALID_TARGET_REQUEST' });
  }

  if (!target.plan_id || !(target.plan_id in PLANS_CATALOG)) {
    throw new AppError(400, `Plano de destino '${target.plan_id}' inválido ou não encontrado no catálogo.`, {
      code: 'INVALID_TARGET_PLAN',
    });
  }

  if (target.interval !== 'monthly' && target.interval !== 'annual') {
    throw new AppError(400, `Intervalo de faturamento '${target.interval}' inválido. Permitidos: monthly, annual.`, {
      code: 'INVALID_TARGET_INTERVAL',
    });
  }

  const plan = getPlanDefinition(target.plan_id);

  if (typeof target.addon_blocks !== 'number' || target.addon_blocks < 0) {
    throw new AppError(400, 'Quantidade de blocos de add-ons deve ser um número maior ou igual a zero.', {
      code: 'ADDON_LIMIT_EXCEEDED',
    });
  }

  if (target.addon_blocks > 0 && !plan.allowMemberAddons) {
    throw new AppError(400, `O plano '${plan.name}' não suporta blocos adicionais de membros.`, {
      code: 'ADDON_NOT_SUPPORTED',
    });
  }

  if (target.addon_blocks > plan.maxMemberAddonBlocks) {
    throw new AppError(
      400,
      `O plano '${plan.name}' suporta no máximo ${plan.maxMemberAddonBlocks} blocos adicionais de membros. Solicitado: ${target.addon_blocks}.`,
      { code: 'ADDON_LIMIT_EXCEEDED' }
    );
  }

  // Auditoria de Preço Anual de Addons
  if (target.interval === 'annual' && target.addon_blocks > 0) {
    if (typeof plan.addonBlockAnnualPriceCents !== 'number' || plan.addonBlockAnnualPriceCents <= 0) {
      throw new AppError(500, 'ANNUAL ADDON PRICING POLICY REQUIRED: preço anual de add-ons não definido no catálogo.', {
        code: 'ANNUAL_ADDON_PRICING_POLICY_REQUIRED',
      });
    }
  }
}

/**
 * Resolve as capacidades e quotas de entitlement efetivas associadas a um plano e quantidade de add-ons.
 * NOTA: Configurações comerciais (ex: allowMemberAddons, maxMemberAddonBlocks) NÃO são entitlements de uso.
 */
export function resolveEffectiveCapabilities(planId: PlanId, addonBlocks: number = 0): EffectiveCapabilities {
  const plan = getPlanDefinition(planId);
  return {
    members: getEffectiveMemberQuota(plan, addonBlocks),
    songs: getEffectiveSongQuota(plan),
  };
}

/**
 * Compara capacidades escalares (números ou 'unlimited').
 */
function compareScalarQuota(source: QuotaLimit, target: QuotaLimit): number {
  if (source === target) return 0;
  if (target === 'unlimited') return 1;
  if (source === 'unlimited') return -1;
  return target > source ? 1 : -1;
}

/**
 * Compara estritamente as capacidades efetivas de entitlement entre origem e destino.
 * Retorna: EQUAL, TARGET_STRICTLY_GREATER, TARGET_STRICTLY_LOWER ou MIXED.
 */
export function compareCapabilities(
  source: EffectiveCapabilities,
  target: EffectiveCapabilities
): EntitlementComparisonResult {
  const membersDelta = compareScalarQuota(source.members, target.members);
  const songsDelta = compareScalarQuota(source.songs, target.songs);

  const deltas = [membersDelta, songsDelta];
  const hasIncrease = deltas.some((d) => d > 0);
  const hasDecrease = deltas.some((d) => d < 0);

  if (hasIncrease && hasDecrease) {
    return 'MIXED';
  }
  if (hasIncrease && !hasDecrease) {
    return 'TARGET_STRICTLY_GREATER';
  }
  if (!hasIncrease && hasDecrease) {
    return 'TARGET_STRICTLY_LOWER';
  }
  return 'EQUAL';
}

/**
 * Classifica a transição de plano e determina a estratégia de execução financeira.
 * Rejeita NO-OP transitions com AppError(400).
 */
export function classifyTransition(
  source: SourceContractInput,
  target: TargetContractRequest
): TransitionClassificationResult {
  validateTargetContract(target);

  const isPlanChange = source.plan_id !== target.plan_id;
  const isIntervalChange = source.interval !== target.interval;
  const isAddonChange = source.addon_blocks !== target.addon_blocks;

  if (!isPlanChange && !isIntervalChange && !isAddonChange) {
    throw new AppError(400, 'Configuração de destino é idêntica à configuração de origem (NO-OP).', {
      code: 'NO_OP_TRANSITION',
    });
  }

  const isInitialPurchase = source.plan_id === 'free' && target.plan_id !== 'free';
  const isCancelToFree = source.plan_id !== 'free' && target.plan_id === 'free';

  let executionStrategy: BillingTransitionExecutionStrategy;
  if (isInitialPurchase) {
    executionStrategy = 'immediate_initial_purchase';
  } else if (isCancelToFree) {
    executionStrategy = 'scheduled_cancel_to_free';
  } else {
    executionStrategy = 'scheduled_paid_transition';
  }

  const sourceCapabilities = resolveEffectiveCapabilities(source.plan_id, source.addon_blocks);
  const targetCapabilities = resolveEffectiveCapabilities(target.plan_id, target.addon_blocks);
  const comparison = compareCapabilities(sourceCapabilities, targetCapabilities);

  let direction: TransitionClassificationResult['entitlement_direction'] = 'same';
  if (comparison === 'TARGET_STRICTLY_GREATER') direction = 'increase';
  else if (comparison === 'TARGET_STRICTLY_LOWER') direction = 'decrease';
  else if (comparison === 'MIXED') direction = 'mixed';

  // Early activation é elegível exclusivamente em transições pagas agendadas com aumento estrito de entitlement
  const earlyActivationEligible =
    executionStrategy === 'scheduled_paid_transition' && comparison === 'TARGET_STRICTLY_GREATER';

  let transitionType: BillingTransitionType;

  if (isInitialPurchase) {
    transitionType = 'upgrade';
  } else if (isCancelToFree) {
    transitionType = 'downgrade';
  } else if (isIntervalChange && (isPlanChange || isAddonChange)) {
    transitionType = 'hybrid';
  } else if (isIntervalChange && !isPlanChange && !isAddonChange) {
    transitionType = 'interval_change';
  } else if (!isIntervalChange && !isPlanChange && isAddonChange) {
    transitionType = 'addon_change';
  } else if (!isIntervalChange && isPlanChange) {
    if (comparison === 'TARGET_STRICTLY_GREATER') {
      transitionType = 'upgrade';
    } else if (comparison === 'TARGET_STRICTLY_LOWER') {
      transitionType = 'downgrade';
    } else {
      transitionType = 'hybrid';
    }
  } else {
    transitionType = 'hybrid';
  }

  return {
    transition_type: transitionType,
    execution_strategy: executionStrategy,
    entitlement_comparison: comparison,
    entitlement_direction: direction,
    early_activation_eligible: earlyActivationEligible,
    is_interval_change: isIntervalChange,
    is_addon_change: isAddonChange,
    is_plan_change: isPlanChange,
    is_initial_purchase: isInitialPurchase,
    is_cancel_to_free: isCancelToFree,
  };
}

/**
 * Converte data em YYYY-MM-DD civil no timezone especificado e calcula os dias exatos [start, end).
 * Imune a variações de DST e horários locais.
 */
export function commercialDaysBetween(
  startDate: string | Date,
  endDate: string | Date,
  timeZone: string = BILLING_TIMEZONE_DEFAULT
): number {
  const startBillingDate = getBillingDate(startDate, timeZone);
  const endBillingDate = getBillingDate(endDate, timeZone);

  const [y1, m1, d1] = startBillingDate.split('-').map(Number);
  const [y2, m2, d2] = endBillingDate.split('-').map(Number);

  const startUtc = Date.UTC(y1, m1 - 1, d1, 12, 0, 0);
  const endUtc = Date.UTC(y2, m2 - 1, d2, 12, 0, 0);

  if (endUtc <= startUtc) {
    throw new AppError(
      400,
      `Data final do período (${endBillingDate}) deve ser estritamente posterior à data inicial (${startBillingDate}).`,
      { code: 'INVALID_SOURCE_PERIOD' }
    );
  }

  const msPerDay = 86_400_000;
  return Math.round((endUtc - startUtc) / msPerDay);
}

/**
 * Divisão inteira com arredondamento ROUND_HALF_UP seguro e verificação de integer safety.
 */
export function roundHalfUpDivide(numerator: number | bigint, denominator: number | bigint): number {
  const num = BigInt(numerator);
  const den = BigInt(denominator);

  if (den <= 0n) {
    throw new AppError(500, 'Denominador inválido na divisão financeira.', { code: 'INVALID_DENOMINATOR' });
  }
  if (num <= 0n) {
    return 0;
  }

  const quotient = num / den;
  const remainder = num % den;

  let resultBigInt = quotient;
  // Se o resto dobrado for maior ou igual ao denominador, arredonda para cima (+1)
  if (remainder * 2n >= den) {
    resultBigInt = quotient + 1n;
  }

  if (resultBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(500, 'Resultado financeiro excede limite seguro de precisão inteira.', {
      code: 'INTEGER_OVERFLOW',
    });
  }

  return Number(resultBigInt);
}

/**
 * Constrói o snapshot comercial imutável de transição (Price Lock em requested_at).
 */
export function buildTransitionCommercialSnapshot(
  source: SourceContractInput,
  target: TargetContractRequest,
  options?: { requestedAt?: string | Date; timeZone?: string }
): TransitionCommercialSnapshot {
  const timeZone = options?.timeZone || BILLING_TIMEZONE_DEFAULT;
  const requestedAtIso = options?.requestedAt
    ? (typeof options.requestedAt === 'string' ? new Date(options.requestedAt) : options.requestedAt).toISOString()
    : new Date().toISOString();

  // 1. Validações e Classificação
  const classification = classifyTransition(source, target);

  let periodStartIso: string | null = null;
  let periodEndIso: string | null = null;
  let startDateStr: string | null = null;
  let endDateStr: string | null = null;
  let effectiveAtIso: string;
  let effectiveBillingDateStr: string;

  if (classification.execution_strategy === 'immediate_initial_purchase') {
    // Compra inicial imediata a partir de Free: não há período pago a preservar
    effectiveAtIso = requestedAtIso;
    effectiveBillingDateStr = getBillingDate(requestedAtIso, timeZone);
  } else {
    // Transições com origem paga (Paid -> Paid e Paid -> Free) exigem período corrente válido
    if (!source.current_period_start || !source.current_period_end) {
      throw new AppError(400, 'Período corrente de faturamento obrigatório para contratos de origem pagos.', {
        code: 'INVALID_SOURCE_PERIOD',
      });
    }

    startDateStr = getBillingDate(source.current_period_start, timeZone);
    endDateStr = getBillingDate(source.current_period_end, timeZone);

    periodStartIso = typeof source.current_period_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.current_period_start.trim())
      ? `${source.current_period_start.trim()}T00:00:00.000Z`
      : (typeof source.current_period_start === 'string' ? new Date(source.current_period_start).toISOString() : source.current_period_start.toISOString());

    periodEndIso = typeof source.current_period_end === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(source.current_period_end.trim())
      ? `${source.current_period_end.trim()}T00:00:00.000Z`
      : (typeof source.current_period_end === 'string' ? new Date(source.current_period_end).toISOString() : source.current_period_end.toISOString());

    // Valida que o período é válido
    commercialDaysBetween(startDateStr, endDateStr, timeZone);

    effectiveAtIso = periodEndIso;
    effectiveBillingDateStr = endDateStr;
  }

  // 2. Resolução de Preços
  const sourcePrice = calculatePlanPriceCents(source.plan_id, source.interval, source.addon_blocks);
  const targetRecurringPrice = calculatePlanPriceCents(target.plan_id, target.interval, target.addon_blocks);
  // Base de comparação para pró-rata: capacidades de destino no ciclo da origem
  const targetCurrentCyclePrice = calculatePlanPriceCents(target.plan_id, source.interval, target.addon_blocks);

  const sourcePlanDef = getPlanDefinition(source.plan_id);
  const targetPlanDef = getPlanDefinition(target.plan_id);

  const sourceEntitlementSnapshot: EntitlementSnapshot = {
    plan_id: source.plan_id,
    addon_blocks: source.addon_blocks,
    interval: source.interval,
    effective_member_quota: getEffectiveMemberQuota(sourcePlanDef, source.addon_blocks),
    effective_song_quota: getEffectiveSongQuota(sourcePlanDef),
  };

  const targetEntitlementSnapshot: EntitlementSnapshot = {
    plan_id: target.plan_id,
    addon_blocks: target.addon_blocks,
    interval: target.interval,
    effective_member_quota: getEffectiveMemberQuota(targetPlanDef, target.addon_blocks),
    effective_song_quota: getEffectiveSongQuota(targetPlanDef),
  };

  const earlyActivationTargetSnapshot: EntitlementSnapshot | null = classification.early_activation_eligible
    ? targetEntitlementSnapshot
    : null;

  return {
    classification,
    transition_type: classification.transition_type,
    execution_strategy: classification.execution_strategy,
    early_activation_eligible: classification.early_activation_eligible,

    source_plan_id: source.plan_id,
    source_interval: source.interval,
    source_addon_blocks: source.addon_blocks,
    source_entitlement_snapshot: sourceEntitlementSnapshot,
    source_current_cycle_total_cents: sourcePrice.totalPriceCents,
    current_period_start: periodStartIso,
    current_period_end: periodEndIso,
    current_period_start_date: startDateStr,
    current_period_end_date: endDateStr,

    target_plan_id: target.plan_id,
    target_interval: target.interval,
    target_addon_blocks: target.addon_blocks,
    target_future_recurring_price_cents: targetRecurringPrice.totalPriceCents,
    target_current_cycle_total_cents: targetCurrentCyclePrice.totalPriceCents,
    target_entitlement_snapshot: targetEntitlementSnapshot,
    early_activation_target_entitlement_snapshot: earlyActivationTargetSnapshot,

    currency: 'BRL',
    price_locked_at: requestedAtIso,
    effective_at: effectiveAtIso,
    effective_billing_date: effectiveBillingDateStr,
  };
}

/**
 * Calcula o ajuste financeiro de pró-rata para uma cotação de early activation.
 */
export function calculateProration(
  snapshot: TransitionCommercialSnapshot,
  options?: { now?: Date | string; timeZone?: string }
): ProrationCalculationResult {
  if (snapshot.execution_strategy === 'immediate_initial_purchase') {
    throw new AppError(400, 'Cotação de pró-rata não é aplicável para compra inicial imediata (Free -> Paid).', {
      code: 'EARLY_ACTIVATION_NOT_APPLICABLE',
    });
  }

  if (snapshot.execution_strategy === 'scheduled_cancel_to_free') {
    throw new AppError(400, 'Cotação de pró-rata não é aplicável para cancelamento agendado (Paid -> Free).', {
      code: 'EARLY_ACTIVATION_NOT_APPLICABLE',
    });
  }

  if (!snapshot.current_period_start_date || !snapshot.current_period_end_date) {
    throw new AppError(400, 'Período corrente ausente para cálculo de pró-rata.', {
      code: 'INVALID_SOURCE_PERIOD',
    });
  }

  const timeZone = options?.timeZone || BILLING_TIMEZONE_DEFAULT;
  const nowIso = options?.now
    ? (typeof options.now === 'string' ? new Date(options.now) : options.now).toISOString()
    : new Date().toISOString();

  const quoteBillingDate = getBillingDate(nowIso, timeZone);

  // Validar se a data da cotação está no intervalo [current_period_start_date, current_period_end_date)
  if (quoteBillingDate < snapshot.current_period_start_date) {
    throw new AppError(
      400,
      `Data da cotação (${quoteBillingDate}) é anterior ao início do ciclo corrente (${snapshot.current_period_start_date}).`,
      { code: 'EARLY_ACTIVATION_OUTSIDE_CURRENT_PERIOD' }
    );
  }

  if (quoteBillingDate >= snapshot.current_period_end_date) {
    throw new AppError(
      400,
      `Data da cotação (${quoteBillingDate}) atingiu ou ultrapassou o fim do ciclo corrente (${snapshot.current_period_end_date}).`,
      { code: 'EARLY_ACTIVATION_OUTSIDE_CURRENT_PERIOD' }
    );
  }

  const totalDays = commercialDaysBetween(
    snapshot.current_period_start_date,
    snapshot.current_period_end_date,
    timeZone
  );

  const remainingDays = commercialDaysBetween(
    quoteBillingDate,
    snapshot.current_period_end_date,
    timeZone
  );

  const deltaCents = snapshot.target_current_cycle_total_cents - snapshot.source_current_cycle_total_cents;

  if (!snapshot.early_activation_eligible || deltaCents <= 0) {
    return {
      total_days: totalDays,
      remaining_days: remainingDays,
      source_current_cycle_total_cents: snapshot.source_current_cycle_total_cents,
      target_current_cycle_total_cents: snapshot.target_current_cycle_total_cents,
      price_delta_cents: Math.max(0, deltaCents),
      prorated_adjustment_cents: 0,
      payment_required: false,
      quote_effective_billing_date: quoteBillingDate,
    };
  }

  const numerator = BigInt(deltaCents) * BigInt(remainingDays);
  const adjustmentCents = roundHalfUpDivide(numerator, BigInt(totalDays));

  return {
    total_days: totalDays,
    remaining_days: remainingDays,
    source_current_cycle_total_cents: snapshot.source_current_cycle_total_cents,
    target_current_cycle_total_cents: snapshot.target_current_cycle_total_cents,
    price_delta_cents: deltaCents,
    prorated_adjustment_cents: adjustmentCents,
    payment_required: adjustmentCents > 0,
    quote_effective_billing_date: quoteBillingDate,
  };
}

/**
 * Calcula o timestamp ISO de término do dia comercial em BILLING_TIMEZONE.
 */
export function getEndOfCommercialDayIso(
  commercialDateYmd: string,
  timeZone: string = BILLING_TIMEZONE_DEFAULT
): string {
  const [year, month, day] = commercialDateYmd.split('-').map(Number);
  let probe = new Date(Date.UTC(year, month - 1, day, 23, 0, 0));
  while (getBillingDate(probe, timeZone) === commercialDateYmd) {
    probe = new Date(probe.getTime() + 60_000);
  }
  return new Date(probe.getTime() - 1).toISOString();
}

/**
 * Cria uma cotação de early activation auditável e determinística.
 */
export function createEarlyActivationQuote(
  snapshot: TransitionCommercialSnapshot,
  options?: CreateQuoteOptions & { transitionId?: string; ministryId?: string }
): BillingEarlyActivationQuote {
  if (snapshot.execution_strategy !== 'scheduled_paid_transition' || !snapshot.early_activation_eligible) {
    throw new AppError(400, 'Transição não é elegível para early activation.', {
      code: 'EARLY_ACTIVATION_NOT_ELIGIBLE',
    });
  }

  const timeZone = options?.timeZone || BILLING_TIMEZONE_DEFAULT;
  const pricedAtIso = options?.now
    ? (typeof options.now === 'string' ? new Date(options.now) : options.now).toISOString()
    : new Date().toISOString();

  const proration = calculateProration(snapshot, { now: pricedAtIso, timeZone });

  // Expiry calculation: menor entre TTL configurado e o fim do dia comercial
  const endOfDayIso = getEndOfCommercialDayIso(proration.quote_effective_billing_date, timeZone);
  let expiresAtIso = endOfDayIso;

  if (options?.ttlMinutes && options.ttlMinutes > 0) {
    const ttlExpiresAt = new Date(new Date(pricedAtIso).getTime() + options.ttlMinutes * 60_000).toISOString();
    if (new Date(ttlExpiresAt).getTime() < new Date(endOfDayIso).getTime()) {
      expiresAtIso = ttlExpiresAt;
    }
  }

  const quoteId = options?.quoteId || `quote_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return {
    quote_id: quoteId,
    transition_id: options?.transitionId || 'transition_unassigned',
    ministry_id: options?.ministryId || 'ministry_unassigned',
    source_current_cycle_total_cents: proration.source_current_cycle_total_cents,
    target_current_cycle_total_cents: proration.target_current_cycle_total_cents,
    price_delta_cents: proration.price_delta_cents,
    total_days: proration.total_days,
    remaining_days: proration.remaining_days,
    prorated_adjustment_cents: proration.prorated_adjustment_cents,
    currency: 'BRL',
    priced_at: pricedAtIso,
    quote_effective_billing_date: proration.quote_effective_billing_date,
    expires_at: expiresAtIso,
    status: 'active',
    calculation_version: 'proration_v1',
  };
}

/**
 * Mapeador de domínio puro para construir um registro BillingTransitionV1Record válido
 * a partir de um snapshot comercial determinístico.
 * NÃO persiste e NÃO chama provedores externos.
 */
export function buildBillingTransitionV1Record(
  params: BuildBillingTransitionRecordParams
): BillingTransitionV1Record {
  const {
    transitionId,
    ministryId,
    provider,
    commercialSnapshot,
    requestedByUserId = null,
    providerCustomerId = null,
    oldProviderSubscriptionId = null,
    previousProviderSubscriptionId = null,
    now = new Date(),
    expiresAt = null,
  } = params;

  const nowIso = typeof now === 'string' ? new Date(now).toISOString() : now.toISOString();

  let initialTransitionStatus: BillingTransitionStatus;
  if (commercialSnapshot.execution_strategy === 'immediate_initial_purchase') {
    initialTransitionStatus = 'pending_initial_purchase';
  } else if (commercialSnapshot.execution_strategy === 'scheduled_paid_transition') {
    initialTransitionStatus = 'pending_future_authorization';
  } else {
    initialTransitionStatus = 'awaiting_old_inactivation';
  }

  const legacyStatus = mapTransitionStatusToLegacyStatus(initialTransitionStatus);

  const record: BillingTransitionV1Record = {
    id: transitionId,
    transition_id: transitionId,
    policy_version: 'billing_transition_v1',
    ministry_id: ministryId,
    provider,
    currency: 'BRL',

    execution_strategy: commercialSnapshot.execution_strategy,
    transition_status: initialTransitionStatus,
    early_activation_status: commercialSnapshot.early_activation_eligible ? 'available' : 'not_applicable',
    financial_safety_status: 'live',
    transition_type: commercialSnapshot.transition_type,

    status: legacyStatus,
    checkout_intent_id: transitionId,
    provider_checkout_id: null,
    new_provider_subscription_id: null,
    provider_customer_id: providerCustomerId,
    requested_plan_id: commercialSnapshot.target_plan_id,
    requested_interval: commercialSnapshot.target_interval,
    requested_addon_blocks: commercialSnapshot.target_addon_blocks,
    expected_amount_cents: commercialSnapshot.target_future_recurring_price_cents,

    source_plan_id: commercialSnapshot.source_plan_id,
    source_interval: commercialSnapshot.source_interval,
    source_addon_blocks: commercialSnapshot.source_addon_blocks,
    source_current_cycle_total_cents: commercialSnapshot.source_current_cycle_total_cents,
    source_entitlement_snapshot: commercialSnapshot.source_entitlement_snapshot,
    current_period_start: commercialSnapshot.current_period_start,
    current_period_end: commercialSnapshot.current_period_end,

    target_plan_id: commercialSnapshot.target_plan_id,
    target_interval: commercialSnapshot.target_interval,
    target_addon_blocks: commercialSnapshot.target_addon_blocks,
    target_future_recurring_price_cents: commercialSnapshot.target_future_recurring_price_cents,
    target_entitlement_snapshot: commercialSnapshot.target_entitlement_snapshot || null,
    early_activation_target_entitlement_snapshot: commercialSnapshot.early_activation_target_entitlement_snapshot,

    effective_at: commercialSnapshot.execution_strategy === 'immediate_initial_purchase' ? null : commercialSnapshot.effective_at,
    effective_billing_date: commercialSnapshot.execution_strategy === 'immediate_initial_purchase' ? null : commercialSnapshot.effective_billing_date,
    current_period_start_billing_date: commercialSnapshot.current_period_start_date,
    current_period_end_billing_date: commercialSnapshot.current_period_end_date,
    requested_commercial_date: getBillingDate(commercialSnapshot.price_locked_at, BILLING_TIMEZONE_DEFAULT),
    price_locked_at: commercialSnapshot.price_locked_at,
    requested_at: commercialSnapshot.price_locked_at,
    last_reconciled_at: null,
    created_at: nowIso,
    updated_at: nowIso,
    expires_at: expiresAt,

    old_provider_subscription_id: oldProviderSubscriptionId,
    previous_provider_subscription_id: previousProviderSubscriptionId,
    requested_by_user_id: requestedByUserId,
  };

  return validateBillingTransitionV1(record);
}

/**
 * Gate conceitual explícito de validação pré-ativação de entitlement para Compra Inicial V1 (Free -> Paid).
 * INITIAL_PURCHASE_PROVIDER_READY
 *
 * Exige:
 * 1. Transição V1 íntegra com estratégia immediate_initial_purchase
 * 2. Correlação inequívoca de checkout (externalReference / provider_checkout_id)
 * 3. Correlação de cliente canônico (provider_customer_id)
 * 4. Correlação de assinatura do provedor (provider_subscription_id)
 * 5. Correlação de pagamento do provedor (provider_payment_id)
 * 6. Status de pagamento liquidado aceito (CONFIRMED / RECEIVED)
 * 7. Valor pago correspondente ao preço travado (amountCents === target_future_recurring_price_cents)
 * 8. Moeda BRL
 * 9. Ciclo correspondente ao intervalo contratado (monthly / annual)
 * 10. Validade de data de renovação / vencimento
 *
 * Fail-Closed: se qualquer dimensão falhar, rejeita a ativação e retorna motivo estruturado.
 */
export function checkInitialPurchaseProviderReadiness(
  params: import('./billing-transition-domain.types').InitialPurchaseProviderReadyParams
): import('./billing-transition-domain.types').InitialPurchaseProviderReadyResult {
  const { transition, parsedEvent, expectedAmountCents, expectedCurrency = 'BRL' } = params;

  if (!transition || typeof transition !== 'object' || transition.policy_version !== 'billing_transition_v1') {
    return {
      ready: false,
      reason: 'Transição inválida ou não é versão billing_transition_v1',
      failureCode: 'INVALID_TRANSITION',
    };
  }

  if (transition.execution_strategy !== 'immediate_initial_purchase') {
    return {
      ready: false,
      reason: `Estratégia '${transition.execution_strategy}' incompatível com INITIAL_PURCHASE_PROVIDER_READY`,
      failureCode: 'STRATEGY_MISMATCH',
    };
  }

  // 1. Checkout Correlation Gate (Attempt-Scoped)
  const knownIntents = new Set<string>();
  if (transition.initial_checkout_intent_id) knownIntents.add(transition.initial_checkout_intent_id);
  if (transition.checkout_intent_id) knownIntents.add(transition.checkout_intent_id);
  if (transition.future_checkout_intent_id) knownIntents.add(transition.future_checkout_intent_id);
  if (transition.checkout_attempts) {
    for (const att of transition.checkout_attempts) {
      if (att.internal_checkout_intent_id) knownIntents.add(att.internal_checkout_intent_id);
    }
  }

  if (parsedEvent.externalReference && knownIntents.size > 0 && !knownIntents.has(parsedEvent.externalReference)) {
    return {
      ready: false,
      reason: `externalReference recebido ('${parsedEvent.externalReference}') não pertence a nenhuma tentativa desta transição`,
      failureCode: 'CHECKOUT_CORRELATION_FAILED',
    };
  }

  const knownCheckoutIds = new Set<string>();
  if (transition.initial_provider_checkout_id) knownCheckoutIds.add(transition.initial_provider_checkout_id);
  if (transition.provider_checkout_id) knownCheckoutIds.add(transition.provider_checkout_id);
  if (transition.future_provider_checkout_id) knownCheckoutIds.add(transition.future_provider_checkout_id);
  if (transition.checkout_attempts) {
    for (const att of transition.checkout_attempts) {
      if (att.provider_checkout_id) knownCheckoutIds.add(att.provider_checkout_id);
    }
  }

  if (parsedEvent.providerCheckoutId && knownCheckoutIds.size > 0 && !knownCheckoutIds.has(parsedEvent.providerCheckoutId)) {
    return {
      ready: false,
      reason: `providerCheckoutId recebido ('${parsedEvent.providerCheckoutId}') não pertence a nenhuma tentativa desta transição`,
      failureCode: 'CHECKOUT_CORRELATION_FAILED',
    };
  }

  // 2. Customer Correlation Gate
  if (
    transition.provider_customer_id &&
    parsedEvent.providerCustomerId &&
    transition.provider_customer_id !== parsedEvent.providerCustomerId
  ) {
    return {
      ready: false,
      reason: `providerCustomerId recebido ('${parsedEvent.providerCustomerId}') diverge do cliente canônico esperado ('${transition.provider_customer_id}')`,
      failureCode: 'CUSTOMER_MISMATCH',
    };
  }

  // 3. Subscription Correlation Gate
  if (!parsedEvent.providerSubscriptionId && !transition.initial_provider_subscription_id && !transition.new_provider_subscription_id) {
    return {
      ready: false,
      reason: 'Identificador de assinatura do provedor ausente no evento e na transição',
      failureCode: 'SUBSCRIPTION_CORRELATION_FAILED',
    };
  }

  const expectedSubId = transition.initial_provider_subscription_id || transition.new_provider_subscription_id;
  if (parsedEvent.providerSubscriptionId && expectedSubId && parsedEvent.providerSubscriptionId !== expectedSubId) {
    return {
      ready: false,
      reason: `providerSubscriptionId recebido ('${parsedEvent.providerSubscriptionId}') diverge da assinatura travada ('${expectedSubId}')`,
      failureCode: 'SUBSCRIPTION_CORRELATION_FAILED',
    };
  }

  // 4. Payment Correlation Gate
  if (!parsedEvent.providerPaymentId || !parsedEvent.providerPaymentId.trim()) {
    return {
      ready: false,
      reason: 'Identificador de pagamento do provedor ausente ou inválido',
      failureCode: 'PAYMENT_CORRELATION_FAILED',
    };
  }

  // 5. Payment Settled Gate
  const isSettledEventType = parsedEvent.eventType === 'payment_confirmed' || parsedEvent.eventType === 'payment_received';
  if (!isSettledEventType) {
    return {
      ready: false,
      reason: `Tipo de evento financeiro '${parsedEvent.eventType}' não é liquidado`,
      failureCode: 'PAYMENT_NOT_SETTLED',
    };
  }

  if (parsedEvent.status) {
    const statusUpper = parsedEvent.status.toUpperCase();
    const isSettledStatus = statusUpper === 'CONFIRMED' || statusUpper === 'RECEIVED';
    if (!isSettledStatus) {
      return {
        ready: false,
        reason: `Status de pagamento '${parsedEvent.status}' não é liquidado (esperado CONFIRMED ou RECEIVED)`,
        failureCode: 'PAYMENT_NOT_SETTLED',
      };
    }
  }

  // 6. Amount Validation Gate
  const paidAmountCents = parsedEvent.amountCents ?? expectedAmountCents;
  if (paidAmountCents !== expectedAmountCents) {
    return {
      ready: false,
      reason: `Valor pago (${paidAmountCents}¢) diverge do preço travado (${expectedAmountCents}¢)`,
      failureCode: 'AMOUNT_MISMATCH',
    };
  }

  // 7. Currency Gate
  const eventCurrency = parsedEvent.currency || 'BRL';
  if (eventCurrency !== expectedCurrency || transition.currency !== expectedCurrency) {
    return {
      ready: false,
      reason: `Moeda '${eventCurrency}' diverge da moeda esperada '${expectedCurrency}'`,
      failureCode: 'CURRENCY_MISMATCH',
    };
  }

  // 8. Cycle / Interval Gate
  if (parsedEvent.subscriptionCycle && parsedEvent.subscriptionCycle !== transition.target_interval) {
    return {
      ready: false,
      reason: `Ciclo da assinatura no provedor ('${parsedEvent.subscriptionCycle}') diverge do contratado ('${transition.target_interval}')`,
      failureCode: 'CYCLE_MISMATCH',
    };
  }

  if (
    parsedEvent.subscriptionValueCents !== undefined &&
    parsedEvent.subscriptionValueCents !== expectedAmountCents
  ) {
    return {
      ready: false,
      reason: `Valor recorrente da assinatura no provedor (${parsedEvent.subscriptionValueCents}¢) diverge do contratado (${expectedAmountCents}¢)`,
      failureCode: 'AMOUNT_MISMATCH',
    };
  }

  // 9. Renewal / Due Date Validity Gate
  if (parsedEvent.dueDate && typeof parsedEvent.dueDate === 'string') {
    const dueDateClean = parsedEvent.dueDate.trim().substring(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateClean)) {
      return {
        ready: false,
        reason: `Data de vencimento/renovação com formato inválido: '${parsedEvent.dueDate}'`,
        failureCode: 'RENEWAL_DATE_INVALID',
      };
    }
  }

  return { ready: true };
}

/**
 * Valida o portão Target Ready para transições Paid -> Paid (Phase 3B.1).
 * Verifica se a nova assinatura e a sua primeira cobrança foram materializadas e
 * correspondem estritamente ao contrato comercial travado para a data futura.
 *
 * REGRA CRÍTICA DE DESACOPLAMENTO (Seção 9):
 * Após a primeira cobrança ser materializada no Asaas, subscription.nextDueDate pode avançar
 * para o ciclo seguinte. Portanto, Target Ready NÃO exige subscription.nextDueDate === effective_billing_date.
 * A autoridade da data comercial da primeira renovação é firstPayment.dueDate === effective_billing_date.
 */
export function verifyPaidToPaidTargetReadyGate(
  params: PaidToPaidTargetReadyParams
): PaidToPaidTargetReadyResult {
  const {
    transition,
    targetCustomerId,
    providerSubscriptionId,
    subscriptionCycle,
    subscriptionValueCents,
    subscriptionStatus,
    firstPayment,
    checkoutSessionId,
    externalReference,
  } = params;

  // 0. Validação de formato e estratégia da transição
  if (!transition || typeof transition !== 'object' || transition.policy_version !== 'billing_transition_v1') {
    return {
      ready: false,
      reason: 'Transição inválida ou não é versão billing_transition_v1',
      failureCode: 'INVALID_TRANSITION',
    };
  }

  if (transition.execution_strategy !== 'scheduled_paid_transition') {
    return {
      ready: false,
      reason: `Estratégia '${transition.execution_strategy}' incompatível com PAID_TO_PAID_TARGET_READY (esperado 'scheduled_paid_transition')`,
      failureCode: 'STRATEGY_MISMATCH',
    };
  }

  // A. Customer Correlation
  if (
    transition.provider_customer_id &&
    targetCustomerId &&
    transition.provider_customer_id !== targetCustomerId
  ) {
    return {
      ready: false,
      reason: `targetCustomerId recebido ('${targetCustomerId}') diverge do cliente canônico esperado ('${transition.provider_customer_id}')`,
      failureCode: 'CUSTOMER_MISMATCH',
    };
  }

  // B. Checkout Correlation (Attempt-Scoped)
  const knownIntents = new Set<string>();
  if (transition.future_checkout_intent_id) knownIntents.add(transition.future_checkout_intent_id);
  if (transition.checkout_intent_id) knownIntents.add(transition.checkout_intent_id);
  if (transition.checkout_attempts) {
    for (const att of transition.checkout_attempts) {
      if (att.attempt_type === 'future_authorization' && att.internal_checkout_intent_id) {
        knownIntents.add(att.internal_checkout_intent_id);
      }
    }
  }

  if (externalReference && knownIntents.size > 0 && !knownIntents.has(externalReference)) {
    return {
      ready: false,
      reason: `externalReference recebido ('${externalReference}') não pertence a nenhuma tentativa future_authorization desta transição`,
      failureCode: 'CHECKOUT_CORRELATION_FAILED',
    };
  }

  const knownCheckoutIds = new Set<string>();
  if (transition.future_provider_checkout_id) knownCheckoutIds.add(transition.future_provider_checkout_id);
  if (transition.checkout_attempts) {
    for (const att of transition.checkout_attempts) {
      if (att.attempt_type === 'future_authorization' && att.provider_checkout_id) {
        knownCheckoutIds.add(att.provider_checkout_id);
      }
    }
  }

  if (checkoutSessionId && knownCheckoutIds.size > 0 && !knownCheckoutIds.has(checkoutSessionId)) {
    return {
      ready: false,
      reason: `checkoutSessionId recebido ('${checkoutSessionId}') não pertence a nenhuma tentativa future_authorization desta transição`,
      failureCode: 'CHECKOUT_CORRELATION_FAILED',
    };
  }

  // C. Subscription Identity
  if (!providerSubscriptionId || !providerSubscriptionId.trim()) {
    return {
      ready: false,
      reason: 'Identificador de assinatura target do provedor ausente ou inválido',
      failureCode: 'SUBSCRIPTION_CORRELATION_FAILED',
    };
  }

  // Não pode ser a mesma assinatura de origem
  if (
    transition.old_provider_subscription_id &&
    providerSubscriptionId === transition.old_provider_subscription_id
  ) {
    return {
      ready: false,
      reason: `providerSubscriptionId target ('${providerSubscriptionId}') não pode ser idêntico à assinatura antiga ('${transition.old_provider_subscription_id}')`,
      failureCode: 'SUBSCRIPTION_CORRELATION_FAILED',
    };
  }

  // D. Cycle / Interval Gate
  if (subscriptionCycle && subscriptionCycle !== transition.target_interval) {
    return {
      ready: false,
      reason: `Ciclo da assinatura no provedor ('${subscriptionCycle}') diverge do contratado ('${transition.target_interval}')`,
      failureCode: 'CYCLE_MISMATCH',
    };
  }

  // E. Recurring Value Gate
  if (
    subscriptionValueCents !== undefined &&
    subscriptionValueCents !== null &&
    subscriptionValueCents !== transition.target_future_recurring_price_cents
  ) {
    return {
      ready: false,
      reason: `Valor recorrente da assinatura no provedor (${subscriptionValueCents}¢) diverge do contratado (${transition.target_future_recurring_price_cents}¢)`,
      failureCode: 'AMOUNT_MISMATCH',
    };
  }

  // F. First Target Payment Materialization
  if (!firstPayment) {
    return {
      ready: false,
      reason: 'Primeira cobrança futura da assinatura target ainda não visível no provedor',
      failureCode: 'PAYMENT_NOT_YET_VISIBLE',
    };
  }

  // First Payment Subscription Correlation
  if (firstPayment.subscriptionId && firstPayment.subscriptionId !== providerSubscriptionId) {
    return {
      ready: false,
      reason: `subscriptionId da cobrança ('${firstPayment.subscriptionId}') diverge da assinatura target ('${providerSubscriptionId}')`,
      failureCode: 'PAYMENT_SUBSCRIPTION_MISMATCH',
    };
  }

  // G. First Payment Amount
  if (firstPayment.amountCents !== transition.target_future_recurring_price_cents) {
    return {
      ready: false,
      reason: `Valor da primeira cobrança (${firstPayment.amountCents}¢) diverge do valor contratado (${transition.target_future_recurring_price_cents}¢)`,
      failureCode: 'PAYMENT_AMOUNT_MISMATCH',
    };
  }

  // H. Commercial Due Date Gate
  const expectedDueDate = transition.effective_billing_date;
  const rawDueDate = firstPayment.originalDueDate || firstPayment.dueDate;
  const paymentDueDate = rawDueDate ? rawDueDate.trim().substring(0, 10) : null;
  if (!expectedDueDate || paymentDueDate !== expectedDueDate) {
    return {
      ready: false,
      reason: `Data de vencimento da primeira cobrança ('${paymentDueDate}') diverge da data comercial efetiva esperada ('${expectedDueDate}')`,
      failureCode: 'DUE_DATE_MISMATCH',
    };
  }

  // I. Target Payment State
  const paymentStatusUpper = (firstPayment.status || '').toUpperCase();
  const validFutureStatuses = ['PENDING', 'AWAITING_PAYMENT', 'CONFIRMED', 'RECEIVED'];
  if (!validFutureStatuses.includes(paymentStatusUpper)) {
    return {
      ready: false,
      reason: `Status da cobrança ('${firstPayment.status}') inválido para Target Ready (esperado PENDING, AWAITING_PAYMENT, CONFIRMED ou RECEIVED)`,
      failureCode: 'PAYMENT_STATUS_INVALID',
    };
  }

  return { ready: true };
}

// ============================================================================
// Phase 3C.1 — Pure Domain Functions for Early Activation with Prorated Adjustment
// ============================================================================

/**
 * Classifica a elegibilidade de early activation baseando-se estritamente nas capacidades
 * operacionais efetivas (membros e músicas) e no delta financeiro.
 * Exclui metadados comerciais e falha fechado em caso de alterações mistas ou delta <= 0.
 */
export function classifyCapabilityEligibility(
  source: EffectiveCapabilities | EntitlementSnapshot,
  target: EffectiveCapabilities | EntitlementSnapshot,
  options?: { priceDeltaCents?: number }
): CapabilityEligibilityResult {
  const sourceCapabilities: EffectiveCapabilities = {
    members: (source as any).effective_member_quota !== undefined ? (source as any).effective_member_quota : (source as any).members,
    songs: (source as any).effective_song_quota !== undefined ? (source as any).effective_song_quota : (source as any).songs,
  };
  const targetCapabilities: EffectiveCapabilities = {
    members: (target as any).effective_member_quota !== undefined ? (target as any).effective_member_quota : (target as any).members,
    songs: (target as any).effective_song_quota !== undefined ? (target as any).effective_song_quota : (target as any).songs,
  };

  const comparison = compareCapabilities(sourceCapabilities, targetCapabilities);

  if (comparison === 'TARGET_STRICTLY_GREATER') {
    if (options?.priceDeltaCents !== undefined && options.priceDeltaCents <= 0) {
      return {
        classification: 'pure_upgrade',
        early_activation_eligible: false,
        reason: 'PRICE_DELTA_NOT_POSITIVE',
      };
    }
    return {
      classification: 'pure_upgrade',
      early_activation_eligible: true,
    };
  }

  if (comparison === 'TARGET_STRICTLY_LOWER') {
    return {
      classification: 'pure_downgrade',
      early_activation_eligible: false,
      reason: 'CAPABILITIES_DECREASED',
    };
  }

  if (comparison === 'MIXED') {
    return {
      classification: 'mixed',
      early_activation_eligible: false,
      reason: 'MIXED_CAPABILITY_CHANGE',
    };
  }

  return {
    classification: 'no_change',
    early_activation_eligible: false,
    reason: 'NO_CAPABILITY_CHANGE',
  };
}

/**
 * Opções de configuração para cálculo de TTL do checkout.
 */
export interface CheckoutTtlOptions {
  providerMinimumMinutes?: number; // default: 10 (conforme contrato Asaas POST /v3/checkouts)
  safetyMarginMinutes?: number; // default: 1 (margem conservadora para absorver latência de rede/criação relativa no gateway)
  maxMinutes?: number; // default: 60
}

/**
 * Calcula o tempo de expiração do checkout no gateway em minutos inteiros.
 * Garante que o checkout NUNCA sobreviva à expiração da cotação e NUNCA viole o mínimo exigido pelo provedor.
 * Subtrai margem de segurança conservadora para absorver latência de rede/criação relativa no gateway.
 * Se o tempo útil resultante for inferior a providerMinimumMinutes (10m), falha fechado antes de qualquer reserva/chamada.
 */
export function calculateCheckoutMinutesToExpire(
  quoteExpiresAt: string | Date,
  now?: string | Date,
  options?: CheckoutTtlOptions
): { minutesToExpire: number; remainingMinutes: number; providerValid: boolean } {
  const providerMinimumMinutes = options?.providerMinimumMinutes ?? 10;
  const safetyMarginMinutes = options?.safetyMarginMinutes ?? 1;
  const maxMinutes = options?.maxMinutes ?? 60;

  const nowMs = now ? (typeof now === 'string' ? new Date(now).getTime() : now.getTime()) : Date.now();
  const quoteExpMs = typeof quoteExpiresAt === 'string' ? new Date(quoteExpiresAt).getTime() : quoteExpiresAt.getTime();

  const diffMs = quoteExpMs - nowMs;
  if (diffMs <= 0) {
    throw new AppError(400, 'A cotação de early activation já expirou.', {
      code: 'EARLY_ACTIVATION_QUOTE_EXPIRED',
    });
  }

  const remainingMinutes = Math.floor(diffMs / 60_000);
  const safeAvailableMinutes = remainingMinutes - safetyMarginMinutes;

  if (safeAvailableMinutes < providerMinimumMinutes) {
    throw new AppError(
      400,
      `Cotação muito próxima do término do dia comercial (tempo útil de ${safeAvailableMinutes} min inferior ao mínimo de ${providerMinimumMinutes} min do gateway). Aguarde a virada do dia para solicitar nova cotação.`,
      {
        code: 'EARLY_ACTIVATION_QUOTE_TOO_CLOSE_TO_EXPIRY',
        remainingMinutes,
        safeAvailableMinutes,
        providerMinimumMinutes,
      }
    );
  }

  const minutesToExpire = Math.min(maxMinutes, safeAvailableMinutes);
  return { minutesToExpire, remainingMinutes, providerValid: true };
}

/**
 * Classificador canônico e unificado do estado financeiro da obrigação de Early Activation.
 * Impede que diferentes predicados interpretem attempt.status de forma divergente.
 */
export function classifyEarlyAdjustmentFinancialState(
  transition: BillingTransitionV1Record,
  now: Date = new Date()
): EarlyAdjustmentFinancialState {
  if (transition.financial_attention_required === true) {
    return 'attention_required';
  }

  const isConfirmed =
    transition.early_activation_status === 'confirmed' ||
    transition.early_activation_status === 'activated';
  const hasPaymentId = Boolean(
    transition.early_activation_provider_payment_id ||
    transition.successful_early_adjustment_provider_payment_id
  );
  if (isConfirmed) {
    return hasPaymentId ? 'settled_converged' : 'settled_unconverged';
  }

  if (hasPaymentId) {
    return 'settled_unconverged';
  }

  const earlyAttempts = (transition.checkout_attempts || []).filter(
    (a) => a.attempt_type === 'early_activation'
  );

  if (earlyAttempts.length === 0) {
    return 'no_obligation';
  }

  const latestAttempt = earlyAttempts[earlyAttempts.length - 1];

  // Se o cancelamento estiver em andamento ou com resultado incerto, fail closed como 'uncertain'
  if (latestAttempt.cancel_state === 'attempting' || latestAttempt.cancel_state === 'uncertain') {
    return 'uncertain';
  }

  if (latestAttempt.status === 'completed') {
    return 'settled_unconverged';
  }

  if (latestAttempt.status === 'uncertain') {
    return 'uncertain';
  }

  if (latestAttempt.status === 'uncertain_expired') {
    return 'uncertain_expired_unresolved';
  }

  if (latestAttempt.status === 'pending') {
    if (latestAttempt.provider_create_state === 'reserved') {
      return 'no_obligation';
    }
    return 'financially_live';
  }

  if (latestAttempt.status === 'failed') {
    if (latestAttempt.failure_classification === 'creation_failed_before_provider_obligation') {
      return 'provider_terminal_unpaid';
    }
    if (latestAttempt.failure_classification === 'payment_declined_in_session') {
      return 'financially_live';
    }
    // provider_session_terminal = true só é seguro quando acompanhado de confirmação de sessão terminada
    if (
      latestAttempt.provider_session_terminal === true &&
      (latestAttempt.failure_classification === 'session_expired' ||
        latestAttempt.failure_classification === 'session_canceled')
    ) {
      return 'provider_terminal_unpaid';
    }
    // Fail closed se a causa do failed for desconhecida ou ambígua
    return 'financially_live';
  }

  if (latestAttempt.status === 'expired' || latestAttempt.status === 'canceled') {
    return 'provider_terminal_unpaid';
  }

  return 'financially_live';
}

/**
 * Predicado puro que determina se uma tentativa de checkout atingiu sua expiração canônica.
 * Utiliza estritamente os timestamps de expiração persistidos no attempt ou na transição.
 * Não utiliza suposições, minutos adivinhados ou relógio de cliente.
 */
export function isEarlyActivationCheckoutAttemptExpired(
  attempt: BillingCheckoutAttempt,
  transition?: BillingTransitionV1Record,
  now: Date = new Date()
): boolean {
  const expiryIso = attempt.expires_at || transition?.expires_at;
  if (!expiryIso) {
    return false;
  }
  const expiryTime = new Date(expiryIso).getTime();
  if (isNaN(expiryTime)) {
    return false;
  }
  return now.getTime() >= expiryTime;
}

export interface ResumeEarlyActivationAttemptResult {
  canResume: boolean;
  attempt?: BillingCheckoutAttempt;
  reason?: string;
}

/**
 * Predicado puro que determina se uma tentativa de early activation no estado 'reserved'
 * (localmente reservada, mas onde a chamada de rede ao provedor definitivamente ainda não foi iniciada)
 * pode ser retomada com a mesma tentativa, sem criar novo attempt_id nem consumir nova quote.
 */
export function canResumeReservedEarlyActivationAttempt(
  transition: BillingTransitionV1Record,
  quoteId: string,
  nowIso: string = new Date().toISOString()
): ResumeEarlyActivationAttemptResult {
  if (transition.transition_status !== 'scheduled') {
    return {
      canResume: false,
      reason: `Transição em status '${transition.transition_status}' não permite retomada de early activation (exigido 'scheduled').`,
    };
  }

  if (transition.financial_attention_required === true) {
    return {
      canResume: false,
      reason: 'Transição requer atenção financeira. Operação bloqueada.',
    };
  }

  const attempts = (transition.checkout_attempts || []).filter((a) => a.attempt_type === 'early_activation');
  if (attempts.length === 0) {
    return { canResume: false, reason: 'Nenhuma tentativa de early activation encontrada.' };
  }

  const latest = attempts[attempts.length - 1];
  if (latest.status !== 'pending' || latest.provider_create_state !== 'reserved') {
    return {
      canResume: false,
      reason: `Tentativa não está no estado 'reserved' elegível para retomada (status: '${latest.status}', provider_create_state: '${latest.provider_create_state}').`,
    };
  }

  if (latest.quote_id !== quoteId) {
    return {
      canResume: false,
      reason: `Tentativa reservada pertence à cotação '${latest.quote_id}', divergente da solicitada '${quoteId}'.`,
    };
  }

  const quote = transition.current_early_activation_quote;
  if (!quote || quote.quote_id !== quoteId) {
    return {
      canResume: false,
      reason: 'Cotação atual da transição é inexistente ou divergente da solicitada.',
    };
  }

  if (new Date(nowIso).getTime() >= new Date(quote.expires_at).getTime()) {
    return {
      canResume: false,
      reason: 'A cotação vinculada à reserva expirou.',
    };
  }

  return {
    canResume: true,
    attempt: latest,
  };
}

/**
 * Predicado puro que determina se existe qualquer obrigação financeira viva para a antecipação.
 */
export function isEarlyAdjustmentObligationFinanciallyLive(
  transition: BillingTransitionV1Record,
  now: Date = new Date()
): boolean {
  const state = classifyEarlyAdjustmentFinancialState(transition, now);
  switch (state) {
    case 'financially_live':
    case 'uncertain':
    case 'uncertain_expired_unresolved':
    case 'settled_unconverged':
    case 'attention_required':
      return true;
    case 'no_obligation':
    case 'provider_terminal_unpaid':
    case 'settled_converged':
      return false;
    default:
      return true; // Fail closed
  }
}

/**
 * Predicado puro da invariante de UMA ÚNICA OBRIGAÇÃO FINANCEIRA VIVA.
 * Determina se um novo checkout de early activation pode ser criado.
 */
export function canCreateEarlyActivationCheckout(
  transition: BillingTransitionV1Record,
  options?: { currentCommercialDate?: string; timeZone?: string }
): EarlyActivationCheckoutEligibilityResult {
  const timeZone = options?.timeZone || BILLING_TIMEZONE_DEFAULT;
  const currentCommercialDate = options?.currentCommercialDate || getBillingDate(new Date(), timeZone);

  if (transition.transition_status !== 'scheduled') {
    return {
      allowed: false,
      reason: `Transição em status '${transition.transition_status}' não permite early activation (exigido 'scheduled').`,
    };
  }

  if (
    transition.early_activation_status === 'confirmed' ||
    transition.early_activation_status === 'activated'
  ) {
    return {
      allowed: false,
      reason: 'A ativação antecipada já foi confirmada e aplicada para esta transição.',
      financialState: 'settled_converged',
    };
  }

  if (transition.financial_attention_required === true) {
    return {
      allowed: false,
      reason: 'Transição requer atenção financeira. Operação bloqueada.',
      financialState: 'attention_required',
    };
  }

  // Se existir uma tentativa local no estado 'reserved', ela não permite criar um NOVO attempt,
  // mas indica que a MESMA tentativa deve ser retomada via canResumeReservedEarlyActivationAttempt.
  const earlyAttempts = (transition.checkout_attempts || []).filter((a) => a.attempt_type === 'early_activation');
  const hasReservedLocalAttempt = earlyAttempts.some(
    (a) => a.status === 'pending' && a.provider_create_state === 'reserved'
  );
  if (hasReservedLocalAttempt) {
    return {
      allowed: false,
      reason: 'Existe uma reserva de checkout local pendente de execução. Retome a mesma tentativa sem criar nova obrigação.',
      financialState: 'no_obligation',
    };
  }

  if (transition.effective_billing_date && currentCommercialDate >= transition.effective_billing_date) {
    return {
      allowed: false,
      reason: `Data comercial atual (${currentCommercialDate}) atingiu ou ultrapassou a data da renovação (${transition.effective_billing_date}).`,
    };
  }

  const financialState = classifyEarlyAdjustmentFinancialState(transition);
  if (isEarlyAdjustmentObligationFinanciallyLive(transition)) {
    return {
      allowed: false,
      reason: `Existe uma obrigação financeira de early activation ativa ou não resolvida (estado: '${financialState}').`,
      financialState,
    };
  }

  const deltaCents =
    (transition.target_current_cycle_total_cents || 0) -
    (transition.source_current_cycle_total_cents || 0);

  if (deltaCents <= 0) {
    return {
      allowed: false,
      reason: 'Diferença de preço do ciclo corrente não é estritamente positiva.',
      financialState,
    };
  }

  return {
    allowed: true,
    financialState,
  };
}

/**
 * Predicado puro do Boundary Handoff Gate.
 * Impede que a Phase 3B.3 marque safe_terminal ou libere o slot se houver obrigações de
 * early activation pendentes, incertas ou não resolvidas na fronteira de renovação.
 */
export function isEarlyActivationBoundarySafe(
  transition: BillingTransitionV1Record
): EarlyActivationBoundarySafeResult {
  if (transition.early_activation_status === 'not_applicable') {
    return { safe: true, financialState: 'no_obligation' };
  }

  if (transition.financial_attention_required === true) {
    return {
      safe: false,
      reason: 'Transição com atenção financeira não é segura para finalização na fronteira.',
      financialState: 'attention_required',
    };
  }

  const financialState = classifyEarlyAdjustmentFinancialState(transition);

  if (financialState === 'settled_converged') {
    return { safe: true, financialState };
  }

  if (financialState === 'no_obligation') {
    return { safe: true, financialState };
  }

  if (financialState === 'provider_terminal_unpaid') {
    return { safe: true, financialState };
  }

  return {
    safe: false,
    reason: `Subfluxo de early activation em estado financeiro inseguro na fronteira ('${financialState}').`,
    financialState,
  };
}

/**
 * Predicado puro de validação atômica do Early Activation Completion Gate.
 * Não faz I/O nem consulta o Firestore diretamente; consome snapshots e evidências já carregados.
 */
export function validateEarlyActivationCompletion(
  params: EarlyActivationCompletionGateParams
): EarlyActivationCompletionGateResult {
  const { transition, payment, transaction, attempt, runtimeSubscription } = params;

  const paymentStatusUpper = (payment.status || '').toUpperCase();
  if (paymentStatusUpper !== 'CONFIRMED' && paymentStatusUpper !== 'RECEIVED') {
    return {
      ready: false,
      reason: `Pagamento ${payment.id} com status não liquidado ('${payment.status}'). Esperado CONFIRMED ou RECEIVED.`,
    };
  }

  if (!transition.early_activation_provider_payment_id || transition.early_activation_provider_payment_id !== payment.id) {
    return {
      ready: false,
      reason: `ID do pagamento fornecido ('${payment.id}') diverge do registrado na transição ('${transition.early_activation_provider_payment_id}').`,
    };
  }

  if (!transaction) {
    return {
      ready: false,
      reason: 'Registro canônico de BillingTransaction ausente.',
    };
  }

  const expectedTxId = `${transition.provider}_${payment.id}`;
  if (transaction.id !== expectedTxId) {
    return {
      ready: false,
      reason: `ID da BillingTransaction ('${transaction.id}') diverge do esperado ('${expectedTxId}').`,
    };
  }

  if (transaction.transaction_type !== 'prorated_early_activation_adjustment') {
    return {
      ready: false,
      reason: `Tipo da transação ('${transaction.transaction_type}') inválido (esperado 'prorated_early_activation_adjustment').`,
    };
  }

  const expectedAmountCents =
    transition.current_early_activation_quote?.prorated_adjustment_cents ||
    transition.prorated_adjustment_cents ||
    0;

  if (transaction.amount_cents !== expectedAmountCents || payment.amountCents !== expectedAmountCents) {
    return {
      ready: false,
      reason: `Valor da transação (${transaction.amount_cents}¢) ou do pagamento (${payment.amountCents}¢) diverge do ajuste contratado (${expectedAmountCents}¢).`,
    };
  }

  const authoritativePaidDate = transaction.paid_billing_date || payment.paidBillingDate;
  if (!authoritativePaidDate) {
    return {
      ready: false,
      reason: 'Data civil financeira autoritativa de liquidação (paid_billing_date) ausente na transação e no pagamento.',
    };
  }

  if (!attempt || attempt.status !== 'completed') {
    return {
      ready: false,
      reason: `Tentativa de checkout ausente ou não concluída (status: '${attempt?.status}').`,
    };
  }

  if (transition.current_early_activation_checkout_attempt_id && attempt.attempt_id !== transition.current_early_activation_checkout_attempt_id) {
    return {
      ready: false,
      reason: `ID da tentativa ('${attempt.attempt_id}') diverge do registrado na transição ('${transition.current_early_activation_checkout_attempt_id}').`,
    };
  }

  if (!runtimeSubscription) {
    return {
      ready: false,
      reason: 'Assinatura em runtime (MinistrySubscription) ausente.',
    };
  }

  if (
    runtimeSubscription.plan_id !== transition.target_plan_id ||
    runtimeSubscription.member_addon_blocks !== transition.target_addon_blocks
  ) {
    return {
      ready: false,
      reason: `Entitlements do runtime (plano: '${runtimeSubscription.plan_id}', blocos: ${runtimeSubscription.member_addon_blocks}) divergem do target_entitlement_snapshot contratado (plano: '${transition.target_plan_id}', blocos: ${transition.target_addon_blocks}).`,
    };
  }

  if (
    transition.current_period_start &&
    runtimeSubscription.current_period_start &&
    runtimeSubscription.current_period_start !== transition.current_period_start
  ) {
    return {
      ready: false,
      reason: `Data inicial do ciclo corrente (${runtimeSubscription.current_period_start}) foi indevidamente modificada (esperado: ${transition.current_period_start}).`,
    };
  }

  if (
    transition.current_period_end &&
    runtimeSubscription.current_period_end &&
    runtimeSubscription.current_period_end !== transition.current_period_end
  ) {
    return {
      ready: false,
      reason: `Data final do ciclo corrente (${runtimeSubscription.current_period_end}) foi indevidamente modificada (esperado: ${transition.current_period_end}).`,
    };
  }

  return { ready: true };
}
