import crypto from 'crypto';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { BillingProvider, ProviderPaymentRecord } from './providers/billing-provider.interface';
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
} from './billing.types';
import {
  validateTargetContract,
  buildTransitionCommercialSnapshot,
  buildBillingTransitionV1Record,
} from './billing-transition-domain.service';
import { AppError } from '../../middleware/error-handler';
import { getCurrentBillingDate, getBillingDate, addCommercialInterval } from '../../utils/billing-date';

export class BillingService {
  constructor(
    private readonly billingRepo: BillingRepository = new BillingRepository(),
    private readonly subscriptionService: SubscriptionService = new SubscriptionService(),
    private readonly subscriptionRepo: SubscriptionRepository = new SubscriptionRepository(),
    private readonly ministryRepo: MinistryRepository = new MinistryRepository(),
    private readonly provider: BillingProvider = new AsaasBillingProvider()
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
        }
      } catch (err: any) {
        console.warn(`[BILLING CUSTOMER] Aviso ao buscar por externalReference: ${err.message}`);
      }
    }

    // 5. Se não existir no gateway, cria explicitamente no Asaas
    if (!providerCustomerId) {
      const ministry = await this.ministryRepo.findById(ministryId);
      const ministryName = ministry?.name || `Ministério ${ministryId}`;

      const created = await this.provider.createCustomer({
        ministryId,
        ministryName,
        email: options?.email,
        taxId: options?.taxId,
        phone: options?.phone,
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

      // 3. Proteção contra Double Request / Idempotência:
      // Se já existir um slot ativo, verifica se possui checkout pendente reutilizável ou rejeita 409
      const activeSlot = await this.billingRepo.getActiveTransitionSlot(ministryId, this.provider.name);
      if (activeSlot) {
        const existingTr = await this.billingRepo.getPlanChange(activeSlot.plan_change_id);
        if (
          existingTr &&
          existingTr.requested_plan_id === planId &&
          existingTr.requested_interval === interval &&
          (existingTr.requested_addon_blocks || 0) === commercialSnapshot.target_addon_blocks &&
          existingTr.checkout_url &&
          existingTr.status === 'pending'
        ) {
          return {
            checkoutUrl: existingTr.checkout_url,
            checkoutId: existingTr.provider_checkout_id || existingTr.checkout_intent_id || activeSlot.plan_change_id,
            expiresAt: existingTr.expires_at,
            totalPriceCents: commercialSnapshot.target_future_recurring_price_cents,
            currency: 'BRL',
          };
        }
        throw new AppError(409, 'Já existe uma transição de plano ativa em processamento para este ministério.', {
          code: 'ACTIVE_TRANSITION_EXISTS',
        });
      }

      // 4. Resolver ou criar cliente canônico no gateway
      const resolvedCustomer = await this.resolveOrCreateBillingCustomer(ministryId);

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

      // 7. Criar Sessão de Checkout Hospedado no Provedor (Asaas)
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
        await this.billingRepo.updateTransition(transitionId, ministryId, {
          transition_status: 'failed',
          failure_reason: providerErr.message || 'Falha na comunicação com gateway de pagamento',
        });
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
    // LEGACY FLOW (PAID -> PAID, PAID -> FREE, etc.) PRESERVED
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
    const resolvedCustomer = await this.resolveOrCreateBillingCustomer(ministryId);

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
    rawBody: any
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

    const now = new Date();
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
          id: `${ministryId}_${this.provider.name}`,
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
          id: `${ministryId}_${this.provider.name}`,
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
  private async handleV1InitialPurchaseWebhook(
    parsedEvent: any,
    planChange: BillingTransitionV1Record,
    now: Date
  ): Promise<{ status: string; processed: boolean; reason?: string; error?: string }> {
    const ministryId = planChange.ministry_id;
    const nowIso = now.toISOString();

    if (parsedEvent.eventType === 'checkout_created') {
      if (parsedEvent.providerCheckoutId && !planChange.initial_provider_checkout_id) {
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          initial_provider_checkout_id: parsedEvent.providerCheckoutId,
          provider_checkout_id: parsedEvent.providerCheckoutId,
        });
      }
      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true };
    }

    if (parsedEvent.eventType === 'checkout_paid') {
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
      if (planChange.transition_status === 'pending_initial_purchase') {
        const terminalStatus = parsedEvent.eventType === 'checkout_expired' ? 'failed' : 'canceled';
        await this.billingRepo.markFinanciallySafe(planChange.id, ministryId, terminalStatus, {
          failure_reason: `Checkout ${parsedEvent.eventType === 'checkout_expired' ? 'expirado' : 'cancelado'} no provedor`,
        });
        await this.billingRepo.releaseSlotIfOwnedAndSafe(ministryId, this.provider.name, planChange.id);
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
      const expectedAmountCents = planChange.target_future_recurring_price_cents;
      const paidAmountCents = parsedEvent.amountCents ?? expectedAmountCents;

      // Amount Validation (Fail-Closed)
      if (paidAmountCents !== expectedAmountCents) {
        console.error(
          `[ANOMALIA DE CONTRATO V1] Valor recebido (${paidAmountCents}¢) diverge do valor travado (${expectedAmountCents}¢) na transição V1 ${planChange.id} (ministério ${ministryId}).`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: `Valor pago (${paidAmountCents}¢) diverge do preço travado (${expectedAmountCents}¢)`,
          transition_status: 'financial_attention_required',
        });
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          `Valor pago (${paidAmountCents}¢) diverge do preço travado (${expectedAmountCents}¢)`
        );
        return { status: 'ok', processed: false, reason: 'amount_validation_failed' };
      }

      // Customer Validation (Fail-Closed)
      if (
        planChange.provider_customer_id &&
        parsedEvent.providerCustomerId &&
        planChange.provider_customer_id !== parsedEvent.providerCustomerId
      ) {
        console.error(
          `[ANOMALIA CUSTOMER V1] Customer recebido (${parsedEvent.providerCustomerId}) diverge do esperado (${planChange.provider_customer_id}) na transição V1 ${planChange.id}.`
        );
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: `Customer recebido (${parsedEvent.providerCustomerId}) diverge do esperado (${planChange.provider_customer_id})`,
          transition_status: 'financial_attention_required',
        });
        await this.billingRepo.markWebhookEventProcessed(
          this.provider.name,
          parsedEvent.providerEventId,
          'failed',
          `Customer diverge do esperado`
        );
        return { status: 'ok', processed: false, reason: 'customer_mismatch' };
      }

      const providerSubId =
        parsedEvent.providerSubscriptionId ||
        planChange.initial_provider_subscription_id ||
        planChange.new_provider_subscription_id ||
        `sub_init_${Date.now()}`;

      // Idempotency: se já completada anteriormente
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
            paid_at: parsedEvent.paymentDate || nowIso,
            payment_method: parsedEvent.paymentMethod,
            invoice_url: parsedEvent.invoiceUrl,
            created_at: nowIso,
            updated_at: nowIso,
          });
        }
        await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
        return { status: 'ok', processed: true, reason: 'already_completed' };
      }

      // Temporal Derivation:
      // current_period_start = instante de confirmação
      // effective_billing_date = data comercial correspondente
      const paymentConfirmationInstant = parsedEvent.paymentDate ? new Date(parsedEvent.paymentDate).toISOString() : nowIso;
      const effectiveBillingDate = getBillingDate(paymentConfirmationInstant, config.billingTimezone);

      // current_period_end = próximo ciclo derivado por calendário exato (addCommercialInterval) ou dueDate futuro
      let nextBillingDateStr: string;
      if (parsedEvent.dueDate && parsedEvent.dueDate > effectiveBillingDate) {
        nextBillingDateStr = parsedEvent.dueDate;
      } else {
        nextBillingDateStr = addCommercialInterval(effectiveBillingDate, planChange.target_interval, config.billingTimezone);
      }
      const currentPeriodEndIso = new Date(`${nextBillingDateStr}T00:00:00.000Z`).toISOString();

      // Ativação do Entitlement via SubscriptionService (única autoridade de cotas)
      try {
        await this.subscriptionService.changePlan(ministryId, planChange.target_plan_id);
        if (planChange.target_addon_blocks > 0) {
          await this.subscriptionService.changeMemberAddonBlocks(ministryId, planChange.target_addon_blocks);
        }
        const appSub = await this.subscriptionRepo.getSubscription(ministryId);
        if (appSub) {
          await this.subscriptionRepo.setSubscription({
            ...appSub,
            billing_status: 'active',
            subscription_mode: 'paid',
            current_period_start: paymentConfirmationInstant,
            current_period_end: currentPeriodEndIso,
            updated_at: nowIso,
          });
        }
      } catch (activationErr: any) {
        console.error(`[CRITICAL V1 ACTIVATION ERROR] Falha ao ativar SubscriptionService após pagamento: ${activationErr.message}`);
        await this.billingRepo.updateTransition(planChange.id, ministryId, {
          financial_attention_required: true,
          financial_attention_reason: `Falha na ativação do SubscriptionService após confirmação de pagamento: ${activationErr.message}`,
          transition_status: 'financial_attention_required',
        });
        throw activationErr;
      }

      // Atualizar / Criar BillingSubscriptionRecord
      const billingSubRecord: BillingSubscriptionRecord = {
        id: `${this.provider.name}_${ministryId}`,
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
        cancel_at_period_end: false,
        created_at: nowIso,
        updated_at: nowIso,
      };
      await this.billingRepo.setSubscription(billingSubRecord);

      // Confirmar transição atomicamente como completed e safe_terminal
      await this.billingRepo.confirmInitialPurchaseActivation({
        transitionId: planChange.id,
        ministryId: ministryId,
        effectiveAt: paymentConfirmationInstant,
        effectiveBillingDate: effectiveBillingDate,
        providerSubscriptionId: providerSubId,
        providerPaymentId: parsedEvent.providerPaymentId,
        providerCustomerId: parsedEvent.providerCustomerId || planChange.provider_customer_id,
        completedAt: nowIso,
      });

      // Salvar Transação
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
          paid_at: parsedEvent.paymentDate || nowIso,
          payment_method: parsedEvent.paymentMethod,
          invoice_url: parsedEvent.invoiceUrl,
          created_at: nowIso,
          updated_at: nowIso,
        });
      }

      // Liberar active transition slot
      await this.billingRepo.releaseSlotIfOwnedAndSafe(ministryId, this.provider.name, planChange.id);

      await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'processed');
      return { status: 'ok', processed: true };
    }

    await this.billingRepo.markWebhookEventProcessed(this.provider.name, parsedEvent.providerEventId, 'ignored');
    return { status: 'ok', processed: false, reason: 'unhandled_v1_event' };
  }

  /**
   * Retorna o histórico de faturas e transações financeiras.
   */
  async getBillingHistory(ministryId: string): Promise<BillingTransactionRecord[]> {
    return await this.billingRepo.getTransactions(ministryId);
  }
}
