import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppProvider } from './whatsapp.types';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';

export class WhatsAppWabaCoordinatorService {
  constructor(
    private readonly lockRepo: WhatsAppWabaLifecycleLockRepository = new WhatsAppWabaLifecycleLockRepository(),
    private readonly provider: WhatsAppProvider = new MetaWhatsAppProvider()
  ) {}

  /**
   * Coordinates Step 9 of Onboarding with Active Re-Assertion Protocol (DEC-7D-56, DEC-7D-63, DEC-7D-66).
   * 1. Transactionally acquires 120s WABA lifecycle lease on lock_meta_${wabaId} with incremented generation.
   * 2. Outside transaction, dispatches POST /{waba_id}/subscribed_apps.
   * 3. On provider failure or timeout, transactionally records mutation as 'unknown_outcome' in the
   *    bounded multi-generation ledger (enforcing P0 overflow fail-closed safety).
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

    // 1. Transactional Lease Acquisition
    const { generation, leaseToken } = await db.runTransaction(async (tx) => {
      return await this.lockRepo.acquireLeaseInTransaction(tx, {
        wabaId,
        holderId,
        desiredState: 'subscribed',
        leaseDurationSeconds: 120,
      });
    });

    // 2. Dispatch Meta Call outside transaction
    try {
      await action();
    } catch (err: any) {
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
      } catch (innerErr: any) {
        console.error('[WABA COORDINATOR] Failed to record unknown outcome in ledger:', innerErr);
      }

      throw err;
    }

    return { generation, leaseToken };
  }
}
