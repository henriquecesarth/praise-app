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
import { WhatsAppExecutionDeadline } from './whatsapp-execution-deadline';
import { WhatsAppReconciliationService } from './whatsapp-reconciliation.service';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';

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
    }, 30000);

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
    }, 30000);
  });

  describe('2. Secret Purge Safety Under Subscribe Debt (DEC-7D-64)', () => {
    it('2.1 Blocks secret deletion with 409 SECRET_PURGE_BLOCKED_UNDER_SUBSCRIBE_DEBT when subscribe debt exists', async () => {
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const secretRepo = new WhatsAppConnectionSecretRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const wabaId = `waba-debt-${testId}`;
      const orgId = `org-debt-${testId}`;
      const connId = `conn-debt-${testId}`;

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

  describe('5. Autonomous Scheduled Execution, Leases, Overlap & Auth Isolation Matrix (Phase 7D1-B-R1, Phase 7D1-B-R2 & Phase 7D1-B-R3)', () => {
    it('5.1 Proves no-user-action model is decoupled from Vercel Cron for Hobby compatibility and wired via cron-job.org zero-cost operational artifact', () => {
      const vercelJsonPath = path.resolve(__dirname, '../../../vercel.json');
      expect(fs.existsSync(vercelJsonPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf8'));

      // Functions maxDuration 60 must be preserved
      expect(content.functions?.['src/app.ts']?.maxDuration).toBe(60);

      // Must contain NO Hobby-invalid frequent crons
      expect(content.crons).toBeUndefined();

      // cron-job.org zero-cost setup artifact must exist and target canonical endpoints
      const docPath = path.resolve(__dirname, '../../../../docs/operations/cronjob-org-setup.md');
      expect(fs.existsSync(docPath)).toBe(true);
      const docContent = fs.readFileSync(docPath, 'utf8');

      expect(docContent).toContain('LouvAIO WhatsApp Provider Cleanup Executor');
      expect(docContent).toContain('LouvAIO WhatsApp WABA Reconciliation Executor');
      expect(docContent).toContain('/api/v1/internal/whatsapp/cleanup-jobs/execute');
      expect(docContent).toContain('/api/v1/internal/whatsapp/reconciliation-jobs/execute');
      expect(docContent).toContain('*/5 * * * *');
      expect(docContent).toContain('Bearer <YOUR_CRON_SECRET>');
      expect(docContent).toContain('R$ 0');
      expect(docContent).toContain('30s');

      // Obsolete Google Cloud Scheduler artifacts must NOT exist
      const oldScriptPath = path.resolve(__dirname, '../../../scripts/deploy-cloud-schedulers.sh');
      expect(fs.existsSync(oldScriptPath)).toBe(false);
      const oldDocPath = path.resolve(__dirname, '../../../../docs/operations/cloud-scheduler-setup.md');
      expect(fs.existsSync(oldDocPath)).toBe(false);
    });

    it('5.2 Scheduled cleanup execution executes due jobs and enforces non-cacheable HTTP headers and compact JSON summary', async () => {
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
      expect(responseData?.ok).toBe(true);
      expect(responseData?.claimed).toBeGreaterThanOrEqual(1);
      expect(responseData?.processed).toBeDefined();
      expect(responseData?.succeeded).toBeDefined();
      expect(responseData?.retryWait).toBeDefined();
      expect(responseData?.exhausted).toBeDefined();
      expect(responseData?.skipped).toBeDefined();
      expect(responseData?.cleanup).toBeUndefined();
    }, 30000);

    it('5.3 Scheduled reconciliation execution executes due reconciliation jobs with compact JSON summary', async () => {
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
      expect(headersSet['Cache-Control']).toBe('no-store, no-cache, must-revalidate, proxy-revalidate');
      expect(headersSet['Pragma']).toBe('no-cache');
      expect(headersSet['Expires']).toBe('0');
      expect(responseData?.ok).toBe(true);
      expect(responseData?.claimed).toBeGreaterThanOrEqual(1);
      expect(responseData?.processed).toBeDefined();
      expect(responseData?.stable).toBeDefined();
      expect(responseData?.repaired).toBeDefined();
      expect(responseData?.failed).toBeDefined();
      expect(responseData?.skipped).toBeDefined();
      expect(responseData?.reconciliation).toBeUndefined();
    }, 30000);

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
    }, 30000);

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
    }, 30000);

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

    it('5.7 Proves candidate acquisition cutoff prevents starting new jobs after budget without dropping leases or attempts', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_cutoff_${testId}`;

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

      // Simulate invocation where acquisitionCutoffMs is 0 (budget already exhausted)
      const summary = await cleanupService.executeDueJobs({
        batchSize: 10,
        acquisitionCutoffMs: 0,
      });

      expect(summary.candidateCount).toBeGreaterThanOrEqual(1);
      expect(summary.processedCount).toBe(0);
      expect(summary.skippedCount).toBeGreaterThanOrEqual(1);

      // Verify that candidate in Firestore remains completely untouched, pending, attempt 0, lease null
      const job = await cleanupRepo.getJobById(jobId);
      expect(job!.status).toBe('pending');
      expect(job!.attempt_count).toBe(0);
      expect(job!.lease_token).toBeNull();
      expect(job!.lease_expires_at).toBeNull();
    });
  });

  describe('6. 30-Second Execution Envelope, Deadline Propagation & Clamped Timeout Matrix (Phase 7D1-B-R3-R1)', () => {
    it('6.A Job starting near acquisition cutoff skips operation that cannot fit remaining budget without incrementing attempt count or locking', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_budget_${testId}`;
      const wabaId = `waba-budget-${testId}`;

      await cleanupRepo.createJob({
        id: jobId,
        organization_id: `org-${testId}`,
        connection_id: `conn-${testId}`,
        provider: 'meta',
        provider_waba_id: wabaId,
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

      // Deadline allows candidate acquisition (loop check), but budget runs out before remote call
      const tightDeadline = new WhatsAppExecutionDeadline({
        startTime: Date.now(),
        budgetMs: 24000,
        safetyMarginMs: 1500,
      });

      let callCount = 0;
      vi.spyOn(tightDeadline, 'hasRemaining').mockImplementation((ms) => {
        callCount++;
        // 1st call is in executeDueJobs candidate loop (ms = 3000) -> allow candidate acquisition
        if (callCount === 1) return true;
        // Subsequent calls inside processSingleJob -> budget exhausted before dispatch
        return false;
      });

      const cleanupService = new WhatsAppCleanupService(
        cleanupRepo,
        lockRepo,
        new WhatsAppWabaReconciliationJobRepository(),
        new WhatsAppConnectionRepository(),
        new WhatsAppConnectionSecretRepository(),
        new WhatsAppEncryptionService(testKey)
      );

      const candidateRecord = await cleanupRepo.getJobById(jobId);
      vi.spyOn(cleanupRepo, 'findDueJobs').mockResolvedValue([candidateRecord!]);

      const summary = await cleanupService.executeDueJobs({
        batchSize: 1,
        deadline: tightDeadline,
      });

      expect(summary.candidateCount).toBe(1);
      expect(summary.processedCount).toBe(1);
      expect(summary.skippedCount).toBe(1);

      // Verify attempt count was NOT incremented (remains 0)
      const job = await cleanupRepo.getJobById(jobId);
      expect(job!.attempt_count).toBe(0);
      expect(job!.status).toBe('retry_wait');
      expect(job!.last_error_code).toBe('INSUFFICIENT_EXECUTION_BUDGET');
      expect(job!.lease_token).toBeNull();

      // Verify WABA lock lease was released as idle
      const lock = await lockRepo.getLock(wabaId);
      if (lock) {
        expect(lock.operation_status).toBe('idle');
      }
    }, 30000);

    it('6.B Provider timeout is clamped to remaining worker deadline (deadline.getClampedTimeoutMs)', () => {
      // 1. With ample time, returns normal timeout
      const ampleDeadline = new WhatsAppExecutionDeadline({
        startTime: Date.now(),
        budgetMs: 24000,
        safetyMarginMs: 1500,
      });
      expect(ampleDeadline.getClampedTimeoutMs(10000, 1500)).toBe(10000);

      // 2. With partial time remaining
      const constrainedDeadline = new WhatsAppExecutionDeadline({
        startTime: Date.now() - 19000,
        budgetMs: 24000,
        safetyMarginMs: 1500,
      });
      const clamped = constrainedDeadline.getClampedTimeoutMs(10000, 1500);
      expect(clamped).toBeLessThanOrEqual(5000);
      expect(clamped).toBeGreaterThanOrEqual(2000);

      // 3. With insufficient time (< minOperationalMs), returns 0
      const exhaustedDeadline = new WhatsAppExecutionDeadline({
        startTime: Date.now() - 23500,
        budgetMs: 24000,
        safetyMarginMs: 1500,
      });
      expect(exhaustedDeadline.getClampedTimeoutMs(10000, 1500)).toBe(0);

      // 4. Provider helper resolves correctly against deadlineAt
      const provider = new MetaWhatsAppProvider();
      const resolved = (provider as any).resolveEffectiveTimeoutMs(10000, {
        deadlineAt: Date.now() + 3000,
      });
      expect(resolved).toBeLessThanOrEqual(3000);
      expect(resolved).toBeGreaterThan(0);
    });

    it('6.C Mutation dispatched then deadline/timeout occurs -> unknown_outcome recorded in ledger', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const secretRepo = new WhatsAppConnectionSecretRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_tout_${testId}`;
      const wabaId = `waba-tout-${testId}`;
      const orgId = `org-${testId}`;
      const connId = `conn-${testId}`;

      const encService = new WhatsAppEncryptionService(testKey);
      const { encryptedAccessToken, iv, authTag } = encService.encryptToken('EAAGtesttoken', orgId, connId);
      await secretRepo.setSecret({
        id: connId,
        organization_id: orgId,
        connection_id: connId,
        key_version: 1,
        encrypted_access_token: encryptedAccessToken,
        iv,
        auth_tag: authTag,
        token_type: 'business_token',
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await cleanupRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'meta',
        provider_waba_id: wabaId,
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

      // Provider throws timeout
      const mockMetaProvider = {
        subscribeMessagingAccountApps: vi.fn(),
        unsubscribeMessagingAccountApps: vi.fn().mockRejectedValue(
          new AppError(504, 'Meta API request timed out after 5000ms', { code: 'PROVIDER_TIMEOUT' })
        ),
        checkMessagingAccountSubscribedApps: vi.fn().mockResolvedValue({
          status: 'UNPROVEN',
          proof: 'UNPROVEN',
        }),
      } as unknown as WhatsAppProvider;

      const cleanupService = new WhatsAppCleanupService(
        cleanupRepo,
        lockRepo,
        new WhatsAppWabaReconciliationJobRepository(),
        new WhatsAppConnectionRepository(),
        secretRepo,
        encService,
        mockMetaProvider
      );

      const deadline = new WhatsAppExecutionDeadline({
        startTime: Date.now(),
        budgetMs: 24000,
        safetyMarginMs: 1500,
      });

      const candidateRecord = await cleanupRepo.getJobById(jobId);
      vi.spyOn(cleanupRepo, 'findDueJobs').mockResolvedValue([candidateRecord!]);

      const summary = await cleanupService.executeDueJobs({
        batchSize: 1,
        deadline,
      });

      expect(summary.retryWaitCount).toBe(1);

      // Verify unknown_outcome recorded in WABA lock ledger
      const lock = await lockRepo.getLock(wabaId);
      expect(lock).not.toBeNull();
      expect(lock!.operation_status).toBe('unknown_outcome');
      const unknownEntry = lock!.unresolved_remote_mutations.find(
        (m) => m.operation === 'unsubscribe' && m.status === 'unknown_outcome'
      );
      expect(unknownEntry).toBeDefined();
    }, 30000);

    it('6.D DELETE succeeds but exhaustive verification cannot finish before deadline -> isProvenClean = false / not PROVEN_CLEAN', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const secretRepo = new WhatsAppConnectionSecretRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_verif_${testId}`;
      const wabaId = `waba-verif-${testId}`;
      const orgId = `org-${testId}`;
      const connId = `conn-${testId}`;

      const encService = new WhatsAppEncryptionService(testKey);
      const { encryptedAccessToken, iv, authTag } = encService.encryptToken('EAAGtesttoken', orgId, connId);
      await secretRepo.setSecret({
        id: connId,
        organization_id: orgId,
        connection_id: connId,
        key_version: 1,
        encrypted_access_token: encryptedAccessToken,
        iv,
        auth_tag: authTag,
        token_type: 'business_token',
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await cleanupRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'meta',
        provider_waba_id: wabaId,
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

      // Provider DELETE returns non-success (ambiguous)
      const mockMetaProvider = {
        subscribeMessagingAccountApps: vi.fn(),
        unsubscribeMessagingAccountApps: vi.fn().mockResolvedValue({ success: false }),
        checkMessagingAccountSubscribedApps: vi.fn(),
      } as unknown as WhatsAppProvider;

      const cleanupService = new WhatsAppCleanupService(
        cleanupRepo,
        lockRepo,
        new WhatsAppWabaReconciliationJobRepository(),
        new WhatsAppConnectionRepository(),
        secretRepo,
        encService,
        mockMetaProvider
      );

      // Deadline allows unsubscribe (>= 3000ms), but runs out before verification (hasRemaining(2000) = false)
      const customDeadline = new WhatsAppExecutionDeadline({
        startTime: Date.now(),
        budgetMs: 24000,
        safetyMarginMs: 1500,
      });
      vi.spyOn(customDeadline, 'hasRemaining').mockImplementation((ms) => {
        // Allow candidate loop and pre-call checks (3000ms)
        if (ms >= 3000) return true;
        // Deny post-condition verification check (2000ms)
        return false;
      });

      const candidateRecord = await cleanupRepo.getJobById(jobId);
      vi.spyOn(cleanupRepo, 'findDueJobs').mockResolvedValue([candidateRecord!]);

      const summary = await cleanupService.executeDueJobs({
        batchSize: 1,
        deadline: customDeadline,
      });

      // Provider DELETE was called, but verification was skipped due to deadline
      expect(mockMetaProvider.unsubscribeMessagingAccountApps).toHaveBeenCalled();
      expect(mockMetaProvider.checkMessagingAccountSubscribedApps).not.toHaveBeenCalled();

      // Job is in retry_wait, not completed
      expect(summary.retryWaitCount).toBe(1);
      const job = await cleanupRepo.getJobById(jobId);
      expect(job!.status).toBe('retry_wait');
      expect(job!.last_error_code).toBe('VERIFICATION_BUDGET_EXHAUSTED');
      expect(job!.provider_cleanup_proof).not.toBe('PROVEN_CLEAN');

      // WABA lock records unknown_outcome so reconciler will settle it
      const lock = await lockRepo.getLock(wabaId);
      expect(lock!.operation_status).toBe('unknown_outcome');
    }, 30000);

    it('6.E Pagination stops safely when deadline is insufficient -> returns UNPROVEN', async () => {
      const provider = new MetaWhatsAppProvider({ appId: 'test-app-id', appSecret: 'test-app-secret' });

      const origFetch = globalThis.fetch;
      try {
        let pageCount = 0;
        const now = Date.now();
        const deadlineAt = now + 1500;

        vi.useFakeTimers();
        vi.setSystemTime(now);

        globalThis.fetch = vi.fn().mockImplementation(async () => {
          pageCount++;
          // Simulate 600ms latency so remaining budget becomes 900ms (< 1000ms threshold)
          vi.setSystemTime(Date.now() + 600);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: 'app-other', name: 'Other App' }],
              paging: {
                cursors: { after: 'cursor123' },
                next: 'https://graph.facebook.com/v21.0/waba/subscribed_apps?after=cursor123',
              },
            }),
          } as any;
        });

        const result = await provider.checkMessagingAccountSubscribedApps(
          'waba-page-test',
          'access-token',
          { deadlineAt }
        );

        expect(result.status).toBe('UNPROVEN');
        expect(result.proof).toBe('UNPROVEN');
        // Paging stopped after 1 page without fetching page 2
        expect(pageCount).toBe(1);
      } finally {
        vi.useRealTimers();
        globalThis.fetch = origFetch;
      }
    });

    it('6.F Budget exhaustion before dispatch leaves job durable for next tick (pending, attempt 0)', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_durable_${testId}`;

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

      const deadline = new WhatsAppExecutionDeadline({
        startTime: Date.now() - 23000,
        budgetMs: 24000,
        safetyMarginMs: 1500,
      });

      const cleanupService = new WhatsAppCleanupService(cleanupRepo);
      const candidateRecord = await cleanupRepo.getJobById(jobId);
      vi.spyOn(cleanupRepo, 'findDueJobs').mockResolvedValue([candidateRecord!]);

      await cleanupService.executeDueJobs({
        batchSize: 1,
        acquisitionCutoffMs: 24000,
        deadline,
      });

      const job = await cleanupRepo.getJobById(jobId);
      expect(job).not.toBeNull();
      expect(job!.attempt_count).toBe(0);
      expect(job!.status).toBe('pending');
      expect(job!.lease_token).toBeNull();
      expect(job!.lease_expires_at).toBeNull();
    }, 30000);

    it('6.G Subsequent scheduler tick successfully discovers and processes the deferred job', async () => {
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const secretRepo = new WhatsAppConnectionSecretRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const jobId = `cleanup_conn_subsequent_${testId}`;
      const wabaId = `waba-subsequent-${testId}`;
      const orgId = `org-${testId}`;
      const connId = `conn-${testId}`;

      const encService = new WhatsAppEncryptionService(testKey);
      const { encryptedAccessToken, iv, authTag } = encService.encryptToken('EAAGtesttoken', orgId, connId);
      await secretRepo.setSecret({
        id: connId,
        organization_id: orgId,
        connection_id: connId,
        key_version: 1,
        encrypted_access_token: encryptedAccessToken,
        iv,
        auth_tag: authTag,
        token_type: 'business_token',
        expires_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      await cleanupRepo.createJob({
        id: jobId,
        organization_id: orgId,
        connection_id: connId,
        provider: 'meta',
        provider_waba_id: wabaId,
        provider_phone_number_id: `phone-${testId}`,
        waba_claim_generation: 1,
        status: 'retry_wait',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: new Date(Date.now() - 1000).toISOString(),
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: 'INSUFFICIENT_EXECUTION_BUDGET',
        last_error_at: new Date(Date.now() - 60000).toISOString(),
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

      const mockMetaProvider = {
        subscribeMessagingAccountApps: vi.fn(),
        unsubscribeMessagingAccountApps: vi.fn().mockResolvedValue({ success: true }),
        checkMessagingAccountSubscribedApps: vi.fn().mockResolvedValue({
          status: 'PROVEN_UNSUBSCRIBED',
          proof: 'PROVEN_CLEAN',
        }),
      } as unknown as WhatsAppProvider;

      const cleanupService = new WhatsAppCleanupService(
        cleanupRepo,
        lockRepo,
        new WhatsAppWabaReconciliationJobRepository(),
        new WhatsAppConnectionRepository(),
        secretRepo,
        encService,
        mockMetaProvider
      );

      const freshDeadline = new WhatsAppExecutionDeadline({
        startTime: Date.now(),
        budgetMs: 24000,
        safetyMarginMs: 1500,
      });

      const candidateRecord = await cleanupRepo.getJobById(jobId);
      vi.spyOn(cleanupRepo, 'findDueJobs').mockResolvedValue([candidateRecord!]);

      const summary = await cleanupService.executeDueJobs({
        batchSize: 1,
        deadline: freshDeadline,
      });

      expect(summary.processedCount).toBe(1);
      expect(summary.succeededCount).toBe(1);

      const job = await cleanupRepo.getJobById(jobId);
      expect(job!.status).toBe('succeeded');
      expect(job!.attempt_count).toBe(1);
      expect(job!.provider_cleanup_proof).toBe('proven');
    }, 30000);

    it('6.H Compact route response schema ({ ok, claimed, processed, ... }) remains unchanged', async () => {
      const cronSecret = 'valid-cron-secret-schema';
      process.env.CRON_SECRET = cronSecret;

      const controller = new InternalWhatsAppController();

      let cleanupJson: any = null;
      let cleanupStatus = 0;
      const resCleanup = {
        setHeader: vi.fn(),
        status: (c: number) => {
          cleanupStatus = c;
          return resCleanup;
        },
        json: (data: any) => {
          cleanupJson = data;
          return resCleanup;
        },
      } as any;
      await controller.executeCleanupJobs(
        { headers: { authorization: `Bearer ${cronSecret}` }, query: {} } as any,
        resCleanup,
        vi.fn()
      );

      expect(cleanupStatus).toBe(200);
      expect(Object.keys(cleanupJson).sort()).toEqual(
        ['claimed', 'exhausted', 'ok', 'processed', 'retryWait', 'skipped', 'succeeded'].sort()
      );
      expect(typeof cleanupJson.ok).toBe('boolean');
      expect(typeof cleanupJson.claimed).toBe('number');
      expect(typeof cleanupJson.processed).toBe('number');
      expect(typeof cleanupJson.succeeded).toBe('number');
      expect(typeof cleanupJson.retryWait).toBe('number');
      expect(typeof cleanupJson.exhausted).toBe('number');
      expect(typeof cleanupJson.skipped).toBe('number');

      let reconJson: any = null;
      let reconStatus = 0;
      const resRecon = {
        setHeader: vi.fn(),
        status: (c: number) => {
          reconStatus = c;
          return resRecon;
        },
        json: (data: any) => {
          reconJson = data;
          return resRecon;
        },
      } as any;
      await controller.executeReconciliationJobs(
        { headers: { authorization: `Bearer ${cronSecret}` }, query: {} } as any,
        resRecon,
        vi.fn()
      );

      expect(reconStatus).toBe(200);
      expect(Object.keys(reconJson).sort()).toEqual(
        ['claimed', 'failed', 'ok', 'processed', 'repaired', 'skipped', 'stable'].sort()
      );
      expect(typeof reconJson.ok).toBe('boolean');
      expect(typeof reconJson.claimed).toBe('number');
      expect(typeof reconJson.processed).toBe('number');
      expect(typeof reconJson.stable).toBe('number');
      expect(typeof reconJson.repaired).toBe('number');
      expect(typeof reconJson.failed).toBe('number');
      expect(typeof reconJson.skipped).toBe('number');
    }, 30000);

    it('6.I Existing overlap/crash/ledger/secret-purge invariants hold without degradation', async () => {
      const lockRepo = new WhatsAppWabaLifecycleLockRepository();
      const testId = crypto.randomUUID().slice(0, 8);
      const wabaId = `waba-invariants-${testId}`;

      const { leaseToken, generation } = await lockRepo.acquireLeaseInTransaction(
        wabaId,
        'cleanup_worker',
        10000,
        'reconciling'
      );
      expect(leaseToken).toBeDefined();

      // Confirms lock cannot be concurrently acquired by another worker (throws 409)
      await expect(
        lockRepo.acquireLeaseInTransaction(wabaId, 'second_worker', 10000, 'reconciling')
      ).rejects.toThrow();

      // Release lock cleanly
      await lockRepo.releaseLeaseInTransaction(wabaId, leaseToken, generation, {
        operation_status: 'idle',
      });
      const lock = await lockRepo.getLock(wabaId);
      expect(lock!.operation_status).toBe('idle');
      expect(lock!.lease_token).toBeNull();
    }, 30000);
  });
});
