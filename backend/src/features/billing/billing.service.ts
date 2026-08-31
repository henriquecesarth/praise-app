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
} from './billing.types';
import { AppError } from '../../middleware/error-handler';
import { getCurrentBillingDate, getBillingDate } from '../../utils/billing-date';

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

    const priceCalc = calculatePlanPriceCents(planId, interval, addonBlocks);
    const plan = getPlanDefinition(planId);
    
    // 1. Proteção contra Double Checkout: Reutilizar sessão pendente recente (< 15 min) para evitar múltiplas cobranças no gateway
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

    // 2. Obter assinatura atual vigente para preservar IDs de supersede sem sobrescrever a assinatura ativa
    const currentBillingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);

    // 3. Gerar identificador determinístico seguro para a intenção de checkout (externalReference)
    const checkoutIntentId = `intent_${ministryId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 4. Determinar URLs públicas de callback para o gateway (Backend é autoridade das URLs de retorno)
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

    // 5. Criar Sessão de Checkout Hospedado no Provedor (Asaas Checkout)
    const checkoutResult = await this.provider.createCheckout({
      ministryId,
      checkoutIntentId,
      planId,
      planName: plan.name,
      interval,
      addonBlocks: priceCalc.addonBlocks,
      amountCents: priceCalc.totalPriceCents,
      successUrl: callbackSuccessUrl,
      cancelUrl: callbackCancelUrl,
      expiredUrl: callbackExpiredUrl,
    });

    // 5. Persistir registro isolado da transição em billing_plan_changes (NÃO altera a assinatura vigente)
    const now = new Date();
    const planChangeRecord: BillingPlanChangeRecord = {
      id: checkoutIntentId,
      ministry_id: ministryId,
      provider: this.provider.name,
      checkout_intent_id: checkoutIntentId,
      provider_checkout_id: checkoutResult.checkoutId,
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
          await this.billingRepo.setCustomer({
            id: `${ministryId}_${this.provider.name}`,
            ministry_id: ministryId,
            provider: this.provider.name,
            provider_customer_id: parsedEvent.providerCustomerId,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
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
          await this.billingRepo.setCustomer({
            id: `${ministryId}_${this.provider.name}`,
            ministry_id: ministryId,
            provider: this.provider.name,
            provider_customer_id: parsedEvent.providerCustomerId,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
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
          await this.billingRepo.setCustomer({
            id: `${ministryId}_${this.provider.name}`,
            ministry_id: ministryId,
            provider: this.provider.name,
            provider_customer_id: parsedEvent.providerCustomerId,
            created_at: now.toISOString(),
            updated_at: now.toISOString(),
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
   * Retorna o histórico de faturas e transações financeiras.
   */
  async getBillingHistory(ministryId: string): Promise<BillingTransactionRecord[]> {
    return await this.billingRepo.getTransactions(ministryId);
  }
}
