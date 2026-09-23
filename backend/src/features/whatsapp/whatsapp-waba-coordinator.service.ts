import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppProvider } from './whatsapp.types';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';

/**
 * R7-B2.3R — HIGH 3: distinguish an AUTHORITATIVE provider rejection from transport uncertainty.
 *
 * A subscribe mutation is only a "confirmed failure" (safe to retry) when the provider returned an
 * authoritative response proving the mutation did not succeed. Any transport/network/timeout/abort
 * failure — or an error that does not explicitly carry an authoritative rejection marker — leaves the
 * remote outcome UNKNOWN and MUST be recorded as ambiguity debt (never settled by provider
 * idempotency assumptions).
 */
export function isAuthoritativeProviderRejection(err: any): boolean {
  const details = err?.details;
  if (err?.name === 'AbortError') {
    return false;
  }
  if (err?.code === 'WHATSAPP_PROVIDER_TIMEOUT' || details?.code === 'WHATSAPP_PROVIDER_TIMEOUT') {
    return false;
  }
  if (details?.transportUncertainty === true) {
    return false;
  }
  return details?.providerRejection === true;
}

export class WhatsAppWabaCoordinatorService {
  constructor(
    private readonly lockRepo: WhatsAppWabaLifecycleLockRepository = new WhatsAppWabaLifecycleLockRepository(),
    private readonly provider: WhatsAppProvider = new MetaWhatsAppProvider(),
    private readonly reconJobRepo: WhatsAppWabaReconciliationJobRepository = new WhatsAppWabaReconciliationJobRepository()
  ) {}

  /**
   * Coordinates Step 9 of Onboarding with Active Re-Assertion Protocol (DEC-7D-56, DEC-7D-63, DEC-7D-66).
   * 1. Transactionally acquires 120s WABA lifecycle lease on lock_meta_${wabaId} with incremented
   *    generation, rejecting any unresolved subscribe ambiguity IN THE SAME transaction (R7-B2.3R HIGH 4).
   * 2. Outside transaction, dispatches POST /{waba_id}/subscribed_apps.
   * 3. On a DEFINITE provider rejection (explicit provider semantics, never HTTP presence alone), the lease is released as idle
   *    (safe retry). On transport/timeout/abort/unknown outcome, the mutation is recorded as
   *    'unknown_outcome' in the bounded multi-generation ledger (enforcing P0 overflow fail-closed
   *    safety).
   */
  async coordinateOnboardingSubscription(
    wabaIdOrParams: string | { wabaId: string; accessToken: string; sessionId: string; connectionId: string },
    sessionId?: string,
    connectionId?: string,
    dispatchAction?: () => Promise<void>
  ): Promise<{ generation: number; leaseToken: string }> {
    let wabaId: string;
    let sId: string;
    let cId: string;
    let action: () => Promise<void>;

    if (typeof wabaIdOrParams === 'object') {
      wabaId = wabaIdOrParams.wabaId;
      sId = wabaIdOrParams.sessionId;
      cId = wabaIdOrParams.connectionId;
      action = () => this.provider.subscribeMessagingAccountApps(wabaIdOrParams.accessToken, wabaId);
    } else {
      wabaId = wabaIdOrParams;
      sId = sessionId!;
      cId = connectionId!;
      action = dispatchAction!;
    }

    const holderId = `onboarding_session_${sId}`;

    // 1. Transactional Lease Acquisition + ambiguity linearization (R7-B2.3R HIGH 4).
    let generation: number;
    let leaseToken: string;
    try {
      const acquired = await db.runTransaction(async (tx) => {
        return await this.lockRepo.acquireLeaseInTransaction(tx, {
          wabaId,
          holderId,
          desiredState: 'subscribed',
          leaseDurationSeconds: 120,
          rejectUnresolvedSubscribeAmbiguity: true,
        });
      });
      generation = acquired.generation;
      leaseToken = acquired.leaseToken;
    } catch (err: any) {
      const code = err?.code || err?.details?.code;
      if (err instanceof AppError && code === 'WABA_SUBSCRIBE_OUTCOME_UNRESOLVED') {
        // Fail closed into the existing durable D7 reconciliation owner (idempotent).
        try {
          await this.reconJobRepo.ensureJobPending(wabaId);
        } catch {
          // Non-blocking: the ambiguity guard already blocked provider dispatch.
        }
      }
      throw err;
    }

    // 2. Dispatch Meta Call outside transaction
    try {
      await action();
    } catch (err: any) {
      // R7-B2.3R — HIGH 3: only an AUTHORITATIVE provider response proves the mutation did not
      // succeed. Everything else (transport/timeout/abort/no authoritative response) is UNKNOWN and
      // must leave ambiguity debt instead of becoming a confirmed failure.
      const isAmbiguousOutcome = !isAuthoritativeProviderRejection(err);

      if (isAmbiguousOutcome) {
        try {
          await db.runTransaction(async (tx) => {
            await this.lockRepo.recordUnknownOutcomeInTransaction(tx, {
              wabaId,
              generation,
              leaseToken,
              operation: 'subscribe',
              connectionId: cId,
              auditNote: `Onboarding subscription dispatch error: ${err?.message || 'unknown'}`,
            });
          });
          // R7-B2.3R — HIGH 3: any recorded transport-uncertain subscribe attempt MUST have a
          // durable D7 reconciliation owner so convergence is never lost.
          await this.reconJobRepo.ensureJobPending(wabaId);
        } catch (innerErr: any) {
          console.error('[WABA COORDINATOR] Failed to record unknown outcome in ledger:', innerErr);
        }
      } else {
        try {
          await db.runTransaction(async (tx) => {
            await this.lockRepo.releaseLeaseInTransaction(tx, {
              wabaId,
              generation,
              leaseToken,
            });
          });
        } catch (innerErr: any) {
          console.error('[WABA COORDINATOR] Failed to release lease after confirmed failure:', innerErr);
        }
      }

      throw err;
    }

    return { generation, leaseToken };
  }
}
