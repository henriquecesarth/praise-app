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
import { ZernioHttpClient } from './zernio-http-client';
import { ZernioError } from './zernio.types';

import { WhatsAppExecutionDeadline } from './whatsapp-execution-deadline';

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
    private readonly metaProvider: WhatsAppProvider = new MetaWhatsAppProvider(),
    private readonly zernioClient: ZernioHttpClient = new ZernioHttpClient()
  ) {}

  async executeDueJobs(options: {
    batchSize?: number;
    softBudgetMs?: number;
    acquisitionCutoffMs?: number;
    deadline?: WhatsAppExecutionDeadline;
  } = {}): Promise<CleanupExecutionSummary> {
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
    candidate: WhatsAppProviderCleanupJobRecord,
    deadline?: WhatsAppExecutionDeadline
  ): Promise<'succeeded' | 'cancelled' | 'retry_wait' | 'exhausted' | 'skipped'> {
    const activeDeadline =
      deadline ??
      new WhatsAppExecutionDeadline({
        budgetMs: 24_000,
        safetyMarginMs: 1_500,
      });

    // 1. Acquire Job Lease (5 minutes)
    const jobLeaseToken = await this.cleanupJobRepo.acquireJobLeaseInTransaction(candidate.id, 5 * 60 * 1000);
    if (!jobLeaseToken) {
      return 'skipped';
    }

    if (candidate.provider === 'zernio') {
      return await this.processSingleZernioJob(candidate, jobLeaseToken, activeDeadline);
    }

    // Check remaining budget before acquiring WABA lock
    if (!activeDeadline.hasRemaining(3_000)) {
      await this.cleanupJobRepo.recordRetryWaitInTransaction(
        candidate.id,
        jobLeaseToken,
        new Date().toISOString(),
        'INSUFFICIENT_EXECUTION_BUDGET'
      );
      return 'skipped';
    }

    if (!candidate.provider_waba_id) {
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
              const reassertTimeout = activeDeadline.getClampedTimeoutMs(15_000, 2_000);
              if (reassertTimeout > 0) {
                await this.metaProvider.subscribeMessagingAccountApps(token, wabaId, {
                  timeoutMs: reassertTimeout,
                  deadlineAt: activeDeadline.deadlineAt,
                });
              }
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
      // Enforce deadline check BEFORE attempt reservation and before mutation dispatch (Section 7, Section 10)
      if (!activeDeadline.hasRemaining(3_000)) {
        await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
          operation_status: 'idle',
        });
        await this.cleanupJobRepo.recordRetryWaitInTransaction(
          candidate.id,
          jobLeaseToken,
          new Date().toISOString(),
          'INSUFFICIENT_EXECUTION_BUDGET'
        );
        return 'skipped';
      }

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

      const deleteTimeout = activeDeadline.getClampedTimeoutMs(10_000, 1_500);
      if (deleteTimeout <= 0) {
        ambiguousDelete = true;
        deleteErrorCode = 'INSUFFICIENT_EXECUTION_BUDGET';
      } else {
        try {
          const res = await this.metaProvider.unsubscribeMessagingAccountApps(accessToken, wabaId, {
            timeoutMs: deleteTimeout,
            deadlineAt: activeDeadline.deadlineAt,
          });
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
        // Only run verification if deadline allows (Section 8)
        if (!activeDeadline.hasRemaining(2_000)) {
          isProvenClean = false;
          deleteErrorCode = deleteErrorCode || 'VERIFICATION_BUDGET_EXHAUSTED';
        } else {
          try {
            const verifyTimeout = activeDeadline.getClampedTimeoutMs(10_000, 1_000);
            const proof = await this.metaProvider.checkMessagingAccountSubscribedApps(accessToken, wabaId, {
              timeoutMs: verifyTimeout,
              deadlineAt: activeDeadline.deadlineAt,
            });
            if (proof.status === 'PROVEN_UNSUBSCRIBED' || proof.proof === 'PROVEN_CLEAN') {
              isProvenClean = true;
            } else if (proof.status === 'PROVEN_SUBSCRIBED' || proof.proof === 'STILL_SUBSCRIBED') {
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

        try {
          await this.wabaLockRepo.releaseLeaseInTransaction(wabaId, wabaLeaseToken, acquiredGen, {
            operation_status: 'unknown_outcome',
          });
        } catch {
          // Lease already cleared by recordUnknownOutcomeInTransaction
        }

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
      wabaId: job.provider_waba_id || undefined,
    });

    // Force abandon lock uncertainty for this connection
    if (job.provider_waba_id) {
      await this.wabaLockRepo.forceAbandonOverrideInTransaction(job.provider_waba_id, options.overrideReason);
    }

    await this.cleanupJobRepo.abandonJob(jobId, options.overrideReason, 'internal_operator');

    const updated = await this.cleanupJobRepo.getJobById(jobId);
    return updated!;
  }

  private async processSingleZernioJob(
    candidate: WhatsAppProviderCleanupJobRecord,
    jobLeaseToken: string,
    activeDeadline: WhatsAppExecutionDeadline
  ): Promise<'succeeded' | 'cancelled' | 'retry_wait' | 'exhausted' | 'skipped'> {
    // 1. Budget check
    if (!activeDeadline.hasRemaining(3_000)) {
      await this.cleanupJobRepo.recordRetryWaitInTransaction(
        candidate.id,
        jobLeaseToken,
        new Date().toISOString(),
        'INSUFFICIENT_EXECUTION_BUDGET'
      );
      return 'skipped';
    }

    // 2. Tenant & Connection state validation
    const conn = await this.connectionRepo.getConnectionById(candidate.connection_id);
    if (!conn || conn.organization_id !== candidate.organization_id) {
      // Cross-tenant mismatch or missing connection: complete as cancelled
      await this.cleanupJobRepo.completeJobInTransaction(
        candidate.id,
        jobLeaseToken,
        'cancelled',
        'not_needed'
      );
      return 'cancelled';
    }

    if (conn.status !== 'disconnected') {
      // Connection is not disconnected; cleanup is not needed or cancelled
      await this.cleanupJobRepo.completeJobInTransaction(
        candidate.id,
        jobLeaseToken,
        'cancelled',
        'not_needed'
      );
      return 'cancelled';
    }

    const accountId = candidate.provider_account_id || conn.provider_account_id;
    const profileId = candidate.provider_profile_id || conn.provider_profile_id;

    // 3. If no provider account ID, it was never materialized remotely
    if (!accountId || !profileId) {
      await this.cleanupJobRepo.settleZernioCleanupInTransaction(candidate.id, jobLeaseToken);
      return 'succeeded';
    }

    // 4. Pre-cleanup presence check (if candidate has prior attempts or unknown mutations)
    const hasPriorUnknown = candidate.unresolved_remote_mutations?.some(
      (m) => m.status === 'unknown_outcome'
    );
    if (hasPriorUnknown || candidate.attempt_count > 0) {
      try {
        const accounts = await this.zernioClient.listAccounts(
          {
            profileId,
            platform: 'whatsapp',
            page: 1,
            limit: 10,
            includeOverLimit: true,
          },
          { deadline: activeDeadline }
        );
        const isPresent = accounts.some((a) => a._id === accountId);
        if (!isPresent) {
          // Account already absent from Zernio: strong settlement proof!
          await this.cleanupJobRepo.settleZernioCleanupInTransaction(candidate.id, jobLeaseToken);
          return 'succeeded';
        }
      } catch (checkErr: any) {
        // If check failed with transient error, proceed to attempt reservation
      }
    }

    // 5. Pre-call attempt reservation
    const reserveResult = await this.cleanupJobRepo.reserveAttemptInTransaction(
      candidate.id,
      jobLeaseToken
    );
    if (typeof reserveResult === 'object' && !reserveResult.reserved) {
      return 'exhausted';
    }

    // 6. Check budget after reservation
    if (!activeDeadline.hasRemaining(3_000)) {
      await this.cleanupJobRepo.recordRetryWaitInTransaction(
        candidate.id,
        jobLeaseToken,
        new Date().toISOString(),
        'INSUFFICIENT_EXECUTION_BUDGET'
      );
      return 'skipped';
    }

    // 7. Execute remote DELETE /v1/accounts/{accountId}
    try {
      await this.zernioClient.deleteAccount(accountId, { deadline: activeDeadline });
      // HTTP 200 OK -> Confirmed cleanup proof! Strong settlement!
      await this.cleanupJobRepo.settleZernioCleanupInTransaction(candidate.id, jobLeaseToken);
      return 'succeeded';
    } catch (err: any) {
      return await this.handleZernioDeleteError(
        candidate,
        jobLeaseToken,
        accountId,
        profileId,
        err,
        activeDeadline
      );
    }
  }

  private async handleZernioDeleteError(
    candidate: WhatsAppProviderCleanupJobRecord,
    jobLeaseToken: string,
    accountId: string,
    profileId: string,
    err: any,
    activeDeadline: WhatsAppExecutionDeadline
  ): Promise<'succeeded' | 'retry_wait' | 'exhausted'> {
    // Case A: 404 Not Found -> Verify absence via listAccounts({ includeOverLimit: true })
    if (err.statusCode === 404 || err.kind === 'NOT_FOUND') {
      try {
        const accounts = await this.zernioClient.listAccounts(
          {
            profileId,
            platform: 'whatsapp',
            page: 1,
            limit: 10,
            includeOverLimit: true,
          },
          { deadline: activeDeadline }
        );
        const isPresent = accounts.some((a) => a._id === accountId);
        if (!isPresent) {
          // Verified absence: Strong settlement proof!
          await this.cleanupJobRepo.settleZernioCleanupInTransaction(candidate.id, jobLeaseToken);
          return 'succeeded';
        } else {
          // DELETE returned 404 but account is still present in listing: ambiguous
          const backoffSeconds = this.resolveBackoffSeconds(candidate.attempt_count + 1);
          await this.cleanupJobRepo.recordRetryWaitInTransaction(
            candidate.id,
            jobLeaseToken,
            {
              errorCode: 'ZERNIO_DELETE_404_STILL_PRESENT',
              errorMessage: 'Zernio DELETE retornou 404 mas conta ainda consta na listagem.',
              nextAttemptSeconds: backoffSeconds,
            }
          );
          return 'retry_wait';
        }
      } catch (probeErr: any) {
        const backoffSeconds = this.resolveBackoffSeconds(candidate.attempt_count + 1);
        await this.cleanupJobRepo.recordRetryWaitInTransaction(
          candidate.id,
          jobLeaseToken,
          {
            errorCode: 'ZERNIO_DELETE_404_PROBE_FAILED',
            errorMessage: probeErr.message || 'Falha ao verificar ausência após 404',
            nextAttemptSeconds: backoffSeconds,
          }
        );
        return 'retry_wait';
      }
    }

    // Case B: 429 Rate Limited
    if (err.statusCode === 429 || err.kind === 'RATE_LIMITED') {
      const retryAfter = (err instanceof ZernioError && err.retryAfterSeconds) ? err.retryAfterSeconds : 60;
      await this.cleanupJobRepo.recordRetryWaitInTransaction(
        candidate.id,
        jobLeaseToken,
        {
          errorCode: 'RATE_LIMITED',
          errorMessage: err.message,
          nextAttemptSeconds: retryAfter,
        }
      );
      return 'retry_wait';
    }

    // Case C: 401 / 403 Auth Error
    if (err.statusCode === 401 || err.statusCode === 403 || err.kind === 'AUTH') {
      if (candidate.attempt_count + 1 >= candidate.max_attempts) {
        await this.cleanupJobRepo.recordExhaustionInTransaction(candidate.id, jobLeaseToken, {
          errorCode: 'ZERNIO_AUTH_ERROR',
          errorMessage: err.message,
        });
        return 'exhausted';
      }
      const backoffSeconds = this.resolveBackoffSeconds(candidate.attempt_count + 1);
      await this.cleanupJobRepo.recordRetryWaitInTransaction(
        candidate.id,
        jobLeaseToken,
        {
          errorCode: 'ZERNIO_AUTH_ERROR',
          errorMessage: err.message,
          nextAttemptSeconds: backoffSeconds,
        }
      );
      return 'retry_wait';
    }

    // Case D: 400 / 422 Validation Error
    if (err.statusCode === 400 || err.statusCode === 422 || err.kind === 'VALIDATION') {
      await this.cleanupJobRepo.recordExhaustionInTransaction(candidate.id, jobLeaseToken, {
        errorCode: 'ZERNIO_VALIDATION_ERROR',
        errorMessage: err.message,
      });
      return 'exhausted';
    }

    // Case E: 5xx, Timeout, Network Error, Indeterminate
    const backoffSeconds = this.resolveBackoffSeconds(candidate.attempt_count + 1);
    await this.cleanupJobRepo.recordUnresolvedMutationInTransaction(
      candidate.id,
      jobLeaseToken,
      {
        operation: 'delete_account',
        errorCode: err.kind || 'TIMEOUT',
        errorMessage: err.message,
        nextAttemptSeconds: backoffSeconds,
        auditNote: `deleteAccount falhou: ${err.message || 'resultado indeterminado'}`,
      }
    );

    // If budget permits, probe presence
    if (activeDeadline.hasRemaining(2_000)) {
      try {
        const accounts = await this.zernioClient.listAccounts(
          {
            profileId,
            platform: 'whatsapp',
            page: 1,
            limit: 10,
            includeOverLimit: true,
          },
          { deadline: activeDeadline }
        );
        const isPresent = accounts.some((a) => a._id === accountId);
        if (!isPresent) {
          const newLeaseToken = await this.cleanupJobRepo.acquireJobLeaseInTransaction(candidate.id, 60_000);
          if (newLeaseToken) {
            await this.cleanupJobRepo.settleZernioCleanupInTransaction(candidate.id, newLeaseToken);
            return 'succeeded';
          }
        }
      } catch {
        // Probe failed, remain in retry_wait
      }
    }

    return 'retry_wait';
  }

  private resolveBackoffSeconds(attemptCount: number): number {
    const idx = Math.min(Math.max(0, attemptCount), CLEANUP_BACKOFF_SCHEDULE_MS.length - 1);
    return Math.max(5, Math.floor(CLEANUP_BACKOFF_SCHEDULE_MS[idx] / 1000));
  }
}
