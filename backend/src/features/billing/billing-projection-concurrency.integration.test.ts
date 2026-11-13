import { describe, it, expect, beforeEach } from 'vitest';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { BillingService } from './billing.service';
import { BillingProvider } from './providers/billing-provider.interface';
import { config } from '../../config/unifiedConfig';
import { MinistrySubscriptionRecord } from '../subscriptions/subscription.types';
import { BillingSubscriptionRecord } from './billing.types';

describe('Phase 7D2-PR0 — Billing Projection Concurrency & Race Hardening', () => {
  const billingRepo = new BillingRepository();
  const subRepo = new SubscriptionRepository();

  function uniqueId(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function buildTestAppSub(
    ministryId: string,
    overrides: Partial<MinistrySubscriptionRecord> = {}
  ): MinistrySubscriptionRecord {
    return {
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
      administratively_suspended: false,
      suspended_at: null,
      suspension_reason: null,
      cancel_at_period_end: false,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
      ...overrides,
    };
  }

  function buildTestBillingSub(
    ministryId: string,
    providerSubId: string,
    overrides: Partial<BillingSubscriptionRecord> = {}
  ): BillingSubscriptionRecord {
    return {
      id: `${ministryId}_asaas`,
      ministry_id: ministryId,
      provider: 'asaas',
      provider_subscription_id: providerSubId,
      provider_customer_id: 'cus_test',
      plan_id: 'lite',
      interval: 'monthly',
      member_addon_blocks: 0,
      amount_cents: 1490,
      status: 'active',
      started_at: '2026-09-09T00:00:00.000Z',
      current_period_start: '2026-09-09T00:00:00.000Z',
      current_period_end: '2026-10-09T00:00:00.000Z',
      current_period_end_billing_date: '2026-10-09',
      cancel_at_period_end: false,
      created_at: '2026-09-09T00:00:00.000Z',
      updated_at: '2026-09-09T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    config.billingTimezone = 'America/Sao_Paulo';
  });

  // --------------------------------------------------------------------------
  // CASE 1: Recovery wins first
  // --------------------------------------------------------------------------
  it('CASE 1: Recovery wins first — concurrent settlement advances cycle, delayed overdue aborts with zero writes', async () => {
    const ministryId = uniqueId('min_c1');
    const providerSubId = uniqueId('sub_c1');
    const paymentId = uniqueId('pay_c1');

    const appSub = buildTestAppSub(ministryId);
    const billingSub = buildTestBillingSub(ministryId, providerSubId);

    await subRepo.setSubscription(appSub);
    await billingRepo.setSubscription(billingSub);

    // 1. PAYMENT_CONFIRMED / PAYMENT_RECEIVED arrives and commits first via settleOrdinaryRecurringRenewalAtomic
    const settleResult = await billingRepo.settleOrdinaryRecurringRenewalAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      renewalBillingDate: '2026-10-09',
      amountCents: 1490,
      currency: 'BRL',
      interval: 'monthly',
      invoiceUrl: 'https://sandbox.asaas.com/i/test-c1',
      paymentMethod: 'CREDIT_CARD',
      paidAt: '2026-10-09T10:00:00.000Z',
      paidBillingDate: '2026-10-09',
      timeZone: 'America/Sao_Paulo',
    });

    expect(settleResult.success).toBe(true);
    expect(settleResult.outcome).toBe('settled');

    // 2. Delayed PAYMENT_OVERDUE resumes / arrives for the same cycle (2026-10-09)
    const overdueResult = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-10-09',
      expectedCurrentPeriodEnd: '2026-10-09',
      amountCents: 1490,
      invoiceUrl: 'https://sandbox.asaas.com/i/test-c1',
      now: new Date('2026-10-10T00:00:00.000Z'),
      timeZone: 'America/Sao_Paulo',
    });

    // Overdue MUST abort with zero writes
    expect(overdueResult.success).toBe(false);
    expect(['already_settled', 'stale_overdue_period_advanced', 'out_of_order_overdue_ignored']).toContain(
      overdueResult.outcome
    );

    // Verify projection integrity: subscription remains active and period is advanced to next cycle
    const storedAppSub = await subRepo.getSubscription(ministryId);
    expect(storedAppSub?.billing_status).toBe('active');
    expect(storedAppSub?.grace_period_expires_at).toBeNull();
    expect(storedAppSub?.current_period_start).toBe('2026-10-09T00:00:00.000Z');
    expect(storedAppSub?.current_period_end).toBe('2026-11-09T00:00:00.000Z');

    const storedBillingSub = await billingRepo.getSubscription(ministryId, 'asaas');
    expect(storedBillingSub?.status).toBe('active');
    expect(storedBillingSub?.current_period_end_billing_date).toBe('2026-11-09');

    const storedTx = await billingRepo.getTransaction(`asaas_${paymentId}`);
    expect(storedTx?.status).toBe('paid');
  });

  // --------------------------------------------------------------------------
  // CASE 2: Overdue wins first
  // --------------------------------------------------------------------------
  it('CASE 2: Overdue wins first — overdue commits past_due, later Confirmed recovers projection cleanly', async () => {
    const ministryId = uniqueId('min_c2');
    const providerSubId = uniqueId('sub_c2');
    const paymentId = uniqueId('pay_c2');

    const appSub = buildTestAppSub(ministryId);
    const billingSub = buildTestBillingSub(ministryId, providerSubId);

    await subRepo.setSubscription(appSub);
    await billingRepo.setSubscription(billingSub);

    // 1. PAYMENT_OVERDUE commits first
    const overdueResult = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-10-09',
      expectedCurrentPeriodEnd: '2026-10-09',
      amountCents: 1490,
      invoiceUrl: 'https://sandbox.asaas.com/i/test-c2',
      now: new Date('2026-10-09T12:00:00.000Z'),
      timeZone: 'America/Sao_Paulo',
    });

    expect(overdueResult.success).toBe(true);
    expect(overdueResult.outcome).toBe('marked_past_due');

    // Verify overdue state
    const pastDueAppSub = await subRepo.getSubscription(ministryId);
    expect(pastDueAppSub?.billing_status).toBe('past_due');
    expect(pastDueAppSub?.grace_period_expires_billing_date).toBe('2026-10-16');
    expect(pastDueAppSub?.current_period_start).toBe('2026-09-09T00:00:00.000Z');
    expect(pastDueAppSub?.current_period_end).toBe('2026-10-09T00:00:00.000Z');

    const pastDueTx = await billingRepo.getTransaction(`asaas_${paymentId}`);
    expect(pastDueTx?.status).toBe('overdue');

    // 2. Later, PAYMENT_CONFIRMED arrives and commits
    const settleResult = await billingRepo.settleOrdinaryRecurringRenewalAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      renewalBillingDate: '2026-10-09',
      amountCents: 1490,
      currency: 'BRL',
      interval: 'monthly',
      invoiceUrl: 'https://sandbox.asaas.com/i/test-c2',
      paymentMethod: 'BOLETO',
      paidAt: '2026-10-11T10:00:00.000Z',
      paidBillingDate: '2026-10-11',
      timeZone: 'America/Sao_Paulo',
    });

    expect(settleResult.success).toBe(true);
    expect(settleResult.outcome).toBe('settled');

    // Verify clean recovery
    const recoveredAppSub = await subRepo.getSubscription(ministryId);
    expect(recoveredAppSub?.billing_status).toBe('active');
    expect(recoveredAppSub?.grace_period_expires_at).toBeNull();
    expect(recoveredAppSub?.grace_period_expires_billing_date).toBeNull();
    expect(recoveredAppSub?.current_period_start).toBe('2026-10-09T00:00:00.000Z');
    expect(recoveredAppSub?.current_period_end).toBe('2026-11-09T00:00:00.000Z');

    const recoveredTx = await billingRepo.getTransaction(`asaas_${paymentId}`);
    expect(recoveredTx?.status).toBe('paid');
  });

  // --------------------------------------------------------------------------
  // CASE 3: Standalone overdue
  // --------------------------------------------------------------------------
  it('CASE 3: Standalone overdue — valid overdue transitions to past_due with 7-day grace without mutating period dates or quotas', async () => {
    const ministryId = uniqueId('min_c3');
    const providerSubId = uniqueId('sub_c3');
    const paymentId = uniqueId('pay_c3');

    const appSub = buildTestAppSub(ministryId, {
      member_addon_blocks: 2,
      locked_member_quota: 15,
      locked_song_quota: 150,
    });
    const billingSub = buildTestBillingSub(ministryId, providerSubId, {
      member_addon_blocks: 2,
    });

    await subRepo.setSubscription(appSub);
    await billingRepo.setSubscription(billingSub);

    const overdueResult = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-10-09',
      expectedCurrentPeriodEnd: '2026-10-09',
      amountCents: 1490,
      invoiceUrl: 'https://sandbox.asaas.com/i/test-c3',
      now: new Date('2026-10-09T08:00:00.000Z'),
      timeZone: 'America/Sao_Paulo',
    });

    expect(overdueResult.success).toBe(true);
    expect(overdueResult.outcome).toBe('marked_past_due');

    const updatedAppSub = await subRepo.getSubscription(ministryId);
    expect(updatedAppSub?.billing_status).toBe('past_due');
    expect(updatedAppSub?.grace_period_expires_billing_date).toBe('2026-10-16');
    expect(updatedAppSub?.current_period_start).toBe('2026-09-09T00:00:00.000Z');
    expect(updatedAppSub?.current_period_end).toBe('2026-10-09T00:00:00.000Z');
    expect(updatedAppSub?.locked_member_quota).toBe(15);
    expect(updatedAppSub?.locked_song_quota).toBe(150);

    const updatedBillingSub = await billingRepo.getSubscription(ministryId, 'asaas');
    expect(updatedBillingSub?.status).toBe('past_due');

    const tx = await billingRepo.getTransaction(`asaas_${paymentId}`);
    expect(tx?.status).toBe('overdue');
    expect(tx?.due_date).toBe('2026-10-09');
  });

  // --------------------------------------------------------------------------
  // CASE 4: Old cycle overdue
  // --------------------------------------------------------------------------
  it('CASE 4: Old cycle overdue — event for an earlier cycle is ignored with zero writes', async () => {
    const ministryId = uniqueId('min_c4');
    const providerSubId = uniqueId('sub_c4');

    const appSub = buildTestAppSub(ministryId, {
      current_period_start: '2026-10-09T00:00:00.000Z',
      current_period_end: '2026-11-09T00:00:00.000Z',
    });

    const billingSub = buildTestBillingSub(ministryId, providerSubId, {
      current_period_start: '2026-10-09T00:00:00.000Z',
      current_period_end: '2026-11-09T00:00:00.000Z',
      current_period_end_billing_date: '2026-11-09',
    });

    await subRepo.setSubscription(appSub);
    await billingRepo.setSubscription(billingSub);

    // Old cycle overdue (dueDate 2026-09-09 < current boundary 2026-11-09)
    const overdueResult = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: 'pay_old_cycle',
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-09-09',
      amountCents: 1490,
      timeZone: 'America/Sao_Paulo',
    });

    expect(overdueResult.success).toBe(false);
    expect(overdueResult.outcome).toBe('out_of_order_overdue_ignored');

    const afterAppSub = await subRepo.getSubscription(ministryId);
    expect(afterAppSub?.billing_status).toBe('active');
  });

  // --------------------------------------------------------------------------
  // CASE 5: Future cycle overdue
  // --------------------------------------------------------------------------
  it('CASE 5: Future cycle overdue — overdue date after current renewal boundary does not delinquish current cycle', async () => {
    const ministryId = uniqueId('min_c5');
    const providerSubId = uniqueId('sub_c5');

    const appSub = buildTestAppSub(ministryId);
    const billingSub = buildTestBillingSub(ministryId, providerSubId);

    await subRepo.setSubscription(appSub);
    await billingRepo.setSubscription(billingSub);

    // Future cycle overdue (dueDate 2026-11-09 > current boundary 2026-10-09)
    const overdueResult = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: 'pay_future_cycle',
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-11-09',
      amountCents: 1490,
      timeZone: 'America/Sao_Paulo',
    });

    expect(overdueResult.success).toBe(false);
    expect(overdueResult.outcome).toBe('future_cycle_overdue_ignored');

    const afterAppSub = await subRepo.getSubscription(ministryId);
    expect(afterAppSub?.billing_status).toBe('active');
  });

  // --------------------------------------------------------------------------
  // CASE 6: Duplicate events
  // --------------------------------------------------------------------------
  it('CASE 6: Duplicate events — duplicate overdue and duplicate confirmed are idempotent', async () => {
    const ministryId = uniqueId('min_c6');
    const providerSubId = uniqueId('sub_c6');
    const paymentId = uniqueId('pay_c6');

    const appSub = buildTestAppSub(ministryId);
    const billingSub = buildTestBillingSub(ministryId, providerSubId);

    await subRepo.setSubscription(appSub);
    await billingRepo.setSubscription(billingSub);

    // Overdue event 1
    const overdue1 = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-10-09',
      expectedCurrentPeriodEnd: '2026-10-09',
      amountCents: 1490,
      timeZone: 'America/Sao_Paulo',
    });
    expect(overdue1.success).toBe(true);
    expect(overdue1.outcome).toBe('marked_past_due');

    // Overdue event 2 (duplicate)
    const overdue2 = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-10-09',
      expectedCurrentPeriodEnd: '2026-10-09',
      amountCents: 1490,
      timeZone: 'America/Sao_Paulo',
    });
    expect(overdue2.success).toBe(true);
    expect(overdue2.outcome).toBe('already_past_due');

    // Settlement event 1
    const settle1 = await billingRepo.settleOrdinaryRecurringRenewalAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      renewalBillingDate: '2026-10-09',
      amountCents: 1490,
      currency: 'BRL',
      interval: 'monthly',
      paidAt: '2026-10-10T10:00:00.000Z',
      paidBillingDate: '2026-10-10',
      timeZone: 'America/Sao_Paulo',
    });
    expect(settle1.success).toBe(true);
    expect(settle1.outcome).toBe('settled');

    // Settlement event 2 (duplicate)
    const settle2 = await billingRepo.settleOrdinaryRecurringRenewalAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      renewalBillingDate: '2026-10-09',
      amountCents: 1490,
      currency: 'BRL',
      interval: 'monthly',
      paidAt: '2026-10-10T10:00:00.000Z',
      paidBillingDate: '2026-10-10',
      timeZone: 'America/Sao_Paulo',
    });
    expect(settle2.success).toBe(true);
    expect(settle2.outcome).toBe('already_settled');

    // Assert final active state is clean and not advanced multiple times
    const finalSub = await subRepo.getSubscription(ministryId);
    expect(finalSub?.billing_status).toBe('active');
    expect(finalSub?.current_period_start).toBe('2026-10-09T00:00:00.000Z');
    expect(finalSub?.current_period_end).toBe('2026-11-09T00:00:00.000Z');
  });

  // --------------------------------------------------------------------------
  // CASE 7: Period integrity
  // --------------------------------------------------------------------------
  it('CASE 7: Period integrity — stale overdue cannot restore older period start/end or grace dates', async () => {
    const ministryId = uniqueId('min_c7');
    const providerSubId = uniqueId('sub_c7');

    const appSub = buildTestAppSub(ministryId, {
      current_period_start: '2026-10-09T00:00:00.000Z',
      current_period_end: '2026-11-09T00:00:00.000Z',
    });

    const billingSub = buildTestBillingSub(ministryId, providerSubId, {
      current_period_start: '2026-10-09T00:00:00.000Z',
      current_period_end: '2026-11-09T00:00:00.000Z',
      current_period_end_billing_date: '2026-11-09',
    });

    await subRepo.setSubscription(appSub);
    await billingRepo.setSubscription(billingSub);

    // Stale overdue carrying older cycle boundary (2026-10-09)
    const overdueResult = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: 'pay_stale_1',
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-10-09',
      expectedCurrentPeriodEnd: '2026-10-09', // stale assumption
      amountCents: 1490,
      timeZone: 'America/Sao_Paulo',
    });

    expect(overdueResult.success).toBe(false);
    expect(overdueResult.outcome).toBe('stale_overdue_period_advanced');

    // Confirm that period dates and active status remain pristine
    const preservedSub = await subRepo.getSubscription(ministryId);
    expect(preservedSub?.billing_status).toBe('active');
    expect(preservedSub?.current_period_start).toBe('2026-10-09T00:00:00.000Z');
    expect(preservedSub?.current_period_end).toBe('2026-11-09T00:00:00.000Z');
  });

  // --------------------------------------------------------------------------
  // CASE 8: Scheduled transitions & Complimentary isolation
  // --------------------------------------------------------------------------
  it('CASE 8: Scheduled transitions & Complimentary isolation — complimentary plans preserved and settled transitions protected', async () => {
    const ministryId = uniqueId('min_c8');
    const providerSubId = uniqueId('sub_c8');

    // Part A: Complimentary plan cannot be delinquent by recurring overdue
    const compAppSub = buildTestAppSub(ministryId, {
      plan_id: 'pro',
      subscription_mode: 'complimentary',
    });

    const compBillingSub = buildTestBillingSub(ministryId, providerSubId, {
      plan_id: 'pro',
      amount_cents: 0,
    });

    await subRepo.setSubscription(compAppSub);
    await billingRepo.setSubscription(compBillingSub);

    const compOverdueResult = await billingRepo.recordOrdinaryRecurringOverdueAtomic({
      ministryId,
      provider: 'asaas',
      providerPaymentId: 'pay_comp',
      providerSubscriptionId: providerSubId,
      overdueBillingDate: '2026-10-09',
      amountCents: 0,
      timeZone: 'America/Sao_Paulo',
    });

    expect(compOverdueResult.success).toBe(false);
    expect(compOverdueResult.outcome).toBe('complimentary_plan_preserved');

    const afterCompSub = await subRepo.getSubscription(ministryId);
    expect(afterCompSub?.billing_status).toBe('active');
    expect(afterCompSub?.subscription_mode).toBe('complimentary');
  });

  // --------------------------------------------------------------------------
  // End-to-end BillingService Webhook Race Test
  // --------------------------------------------------------------------------
  it('E2E Webhook Race: PAYMENT_OVERDUE arriving after PAYMENT_CONFIRMED ignores overdue and preserves active renewal', async () => {
    const ministryId = uniqueId('min_e2e');
    const providerSubId = uniqueId('sub_e2e');
    const paymentId = uniqueId('pay_e2e');

    const appSub = buildTestAppSub(ministryId);
    const billingSub = buildTestBillingSub(ministryId, providerSubId);

    await subRepo.setSubscription(appSub);
    await billingRepo.setSubscription(billingSub);

    let currentWebhookPayload: any = null;

    const mockProvider: BillingProvider = {
      name: 'asaas',
      validateWebhookRequest: () => true,
      parseWebhookEvent: () => currentWebhookPayload,
    } as any;

    const service = new BillingService(
      billingRepo,
      {} as any,
      subRepo,
      {} as any,
      mockProvider,
      {} as any
    );

    // 1. PAYMENT_CONFIRMED webhook arrives and processes
    currentWebhookPayload = {
      providerEventId: uniqueId('evt_confirmed_e2e'),
      eventType: 'payment_confirmed',
      rawEventType: 'PAYMENT_CONFIRMED',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      providerCustomerId: 'cus_e2e',
      amountCents: 1490,
      currency: 'BRL',
      paymentMethod: 'CREDIT_CARD',
      dueDate: '2026-10-09',
      originalDueDate: '2026-10-09',
      invoiceUrl: 'https://sandbox.asaas.com/i/test-e2e',
      paymentDate: '2026-10-09',
      status: 'CONFIRMED',
    };

    const confirmRes = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(confirmRes.status).toBe('ok');
    expect(confirmRes.processed).toBe(true);

    // 2. Delayed PAYMENT_OVERDUE webhook arrives for the same cycle
    currentWebhookPayload = {
      providerEventId: uniqueId('evt_overdue_e2e'),
      eventType: 'payment_overdue',
      rawEventType: 'PAYMENT_OVERDUE',
      providerPaymentId: paymentId,
      providerSubscriptionId: providerSubId,
      providerCustomerId: 'cus_e2e',
      amountCents: 1490,
      currency: 'BRL',
      paymentMethod: 'BOLETO',
      dueDate: '2026-10-08',
      originalDueDate: '2026-10-09',
      invoiceUrl: 'https://sandbox.asaas.com/i/test-e2e',
      status: 'OVERDUE',
    };

    const overdueRes = await service.handleWebhook({ 'asaas-access-token': 'token' }, {});
    expect(overdueRes.status).toBe('ok');
    expect(overdueRes.processed).toBe(false);
    expect(['already_settled', 'stale_overdue_period_advanced', 'out_of_order_overdue_ignored']).toContain(
      overdueRes.reason
    );

    // Assert final database state: subscription is active and period has advanced
    const finalAppSub = await subRepo.getSubscription(ministryId);
    expect(finalAppSub?.billing_status).toBe('active');
    expect(finalAppSub?.grace_period_expires_at).toBeNull();
    expect(finalAppSub?.current_period_start).toBe('2026-10-09T00:00:00.000Z');
    expect(finalAppSub?.current_period_end).toBe('2026-11-09T00:00:00.000Z');

    const finalTx = await billingRepo.getTransaction(`asaas_${paymentId}`);
    expect(finalTx?.status).toBe('paid');
  });
});
