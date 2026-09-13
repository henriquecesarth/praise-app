import { db } from '../lib/firebase';
import crypto from 'crypto';
import { AppError } from '../middleware/error-handler';
import { WhatsAppProviderCleanupJobRecord } from '../features/whatsapp/whatsapp.types';

export class WhatsAppProviderCleanupJobRepository {
  private readonly jobsCol = db.collection('whatsapp_provider_cleanup_jobs');

  getJobRef(jobId: string): FirebaseFirestore.DocumentReference {
    return this.jobsCol.doc(jobId);
  }

  async getJob(jobId: string): Promise<WhatsAppProviderCleanupJobRecord | null> {
    const doc = await this.getJobRef(jobId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppProviderCleanupJobRecord;
  }

  async getJobById(jobId: string): Promise<WhatsAppProviderCleanupJobRecord | null> {
    return this.getJob(jobId);
  }

  async updateJob(
    jobId: string,
    data: Partial<WhatsAppProviderCleanupJobRecord>
  ): Promise<void> {
    const docRef = this.getJobRef(jobId);
    await docRef.update({
      ...data,
      updated_at: new Date().toISOString(),
    });
  }

  async createJob(
    job: WhatsAppProviderCleanupJobRecord,
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.getJobRef(job.id);
    if (tx) {
      tx.set(docRef, job);
    } else {
      await docRef.set(job);
    }
  }

  async findDueJobs(limitCount: number = 10): Promise<WhatsAppProviderCleanupJobRecord[]> {
    const nowIso = new Date().toISOString();

    // Query A: pending or retry_wait due
    const queryA = await this.jobsCol
      .where('status', 'in', ['pending', 'retry_wait'])
      .where('next_attempt_at', '<=', nowIso)
      .limit(limitCount)
      .get();

    const jobsA = queryA.docs.map(
      (d) => ({ id: d.id, ...d.data() } as WhatsAppProviderCleanupJobRecord)
    );

    if (jobsA.length >= limitCount) {
      return jobsA;
    }

    // Query B: expired processing leases
    const remaining = limitCount - jobsA.length;
    const queryB = await this.jobsCol
      .where('status', '==', 'processing')
      .where('lease_expires_at', '<=', nowIso)
      .limit(remaining)
      .get();

    const jobsB = queryB.docs.map(
      (d) => ({ id: d.id, ...d.data() } as WhatsAppProviderCleanupJobRecord)
    );

    return [...jobsA, ...jobsB];
  }

  async acquireJobLeaseInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2?: string | number,
    arg3?: number
  ): Promise<any> {
    if (typeof arg1 === 'string') {
      const jobId = arg1;
      const durationMs = typeof arg2 === 'number' ? arg2 : 300_000;
      return await db.runTransaction(async (tx) => {
        const docRef = this.getJobRef(jobId);
        const doc = await tx.get(docRef);
        if (!doc.exists) return null;

        const job = doc.data() as WhatsAppProviderCleanupJobRecord;
        const now = new Date();

        if (job.status === 'processing' && job.lease_expires_at) {
          if (new Date(job.lease_expires_at) > now) {
            return null; // Contention
          }
        }

        const leaseToken = crypto.randomUUID();
        const leaseExpiresAt = new Date(now.getTime() + durationMs).toISOString();
        const nowIso = now.toISOString();

        tx.update(docRef, {
          status: 'processing',
          lease_token: leaseToken,
          lease_expires_at: leaseExpiresAt,
          updated_at: nowIso,
        });

        return leaseToken;
      });
    }

    const tx = arg1 as FirebaseFirestore.Transaction;
    const jobId = arg2 as string;
    const durationSeconds = typeof arg3 === 'number' ? arg3 : 300;

    const docRef = this.getJobRef(jobId);
    const doc = await tx.get(docRef);
    if (!doc.exists) {
      throw new AppError(404, 'Cleanup job não encontrado.');
    }

    const job = { id: doc.id, ...doc.data() } as WhatsAppProviderCleanupJobRecord;
    const now = new Date();

    if (job.status === 'processing' && job.lease_expires_at) {
      if (new Date(job.lease_expires_at) > now) {
        throw new AppError(409, 'JOB_CURRENTLY_PROCESSING: Cleanup job já possui lease ativo.', {
          code: 'JOB_CURRENTLY_PROCESSING',
        });
      }
    }

    const leaseToken = crypto.randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + durationSeconds * 1000).toISOString();
    const nowIso = now.toISOString();

    tx.update(docRef, {
      status: 'processing',
      lease_token: leaseToken,
      lease_expires_at: leaseExpiresAt,
      updated_at: nowIso,
    });

    return {
      leaseToken,
      job: {
        ...job,
        status: 'processing',
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        updated_at: nowIso,
      },
    };
  }

  // Pre-call attempt reservation (DEC-7D-50)
  async reserveAttemptInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: string,
    arg3?: string
  ): Promise<any> {
    if (typeof arg1 === 'string') {
      const jobId = arg1;
      const leaseToken = arg2;

      return await db.runTransaction(async (tx) => {
        const docRef = this.getJobRef(jobId);
        const doc = await tx.get(docRef);
        if (!doc.exists) {
          throw new AppError(404, 'Cleanup job não encontrado.');
        }

        const job = doc.data() as WhatsAppProviderCleanupJobRecord;
        if (job.lease_token !== leaseToken) {
          throw new AppError(409, 'CLEANUP_JOB_LEASE_LOST: Token de lease divergente.');
        }

        if (job.attempt_count >= job.max_attempts) {
          tx.update(docRef, {
            status: 'exhausted',
            lease_token: null,
            lease_expires_at: null,
            last_error_code: 'MAX_RETRIES_EXCEEDED',
            retention_expires_at: null,
            updated_at: new Date().toISOString(),
          });
          return { reserved: false, currentAttemptCount: job.attempt_count };
        }

        const nextAttempt = job.attempt_count + 1;
        const nowIso = new Date().toISOString();

        tx.update(docRef, {
          attempt_count: nextAttempt,
          last_attempt_started_at: nowIso,
          updated_at: nowIso,
        });

        return { reserved: true, currentAttemptCount: nextAttempt };
      });
    }

    const tx = arg1 as FirebaseFirestore.Transaction;
    const jobId = arg2;
    const leaseToken = arg3!;

    const docRef = this.getJobRef(jobId);
    const doc = await tx.get(docRef);
    if (!doc.exists) {
      throw new AppError(404, 'Cleanup job não encontrado.');
    }

    const job = doc.data() as WhatsAppProviderCleanupJobRecord;
    if (job.lease_token !== leaseToken) {
      throw new AppError(409, 'CLEANUP_JOB_LEASE_LOST: Token de lease divergente.');
    }

    if (job.attempt_count >= job.max_attempts) {
      tx.update(docRef, {
        status: 'exhausted',
        lease_token: null,
        lease_expires_at: null,
        last_error_code: 'MAX_RETRIES_EXCEEDED',
        retention_expires_at: null,
        updated_at: new Date().toISOString(),
      });
      throw new AppError(409, 'MAX_RETRIES_EXCEEDED: Tentativas máximas de limpeza já esgotadas.', {
        code: 'MAX_RETRIES_EXCEEDED',
      });
    }

    const nextAttempt = job.attempt_count + 1;
    const nowIso = new Date().toISOString();

    tx.update(docRef, {
      attempt_count: nextAttempt,
      last_attempt_started_at: nowIso,
      updated_at: nowIso,
    });

    return nextAttempt;
  }

  async completeJobInTransaction(
    jobId: string,
    leaseToken: string,
    status: 'succeeded' | 'cancelled',
    proof: 'proven' | 'not_needed'
  ): Promise<void>;
  async completeJobInTransaction(
    tx: FirebaseFirestore.Transaction,
    jobId: string,
    leaseToken: string,
    status: 'succeeded' | 'cancelled',
    proof: 'proven' | 'not_needed'
  ): Promise<void>;
  async completeJobInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: string,
    arg3: string,
    arg4?: 'succeeded' | 'cancelled' | 'proven' | 'not_needed',
    arg5?: 'proven' | 'not_needed'
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const jobId = isStandalone ? arg1 : arg2;
    const leaseToken = isStandalone ? arg2 : arg3;
    const status = isStandalone ? (arg3 as 'succeeded' | 'cancelled') : (arg4 as 'succeeded' | 'cancelled');
    const proof = isStandalone ? (arg4 as 'proven' | 'not_needed') : arg5!;

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      const docRef = this.getJobRef(jobId);
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        return;
      }
      const job = doc.data() as WhatsAppProviderCleanupJobRecord;
      if (job.lease_token !== leaseToken) {
        throw new AppError(409, 'CLEANUP_JOB_LEASE_LOST: Token de lease divergente.');
      }

      const now = new Date();
      const retentionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = now.toISOString();

      tx.update(docRef, {
        status,
        provider_cleanup_proof: proof,
        lease_token: null,
        lease_expires_at: null,
        retention_expires_at: retentionExpiresAt,
        last_error_code: null,
        last_error_message: null,
        updated_at: nowIso,
      });
    };

    if (isStandalone) {
      await db.runTransaction(handler);
    } else {
      await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }

  async recordRetryWaitInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: string,
    arg3: string | { errorCode: string; errorMessage: string; nextAttemptSeconds: number },
    arg4?: string
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const jobId = isStandalone ? arg1 : arg2;
    const leaseToken = isStandalone ? arg2 : (arg3 as string);

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      const docRef = this.getJobRef(jobId);
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        return;
      }
      const job = doc.data() as WhatsAppProviderCleanupJobRecord;
      if (job.lease_token !== leaseToken) {
        throw new AppError(409, 'CLEANUP_JOB_LEASE_LOST: Token de lease divergente.');
      }

      const now = new Date();
      let nextAttemptAt: string;
      let errorCode: string | null = null;
      let errorMessage: string | null = null;

      if (isStandalone) {
        nextAttemptAt = arg3 as string;
        errorCode = arg4 || null;
      } else {
        const params = arg3 as { errorCode: string; errorMessage: string; nextAttemptSeconds: number };
        nextAttemptAt = new Date(now.getTime() + params.nextAttemptSeconds * 1000).toISOString();
        errorCode = params.errorCode;
        errorMessage = params.errorMessage;
      }

      const nowIso = now.toISOString();

      tx.update(docRef, {
        status: 'retry_wait',
        lease_token: null,
        lease_expires_at: null,
        last_error_code: errorCode,
        last_error_message: errorMessage,
        next_attempt_at: nextAttemptAt,
        updated_at: nowIso,
      });
    };

    if (isStandalone) {
      await db.runTransaction(handler);
    } else {
      await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }

  async recordExhaustionInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: string,
    arg3: string | { errorCode: string; errorMessage: string }
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const jobId = isStandalone ? arg1 : arg2;
    const leaseToken = isStandalone ? arg2 : (arg3 as any);

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      const docRef = this.getJobRef(jobId);
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        return;
      }
      const job = doc.data() as WhatsAppProviderCleanupJobRecord;
      if (job.lease_token !== leaseToken) {
        throw new AppError(409, 'CLEANUP_JOB_LEASE_LOST: Token de lease divergente.');
      }

      const nowIso = new Date().toISOString();
      const errorCode = isStandalone ? (arg3 as string) : (arg3 as any).errorCode;
      const errorMessage = isStandalone ? null : (arg3 as any).errorMessage;

      tx.update(docRef, {
        status: 'exhausted',
        provider_cleanup_proof: 'unproven',
        lease_token: null,
        lease_expires_at: null,
        retention_expires_at: null, // TTL suppressed (DEC-7D-51)
        last_error_code: errorCode,
        last_error_message: errorMessage,
        updated_at: nowIso,
      });
    };

    if (isStandalone) {
      await db.runTransaction(handler);
    } else {
      await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }

  async abandonJob(
    jobId: string,
    arg2: string | { operatorId: string; overrideReason: string },
    arg3?: string
  ): Promise<void> {
    const overrideReason = typeof arg2 === 'string' ? arg2 : arg2.overrideReason;
    const operatorId = typeof arg2 === 'string' ? (arg3 || 'internal_operator') : arg2.operatorId;

    if (!overrideReason || overrideReason.trim().length < 10) {
      throw new AppError(
        400,
        'OVERRIDE_REASON_REQUIRED: Justificativa obrigatória (mínimo 10 caracteres) para force-abandon.',
        { code: 'OVERRIDE_REASON_REQUIRED' }
      );
    }

    const docRef = this.getJobRef(jobId);
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(docRef);
      if (!doc.exists) {
        throw new AppError(404, 'Cleanup job não encontrado.');
      }
      const job = doc.data() as WhatsAppProviderCleanupJobRecord;

      const now = new Date();
      if (job.status === 'processing' && job.lease_expires_at) {
        if (new Date(job.lease_expires_at) > now) {
          throw new AppError(409, 'JOB_CURRENTLY_PROCESSING: Job está em execução ativa.', {
            code: 'JOB_CURRENTLY_PROCESSING',
          });
        }
      }

      if (job.status !== 'exhausted') {
        throw new AppError(409, 'JOB_NOT_EXHAUSTED: Apenas jobs esgotados podem ser abandonados manualmente.', {
          code: 'JOB_NOT_EXHAUSTED',
        });
      }

      const retentionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const nowIso = now.toISOString();

      tx.update(docRef, {
        status: 'abandoned',
        provider_cleanup_proof: 'overridden',
        override_reason: overrideReason.trim(),
        manual_action_by: operatorId,
        manual_action_at: nowIso,
        manual_action_reason: overrideReason.trim(),
        lease_token: null,
        lease_expires_at: null,
        retention_expires_at: retentionExpiresAt,
        updated_at: nowIso,
      });
    });
  }
}
