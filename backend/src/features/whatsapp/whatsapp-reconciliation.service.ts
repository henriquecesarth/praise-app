import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';
import { WhatsAppProvider, WhatsAppWabaReconciliationJobRecord } from './whatsapp.types';
import { AppError } from '../../middleware/error-handler';
import { db } from '../../lib/firebase';

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
  } = {}): Promise<ReconciliationExecutionSummary> {
    const batchSize = Math.min(Math.max(1, options.batchSize ?? 10), 25);
    const softBudgetMs = options.softBudgetMs ?? 20_000;
    const acquisitionCutoffMs = options.acquisitionCutoffMs ?? 15_000;
    const startTime = Date.now();

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
      if (Date.now() - startTime > acquisitionCutoffMs || Date.now() - startTime > softBudgetMs) {
        summary.skippedCount++;
        continue;
      }

      try {
        const outcome = await this.processSingleJob(candidate);
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
    candidate: WhatsAppWabaReconciliationJobRecord
  ): Promise<'stable' | 'repaired' | 'failed' | 'skipped'> {
    // 1. Acquire Job Lease (5 minutes)
    const jobLeaseToken = await this.reconJobRepo.acquireJobLeaseInTransaction(candidate.id, 5 * 60 * 1000);
    if (!jobLeaseToken) {
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
      try {
        const proof = await this.metaProvider.checkMessagingAccountSubscribedApps(accessToken, wabaId);
        if (proof.status === 'PROVEN_SUBSCRIBED') {
          observedState = 'subscribed';
        } else if (proof.status === 'PROVEN_UNSUBSCRIBED') {
          observedState = 'unsubscribed';
        }
      } catch {
        observedState = 'unproven';
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
        if (desiredState === 'subscribed' && observedState === 'unsubscribed') {
          try {
            await this.metaProvider.subscribeMessagingAccountApps(accessToken, wabaId);
          } catch {
            // Repair failed
          }
        } else if (desiredState === 'unsubscribed' && observedState === 'subscribed') {
          try {
            await this.metaProvider.unsubscribeMessagingAccountApps(accessToken, wabaId);
          } catch {
            // Repair failed
          }
        }

        await this.reconJobRepo.recordJobFailureInTransaction(candidate.id, jobLeaseToken, 'DRIFT_DETECTED');
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          desired_subscription_state: desiredState,
          operation_status: 'idle',
        });
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
