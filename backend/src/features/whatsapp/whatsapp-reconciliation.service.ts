import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';
import { WhatsAppProvider, WhatsAppWabaReconciliationJobRecord } from './whatsapp.types';
import { AppError } from '../../middleware/error-handler';
import { db } from '../../lib/firebase';
import { WhatsAppExecutionDeadline } from './whatsapp-execution-deadline';

export interface ReconciliationExecutionSummary {
  candidateCount: number;
  processedCount: number;
  stableCount: number;
  repairedCount: number;
  failedCount: number;
  skippedCount: number;
}

export class WhatsAppReconciliationService {
  constructor(
    private readonly reconJobRepo: WhatsAppWabaReconciliationJobRepository = new WhatsAppWabaReconciliationJobRepository(),
    private readonly wabaLockRepo: WhatsAppWabaLifecycleLockRepository = new WhatsAppWabaLifecycleLockRepository(),
    private readonly connectionRepo: WhatsAppConnectionRepository = new WhatsAppConnectionRepository(),
    private readonly secretRepo: WhatsAppConnectionSecretRepository = new WhatsAppConnectionSecretRepository(),
    private readonly encryptionService: WhatsAppEncryptionService = new WhatsAppEncryptionService(),
    private readonly metaProvider: WhatsAppProvider = new MetaWhatsAppProvider()
  ) {}

  async executeDueJobs(options: {
    batchSize?: number;
    softBudgetMs?: number;
    acquisitionCutoffMs?: number;
    deadline?: WhatsAppExecutionDeadline;
  } = {}): Promise<ReconciliationExecutionSummary> {
    const batchSize = Math.min(Math.max(1, options.batchSize ?? 10), 25);
    const softBudgetMs = options.softBudgetMs ?? 20_000;
    const acquisitionCutoffMs = options.acquisitionCutoffMs ?? 15_000;
    const startTime = Date.now();
    const deadline =
      options.deadline ??
      new WhatsAppExecutionDeadline({
        startTime,
        budgetMs: options.softBudgetMs ? options.softBudgetMs + 4_000 : 24_000,
        safetyMarginMs: 1_500,
      });

    const candidateJobs = await this.reconJobRepo.findDueJobs(batchSize);

    const summary: ReconciliationExecutionSummary = {
      candidateCount: candidateJobs.length,
      processedCount: 0,
      stableCount: 0,
      repairedCount: 0,
      failedCount: 0,
      skippedCount: 0,
    };

    for (const candidate of candidateJobs) {
      if (
        Date.now() - startTime > acquisitionCutoffMs ||
        Date.now() - startTime > softBudgetMs ||
        deadline.isExpired() ||
        !deadline.hasRemaining(3_000)
      ) {
        summary.skippedCount++;
        continue;
      }

      try {
        const outcome = await this.processSingleJob(candidate, deadline);
        summary.processedCount++;
        if (outcome === 'stable') summary.stableCount++;
        else if (outcome === 'repaired') summary.repairedCount++;
        else if (outcome === 'failed') summary.failedCount++;
        else summary.skippedCount++;
      } catch (err) {
        summary.skippedCount++;
      }
    }

    return summary;
  }

  private async processSingleJob(
    candidate: WhatsAppWabaReconciliationJobRecord,
    deadline?: WhatsAppExecutionDeadline
  ): Promise<'stable' | 'repaired' | 'failed' | 'skipped'> {
    const activeDeadline =
      deadline ??
      new WhatsAppExecutionDeadline({
        budgetMs: 24_000,
        safetyMarginMs: 1_500,
      });

    // 1. Acquire Job Lease (5 minutes)
    const jobLeaseToken = await this.reconJobRepo.acquireJobLeaseInTransaction(candidate.id, 5 * 60 * 1000);
    if (!jobLeaseToken) {
      return 'skipped';
    }

    // Check remaining budget before acquiring WABA lock
    if (!activeDeadline.hasRemaining(3_000)) {
      await this.reconJobRepo.recordJobFailureInTransaction(
        candidate.id,
        jobLeaseToken,
        'INSUFFICIENT_EXECUTION_BUDGET'
      );
      return 'skipped';
    }

    const wabaId = candidate.provider_waba_id;

    // 2. Acquire WABA Lifecycle Lock Lease (120 seconds)
    let wabaLeaseResult;
    try {
      wabaLeaseResult = await this.wabaLockRepo.acquireLeaseInTransaction(
        wabaId,
        candidate.id,
        120 * 1000,
        'reconciling'
      );
    } catch (err: any) {
      if (err instanceof AppError && err.statusCode === 409) {
        return 'skipped';
      }
      throw err;
    }

    const { leaseToken: wabaLeaseToken, generation: acquiredGen, lock } = wabaLeaseResult;

    try {
      // 3. Derive Current Desired State
      const activeDeps = await this.connectionRepo.findActivePlatformDependencies(wabaId);
      const desiredState: 'subscribed' | 'unsubscribed' = activeDeps.length > 0 ? 'subscribed' : 'unsubscribed';

      // 4. Locate usable credential for this WABA
      const snap = await db
        .collection('whatsapp_connections')
        .where('provider_waba_id', '==', wabaId)
        .limit(5)
        .get();

      let accessToken: string | null = null;
      for (const doc of snap.docs) {
        const connData = doc.data();
        const secret = await this.secretRepo.getSecret(connData.organization_id, doc.id);
        if (secret) {
          try {
            accessToken = this.encryptionService.decryptToken(secret, connData.organization_id, doc.id);
            break;
          } catch {
            // Try next
          }
        }
      }

      if (!accessToken) {
        // No secret found to query Meta
        await this.reconJobRepo.recordJobFailureInTransaction(candidate.id, jobLeaseToken, 'NO_USABLE_CREDENTIAL');
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen);
        return 'failed';
      }

      // 5. Query Current Remote State
      let observedState: 'subscribed' | 'unsubscribed' | 'unproven' = 'unproven';
      const queryTimeout = activeDeadline.getClampedTimeoutMs(10_000, 1_500);
      if (queryTimeout <= 0) {
        observedState = 'unproven';
      } else {
        try {
          const proof = await this.metaProvider.checkMessagingAccountSubscribedApps(accessToken, wabaId, {
            timeoutMs: queryTimeout,
            deadlineAt: activeDeadline.deadlineAt,
          });
          if (proof.status === 'PROVEN_SUBSCRIBED' || proof.proof === 'STILL_SUBSCRIBED' || proof.isSubscribed === true) {
            observedState = 'subscribed';
          } else if (proof.status === 'PROVEN_UNSUBSCRIBED' || proof.proof === 'PROVEN_CLEAN') {
            observedState = 'unsubscribed';
          }
        } catch {
          observedState = 'unproven';
        }
      }

      if (observedState === 'unproven') {
        // Transient error
        await this.reconJobRepo.recordJobFailureInTransaction(candidate.id, jobLeaseToken, 'UNPROVEN_REMOTE_STATE');
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen);
        return 'failed';
      }

      // 6. Compare & Repair Drift
      if (desiredState === observedState) {
        // Current desired state confirmed matching observed state
        await this.reconJobRepo.recordJobSuccessInTransaction(candidate.id, jobLeaseToken);
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          desired_subscription_state: desiredState,
          provider_observed_state: observedState,
          provider_observed_at: new Date().toISOString(),
          provider_observed_generation: acquiredGen,
          operation_status: 'idle',
        });
        return 'stable';
      } else {
        // Drift detected!
        // Enforce deadline check before dispatching repair mutation (Section 7)
        const repairTimeout = activeDeadline.getClampedTimeoutMs(
          desiredState === 'subscribed' ? 15_000 : 10_000,
          2_000
        );

        let repairUncertain = false;

        if (repairTimeout > 0) {
          if (desiredState === 'subscribed' && observedState === 'unsubscribed') {
            try {
              await this.metaProvider.subscribeMessagingAccountApps(accessToken, wabaId, {
                timeoutMs: repairTimeout,
                deadlineAt: activeDeadline.deadlineAt,
              });
            } catch (err: any) {
              if (err?.code === 'WHATSAPP_PROVIDER_TIMEOUT' || err?.name === 'AbortError') {
                repairUncertain = true;
              }
            }
          } else if (desiredState === 'unsubscribed' && observedState === 'subscribed') {
            try {
              const res = await this.metaProvider.unsubscribeMessagingAccountApps(accessToken, wabaId, {
                timeoutMs: repairTimeout,
                deadlineAt: activeDeadline.deadlineAt,
              });
              if (!res.success) {
                repairUncertain = true;
              }
            } catch (err: any) {
              if (err?.code === 'WHATSAPP_PROVIDER_TIMEOUT' || err?.name === 'AbortError') {
                repairUncertain = true;
              }
            }
          }
        }

        // Section 6: If provider mutation was dispatched and outcome cannot be confirmed authoritatively before deadline
        if (repairUncertain) {
          await this.wabaLockRepo.recordUnknownOutcomeInTransaction(wabaId, {
            operation_generation: acquiredGen,
            operation: desiredState === 'subscribed' ? 'subscribe' : 'unsubscribe',
            connection_id: 'reconciliation_repair',
          });
        }

        await this.reconJobRepo.recordJobFailureInTransaction(candidate.id, jobLeaseToken, 'DRIFT_DETECTED');
        try {
          await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
            desired_subscription_state: desiredState,
            operation_status: repairUncertain ? 'unknown_outcome' : 'idle',
          });
        } catch {
          // Lease already cleared if recordUnknownOutcomeInTransaction ran
        }
        return 'repaired';
      }
    } finally {
      try {
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen);
      } catch {
        // Ignored
      }
    }
  }
}
