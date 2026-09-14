import crypto from 'crypto';
import { WhatsAppProviderCleanupJobRepository } from '../../repositories/WhatsAppProviderCleanupJobRepository';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';
import { WhatsAppProvider, WhatsAppProviderCleanupJobRecord } from './whatsapp.types';
import { AppError } from '../../middleware/error-handler';

export const CLEANUP_BACKOFF_SCHEDULE_MS = [
  0,
  60 * 1000,          // 1 minute
  5 * 60 * 1000,      // 5 minutes
  30 * 60 * 1000,     // 30 minutes
  2 * 60 * 60 * 1000, // 2 hours
];

export interface CleanupExecutionSummary {
  candidateCount: number;
  processedCount: number;
  succeededCount: number;
  cancelledCount: number;
  retryWaitCount: number;
  exhaustedCount: number;
  skippedCount: number;
}

export class WhatsAppCleanupService {
  constructor(
    private readonly cleanupJobRepo: WhatsAppProviderCleanupJobRepository = new WhatsAppProviderCleanupJobRepository(),
    private readonly wabaLockRepo: WhatsAppWabaLifecycleLockRepository = new WhatsAppWabaLifecycleLockRepository(),
    private readonly reconJobRepo: WhatsAppWabaReconciliationJobRepository = new WhatsAppWabaReconciliationJobRepository(),
    private readonly connectionRepo: WhatsAppConnectionRepository = new WhatsAppConnectionRepository(),
    private readonly secretRepo: WhatsAppConnectionSecretRepository = new WhatsAppConnectionSecretRepository(),
    private readonly encryptionService: WhatsAppEncryptionService = new WhatsAppEncryptionService(),
    private readonly metaProvider: WhatsAppProvider = new MetaWhatsAppProvider()
  ) {}

  async executeDueJobs(options: {
    batchSize?: number;
    softBudgetMs?: number;
    acquisitionCutoffMs?: number;
  } = {}): Promise<CleanupExecutionSummary> {
    const batchSize = Math.min(Math.max(1, options.batchSize ?? 10), 25);
    const softBudgetMs = options.softBudgetMs ?? 20_000;
    const acquisitionCutoffMs = options.acquisitionCutoffMs ?? 15_000;

    const startTime = Date.now();
    const candidateJobs = await this.cleanupJobRepo.findDueJobs(batchSize);

    const summary: CleanupExecutionSummary = {
      candidateCount: candidateJobs.length,
      processedCount: 0,
      succeededCount: 0,
      cancelledCount: 0,
      retryWaitCount: 0,
      exhaustedCount: 0,
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
        if (outcome === 'succeeded') summary.succeededCount++;
        else if (outcome === 'cancelled') summary.cancelledCount++;
        else if (outcome === 'retry_wait') summary.retryWaitCount++;
        else if (outcome === 'exhausted') summary.exhaustedCount++;
        else summary.skippedCount++;
      } catch (err) {
        summary.skippedCount++;
      }
    }

    return summary;
  }

  private async processSingleJob(
    candidate: WhatsAppProviderCleanupJobRecord
  ): Promise<'succeeded' | 'cancelled' | 'retry_wait' | 'exhausted' | 'skipped'> {
    // 1. Acquire Job Lease (5 minutes)
    const jobLeaseToken = await this.cleanupJobRepo.acquireJobLeaseInTransaction(candidate.id, 5 * 60 * 1000);
    if (!jobLeaseToken) {
      return 'skipped';
    }

    const wabaId = candidate.provider_waba_id;

    // 2. Acquire WABA Lifecycle Lock Lease (120 seconds)
    const holderId = `cleanup_conn_${candidate.connection_id}`;
    let wabaLeaseResult;
    try {
      wabaLeaseResult = await this.wabaLockRepo.acquireLeaseInTransaction(
        wabaId,
        holderId,
        120 * 1000,
        'reconciling'
      );
    } catch (err: any) {
      if (err instanceof AppError && err.statusCode === 409) {
        // Contention: release job lease with short retry wait
        const nextAttempt = new Date(Date.now() + 5000).toISOString();
        await this.cleanupJobRepo.recordRetryWaitInTransaction(
          candidate.id,
          jobLeaseToken,
          nextAttempt,
          'WABA_LIFECYCLE_CONTENTION'
        );
        return 'retry_wait';
      }
      throw err;
    }

    const { leaseToken: wabaLeaseToken, generation: acquiredGen, lock } = wabaLeaseResult;

    try {
      // 3. Recompute Dependencies Strictly Post-Lock (DEC-7D-56, DEC-7D-68)
      const survivingDeps = await this.connectionRepo.findActivePlatformDependencies(
        wabaId,
        candidate.connection_id
      );

      if (survivingDeps.length > 0) {
        // Surviving lines exist -> desired state is 'subscribed'.
        // If there's pending unsubscribe uncertainty, actively re-assert POST to protect surviving lines!
        if (lock.unresolved_remote_mutations.some((m) => m.operation === 'unsubscribe' && m.status === 'unknown_outcome')) {
          const secret = await this.secretRepo.getSecret(candidate.organization_id, candidate.connection_id);
          if (secret) {
            try {
              const token = this.encryptionService.decryptToken(secret, candidate.organization_id, candidate.connection_id);
              await this.metaProvider.subscribeMessagingAccountApps(token, wabaId);
            } catch {
              // Best effort re-assertion; durable reconciler will verify
            }
          }
        }

        // Release WABA lease
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          desired_subscription_state: 'subscribed',
          operation_status: 'idle',
        });

        // Cancel cleanup job (NO_PROVIDER_CLEANUP_NEEDED)
        await this.cleanupJobRepo.completeJobInTransaction(
          candidate.id,
          jobLeaseToken,
          'cancelled',
          'proven'
        );

        // Safe to delete secret because surviving lines have their own secrets
        await this.secretRepo.deleteSecret(candidate.organization_id, candidate.connection_id, {
          wabaId,
        });

        return 'cancelled';
      }

      // Zero surviving dependencies -> Desired state is 'unsubscribed'!
      // 4. Pre-Call Attempt Reservation (DEC-7D-50)
      const reservation = await this.cleanupJobRepo.reserveAttemptInTransaction(candidate.id, jobLeaseToken);
      if (!reservation.reserved) {
        // Max retries exceeded prior to call
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          operation_status: 'idle',
        });
        return 'exhausted';
      }

      const currentAttempt = reservation.currentAttemptCount;

      // 5. Decrypt Token for Meta Call
      const secretRecord = await this.secretRepo.getSecret(candidate.organization_id, candidate.connection_id);
      if (!secretRecord) {
        // Credential missing -> exhausted with AUTH_LOST
        await this.cleanupJobRepo.recordExhaustionInTransaction(
          candidate.id,
          jobLeaseToken,
          'AUTH_LOST'
        );
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          operation_status: 'idle',
        });
        return 'exhausted';
      }

      let accessToken: string;
      try {
        accessToken = this.encryptionService.decryptToken(
          secretRecord,
          candidate.organization_id,
          candidate.connection_id
        );
      } catch (err) {
        await this.cleanupJobRepo.recordExhaustionInTransaction(
          candidate.id,
          jobLeaseToken,
          'SECRET_DECRYPTION_FAILED'
        );
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          operation_status: 'idle',
        });
        return 'exhausted';
      }

      // 6. Provider Unsubscribe Execution
      let deleteSuccess = false;
      let ambiguousDelete = false;
      let deleteErrorCode: string | null = null;
      let authLost = false;

      try {
        const res = await this.metaProvider.unsubscribeMessagingAccountApps(accessToken, wabaId);
        if (res.success) {
          deleteSuccess = true;
        } else {
          ambiguousDelete = true;
        }
      } catch (err: any) {
        const msg = String(err?.message || '');
        if (msg.includes('401') || msg.includes('190') || msg.includes('403') || msg.includes('TOKEN_EXPIRED')) {
          authLost = true;
          deleteErrorCode = 'AUTH_LOST';
        } else if (msg.includes('400')) {
          deleteErrorCode = 'INVALID_CONTAINER';
          authLost = true; // Non-retryable
        } else {
          ambiguousDelete = true;
          deleteErrorCode = err?.code || 'META_API_ERROR';
        }
      }

      if (authLost) {
        await this.cleanupJobRepo.recordExhaustionInTransaction(
          candidate.id,
          jobLeaseToken,
          deleteErrorCode || 'AUTH_LOST'
        );
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          operation_status: 'idle',
        });
        return 'exhausted';
      }

      // If ambiguous, perform authoritative post-condition verification with exhaustive pagination
      let isProvenClean = false;
      if (deleteSuccess) {
        isProvenClean = true;
      } else if (ambiguousDelete) {
        try {
          const proof = await this.metaProvider.checkMessagingAccountSubscribedApps(accessToken, wabaId);
          if (proof.status === 'PROVEN_UNSUBSCRIBED') {
            isProvenClean = true;
          } else if (proof.status === 'PROVEN_SUBSCRIBED') {
            isProvenClean = false;
            deleteErrorCode = 'APP_STILL_SUBSCRIBED';
          } else {
            isProvenClean = false;
            deleteErrorCode = 'UNPROVEN_CLEAN';
          }
        } catch (err: any) {
          isProvenClean = false;
          deleteErrorCode = 'POST_CONDITION_CHECK_FAILED';
        }
      }

      // 7. Post-Provider Writeback & Fencing
      if (isProvenClean) {
        // Check if there is unresolved subscribe debt
        const hasUnresolvedSubscribe = lock.unresolved_remote_mutations.some(
          (m) => m.operation === 'subscribe' && m.status === 'unknown_outcome'
        );

        if (hasUnresolvedSubscribe) {
          // STRICT SECRET RETENTION INVARIANT (DEC-7D-64)
          // Secret purge is strictly prohibited while subscribe debt exists!
          await this.cleanupJobRepo.recordExhaustionInTransaction(
            candidate.id,
            jobLeaseToken,
            'UNRESOLVED_REMOTE_SUBSCRIBE_DEBT'
          );
          await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
            desired_subscription_state: 'unsubscribed',
            provider_observed_state: 'unsubscribed',
            operation_status: 'idle',
          });
          // Trigger reconciler to eventually settle subscribe debt
          await this.reconJobRepo.ensureJobPending(wabaId);
          return 'exhausted';
        }

        // Clean unsubscription confirmed & zero subscribe debt: Succeeded!
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          desired_subscription_state: 'unsubscribed',
          provider_observed_state: 'unsubscribed',
          operation_status: 'idle',
        });

        await this.cleanupJobRepo.completeJobInTransaction(
          candidate.id,
          jobLeaseToken,
          'succeeded',
          'proven'
        );

        // Purge secret immediately
        await this.secretRepo.deleteSecret(candidate.organization_id, candidate.connection_id, {
          wabaId,
        });

        return 'succeeded';
      } else {
        // Failed / Unproven
        // Record unknown outcome in ledger & ensure reconciliation job is active
        await this.wabaLockRepo.recordUnknownOutcomeInTransaction(wabaId, {
          operation_generation: acquiredGen,
          operation: 'unsubscribe',
          connection_id: candidate.connection_id,
        });

        await this.reconJobRepo.ensureJobPending(wabaId);

        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          operation_status: 'unknown_outcome',
        });

        if (currentAttempt < candidate.max_attempts) {
          const backoffMs = CLEANUP_BACKOFF_SCHEDULE_MS[currentAttempt] ?? (2 * 60 * 60 * 1000);
          const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();
          await this.cleanupJobRepo.recordRetryWaitInTransaction(
            candidate.id,
            jobLeaseToken,
            nextAttemptAt,
            deleteErrorCode || 'UNPROVEN_CLEAN'
          );
          return 'retry_wait';
        } else {
          // Terminal retry exhaustion (DEC-7D-41, DEC-7D-51):
          // Secret is STRICTLY RETAINED encrypted; retention_expires_at = null
          await this.cleanupJobRepo.recordExhaustionInTransaction(
            candidate.id,
            jobLeaseToken,
            'MAX_RETRIES_EXCEEDED'
          );
          return 'exhausted';
        }
      }
    } finally {
      // Ensure WABA lock is not left abandoned if an unhandled error occurred
      try {
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen);
      } catch {
        // Already released or expired
      }
    }
  }

  async retryJob(
    jobId: string,
    operatorId: string,
    reason?: string
  ): Promise<WhatsAppProviderCleanupJobRecord> {
    const job = await this.cleanupJobRepo.getJobById(jobId);
    if (!job) {
      throw new AppError(404, 'CLEANUP_JOB_NOT_FOUND: Job de cleanup não encontrado.', {
        code: 'CLEANUP_JOB_NOT_FOUND',
      });
    }

    if (job.status === 'processing') {
      const now = new Date();
      if (job.lease_expires_at && new Date(job.lease_expires_at) > now) {
        throw new AppError(409, 'JOB_CURRENTLY_PROCESSING: Job está sendo processado por um worker ativo.', {
          code: 'JOB_CURRENTLY_PROCESSING',
        });
      }
    }

    if (job.status !== 'exhausted' && job.status !== 'cancelled') {
      throw new AppError(400, `Job em status '${job.status}' não pode ser reiniciado. Apenas 'exhausted' ou 'cancelled'.`, {
        code: 'INVALID_JOB_STATUS_FOR_RETRY',
      });
    }

    await this.cleanupJobRepo.updateJob(jobId, {
      status: 'pending',
      attempt_count: 0,
      next_attempt_at: new Date().toISOString(),
      lease_token: null,
      lease_expires_at: null,
      last_error_code: null,
      manual_action_by: 'internal_operator',
      manual_action_at: new Date().toISOString(),
      manual_action_reason: reason || 'Operator retry request',
    });

    const updated = await this.cleanupJobRepo.getJobById(jobId);
    return updated!;
  }

  async abandonJob(
    jobId: string,
    options: { forceAbandon?: boolean; overrideReason?: string }
  ): Promise<WhatsAppProviderCleanupJobRecord> {
    const job = await this.cleanupJobRepo.getJobById(jobId);
    if (!job) {
      throw new AppError(404, 'CLEANUP_JOB_NOT_FOUND: Job de cleanup não encontrado.', {
        code: 'CLEANUP_JOB_NOT_FOUND',
      });
    }

    if (job.status === 'processing') {
      const now = new Date();
      if (job.lease_expires_at && new Date(job.lease_expires_at) > now) {
        throw new AppError(409, 'JOB_CURRENTLY_PROCESSING: Job está sendo processado por um worker ativo.', {
          code: 'JOB_CURRENTLY_PROCESSING',
        });
      }
    }

    if (job.status !== 'exhausted') {
      throw new AppError(409, 'JOB_NOT_EXHAUSTED: Apenas jobs exaustos podem ser abandonados pelo operador.', {
        code: 'JOB_NOT_EXHAUSTED',
      });
    }

    if (!options.forceAbandon || !options.overrideReason || options.overrideReason.trim().length < 10) {
      throw new AppError(
        400,
        'OVERRIDE_REASON_REQUIRED: O abandono manual requer force_abandon=true e override_reason de no mínimo 10 caracteres.',
        { code: 'OVERRIDE_REASON_REQUIRED' }
      );
    }

    // Force purge secret with override
    await this.secretRepo.deleteSecret(job.organization_id, job.connection_id, {
      force: true,
      overrideReason: options.overrideReason,
      wabaId: job.provider_waba_id,
    });

    // Force abandon lock uncertainty for this connection
    await this.wabaLockRepo.forceAbandonOverrideInTransaction(job.provider_waba_id, options.overrideReason);

    await this.cleanupJobRepo.abandonJob(jobId, options.overrideReason, 'internal_operator');

    const updated = await this.cleanupJobRepo.getJobById(jobId);
    return updated!;
  }
}
