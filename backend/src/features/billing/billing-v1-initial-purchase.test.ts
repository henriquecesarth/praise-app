import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { BillingProvider, ParsedWebhookEvent } from './providers/billing-provider.interface';
import { AsaasBillingProvider } from './providers/asaas/asaas.provider';
import {
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingPlanChangeRecord,
  BillingTransitionV1Record,
  BillingActiveTransitionSlotRecord,
  BillingTransactionRecord,
  isBillingTransitionV1,
} from './billing.types';
import { config } from '../../config/unifiedConfig';
import { AppError } from '../../middleware/error-handler';

describe('Phase 3A.1 — Billing Transition V1 Initial Purchase Financial Boundary Hardening', () => {
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
  const transactionsStore = new Map<string, BillingTransactionRecord>();

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
      getSubscriptionByCheckoutIntentId: vi.fn().mockImplementation(async (intentId: string) => {
        for (const sub of subscriptionsStore.values()) {
          if (sub.checkout_intent_id === intentId) return sub;
        }
        return null;
      }),
      getSubscriptionByCheckoutId: vi.fn().mockImplementation(async (checkoutId: string) => {
        for (const sub of subscriptionsStore.values()) {
          if (sub.provider_checkout_id === checkoutId) return sub;
        }
        return null;
      }),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockImplementation(async (providerSubId: string) => {
        for (const sub of subscriptionsStore.values()) {
          if (sub.provider_subscription_id === providerSubId) return sub;
        }
        return null;
      }),
      setSubscription: vi.fn().mockImplementation(async (sub: any) => {
        subscriptionsStore.set(sub.ministry_id, sub);
      }),
      getPlanChange: vi.fn().mockImplementation(async (id: string) => {
        return planChangesStore.get(id) || null;
      }),
      setPlanChange: vi.fn().mockImplementation(async (record: any) => {
        planChangesStore.set(record.id, record);
      }),
      getRecentPendingPlanChange: vi.fn().mockResolvedValue(null),
      getTransitionById: vi.fn().mockImplementation(async (id: string, ministryId: string) => {
        return planChangesStore.get(id) || null;
      }),
      getPlanChangeByCheckoutIntentId: vi.fn().mockImplementation(async (intentId: string) => {
        for (const tr of planChangesStore.values()) {
          if (
            tr.id === intentId ||
            tr.checkout_intent_id === intentId ||
            (tr as any).initial_checkout_intent_id === intentId ||
            (tr as any).checkout_attempts?.some((a: any) => a.internal_checkout_intent_id === intentId)
          ) {
            return tr;
          }
        }
        return null;
      }),
      getPlanChangeByCheckoutId: vi.fn().mockImplementation(async (chkId: string) => {
        for (const tr of planChangesStore.values()) {
          if (
            tr.provider_checkout_id === chkId ||
            (tr as any).initial_provider_checkout_id === chkId ||
            (tr as any).checkout_attempts?.some((a: any) => a.provider_checkout_id === chkId)
          ) {
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
            (tr as any).initial_provider_payment_id === providerRef ||
            (tr as any).checkout_attempts?.some((a: any) => a.provider_checkout_id === providerRef || a.internal_checkout_intent_id === providerRef)
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
          current_period_start_billing_date: params.currentPeriodStartBillingDate || params.effectiveBillingDate,
          current_period_end_billing_date: params.currentPeriodEndBillingDate || null,
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
      getTransaction: vi.fn().mockImplementation(async (provider: string, providerPaymentId: string) => {
        return transactionsStore.get(`${provider}_${providerPaymentId}`) || null;
      }),
      saveTransaction: vi.fn().mockImplementation(async (tx: BillingTransactionRecord) => {
        const existing = transactionsStore.get(tx.id);
        if (existing) {
          if (
            existing.paid_billing_date &&
            tx.paid_billing_date &&
            existing.paid_billing_date !== tx.paid_billing_date
          ) {
            throw new AppError(
              409,
              `Conflito de data financeira comercial para a transação ${tx.id}`,
              { code: 'CONFLICTING_FINANCIAL_DATE' }
            );
          }
          transactionsStore.set(tx.id, {
            ...existing,
            ...tx,
            paid_billing_date: existing.paid_billing_date || tx.paid_billing_date || null,
            created_at: existing.created_at || tx.created_at,
            updated_at: tx.updated_at || new Date().toISOString(),
          });
        } else {
          transactionsStore.set(tx.id, tx);
        }
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
      claimTransitionForReconciliation: vi.fn().mockImplementation(async (id: string, lockWorkerId: string) => {
        const existing = planChangesStore.get(id);
        if (!existing) return null;
        return existing as BillingTransitionV1Record;
      }),
      releasePlanChangeLock: vi.fn().mockImplementation(async (id: string) => {
        // no-op in memory test
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
      createCustomer: vi.fn().mockResolvedValue({ providerCustomerId: 'cus_min_test_1' }),
      classifyErrorOutcome: vi.fn().mockImplementation((err: any) => {
        if (err instanceof AppError && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 408) {
          return 'DEFINITE_NO_RESOURCE_CREATED';
        }
        return 'OUTCOME_UNCERTAIN';
      }),
      createCheckout: vi.fn().mockImplementation(async () => {
        const id = 'chk_' + Math.random().toString(36).substring(2, 8);
        return {
          checkoutUrl: `https://sandbox.asaas.com/c/${id}`,
          checkoutId: id,
          expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        };
      }),
      findSubscriptionByExternalReference: vi.fn().mockResolvedValue(null),
      getSubscription: vi.fn().mockResolvedValue(null),
      listSubscriptionPayments: vi.fn().mockResolvedValue([]),
      getPayment: vi.fn().mockResolvedValue(null),
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn(),
    };

    const mockUserRepo = {
      findById: vi.fn().mockResolvedValue({ id: 'usr_admin_1', name: 'Admin', email: 'admin@louvaio.local' }),
    };

    billingService = new BillingService(
      mockBillingRepo as any,
      mockSubscriptionService as any,
      mockSubscriptionRepo as any,
      mockMinistryRepo as any,
      mockProvider as any,
      mockUserRepo as any
    );
  });

  // ===========================================================================
  // 1. PROVIDER CREATE CHECKOUT — DEFINITE VS UNCERTAIN FAILURE
  // ===========================================================================
  describe('1. Provider Create Checkout — Definite vs Uncertain Failure', () => {
    it('1.1 Definite failure (400 Bad Request): marca failed, safe_terminal e libera slot imediatamente', async () => {
      const clientError = new AppError(400, 'CPF/CNPJ inválido fornecido ao gateway');
      mockProvider.createCheckout.mockRejectedValueOnce(clientError);

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow('CPF/CNPJ inválido fornecido ao gateway');

      // Transição deve estar em failed e safe_terminal
      const transitions = Array.from(planChangesStore.values());
      expect(transitions.length).toBe(1);
      const tr = transitions[0] as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('failed');
      expect(tr.financial_safety_status).toBe('safe_terminal');
      expect(tr.failure_reason).toContain('CPF/CNPJ inválido');

      // Slot deve ter sido liberado
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('1.2 Uncertain failure (Network Timeout / 500 Server Error): NÃO libera slot e marca financial_attention_required', async () => {
      const timeoutError = new Error('fetch failed: ETIMEDOUT connect timeout');
      mockProvider.createCheckout.mockRejectedValueOnce(timeoutError);

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'pro',
          interval: 'annual',
          addonBlocks: 0,
        })
      ).rejects.toThrow('fetch failed: ETIMEDOUT connect timeout');

      // Transição deve reter slot e marcar atenção financeira
      const transitions = Array.from(planChangesStore.values());
      expect(transitions.length).toBe(1);
      const tr = transitions[0] as BillingTransitionV1Record;
      expect(tr.transition_status).toBe('pending_initial_purchase');
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_safety_status).toBe('attention_required');

      // Slot DEVE permanecer retido para evitar double charge
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });
  });

  // ===========================================================================
  // 2. EXISTING CHECKOUT RECOVERY & DUPLICATE PREVENTION
  // ===========================================================================
  describe('2. Existing Checkout Recovery & Duplicate Prevention', () => {
    it('2.1 Reutiliza checkout existente pendente sem chamar gateway novamente', async () => {
      // 1ª chamada cria o checkout
      const firstResult = await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);

      // 2ª chamada idêntica reutiliza a sessão pendente
      const secondResult = await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });

      expect(secondResult.checkoutUrl).toBe(firstResult.checkoutUrl);
      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1); // Não chamou gateway 2x
    });

    it('2.2 Quarentena bloqueia novo POST enquanto incerto mesmo após término de TTL sem evidência', async () => {
      // Simula transição com criação incerta
      const timeoutError = new Error('ETIMEDOUT');
      mockProvider.createCheckout.mockRejectedValueOnce(timeoutError);

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow();

      const existingTr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;
      expect(existingTr.uncertain_until).toBeDefined();

      // Durante e após a passagem do tempo da quarentena, novo POST continua estritamente proibido sem evidência segura
      existingTr.uncertain_until = new Date(Date.now() - 5000).toISOString();
      planChangesStore.set(existingTr.id, existingTr);

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow('UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED');

      // Provedor continua tendo sido chamado apenas 1x
      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });
  });

  // ===========================================================================
  // 3. STRONG INITIAL_PURCHASE_PROVIDER_READY GATE
  // ===========================================================================
  describe('3. Strong Initial Purchase Provider Ready Gate', () => {
    let transitionId: string;
    let checkoutIntentId: string;
    let providerCheckoutId: string;

    beforeEach(async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;
      transitionId = tr.id;
      checkoutIntentId = tr.checkout_intent_id!;
      providerCheckoutId = tr.initial_provider_checkout_id!;
    });

    it('3.1 Rejeita externalReference divergente (CHECKOUT_CORRELATION_FAILED)', async () => {
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_wrong_ref',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: 'chk_other',
        providerSubscriptionId: 'sub_asaas_1',
        providerPaymentId: 'pay_asaas_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: 'intent_completely_different',
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('CHECKOUT_CORRELATION_FAILED');
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('3.2 Rejeita customer divergente (CUSTOMER_MISMATCH)', async () => {
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_wrong_cus',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: providerCheckoutId,
        providerSubscriptionId: 'sub_asaas_1',
        providerPaymentId: 'pay_asaas_1',
        providerCustomerId: 'cus_imposter_999',
        externalReference: checkoutIntentId,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('CUSTOMER_MISMATCH');
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('3.3 Rejeita valor divergente do preço travado (AMOUNT_MISMATCH)', async () => {
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_wrong_amt',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_asaas_1',
        providerPaymentId: 'pay_asaas_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: checkoutIntentId,
        amountCents: 1000, // Preço esperado é 1490
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('AMOUNT_MISMATCH');
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('3.4 Rejeita ciclo divergente (CYCLE_MISMATCH - ex: contratado mensal, provedor anual)', async () => {
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_wrong_cycle',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_asaas_1',
        providerPaymentId: 'pay_asaas_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: checkoutIntentId,
        amountCents: 1490,
        subscriptionCycle: 'annual', // Contratado foi 'monthly'
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('CYCLE_MISMATCH');
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    });

    it('3.5 Rejeita evento com status financeiro não liquidado (PAYMENT_NOT_SETTLED)', async () => {
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_not_settled',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_asaas_1',
        providerPaymentId: 'pay_asaas_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: checkoutIntentId,
        amountCents: 1490,
        status: 'PENDING', // Rejeitado
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('PAYMENT_NOT_SETTLED');
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    });

    it('3.6 Rejeita data de vencimento/renovação com formato inválido (RENEWAL_DATE_INVALID)', async () => {
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_invalid_due',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_asaas_1',
        providerPaymentId: 'pay_asaas_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: checkoutIntentId,
        amountCents: 1490,
        dueDate: 'data-corrompida-invalid',
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('RENEWAL_DATE_INVALID');
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 4. TEMPORAL DERIVATION & DELAYED WEBHOOK TEST
  // ===========================================================================
  describe('4. Temporal Derivation & Delayed Webhook Resilience', () => {
    it('4.1 Webhook atrasado: pagamento confirmado em 23:55 no dia 01/09 e webhook chega dia 02/09 -> data de ativação permanece 01/09', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0];

      // Pagamento confirmado em 01/09 às 23:55 (horário de Brasília: 02/09 02:55 UTC)
      // Webhook processado quando o relógio do servidor marca 02/09 10:00
      const paymentConfirmedInstant = '2026-09-02T02:55:00.000Z'; // Corresponde a 2026-09-01 23:55 em America/Sao_Paulo (-03:00)

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_delayed_webhook_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_delayed_1',
        providerPaymentId: 'pay_delayed_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        confirmedDate: paymentConfirmedInstant,
        paymentDate: paymentConfirmedInstant,
        subscriptionNextDueDate: '2026-10-01',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const savedSub = subscriptionsStore.get('min_test_1');
      expect(savedSub?.current_period_start).toBe(paymentConfirmedInstant);

      const savedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(savedTr.effective_billing_date).toBe('2026-09-01'); // Permanece o dia comercial da confirmação financeira
      expect(savedTr.transition_status).toBe('completed');
      expect(savedTr.financial_safety_status).toBe('safe_terminal');
    });

    it('4.2 Autoridade de renovação: utiliza subscriptionNextDueDate do provedor quando validada', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0];

      const webhookEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_renewal_authority_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_renewal_1',
        providerPaymentId: 'pay_renewal_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        confirmedDate: '2026-09-02T10:00:00.000Z',
        subscriptionNextDueDate: '2026-10-02', // Data de renovação esperada pelo calendário civil
      };
      mockProvider.parseWebhookEvent.mockReturnValue(webhookEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const savedSub = subscriptionsStore.get('min_test_1');
      expect(savedSub?.current_period_end).toBe('2026-10-02T00:00:00.000Z');
    });
  });

  // ===========================================================================
  // 5. FAILURE-INJECTION AFTER ACTIVATION STEPS & ATOMICITY
  // ===========================================================================
  describe('5. Failure-Injection Safety & Safe-Terminal Ordering', () => {
    let tr: BillingTransitionV1Record;

    beforeEach(async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;
    });

    it('5.1 Falha na escrita de SubscriptionRepository após SubscriptionService: não perde rastro, marca attention_required e NÃO libera slot', async () => {
      mockSubscriptionRepo.setSubscription.mockRejectedValueOnce(new Error('Firestore Subscription write unavailable'));

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_fail_sub_repo',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_fail_1',
        providerPaymentId: 'pay_fail_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.status).toBe('error');

      // Slot DEVE continuar retido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.financial_attention_required).toBe(true);
      expect(updatedTr.financial_safety_status).toBe('attention_required');
    });

    it('5.2 Ordem estrita safe-terminal: transação financeira é salva de forma idempotente e slot só é liberado APÓS safe_terminal', async () => {
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_safe_order_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_safe_1',
        providerPaymentId: 'pay_safe_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
        invoiceUrl: 'https://asaas.com/i/inv_123',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      // Transação persistida
      const tx = transactionsStore.get('asaas_pay_safe_1');
      expect(tx).toBeDefined();
      expect(tx?.amount_cents).toBe(1490);
      expect(tx?.provider_payment_id).toBe('pay_safe_1');
      expect(tx?.invoice_url).toBe('https://asaas.com/i/inv_123');

      // Transição completada e safe_terminal
      const completedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(completedTr.transition_status).toBe('completed');
      expect(completedTr.financial_safety_status).toBe('safe_terminal');

      // Slot liberado
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('5.3 BillingTransaction Idempotency: múltiplos eventos mapeiam para o mesmo registro sem sobrescrever created_at', async () => {
      const event1: ParsedWebhookEvent = {
        providerEventId: 'evt_tx_idemp_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_safe_1',
        providerPaymentId: 'pay_idemp_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
        subscriptionNextDueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event1);

      await billingService.handleWebhook({}, {});

      const txFirst = transactionsStore.get('asaas_pay_idemp_1');
      expect(txFirst).toBeDefined();
      const firstCreatedAt = txFirst?.created_at;

      // Segundo webhook para o mesmo pagamento (ex: PAYMENT_RECEIVED)
      const event2: ParsedWebhookEvent = {
        providerEventId: 'evt_tx_idemp_2',
        rawEventType: 'PAYMENT_RECEIVED',
        eventType: 'payment_confirmed',
        providerSubscriptionId: 'sub_safe_1',
        providerPaymentId: 'pay_idemp_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:05:00.000Z',
        subscriptionNextDueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event2);

      const res2 = await billingService.handleWebhook({}, {});
      expect(res2.processed).toBe(true);

      const txSecond = transactionsStore.get('asaas_pay_idemp_1');
      expect(txSecond?.created_at).toBe(firstCreatedAt); // created_at preservado!
      expect(transactionsStore.size).toBe(1); // Exatamente 1 registro
    });
  });

  // ===========================================================================
  // 6. RECONCILER ENTRY POINTS
  // ===========================================================================
  describe('6. Reconciler Entry Points for Initial Purchase', () => {
    it('6.1 Reconciliação recupera transição com checkout incerto e pagamento confirmado no provedor', async () => {
      // 1. Simula checkout que teve timeout na criação
      mockProvider.createCheckout.mockRejectedValueOnce(new Error('ETIMEDOUT'));
      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow();

      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;
      expect(tr.financial_attention_required).toBe(true);

      // 2. Provedor tem a assinatura e o pagamento confirmado
      mockProvider.findSubscriptionByExternalReference.mockResolvedValueOnce({
        providerSubscriptionId: 'sub_reconciled_999',
        providerCustomerId: 'cus_min_test_1',
        status: 'ACTIVE',
        valueCents: 1490,
        nextDueDate: '2026-10-02',
      });
      mockProvider.listSubscriptionPayments.mockResolvedValueOnce([
        {
          id: 'pay_reconciled_888',
          subscriptionId: 'sub_reconciled_999',
          customerId: 'cus_min_test_1',
          status: 'CONFIRMED',
          dueDate: '2026-09-02',
          amountCents: 1490,
        },
      ]);

      // 3. Executa a reconciliação
      const recResult = await billingService.reconcileInitialPurchaseTransition(tr.id, 'worker_test_1');
      expect(recResult.success).toBe(true);

      // 4. Transição foi completada, entitlement ativado e slot liberado
      const completedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(completedTr.transition_status).toBe('completed');
      expect(completedTr.financial_safety_status).toBe('safe_terminal');
      expect(completedTr.initial_provider_subscription_id).toBe('sub_reconciled_999');

      expect(mockSubscriptionService.changePlan).toHaveBeenCalledWith('min_test_1', 'lite');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('6.2 Reconciliação restaura transação financeira ausente em transição já completed', async () => {
      // Cria e completa transição mas sem transação no store
      const checkout = await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      tr.transition_status = 'completed';
      tr.financial_safety_status = 'safe_terminal';
      tr.initial_provider_payment_id = 'pay_missing_tx_1';
      planChangesStore.set(tr.id, tr);

      // Executa reconciliação
      const recResult = await billingService.reconcileInitialPurchaseTransition(tr.id, 'worker_test_1');
      expect(recResult.success).toBe(true);

      // Transação financeira foi criada
      const tx = transactionsStore.get('asaas_pay_missing_tx_1');
      expect(tx).toBeDefined();
      expect(tx?.amount_cents).toBe(1490);
    });
  });

  // ===========================================================================
  // 7. PHASE 3A.2 — ASAAS CONTRACT & UNCERTAIN CHECKOUT RECOVERY AUDIT
  // ===========================================================================
  describe('7. Phase 3A.2 — Asaas Contract & Uncertain Checkout Recovery Audit', () => {
    it('7.1 Uncertain checkout without provider ID cannot trigger second POST during quarantine', async () => {
      mockProvider.createCheckout.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow();

      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);

      // Chamada imediata enquanto quarentena está ativa
      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow('Transição em quarentena de segurança financeira');

      // Não disparou segundo POST ao Asaas
      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);
    });

    it('7.2 Subscription lookup cannot be treated as checkout lookup during quarantine', async () => {
      mockProvider.createCheckout.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow();

      // No momento da criação do checkout, subscription não existe ainda no Asaas
      mockProvider.findSubscriptionByExternalReference.mockResolvedValueOnce(null);

      // Tentar checkout novamente dentro da quarentena deve falhar fechado com CHECKOUT_QUARANTINED
      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow('Transição em quarentena de segurança financeira');

      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);
    });

    it('7.3 Time-only uncertain retry is rejected (tempo sozinho não autoriza novo POST)', async () => {
      mockProvider.createCheckout.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow();

      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;
      expect(tr.uncertain_until).toBeDefined();

      // Simula término do TTL do checkout
      tr.uncertain_until = new Date(Date.now() - 5000).toISOString();
      planChangesStore.set(tr.id, tr);

      // Nova chamada pelo usuário é bloqueada com UNCERTAIN_CHECKOUT_UNRESOLVED
      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow('UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED');

      // Slot DEVE permanecer retido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);
    });

    it('7.4 Attempt history preserved with status uncertain and transition marked attention_required', async () => {
      mockProvider.createCheckout.mockRejectedValueOnce(new Error('ETIMEDOUT'));

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow();

      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;
      expect(tr.checkout_attempts?.length).toBe(1);
      expect(tr.checkout_attempts?.[0].status).toBe('uncertain');
      expect(tr.financial_attention_required).toBe(true);
      expect(tr.financial_attention_reason).toBe('UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED');
    });

    it('7.5 Current Hosted Checkout billingTypes match provider contract (credit card only, no boleto)', async () => {
      // Instancia o provider real do Asaas com mock do global fetch
      const asaasProvider = new AsaasBillingProvider({ apiKey: 'fake_api_key', apiUrl: 'https://sandbox.asaas.com/api/v3' });

      let capturedPayload: any = null;
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url: string, options: any) => {
        if (url.includes('/checkouts')) {
          capturedPayload = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ id: 'chk_contract_123', link: 'https://sandbox.asaas.com/c/chk_contract_123' }),
          };
        }
        return { ok: false, status: 404 };
      });

      try {
        await asaasProvider.createCheckout({
          ministryId: 'min_contract_1',
          planId: 'lite',
          planName: 'Lite',
          interval: 'monthly',
          addonBlocks: 0,
          amountCents: 1490,
          successUrl: 'https://louvaio.app/api/v1/billing/success',
        });

        expect(capturedPayload).toBeDefined();
        expect(capturedPayload.billingTypes).toEqual(['CREDIT_CARD']);
        expect(capturedPayload.billingTypes).not.toContain('BOLETO');
        expect(capturedPayload.chargeTypes).toEqual(['RECURRENT']);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('7.6 CHECKOUT_PAID recognized and updates attempt, but CANNOT bypass Provider Ready Gate', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const checkoutPaidEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_chk_paid_1',
        rawEventType: 'CHECKOUT_PAID',
        eventType: 'checkout_paid',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_asaas_ready_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(checkoutPaidEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      // CHECKOUT_PAID NÃO deve ativar o SubscriptionService!
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();

      // Slot DEVE permanecer retido aguardando liquidação financeira (PAYMENT_CONFIRMED)
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      // Transição vinculou os IDs do provedor
      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.initial_provider_subscription_id).toBe('sub_asaas_ready_1');
      expect(updatedTr.transition_status).toBe('pending_initial_purchase');
    });

    it('7.7 CHECKOUT_EXPIRED recognized and releases slot safely', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const checkoutExpiredEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_chk_exp_1',
        rawEventType: 'CHECKOUT_EXPIRED',
        eventType: 'checkout_expired',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(checkoutExpiredEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.transition_status).toBe('failed');
      expect(updatedTr.financial_safety_status).toBe('safe_terminal');

      // Slot foi liberado com segurança
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('7.8 PAYMENT_CONFIRMED recognized separately from checkout events', async () => {
      const asaasProvider = new AsaasBillingProvider({ apiKey: 'fake_api_key', apiUrl: 'https://sandbox.asaas.com/api/v3' });

      const parsedConfirmed = asaasProvider.parseWebhookEvent({
        id: 'evt_pc_1',
        event: 'PAYMENT_CONFIRMED',
        payment: {
          id: 'pay_pc_1',
          value: 14.9,
          status: 'CONFIRMED',
          customer: 'cus_1',
          subscription: 'sub_1',
        },
      });

      expect(parsedConfirmed?.eventType).toBe('payment_confirmed');
      expect(parsedConfirmed?.providerPaymentId).toBe('pay_pc_1');

      const parsedReceived = asaasProvider.parseWebhookEvent({
        id: 'evt_pr_1',
        event: 'PAYMENT_RECEIVED',
        payment: {
          id: 'pay_pr_1',
          value: 14.9,
          status: 'RECEIVED',
          customer: 'cus_1',
          subscription: 'sub_1',
        },
      });

      expect(parsedReceived?.eventType).toBe('payment_confirmed');
    });

    it('7.9 paymentDate-only payload does not fabricate exact instant (uses operational timestamp for effective_at)', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_date_only_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_asaas_1',
        providerPaymentId: 'pay_date_only_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-01', // Data sem hora
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const beforeIso = new Date().toISOString();
      const res = await billingService.handleWebhook({}, {});
      const afterIso = new Date().toISOString();
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.effective_billing_date).toBe('2026-09-01'); // Autoridade comercial mantida

      const savedSub = subscriptionsStore.get('min_test_1');
      expect(savedSub).toBeDefined();
      // effective_at / current_period_start NÃO deve ser fabricado como meia-noite (2026-09-01T00:00:00.000Z) ou meio-dia
      expect(savedSub!.current_period_start).not.toBe('2026-09-01T00:00:00.000Z');
      expect(savedSub!.current_period_start).not.toBe('2026-09-01T12:00:00.000Z');
      expect(new Date(savedSub!.current_period_start).getTime()).toBeGreaterThanOrEqual(new Date(beforeIso).getTime() - 1000);
      expect(new Date(savedSub!.current_period_start).getTime()).toBeLessThanOrEqual(new Date(afterIso).getTime() + 1000);
    });

    it('7.10 delayed webhook preserves provider commercial date', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      // Pagamento foi liquidado no provedor em 01/09 às 23:55 (UTC-3)
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_delayed_7_10',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_asaas_1',
        providerPaymentId: 'pay_delayed_7_10',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        confirmedDate: '2026-09-01T23:55:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.effective_billing_date).toBe('2026-09-01');
    });

    it('7.11 fresh subscription read determines next renewal safely when event payload lacks nextDueDate', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      // Evento vem sem subscriptionNextDueDate
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_no_next_due',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_fresh_read_1',
        providerPaymentId: 'pay_fresh_read_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      // Fresh provider read retorna a próxima data de renovação pós-liquidação
      mockProvider.getSubscription.mockResolvedValueOnce({
        status: 'ACTIVE',
        value: 14.9,
        cycle: 'MONTHLY',
        nextDueDate: '2026-10-02',
      });

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      expect(mockProvider.getSubscription).toHaveBeenCalledWith('sub_fresh_read_1');

      const savedSub = subscriptionsStore.get('min_test_1');
      expect(savedSub).toBeDefined();
      expect(savedSub!.current_period_end).toBe('2026-10-02T00:00:00.000Z');
    });

    it('7.12 fresh subscription read fails closed when provider returns anomaly renewal date <= effectiveBillingDate', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_anomaly_due',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_anomaly_1',
        providerPaymentId: 'pay_anomaly_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      // Provedor retorna anomalia (nextDueDate no passado ou no mesmo dia do pagamento)
      mockProvider.getSubscription.mockResolvedValueOnce({
        status: 'ACTIVE',
        value: 14.9,
        cycle: 'MONTHLY',
        nextDueDate: '2026-09-02', // Anomalia: não avançou o mês pós-pagamento
      });

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('RENEWAL_DATE_MISMATCH');

      // Entitlement NÃO foi promovido
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();

      // Slot DEVE permanecer retido para atenção financeira
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('7.13 finalization ordering remains safe (Gate -> Entitlement -> AppSub -> BillingSub -> Tx -> Completed -> SlotRelease)', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'pro',
        interval: 'monthly',
        addonBlocks: 1,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const executionOrder: string[] = [];

      mockSubscriptionService.changePlan.mockImplementationOnce(async () => {
        executionOrder.push('changePlan');
      });
      mockSubscriptionService.changeMemberAddonBlocks.mockImplementationOnce(async () => {
        executionOrder.push('changeMemberAddonBlocks');
      });
      mockSubscriptionRepo.setSubscription.mockImplementationOnce(async () => {
        executionOrder.push('setSubscription');
      });
      mockBillingRepo.saveTransaction.mockImplementationOnce(async () => {
        executionOrder.push('saveTransaction');
      });
      mockBillingRepo.confirmInitialPurchaseActivation.mockImplementationOnce(async (params: any) => {
        executionOrder.push('confirmInitialPurchaseActivation');
        const existing = planChangesStore.get(params.transitionId);
        const updated = {
          ...existing,
          transition_status: 'completed',
          financial_safety_status: 'safe_terminal',
        };
        planChangesStore.set(params.transitionId, updated as any);
        return updated as any;
      });
      mockBillingRepo.releaseSlotIfOwnedAndSafe.mockImplementationOnce(async (minId: string, prov: string, tId: string) => {
        executionOrder.push('releaseSlotIfOwnedAndSafe');
        activeSlotsStore.delete(`slot_${minId}_${prov}`);
        return true;
      });

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_order_audit_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_order_1',
        providerPaymentId: 'pay_order_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 9680,
        paymentDate: '2026-09-02T10:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

        expect(executionOrder).toEqual([
        'changePlan',
        'changeMemberAddonBlocks',
        'setSubscription',
        'saveTransaction',
        'confirmInitialPurchaseActivation',
        'releaseSlotIfOwnedAndSafe',
      ]);
    });
  });

  // ===========================================================================
  // 8. PHASE 3A.3 — ATTEMPT RACE & BILLING PERIOD HARDENING
  // ===========================================================================
  describe('8. Phase 3A.3 — Attempt Race & Billing Period Hardening', () => {
    it('8.1 Attempt Races: Stale checkout_expired on Attempt A after Attempt B exists -> A expired, B stays pending, slot kept', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      // Simula a existência de dois attempts: Attempt A (antigo) e Attempt B (atual)
      const attemptA = { ...tr.checkout_attempts![0], attempt_id: 'att_A', provider_checkout_id: 'chk_A', internal_checkout_intent_id: 'intent_A' };
      const attemptB = { ...tr.checkout_attempts![0], attempt_id: 'att_B', provider_checkout_id: 'chk_B', internal_checkout_intent_id: 'intent_B', status: 'pending' as const };

      tr.checkout_attempts = [attemptA, attemptB];
      tr.current_initial_purchase_checkout_attempt_id = 'att_B';
      tr.initial_provider_checkout_id = 'chk_B';
      planChangesStore.set(tr.id, tr);

      // Webhook de CHECKOUT_EXPIRED chega referenciando o Attempt A (antigo)
      const staleExpiredEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_exp_A',
        rawEventType: 'CHECKOUT_EXPIRED',
        eventType: 'checkout_expired',
        providerCheckoutId: 'chk_A',
        externalReference: 'intent_A',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(staleExpiredEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      // Attempt A foi marcado como expired
      expect(updatedTr.checkout_attempts?.find((a) => a.attempt_id === 'att_A')?.status).toBe('expired');
      // Attempt B PERMANECE pending
      expect(updatedTr.checkout_attempts?.find((a) => a.attempt_id === 'att_B')?.status).toBe('pending');
      // Transição NÃO foi marcada como failed nem safe_terminal
      expect(updatedTr.transition_status).toBe('pending_initial_purchase');
      expect(updatedTr.financial_safety_status).toBe('live');
      // Slot PERMANECE retido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('8.2 Attempt Races: Stale checkout_canceled on Attempt A after Attempt B exists -> A canceled, B stays pending, slot kept', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const attemptA = { ...tr.checkout_attempts![0], attempt_id: 'att_A', provider_checkout_id: 'chk_A', internal_checkout_intent_id: 'intent_A' };
      const attemptB = { ...tr.checkout_attempts![0], attempt_id: 'att_B', provider_checkout_id: 'chk_B', internal_checkout_intent_id: 'intent_B', status: 'pending' as const };

      tr.checkout_attempts = [attemptA, attemptB];
      tr.current_initial_purchase_checkout_attempt_id = 'att_B';
      tr.initial_provider_checkout_id = 'chk_B';
      planChangesStore.set(tr.id, tr);

      // Webhook de CHECKOUT_CANCELED chega referenciando Attempt A
      const staleCanceledEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_canc_A',
        rawEventType: 'CHECKOUT_CANCELED',
        eventType: 'checkout_canceled',
        providerCheckoutId: 'chk_A',
        externalReference: 'intent_A',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(staleCanceledEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.checkout_attempts?.find((a) => a.attempt_id === 'att_A')?.status).toBe('canceled');
      expect(updatedTr.checkout_attempts?.find((a) => a.attempt_id === 'att_B')?.status).toBe('pending');
      expect(updatedTr.transition_status).toBe('pending_initial_purchase');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('8.3 Attempt Races: Stale checkout_paid on Attempt A after Attempt B exists -> financial_attention_required, slot kept', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const attemptA = { ...tr.checkout_attempts![0], attempt_id: 'att_A', provider_checkout_id: 'chk_A', internal_checkout_intent_id: 'intent_A' };
      const attemptB = { ...tr.checkout_attempts![0], attempt_id: 'att_B', provider_checkout_id: 'chk_B', internal_checkout_intent_id: 'intent_B', status: 'pending' as const };

      tr.checkout_attempts = [attemptA, attemptB];
      tr.current_initial_purchase_checkout_attempt_id = 'att_B';
      tr.initial_provider_checkout_id = 'chk_B';
      planChangesStore.set(tr.id, tr);

      // Webhook de CHECKOUT_PAID chega para Attempt A (antigo)
      const stalePaidEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_paid_A',
        rawEventType: 'CHECKOUT_PAID',
        eventType: 'checkout_paid',
        providerCheckoutId: 'chk_A',
        providerSubscriptionId: 'sub_stale_A',
        providerCustomerId: 'cus_min_test_1',
        externalReference: 'intent_A',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(stalePaidEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      // Transição entrou em atenção financeira devido ao pagamento em tentativa stale
      expect(updatedTr.financial_attention_required).toBe(true);
      expect(updatedTr.financial_attention_reason).toBe('STALE_ATTEMPT_CHECKOUT_PAID');
      expect(updatedTr.financial_safety_status).toBe('attention_required');
      // Slot permanece travado
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('8.4 Attempt Races: PAYMENT_CONFIRMED on Attempt A when Attempt B exists -> handled safely without double activation', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const attemptA = { ...tr.checkout_attempts![0], attempt_id: 'att_A', provider_checkout_id: 'chk_A', internal_checkout_intent_id: 'intent_A' };
      const attemptB = { ...tr.checkout_attempts![0], attempt_id: 'att_B', provider_checkout_id: 'chk_B', internal_checkout_intent_id: 'intent_B', status: 'pending' as const };

      tr.checkout_attempts = [attemptA, attemptB];
      tr.current_initial_purchase_checkout_attempt_id = 'att_B';
      tr.initial_provider_checkout_id = 'chk_B';
      planChangesStore.set(tr.id, tr);

      // Pagamento do Attempt A chega
      const paymentEventA: ParsedWebhookEvent = {
        providerEventId: 'evt_pay_A',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: 'chk_A',
        providerSubscriptionId: 'sub_A',
        providerPaymentId: 'pay_A',
        providerCustomerId: 'cus_min_test_1',
        externalReference: 'intent_A',
        amountCents: 1490,
        paymentDate: '2026-09-02T10:00:00.000Z',
        subscriptionNextDueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(paymentEventA);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      expect(mockSubscriptionService.changePlan).toHaveBeenCalledTimes(1);

      // Segundo pagamento (com id de evento diferente para simular race/redelivery após completed) não duplica ativação
      const paymentEventA2: ParsedWebhookEvent = {
        ...paymentEventA,
        providerEventId: 'evt_pay_A_redelivery',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(paymentEventA2);

      const res2 = await billingService.handleWebhook({}, {});
      expect(res2.processed).toBe(true);
      expect(res2.reason).toBe('already_completed');
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledTimes(1);
    });

    it('8.5 Attempt Races: Duplicate terminal event is processed idempotently', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const expiredEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_exp_dup_1',
        rawEventType: 'CHECKOUT_EXPIRED',
        eventType: 'checkout_expired',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(expiredEvent);

      // 1º evento
      const res1 = await billingService.handleWebhook({}, {});
      expect(res1.processed).toBe(true);
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);

      // 2º evento duplicado
      const expiredEvent2: ParsedWebhookEvent = { ...expiredEvent, providerEventId: 'evt_exp_dup_2' };
      mockProvider.parseWebhookEvent.mockReturnValue(expiredEvent2);

      const res2 = await billingService.handleWebhook({}, {});
      expect(res2.processed).toBe(true);
    });

    it('8.6 Terminal Event Safety Guard: checkout_expired arrives but transition has settled payment -> slot kept', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      // Simula que a transição já possui pagamento confirmado
      tr.initial_provider_payment_id = 'pay_already_settled_1';
      planChangesStore.set(tr.id, tr);

      const expiredEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_exp_with_pay',
        rawEventType: 'CHECKOUT_EXPIRED',
        eventType: 'checkout_expired',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        externalReference: tr.checkout_intent_id,
      };
      mockProvider.parseWebhookEvent.mockReturnValue(expiredEvent);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      // Guard acionado: atenção financeira e slot NÃO liberado!
      expect(updatedTr.financial_attention_required).toBe(true);
      expect(updatedTr.financial_attention_reason).toBe('TERMINAL_EVENT_WITH_SETTLED_PAYMENT_OR_SUBSCRIPTION');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('8.7 Uncertain Create: OUTCOME_UNCERTAIN -> passes uncertain_until -> subsequent calls do ZERO new POSTs and retain slot', async () => {
      mockProvider.createCheckout.mockRejectedValueOnce(new Error('ETIMEDOUT connect timeout'));

      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow();

      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;
      expect(tr.financial_attention_required).toBe(true);

      // Simula término de 75 minutos (quarantine TTL)
      tr.uncertain_until = new Date(Date.now() - 10000).toISOString();
      planChangesStore.set(tr.id, tr);

      // Nova chamada pelo usuário após o término da quarentena DEVE ser rejeitada sem novo POST ao Asaas
      await expect(
        billingService.createCheckout('min_test_1', 'usr_admin_1', {
          planId: 'lite',
          interval: 'monthly',
          addonBlocks: 0,
        })
      ).rejects.toThrow('UNCERTAIN_CHECKOUT_CREATE_UNRESOLVED');

      expect(mockProvider.createCheckout).toHaveBeenCalledTimes(1);
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });

    it('8.8 Commercial Period: Payment confirmed on 2026-09-01, webhook processed on 2026-09-02 -> preserves 2026-09-01 start and 2026-10-01 end', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_delayed_period_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_delayed_period_1',
        providerPaymentId: 'pay_delayed_period_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        confirmedDate: '2026-09-01T22:00:00.000Z', // Data financeira no dia 01/09
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      // Webhook é processado no dia 02/09 às 08:00
      const nowProcessing = new Date('2026-09-02T08:00:00.000Z');
      const res = await billingService.handleWebhook({}, {}, nowProcessing);
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.effective_billing_date).toBe('2026-09-01');
      expect(updatedTr.current_period_start_billing_date).toBe('2026-09-01');
      expect(updatedTr.current_period_end_billing_date).toBe('2026-10-01');

      const billingSub = subscriptionsStore.get('min_test_1');
      expect(billingSub).toBeDefined();
      expect(billingSub!.current_period_start_billing_date).toBe('2026-09-01');
      expect(billingSub!.current_period_end_billing_date).toBe('2026-10-01');
      expect(billingSub!.current_period_end).toBe('2026-10-01T00:00:00.000Z');
    });

    it('8.9 Commercial Period Month-End & Leap Year: 2026-01-31 -> 2026-02-28; 2024-02-29 annual -> 2025-02-28', async () => {
      // 1. Mensal partindo de 31 de janeiro
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const jan31Event: ParsedWebhookEvent = {
        providerEventId: 'evt_jan_31',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_jan_31',
        providerPaymentId: 'pay_jan_31',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        confirmedDate: '2026-01-31T15:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(jan31Event);

      await billingService.handleWebhook({}, {});

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.current_period_start_billing_date).toBe('2026-01-31');
      expect(updatedTr.current_period_end_billing_date).toBe('2026-02-28');

      // 2. Anual partindo de 29 de fevereiro em ano bissexto (2024)
      await billingService.createCheckout('min_test_leap', 'usr_admin_1', {
        planId: 'lite',
        interval: 'annual',
        addonBlocks: 0,
      });
      const trAnnual = Array.from(planChangesStore.values()).find((t) => t.ministry_id === 'min_test_leap') as BillingTransitionV1Record;

      const leapEvent: ParsedWebhookEvent = {
        providerEventId: 'evt_leap_2024',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: trAnnual.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_leap_1',
        providerPaymentId: 'pay_leap_1',
        providerCustomerId: trAnnual.provider_customer_id || 'cus_min_test_1',
        externalReference: trAnnual.checkout_intent_id,
        amountCents: trAnnual.target_future_recurring_price_cents,
        confirmedDate: '2024-02-29T15:00:00.000Z',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(leapEvent);

      await billingService.handleWebhook({}, {});

      const updatedTrAnnual = planChangesStore.get(trAnnual.id) as BillingTransitionV1Record;
      expect(updatedTrAnnual.current_period_start_billing_date).toBe('2024-02-29');
      expect(updatedTrAnnual.current_period_end_billing_date).toBe('2025-02-28');
    });

    it('8.10 Renewal Date Exact Cross-Check: Monthly on 2026-09-01 with provider nextDueDate: 2026-10-01 PASSES', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_exact_due_pass',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_exact_1',
        providerPaymentId: 'pay_exact_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-01T10:00:00.000Z',
        subscriptionNextDueDate: '2026-10-01',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.transition_status).toBe('completed');
      expect(updatedTr.financial_safety_status).toBe('safe_terminal');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
    });

    it('8.11 Renewal Date Exact Cross-Check: Monthly on 2026-09-01 with provider nextDueDate: 2026-12-01 FAILS CLOSED with RENEWAL_DATE_MISMATCH', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_exact_due_mismatch',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_mismatch_1',
        providerPaymentId: 'pay_mismatch_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-01T10:00:00.000Z',
        subscriptionNextDueDate: '2026-12-01', // Anomalia: 3 meses ao invés de 1 mês
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('RENEWAL_DATE_MISMATCH');

      // Entitlement NÃO promovido
      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();

      // Slot DEVE permanecer retido
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);

      const updatedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(updatedTr.financial_attention_required).toBe(true);
      expect(updatedTr.financial_safety_status).toBe('attention_required');
    });

    it('8.12 Renewal Date Exact Cross-Check: Monthly on 2026-09-01 with provider nextDueDate: 2026-09-01 FAILS CLOSED with RENEWAL_DATE_MISMATCH', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_exact_due_same_day',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_sameday_1',
        providerPaymentId: 'pay_sameday_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-01T10:00:00.000Z',
        subscriptionNextDueDate: '2026-09-01', // Anomalia: não avançou o vencimento
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      const res = await billingService.handleWebhook({}, {});
      expect(res.processed).toBe(false);
      expect(res.reason).toBe('RENEWAL_DATE_MISMATCH');

      expect(mockSubscriptionService.changePlan).not.toHaveBeenCalled();
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(true);
    });
  });

  // ===========================================================================
  // 9. PHASE 3A FINAL CLOSURE — IDEMPOTENCY & TRANSACTION TEMPORAL AUDIT
  // ===========================================================================
  describe('9. Phase 3A Final Closure — Idempotency & Transaction Temporal Audit', () => {
    it('9.1 Same provider_event_id twice -> business processing once (Event Layer Idempotency)', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_dup_audit_101',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_dup_audit_1',
        providerPaymentId: 'pay_dup_audit_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02',
        subscriptionNextDueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);

      // 1ª entrega: processa normalmente
      const firstRes = await billingService.handleWebhook({}, {});
      expect(firstRes.processed).toBe(true);
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledTimes(1);

      // 2ª entrega com o MESMO providerEventId: registrado como duplicata
      const secondRes = await billingService.handleWebhook({}, {});
      expect(secondRes.processed).toBe(false);
      expect(secondRes.reason).toBe('duplicate_event');
      // Nenhuma segunda invocação de negócio
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledTimes(1);
    });

    it('9.2 Same payment represented by different events -> single BillingTransaction record (Transaction Layer Idempotency)', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event1: ParsedWebhookEvent = {
        providerEventId: 'evt_tx_layer_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_tx_layer_1',
        providerPaymentId: 'pay_same_tx_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02',
        subscriptionNextDueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event1);
      await billingService.handleWebhook({}, {});

      // Segundo evento com ID de evento diferente mas referente ao MESMO payment ID
      const event2: ParsedWebhookEvent = {
        providerEventId: 'evt_tx_layer_2',
        rawEventType: 'PAYMENT_RECEIVED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_tx_layer_1',
        providerPaymentId: 'pay_same_tx_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02',
        subscriptionNextDueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event2);
      await billingService.handleWebhook({}, {});

      // Deve existir exatamente 1 registro de transação financeira para este payment
      const matchingTxs = Array.from(transactionsStore.values()).filter(
        (t) => t.provider_payment_id === 'pay_same_tx_1'
      );
      expect(matchingTxs.length).toBe(1);
    });

    it('9.3 Completed transition receives duplicate payment event -> no regression, safe_terminal remains, slot not recreated', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_completed_dup_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_comp_1',
        providerPaymentId: 'pay_comp_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-02',
        subscriptionNextDueDate: '2026-10-02',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);
      await billingService.handleWebhook({}, {});

      const completedTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(completedTr.transition_status).toBe('completed');
      expect(completedTr.financial_safety_status).toBe('safe_terminal');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);

      // Evento subsequente com mesmo ou novo eventId
      const eventDup: ParsedWebhookEvent = {
        ...event,
        providerEventId: 'evt_completed_dup_2',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(eventDup);
      const dupRes = await billingService.handleWebhook({}, {});
      expect(dupRes.processed).toBe(true);

      // Estado permanece completed, safe_terminal e slot continua liberado
      const afterTr = planChangesStore.get(tr.id) as BillingTransitionV1Record;
      expect(afterTr.transition_status).toBe('completed');
      expect(afterTr.financial_safety_status).toBe('safe_terminal');
      expect(activeSlotsStore.has('slot_min_test_1_asaas')).toBe(false);
      expect(mockSubscriptionService.changePlan).toHaveBeenCalledTimes(1); // Entitlement não duplicado
    });

    it('9.4 Temporal Provenance: preserves exact commercial date in paid_billing_date without fake time', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      // Evento com pagamento ocorrido no dia 2026-09-01
      const event: ParsedWebhookEvent = {
        providerEventId: 'evt_temporal_audit_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_temp_1',
        providerPaymentId: 'pay_temp_1',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-01', // Date-only do provedor
        subscriptionNextDueDate: '2026-10-01',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event);
      await billingService.handleWebhook({}, {});

      const tx = transactionsStore.get('asaas_pay_temp_1');
      expect(tx).toBeDefined();
      expect(tx?.paid_billing_date).toBe('2026-09-01');
      expect(tx?.paid_at).toBeDefined(); // Timestamp operacional observado
    });

    it('9.5 Same payment represented by PAYMENT_CONFIRMED then PAYMENT_RECEIVED with same commercial date preserves single transaction and date', async () => {
      await billingService.createCheckout('min_test_1', 'usr_admin_1', {
        planId: 'lite',
        interval: 'monthly',
        addonBlocks: 0,
      });
      const tr = Array.from(planChangesStore.values())[0] as BillingTransitionV1Record;

      const event1: ParsedWebhookEvent = {
        providerEventId: 'evt_samedate_1',
        rawEventType: 'PAYMENT_CONFIRMED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_samedate_1',
        providerPaymentId: 'pay_samedate_100',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-01',
        subscriptionNextDueDate: '2026-10-01',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event1);
      await billingService.handleWebhook({}, {});

      const event2: ParsedWebhookEvent = {
        providerEventId: 'evt_samedate_2',
        rawEventType: 'PAYMENT_RECEIVED',
        eventType: 'payment_confirmed',
        providerCheckoutId: tr.initial_provider_checkout_id!,
        providerSubscriptionId: 'sub_samedate_1',
        providerPaymentId: 'pay_samedate_100',
        providerCustomerId: 'cus_min_test_1',
        externalReference: tr.checkout_intent_id,
        amountCents: 1490,
        paymentDate: '2026-09-01',
        subscriptionNextDueDate: '2026-10-01',
      };
      mockProvider.parseWebhookEvent.mockReturnValue(event2);
      await billingService.handleWebhook({}, {});

      const tx = transactionsStore.get('asaas_pay_samedate_100');
      expect(tx).toBeDefined();
      expect(tx?.paid_billing_date).toBe('2026-09-01');
    });

    it('9.6 Conflicting financial date for same payment is blocked (fails closed without silent overwrite)', async () => {
      const initialTx: BillingTransactionRecord = {
        id: 'asaas_pay_conflict_1',
        ministry_id: 'min_test_1',
        provider: 'asaas',
        provider_payment_id: 'pay_conflict_1',
        amount_cents: 1490,
        currency: 'BRL',
        status: 'paid',
        due_date: '2026-09-01',
        paid_at: '2026-09-01T10:00:00Z',
        paid_billing_date: '2026-09-01',
        created_at: '2026-09-01T10:00:00Z',
        updated_at: '2026-09-01T10:00:00Z',
      };
      await mockBillingRepo.saveTransaction(initialTx);

      const conflictingTx: BillingTransactionRecord = {
        ...initialTx,
        paid_billing_date: '2026-09-02', // Divergência de data comercial
      };

      await expect(mockBillingRepo.saveTransaction(conflictingTx)).rejects.toThrowError(
        /Conflito de data financeira comercial/
      );

      // Garante que o valor original de 01/09 não foi corrompido
      const currentTx = transactionsStore.get('asaas_pay_conflict_1');
      expect(currentTx?.paid_billing_date).toBe('2026-09-01');
    });
  });
});
