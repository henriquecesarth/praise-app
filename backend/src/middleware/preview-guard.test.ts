import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isPreviewEnvironment } from '../config/unifiedConfig';
import { blockInPreview } from './preview-guard';
import { AppError } from './error-handler';
import { PushNotificationService } from '../features/push_notifications/push-notification.service';
import { WhatsAppOutboundService } from '../features/whatsapp/whatsapp-outbound.service';
import { AsaasBillingProvider } from '../features/billing/providers/asaas/asaas.provider';
import { ZernioHttpClient } from '../features/whatsapp/zernio-http-client';
import { SubscriptionService } from '../features/subscriptions/subscription.service';
import { BillingService } from '../features/billing/billing.service';
import { WhatsAppConnectionService } from '../features/whatsapp/whatsapp-connection.service';
import { WhatsAppCleanupService } from '../features/whatsapp/whatsapp-cleanup.service';
import { WhatsAppReconciliationService } from '../features/whatsapp/whatsapp-reconciliation.service';
import { WhatsAppProviderCleanupJobRepository } from '../repositories/WhatsAppProviderCleanupJobRepository';
import { WhatsAppWabaReconciliationJobRepository } from '../repositories/WhatsAppWabaReconciliationJobRepository';
import { AccountDeletionRepository } from '../repositories/AccountDeletionRepository';
import { AccountDeletionService } from '../features/account_deletion/account-deletion.service';
import { BillingRepository } from '../repositories/BillingRepository';
import { WhatsAppConnectionRepository } from '../repositories/WhatsAppConnectionRepository';
import { db } from '../lib/firebase';

describe('Preview Mode Fail-Closed Isolation (R3-C5 & R3-C7)', () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalPreviewMode = process.env.PREVIEW_MODE;
  const originalVercel = process.env.VERCEL;

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
    delete process.env.PREVIEW_MODE;
    delete process.env.VERCEL;
  });

  afterEach(() => {
    if (originalVercelEnv !== undefined) {
      process.env.VERCEL_ENV = originalVercelEnv;
    } else {
      delete process.env.VERCEL_ENV;
    }

    if (originalPreviewMode !== undefined) {
      process.env.PREVIEW_MODE = originalPreviewMode;
    } else {
      delete process.env.PREVIEW_MODE;
    }

    if (originalVercel !== undefined) {
      process.env.VERCEL = originalVercel;
    } else {
      delete process.env.VERCEL;
    }
  });

  describe('1. Environment Detection and Precedence (Finding P2 & Step 1)', () => {
    it('VERCEL_ENV=production strictly takes precedence over PREVIEW_MODE=true', () => {
      process.env.VERCEL_ENV = 'production';
      process.env.PREVIEW_MODE = 'true';
      expect(isPreviewEnvironment()).toBe(false);
    });

    it('VERCEL_ENV=production returns false when PREVIEW_MODE is false or unset', () => {
      process.env.VERCEL_ENV = 'production';
      expect(isPreviewEnvironment()).toBe(false);
      process.env.PREVIEW_MODE = 'false';
      expect(isPreviewEnvironment()).toBe(false);
    });

    it('VERCEL_ENV=preview strictly enforces preview mode even if PREVIEW_MODE=false', () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.PREVIEW_MODE = 'false';
      expect(isPreviewEnvironment()).toBe(true);
    });

    it('VERCEL_ENV=preview enforces preview mode when PREVIEW_MODE is true or unset', () => {
      process.env.VERCEL_ENV = 'preview';
      expect(isPreviewEnvironment()).toBe(true);
      process.env.PREVIEW_MODE = 'true';
      expect(isPreviewEnvironment()).toBe(true);
    });

    it('VERCEL=1 fails closed to preview mode when VERCEL_ENV is missing (prevents unverified execution as production)', () => {
      process.env.VERCEL = '1';
      expect(isPreviewEnvironment()).toBe(true);
    });

    it('VERCEL=1 with explicit VERCEL_ENV=production strictly runs as production', () => {
      process.env.VERCEL = '1';
      process.env.VERCEL_ENV = 'production';
      expect(isPreviewEnvironment()).toBe(false);
    });

    it('Local development respects PREVIEW_MODE=true', () => {
      process.env.PREVIEW_MODE = 'true';
      expect(isPreviewEnvironment()).toBe(true);
    });

    it('Local development without PREVIEW_MODE returns false (normal development)', () => {
      expect(isPreviewEnvironment()).toBe(false);
      process.env.PREVIEW_MODE = 'false';
      expect(isPreviewEnvironment()).toBe(false);
    });
  });

  describe('2. Route Guard Middleware (blockInPreview)', () => {
    it('blocks prohibited operations with HTTP 403 AppError in preview mode', () => {
      process.env.PREVIEW_MODE = 'true';

      const mockReq = {} as any;
      const mockRes = {} as any;
      const mockNext = vi.fn();

      const middleware = blockInPreview('Operação de checkout');
      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      const err = mockNext.mock.calls[0][0];
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(403);
      expect(err.message).toContain('Operação de checkout desabilitado(a) no ambiente de Preview.');
      expect(err.details?.code).toBe('PREVIEW_MODE_BLOCKED');
    });

    it('blocks billing contact endpoint in preview mode', () => {
      process.env.PREVIEW_MODE = 'true';
      const mockNext = vi.fn();
      blockInPreview('Definição de contato de faturamento')({} as any, {} as any, mockNext);
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
      expect(err.details?.code).toBe('PREVIEW_MODE_BLOCKED');
    });

    it('blocks billing reconcile endpoint in preview mode', () => {
      process.env.PREVIEW_MODE = 'true';
      const mockNext = vi.fn();
      blockInPreview('Reconciliação manual de faturamento')({} as any, {} as any, mockNext);
      const err = mockNext.mock.calls[0][0];
      expect(err.statusCode).toBe(403);
      expect(err.details?.code).toBe('PREVIEW_MODE_BLOCKED');
    });

    it('blocks WhatsApp onboarding and disconnection endpoints in preview mode', () => {
      process.env.PREVIEW_MODE = 'true';
      const mockNext1 = vi.fn();
      blockInPreview('Início do onboarding do WhatsApp')({} as any, {} as any, mockNext1);
      expect(mockNext1.mock.calls[0][0].statusCode).toBe(403);

      const mockNext2 = vi.fn();
      blockInPreview('Desconexão do canal WhatsApp')({} as any, {} as any, mockNext2);
      expect(mockNext2.mock.calls[0][0].statusCode).toBe(403);
    });

    it('allows operations to pass in normal production/development mode', () => {
      process.env.VERCEL_ENV = 'production';

      const mockReq = {} as any;
      const mockRes = {} as any;
      const mockNext = vi.fn();

      const middleware = blockInPreview('Operação de checkout');
      middleware(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
      expect(mockNext).toHaveBeenCalledWith();
    });
  });

  describe('3. External Provider Boundaries (Finding P1-A & P1-B)', () => {
    it('AsaasBillingProvider: rejects mutating/checkout methods even if credentials are present', async () => {
      process.env.PREVIEW_MODE = 'true';
      const fetchSpy = vi.spyOn(global, 'fetch');

      const provider = new AsaasBillingProvider({
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        apiKey: 'test_real_looking_api_key_123',
        webhookToken: 'test_token',
      });

      await expect(
        provider.createCustomer({ ministryId: 'm1', ministryName: 'Igreja Teste', email: 'teste@igreja.com', taxId: '00000000000' })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Chamada ao provedor de faturamento Asaas (createCustomer) desabilitada no ambiente de Preview.');

      await expect(
        provider.updateCustomer('cus_123', { name: 'Igreja Nova' })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Chamada ao provedor de faturamento Asaas (updateCustomer) desabilitada no ambiente de Preview.');

      await expect(
        provider.createCheckout({
          ministryId: 'm1',
          providerCustomerId: 'cus_123',
          planId: 'pro',
          planName: 'Pro',
          interval: 'monthly',
          addonBlocks: 0,
          amountCents: 5900,
        })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Chamada ao provedor de faturamento Asaas (createHostedCheckout) desabilitada no ambiente de Preview.');

      await expect(
        provider.cancelSubscription('sub_123')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Chamada ao provedor de faturamento Asaas (cancelSubscription) desabilitada no ambiente de Preview.');

      await expect(
        provider.inactivateSubscription('sub_123')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Chamada ao provedor de faturamento Asaas (inactivateSubscription) desabilitada no ambiente de Preview.');

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('ZernioHttpClient: rejects external requests even if API key is present', async () => {
      process.env.PREVIEW_MODE = 'true';
      const fetchSpy = vi.spyOn(global, 'fetch');

      const client = new ZernioHttpClient({
        apiKey: 'test_zernio_token_xyz',
        baseUrl: 'https://zernio.example.com',
      });

      await expect(
        client.request('/accounts', { method: 'GET' })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Chamada ao provedor Zernio desabilitada no ambiente de Preview.');

      await expect(
        client.deleteAccount('acc_123')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Chamada ao provedor Zernio desabilitada no ambiente de Preview.');

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('External providers in production mode do not throw PREVIEW_MODE_BLOCKED', async () => {
      process.env.VERCEL_ENV = 'production';
      const fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async () => {
        return new Response(JSON.stringify({ id: 'cus_prod_1' }), { status: 200 });
      });

      const provider = new AsaasBillingProvider({
        apiUrl: 'https://sandbox.asaas.com/api/v3',
        apiKey: 'test_key',
      });

      const res = await provider.createCustomer({ ministryId: 'm1', ministryName: 'Igreja Prod', email: 'prod@igreja.com', taxId: '00000000000' });
      expect(res.providerCustomerId).toBe('cus_prod_1');
      expect(fetchSpy).toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  describe('4. Subscription & Billing Service Boundaries', () => {
    it('SubscriptionService: blocks plan changes and complimentary plan grants/revocations', async () => {
      process.env.PREVIEW_MODE = 'true';
      const service = new SubscriptionService();

      await expect(
        service.grantComplimentaryPlan('m1', 'pro', 'admin_1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Concessão de plano cortesia desabilitada no ambiente de Preview.');

      await expect(
        service.revokeComplimentaryPlan('m1', 'admin_1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Revogação de plano cortesia desabilitada no ambiente de Preview.');

      await expect(
        service.changePlan('m1', 'pro')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Alteração de plano desabilitada no ambiente de Preview.');
    });

    it('BillingService: blocks billing contact, reconcile, checkout and cancellation', async () => {
      process.env.PREVIEW_MODE = 'true';
      const service = new BillingService();

      await expect(
        service.setBillingContact('m1', 'u1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Atualização de contato de faturamento desabilitada no ambiente de Preview.');

      await expect(
        service.reconcileBillingSubscription('m1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Reconciliação de faturamento desabilitada no ambiente de Preview.');

      await expect(
        service.createCheckout('m1', 'admin_1', { targetPlan: 'pro', cycle: 'monthly' } as any)
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Criação de checkout desabilitada no ambiente de Preview.');

      await expect(
        service.cancelSubscription('m1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Cancelamento de assinatura desabilitado no ambiente de Preview.');

      await expect(
        service.processPlanChangeSupersede('change_1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Transição de plano desabilitada no ambiente de Preview.');
    });
  });

  describe('5. WhatsApp Connection & Lifecycle Boundaries', () => {
    it('WhatsAppConnectionService: blocks onboarding, update and disconnection', async () => {
      process.env.PREVIEW_MODE = 'true';
      const service = new WhatsAppConnectionService();

      await expect(
        service.startOnboarding('org_1', 'u1', { returnUrl: 'https://example.com' } as any)
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Início de onboarding WhatsApp desabilitado no ambiente de Preview.');

      await expect(
        service.completeOnboarding('org_1', 'u1', { sessionId: 'sess_1', stateNonce: 'n1', code: 'c1', wabaId: 'w1', phoneNumberId: 'p1' })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Conclusão de onboarding WhatsApp desabilitada no ambiente de Preview.');

      await expect(
        service.updateConnection('org_1', 'conn_1', {}, 'u1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Atualização de conexão WhatsApp desabilitada no ambiente de Preview.');

      await expect(
        service.disconnectConnection('org_1', 'conn_1', 'u1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Desconexão de WhatsApp desabilitada no ambiente de Preview.');
    });

    it('WhatsAppCleanupService: blocks executeDueJobs in preview mode', async () => {
      process.env.PREVIEW_MODE = 'true';
      const service = new WhatsAppCleanupService();

      await expect(
        service.executeDueJobs()
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Execução de jobs de cleanup de WhatsApp desabilitada no ambiente de Preview.');
    });

    it('WhatsAppReconciliationService: blocks executeDueJobs in preview mode', async () => {
      process.env.PREVIEW_MODE = 'true';
      const service = new WhatsAppReconciliationService();

      await expect(
        service.executeDueJobs()
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Execução de jobs de reconciliação de WhatsApp desabilitada no ambiente de Preview.');
    });
  });

  describe('6. Shared Job Creation Boundaries (Producers of shared Firestore jobs)', () => {
    it('WhatsAppProviderCleanupJobRepository: createJob fails closed before writing to Firestore', async () => {
      process.env.PREVIEW_MODE = 'true';
      const repo = new WhatsAppProviderCleanupJobRepository();

      await expect(
        repo.createJob({
          id: 'cleanup_1',
          org_id: 'org_1',
          connection_id: 'conn_1',
          status: 'pending',
          attempt_count: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        } as any)
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Enfileiramento de jobs de cleanup de WhatsApp desabilitado no ambiente de Preview.');
    });

    it('WhatsAppWabaReconciliationJobRepository: ensureJobPending & ensureZernioJobPending fail closed', async () => {
      process.env.PREVIEW_MODE = 'true';
      const repo = new WhatsAppWabaReconciliationJobRepository();

      await expect(
        repo.ensureJobPending('waba_1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Enfileiramento de jobs de reconciliação de WhatsApp desabilitado no ambiente de Preview.');

      await expect(
        repo.ensureZernioJobPending({
          connectionId: 'conn_1',
          organizationId: 'org_1',
        })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Enfileiramento de jobs de reconciliação de WhatsApp desabilitado no ambiente de Preview.');
    });

    it('AccountDeletionRepository: saveJob fails closed before writing to Firestore', async () => {
      process.env.PREVIEW_MODE = 'true';
      const repo = new AccountDeletionRepository();

      await expect(
        repo.saveJob({
          id: 'del_user1',
          user_id: 'user1',
          status: 'pending',
        } as any)
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Criação de jobs de exclusão de conta desabilitada no ambiente de Preview.');
    });

    it('AccountDeletionService: executeDeletion fails closed in preview mode', async () => {
      process.env.PREVIEW_MODE = 'true';
      const service = new AccountDeletionService();

      await expect(
        service.executeDeletion('user1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Exclusão de contas desabilitada no ambiente de Preview.');
    });
  });

  describe('7. Push Notifications & WhatsApp Outbound (Preserved R3-C3 Guards)', () => {
    it('PushNotificationService: reject push dispatch in preview mode', async () => {
      process.env.PREVIEW_MODE = 'true';
      const pushService = new PushNotificationService();

      await expect(
        pushService.sendToUser('user-123', {
          title: 'Notificação',
          body: 'Teste',
          data: { type: 'announcement', ministryId: 'm1' },
        })
      ).rejects.toThrow('Disparo de push notifications (FCM) desabilitado no ambiente de Preview.');
    });

    it('WhatsAppOutboundService: reject proactive template messages in preview mode', async () => {
      process.env.PREVIEW_MODE = 'true';
      const whatsappOutbound = new WhatsAppOutboundService();

      await expect(
        whatsappOutbound.sendProactiveTemplate({
          dispatchId: 'disp-1',
          recipientPhone: '+5511999999999',
          templateName: 'test_tpl',
          templateLanguage: 'pt_BR',
        })
      ).rejects.toThrow('Operações de envio de WhatsApp estão desabilitadas no ambiente de Preview.');
    });

    it('WhatsAppOutboundService: reject existing conversation text messages in preview mode', async () => {
      process.env.PREVIEW_MODE = 'true';
      const whatsappOutbound = new WhatsAppOutboundService();

      await expect(
        whatsappOutbound.sendExistingConversationText({
          dispatchId: 'disp-2',
          conversationId: 'conv-1',
          messageText: 'Olá',
        })
      ).rejects.toThrow('Operações de envio de WhatsApp estão desabilitadas no ambiente de Preview.');
    });
  });

  describe('8. Shared Side-Effect Writers Remediation (R3-C7 Finding P1-A & P1-B)', () => {
    it('BillingService.prepareScheduledCancelToFreeTransition: fails closed in Preview without calling db.runTransaction', async () => {
      process.env.PREVIEW_MODE = 'true';
      const txSpy = vi.spyOn(db, 'runTransaction');
      const billingService = new BillingService();

      await expect(
        billingService.prepareScheduledCancelToFreeTransition('min_1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Preparação de transição de cancelamento desabilitada no ambiente de Preview.');

      expect(txSpy).not.toHaveBeenCalled();
      txSpy.mockRestore();
    });

    it('BillingRepository.createTransitionAndClaimSlot: fails closed in Preview before transaction/slot persistence', async () => {
      process.env.PREVIEW_MODE = 'true';
      const txSpy = vi.spyOn(db, 'runTransaction');
      const billingRepo = new BillingRepository();

      await expect(
        billingRepo.createTransitionAndClaimSlot({
          id: 'change_1',
          ministry_id: 'min_1',
          provider: 'asaas',
          transition_type: 'scheduled_cancel_to_free',
          transition_status: 'awaiting_old_inactivation',
        } as any)
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Criação de transição e reivindicação de slot desabilitadas no ambiente de Preview.');

      expect(txSpy).not.toHaveBeenCalled();
      txSpy.mockRestore();
    });

    it('Early-activation quotation route & service: fails closed in Preview without mutating Firestore', async () => {
      process.env.PREVIEW_MODE = 'true';
      const txSpy = vi.spyOn(db, 'runTransaction');
      const mockNext = vi.fn();

      // Route guard
      blockInPreview('Cotação de ativação antecipada')({} as any, {} as any, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
      const routeErr = mockNext.mock.calls[0][0];
      expect(routeErr.statusCode).toBe(403);
      expect(routeErr.details?.code).toBe('PREVIEW_MODE_BLOCKED');

      // Service guard
      const billingService = new BillingService();
      await expect(
        billingService.createEarlyActivationQuote('min_1', 'user_1', 'trans_1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Cotação de ativação antecipada desabilitada no ambiente de Preview.');

      // Repository guard
      const billingRepo = new BillingRepository();
      await expect(
        billingRepo.recordEarlyActivationQuote({
          ministryId: 'min_1',
          transitionId: 'trans_1',
          quote: {} as any,
        })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Persistência de cotação de early activation desabilitada no ambiente de Preview.');

      expect(txSpy).not.toHaveBeenCalled();
      txSpy.mockRestore();
    });

    it('WhatsAppConnectionRepository.disconnectConnection: fails closed in Preview before transaction/cleanup job write', async () => {
      process.env.PREVIEW_MODE = 'true';
      const txSpy = vi.spyOn(db, 'runTransaction');
      const connRepo = new WhatsAppConnectionRepository();

      await expect(
        connRepo.disconnectConnection('org_1', 'conn_1')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Desconexão de WhatsApp desabilitada no ambiente de Preview.');

      expect(txSpy).not.toHaveBeenCalled();
      txSpy.mockRestore();
    });

    it('WhatsAppConnectionService.transitionZernioConnectedAtomically: fails closed before reconciliation job write', async () => {
      process.env.PREVIEW_MODE = 'true';
      const txSpy = vi.spyOn(db, 'runTransaction');
      const connService = new WhatsAppConnectionService();

      await expect(
        connService.transitionZernioConnectedAtomically({
          orgId: 'org_1',
          connectionId: 'conn_1',
          providerAccountId: 'acc_1',
          phoneNumber: '+5511999999999',
        })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Transição de conexão e reconciliação Zernio desabilitadas no ambiente de Preview.');

      expect(txSpy).not.toHaveBeenCalled();
      txSpy.mockRestore();
    });

    it('WhatsAppProviderCleanupJobRepository.commitMaterializedDenialOwnershipAtomically: fails closed before cleanup job write', async () => {
      process.env.PREVIEW_MODE = 'true';
      const txSpy = vi.spyOn(db, 'runTransaction');
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();

      await expect(
        cleanupRepo.commitMaterializedDenialOwnershipAtomically({
          organizationId: 'org_1',
          connectionId: 'conn_1',
          sessionId: 'sess_1',
          wabaId: 'waba_1',
          phoneNumberId: 'phone_1',
          normalizedPhoneNumber: '+5511999999999',
        })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Materialização de posse de negação e jobs de cleanup desabilitadas no ambiente de Preview.');

      expect(txSpy).not.toHaveBeenCalled();
      txSpy.mockRestore();
    });

    it('Production mode: operations proceed normally to db.runTransaction without PREVIEW_MODE_BLOCKED error', async () => {
      process.env.VERCEL_ENV = 'production';
      process.env.PREVIEW_MODE = 'false';

      let txCalledCount = 0;
      const txSpy = vi.spyOn(db, 'runTransaction').mockImplementation(async () => {
        txCalledCount++;
        return {} as any;
      });

      const billingRepo = new BillingRepository();
      const connRepo = new WhatsAppConnectionRepository();
      const connService = new WhatsAppConnectionService();
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();

      // 1. Billing slot claim
      await billingRepo.createTransitionAndClaimSlot({
        id: 'change_prod_1',
        ministry_id: 'min_prod',
        provider: 'asaas',
      } as any);
      expect(txCalledCount).toBe(1);

      // 2. WhatsApp disconnect
      await connRepo.disconnectConnection('org_prod', 'conn_prod');
      expect(txCalledCount).toBe(2);

      // 3. Zernio connect transition
      await connService.transitionZernioConnectedAtomically({
        orgId: 'org_prod',
        connectionId: 'conn_prod',
        providerAccountId: 'acc_1',
        phoneNumber: '+5511999999999',
      });
      expect(txCalledCount).toBe(3);

      // 4. Cleanup denial commit
      await cleanupRepo.commitMaterializedDenialOwnershipAtomically({
        organizationId: 'org_prod',
        connectionId: 'conn_prod',
        sessionId: 'sess_1',
        wabaId: 'waba_1',
        phoneNumberId: 'phone_1',
        normalizedPhoneNumber: '+5511999999999',
      });
      expect(txCalledCount).toBe(4);

      txSpy.mockRestore();
    });
  });

  describe('9. WhatsApp Cleanup Retry & UpdateJob Remediation (R3-C9)', () => {
    it('Preview mode (VERCEL_ENV=preview, PREVIEW_MODE=false): retryJob and updateJob fail closed before Firestore update', async () => {
      process.env.VERCEL_ENV = 'preview';
      process.env.PREVIEW_MODE = 'false';

      const updateSpy = vi.fn();
      const txSpy = vi.spyOn(db, 'runTransaction');
      const fetchSpy = vi.spyOn(global, 'fetch');

      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      vi.spyOn(cleanupRepo, 'getJobRef').mockReturnValue({ update: updateSpy } as any);

      const cleanupService = new WhatsAppCleanupService(cleanupRepo);

      // 1. WhatsAppCleanupService.retryJob must throw PREVIEW_MODE_BLOCKED
      await expect(
        cleanupService.retryJob('job_exhausted_1', 'operator_1', 'Operator retry request')
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Reinicialização de jobs de cleanup de WhatsApp desabilitada no ambiente de Preview.');

      // 2. WhatsAppProviderCleanupJobRepository.updateJob must throw PREVIEW_MODE_BLOCKED
      await expect(
        cleanupRepo.updateJob('job_exhausted_1', {
          status: 'pending',
          attempt_count: 0,
        })
      ).rejects.toThrow('PREVIEW_MODE_BLOCKED: Atualização de jobs de cleanup de WhatsApp desabilitada no ambiente de Preview.');

      // Verify ZERO mutations occurred:
      // - Firestore .update is NOT called
      expect(updateSpy).not.toHaveBeenCalled();
      // - No transaction starts
      expect(txSpy).not.toHaveBeenCalled();
      // - No external provider calls
      expect(fetchSpy).not.toHaveBeenCalled();

      txSpy.mockRestore();
      fetchSpy.mockRestore();
    });

    it('Production mode (VERCEL_ENV=production, PREVIEW_MODE=true): updateJob is allowed and performs update', async () => {
      process.env.VERCEL_ENV = 'production';
      process.env.PREVIEW_MODE = 'true';

      const updateSpy = vi.fn().mockResolvedValue(undefined);
      const cleanupRepo = new WhatsAppProviderCleanupJobRepository();
      vi.spyOn(cleanupRepo, 'getJobRef').mockReturnValue({ update: updateSpy } as any);

      await cleanupRepo.updateJob('job_prod_1', {
        status: 'pending',
        attempt_count: 0,
      });

      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
          attempt_count: 0,
        })
      );
    });
  });
});


