import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../lib/firebase';
import { AppError } from '../middleware/error-handler';
import {
  BillingCustomerRecord,
  BillingSubscriptionRecord,
  BillingPlanChangeRecord,
  LegacyBillingPlanChangeRecord,
  BillingTransactionRecord,
  BillingWebhookEventRecord,
  BillingActiveTransitionSlotRecord,
  BillingProviderName,
  BillingTransitionStatus,
  BillingTransitionV1Record,
  EntitlementSnapshot,
  isBillingTransitionV1,
  validateBillingTransitionV1,
  mapTransitionStatusToLegacyStatus,
  buildActiveTransitionSlotId,
  buildBillingSubscriptionId,
  BillingCheckoutAttempt,
  BillingCheckoutAttemptFailureClassification,
  BillingEarlyActivationQuote,
  V1_RECONCILABLE_TRANSITION_STATUSES,
} from '../features/billing/billing.types';
import {
  isEarlyAdjustmentObligationFinanciallyLive,
  canCreateEarlyActivationCheckout,
  classifyCapabilityEligibility,
} from '../features/billing/billing-transition-domain.service';

export const SAFE_TERMINAL_TRANSITION_STATUSES = [
  'completed',
  'canceled',
  'superseded',
  'failed',
] as const;

export type SafeTerminalTransitionStatus = (typeof SAFE_TERMINAL_TRANSITION_STATUSES)[number];

export const IMMUTABLE_TRANSITION_FIELDS: (keyof BillingTransitionV1Record)[] = [
  'id',
  'transition_id',
  'ministry_id',
  'provider',
  'currency',
  'policy_version',
  'execution_strategy',
  'transition_type',
  'requested_at',
  'requested_commercial_date',
  'price_locked_at',
  'requested_by_user_id',
  'source_plan_id',
  'source_interval',
  'source_addon_blocks',
  'source_current_cycle_total_cents',
  'source_entitlement_snapshot',
  'target_entitlement_snapshot',
  'early_activation_target_entitlement_snapshot',
  'current_period_start',
  'current_period_end',
  'target_plan_id',
  'target_interval',
  'target_addon_blocks',
  'target_future_recurring_price_cents',
  'requested_plan_id',
  'requested_interval',
  'requested_addon_blocks',
  'expected_amount_cents',
];

export const PERMANENT_WRITE_ONCE_FIELDS: (keyof BillingTransitionV1Record)[] = [
  'provider_customer_id',
  'old_provider_subscription_id',
  'previous_provider_subscription_id',
  'initial_provider_subscription_id',
  'initial_provider_payment_id',
  'future_provider_subscription_id',
  'future_provider_payment_id',
  'early_activation_provider_payment_id',
];

export class BillingRepository {
  private readonly customersCollection = db.collection('billing_customers');
  private readonly subscriptionsCollection = db.collection('billing_subscriptions');
  private readonly planChangesCollection = db.collection('billing_plan_changes');
  private readonly activeTransitionSlotsCollection = db.collection('billing_active_transition_slots');
  private readonly transactionsCollection = db.collection('billing_transactions');
  private readonly webhookEventsCollection = db.collection('billing_webhook_events');
  private readonly schedulersCollection = db.collection('billing_schedulers');

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

  /**
   * Bloqueia/Aluga atomicamente a criação de cliente para evitar múltiplas chamadas concorrentes ao gateway
   */
  async claimCustomerCreation(
    ministryId: string,
    provider: BillingProviderName,
    lockWorkerId: string,
    lockDurationMs: number = 30000
  ): Promise<{ acquired: boolean; customer: BillingCustomerRecord | null }> {
    const docId = `${ministryId}_${provider}`;
    const docRef = this.customersCollection.doc(docId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      const now = Date.now();

      if (doc.exists) {
        const data = doc.data() as BillingCustomerRecord;

        // Se o customer já possui provider_customer_id consolidado e pronto
        if (data.provider_customer_id && data.provider_customer_id.trim() && data.status !== 'creating') {
          return { acquired: false, customer: data };
        }

        // Se está em criação por outra instância ativa
        if (data.status === 'creating' && data.lease_locked_until) {
          const lockUntil = new Date(data.lease_locked_until).getTime();
          if (lockUntil > now && data.lease_locked_by !== lockWorkerId) {
            // Travado por outra instância
            return { acquired: false, customer: data };
          }
        }
      }

      // Adquire o lease para criação
      const nowIso = new Date(now).toISOString();
      const leaseRecord: BillingCustomerRecord = {
        id: docId,
        ministry_id: ministryId,
        provider,
        provider_customer_id: '',
        status: 'creating',
        lease_locked_until: new Date(now + lockDurationMs).toISOString(),
        lease_locked_by: lockWorkerId,
        created_at: doc.exists ? (doc.data()?.created_at || nowIso) : nowIso,
        updated_at: nowIso,
      };

      t.set(docRef, leaseRecord, { merge: true });
      return { acquired: true, customer: leaseRecord };
    });
  }

  // --------------------------------------------------------------------------
  // Subscriptions
  // --------------------------------------------------------------------------

  async getSubscription(ministryId: string, provider: BillingProviderName): Promise<BillingSubscriptionRecord | null> {
    const canonicalDocId = buildBillingSubscriptionId(ministryId, provider);
    const invertedDocId = `${provider}_${ministryId}`;

    // Leitura paralela para checagem de chave canônica e chave legada invertida (dual-key conflict safety)
    const [canonicalDoc, invertedDoc] = await Promise.all([
      this.subscriptionsCollection.doc(canonicalDocId).get(),
      this.subscriptionsCollection.doc(invertedDocId).get(),
    ]);

    const canonicalData = canonicalDoc.exists ? (canonicalDoc.data() as BillingSubscriptionRecord) : null;
    const invertedData = invertedDoc.exists ? (invertedDoc.data() as BillingSubscriptionRecord) : null;

    if (!canonicalData && !invertedData) {
      return null;
    }

    if (canonicalData && !invertedData) {
      return { ...canonicalData, id: canonicalDocId };
    }

    if (!canonicalData && invertedData) {
      // Documento histórico em chave legada/invertida: retorna com id normalizado canônico
      return { ...invertedData, id: canonicalDocId };
    }

    // Caso excepcional: Ambos os documentos existem (dual-key conflict evaluation)
    if (canonicalData && invertedData) {
      // Se apontam para o mesmo provider_subscription_id, o canônico prevalece
      if (canonicalData.provider_subscription_id === invertedData.provider_subscription_id) {
        return { ...canonicalData, id: canonicalDocId };
      }

      // Se um está inativo/cancelado e o outro ativo
      if (canonicalData.status === 'active' && invertedData.status !== 'active') {
        return { ...canonicalData, id: canonicalDocId };
      }
      if (invertedData.status === 'active' && canonicalData.status !== 'active') {
        return { ...invertedData, id: canonicalDocId };
      }

      // Se ambos alegam status active mas com assinaturas divergentes -> FAIL CLOSED
      console.error(
        `[DUAL-KEY CONFLICT] Divergência financeira crítica em BillingSubscription para o ministério ${ministryId}: ` +
          `canônico (${canonicalDocId}) aponta sub=${canonicalData.provider_subscription_id} (status=${canonicalData.status}), ` +
          `invertido (${invertedDocId}) aponta sub=${invertedData.provider_subscription_id} (status=${invertedData.status}). Fail-closed acionado.`
      );
      throw new AppError(
        500,
        `DUAL_KEY_FINANCIAL_CONFLICT: Conflito irresolvível entre assinaturas em chaves canônica e legada para o ministério ${ministryId}. Atenção financeira requerida.`
      );
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
    if (!subscription.ministry_id || !subscription.provider) {
      throw new Error(
        `[CANONICAL KEY] Impossível persistir BillingSubscription: ministry_id e provider são obrigatórios. (Recebido: ministry_id=${subscription.ministry_id}, provider=${subscription.provider})`
      );
    }

    // O repositório é a autoridade canônica da chave. O document ID é derivado exclusivamente aqui.
    // O caller NÃO consegue forçar um id divergente ou invertido.
    const canonicalDocId = buildBillingSubscriptionId(subscription.ministry_id, subscription.provider);
    const normalizedRecord: BillingSubscriptionRecord = {
      ...subscription,
      id: canonicalDocId,
    };

    // Identity Immutability Guard: prevenir merge acidental entre ministérios/provedores divergentes
    const existingDoc = await this.subscriptionsCollection.doc(canonicalDocId).get();
    if (existingDoc.exists) {
      const existing = existingDoc.data() as BillingSubscriptionRecord;
      if (existing.ministry_id && existing.ministry_id !== subscription.ministry_id) {
        throw new Error(
          `[IDENTITY IMMUTABILITY VIOLATION] Conflito de ministry_id em BillingSubscription: existente=${existing.ministry_id}, novo=${subscription.ministry_id}`
        );
      }
      if (existing.provider && existing.provider !== subscription.provider) {
        throw new Error(
          `[IDENTITY IMMUTABILITY VIOLATION] Conflito de provider em BillingSubscription: existente=${existing.provider}, novo=${subscription.provider}`
        );
      }
    }

    await this.subscriptionsCollection.doc(canonicalDocId).set(normalizedRecord, { merge: true });
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

  async getPlanChangeByInitialSubscriptionId(
    providerSubscriptionId: string,
    provider: BillingProviderName
  ): Promise<BillingPlanChangeRecord | null> {
    const snapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('initial_provider_subscription_id', '==', providerSubscriptionId)
      .limit(1)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs[0].data() as BillingPlanChangeRecord;
    }
    return null;
  }

  async getPlanChangeByProviderId(
    providerId: string,
    provider: BillingProviderName
  ): Promise<BillingPlanChangeRecord | null> {
    const byIntent = await this.getPlanChangeByCheckoutIntentId(providerId, provider);
    if (byIntent) return byIntent;

    const byChk = await this.getPlanChangeByCheckoutId(providerId, provider);
    if (byChk) return byChk;

    const bySub = await this.getPlanChangeByNewSubscriptionId(providerId, provider);
    if (bySub) return bySub;

    const byInitSub = await this.getPlanChangeByInitialSubscriptionId(providerId, provider);
    if (byInitSub) return byInitSub;

    const snapshotFutureSub = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('future_provider_subscription_id', '==', providerId)
      .limit(1)
      .get();
    if (!snapshotFutureSub.empty) {
      return snapshotFutureSub.docs[0].data() as BillingPlanChangeRecord;
    }

    const snapshotInitChk = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('initial_provider_checkout_id', '==', providerId)
      .limit(1)
      .get();
    if (!snapshotInitChk.empty) {
      return snapshotInitChk.docs[0].data() as BillingPlanChangeRecord;
    }

    const snapshotFutureChk = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('future_provider_checkout_id', '==', providerId)
      .limit(1)
      .get();
    if (!snapshotFutureChk.empty) {
      return snapshotFutureChk.docs[0].data() as BillingPlanChangeRecord;
    }

    const snapshotFuturePay = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('future_provider_payment_id', '==', providerId)
      .limit(1)
      .get();
    if (!snapshotFuturePay.empty) {
      return snapshotFuturePay.docs[0].data() as BillingPlanChangeRecord;
    }

    const snapshotRenewalPay = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('successful_renewal_provider_payment_id', '==', providerId)
      .limit(1)
      .get();
    if (!snapshotRenewalPay.empty) {
      return snapshotRenewalPay.docs[0].data() as BillingPlanChangeRecord;
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // Billing Transition Policy V1 (Deterministic Active Slot & Snapshots)
  // --------------------------------------------------------------------------

  /**
   * Cria atomicamente uma nova transição de plano e adquire o slot determinístico exclusivo.
   * Se já existir uma transição ativa no provedor para o ministério, rejeita a operação.
   */
  async createTransitionAndClaimSlot(
    record: BillingPlanChangeRecord
  ): Promise<{ planChange: BillingPlanChangeRecord; slot: BillingActiveTransitionSlotRecord }> {
    if (!record.id || !record.ministry_id || !record.provider) {
      throw new AppError(400, 'Dados de transição incompletos para criação atômica.');
    }

    const slotId = buildActiveTransitionSlotId(record.ministry_id, record.provider);
    const slotDocRef = this.activeTransitionSlotsCollection.doc(slotId);
    const planChangeDocRef = this.planChangesCollection.doc(record.id);

    return await db.runTransaction(async (t: any) => {
      const slotDoc = await t.get(slotDocRef);
      if (slotDoc.exists) {
        const existingSlot = slotDoc.data() as BillingActiveTransitionSlotRecord;
        throw new AppError(
          409,
          'Já existe uma transição de plano ativa para este ministério no provedor.',
          { code: 'ACTIVE_TRANSITION_EXISTS', slotId, activePlanChangeId: existingSlot.plan_change_id }
        );
      }

      const planChangeDoc = await t.get(planChangeDocRef);
      if (planChangeDoc.exists) {
        throw new AppError(
          409,
          'Já existe um registro de transição com este identificador.',
          { code: 'PLAN_CHANGE_ID_EXISTS', id: record.id }
        );
      }

      const nowIso = new Date().toISOString();
      const slotRecord: BillingActiveTransitionSlotRecord = {
        id: slotId,
        ministry_id: record.ministry_id,
        provider: record.provider,
        plan_change_id: record.id,
        acquired_at: record.created_at || nowIso,
        updated_at: nowIso,
        version: 1,
      };

      let normalizedRecord: BillingPlanChangeRecord;

      if (isBillingTransitionV1(record)) {
        const transitionStatus = record.transition_status || 'pending_future_authorization';
        const v1Data: BillingTransitionV1Record = {
          ...record,
          id: record.id,
          transition_id: record.transition_id || record.id,
          policy_version: 'billing_transition_v1',
          transition_status: transitionStatus,
          status: mapTransitionStatusToLegacyStatus(transitionStatus),
          financial_safety_status: record.financial_safety_status || 'live',
          early_activation_status: record.early_activation_status || 'not_applicable',
          requested_plan_id: record.target_plan_id,
          requested_interval: record.target_interval,
          requested_addon_blocks: record.target_addon_blocks,
          expected_amount_cents: record.target_future_recurring_price_cents,
          source_entitlement_snapshot: record.source_entitlement_snapshot,
          target_entitlement_snapshot: record.target_entitlement_snapshot || null,
          early_activation_target_entitlement_snapshot: record.early_activation_target_entitlement_snapshot || null,
          created_at: record.created_at || nowIso,
          updated_at: nowIso,
          last_reconciled_at: record.last_reconciled_at ?? null,
        };
        try {
          normalizedRecord = validateBillingTransitionV1(v1Data);
        } catch (err: any) {
          throw new AppError(500, `Falha de validação da transição V1: ${err.message}`);
        }
      } else {
        normalizedRecord = {
          ...record,
          created_at: record.created_at || nowIso,
          updated_at: nowIso,
        };
      }

      t.set(planChangeDocRef, normalizedRecord);
      t.set(slotDocRef, slotRecord);

      return { planChange: normalizedRecord, slot: slotRecord };
    });
  }

  /**
   * Consulta uma transição por ID com verificação opcional de isolamento multi-tenant
   */
  async getTransitionById(id: string, ministryId?: string): Promise<BillingPlanChangeRecord | null> {
    const doc = await this.planChangesCollection.doc(id).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() as BillingPlanChangeRecord;
    if (ministryId && data.ministry_id !== ministryId) {
      return null;
    }
    if (isBillingTransitionV1(data)) {
      try {
        return validateBillingTransitionV1(data);
      } catch (err: any) {
        throw new AppError(500, `Registro V1 corrompido: ${err.message}`);
      }
    }
    return data;
  }

  /**
   * Obtém o registro de slot determinístico ativo de um ministério no provedor.
   */
  async getActiveTransitionSlot(
    ministryId: string,
    provider: BillingProviderName
  ): Promise<BillingActiveTransitionSlotRecord | null> {
    const slotId = buildActiveTransitionSlotId(ministryId, provider);
    const doc = await this.activeTransitionSlotsCollection.doc(slotId).get();
    if (doc.exists) {
      return doc.data() as BillingActiveTransitionSlotRecord;
    }
    return null;
  }

  /**
   * Obtém a transição ativa de um ministério no provedor através do slot determinístico
   */
  async getActiveTransitionForMinistry(
    ministryId: string,
    provider: BillingProviderName
  ): Promise<{ slot: BillingActiveTransitionSlotRecord; transition: BillingPlanChangeRecord } | null> {
    const slotId = buildActiveTransitionSlotId(ministryId, provider);
    const slotDoc = await this.activeTransitionSlotsCollection.doc(slotId).get();
    if (!slotDoc.exists) {
      return null;
    }

    const slot = slotDoc.data() as BillingActiveTransitionSlotRecord;
    const transitionDoc = await this.planChangesCollection.doc(slot.plan_change_id).get();
    if (!transitionDoc.exists) {
      return null;
    }

    const transition = transitionDoc.data() as BillingPlanChangeRecord;
    if (transition.ministry_id !== ministryId) {
      return null;
    }

    if (isBillingTransitionV1(transition)) {
      try {
        const validated = validateBillingTransitionV1(transition);
        return { slot, transition: validated };
      } catch (err: any) {
        throw new AppError(500, `Transição V1 ativa corrompida no slot: ${err.message}`);
      }
    }

    return { slot, transition };
  }

  /**
   * Atualiza uma transição garantindo estritamente a imutabilidade dos snapshots e price locks,
   * além da semântica write-once de referências de provedor.
   * Substituições de checkout/quote requerem recordNewCheckoutAttempt.
   */
  async updateTransition(
    id: string,
    ministryId: string,
    updates: Partial<BillingPlanChangeRecord>
  ): Promise<BillingPlanChangeRecord> {
    const docRef = this.planChangesCollection.doc(id);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, 'Transição de plano não encontrada.');
      }
      const existing = doc.data() as BillingPlanChangeRecord;
      if (existing.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }

      // 1. Validação de imutabilidade dos snapshots e price locks
      for (const field of IMMUTABLE_TRANSITION_FIELDS) {
        const updateVal = (updates as any)[field];
        const existingVal = (existing as any)[field];
        if (updateVal !== undefined && JSON.stringify(updateVal) !== JSON.stringify(existingVal)) {
          throw new AppError(
            400,
            `Campo imutável '${String(field)}' não pode ser modificado após a criação da transição.`
          );
        }
      }

      // 2. Validação write-once permanente de referências do provedor
      for (const field of PERMANENT_WRITE_ONCE_FIELDS) {
        const updateVal = (updates as any)[field];
        const existingVal = (existing as any)[field];
        if (updateVal !== undefined && updateVal !== null) {
          if (existingVal !== undefined && existingVal !== null && existingVal !== '' && existingVal !== updateVal) {
            throw new AppError(
              400,
              `Campo write-once permanente '${String(field)}' não pode ser substituído de '${existingVal}' para '${updateVal}'.`
            );
          }
        }
      }

      // 3. Validação write-once genérica de checkouts (checkout rotation exige recordNewCheckoutAttempt)
      const genericCheckoutFields: (keyof BillingTransitionV1Record)[] = [
        'initial_provider_checkout_id',
        'initial_checkout_intent_id',
        'future_provider_checkout_id',
        'early_activation_provider_checkout_id',
        'future_checkout_intent_id',
        'early_activation_checkout_intent_id',
      ];
      for (const field of genericCheckoutFields) {
        const updateVal = (updates as any)[field];
        const existingVal = (existing as any)[field];
        if (updateVal !== undefined && updateVal !== null) {
          if (existingVal !== undefined && existingVal !== null && existingVal !== '' && existingVal !== updateVal) {
            throw new AppError(
              400,
              `Substituição de '${String(field)}' de '${existingVal}' para '${updateVal}' não permitida via update genérico. Use recordNewCheckoutAttempt.`
            );
          }
        }
      }

      let updatedRecord: BillingPlanChangeRecord;

      if (isBillingTransitionV1(existing)) {
        const nextTransitionStatus = (updates as Partial<BillingTransitionV1Record>).transition_status || existing.transition_status;
        const denormalizedStatus = mapTransitionStatusToLegacyStatus(nextTransitionStatus);

        const v1Updates: Partial<BillingTransitionV1Record> = {
          ...(updates as Partial<BillingTransitionV1Record>),
          transition_status: nextTransitionStatus,
          status: denormalizedStatus,
          requested_plan_id: existing.target_plan_id,
          requested_interval: existing.target_interval,
          requested_addon_blocks: existing.target_addon_blocks,
          expected_amount_cents: existing.target_future_recurring_price_cents,
          source_entitlement_snapshot: existing.source_entitlement_snapshot,
          early_activation_target_entitlement_snapshot: existing.early_activation_target_entitlement_snapshot,
          updated_at: new Date().toISOString(),
        };

        const merged = {
          ...existing,
          ...v1Updates,
        };

        try {
          updatedRecord = validateBillingTransitionV1(merged);
        } catch (err: any) {
          throw new AppError(500, `Falha de validação após update V1: ${err.message}`);
        }
      } else {
        updatedRecord = {
          ...existing,
          ...updates,
          updated_at: new Date().toISOString(),
        } as LegacyBillingPlanChangeRecord;
      }

      t.set(docRef, updatedRecord, { merge: true });
      return updatedRecord;
    });
  }

  /**
   * Registra uma nova tentativa de checkout de forma auditável e atômica.
   * Permite rotacionar checkouts expirados/falhos de future authorization ou registrar nova quote de early activation,
   * preservando todo o histórico de tentativas anteriores.
   */
  async recordNewCheckoutAttempt(
    transitionId: string,
    ministryId: string,
    attempt: any,
    newQuote?: any
  ): Promise<BillingTransitionV1Record> {
    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, 'Transição de plano não encontrada.');
      }
      const existing = doc.data() as BillingPlanChangeRecord;
      if (existing.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(existing)) {
        throw new AppError(400, 'Tentativas de checkout auditáveis são suportadas apenas em transições V1.');
      }

      const nowIso = new Date().toISOString();
      const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];

      // Expira qualquer tentativa anterior pendente do mesmo tipo
      for (let i = 0; i < attempts.length; i++) {
        if (attempts[i].attempt_type === attempt.attempt_type && attempts[i].status === 'pending') {
          attempts[i] = {
            ...attempts[i],
            status: 'expired',
          };
        }
      }
      attempts.push(attempt);

      const quotesHistory = existing.early_activation_quotes_history
        ? [...existing.early_activation_quotes_history]
        : [];
      let activeQuote = existing.current_early_activation_quote;

      if (newQuote) {
        for (let i = 0; i < quotesHistory.length; i++) {
          if (quotesHistory[i].status === 'active') {
            quotesHistory[i] = { ...quotesHistory[i], status: 'superseded' };
          }
        }
        quotesHistory.push(newQuote);
        activeQuote = newQuote;
      }

      const updates: Partial<BillingTransitionV1Record> = {
        checkout_attempts: attempts,
        early_activation_quotes_history: quotesHistory.length > 0 ? quotesHistory : undefined,
        current_early_activation_quote: activeQuote,
        updated_at: nowIso,
      };

      if (attempt.attempt_type === 'initial_purchase') {
        updates.current_initial_purchase_checkout_attempt_id = attempt.attempt_id;
        updates.initial_checkout_intent_id = attempt.internal_checkout_intent_id;
        updates.initial_provider_checkout_id = attempt.provider_checkout_id;
        updates.checkout_intent_id = attempt.internal_checkout_intent_id;
        updates.provider_checkout_id = attempt.provider_checkout_id;
        updates.checkout_url = attempt.checkout_url;
      } else if (attempt.attempt_type === 'future_authorization') {
        updates.current_future_checkout_attempt_id = attempt.attempt_id;
        updates.future_checkout_intent_id = attempt.internal_checkout_intent_id;
        updates.future_provider_checkout_id = attempt.provider_checkout_id;
        updates.checkout_intent_id = attempt.internal_checkout_intent_id;
        updates.provider_checkout_id = attempt.provider_checkout_id;
        updates.checkout_url = attempt.checkout_url;
      } else if (attempt.attempt_type === 'early_activation') {
        updates.current_early_activation_checkout_attempt_id = attempt.attempt_id;
        updates.early_activation_checkout_intent_id = attempt.internal_checkout_intent_id;
        updates.early_activation_provider_checkout_id = attempt.provider_checkout_id;
        if (activeQuote) {
          updates.prorated_adjustment_cents = activeQuote.prorated_adjustment_cents;
          updates.target_current_cycle_total_cents = activeQuote.target_current_cycle_total_cents;
        }
      }

      const merged: BillingTransitionV1Record = {
        ...existing,
        ...updates,
      };

      const validated = validateBillingTransitionV1(merged);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Reserva atômica da tentativa de checkout de ativação antecipada (Early Activation).
   * Executa validação de precondições, verificação da invariante de uma única obrigação viva,
   * consome atomicamente a cotação ativa e persiste a tentativa no estado 'pending' (pré-provedor).
   */
  async reserveEarlyActivationCheckoutAttempt(params: {
    transitionId: string;
    ministryId: string;
    quoteId: string;
    attemptId: string;
    internalCheckoutIntentId: string;
    amountCents: number;
    checkoutMinutesToExpire: number;
    quoteExpiresAt: string;
    nowIso?: string;
  }): Promise<{ transition: BillingTransitionV1Record; attempt: BillingCheckoutAttempt }> {
    const {
      transitionId,
      ministryId,
      quoteId,
      attemptId,
      internalCheckoutIntentId,
      amountCents,
      checkoutMinutesToExpire,
      quoteExpiresAt,
      nowIso = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada para reserva de early activation.`);
      }
      const existing = doc.data() as BillingPlanChangeRecord;
      if (existing.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(existing)) {
        throw new AppError(400, 'Early activation é suportado exclusivamente em transições V1.');
      }

      if (existing.execution_strategy !== 'scheduled_paid_transition') {
        throw new AppError(400, `Estratégia '${existing.execution_strategy}' não permite early activation.`);
      }

      if (existing.transition_status !== 'scheduled') {
        throw new AppError(409, `Transição em status '${existing.transition_status}' não permite early activation.`);
      }

      if (existing.financial_attention_required === true) {
        throw new AppError(409, 'Transição requer atenção financeira. Reserva de checkout bloqueada.', {
          code: 'FINANCIAL_ATTENTION_LOCKED',
        });
      }

      if (existing.early_activation_status === 'confirmed') {
        throw new AppError(409, 'A ativação antecipada já foi confirmada nesta transição.', {
          code: 'EARLY_ACTIVATION_ALREADY_CONFIRMED',
        });
      }

      // Validação da invariante de uma única obrigação viva ou reserva local pendente
      const earlyAttempts = (existing.checkout_attempts || []).filter((a) => a.attempt_type === 'early_activation');
      const hasReservedLocal = earlyAttempts.some(
        (a) => a.status === 'pending' && a.provider_create_state === 'reserved'
      );
      if (hasReservedLocal || isEarlyAdjustmentObligationFinanciallyLive(existing)) {
        throw new AppError(409, 'Já existe uma obrigação financeira de ativação antecipada ativa ou reserva pendente.', {
          code: 'EARLY_ACTIVATION_OBLIGATION_LIVE',
        });
      }

      // Validação da cotação
      const activeQuote = existing.current_early_activation_quote;
      if (!activeQuote || activeQuote.quote_id !== quoteId) {
        throw new AppError(400, 'Cotação de early activation inválida ou divergente da transição.', {
          code: 'INVALID_EARLY_ACTIVATION_QUOTE',
        });
      }

      if (activeQuote.status !== 'active') {
        throw new AppError(409, `Cotação com status '${activeQuote.status}' não pode ser consumida.`, {
          code: 'EARLY_ACTIVATION_QUOTE_NOT_ACTIVE',
        });
      }

      if (new Date(activeQuote.expires_at).getTime() <= new Date(nowIso).getTime()) {
        throw new AppError(400, 'A cotação de early activation expirou.', {
          code: 'EARLY_ACTIVATION_QUOTE_EXPIRED',
        });
      }

      // Transiciona a quote para consumed (imutável)
      const consumedQuote: BillingEarlyActivationQuote = {
        ...activeQuote,
        status: 'consumed',
      };

      const quotesHistory = existing.early_activation_quotes_history
        ? [...existing.early_activation_quotes_history]
        : [];
      const historyIndex = quotesHistory.findIndex((q) => q.quote_id === quoteId);
      if (historyIndex >= 0) {
        quotesHistory[historyIndex] = consumedQuote;
      } else {
        quotesHistory.push(consumedQuote);
      }

      // Cria a nova tentativa local (pré-gateway, sem provider_checkout_id ainda)
      const newAttempt: BillingCheckoutAttempt = {
        attempt_id: attemptId,
        transition_id: transitionId,
        attempt_type: 'early_activation',
        internal_checkout_intent_id: internalCheckoutIntentId,
        provider_checkout_id: null,
        checkout_url: null,
        quote_id: quoteId,
        amount_cents: amountCents,
        currency: 'BRL',
        status: 'pending',
        provider_create_state: 'reserved',
        failure_classification: null,
        provider_session_terminal: false,
        created_at: nowIso,
        checkout_requested_at: nowIso,
        checkout_minutes_to_expire: checkoutMinutesToExpire,
        expires_at: quoteExpiresAt,
      };

      const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
      attempts.push(newAttempt);

      const merged: BillingTransitionV1Record = {
        ...existing,
        checkout_attempts: attempts,
        current_early_activation_quote: consumedQuote,
        early_activation_quotes_history: quotesHistory,
        early_activation_status: 'payment_pending',
        current_early_activation_checkout_attempt_id: attemptId,
        early_activation_checkout_intent_id: internalCheckoutIntentId,
        early_activation_provider_checkout_id: null,
        prorated_adjustment_cents: amountCents,
        updated_at: nowIso,
      };

      const validated = validateBillingTransitionV1(merged);
      t.set(docRef, validated, { merge: true });
      return { transition: validated, attempt: newAttempt };
    });
  }

  /**
   * Transiciona atomicamente a tentativa de checkout do estado 'reserved' para 'attempting' (Two-Phase Commit).
   * Deve ser chamada IMEDIATAMENTE ANTES do POST /v3/checkouts ao provedor.
   * Se a tentativa não estiver em 'reserved' (ex: corrida concorrente ou já processada), lança 409 ATTEMPT_NOT_RESERVED.
   */
  async markEarlyActivationCheckoutAttempting(params: {
    transitionId: string;
    ministryId: string;
    attemptId: string;
    nowIso?: string;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      attemptId,
      nowIso = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada.`);
      }
      const existing = doc.data() as BillingPlanChangeRecord;
      if (existing.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(existing)) {
        throw new AppError(400, 'Operação suportada apenas em transições V1.');
      }

      const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
      const attemptIndex = attempts.findIndex((a) => a.attempt_id === attemptId);
      if (attemptIndex < 0) {
        throw new AppError(404, `Tentativa de checkout '${attemptId}' não encontrada na transição.`);
      }

      const currentAttempt = attempts[attemptIndex];

      // Invariante CAS: a transição para attempting só é permitida se estiver no estado 'reserved'
      if (currentAttempt.provider_create_state !== 'reserved') {
        throw new AppError(
          409,
          `Conflito CAS: tentativa '${attemptId}' não está no estado 'reserved' (estado atual: '${currentAttempt.provider_create_state || 'unknown'}').`,
          { code: 'ATTEMPT_NOT_RESERVED' }
        );
      }

      const updatedAttempt: BillingCheckoutAttempt = {
        ...currentAttempt,
        provider_create_state: 'attempting',
        checkout_requested_at: nowIso,
      };

      attempts[attemptIndex] = updatedAttempt;

      const merged: BillingTransitionV1Record = {
        ...existing,
        checkout_attempts: attempts,
        updated_at: nowIso,
      };

      const validated = validateBillingTransitionV1(merged);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Registra com sucesso inequívoco o checkout gerado no provedor para uma tentativa reservada.
   * Aplica garantia de write-once sobre provider_checkout_id.
   */
  async recordEarlyActivationCheckoutCreated(params: {
    transitionId: string;
    ministryId: string;
    attemptId: string;
    providerCheckoutId: string;
    checkoutUrl: string;
    expiresAt?: string | null;
    nowIso?: string;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      attemptId,
      providerCheckoutId,
      checkoutUrl,
      expiresAt,
      nowIso = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada.`);
      }
      const existing = doc.data() as BillingPlanChangeRecord;
      if (existing.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(existing)) {
        throw new AppError(400, 'Operação suportada apenas em transições V1.');
      }

      const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
      const attemptIndex = attempts.findIndex((a) => a.attempt_id === attemptId);
      if (attemptIndex < 0) {
        throw new AppError(404, `Tentativa de checkout '${attemptId}' não encontrada na transição.`);
      }

      const currentAttempt = attempts[attemptIndex];

      // Garantia WRITE-ONCE de provider_checkout_id
      if (
        currentAttempt.provider_checkout_id &&
        currentAttempt.provider_checkout_id !== providerCheckoutId
      ) {
        throw new AppError(
          409,
          `Conflito financeiro write-once: tentativa '${attemptId}' já possui checkout ID '${currentAttempt.provider_checkout_id}'. Não é permitido rotacionar para '${providerCheckoutId}'.`,
          { code: 'CHECKOUT_ID_CONFLICT' }
        );
      }

      // Garantia WRITE-ONCE de early_activation_provider_checkout_id na transição
      if (
        existing.early_activation_provider_checkout_id &&
        existing.early_activation_provider_checkout_id !== providerCheckoutId
      ) {
        throw new AppError(
          409,
          `Conflito financeiro write-once: transição '${transitionId}' já possui checkout ID '${existing.early_activation_provider_checkout_id}'. Não é permitido rotacionar para '${providerCheckoutId}'.`,
          { code: 'CHECKOUT_ID_CONFLICT' }
        );
      }

      const updatedAttempt: BillingCheckoutAttempt = {
        ...currentAttempt,
        provider_create_state: 'created',
        provider_checkout_id: providerCheckoutId,
        checkout_url: checkoutUrl,
        provider_session_terminal: false,
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      };

      attempts[attemptIndex] = updatedAttempt;

      const merged: BillingTransitionV1Record = {
        ...existing,
        checkout_attempts: attempts,
        early_activation_provider_checkout_id: providerCheckoutId,
        checkout_url: checkoutUrl,
        updated_at: nowIso,
      };

      const validated = validateBillingTransitionV1(merged);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Registra falha determinística comprovada na criação do checkout (antes de criar obrigação no provedor).
   * Libera o subfluxo de early activation para 'available' e marca attempt como terminalmente falha.
   */
  async markEarlyActivationCheckoutCreationFailed(params: {
    transitionId: string;
    ministryId: string;
    attemptId: string;
    failureClassification: BillingCheckoutAttemptFailureClassification;
    reason?: string;
    nowIso?: string;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      attemptId,
      failureClassification,
      reason,
      nowIso = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada.`);
      }
      const existing = doc.data() as BillingPlanChangeRecord;
      if (existing.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(existing)) {
        throw new AppError(400, 'Operação suportada apenas em transições V1.');
      }

      const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
      const attemptIndex = attempts.findIndex((a) => a.attempt_id === attemptId);
      if (attemptIndex < 0) {
        throw new AppError(404, `Tentativa de checkout '${attemptId}' não encontrada.`);
      }

      const currentAttempt = attempts[attemptIndex];
      const isPreObligationFailure = failureClassification === 'creation_failed_before_provider_obligation';

      const updatedAttempt: BillingCheckoutAttempt = {
        ...currentAttempt,
        status: 'failed',
        provider_create_state: isPreObligationFailure ? 'rejected_no_obligation' : currentAttempt.provider_create_state,
        failure_classification: failureClassification,
        provider_session_terminal: isPreObligationFailure ? false : currentAttempt.provider_session_terminal,
        completed_at: nowIso,
      };

      attempts[attemptIndex] = updatedAttempt;

      const merged: BillingTransitionV1Record = {
        ...existing,
        checkout_attempts: attempts,
        // Se a falha ocorreu comprovadamente antes de criar recurso no gateway, o subfluxo retorna para available
        early_activation_status: isPreObligationFailure ? 'available' : existing.early_activation_status,
        updated_at: nowIso,
      };

      const validated = validateBillingTransitionV1(merged);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Registra incerteza (timeout, 5xx, perda de conexão) na criação do checkout.
   * Mantém a tentativa em quarentena ('uncertain'), o subfluxo em 'payment_pending' e o slot HELD.
   */
  async markEarlyActivationCheckoutCreateUncertain(params: {
    transitionId: string;
    ministryId: string;
    attemptId: string;
    uncertainUntil: string;
    reason?: string;
    nowIso?: string;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      attemptId,
      uncertainUntil,
      reason,
      nowIso = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada.`);
      }
      const existing = doc.data() as BillingPlanChangeRecord;
      if (existing.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(existing)) {
        throw new AppError(400, 'Operação suportada apenas em transições V1.');
      }

      const attempts = existing.checkout_attempts ? [...existing.checkout_attempts] : [];
      const attemptIndex = attempts.findIndex((a) => a.attempt_id === attemptId);
      if (attemptIndex < 0) {
        throw new AppError(404, `Tentativa de checkout '${attemptId}' não encontrada.`);
      }

      const currentAttempt = attempts[attemptIndex];
      const updatedAttempt: BillingCheckoutAttempt = {
        ...currentAttempt,
        status: 'uncertain',
        provider_create_state: 'uncertain',
        failure_classification: 'unknown',
        provider_session_terminal: false,
        uncertain_until: uncertainUntil,
      };

      attempts[attemptIndex] = updatedAttempt;

      const merged: BillingTransitionV1Record = {
        ...existing,
        checkout_attempts: attempts,
        early_activation_status: 'payment_pending',
        updated_at: nowIso,
      };

      const validated = validateBillingTransitionV1(merged);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Persiste atomicamente uma cotação de early activation (CAS via Firestore Transaction).
   * Valida tenant isolation, status scheduled, ausência de financial attention, ausência de
   * obrigações financeiramente vivas e atualiza lifecycle da cotação anterior para superseded.
   */
  async recordEarlyActivationQuote(params: {
    ministryId: string;
    transitionId: string;
    quote: BillingEarlyActivationQuote;
    nowIso?: string;
  }): Promise<{ transition: BillingTransitionV1Record; quote: BillingEarlyActivationQuote }> {
    const { ministryId, transitionId, quote, nowIso = new Date().toISOString() } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada.`);
      }

      const existing = doc.data() as BillingPlanChangeRecord;
      if (existing.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }

      if (!isBillingTransitionV1(existing)) {
        throw new AppError(400, 'Operação suportada apenas em transições V1.');
      }

      // 1. Revalidação transacional completa de prontidão financeira (Seção 4)
      if (existing.execution_strategy !== 'scheduled_paid_transition') {
        throw new AppError(
          400,
          `Estratégia '${existing.execution_strategy}' não permite cotação de early activation (exigido 'scheduled_paid_transition').`
        );
      }

      if (existing.transition_status !== 'scheduled') {
        throw new AppError(
          400,
          `Transição em status '${existing.transition_status}' não permite cotação de early activation (exigido 'scheduled').`
        );
      }

      if (existing.supersede_status !== 'completed') {
        throw new AppError(
          400,
          `Transição anterior não finalizada no commit (supersede_status: '${existing.supersede_status}').`
        );
      }

      if (existing.payment_cleanup_status !== 'completed') {
        throw new AppError(
          400,
          `Limpeza de cobranças antigas não finalizada no commit (payment_cleanup_status: '${existing.payment_cleanup_status}').`
        );
      }

      if (existing.financial_safety_status !== 'live') {
        throw new AppError(
          400,
          `Estado de segurança financeira '${existing.financial_safety_status}' inválido para cotação (exigido 'live').`
        );
      }

      if (existing.financial_attention_required === true) {
        throw new AppError(400, 'Transição requer atenção financeira. Cotação bloqueada no commit.');
      }

      if (existing.early_activation_status === 'payment_pending') {
        throw new AppError(409, 'Existe um pagamento de ativação antecipada pendente de confirmação.');
      }

      if (isEarlyAdjustmentObligationFinanciallyLive(existing)) {
        throw new AppError(409, 'Existe uma obrigação financeira de early activation ativa ou não resolvida.');
      }

      if (!existing.target_entitlement_snapshot) {
        throw new AppError(400, 'Snapshot de entitlement de destino ausente na transição fresh.');
      }

      if (
        existing.source_current_cycle_total_cents === undefined ||
        existing.source_current_cycle_total_cents === null ||
        existing.target_current_cycle_total_cents === undefined ||
        existing.target_current_cycle_total_cents === null
      ) {
        throw new AppError(400, 'Totais financeiros do ciclo corrente ausentes na transição fresh.');
      }

      // 2. Fresh Economic Binding (Seção 5)
      if (quote.transition_id !== existing.id) {
        throw new AppError(
          409,
          `ID da transição na cotação ('${quote.transition_id}') diverge da transição persistida ('${existing.id}').`,
          { code: 'STALE_EARLY_ACTIVATION_QUOTE' }
        );
      }

      if (quote.ministry_id !== existing.ministry_id) {
        throw new AppError(
          403,
          `Ministério da cotação ('${quote.ministry_id}') diverge do ministério da transição ('${existing.ministry_id}').`,
          { code: 'STALE_EARLY_ACTIVATION_QUOTE' }
        );
      }

      if (quote.source_current_cycle_total_cents !== existing.source_current_cycle_total_cents) {
        throw new AppError(
          409,
          `Valor do ciclo de origem na cotação (${quote.source_current_cycle_total_cents}¢) diverge do valor travado na transição fresh (${existing.source_current_cycle_total_cents}¢).`,
          { code: 'STALE_EARLY_ACTIVATION_QUOTE' }
        );
      }

      if (quote.target_current_cycle_total_cents !== existing.target_current_cycle_total_cents) {
        throw new AppError(
          409,
          `Valor do ciclo de destino na cotação (${quote.target_current_cycle_total_cents}¢) diverge do valor travado na transição fresh (${existing.target_current_cycle_total_cents}¢).`,
          { code: 'STALE_EARLY_ACTIVATION_QUOTE' }
        );
      }

      // 3. Boundary / Quote Date Commit Guard (Seção 6)
      if (existing.effective_billing_date && quote.quote_effective_billing_date >= existing.effective_billing_date) {
        throw new AppError(
          400,
          `Data comercial da cotação (${quote.quote_effective_billing_date}) atingiu ou ultrapassou a fronteira da renovação (${existing.effective_billing_date}).`,
          { code: 'QUOTE_BOUNDARY_EXCEEDED' }
        );
      }

      const nowTime = new Date(nowIso).getTime();
      const quoteExpiryTime = new Date(quote.expires_at).getTime();
      if (nowTime >= quoteExpiryTime) {
        throw new AppError(400, 'A cotação de early activation já expirou no momento do commit.', {
          code: 'EARLY_ACTIVATION_QUOTE_EXPIRED',
        });
      }

      // 4. Capability Eligibility at Commit (Seção 7)
      const commitCapabilityCheck = classifyCapabilityEligibility(
        existing.source_entitlement_snapshot,
        existing.target_entitlement_snapshot,
        {
          priceDeltaCents:
            existing.target_current_cycle_total_cents - existing.source_current_cycle_total_cents,
        }
      );

      if (commitCapabilityCheck.classification !== 'pure_upgrade' || !commitCapabilityCheck.early_activation_eligible) {
        throw new AppError(
          400,
          `Transição não é elegível para early activation no commit: classificação '${commitCapabilityCheck.classification}'. Motivo: ${commitCapabilityCheck.reason || 'Upgrade estrito de capacidades obrigatório'}.`,
          { code: 'INELIGIBLE_EARLY_ACTIVATION_UPGRADE' }
        );
      }

      // 5. Atualiza histórico e current quote
      const existingHistory = existing.early_activation_quotes_history
        ? [...existing.early_activation_quotes_history]
        : [];

      const updatedHistory = existingHistory.map((q) => {
        if (q.status === 'active') {
          return { ...q, status: 'superseded' as const };
        }
        return q;
      });

      if (existing.current_early_activation_quote && existing.current_early_activation_quote.status === 'active') {
        const foundIndex = updatedHistory.findIndex(
          (q) => q.quote_id === existing.current_early_activation_quote!.quote_id
        );
        if (foundIndex >= 0) {
          updatedHistory[foundIndex] = {
            ...updatedHistory[foundIndex],
            status: 'superseded',
          };
        } else {
          updatedHistory.push({
            ...existing.current_early_activation_quote,
            status: 'superseded',
          });
        }
      }

      updatedHistory.push(quote);

      const merged: BillingTransitionV1Record = {
        ...existing,
        current_early_activation_quote: quote,
        early_activation_quotes_history: updatedHistory,
        early_activation_status: 'available',
        updated_at: nowIso,
      };

      const validated = validateBillingTransitionV1(merged);
      t.set(docRef, validated, { merge: true });
      return { transition: validated, quote };
    });
  }

  /**
   * Confirma atômica e idempotentemente a ativação de uma transição de compra inicial (Free -> Paid).
   * Atualiza effective_at, effective_billing_date, referências de provedor, marca completed e safe_terminal.
   */
  async confirmInitialPurchaseActivation(params: {
    transitionId: string;
    ministryId: string;
    effectiveAt: string;
    effectiveBillingDate: string;
    currentPeriodStartBillingDate?: string;
    currentPeriodEndBillingDate?: string;
    providerSubscriptionId: string;
    providerPaymentId?: string | null;
    providerCustomerId?: string | null;
    completedAt?: string;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      effectiveAt,
      effectiveBillingDate,
      currentPeriodStartBillingDate,
      currentPeriodEndBillingDate,
      providerSubscriptionId,
      providerPaymentId = null,
      providerCustomerId = null,
      completedAt = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada para confirmação de ativação.`);
      }
      const current = doc.data() as BillingPlanChangeRecord;
      if (current.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(current)) {
        throw new AppError(400, 'confirmInitialPurchaseActivation suporta apenas transições V1.');
      }

      if (current.execution_strategy !== 'immediate_initial_purchase') {
        throw new AppError(
          400,
          `Estratégia inválida para confirmInitialPurchaseActivation: '${current.execution_strategy}'.`
        );
      }

      // Idempotência: se já completada com as mesmas referências, retorna sem erro
      if (
        current.transition_status === 'completed' &&
        current.financial_safety_status === 'safe_terminal' &&
        current.effective_billing_date === effectiveBillingDate &&
        (current.initial_provider_subscription_id === providerSubscriptionId ||
          current.new_provider_subscription_id === providerSubscriptionId)
      ) {
        return current;
      }

      // Validação Write-Once de Effective Date (null -> valor permitido; valor A -> valor B proibido)
      if (current.effective_billing_date && current.effective_billing_date !== effectiveBillingDate) {
        throw new AppError(
          409,
          `Conflito em effective_billing_date: já gravado como '${current.effective_billing_date}', tentativa de alterar para '${effectiveBillingDate}'.`
        );
      }

      // Validação Write-Once de Provider Subscription
      if (
        current.initial_provider_subscription_id &&
        current.initial_provider_subscription_id !== providerSubscriptionId
      ) {
        throw new AppError(
          409,
          `Conflito em initial_provider_subscription_id: já gravado como '${current.initial_provider_subscription_id}', tentativa de alterar para '${providerSubscriptionId}'.`
        );
      }

      const updated: BillingTransitionV1Record = {
        ...current,
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
        status: 'completed',
        effective_at: effectiveAt,
        effective_billing_date: effectiveBillingDate,
        current_period_start_billing_date: currentPeriodStartBillingDate || effectiveBillingDate,
        current_period_end_billing_date: currentPeriodEndBillingDate || current.current_period_end_billing_date || null,
        initial_provider_subscription_id: providerSubscriptionId,
        new_provider_subscription_id: providerSubscriptionId,
        initial_provider_payment_id: providerPaymentId || current.initial_provider_payment_id || null,
        provider_customer_id: providerCustomerId || current.provider_customer_id || null,
        confirmed_at: current.confirmed_at || completedAt,
        completed_at: completedAt,
        updated_at: completedAt,
      };

      const validated = validateBillingTransitionV1(updated);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Confirma atômica e idempotentemente a ativação da renovação de uma transição agendada (Paid -> Paid V1).
   * Atualiza datas de período, referências de liquidação, transita para completed e safe_terminal.
   */
  async confirmScheduledPaidRenewalActivation(params: {
    transitionId: string;
    ministryId: string;
    effectiveBillingDate: string;
    currentPeriodStartBillingDate: string;
    currentPeriodEndBillingDate: string;
    providerSubscriptionId: string;
    providerPaymentId: string;
    providerCustomerId?: string | null;
    renewalPaidBillingDate?: string | null;
    renewalPaymentSettledAt?: string | null;
    completedAt?: string;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      effectiveBillingDate,
      currentPeriodStartBillingDate,
      currentPeriodEndBillingDate,
      providerSubscriptionId,
      providerPaymentId,
      providerCustomerId = null,
      renewalPaidBillingDate = null,
      renewalPaymentSettledAt = null,
      completedAt = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada para confirmação de renovação.`);
      }
      const current = doc.data() as BillingPlanChangeRecord;
      if (current.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(current)) {
        throw new AppError(400, 'confirmScheduledPaidRenewalActivation suporta apenas transições V1.');
      }

      if (current.execution_strategy !== 'scheduled_paid_transition') {
        throw new AppError(
          400,
          `Estratégia inválida para confirmScheduledPaidRenewalActivation: '${current.execution_strategy}'.`
        );
      }

      // Idempotência: se já completada com as mesmas referências, retorna sem erro
      if (
        current.transition_status === 'completed' &&
        current.financial_safety_status === 'safe_terminal' &&
        current.effective_billing_date === effectiveBillingDate &&
        (current.future_provider_subscription_id === providerSubscriptionId ||
          current.new_provider_subscription_id === providerSubscriptionId)
      ) {
        return current;
      }

      // Validação Write-Once de Effective Date
      if (current.effective_billing_date && current.effective_billing_date !== effectiveBillingDate) {
        throw new AppError(
          409,
          `Conflito em effective_billing_date: já gravado como '${current.effective_billing_date}', tentativa de alterar para '${effectiveBillingDate}'.`
        );
      }

      // Validação Write-Once de Provider Subscription
      if (
        current.future_provider_subscription_id &&
        current.future_provider_subscription_id !== providerSubscriptionId
      ) {
        throw new AppError(
          409,
          `Conflito em future_provider_subscription_id: já gravado como '${current.future_provider_subscription_id}', tentativa de alterar para '${providerSubscriptionId}'.`
        );
      }

      const updated: BillingTransitionV1Record = {
        ...current,
        transition_status: 'completed',
        financial_safety_status: 'safe_terminal',
        status: 'completed',
        effective_at: current.effective_at || completedAt,
        effective_billing_date: effectiveBillingDate,
        current_period_start_billing_date: currentPeriodStartBillingDate || effectiveBillingDate,
        current_period_end_billing_date: currentPeriodEndBillingDate || current.current_period_end_billing_date || null,
        future_provider_subscription_id: providerSubscriptionId,
        new_provider_subscription_id: providerSubscriptionId,
        future_provider_payment_id: providerPaymentId || current.future_provider_payment_id || null,
        successful_renewal_provider_payment_id: providerPaymentId || current.successful_renewal_provider_payment_id || null,
        renewal_payment_settled_at: renewalPaymentSettledAt || current.renewal_payment_settled_at || completedAt,
        renewal_paid_billing_date: renewalPaidBillingDate || current.renewal_paid_billing_date || effectiveBillingDate,
        target_promoted_at: completedAt,
        provider_customer_id: providerCustomerId || current.provider_customer_id || null,
        confirmed_at: current.confirmed_at || completedAt,
        completed_at: completedAt,
        updated_at: completedAt,
        grace_status: current.grace_started_at ? 'resolved' : current.grace_status,
      };

      const validated = validateBillingTransitionV1(updated);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Phase 3B.3B: Persiste a entrada em carência civil de 7 dias [start, end) de forma write-once.
   * Se a carência já tiver sido iniciada, preserva as datas e o snapshot originais (idempotência).
   */
  async enterScheduledPaidTransitionGrace(params: {
    transitionId: string;
    ministryId: string;
    graceStartedAt: string;
    graceStartBillingDate: string;
    graceEndBillingDate: string;
    graceEntitlementSnapshot: EntitlementSnapshot;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      graceStartedAt,
      graceStartBillingDate,
      graceEndBillingDate,
      graceEntitlementSnapshot,
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada para entrada em carência.`);
      }
      const current = doc.data() as BillingPlanChangeRecord;
      if (current.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(current)) {
        throw new AppError(400, 'enterScheduledPaidTransitionGrace suporta apenas transições V1.');
      }

      // Write-Once: se já tiver grace_started_at gravado, não recalcula nem sobrescreve
      if (current.grace_started_at) {
        return current;
      }

      const updated: BillingTransitionV1Record = {
        ...current,
        grace_status: 'in_grace',
        grace_started_at: graceStartedAt,
        grace_start_billing_date: graceStartBillingDate,
        grace_end_billing_date: graceEndBillingDate,
        grace_entitlement_snapshot: graceEntitlementSnapshot,
        updated_at: graceStartedAt,
      };

      const validated = validateBillingTransitionV1(updated);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Phase 3B.3B: Registra a expiração da carência civil de 7 dias de forma idempotente e write-once.
   * A transição permanece 'scheduled' e o slot ativo continua HELD.
   */
  async recordGraceExpiry(params: {
    transitionId: string;
    ministryId: string;
    graceExpiredAt: string;
    graceExpiredBillingDate: string;
  }): Promise<BillingTransitionV1Record> {
    const { transitionId, ministryId, graceExpiredAt, graceExpiredBillingDate } = params;
    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada para expiração de carência.`);
      }
      const current = doc.data() as BillingPlanChangeRecord;
      if (current.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(current)) {
        throw new AppError(400, 'recordGraceExpiry suporta apenas transições V1.');
      }

      if (current.grace_expired_at) {
        return current;
      }

      const updated: BillingTransitionV1Record = {
        ...current,
        grace_status: 'expired',
        grace_expired_at: graceExpiredAt,
        grace_expired_billing_date: graceExpiredBillingDate,
        updated_at: graceExpiredAt,
      };

      const validated = validateBillingTransitionV1(updated);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Persiste a evidência de liquidação financeira da renovação antes de atingir a fronteira comercial.
   * A transição permanece em 'scheduled' e o slot continua HELD.
   */
  async recordRenewalFinancialSettlement(params: {
    transitionId: string;
    ministryId: string;
    providerPaymentId: string;
    paidBillingDate: string;
    settledAt: string;
  }): Promise<BillingTransitionV1Record> {
    const { transitionId, ministryId, providerPaymentId, paidBillingDate, settledAt } = params;
    return (await this.updateTransition(transitionId, ministryId, {
      successful_renewal_provider_payment_id: providerPaymentId,
      renewal_paid_billing_date: paidBillingDate,
      renewal_payment_settled_at: settledAt,
    })) as BillingTransitionV1Record;
  }

  /**
   * Marca uma transição como segura terminalmente (safe_terminal) após todas as compensações financeiras
   */
  async markFinanciallySafe(
    id: string,
    ministryId: string,
    terminalStatus: SafeTerminalTransitionStatus,
    details?: { failure_reason?: string }
  ): Promise<BillingPlanChangeRecord> {
    if (!SAFE_TERMINAL_TRANSITION_STATUSES.includes(terminalStatus)) {
      throw new AppError(
        400,
        `Status '${terminalStatus}' não é um estado terminal financeiramente seguro. Permitidos: ${SAFE_TERMINAL_TRANSITION_STATUSES.join(', ')}`
      );
    }

    return await this.updateTransition(id, ministryId, {
      transition_status: terminalStatus,
      financial_safety_status: 'safe_terminal',
      failure_reason: details?.failure_reason || null,
      completed_at: terminalStatus === 'completed' ? new Date().toISOString() : undefined,
    });
  }

  /**
   * Libera o slot determinístico ativo via Compare-And-Set seguro.
   * Só permite liberação se o slot ainda pertencer à mesma transição E ela for 'safe_terminal' e terminal status.
   */
  async releaseSlotIfOwnedAndSafe(
    ministryId: string,
    provider: BillingProviderName,
    planChangeId: string
  ): Promise<{ released: boolean; reason?: string }> {
    const slotId = buildActiveTransitionSlotId(ministryId, provider);
    const slotDocRef = this.activeTransitionSlotsCollection.doc(slotId);
    const planChangeDocRef = this.planChangesCollection.doc(planChangeId);

    return await db.runTransaction(async (t: any) => {
      const slotDoc = await t.get(slotDocRef);
      if (!slotDoc.exists) {
        return { released: false, reason: 'slot_not_found' };
      }

      const slot = slotDoc.data() as BillingActiveTransitionSlotRecord;
      if (slot.plan_change_id !== planChangeId) {
        return { released: false, reason: 'slot_owned_by_another_transition' };
      }

      const planChangeDoc = await t.get(planChangeDocRef);
      if (!planChangeDoc.exists) {
        return { released: false, reason: 'transition_not_found' };
      }

      const transition = planChangeDoc.data() as BillingPlanChangeRecord;
      if (transition.ministry_id !== ministryId) {
        return { released: false, reason: 'tenant_mismatch' };
      }

      if (!isBillingTransitionV1(transition)) {
        return { released: false, reason: 'legacy_transition_does_not_own_slot' };
      }

      if (transition.financial_safety_status !== 'safe_terminal') {
        return { released: false, reason: 'transition_not_financially_safe' };
      }

      if (!(SAFE_TERMINAL_TRANSITION_STATUSES as readonly string[]).includes(transition.transition_status)) {
        return { released: false, reason: 'transition_status_not_terminal' };
      }
      if (transition.transition_status === 'financial_attention_required') {
        return { released: false, reason: 'financial_attention_required' };
      }

      // Slot Release Invariant: para scheduled_paid_transition, o slot NUNCA pode ser liberado sem cutover de origem concluído
      if (
        transition.execution_strategy === 'scheduled_paid_transition' &&
        (transition.supersede_status !== 'completed' || transition.payment_cleanup_status !== 'completed')
      ) {
        return { released: false, reason: 'source_cutover_not_completed' };
      }

      t.delete(slotDocRef);
      return { released: true };
    });
  }

  // --------------------------------------------------------------------------
  // V1 Explicit Correlation Lookups
  // --------------------------------------------------------------------------

  async getTransitionByFutureCheckoutIntentId(
    checkoutIntentId: string,
    provider?: BillingProviderName
  ): Promise<BillingTransitionV1Record | null> {
    let query: any = this.planChangesCollection.where('future_checkout_intent_id', '==', checkoutIntentId);
    if (provider) {
      query = query.where('provider', '==', provider);
    }
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0].data() as BillingPlanChangeRecord;
    if (!isBillingTransitionV1(doc)) return null;
    return validateBillingTransitionV1(doc);
  }

  async getTransitionByFutureProviderCheckoutId(
    providerCheckoutId: string,
    provider?: BillingProviderName
  ): Promise<BillingTransitionV1Record | null> {
    let query: any = this.planChangesCollection.where('future_provider_checkout_id', '==', providerCheckoutId);
    if (provider) {
      query = query.where('provider', '==', provider);
    }
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0].data() as BillingPlanChangeRecord;
    if (!isBillingTransitionV1(doc)) return null;
    return validateBillingTransitionV1(doc);
  }

  async getTransitionByFutureSubscriptionId(
    subscriptionId: string,
    provider?: BillingProviderName
  ): Promise<BillingTransitionV1Record | null> {
    let query: any = this.planChangesCollection.where('future_provider_subscription_id', '==', subscriptionId);
    if (provider) {
      query = query.where('provider', '==', provider);
    }
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0].data() as BillingPlanChangeRecord;
    if (!isBillingTransitionV1(doc)) return null;
    return validateBillingTransitionV1(doc);
  }

  async getTransitionByFuturePaymentId(
    paymentId: string,
    provider?: BillingProviderName
  ): Promise<BillingTransitionV1Record | null> {
    let query: any = this.planChangesCollection.where('future_provider_payment_id', '==', paymentId);
    if (provider) {
      query = query.where('provider', '==', provider);
    }
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0].data() as BillingPlanChangeRecord;
    if (!isBillingTransitionV1(doc)) return null;
    return validateBillingTransitionV1(doc);
  }

  async getTransitionByEarlyActivationCheckoutIntentId(
    checkoutIntentId: string,
    provider?: BillingProviderName
  ): Promise<BillingTransitionV1Record | null> {
    let query: any = this.planChangesCollection.where('early_activation_checkout_intent_id', '==', checkoutIntentId);
    if (provider) {
      query = query.where('provider', '==', provider);
    }
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0].data() as BillingPlanChangeRecord;
    if (!isBillingTransitionV1(doc)) return null;
    return validateBillingTransitionV1(doc);
  }


  async getTransitionByEarlyActivationProviderCheckoutId(
    providerCheckoutId: string,
    provider?: BillingProviderName
  ): Promise<BillingTransitionV1Record | null> {
    let query: any = this.planChangesCollection.where('early_activation_provider_checkout_id', '==', providerCheckoutId);
    if (provider) {
      query = query.where('provider', '==', provider);
    }
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0].data() as BillingPlanChangeRecord;
    if (!isBillingTransitionV1(doc)) return null;
    return validateBillingTransitionV1(doc);
  }

  async getTransitionByEarlyActivationPaymentId(
    paymentId: string,
    provider?: BillingProviderName
  ): Promise<BillingTransitionV1Record | null> {
    let query: any = this.planChangesCollection.where('early_activation_provider_payment_id', '==', paymentId);
    if (provider) {
      query = query.where('provider', '==', provider);
    }
    const snapshot = await query.limit(1).get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0].data() as BillingPlanChangeRecord;
    if (!isBillingTransitionV1(doc)) return null;
    return validateBillingTransitionV1(doc);
  }

  /**
   * Persiste atomicamente a evidência de liquidação financeira do pagamento de ajuste de early activation.
   * Valida status scheduled, financial safety live e ausência de conflito write-once em early_activation_provider_payment_id.
   * A transição permanece scheduled e o slot permanece HELD.
   */
  async recordEarlyAdjustmentFinancialSettlement(params: {
    transitionId: string;
    ministryId: string;
    providerPaymentId: string;
    paidBillingDate: string;
    settledAt: string;
    attemptId?: string | null;
    nowIso?: string;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      providerPaymentId,
      paidBillingDate,
      settledAt,
      attemptId,
      nowIso = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada para liquidação de early adjustment.`);
      }
      const current = doc.data() as BillingPlanChangeRecord;
      if (current.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(current)) {
        throw new AppError(400, 'recordEarlyAdjustmentFinancialSettlement suporta apenas transições V1.');
      }

      // Write-Once de provider payment ID
      if (
        current.early_activation_provider_payment_id &&
        current.early_activation_provider_payment_id !== providerPaymentId
      ) {
        throw new AppError(
          409,
          `Conflito financeiro write-once em early adjustment: já existe pagamento '${current.early_activation_provider_payment_id}' gravado. Tentativa de sobrescrever com '${providerPaymentId}'.`,
          { code: 'EARLY_ADJUSTMENT_PAYMENT_ID_CONFLICT' }
        );
      }

      // Atualizar tentativa em checkout_attempts se aplicável
      const attempts = current.checkout_attempts ? [...current.checkout_attempts] : [];
      const effectiveAttemptId = attemptId || current.current_early_activation_checkout_attempt_id;
      if (effectiveAttemptId) {
        const attIdx = attempts.findIndex((a) => a.attempt_id === effectiveAttemptId);
        if (attIdx >= 0) {
          attempts[attIdx] = {
            ...attempts[attIdx],
            provider_payment_id: providerPaymentId,
            paid_at: settledAt,
            provider_session_terminal: true,
          };
        }
      }

      const updated: BillingTransitionV1Record = {
        ...current,
        early_activation_provider_payment_id: providerPaymentId,
        successful_early_adjustment_provider_payment_id: providerPaymentId,
        early_activation_payment_settled_at: settledAt,
        early_adjustment_paid_billing_date: paidBillingDate,
        checkout_attempts: attempts,
        updated_at: nowIso,
      };

      const validated = validateBillingTransitionV1(updated);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
  }

  /**
   * Confirma a ativação do entitlement de early activation após a convergência local e de cotas.
   * Marca early_activation_status = 'activated' e early_activation_activated_at.
   * A transição PERMANECE em 'scheduled', financial_safety_status 'live' e o slot PERMANECE 'HELD'.
   */
  async confirmEarlyActivationEntitlement(params: {
    transitionId: string;
    ministryId: string;
    providerPaymentId: string;
    attemptId?: string | null;
    nowIso?: string;
  }): Promise<BillingTransitionV1Record> {
    const {
      transitionId,
      ministryId,
      providerPaymentId,
      attemptId,
      nowIso = new Date().toISOString(),
    } = params;

    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, `Transição '${transitionId}' não encontrada para confirmação de early activation.`);
      }
      const current = doc.data() as BillingPlanChangeRecord;
      if (current.ministry_id !== ministryId) {
        throw new AppError(403, 'Acesso não autorizado a esta transição de plano.');
      }
      if (!isBillingTransitionV1(current)) {
        throw new AppError(400, 'confirmEarlyActivationEntitlement suporta apenas transições V1.');
      }

      // Idempotência: se já ativado com o mesmo payment ID, retorna sem mutação
      if (
        current.early_activation_status === 'activated' &&
        current.early_activation_provider_payment_id === providerPaymentId
      ) {
        return current;
      }

      // Validação de pagamento correspondente
      if (
        current.early_activation_provider_payment_id &&
        current.early_activation_provider_payment_id !== providerPaymentId
      ) {
        throw new AppError(
          409,
          `Conflito em confirmEarlyActivationEntitlement: pagamento esperado '${current.early_activation_provider_payment_id}' != recebido '${providerPaymentId}'.`
        );
      }

      const attempts = current.checkout_attempts ? [...current.checkout_attempts] : [];
      const effectiveAttemptId = attemptId || current.current_early_activation_checkout_attempt_id;
      if (effectiveAttemptId) {
        const attIdx = attempts.findIndex((a) => a.attempt_id === effectiveAttemptId);
        if (attIdx >= 0) {
          attempts[attIdx] = {
            ...attempts[attIdx],
            status: 'completed',
            completed_at: nowIso,
            provider_session_terminal: true,
          };
        }
      }

      const updated: BillingTransitionV1Record = {
        ...current,
        early_activation_status: 'activated',
        early_activation_activated_at: nowIso,
        early_activation_confirmed_at: nowIso,
        early_activation_provider_payment_id: providerPaymentId,
        successful_early_adjustment_provider_payment_id: providerPaymentId,
        checkout_attempts: attempts,
        // Invariantes estritas de Paid -> Paid:
        transition_status: 'scheduled',
        financial_safety_status: 'live',
        updated_at: nowIso,
      };

      const validated = validateBillingTransitionV1(updated);
      t.set(docRef, validated, { merge: true });
      return validated;
    });
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
   * Normalização explícita, idempotente e delimitada de transições legadas sem metadata de scheduling.
   * Utiliza:
   * - Bounded scan (teto explícito de leituras por ciclo);
   * - Stable Document ID ordering (`orderBy('__name__', 'asc')`);
   * - Durable cursor persistido em `billing_schedulers/normalization_{provider}` (sobrevive a restarts);
   * - At-least-once crash safety: normaliza primeiro, persiste avanço de cursor depois;
   * - Wrap controlado ao atingir o final da coleção;
   * - Fresh transaction check garantindo que JAMAIS sobrescreve um timestamp real de agendamento;
   * - Zero mutação em campos de negócio e zero mutação em `updated_at`.
   */
  async normalizeLegacyTransitionsWithoutScheduling(
    provider: BillingProviderName = 'asaas',
    batchSize: number = 50
  ): Promise<{ normalizedCount: number; hasMore: boolean }> {
    const scopes: { scope: string; field: 'transition_status' | 'financial_attention_required'; value: any }[] = [
      ...V1_RECONCILABLE_TRANSITION_STATUSES.map((st) => ({
        scope: st,
        field: 'transition_status' as const,
        value: st,
      })),
      { scope: 'attention', field: 'financial_attention_required' as const, value: true },
    ];

    // 1. Carrega cursores persistidos para o provedor
    const schedulerDocId = `normalization_${provider}`;
    const schedulerSnap = await this.schedulersCollection.doc(schedulerDocId).get();
    const schedulerData = schedulerSnap.exists ? schedulerSnap.data() : null;
    const cursors: Record<string, string | null> = { ...(schedulerData?.cursors || {}) };

    let inspectedCount = 0;
    let normalizedCount = 0;
    const cursorUpdates: Record<string, { expectedStartCursor: string | null; nextCursor: string | null }> = {};

    for (const scope of scopes) {
      if (inspectedCount >= batchSize) break;
      const remaining = batchSize - inspectedCount;
      const startCursor = cursors[scope.scope] || null;

      let query = this.planChangesCollection
        .where('provider', '==', provider)
        .where(scope.field, '==', scope.value)
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(remaining);

      if (startCursor) {
        query = query.startAfter(startCursor);
      }

      const snap = await query.get();

      if (snap.empty) {
        // Se a query vazia possuía cursor prévio, alcançou o fim da faixa: wrap planejado via CAS
        if (startCursor) {
          cursorUpdates[scope.scope] = { expectedStartCursor: startCursor, nextCursor: null };
        }
        continue;
      }

      inspectedCount += snap.docs.length;

      // 2. Inspeciona e normaliza os documentos do batch com fresh transaction check
      for (const doc of snap.docs) {
        const data = doc.data() as BillingPlanChangeRecord;
        if (data.last_reconciled_at === undefined) {
          await this.planChangesCollection.firestore.runTransaction(async (t) => {
            const freshSnap = await t.get(doc.ref);
            if (!freshSnap.exists) return;
            const freshData = freshSnap.data() as BillingPlanChangeRecord;
            if (freshData.last_reconciled_at === undefined) {
              // Grava EXCLUSIVAMENTE last_reconciled_at = null, sem alterar updated_at ou campos de negócio
              t.update(doc.ref, { last_reconciled_at: null });
              normalizedCount++;
            }
          });
        }
      }

      // 3. Atualização do cursor do scope com Scan-Start CAS
      const lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.docs.length < remaining) {
        // Fim da faixa alcançado neste ciclo: planeja wrap para null com pré-condição CAS
        cursorUpdates[scope.scope] = { expectedStartCursor: startCursor, nextCursor: null };
      } else {
        // Avança o cursor durável para o último ID inspecionado
        cursorUpdates[scope.scope] = { expectedStartCursor: startCursor, nextCursor: lastDoc.id };
      }
    }

    // 4. Persiste o progresso do cursor de forma atômica, per-scope e com Scan-Start CAS via transação
    await this.schedulersCollection.firestore.runTransaction(async (t) => {
      const schedRef = this.schedulersCollection.doc(schedulerDocId);
      const schedSnap = await t.get(schedRef);
      const existingCursors: Record<string, string | null> = schedSnap.exists
        ? { ...(schedSnap.data()?.cursors || {}) }
        : {};

      for (const scopeKey of Object.keys(cursorUpdates)) {
        const { expectedStartCursor, nextCursor } = cursorUpdates[scopeKey];
        const currentCursor = existingCursors[scopeKey] || null;

        if (nextCursor === null) {
          // WRAP CAS: só pode resetar para null se o cursor persistido no banco
          // ainda for exatamente aquele de onde este scan iniciou (sem avanço concorrente por outro worker)
          if (currentCursor === expectedStartCursor) {
            existingCursors[scopeKey] = null;
          }
          // Caso contrário: stale wrap observation (outro worker já avançou o cursor para um valor mais novo); ignora!
        } else {
          // FORWARD ADVANCEMENT CAS:
          // Só avança se o novo cursor for estritamente maior que o cursor persistido atual
          if (currentCursor === null) {
            if (expectedStartCursor === null) {
              existingCursors[scopeKey] = nextCursor;
            }
          } else if (nextCursor > currentCursor) {
            existingCursors[scopeKey] = nextCursor;
          }
        }
      }

      t.set(
        schedRef,
        {
          id: schedulerDocId,
          provider,
          cursors: existingCursors,
          updated_at: new Date().toISOString(),
        },
        { merge: true }
      );
    });

    return {
      normalizedCount,
      hasMore: inspectedCount >= batchSize,
    };
  }

  async getNormalizationSchedulerRecord(provider: BillingProviderName = 'asaas'): Promise<any> {
    const doc = await this.schedulersCollection.doc(`normalization_${provider}`).get();
    return doc.exists ? doc.data() : null;
  }

  /**
   * Busca transições V1 que necessitam de reconciliação com ordenação determinística e fairness entre buckets.
   * Aplica:
   * 1. Query LRR Moderna indexada por last_reconciled_at ASC e __name__ ASC (nulls primeiro = maior prioridade);
   * 2. Fair Round-Robin Interleaving entre os buckets operacionais para prevenir starvation de qualquer estado;
   * 3. Bounded batch limit estrito (limitCount = 20).
   */
  async getV1TransitionsNeedingReconciliation(
    provider: BillingProviderName,
    limitCount: number = 20
  ): Promise<BillingPlanChangeRecord[]> {
    const fetchBucketDocs = async (
      status: string
    ): Promise<any[]> => {
      try {
        const modernQuery = this.planChangesCollection
          .where('provider', '==', provider)
          .where('transition_status', '==', status)
          .orderBy('last_reconciled_at', 'asc')
          .orderBy(FieldPath.documentId(), 'asc')
          .limit(limitCount);

        const snap = await modernQuery.get();
        return (snap as any).docs || [];
      } catch {
        const snap = await this.planChangesCollection
          .where('provider', '==', provider)
          .where('transition_status', '==', status)
          .limit(limitCount)
          .get();
        return (snap as any).docs || [];
      }
    };

    // Consulta exclusiva de atenção filtrada estritamente por live statuses (previne starvation por terminais antes do limit)
    const fetchLiveAttentionDocs = async (status: string): Promise<any[]> => {
      try {
        const modernQuery = this.planChangesCollection
          .where('provider', '==', provider)
          .where('transition_status', '==', status)
          .where('financial_attention_required', '==', true)
          .orderBy('last_reconciled_at', 'asc')
          .orderBy(FieldPath.documentId(), 'asc')
          .limit(limitCount);

        const snap = await modernQuery.get();
        return (snap as any).docs || [];
      } catch {
        const snap = await this.planChangesCollection
          .where('provider', '==', provider)
          .where('transition_status', '==', status)
          .where('financial_attention_required', '==', true)
          .limit(limitCount)
          .get();
        return (snap as any).docs || [];
      }
    };

    const healthyPromises = V1_RECONCILABLE_TRANSITION_STATUSES.map((st) => fetchBucketDocs(st));
    const attentionPromises = V1_RECONCILABLE_TRANSITION_STATUSES.map((st) => fetchLiveAttentionDocs(st));

    const [healthyResults, attentionResults] = await Promise.all([
      Promise.all(healthyPromises),
      Promise.all(attentionPromises),
    ]);

    // Função de ordenação determinística para os documentos de cada bucket
    const sortCandidates = (docs: any[]): any[] => {
      return [...docs].sort(compareTransitionsLRR);
    };

    // Remove registros que requerem intervenção manual dos buckets operacionais automáticos
    const filterHealthy = (docs: any[]): any[] => {
      return docs.filter((d) => {
        const data = typeof d.data === 'function' ? d.data() : d;
        return data.financial_attention_required !== true;
      });
    };

    // Anti-starvation de terminais no attention bucket:
    // Transições terminais (completed, canceled, failed, superseded, safe_terminal)
    // não podem monopolizar o attention bucket antes do limit operacional
    const filterLiveAttention = (docs: any[]): any[] => {
      return docs.filter((d) => {
        const data = typeof d.data === 'function' ? d.data() : d;
        const status = data.transition_status || data.status;
        const safety = data.financial_safety_status;
        return (
          safety !== 'safe_terminal' &&
          !SAFE_TERMINAL_TRANSITION_STATUSES.includes(status)
        );
      });
    };

    // Fair Round-Robin interleaving entre os sub-buckets de live attention para evitar viés de status em atenção
    const sortedAttentionSubBuckets = attentionResults.map((docs) =>
      sortCandidates(filterLiveAttention(docs))
    );
    const sortedAttention: any[] = [];
    let attAdded = true;
    let attRound = 0;
    while (sortedAttention.length < limitCount && attAdded) {
      attAdded = false;
      for (const attSub of sortedAttentionSubBuckets) {
        if (attRound < attSub.length) {
          sortedAttention.push(attSub[attRound]);
          attAdded = true;
          if (sortedAttention.length >= limitCount) break;
        }
      }
      attRound++;
    }

    // Multi-bucket fair round-robin interleaving:
    // Garante que nenhum bucket monopolize o lote e nenhum sofra starvation.
    const buckets = [
      ...healthyResults.map((docs) => sortCandidates(filterHealthy(docs))),
      sortedAttention,
    ];

    const seenIds = new Set<string>();
    const results: BillingPlanChangeRecord[] = [];
    let addedInRound = true;
    let roundIdx = 0;

    while (results.length < limitCount && addedInRound) {
      addedInRound = false;
      for (const bucket of buckets) {
        if (roundIdx < bucket.length) {
          const doc = bucket[roundIdx];
          const data = typeof doc.data === 'function' ? doc.data() : doc;
          const id = data.id || doc.id;
          if (!seenIds.has(id)) {
            seenIds.add(id);
            results.push(data as BillingPlanChangeRecord);
            if (results.length >= limitCount) break;
          }
          addedInRound = true;
        }
      }
      roundIdx++;
    }

    return results;
  }

  /**
   * Bloqueia/Aluga atomicamente uma transição de plano para reconciliação ou retry seguro contra concorrência multi-instância
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
        last_reconciled_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      };

      t.set(docRef, updatedRecord, { merge: true });
      return updatedRecord;
    });
  }

  /**
   * Bloqueia/Aluga atomicamente uma transição V1 para reconciliação automática
   */
  async claimTransitionForReconciliation(
    transitionId: string,
    lockWorkerId: string,
    lockDurationMs: number = 60000
  ): Promise<BillingTransitionV1Record | null> {
    const docRef = this.planChangesCollection.doc(transitionId);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) return null;

      const data = doc.data() as BillingTransitionV1Record;

      // Se a transição já for terminal segura e não tiver pendências financeiras, skip
      if (data.financial_safety_status === 'safe_terminal' && data.transition_status === 'completed') {
        return null;
      }

      // Hard block: transição que requer atenção financeira manual nunca é processada automaticamente
      if (data.financial_attention_required === true) {
        return null;
      }

      const now = Date.now();
      if (data.retry_locked_until) {
        const lockUntil = new Date(data.retry_locked_until).getTime();
        if (lockUntil > now && data.retry_locked_by !== lockWorkerId) {
          return null;
        }
      }

      const updatedRecord: BillingTransitionV1Record = {
        ...data,
        retry_locked_until: new Date(now + lockDurationMs).toISOString(),
        retry_locked_by: lockWorkerId,
        retry_count: (data.retry_count || 0) + 1,
        last_retry_at: new Date(now).toISOString(),
        last_reconciled_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      };

      t.set(docRef, updatedRecord, { merge: true });
      return updatedRecord;
    });
  }

  /**
   * Libera o bloqueio de uma transição de plano.
   * Não altera last_reconciled_at (a única autoridade de agendamento é atribuída no claim).
   */
  async releasePlanChangeLock(id: string): Promise<void> {
    const docRef = this.planChangesCollection.doc(id);
    const nowIso = new Date().toISOString();
    await docRef.set(
      {
        retry_locked_until: null,
        retry_locked_by: null,
        last_reconciled_at: nowIso,
        updated_at: nowIso,
      },
      { merge: true }
    );
  }

  // --------------------------------------------------------------------------
  // Transactions
  // --------------------------------------------------------------------------

  async getTransaction(
    providerOrId: BillingProviderName | string,
    providerPaymentId?: string
  ): Promise<BillingTransactionRecord | null> {
    const docId = providerPaymentId ? `${providerOrId}_${providerPaymentId}` : providerOrId;
    const doc = await this.transactionsCollection.doc(docId).get();
    if (doc.exists) {
      return doc.data() as BillingTransactionRecord;
    }
    return null;
  }

  async saveTransaction(transaction: BillingTransactionRecord): Promise<void> {
    const docRef = this.transactionsCollection.doc(transaction.id);
    await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (doc.exists) {
        const existing = doc.data() as BillingTransactionRecord;

        // Proteção Canônica de Data Financeira (Imutabilidade de paid_billing_date)
        if (
          existing.paid_billing_date &&
          transaction.paid_billing_date &&
          existing.paid_billing_date !== transaction.paid_billing_date
        ) {
          throw new AppError(
            409,
            `Conflito de data financeira comercial para a transação ${transaction.id}: existente (${existing.paid_billing_date}) diverge da recebida (${transaction.paid_billing_date}).`,
            { code: 'CONFLICTING_FINANCIAL_DATE' }
          );
        }

        // Proteção Canônica de Valor Financeiro (Imutabilidade de amount_cents)
        if (
          existing.amount_cents !== undefined &&
          transaction.amount_cents !== undefined &&
          existing.amount_cents !== transaction.amount_cents
        ) {
          throw new AppError(
            409,
            `Conflito de valor financeiro comercial para a transação ${transaction.id}: existente (${existing.amount_cents}) diverge da recebida (${transaction.amount_cents}).`,
            { code: 'CONFLICTING_FINANCIAL_AMOUNT' }
          );
        }

        const merged: BillingTransactionRecord = {
          ...existing,
          ...transaction,
          paid_billing_date: existing.paid_billing_date || transaction.paid_billing_date || null,
          created_at: existing.created_at || transaction.created_at,
          updated_at: transaction.updated_at || new Date().toISOString(),
        };
        t.set(docRef, merged, { merge: true });
      } else {
        t.set(docRef, transaction, { merge: true });
      }
    });
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

/**
 * Retorna o timestamp numérico de reconciliação para LRR.
 * Invariante canônica (Seção 2 e 13): missing e null são semanticamente equivalentes a never reconciled (0).
 */
export function getTransitionReconciliationTimestamp(tr: any): number {
  if (!tr || tr.last_reconciled_at === undefined || tr.last_reconciled_at === null) {
    return 0; // Never reconciled = maior prioridade
  }
  const time = new Date(tr.last_reconciled_at).getTime();
  return isNaN(time) ? 0 : time;
}

/**
 * Retorna o timestamp numérico de criação com fallback seguro para documentos legados sem created_at (Seção 14).
 */
export function getTransitionCreationTimestamp(tr: any): number {
  if (!tr || tr.created_at === undefined || tr.created_at === null) {
    return 0; // Fallback determinístico
  }
  const time = new Date(tr.created_at).getTime();
  return isNaN(time) ? 0 : time;
}

/**
 * Comparador canônico determinístico triplo para o algoritmo LRR (Least Recently Reconciled).
 * 1. last_reconciled_at ASC (missing/null tratados identicamente como 0)
 * 2. created_at ASC (missing/null tratados como 0)
 * 3. id ASC (tiebreak estável lexicográfico)
 */
export function compareTransitionsLRR(aDoc: any, bDoc: any): number {
  const a = typeof aDoc?.data === 'function' ? aDoc.data() : aDoc;
  const b = typeof bDoc?.data === 'function' ? bDoc.data() : bDoc;

  const aRecon = getTransitionReconciliationTimestamp(a);
  const bRecon = getTransitionReconciliationTimestamp(b);
  if (aRecon !== bRecon) return aRecon - bRecon;

  const aCreated = getTransitionCreationTimestamp(a);
  const bCreated = getTransitionCreationTimestamp(b);
  if (aCreated !== bCreated) return aCreated - bCreated;

  const aId = a?.id || aDoc?.id || '';
  const bId = b?.id || bDoc?.id || '';
  return aId.localeCompare(bId);
}
