import crypto from 'crypto';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { UserRepository } from '../../repositories/UserRepository';
import { BillingProvider, ProviderPaymentRecord, ParsedWebhookEvent } from './providers/billing-provider.interface';
import { AsaasBillingProvider } from './providers/asaas/asaas.provider';
import { config } from '../../config/unifiedConfig';
import {
  PlanId,
  BillingInterval,
  PLANS_CATALOG,
  getPlanDefinition,
  getEffectiveMemberQuota,
  getEffectiveSongQuota,
  calculatePlanPriceCents,
  isUsageOverLimit,
  DEFAULT_GRACE_PERIOD_DAYS,
} from '../../config/plans.config';
import {
  CheckoutPreviewResult,
  CheckoutCreationRequest,
  CheckoutCreationResult,
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingPlanChangeRecord,
  BillingTransactionRecord,
  BillingWebhookEventRecord,
  BillingTransitionV1Record,
  BillingCheckoutAttempt,
  isBillingTransitionV1,
  buildBillingSubscriptionId,
} from './billing.types';
import {
  validateTargetContract,
  classifyTransition,
  buildTransitionCommercialSnapshot,
  buildBillingTransitionV1Record,
  checkInitialPurchaseProviderReadiness,
  verifyPaidToPaidTargetReadyGate,
  canCreateEarlyActivationCheckout,
  canResumeReservedEarlyActivationAttempt,
  calculateCheckoutMinutesToExpire,
  createEarlyActivationQuote,
  classifyCapabilityEligibility,
  isEarlyAdjustmentObligationFinanciallyLive,
  classifyEarlyAdjustmentFinancialState,
  BILLING_TIMEZONE_DEFAULT,
} from './billing-transition-domain.service';
import { TransitionCommercialSnapshot } from './billing-transition-domain.types';
import {
  EarlyActivationQuoteResponseDto,
  EarlyActivationCheckoutResponseDto,
} from './billing.types';
import { AppError } from '../../middleware/error-handler';
import { getCurrentBillingDate, getBillingDate, addCommercialInterval, addCommercialDays } from '../../utils/billing-date';
import { providerBrlDecimalToCents } from './billing-money.utils';

export class BillingService {
  constructor(
    private readonly billingRepo: BillingRepository = new BillingRepository(),
    private readonly subscriptionService: SubscriptionService = new SubscriptionService(),
    private readonly subscriptionRepo: SubscriptionRepository = new SubscriptionRepository(),
    private readonly ministryRepo: MinistryRepository = new MinistryRepository(),
    private readonly provider: BillingProvider = new AsaasBillingProvider(),
    private readonly userRepo: UserRepository = new UserRepository()
  ) {}

  /**
   * Executa a limpeza determinística e idempotente de cobranças PENDING pré-geradas no Asaas
   * pertencentes à assinatura anterior (sub_old) e referentes à próxima renovação futura.
   *
   * Regra de Corte:
   * renewalCutoffDate = getBillingDate(currentPeriodEnd, config.billingTimezone) (YYYY-MM-DD)
   *
   * Candidatos a remoção:
   * - payment.subscription === oldProviderSubscriptionId
   * - payment.status === 'PENDING'
   * - payment.dueDate >= renewalCutoffDate (comparação estrita YYYY-MM-DD)
   *
   * Preserva estritamente:
   * - CONFIRMED / RECEIVED (histórico consolidado)
   * - OVERDUE (dívida legítima de períodos já consumidos)
   * - PENDING com dueDate < renewalCutoffDate (ciclo anterior em curso)
   *
   * Tratamento de Race Condition (PENDING -> CONFIRMED):
   * Se DELETE falhar e o payment foi capturado (CONFIRMED/RECEIVED),
   * marca financial_attention_required e NÃO realiza refund automático.
   */
  async cleanupFuturePaymentsFromPreviousSubscription(params: {
    oldProviderSubscriptionId: string;
    currentPeriodEnd: string | null;
    ministryId: string;
  }): Promise<{
    success: boolean;
    removedPaymentIds: string[];
    skippedPaymentIds: string[];
    financialAttentionRequired?: boolean;
    financialAttentionReason?: string;
    error?: string;
  }> {
    const { oldProviderSubscriptionId, currentPeriodEnd } = params;

    if (!oldProviderSubscriptionId) {
      return { success: true, removedPaymentIds: [], skippedPaymentIds: [] };
    }

    const renewalCutoffDate = currentPeriodEnd
      ? getBillingDate(currentPeriodEnd, config.billingTimezone)
      : getCurrentBillingDate(new Date(), config.billingTimezone);

    let pendingPayments: ProviderPaymentRecord[] = [];
    try {
      pendingPayments = await this.provider.listSubscriptionPayments(oldProviderSubscriptionId, {
        status: 'PENDING',
      });
    } catch (listErr: any) {
      console.error(
        `[PAYMENT CLEANUP WARNING] Falha ao listar pagamentos da assinatura ${oldProviderSubscriptionId}:`,
        listErr
      );
      return {
        success: false,
        removedPaymentIds: [],
        skippedPaymentIds: [],
        error: listErr.message || 'Falha ao listar pagamentos da assinatura antiga',
      };
    }

    const removedPaymentIds: string[] = [];
    const skippedPaymentIds: string[] = [];

    for (const payment of pendingPayments) {
      // Garantir correspondência de assinatura
      if (payment.subscriptionId && payment.subscriptionId !== oldProviderSubscriptionId) {
        continue;
      }

      // Preservar estritamente qualquer status não-PENDING (ex: OVERDUE, CONFIRMED, RECEIVED)
      if (payment.status !== 'PENDING') {
        skippedPaymentIds.push(payment.id);
        continue;
      }

      // Comparação estrita de data comercial YYYY-MM-DD
      const paymentDueDate = payment.dueDate ? payment.dueDate.substring(0, 10) : '';
      if (!paymentDueDate || paymentDueDate < renewalCutoffDate) {
        // Cobrança referente ao ciclo atual ou passado — PRESERVAR
        skippedPaymentIds.push(payment.id);
        continue;
      }

      // Candidato a remoção: PENDING com dueDate >= renewalCutoffDate
      try {
        await this.provider.removePayment(payment.id);
        removedPaymentIds.push(payment.id);
        console.log(
          `[PAYMENT CLEANUP] Cobrança futura PENDING ${payment.id} (dueDate: ${payment.dueDate}) da assinatura ${oldProviderSubscriptionId} removida com sucesso no Asaas.`
        );
      } catch (removeErr: any) {
        console.error(
          `[PAYMENT CLEANUP ERROR] Falha ao remover cobrança ${payment.id} no Asaas:`,
          removeErr
        );

        // Investigar se houve race condition (ex: pagamento capturado entre o GET e o DELETE)
        if (this.provider.getPayment) {
          try {
            const currentPayState = await this.provider.getPayment(payment.id);
            if (!currentPayState || currentPayState.status === 'DELETED') {
              // Já deletado — tratar como resolvido
              removedPaymentIds.push(payment.id);
              continue;
            }

            if (currentPayState.status === 'CONFIRMED' || currentPayState.status === 'RECEIVED') {
              // Race financeira: o Asaas debitou o cartão antes do DELETE!
              console.error(
                `[CRITICAL FINANCIAL RACE] Cobrança ${payment.id} que deveria ser cancelada foi confirmada/paga (R$ ${(payment.amountCents / 100).toFixed(2)}) no Asaas!`
              );
              return {
                success: false,
                removedPaymentIds,
                skippedPaymentIds,
                financialAttentionRequired: true,
                financialAttentionReason: `Cobrança futura ${payment.id} de ${oldProviderSubscriptionId} foi paga (${currentPayState.status}) antes do cancelamento. Requer intervenção operacional.`,
                error: `Cobrança ${payment.id} foi confirmada durante a transição.`,
              };
            }
          } catch (getErr: any) {
            console.error(`[PAYMENT CLEANUP] Falha ao reconsultar status do payment ${payment.id}:`, getErr);
          }
        }

        return {
          success: false,
          removedPaymentIds,
          skippedPaymentIds,
          error: removeErr.message || `Falha ao remover cobrança futura ${payment.id}`,
        };
      }
    }

    return {
      success: true,
      removedPaymentIds,
      skippedPaymentIds,
    };
  }

  /**
   * Retorna prévia detalhada de valores, quotas e eventuais impactos de downgrade antes do checkout.
   */
  async getCheckoutPreview(
    ministryId: string,
    targetPlanId: PlanId,
    interval: BillingInterval,
    requestedAddonBlocks: number = 0
  ): Promise<CheckoutPreviewResult> {
    if (!(targetPlanId in PLANS_CATALOG)) {
      throw new AppError(400, `Plano inválido: ${targetPlanId}`);
    }

    const currentSummary = await this.subscriptionService.getSubscriptionSummary(ministryId);
    const targetPlan = getPlanDefinition(targetPlanId);
    const priceCalculation = calculatePlanPriceCents(targetPlanId, interval, requestedAddonBlocks);

    const targetEffectiveMembers = getEffectiveMemberQuota(targetPlan, priceCalculation.addonBlocks);
    const targetEffectiveSongs = getEffectiveSongQuota(targetPlan);

    // Comparar se é downgrade
    const currentEffectiveMembers = currentSummary.quotas.members;
    const isDowngrade =
      currentEffectiveMembers !== 'unlimited' &&
      targetEffectiveMembers !== 'unlimited' &&
      targetEffectiveMembers < currentEffectiveMembers;

    let downgradeImpact: CheckoutPreviewResult['downgradeImpact'] = undefined;
    if (isDowngrade) {
      const overLimitInfo = isUsageOverLimit(
        {
          members_count: currentSummary.usage.membersCount,
          songs_count: currentSummary.usage.songsCount,
        },
        {
          members: targetEffectiveMembers,
          songs: targetEffectiveSongs,
        }
      );

      downgradeImpact = {
        isOverLimit: overLimitInfo.isOverLimit,
        membersOver: overLimitInfo.membersOver,
        songsOver: overLimitInfo.songsOver,
        gracePeriodDays: DEFAULT_GRACE_PERIOD_DAYS,
      };
    }

    return {
      planId: targetPlan.id,
      planName: targetPlan.name,
      interval,
      addonBlocks: priceCalculation.addonBlocks,
      effectiveMembersQuota: targetEffectiveMembers,
      effectiveSongsQuota: targetEffectiveSongs,
      basePriceCents: priceCalculation.basePriceCents,
      addonsPriceCents: priceCalculation.addonsPriceCents,
      totalPriceCents: priceCalculation.totalPriceCents,
      fullMonthlyEquivalentCents: priceCalculation.fullMonthlyEquivalentCents,
      annualSavingsCents: priceCalculation.annualSavingsCents,
      currency: 'BRL',
      currentPlanId: currentSummary.subscription.planId,
      isDowngrade,
      downgradeImpact,
    };
  }

  /**
   * Resolve ou cria o cliente canônico no gateway de billing com proteção atômica contra concorrência.
   *
   * Invariante de Domínio:
   * 1 Ministry + 1 Billing Provider -> 1 Registro Canônico em `billing_customers`.
   *
   * Garantias de Concorrência e Resiliência:
   * 1. Consulta `billing_customers` e a assinatura ativa vigente.
   * 2. Reconciliação segura de mismatch: se a assinatura ativa pertence a outro customer, assume essa autoridade.
   * 3. Se não existir customer canônico pronto, adquire claim/lease transacional atômico no Firestore.
   * 4. Se outra requisição estiver criando o customer, aguarda a resolução com polling em vez de duplicar no gateway.
   * 5. Antes de criar no Asaas, consulta `findCustomerByExternalReference` para recuperar eventuais cadastros prévios criados antes de um crash.
   * 6. Criação explícita (`POST /v3/customers`) executada fora de transações Firestore.
   */
  async resolveOrCreateBillingCustomer(
    ministryId: string,
    options?: { email?: string; taxId?: string; phone?: string; pollTimeoutMs?: number }
  ): Promise<{ providerCustomerId: string; isNew: boolean }> {
    const canonicalCustomer = await this.billingRepo.getCustomer(ministryId, this.provider.name);
    const currentBillingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);

    // 1. Reconciliação segura de Mismatch: Se a subscription ativa vigente possui provider_customer_id
    if (
      currentBillingSub &&
      currentBillingSub.status === 'active' &&
      currentBillingSub.provider_customer_id &&
      currentBillingSub.provider_customer_id.trim()
    ) {
      const activeSubCustomerId = currentBillingSub.provider_customer_id.trim();

      if (canonicalCustomer && canonicalCustomer.provider_customer_id !== activeSubCustomerId) {
        console.log(
          `[BILLING CUSTOMER RECONCILE] Mismatch detectado para ministério ${ministryId}. Atualizando customer canônico de ${canonicalCustomer.provider_customer_id} para ${activeSubCustomerId} (autoridade da assinatura ativa).`
        );
        const now = new Date().toISOString();
        await this.billingRepo.setCustomer({
          id: `${ministryId}_${this.provider.name}`,
          ministry_id: ministryId,
          provider: this.provider.name,
          provider_customer_id: activeSubCustomerId,
          status: 'ready',
          created_at: canonicalCustomer.created_at || now,
          updated_at: now,
        });
        return { providerCustomerId: activeSubCustomerId, isNew: false };
      }

      if (!canonicalCustomer) {
        const now = new Date().toISOString();
        await this.billingRepo.setCustomer({
          id: `${ministryId}_${this.provider.name}`,
          ministry_id: ministryId,
          provider: this.provider.name,
          provider_customer_id: activeSubCustomerId,
          status: 'ready',
          created_at: now,
          updated_at: now,
        });
        return { providerCustomerId: activeSubCustomerId, isNew: false };
      }
    }

    // 2. Se já possui customer canônico persistido e pronto, reutiliza imediatamente
    if (
      canonicalCustomer &&
      canonicalCustomer.provider_customer_id &&
      canonicalCustomer.provider_customer_id.trim() &&
      canonicalCustomer.status !== 'creating'
    ) {
      return { providerCustomerId: canonicalCustomer.provider_customer_id.trim(), isNew: false };
    }

    // 3. Concorrência no Primeiro Customer: Adquire claim/lease atômico no Firestore
    const lockWorkerId = `claim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const claim = await this.billingRepo.claimCustomerCreation(ministryId, this.provider.name, lockWorkerId, 30000);

    if (!claim.acquired) {
      // Se já está pronto no Firestore
      if (claim.customer?.provider_customer_id && claim.customer.status !== 'creating') {
        return { providerCustomerId: claim.customer.provider_customer_id.trim(), isNew: false };
      }

      // Se está em criação por outra request concorrente, aguarda resolução com polling
      const timeoutMs = options?.pollTimeoutMs || 8000;
      const startTime = Date.now();
      while (Date.now() - startTime < timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const polled = await this.billingRepo.getCustomer(ministryId, this.provider.name);
        if (polled && polled.provider_customer_id && polled.status !== 'creating') {
          return { providerCustomerId: polled.provider_customer_id.trim(), isNew: false };
        }
      }
      // Se expirou o polling, tenta reavaliar o claim
      const retryClaim = await this.billingRepo.claimCustomerCreation(ministryId, this.provider.name, lockWorkerId, 30000);
      if (!retryClaim.acquired && retryClaim.customer?.provider_customer_id) {
        return { providerCustomerId: retryClaim.customer.provider_customer_id.trim(), isNew: false };
      }
    }

    // 4. Detentor do lease: Verifica se o customer já existe no gateway Asaas por externalReference antes de criar
    let providerCustomerId: string | null = null;
    if (typeof this.provider.findCustomerByExternalReference === 'function') {
      try {
        const existingOnGateway = await this.provider.findCustomerByExternalReference(ministryId);
        if (existingOnGateway && existingOnGateway.providerCustomerId) {
          providerCustomerId = existingOnGateway.providerCustomerId;
          const ministry = await this.ministryRepo.findById(ministryId);
          const phone = options?.phone || (ministry as any)?.phone || '11999999999';
          if (typeof this.provider.updateCustomer === 'function') {
            await this.provider.updateCustomer(providerCustomerId, {
              email: options?.email,
              phone: phone,
            });
          }
        }
      } catch (err: any) {
        console.warn(`[BILLING CUSTOMER] Aviso ao buscar por externalReference: ${err.message}`);
      }
    }

    // 5. Se não existir no gateway, cria explicitamente no Asaas
    if (!providerCustomerId) {
      const ministry = await this.ministryRepo.findById(ministryId);
      const ministryName = ministry?.name || `Ministério ${ministryId}`;
      const phone = options?.phone || (ministry as any)?.phone || '11999999999';

      const created = await this.provider.createCustomer({
        ministryId,
        ministryName,
        email: options?.email,
        taxId: options?.taxId,
        phone: phone,
      });
      providerCustomerId = created.providerCustomerId;
    }

    // 6. Persiste o customer canônico como 'ready' e libera o lease
    const now = new Date().toISOString();
    await this.billingRepo.setCustomer({
      id: `${ministryId}_${this.provider.name}`,
      ministry_id: ministryId,
      provider: this.provider.name,
      provider_customer_id: providerCustomerId,
      status: 'ready',
      lease_locked_until: null,
      lease_locked_by: null,
      created_at: canonicalCustomer?.created_at || now,
      updated_at: now,
    });

    return { providerCustomerId, isNew: true };
  }

  /**
   * Reconcilia ou atualiza o customer canônico no Firestore de forma segura contra webhooks históricos atrasados.
   */
  private async safeUpdateWebhookCustomer(
    ministryId: string,
    newCustomerId: string | undefined,
    options: {
      isCurrentTransitionOrActiveSub: boolean;
      nowIso: string;
    }
  ): Promise<void> {
    if (!newCustomerId || !newCustomerId.trim()) return;

    const trimmedId = newCustomerId.trim();
    const existingCust = await this.billingRepo.getCustomer(ministryId, this.provider.name);

    if (!existingCust || !existingCust.provider_customer_id) {
      await this.billingRepo.setCustomer({
        id: `${ministryId}_${this.provider.name}`,
        ministry_id: ministryId,
        provider: this.provider.name,
        provider_customer_id: trimmedId,
        status: 'ready',
        created_at: options.nowIso,
        updated_at: options.nowIso,
      });
      return;
    }

    if (existingCust.provider_customer_id === trimmedId) {
      return;
    }

    // Mismatch: o webhook traz um customer diferente do canônico atual
    if (options.isCurrentTransitionOrActiveSub) {
      console.log(
        `[BILLING WEBHOOK RECONCILE] Atualizando customer canônico para ministério ${ministryId} de ${existingCust.provider_customer_id} para ${trimmedId} (evento de assinatura/transição vigente).`
      );
      await this.billingRepo.setCustomer({
        id: `${ministryId}_${this.provider.name}`,
        ministry_id: ministryId,
        provider: this.provider.name,
        provider_customer_id: trimmedId,
        status: 'ready',
        created_at: existingCust.created_at || options.nowIso,
        updated_at: options.nowIso,
      });
    } else {
      console.log(
        `[BILLING WEBHOOK IGNORED] Ignorando atualização de customer canônico para ministério ${ministryId} de evento histórico com customer ${trimmedId}. Mantido customer canônico vigente ${existingCust.provider_customer_id}.`
      );
    }
  }

  /**
   * Inicia o fluxo de checkout gerando link hospedado no gateway.
   * Possui proteção ativa contra double checkout reutilizando sessões pendentes idênticas recentes (< 15 min).
   */
  async createCheckout(
    ministryId: string,
    userId: string,
    request: CheckoutCreationRequest
  ): Promise<CheckoutCreationResult> {
    const { planId, interval, addonBlocks = 0, successUrl, cancelUrl } = request;

    if (!(planId in PLANS_CATALOG)) {
      throw new AppError(400, `Plano inválido: ${planId}`);
    }

    if (interval !== 'monthly' && interval !== 'annual') {
      throw new AppError(400, `Intervalo de cobrança inválido: ${interval}. Use 'monthly' ou 'annual'.`);
    }

    // Se o usuário selecionar Free:
    if (planId === 'free') {
      const currentBillingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
      if (currentBillingSub && currentBillingSub.status === 'active' && currentBillingSub.plan_id !== 'free') {
        // Se já possui assinatura paga ativa, agenda o cancelamento para o fim do período
        await this.cancelSubscription(ministryId);
      } else {
        await this.subscriptionService.changePlan(ministryId, 'free');
      }
      return {
        checkoutUrl: successUrl || '/ministerio/plano',
        checkoutId: `free_${Date.now()}`,
        expiresAt: null,
        totalPriceCents: 0,
        currency: 'BRL',
      };
    }

    // 1. Obter assinatura atual vigente para verificar se a origem é Free
    const currentBillingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
    const currentAppSub = await this.subscriptionRepo.getSubscription(ministryId);

    const isSourceFree =
      (!currentBillingSub || currentBillingSub.status !== 'active' || currentBillingSub.plan_id === 'free') &&
      (!currentAppSub || currentAppSub.subscription_mode !== 'paid' || currentAppSub.plan_id === 'free');

    // =========================================================================
    // V1 INITIAL PURCHASE (FREE -> PAID) ORCHESTRATION SAGA
    // =========================================================================
    if (isSourceFree) {
      // 1. Validar contrato de destino no domínio de transição
      validateTargetContract({
        plan_id: planId,
        interval,
        addon_blocks: addonBlocks,
      });

      // 2. Construir snapshot comercial determinístico
      const commercialSnapshot = buildTransitionCommercialSnapshot(
        {
          plan_id: 'free',
          interval,
          addon_blocks: 0,
        },
        {
          plan_id: planId,
          interval,
          addon_blocks: addonBlocks,
        }
      );

      // 3. Proteção contra Double Request / Idempotência & Quarantine Recovery:
      // Se já existir um slot ativo para o ministério:
      const activeSlot = await this.billingRepo.getActiveTransitionSlot(ministryId, this.provider.name);
      if (activeSlot) {
        const existingTr = await this.billingRepo.getTransitionById(activeSlot.plan_change_id, ministryId);

        let trPlanId: string | null = null;
        let trInterval: string | null = null;
        let trAddonBlocks: number = 0;
        let trStatus: string | null = null;

        if (existingTr) {
          if (isBillingTransitionV1(existingTr)) {
            trPlanId = existingTr.target_plan_id;
            trInterval = existingTr.target_interval;
            trAddonBlocks = existingTr.target_addon_blocks;
            trStatus = existingTr.transition_status;
          } else {
            trPlanId = existingTr.requested_plan_id;
            trInterval = existingTr.requested_interval;
            trAddonBlocks = existingTr.requested_addon_blocks || 0;
            trStatus = existingTr.status;
          }
        }
        const isPending = trStatus === 'pending_initial_purchase' || trStatus === 'pending';

        // 3.1 Reutilização de checkout pendente válido e não expirado
        if (
          existingTr &&
          trPlanId === planId &&
          trInterval === interval &&
          trAddonBlocks === commercialSnapshot.target_addon_blocks &&
          existingTr.checkout_url &&
          isPending
        ) {
          if (!existingTr.expires_at || new Date(existingTr.expires_at).getTime() > Date.now()) {
            return {
              checkoutUrl: existingTr.checkout_url,
              checkoutId: existingTr.provider_checkout_id || existingTr.checkout_intent_id || activeSlot.plan_change_id,
              expiresAt: existingTr.expires_at,
              totalPriceCents: commercialSnapshot.target_future_recurring_price_cents,
              currency: 'BRL',
            };
          }
        }

        // 3.2 Se a transição V1 possui criação incerta não resolvida (OUTCOME_UNCERTAIN prévio)
        if (existingTr && isBillingTransitionV1(existingTr) && (existingTr.transition_status === 'pending_initial_purchase' || existingTr.financial_attention_required)) {
          const hasUnresolvedUncertainAttempt = existingTr.checkout_attempts?.some(
            (att) => att.status === 'uncertain' || (att.status === 'pending' && !att.provider_checkout_id)
          ) || existingTr.financial_attention_required;

          if (hasUnresolvedUncertainAttempt) {
            // Atualiza motivo para UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED mantendo a quarentena e retendo o slot
            await this.billingRepo.updateTransition(existingTr.id, ministryId, {
              financial_attention_required: true,
              financial_attention_reason: 'UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED',
              financial_safety_status: 'attention_required',
            });

            throw new AppError(409, 'Transição em quarentena de segurança financeira por criação de checkout incerta não resolvida (UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED). O tempo decorrido não autoriza novo checkout automaticamente sem evidência inequívoca de ausência de cobrança.', {
              code: 'UNCERTAIN_CHECKOUT_UNRESOLVED',
              financialAttentionRequired: true,
              uncertainUntil: existingTr.uncertain_until,
            });
          }
        }

        throw new AppError(409, 'Já existe uma transição de plano ativa em processamento para este ministério.', {
          code: 'ACTIVE_TRANSITION_EXISTS',
        });
      }

      // 4. Resolver ou criar cliente canônico no gateway
      const requestingUser = userId ? await this.userRepo.findById(userId) : null;
      const resolvedCustomer = await this.resolveOrCreateBillingCustomer(ministryId, {
        email: requestingUser?.email,
      });

      // 5. Construir entidade de persistência V1 e travar slot determinístico ANTES de qualquer mutação externa
      const transitionId = `transition_${ministryId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const checkoutIntentId = `intent_init_${ministryId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const transitionRecord = buildBillingTransitionV1Record({
        transitionId,
        ministryId,
        provider: this.provider.name,
        commercialSnapshot,
        requestedByUserId: userId,
        providerCustomerId: resolvedCustomer.providerCustomerId,
      });
      transitionRecord.checkout_intent_id = checkoutIntentId;
      transitionRecord.initial_checkout_intent_id = checkoutIntentId;

      await this.billingRepo.createTransitionAndClaimSlot(transitionRecord);

      // 6. Determinar URLs públicas de retorno
      const publicApiUrl = (config.billingPublicApiUrl || '').trim().replace(/\/+$/, '');
      if (!publicApiUrl) {
        throw new AppError(500, 'URL pública de callback do Billing não configurada.');
      }
      if (publicApiUrl.includes('localhost') || publicApiUrl.includes('127.0.0.1')) {
        throw new AppError(500, 'URL pública de callback do Billing não pode ser localhost.');
      }

      const callbackSuccessUrl = `${publicApiUrl}/api/v1/billing/checkout-return/success`;
      const callbackCancelUrl = `${publicApiUrl}/api/v1/billing/checkout-return/cancel`;
      const callbackExpiredUrl = `${publicApiUrl}/api/v1/billing/checkout-return/expired`;

      // 7. Criar Sessão de Checkout Hospedado no Provedor (Asaas) com classificação de erro
      let checkoutResult: { checkoutUrl: string; checkoutId: string; expiresAt: string | null };
      try {
        checkoutResult = await this.provider.createCheckout({
          ministryId,
          checkoutIntentId,
          providerCustomerId: resolvedCustomer.providerCustomerId,
          planId,
          planName: getPlanDefinition(planId).name,
          interval,
          addonBlocks: commercialSnapshot.target_addon_blocks,
          amountCents: commercialSnapshot.target_future_recurring_price_cents,
          successUrl: callbackSuccessUrl,
          cancelUrl: callbackCancelUrl,
          expiredUrl: callbackExpiredUrl,
        });
      } catch (providerErr: any) {
        const errorOutcome = typeof this.provider.classifyErrorOutcome === 'function'
          ? this.provider.classifyErrorOutcome(providerErr)
          : 'OUTCOME_UNCERTAIN';

        if (errorOutcome === 'DEFINITE_NO_RESOURCE_CREATED') {
          await this.billingRepo.markFinanciallySafe(transitionId, ministryId, 'failed', {
            failure_reason: providerErr.message || 'Falha na validação do checkout pelo gateway',
          });
          await this.billingRepo.releaseSlotIfOwnedAndSafe(ministryId, this.provider.name, transitionId);
        } else {
          // OUTCOME_UNCERTAIN: NÃO libera slot! Registra tentativa incerta e quarentena segura com UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED
          const nowIso = new Date().toISOString();
          const minutesToExpire = 60;
          const safetyMarginMinutes = 15;
          const uncertainUntilIso = new Date(Date.now() + (minutesToExpire + safetyMarginMinutes) * 60 * 1000).toISOString();
          const expiresAtIso = new Date(Date.now() + minutesToExpire * 60 * 1000).toISOString();

          const attemptId = `att_init_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          const uncertainAttempt: BillingCheckoutAttempt = {
            attempt_id: attemptId,
            transition_id: transitionId,
            attempt_type: 'initial_purchase',
            internal_checkout_intent_id: checkoutIntentId,
            provider_checkout_id: null,
            checkout_url: null,
            amount_cents: commercialSnapshot.target_future_recurring_price_cents,
            currency: 'BRL',
            status: 'uncertain',
            created_at: nowIso,
            checkout_requested_at: nowIso,
            checkout_minutes_to_expire: minutesToExpire,
            uncertain_until: uncertainUntilIso,
            expires_at: expiresAtIso,
          };

          await this.billingRepo.recordNewCheckoutAttempt(transitionId, ministryId, uncertainAttempt);
          await this.billingRepo.updateTransition(transitionId, ministryId, {
            transition_status: 'pending_initial_purchase',
            financial_attention_required: true,
            financial_attention_reason: 'UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED',
            financial_safety_status: 'attention_required',
            checkout_requested_at: nowIso,
            checkout_minutes_to_expire: minutesToExpire,
            uncertain_until: uncertainUntilIso,
            expires_at: expiresAtIso,
            current_initial_purchase_checkout_attempt_id: attemptId,
          });
        }
        throw providerErr;
      }

      // 8. Registrar tentativa auditável e vincular referências do provedor
      const attemptId = `att_init_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const attempt: BillingCheckoutAttempt = {
        attempt_id: attemptId,
        transition_id: transitionId,
        attempt_type: 'initial_purchase',
        internal_checkout_intent_id: checkoutIntentId,
        provider_checkout_id: checkoutResult.checkoutId,
        checkout_url: checkoutResult.checkoutUrl,
        amount_cents: commercialSnapshot.target_future_recurring_price_cents,
        currency: 'BRL',
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: checkoutResult.expiresAt,
      };

      await this.billingRepo.recordNewCheckoutAttempt(transitionId, ministryId, attempt);
      await this.billingRepo.updateTransition(transitionId, ministryId, {
        checkout_url: checkoutResult.checkoutUrl,
        initial_provider_checkout_id: checkoutResult.checkoutId,
        provider_checkout_id: checkoutResult.checkoutId,
        current_initial_purchase_checkout_attempt_id: attemptId,
        expires_at: checkoutResult.expiresAt,
      });

      return {
        checkoutUrl: checkoutResult.checkoutUrl,
        checkoutId: checkoutResult.checkoutId,
        expiresAt: checkoutResult.expiresAt,
        totalPriceCents: commercialSnapshot.target_future_recurring_price_cents,
        currency: 'BRL',
      };
    }

    // =========================================================================
    // V1 PAID -> PAID FUTURE AUTHORIZATION SAGA (PHASE 3B.1)
    // =========================================================================
    const isV1ScheduledPaid =
      !isSourceFree &&
      (request.policyVersion === 'billing_transition_v1' ||
        Boolean(currentBillingSub?.current_period_end_billing_date) ||
        Boolean((currentAppSub as any)?.current_period_end_billing_date));

    if (isV1ScheduledPaid) {
      // 1. Resolver contrato de origem a partir das autoridades internas do LouvAIO
      const sourcePlanId = (currentAppSub?.plan_id || currentBillingSub?.plan_id || 'lite') as PlanId;
      const sourceInterval = (currentBillingSub?.interval || currentAppSub?.billing_interval || 'monthly') as BillingInterval;
      const sourceAddonBlocks = currentBillingSub?.member_addon_blocks ?? currentAppSub?.member_addon_blocks ?? 0;

      const sourcePeriodStartBillingDate =
        currentBillingSub?.current_period_start_billing_date ||
        (currentBillingSub?.current_period_start ? getBillingDate(currentBillingSub.current_period_start, config.billingTimezone) : null) ||
        (currentAppSub?.current_period_start ? getBillingDate(currentAppSub.current_period_start, config.billingTimezone) : null);

      const sourcePeriodEndBillingDate =
        currentBillingSub?.current_period_end_billing_date ||
        (currentBillingSub?.current_period_end ? getBillingDate(currentBillingSub.current_period_end, config.billingTimezone) : null) ||
        (currentAppSub?.current_period_end ? getBillingDate(currentAppSub.current_period_end, config.billingTimezone) : null);

      if (!sourcePeriodStartBillingDate || !sourcePeriodEndBillingDate) {
        throw new AppError(400, 'Período corrente de faturamento obrigatório para contratos de origem pagos.', {
          code: 'INVALID_SOURCE_PERIOD',
        });
      }

      // 2. Validar contrato de destino no domínio de transição
      validateTargetContract({
        plan_id: planId,
        interval,
        addon_blocks: addonBlocks,
      });

      // 3. Classificar transição (rejeita NO-OP com 400 NO_OP_TRANSITION)
      const sourceContract = {
        plan_id: sourcePlanId,
        interval: sourceInterval,
        addon_blocks: sourceAddonBlocks,
        current_period_start: sourcePeriodStartBillingDate,
        current_period_end: sourcePeriodEndBillingDate,
      };
      const targetRequest = {
        plan_id: planId,
        interval,
        addon_blocks: addonBlocks,
      };

      classifyTransition(sourceContract, targetRequest);

      // 4. Construir snapshot comercial determinístico (Price Lock no requested_at)
      const commercialSnapshot = buildTransitionCommercialSnapshot(sourceContract, targetRequest, {
        timeZone: config.billingTimezone,
      });
      commercialSnapshot.effective_billing_date = sourcePeriodEndBillingDate;

      // 5. Proteção contra Double Request / Idempotência & Quarantine Recovery
      const activeSlot = await this.billingRepo.getActiveTransitionSlot(ministryId, this.provider.name);
      if (activeSlot) {
        const existingTr = await this.billingRepo.getTransitionById(activeSlot.plan_change_id, ministryId);

        let trPlanId: string | null = null;
        let trInterval: string | null = null;
        let trAddonBlocks: number = 0;
        let trStatus: string | null = null;

        if (existingTr) {
          if (isBillingTransitionV1(existingTr)) {
            trPlanId = existingTr.target_plan_id;
            trInterval = existingTr.target_interval;
            trAddonBlocks = existingTr.target_addon_blocks;
            trStatus = existingTr.transition_status;
          } else {
            trPlanId = existingTr.requested_plan_id;
            trInterval = existingTr.requested_interval;
            trAddonBlocks = existingTr.requested_addon_blocks || 0;
            trStatus = existingTr.status;
          }
        }
        const isPending = trStatus === 'pending_future_authorization' || trStatus === 'future_target_prepared';

        // 5.1 Reutilização de checkout pendente válido e não expirado
        if (
          existingTr &&
          trPlanId === planId &&
          trInterval === interval &&
          trAddonBlocks === commercialSnapshot.target_addon_blocks &&
          existingTr.checkout_url &&
          isPending
        ) {
          if (!existingTr.expires_at || new Date(existingTr.expires_at).getTime() > Date.now()) {
            const trFutureCheckoutId = isBillingTransitionV1(existingTr)
              ? existingTr.future_provider_checkout_id
              : existingTr.provider_checkout_id;
            return {
              checkoutUrl: existingTr.checkout_url,
              checkoutId: trFutureCheckoutId || existingTr.checkout_intent_id || activeSlot.plan_change_id,
              expiresAt: existingTr.expires_at,
              totalPriceCents: commercialSnapshot.target_future_recurring_price_cents,
              currency: 'BRL',
            };
          }
        }

        // 5.2 Se a transição V1 possui criação incerta não resolvida
        if (
          existingTr &&
          isBillingTransitionV1(existingTr) &&
          (existingTr.transition_status === 'pending_future_authorization' || existingTr.financial_attention_required)
        ) {
          const hasUnresolvedUncertainAttempt =
            existingTr.checkout_attempts?.some(
              (att) => att.status === 'uncertain' || (att.status === 'pending' && !att.provider_checkout_id)
            ) || existingTr.financial_attention_required;

          if (hasUnresolvedUncertainAttempt) {
            await this.billingRepo.updateTransition(existingTr.id, ministryId, {
              financial_attention_required: true,
              financial_attention_reason: 'UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED',
              financial_safety_status: 'attention_required',
            });

            throw new AppError(
              409,
              'Transição em quarentena de segurança financeira por criação de checkout incerta não resolvida (UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED). O tempo decorrido não autoriza novo checkout automaticamente sem evidência inequívoca de ausência de cobrança.',
              { code: 'UNCERTAIN_CHECKOUT_UNRESOLVED' }
            );
          }
        }

        throw new AppError(
          409,
          `O ministério já possui uma transição financeira ativa (slot retido pela transição ${activeSlot.plan_change_id}). Conclua ou aguarde a finalização antes de iniciar uma nova mudança.`,
          { code: 'ACTIVE_TRANSITION_SLOT_HELD' }
        );
      }

      // 6. Resolver dados do ministério e cliente canônico antes da criação da transição
      const ministry = await this.ministryRepo.findById(ministryId);
      if (!ministry) {
        throw new AppError(404, 'Ministério não encontrado.');
      }
      const requestingUser = userId ? await this.userRepo.findById(userId) : null;
      const resolvedCustomer = await this.resolveOrCreateBillingCustomer(ministryId, {
        email: requestingUser?.email,
      });

      // 7. Construir registro V1 da transição e adquirir atomicamente o slot determinístico
      const transitionId = `tr_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const internalCheckoutIntentId = `intent_${ministryId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      const transitionRecord = buildBillingTransitionV1Record({
        transitionId,
        ministryId,
        provider: this.provider.name,
        commercialSnapshot,
        requestedByUserId: userId,
        providerCustomerId: resolvedCustomer.providerCustomerId,
        oldProviderSubscriptionId: currentBillingSub?.provider_subscription_id || null,
        previousProviderSubscriptionId: currentBillingSub?.provider_subscription_id || null,
      });
      transitionRecord.checkout_intent_id = internalCheckoutIntentId;
      transitionRecord.future_checkout_intent_id = internalCheckoutIntentId;

      await this.billingRepo.createTransitionAndClaimSlot(transitionRecord);

      // 8. Resolver URLs públicas de retorno
      const publicApiUrl = (config.billingPublicApiUrl || '').trim().replace(/\/+$/, '');
      if (!publicApiUrl) {
        throw new AppError(500, 'URL pública de callback do Billing não configurada.');
      }
      if (publicApiUrl.includes('localhost') || publicApiUrl.includes('127.0.0.1')) {
        throw new AppError(500, 'URL pública de callback do Billing não pode ser localhost.');
      }

      const callbackSuccessUrl = `${publicApiUrl}/api/v1/billing/checkout-return/success`;
      const callbackCancelUrl = `${publicApiUrl}/api/v1/billing/checkout-return/cancel`;
      const callbackExpiredUrl = `${publicApiUrl}/api/v1/billing/checkout-return/expired`;
      const plan = getPlanDefinition(planId);

      // 9. Chamar gateway externo para criação de Hosted Checkout RECURRENT com first billing date = source period end
      let checkoutResult: { checkoutUrl: string; checkoutId: string; expiresAt: string | null };
      try {
        checkoutResult = await this.provider.createCheckout({
          ministryId,
          checkoutIntentId: internalCheckoutIntentId,
          providerCustomerId: resolvedCustomer.providerCustomerId,
          planId,
          planName: plan.name,
          interval,
          addonBlocks,
          amountCents: commercialSnapshot.target_future_recurring_price_cents,
          nextDueDate: commercialSnapshot.effective_billing_date,
          successUrl: callbackSuccessUrl,
          cancelUrl: callbackCancelUrl,
          expiredUrl: callbackExpiredUrl,
          customerData: {
            name: ministry.name,
            email: requestingUser?.email,
          },
        });
      } catch (err: any) {
        const outcome =
          typeof this.provider.classifyErrorOutcome === 'function'
            ? this.provider.classifyErrorOutcome(err)
            : 'OUTCOME_UNCERTAIN';

        if (outcome === 'DEFINITE_NO_RESOURCE_CREATED') {
          const attemptId = `att_fa_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          const failedAttempt: BillingCheckoutAttempt = {
            attempt_id: attemptId,
            transition_id: transitionRecord.id,
            attempt_type: 'future_authorization',
            internal_checkout_intent_id: internalCheckoutIntentId,
            amount_cents: commercialSnapshot.target_future_recurring_price_cents,
            currency: 'BRL',
            status: 'failed',
            created_at: new Date().toISOString(),
          };
          await this.billingRepo.recordNewCheckoutAttempt(transitionRecord.id, ministryId, failedAttempt);
          await this.billingRepo.markFinanciallySafe(transitionRecord.id, ministryId, 'failed', {
            failure_reason: err.message || 'Falha na validação do checkout pelo gateway',
          });
          await this.billingRepo.releaseSlotIfOwnedAndSafe(ministryId, this.provider.name, transitionRecord.id);
          throw err;
        }

        // OUTCOME_UNCERTAIN: mantém o slot e marca quarentena de atenção financeira
        const nowIso = new Date().toISOString();
        const minutesToExpire = 60;
        const safetyMarginMinutes = 15;
        const uncertainUntilIso = new Date(Date.now() + (minutesToExpire + safetyMarginMinutes) * 60 * 1000).toISOString();
        const expiresAtIso = new Date(Date.now() + minutesToExpire * 60 * 1000).toISOString();

        const attemptId = `att_fa_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const uncertainAttempt: BillingCheckoutAttempt = {
          attempt_id: attemptId,
          transition_id: transitionRecord.id,
          attempt_type: 'future_authorization',
          internal_checkout_intent_id: internalCheckoutIntentId,
          provider_checkout_id: null,
          checkout_url: null,
          amount_cents: commercialSnapshot.target_future_recurring_price_cents,
          currency: 'BRL',
          status: 'uncertain',
          created_at: nowIso,
          checkout_requested_at: nowIso,
          checkout_minutes_to_expire: minutesToExpire,
          uncertain_until: uncertainUntilIso,
          expires_at: expiresAtIso,
        };

        await this.billingRepo.recordNewCheckoutAttempt(transitionRecord.id, ministryId, uncertainAttempt);
        await this.billingRepo.updateTransition(transitionRecord.id, ministryId, {
          transition_status: 'pending_future_authorization',
          financial_attention_required: true,
          financial_attention_reason: 'UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED',
          financial_safety_status: 'attention_required',
          checkout_requested_at: nowIso,
          checkout_minutes_to_expire: minutesToExpire,
          uncertain_until: uncertainUntilIso,
          expires_at: expiresAtIso,
          current_future_checkout_attempt_id: attemptId,
        });

        throw err;
      }

      // 10. Registrar tentativa determinística concluída e vincular referências do provedor
      const attemptId = `att_fa_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      const attempt: BillingCheckoutAttempt = {
        attempt_id: attemptId,
        transition_id: transitionRecord.id,
        attempt_type: 'future_authorization',
        internal_checkout_intent_id: internalCheckoutIntentId,
        provider_checkout_id: checkoutResult.checkoutId,
        checkout_url: checkoutResult.checkoutUrl,
        amount_cents: commercialSnapshot.target_future_recurring_price_cents,
        currency: 'BRL',
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: checkoutResult.expiresAt,
      };

      await this.billingRepo.recordNewCheckoutAttempt(transitionRecord.id, ministryId, attempt);
      await this.billingRepo.updateTransition(transitionRecord.id, ministryId, {
        checkout_url: checkoutResult.checkoutUrl,
        future_provider_checkout_id: checkoutResult.checkoutId,
        provider_checkout_id: checkoutResult.checkoutId,
        current_future_checkout_attempt_id: attemptId,
        expires_at: checkoutResult.expiresAt,
      });

      return {
        checkoutUrl: checkoutResult.checkoutUrl,
        checkoutId: checkoutResult.checkoutId,
        expiresAt: checkoutResult.expiresAt,
        totalPriceCents: commercialSnapshot.target_future_recurring_price_cents,
        currency: 'BRL',
      };
    }

    // =========================================================================
    // LEGACY FLOW (PAID -> FREE, etc.) PRESERVED
    // =========================================================================
    const priceCalc = calculatePlanPriceCents(planId, interval, addonBlocks);
    const plan = getPlanDefinition(planId);

    // Proteção contra Double Checkout Legado: Reutilizar sessão pendente recente (< 15 min)
    const existingPending = await this.billingRepo.getRecentPendingPlanChange(
      ministryId,
      this.provider.name,
      planId,
      interval,
      priceCalc.addonBlocks
    );

    if (existingPending && existingPending.checkout_url) {
      return {
        checkoutUrl: existingPending.checkout_url,
        checkoutId: existingPending.provider_checkout_id || existingPending.checkout_intent_id || 'chk_pending',
        expiresAt: existingPending.expires_at,
        totalPriceCents: priceCalc.totalPriceCents,
        currency: 'BRL',
      };
    }

    // 3. Resolver ou criar cliente canônico no gateway antes da geração da sessão de checkout
    const requestingUser = userId ? await this.userRepo.findById(userId) : null;
    const resolvedCustomer = await this.resolveOrCreateBillingCustomer(ministryId, {
      email: requestingUser?.email,
    });

    // 4. Gerar identificador determinístico seguro para a intenção de checkout (externalReference)
    const checkoutIntentId = `intent_${ministryId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 5. Determinar URLs públicas de callback para o gateway (Backend é autoridade das URLs de retorno)
    const publicApiUrl = (config.billingPublicApiUrl || '').trim().replace(/\/+$/, '');
    if (!publicApiUrl) {
      throw new AppError(500, 'URL pública de callback do Billing não configurada.');
    }
    if (publicApiUrl.includes('localhost') || publicApiUrl.includes('127.0.0.1')) {
      throw new AppError(500, 'URL pública de callback do Billing não pode ser localhost.');
    }

    const callbackSuccessUrl = `${publicApiUrl}/api/v1/billing/checkout-return/success`;
    const callbackCancelUrl = `${publicApiUrl}/api/v1/billing/checkout-return/cancel`;
    const callbackExpiredUrl = `${publicApiUrl}/api/v1/billing/checkout-return/expired`;

    // 6. Criar Sessão de Checkout Hospedado no Provedor (Asaas Checkout) com o customer canônico
    const checkoutResult = await this.provider.createCheckout({
      ministryId,
      checkoutIntentId,
      providerCustomerId: resolvedCustomer.providerCustomerId,
      planId,
      planName: plan.name,
      interval,
      addonBlocks: priceCalc.addonBlocks,
      amountCents: priceCalc.totalPriceCents,
      successUrl: callbackSuccessUrl,
      cancelUrl: callbackCancelUrl,
      expiredUrl: callbackExpiredUrl,
    });

    // 7. Persistir registro isolado da transição em billing_plan_changes (NÃO altera a assinatura vigente)
    const now = new Date();
    const planChangeRecord: BillingPlanChangeRecord = {
      id: checkoutIntentId,
      ministry_id: ministryId,
      provider: this.provider.name,
      checkout_intent_id: checkoutIntentId,
      provider_checkout_id: checkoutResult.checkoutId,
      provider_customer_id: resolvedCustomer.providerCustomerId,
      requested_plan_id: planId,
      requested_interval: interval,
      requested_addon_blocks: priceCalc.addonBlocks,
      expected_amount_cents: priceCalc.totalPriceCents,
      currency: 'BRL',
      checkout_url: checkoutResult.checkoutUrl,
      previous_provider_subscription_id: currentBillingSub?.status === 'active' ? (currentBillingSub.provider_subscription_id || null) : null,
      previous_plan_id: currentBillingSub?.status === 'active' ? currentBillingSub.plan_id : null,
      previous_interval: currentBillingSub?.status === 'active' ? currentBillingSub.interval : null,
      new_provider_subscription_id: null,
      status: 'pending',
      supersede_status: currentBillingSub?.status === 'active' && currentBillingSub.provider_subscription_id ? 'pending' : 'not_applicable',
      payment_cleanup_status: currentBillingSub?.status === 'active' && currentBillingSub.provider_subscription_id ? 'pending' : 'not_applicable',
      renewal_cutoff_date: currentBillingSub?.current_period_end ? getBillingDate(currentBillingSub.current_period_end, config.billingTimezone) : null,
      created_at: now.toISOString(),
      expires_at: checkoutResult.expiresAt || new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      updated_at: now.toISOString(),
    };

    await this.billingRepo.setPlanChange(planChangeRecord);

    return {
      checkoutUrl: checkoutResult.checkoutUrl,
      checkoutId: checkoutResult.checkoutId,
      expiresAt: checkoutResult.expiresAt,
      totalPriceCents: priceCalc.totalPriceCents,
      currency: 'BRL',
    };
  }

  /**
   * Processador transacional de Webhooks do Gateway de pagamento com idempotência atômica,
   * validação de valor pago (amount validation), proteção de out-of-order e isolamento de tenant.
   */
  async handleWebhook(
    headers: Record<string, any>,
    rawBody: any,
    now: Date = new Date()
  ): Promise<{ status: string; processed: boolean; reason?: string; error?: string }> {
    // 1. Validar autenticidade do webhook (Webhook Authentication Token)
    const isValid = this.provider.validateWebhookRequest(headers, rawBody);
    if (!isValid) {
      throw new AppError(401, 'Token de autenticação de webhook inválido.');
    }

    // 2. Parsear o evento do payload
    const parsedEvent = this.provider.parseWebhookEvent(rawBody);
    if (!parsedEvent) {
      return { status: 'ok', processed: false, reason: 'unsupported_payload' };
    }

    const payloadHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(rawBody || {}))
      .digest('hex');

    const eventRecord: BillingWebhookEventRecord = {
      id: `${this.provider.name}_${parsedEvent.providerEventId}`,
      provider: this.provider.name,
      provider_event_id: parsedEvent.providerEventId,
      event_type: parsedEvent.rawEventType,
      received_at: now.toISOString(),
      processed_at: null,
      processing_status: 'processing',
      attempts: 1,
      payload_hash: payloadHash,
      error_message: null,
    };

    // 3. Registrar para controle de idempotência atômica
    // Se o evento já existir no Firestore (seja em processing ou processed), encerra imediatamente sem duplicar
    const { isDuplicate } = await this.billingRepo.registerWebhookEvent(eventRecord);
    if (isDuplicate) {
      return { status: 'ok', processed: false, reason: 'duplicate_event' };
    }

    try {
      // 4. Resolver ministério e transição associados com segurança (Tenant Resolution via IDs vinculados)
      let ministryId: string | null = null;
      let billingSub: BillingSubscriptionRecord | null = null;
      let planChange: BillingPlanChangeRecord | null = null;

      // 4.1 Busca por externalReference (checkout intent)
      if (parsedEvent.externalReference) {
        planChange = await this.billingRepo.getPlanChangeByCheckoutIntentId(
          parsedEvent.externalReference,
          this.provider.name
        );
        if (!planChange && typeof (this.billingRepo as any).getTransitionByEarlyActivationCheckoutIntentId === 'function') {
          planChange = await (this.billingRepo as any).getTransitionByEarlyActivationCheckoutIntentId(
            parsedEvent.externalReference,
            this.provider.name
          );
        }
        if (planChange) {
          ministryId = planChange.ministry_id;
        } else {
          billingSub = await this.billingRepo.getSubscriptionByCheckoutIntentId(
            parsedEvent.externalReference,
            this.provider.name
          );
          if (billingSub) {
            ministryId = billingSub.ministry_id;
          }
        }
      }

      // 4.2 Busca por provider_checkout_id
      if (!ministryId && parsedEvent.providerCheckoutId) {
        planChange = await this.billingRepo.getPlanChangeByCheckoutId(
          parsedEvent.providerCheckoutId,
          this.provider.name
        );
        if (!planChange && typeof (this.billingRepo as any).getTransitionByEarlyActivationProviderCheckoutId === 'function') {
          planChange = await (this.billingRepo as any).getTransitionByEarlyActivationProviderCheckoutId(
            parsedEvent.providerCheckoutId,
            this.provider.name
          );
        }
        if (planChange) {
          ministryId = planChange.ministry_id;
        } else {
          billingSub = await this.billingRepo.getSubscriptionByCheckoutId(
            parsedEvent.providerCheckoutId,
            this.provider.name
          );
          if (billingSub) {
            ministryId = billingSub.ministry_id;
          }
        }
      }

      // 4.2.1 Busca por providerPaymentId (ex: target renewal payment em transições agendadas V1)
      if (
        !ministryId &&
        parsedEvent.providerPaymentId &&
        typeof (this.billingRepo as any).getTransitionByFuturePaymentId === 'function'
      ) {
        planChange = await (this.billingRepo as any).getTransitionByFuturePaymentId(
          parsedEvent.providerPaymentId,
          this.provider.name
        );
        if (planChange) {
          ministryId = planChange.ministry_id;
        }
      }

      // 4.2.2 Busca por providerPaymentId em early activation
      if (
        !ministryId &&
        parsedEvent.providerPaymentId &&
        typeof (this.billingRepo as any).getTransitionByEarlyActivationPaymentId === 'function'
      ) {
        planChange = await (this.billingRepo as any).getTransitionByEarlyActivationPaymentId(
          parsedEvent.providerPaymentId,
          this.provider.name
        );
        if (planChange) {
          ministryId = planChange.ministry_id;
        }
      }

      // 4.3 Busca por provider_subscription_id real
      if (!ministryId && parsedEvent.providerSubscriptionId) {
        billingSub = await this.billingRepo.getSubscriptionByProviderSubscriptionId(
          parsedEvent.providerSubscriptionId,
          this.provider.name
        );
        if (billingSub) {
          ministryId = billingSub.ministry_id;
        } else {
          planChange = await this.billingRepo.getPlanChangeByNewSubscriptionId(
            parsedEvent.providerSubscriptionId,
            this.provider.name
          );
          if (
            !planChange &&
            typeof (this.billingRepo as any).getTransitionByFutureSubscriptionId === 'function'
          ) {
            planChange = await (this.billingRepo as any).getTransitionByFutureSubscriptionId(
              parsedEvent.providerSubscriptionId,
              this.provider.name
            );
          }
          if (planChange) {
            ministryId = planChange.ministry_id;
          }
        }
      }

      // 4.4 Busca por providerCustomerId
      if (!ministryId && parsedEvent.providerCustomerId) {
        const customer = await this.billingRepo.getCustomerByProviderId(
          parsedEvent.providerCustomerId,
          this.provider.name
        );
        if (customer) {
          ministryId = customer.ministry_id;
        }
      }

      if (!billingSub && ministryId) {
        billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
      }

      if (!planChange && parsedEvent.externalReference) {
        planChange = await this.billingRepo.getPlanChange(parsedEvent.externalReference);
      }

      if (
        !planChange &&
        parsedEvent.providerPaymentId &&
        typeof (this.billingRepo as any).getTransitionByFuturePaymentId === 'function'
      ) {
        planChange = await (this.billingRepo as any).getTransitionByFuturePaymentId(
          parsedEvent.providerPaymentId,
          this.provider.name
        );
      }

      if (
        !planChange &&
        parsedEvent.providerPaymentId &&
        typeof (this.billingRepo as any).getTransitionByEarlyActivationPaymentId === 'function'
      ) {
        planChange = await (this.billingRepo as any).getTransitionByEarlyActivationPaymentId(
          parsedEvent.providerPaymentId,
          this.provider.name
        );
      }

      if (!planChange && ministryId) {
        const activeSlot = await this.billingRepo.getActiveTransitionSlot(ministryId, this.provider.name);
        if (activeSlot) {
          planChange = await this.billingRepo.getPlanChange(activeSlot.plan_change_id);
        }
      }

      if (!ministryId) {
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'ignored',
          'Assinatura, checkout ou cliente não localizado para o evento'
        );
        return { status: 'ok', processed: false, reason: 'ministry_not_found' };
      }

      const currentAppSub = await this.subscriptionRepo.getSubscription(ministryId);

      // 5. Isolamento de Planos Cortesia (Complimentary Guard):
      if (
        currentAppSub &&
        currentAppSub.subscription_mode === 'complimentary' &&
        parsedEvent.eventType !== 'payment_confirmed' &&
        parsedEvent.eventType !== 'payment_received'
      ) {
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'ignored',
          'Evento financeiro ignorado para plano de cortesia da plataforma'
        );
        return { status: 'ok', processed: false, reason: 'complimentary_plan_preserved' };
      }

      // 5.1 Roteamento V1: Se a transição identificada for V1 com execution_strategy 'immediate_initial_purchase',
      // processa exclusivamente pelo orquestrador V1, garantindo atomicidade, invariantes temporais e liberação segura do slot.
      if (
        planChange &&
        isBillingTransitionV1(planChange) &&
        planChange.execution_strategy === 'immediate_initial_purchase'
      ) {
        return await this.handleV1InitialPurchaseWebhook(parsedEvent, planChange, now);
      }

      // 5.2 Roteamento V1: Se a transição identificada for V1 com execution_strategy 'scheduled_paid_transition' (Phase 3B.1),
      // processa pelo orquestrador de autorização futura, descobre os recursos target e avança estritamente para future_target_prepared.
      if (
        planChange &&
        isBillingTransitionV1(planChange) &&
        planChange.execution_strategy === 'scheduled_paid_transition'
      ) {
        return await this.handleV1PaidToPaidWebhook(parsedEvent, planChange, now);
      }

      // 6. Executar ação de acordo com o tipo normalizado de evento financeiro
      if (parsedEvent.eventType === 'checkout_created') {
        // Confirmação de registro do checkout no Asaas (continua em pending)
      } else if (parsedEvent.eventType === 'checkout_paid') {
        // Pagador concluiu o checkout
        if (planChange) {
          planChange.provider_checkout_id = parsedEvent.providerCheckoutId || planChange.provider_checkout_id;
          planChange.new_provider_subscription_id = parsedEvent.providerSubscriptionId || planChange.new_provider_subscription_id;
          planChange.provider_customer_id = parsedEvent.providerCustomerId || planChange.provider_customer_id;
          planChange.updated_at = now.toISOString();
          await this.billingRepo.setPlanChange(planChange);
        }
        if (parsedEvent.providerCustomerId) {
          const isCurrentTransition = Boolean(
            planChange && (planChange.status === 'pending' || planChange.status === 'superseding')
          );
          await this.safeUpdateWebhookCustomer(ministryId, parsedEvent.providerCustomerId, {
            isCurrentTransitionOrActiveSub: isCurrentTransition,
            nowIso: now.toISOString(),
          });
        }
      } else if (parsedEvent.eventType === 'checkout_canceled' || parsedEvent.eventType === 'checkout_expired') {
        if (planChange && planChange.status === 'pending') {
          planChange.status = parsedEvent.eventType === 'checkout_expired' ? 'expired' : 'canceled';
          planChange.updated_at = now.toISOString();
          await this.billingRepo.setPlanChange(planChange);
        }
      } else if (
        parsedEvent.eventType === 'subscription_created' ||
        parsedEvent.eventType === 'subscription_updated'
      ) {
        // Asaas gerou/atualizou a Subscription recorrente
        if (planChange) {
          planChange.new_provider_subscription_id = parsedEvent.providerSubscriptionId || planChange.new_provider_subscription_id;
          planChange.provider_customer_id = parsedEvent.providerCustomerId || planChange.provider_customer_id;
          planChange.updated_at = now.toISOString();
          await this.billingRepo.setPlanChange(planChange);
        }
        if (parsedEvent.providerCustomerId) {
          const isCurrentSub = Boolean(
            (planChange && planChange.status === 'pending') ||
              (billingSub &&
                billingSub.status === 'active' &&
                billingSub.provider_subscription_id === parsedEvent.providerSubscriptionId)
          );
          await this.safeUpdateWebhookCustomer(ministryId, parsedEvent.providerCustomerId, {
            isCurrentTransitionOrActiveSub: isCurrentSub,
            nowIso: now.toISOString(),
          });
        }
      } else if (parsedEvent.eventType === 'payment_confirmed' || parsedEvent.eventType === 'payment_received') {
        const targetPlan = planChange?.requested_plan_id || billingSub?.plan_id || 'free';
        const targetAddons = planChange?.requested_addon_blocks ?? billingSub?.member_addon_blocks ?? 0;
        const targetInterval = planChange?.requested_interval || billingSub?.interval || 'monthly';
        const expectedPrice = calculatePlanPriceCents(targetPlan, targetInterval, targetAddons);

        // Validação de Valor & Contrato (Amount Validation): Correspondência exata entre valor pago e plano contratado
        if (targetPlan !== 'free') {
          const paidAmountCents = parsedEvent.amountCents ?? planChange?.expected_amount_cents ?? billingSub?.amount_cents ?? 0;

          if (paidAmountCents !== expectedPrice.totalPriceCents) {
            console.error(
              `[ANOMALIA DE CONTRATO/VALOR] Valor recebido (${paidAmountCents}¢) diverge do valor esperado (${expectedPrice.totalPriceCents}¢) para o plano ${targetPlan} (${targetInterval}, ${targetAddons} blocos) no ministério ${ministryId}.`
            );
            await this.billingRepo.markWebhookEventProcessed(
              this.provider.name,
              parsedEvent.providerEventId,
              'failed',
              `Valor pago (${paidAmountCents}¢) diverge do esperado (${expectedPrice.totalPriceCents}¢) para o plano ${targetPlan}`
            );
            return { status: 'ok', processed: false, reason: 'amount_validation_failed' };
          }
        }

        const newProviderSubId =
          parsedEvent.providerSubscriptionId ||
          planChange?.new_provider_subscription_id ||
          billingSub?.provider_subscription_id ||
          null;

        const oldProviderSubId =
          planChange?.previous_provider_subscription_id ||
          (billingSub?.status === 'active' &&
          billingSub.provider_subscription_id &&
          billingSub.provider_subscription_id !== newProviderSubId
            ? billingSub.provider_subscription_id
            : null);

        // Se a transição já foi concluída anteriormente (ex: reconciliador automático venceu a corrida), trata como idempotente
        if (planChange && planChange.status === 'completed' && planChange.supersede_status === 'completed') {
          if (parsedEvent.providerPaymentId) {
            await this.billingRepo.saveTransaction({
              id: `${this.provider.name}_${parsedEvent.providerPaymentId}`,
              ministry_id: ministryId,
              provider: this.provider.name,
              provider_payment_id: parsedEvent.providerPaymentId,
              provider_subscription_id: newProviderSubId,
              amount_cents: parsedEvent.amountCents || expectedPrice.totalPriceCents,
              currency: 'BRL',
              status: 'paid',
              due_date: parsedEvent.dueDate || getCurrentBillingDate(now),
              paid_at: parsedEvent.paymentDate || now.toISOString(),
              payment_method: parsedEvent.paymentMethod,
              invoice_url: parsedEvent.invoiceUrl,
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            });
          }
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
          return { status: 'ok', processed: true, reason: 'already_completed' };
        }

        // Supersede da assinatura anterior no Asaas (inativação via PUT status INACTIVE + cleanup de cobranças futuras PENDING)
        if (oldProviderSubId && oldProviderSubId !== newProviderSubId && planChange?.supersede_status !== 'completed') {
          try {
            await this.provider.inactivateSubscription(oldProviderSubId);

            // Executar limpeza de cobranças PENDING futuras
            const cutoffEnd = planChange?.renewal_cutoff_date || billingSub?.current_period_end || null;
            const cleanupResult = await this.cleanupFuturePaymentsFromPreviousSubscription({
              oldProviderSubscriptionId: oldProviderSubId,
              currentPeriodEnd: cutoffEnd,
              ministryId,
            });

            if (!cleanupResult.success) {
              if (planChange) {
                if (cleanupResult.financialAttentionRequired) {
                  planChange.status = 'financial_attention_required';
                  planChange.supersede_status = 'financial_attention_required';
                  planChange.payment_cleanup_status = 'financial_attention_required';
                  planChange.financial_attention_required = true;
                  planChange.financial_attention_reason = cleanupResult.financialAttentionReason;
                } else {
                  planChange.status = 'superseding';
                  planChange.supersede_status = 'failed';
                  planChange.payment_cleanup_status = 'failed';
                  planChange.payment_cleanup_error = cleanupResult.error;
                  planChange.retry_count = (planChange.retry_count || 0) + 1;
                  planChange.last_retry_at = now.toISOString();
                }
                planChange.new_provider_subscription_id = newProviderSubId;
                planChange.payment_cleanup_ids = cleanupResult.removedPaymentIds;
                planChange.updated_at = now.toISOString();
                await this.billingRepo.setPlanChange(planChange);
              }

              await this.billingRepo.markWebhookEventProcessed(
                this.provider.name,
                parsedEvent.providerEventId,
                'failed',
                cleanupResult.error || 'Falha no cleanup financeiro da assinatura anterior'
              );

              return {
                status: 'error',
                processed: false,
                reason: 'supersede_inactivation_failed',
                error: cleanupResult.error,
              };
            }

            if (planChange) {
              planChange.supersede_status = 'completed';
              planChange.supersede_error = null;
              planChange.payment_cleanup_status = 'completed';
              planChange.payment_cleanup_ids = cleanupResult.removedPaymentIds;
              planChange.payment_cleanup_error = null;
            }
          } catch (cancelErr: any) {
            console.error(`[SUPERSEDE WARNING] Falha ao inativar assinatura anterior ${oldProviderSubId} no gateway Asaas:`, cancelErr);
            if (planChange) {
              planChange.supersede_status = 'failed';
              planChange.supersede_error = cancelErr.message || 'Falha ao inativar assinatura anterior';
              planChange.status = 'superseding';
              planChange.new_provider_subscription_id = newProviderSubId;
              planChange.retry_count = (planChange.retry_count || 0) + 1;
              planChange.last_retry_at = now.toISOString();
              planChange.updated_at = now.toISOString();
              await this.billingRepo.setPlanChange(planChange);
            }
            await this.billingRepo.markWebhookEventProcessed(
              this.provider.name,
              parsedEvent.providerEventId,
              'failed',
              cancelErr.message || 'Falha ao inativar assinatura anterior no Asaas'
            );
            return {
              status: 'error',
              processed: false,
              reason: 'supersede_inactivation_failed',
              error: cancelErr.message || 'Falha ao inativar assinatura anterior no Asaas',
            };
          }
        }

        // Ativar entitlement de produto no SubscriptionService
        await this.subscriptionService.changePlan(ministryId, targetPlan);
        if (targetAddons > 0) {
          await this.subscriptionService.changeMemberAddonBlocks(ministryId, targetAddons);
        } else {
          await this.subscriptionService.changeMemberAddonBlocks(ministryId, 0);
        }

        // Atualizar status de faturamento para ativo
        const updatedAppSub = await this.subscriptionRepo.getSubscription(ministryId);
        if (updatedAppSub) {
          const periodEnd = new Date(
            now.getTime() + (targetInterval === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
          ).toISOString();

          await this.subscriptionRepo.setSubscription({
            ...updatedAppSub,
            billing_status: 'active',
            billing_interval: targetInterval,
            subscription_mode: targetPlan === 'free' ? 'free' : 'paid',
            grace_period_expires_at: null,
            current_period_start: now.toISOString(),
            current_period_end: periodEnd,
            cancel_at_period_end: false,
            updated_at: now.toISOString(),
          });
        }

        // Atualizar registro oficial de BillingSubscription (promove a nova assinatura a ativa vigente)
        const newBillingSub: BillingSubscriptionRecord = {
          id: buildBillingSubscriptionId(ministryId, this.provider.name),
          ministry_id: ministryId,
          provider: this.provider.name,
          checkout_intent_id: planChange?.checkout_intent_id || billingSub?.checkout_intent_id,
          provider_checkout_id: planChange?.provider_checkout_id || parsedEvent.providerCheckoutId || billingSub?.provider_checkout_id,
          provider_subscription_id: newProviderSubId,
          provider_customer_id: parsedEvent.providerCustomerId || planChange?.provider_customer_id || billingSub?.provider_customer_id,
          plan_id: targetPlan,
          interval: targetInterval,
          member_addon_blocks: targetAddons,
          amount_cents: expectedPrice.totalPriceCents,
          status: 'active',
          started_at: billingSub?.started_at || now.toISOString(),
          current_period_start: now.toISOString(),
          current_period_end: new Date(
            now.getTime() + (targetInterval === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
          ).toISOString(),
          cancel_at_period_end: false,
          created_at: billingSub?.created_at || now.toISOString(),
          updated_at: now.toISOString(),
        };

        await this.billingRepo.setSubscription(newBillingSub);

        // Atualizar registro da transição de plano
        if (planChange) {
          planChange.status = 'completed';
          planChange.supersede_status = oldProviderSubId && oldProviderSubId !== newProviderSubId ? 'completed' : (planChange.supersede_status || 'not_applicable');
          planChange.payment_cleanup_status = oldProviderSubId && oldProviderSubId !== newProviderSubId ? (planChange.payment_cleanup_status || 'completed') : 'not_applicable';
          planChange.completed_at = now.toISOString();
          planChange.confirmed_at = planChange.confirmed_at || now.toISOString();
          planChange.new_provider_subscription_id = newProviderSubId;
          planChange.retry_locked_until = null;
          planChange.retry_locked_by = null;
          planChange.updated_at = now.toISOString();
          await this.billingRepo.setPlanChange(planChange);
        }

        if (parsedEvent.providerCustomerId) {
          await this.safeUpdateWebhookCustomer(ministryId, parsedEvent.providerCustomerId, {
            isCurrentTransitionOrActiveSub: true,
            nowIso: now.toISOString(),
          });
        }

        // Registrar transação financeira
        if (parsedEvent.providerPaymentId) {
          const transaction: BillingTransactionRecord = {
            id: `${this.provider.name}_${parsedEvent.providerPaymentId}`,
            ministry_id: ministryId,
            provider: this.provider.name,
            provider_payment_id: parsedEvent.providerPaymentId,
            provider_subscription_id: newProviderSubId,
            amount_cents: parsedEvent.amountCents || expectedPrice.totalPriceCents,
            currency: 'BRL',
            status: 'paid',
            due_date: parsedEvent.dueDate || getCurrentBillingDate(now),
            paid_at: parsedEvent.paymentDate || now.toISOString(),
            payment_method: parsedEvent.paymentMethod,
            invoice_url: parsedEvent.invoiceUrl,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          };

          await this.billingRepo.saveTransaction(transaction);
        }

        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'processed'
        );

        return { status: 'ok', processed: true };
      } else if (parsedEvent.eventType === 'payment_overdue') {
        // Proteção contra eventos de assinaturas antigas / supersedidas
        if (
          parsedEvent.providerSubscriptionId &&
          billingSub?.provider_subscription_id &&
          parsedEvent.providerSubscriptionId !== billingSub.provider_subscription_id
        ) {
          await this.billingRepo.markWebhookEventProcessed(
            this.provider.name,
            parsedEvent.providerEventId,
            'ignored',
            'Evento PAYMENT_OVERDUE de assinatura antiga/supersedida ignorado'
          );
          return { status: 'ok', processed: false, reason: 'superseded_subscription_event_ignored' };
        }

        // Proteção contra eventos fora de ordem:
        if (currentAppSub && currentAppSub.billing_status === 'active' && parsedEvent.dueDate) {
          const periodStartTime = new Date(currentAppSub.current_period_start).getTime();
          const eventDueTime = new Date(parsedEvent.dueDate).getTime();
          if (periodStartTime > eventDueTime) {
            await this.billingRepo.markWebhookEventProcessed(
              this.provider.name,
              parsedEvent.providerEventId,
              'ignored',
              'Evento PAYMENT_OVERDUE antigo ignorado por out-of-order sequence guard'
            );
            return { status: 'ok', processed: false, reason: 'out_of_order_overdue_ignored' };
          }
        }

        // Entrar em past_due e abrir carência de 7 dias se ainda não tiver
        if (currentAppSub && currentAppSub.billing_status === 'active') {
          const graceExpires = new Date(
            now.getTime() + DEFAULT_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
          ).toISOString();

          await this.subscriptionRepo.setSubscription({
            ...currentAppSub,
            billing_status: 'past_due',
            grace_period_expires_at: currentAppSub.grace_period_expires_at || graceExpires,
            updated_at: now.toISOString(),
          });
        }

        if (billingSub) {
          await this.billingRepo.setSubscription({
            ...billingSub,
            status: 'past_due',
            updated_at: now.toISOString(),
          });
        }

        if (parsedEvent.providerPaymentId) {
          await this.billingRepo.saveTransaction({
            id: `${this.provider.name}_${parsedEvent.providerPaymentId}`,
            ministry_id: ministryId,
            provider: this.provider.name,
            provider_payment_id: parsedEvent.providerPaymentId,
            amount_cents: parsedEvent.amountCents || billingSub?.amount_cents || 0,
            currency: 'BRL',
            status: 'overdue',
            due_date: parsedEvent.dueDate || getCurrentBillingDate(now),
            paid_at: null,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
          });
        }
      } else if (
        parsedEvent.eventType === 'subscription_inactivated' ||
        parsedEvent.eventType === 'subscription_canceled'
      ) {
        // Proteção contra eventos de cancelamento de assinaturas antigas / supersedidas
        if (
          parsedEvent.providerSubscriptionId &&
          billingSub?.provider_subscription_id &&
          parsedEvent.providerSubscriptionId !== billingSub.provider_subscription_id
        ) {
          await this.billingRepo.markWebhookEventProcessed(
            this.provider.name,
            parsedEvent.providerEventId,
            'ignored',
            'Evento SUBSCRIPTION_CANCELED de assinatura antiga/supersedida ignorado'
          );
          return { status: 'ok', processed: false, reason: 'superseded_subscription_event_ignored' };
        }

        if (billingSub) {
          await this.billingRepo.setSubscription({
            ...billingSub,
            status: 'canceled',
            updated_at: now.toISOString(),
          });
        }
      }

      // Marcar evento como processado com sucesso
      await this.billingRepo.markWebhookEventProcessed(
        this.provider.name,
        parsedEvent.providerEventId,
        'processed'
      );

      return { status: 'ok', processed: true };
    } catch (err: any) {
      console.error('[Billing Webhook Error]:', err);
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          err.message
        );
      }
      return { status: 'error', processed: false, error: err.message };
    }
  }

  /**
   * Agenda o cancelamento da assinatura ao fim do período atual pago (`cancel_at_period_end`).
   * Executa PUT status INACTIVE no gateway Asaas para cessar futuras renovações
   * e executa cleanup de eventuais cobranças futuras PENDING já geradas.
   */
  async cancelSubscription(ministryId: string): Promise<BillingSubscriptionRecord> {
    const billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
    if (!billingSub || billingSub.status === 'canceled') {
      throw new AppError(400, 'Não há assinatura ativa para cancelar neste ministério.');
    }

    if (billingSub.provider_subscription_id) {
      await this.provider.inactivateSubscription(billingSub.provider_subscription_id);

      // Executar limpeza de cobranças PENDING futuras
      const cleanupResult = await this.cleanupFuturePaymentsFromPreviousSubscription({
        oldProviderSubscriptionId: billingSub.provider_subscription_id,
        currentPeriodEnd: billingSub.current_period_end,
        ministryId,
      });

      if (!cleanupResult.success) {
        // Persistir registro de cancelamento/transição pendente para retry
        const nowIso = new Date().toISOString();
        const changeRecord: BillingPlanChangeRecord = {
          id: `cancel_${ministryId}_${Date.now()}`,
          ministry_id: ministryId,
          provider: this.provider.name,
          checkout_intent_id: `cancel_${ministryId}_${Date.now()}`,
          requested_plan_id: 'free',
          requested_interval: billingSub.interval,
          requested_addon_blocks: 0,
          expected_amount_cents: 0,
          currency: 'BRL',
          previous_provider_subscription_id: billingSub.provider_subscription_id,
          previous_plan_id: billingSub.plan_id,
          previous_interval: billingSub.interval,
          status: cleanupResult.financialAttentionRequired ? 'financial_attention_required' : 'superseding',
          supersede_status: cleanupResult.financialAttentionRequired ? 'financial_attention_required' : 'failed',
          payment_cleanup_status: cleanupResult.financialAttentionRequired ? 'financial_attention_required' : 'failed',
          payment_cleanup_error: cleanupResult.error,
          payment_cleanup_ids: cleanupResult.removedPaymentIds,
          financial_attention_required: cleanupResult.financialAttentionRequired,
          financial_attention_reason: cleanupResult.financialAttentionReason,
          renewal_cutoff_date: billingSub.current_period_end
            ? getBillingDate(billingSub.current_period_end, config.billingTimezone)
            : null,
          created_at: nowIso,
          expires_at: null,
          updated_at: nowIso,
        };
        await this.billingRepo.setPlanChange(changeRecord);

        throw new AppError(
          500,
          cleanupResult.financialAttentionRequired
            ? 'Identificada cobrança em processamento no gateway. O cancelamento foi registrado e requer validação financeira operacional.'
            : 'Falha ao cancelar cobrança futura no gateway Asaas. O cancelamento está em processamento e será recuperado automaticamente.'
        );
      }
    }

    const now = new Date().toISOString();
    const updatedBillingSub: BillingSubscriptionRecord = {
      ...billingSub,
      cancel_at_period_end: true,
      updated_at: now,
    };
    await this.billingRepo.setSubscription(updatedBillingSub);

    const currentAppSub = await this.subscriptionRepo.getSubscription(ministryId);
    if (currentAppSub) {
      await this.subscriptionRepo.setSubscription({
        ...currentAppSub,
        cancel_at_period_end: true,
        updated_at: now,
      });
    }

    return updatedBillingSub;
  }

  /**
   * Reativa uma assinatura que havia sido marcada com `cancel_at_period_end`.
   * Envia PUT /subscriptions/{id} com status: ACTIVE e nextDueDate derivado de current_period_end.
   */
  async reactivateSubscription(ministryId: string): Promise<BillingSubscriptionRecord> {
    const billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
    if (!billingSub || !billingSub.cancel_at_period_end) {
      throw new AppError(400, 'Não há cancelamento pendente para reativar neste ministério.');
    }

    if (billingSub.provider_subscription_id) {
      const nextDueDate = billingSub.current_period_end
        ? getBillingDate(billingSub.current_period_end)
        : getCurrentBillingDate();
      await this.provider.reactivateSubscription(billingSub.provider_subscription_id, nextDueDate);
    }

    const now = new Date().toISOString();
    const updatedBillingSub: BillingSubscriptionRecord = {
      ...billingSub,
      cancel_at_period_end: false,
      updated_at: now,
    };
    await this.billingRepo.setSubscription(updatedBillingSub);

    const currentAppSub = await this.subscriptionRepo.getSubscription(ministryId);
    if (currentAppSub) {
      await this.subscriptionRepo.setSubscription({
        ...currentAppSub,
        cancel_at_period_end: false,
        updated_at: now,
      });
    }

    return updatedBillingSub;
  }

  /**
   * Processa de forma atômica e idempotente o encerramento da assinatura antiga,
   * a remoção de cobranças futuras PENDING e a promoção da nova assinatura.
   * Utilizado pelo worker de reconciliação automática e pelo endpoint de reconciliação manual.
   */
  async processPlanChangeSupersede(
    planChangeId: string,
    lockWorkerId: string = 'worker_reconciler'
  ): Promise<{ success: boolean; planChange?: BillingPlanChangeRecord; reason?: string }> {
    const change = await this.billingRepo.claimPlanChangeForRetry(planChangeId, lockWorkerId);
    if (!change) {
      return { success: false, reason: 'already_completed_or_locked' };
    }

    try {
      const now = new Date();
      const ministryId = change.ministry_id;
      const oldSubId = change.previous_provider_subscription_id;
      const newSubId = change.new_provider_subscription_id;

      if (oldSubId && oldSubId !== newSubId && change.supersede_status !== 'completed') {
        if (change.financial_attention_required) {
          return {
            success: false,
            planChange: change,
            reason: change.financial_attention_reason || 'Intervenção financeira manual necessária',
          };
        }

        await this.provider.inactivateSubscription(oldSubId);

        const billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
        const cutoffEnd = change.renewal_cutoff_date || billingSub?.current_period_end || null;
        const cleanupResult = await this.cleanupFuturePaymentsFromPreviousSubscription({
          oldProviderSubscriptionId: oldSubId,
          currentPeriodEnd: cutoffEnd,
          ministryId,
        });

        if (!cleanupResult.success) {
          if (cleanupResult.financialAttentionRequired) {
            change.status = 'financial_attention_required';
            change.supersede_status = 'financial_attention_required';
            change.payment_cleanup_status = 'financial_attention_required';
            change.financial_attention_required = true;
            change.financial_attention_reason = cleanupResult.financialAttentionReason;
          } else {
            change.status = 'superseding';
            change.supersede_status = 'failed';
            change.payment_cleanup_status = 'failed';
            change.payment_cleanup_error = cleanupResult.error;
          }
          change.payment_cleanup_ids = cleanupResult.removedPaymentIds;
          change.retry_locked_until = null;
          change.retry_locked_by = null;
          change.updated_at = new Date().toISOString();
          await this.billingRepo.setPlanChange(change);
          return { success: false, planChange: change, reason: cleanupResult.error };
        }

        change.supersede_status = 'completed';
        change.supersede_error = null;
        change.payment_cleanup_status = 'completed';
        change.payment_cleanup_ids = cleanupResult.removedPaymentIds;
        change.payment_cleanup_error = null;
      }

      if (newSubId) {
        // Ativar entitlement de produto no SubscriptionService
        await this.subscriptionService.changePlan(ministryId, change.requested_plan_id);
        await this.subscriptionService.changeMemberAddonBlocks(ministryId, change.requested_addon_blocks || 0);

        // Atualizar status de faturamento
        const currentAppSub = await this.subscriptionRepo.getSubscription(ministryId);
        if (currentAppSub) {
          const periodEnd = new Date(
            now.getTime() + (change.requested_interval === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
          ).toISOString();

          await this.subscriptionRepo.setSubscription({
            ...currentAppSub,
            billing_status: 'active',
            billing_interval: change.requested_interval,
            subscription_mode: change.requested_plan_id === 'free' ? 'free' : 'paid',
            grace_period_expires_at: null,
            current_period_start: now.toISOString(),
            current_period_end: periodEnd,
            cancel_at_period_end: false,
            updated_at: now.toISOString(),
          });
        }

        const billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
        const expectedPrice = calculatePlanPriceCents(
          change.requested_plan_id,
          change.requested_interval,
          change.requested_addon_blocks || 0
        );

        const newBillingSub: BillingSubscriptionRecord = {
          id: buildBillingSubscriptionId(ministryId, this.provider.name),
          ministry_id: ministryId,
          provider: this.provider.name,
          checkout_intent_id: change.checkout_intent_id,
          provider_checkout_id: change.provider_checkout_id,
          provider_subscription_id: newSubId,
          provider_customer_id: change.provider_customer_id || billingSub?.provider_customer_id,
          plan_id: change.requested_plan_id,
          interval: change.requested_interval,
          member_addon_blocks: change.requested_addon_blocks || 0,
          amount_cents: change.expected_amount_cents || expectedPrice.totalPriceCents,
          status: 'active',
          started_at: billingSub?.started_at || now.toISOString(),
          current_period_start: now.toISOString(),
          current_period_end: new Date(
            now.getTime() + (change.requested_interval === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
          ).toISOString(),
          cancel_at_period_end: false,
          created_at: billingSub?.created_at || now.toISOString(),
          updated_at: now.toISOString(),
        };

        await this.billingRepo.setSubscription(newBillingSub);
      }

      change.status = 'completed';
      change.completed_at = now.toISOString();
      change.retry_locked_until = null;
      change.retry_locked_by = null;
      change.updated_at = now.toISOString();
      await this.billingRepo.setPlanChange(change);

      return { success: true, planChange: change };
    } catch (err: any) {
      change.supersede_status = 'failed';
      change.supersede_error = err.message || 'Falha ao processar supersede';
      change.retry_locked_until = null;
      change.retry_locked_by = null;
      change.updated_at = new Date().toISOString();
      await this.billingRepo.setPlanChange(change);
      return { success: false, planChange: change, reason: err.message };
    }
  }

  /**
   * Reconcilia o estado da assinatura interna com o gateway Asaas sob demanda.
   * Subscriptions 'complimentary' são ignoradas pelo reconciliador externo.
   */
  async reconcileBillingSubscription(ministryId: string): Promise<{
    ministryId: string;
    internalStatus: string;
    providerStatus?: string;
    reconciled: boolean;
    message: string;
  }> {
    const appSub = await this.subscriptionRepo.getSubscription(ministryId);
    if (appSub?.subscription_mode === 'complimentary') {
      return {
        ministryId,
        internalStatus: appSub.billing_status,
        reconciled: true,
        message: 'Plano de cortesia da plataforma não requer reconciliação com gateway externo.',
      };
    }

    // 1. Processar quaisquer supersedes que falharam ou estão pendentes neste ministério
    const failedSupersedes = await this.billingRepo.getFailedSupersedes(ministryId, this.provider.name);
    let hasFinancialAttention = false;
    for (const failedChange of failedSupersedes) {
      const procResult = await this.processPlanChangeSupersede(failedChange.id, 'manual_reconcile');
      if (procResult.planChange?.financial_attention_required) {
        hasFinancialAttention = true;
      }
    }

    if (hasFinancialAttention) {
      return {
        ministryId,
        internalStatus: 'financial_attention_required',
        providerStatus: 'INACTIVE',
        reconciled: false,
        message: 'Atenção financeira necessária: cobrança da assinatura anterior foi paga antes do cancelamento.',
      };
    }

    const billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
    if (!billingSub || !billingSub.provider_subscription_id) {
      return {
        ministryId,
        internalStatus: appSub?.billing_status || 'active',
        reconciled: true,
        message: 'Nenhuma assinatura registrada no gateway para reconciliar.',
      };
    }

    if (!this.provider.getSubscription) {
      return {
        ministryId,
        internalStatus: billingSub.status,
        reconciled: true,
        message: 'Provedor atual não expõe endpoint de consulta direta.',
      };
    }

    const providerData = await this.provider.getSubscription(billingSub.provider_subscription_id);
    if (!providerData) {
      return {
        ministryId,
        internalStatus: billingSub.status,
        providerStatus: 'NOT_FOUND',
        reconciled: false,
        message: 'Assinatura não localizada no gateway externo.',
      };
    }

    const now = new Date().toISOString();
    let reconciled = true;
    let message = 'Assinatura sincronizada com sucesso.';

    // Se o Asaas estiver ACTIVE mas o Firestore estiver past_due: recuperar
    if (providerData.status === 'ACTIVE' && billingSub.status !== 'active') {
      await this.billingRepo.setSubscription({ ...billingSub, status: 'active', updated_at: now });
      if (appSub) {
        await this.subscriptionRepo.setSubscription({
          ...appSub,
          billing_status: 'active',
          grace_period_expires_at: null,
          updated_at: now,
        });
      }
      message = 'Assinatura recuperada para ativa após sincronização.';
    } else if (
      (providerData.status === 'INACTIVE' || providerData.status === 'CANCELED') &&
      billingSub.status === 'active'
    ) {
      if (billingSub.cancel_at_period_end) {
        message = 'Assinatura com cancelamento agendado para o fim do período vigente sincronizada.';
      } else if (failedSupersedes.length > 0) {
        message = 'Assinatura anterior INACTIVE em processo de supersede/cleanup financeiro sincronizada.';
      } else {
        await this.billingRepo.setSubscription({ ...billingSub, status: 'canceled', updated_at: now });
        if (appSub) {
          await this.subscriptionRepo.setSubscription({
            ...appSub,
            billing_status: 'canceled',
            updated_at: now,
          });
        }
        message = 'Assinatura marcada como cancelada após sincronização.';
      }
    }

    return {
      ministryId,
      internalStatus: billingSub.status,
      providerStatus: providerData.status,
      reconciled,
      message,
    };
  }

  /**
   * Processador de Webhook exclusivo para a saga de Compra Inicial V1 (Free -> Paid).
   * Garante:
   * - Invariantes temporais estritas (sem +30/+365 dias fixos).
   * - Ativação de entitlement pelo SubscriptionService apenas após confirmação financeira.
   * - Liberação do active transition slot apenas após safe_terminal.
   * - Fail-closed em divergência de contrato/valor sem retenção indevida ou perda de rastro financeiro.
   */
  /**
   * Processador de Webhook exclusivo para a saga de Compra Inicial V1 (Free -> Paid).
   * Garante:
   * - Invariantes temporais estritas (sem +30/+365 dias fixos).
   * - Ativação de entitlement pelo SubscriptionService apenas após confirmação financeira.
   * - Liberação do active transition slot apenas após safe_terminal.
   * - Fail-closed em divergência de contrato/valor sem retenção indevida ou perda de rastro financeiro.
   */
  private async handleV1InitialPurchaseWebhook(
    parsedEvent: any,
    planChange: BillingTransitionV1Record,
    now: Date
  ): Promise<{ status: string; processed: boolean; reason?: string; error?: string }> {
    const ministryId = planChange.ministry_id;
    const nowIso = now.toISOString();

    // 0. Attempt-Scoped Event Resolution:
    // Localiza a tentativa exata correspondente ao evento no histórico de attempts da transição
    const attempts = planChange.checkout_attempts ? [...planChange.checkout_attempts] : [];
    let matchedAttemptIndex = -1;

    if (parsedEvent.providerCheckoutId) {
      matchedAttemptIndex = attempts.findIndex((a) => a.provider_checkout_id === parsedEvent.providerCheckoutId);
    }
    if (matchedAttemptIndex === -1 && parsedEvent.externalReference) {
      matchedAttemptIndex = attempts.findIndex((a) => a.internal_checkout_intent_id === parsedEvent.externalReference);
    }
    if (matchedAttemptIndex === -1 && planChange.current_initial_purchase_checkout_attempt_id) {
      matchedAttemptIndex = attempts.findIndex((a) => a.attempt_id === planChange.current_initial_purchase_checkout_attempt_id);
    }

    const matchedAttempt = matchedAttemptIndex !== -1 ? attempts[matchedAttemptIndex] : undefined;
    const isCurrentAttempt = !matchedAttempt ||
      !planChange.current_initial_purchase_checkout_attempt_id ||
      matchedAttempt.attempt_id === planChange.current_initial_purchase_checkout_attempt_id;

    const persistUpdatedAttempts = async () => {
      if (attempts.length > 0) {
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          checkout_attempts: attempts,
        });
      }
    };

    if (parsedEvent.eventType === 'checkout_created') {
      if (matchedAttempt && parsedEvent.providerCheckoutId) {
        matchedAttempt.provider_checkout_id = parsedEvent.providerCheckoutId;
        await persistUpdatedAttempts();
      }
      if (isCurrentAttempt && parsedEvent.providerCheckoutId && !planChange.initial_provider_checkout_id) {
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          initial_provider_checkout_id: parsedEvent.providerCheckoutId,
          provider_checkout_id: parsedEvent.providerCheckoutId,
        });
      }
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true };
    }

    if (parsedEvent.eventType === 'checkout_paid') {
      if (matchedAttempt) {
        matchedAttempt.status = 'completed';
        matchedAttempt.completed_at = nowIso;
        matchedAttempt.provider_checkout_id = parsedEvent.providerCheckoutId || matchedAttempt.provider_checkout_id;
        await persistUpdatedAttempts();
      }

      // STALE PAID EVENT GUARD:
      // Se pertence a um attempt antigo enquanto há outro attempt atual
      if (!isCurrentAttempt) {
        console.warn(
          `[STALE CHECKOUT_PAID EVENT] Evento CHECKOUT_PAID recebido para tentativa antiga ${matchedAttempt?.attempt_id} (atual: ${planChange.current_initial_purchase_checkout_attempt_id}) na transição ${planChange.id}.`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'STALE_ATTEMPT_CHECKOUT_PAID',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: true };
      }

      if (parsedEvent.providerSubscriptionId || parsedEvent.providerCustomerId) {
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          initial_provider_subscription_id: parsedEvent.providerSubscriptionId || planChange.initial_provider_subscription_id || null,
          new_provider_subscription_id: parsedEvent.providerSubscriptionId || planChange.new_provider_subscription_id || null,
          provider_customer_id: parsedEvent.providerCustomerId || planChange.provider_customer_id || null,
        });
      }
      if (parsedEvent.providerCustomerId) {
        await this.safeUpdateWebhookCustomer(ministryId, parsedEvent.providerCustomerId, {
          isCurrentTransitionOrActiveSub: true,
          nowIso,
        });
      }
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true };
    }

    if (parsedEvent.eventType === 'checkout_canceled' || parsedEvent.eventType === 'checkout_expired') {
      const terminalAttemptStatus = parsedEvent.eventType === 'checkout_expired' ? 'expired' : 'canceled';
      if (matchedAttempt) {
        matchedAttempt.status = terminalAttemptStatus;
        matchedAttempt.completed_at = nowIso;
        await persistUpdatedAttempts();
      }

      // CURRENT ATTEMPT GUARD:
      // Se o evento pertence a um attempt antigo, apenas atualiza o histórico e NÃO afeta a transição global nem libera o slot!
      if (!isCurrentAttempt) {
        console.log(
          `[STALE TERMINAL EVENT] Evento ${parsedEvent.eventType} para tentativa antiga ${matchedAttempt?.attempt_id} ignorado para efeito de transição global.`
        );
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: true };
      }

      // TERMINAL CHECKOUT EVENT SAFETY GUARD:
      // Só pode transformar em safe_terminal e liberar slot quando:
      // 1. Pertence ao current attempt
      // 2. Não existe settled payment associado
      // 3. Não existe provider subscription financeira viva conhecida
      // 4. Não existe financial attention pendente
      // 5. Transição está em pending_initial_purchase
      const hasSettledPayment = !!planChange.initial_provider_payment_id;
      const hasLiveSubscription = !!planChange.initial_provider_subscription_id;
      const hasFinancialAttention = !!planChange.financial_attention_required;

      if (
        planChange.transition_status === 'pending_initial_purchase' &&
        !hasSettledPayment &&
        !hasLiveSubscription &&
        !hasFinancialAttention
      ) {
        const terminalStatus = parsedEvent.eventType === 'checkout_expired' ? 'failed' : 'canceled';
        await this.billingRepo.markFinanciallySafe(planChange.id, ministryId, terminalStatus, {
          failure_reason: `Checkout ${parsedEvent.eventType === 'checkout_expired' ? 'expirado' : 'cancelado'} no provedor`,
        });
        await this.billingRepo.releaseSlotIfOwnedAndSafe(ministryId, this.provider.name, planChange.id);
      } else if (hasSettledPayment || hasLiveSubscription || hasFinancialAttention) {
        console.warn(
          `[TERMINAL EVENT SAFETY GUARD] Checkout ${parsedEvent.eventType} recebido para transição ${planChange.id} com recurso financeiro existente (payment: ${hasSettledPayment}, sub: ${hasLiveSubscription}, attention: ${hasFinancialAttention}). Slot retido.`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'TERMINAL_EVENT_WITH_SETTLED_PAYMENT_OR_SUBSCRIPTION',
          financial_safety_status: 'attention_required',
        });
      }

      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true };
    }

    if (parsedEvent.eventType === 'subscription_created' || parsedEvent.eventType === 'subscription_updated') {
      if (parsedEvent.providerSubscriptionId) {
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          initial_provider_subscription_id: parsedEvent.providerSubscriptionId,
          new_provider_subscription_id: parsedEvent.providerSubscriptionId,
          provider_customer_id: parsedEvent.providerCustomerId || planChange.provider_customer_id || null,
        });
      }
      if (parsedEvent.providerCustomerId) {
        await this.safeUpdateWebhookCustomer(ministryId, parsedEvent.providerCustomerId, {
          isCurrentTransitionOrActiveSub: true,
          nowIso,
        });
      }
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true };
    }

    if (parsedEvent.eventType === 'payment_confirmed' || parsedEvent.eventType === 'payment_received') {
      if (matchedAttempt) {
        matchedAttempt.status = 'completed';
        matchedAttempt.completed_at = nowIso;
        await persistUpdatedAttempts();
      }

      const expectedAmountCents = planChange.target_future_recurring_price_cents;
      const paidAmountCents = parsedEvent.amountCents ?? expectedAmountCents;

      const providerSubId =
        parsedEvent.providerSubscriptionId ||
        planChange.initial_provider_subscription_id ||
        planChange.new_provider_subscription_id ||
        `sub_init_${Date.now()}`;

      // 1. Idempotency Gate: se a transição já foi completada com segurança terminal
      if (planChange.transition_status === 'completed') {
        if (parsedEvent.providerPaymentId) {
          await this.billingRepo.saveTransaction({
            id: `${this.provider.name}_${parsedEvent.providerPaymentId}`,
            ministry_id: ministryId,
            provider: this.provider.name,
            provider_payment_id: parsedEvent.providerPaymentId,
            provider_subscription_id: providerSubId,
            amount_cents: paidAmountCents,
            currency: 'BRL',
            status: 'paid',
            due_date: parsedEvent.dueDate || getBillingDate(now, config.billingTimezone),
            paid_at: parsedEvent.confirmedDate || parsedEvent.paymentDate || nowIso,
            paid_billing_date: getBillingDate(parsedEvent.paymentDate || parsedEvent.confirmedDate || parsedEvent.dueDate || now, config.billingTimezone),
            payment_method: parsedEvent.paymentMethod,
            invoice_url: parsedEvent.invoiceUrl,
            created_at: nowIso,
            updated_at: nowIso,
          });
        }
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: true, reason: 'already_completed' };
      }

      // OLD ATTEMPT PAYMENT SAFETY: se o pagamento pertence a uma tentativa antiga e outra tentativa também foi gerada
      if (!isCurrentAttempt && planChange.initial_provider_payment_id && planChange.initial_provider_payment_id !== parsedEvent.providerPaymentId) {
        console.error(`[MULTIPLE ATTEMPTS PAYMENT] Pagamento recebido para tentativa antiga quando já existe pagamento registrado na transição ${planChange.id}.`);
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'MULTIPLE_ATTEMPTS_WITH_PAYMENT',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'failed', 'MULTIPLE_ATTEMPTS_WITH_PAYMENT');
        return { status: 'ok', processed: false, reason: 'MULTIPLE_ATTEMPTS_WITH_PAYMENT' };
      }

      // 2. Strong Readiness Gate: INITIAL_PURCHASE_PROVIDER_READY
      const readiness = checkInitialPurchaseProviderReadiness({
        transition: planChange,
        parsedEvent,
        expectedAmountCents,
        expectedCurrency: 'BRL',
      });

      if (!readiness.ready) {
        console.error(
          `[INITIAL PURCHASE READINESS GATE FAILED] ${readiness.reason} (failureCode: ${readiness.failureCode}) na transição V1 ${planChange.id} (ministério ${ministryId}).`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: readiness.reason,
          transition_status: 'financial_attention_required',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          readiness.reason
        );
        return { status: 'ok', processed: false, reason: readiness.failureCode || 'provider_readiness_failed' };
      }

      // 3. Temporal Authority Derivation:
      // financial_commercial_date: data comercial financeira confirmada pelo gateway (YYYY-MM-DD em America/Sao_Paulo).
      // financial_confirmation_instant: timestamp ISO exato se fornecido pelo gateway (com hora/minuto).
      // Se o gateway apenas forneceu uma DATE (ex: '2026-09-01'), NUNCA fabricamos meia-noite ou meio-dia;
      // usamos o instante operacional conhecido (nowIso da recepção do webhook) como timestamp do sistema (effective_at),
      // e effectiveBillingDate retém a autoridade comercial financeira do provedor.
      let effectiveBillingDate: string;
      let paymentConfirmationInstant: string;

      const rawConfirmDate = parsedEvent.confirmedDate || parsedEvent.paymentDate;
      if (rawConfirmDate && typeof rawConfirmDate === 'string' && rawConfirmDate.trim()) {
        const trimmed = rawConfirmDate.trim();
        if (trimmed.includes('T')) {
          paymentConfirmationInstant = new Date(trimmed).toISOString();
          effectiveBillingDate = getBillingDate(paymentConfirmationInstant, config.billingTimezone);
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          effectiveBillingDate = trimmed;
          paymentConfirmationInstant = nowIso;
        } else {
          paymentConfirmationInstant = nowIso;
          effectiveBillingDate = getBillingDate(now, config.billingTimezone);
        }
      } else {
        paymentConfirmationInstant = nowIso;
        effectiveBillingDate = getBillingDate(now, config.billingTimezone);
      }

      // Renewal Date Authority & Exact Calendar Cross-Check:
      // A primeira cobrança da initial purchase foi liquidada na effectiveBillingDate.
      // Calculamos a renovação comercial esperada segundo o calendário civil:
      const expectedCommercialRenewalDate = addCommercialInterval(
        effectiveBillingDate,
        planChange.target_interval,
        config.billingTimezone
      );

      let candidateNextDueDate: string | undefined =
        typeof parsedEvent.subscriptionNextDueDate === 'string' && parsedEvent.subscriptionNextDueDate.trim()
          ? parsedEvent.subscriptionNextDueDate.trim().substring(0, 10)
          : undefined;

      // Se não veio no evento ou se a data ainda aponta para o primeiro vencimento (<= effectiveBillingDate),
      // faz fresh provider read se getSubscription estiver disponível
      if (
        (!candidateNextDueDate || candidateNextDueDate <= effectiveBillingDate) &&
        providerSubId &&
        typeof (this.provider as any).getSubscription === 'function'
      ) {
        try {
          const freshSub = await (this.provider as any).getSubscription(providerSubId);
          if (freshSub && typeof freshSub.nextDueDate === 'string' && freshSub.nextDueDate.trim()) {
            candidateNextDueDate = freshSub.nextDueDate.trim().substring(0, 10);
          }
        } catch (freshErr: any) {
          console.warn(`[RENEWAL FRESH READ] Aviso ao consultar assinatura ${providerSubId}: ${freshErr.message}`);
        }
      }

      // EXACT CROSS-CHECK: Se obtivemos nextDueDate do provedor, ele DEVE corresponder EXATAMENTE ao calendário civil esperado
      if (candidateNextDueDate && /^\d{4}-\d{2}-\d{2}$/.test(candidateNextDueDate)) {
        if (candidateNextDueDate !== expectedCommercialRenewalDate) {
          console.error(
            `[RENEWAL DATE MISMATCH] nextDueDate do provedor (${candidateNextDueDate}) diverge do calendário civil comercial esperado (${expectedCommercialRenewalDate}) a partir de ${effectiveBillingDate}.`
          );
          await this.billingRepo.updateTransition(planChange.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: `Data de renovação do provedor (${candidateNextDueDate}) diverge do ciclo esperado (${expectedCommercialRenewalDate}) para intervalo ${planChange.target_interval}.`,
            transition_status: 'financial_attention_required',
            financial_safety_status: 'attention_required',
          });
          return { status: 'ok', processed: false, reason: 'RENEWAL_DATE_MISMATCH' };
        }
      }

      const nextBillingDateStr = expectedCommercialRenewalDate;
      const currentPeriodStartBillingDate = effectiveBillingDate;
      const currentPeriodEndBillingDate = nextBillingDateStr;
      const currentPeriodEndIso = new Date(`${nextBillingDateStr}T00:00:00.000Z`).toISOString();

      // 4. Activation Saga com Failure-Injection Safety e Safe Terminal Ordering
      try {
        // Step 4.1: Ativação de Entitlement no SubscriptionService (valores absolutos)
        await this.subscriptionService.changePlan(ministryId, planChange.target_plan_id);
        if (planChange.target_addon_blocks > 0) {
          await this.subscriptionService.changeMemberAddonBlocks(ministryId, planChange.target_addon_blocks);
        } else {
          await this.subscriptionService.changeMemberAddonBlocks(ministryId, 0);
        }

        // Step 4.2: Atualizar SubscriptionRepository
        const appSub = await this.subscriptionRepo.getSubscription(ministryId);
        if (appSub) {
          await this.subscriptionRepo.setSubscription({
            ...appSub,
            billing_status: 'active',
            billing_interval: planChange.target_interval,
            subscription_mode: 'paid',
            grace_period_expires_at: null,
            current_period_start: paymentConfirmationInstant,
            current_period_end: currentPeriodEndIso,
            cancel_at_period_end: false,
            updated_at: nowIso,
          });
        }

        // Step 4.3: Atualizar / Criar BillingSubscriptionRecord
        const billingSubRecord: BillingSubscriptionRecord = {
          id: buildBillingSubscriptionId(ministryId, this.provider.name),
          ministry_id: ministryId,
          provider: this.provider.name,
          plan_id: planChange.target_plan_id,
          interval: planChange.target_interval,
          member_addon_blocks: planChange.target_addon_blocks,
          amount_cents: expectedAmountCents,
          status: 'active',
          provider_subscription_id: providerSubId,
          provider_customer_id: parsedEvent.providerCustomerId || planChange.provider_customer_id || null,
          provider_checkout_id: planChange.initial_provider_checkout_id || planChange.provider_checkout_id || null,
          checkout_intent_id: planChange.initial_checkout_intent_id || planChange.checkout_intent_id || undefined,
          started_at: paymentConfirmationInstant,
          current_period_start: paymentConfirmationInstant,
          current_period_end: currentPeriodEndIso,
          current_period_start_billing_date: currentPeriodStartBillingDate,
          current_period_end_billing_date: currentPeriodEndBillingDate,
          effective_billing_date: effectiveBillingDate,
          cancel_at_period_end: false,
          created_at: nowIso,
          updated_at: nowIso,
        };
        await this.billingRepo.setSubscription(billingSubRecord);

        // Step 4.4: Persistir Transação Financeira de forma IDEMPOTENTE ANTES de marcar safe_terminal
        if (parsedEvent.providerPaymentId) {
          await this.billingRepo.saveTransaction({
            id: `${this.provider.name}_${parsedEvent.providerPaymentId}`,
            ministry_id: ministryId,
            provider: this.provider.name,
            provider_payment_id: parsedEvent.providerPaymentId,
            provider_subscription_id: providerSubId,
            amount_cents: paidAmountCents,
            currency: 'BRL',
            status: 'paid',
            due_date: parsedEvent.dueDate || effectiveBillingDate,
            paid_at: paymentConfirmationInstant,
            paid_billing_date: effectiveBillingDate,
            payment_method: parsedEvent.paymentMethod,
            invoice_url: parsedEvent.invoiceUrl,
            created_at: nowIso,
            updated_at: nowIso,
          });
        }

        // Step 4.5: Confirmar transição atomicamente como completed e safe_terminal
        await this.billingRepo.confirmInitialPurchaseActivation({
          transitionId: planChange.id,
          ministryId: ministryId,
          effectiveAt: paymentConfirmationInstant,
          effectiveBillingDate: effectiveBillingDate,
          currentPeriodStartBillingDate: currentPeriodStartBillingDate,
          currentPeriodEndBillingDate: currentPeriodEndBillingDate,
          providerSubscriptionId: providerSubId,
          providerPaymentId: parsedEvent.providerPaymentId,
          providerCustomerId: parsedEvent.providerCustomerId || planChange.provider_customer_id,
          completedAt: nowIso,
        });

        // Step 4.6: Liberar slot determinístico ativo (APENAS APÓS safe_terminal)
        await this.billingRepo.releaseSlotIfOwnedAndSafe(ministryId, this.provider.name, planChange.id);

        if (parsedEvent.providerCustomerId) {
          await this.safeUpdateWebhookCustomer(ministryId, parsedEvent.providerCustomerId, {
            isCurrentTransitionOrActiveSub: true,
            nowIso,
          });
        }

        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: true };
      } catch (activationErr: any) {
        console.error(
          `[CRITICAL V1 ACTIVATION ERROR] Falha na ativação da transição V1 após confirmação financeira: ${activationErr.message}`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: `Erro de ativação pós-pagamento confirmado: ${activationErr.message}`,
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          activationErr.message
        );
        throw activationErr;
      }
    }

    await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'ignored');
    return { status: 'ok', processed: false, reason: 'unhandled_v1_event' };
  }

  /**
   * Reconcilia uma transição de compra inicial V1 (Free -> Paid) de forma idempotente e segura.
   * Cobre:
   * A) Criação com resultado incerto (recovery via externalReference)
   * B) Checkout criado / local reference não persistida
   * C) Pagamento confirmado / ativação que falhou parcialmente
   * D) Transição completed com transação financeira ausente
   */
  async reconcileInitialPurchaseTransition(
    transitionId: string,
    lockWorkerId: string = 'worker_reconciler'
  ): Promise<{ success: boolean; transition?: BillingTransitionV1Record; reason?: string }> {
    const claimed = await this.billingRepo.claimTransitionForReconciliation(transitionId, lockWorkerId);
    if (!claimed) {
      return { success: false, reason: 'already_completed_or_locked' };
    }

    try {
      const now = new Date();
      const ministryId = claimed.ministry_id;
      const checkoutIntentId = claimed.initial_checkout_intent_id || claimed.checkout_intent_id;

      // 1. Se já está completed e safe_terminal: verificar se falta apenas salvar a transação
      if (claimed.transition_status === 'completed' && claimed.financial_safety_status === 'safe_terminal') {
        if (claimed.initial_provider_payment_id) {
          const existingTx = await this.billingRepo.getTransaction(this.provider.name, claimed.initial_provider_payment_id);
          if (!existingTx) {
            await this.billingRepo.saveTransaction({
              id: `${this.provider.name}_${claimed.initial_provider_payment_id}`,
              ministry_id: ministryId,
              provider: this.provider.name,
              provider_payment_id: claimed.initial_provider_payment_id,
              provider_subscription_id: claimed.initial_provider_subscription_id || claimed.new_provider_subscription_id,
              amount_cents: claimed.target_future_recurring_price_cents,
              currency: 'BRL',
              status: 'paid',
              due_date: claimed.effective_billing_date || getCurrentBillingDate(now, config.billingTimezone),
              paid_at: claimed.effective_at || now.toISOString(),
              paid_billing_date: claimed.effective_billing_date || getCurrentBillingDate(now, config.billingTimezone),
              created_at: now.toISOString(),
              updated_at: now.toISOString(),
            });
          }
        }
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: true, transition: claimed };
      }

      // 2. Se a transição tem checkout_url pendente ou resultado incerto: verificar no provedor se já existe assinatura/pagamento
      if (checkoutIntentId && typeof this.provider.findSubscriptionByExternalReference === 'function') {
        const remoteSub = await this.provider.findSubscriptionByExternalReference(checkoutIntentId);
        if (remoteSub && remoteSub.providerSubscriptionId) {
          // Anexar referências
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            initial_provider_subscription_id: remoteSub.providerSubscriptionId,
            new_provider_subscription_id: remoteSub.providerSubscriptionId,
            provider_customer_id: remoteSub.providerCustomerId || claimed.provider_customer_id,
            financial_attention_required: false,
            financial_attention_reason: null,
          });

          // Consultar se há pagamentos confirmados vinculados a esta assinatura
          const payments = await this.provider.listSubscriptionPayments(remoteSub.providerSubscriptionId, { status: 'CONFIRMED' });
          const confirmedPayment = payments.find((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED');

          if (confirmedPayment) {
            // Proveniência Temporal Rigorosa: a data de liquidação DEVE ser evidência financeira comprovada pelo provedor
            // (paymentDate ou clientPaymentDate). Vencimento (dueDate) ou relógio atual (now) NUNCA são substitutos de liquidação.
            const settlementDate = confirmedPayment.paymentDate || confirmedPayment.clientPaymentDate;
            if (!settlementDate) {
              console.error(
                `[RECONCILE INITIAL PURCHASE FAIL CLOSED] Pagamento ${confirmedPayment.id} possui status ${confirmedPayment.status} mas nenhuma data financeira autoritativa (paymentDate/clientPaymentDate).`
              );
              await this.billingRepo.updateTransition(claimed.id, ministryId, {
                financial_attention_required: true,
                financial_attention_reason: 'SETTLED_PAYMENT_MISSING_FINANCIAL_DATE',
                financial_safety_status: 'attention_required',
              });
              await this.billingRepo.releasePlanChangeLock(claimed.id);
              return { success: false, reason: 'SETTLED_PAYMENT_MISSING_FINANCIAL_DATE' };
            }

            // Executar ativação segura via webhook handler
            const parsedEvent: any = {
              providerEventId: `rec_${confirmedPayment.id}_${Date.now()}`,
              eventType: 'payment_confirmed',
              rawEventType: 'PAYMENT_CONFIRMED',
              providerSubscriptionId: remoteSub.providerSubscriptionId,
              providerPaymentId: confirmedPayment.id,
              providerCustomerId: remoteSub.providerCustomerId || confirmedPayment.customerId || claimed.provider_customer_id,
              externalReference: checkoutIntentId,
              amountCents: confirmedPayment.amountCents || claimed.target_future_recurring_price_cents,
              dueDate: confirmedPayment.dueDate,
              paymentDate: settlementDate,
              confirmedDate: settlementDate,
              status: confirmedPayment.status,
              subscriptionNextDueDate: remoteSub.nextDueDate,
            };

            const latestTr = await this.billingRepo.getTransitionById(claimed.id, ministryId);
            if (latestTr && isBillingTransitionV1(latestTr)) {
              await this.handleV1InitialPurchaseWebhook(parsedEvent, latestTr, now);
            }
          }
        }
      }

      await this.billingRepo.releasePlanChangeLock(claimed.id);
      const reloaded = await this.billingRepo.getTransitionById(claimed.id, ministryId);
      return { success: true, transition: (reloaded && isBillingTransitionV1(reloaded) ? reloaded : undefined) };
    } catch (err: any) {
      console.error(`[RECONCILE INITIAL PURCHASE ERROR] Falha ao reconciliar transição ${transitionId}:`, err);
      await this.billingRepo.releasePlanChangeLock(claimed.id);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Orquestrador de Webhook para transições Paid -> Paid V1 (Phase 3B.1).
   * Valida eventos de autorização futura, descobre a assinatura target e primeira cobrança,
   * executa o Target Ready Gate e avança estritamente para future_target_prepared.
   *
   * INVARIANTES RIGOROSOS DA PHASE 3B.1:
   * 1. A assinatura antiga (old_provider_subscription_id) NUNCA é inativada ou cancelada.
   * 2. Nenhuma cobrança pendente da assinatura antiga é deletada.
   * 3. Nenhum entitlement target é aplicado e nenhuma alteração no SubscriptionService é feita.
   * 4. O active transition slot NÃO é liberado ao atingir future_target_prepared.
   * 5. Nenhuma BillingTransaction é criada para a cobrança futura (que permanece PENDING).
   * 6. Desacoplamento de nextDueDate: Target Ready NÃO exige subscription.nextDueDate === effective_billing_date.
   */
  private async handleV1PaidToPaidWebhook(
    parsedEvent: ParsedWebhookEvent,
    planChange: BillingTransitionV1Record,
    now: Date
  ): Promise<{ status: string; processed: boolean; reason?: string }> {
    const ministryId = planChange.ministry_id;
    const nowIso = now.toISOString();

    // 0. Se a transição já estiver completed, tratar com idempotência terminal
    if (planChange.transition_status === 'completed') {
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true, reason: 'already_completed' };
    }

    // 0.1 Se a transição estiver scheduled:
    if (planChange.transition_status === 'scheduled') {
      // Verificar se o evento pertence ao subfluxo de early activation (adjustment avulso)
      if (this.isEarlyActivationWebhookEvent(parsedEvent, planChange)) {
        return await this.processEarlyActivationAdjustmentSettlement(parsedEvent, planChange, now);
      }

      // Processar liquidação/carência da renovação via Single State Machine (Phase 3B.3A/3B)
      if (
        parsedEvent.eventType === 'payment_confirmed' ||
        parsedEvent.eventType === 'payment_received' ||
        parsedEvent.eventType === 'payment_overdue'
      ) {
        return await this.processScheduledPaidRenewalSettlement(parsedEvent, planChange, now);
      }
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true, reason: 'scheduled_event_acknowledged' };
    }

    // 0.2 Se a transição estiver em future_target_prepared ou awaiting_old_inactivation:
    if (
      (planChange.transition_status as string) === 'future_target_prepared' ||
      planChange.transition_status === 'awaiting_old_inactivation'
    ) {
      if (parsedEvent.eventType === 'payment_confirmed' || parsedEvent.eventType === 'payment_received') {
        console.log(
          `[WEBHOOK CUTOVER ORDERING] Webhook ${parsedEvent.eventType} recebido enquanto em ${planChange.transition_status}. ` +
            `Disparando source cutover antes da liquidação da renovação.`
        );

        // 1. Executar o subfluxo de corte de origem de forma atômica/idempotente
        await this.reconcilePaidToPaidSourceCutover(
          planChange.id,
          'webhook_' + (parsedEvent.providerEventId || Date.now())
        );

        // 2. Re-ler estado fresh da transição
        const freshTr = await this.billingRepo.getTransitionById(planChange.id, ministryId);
        if (
          freshTr &&
          isBillingTransitionV1(freshTr) &&
          freshTr.transition_status === 'scheduled' &&
          freshTr.supersede_status === 'completed'
        ) {
          // 3. Somente agora que a transição está comprovadamente scheduled e origem INACTIVE, processar a liquidação
          return await this.processScheduledPaidRenewalSettlement(parsedEvent, freshTr, now);
        }

        // Se o cutover não atingiu scheduled (ex: lock ocupado pelo worker ou falha temporária),
        // NÃO ativa target. Retorna acknowledging event para que o reconciler worker conclua no ciclo seguinte.
        console.log(
          `[WEBHOOK CUTOVER ORDERING] Cutover em andamento ou não convergiu para scheduled ainda (status=${(freshTr as any)?.transition_status}). O reconciler worker convergirá.`
        );
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: false, reason: 'cutover_in_progress_reconciler_will_converge' };
      }
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true, reason: `already_${planChange.transition_status}` };
    }

    // 1. Eventos de Checkout
    if (parsedEvent.eventType === 'checkout_created') {
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true, reason: 'checkout_created' };
    }

    if (parsedEvent.eventType === 'checkout_expired' || parsedEvent.eventType === 'checkout_canceled') {
      const currentAttemptId = planChange.current_future_checkout_attempt_id;
      const currentAttempts = planChange.checkout_attempts || [];
      const matchedAttempt = currentAttempts.find(
        (att) =>
          (parsedEvent.providerCheckoutId && att.provider_checkout_id === parsedEvent.providerCheckoutId) ||
          (parsedEvent.externalReference && att.internal_checkout_intent_id === parsedEvent.externalReference)
      );

      const isCurrentAttempt = matchedAttempt && matchedAttempt.attempt_id === currentAttemptId;

      // 1. Atualizar histórico da tentativa que sofreu o cancelamento/expiração
      if (matchedAttempt) {
        matchedAttempt.status = parsedEvent.eventType === 'checkout_expired' ? 'expired' : 'canceled';
        matchedAttempt.completed_at = nowIso;
      }

      // STALE EVENT GUARD: se o evento de cancelamento refere-se a uma tentativa antiga, não altera a transição global
      if (!isCurrentAttempt) {
        console.log(
          `[STALE TERMINAL EVENT] Evento ${parsedEvent.eventType} para tentativa antiga ${matchedAttempt?.attempt_id} ignorado para efeito de transição global.`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          checkout_attempts: currentAttempts,
        });
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: true, reason: 'stale_attempt_event' };
      }

      // TARGET READY SAFETY GUARD: Se a transição já atingiu future_target_prepared, scheduled ou posterior,
      // um evento de cancelamento atrasado da sessão não desfaz a obrigação target preparada/agendada!
      const currentTrStatus = planChange.transition_status as string;
      if (
        currentTrStatus === 'future_target_prepared' ||
        currentTrStatus === 'awaiting_old_inactivation' ||
        currentTrStatus === 'scheduled' ||
        currentTrStatus === 'completed'
      ) {
        console.warn(
          `[TARGET READY NOT UNDONE] Evento ${parsedEvent.eventType} recebido para transição ${planChange.id} no status ${planChange.transition_status}. Target preservada.`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          checkout_attempts: currentAttempts,
        });
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: true, reason: 'target_already_prepared_or_active' };
      }

      // IDEMPOTENCY GUARD: se a transição já está em estado terminal (canceled / failed):
      if (planChange.transition_status === 'canceled' || planChange.transition_status === 'failed') {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: true, reason: 'already_terminal' };
      }

      // SEMÂNTICA CANÔNICA DE CANCELAMENTO SEGURO vs FALHA DEFINITIVA
      if (planChange.transition_status === 'pending_future_authorization') {
        const hasTargetPayment = !!planChange.future_provider_payment_id || !!(planChange as any).new_provider_payment_id;
        const hasTargetSub = !!planChange.future_provider_subscription_id || !!(planChange as any).new_provider_subscription_id;
        const hasFinancialAttention = !!planChange.financial_attention_required;

        if (hasTargetPayment || hasTargetSub || hasFinancialAttention) {
          console.warn(
            `[TERMINAL EVENT SAFETY GUARD] Checkout ${parsedEvent.eventType} recebido para transição ${planChange.id} com recurso target existente (payment: ${hasTargetPayment}, sub: ${hasTargetSub}, attention: ${hasFinancialAttention}). Slot retido.`
          );
          await this.billingRepo.updateTransition(planChange.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'TERMINAL_EVENT_WITH_TARGET_RESOURCES',
            financial_safety_status: 'attention_required',
            checkout_attempts: currentAttempts,
          });
        } else {
          // Explicit safe cancellation -> 'canceled'
          // Definitive failure (ex: expirado sem pagamento) -> 'failed'
          const terminalStatus: 'canceled' | 'failed' = parsedEvent.eventType === 'checkout_canceled' ? 'canceled' : 'failed';
          const failureReason = parsedEvent.eventType === 'checkout_canceled'
            ? 'Checkout canceled by user/provider'
            : `Checkout ${parsedEvent.eventType}`;

          await this.billingRepo.updateTransition(planChange.id, ministryId, {
            transition_status: terminalStatus,
            status: terminalStatus,
            financial_safety_status: 'safe_terminal',
            financial_attention_required: false,
            failure_reason: failureReason,
            checkout_attempts: currentAttempts,
            completed_at: nowIso,
          });

          await this.billingRepo.releaseSlotIfOwnedAndSafe(ministryId, this.provider.name, planChange.id);
        }
      }

      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true, reason: parsedEvent.eventType };
    }

    // 2. CHECKOUT_PAID / SUBSCRIPTION_CREATED / SUBSCRIPTION_UPDATED / PAYMENT_CONFIRMED / PAYMENT_RECEIVED / unknown
    // Webhook recovery: se o evento traz providerCheckoutId e a transição ainda não possuía o ID registrado (ex: uncertain create):
    if (parsedEvent.providerCheckoutId && !planChange.future_provider_checkout_id) {
      const currentAttempts = planChange.checkout_attempts || [];
      const updatedAttempts = currentAttempts.map((att) =>
        !att.provider_checkout_id
          ? { ...att, provider_checkout_id: parsedEvent.providerCheckoutId }
          : att
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        future_provider_checkout_id: parsedEvent.providerCheckoutId,
        checkout_attempts: updatedAttempts,
      });
      planChange.future_provider_checkout_id = parsedEvent.providerCheckoutId;
    }

    let targetSubId =
      parsedEvent.providerSubscriptionId ||
      planChange.future_provider_subscription_id ||
      planChange.new_provider_subscription_id;

    // Se ainda não temos targetSubId, tentar buscar via cobranças da sessão de checkout no provedor (caminho documentado Asaas: GET /v3/payments?checkoutSession=...)
    const effectiveCheckoutId =
      parsedEvent.providerCheckoutId ||
      planChange.future_provider_checkout_id ||
      planChange.checkout_attempts?.find((a) => a.provider_checkout_id)?.provider_checkout_id;

    let sessionPayments: ProviderPaymentRecord[] = [];
    if (effectiveCheckoutId && typeof this.provider.listPaymentsByCheckoutSession === 'function') {
      const res = await this.provider.listPaymentsByCheckoutSession(effectiveCheckoutId);
      if (Array.isArray(res)) {
        sessionPayments = res;
      }
    }

    if (!targetSubId && sessionPayments.length > 0) {
      const linkedSub = sessionPayments.find((p) => p.subscriptionId)?.subscriptionId;
      if (linkedSub) {
        targetSubId = linkedSub;
      }
    }

    let targetSub: any = null;
    if (targetSubId && typeof this.provider.getSubscription === 'function') {
      targetSub = await this.provider.getSubscription(targetSubId);
    }

    // Descobrir pagamentos da assinatura target
    let firstPayment: any = null;

    // WEBHOOK EXACT PAYMENT FAST PATH (Seção 4):
    // Se o evento recebido fornecer providerPaymentId, consultar diretamente a cobrança exata como autoridade primária
    if (parsedEvent.providerPaymentId && typeof (this.provider as any).getPayment === 'function') {
      const exactPayment = await (this.provider as any).getPayment(parsedEvent.providerPaymentId);
      if (exactPayment) {
        if (!targetSubId && exactPayment.subscriptionId) {
          targetSubId = exactPayment.subscriptionId;
        }
        if (!targetSubId || !exactPayment.subscriptionId || exactPayment.subscriptionId === targetSubId) {
          firstPayment = exactPayment;
        }
      }
    }

    if (!firstPayment && targetSubId && typeof this.provider.listSubscriptionPayments === 'function') {
      const payments = await this.provider.listSubscriptionPayments(targetSubId, { status: 'ALL' });
      if (Array.isArray(payments) && payments.length > 0) {
        // SECOND CYCLE PROTECTION (Seção 9):
        // Filtrar candidatos que correspondem à primeira obrigação contratual exata
        const candidatePayments = payments.filter((p) => {
          const pDueDate = (p.originalDueDate || p.dueDate || '').trim().substring(0, 10);
          return (
            pDueDate === planChange.effective_billing_date &&
            p.amountCents === planChange.target_future_recurring_price_cents
          );
        });

        if (candidatePayments.length === 1) {
          firstPayment = candidatePayments[0];
        } else if (candidatePayments.length > 1) {
          console.error(
            `[AMBIGUOUS TARGET PAYMENTS] Assinatura target ${targetSubId} possui múltiplos pagamentos para a mesma boundary ${planChange.effective_billing_date}.`
          );
          await this.billingRepo.updateTransition(planChange.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'AMBIGUOUS_TARGET_PAYMENTS',
            financial_safety_status: 'attention_required',
          });
          return { status: 'ok', processed: false, reason: 'AMBIGUOUS_TARGET_PAYMENTS' };
        } else if (payments.length > 0) {
          firstPayment = payments[0];
        }
      }
    }
    if (!firstPayment && sessionPayments.length > 0) {
      firstPayment =
        sessionPayments.find((p) => !p.subscriptionId || p.subscriptionId === targetSubId) || sessionPayments[0];
    }

    let subValCents = parsedEvent.subscriptionValueCents;
    if (subValCents === undefined && targetSub) {
      if (targetSub.valueCents !== undefined) {
        subValCents = targetSub.valueCents;
      } else if (targetSub.value !== undefined) {
        subValCents = providerBrlDecimalToCents(targetSub.value);
      }
    }
    if (subValCents === undefined) {
      subValCents = planChange.target_future_recurring_price_cents;
    }

    let subCycle: BillingInterval | undefined;
    if (parsedEvent.subscriptionCycle) {
      subCycle = parsedEvent.subscriptionCycle;
    } else if (targetSub?.cycle === 'YEARLY' || targetSub?.cycle === 'annual') {
      subCycle = 'annual';
    } else if (targetSub?.cycle === 'MONTHLY' || targetSub?.cycle === 'monthly') {
      subCycle = 'monthly';
    }

    // Executar o Target Ready Gate
    const readyResult = verifyPaidToPaidTargetReadyGate({
      transition: planChange,
      targetCustomerId: parsedEvent.providerCustomerId || targetSub?.customer || planChange.provider_customer_id,
      providerSubscriptionId: targetSubId,
      subscriptionCycle: subCycle || planChange.target_interval,
      subscriptionValueCents: subValCents,
      subscriptionStatus: targetSub?.status,
      subscriptionNextDueDate: targetSub?.nextDueDate || parsedEvent.subscriptionNextDueDate,
      firstPayment: firstPayment
        ? {
            id: firstPayment.id,
            subscriptionId: firstPayment.subscriptionId || targetSubId,
            customerId: firstPayment.customerId || planChange.provider_customer_id,
            amountCents: firstPayment.amountCents || planChange.target_future_recurring_price_cents,
            dueDate: firstPayment.dueDate,
            status: firstPayment.status,
          }
        : null,
      checkoutSessionId: parsedEvent.providerCheckoutId || planChange.future_provider_checkout_id,
      externalReference: parsedEvent.externalReference || planChange.future_checkout_intent_id,
    });

    if (readyResult.ready && firstPayment && targetSubId) {
      // TARGET READY ALCANÇADO:
      // Transição avança estritamente para future_target_prepared
      // Preserva referências do provedor write-once
      // O active transition slot NÃO É LIBERADO!
      // NÃO altera SubscriptionService entitlement!
      // NÃO inativa assinatura antiga!
      // NÃO cria BillingTransaction!
      const currentAttempts = planChange.checkout_attempts || [];
      const updatedAttempts = currentAttempts.map((att) =>
        att.attempt_id === planChange.current_future_checkout_attempt_id
          ? {
              ...att,
              status: 'completed' as const,
              completed_at: nowIso,
              provider_checkout_id: parsedEvent.providerCheckoutId || att.provider_checkout_id,
            }
          : att
      );

      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        transition_status: 'future_target_prepared',
        status: 'pending',
        future_provider_checkout_id: parsedEvent.providerCheckoutId || planChange.future_provider_checkout_id,
        future_provider_subscription_id: targetSubId,
        new_provider_subscription_id: targetSubId,
        future_provider_payment_id: firstPayment.id,
        target_ready_verified_at: nowIso,
        checkout_attempts: updatedAttempts,
        financial_attention_required: false,
        financial_attention_reason: null,
        financial_safety_status: 'live',
      });

      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true, reason: 'future_target_prepared' };
    }

    if (readyResult.failureCode === 'PAYMENT_NOT_YET_VISIBLE') {
      // Estado seguro temporário: salva assinatura descoberta e mantém pending_future_authorization
      if (targetSubId) {
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          future_provider_subscription_id: targetSubId,
          new_provider_subscription_id: targetSubId,
        });
      }
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: false, reason: 'PAYMENT_NOT_YET_VISIBLE' };
    }

    // Mismatch real do provedor: fail closed!
    await this.billingRepo.updateTransition(planChange.id, ministryId, {
      financial_attention_required: true,
      financial_attention_reason: readyResult.reason,
      financial_safety_status: 'attention_required',
    });

    await this.billingRepo.markWebhookEventProcessed(
      this.provider.name,
      parsedEvent.providerEventId,
      'ignored',
      readyResult.reason
    );
    return { status: 'ok', processed: false, reason: readyResult.failureCode };
  }

  /**
   * Reconcilia uma transição Paid -> Paid em autorização futura de forma idempotente e segura (Phase 3B.1).
   * Descobre a assinatura e primeira cobrança target, executa o Target Ready Gate e
   * avança estritamente para future_target_prepared com retenção do slot.
   */
  async reconcilePaidToPaidFutureAuthorization(
    transitionId: string,
    lockWorkerId: string = 'worker_reconciler'
  ): Promise<{ success: boolean; transition?: BillingTransitionV1Record; reason?: string }> {
    const claimed = await this.billingRepo.claimTransitionForReconciliation(transitionId, lockWorkerId);
    if (!claimed) {
      return { success: false, reason: 'already_completed_or_locked' };
    }

    try {
      const ministryId = claimed.ministry_id;
      const checkoutIntentId = claimed.future_checkout_intent_id || claimed.checkout_intent_id;

      // Se já está future_target_prepared, nada a fazer
      if (claimed.transition_status === 'future_target_prepared') {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: true, transition: claimed };
      }

      // 1. Descobrir candidatos à assinatura target
      // Cadeia canônica: internal future_authorization attempt -> known provider checkout ID -> payments?checkoutSession -> target subscription -> first target payment
      const candidateSubIds: string[] = [];

      if (claimed.future_provider_subscription_id) {
        candidateSubIds.push(claimed.future_provider_subscription_id);
      } else if (claimed.new_provider_subscription_id) {
        candidateSubIds.push(claimed.new_provider_subscription_id);
      }

      const attemptCheckoutId =
        claimed.future_provider_checkout_id ||
        claimed.checkout_attempts?.find((a) => a.provider_checkout_id)?.provider_checkout_id;

      // Se ainda não temos assinatura registrada:
      if (candidateSubIds.length === 0) {
        if (attemptCheckoutId) {
          // CASO A: provider_checkout_id É CONHECIDO -> usar caminho documentado: GET /v3/payments?checkoutSession=<checkoutId>
          if (typeof this.provider.listPaymentsByCheckoutSession === 'function') {
            const rawPayments = await this.provider.listPaymentsByCheckoutSession(attemptCheckoutId);
            const checkoutPayments = Array.isArray(rawPayments) ? rawPayments : [];

            if (checkoutPayments.length === 0) {
              // 0 cobranças encontradas para a sessão de checkout conhecida: usuário ainda não concluiu ou gateway ainda não materializou
              await this.billingRepo.releasePlanChangeLock(claimed.id);
              return { success: false, reason: 'checkout_pending_user_action' };
            }

            // Extrair candidate subscriptions das cobranças retornadas
            const distinctSubIds = Array.from(
              new Set(checkoutPayments.map((p) => p.subscriptionId).filter((id): id is string => Boolean(id)))
            );

            for (const subId of distinctSubIds) {
              if (!candidateSubIds.includes(subId)) {
                candidateSubIds.push(subId);
              }
            }
          }
        } else {
          // CASO B: provider_checkout_id É DESCONHECIDO (criação incerta por timeout sem ID)
          // O Asaas NÃO expõe endpoint documentado para buscar Checkouts por externalReference.
          // NÃO inventar endpoints, NÃO fazer blind retry e NÃO inferir ausência por decurso de tempo.
          // A transição permanece em financial_attention_required com o slot HELD até receber webhook correlacionável ou intervenção operacional.
          await this.billingRepo.releasePlanChangeLock(claimed.id);
          return { success: false, reason: 'uncertain_create_awaiting_webhook_or_manual_resolution' };
        }
      }

      // Se não há nenhuma assinatura target candidata identificada:
      if (candidateSubIds.length === 0) {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'checkout_pending_user_action' };
      }

      // Se há 2+ candidatas plausíveis concorrentes: fail-closed determinístico!
      // NÃO escolher primeiro/latest arbitrariamente. Acionar financial_attention_required, reter slot e NÃO tocar source subscription.
      if (candidateSubIds.length > 1) {
        console.error(
          `[AMBIGUOUS TARGET RESOURCES] Transição ${claimed.id} possui ${candidateSubIds.length} assinaturas candidatas para a sessão ${attemptCheckoutId}. Acionando financial_attention_required.`
        );
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'AMBIGUOUS_TARGET_RESOURCES',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'AMBIGUOUS_TARGET_RESOURCES' };
      }

      // Exatamente 1 candidato unicamente correlacionado
      const targetSubId = candidateSubIds[0];
      let targetSub: any = null;
      if (typeof this.provider.getSubscription === 'function') {
        targetSub = await this.provider.getSubscription(targetSubId);
      }

      if (!targetSub) {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'subscription_not_found' };
      }

      // Descobrir pagamentos da assinatura target
      let payments: ProviderPaymentRecord[] = [];
      if (typeof this.provider.listSubscriptionPayments === 'function') {
        const subPaymentsRes = await this.provider.listSubscriptionPayments(targetSubId, { status: 'ALL' });
        if (Array.isArray(subPaymentsRes)) {
          payments = subPaymentsRes;
        }
      }
      if (payments.length === 0 && attemptCheckoutId && typeof this.provider.listPaymentsByCheckoutSession === 'function') {
        const checkoutPaymentsRes = await this.provider.listPaymentsByCheckoutSession(attemptCheckoutId);
        if (Array.isArray(checkoutPaymentsRes)) {
          payments = checkoutPaymentsRes;
        }
      }

      const subPayments = payments.filter((p) => !p.subscriptionId || p.subscriptionId === targetSubId);
      if (subPayments.length === 0) {
        // Primeira cobrança ainda não visível no gateway
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          future_provider_subscription_id: targetSubId,
          new_provider_subscription_id: targetSubId,
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'payment_not_yet_visible' };
      }

      // SECOND CYCLE PROTECTION (Seção 9):
      // Filtrar candidatos que correspondem à primeira obrigação contratual exata
      const candidatePayments = subPayments.filter((p) => {
        const pDueDate = (p.originalDueDate || p.dueDate || '').trim().substring(0, 10);
        return (
          pDueDate === claimed.effective_billing_date &&
          p.amountCents === claimed.target_future_recurring_price_cents
        );
      });

      if (candidatePayments.length > 1) {
        console.error(
          `[AMBIGUOUS TARGET PAYMENTS] Assinatura target ${targetSubId} possui múltiplos pagamentos (${candidatePayments.length}) para a boundary ${claimed.effective_billing_date}.`
        );
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'AMBIGUOUS_TARGET_PAYMENTS',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'AMBIGUOUS_TARGET_PAYMENTS' };
      }

      const firstPayment = candidatePayments.length === 1 ? candidatePayments[0] : subPayments[0];

      let subValCents: number | undefined = targetSub?.valueCents;
      if (subValCents === undefined && targetSub?.value !== undefined) {
        subValCents = providerBrlDecimalToCents(targetSub.value);
      }
      if (subValCents === undefined) {
        subValCents = claimed.target_future_recurring_price_cents;
      }

      let subCycle: BillingInterval | undefined;
      if (targetSub?.cycle === 'YEARLY' || targetSub?.cycle === 'annual') subCycle = 'annual';
      else if (targetSub?.cycle === 'MONTHLY' || targetSub?.cycle === 'monthly') subCycle = 'monthly';

      const readyResult = verifyPaidToPaidTargetReadyGate({
        transition: claimed,
        targetCustomerId: targetSub?.customer || targetSub?.providerCustomerId || claimed.provider_customer_id,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: subCycle || claimed.target_interval,
        subscriptionValueCents: subValCents,
        subscriptionStatus: targetSub?.status,
        subscriptionNextDueDate: targetSub?.nextDueDate,
        firstPayment: {
          id: firstPayment.id,
          subscriptionId: firstPayment.subscriptionId || targetSubId,
          customerId: firstPayment.customerId || claimed.provider_customer_id,
          amountCents: firstPayment.amountCents || claimed.target_future_recurring_price_cents,
          dueDate: firstPayment.dueDate,
          status: firstPayment.status,
        },
        checkoutSessionId: claimed.checkout_attempts?.[0]?.provider_checkout_id,
        externalReference: claimed.future_checkout_intent_id || claimed.checkout_intent_id,
      });

      if (readyResult.ready) {
        const currentAttempts = claimed.checkout_attempts || [];
        const updatedAttempts = currentAttempts.map((att) =>
          att.attempt_id === claimed.current_future_checkout_attempt_id
            ? { ...att, status: 'completed' as const, completed_at: new Date().toISOString() }
            : att
        );

        // Prova positiva estrita obtida: limpar financial_attention_required originada por criação incerta
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          transition_status: 'future_target_prepared',
          future_provider_subscription_id: targetSubId,
          new_provider_subscription_id: targetSubId,
          future_provider_payment_id: firstPayment.id,
          target_ready_verified_at: new Date().toISOString(),
          financial_attention_required: false,
          financial_attention_reason: null,
          financial_safety_status: 'live',
          status: 'pending',
          checkout_attempts: updatedAttempts,
        });

        await this.billingRepo.releasePlanChangeLock(claimed.id);
        const reloaded = await this.billingRepo.getTransitionById(claimed.id, ministryId);
        return { success: true, transition: reloaded && isBillingTransitionV1(reloaded) ? reloaded : undefined };
      }

      if (readyResult.failureCode === 'PAYMENT_NOT_YET_VISIBLE') {
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          future_provider_subscription_id: targetSubId,
          new_provider_subscription_id: targetSubId,
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'payment_not_yet_visible' };
      }

      // Mismatch real: falha estrita no Target Ready Gate
      await this.billingRepo.updateTransition(claimed.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: readyResult.reason,
        financial_safety_status: 'attention_required',
      });
      await this.billingRepo.releasePlanChangeLock(claimed.id);
      return { success: false, reason: readyResult.failureCode };
    } catch (err: any) {
      console.error(`[RECONCILE PAID TO PAID ERROR] Falha ao reconciliar transição ${transitionId}:`, err);
      await this.billingRepo.releasePlanChangeLock(claimed.id);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Phase 3B.2: Paid -> Paid Source Recurrence Cutover & Scheduling
   * Executa a transição da recorrência de origem para scheduled:
   * future_target_prepared -> awaiting_old_inactivation -> scheduled
   *
   * Invariantes críticas:
   * 1. Revalidação estrita do Target Ready Gate antes de tocar na assinatura de origem.
   * 2. Inativação (PUT status INACTIVE) da assinatura de origem sem updatePendingPayments.
   *    NUNCA chamar DELETE na assinatura de origem.
   * 3. Remoção criteriosa de cobranças futuras PENDING da assinatura de origem com dueDate >= renewalCutoffDate.
   *    Preservação estrita de cobranças CONFIRMED, RECEIVED, OVERDUE ou com dueDate < cutoff.
   * 4. Race condition guard: Fresh read do payment antes da exclusão. Se o payment se tornou CONFIRMED/RECEIVED,
   *    NÃO excluir, NÃO estornar, acionar financial_attention_required com SOURCE_PAYMENT_SETTLED_DURING_CUTOVER.
   * 5. Re-verificação de sanidade do provedor após cleanup (source INACTIVE, sem cobranças futuras PENDING).
   * 6. Revalidação final do target antes de marcar scheduled.
   * 7. Slot de transição ativa PERMANECE HELD em scheduled (não é liberado).
   * 8. Entitlement runtime LouvAIO NÃO é promovido (cliente continua usufruindo do plano de origem até a virada civil).
   * 9. Nenhuma BillingTransaction é criada para cobranças PENDING ou exclusões de cobrança.
   */
  async cutoverPaidToPaidSourceRecurrence(
    transitionId: string,
    actor: string = 'worker'
  ): Promise<{ success: boolean; reason?: string; transition?: BillingTransitionV1Record }> {
    const claimed = await this.billingRepo.claimPlanChangeForRetry(transitionId, actor, 60000);
    if (!claimed) {
      return { success: false, reason: 'locked_by_another_worker' };
    }

    const ministryId = claimed.ministry_id;

    try {
      if (!isBillingTransitionV1(claimed)) {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'unsupported_policy_version' };
      }

      if (claimed.execution_strategy !== 'scheduled_paid_transition') {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'unsupported_execution_strategy' };
      }

      // Se já alcançou scheduled, nada a fazer
      if (claimed.transition_status === 'scheduled') {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: true, transition: claimed };
      }

      // Precondição: deve estar em future_target_prepared ou awaiting_old_inactivation
      if (
        claimed.transition_status !== 'future_target_prepared' &&
        claimed.transition_status !== 'awaiting_old_inactivation'
      ) {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'invalid_entry_transition_status' };
      }

      // Se atenção financeira estiver ativada, fail closed
      if (claimed.financial_attention_required === true) {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'financial_attention_required' };
      }

      // Verificar posse legítima do active transition slot
      const currentSlot = await this.billingRepo.getActiveTransitionSlot(ministryId, this.provider.name);
      if (!currentSlot || currentSlot.plan_change_id !== claimed.id) {
        console.error(`[CUTOVER GUARD] Slot ativo ausente ou pertencente a outra transição para ministério ${ministryId}`);
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'ACTIVE_SLOT_MISMATCH',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'ACTIVE_SLOT_MISMATCH' };
      }

      // 2. Resolver authoritative cutoff date com estrita correspondência de fronteira comercial (Section 6)
      if (
        !claimed.effective_billing_date ||
        !claimed.current_period_end_billing_date ||
        claimed.effective_billing_date !== claimed.current_period_end_billing_date
      ) {
        console.error(
          `[CUTOVER GUARD] Fronteira comercial inválida ou divergente: effective=${claimed.effective_billing_date}, periodEnd=${claimed.current_period_end_billing_date}`
        );
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'COMMERCIAL_BOUNDARY_MISMATCH',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'COMMERCIAL_BOUNDARY_MISMATCH' };
      }

      const renewalCutoffDate = claimed.effective_billing_date;

      // Identificar assinatura target
      const targetSubId =
        claimed.future_provider_subscription_id || claimed.new_provider_subscription_id;
      if (!targetSubId) {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'missing_target_provider_subscription_id' };
      }

      // Identificar assinatura source
      let sourceSubId =
        claimed.old_provider_subscription_id || claimed.previous_provider_subscription_id;
      if (!sourceSubId) {
        const activeSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
        if (activeSub?.provider_subscription_id) {
          sourceSubId = activeSub.provider_subscription_id;
        }
      }

      if (!sourceSubId) {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'missing_source_provider_subscription_id' };
      }

      // Invariante crítica: sourceSubId !== targetSubId
      if (sourceSubId === targetSubId) {
        console.error(`[CUTOVER GUARD] Colisão de assinaturas: sourceSubId === targetSubId (${sourceSubId})`);
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'SOURCE_TARGET_SUBSCRIPTION_COLLISION',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'SOURCE_TARGET_SUBSCRIPTION_COLLISION' };
      }

      // Verificar obrigações pré-existentes na source com dueDate >= renewalCutoffDate (Preserve != Safe, Sections 2 & 3)
      let initialSourcePayments: ProviderPaymentRecord[] = [];
      if (typeof this.provider.listSubscriptionPayments === 'function') {
        const initPList = await this.provider.listSubscriptionPayments(sourceSubId, { status: 'ALL' });
        if (Array.isArray(initPList)) initialSourcePayments = initPList;
      }

      const preExistingBoundaryPayments = initialSourcePayments.filter(
        (p) => (!p.subscriptionId || p.subscriptionId === sourceSubId) && p.dueDate && p.dueDate >= renewalCutoffDate
      );

      for (const pay of preExistingBoundaryPayments) {
        if (pay.status === 'CONFIRMED' || pay.status === 'RECEIVED') {
          console.error(
            `[CUTOVER GUARD] Cobrança source pré-existente liquidada encontrada para boundary >= ${renewalCutoffDate}: ${pay.id} (${pay.status})`
          );
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'SOURCE_PAYMENT_ALREADY_SETTLED',
            financial_safety_status: 'attention_required',
          });
          await this.billingRepo.releasePlanChangeLock(claimed.id);
          return { success: false, reason: 'SOURCE_PAYMENT_ALREADY_SETTLED' };
        }

        if (pay.status === 'OVERDUE') {
          console.error(
            `[CUTOVER GUARD] Cobrança source pré-existente vencida (OVERDUE) encontrada para boundary >= ${renewalCutoffDate}: ${pay.id}`
          );
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'SOURCE_PAYMENT_OVERDUE',
            financial_safety_status: 'attention_required',
          });
          await this.billingRepo.releasePlanChangeLock(claimed.id);
          return { success: false, reason: 'SOURCE_PAYMENT_OVERDUE' };
        }

        if (pay.status !== 'PENDING') {
          console.error(
            `[CUTOVER GUARD] Cobrança source com status excepcional encontrada para boundary >= ${renewalCutoffDate}: ${pay.id} (${pay.status})`
          );
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'SOURCE_PAYMENT_EXCEPTIONAL_STATUS',
            financial_safety_status: 'attention_required',
          });
          await this.billingRepo.releasePlanChangeLock(claimed.id);
          return { success: false, reason: 'SOURCE_PAYMENT_EXCEPTIONAL_STATUS' };
        }
      }

      // 3. REVALIDATE TARGET BEFORE SOURCE MUTATION (Sections 6, 7, 8)
      if (typeof this.provider.getSubscription !== 'function') {
        throw new AppError(500, 'Provider não suporta getSubscription');
      }

      const freshTargetSub = await this.provider.getSubscription(targetSubId);
      if (!freshTargetSub) {
        console.error(`[CUTOVER GUARD] Target subscription ${targetSubId} não encontrada no provedor`);
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'TARGET_SUBSCRIPTION_NOT_FOUND',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'TARGET_SUBSCRIPTION_NOT_FOUND' };
      }

      // Buscar pagamentos da target subscription (listSubscriptionPayments ou listPaymentsByCheckoutSession)
      let targetPayments: ProviderPaymentRecord[] = [];
      if (typeof this.provider.listSubscriptionPayments === 'function') {
        const pRes = await this.provider.listSubscriptionPayments(targetSubId, { status: 'ALL' });
        if (Array.isArray(pRes)) targetPayments = pRes;
      }
      if (
        targetPayments.length === 0 &&
        claimed.future_provider_checkout_id &&
        typeof this.provider.listPaymentsByCheckoutSession === 'function'
      ) {
        const cRes = await this.provider.listPaymentsByCheckoutSession(claimed.future_provider_checkout_id);
        if (Array.isArray(cRes)) targetPayments = cRes;
      }

      // Filtrar cobranças pertencentes à target subscription
      const subTargetPayments = targetPayments.filter((p) => !p.subscriptionId || p.subscriptionId === targetSubId);

      // Boundary candidates: dueDate == renewalCutoffDate AND amountCents == target_future_recurring_price_cents
      const boundaryCandidatePayments = subTargetPayments.filter((p) => {
        const pDueDate = (p.originalDueDate || p.dueDate || '').trim().substring(0, 10);
        return (
          pDueDate === renewalCutoffDate &&
          p.amountCents === claimed.target_future_recurring_price_cents
        );
      });

      if (boundaryCandidatePayments.length === 0) {
        console.error(`[CUTOVER GUARD] Nenhuma cobrança target encontrada para a boundary ${renewalCutoffDate}`);
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'target_payment_not_found_on_boundary' };
      }

      if (boundaryCandidatePayments.length > 1) {
        console.error(
          `[AMBIGUOUS TARGET RESOURCES] Target possui ${boundaryCandidatePayments.length} cobranças concorrentes para a boundary ${renewalCutoffDate}`
        );
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'AMBIGUOUS_TARGET_RESOURCES',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'AMBIGUOUS_TARGET_RESOURCES' };
      }

      const verifiedFirstTargetPayment = boundaryCandidatePayments[0];

      let targetValCents = freshTargetSub.valueCents;
      if (targetValCents === undefined && freshTargetSub.value !== undefined) {
        targetValCents = providerBrlDecimalToCents(freshTargetSub.value);
      }
      if (targetValCents === undefined) {
        targetValCents = claimed.target_future_recurring_price_cents;
      }

      let targetCycle: BillingInterval | undefined;
      if (freshTargetSub.cycle === 'YEARLY' || freshTargetSub.cycle === 'annual') targetCycle = 'annual';
      else if (freshTargetSub.cycle === 'MONTHLY' || freshTargetSub.cycle === 'monthly') targetCycle = 'monthly';

      const readyResult = verifyPaidToPaidTargetReadyGate({
        transition: claimed,
        targetCustomerId: freshTargetSub.customer || claimed.provider_customer_id,
        providerSubscriptionId: targetSubId,
        subscriptionCycle: targetCycle,
        subscriptionValueCents: targetValCents,
        subscriptionStatus: freshTargetSub.status,
        subscriptionNextDueDate: freshTargetSub.nextDueDate,
        firstPayment: verifiedFirstTargetPayment,
      });

      if (!readyResult.ready) {
        console.error(`[CUTOVER GUARD] Target Ready Gate falhou na revalidação: ${readyResult.failureCode}`);
        if (readyResult.failureCode !== 'PAYMENT_NOT_YET_VISIBLE') {
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: readyResult.failureCode,
            financial_safety_status: 'attention_required',
          });
        }
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: readyResult.failureCode };
      }

      // 4. CUTOVER INTENT PERSISTENCE (Section 9)
      // Persistir awaiting_old_inactivation antes de qualquer mutação no provedor
      if (claimed.transition_status !== 'awaiting_old_inactivation') {
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          transition_status: 'awaiting_old_inactivation',
          old_provider_subscription_id: sourceSubId,
          previous_provider_subscription_id: sourceSubId,
          renewal_cutoff_date: renewalCutoffDate,
          future_provider_payment_id: verifiedFirstTargetPayment.id,
        });
        claimed.transition_status = 'awaiting_old_inactivation';
      }

      // 5. INACTIVATE SOURCE SUBSCRIPTION (Sections 10, 11, 12)
      const freshSourceSub = await this.provider.getSubscription(sourceSubId);
      if (!freshSourceSub) {
        console.error(`[CUTOVER GUARD] Assinatura source ${sourceSubId} não encontrada no provedor`);
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'SOURCE_SUBSCRIPTION_NOT_FOUND',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'SOURCE_SUBSCRIPTION_NOT_FOUND' };
      }

      if (freshSourceSub.status === 'ACTIVE') {
        try {
          await this.provider.inactivateSubscription(sourceSubId);
        } catch (inactErr: any) {
          console.warn(`[CUTOVER] Inativação da assinatura source sofreu erro ou incerteza: ${inactErr.message}`);
          const recheck = await this.provider.getSubscription(sourceSubId);
          if (recheck?.status !== 'INACTIVE') {
            await this.billingRepo.updateTransition(claimed.id, ministryId, {
              financial_attention_required: true,
              financial_attention_reason: 'SOURCE_INACTIVATION_UNCERTAIN',
              financial_safety_status: 'attention_required',
            });
            await this.billingRepo.releasePlanChangeLock(claimed.id);
            return { success: false, reason: 'SOURCE_INACTIVATION_UNCERTAIN' };
          }
        }
      } else if (freshSourceSub.status !== 'INACTIVE') {
        console.error(`[CUTOVER GUARD] Assinatura source com status inesperado: ${freshSourceSub.status}`);
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'SOURCE_SUBSCRIPTION_UNEXPECTED_STATUS',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'SOURCE_SUBSCRIPTION_UNEXPECTED_STATUS' };
      }

      const confirmedSourceSub = await this.provider.getSubscription(sourceSubId);
      if (confirmedSourceSub?.status !== 'INACTIVE') {
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'SOURCE_INACTIVATION_FAILED',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'SOURCE_INACTIVATION_FAILED' };
      }

      // 6. LIST EXACT SOURCE PENDING PAYMENTS & CLEANUP (Sections 13, 14, 15, 16, 17)
      let sourcePayments: ProviderPaymentRecord[] = [];
      if (typeof this.provider.listSubscriptionPayments === 'function') {
        const pList = await this.provider.listSubscriptionPayments(sourceSubId, { status: 'PENDING' });
        if (Array.isArray(pList)) sourcePayments = pList;
      }

      // Filtrar apenas cobranças com subscription == sourceSubId AND status == PENDING AND dueDate >= renewalCutoffDate
      const eligiblePaymentsToDelete = sourcePayments.filter(
        (p) =>
          (!p.subscriptionId || p.subscriptionId === sourceSubId) &&
          p.status === 'PENDING' &&
          p.dueDate &&
          p.dueDate >= renewalCutoffDate
      );

      const cleanedPaymentIds: string[] = [];

      for (const pay of eligiblePaymentsToDelete) {
        // FRESH READ BEFORE DELETE (Section 15)
        let freshPayment: ProviderPaymentRecord | null = null;
        if (typeof this.provider.getPayment === 'function') {
          freshPayment = await this.provider.getPayment(pay.id);
        }

        if (!freshPayment) {
          cleanedPaymentIds.push(pay.id);
          continue;
        }

        // PENDING -> SETTLED RACE GUARD (Section 16)
        if (freshPayment.status === 'CONFIRMED' || freshPayment.status === 'RECEIVED') {
          console.error(`[CUTOVER RACE] Cobrança source ${pay.id} foi liquidada durante o cutover!`);
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'SOURCE_PAYMENT_SETTLED_DURING_CUTOVER',
            financial_safety_status: 'attention_required',
          });
          await this.billingRepo.releasePlanChangeLock(claimed.id);
          return { success: false, reason: 'SOURCE_PAYMENT_SETTLED_DURING_CUTOVER' };
        }

        if (
          freshPayment.status === 'PENDING' &&
          freshPayment.dueDate &&
          freshPayment.dueDate >= renewalCutoffDate &&
          (!freshPayment.subscriptionId || freshPayment.subscriptionId === sourceSubId)
        ) {
          try {
            await this.provider.removePayment(pay.id);
            cleanedPaymentIds.push(pay.id);
          } catch (delErr: any) {
            console.warn(`[CUTOVER] Erro ao remover cobrança ${pay.id}: ${delErr.message}`);
            let recheckPay: ProviderPaymentRecord | null = null;
            if (typeof this.provider.getPayment === 'function') {
              recheckPay = await this.provider.getPayment(pay.id);
            }

            // A) 404 / ausência comprovadamente compatível com payment removido -> deletion confirmed
            if (!recheckPay) {
              cleanedPaymentIds.push(pay.id);
              continue;
            }

            // B) Payment ainda PENDING -> deletion NOT confirmed
            if (recheckPay.status === 'PENDING') {
              console.error(`[CUTOVER UNCERTAIN DELETE] Cobrança ${pay.id} permanece PENDING após falha de DELETE.`);
              await this.billingRepo.updateTransition(claimed.id, ministryId, {
                financial_attention_required: true,
                financial_attention_reason: 'SOURCE_PAYMENT_DELETE_UNCERTAIN',
                financial_safety_status: 'attention_required',
              });
              await this.billingRepo.releasePlanChangeLock(claimed.id);
              return { success: false, reason: 'SOURCE_PAYMENT_DELETE_UNCERTAIN' };
            }

            // C) Payment CONFIRMED / RECEIVED -> settled during delete
            if (recheckPay.status === 'CONFIRMED' || recheckPay.status === 'RECEIVED') {
              console.error(`[CUTOVER RACE] Cobrança ${pay.id} foi liquidada durante DELETE incerto!`);
              await this.billingRepo.updateTransition(claimed.id, ministryId, {
                financial_attention_required: true,
                financial_attention_reason: 'SOURCE_PAYMENT_SETTLED_DURING_CUTOVER',
                financial_safety_status: 'attention_required',
              });
              await this.billingRepo.releasePlanChangeLock(claimed.id);
              return { success: false, reason: 'SOURCE_PAYMENT_SETTLED_DURING_CUTOVER' };
            }

            // D) Payment OVERDUE -> active overdue obligation
            if (recheckPay.status === 'OVERDUE') {
              console.error(`[CUTOVER UNCERTAIN DELETE] Cobrança ${pay.id} ficou OVERDUE após falha de DELETE.`);
              await this.billingRepo.updateTransition(claimed.id, ministryId, {
                financial_attention_required: true,
                financial_attention_reason: 'SOURCE_PAYMENT_OVERDUE_DURING_CUTOVER',
                financial_safety_status: 'attention_required',
              });
              await this.billingRepo.releasePlanChangeLock(claimed.id);
              return { success: false, reason: 'SOURCE_PAYMENT_OVERDUE_DURING_CUTOVER' };
            }

            // E) Estado financeiro excepcional / unknown -> FAIL CLOSED
            console.error(`[CUTOVER UNCERTAIN DELETE] Cobrança ${pay.id} em estado desconhecido (${recheckPay.status}).`);
            await this.billingRepo.updateTransition(claimed.id, ministryId, {
              financial_attention_required: true,
              financial_attention_reason: 'SOURCE_PAYMENT_STATUS_UNKNOWN',
              financial_safety_status: 'attention_required',
            });
            await this.billingRepo.releasePlanChangeLock(claimed.id);
            return { success: false, reason: 'SOURCE_PAYMENT_STATUS_UNKNOWN' };
          }
        }
      }

      // 7. POST-CLEANUP REVERIFICATION & FINAL SOURCE SAFETY GATE (Sections 4, 5, 19)
      const postVerifySourceSub = await this.provider.getSubscription(sourceSubId);
      if (postVerifySourceSub?.status !== 'INACTIVE') {
        console.error(`[CUTOVER GUARD] Source não está INACTIVE após cleanup!`);
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'SOURCE_INACTIVATION_FAILED',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'SOURCE_INACTIVATION_FAILED' };
      }

      // FINAL SOURCE SAFETY GATE: All-status fresh reconciliation
      let allRemainingPayments: ProviderPaymentRecord[] = [];
      if (typeof this.provider.listSubscriptionPayments === 'function') {
        const rem = await this.provider.listSubscriptionPayments(sourceSubId, { status: 'ALL' });
        if (Array.isArray(rem)) allRemainingPayments = rem;
      }

      const remainingBoundaryObligations = allRemainingPayments.filter(
        (p) =>
          (!p.subscriptionId || p.subscriptionId === sourceSubId) &&
          p.dueDate &&
          p.dueDate >= renewalCutoffDate
      );

      for (const remaining of remainingBoundaryObligations) {
        if (remaining.status === 'PENDING') {
          console.error(`[FINAL SAFETY GATE] Cobrança PENDING >= cutoff ainda persiste na source: ${remaining.id}`);
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'SOURCE_PAYMENT_CLEANUP_INCOMPLETE',
            financial_safety_status: 'attention_required',
          });
          await this.billingRepo.releasePlanChangeLock(claimed.id);
          return { success: false, reason: 'SOURCE_PAYMENT_CLEANUP_INCOMPLETE' };
        }

        if (remaining.status === 'CONFIRMED' || remaining.status === 'RECEIVED') {
          console.error(
            `[FINAL SAFETY GATE] Cobrança liquidada (${remaining.status}) detectada na source >= cutoff: ${remaining.id}`
          );
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'SOURCE_PAYMENT_ALREADY_SETTLED',
            financial_safety_status: 'attention_required',
          });
          await this.billingRepo.releasePlanChangeLock(claimed.id);
          return { success: false, reason: 'SOURCE_PAYMENT_ALREADY_SETTLED' };
        }

        if (remaining.status === 'OVERDUE') {
          console.error(`[FINAL SAFETY GATE] Cobrança OVERDUE detectada na source >= cutoff: ${remaining.id}`);
          await this.billingRepo.updateTransition(claimed.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'SOURCE_PAYMENT_OVERDUE',
            financial_safety_status: 'attention_required',
          });
          await this.billingRepo.releasePlanChangeLock(claimed.id);
          return { success: false, reason: 'SOURCE_PAYMENT_OVERDUE' };
        }

        console.error(
          `[FINAL SAFETY GATE] Obrigação conflitante encontrada na source >= cutoff: ${remaining.id} (${remaining.status})`
        );
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'SOURCE_ACTIVE_OBLIGATION_DETECTED',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'SOURCE_ACTIVE_OBLIGATION_DETECTED' };
      }

      // 8. TARGET FINAL REVALIDATION (Section 20)
      const finalTargetSub = await this.provider.getSubscription(targetSubId);
      if (!finalTargetSub || (finalTargetSub.status !== 'ACTIVE' && finalTargetSub.status !== 'active')) {
        console.error(`[CUTOVER GUARD] Target subscription mudou de estado antes da conclusão do cutover!`);
        await this.billingRepo.updateTransition(claimed.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'TARGET_CHANGED_DURING_CUTOVER',
          financial_safety_status: 'attention_required',
        });
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: 'TARGET_CHANGED_DURING_CUTOVER' };
      }

      // 9. SCHEDULED STATE (Sections 21, 22, 23, 24)
      const nowIso = new Date().toISOString();
      await this.billingRepo.updateTransition(claimed.id, ministryId, {
        transition_status: 'scheduled',
        status: 'pending',
        supersede_status: 'completed',
        payment_cleanup_status: 'completed',
        payment_cleanup_ids: cleanedPaymentIds,
        financial_attention_required: false,
        financial_attention_reason: null,
        financial_safety_status: 'live',
        effective_at: nowIso,
        updated_at: nowIso,
      });

      await this.billingRepo.releasePlanChangeLock(claimed.id);
      const reloaded = await this.billingRepo.getTransitionById(claimed.id, ministryId);
      return { success: true, transition: reloaded && isBillingTransitionV1(reloaded) ? reloaded : undefined };
    } catch (err: any) {
      console.error(`[CUTOVER ERROR] Falha ao executar cutover da transição ${claimed.id}:`, err);
      await this.billingRepo.releasePlanChangeLock(claimed.id);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Alias de reconciliação para a Phase 3B.2
   */
  async reconcilePaidToPaidSourceCutover(
    transitionId: string,
    actor: string = 'worker'
  ): Promise<{ success: boolean; reason?: string; transition?: BillingTransitionV1Record }> {
    return await this.cutoverPaidToPaidSourceRecurrence(transitionId, actor);
  }

  /**
   * Phase 3B.3A: Scheduled Renewal Settlement & Target Activation
   *
   * Two-Gate Model:
   * Gate A: Financial Settlement Gate (target renewal payment is settled - CONFIRMED or RECEIVED).
   * Gate B: Commercial Boundary Gate (currentCommercialDate >= effective_billing_date).
   *
   * Invariants:
   * 1. Exact Target Payment Authority: Correlates write-once to future_provider_payment_id.
   * 2. Early Settlement Before Boundary: If payment is settled before boundary (currentCommercialDate < effective_billing_date):
   *    - Persists canonical BillingTransaction idempotently
   *    - Persists settlement proof (renewal_payment_settled_at, renewal_paid_billing_date, successful_renewal_provider_payment_id)
   *    - Does NOT promote target entitlement
   *    - Does NOT mark completed
   *    - Does NOT release slot
   *    - Transition remains 'scheduled'
   * 3. Boundary Reached + Payment Settled:
   *    - Fresh target revalidation (subscription ACTIVE, payment confirmed)
   *    - Promotes immutable target entitlement snapshot
   *    - Advances commercial period (start = effective_billing_date, end = addCommercialInterval)
   *    - Switches active billing_subscriptions to target
   *    - Updates ministry_subscriptions
   *    - Confirms transition completed + safe_terminal
   *    - Releases slot LAST
   * 4. Boundary Reached + Payment Unpaid/Pending:
   *    - Remains scheduled, source entitlement active, slot HELD (grace is Phase 3B.3B).
   */
  async processScheduledPaidRenewalSettlement(
    parsedEvent: ParsedWebhookEvent | null,
    planChange: BillingTransitionV1Record,
    now: Date,
    options?: { nowCommercialDate?: string }
  ): Promise<{ status: string; processed: boolean; reason?: string }> {
    const ministryId = planChange.ministry_id;
    const nowIso = now.toISOString();
    const currentCommercialDate =
      options?.nowCommercialDate || getBillingDate(now, config.billingTimezone);

    if (planChange.transition_status === 'completed') {
      return { status: 'ok', processed: true, reason: 'already_completed' };
    }

    if (planChange.execution_strategy !== 'scheduled_paid_transition') {
      // Categoria A: consumido, sem mudança. Evento finalizado terminalmente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'strategy_mismatch' };
    }

    // Settlement Precondition Gate: PROIBIDO ativar target antes do source cutover concluído (Section 4 & 5)
    if (
      planChange.transition_status !== 'scheduled' ||
      planChange.supersede_status !== 'completed' ||
      planChange.payment_cleanup_status !== 'completed'
    ) {
      console.warn(
        `[SETTLEMENT PRECONDITION GATE] Transição ${planChange.id} não está em scheduled ou cutover incompleto: ` +
          `transition_status=${planChange.transition_status}, supersede_status=${planChange.supersede_status}, ` +
          `cleanup_status=${planChange.payment_cleanup_status}. Liquidação e promoção de cotas bloqueadas.`
      );
      // Categoria B: cutover transitoriamente incompleto — o BillingReconcilerWorker
      // completa o cutover e o settlement de forma autônoma.
      // O webhook individual é consumido terminalmente: a saga pertence ao reconciler, não ao replay do evento.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'SOURCE_CUTOVER_NOT_COMPLETED' };
    }

    if (planChange.financial_attention_required === true) {
      console.warn(
        `[SETTLEMENT PRECONDITION GATE] Transição ${planChange.id} possui financial_attention_required=true. Bloqueado.`
      );
      // Categoria C: atenção financeira persistida na transição. O bloqueio vem do campo financial_attention_required,
      // não do estado do evento. Finalizar o evento terminalmente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'financial_attention_required' };
    }

    if (planChange.financial_safety_status !== 'live') {
      console.warn(
        `[SETTLEMENT PRECONDITION GATE] Transição ${planChange.id} possui financial_safety_status=${planChange.financial_safety_status} (esperado live). Bloqueado.`
      );
      // Categoria C: estado terminal de atenção financeira. Evento finalizado.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'FINANCIAL_SAFETY_STATUS_NOT_LIVE' };
    }

    const effectiveBillingDate = planChange.effective_billing_date;
    const periodEndBillingDate = planChange.current_period_end_billing_date;

    if (!effectiveBillingDate || !periodEndBillingDate || effectiveBillingDate !== periodEndBillingDate) {
      console.error(
        `[RENEWAL BOUNDARY GUARD] Fronteira comercial inválida ou divergente: effective=${effectiveBillingDate}, periodEnd=${periodEndBillingDate}`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'COMMERCIAL_BOUNDARY_MISMATCH',
        financial_safety_status: 'attention_required',
      });
      // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'COMMERCIAL_BOUNDARY_MISMATCH' };
    }

    const expectedPaymentId = planChange.future_provider_payment_id || planChange.initial_provider_payment_id;
    const targetSubId = planChange.future_provider_subscription_id || planChange.new_provider_subscription_id;

    if (!expectedPaymentId || !targetSubId) {
      console.error(
        `[RENEWAL PAYMENT AUTHORITY] Transição ${planChange.id} não possui referências de pagamento/assinatura alvo gravadas.`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'MISSING_TARGET_RESOURCES',
        financial_safety_status: 'attention_required',
      });
      // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'MISSING_TARGET_RESOURCES' };
    }

    // Correlation check if parsedEvent is present
    if (parsedEvent?.providerPaymentId && parsedEvent.providerPaymentId !== expectedPaymentId) {
      if (parsedEvent.providerSubscriptionId === targetSubId) {
        console.warn(
          `[RENEWAL SECOND CYCLE] Webhook payment ID ${parsedEvent.providerPaymentId} != first payment ${expectedPaymentId}, pertence à assinatura alvo mas é cobrança posterior.`
        );
        // Categoria A: segundo ciclo corretamente descartado. Evento finalizado terminalmente.
        if (parsedEvent?.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        }
        return { status: 'ok', processed: false, reason: 'SECOND_CYCLE_PAYMENT' };
      }
      console.warn(
        `[RENEWAL PAYMENT MISMATCH] Webhook payment ID ${parsedEvent.providerPaymentId} não corresponde ao target payment esperado ${expectedPaymentId}.`
      );
      // Categoria D: webhook de pagamento errado; ignorado definitivamente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'ignored', `payment_id_mismatch: got ${parsedEvent.providerPaymentId}, expected ${expectedPaymentId}`);
      }
      return { status: 'ok', processed: false, reason: 'WRONG_PAYMENT_ID' };
    }

    if (parsedEvent?.providerSubscriptionId && parsedEvent.providerSubscriptionId !== targetSubId) {
      console.warn(
        `[RENEWAL SUBSCRIPTION MISMATCH] Webhook subscription ID ${parsedEvent.providerSubscriptionId} não corresponde ao target subscription esperado ${targetSubId}.`
      );
      // Categoria D: webhook de assinatura errada; ignorado definitivamente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'ignored', `subscription_id_mismatch: got ${parsedEvent.providerSubscriptionId}, expected ${targetSubId}`);
      }
      return { status: 'ok', processed: false, reason: 'WRONG_TARGET_SUBSCRIPTION' };
    }

    // Fresh read of target payment from provider
    let payment: ProviderPaymentRecord | null = null;
    if (typeof (this.provider as any).getPayment === 'function') {
      payment = await (this.provider as any).getPayment(expectedPaymentId);
    } else {
      const subPayments = await this.provider.listSubscriptionPayments(targetSubId, { status: 'ALL' });
      payment = subPayments.find((p) => p.id === expectedPaymentId) || null;
    }

    if (!payment) {
      console.warn(`[RENEWAL PAYMENT READ] Cobrança target ${expectedPaymentId} não localizada no provedor.`);
      // Categoria B: eventual consistency — o reconciler possui future_provider_payment_id
      // e pode realizar o poll/discovery do pagamento via provider.getPayment de forma autônoma.
      // O webhook individual é consumido terminalmente: a saga pertence ao reconciler.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'PAYMENT_NOT_FOUND' };
    }

    // Validation of payment details
    if (payment.subscriptionId && payment.subscriptionId !== targetSubId) {
      console.error(
        `[RENEWAL PAYMENT MISMATCH] Cobrança ${payment.id} vinculada a subscription ${payment.subscriptionId}, esperada ${targetSubId}.`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'TARGET_PAYMENT_SUBSCRIPTION_MISMATCH',
        financial_safety_status: 'attention_required',
      });
      // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'TARGET_PAYMENT_SUBSCRIPTION_MISMATCH' };
    }

    if (
      payment.customerId &&
      planChange.provider_customer_id &&
      payment.customerId !== planChange.provider_customer_id
    ) {
      console.error(
        `[RENEWAL CUSTOMER MISMATCH] Cobrança ${payment.id} possui customer ${payment.customerId}, esperado ${planChange.provider_customer_id}.`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'TARGET_PAYMENT_CUSTOMER_MISMATCH',
        financial_safety_status: 'attention_required',
      });
      // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'TARGET_PAYMENT_CUSTOMER_MISMATCH' };
    }

    const effectivePaymentDueDate = payment.originalDueDate || payment.dueDate;
    if (effectivePaymentDueDate && effectivePaymentDueDate !== effectiveBillingDate) {
      console.error(
        `[RENEWAL DUE DATE MISMATCH] Cobrança target exata ${payment.id} dueDate ${payment.dueDate} (original: ${payment.originalDueDate}) diverge de ${effectiveBillingDate}.`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'TARGET_FIRST_PAYMENT_BOUNDARY_MISMATCH',
        financial_safety_status: 'attention_required',
      });
      // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'TARGET_FIRST_PAYMENT_BOUNDARY_MISMATCH' };
    }

    if (
      payment.amountCents !== undefined &&
      payment.amountCents !== planChange.target_future_recurring_price_cents
    ) {
      console.error(
        `[RENEWAL AMOUNT MISMATCH] Cobrança ${payment.id} amount ${payment.amountCents} diverge do preço locked ${planChange.target_future_recurring_price_cents}.`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'TARGET_PAYMENT_AMOUNT_MISMATCH',
        financial_safety_status: 'attention_required',
      });
      // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'TARGET_PAYMENT_AMOUNT_MISMATCH' };
    }

    const isSettled = payment.status === 'CONFIRMED' || payment.status === 'RECEIVED';
    if (!isSettled) {
      if (payment.status === 'REFUNDED' || payment.status === 'CHARGEBACK' || payment.status === 'DELETED') {
        console.error(`[RENEWAL STATUS INVALID] Cobrança target possui status ${payment.status}.`);
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: `TARGET_PAYMENT_STATUS_${payment.status}`,
          financial_safety_status: 'attention_required',
        });
        // Categoria C: status terminal de pagamento. Atenção financeira persistida. Evento finalizado.
        if (parsedEvent?.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        }
        return { status: 'ok', processed: false, reason: `TARGET_PAYMENT_STATUS_${payment.status}` };
      }

      // Se o pagamento target for PENDING ou OVERDUE:
      const commercialBoundaryReached = currentCommercialDate >= effectiveBillingDate;
      if (!commercialBoundaryReached) {
        // Categoria A: Pre-boundary, PENDING/OVERDUE esperado. A transição permanece scheduled e o slot
        // HELD. O evento foi avaliado corretamente — não há ação a tomar neste momento.
        // O evento é finalizado terminalmente; o reconciler descobrirá a transition no próximo ciclo.
        if (parsedEvent?.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        }
        return { status: 'ok', processed: false, reason: 'renewal_payment_not_settled' };
      }

      // Phase 3B.3B: Fronteira comercial atingida e target payment NÃO liquidado -> Carência civil de 7 dias [start, end)
      let graceStartBillingDate = planChange.grace_start_billing_date;
      let graceEndBillingDate = planChange.grace_end_billing_date;
      let graceSnapshot = planChange.grace_entitlement_snapshot;

      if (!planChange.grace_started_at || !graceEndBillingDate || !graceSnapshot) {
        // Entrada write-once em carência: capturar runtime entitlement imediatamente anterior à fronteira
        const preBoundarySub = await this.subscriptionRepo.getSubscription(ministryId);
        const activePlanId = preBoundarySub?.plan_id || planChange.source_plan_id;
        const activeAddonBlocks =
          preBoundarySub?.member_addon_blocks !== undefined
            ? preBoundarySub.member_addon_blocks
            : planChange.source_addon_blocks;
        const activeInterval = preBoundarySub?.billing_interval || planChange.source_interval;

        graceSnapshot = {
          plan_id: activePlanId,
          addon_blocks: activeAddonBlocks,
          interval: activeInterval,
          effective_member_quota:
            preBoundarySub?.locked_member_quota !== undefined && preBoundarySub.locked_member_quota !== null
              ? preBoundarySub.locked_member_quota
              : planChange.source_entitlement_snapshot?.effective_member_quota ??
                getEffectiveMemberQuota(getPlanDefinition(activePlanId), activeAddonBlocks),
          effective_song_quota:
            preBoundarySub?.locked_song_quota !== undefined && preBoundarySub.locked_song_quota !== null
              ? preBoundarySub.locked_song_quota
              : planChange.source_entitlement_snapshot?.effective_song_quota ??
                getEffectiveSongQuota(getPlanDefinition(activePlanId)),
        };

        graceStartBillingDate = effectiveBillingDate;
        graceEndBillingDate = addCommercialDays(effectiveBillingDate, 7, config.billingTimezone);

        await this.billingRepo.enterScheduledPaidTransitionGrace({
          transitionId: planChange.id,
          ministryId,
          graceStartedAt: nowIso,
          graceStartBillingDate,
          graceEndBillingDate,
          graceEntitlementSnapshot: graceSnapshot,
        });

      }

      // Sincronização e convergência crash-safe da runtime subscription
      // Garante que ministry_subscriptions.billing_status seja past_due com grace_period_expires_billing_date
      // mesmo se o processo tiver sofrido crash imediatamente após enterScheduledPaidTransitionGrace
      const currentAppSub = await this.subscriptionRepo.getSubscription(ministryId);
      if (
        currentAppSub &&
        (currentAppSub.billing_status !== 'past_due' ||
          currentAppSub.grace_period_expires_billing_date !== graceEndBillingDate ||
          currentAppSub.locked_member_quota !== graceSnapshot.effective_member_quota ||
          currentAppSub.locked_song_quota !== graceSnapshot.effective_song_quota)
      ) {
        await this.subscriptionRepo.setSubscription({
          ...currentAppSub,
          billing_status: 'past_due',
          grace_period_expires_at: new Date(`${graceEndBillingDate}T00:00:00.000Z`).toISOString(),
          grace_period_expires_billing_date: graceEndBillingDate,
          locked_member_quota: graceSnapshot.effective_member_quota,
          locked_song_quota: graceSnapshot.effective_song_quota,
          entitlement_snapshot: graceSnapshot,
          updated_at: nowIso,
        });
      }

      // Avaliação da janela [start, end)
      const isGraceExpired = currentCommercialDate >= graceEndBillingDate;

      if (isGraceExpired) {
        await this.billingRepo.recordGraceExpiry({
          transitionId: planChange.id,
          ministryId,
          graceExpiredAt: nowIso,
          graceExpiredBillingDate: currentCommercialDate,
        });

        const currentAppSub = await this.subscriptionRepo.getSubscription(ministryId);
        if (currentAppSub) {
          await this.subscriptionRepo.setSubscription({
            ...currentAppSub,
            billing_status: 'past_due',
            grace_period_expires_at: new Date(`${graceEndBillingDate}T00:00:00.000Z`).toISOString(),
            grace_period_expires_billing_date: graceEndBillingDate,
            locked_member_quota: graceSnapshot.effective_member_quota,
            locked_song_quota: graceSnapshot.effective_song_quota,
            updated_at: nowIso,
          });
        }

        console.warn(
          `[GRACE EXPIRED] Carência civil de 7 dias [${graceStartBillingDate}, ${graceEndBillingDate}) expirou em ${currentCommercialDate}. Modo de acesso restrito (dados preservados). Slot HELD.`
        );

        if (parsedEvent?.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        }

        return { status: 'ok', processed: true, reason: 'grace_expired_restricted' };
      }

      console.log(
        `[GRACE ACTIVE] Cobrança target ${expectedPaymentId} não liquidada na fronteira ${effectiveBillingDate}. Carência civil ativa até ${graceEndBillingDate} (atual: ${currentCommercialDate}). Direito de uso preservado. Slot HELD.`
      );

      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }

      return { status: 'ok', processed: true, reason: 'grace_entered_unpaid' };
    }

    // Determine Financial Commercial Date & Operational Instant
    let paidBillingDate: string;
    let paymentConfirmationInstant: string;

    const rawConfirmDate =
      payment.clientPaymentDate ||
      payment.paymentDate ||
      parsedEvent?.confirmedDate ||
      parsedEvent?.paymentDate;

    if (rawConfirmDate && typeof rawConfirmDate === 'string' && rawConfirmDate.trim()) {
      const trimmed = rawConfirmDate.trim();
      if (trimmed.includes('T')) {
        paymentConfirmationInstant = new Date(trimmed).toISOString();
        paidBillingDate = getBillingDate(paymentConfirmationInstant, config.billingTimezone);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        paidBillingDate = trimmed;
        paymentConfirmationInstant = nowIso;
      } else {
        paymentConfirmationInstant = nowIso;
        paidBillingDate = getBillingDate(now, config.billingTimezone);
      }
    } else {
      paymentConfirmationInstant = nowIso;
      paidBillingDate = getBillingDate(now, config.billingTimezone);
    }

    // Save Canonical BillingTransaction Idempotently
    const txId = `${this.provider.name}_${payment.id}`;
    try {
      await this.billingRepo.saveTransaction({
        id: txId,
        ministry_id: ministryId,
        provider: this.provider.name,
        provider_payment_id: payment.id,
        provider_subscription_id: targetSubId,
        amount_cents: payment.amountCents || planChange.target_future_recurring_price_cents,
        currency: 'BRL',
        status: 'paid',
        due_date: payment.dueDate || effectiveBillingDate,
        paid_at: paymentConfirmationInstant,
        paid_billing_date: paidBillingDate,
        payment_method: payment.billingType || parsedEvent?.paymentMethod || 'CREDIT_CARD',
        invoice_url: payment.invoiceUrl || parsedEvent?.invoiceUrl,
        transaction_type: 'recurring_payment',
        created_at: nowIso,
        updated_at: nowIso,
      });
    } catch (txErr: any) {
      const errCode = txErr instanceof AppError ? (txErr.details as any)?.code : txErr?.code;
      if (
        errCode === 'CONFLICTING_FINANCIAL_DATE' ||
        errCode === 'CONFLICTING_FINANCIAL_AMOUNT'
      ) {
        console.error(`[FINANCIAL TRANSACTION CONFLICT] ${txErr.message}`);
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'FINANCIAL_TRANSACTION_CONFLICT',
          financial_safety_status: 'attention_required',
        });
        return { status: 'ok', processed: false, reason: 'FINANCIAL_TRANSACTION_CONFLICT' };
      }
      throw txErr;
    }

    // Check Commercial Boundary Gate
    const commercialBoundaryReached = currentCommercialDate >= effectiveBillingDate;

    if (!commercialBoundaryReached) {
      // EARLY SETTLEMENT BEFORE BOUNDARY:
      // Persistir liquidação financeira write-once, mas NÃO promover entitlement nem liberar slot!
      await this.billingRepo.recordRenewalFinancialSettlement({
        transitionId: planChange.id,
        ministryId: ministryId,
        providerPaymentId: payment.id,
        paidBillingDate: paidBillingDate,
        settledAt: paymentConfirmationInstant,
      });

      console.log(
        `[EARLY SETTLEMENT BEFORE BOUNDARY] Cobrança target ${payment.id} liquidada em ${paidBillingDate}, mas fronteira ${effectiveBillingDate} ainda não atingida (atual: ${currentCommercialDate}). Entitlement mantido na source.`
      );

      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }

      return { status: 'ok', processed: true, reason: 'early_settlement_recorded_awaiting_boundary' };
    }

    // Phase 3B.3B: Se a cobrança target foi liquidada na/após expiração da carência civil:
    // Bloquear auto-ativação (requer política explícita de delinquency recovery). Slot HELD.
    const graceEndBillingDate =
      planChange.grace_end_billing_date || addCommercialDays(effectiveBillingDate, 7, config.billingTimezone);

    if (currentCommercialDate >= graceEndBillingDate) {
      console.warn(
        `[LATE PAYMENT AFTER GRACE] Cobrança target ${payment.id} liquidada em ${paidBillingDate}, mas na/após expiração da carência civil ${graceEndBillingDate} (atual: ${currentCommercialDate}). Requer política explícita de delinquency recovery. Slot HELD.`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'RENEWAL_SETTLED_AFTER_GRACE_REQUIRES_POLICY',
        financial_safety_status: 'attention_required',
      });
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'RENEWAL_SETTLED_AFTER_GRACE_REQUIRES_POLICY' };
    }

    // Fresh Target Subscription Verification Before Promotion
    if (typeof (this.provider as any).getSubscription === 'function') {
      try {
        const freshSub = await (this.provider as any).getSubscription(targetSubId);
        if (freshSub) {
          if (freshSub.status && freshSub.status.toUpperCase() !== 'ACTIVE') {
            console.error(
              `[TARGET SUB STATUS MISMATCH] Status da assinatura target é ${freshSub.status}, esperado ACTIVE.`
            );
            await this.billingRepo.updateTransition(planChange.id, ministryId, {
              financial_attention_required: true,
              financial_attention_reason: `TARGET_SUBSCRIPTION_NOT_ACTIVE_${freshSub.status}`,
              financial_safety_status: 'attention_required',
            });
            // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
            if (parsedEvent?.providerEventId) {
              await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
            }
            return { status: 'ok', processed: false, reason: 'TARGET_SUBSCRIPTION_NOT_ACTIVE' };
          }

          if (
            freshSub.customer &&
            planChange.provider_customer_id &&
            freshSub.customer !== planChange.provider_customer_id
          ) {
            console.error(
              `[TARGET SUB CUSTOMER MISMATCH] Customer ${freshSub.customer} diverge de ${planChange.provider_customer_id}.`
            );
            await this.billingRepo.updateTransition(planChange.id, ministryId, {
              financial_attention_required: true,
              financial_attention_reason: 'TARGET_SUBSCRIPTION_CUSTOMER_MISMATCH',
              financial_safety_status: 'attention_required',
            });
            // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
            if (parsedEvent?.providerEventId) {
              await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
            }
            return { status: 'ok', processed: false, reason: 'TARGET_SUBSCRIPTION_CUSTOMER_MISMATCH' };
          }

          const expectedCycle = planChange.target_interval === 'annual' ? ['YEARLY', 'ANNUAL'] : ['MONTHLY'];
          if (freshSub.cycle && !expectedCycle.includes(String(freshSub.cycle).toUpperCase())) {
            console.error(
              `[TARGET SUB CYCLE MISMATCH] Cycle ${freshSub.cycle} incompatível com target_interval ${planChange.target_interval}.`
            );
            await this.billingRepo.updateTransition(planChange.id, ministryId, {
              financial_attention_required: true,
              financial_attention_reason: 'TARGET_SUBSCRIPTION_CYCLE_MISMATCH',
              financial_safety_status: 'attention_required',
            });
            // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
            if (parsedEvent?.providerEventId) {
              await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
            }
            return { status: 'ok', processed: false, reason: 'TARGET_SUBSCRIPTION_CYCLE_MISMATCH' };
          }

          const subValueCents =
            freshSub.valueCents !== undefined
              ? freshSub.valueCents
              : freshSub.value !== undefined
              ? Math.round(freshSub.value * 100)
              : undefined;
          if (
            subValueCents !== undefined &&
            subValueCents !== planChange.target_future_recurring_price_cents
          ) {
            console.error(
              `[TARGET SUB VALUE MISMATCH] Valor recorrente ${subValueCents} diverge do preço travado ${planChange.target_future_recurring_price_cents}.`
            );
            await this.billingRepo.updateTransition(planChange.id, ministryId, {
              financial_attention_required: true,
              financial_attention_reason: 'TARGET_SUBSCRIPTION_VALUE_MISMATCH',
              financial_safety_status: 'attention_required',
            });
            // Categoria C: atenção financeira persistida. Evento finalizado terminalmente.
            if (parsedEvent?.providerEventId) {
              await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
            }
            return { status: 'ok', processed: false, reason: 'TARGET_SUBSCRIPTION_VALUE_MISMATCH' };
          }
        }
      } catch (subErr: any) {
        console.warn(`[TARGET SUB REVALIDATION] Aviso ao consultar assinatura ${targetSubId}: ${subErr.message}`);
      }
    }

    // Source Provider Fresh Safety Before Activation (Section 5 & 15)
    const sourceSubId =
      planChange.previous_provider_subscription_id || planChange.old_provider_subscription_id;
    if (sourceSubId && sourceSubId !== targetSubId && typeof (this.provider as any).getSubscription === 'function') {
      try {
        const freshSourceSub = await (this.provider as any).getSubscription(sourceSubId);
        if (
          freshSourceSub &&
          freshSourceSub.status &&
          (freshSourceSub.status.toUpperCase() === 'ACTIVE' || freshSourceSub.status.toLowerCase() === 'active')
        ) {
          console.error(
            `[SOURCE SAFETY VIOLATION] Assinatura de origem ${sourceSubId} ainda está ACTIVE no provedor! Ativação cancelada com FAIL-CLOSED.`
          );
          await this.billingRepo.updateTransition(planChange.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'SOURCE_SUBSCRIPTION_STILL_ACTIVE_AT_RENEWAL',
            financial_safety_status: 'attention_required',
          });
          // Categoria C: atenção financeira persistida na transição (financial_attention_required=true).
          // O webhook é consumido terminalmente — a progressão futura é bloqueada intencionalmente
          // e requer revisão manual ou intervenção do suporte operacional.
          if (parsedEvent?.providerEventId) {
            await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
          }
          return { status: 'ok', processed: false, reason: 'SOURCE_SUBSCRIPTION_STILL_ACTIVE' };
        }
      } catch (err: any) {
        console.warn(`[SOURCE SAFETY WARNING] Não foi possível re-ler source subscription ${sourceSubId}:`, err?.message);
      }
    }

    // Step 1: Promote entitlement in SubscriptionService using immutable target snapshot
    const targetSnapshot = planChange.target_entitlement_snapshot || {
      plan_id: planChange.target_plan_id,
      addon_blocks: planChange.target_addon_blocks,
      interval: planChange.target_interval,
      effective_member_quota: getEffectiveMemberQuota(
        getPlanDefinition(planChange.target_plan_id),
        planChange.target_addon_blocks
      ),
      effective_song_quota: getEffectiveSongQuota(getPlanDefinition(planChange.target_plan_id)),
    };

    if (typeof (this.subscriptionService as any).applyLockedEntitlementSnapshot === 'function') {
      await (this.subscriptionService as any).applyLockedEntitlementSnapshot(ministryId, targetSnapshot);
    } else {
      await this.subscriptionService.changePlan(ministryId, planChange.target_plan_id);
      if (planChange.target_addon_blocks > 0) {
        await this.subscriptionService.changeMemberAddonBlocks(ministryId, planChange.target_addon_blocks);
      } else {
        await this.subscriptionService.changeMemberAddonBlocks(ministryId, 0);
      }
    }

    // Step 2: Calculate New Commercial Period
    const newCurrentPeriodStartBillingDate = effectiveBillingDate;
    const newCurrentPeriodEndBillingDate = addCommercialInterval(
      newCurrentPeriodStartBillingDate,
      planChange.target_interval,
      config.billingTimezone
    );
    const newCurrentPeriodStartIso = new Date(`${newCurrentPeriodStartBillingDate}T00:00:00.000Z`).toISOString();
    const newCurrentPeriodEndIso = new Date(`${newCurrentPeriodEndBillingDate}T00:00:00.000Z`).toISOString();

    // Step 3: Update ministry_subscriptions
    const appSub = await this.subscriptionRepo.getSubscription(ministryId);
    if (appSub) {
      await this.subscriptionRepo.setSubscription({
        ...appSub,
        plan_id: planChange.target_plan_id,
        billing_interval: planChange.target_interval,
        billing_status: 'active',
        subscription_mode: 'paid',
        grace_period_expires_at: null,
        grace_period_expires_billing_date: null,
        current_period_start: newCurrentPeriodStartIso,
        current_period_end: newCurrentPeriodEndIso,
        cancel_at_period_end: false,
        updated_at: nowIso,
      });
    }

    // Step 4: Switch active billing_subscriptions to TARGET
    const billingSubRecord: BillingSubscriptionRecord = {
      id: buildBillingSubscriptionId(ministryId, this.provider.name),
      ministry_id: ministryId,
      provider: this.provider.name,
      plan_id: planChange.target_plan_id,
      interval: planChange.target_interval,
      member_addon_blocks: planChange.target_addon_blocks,
      amount_cents: planChange.target_future_recurring_price_cents,
      status: 'active',
      provider_subscription_id: targetSubId,
      provider_customer_id: planChange.provider_customer_id || null,
      provider_checkout_id: planChange.future_provider_checkout_id || planChange.provider_checkout_id || null,
      checkout_intent_id: planChange.future_checkout_intent_id || planChange.checkout_intent_id || undefined,
      started_at: planChange.effective_at || nowIso,
      current_period_start: newCurrentPeriodStartIso,
      current_period_end: newCurrentPeriodEndIso,
      current_period_start_billing_date: newCurrentPeriodStartBillingDate,
      current_period_end_billing_date: newCurrentPeriodEndBillingDate,
      effective_billing_date: newCurrentPeriodStartBillingDate,
      cancel_at_period_end: false,
      created_at: nowIso,
      updated_at: nowIso,
    };
    await this.billingRepo.setSubscription(billingSubRecord);

    // Step 4.1: Activation Completion Gate
    const freshAppSub = await this.subscriptionRepo.getSubscription(ministryId);
    const freshBillingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
    let freshTx: BillingTransactionRecord | null = null;
    if (typeof (this.billingRepo as any).getTransaction === 'function') {
      freshTx = await (this.billingRepo as any).getTransaction(this.provider.name, payment.id);
      if (!freshTx) {
        freshTx = await (this.billingRepo as any).getTransaction(txId);
      }
    } else if (typeof (this.billingRepo as any).getTransactions === 'function') {
      const txs = await this.billingRepo.getTransactions(ministryId, 10);
      freshTx = txs.find((t) => t.id === txId) || null;
    } else {
      freshTx = { id: txId, status: 'paid', provider_payment_id: expectedPaymentId } as any;
    }

    const appSubValid =
      freshAppSub &&
      freshAppSub.plan_id === targetSnapshot.plan_id &&
      (freshAppSub.member_addon_blocks || 0) === targetSnapshot.addon_blocks &&
      freshAppSub.billing_interval === planChange.target_interval &&
      freshAppSub.current_period_start === newCurrentPeriodStartIso &&
      freshAppSub.current_period_end === newCurrentPeriodEndIso &&
      freshAppSub.billing_status === 'active' &&
      !freshAppSub.grace_period_expires_billing_date &&
      !freshAppSub.grace_period_expires_at;

    const billingSubValid =
      freshBillingSub &&
      freshBillingSub.provider_subscription_id === targetSubId &&
      freshBillingSub.current_period_start_billing_date === newCurrentPeriodStartBillingDate &&
      freshBillingSub.current_period_end_billing_date === newCurrentPeriodEndBillingDate &&
      freshBillingSub.status === 'active';

    const txValid = freshTx && freshTx.status === 'paid' && freshTx.provider_payment_id === expectedPaymentId;

    const freshPlanChange = await this.billingRepo.getTransitionById(planChange.id, ministryId);
    const cutoverValid =
      freshPlanChange &&
      isBillingTransitionV1(freshPlanChange) &&
      freshPlanChange.supersede_status === 'completed' &&
      freshPlanChange.payment_cleanup_status === 'completed' &&
      freshPlanChange.transition_status === 'scheduled';

    if (!appSubValid || !billingSubValid || !txValid || !cutoverValid) {
      console.error(
        `[ACTIVATION COMPLETION GATE FAILED] Local state not fully converged: appSub=${Boolean(
          appSubValid
        )}, billingSub=${Boolean(billingSubValid)}, tx=${Boolean(txValid)}, cutover=${Boolean(
          cutoverValid
        )}. Slot remains HELD.`
      );
      // Categoria B: writes locais ainda não convergidos (crash-safety scenario).
      // O BillingReconcilerWorker detecta a transição em 'scheduled' e re-executa a liquidação de forma autônoma.
      // O webhook individual é consumido terminalmente — a saga é do reconciler, não do replay do evento.
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'ACTIVATION_COMPLETION_GATE_FAILED' };
    }

    // Step 5: Confirm transition completed + safe_terminal
    await this.billingRepo.confirmScheduledPaidRenewalActivation({
      transitionId: planChange.id,
      ministryId: ministryId,
      effectiveBillingDate: effectiveBillingDate,
      currentPeriodStartBillingDate: newCurrentPeriodStartBillingDate,
      currentPeriodEndBillingDate: newCurrentPeriodEndBillingDate,
      providerSubscriptionId: targetSubId,
      providerPaymentId: payment.id,
      providerCustomerId: planChange.provider_customer_id,
      renewalPaidBillingDate: paidBillingDate,
      renewalPaymentSettledAt: paymentConfirmationInstant,
      completedAt: nowIso,
    });

    // Step 6: Release active transition slot LAST
    await this.billingRepo.releaseSlotIfOwnedAndSafe(ministryId, this.provider.name, planChange.id);

    if (parsedEvent?.providerEventId) {
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
    }

    return { status: 'ok', processed: true, reason: 'renewal_activated' };
  }

  /**
   * Reconciliador de liquidação de renovação e ativação de target (Phase 3B.3A)
   */
  async reconcilePaidToPaidRenewalSettlement(
    transitionId: string,
    workerId?: string,
    options?: { nowCommercialDate?: string }
  ): Promise<{ success: boolean; reason?: string; transition?: BillingTransitionV1Record }> {
    const now = new Date();
    const claimed = await this.billingRepo.claimTransitionForReconciliation(
      transitionId,
      workerId || `worker_${Date.now()}`,
      60000
    );
    if (!claimed) {
      // Diagnóstico preciso de motivo quando claim retorna null (Seção 11)
      const current = await this.billingRepo.getTransitionById(transitionId);
      if (!current) return { success: false, reason: 'transition_not_found' };
      if (!isBillingTransitionV1(current)) return { success: false, reason: 'not_v1_transition' };
      if (current.financial_attention_required) return { success: false, reason: 'financial_attention_required' };
      if (current.financial_safety_status === 'safe_terminal' && current.transition_status === 'completed') {
        await this.billingRepo.releaseSlotIfOwnedAndSafe(current.ministry_id, this.provider.name, current.id);
        return { success: true, reason: 'already_completed', transition: current };
      }
      return { success: false, reason: 'lock_busy' };
    }

    try {
      // Se já completada: se o slot ainda estiver alugado por crash residual, libera e retorna
      if (claimed.transition_status === 'completed') {
        await this.billingRepo.releaseSlotIfOwnedAndSafe(claimed.ministry_id, this.provider.name, claimed.id);
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: true, transition: claimed };
      }

      if (claimed.transition_status !== 'scheduled') {
        await this.billingRepo.releasePlanChangeLock(claimed.id);
        return { success: false, reason: `unexpected_status_${claimed.transition_status}` };
      }

      const result = await this.processScheduledPaidRenewalSettlement(null, claimed, now, options);

      await this.billingRepo.releasePlanChangeLock(claimed.id);
      const reloaded = await this.billingRepo.getTransitionById(claimed.id, claimed.ministry_id);
      return {
        success:
          (result.processed && result.reason === 'renewal_activated') ||
          result.reason === 'grace_entered_unpaid' ||
          result.reason === 'grace_expired_restricted',
        reason: result.reason,
        transition: reloaded && isBillingTransitionV1(reloaded) ? reloaded : undefined,
      };
    } catch (err: any) {
      console.error(`[RECONCILE RENEWAL ERROR] Falha ao reconciliar transição ${transitionId}:`, err);
      await this.billingRepo.releasePlanChangeLock(claimed.id);
      return { success: false, reason: err.message };
    }
  }

  /**
   * Determina se um evento de webhook pertence ao subfluxo de early activation (adjustment avulso).
   * Distingue com segurança o adjustment da renovação futura (future_provider_payment_id / target subscription).
   */
  private isEarlyActivationWebhookEvent(
    parsedEvent: ParsedWebhookEvent,
    planChange: BillingTransitionV1Record
  ): boolean {
    if (planChange.execution_strategy !== 'scheduled_paid_transition') {
      return false;
    }

    // 1. Se o payment ID coincide com o payment ID de early activation já gravado
    if (
      parsedEvent.providerPaymentId &&
      planChange.early_activation_provider_payment_id &&
      parsedEvent.providerPaymentId === planChange.early_activation_provider_payment_id
    ) {
      return true;
    }

    // 2. Se o checkout ID coincide com o checkout ID de early activation
    if (
      parsedEvent.providerCheckoutId &&
      planChange.early_activation_provider_checkout_id &&
      parsedEvent.providerCheckoutId === planChange.early_activation_provider_checkout_id
    ) {
      return true;
    }

    // 3. Se a externalReference coincide com early_activation_checkout_intent_id
    if (
      parsedEvent.externalReference &&
      planChange.early_activation_checkout_intent_id &&
      parsedEvent.externalReference === planChange.early_activation_checkout_intent_id
    ) {
      return true;
    }

    // 4. Se qualquer tentativa de early activation possuir o checkout ID, intent ID ou payment ID
    const earlyAttempts = (planChange.checkout_attempts || []).filter(
      (a) => a.attempt_type === 'early_activation'
    );
    if (earlyAttempts.length > 0) {
      if (
        parsedEvent.providerCheckoutId &&
        earlyAttempts.some((a) => a.provider_checkout_id === parsedEvent.providerCheckoutId)
      ) {
        return true;
      }
      if (
        parsedEvent.externalReference &&
        earlyAttempts.some((a) => a.internal_checkout_intent_id === parsedEvent.externalReference)
      ) {
        return true;
      }
      if (
        parsedEvent.providerPaymentId &&
        earlyAttempts.some((a) => a.provider_payment_id === parsedEvent.providerPaymentId)
      ) {
        return true;
      }
    }

    // 5. Se o payment ID ou subscription ID for estritamente da renovação target: NÃO é early activation
    if (
      parsedEvent.providerPaymentId &&
      planChange.future_provider_payment_id &&
      parsedEvent.providerPaymentId === planChange.future_provider_payment_id
    ) {
      return false;
    }
    if (
      parsedEvent.providerSubscriptionId &&
      planChange.future_provider_subscription_id &&
      parsedEvent.providerSubscriptionId === planChange.future_provider_subscription_id
    ) {
      return false;
    }

    // 6. Se o evento é de checkout e a transição tem early activation payment_pending ou checkout ativo
    if (
      (parsedEvent.eventType === 'checkout_created' ||
        parsedEvent.eventType === 'checkout_paid' ||
        parsedEvent.eventType === 'checkout_expired' ||
        parsedEvent.eventType === 'checkout_canceled') &&
      planChange.early_activation_provider_checkout_id &&
      parsedEvent.providerCheckoutId === planChange.early_activation_provider_checkout_id
    ) {
      return true;
    }

    return false;
  }

  /**
   * Orquestrador e Máquina de Estados Canônica da Liquidação de Early Activation (Phase 3C.4).
   *
   * Responsabilidades e Invariantes:
   * 1. Valida pré-condições da transição (scheduled, financial_safety_status live, financial_attention_required != true).
   * 2. Idempotência estrita: se já estiver em 'activated', finaliza terminalmente sem mutação adicional.
   * 3. Correlação exata de tentativa (Seções 4 e 6):
   *    - Rejeita pagamentos pertencentes a tentativas antigas (stale attempt -> financial attention).
   *    - Rejeita pagamentos em tentativas terminalmente canceladas/expiradas (financial attention).
   * 4. Descoberta e validação exata do pagamento avulso no provedor (Seções 7 e 8):
   *    - CHECKOUT_PAID sozinho NÃO ativa entitlement. Exige pagamento comprovadamente liquidado (CONFIRMED ou RECEIVED).
   *    - Consulta fresh do pagamento no provedor via getPayment se disponível.
   *    - Pagamento não liquidado (PENDING, OVERDUE) não promove entitlement.
   *    - Reversões (REFUNDED, CHARGEBACK) bloqueiam ativação e acionam financial attention sem auto-refund.
   * 5. Isolamento estrito entre adjustment payment e future target recurring payment (Seção 5):
   *    - adjustment payment != future_provider_payment_id.
   * 6. Validação de valor exato do adjustment (Seção 6):
   *    - amountCents deve coincidir exatamente com o valor travado na cotação.
   * 7. Proveniência temporal rigorosa (Seção 11):
   *    - Preserva paid_billing_date e paid_at canônicos comprovados pelo gateway.
   * 8. Commercial Boundary Guard (Seções 14 e 36):
   *    - Se currentCommercialDate >= effective_billing_date: NÃO auto-ativa entitlement!
   *    - Grava a BillingTransaction, marca financial_attention_required (LATE_EARLY_ADJUSTMENT_SETTLEMENT) e retém o slot.
   * 9. Persistência de evidência financeira write-once (Seção 9).
   * 10. Criação da BillingTransaction canônica de tipo 'prorated_early_activation_adjustment' exatamente uma vez (Seção 10).
   * 11. Fresh reread da transição antes da mutação de entitlement (Seção 12).
   * 12. Aplicação imediata do target_entitlement_snapshot imutável no runtime (SubscriptionService) (Seções 17 e 18).
   * 13. Preservação do ciclo comercial corrente na assinatura do ministério (Seções 3 e 19):
   *     - current_period_start_billing_date e current_period_end_billing_date NÃO MUDAM.
   * 14. Local Early Activation Completion Gate (Seção 34):
   *     - Validação cruzada fresh de appSub, billingSub, transaction, payment IDs e transition_status === 'scheduled'.
   * 15. Confirmação da ativação:
   *     - early_activation_status = 'activated'.
   *     - transition_status PERMANECE 'scheduled'.
   *     - financial_safety_status PERMANECE 'live'.
   *     - Slot PERMANECE 'HELD'.
   */
  async processEarlyActivationAdjustmentSettlement(
    parsedEvent: ParsedWebhookEvent | null,
    planChange: BillingTransitionV1Record,
    now: Date,
    options?: { nowCommercialDate?: string }
  ): Promise<{ status: string; processed: boolean; reason?: string }> {
    const ministryId = planChange.ministry_id;
    const nowIso = now.toISOString();
    const currentCommercialDate =
      options?.nowCommercialDate || getBillingDate(now, config.billingTimezone);

    // 0. Se a transição já estiver completed, idempotência terminal
    if (planChange.transition_status === 'completed') {
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: true, reason: 'already_completed' };
    }

    if (planChange.execution_strategy !== 'scheduled_paid_transition') {
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'strategy_mismatch' };
    }

    // 0.1 Idempotência / Monotonicidade: Se já ativado anteriormente
    if (planChange.early_activation_status === 'activated') {
      const earlyAttempts = (planChange.checkout_attempts || []).filter(
        (a) => a.attempt_type === 'early_activation'
      );
      const currentAttemptId = planChange.current_early_activation_checkout_attempt_id;
      const targetAttempt = earlyAttempts.find((a) => {
        if (parsedEvent?.providerCheckoutId && a.provider_checkout_id === parsedEvent.providerCheckoutId) return true;
        if (parsedEvent?.externalReference && a.internal_checkout_intent_id === parsedEvent.externalReference) return true;
        if (parsedEvent?.providerPaymentId && a.provider_payment_id === parsedEvent.providerPaymentId) return true;
        return false;
      });

      const isHistoricalAttempt = Boolean(targetAttempt && currentAttemptId && targetAttempt.attempt_id !== currentAttemptId);

      if (parsedEvent?.eventType === 'checkout_created') {
        if (isHistoricalAttempt && targetAttempt) {
          // A) Evento repetido do mesmo checkout histórico já conhecido -> benign/idempotent
          if (
            targetAttempt.provider_checkout_id &&
            targetAttempt.provider_checkout_id === parsedEvent.providerCheckoutId
          ) {
            if (parsedEvent?.providerEventId) {
              await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
            }
            return { status: 'ok', processed: true, reason: 'already_activated' };
          }

          // B) NOVO provider checkout inesperadamente materializado para attempt histórico -> financial attention
          console.warn(
            `[STALE CHECKOUT MATERIALIZED AFTER ACTIVATION] Novo checkout ${parsedEvent.providerCheckoutId} materializado para tentativa histórica ${targetAttempt.attempt_id} após ativação.`
          );

          if (!targetAttempt.provider_checkout_id && parsedEvent.providerCheckoutId) {
            targetAttempt.provider_checkout_id = parsedEvent.providerCheckoutId;
            targetAttempt.provider_create_state = 'created';
          }

          await this.billingRepo.updateTransition(planChange.id, ministryId, {
            checkout_attempts: planChange.checkout_attempts,
            financial_attention_required: true,
            financial_attention_reason: 'STALE_PROVIDER_CHECKOUT_MATERIALIZED',
            financial_safety_status: 'attention_required',
          });

          if (parsedEvent?.providerEventId) {
            await this.billingRepo.markWebhookEventProcessed(
              this.provider.name,
              parsedEvent.providerEventId,
              'processed',
              'STALE_PROVIDER_CHECKOUT_MATERIALIZED'
            );
          }

          // Entitlement continua 'activated' (NÃO regride)! Slot permanece HELD!
          return { status: 'ok', processed: false, reason: 'STALE_PROVIDER_CHECKOUT_MATERIALIZED' };
        }
      }

      // Seção 9: activated + stale historical checkout payment
      if (
        (parsedEvent?.eventType === 'payment_confirmed' || parsedEvent?.eventType === 'payment_received') &&
        isHistoricalAttempt &&
        targetAttempt
      ) {
        console.warn(
          `[STALE PAYMENT RECEIVED AFTER ACTIVATION] Pagamento real ${parsedEvent.providerPaymentId} recebido para tentativa histórica ${targetAttempt.attempt_id} após ativação.`
        );
        return await this.recordStaleSettledPaymentLedger({
          planChange,
          matchedAttempt: targetAttempt,
          parsedEvent,
          now,
          nowIso,
          ministryId,
        });
      }

      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: true, reason: 'already_activated' };
    }

    // 2. Localização e validação de tentativa de early activation
    const earlyAttempts = (planChange.checkout_attempts || []).filter(
      (a) => a.attempt_type === 'early_activation'
    );
    const currentAttemptId = planChange.current_early_activation_checkout_attempt_id;
    let matchedAttempt = earlyAttempts.find((a) => {
      if (parsedEvent?.providerCheckoutId && a.provider_checkout_id === parsedEvent.providerCheckoutId) return true;
      if (parsedEvent?.externalReference && a.internal_checkout_intent_id === parsedEvent.externalReference) return true;
      if (parsedEvent?.providerPaymentId && a.provider_payment_id === parsedEvent.providerPaymentId) return true;
      return false;
    });

    if (!matchedAttempt && currentAttemptId) {
      matchedAttempt = earlyAttempts.find((a) => a.attempt_id === currentAttemptId);
    }

    if (!matchedAttempt && earlyAttempts.length > 0) {
      matchedAttempt = earlyAttempts[earlyAttempts.length - 1];
    }

    if (!matchedAttempt) {
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'ignored',
          'EARLY_ADJUSTMENT_ATTEMPT_NOT_FOUND'
        );
      }
      return { status: 'ok', processed: false, reason: 'EARLY_ADJUSTMENT_ATTEMPT_NOT_FOUND' };
    }

    const isCurrentAttempt = Boolean(currentAttemptId && matchedAttempt.attempt_id === currentAttemptId);

    // Stale attempt check (Seção 30, 15 & Stale Provider Resource Safety Patch)
    if (!isCurrentAttempt) {
      if (parsedEvent?.eventType === 'checkout_created') {
        // Conflito Write-Once no attempt antigo: se já tem checkout ID diferente
        if (
          parsedEvent.providerCheckoutId &&
          matchedAttempt.provider_checkout_id &&
          matchedAttempt.provider_checkout_id !== parsedEvent.providerCheckoutId
        ) {
          console.error(
            `[STALE ATTEMPT CHECKOUT CONFLICT] providerCheckoutId divergente para tentativa antiga ${matchedAttempt.attempt_id}: existing ${matchedAttempt.provider_checkout_id} vs incoming ${parsedEvent.providerCheckoutId}`
          );
          await this.billingRepo.updateTransition(planChange.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'CHECKOUT_ID_WRITE_ONCE_CONFLICT',
            financial_safety_status: 'attention_required',
          });
          if (parsedEvent.providerEventId) {
            await this.billingRepo.markWebhookEventProcessed(
              this.provider.name,
              parsedEvent.providerEventId,
              'failed',
              'CHECKOUT_ID_WRITE_ONCE_CONFLICT'
            );
          }
          return { status: 'ok', processed: false, reason: 'CHECKOUT_ID_WRITE_ONCE_CONFLICT' };
        }

        // Repetição benigna/idempotente do mesmo checkout ID já conhecido no attempt antigo
        if (
          parsedEvent.providerCheckoutId &&
          matchedAttempt.provider_checkout_id === parsedEvent.providerCheckoutId
        ) {
          if (parsedEvent.providerEventId) {
            await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
          }
          return { status: 'ok', processed: true, reason: 'stale_checkout_created_already_acknowledged' };
        }

        // Materialização de NOVO provider checkout para tentativa antiga (STALE_PROVIDER_CHECKOUT_MATERIALIZED)
        // 1. Persistir provider_checkout_id SOMENTE no attempt antigo, write-once.
        // 2. NÃO alterar current attempt, transition-level provider checkout ID, quotes ou payment IDs.
        if (parsedEvent.providerCheckoutId && !matchedAttempt.provider_checkout_id) {
          matchedAttempt.provider_checkout_id = parsedEvent.providerCheckoutId;
          matchedAttempt.provider_create_state = 'created';
        }

        console.warn(
          `[STALE PROVIDER CHECKOUT MATERIALIZED] Materializado provider checkout ${parsedEvent.providerCheckoutId} para tentativa antiga ${matchedAttempt.attempt_id} enquanto a tentativa corrente é ${currentAttemptId}. Acionando financial_attention_required.`
        );

        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          checkout_attempts: planChange.checkout_attempts,
          financial_attention_required: true,
          financial_attention_reason: 'STALE_PROVIDER_CHECKOUT_MATERIALIZED',
          financial_safety_status: 'attention_required',
        });

        if (parsedEvent?.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(
            this.provider.name,
            parsedEvent.providerEventId,
            'processed',
            'STALE_PROVIDER_CHECKOUT_MATERIALIZED'
          );
        }

        return { status: 'ok', processed: false, reason: 'STALE_PROVIDER_CHECKOUT_MATERIALIZED' };
      }

      if (parsedEvent?.eventType === 'payment_confirmed' || parsedEvent?.eventType === 'payment_received') {
        console.error(
          `[STALE EARLY ACTIVATION ATTEMPT] Pagamento recebido para tentativa antiga ${matchedAttempt.attempt_id} != corrente ${currentAttemptId}.`
        );
        return await this.recordStaleSettledPaymentLedger({
          planChange,
          matchedAttempt,
          parsedEvent,
          now,
          nowIso,
          ministryId,
        });
      }

      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: true, reason: 'stale_attempt_event_ignored' };
    }

    // 1. Readiness Gate da transição
    if (
      planChange.transition_status !== 'scheduled' ||
      planChange.supersede_status !== 'completed' ||
      planChange.payment_cleanup_status !== 'completed'
    ) {
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'SOURCE_CUTOVER_NOT_COMPLETED' };
    }

    if (planChange.financial_attention_required === true) {
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'financial_attention_required' };
    }

    if (planChange.financial_safety_status !== 'live') {
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'FINANCIAL_SAFETY_STATUS_NOT_LIVE' };
    }

    // Canceled/Expired attempt race (Seção 31)
    if (matchedAttempt.status === 'canceled' || matchedAttempt.status === 'expired') {
      if (parsedEvent?.eventType === 'payment_confirmed' || parsedEvent?.eventType === 'payment_received') {
        console.error(
          `[CANCELED ATTEMPT PAYMENT CONFLICT] Pagamento liquidado em tentativa cancelada/expirada ${matchedAttempt.attempt_id}.`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT',
          financial_safety_status: 'attention_required',
        });
        if (parsedEvent?.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(
            this.provider.name,
            parsedEvent.providerEventId,
            'failed',
            'CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT'
          );
        }
        return { status: 'ok', processed: false, reason: 'CANCELED_ATTEMPT_WITH_SETTLED_PAYMENT' };
      }
    }

    // 3. Tratamento de eventos de checkout
    if (parsedEvent?.eventType === 'checkout_created') {
      // 3.1 Se o attempt já está concluído ('completed'), evento atrasado é no-op monotônico
      if (matchedAttempt.status === 'completed') {
        if (parsedEvent.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        }
        return { status: 'ok', processed: true, reason: 'attempt_already_completed' };
      }

      // 3.2 Validação Write-Once do provider_checkout_id no attempt
      if (
        parsedEvent.providerCheckoutId &&
        matchedAttempt.provider_checkout_id &&
        matchedAttempt.provider_checkout_id !== parsedEvent.providerCheckoutId
      ) {
        console.error(
          `[EARLY ACTIVATION CHECKOUT CONFLICT] providerCheckoutId divergente para attempt ${matchedAttempt.attempt_id}: existing ${matchedAttempt.provider_checkout_id} vs incoming ${parsedEvent.providerCheckoutId}`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'CHECKOUT_ID_WRITE_ONCE_CONFLICT',
          financial_safety_status: 'attention_required',
        });
        if (parsedEvent.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(
            this.provider.name,
            parsedEvent.providerEventId,
            'failed',
            'CHECKOUT_ID_WRITE_ONCE_CONFLICT'
          );
        }
        return { status: 'ok', processed: false, reason: 'CHECKOUT_ID_WRITE_ONCE_CONFLICT' };
      }

      // 3.3 Idempotência no current attempt: se já tem o mesmo provider_checkout_id
      if (
        parsedEvent.providerCheckoutId &&
        matchedAttempt.provider_checkout_id === parsedEvent.providerCheckoutId
      ) {
        if (parsedEvent.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        }
        return { status: 'ok', processed: true, reason: 'checkout_created_already_acknowledged' };
      }

      // 3.4 Tentativa corrente: correlacionar e persistir provider_checkout_id
      if (parsedEvent.providerCheckoutId && !matchedAttempt.provider_checkout_id) {
        // Validação Write-Once na transição
        if (
          planChange.early_activation_provider_checkout_id &&
          planChange.early_activation_provider_checkout_id !== parsedEvent.providerCheckoutId
        ) {
          console.error(
            `[EARLY ACTIVATION CHECKOUT CONFLICT] transition.early_activation_provider_checkout_id divergente: existing ${planChange.early_activation_provider_checkout_id} vs incoming ${parsedEvent.providerCheckoutId}`
          );
          await this.billingRepo.updateTransition(planChange.id, ministryId, {
            financial_attention_required: true,
            financial_attention_reason: 'CHECKOUT_ID_WRITE_ONCE_CONFLICT',
            financial_safety_status: 'attention_required',
          });
          if (parsedEvent.providerEventId) {
            await this.billingRepo.markWebhookEventProcessed(
              this.provider.name,
              parsedEvent.providerEventId,
              'failed',
              'CHECKOUT_ID_WRITE_ONCE_CONFLICT'
            );
          }
          return { status: 'ok', processed: false, reason: 'CHECKOUT_ID_WRITE_ONCE_CONFLICT' };
        }

        matchedAttempt.provider_checkout_id = parsedEvent.providerCheckoutId;
        matchedAttempt.provider_create_state = 'created';
        // Se a tentativa estava em 'uncertain' (devido a OUTCOME_UNCERTAIN), recupera com sucesso para 'pending'
        if (matchedAttempt.status === 'uncertain') {
          matchedAttempt.status = 'pending';
        }
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          early_activation_provider_checkout_id: parsedEvent.providerCheckoutId,
          checkout_attempts: planChange.checkout_attempts,
        });
      }
      if (parsedEvent.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: true, reason: 'checkout_created_acknowledged' };
    }

    if (parsedEvent?.eventType === 'checkout_expired' || parsedEvent?.eventType === 'checkout_canceled') {
      // Monotonicidade: Se o attempt já está 'completed', eventos tardios não regridem o status!
      if (matchedAttempt.status === 'completed') {
        if (parsedEvent.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        }
        return { status: 'ok', processed: true, reason: 'attempt_already_completed' };
      }

      matchedAttempt.status = parsedEvent.eventType === 'checkout_expired' ? 'expired' : 'canceled';
      matchedAttempt.completed_at = nowIso;
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        checkout_attempts: planChange.checkout_attempts,
      });
      if (parsedEvent.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: true, reason: `attempt_${matchedAttempt.status}` };
    }

    // 4. Descoberta do pagamento exato do provedor
    let exactPaymentId =
      parsedEvent?.providerPaymentId ||
      matchedAttempt.provider_payment_id ||
      planChange.early_activation_provider_payment_id;

    if (!exactPaymentId && (matchedAttempt.provider_checkout_id || planChange.early_activation_provider_checkout_id)) {
      const chkId = matchedAttempt.provider_checkout_id || planChange.early_activation_provider_checkout_id!;
      if (typeof this.provider.listPaymentsByCheckoutSession === 'function') {
        try {
          const sessionPayments = await this.provider.listPaymentsByCheckoutSession(chkId);
          if (Array.isArray(sessionPayments) && sessionPayments.length > 0) {
            const found =
              sessionPayments.find((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED') || sessionPayments[0];
            if (found && found.id) {
              exactPaymentId = found.id;
            }
          }
        } catch (chkErr: any) {
          console.warn(`[EARLY ACTIVATION CHECKOUT PAYMENTS] Erro ao listar cobranças da sessão ${chkId}:`, chkErr?.message);
        }
      }
    }

    // Se o evento foi checkout_paid e ainda não temos payment liquidado (Seção 8):
    if (parsedEvent?.eventType === 'checkout_paid') {
      matchedAttempt.status = 'completed';
      matchedAttempt.completed_at = nowIso;
      if (exactPaymentId && !matchedAttempt.provider_payment_id) {
        matchedAttempt.provider_payment_id = exactPaymentId;
      }
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        checkout_attempts: planChange.checkout_attempts,
      });

      if (!exactPaymentId) {
        if (parsedEvent.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        }
        return { status: 'ok', processed: true, reason: 'checkout_paid_awaiting_payment_confirmation' };
      }
    }

    if (!exactPaymentId) {
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'PAYMENT_NOT_FOUND' };
    }

    // Isolamento Detached vs Recurring (Seção 5 & 39):
    if (planChange.future_provider_payment_id && exactPaymentId === planChange.future_provider_payment_id) {
      console.warn(`[CROSS-ROUTING ISOLATION] Pagamento ${exactPaymentId} é o future renewal payment, não o early adjustment.`);
      return await this.processScheduledPaidRenewalSettlement(parsedEvent, planChange, now, options);
    }

    // 5. Fresh Payment Read & Validações de Status e Valor
    let payment: any = null;
    if (typeof (this.provider as any).getPayment === 'function') {
      try {
        payment = await (this.provider as any).getPayment(exactPaymentId);
      } catch (payErr: any) {
        console.warn(`[EARLY ACTIVATION PAYMENT FRESH READ] Aviso ao consultar cobrança ${exactPaymentId}:`, payErr?.message);
      }
    }

    const paymentStatus = (
      payment?.status ||
      parsedEvent?.status ||
      (parsedEvent?.eventType === 'payment_confirmed'
        ? 'CONFIRMED'
        : parsedEvent?.eventType === 'payment_received'
        ? 'RECEIVED'
        : 'UNKNOWN')
    ).toUpperCase();

    // Reversal check pré-ativação (Seção 37)
    if (paymentStatus === 'REFUNDED' || paymentStatus === 'CHARGEBACK') {
      console.error(`[EARLY ADJUSTMENT REVERSAL] Pagamento ${exactPaymentId} está ${paymentStatus}. Ativação bloqueada.`);
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: `EARLY_ADJUSTMENT_PAYMENT_REVERSED_${paymentStatus}`,
        financial_safety_status: 'attention_required',
      });
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          `EARLY_ADJUSTMENT_PAYMENT_REVERSED_${paymentStatus}`
        );
      }
      return { status: 'ok', processed: false, reason: `ADJUSTMENT_PAYMENT_REVERSED_${paymentStatus}` };
    }

    // Apenas CONFIRMED ou RECEIVED abrem o settlement gate (Seção 7)
    if (paymentStatus !== 'CONFIRMED' && paymentStatus !== 'RECEIVED') {
      console.log(`[EARLY ACTIVATION NOT SETTLED] Pagamento ${exactPaymentId} em status ${paymentStatus}. Entitlement mantido na source.`);
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'payment_not_settled' };
    }

    // Validação de sessão do checkout (Seção 6)
    const paymentCheckoutSession = payment?.checkoutSession || parsedEvent?.providerCheckoutId;
    const expectedCheckoutId = matchedAttempt.provider_checkout_id || planChange.early_activation_provider_checkout_id;
    if (paymentCheckoutSession && expectedCheckoutId && paymentCheckoutSession !== expectedCheckoutId) {
      console.error(
        `[EARLY ACTIVATION CHECKOUT MISMATCH] payment.checkoutSession ${paymentCheckoutSession} != expected ${expectedCheckoutId}.`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'EARLY_ADJUSTMENT_CHECKOUT_SESSION_MISMATCH',
        financial_safety_status: 'attention_required',
      });
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          'EARLY_ADJUSTMENT_CHECKOUT_SESSION_MISMATCH'
        );
      }
      return { status: 'ok', processed: false, reason: 'EARLY_ADJUSTMENT_CHECKOUT_SESSION_MISMATCH' };
    }

    // Validação de valor do adjustment (Seção 6)
    const expectedAmountCents =
      planChange.current_early_activation_quote?.prorated_adjustment_cents ||
      planChange.prorated_adjustment_cents ||
      matchedAttempt.amount_cents;

    const paidAmountCents =
      payment?.amountCents !== undefined
        ? payment.amountCents
        : parsedEvent?.amountCents !== undefined
        ? parsedEvent.amountCents
        : expectedAmountCents;

    if (expectedAmountCents && paidAmountCents !== expectedAmountCents) {
      console.error(
        `[EARLY ADJUSTMENT AMOUNT MISMATCH] Valor pago (${paidAmountCents}) diverge do valor esperado (${expectedAmountCents}).`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'EARLY_ADJUSTMENT_AMOUNT_MISMATCH',
        financial_safety_status: 'attention_required',
      });
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          'EARLY_ADJUSTMENT_AMOUNT_MISMATCH'
        );
      }
      return { status: 'ok', processed: false, reason: 'EARLY_ADJUSTMENT_AMOUNT_MISMATCH' };
    }

    // 6. Proveniência Temporal
    let paidBillingDate: string;
    let paymentConfirmationInstant: string;
    const rawConfirmDate =
      payment?.confirmedDate || payment?.paymentDate || parsedEvent?.confirmedDate || parsedEvent?.paymentDate;
    if (rawConfirmDate && typeof rawConfirmDate === 'string' && rawConfirmDate.trim()) {
      const trimmed = rawConfirmDate.trim();
      if (trimmed.includes('T')) {
        paymentConfirmationInstant = new Date(trimmed).toISOString();
        paidBillingDate = getBillingDate(paymentConfirmationInstant, config.billingTimezone);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        paidBillingDate = trimmed;
        paymentConfirmationInstant = nowIso;
      } else {
        paymentConfirmationInstant = nowIso;
        paidBillingDate = getBillingDate(now, config.billingTimezone);
      }
    } else {
      paymentConfirmationInstant = nowIso;
      paidBillingDate = getBillingDate(now, config.billingTimezone);
    }

    // 7. Commercial Boundary Guard (Seções 14 e 36)
    const effectiveBillingDate = planChange.effective_billing_date;
    if (effectiveBillingDate && currentCommercialDate >= effectiveBillingDate) {
      console.warn(
        `[LATE EARLY ADJUSTMENT SETTLEMENT] Pagamento de ajuste liquidado em ${currentCommercialDate} >= fronteira de renovação ${effectiveBillingDate}. Não auto-ativa.`
      );

      const txId = `${this.provider.name}_${exactPaymentId}`;
      try {
        await this.billingRepo.saveTransaction({
          id: txId,
          ministry_id: ministryId,
          provider: this.provider.name,
          provider_payment_id: exactPaymentId,
          amount_cents: paidAmountCents,
          currency: 'BRL',
          status: 'paid',
          due_date: payment?.dueDate || paidBillingDate,
          paid_at: paymentConfirmationInstant,
          paid_billing_date: paidBillingDate,
          payment_method: payment?.billingType || parsedEvent?.paymentMethod || 'CREDIT_CARD',
          invoice_url: payment?.invoiceUrl || parsedEvent?.invoiceUrl,
          transaction_type: 'prorated_early_activation_adjustment',
          quote_id: planChange.current_early_activation_quote?.quote_id || null,
          attempt_id: matchedAttempt.attempt_id,
          created_at: nowIso,
          updated_at: nowIso,
        });
      } catch (txErr: any) {
        console.warn(`[LATE ADJUSTMENT TX] Transação já salva ou aviso:`, txErr?.message);
      }

      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'LATE_EARLY_ADJUSTMENT_SETTLEMENT',
        financial_safety_status: 'attention_required',
      });

      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'LATE_EARLY_ADJUSTMENT_SETTLEMENT' };
    }

    // 8. Persistência de Evidência Financeira Write-Once (Seção 9)
    try {
      await this.billingRepo.recordEarlyAdjustmentFinancialSettlement({
        transitionId: planChange.id,
        ministryId,
        providerPaymentId: exactPaymentId,
        paidBillingDate,
        settledAt: paymentConfirmationInstant,
        attemptId: matchedAttempt.attempt_id,
        nowIso,
      });
    } catch (settleErr: any) {
      if (settleErr?.details?.code === 'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT') {
        console.error(`[EARLY ADJUSTMENT CONFLICT] ${settleErr.message}`);
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT',
          financial_safety_status: 'attention_required',
        });
        if (parsedEvent?.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(
            this.provider.name,
            parsedEvent.providerEventId,
            'failed',
            'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT'
          );
        }
        return { status: 'ok', processed: false, reason: 'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT' };
      }
      throw settleErr;
    }

    // 9. Criação da BillingTransaction Canônica de forma idempotente (Seção 10 & 35)
    const txId = `${this.provider.name}_${exactPaymentId}`;
    try {
      await this.billingRepo.saveTransaction({
        id: txId,
        ministry_id: ministryId,
        provider: this.provider.name,
        provider_payment_id: exactPaymentId,
        amount_cents: paidAmountCents,
        currency: 'BRL',
        status: 'paid',
        due_date: payment?.dueDate || paidBillingDate,
        paid_at: paymentConfirmationInstant,
        paid_billing_date: paidBillingDate,
        payment_method: payment?.billingType || parsedEvent?.paymentMethod || 'CREDIT_CARD',
        invoice_url: payment?.invoiceUrl || parsedEvent?.invoiceUrl,
        transaction_type: 'prorated_early_activation_adjustment',
        quote_id: planChange.current_early_activation_quote?.quote_id || null,
        attempt_id: matchedAttempt.attempt_id,
        created_at: nowIso,
        updated_at: nowIso,
      });
    } catch (txErr: any) {
      const errCode = txErr instanceof AppError ? (txErr.details as any)?.code : txErr?.code;
      if (errCode === 'CONFLICTING_FINANCIAL_DATE' || errCode === 'CONFLICTING_FINANCIAL_AMOUNT') {
        console.error(`[FINANCIAL TRANSACTION CONFLICT] ${txErr.message}`);
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: 'FINANCIAL_TRANSACTION_CONFLICT',
          financial_safety_status: 'attention_required',
        });
        if (parsedEvent?.providerEventId) {
          await this.billingRepo.markWebhookEventProcessed(
            this.provider.name,
            parsedEvent.providerEventId,
            'failed',
            'FINANCIAL_TRANSACTION_CONFLICT'
          );
        }
        return { status: 'ok', processed: false, reason: 'FINANCIAL_TRANSACTION_CONFLICT' };
      }
      throw txErr;
    }

    // 10. Fresh Reread antes de mutar entitlement (Seção 12)
    const freshTr = await this.billingRepo.getTransitionById(planChange.id, ministryId);
    if (!freshTr || !isBillingTransitionV1(freshTr)) {
      throw new AppError(404, 'Transição não encontrada após registro de liquidação.');
    }

    // 11. Aplicar target_entitlement_snapshot imutável no runtime (SubscriptionService) (Seções 17 e 18)
    const targetSnapshot = freshTr.target_entitlement_snapshot || {
      plan_id: freshTr.target_plan_id,
      addon_blocks: freshTr.target_addon_blocks,
      interval: freshTr.target_interval,
      effective_member_quota: getEffectiveMemberQuota(
        getPlanDefinition(freshTr.target_plan_id),
        freshTr.target_addon_blocks
      ),
      effective_song_quota: getEffectiveSongQuota(getPlanDefinition(freshTr.target_plan_id)),
    };

    if (typeof (this.subscriptionService as any).applyLockedEntitlementSnapshot === 'function') {
      await (this.subscriptionService as any).applyLockedEntitlementSnapshot(ministryId, targetSnapshot);
    } else {
      await this.subscriptionService.changePlan(ministryId, freshTr.target_plan_id);
      await this.subscriptionService.changeMemberAddonBlocks(ministryId, freshTr.target_addon_blocks || 0);
    }

    // 12. Convergir MinistrySubscription preservando o período comercial original (Seção 3 & 19)
    const currentSub = await this.subscriptionRepo.getSubscription(ministryId);
    if (currentSub) {
      await this.subscriptionRepo.setSubscription({
        ...currentSub,
        plan_id: targetSnapshot.plan_id,
        member_addon_blocks: targetSnapshot.addon_blocks,
        billing_status: 'active',
        subscription_mode: 'paid',
        locked_member_quota: targetSnapshot.effective_member_quota,
        locked_song_quota: targetSnapshot.effective_song_quota,
        entitlement_snapshot: targetSnapshot,
        grace_period_expires_at: null,
        grace_period_expires_billing_date: null,
        // INVARIANTE RIGOROSA: datas do ciclo comercial da origem NÃO MUDAM!
        current_period_start: currentSub.current_period_start,
        current_period_end: currentSub.current_period_end,
        updated_at: nowIso,
      });
    }

    // 13. Local Early Activation Completion Gate (Seção 34)
    const reloadedAppSub = await this.subscriptionRepo.getSubscription(ministryId);
    let reloadedTx: any = null;
    if (typeof (this.billingRepo as any).getTransaction === 'function') {
      reloadedTx = await (this.billingRepo as any).getTransaction(this.provider.name, exactPaymentId);
      if (!reloadedTx) {
        reloadedTx = await (this.billingRepo as any).getTransaction(txId);
      }
    } else {
      reloadedTx = { id: txId, status: 'paid', provider_payment_id: exactPaymentId };
    }

    const latestTr = await this.billingRepo.getTransitionById(planChange.id, ministryId);

    const appSubValid =
      reloadedAppSub &&
      reloadedAppSub.plan_id === targetSnapshot.plan_id &&
      (reloadedAppSub.member_addon_blocks || 0) === targetSnapshot.addon_blocks &&
      reloadedAppSub.billing_status === 'active';

    const txValid =
      reloadedTx &&
      reloadedTx.status === 'paid' &&
      reloadedTx.provider_payment_id === exactPaymentId;

    const paymentIsolationValid =
      latestTr &&
      isBillingTransitionV1(latestTr) &&
      latestTr.early_activation_provider_payment_id === exactPaymentId &&
      latestTr.future_provider_payment_id !== exactPaymentId;

    const transitionStateValid =
      latestTr &&
      isBillingTransitionV1(latestTr) &&
      latestTr.transition_status === 'scheduled' &&
      latestTr.financial_safety_status === 'live';

    if (!appSubValid || !txValid || !paymentIsolationValid || !transitionStateValid) {
      console.error(
        `[LOCAL EARLY ACTIVATION COMPLETION GATE FAILED] Local state not fully converged: appSub=${Boolean(
          appSubValid
        )}, tx=${Boolean(txValid)}, isolation=${Boolean(paymentIsolationValid)}, state=${Boolean(
          transitionStateValid
        )}. Slot remains HELD.`
      );
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      }
      return { status: 'ok', processed: false, reason: 'LOCAL_EARLY_ACTIVATION_COMPLETION_GATE_FAILED' };
    }

    // 14. Confirmar ativação (Seção 22, 23 & 24):
    // early_activation_status = 'activated'
    // transition_status PERMANECE 'scheduled'
    // financial_safety_status PERMANECE 'live'
    // slot PERMANECE 'HELD'
    await this.billingRepo.confirmEarlyActivationEntitlement({
      transitionId: planChange.id,
      ministryId,
      providerPaymentId: exactPaymentId,
      attemptId: matchedAttempt.attempt_id,
      nowIso,
    });

    if (parsedEvent?.providerEventId) {
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
    }

    return { status: 'ok', processed: true, reason: 'early_activation_settled_and_promoted' };
  }

  /**
   * Registra a evidência financeira de um pagamento liquidado pertencente a uma tentativa stale/histórica (Phase 3C.4 Ledger Patch).
   *
   * Invariantes:
   * 1. Um pagamento liquidado no gateway é um fato financeiro real e deve ser registrado em BillingTransaction canônica,
   *    mesmo quando NÃO concede entitlement (financial validity for entitlement != financial existence).
   * 2. Preserva provider_payment_id e paid_at write-once exclusivamente no attempt antigo.
   * 3. NÃO ativa target entitlement e NÃO regride se já ativado.
   * 4. NÃO associa o pagamento ao current attempt e NÃO substitui transition-level payment IDs.
   * 5. Aciona financial_attention_required = true (razão STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED ou FINANCIAL_TRANSACTION_CONFLICT).
   * 6. Retém o slot ativo HELD e mantém a transição scheduled.
   * 7. Zero auto-refund e zero cancelamento.
   */
  private async recordStaleSettledPaymentLedger(params: {
    planChange: BillingTransitionV1Record;
    matchedAttempt: BillingCheckoutAttempt;
    parsedEvent: any;
    now: Date;
    nowIso: string;
    ministryId: string;
  }): Promise<{ status: string; processed: boolean; reason: string }> {
    const { planChange, matchedAttempt, parsedEvent, now, nowIso, ministryId } = params;
    const exactPaymentId = parsedEvent?.providerPaymentId || matchedAttempt.provider_payment_id;

    if (!exactPaymentId) {
      return { status: 'ok', processed: false, reason: 'STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED' };
    }

    // Validação write-once no próprio attempt antigo: se já tem payment ID diferente
    if (
      parsedEvent?.providerPaymentId &&
      matchedAttempt.provider_payment_id &&
      matchedAttempt.provider_payment_id !== parsedEvent.providerPaymentId
    ) {
      console.error(
        `[STALE ATTEMPT PAYMENT CONFLICT] providerPaymentId divergente para tentativa antiga ${matchedAttempt.attempt_id}: existing ${matchedAttempt.provider_payment_id} vs incoming ${parsedEvent.providerPaymentId}`
      );
      await this.billingRepo.updateTransition(planChange.id, ministryId, {
        financial_attention_required: true,
        financial_attention_reason: 'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT',
        financial_safety_status: 'attention_required',
      });
      if (parsedEvent?.providerEventId) {
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT'
        );
      }
      return { status: 'ok', processed: false, reason: 'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT' };
    }

    // 1. Consulta opcional de payment para dados de proveniência
    let payment: any = null;
    if (typeof (this.provider as any).getPayment === 'function') {
      try {
        payment = await (this.provider as any).getPayment(exactPaymentId);
      } catch (payErr: any) {
        console.warn(`[STALE PAYMENT FRESH READ] Aviso ao consultar cobrança ${exactPaymentId}:`, payErr?.message);
      }
    }

    // 2. Proveniência temporal
    let paidBillingDate: string;
    let paymentConfirmationInstant: string;
    const rawConfirmDate =
      payment?.confirmedDate || payment?.paymentDate || parsedEvent?.confirmedDate || parsedEvent?.paymentDate;
    if (rawConfirmDate && typeof rawConfirmDate === 'string' && rawConfirmDate.trim()) {
      const trimmed = rawConfirmDate.trim();
      if (trimmed.includes('T')) {
        paymentConfirmationInstant = new Date(trimmed).toISOString();
        paidBillingDate = getBillingDate(paymentConfirmationInstant, config.billingTimezone);
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        paidBillingDate = trimmed;
        paymentConfirmationInstant = nowIso;
      } else {
        paymentConfirmationInstant = nowIso;
        paidBillingDate = getBillingDate(now, config.billingTimezone);
      }
    } else {
      paymentConfirmationInstant = nowIso;
      paidBillingDate = getBillingDate(now, config.billingTimezone);
    }

    // 3. Montagem e gravação idempotente da BillingTransaction canônica
    const paidAmountCents =
      payment?.amountCents !== undefined
        ? payment.amountCents
        : parsedEvent?.amountCents !== undefined
        ? parsedEvent.amountCents
        : matchedAttempt.amount_cents || 0;

    const txId = `${this.provider.name}_${exactPaymentId}`;
    let txConflict = false;
    try {
      await this.billingRepo.saveTransaction({
        id: txId,
        ministry_id: ministryId,
        provider: this.provider.name,
        provider_payment_id: exactPaymentId,
        amount_cents: paidAmountCents,
        currency: 'BRL',
        status: 'paid',
        due_date: payment?.dueDate || paidBillingDate,
        paid_at: paymentConfirmationInstant,
        paid_billing_date: paidBillingDate,
        payment_method: payment?.billingType || parsedEvent?.paymentMethod || 'CREDIT_CARD',
        invoice_url: payment?.invoiceUrl || parsedEvent?.invoiceUrl,
        transaction_type: 'prorated_early_activation_adjustment',
        quote_id: matchedAttempt.quote_id || null,
        attempt_id: matchedAttempt.attempt_id,
        created_at: nowIso,
        updated_at: nowIso,
      });
    } catch (txErr: any) {
      const errCode = txErr instanceof AppError ? (txErr.details as any)?.code : txErr?.code;
      if (errCode === 'CONFLICTING_FINANCIAL_DATE' || errCode === 'CONFLICTING_FINANCIAL_AMOUNT') {
        console.error(`[FINANCIAL TRANSACTION CONFLICT] Conflito em stale transaction ${txId}: ${txErr.message}`);
        txConflict = true;
      } else {
        throw txErr;
      }
    }

    // 4. Preservação write-once no attempt antigo (sem tocar na transição nem no current attempt)
    if (parsedEvent?.providerPaymentId && !matchedAttempt.provider_payment_id) {
      matchedAttempt.provider_payment_id = parsedEvent.providerPaymentId;
      matchedAttempt.paid_at = paymentConfirmationInstant;
    }

    const reason = txConflict ? 'FINANCIAL_TRANSACTION_CONFLICT' : 'STALE_ATTEMPT_EARLY_ADJUSTMENT_SETTLED';

    await this.billingRepo.updateTransition(planChange.id, ministryId, {
      checkout_attempts: planChange.checkout_attempts,
      financial_attention_required: true,
      financial_attention_reason: reason,
      financial_safety_status: 'attention_required',
    });

    if (parsedEvent?.providerEventId) {
      await this.billingRepo.markWebhookEventProcessed(
        this.provider.name,
        parsedEvent.providerEventId,
        txConflict ? 'failed' : 'processed',
        reason
      );
    }

    return { status: 'ok', processed: false, reason };
  }

  /**
   * Retorna o histórico de faturas e transações financeiras.
   */
  async getBillingHistory(ministryId: string): Promise<BillingTransactionRecord[]> {
    return await this.billingRepo.getTransactions(ministryId);
  }

  /**
   * Cria e persiste atomicamente uma cotação determinística de ativação antecipada.
   * NÃO chama o gateway Asaas (zero provider mutation).
   * Usa SOMENTE dados econômicos travados da transição V1 (nunca reprecifica via catálogo).
   */
  async createEarlyActivationQuote(
    ministryId: string,
    userId: string,
    transitionId: string,
    options?: { now?: Date | string }
  ): Promise<EarlyActivationQuoteResponseDto> {
    if (!ministryId || !transitionId) {
      throw new AppError(400, 'ministryId e transitionId são obrigatórios.');
    }

    const transition = await this.billingRepo.getPlanChange(transitionId);
    if (!transition) {
      throw new AppError(404, `Transição '${transitionId}' não encontrada.`);
    }

    if (transition.ministry_id !== ministryId) {
      throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
    }

    if (!isBillingTransitionV1(transition)) {
      throw new AppError(400, 'Ativação antecipada é suportada exclusivamente em transições V1.');
    }

    // 1. Validações de pré-requisitos canônicos da transição V1 (Seção 4)
    if (transition.execution_strategy !== 'scheduled_paid_transition') {
      throw new AppError(400, `Estratégia '${transition.execution_strategy}' não permite early activation.`);
    }

    if (transition.transition_status !== 'scheduled') {
      throw new AppError(400, `Transição em status '${transition.transition_status}' não permite cotação de early activation (exigido 'scheduled').`);
    }

    if (transition.supersede_status !== 'completed') {
      throw new AppError(400, 'Transição anterior ainda não foi finalizada (supersede_status incompleto).');
    }

    if (transition.payment_cleanup_status !== 'completed') {
      throw new AppError(400, 'Limpeza de cobranças antigas ainda não foi finalizada.');
    }

    if (transition.financial_safety_status !== 'live') {
      throw new AppError(400, `Estado de segurança financeira '${transition.financial_safety_status}' inválido.`);
    }

    if (transition.financial_attention_required === true) {
      throw new AppError(400, 'Transição requer atenção financeira. Cotação bloqueada.');
    }

    const timeZone = config.billingTimezone || BILLING_TIMEZONE_DEFAULT;
    const nowIso = options?.now
      ? (typeof options.now === 'string' ? new Date(options.now) : options.now).toISOString()
      : new Date().toISOString();
    const currentCommercialDate = getBillingDate(nowIso, timeZone);

    if (transition.effective_billing_date && currentCommercialDate >= transition.effective_billing_date) {
      throw new AppError(
        400,
        `Data comercial atual (${currentCommercialDate}) atingiu ou ultrapassou a fronteira da renovação (${transition.effective_billing_date}).`
      );
    }

    if (!transition.target_entitlement_snapshot) {
      throw new AppError(400, 'Snapshot de entitlement de destino ausente na transição.');
    }

    if (
      transition.source_current_cycle_total_cents === undefined ||
      transition.source_current_cycle_total_cents === null ||
      transition.target_current_cycle_total_cents === undefined ||
      transition.target_current_cycle_total_cents === null
    ) {
      throw new AppError(400, 'Totais financeiros do ciclo corrente ausentes na transição.');
    }

    const sourceCurrentCycleTotalCents = transition.source_current_cycle_total_cents;
    const targetCurrentCycleTotalCents = transition.target_current_cycle_total_cents;

    // 2. Validação estrita de Pure Upgrade e Delta Positivo
    const capabilityCheck = classifyCapabilityEligibility(
      transition.source_entitlement_snapshot,
      transition.target_entitlement_snapshot,
      {
        priceDeltaCents: targetCurrentCycleTotalCents - sourceCurrentCycleTotalCents,
      }
    );

    if (capabilityCheck.classification !== 'pure_upgrade' || !capabilityCheck.early_activation_eligible) {
      throw new AppError(
        400,
        `Transição não é elegível para early activation: classificação '${capabilityCheck.classification}'. Motivo: ${capabilityCheck.reason || 'Upgrade estrito de capacidades obrigatório'}.`
      );
    }

    const deltaCents = targetCurrentCycleTotalCents - sourceCurrentCycleTotalCents;
    if (deltaCents <= 0) {
      throw new AppError(400, 'Diferença de preço entre destino e origem deve ser estritamente positiva.');
    }

    // 3. Validação de Ausência de Obrigação Financeira Viva
    if (isEarlyAdjustmentObligationFinanciallyLive(transition)) {
      const state = classifyEarlyAdjustmentFinancialState(transition);
      throw new AppError(
        409,
        `Existe uma obrigação financeira de ativação antecipada ativa ou não resolvida (estado: '${state}').`
      );
    }

    if (transition.early_activation_status === 'payment_pending') {
      throw new AppError(409, 'Existe um pagamento de ativação antecipada pendente de confirmação.');
    }

    // 4. Montar Snapshot Comercial usando ESTRITAMENTE dados travados na transição
    const classification = classifyTransition(
      {
        plan_id: transition.source_plan_id,
        interval: transition.source_interval,
        addon_blocks: transition.source_addon_blocks,
        current_period_start: transition.current_period_start,
        current_period_end: transition.current_period_end,
      },
      {
        plan_id: transition.target_plan_id,
        interval: transition.target_interval,
        addon_blocks: transition.target_addon_blocks,
      }
    );

    const commercialSnapshot: TransitionCommercialSnapshot = {
      classification,
      transition_type: transition.transition_type,
      execution_strategy: transition.execution_strategy,
      early_activation_eligible: true,
      source_plan_id: transition.source_plan_id,
      source_interval: transition.source_interval,
      source_addon_blocks: transition.source_addon_blocks,
      source_entitlement_snapshot: transition.source_entitlement_snapshot,
      source_current_cycle_total_cents: sourceCurrentCycleTotalCents,
      current_period_start: transition.current_period_start,
      current_period_end: transition.current_period_end,
      current_period_start_date: transition.current_period_start
        ? getBillingDate(transition.current_period_start, timeZone)
        : null,
      current_period_end_date: transition.current_period_end
        ? getBillingDate(transition.current_period_end, timeZone)
        : null,
      target_plan_id: transition.target_plan_id,
      target_interval: transition.target_interval,
      target_addon_blocks: transition.target_addon_blocks,
      target_future_recurring_price_cents: transition.target_future_recurring_price_cents,
      target_current_cycle_total_cents: targetCurrentCycleTotalCents,
      target_entitlement_snapshot: transition.target_entitlement_snapshot,
      early_activation_target_entitlement_snapshot:
        transition.early_activation_target_entitlement_snapshot || transition.target_entitlement_snapshot,
      currency: 'BRL',
      price_locked_at: transition.price_locked_at,
      effective_at: transition.effective_at || transition.current_period_end || nowIso,
      effective_billing_date:
        transition.effective_billing_date ||
        (transition.current_period_end ? getBillingDate(transition.current_period_end, timeZone) : currentCommercialDate),
    };

    // 5. Criar cotação determinística pura (sem chamada externa)
    const quote = createEarlyActivationQuote(commercialSnapshot, {
      transitionId,
      ministryId,
      now: nowIso,
      timeZone,
    });

    // 6. Persistência atômica com CAS no Firestore
    const { quote: persistedQuote } = await this.billingRepo.recordEarlyActivationQuote({
      ministryId,
      transitionId,
      quote,
      nowIso,
    });

    // 7. Retornar DTO de resposta limpo e sanitizado
    return {
      quoteId: persistedQuote.quote_id,
      transitionId: persistedQuote.transition_id,
      sourcePlanId: transition.source_plan_id,
      targetPlanId: transition.target_plan_id,
      currentPeriodStartBillingDate: commercialSnapshot.current_period_start_date || '',
      currentPeriodEndBillingDate: commercialSnapshot.current_period_end_date || '',
      quoteBillingDate: persistedQuote.quote_effective_billing_date,
      totalDays: persistedQuote.total_days || 0,
      remainingDays: persistedQuote.remaining_days || 0,
      sourceCurrentCycleTotalCents: persistedQuote.source_current_cycle_total_cents,
      targetCurrentCycleTotalCents: persistedQuote.target_current_cycle_total_cents,
      priceDeltaCents: persistedQuote.price_delta_cents || 0,
      proratedAdjustmentCents: persistedQuote.prorated_adjustment_cents,
      currency: 'BRL',
      expiresAt: persistedQuote.expires_at,
      nextRenewalBillingDate: transition.effective_billing_date || '',
      nextRecurringAmountCents: transition.target_future_recurring_price_cents,
    };
  }

  /**
   * Inicia o fluxo de checkout avulso (DETACHED) de early activation no Asaas.
   * Cria registro atômico de tentativa ('reserved') no Firestore ANTES de qualquer chamada externa.
   * Transiciona 'reserved' -> 'attempting' via CAS estrito.
   * Zero blind retry. Não ativa entitlement.
   */
  async createEarlyActivationCheckout(
    ministryId: string,
    userId: string,
    transitionId: string,
    quoteId: string,
    options?: {
      customerData?: {
        name?: string;
        email?: string;
        cpfCnpj?: string;
        phone?: string;
      };
      now?: Date | string;
    }
  ): Promise<{
    checkoutUrl: string;
    checkoutId: string;
    attemptId: string;
    quoteId: string;
    amountCents: number;
    minutesToExpire: number;
    expiresAt: string | null;
  }> {
    // 1. Obter a transição V1 vigente
    const transition = await this.billingRepo.getPlanChange(transitionId);
    if (!transition) {
      throw new AppError(404, `Transição '${transitionId}' não encontrada.`);
    }
    if (transition.ministry_id !== ministryId) {
      throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
    }
    if (!isBillingTransitionV1(transition)) {
      throw new AppError(400, 'Ativação antecipada é suportada exclusivamente em transições V1.');
    }

    if (transition.execution_strategy !== 'scheduled_paid_transition') {
      throw new AppError(400, `Estratégia '${transition.execution_strategy}' não permite ativação antecipada.`);
    }

    if (transition.transition_status !== 'scheduled') {
      throw new AppError(409, `Transição em status '${transition.transition_status}' não permite ativação antecipada (exigido 'scheduled').`);
    }

    if (transition.financial_attention_required === true) {
      throw new AppError(409, 'Transição requer atenção financeira. Operação bloqueada.', {
        code: 'FINANCIAL_ATTENTION_LOCKED',
      });
    }

    if (transition.early_activation_status === 'confirmed') {
      throw new AppError(409, 'A ativação antecipada já foi confirmada nesta transição.', {
        code: 'EARLY_ACTIVATION_ALREADY_CONFIRMED',
      });
    }

    // Validação de precondição temporal (pre-boundary)
    const nowIso = options?.now
      ? (typeof options.now === 'string' ? new Date(options.now) : options.now).toISOString()
      : new Date().toISOString();

    // 2. Verificar se existe tentativa no estado 'reserved' elegível para retomada segura
    const resumeCheck = canResumeReservedEarlyActivationAttempt(transition, quoteId, nowIso);

    let attemptId: string;
    let internalCheckoutIntentId: string;
    let amountCents: number;
    let minutesToExpire: number;
    let quoteExpiresAt: string;

    if (resumeCheck.canResume && resumeCheck.attempt) {
      // Retomada idempotente da mesma tentativa local previamente reservada
      attemptId = resumeCheck.attempt.attempt_id;
      internalCheckoutIntentId = resumeCheck.attempt.internal_checkout_intent_id;
      amountCents = resumeCheck.attempt.amount_cents;
      const quote = transition.current_early_activation_quote!;
      quoteExpiresAt = quote.expires_at;

      const ttlResult = calculateCheckoutMinutesToExpire(quoteExpiresAt, nowIso, {
        providerMinimumMinutes: 10,
        safetyMarginMinutes: 1,
        maxMinutes: 60,
      });
      minutesToExpire = ttlResult.minutesToExpire;
    } else {
      // 2.1 Validação do portão de UMA ÚNICA OBRIGAÇÃO FINANCEIRA VIVA
      const eligibility = canCreateEarlyActivationCheckout(transition, {
        timeZone: config.billingTimezone || 'America/Sao_Paulo',
      });
      if (!eligibility.allowed) {
        throw new AppError(409, eligibility.reason || 'Operação de checkout não permitida.', {
          code: 'EARLY_ACTIVATION_CHECKOUT_BLOCKED',
          financialState: eligibility.financialState,
        });
      }

      // 2.2 Validar se a cotação solicitada existe e está ativa
      const quote = transition.current_early_activation_quote;
      if (!quote || quote.quote_id !== quoteId) {
        throw new AppError(400, `Cotação de early activation inválida ou divergente da transição (cotação '${quoteId}').`, {
          code: 'EARLY_ACTIVATION_QUOTE_NOT_ACTIVE',
        });
      }

      if (quote.status !== 'active') {
        throw new AppError(400, `Cotação com status '${quote.status}' não pode ser utilizada para checkout.`, {
          code: 'EARLY_ACTIVATION_QUOTE_INACTIVE',
        });
      }

      quoteExpiresAt = quote.expires_at;
      const ttlResult = calculateCheckoutMinutesToExpire(quoteExpiresAt, nowIso, {
        providerMinimumMinutes: 10,
        safetyMarginMinutes: 1,
        maxMinutes: 60,
      });
      minutesToExpire = ttlResult.minutesToExpire;
      amountCents = quote.prorated_adjustment_cents;

      // 2.3 Gerar identificadores únicos de tentativa e intenção
      attemptId = `att_ea_${transitionId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      internalCheckoutIntentId = `intent_ea_${transitionId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

      // 2.4 RESERVA ATÔMICA DA TENTATIVA NO REPOSITÓRIO (CAS)
      await this.billingRepo.reserveEarlyActivationCheckoutAttempt({
        transitionId,
        ministryId,
        quoteId,
        attemptId,
        internalCheckoutIntentId,
        amountCents,
        checkoutMinutesToExpire: minutesToExpire,
        quoteExpiresAt,
        nowIso,
      });
    }

    // 3. TWO-PHASE PROVIDER-CREATE MARKER (CAS): Transiciona atomicamente reserved -> attempting antes do POST
    await this.billingRepo.markEarlyActivationCheckoutAttempting({
      transitionId,
      ministryId,
      attemptId,
      nowIso,
    });

    // 4. Obter URLs de callback - autoridade exclusiva do backend (frontend NÃO pode injetar URLs arbitrárias)
    const publicApiUrl = (config.billingPublicApiUrl || '').trim().replace(/\/+$/, '');
    if (!publicApiUrl) {
      throw new AppError(500, 'URL pública de callback do Billing não configurada.');
    }
    if (publicApiUrl.includes('localhost') || publicApiUrl.includes('127.0.0.1')) {
      throw new AppError(500, 'URL pública de callback do Billing não pode ser localhost.');
    }

    const successUrl = `${publicApiUrl}/api/v1/billing/checkout-return/success`;
    const cancelUrl = `${publicApiUrl}/api/v1/billing/checkout-return/cancel`;
    const expiredUrl = `${publicApiUrl}/api/v1/billing/checkout-return/expired`;

    if (typeof this.provider.createDetachedCheckout !== 'function') {
      throw new AppError(500, 'Provedor configurado não suporta criação de checkout avulso (DETACHED).');
    }

    // 5. Chamada externa ao provedor
    let checkoutResult: { checkoutUrl: string; checkoutId: string; expiresAt: string | null };
    try {
      checkoutResult = await this.provider.createDetachedCheckout({
        ministryId,
        checkoutIntentId: internalCheckoutIntentId,
        providerCustomerId: transition.provider_customer_id || undefined,
        amountCents,
        description: `Ajuste Pró-Rata de Ativação Antecipada (${transition.target_plan_id})`,
        minutesToExpire,
        successUrl,
        cancelUrl,
        expiredUrl,
        customerData: options?.customerData,
      });
    } catch (providerErr: any) {
      console.error(`[EARLY ACTIVATION CHECKOUT ERROR] Falha no provedor para transição ${transitionId}:`, providerErr);

      const errorOutcome =
        typeof this.provider.classifyErrorOutcome === 'function'
          ? this.provider.classifyErrorOutcome(providerErr)
          : 'OUTCOME_UNCERTAIN';

      if (errorOutcome === 'DEFINITE_NO_RESOURCE_CREATED') {
        // Falha comprovada antes de criar recurso: libera subfluxo para available
        await this.billingRepo.markEarlyActivationCheckoutCreationFailed({
          transitionId,
          ministryId,
          attemptId,
          failureClassification: 'creation_failed_before_provider_obligation',
          reason: providerErr.message,
          nowIso,
        });

        if (providerErr instanceof AppError) throw providerErr;
        throw new AppError(400, `Falha ao criar checkout de ativação antecipada no gateway: ${providerErr.message}`, {
          code: 'PROVIDER_CHECKOUT_CREATION_FAILED',
        });
      }

      // Falha incerta (timeout, 5xx, perda de rede): quarentena
      const uncertainUntil = quoteExpiresAt;
      await this.billingRepo.markEarlyActivationCheckoutCreateUncertain({
        transitionId,
        ministryId,
        attemptId,
        uncertainUntil,
        reason: providerErr.message,
        nowIso,
      });

      throw new AppError(
        500,
        'Instabilidade ao comunicar com gateway de pagamento. A tentativa está sendo verificada de forma segura pelo sistema. Por favor, aguarde alguns instantes antes de realizar qualquer nova ação.',
        { code: 'CHECKOUT_CREATE_UNCERTAIN', attemptId }
      );
    }

    // 6. Sucesso no provedor: persistência local resiliente com retry idempotente
    let persistSuccess = false;
    let lastPersistError: any = null;
    for (let retryNum = 1; retryNum <= 3; retryNum++) {
      try {
        await this.billingRepo.recordEarlyActivationCheckoutCreated({
          transitionId,
          ministryId,
          attemptId,
          providerCheckoutId: checkoutResult.checkoutId,
          checkoutUrl: checkoutResult.checkoutUrl,
          expiresAt: checkoutResult.expiresAt,
          nowIso,
        });
        persistSuccess = true;
        break;
      } catch (err: any) {
        lastPersistError = err;
        if (err?.details?.code === 'CHECKOUT_ID_CONFLICT' || err?.message?.includes('write-once')) {
          throw err;
        }
      }
    }

    if (!persistSuccess) {
      console.error(
        `[EARLY ACTIVATION CRITICAL] Falha ao persistir localmente checkout ID '${checkoutResult.checkoutId}' após criação no provedor:`,
        lastPersistError
      );
      throw new AppError(
        500,
        `Checkout criado no gateway com ID '${checkoutResult.checkoutId}', mas ocorreu falha ao persistir localmente. A tentativa permanece retida para reconciliação.`,
        {
          code: 'CHECKOUT_PERSISTENCE_FAILED_RETAINED',
          checkoutId: checkoutResult.checkoutId,
        }
      );
    }

    return {
      checkoutUrl: checkoutResult.checkoutUrl,
      checkoutId: checkoutResult.checkoutId,
      attemptId,
      quoteId,
      amountCents,
      minutesToExpire,
      expiresAt: checkoutResult.expiresAt,
    };
  }
}
