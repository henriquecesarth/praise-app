import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { BillingProvider, ParsedWebhookEvent } from './providers/billing-provider.interface';
import {
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingPlanChangeRecord,
  BillingTransitionV1Record,
  BillingActiveTransitionSlotRecord,
  isBillingTransitionV1,
} from './billing.types';
import { config } from '../../config/unifiedConfig';
import { AppError } from '../../middleware/error-handler';

describe('Phase 3A — Billing Transition V1 Initial Purchase Orchestration (Free -> Paid)', () => {
  let billingService: BillingService;
  let mockBillingRepo: any;
  let mockSubscriptionService: any;
  let mockSubscriptionRepo: any;
  let mockMinistryRepo: any;
  let mockProvider: any;

  const planChangesStore = new Map<string, BillingPlanChangeRecord>();
  const activeSlotsStore = new Map<string, BillingActiveTransitionSlotRecord>();
  const subscriptionsStore = new Map<string, BillingSubscriptionRecord>();
  const customersStore = new Map<string, BillingCustomerRecord>();
  const appSubscriptionsStore = new Map<string, any>();
  const webhookEventsStore = new Map<string, any>();
  const transactionsStore = new Map<string, any>();

  beforeEach(() => {
    (config as any).billingPublicApiUrl = 'https://api.louvaio.com';
    (config as any).billingTimezone = 'America/Sao_Paulo';

    planChangesStore.clear();
    activeSlotsStore.clear();
    subscriptionsStore.clear();
    customersStore.clear();
    appSubscriptionsStore.clear();
    webhookEventsStore.clear();
    transactionsStore.clear();

    mockBillingRepo = {
      getCustomer: vi.fn().mockImplementation(async (ministryId: string) => {
        return customersStore.get(`${ministryId}_asaas`) || null;
      }),
      getCustomerByProviderId: vi.fn().mockImplementation(async (providerCustomerId: string) => {
        for (const c of customersStore.values()) {
          if (c.provider_customer_id === providerCustomerId) return c;
        }
        return null;
      }),
      setCustomer: vi.fn().mockImplementation(async (c: any) => {
        customersStore.set(c.id, c);
      }),
      claimCustomerCreation: vi.fn().mockImplementation(async (ministryId: string, provider: string, lockWorkerId: string) => {
        const existing = customersStore.get(`${ministryId}_${provider}`);
        if (existing) return { acquired: false, customer: existing };
        const newCust: BillingCustomerRecord = {
          id: `${ministryId}_${provider}`,
          ministry_id: ministryId,
          provider: provider as any,
          provider_customer_id: `cus_${ministryId}`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        customersStore.set(newCust.id, newCust);
        return { acquired: true, customer: newCust };
      }),
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return subscriptionsStore.get(ministryId) || null;
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        subscriptionsStore.set(sub.ministry_id, sub);
      }),
      getPlanChange: vi.fn().mockImplementation(async (id: string) => {
        return planChangesStore.get(id) || null;
      }),
      getPlanChangeByCheckoutIntentId: vi.fn().mockImplementation(async (intentId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.id === intentId || tr.checkout_intent_id === intentId || (tr as any).initial_checkout_intent_id === intentId) {
            return tr;
          }
        }
        return null;
      }),
      getPlanChangeByCheckoutId: vi.fn().mockImplementation(async (chkId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.provider_checkout_id === chkId || (tr as any).initial_provider_checkout_id === chkId) {
            return tr;
          }
        }
        return null;
      }),
      getPlanChangeByNewSubscriptionId: vi.fn().mockImplementation(async (subId: string) => {
        for (const tr of planChangesStore.values()) {
          if (tr.new_provider_subscription_id === subId || (tr as any).initial_provider_subscription_id === subId) {
            return tr;
          }
        }
        return null;
      }),
      getPlanChangeByProviderId: vi.fn().mockImplementation(async (providerRef: string) => {
        for (const tr of planChangesStore.values()) {
          if (
            tr.id === providerRef ||
            tr.checkout_intent_id === providerRef ||
            (tr as any).initial_checkout_intent_id === providerRef ||
            tr.provider_checkout_id === providerRef ||
            (tr as any).initial_provider_checkout_id === providerRef ||
            tr.new_provider_subscription_id === providerRef ||
            (tr as any).initial_provider_subscription_id === providerRef ||
            (tr as any).initial_provider_payment_id === providerRef
          ) {
            return tr;
          }
        }
        return null;
      }),
      getActiveTransitionSlot: vi.fn().mockImplementation(async (ministryId: string, provider: string) => {
        return activeSlotsStore.get(`slot_${ministryId}_${provider}`) || null;
      }),
      createTransitionAndClaimSlot: vi.fn().mockImplementation(async (record: BillingTransitionV1Record) => {
        const slotKey = `slot_${record.ministry_id}_${record.provider}`;
        if (activeSlotsStore.has(slotKey)) {
          throw new AppError(409, 'Já existe uma transição ativa para este ministério.', {
            code: 'ACTIVE_TRANSITION_EXISTS',
          });
        }
        planChangesStore.set(record.id, record);
        const slot: BillingActiveTransitionSlotRecord = {
          id: slotKey,
          ministry_id: record.ministry_id,
          provider: record.provider,
          plan_change_id: record.id,
          acquired_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          version: 1,
        };
        activeSlotsStore.set(slotKey, slot);
        return { planChange: record, slot };
      }),
      updateTransition: vi.fn().mockImplementation(async (id: string, ministryId: string, updates: any) => {
        const existing = planChangesStore.get(id);
        if (!existing) throw new AppError(404, 'Transição não encontrada');
        const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };
        planChangesStore.set(id, updated);
        return updated;
      }),
      recordNewCheckoutAttempt: vi.fn().mockImplementation(async (transitionId: string, ministryId: string, attempt: any) => {
        const existing = planChangesStore.get(transitionId);
        if (!existing) throw new AppError(404, 'Transição não encontrada');
        const attempts = (existing as any).checkout_attempts || [];
        attempts.push(attempt);
        const updated = { ...existing, checkout_attempts: attempts, updated_at: new Date().toISOString() };
        planChangesStore.set(transitionId, updated as any);
        return updated;
      }),
      confirmInitialPurchaseActivation: vi.fn().mockImplementation(async (params: any) => {
        const existing = planChangesStore.get(params.transitionId);
        if (!existing) throw new AppError(404, 'Transição não encontrada');
        const updated: BillingTransitionV1Record = {
          ...(existing as BillingTransitionV1Record),
          transition_status: 'completed',
          financial_safety_status: 'safe_terminal',
          status: 'completed',
          effective_at: params.effectiveAt,
          effective_billing_date: params.effectiveBillingDate,
          initial_provider_subscription_id: params.providerSubscriptionId,
          new_provider_subscription_id: params.providerSubscriptionId,
          initial_provider_payment_id: params.providerPaymentId || null,
          provider_customer_id: params.providerCustomerId || existing.provider_customer_id || null,
          confirmed_at: params.completedAt || new Date().toISOString(),
          completed_at: params.completedAt || new Date().toISOString(),
          updated_at: params.completedAt || new Date().toISOString(),
        };
        planChangesStore.set(params.transitionId, updated);
        return updated;
      }),
      releaseSlotIfOwnedAndSafe: vi.fn().mockImplementation(async (ministryId: string, provider: string, transitionId: string) => {
        const slotKey = `slot_${ministryId}_${provider}`;
        const slot = activeSlotsStore.get(slotKey);
        if (slot && slot.plan_change_id === transitionId) {
          activeSlotsStore.delete(slotKey);
          return true;
        }
        return false;
      }),
      markFinanciallySafe: vi.fn().mockImplementation(async (id: string, ministryId: string, terminalStatus: string, details?: any) => {
        const existing = planChangesStore.get(id);
        if (existing) {
          const updated = {
            ...existing,
            transition_status: terminalStatus,
            financial_safety_status: 'safe_terminal',
            failure_reason: details?.failure_reason || null,
            updated_at: new Date().toISOString(),
          };
          planChangesStore.set(id, updated as any);
          return updated;
        }
        return null;
      }),
      saveTransaction: vi.fn().mockImplementation(async (tx: any) => {
        transactionsStore.set(tx.id, tx);
      }),
      registerWebhookEvent: vi.fn().mockImplementation(async (evt: any) => {
        if (webhookEventsStore.has(evt.id)) {
          return { isDuplicate: true, event: webhookEventsStore.get(evt.id) };
        }
        webhookEventsStore.set(evt.id, evt);
        return { isDuplicate: false, event: evt };
      }),
      markWebhookEventProcessed: vi.fn().mockImplementation(async (provider: string, eventId: string, status: string, error?: string) => {
        const key = `${provider}_${eventId}`;
        const existing = webhookEventsStore.get(key);
        if (existing) {
          existing.processing_status = status;
          existing.error_message = error || null;
        }
      }),
    };

    mockSubscriptionService = {
      changePlan: vi.fn().mockResolvedValue({ success: true }),
      changeMemberAddonBlocks: vi.fn().mockResolvedValue({ success: true }),
    };

    mockSubscriptionRepo = {
      getSubscription: vi.fn().mockImplementation(async (ministryId: string) => {
        return appSubscriptionsStore.get(ministryId) || {
          id: ministryId,
          ministry_id: ministryId,
          plan_id: 'free',
          subscription_mode: 'free',
          billing_status: 'active',
        };
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        appSubscriptionsStore.set(sub.ministry_id, sub);
      }),
    };

    mockMinistryRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'min_test_1', name: 'Igreja Central' }),
    };

    mockProvider = {
      name: 'asaas',
      createCustomer: vi.fn().mockResolvedValue('cus_asaas_123'),
      createCheckout: vi.fn().mockImplementation(async () => {
        const id = 'chk_' + Math.random().toString(36).substring(2, 8);
        return {
          checkoutUrl: `https://sandbox.asaas.com/c/${id}`,
          checkoutId: id,
          expiresAt: '2026-09-02T15:00:00.000Z',
        };
      }),
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn(),
    };

    billingService = new BillingService(
      mockBillingRepo as any,
      mockSubscriptionService as any,
      mockSubscriptionRepo as any,
      mockMinistryRepo as any,
      mockProvider as any
    );
  });

  describe('1. Initial Purchase Creation (Free -> Paid)', () => {
    it('deve criar transição V1 com immediate_initial_purchase e adquirir o slot ANTES de chamar o Asaas', async () => {
      const result = await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });

      expect(result.checkoutUrl).toContain('https://sandbox.asaas.com/c/chk_');
      expect(result.checkoutId).toMatch(/^chk_/);
      expect(result.totalPriceCents).toBe(1490);
      expect(result.currency).toBe('BRL');

      // Slot deve estar ocupado
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      // Transição V1 criada
      const transitions = Array.from(planChangesStore.values());
      expect(transitions.length).toBe(1);
      const tr = transitions[0];

      expect(isBillingTransitionV1(tr)).toBe(true);
      if (isBillingTransitionV1(tr)) {
        expect(tr.execution_strategy).toBe('immediate_initial_purchase');
        expect(tr.transition_status).toBe('pending_initial_purchase');
        expect(tr.financial_safety_status).toBe('live');
        expect(tr.early_activation_status).toBe('not_applicable');
        expect(tr.source_plan_id).toBe('free');
        expect(tr.current_period_start).toBeNull();
        expect(tr.current_period_end).toBeNull();
        expect(tr.effective_at).toBeNull();
        expect(tr.effective_billing_date).toBeNull();
        expect(tr.target_plan_id).toBe('lite');
        expect(tr.target_future_recurring_price_cents).toBe(1490);
        expect(tr.checkout_attempts?.length).toBe(1);
        expect(tr.checkout_attempts?.[0].attempt_type).toBe('initial_purchase');
        expect(tr.initial_provider_checkout_id).toMatch(/^chk_/);
      }
    });

    it('deve BLOQUEAR com 409 se já existir uma transição ativa em andamento para o mesmo ministério', async () => {
      // Primeiro request cria a transição e adquire o slot
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });

      // Segundo request simultâneo para plano diferente é bloqueado
      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'pro',
          interval: 'annual',
          addonBlocks: 0,
        })
      ).rejects.toThrow(/Já existe uma transição de plano ativa em processamento/i);

      // Asaas createCheckout deve ter sido chamado exatamente UMA vez
      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);
    });

    it('deve REJEITAR plano inválido sem realizar mutação no provedor nem adquirir slot', async () => {
      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'super_pro_inexistente' as any,
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow(/Plano inválido/i);

      expect(mockProvider.createCheckout).not.toHaveBeenCalled();
      expect(activeSlotsStore.size).toBe(0);
    });

    it('se a criação do checkout no provedor falhar, a transição é marcada como failed e o erro é propagado', async () => {
      mockProvider.createCheckout.mockRejectedValueOnce(new Error('Asaas API 500 Network Error'));

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'pro',
          interval: 'annual',
          addonBlocks: 0,
        })
      ).rejects.toThrow('Asaas API 500 Network Error');

      const transitions = Array.from(planChangesStore.values());
      expect(transitions.length).toBe(1);
      expect((transitions[0] as any).transition_status).toBe('failed');
      expect((transitions[0] as any).failure_reason).toContain('Asaas API 500 Network Error');
    });
  });

  describe('2. Webhook & Financial Confirmation Gate (V1)', () => {
    let transitionId: string;
    let checkoutIntentId: string;

    beforeEach(async () => {
      const checkout = await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });

      const tr = Array.from(planChangesStore.values())[0];
      transitionId = tr.id;
      checkoutIntentId = tr.checkout_intent_id!;
    });

    it('PAYMENT_CONFIRMED: valida valor, ativa SubscriptionService, marca safe_terminal e libera slot', async () => {
      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_pay_conf_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: 'chk_init_123',
        providerSubscriptionId: 'sub_asaas_999',
        providerPaymentId: 'pay_asaas_888',
        providerCustomerId: 'cus_min_test_1',
        externalReference: checkoutIntentId,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
        dueDate: '2026-10-02',
        paymentMethod: 'CREDIT_CARD',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      // Entitlement promovido pelo SubscriptionService
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledWith('min_test_1', 'lite');

      // Subscription ativa no repositório
      const savedSub = subscriptionsStore.get('min_test_1');
      expect(savedSub).toBeDefined();
      expect(savedSub?.plan_id).toBe('lite');
      expect(savedSub?.status).toBe('active');
      expect(savedSub?.provider_subscription_id).toBe('sub_asaas_999');
      expect(savedSub?.current_period_start).toBe('2026-09-02T10:00:00.000Z');
      expect(savedSub?.current_period_end).toBe('2026-10-02T00:00:00.000Z');

      // Transição completada e safe_terminal
      const savedTr = planChangesStore.get(transitionId) as BillingTransitionV1Record;
      expect(savedTr.transition_status).toBe('completed');
      expect(savedTr.financial_safety_status).toBe('safe_terminal');
      expect(savedTr.effective_billing_date).toBe('2026-09-02');
      expect(savedTr.initial_provider_subscription_id).toBe('sub_asaas_999');
      expect(savedTr.initial_provider_payment_id).toBe('pay_asaas_888');

      // Slot liberado
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('deve ser IDEMPOTENTE em webhooks duplicados (não reativa SubscriptionService)', async () => {
      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_pay_conf_dup_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: 'chk_init_123',
        providerSubscriptionId: 'sub_asaas_999',
        providerPaymentId: 'pay_asaas_888',
        providerCustomerId: 'cus_min_test_1',
        externalReference: checkoutIntentId,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
        dueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      // Primeiro processamento
      await billingService.handleWebhook({}, {});
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledTimes(1);

      // Segundo webhook com evento idêntico registrado
      const dupRes = await billingService.handleWebhook({}, {});
      expect(dupRes.reason).toBe('duplicate_event');

      // Terceiro webhook com ID diferente mas mesma transição já concluída
      const webhookEvent2: ParsedWebhookEvent = {
        ...webhookEvent,
        providerEventId: 'evt_pay_conf_dup_2',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent2);
      const res2 = await billingService.handleWebhook({}, {});

      expect(res2.processed).toBe(true);
      expect(res2.reason).toBe('already_completed');
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledTimes(1); // Não chamado de novo
    });

    it('Divergência de Valor (Amount Mismatch): FAIL-CLOSED, marca financial_attention_required e NÃO libera slot', async () => {
      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_pay_wrong_amount',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: 'chk_init_123',
        providerSubscriptionId: 'sub_asaas_999',
        providerPaymentId: 'pay_asaas_888',
        providerCustomerId: 'cus_min_test_1',
        externalReference: checkoutIntentId,
        amountCents: 990, // Divergente de 1490
        paymentDate: '2026-09-02T10:00:00.000Z',
        dueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('amount_validation_failed');

      // Entitlement NÃO promovido
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();

      // Slot mantido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      // Transição marcada como financial_attention_required
      const savedTr = planChangesStore.get(transitionId) as BillingTransitionV1Record;
      expect(savedTr.financial_attention_required).toBe(true);
      expect(savedTr.transition_status).toBe('financial_attention_required');
    });

    it('Falha pós-pagamento no SubscriptionService: mantém rastro financeiro, marca attention_required e NÃO libera slot', async () => {
      mockSubscriptionService.changePlan.mockRejectedValueOnce(new Error('Firestore SubscriptionService write failure'));

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_pay_activation_error',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: 'chk_init_123',
        providerSubscriptionId: 'sub_asaas_999',
        providerPaymentId: 'pay_asaas_888',
        providerCustomerId: 'cus_min_test_1',
        externalReference: checkoutIntentId,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
        dueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.status).toBe('error');
      expect(res.processed).toBe(false);

      // Slot mantido para intervenção do reconciliador
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      const savedTr = planChangesStore.get(transitionId) as BillingTransitionV1Record;
      expect(savedTr.financial_attention_required).toBe(true);
      expect(savedTr.financial_attention_reason).toContain('Falha na ativação do SubscriptionService');
    });

    it('CHECKOUT_CANCELED / EXPIRED: transição termina terminalmente e slot é liberado com segurança', async () => {
      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_chk_expired_1',
        rawEventType: 'CHECKOUT_EXPIRED',
        eventType: 'checkout_expired',
        providerCheckoutId: 'chk_init_123',
        externalReference: checkoutIntentId,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      // Slot liberado
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);

      const savedTr = planChangesStore.get(transitionId) as BillingTransitionV1Record;
      expect(savedTr.transition_status).toBe('failed');
      expect(savedTr.financial_safety_status).toBe('safe_terminal');
    });
  });

  describe('3. Temporal Derivation Semantics (No +30/+365 approximation)', () => {
    it('deve derivar current_period_end usando calendário exato para planos mensais (ex: 31/01 -> 28/02)', async () => {
      const checkout = await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const allTransitions = Array.from(planChangesStore.values());
      const tr = allTransitions[allTransitions.length - 1];

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_jan31_monthly',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id || tr.provider_checkout_id || 'chk_init_123',
        providerSubscriptionId: 'sub_jan31',
        providerPaymentId: 'pay_jan31',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-01-31T15:00:00.000Z', // 31 de janeiro
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      await billingService.handleWebhook({}, {});

      const savedSub = subscriptionsStore.get('min_test_1');
      expect(savedSub?.current_period_start).toBe('2026-01-31T15:00:00.000Z');
      expect(savedSub?.current_period_end).toBe('2026-02-28T00:00:00.000Z'); // 28 de fevereiro, não 02 de março (+30 dias)
    });

    it('deve derivar current_period_end usando calendário exato para planos anuais (ex: 29/02/2024 -> 28/02/2025)', async () => {
      const checkout = await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'pro',
        interval: 'annual',
        addonBlocks: 0,
      });
      const allTransitions = Array.from(planChangesStore.values());
      const tr = allTransitions[allTransitions.length - 1];

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_leap_annual',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id || tr.provider_checkout_id || 'chk_init_123',
        providerSubscriptionId: 'sub_leap',
        providerPaymentId: 'pay_leap',
        externalReference: tr.checkout_intent_id,
        amountCents: 97092, // R$ 970,92 (8990 * 12 * 0.90)
        paymentDate: '2024-02-29T12:00:00.000Z', // 29 de fevereiro em ano bissexto
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const savedSub = subscriptionsStore.get('min_test_1');
      expect(savedSub?.current_period_start).toBe('2024-02-29T12:00:00.000Z');
      expect(savedSub?.current_period_end).toBe('2025-02-28T00:00:00.000Z');
    });
  });
});
