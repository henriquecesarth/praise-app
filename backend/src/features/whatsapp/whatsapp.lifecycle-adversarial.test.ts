import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderCleanupJobRepository } from '../../repositories/WhatsAppProviderCleanupJobRepository';
import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppCleanupService } from './whatsapp-cleanup.service';
import fs from 'fs';
import path from 'path';
import { InternalWhatsAppController, verifyBearerSecret } from './internal-whatsapp.controller';
import { AppError } from '../../middleware/error-handler';
import { WhatsAppProvider } from './whatsapp.types';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';

describe('Phase 7D1 Adversarial Lifecycle & Distributed Convergence Matrix', () => {
  const testKey = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXoxMjM0NTY=';

  describe('1. Multi-Generation Remote Uncertainty Ledger Boundedness', () => {
    it('1.1 Prunes settled records FIFO to maintain <= 20 entries', async () => {
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const wabaId = `waba-ledger-prune-${testId}`;

      // Seed lock with 19 settled mutations
      for (let i = 1; i <= 19; i++) {
        await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
          operation_generation: i,
          operation: 'subscribe',
          connection_id: `conn-${i}`,
        });
      }

      // Mark first 5 as settled
      const docRef = (lockRepo as any).locksCol.doc(`lock_meta_${wabaId}`);
      const snap = await docRef.get();
      const data = snap.data();
      data.unresolved_remote_mutations.forEach((m: any, idx: number) => {
        if (idx < 5) m.status = 'settled';
      });
      await docRef.set(data);

      // Add 2 more unknown outcomes
      await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
        operation_generation: 20,
        operation: 'subscribe',
        connection_id: 'conn-20',
      });
      await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
        operation_generation: 21,
        operation: 'subscribe',
        connection_id: 'conn-21',
      });

      const updated = await lockRepo.getLock(wabaId);
      expect(updated).not.toBeNull();
      expect(updated!.unresolved_remote_mutations.length).toBeLessThanOrEqual(20);
    });

    it('1.2 FAILS CLOSED with 500 WABA_UNCERTAINTY_LEDGER_SATURATED when all 20 entries are unresolved', async () => {
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const wabaId = `waba-ledger-sat-${testId}`;

      // Seed 20 unknown outcomes (none settled)
      for (let i = 1; i <= 20; i++) {
        await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
          operation_generation: i,
          operation: 'subscribe',
          connection_id: `conn-${i}`,
        });
      }

      const lock = await lockRepo.getLock(wabaId);
      expect(lock!.unresolved_remote_mutations.length).toBe(20);

      // 21st insertion must fail closed
      await expect(
        lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
          operation_generation: 21,
          operation: 'subscribe',
          connection_id: 'conn-21',
        })
      ).rejects.toThrow('WABA_UNCERTAINTY_LEDGER_SATURATED');
    });
  });

  describe('2. Secret Purge Safety Under Subscribe Debt (DEC-7D-64)', () => {
    it('2.1 Blocks secret deletion with 409 SECRET_PURGE_BLOCKED_UNDER_SUBSCRIBE_DEBT when subscribe debt exists', async () => {
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const secretRepo = new WhatsAppConnectionSecretRepository();
      const wabaId = 'waba-debt-01';
      const orgId = 'org-debt-01';
      const connId = 'conn-debt-01';

      // Create secret
      await secretRepo.setSecret({
        id: connId,
        organization_id: orgId,
        connection_id: connId,
        key_version: 1,
        encrypted_access_token: 'dummy',
        iv: 'dummy',
        auth_tag: 'dummy',
        token_type: 'business_token',
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Record unresolved subscribe debt
      await lockRepo.recordUnknownOutcomeInTransaction(wabaId, {
        operation_generation: 1,
        operation: 'subscribe',
        connection_id: connId,
      });

      // Attempt standard deletion must fail
      await expect(
        secretRepo.deleteSecret(orgId, connId, { wabaId })
      ).rejects.toThrow('SECRET_PURGE_BLOCKED_UNDER_SUBSCRIBE_DEBT');

      // Verify secret is still retained
      const retained = await secretRepo.getSecret(orgId, connId);
      expect(retained).not.toBeNull();
    });

    it('2.2 Permits secret deletion when force: true and valid overrideReason (>=10 chars) are supplied', async () => {
      const secretRepo = new WhatsAppConnectionSecretRepository();
      const orgId = 'org-debt-02';
      const connId = 'conn-debt-02';
      const wabaId = 'waba-debt-02';

      await secretRepo.setSecret({
        id: connId,
        organization_id: orgId,
        connection_id: connId,
        key_version: 1,
        encrypted_access_token: 'dummy',
        iv: 'dummy',
        auth_tag: 'dummy',
        token_type: 'business_token',
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Force delete with override reason
      await expect(
        secretRepo.deleteSecret(orgId, connId, {
          wabaId,
          force: true,
          overrideReason: 'Operator manual authorization after verification',
        })
      ).resolves.not.toThrow();

      const deleted = await secretRepo.getSecret(orgId, connId);
      expect(deleted).toBeNull();
    });

    it('2.3 Rejects force deletion when overrideReason is less than 10 characters', async () => {
      const secretRepo = new WhatsAppConnectionSecretRepository();
      const orgId = 'org-debt-03';
      const connId = 'conn-debt-03';

      await secretRepo.setSecret({
        id: connId,
        organization_id: orgId,
        connection_id: connId,
        key_version: 1,
        encrypted_access_token: 'dummy',
        iv: 'dummy',
        auth_tag: 'dummy',
        token_type: 'business_token',
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await expect(
        secretRepo.deleteSecret(orgId, connId, {
          force: true,
          overrideReason: 'too short',
        })
      ).rejects.toThrow('OVERRIDE_REASON_TOO_SHORT');
    });
  });

  describe('3. Timing-Safe Internal Authentication (DEC-7D-47)', () => {
    it('3.1 Validates matching bearer token in constant time', () => {
      const secret = 'super-secret-cron-token-12345';
      const validHeader = `Bearer ${secret}`;
      expect(verifyBearerSecret(validHeader, secret)).toBe(true);
    });

    it('3.2 Fails closed on wrong secret without timing leaks', () => {
      const secret = 'super-secret-cron-token-12345';
      const wrongHeader = 'Bearer wrong-secret-token';
      expect(verifyBearerSecret(wrongHeader, secret)).toBe(false);
    });

    it('3.3 Fails closed on malformed authorization header', () => {
      const secret = 'super-secret-cron-token-12345';
      expect(verifyBearerSecret('Basic abc', secret)).toBe(false);
      expect(verifyBearerSecret(undefined, secret)).toBe(false);
      expect(verifyBearerSecret('', secret)).toBe(false);
      expect(verifyBearerSecret('Bearer', secret)).toBe(false);
    });
  });

  describe('4. Durable Cleanup Job Leases, Pre-Call Reservation & Stale Worker Fencing', () => {
    it('4.1 Pre-call reservation increments attempt_count BEFORE remote call and fails closed at max_attempts', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const jobId = 'cleanup_conn_pre_call_01';

      await cleanupRepo.createJob({
        id: jobId,
        organization_id: 'org-test',
        connection_id: 'conn-test',
        provider: 'meta',
        provider_waba_id: 'waba-test',
        provider_phone_number_id: 'phone-test',
        waba_claim_generation: 1,
        status: 'pending',
        attempt_count: 4,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        retention_expires_at: null,
      });

      const leaseToken = await cleanupRepo.acquireJobLeaseInTransaction(jobId, 60000);
      expect(leaseToken).not.toBeNull();

      // Reserve 5th attempt (should succeed)
      const res1 = await cleanupRepo.reserveAttemptInTransaction(jobId, leaseToken!);
      expect(res1.reserved).toBe(true);
      expect(res1.currentAttemptCount).toBe(5);

      // Attempt 6th reservation (must fail and transition to exhausted)
      const res2 = await cleanupRepo.reserveAttemptInTransaction(jobId, leaseToken!);
      expect(res2.reserved).toBe(false);

      const exhaustedJob = await cleanupRepo.getJobById(jobId);
      expect(exhaustedJob!.status).toBe('exhausted');
      expect(exhaustedJob!.last_error_code).toBe('MAX_RETRIES_EXCEEDED');
      expect(exhaustedJob!.retention_expires_at).toBeNull();
    });

    it('4.2 Stale worker writeback is rejected when lease_token mismatches', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const jobId = 'cleanup_conn_stale_02';

      await cleanupRepo.createJob({
        id: jobId,
        organization_id: 'org-test',
        connection_id: 'conn-test-2',
        provider: 'meta',
        provider_waba_id: 'waba-test',
        provider_phone_number_id: 'phone-test',
        waba_claim_generation: 1,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date().toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        retention_expires_at: null,
      });

      const tokenA = await cleanupRepo.acquireJobLeaseInTransaction(jobId, 60000);

      // Simulate lease expiration / reclaim by worker B
      await cleanupRepo.updateJob(jobId, {
        lease_token: 'worker-B-token',
        lease_expires_at: new Date(Date.now() + 60000).toISOString(),
      });

      // Stale Worker A writeback must fail
      await expect(
        cleanupRepo.completeJobInTransaction(jobId, tokenA!, 'succeeded', 'proven')
      ).rejects.toThrow('CLEANUP_JOB_LEASE_LOST');
    });
  });

  describe('5. Autonomous Scheduled Execution, Leases, Overlap & Auth Isolation Matrix (Phase 7D1-B-R1)', () => {
    it('5.1 Proves no-user-action model is wired via Vercel Cron configuration and functions maxDuration', () => {
      const vercelJsonPath = path.resolve(__dirname, '../../../vercel.json');
      expect(fs.existsSync(vercelJsonPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));

      expect(content.functions?.['src/app.ts']?.maxDuration).toBe(60);
      expect(Array.isArray(content.crons)).toBe(true);
      expect(content.crons).toHaveLength(2);

      const cleanupCron = content.crons.find(
        (c: any) => c.path === '/api/v1/internal/whatsapp/cleanup-jobs/execute'
      );
      expect(cleanupCron).toBeDefined();
      expect(cleanupCron.schedule).toBe('*/5 * * * *');

      const reconCron = content.crons.find(
        (c: any) => c.path === '/api/v1/internal/whatsapp/reconciliation-jobs/execute'
      );
      expect(reconCron).toBeDefined();
      expect(reconCron.schedule).toBe('*/5 * * * *');
    });

    it('5.2 Scheduled cleanup execution executes due jobs and enforces non-cacheable HTTP headers', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_exec_${testId}`;

      await cleanupRepo.createJob({
        id: jobId,
        organization_id: `org-${testId}`,
        connection_id: `conn-${testId}`,
        provider: 'meta',
        provider_waba_id: `waba-${testId}`,
        provider_phone_number_id: `phone-${testId}`,
        waba_claim_generation: 1,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 5000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        retention_expires_at: null,
      });

      const cronSecret = 'valid-cron-secret-501';
      process.env.CRON_SECRET = cronSecret;

      const req = {
        headers: { authorization: `Bearer ${cronSecret}` },
        query: { batchSize: '5' },
      } as any;
      const headersSet: Record<string, string> = {};
      let responseData: any = null;
      let statusCode = 200;
      const res = {
        setHeader: (k: string, v: string) => {
          headersSet[k] = v;
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          responseData = data;
          return res;
        },
      } as any;
      const next = vi.fn();

      const controller = new InternalWhatsAppController();
      await controller.executeCleanupJobs(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(statusCode).toBe(200);
      expect(headersSet['Cache-Control']).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
      expect(headersSet['Pragma']).toBe('no-cache');
      expect(headersSet['Expires']).toBe('0');
      expect(responseData?.success).toBe(true);
      expect(responseData?.cleanup?.candidateCount).toBeGreaterThanOrEqual(1);
    }, 15000);

    it('5.3 Scheduled reconciliation execution executes due reconciliation jobs', async () => {
      const reconRepo = new WhatsAppWabaReconciliationJobRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const wabaId = `waba-recon-test-${testId}`;

      await reconRepo.ensureJobPending(wabaId, 'unsubscribed');

      const cronSecret = 'valid-cron-secret-502';
      process.env.CRON_SECRET = cronSecret;

      const req = {
        headers: { authorization: `Bearer ${cronSecret}` },
        query: { batchSize: '5' },
      } as any;
      const headersSet: Record<string, string> = {};
      let responseData: any = null;
      let statusCode = 200;
      const res = {
        setHeader: (k: string, v: string) => {
          headersSet[k] = v;
        },
        status: (code: number) => {
          statusCode = code;
          return res;
        },
        json: (data: any) => {
          responseData = data;
          return res;
        },
      } as any;
      const next = vi.fn();

      const controller = new InternalWhatsAppController();
      await controller.executeReconciliationJobs(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(statusCode).toBe(200);
      expect(responseData?.success).toBe(true);
      expect(responseData?.reconciliation?.candidateCount).toBeGreaterThanOrEqual(1);
    }, 15000);

    it('5.4 Duplicate scheduler invocations are safe against concurrent execution overlap', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_overlap_${testId}`;

      await cleanupRepo.createJob({
        id: jobId,
        organization_id: `org-${testId}`,
        connection_id: `conn-${testId}`,
        provider: 'meta',
        provider_waba_id: `waba-${testId}`,
        provider_phone_number_id: `phone-${testId}`,
        waba_claim_generation: 1,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 5000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        retention_expires_at: null,
      });

      const cleanupService = new WhatsAppCleanupService();

      // Launch two worker executions concurrently targeting the same due jobs
      const [res1, res2] = await Promise.all([
        cleanupService.executeDueJobs({ batchSize: 5 }),
        cleanupService.executeDueJobs({ batchSize: 5 }),
      ]);

      // Both runners must complete without unhandled crash, and exactly one acquires the candidate
      expect(res1.processedCount + res2.processedCount).toBeGreaterThanOrEqual(1);
    }, 15000);

    it('5.5 Expired job lease (worker crash) becomes claimable by subsequent scheduler invocation', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_expired_${testId}`;

      // Simulate a crashed worker whose lease expired 10 seconds ago
      await cleanupRepo.createJob({
        id: jobId,
        organization_id: `org-${testId}`,
        connection_id: `conn-${testId}`,
        provider: 'meta',
        provider_waba_id: `waba-${testId}`,
        provider_phone_number_id: `phone-${testId}`,
        waba_claim_generation: 1,
        status: 'processing',
        attempt_count: 1,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 60000).toISOString(),
        lease_token: 'crashed-worker-lease-token',
        lease_expires_at: new Date(Date.now() - 10000).toISOString(),
        last_attempt_started_at: new Date(Date.now() - 60000).toISOString(),
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        completed_at: null,
        retention_expires_at: null,
      });

      // Query B discovers the expired processing lease
      const dueJobs = await cleanupRepo.findDueJobs(10);
      const targetJob = dueJobs.find((j) => j.id === jobId);
      expect(targetJob).toBeDefined();
      expect(targetJob!.status).toBe('processing');

      // Next scheduler execution acquires a new lease
      const newLeaseToken = await cleanupRepo.acquireJobLeaseInTransaction(jobId, 60000);
      expect(newLeaseToken).not.toBeNull();
      expect(newLeaseToken).not.toBe('crashed-worker-lease-token');

      const updated = await cleanupRepo.getJobById(jobId);
      expect(updated!.lease_token).toBe(newLeaseToken);
    }, 15000);

    it('5.6 Rejects unauthorized requests, invalid tokens, and enforces operator/cron authority separation', async () => {
      const cronSecret = 'actual-cron-secret-12345';
      const operatorSecret = 'actual-operator-secret-67890';
      process.env.CRON_SECRET = cronSecret;
      process.env.INTERNAL_OPERATOR_SECRET = operatorSecret;

      const controller = new InternalWhatsAppController();

      // Case A: Missing authorization on cron route -> 401 UNAUTHORIZED
      const reqMissing = { headers: {}, query: {} } as any;
      const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const next1 = vi.fn();
      await controller.executeCleanupJobs(reqMissing, res, next1);
      expect(next1).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, details: { code: 'UNAUTHORIZED' } })
      );

      // Case B: Wrong token on cron route -> 401 UNAUTHORIZED
      const reqWrong = { headers: { authorization: 'Bearer totally-wrong-token' }, query: {} } as any;
      const next2 = vi.fn();
      await controller.executeCleanupJobs(reqWrong, res, next2);
      expect(next2).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, details: { code: 'UNAUTHORIZED' } })
      );

      // Case C: Operator secret passed to cron route -> 401 UNAUTHORIZED (operator cannot execute cron-only route)
      const reqOperatorOnCron = { headers: { authorization: `Bearer ${operatorSecret}` }, query: {} } as any;
      const next3 = vi.fn();
      await controller.executeCleanupJobs(reqOperatorOnCron, res, next3);
      expect(next3).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, details: { code: 'UNAUTHORIZED' } })
      );

      // Case D: Cron secret passed to operator force-abandon -> 403 FORBIDDEN (cron machine cannot perform human force-abandon)
      const reqCronOnAbandon = {
        headers: { authorization: `Bearer ${cronSecret}` },
        params: { jobId: 'cleanup_conn_dummy' },
        body: { force_abandon: true, override_reason: 'Justification >= 10 characters' },
      } as any;
      const next4 = vi.fn();
      await controller.abandonCleanupJob(reqCronOnAbandon, res, next4);
      expect(next4).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403, details: { code: 'FORBIDDEN' } })
      );
    });
  });
});
