import { BillingService } from '../src/features/billing/billing.service';
import { AsaasBillingProvider } from '../src/features/billing/providers/asaas/asaas.provider';
import { BillingRepository } from '../src/repositories/BillingRepository';
import { SubscriptionService } from '../src/features/subscriptions/subscription.service';
import { SubscriptionRepository } from '../src/repositories/SubscriptionRepository';
import { MinistryRepository } from '../src/repositories/MinistryRepository';
import { getCurrentBillingDate } from '../src/utils/billing-date';
import { config } from '../src/config/unifiedConfig';

async function createRealCheckoutTimezoneFixed() {
  const ministryId = 'Cqj1xR8FK2WArZWd2BLj';
  const userId = 'XnpmlGGY6PZCRT90U0hYlLrEwjf2';

  console.log(`=== CRIANDO CHECKOUT REAL COM CORREÇÃO DE TIMEZONE PARA O MINISTÉRIO ${ministryId} ===\n`);

  const now = new Date();
  const billingTimezone = config.billingTimezone || 'America/Sao_Paulo';
  const billingLocalDate = getCurrentBillingDate(now, billingTimezone);

  console.log('--- 1. AUDITORIA DE TIMEZONE & DATAS ---');
  console.log(`Billing Timezone: ${billingTimezone}`);
  console.log(`Current UTC Instant: ${now.toISOString()}`);
  console.log(`Current Billing-Local Date: ${billingLocalDate}`);
  console.log(`nextDueDate que será enviado ao Asaas: ${billingLocalDate}`);

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

  console.log('\n--- 2. VERIFICANDO ESTADO PRÉ-CHECKOUT ---');
  const beforeSummary = await subService.getSubscriptionSummary(ministryId);
  console.log({
    planId: beforeSummary.subscription.planId,
    subscriptionMode: beforeSummary.subscription.subscriptionMode,
    billingStatus: beforeSummary.subscription.billingStatus,
    quotas: beforeSummary.quotas,
  });

  console.log('\n--- 3. EXECUTANDO BillingService.createCheckout ---');
  const result = await billingService.createCheckout(ministryId, userId, {
    planId: 'lite',
    interval: 'monthly',
    addonBlocks: 0,
  });

  console.log('\n✅ NOVO CHECKOUT CRIADO COM SUCESSO NO ASAAS SANDBOX!');
  console.log(JSON.stringify(result, null, 2));

  console.log('\n--- 4. VERIFICANDO ESTADO PÓS-CRIAÇÃO (DEVE PERMANECER FREE) ---');
  const afterSummary = await subService.getSubscriptionSummary(ministryId);
  console.log({
    planId: afterSummary.subscription.planId,
    subscriptionMode: afterSummary.subscription.subscriptionMode,
    billingStatus: afterSummary.subscription.billingStatus,
    quotas: afterSummary.quotas,
  });

  console.log('\n--- 5. REGISTRO DE BILLING_SUBSCRIPTION PERSISTIDO ---');
  const billingSub = await billingRepo.getSubscription(ministryId, 'asaas');
  console.log(JSON.stringify(billingSub, null, 2));
}

createRealCheckoutTimezoneFixed().catch(console.error);
