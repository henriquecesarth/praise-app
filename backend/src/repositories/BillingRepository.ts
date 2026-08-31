import { db } from '../lib/firebase';
import {
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingTransactionRecord,
  BillingWebhookEventRecord,
  BillingProviderName,
} from '../features/billing/billing.types';


export class BillingRepository {
  private readonly customersCollection = db.collection('billing_customers');
  private readonly subscriptionsCollection = db.collection('billing_subscriptions');
  private readonly transactionsCollection = db.collection('billing_transactions');
  private readonly webhookEventsCollection = db.collection('billing_webhook_events');

  // --------------------------------------------------------------------------
  // Customers
  // --------------------------------------------------------------------------

  async getCustomer(ministryId: string, provider: BillingProviderName): Promise<BillingCustomerRecord | null> {
    const docId = `${ministryId}_${provider}`;
    const doc = await this.customersCollection.doc(docId).get();
    if (doc.exists) {
      return doc.data() as BillingCustomerRecord;
    }
    return null;
  }

  async getCustomerByProviderId(providerCustomerId: string, provider: BillingProviderName): Promise<BillingCustomerRecord | null> {
    const snapshot = await this.customersCollection
      .where('provider', '==', provider)
      .where('provider_customer_id', '==', providerCustomerId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0].data() as BillingCustomerRecord;
    }
    return null;
  }

  async setCustomer(customer: BillingCustomerRecord): Promise<void> {
    await this.customersCollection.doc(customer.id).set(customer, { merge: true });
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  async getSubscription(ministryId: string, provider: BillingProviderName): Promise<BillingSubscriptionRecord | null> {
    const docId = `${ministryId}_${provider}`;
    const doc = await this.subscriptionsCollection.doc(docId).get();
    if (doc.exists) {
      return doc.data() as BillingSubscriptionRecord;
    }
    return null;
  }

  async getRecentPendingSubscription(
    ministryId: string,
    provider: BillingProviderName,
    planId: string,
    interval: string,
    addonBlocks: number,
    maxAgeMs: number = 15 * 60 * 1000
  ): Promise<BillingSubscriptionRecord | null> {
    const existing = await this.getSubscription(ministryId, provider);
    if (!existing || existing.status !== 'pending' || !existing.checkout_url) {
      return null;
    }

    if (
      existing.plan_id === planId &&
      existing.interval === interval &&
      (existing.member_addon_blocks || 0) === addonBlocks
    ) {
      const createdAtTime = new Date(existing.created_at || existing.updated_at).getTime();
      const ageMs = Date.now() - createdAtTime;
      if (ageMs >= 0 && ageMs < maxAgeMs) {
        return existing;
      }
    }

    return null;
  }


  async getSubscriptionByProviderSubscriptionId(
    providerSubscriptionId: string,
    provider: BillingProviderName
  ): Promise<BillingSubscriptionRecord | null> {
    const snapshot = await this.subscriptionsCollection
      .where('provider', '==', provider)
      .where('provider_subscription_id', '==', providerSubscriptionId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0].data() as BillingSubscriptionRecord;
    }
    return null;
  }

  async getSubscriptionByCheckoutId(
    providerCheckoutId: string,
    provider: BillingProviderName
  ): Promise<BillingSubscriptionRecord | null> {
    const snapshot = await this.subscriptionsCollection
      .where('provider', '==', provider)
      .where('provider_checkout_id', '==', providerCheckoutId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0].data() as BillingSubscriptionRecord;
    }
    return null;
  }

  async getSubscriptionByCheckoutIntentId(
    checkoutIntentId: string,
    provider: BillingProviderName
  ): Promise<BillingSubscriptionRecord | null> {
    const snapshot = await this.subscriptionsCollection
      .where('provider', '==', provider)
      .where('checkout_intent_id', '==', checkoutIntentId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0].data() as BillingSubscriptionRecord;
    }
    return null;
  }

  async getSubscriptionByProviderId(
    providerId: string,
    provider: BillingProviderName
  ): Promise<BillingSubscriptionRecord | null> {
    const bySub = await this.getSubscriptionByProviderSubscriptionId(providerId, provider);
    if (bySub) return bySub;

    const byChk = await this.getSubscriptionByCheckoutId(providerId, provider);
    if (byChk) return byChk;

    return await this.getSubscriptionByCheckoutIntentId(providerId, provider);
  }

  async setSubscription(subscription: BillingSubscriptionRecord): Promise<void> {
    await this.subscriptionsCollection.doc(subscription.id).set(subscription, { merge: true });
  }

  // --------------------------------------------------------------------------
  // Transactions
  // --------------------------------------------------------------------------

  async saveTransaction(transaction: BillingTransactionRecord): Promise<void> {
    await this.transactionsCollection.doc(transaction.id).set(transaction, { merge: true });
  }

  async getTransactions(ministryId: string, limitCount: number = 50): Promise<BillingTransactionRecord[]> {
    const snapshot = await this.transactionsCollection
      .where('ministry_id', '==', ministryId)
      .orderBy('created_at', 'desc')
      .limit(limitCount)
      .get();

    return snapshot.docs.map((doc: any) => doc.data() as BillingTransactionRecord);
  }

  // --------------------------------------------------------------------------
  // Webhook Events & Idempotency
  // --------------------------------------------------------------------------

  async getWebhookEvent(provider: BillingProviderName, providerEventId: string): Promise<BillingWebhookEventRecord | null> {
    const docId = `${provider}_${providerEventId}`;
    const doc = await this.webhookEventsCollection.doc(docId).get();
    if (doc.exists) {
      return doc.data() as BillingWebhookEventRecord;
    }
    return null;
  }

  /**
   * Registra o evento de webhook para controle de idempotência.
   * Retorna false se o evento já existe e está concluído/em processamento, ou true se é um evento novo.
   */
  async registerWebhookEvent(event: BillingWebhookEventRecord): Promise<{ isDuplicate: boolean; event: BillingWebhookEventRecord }> {
    const docRef = this.webhookEventsCollection.doc(event.id);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (doc.exists) {
        const existing = doc.data() as BillingWebhookEventRecord;
        return { isDuplicate: true, event: existing };
      }

      t.set(docRef, event);
      return { isDuplicate: false, event };
    });

  }


  async markWebhookEventProcessed(
    provider: BillingProviderName,
    providerEventId: string,
    status: 'processed' | 'failed' | 'ignored',
    errorMessage?: string | null
  ): Promise<void> {
    const docId = `${provider}_${providerEventId}`;
    await this.webhookEventsCollection.doc(docId).update({
      processing_status: status,
      processed_at: new Date().toISOString(),
      error_message: errorMessage || null,
    });
  }
}
