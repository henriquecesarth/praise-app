import crypto from 'crypto';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { BillingProvider } from './providers/billing-provider.interface';
import { AsaasBillingProvider } from './providers/asaas/asaas.provider';
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
  BillingTransactionRecord,
  BillingWebhookEventRecord,
} from './billing.types';
import { AppError } from '../../middleware/error-handler';
import { getCurrentBillingDate } from '../../utils/billing-date';

export class BillingService {
  constructor(
    private readonly billingRepo: BillingRepository = new BillingRepository(),
    private readonly subscriptionService: SubscriptionService = new SubscriptionService(),
    private readonly subscriptionRepo: SubscriptionRepository = new SubscriptionRepository(),
    private readonly ministryRepo: MinistryRepository = new MinistryRepository(),
    private readonly provider: BillingProvider = new AsaasBillingProvider()
  ) {}

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

    // Se o usuário selecionar Free, não necessita de checkout financeiro
    if (planId === 'free') {
      await this.subscriptionService.changePlan(ministryId, 'free');
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
    const existingPending = await this.billingRepo.getRecentPendingSubscription(
      ministryId,
      this.provider.name,
      planId,
      interval,
      priceCalc.addonBlocks
    );

    if (existingPending && existingPending.checkout_url) {
      return {
        checkoutUrl: existingPending.checkout_url,
        checkoutId: existingPending.provider_checkout_id || existingPending.provider_subscription_id || existingPending.checkout_intent_id || 'chk_pending',
        expiresAt: null,
        totalPriceCents: priceCalc.totalPriceCents,
        currency: 'BRL',
      };
    }

    // 2. Gerar identificador determinístico seguro para a intenção de checkout (externalReference)
    const checkoutIntentId = `intent_${ministryId}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    // 3. Criar Sessão de Checkout Hospedado no Provedor (Asaas Checkout)
    const checkoutResult = await this.provider.createCheckout({
      ministryId,
      checkoutIntentId,
      planId,
      planName: plan.name,
      interval,
      addonBlocks: priceCalc.addonBlocks,
      amountCents: priceCalc.totalPriceCents,
      successUrl,
      cancelUrl,
    });

    // 4. Persistir registro de checkout/assinatura pendente (sem conceder quota ainda)
    const now = new Date();
    const billingSubscription: BillingSubscriptionRecord = {
      id: `${ministryId}_${this.provider.name}`,
      ministry_id: ministryId,
      provider: this.provider.name,
      checkout_intent_id: checkoutIntentId,
      provider_checkout_id: checkoutResult.checkoutId,
      provider_subscription_id: null,
      provider_customer_id: null,
      plan_id: planId,
      interval,
      member_addon_blocks: priceCalc.addonBlocks,
      amount_cents: priceCalc.totalPriceCents,
      status: 'pending',
      started_at: now.toISOString(),
      current_period_start: now.toISOString(),
      current_period_end: new Date(
        now.getTime() + (interval === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
      ).toISOString(),
      cancel_at_period_end: false,
      checkout_url: checkoutResult.checkoutUrl,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    await this.billingRepo.setSubscription(billingSubscription);

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
  ): Promise<{ status: string; processed: boolean; reason?: string }> {
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
      // 4. Resolver ministério associado com segurança (Tenant Resolution via IDs vinculados)
      let ministryId: string | null = null;
      let billingSub: BillingSubscriptionRecord | null = null;

      // 4.1 Busca por provider_subscription_id real
      if (parsedEvent.providerSubscriptionId) {
        billingSub = await this.billingRepo.getSubscriptionByProviderSubscriptionId(
          parsedEvent.providerSubscriptionId,
          this.provider.name
        );
        if (billingSub) {
          ministryId = billingSub.ministry_id;
        }
      }

      // 4.2 Busca por provider_checkout_id
      if (!ministryId && parsedEvent.providerCheckoutId) {
        billingSub = await this.billingRepo.getSubscriptionByCheckoutId(
          parsedEvent.providerCheckoutId,
          this.provider.name
        );
        if (billingSub) {
          ministryId = billingSub.ministry_id;
        }
      }

      // 4.3 Busca por externalReference (checkout intent)
      if (!ministryId && parsedEvent.externalReference) {
        billingSub = await this.billingRepo.getSubscriptionByCheckoutIntentId(
          parsedEvent.externalReference,
          this.provider.name
        );
        if (billingSub) {
          ministryId = billingSub.ministry_id;
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
          billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
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

      // 6. Executar ação de acordo com o tipo normalizado de evento financeiro
      if (parsedEvent.eventType === 'checkout_created') {
        // Confirmação de registro do checkout no Asaas (continua em pending)
      } else if (parsedEvent.eventType === 'checkout_paid') {
        // Pagador concluiu o checkout
        if (billingSub) {
          await this.billingRepo.setSubscription({
            ...billingSub,
            provider_checkout_id: parsedEvent.providerCheckoutId || billingSub.provider_checkout_id,
            provider_subscription_id: parsedEvent.providerSubscriptionId || billingSub.provider_subscription_id,
            provider_customer_id: parsedEvent.providerCustomerId || billingSub.provider_customer_id,
            updated_at: now.toISOString(),
          });
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
        if (billingSub && billingSub.status === 'pending') {
          await this.billingRepo.setSubscription({
            ...billingSub,
            status: 'canceled',
            updated_at: now.toISOString(),
          });
        }
      } else if (
        parsedEvent.eventType === 'subscription_created' ||
        parsedEvent.eventType === 'subscription_updated'
      ) {
        // Asaas gerou/atualizou a Subscription recorrente
        if (billingSub) {
          await this.billingRepo.setSubscription({
            ...billingSub,
            provider_subscription_id: parsedEvent.providerSubscriptionId || billingSub.provider_subscription_id,
            provider_customer_id: parsedEvent.providerCustomerId || billingSub.provider_customer_id,
            updated_at: now.toISOString(),
          });
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
        const targetPlan = billingSub?.plan_id || 'free';
        const targetAddons = billingSub?.member_addon_blocks || 0;
        const targetInterval = billingSub?.interval || 'monthly';

        // Validação de Valor & Contrato (Amount Validation): Correspondência exata entre valor pago e plano contratado
        if (targetPlan !== 'free') {
          const expectedPrice = calculatePlanPriceCents(targetPlan, targetInterval, targetAddons);
          const paidAmountCents = parsedEvent.amountCents ?? billingSub?.amount_cents ?? 0;

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

        // Ativar entitlement de produto no SubscriptionService
        await this.subscriptionService.changePlan(ministryId, targetPlan);
        if (targetAddons > 0) {
          await this.subscriptionService.changeMemberAddonBlocks(ministryId, targetAddons);
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
            subscription_mode: targetPlan === 'free' ? 'free' : 'paid',
            grace_period_expires_at: null,
            current_period_start: now.toISOString(),
            current_period_end: periodEnd,
            cancel_at_period_end: false,
            updated_at: now.toISOString(),
          });
        }

        // Atualizar registro de BillingSubscription
        if (billingSub) {
          await this.billingRepo.setSubscription({
            ...billingSub,
            provider_subscription_id: parsedEvent.providerSubscriptionId || billingSub.provider_subscription_id,
            provider_customer_id: parsedEvent.providerCustomerId || billingSub.provider_customer_id,
            status: 'active',
            current_period_start: now.toISOString(),
            current_period_end: new Date(
              now.getTime() + (billingSub.interval === 'annual' ? 365 : 30) * 24 * 60 * 60 * 1000
            ).toISOString(),
            cancel_at_period_end: false,
            updated_at: now.toISOString(),
          });
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
            provider_subscription_id: parsedEvent.providerSubscriptionId || billingSub?.provider_subscription_id,
            amount_cents: parsedEvent.amountCents || billingSub?.amount_cents || 0,
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
      } else if (parsedEvent.eventType === 'payment_overdue') {
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
        if (billingSub) {
          await this.billingRepo.setSubscription({
            ...billingSub,
            status: 'canceled',
            updated_at: now.toISOString(),
          });
        }
      }

      // 7. Marcar evento como processado com sucesso
      await this.billingRepo.markWebhookEventProcessed(
        this.provider.name,
        parsedEvent.providerEventId,
        'processed'
      );

      return { status: 'ok', processed: true };
    } catch (err: any) {
      await this.billingRepo.markWebhookEventProcessed(
        this.provider.name,
        parsedEvent.providerEventId,
        'failed',
        err.message || 'Erro no processamento do evento'
      );
      throw err;
    }
  }

  /**
   * Agenda o cancelamento da assinatura ao fim do período atual pago (`cancel_at_period_end`).
   */
  async cancelSubscription(ministryId: string): Promise<BillingSubscriptionRecord> {
    const billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
    if (!billingSub || billingSub.status === 'canceled') {
      throw new AppError(400, 'Não há assinatura ativa para cancelar neste ministério.');
    }

    if (billingSub.provider_subscription_id) {
      await this.provider.cancelSubscription(billingSub.provider_subscription_id, true);
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
   */
  async reactivateSubscription(ministryId: string): Promise<BillingSubscriptionRecord> {
    const billingSub = await this.billingRepo.getSubscription(ministryId, this.provider.name);
    if (!billingSub || !billingSub.cancel_at_period_end) {
      throw new AppError(400, 'Não há cancelamento pendente para reativar neste ministério.');
    }

    if (billingSub.provider_subscription_id) {
      await this.provider.reactivateSubscription(billingSub.provider_subscription_id);
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
