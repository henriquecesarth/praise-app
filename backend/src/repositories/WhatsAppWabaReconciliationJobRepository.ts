import { db } from '../lib/firebase';
import crypto from 'crypto';
import { AppError } from '../middleware/error-handler';
import { WhatsAppWabaReconciliationJobRecord } from '../features/whatsapp/whatsapp.types';

export class WhatsAppWabaReconciliationJobRepository {
  private readonly jobsCol = db.collection('whatsapp_waba_reconciliation_jobs');

  getJobRef(wabaId: string): FirebaseFirestore.DocumentReference {
    return this.jobsCol.doc(`recon_meta_${wabaId}`);
  }

  async getJob(wabaId: string): Promise<WhatsAppWabaReconciliationJobRecord | null> {
    const doc = await this.getJobRef(wabaId).get();
    if (!doc.exists) {
      return null;
    }
    return { id: doc.id, ...doc.data() } as WhatsAppWabaReconciliationJobRecord;
  }

  async ensureJobPending(
    wabaId: string,
    desiredState: 'subscribed' | 'unsubscribed' = 'subscribed',
    tx?: FirebaseFirestore.Transaction
  ): Promise<void> {
    const docRef = this.getJobRef(wabaId);
    const nowIso = new Date().toISOString();

    const applyUpdate = (existingJob: WhatsAppWabaReconciliationJobRecord | null) => {
      if (!existingJob) {
        const newJob: WhatsAppWabaReconciliationJobRecord = {
          id: `recon_meta_${wabaId}`,
          provider: 'meta',
          provider_waba_id: wabaId,
          desired_state: desiredState,
          status: 'pending',
          attempt_count: 0,
          next_attempt_at: nowIso,
          lease_token: null,
          lease_expires_at: null,
          last_error_code: null,
          last_error_message: null,
          consecutive_stable_observations: 0,
          last_observed_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        return { op: 'set' as const, data: newJob };
      }

      if (existingJob.status === 'processing') {
        return {
          op: 'update' as const,
          data: {
            desired_state: desiredState,
            updated_at: nowIso,
          },
        };
      }

      return {
        op: 'update' as const,
        data: {
          desired_state: desiredState,
          status: 'pending' as const,
          next_attempt_at: nowIso,
          updated_at: nowIso,
        },
      };
    };

    if (tx) {
      const doc = await tx.get(docRef);
      const existing = doc.exists ? ({ id: doc.id, ...doc.data() } as WhatsAppWabaReconciliationJobRecord) : null;
      const res = applyUpdate(existing);
      if (res.op === 'set') {
        tx.set(docRef, res.data);
      } else {
        tx.update(docRef, res.data);
      }
    } else {
      await db.runTransaction(async (t) => {
        const doc = await t.get(docRef);
        const existing = doc.exists ? ({ id: doc.id, ...doc.data() } as WhatsAppWabaReconciliationJobRecord) : null;
        const res = applyUpdate(existing);
        if (res.op === 'set') {
          t.set(docRef, res.data);
        } else {
          t.update(docRef, res.data);
        }
      });
    }
  }

  async findDueJobs(limitCount: number = 10): Promise<WhatsAppWabaReconciliationJobRecord[]> {
    const nowIso = new Date().toISOString();

    // Query A: pending / idle due
    let jobsA: WhatsAppWabaReconciliationJobRecord[] = [];
    try {
      const queryA = await this.jobsCol
        .where('status', 'in', ['pending', 'idle'])
        .where('next_attempt_at', '<=', nowIso)
        .limit(limitCount)
        .get();

      jobsA = queryA.docs.map(
        (d) => ({ id: d.id, ...d.data() } as WhatsAppWabaReconciliationJobRecord)
      );
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
      const snap = await this.jobsCol
        .where('status', 'in', ['pending', 'idle'])
        .get();
      jobsA = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as WhatsAppWabaReconciliationJobRecord))
        .filter((j) => j.next_attempt_at <= nowIso)
        .slice(0, limitCount);
    }

    if (jobsA.length >= limitCount) {
      return jobsA;
    }

    // Query B: expired processing leases
    const remaining = limitCount - jobsA.length;
    let jobsB: WhatsAppWabaReconciliationJobRecord[] = [];
    try {
      const queryB = await this.jobsCol
        .where('status', '==', 'processing')
        .where('lease_expires_at', '<=', nowIso)
        .limit(remaining)
        .get();

      jobsB = queryB.docs.map(
        (d) => ({ id: d.id, ...d.data() } as WhatsAppWabaReconciliationJobRecord)
      );
    } catch (err: any) {
      if (process.env.NODE_ENV === 'production') {
        throw err;
      }
      const snap = await this.jobsCol
        .where('status', '==', 'processing')
        .get();
      jobsB = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as WhatsAppWabaReconciliationJobRecord))
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
        const docRef = this.jobsCol.doc(jobId);
        const doc = await tx.get(docRef);
        if (!doc.exists) return null;

        const job = doc.data() as WhatsAppWabaReconciliationJobRecord;
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
          attempt_count: (job.attempt_count || 0) + 1,
          updated_at: nowIso,
        });

        return leaseToken;
      });
    }

    const tx = arg1 as FirebaseFirestore.Transaction;
    const jobId = arg2 as string;
    const durationSeconds = typeof arg3 === 'number' ? arg3 : 300;

    const docRef = this.jobsCol.doc(jobId);
    const doc = await tx.get(docRef);
    if (!doc.exists) {
      throw new AppError(404, 'Reconciliation job não encontrado.');
    }

    const job = { id: doc.id, ...doc.data() } as WhatsAppWabaReconciliationJobRecord;
    const now = new Date();

    if (job.status === 'processing' && job.lease_expires_at) {
      if (new Date(job.lease_expires_at) > now) {
        throw new AppError(409, 'JOB_CURRENTLY_PROCESSING: Reconciliation job já possui lease ativo.', {
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
      attempt_count: job.attempt_count + 1,
      updated_at: nowIso,
    });

    return {
      leaseToken,
      job: {
        ...job,
        status: 'processing',
        lease_token: leaseToken,
        lease_expires_at: leaseExpiresAt,
        attempt_count: job.attempt_count + 1,
        updated_at: nowIso,
      },
    };
  }

  async recordJobSuccessInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: string,
    arg3?: any,
    arg4?: any
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const jobId = isStandalone ? arg1 : arg2;
    const leaseToken = isStandalone ? arg2 : arg3;

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      const docRef = this.jobsCol.doc(jobId);
      const doc = await tx.get(docRef);
      if (!doc.exists) return;

      const job = doc.data() as WhatsAppWabaReconciliationJobRecord;
      if (job.lease_token !== leaseToken) {
        throw new AppError(409, 'RECONCILIATION_LEASE_LOST: Token de lease divergente.');
      }

      const now = new Date();
      let nextIntervalSeconds = 300;
      let consecutiveObservations = (job.consecutive_stable_observations || 0) + 1;

      if (!isStandalone && arg4) {
        if (arg4.nextAttemptSeconds) nextIntervalSeconds = arg4.nextAttemptSeconds;
        if (arg4.consecutiveObservations !== undefined) consecutiveObservations = arg4.consecutiveObservations;
      } else if (isStandalone && typeof arg3 === 'number') {
        nextIntervalSeconds = arg3;
      }

      const nextAttemptAt = new Date(now.getTime() + nextIntervalSeconds * 1000).toISOString();
      const nowIso = now.toISOString();

      tx.update(docRef, {
        status: 'idle',
        lease_token: null,
        lease_expires_at: null,
        last_observed_at: nowIso,
        consecutive_stable_observations: consecutiveObservations,
        next_attempt_at: nextAttemptAt,
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

  async recordJobFailureInTransaction(
    arg1: FirebaseFirestore.Transaction | string,
    arg2: string,
    arg3?: any,
    arg4?: any
  ): Promise<void> {
    const isStandalone = typeof arg1 === 'string';
    const jobId = isStandalone ? arg1 : arg2;
    const leaseToken = isStandalone ? arg2 : arg3;

    const handler = async (tx: FirebaseFirestore.Transaction) => {
      const docRef = this.jobsCol.doc(jobId);
      const doc = await tx.get(docRef);
      if (!doc.exists) return;

      const job = doc.data() as WhatsAppWabaReconciliationJobRecord;
      if (job.lease_token !== leaseToken) {
        throw new AppError(409, 'RECONCILIATION_LEASE_LOST: Token de lease divergente.');
      }

      const now = new Date();
      const nowIso = now.toISOString();

      let errorCode = isStandalone ? (arg3 || 'DRIFT_DETECTED') : arg4?.errorCode || 'DRIFT_DETECTED';
      let errorMessage = isStandalone ? null : arg4?.errorMessage || null;
      let backoffSeconds = 60;
      let terminalAuthLost = false;

      if (!isStandalone && arg4) {
        if (arg4.nextAttemptSeconds) backoffSeconds = arg4.nextAttemptSeconds;
        if (arg4.terminalAuthLost) terminalAuthLost = true;
      }

      if (terminalAuthLost) {
        tx.update(docRef, {
          status: 'exhausted',
          lease_token: null,
          lease_expires_at: null,
          last_error_code: errorCode,
          last_error_message: errorMessage,
          updated_at: nowIso,
        });
        return;
      }

      const nextAttemptAt = new Date(now.getTime() + backoffSeconds * 1000).toISOString();

      tx.update(docRef, {
        status: 'pending',
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
}
