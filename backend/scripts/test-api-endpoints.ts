import { SubscriptionService } from '../src/features/subscriptions/subscription.service';
import { BillingService } from '../src/features/billing/billing.service';
import { AsaasBillingProvider } from '../src/features/billing/providers/asaas/asaas.provider';
import { BillingRepository } from '../src/repositories/BillingRepository';
import { SubscriptionRepository } from '../src/repositories/SubscriptionRepository';
import { MinistryRepository } from '../src/repositories/MinistryRepository';
import { config } from '../src/config/unifiedConfig';

async function testEndpoints() {
  const ministryId = '9lxhjzz3OV1JrqTV6B3q';
  console.log(`=== TESTANDO ENDPOINTS DE SUBSCRIPTION & BILLING PARA ${ministryId} ===\n`);

  const subService = new SubscriptionService();
  const billingRepo = new BillingRepository();
  const subRepo = new SubscriptionRepository();
  const minRepo = new MinistryRepository();
  const provider = new AsaasBillingProvider();

  const billingService = new BillingService(billingRepo, subService, subRepo, minRepo, provider);

  // 1. Subscription Summary (GET /api/v1/ministries/:ministryId/subscription)
  console.log('--- 1. GET /subscription ---');
  const summary = await subService.getSubscriptionSummary(ministryId);
  console.log(JSON.stringify(summary, null, 2));

  // 2. Billing History (GET /api/v1/ministries/:ministryId/billing/history)
  console.log('\n--- 2. GET /billing/history ---');
  try {
    const history = await billingService.getBillingHistory(ministryId);
    console.log(`✅ Sucesso! Transações encontradas: ${history.length}`);
    console.log(JSON.stringify(history, null, 2));
  } catch (err: any) {
    console.error('❌ Erro em getBillingHistory:', err.message);
  }
}

testEndpoints().catch(console.error);
