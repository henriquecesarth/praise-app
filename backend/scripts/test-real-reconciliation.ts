import { BillingService } from '../src/features/billing/billing.service';
import { AsaasBillingProvider } from '../src/features/billing/providers/asaas/asaas.provider';
import { BillingRepository } from '../src/repositories/BillingRepository';
import { SubscriptionService } from '../src/features/subscriptions/subscription.service';
import { SubscriptionRepository } from '../src/repositories/SubscriptionRepository';
import { MinistryRepository } from '../src/repositories/MinistryRepository';
import { config } from '../src/config/unifiedConfig';

async function testReconcile() {
  const ministryId = 'Cqj1xR8FK2WArZWd2BLj';
  console.log(`=== TESTANDO RECONCILIAÇÃO REAL COM ASAAS PARA O MINISTÉRIO ${ministryId} ===\n`);

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

  console.log('1. Executando reconcileBillingSubscription...');
  const reconcileResult = await billingService.reconcileBillingSubscription(ministryId);
  console.log('Resultado da reconciliação:');
  console.log(JSON.stringify(reconcileResult, null, 2));

  console.log('\n2. Verificando estado do entitlement após reconciliação...');
  const summary = await subService.getSubscriptionSummary(ministryId);
  console.log(JSON.stringify(summary, null, 2));

  console.log('\n3. Verificando registro em billing_subscriptions...');
  const billingSub = await billingRepo.getSubscription(ministryId, 'asaas');
  console.log({
    ministry_id: billingSub?.ministry_id,
    plan_id: billingSub?.plan_id,
    status: billingSub?.status,
    provider_checkout_id: billingSub?.provider_checkout_id,
    provider_subscription_id: billingSub?.provider_subscription_id,
    checkout_id_not_equals_sub_id: billingSub?.provider_checkout_id !== billingSub?.provider_subscription_id,
  });
}

testReconcile().catch(console.error);
