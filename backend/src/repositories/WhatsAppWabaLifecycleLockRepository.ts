import { db } from '../lib/firebase';
import crypto from 'crypto';
import { AppError } from '../middleware/error-handler';
import {
  WhatsAppWabaLifecycleLockRecord,
  WhatsAppUnresolvedRemoteMutation,
} from '../features/whatsapp/whatsapp.types';

/**
 * R7-B2.3 — D7 subscribe-ambiguity predicate.
 *
 * A WABA lifecycle lock represents an UNRESOLVED remote subscribe attempt when:
 *  - `operation_status === 'in_flight'` (the process may have dispatched the Meta call and died
 *    before persisting the local `waba_subscribed` checkpoint), or
 *  - `operation_status === 'unknown_outcome'` (a timeout/abort left the outcome undetermined), or
 *  - the bounded ledger still carries an unresolved `subscribe` mutation.
 *
 * This is a READ-ONLY predicate over the existing D7 uncertainty representation. It never invents
 * a second uncertainty system and never settles anything by itself: callers must route convergence
 * to the existing durable reconciliation job (`recon_meta_${wabaId}`).
 */
export function hasUnresolvedWabaSubscribeAmbiguity(
  lock: WhatsAppWabaLifecycleLockRecord | null | undefined
): boolean {
  if (!lock) {
    return false;
  }
  if (lock.operation_status === 'in_flight' || lock.operation_status === 'unknown_outcome') {
    return true;
  }
  return (lock.unresolved_remote_mutations || []).some(
    (m) => m.operation === 'subscribe' && m.status === 'unknown_outcome'
  );
}

export class WhatsAppWabaLifecycleLockRepository {
  private readonly locksCol = db.collection('whatsapp_waba_lifecycle_locks');

  getLockRef(wabaId: string): FirebaseFirestore.DocumentReference {
    return this.locksCol.doc(`lock_meta_${wabaId}`);
  }

  async getLock(
    wabaId: string,
    tx?: FirebaseFirestore.Transaction
  ): Promise<WhatsAppWabaLifecycleLockRecord | null> {
    const docRef = this.getLockRef(wabaId);
    const doc = tx ? await tx.get(docRef) : await docRef.get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppWabaLifecycleLockRecord;
  }

  async acquireLeaseInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: any,
    arg3?: any,
    arg4?: any,
    arg5?: any
  ): Promise<{
    generation: number;
    leaseToken: string;
    lock: WhatsAppWabaLifecycleLockRecord;
  }> {
    const isStandalone = typeof arg1 === 'string';

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      let wabaId: string;
      let holderId: string;
      let desiredState: 'subscribed' | 'unsubscribed';
      let durationSeconds: number;
      let operationStatus: 'idle' | 'in_flight' | 'unknown_outcome' = 'in_flight';
      let rejectUnresolvedSubscribeAmbiguity = false;

      if (isStandalone) {
        wabaId = arg1 as string;
        holderId = arg2 as string;
        durationSeconds = typeof arg3 === 'number' ? Math.ceil(arg3 / 1000) : 120;
        operationStatus = (arg4 as 'idle' | 'in_flight' | 'unknown_outcome') || 'in_flight';
        desiredState = arg5 || 'subscribed';
      } else {
        const params = arg2 as {
          wabaId: string;
          holderId: string;
          desiredState: 'subscribed' | 'unsubscribed';
          leaseDurationSeconds?: number;
          rejectUnresolvedSubscribeAmbiguity?: boolean;
        };
        wabaId = params.wabaId;
        holderId = params.holderId;
        desiredState = params.desiredState;
        durationSeconds = params.leaseDurationSeconds || 120;
        rejectUnresolvedSubscribeAmbiguity = params.rejectUnresolvedSubscribeAmbiguity === true;
      }

      const docRef = this.getLockRef(wabaId);
      const doc = await tx.get(docRef);
      const now = new Date();
      const nowIso = now.toISOString();

      let currentLock: WhatsAppWabaLifecycleLockRecord | null = null;
      if (doc.exists) {
        currentLock = { id: doc.id, ...doc.data() } as WhatsAppWabaLifecycleLockRecord;
      }

      if (currentLock?.lease_expires_at) {
        const leaseExpiresAt = new Date(currentLock.lease_expires_at);
        if (leaseExpiresAt > now) {
          throw new AppError(
            409,
            'WABA_LIFECYCLE_CONTENTION: O coordenador de ciclo de vida da WABA está bloqueado por outra operação ativa.',
            {
              code: 'WABA_LIFECYCLE_CONTENTION',
              retryAfter: 5,
            }
          );
        }
      }

      // R7-B2.3R — HIGH 4: linearize the "no unresolved subscribe ambiguity" decision with lease
      // acquisition. A stale pre-flight read MUST NOT be the sole safety gate. If an unresolved
      // subscribe attempt exists (in_flight / unknown_outcome / ledger debt), this generation MUST
      // NOT dispatch a new subscribe mutation. Fail closed into existing D7 reconciliation ownership.
      if (rejectUnresolvedSubscribeAmbiguity && hasUnresolvedWabaSubscribeAmbiguity(currentLock)) {
        throw new AppError(
          409,
          'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED: Uma tentativa anterior de assinatura da WABA possui resultado remoto não resolvido. A convergência pertence ao reconciliador D7.',
          { code: 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED' }
        );
      }

      const nextGeneration = (currentLock?.operation_generation || 0) + 1;
      const leaseToken = crypto.randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + durationSeconds * 1000).toISOString();

      const updatedLock: WhatsAppWabaLifecycleLockRecord = {
        id: `lock_meta_${wabaId}`,
        provider: 'meta',
        provider_waba_id: wabaId,
        operation_generation: nextGeneration,
        desired_subscription_state: desiredState,
        operation_status: operationStatus,
        current_holder_id: holderId,
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        provider_observed_state: currentLock?.provider_observed_state || 'unknown',
        provider_observed_at: currentLock?.provider_observed_at || null,
        provider_observed_generation: currentLock?.provider_observed_generation || null,
        unresolved_remote_mutations: currentLock?.unresolved_remote_mutations || [],
        last_settled_at: currentLock?.last_settled_at || null,
        created_at: currentLock?.created_at || nowIso,
        updated_at: nowIso,
      };

      tx.set(docRef, updatedLock);

      return {
        generation: nextGeneration,
        leaseToken,
        lock: updatedLock,
      };
    };

    if (isStandalone) {
      return await db.runTransaction(handler);
    } else {
      return await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }

  async releaseLeaseInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: any,
    arg3?: any,
    arg4?: any
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      let wabaId: string;
      let leaseToken: string;
      let generation: number;
      let observedState: any;
      let desiredState: any;
      let operationStatus: any = 'idle';

      if (isStandalone) {
        wabaId = arg1 as string;
        leaseToken = arg2 as string;
        generation = arg3 as number;
        const updates = arg4 || {};
        observedState = updates.provider_observed_state;
        desiredState = updates.desired_subscription_state;
        operationStatus = updates.operation_status || 'idle';
      } else {
        const params = arg2 as {
          wabaId: string;
          generation: number;
          leaseToken: string;
          observedState?: 'subscribed' | 'unsubscribed';
          desiredState?: 'subscribed' | 'unsubscribed';
        };
        wabaId = params.wabaId;
        leaseToken = params.leaseToken;
        generation = params.generation;
        observedState = params.observedState;
        desiredState = params.desiredState;
      }

      const docRef = this.getLockRef(wabaId);
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        return;
      }

      const lock = doc.data() as WhatsAppWabaLifecycleLockRecord;
      const nowIso = new Date().toISOString();

      if (lock.operation_generation !== generation || lock.lease_token !== leaseToken) {
        throw new AppError(
          409,
          'WABA_LIFECYCLE_LEASE_LOST: Geração ou token de lease da WABA divergente. Writeback abortado.',
          { code: 'WABA_LIFECYCLE_LEASE_LOST' }
        );
      }

      tx.update(docRef, {
        operation_status: operationStatus,
        lease_token: null,
        lease_expires_at: null,
        current_holder_id: null,
        last_settled_at: nowIso,
        provider_observed_state: observedState || lock.provider_observed_state,
        provider_observed_at: observedState ? nowIso : lock.provider_observed_at,
        provider_observed_generation: observedState ? generation : lock.provider_observed_generation,
        desired_subscription_state: desiredState || lock.desired_subscription_state,
        updated_at: nowIso,
      });
    };

    if (isStandalone) {
      await db.runTransaction(handler);
    } else {
      await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }

  /**
   * Records a provider observation while retaining the exact current WABA lease. This is the D7
   * non-destructive checkpoint between external proof and later destructive local settlement.
   */
  async recordProviderObservedStateInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: any,
    arg3?: any,
    arg4?: any
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const handler = async (tx: FirebaseFirestore.Transaction) => {
      let wabaId: string;
      let generation: number;
      let leaseToken: string;
      let observedState: 'subscribed' | 'unsubscribed';

      if (isStandalone) {
        wabaId = arg1 as string;
        leaseToken = arg2 as string;
        generation = arg3 as number;
        observedState = arg4 as 'subscribed' | 'unsubscribed';
      } else {
        const params = arg2 as {
          wabaId: string;
          generation: number;
          leaseToken: string;
          observedState: 'subscribed' | 'unsubscribed';
        };
        wabaId = params.wabaId;
        generation = params.generation;
        leaseToken = params.leaseToken;
        observedState = params.observedState;
      }

      const docRef = this.getLockRef(wabaId);
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        throw new AppError(409, 'WABA_SETTLEMENT_EVIDENCE_INVALID: Lock de ciclo de vida da WABA não encontrado.', {
          code: 'WABA_SETTLEMENT_EVIDENCE_INVALID',
        });
      }

      const lock = doc.data() as WhatsAppWabaLifecycleLockRecord;
      if (
        lock.provider_waba_id !== wabaId ||
        lock.operation_generation !== generation ||
        lock.lease_token !== leaseToken
      ) {
        throw new AppError(
          409,
          'WABA_LIFECYCLE_LEASE_LOST: Geração ou token de lease da WABA divergente. Observação do provedor rejeitada.',
          { code: 'WABA_LIFECYCLE_LEASE_LOST' }
        );
      }

      const nowIso = new Date().toISOString();
      tx.update(docRef, {
        provider_observed_state: observedState,
        provider_observed_at: nowIso,
        provider_observed_generation: generation,
        updated_at: nowIso,
      });
    };

    if (isStandalone) {
      await db.runTransaction(handler);
    } else {
      await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }

  async recordUnknownOutcomeInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: any
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      let wabaId: string;
      let generation: number;
      let leaseToken: string | null = null;
      let operation: 'subscribe' | 'unsubscribe';
      let connectionId: string;
      let auditNote: string | undefined;

      if (isStandalone) {
        wabaId = arg1 as string;
        generation = arg2.operation_generation;
        operation = arg2.operation;
        connectionId = arg2.connection_id;
        auditNote = arg2.audit_note;
      } else {
        const params = arg2 as {
          wabaId: string;
          generation: number;
          leaseToken: string;
          operation: 'subscribe' | 'unsubscribe';
          connectionId: string;
          auditNote?: string;
        };
        wabaId = params.wabaId;
        generation = params.generation;
        leaseToken = params.leaseToken;
        operation = params.operation;
        connectionId = params.connectionId;
        auditNote = params.auditNote;
      }

      const docRef = this.getLockRef(wabaId);
      const doc = await tx.get(docRef);
      const nowIso = new Date().toISOString();

      let lock: WhatsAppWabaLifecycleLockRecord;
      if (!doc.exists) {
        lock = {
          id: `lock_meta_${wabaId}`,
          provider: 'meta',
          provider_waba_id: wabaId,
          operation_generation: generation,
          desired_subscription_state: operation === 'subscribe' ? 'subscribed' : 'unsubscribed',
          operation_status: 'unknown_outcome',
          current_holder_id: null,
          lease_token: null,
          lease_expires_at: null,
          provider_observed_state: 'unknown',
          provider_observed_at: null,
          provider_observed_generation: null,
          unresolved_remote_mutations: [],
          last_settled_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        tx.set(docRef, lock);
      } else {
        lock = doc.data() as WhatsAppWabaLifecycleLockRecord;
        if (leaseToken && (lock.operation_generation !== generation || lock.lease_token !== leaseToken)) {
          throw new AppError(
            409,
            'WABA_LIFECYCLE_LEASE_LOST: Geração ou token de lease divergente.',
            { code: 'WABA_LIFECYCLE_LEASE_LOST' }
          );
        }
      }

      let mutations = [...(lock.unresolved_remote_mutations || [])];

      // P0 Ledger Capacity & Saturation Check (DEC-7D-65 & Section 14)
      if (mutations.length >= 20) {
        const settledIndices = mutations
          .map((m, idx) => (m.status === 'settled' ? idx : -1))
          .filter((idx) => idx !== -1);

        if (settledIndices.length === 0) {
          throw new AppError(
            500,
            'WABA_UNCERTAINTY_LEDGER_SATURATED: O livro-razão de incertezas atingiu o limite de 20 registros não liquidados. Descarte silencioso proibido.',
            { code: 'WABA_UNCERTAINTY_LEDGER_SATURATED' }
          );
        }

        const oldestSettledIndex = settledIndices[0];
        mutations.splice(oldestSettledIndex, 1);
      }

      const newMutation: WhatsAppUnresolvedRemoteMutation = {
        operation_generation: generation,
        operation,
        dispatched_at: nowIso,
        status: 'unknown_outcome',
        connection_id: connectionId,
        audit_note: auditNote,
      };

      mutations.push(newMutation);

      tx.update(docRef, {
        operation_status: 'unknown_outcome',
        lease_token: null,
        lease_expires_at: null,
        current_holder_id: null,
        unresolved_remote_mutations: mutations,
        updated_at: nowIso,
      });
    };

    if (isStandalone) {
      await db.runTransaction(handler);
    } else {
      await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }

  async forceAbandonOverrideInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: string,
    arg3?: string
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const wabaId = isStandalone ? arg1 : arg2;
    const overrideReason = isStandalone ? arg2 : arg3!;

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      const docRef = this.getLockRef(wabaId);
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        return;
      }

      const lock = doc.data() as WhatsAppWabaLifecycleLockRecord;
      const nowIso = new Date().toISOString();

      const mutations = (lock.unresolved_remote_mutations || []).map((m) => ({
        ...m,
        status: 'settled' as const,
        audit_note: `force_abandon: ${overrideReason}`,
      }));

      tx.update(docRef, {
        operation_status: 'idle',
        lease_token: null,
        lease_expires_at: null,
        current_holder_id: null,
        desired_subscription_state: 'unsubscribed',
        unresolved_remote_mutations: mutations,
        last_settled_at: nowIso,
        updated_at: nowIso,
      });
    };

    if (isStandalone) {
      await db.runTransaction(handler);
    } else {
      await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }
}
