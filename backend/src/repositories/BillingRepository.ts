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
} from '../features/billing/billing.types';

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
   * Busca transições V1 que necessitam de reconciliação (resultado incerto, atenção financeira ou pendentes)
   */
  async getV1TransitionsNeedingReconciliation(
    provider: BillingProviderName,
    limitCount: number = 20
  ): Promise<BillingPlanChangeRecord[]> {
    const attentionSnapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('financial_attention_required', '==', true)
      .limit(limitCount)
      .get();

    const pendingFutureSnapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('transition_status', '==', 'pending_future_authorization')
      .limit(limitCount)
      .get();

    const targetPreparedSnapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('transition_status', '==', 'future_target_prepared')
      .limit(limitCount)
      .get();

    const awaitingInactivationSnapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('transition_status', '==', 'awaiting_old_inactivation')
      .limit(limitCount)
      .get();

    const scheduledSnapshot = await this.planChangesCollection
      .where('provider', '==', provider)
      .where('transition_status', '==', 'scheduled')
      .limit(limitCount)
      .get();

    const seenIds = new Set<string>();
    const results: BillingPlanChangeRecord[] = [];

    for (const doc of [
      ...attentionSnapshot.docs,
      ...pendingFutureSnapshot.docs,
      ...targetPreparedSnapshot.docs,
      ...awaitingInactivationSnapshot.docs,
      ...scheduledSnapshot.docs,
    ]) {
      if (!seenIds.has(doc.id)) {
        seenIds.add(doc.id);
        results.push(doc.data() as BillingPlanChangeRecord);
      }
    }

    return results.slice(0, limitCount);
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
    id: string,
    lockWorkerId: string,
    lockDurationMs: number = 60000
  ): Promise<BillingTransitionV1Record | null> {
    const docRef = this.planChangesCollection.doc(id);

    return await db.runTransaction(async (t: any) => {
      const doc = await t.get(docRef);
      if (!doc.exists) return null;

      const data = doc.data() as BillingPlanChangeRecord;
      if (!isBillingTransitionV1(data)) return null;

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
