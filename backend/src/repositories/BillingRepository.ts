import { db } from '../lib/firebase';
import {
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingPlanChangeRecord,
  BillingTransactionRecord,
  BillingWebhookEventRecord,
  BillingProviderName,
} from '../features/billing/billing.types';


export class BillingRepository {
  private readonly customersCollection = db.collection('billing_customers');
  private readonly subscriptionsCollection = db.collection('billing_subscriptions');
  private readonly planChangesCollection = db.collection('billing_plan_changes');
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
  // Plan Changes & Transitions (Lifecycle Isolation)
  // --------------------------------------------------------------------------

  async getPlanChange(id: string): Promise<BillingPlanChangeRecord | null> {
    const doc = await this.planChangesCollection.doc(id).get();
    if (doc.exists) {
      return doc.data() as BillingPlanChangeRecord;
    }
    return null;
  }

  async setPlanChange(record: BillingPlanChangeRecord): Promise<void> {
    await this.planChangesCollection.doc(record.id).set(record, { merge: true });
  }

  async getRecentPendingPlanChange(
    ministryId: string,
    provider: BillingProviderName,
    planId: string,
    interval: string,
    addonBlocks: number,
    maxAgeMs: number = 15 * 60 * 1000
  ): Promise<BillingPlanChangeRecord | null> {
    const snapshot = await this.planChangesCollection
      .where('ministry_id', '==', ministryId)
      .where('provider', '==', provider)
      .where('status', '==', 'pending')
      .limit(5)
      .get();

    if (snapshot.empty) {
      return null;
    }

    for (const doc of snapshot.docs) {
      const record = doc.data() as BillingPlanChangeRecord;
      if (
        record.requested_plan_id === planId &&
        record.requested_interval === interval &&
        (record.requested_addon_blocks || 0) === addonBlocks &&
        record.checkout_url
      ) {
        const createdAtTime = new Date(record.created_at || record.updated_at).getTime();
        const ageMs = Date.now() - createdAtTime;
        if (ageMs >= 0 && ageMs < maxAgeMs) {
          return record;
        }
      }
    }

    return null;
  }

  async getPlanChangeByCheckoutIntentId(
    checkoutIntentId: string,
    provider: BillingProviderName
  ): Promise<BillingPlanChangeRecord | null> {
    const snapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('checkout_intent_id', '==', checkoutIntentId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0].data() as BillingPlanChangeRecord;
    }
    return null;
  }

  async getPlanChangeByCheckoutId(
    providerCheckoutId: string,
    provider: BillingProviderName
  ): Promise<BillingPlanChangeRecord | null> {
    const snapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('provider_checkout_id', '==', providerCheckoutId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0].data() as BillingPlanChangeRecord;
    }
    return null;
  }

  async getPlanChangeByNewSubscriptionId(
    providerSubscriptionId: string,
    provider: BillingProviderName
  ): Promise<BillingPlanChangeRecord | null> {
    const snapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('new_provider_subscription_id', '==', providerSubscriptionId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0].data() as BillingPlanChangeRecord;
    }
    return null;
  }

  async getFailedSupersedes(
    ministryId: string,
    provider: BillingProviderName
  ): Promise<BillingPlanChangeRecord[]> {
    const snapshot = await this.planChangesCollection
      .where('ministry_id', '==', ministryId)
      .where('provider', '==', provider)
      .where('supersede_status', '==', 'failed')
      .get();

    return snapshot.docs.map((doc: any) => doc.data() as BillingPlanChangeRecord);
  }

  /**
   * Busca transições que falharam ou estão pendentes de supersede para reconciliação automática
   */
  async getPendingOrFailedPlanChanges(
    provider: BillingProviderName,
    limitCount: number = 20
  ): Promise<BillingPlanChangeRecord[]> {
    const snapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('supersede_status', '==', 'failed')
      .limit(limitCount)
      .get();

    return snapshot.docs.map((doc: any) => doc.data() as BillingPlanChangeRecord);
  }

  /**
   * Bloqueia/Aluga atomicamente uma transição de plano para execução de retry seguro contra concorrência multi-instância
   */
  async claimPlanChangeForRetry(
    id: string,
    lockWorkerId: string,
    lockDurationMs: number = 60000
  ): Promise<BillingPlanChangeRecord | null> {
    const docRef = this.planChangesCollection.doc(id);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) return null;

      const data = doc.data() as BillingPlanChangeRecord;

      // Se já foi concluído ou requer atenção financeira operacional manual, não processar no worker automático
      if (
        data.status === 'completed' ||
        data.supersede_status === 'completed' ||
        data.financial_attention_required === true
      ) {
        return null;
      }

      const now = Date.now();
      if (data.retry_locked_until) {
        const lockUntil = new Date(data.retry_locked_until).getTime();
        // Se ainda está travado por outra instância ativa, recusa claim
        if (lockUntil > now && data.retry_locked_by !== lockWorkerId) {
          return null;
        }
      }

      const updatedRecord: BillingPlanChangeRecord = {
        ...data,
        retry_locked_until: new Date(now + lockDurationMs).toISOString(),
        retry_locked_by: lockWorkerId,
        retry_count: (data.retry_count || 0) + 1,
        last_retry_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      };

      t.set(docRef, updatedRecord, { merge: true });
      return updatedRecord;
    });
  }

  /**
   * Libera o bloqueio de uma transição de plano
   */
  async releasePlanChangeLock(id: string): Promise<void> {
    const docRef = this.planChangesCollection.doc(id);
    await docRef.set(
      {
        retry_locked_until: null,
        retry_locked_by: null,
        updated_at: new Date().toISOString(),
      },
      { merge: true }
    );
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
   * Se o evento já foi processado com sucesso ('processed') ou descartado ('ignored'), retorna isDuplicate: true.
   * Se o evento anterior falhou ('failed'), permite o reprocessamento para possibilitar redeliveries do gateway.
   */
  async registerWebhookEvent(event: BillingWebhookEventRecord): Promise<{ isDuplicate: boolean; event: BillingWebhookEventRecord }> {
    const docRef = this.webhookEventsCollection.doc(event.id);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (doc.exists) {
        const existing = doc.data() as BillingWebhookEventRecord;
        if (existing.processing_status === 'processed' || existing.processing_status === 'ignored') {
          return { isDuplicate: true, event: existing };
        }

        // Se o evento anterior falhou ou foi abortado, incrementa tentativa e permite reprocessamento
        const updated: BillingWebhookEventRecord = {
          ...existing,
          attempts: (existing.attempts || 1) + 1,
          processing_status: 'processing',
          received_at: event.received_at,
        };
        t.set(docRef, updated, { merge: true });
        return { isDuplicate: false, event: updated };
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
