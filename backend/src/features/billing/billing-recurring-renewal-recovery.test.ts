import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BillingService } from './billing.service';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { AsaasBillingProvider } from './providers/asaas/asaas.provider';

describe('Phase 4A.6C: Recurring Renewal Ingestion & Recovery Runtime Hardening', () => {
  let billingService: BillingService;
  let subscriptionService: SubscriptionService;
  let mockBillingRepo: any;
  let mockSubRepo: any;
  let mockProvider: any;
  let mockSubService: any;

  const ministryId = 'min_renewal_test_01';
  const providerSubId = 'sub_test_current_123';
  const renewalPaymentId = 'pay_test_current_renewal';
  const invoiceUrl = 'https://sandbox.example.invalid/i/test-current-renewal';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. S2 reproduction: ordinary recurring PAYMENT_RECEIVED does NOT call nonexistent changePlan and recovers cleanly', async () => {
    // Current app sub is past_due from current cycle
    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'lite',
      subscription_mode: 'paid',
      billing_status: 'past_due',
      billing_interval: 'monthly',
      member_addon_blocks: 0,
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
      grace_period_expires_at: '2026-10-16T00:00:00.000Z',
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    };

    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      provider_customer_id: 'cus_test_123',
      plan_id: 'lite',
      interval: 'monthly',
      amount_cents: 1490,
      status: 'past_due',
      started_at: '2026-09-09T00:00:00.000Z',
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
      current_period_end_billing_date: '2026-10-09',
      cancel_at_period_end: false,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    };

    mockBillingRepo = {
      registerWebhookEvent: vi.fn().mockResolvedValue({ isDuplicate: false }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      getPlanChangeByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getPlanChangeByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockResolvedValue(currentBillingSub),
      getCustomerByProviderId: vi.fn().mockResolvedValue(null),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      getPlanChange: vi.fn().mockResolvedValue(null),
      getActiveTransitionSlot: vi.fn().mockResolvedValue(null),
      setSubscription: vi.fn().mockResolvedValue(undefined),
      saveTransaction: vi.fn().mockResolvedValue(undefined),
      getTransaction: vi.fn().mockResolvedValue(null),
      getCustomer: vi.fn().mockResolvedValue(null),
      setCustomer: vi.fn().mockResolvedValue(undefined),
      updateCustomer: vi.fn().mockResolvedValue(undefined),
      settleOrdinaryRecurringRenewalAtomic: vi.fn().mockImplementation(async (params: any) => {
        await mockSubRepo.setSubscription({
          ...currentAppSub,
          billing_status: 'active',
          grace_period_expires_at: null,
          current_period_start: '2026-10-09T00:00:00.000Z',
          current_period_end: '2026-11-09T00:00:00.000Z',
        });
        await mockBillingRepo.saveTransaction({
          id: `asaas_${params.providerPaymentId}`,
          ministry_id: params.ministryId,
          provider: 'asaas',
          provider_payment_id: params.providerPaymentId,
          provider_subscription_id: params.providerSubscriptionId,
          transaction_type: 'recurring_payment',
          status: 'paid',
          due_date: params.renewalBillingDate,
          paid_billing_date: params.paidBillingDate || params.renewalBillingDate,
          invoice_url: params.invoiceUrl,
        });
        return {
          success: true,
          outcome: 'settled',
          transactionId: `asaas_${params.providerPaymentId}`,
        };
      }),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
      setSubscription: vi.fn().mockResolvedValue(undefined),
    };

    mockProvider = {
      name: 'asaas',
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        providerEventId: 'evt_received_1',
        eventType: 'payment_received',
        rawEventType: 'PAYMENT_RECEIVED',
        providerPaymentId: renewalPaymentId,
        providerSubscriptionId: providerSubId,
        providerCustomerId: 'cus_test_123',
        amountCents: 1490,
        currency: 'BRL',
        paymentMethod: 'BOLETO',
        dueDate: '2026-10-09',
        originalDueDate: '2026-10-09',
        invoiceUrl,
        paymentDate: '2026-10-09',
        status: 'RECEIVED',
      }),
    };

    // Note: SubscriptionService mock does NOT have changePlan!
    mockSubService = {
      getSubscriptionSummary: vi.fn(),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      mockSubService as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    // Act: process PAYMENT_RECEIVED webhook for ordinary renewal (planChange == null)
    const result = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});

    expect(result.status).toBe('ok');
    expect(result.processed).toBe(true);
    expect(mockSubRepo.setSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        billing_status: 'active',
        grace_period_expires_at: null,
        current_period_start: '2026-10-09T00:00:00.000Z',
        current_period_end: '2026-11-09T00:00:00.000Z',
      })
    );
    expect(mockBillingRepo.saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `asaas_${renewalPaymentId}`,
        ministry_id: ministryId,
        provider: 'asaas',
        provider_payment_id: renewalPaymentId,
        provider_subscription_id: providerSubId,
        transaction_type: 'recurring_payment',
        status: 'paid',
        due_date: '2026-10-09',
        paid_billing_date: '2026-10-09',
        invoice_url: invoiceUrl,
      })
    );
  });

  it('2. Dual-event idempotency: PAYMENT_CONFIRMED followed by PAYMENT_RECEIVED for the same payment is idempotent', async () => {
    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'lite',
      subscription_mode: 'paid',
      billing_status: 'past_due',
      billing_interval: 'monthly',
      member_addon_blocks: 0,
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
      grace_period_expires_at: '2026-10-16T00:00:00.000Z',
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    };

    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      provider_customer_id: 'cus_test_123',
      plan_id: 'lite',
      interval: 'monthly',
      amount_cents: 1490,
      status: 'past_due',
      started_at: '2026-09-09T00:00:00.000Z',
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
      current_period_end_billing_date: '2026-10-09',
      cancel_at_period_end: false,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-10-09T00:00:00.000Z',
    };

    // First event settles
    mockBillingRepo = {
      registerWebhookEvent: vi.fn().mockResolvedValue({ isDuplicate: false }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      getPlanChangeByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getPlanChangeByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockResolvedValue(currentBillingSub),
      getCustomerByProviderId: vi.fn().mockResolvedValue(null),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      getPlanChange: vi.fn().mockResolvedValue(null),
      getActiveTransitionSlot: vi.fn().mockResolvedValue(null),
      setSubscription: vi.fn().mockResolvedValue(undefined),
      saveTransaction: vi.fn().mockResolvedValue(undefined),
      getTransaction: vi.fn().mockResolvedValue(null), // not settled yet
      getCustomer: vi.fn().mockResolvedValue(null),
      setCustomer: vi.fn().mockResolvedValue(undefined),
      updateCustomer: vi.fn().mockResolvedValue(undefined),
      settleOrdinaryRecurringRenewalAtomic: vi.fn()
        .mockImplementationOnce(async (params: any) => {
          await mockSubRepo.setSubscription({
            ...currentAppSub,
            billing_status: 'active',
            grace_period_expires_at: null,
            current_period_start: '2026-10-09T00:00:00.000Z',
            current_period_end: '2026-11-09T00:00:00.000Z',
          });
          return {
            success: true,
            outcome: 'settled',
            transactionId: `asaas_${params.providerPaymentId}`,
          };
        })
        .mockResolvedValueOnce({
          success: true,
          outcome: 'already_settled',
          transactionId: `asaas_${renewalPaymentId}`,
        }),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
      setSubscription: vi.fn().mockResolvedValue(undefined),
    };

    mockProvider = {
      name: 'asaas',
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        providerEventId: 'evt_confirmed_1',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerPaymentId: renewalPaymentId,
        providerSubscriptionId: providerSubId,
        providerCustomerId: 'cus_test_123',
        amountCents: 1490,
        currency: 'BRL',
        paymentMethod: 'CREDIT_CARD',
        dueDate: '2026-10-09',
        originalDueDate: '2026-10-09',
        invoiceUrl,
        paymentDate: '2026-10-09',
        status: 'CONFIRMED',
      }),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    const firstResult = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(firstResult.status).toBe('ok');
    expect(firstResult.processed).toBe(true);
    expect(mockSubRepo.setSubscription).toHaveBeenCalledTimes(1);

    // Second event arrives (PAYMENT_RECEIVED) for the exact same payment ID
    mockBillingRepo.getTransaction.mockResolvedValue({
      id: `asaas_${renewalPaymentId}`,
      ministry_id: ministryId,
      status: 'paid',
      transaction_type: 'recurring_payment',
    });

    mockProvider.parseWebhookEvent.mockReturnValue({
      providerEventId: 'evt_received_2',
      eventType: 'payment_received',
      rawEventType: 'PAYMENT_RECEIVED',
      providerPaymentId: renewalPaymentId,
      providerSubscriptionId: providerSubId,
      providerCustomerId: 'cus_test_123',
      amountCents: 1490,
      currency: 'BRL',
      paymentMethod: 'CREDIT_CARD',
      dueDate: '2026-10-09',
      originalDueDate: '2026-10-09',
      invoiceUrl,
      paymentDate: '2026-10-09',
      status: 'RECEIVED',
    });

    const secondResult = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(secondResult.status).toBe('ok');
    expect(secondResult.processed).toBe(true);
    expect(secondResult.reason).toBe('already_settled');
    // Set subscription should not have been called a second time
    expect(mockSubRepo.setSubscription).toHaveBeenCalledTimes(1);
  });

  it('3. PAYMENT_OVERDUE identity ingestion: handles Asaas forced overdue (dueDate=yesterday, originalDueDate=renewalBoundary)', async () => {
    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'lite',
      subscription_mode: 'paid',
      billing_status: 'active',
      billing_interval: 'monthly',
      member_addon_blocks: 0,
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
      grace_period_expires_at: null,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
    };

    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      provider_customer_id: 'cus_test_123',
      plan_id: 'lite',
      interval: 'monthly',
      amount_cents: 1490,
      status: 'active',
      started_at: '2026-09-09T00:00:00.000Z',
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
      current_period_end_billing_date: '2026-10-09',
      cancel_at_period_end: false,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
    };

    mockBillingRepo = {
      registerWebhookEvent: vi.fn().mockResolvedValue({ isDuplicate: false }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      getPlanChangeByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getPlanChangeByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockResolvedValue(currentBillingSub),
      getCustomerByProviderId: vi.fn().mockResolvedValue(null),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      getPlanChange: vi.fn().mockResolvedValue(null),
      getActiveTransitionSlot: vi.fn().mockResolvedValue(null),
      setSubscription: vi.fn().mockResolvedValue(undefined),
      saveTransaction: vi.fn().mockResolvedValue(undefined),
      getTransaction: vi.fn().mockResolvedValue(null),
      getCustomer: vi.fn().mockResolvedValue(null),
      setCustomer: vi.fn().mockResolvedValue(undefined),
      updateCustomer: vi.fn().mockResolvedValue(undefined),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
      setSubscription: vi.fn().mockResolvedValue(undefined),
    };

    mockProvider = {
      name: 'asaas',
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        providerEventId: 'evt_overdue_1',
        eventType: 'payment_overdue',
        rawEventType: 'PAYMENT_OVERDUE',
        providerPaymentId: renewalPaymentId,
        providerSubscriptionId: providerSubId,
        providerCustomerId: 'cus_test_123',
        amountCents: 1490,
        currency: 'BRL',
        paymentMethod: 'BOLETO',
        dueDate: '2026-09-08', // Mutated to yesterday by Asaas simulation
        originalDueDate: '2026-10-09', // Immutable commercial renewal boundary
        invoiceUrl,
        status: 'OVERDUE',
      }),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    const result = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(result.status).toBe('ok');
    expect(result.processed).toBe(true);

    // Sub transitions to past_due with 7-day civil grace anchored at 2026-10-09 (2026-10-16)
    expect(mockSubRepo.setSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        billing_status: 'past_due',
        grace_period_expires_billing_date: '2026-10-16',
      })
    );

    // Overdue transaction is saved with full canonical identity and boundary date
    expect(mockBillingRepo.saveTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: `asaas_${renewalPaymentId}`,
        ministry_id: ministryId,
        provider: 'asaas',
        provider_payment_id: renewalPaymentId,
        provider_subscription_id: providerSubId,
        transaction_type: 'recurring_payment',
        status: 'overdue',
        due_date: '2026-10-09', // Immutable renewal date, not yesterday!
        invoice_url: invoiceUrl,
      })
    );
  });

  it('4. Reader-Writer contract proof: resolveCurrentRenewalRecoveryInvoice successfully resolves transaction written on overdue', async () => {
    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      current_period_end_billing_date: '2026-10-09',
      current_period_end: '2026-10-09T00:00:00.000Z',
    };

    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      current_period_end: '2026-10-09T00:00:00.000Z',
    };

    // The exact transaction format written by our payment_overdue handler
    const writtenTransaction = {
      id: `asaas_${renewalPaymentId}`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_payment_id: renewalPaymentId,
      provider_subscription_id: providerSubId,
      transaction_type: 'recurring_payment',
      amount_cents: 1490,
      currency: 'BRL',
      status: 'overdue',
      due_date: '2026-10-09',
      paid_at: null,
      invoice_url: invoiceUrl,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
    };

    const { resolveCurrentRenewalRecoveryInvoice } = await import('../subscriptions/subscription.service');
    const resolvedUrl = resolveCurrentRenewalRecoveryInvoice([writtenTransaction], {
      ministryId,
      billingSub: currentBillingSub,
      subscription: currentAppSub,
      timeZone: 'America/Sao_Paulo',
    });

    expect(resolvedUrl).toBe(invoiceUrl);
  });

  it('5. True stale overdue event from older cycle is rejected by out-of-order guard', async () => {
    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'lite',
      subscription_mode: 'paid',
      billing_status: 'active',
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
    };

    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      current_period_end_billing_date: '2026-10-09',
      status: 'active',
    };

    mockBillingRepo = {
      registerWebhookEvent: vi.fn().mockResolvedValue({ isDuplicate: false }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      getPlanChangeByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getPlanChangeByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockResolvedValue(currentBillingSub),
      getCustomerByProviderId: vi.fn().mockResolvedValue(null),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      getPlanChange: vi.fn().mockResolvedValue(null),
      getActiveTransitionSlot: vi.fn().mockResolvedValue(null),
      setSubscription: vi.fn().mockResolvedValue(undefined),
      saveTransaction: vi.fn().mockResolvedValue(undefined),
      getTransaction: vi.fn().mockResolvedValue(null),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
      setSubscription: vi.fn().mockResolvedValue(undefined),
    };

    mockProvider = {
      name: 'asaas',
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        providerEventId: 'evt_old_overdue',
        eventType: 'payment_overdue',
        rawEventType: 'PAYMENT_OVERDUE',
        providerPaymentId: 'pay_august_overdue',
        providerSubscriptionId: providerSubId,
        amountCents: 1490,
        dueDate: '2026-08-01',
        originalDueDate: '2026-08-01',
        invoiceUrl: 'https://sandbox.example.invalid/i/old',
        status: 'OVERDUE',
      }),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    const result = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(result.processed).toBe(false);
    expect(result.reason).toBe('out_of_order_overdue_ignored');
    expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
      'asaas',
      'evt_old_overdue',
      'ignored',
      expect.any(String)
    );
    expect(mockSubRepo.setSubscription).not.toHaveBeenCalled();
    expect(mockBillingRepo.saveTransaction).not.toHaveBeenCalled();
  });

  it('6. Overdue event for mismatched/superseded subscription is ignored', async () => {
    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      status: 'active',
    };

    mockBillingRepo = {
      registerWebhookEvent: vi.fn().mockResolvedValue({ isDuplicate: false }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      getPlanChangeByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutIntentId: vi.fn().mockResolvedValue(null),
      getPlanChangeByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByCheckoutId: vi.fn().mockResolvedValue(null),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockResolvedValue(currentBillingSub),
      getCustomerByProviderId: vi.fn().mockResolvedValue(null),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      getPlanChange: vi.fn().mockResolvedValue(null),
      getActiveTransitionSlot: vi.fn().mockResolvedValue(null),
      setSubscription: vi.fn().mockResolvedValue(undefined),
      saveTransaction: vi.fn().mockResolvedValue(undefined),
      getTransaction: vi.fn().mockResolvedValue(null),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue({ id: ministryId, billing_status: 'active' }),
      setSubscription: vi.fn().mockResolvedValue(undefined),
    };

    mockProvider = {
      name: 'asaas',
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        providerEventId: 'evt_superseded_sub',
        eventType: 'payment_overdue',
        rawEventType: 'PAYMENT_OVERDUE',
        providerPaymentId: 'pay_other',
        providerSubscriptionId: 'sub_old_different_123',
        amountCents: 1490,
        dueDate: '2026-10-09',
        originalDueDate: '2026-10-09',
        status: 'OVERDUE',
      }),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    const result = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(result.processed).toBe(false);
    expect(result.reason).toBe('superseded_subscription_event_ignored');
    expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
      'asaas',
      'evt_superseded_sub',
      'ignored',
      expect.any(String)
    );
  });

  it('7. Future-cycle overdue regression: PAYMENT_OVERDUE for future cycle boundary does NOT mark current cycle past_due', async () => {
    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'lite',
      subscription_mode: 'paid',
      billing_status: 'active',
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
    };

    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      current_period_end_billing_date: '2026-10-09',
      status: 'active',
    };

    mockBillingRepo = {
      registerWebhookEvent: vi.fn().mockResolvedValue({ isDuplicate: false }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockResolvedValue(currentBillingSub),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      getActiveTransitionSlot: vi.fn().mockResolvedValue(null),
      saveTransaction: vi.fn().mockResolvedValue(undefined),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
      setSubscription: vi.fn().mockResolvedValue(undefined),
    };

    mockProvider = {
      name: 'asaas',
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        providerEventId: 'evt_future_overdue',
        eventType: 'payment_overdue',
        rawEventType: 'PAYMENT_OVERDUE',
        providerPaymentId: 'pay_future_overdue',
        providerSubscriptionId: providerSubId,
        amountCents: 1490,
        dueDate: '2026-11-09',
        originalDueDate: '2026-11-09', // Future cycle boundary!
        status: 'OVERDUE',
      }),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    const result = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(result.processed).toBe(false);
    expect(result.reason).toBe('future_cycle_overdue_ignored');
    expect(mockBillingRepo.markWebhookEventProcessed).toHaveBeenCalledWith(
      'asaas',
      'evt_future_overdue',
      'ignored',
      expect.stringContaining('ciclo futuro')
    );
    expect(mockSubRepo.setSubscription).not.toHaveBeenCalled();
    expect(mockBillingRepo.saveTransaction).not.toHaveBeenCalled();
  });

  it('8. Detached adjustment overdue regression: PAYMENT_OVERDUE without providerSubscriptionId does NOT mark recurring sub past_due', async () => {
    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'lite',
      subscription_mode: 'paid',
      billing_status: 'active',
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
    };

    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      current_period_end_billing_date: '2026-10-09',
      status: 'active',
    };

    mockBillingRepo = {
      registerWebhookEvent: vi.fn().mockResolvedValue({ isDuplicate: false }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      getCustomerByProviderId: vi.fn().mockResolvedValue({ ministry_id: ministryId }),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockResolvedValue(currentBillingSub),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      getActiveTransitionSlot: vi.fn().mockResolvedValue(null),
      saveTransaction: vi.fn().mockResolvedValue(undefined),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
      setSubscription: vi.fn().mockResolvedValue(undefined),
    };

    mockProvider = {
      name: 'asaas',
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      parseWebhookEvent: vi.fn().mockReturnValue({
        providerEventId: 'evt_detached_overdue',
        eventType: 'payment_overdue',
        rawEventType: 'PAYMENT_OVERDUE',
        providerPaymentId: 'pay_detached_early_adj',
        providerCustomerId: 'cus_test_123',
        providerSubscriptionId: null, // Detached adjustment!
        amountCents: 500,
        dueDate: '2026-10-09',
        originalDueDate: '2026-10-09',
        status: 'OVERDUE',
      }),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    const result = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(result.processed).toBe(false);
    expect(result.reason).toBe('unmatched_or_detached_overdue_ignored');
    expect(mockSubRepo.setSubscription).not.toHaveBeenCalled();
  });

  it('9. Customer reconciliation with settled payment: reconcileBillingSubscription calls settleOrdinaryRecurringRenewalAtomic', async () => {
    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      plan_id: 'lite',
      interval: 'monthly',
      amount_cents: 1490,
      status: 'past_due',
      current_period_end_billing_date: '2026-10-09',
    };

    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      billing_status: 'past_due',
      current_period_end: '2026-10-09T00:00:00.000Z',
    };

    mockBillingRepo = {
      getFailedSupersedes: vi.fn().mockResolvedValue([]),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      settleOrdinaryRecurringRenewalAtomic: vi.fn().mockResolvedValue({
        success: true,
        outcome: 'settled',
        transactionId: `asaas_${renewalPaymentId}`,
      }),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
    };

    mockProvider = {
      name: 'asaas',
      getSubscription: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
      listSubscriptionPayments: vi.fn().mockResolvedValue([
        {
          id: renewalPaymentId,
          subscriptionId: providerSubId,
          status: 'RECEIVED',
          amountCents: 1490,
          originalDueDate: '2026-10-09',
          dueDate: '2026-10-09',
        },
      ]),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    const result = await service.reconcileBillingSubscription(ministryId);
    expect(result.reconciled).toBe(true);
    expect(result.internalStatus).toBe('active');
    expect(mockBillingRepo.settleOrdinaryRecurringRenewalAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        ministryId,
        provider: 'asaas',
        providerPaymentId: renewalPaymentId,
        providerSubscriptionId: providerSubId,
        renewalBillingDate: '2026-10-09',
      })
    );
  });

  it('10. Customer reconciliation with unpaid payment: reconcileBillingSubscription preserves past_due when payment is OVERDUE', async () => {
    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      plan_id: 'lite',
      interval: 'monthly',
      amount_cents: 1490,
      status: 'past_due',
      current_period_end_billing_date: '2026-10-09',
    };

    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      billing_status: 'past_due',
      current_period_end: '2026-10-09T00:00:00.000Z',
    };

    mockBillingRepo = {
      getFailedSupersedes: vi.fn().mockResolvedValue([]),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      settleOrdinaryRecurringRenewalAtomic: vi.fn(),
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
    };

    mockProvider = {
      name: 'asaas',
      getSubscription: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
      listSubscriptionPayments: vi.fn().mockResolvedValue([
        {
          id: renewalPaymentId,
          subscriptionId: providerSubId,
          status: 'OVERDUE',
          amountCents: 1490,
          originalDueDate: '2026-10-09',
          dueDate: '2026-10-09',
        },
      ]),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    const result = await service.reconcileBillingSubscription(ministryId);
    expect(result.reconciled).toBe(false);
    expect(result.internalStatus).toBe('past_due');
    expect(mockBillingRepo.settleOrdinaryRecurringRenewalAtomic).not.toHaveBeenCalled();
  });

  it('11. Webhook and Reconciler convergence: both routes invoke the exact same atomic settlement engine', async () => {
    const currentBillingSub: any = {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      plan_id: 'lite',
      interval: 'monthly',
      amount_cents: 1490,
      status: 'past_due',
      current_period_end_billing_date: '2026-10-09',
    };

    const currentAppSub: any = {
      id: ministryId,
      ministry_id: ministryId,
      plan_id: 'lite',
      subscription_mode: 'paid',
      billing_status: 'past_due',
      member_addon_blocks: 0,
      current_period_end: '2026-10-09T00:00:00.000Z',
    };

    const atomicSettleMock = vi.fn().mockResolvedValue({
      success: true,
      outcome: 'settled',
      transactionId: `asaas_${renewalPaymentId}`,
    });

    mockBillingRepo = {
      registerWebhookEvent: vi.fn().mockResolvedValue({ isDuplicate: false }),
      markWebhookEventProcessed: vi.fn().mockResolvedValue(undefined),
      getFailedSupersedes: vi.fn().mockResolvedValue([]),
      getSubscriptionByProviderSubscriptionId: vi.fn().mockResolvedValue(currentBillingSub),
      getSubscription: vi.fn().mockResolvedValue(currentBillingSub),
      getActiveTransitionSlot: vi.fn().mockResolvedValue(null),
      settleOrdinaryRecurringRenewalAtomic: atomicSettleMock,
    };

    mockSubRepo = {
      getSubscription: vi.fn().mockResolvedValue(currentAppSub),
    };

    mockProvider = {
      name: 'asaas',
      validateWebhookRequest: vi.fn().mockReturnValue(true),
      getSubscription: vi.fn().mockResolvedValue({ status: 'ACTIVE' }),
      parseWebhookEvent: vi.fn().mockReturnValue({
        providerEventId: 'evt_webhook_conv',
        eventType: 'payment_confirmed',
        rawEventType: 'PAYMENT_CONFIRMED',
        providerPaymentId: renewalPaymentId,
        providerSubscriptionId: providerSubId,
        amountCents: 1490,
        currency: 'BRL',
        paymentMethod: 'CREDIT_CARD',
        dueDate: '2026-10-09',
        originalDueDate: '2026-10-09',
        status: 'CONFIRMED',
      }),
      listSubscriptionPayments: vi.fn().mockResolvedValue([
        {
          id: renewalPaymentId,
          subscriptionId: providerSubId,
          status: 'CONFIRMED',
          amountCents: 1490,
          originalDueDate: '2026-10-09',
          dueDate: '2026-10-09',
        },
      ]),
    };

    const service = new BillingService(
      mockBillingRepo as any,
      {} as any,
      mockSubRepo as any,
      {} as any,
      mockProvider as any,
      {} as any
    );

    // Route 1: Webhook delivery
    const webhookRes = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(webhookRes.processed).toBe(true);

    // Route 2: On-demand reconciliation
    const reconRes = await service.reconcileBillingSubscription(ministryId);
    expect(reconRes.reconciled).toBe(true);

    // Both converged on the single canonical atomic method
    expect(atomicSettleMock).toHaveBeenCalledTimes(2);
    expect(atomicSettleMock.mock.calls[0][0].providerPaymentId).toBe(renewalPaymentId);
    expect(atomicSettleMock.mock.calls[1][0].providerPaymentId).toBe(renewalPaymentId);
  });
});
