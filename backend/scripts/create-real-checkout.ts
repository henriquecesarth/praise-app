import { BillingService } from '../src/features/billing/billing.service';
import { AsaasBillingProvider } from '../src/features/billing/providers/asaas/asaas.provider';
import { BillingRepository } from '../src/repositories/BillingRepository';
import { SubscriptionService } from '../src/features/subscriptions/subscription.service';
import { SubscriptionRepository } from '../src/repositories/SubscriptionRepository';
import { MinistryRepository } from '../src/repositories/MinistryRepository';
import { config } from '../src/config/unifiedConfig';

async function createRealCheckout() {
  const ministryId = '5kL2qssw4PCi2irzC25X';
  console.log(`=== CRIANDO CHECKOUT REAL NO ASAAS SANDBOX PARA MINISTÉRIO ${ministryId} ===\n`);

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

  console.log('1. Verificando estado ANTES do checkout...');
  const beforeSummary = await subService.getSubscriptionSummary(ministryId);
  console.log({
    planId: beforeSummary.subscription.planId,
    subscriptionMode: beforeSummary.subscription.subscriptionMode,
    billingStatus: beforeSummary.subscription.billingStatus,
    quotas: beforeSummary.quotas,
  });

  const userId = 'M6zNUvylOOPylVOdzjzJS18VIJl1';
  console.log('\n2. Chamando BillingService.createCheckout...');
  const result = await billingService.createCheckout(ministryId, userId, {
    planId: 'lite',
    interval: 'monthly',
    addonBlocks: 0,
  });

  console.log('\n✅ CHECKOUT CRIADO COM SUCESSO NO ASAAS SANDBOX!');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n3. Verificando estado APÓS criação do checkout (deve permanecer FREE)...');
  const afterSummary = await subService.getSubscriptionSummary(ministryId);
  console.log({
    planId: afterSummary.subscription.planId,
    subscriptionMode: afterSummary.subscription.subscriptionMode,
    billingStatus: afterSummary.subscription.billingStatus,
    quotas: afterSummary.quotas,
  });

  console.log('\n4. Verificando registro de billing_subscription persistido...');
  const billingSub = await billingRepo.getSubscription(ministryId, 'asaas');
  console.log(JSON.stringify(billingSub, null, 2));
}

createRealCheckout().catch(console.error);
