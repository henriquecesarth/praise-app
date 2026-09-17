import { db } from '../lib/firebase';
import crypto from 'crypto';
import { AppError } from '../middleware/error-handler';
import {
  WhatsAppProviderCleanupJobRecord,
  WhatsAppUnresolvedRemoteMutation,
  WhatsAppConnectionRecord,
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
} from '../features/whatsapp/whatsapp.types';

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
    let jobsA: WhatsAppProviderCleanupJobRecord[] = [];
    try {
      const queryA = await this.jobsCol
        .where('status', 'in', ['pending', 'retry_wait'])
        .where('next_attempt_at', '<=', nowIso)
        .limit(limitCount)
        .get();

      jobsA = queryA.docs.map(
        (d) => ({ id: d.id, ...d.data() } as WhatsAppProviderCleanupJobRecord)
      );
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
      const snap = await this.jobsCol
        .where('status', 'in', ['pending', 'retry_wait'])
        .get();
      jobsA = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as WhatsAppProviderCleanupJobRecord))
        .filter((j) => j.next_attempt_at <= nowIso)
        .slice(0, limitCount);
    }

    if (jobsA.length >= limitCount) {
      return jobsA;
    }

    // Query B: expired processing leases
    const remaining = limitCount - jobsA.length;
    let jobsB: WhatsAppProviderCleanupJobRecord[] = [];
    try {
      const queryB = await this.jobsCol
        .where('status', '==', 'processing')
        .where('lease_expires_at', '<=', nowIso)
        .limit(remaining)
        .get();

      jobsB = queryB.docs.map(
        (d) => ({ id: d.id, ...d.data() } as WhatsAppProviderCleanupJobRecord)
      );
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
      const snap = await this.jobsCol
        .where('status', '==', 'processing')
        .get();
      jobsB = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as WhatsAppProviderCleanupJobRecord))
        .filter((j) => j.lease_expires_at && j.lease_expires_at <= nowIso)
        .slice(0, remaining);
    }

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
      const hasUnknown = job.unresolved_remote_mutations?.some((m) => m.status === 'unknown_outcome');
      const retentionExpiresAt = hasUnknown
        ? null
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
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
    arg3: any,
    arg4?: any
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const jobId = isStandalone ? arg1 : arg2;
    const leaseToken = isStandalone ? arg2 : (arg3 as string);
    const payload = isStandalone ? arg3 : arg4;
    const optionalErrorCode = isStandalone ? arg4 : undefined;

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

      if (typeof payload === 'object' && payload !== null) {
        errorCode = payload.errorCode || null;
        errorMessage = payload.errorMessage || null;
        const seconds = payload.nextAttemptSeconds ?? 60;
        nextAttemptAt = new Date(now.getTime() + seconds * 1000).toISOString();
      } else if (typeof payload === 'string') {
        nextAttemptAt = payload;
        errorCode = optionalErrorCode || null;
      } else {
        nextAttemptAt = new Date(now.getTime() + 60 * 1000).toISOString();
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

  async settleZernioCleanupInTransaction(
    jobId: string,
    leaseToken: string,
    options?: { providerCleanupProof?: 'proven' | 'proven_absent' | 'unproven' | string }
  ): Promise<void>;
  async settleZernioCleanupInTransaction(
    tx: FirebaseFirestore.Transaction,
    jobId: string,
    leaseToken: string,
    options?: { providerCleanupProof?: 'proven' | 'proven_absent' | 'unproven' | string }
  ): Promise<void>;
  async settleZernioCleanupInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2?: string,
    arg3?: any,
    arg4?: any
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const jobId = isStandalone ? arg1 : arg2!;
    const leaseToken = isStandalone ? arg2! : arg3!;
    const options = isStandalone ? arg3 : arg4;
    const proof: 'proven' | 'proven_absent' | 'unproven' =
      options?.providerCleanupProof || 'proven_absent';

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      // 1. ALL READS FIRST (Strict Firestore rule: zero reads after any writes)
      const jobRef = this.getJobRef(jobId);
      const jobDoc = await tx.get(jobRef);
      if (!jobDoc.exists) {
        throw new AppError(404, 'Cleanup job não encontrado.');
      }
      const job = jobDoc.data() as WhatsAppProviderCleanupJobRecord;
      if (job.lease_token !== leaseToken) {
        throw new AppError(409, 'CLEANUP_JOB_LEASE_LOST: Token de lease divergente.');
      }

      // Read connection
      const connRef = db.collection('whatsapp_connections').doc(job.connection_id);
      const connDoc = await tx.get(connRef);
      if (!connDoc.exists) {
        throw new AppError(404, 'Conexão não encontrada.');
      }
      const conn = connDoc.data() as WhatsAppConnectionRecord;
      if (conn.organization_id !== job.organization_id) {
        throw new AppError(403, 'Isolamento multi-inquilino violado.');
      }
      if (conn.status !== 'disconnected') {
        throw new AppError(409, 'CLEANUP_CONNECTION_NOT_DISCONNECTED: Conexão não está em estado desconectado.', {
          code: 'CLEANUP_CONNECTION_NOT_DISCONNECTED',
        });
      }

      // Read account claim
      const accountId = job.provider_account_id || conn.provider_account_id;
      let accountClaimRef: FirebaseFirestore.DocumentReference | null = null;
      let accountClaimDoc: FirebaseFirestore.DocumentSnapshot | null = null;
      if (accountId) {
        const accountClaimId = getZernioAccountClaimId(accountId);
        accountClaimRef = db.collection('whatsapp_provider_identity_claims').doc(accountClaimId);
        accountClaimDoc = await tx.get(accountClaimRef);
      }

      // Read phone claim
      const phoneNumber = job.phone_number || conn.phone_number;
      let phoneClaimRef: FirebaseFirestore.DocumentReference | null = null;
      let phoneClaimDoc: FirebaseFirestore.DocumentSnapshot | null = null;
      if (phoneNumber) {
        const phoneClaimId = getZernioPhoneClaimId(phoneNumber);
        phoneClaimRef = db.collection('whatsapp_provider_identity_claims').doc(phoneClaimId);
        phoneClaimDoc = await tx.get(phoneClaimRef);
      }

      // Read secret
      const secretRef = db.collection('whatsapp_connection_secrets').doc(job.connection_id);
      const secretDoc = await tx.get(secretRef);

      // 2. VALIDATION PHASE (All reads succeeded, validate invariants fail-closed)
      // HIGH 2: Account claim ownership validation
      if (accountClaimDoc && accountClaimDoc.exists) {
        const claimData = accountClaimDoc.data();
        if (
          claimData?.organization_id !== job.organization_id ||
          claimData?.connection_id !== job.connection_id
        ) {
          throw new AppError(409, 'CLAIM_OWNERSHIP_CONFLICT: Account claim owned by another organization or connection.', {
            code: 'CLAIM_OWNERSHIP_CONFLICT',
            claimId: accountClaimDoc.id,
            expectedConnectionId: job.connection_id,
            actualConnectionId: claimData?.connection_id,
            expectedOrganizationId: job.organization_id,
            actualOrganizationId: claimData?.organization_id,
          });
        }
      }

      // HIGH 2: Phone claim ownership validation
      if (phoneClaimDoc && phoneClaimDoc.exists) {
        const claimData = phoneClaimDoc.data();
        if (
          claimData?.organization_id !== job.organization_id ||
          claimData?.connection_id !== job.connection_id
        ) {
          throw new AppError(409, 'CLAIM_OWNERSHIP_CONFLICT: Phone claim owned by another organization or connection.', {
            code: 'CLAIM_OWNERSHIP_CONFLICT',
            claimId: phoneClaimDoc.id,
            expectedConnectionId: job.connection_id,
            actualConnectionId: claimData?.connection_id,
            expectedOrganizationId: job.organization_id,
            actualOrganizationId: claimData?.organization_id,
          });
        }
      }

      // 3. WRITE PHASE (Zero reads executed from this point forward)
      if (accountClaimRef && accountClaimDoc?.exists) {
        tx.delete(accountClaimRef);
      }

      if (phoneClaimRef && phoneClaimDoc?.exists) {
        tx.delete(phoneClaimRef);
      }

      // Delete connection secret if any remains
      if (secretDoc.exists) {
        tx.delete(secretRef);
      }

      const now = new Date();
      const nowIso = now.toISOString();

      // Settle any unknown mutations on the job
      const updatedMutations = (job.unresolved_remote_mutations || []).map((m) =>
        m.status === 'unknown_outcome'
          ? { ...m, status: 'settled' as const, audit_note: m.audit_note ? `${m.audit_note} (settled)` : 'settled by D7 cleanup' }
          : m
      );

      const hasUnknown = updatedMutations.some((m) => m.status === 'unknown_outcome');
      const retentionExpiresAt = hasUnknown
        ? null
        : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      tx.update(jobRef, {
        status: 'succeeded',
        provider_cleanup_proof: proof,
        settled_at: nowIso,
        completed_at: nowIso,
        lease_token: null,
        lease_expires_at: null,
        retention_expires_at: retentionExpiresAt,
        last_error_code: null,
        last_error_message: null,
        unresolved_remote_mutations: updatedMutations,
        updated_at: nowIso,
      });
    };

    if (isStandalone) {
      await db.runTransaction(handler);
    } else {
      await handler(arg1 as FirebaseFirestore.Transaction);
    }
  }

  async recordUnresolvedMutationInTransaction(
    jobId: string,
    leaseToken: string,
    options: {
      operation?: 'delete_account';
      auditNote?: string;
      errorCode?: string;
      errorMessage?: string;
      nextAttemptSeconds?: number;
    }
  ): Promise<void>;
  async recordUnresolvedMutationInTransaction(
    tx: FirebaseFirestore.Transaction,
    jobId: string,
    leaseToken: string,
    options: {
      operation?: 'delete_account';
      auditNote?: string;
      errorCode?: string;
      errorMessage?: string;
      nextAttemptSeconds?: number;
    }
  ): Promise<void>;
  async recordUnresolvedMutationInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: string,
    arg3: any,
    arg4?: any
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const jobId = isStandalone ? arg1 : arg2;
    const leaseToken = isStandalone ? arg2 : arg3;
    const opts = (isStandalone ? arg3 : arg4) || {};

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
      const nowIso = now.toISOString();
      const backoffSeconds = opts.nextAttemptSeconds ?? 60;
      const nextAttemptAt = new Date(now.getTime() + backoffSeconds * 1000).toISOString();

      let mutations = [...(job.unresolved_remote_mutations || [])];

      // Enforce FIFO cap 20
      if (mutations.length >= 20) {
        const settledIndices = mutations
          .map((m, idx) => (m.status === 'settled' ? idx : -1))
          .filter((idx) => idx !== -1);

        if (settledIndices.length === 0) {
          tx.update(docRef, {
            status: 'exhausted',
            provider_cleanup_proof: 'unproven',
            lease_token: null,
            lease_expires_at: null,
            retention_expires_at: null,
            last_error_code: 'UNCERTAINTY_LEDGER_SATURATED',
            last_error_message: 'Livro-razão de incertezas Zernio saturado (20 registros não liquidados).',
            updated_at: nowIso,
          });
          throw new AppError(
            500,
            'ZERNIO_UNCERTAINTY_LEDGER_SATURATED: O livro-razão de incertezas atingiu o limite de 20 registros não liquidados.',
            { code: 'ZERNIO_UNCERTAINTY_LEDGER_SATURATED' }
          );
        }

        const oldestSettledIndex = settledIndices[0];
        mutations.splice(oldestSettledIndex, 1);
      }

      const newMutation: WhatsAppUnresolvedRemoteMutation = {
        operation_generation: job.attempt_count,
        operation: opts.operation || 'delete_account',
        dispatched_at: nowIso,
        status: 'unknown_outcome',
        connection_id: job.connection_id,
        provider: 'zernio',
        provider_account_id: job.provider_account_id || undefined,
        audit_note: opts.auditNote || opts.errorMessage || 'Zernio deleteAccount indeterminate error',
      };

      mutations.push(newMutation);

      tx.update(docRef, {
        status: 'retry_wait',
        lease_token: null,
        lease_expires_at: null,
        retention_expires_at: null, // TTL suppressed when unknown mutations present
        last_error_code: opts.errorCode || 'UNKNOWN_OUTCOME',
        last_error_message: opts.errorMessage || null,
        next_attempt_at: nextAttemptAt,
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
}
