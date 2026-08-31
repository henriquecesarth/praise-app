import { db } from '../src/lib/firebase';
import { SubscriptionService } from '../src/features/subscriptions/subscription.service';

async function listMinistries() {
  console.log('=== LISTAGEM DE MINISTÉRIOS DISPONÍVEIS ===\n');
  const snapshot = await db.collection('ministries').get();
  const subService = new SubscriptionService();

  for (const doc of snapshot.docs) {
    const minData = doc.data();
    const summary = await subService.getSubscriptionSummary(doc.id);
    console.log(`Ministry ID: ${doc.id}`);
    console.log(`Nome: ${minData.name}`);
    console.log(`Plan ID: ${summary.subscription.planId}`);
    console.log(`Subscription Mode: ${summary.subscription.subscriptionMode}`);
    console.log(`Billing Status: ${summary.subscription.billingStatus}`);
    console.log(`Quotas: members=${summary.quotas.members}, songs=${summary.quotas.songs}`);
    console.log('----------------------------------------------------');
  }
}

listMinistries().catch(console.error);
