import { BillingService } from '../src/features/billing/billing.service';
import { AsaasBillingProvider } from '../src/features/billing/providers/asaas/asaas.provider';
import { BillingRepository } from '../src/repositories/BillingRepository';
import { SubscriptionService } from '../src/features/subscriptions/subscription.service';
import { SubscriptionRepository } from '../src/repositories/SubscriptionRepository';
import { MinistryRepository } from '../src/repositories/MinistryRepository';
import { config } from '../src/config/unifiedConfig';

async function testRealEventFlow() {
  console.log('=== TESTE DO FLUXO DE EVENTOS REAIS ===\n');

  const provider = new AsaasBillingProvider({
    apiUrl: config.asaas.apiUrl,
    apiKey: config.asaas.apiKey,
    webhookToken: config.asaas.webhookToken,
  });

  const billingRepo = new BillingRepository();
  const subService = new SubscriptionService();
  const subRepo = new SubscriptionRepository();
  const minRepo = new MinistryRepository();

  const billingService = new BillingService(
    billingRepo,
    subService,
    subRepo,
    minRepo,
    provider
  );

  const webhookHeaders = {
    'asaas-access-token': config.asaas.webhookToken,
  };

  // 1. Processar evento SUBSCRIPTION_CREATED com payload real do Asaas
  console.log('--- 1. PROCESSANDO SUBSCRIPTION_CREATED REAL ---');
  const subCreatedPayload = {
    id: 'evt_sim_sub_created_real_1',
    event: 'SUBSCRIPTION_CREATED',
    dateCreated: '2026-08-30 15:59:11',
    subscription: {
      object: 'subscription',
      id: 'sub_2hqxmkyrm88jwkd3',
      dateCreated: '2026-08-30',
      customer: 'cus_000008945616',
      paymentLink: null,
      value: 14.9,
      nextDueDate: '2026-09-29',
      cycle: 'MONTHLY',
      description: null,
      billingType: 'CREDIT_CARD',
      deleted: false,
      status: 'ACTIVE',
      externalReference: null,
      checkoutSession: 'e6cf65eb-b5ff-4a40-8844-ce75cac5cb25',
    },
  };

  const res1 = await billingService.handleWebhook(webhookHeaders, subCreatedPayload);
  console.log('Resultado SUBSCRIPTION_CREATED:', JSON.stringify(res1, null, 2));

  // Verificar se o billing_subscription atualizou com provider_subscription_id real
  const updatedSub = await billingRepo.getSubscription('9lxhjzz3OV1JrqTV6B3q', 'asaas');
  console.log('Billing Subscription após SUBSCRIPTION_CREATED:');
  console.log({
    ministry_id: updatedSub?.ministry_id,
    provider_checkout_id: updatedSub?.provider_checkout_id,
    provider_subscription_id: updatedSub?.provider_subscription_id,
    provider_customer_id: updatedSub?.provider_customer_id,
    status: updatedSub?.status,
  });

  // 2. Processar evento PAYMENT_CONFIRMED real
  console.log('\n--- 2. PROCESSANDO PAYMENT_CONFIRMED REAL ---');
  const paymentConfirmedPayload = {
    id: 'evt_sim_pay_confirmed_real_1',
    event: 'PAYMENT_CONFIRMED',
    dateCreated: '2026-08-30 15:59:12',
    payment: {
      object: 'payment',
      id: 'pay_r62mo35mgzjuwy0f',
      dateCreated: '2026-08-30',
      customer: 'cus_000008945616',
      subscription: 'sub_2hqxmkyrm88jwkd3',
      checkoutSession: 'e6cf65eb-b5ff-4a40-8844-ce75cac5cb25',
      value: 14.9,
      netValue: 14.12,
      billingType: 'CREDIT_CARD',
      status: 'CONFIRMED',
      dueDate: '2026-08-30',
      confirmedDate: '2026-08-30',
      invoiceUrl: 'https://sandbox.asaas.com/i/r62mo35mgzjuwy0f',
    },
  };

  const res2 = await billingService.handleWebhook(webhookHeaders, paymentConfirmedPayload);
  console.log('Resultado PAYMENT_CONFIRMED:', JSON.stringify(res2, null, 2));

  // 3. Verificar Entitlement e Quotas no SubscriptionService
  console.log('\n--- 3. VERIFICANDO ENTITLEMENT E QUOTAS ---');
  const summary = await subService.getSubscriptionSummary('9lxhjzz3OV1JrqTV6B3q');
  console.log('Summary da assinatura do Ministério 9lxhjzz3OV1JrqTV6B3q:');
  console.log(JSON.stringify(summary, null, 2));

  // 4. Testar reconciliação com o Asaas Sandbox
  console.log('\n--- 4. TESTANDO RECONCILIAÇÃO REAL COM ASAAS ---');
  const reconcileRes = await billingService.reconcileBillingSubscription('9lxhjzz3OV1JrqTV6B3q');
  console.log('Resultado da reconciliação:');
  console.log(JSON.stringify(reconcileRes, null, 2));

  // 5. Testar Idempotência (reenvio do mesmo webhook)
  console.log('\n--- 5. TESTANDO IDEMPOTÊNCIA DO WEBHOOK ---');
  const duplicateRes = await billingService.handleWebhook(webhookHeaders, paymentConfirmedPayload);
  console.log('Resultado do reenvio duplicado:', JSON.stringify(duplicateRes, null, 2));
}

testRealEventFlow().catch(console.error);
