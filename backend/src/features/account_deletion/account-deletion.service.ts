import { authAdmin } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import { AccountDeletionRepository } from '../../repositories/AccountDeletionRepository';
import {
  AccountDeletionJobRecord,
  AccountDeletionBlocker,
  AccountDeletionPreflightResponse,
} from './account-deletion.types';

export class AccountDeletionService {
  constructor(
    private readonly repository: AccountDeletionRepository = new AccountDeletionRepository()
  ) {}

  async evaluatePreflight(userId: string, userEmail?: string): Promise<AccountDeletionPreflightResponse> {
    const blockers: AccountDeletionBlocker[] = [];

    // 1. Ministry owner check
    const ownedMinistries = await this.repository.findOwnedMinistries(userId);
    for (const m of ownedMinistries) {
      blockers.push({
        code: 'MINISTRY_OWNER',
        message: `Você é proprietário do ministério "${m.name}". Transfira a propriedade antes de excluir sua conta.`,
        details: { ministryId: m.id, ministryName: m.name },
      });
    }

    // 2. Organization owner check
    const ownedOrgs = await this.repository.findOwnedOrganizations(userId);
    for (const o of ownedOrgs) {
      blockers.push({
        code: 'ORGANIZATION_OWNER',
        message: `Você é proprietário da organização "${o.name}". Transfira a propriedade antes de excluir sua conta.`,
        details: { organizationId: o.id, organizationName: o.name },
      });
    }

    // 3. Sole remaining admin check
    const ownedMinistryIds = new Set(ownedMinistries.map((m) => m.id));
    const soleAdminMinistries = await this.repository.findSoleAdminMinistries(userId);
    for (const sm of soleAdminMinistries) {
      if (!ownedMinistryIds.has(sm.id)) {
        blockers.push({
          code: 'SOLE_MINISTRY_ADMIN',
          message: `Você é o único administrador do ministério "${sm.name}". Promova outro integrante a administrador antes de excluir sua conta.`,
          details: { ministryId: sm.id, ministryName: sm.name },
        });
      }
    }

    // 4. Billing contact replacement check
    const billingMinistries = await this.repository.findBillingContactMinistries(userId, userEmail);
    for (const bm of billingMinistries) {
      blockers.push({
        code: 'BILLING_CONTACT_REPLACEMENT_REQUIRED',
        message: `Você é o contato de cobrança ativo do ministério "${bm.name}". Atualize o contato de cobrança antes de excluir sua conta.`,
        details: { ministryId: bm.id, ministryName: bm.name },
      });
    }

    const activeJob = await this.repository.getJob(userId);

    return {
      deletionAllowed: blockers.length === 0,
      blockers,
      activeJob: activeJob
        ? {
            id: activeJob.id,
            status: activeJob.status,
            step_progress: activeJob.step_progress,
            requested_at: activeJob.requested_at,
          }
        : null,
    };
  }

  async executeDeletion(
    userId: string,
    userEmail?: string
  ): Promise<{ success: boolean; message: string; job: AccountDeletionJobRecord }> {
    // 1. Checagem de preflight
    const preflight = await this.evaluatePreflight(userId, userEmail);
    if (!preflight.deletionAllowed) {
      const now = new Date().toISOString();
      const existingJob = await this.repository.getJob(userId);
      const blockedJob: AccountDeletionJobRecord = {
        id: `del_${userId}`,
        user_id: userId,
        user_email: userEmail || null,
        status: 'preflight_blocked',
        blockers: preflight.blockers,
        checkpoints: existingJob?.checkpoints || {},
        step_progress: 'preflight_blocked',
        error_details: 'Bloqueado por pré-requisitos de governança ou faturamento',
        requested_at: existingJob?.requested_at || now,
        started_at: existingJob?.started_at || null,
        completed_at: null,
        updated_at: now,
      };
      await this.repository.saveJob(blockedJob);

      throw new AppError(409, 'Exclusão não permitida devido a pendências de propriedade ou faturamento.', {
        code: 'PREFLIGHT_BLOCKED',
        blockers: preflight.blockers,
      });
    }

    // 2. Recuperar ou inicializar job durável
    const now = new Date().toISOString();
    let job = await this.repository.getJob(userId);

    if (job && job.status === 'completed') {
      return {
        success: true,
        message: 'Conta já excluída anteriormente.',
        job,
      };
    }

    if (!job) {
      job = {
        id: `del_${userId}`,
        user_id: userId,
        user_email: userEmail || null,
        status: 'cleanup_in_progress',
        blockers: null,
        checkpoints: {},
        step_progress: 'cleanup_in_progress',
        error_details: null,
        requested_at: now,
        started_at: now,
        completed_at: null,
        updated_at: now,
      };
      await this.repository.saveJob(job);
    } else {
      job.status = 'cleanup_in_progress';
      job.step_progress = 'cleanup_in_progress';
      job.updated_at = now;
      await this.repository.saveJob(job);
    }

    let memberIds: string[] = [];

    // 3. Checkpoint 1: Dados pessoais
    if (!job.checkpoints.personal_data_deleted) {
      await this.repository.deletePersonalData(userId);
      job.checkpoints.personal_data_deleted = true;
      job.step_progress = 'personal_data_deleted';
      job.updated_at = new Date().toISOString();
      await this.repository.saveJob(job);
    }

    // 4. Checkpoint 2: Desvincular associações/membros
    if (!job.checkpoints.memberships_detached) {
      memberIds = await this.repository.detachMemberships(userId);
      job.checkpoints.memberships_detached = true;
      job.step_progress = 'memberships_detached';
      job.updated_at = new Date().toISOString();
      await this.repository.saveJob(job);
    }

    // 5. Checkpoint 3: Limpeza de escalas futuras e anonimização de escalas passadas
    if (!job.checkpoints.future_schedules_cleaned) {
      await this.repository.cleanFutureSchedulesAndAnonymizeHistorical(userId, memberIds);
      job.checkpoints.future_schedules_cleaned = true;
      job.step_progress = 'future_schedules_cleaned';
      job.updated_at = new Date().toISOString();
      await this.repository.saveJob(job);
    }

    // 6. Checkpoint 4: Anonimização de conteúdo histórico compartilhado
    if (!job.checkpoints.historical_anonymized) {
      await this.repository.anonymizeHistoricalSharedContent(userId);
      job.checkpoints.historical_anonymized = true;
      job.step_progress = 'historical_anonymized';
      job.updated_at = new Date().toISOString();
      await this.repository.saveJob(job);
    }

    // 7. Checkpoint 5: Anonimização de referências do WhatsApp
    if (!job.checkpoints.whatsapp_anonymized) {
      await this.repository.anonymizeWhatsAppReferences(userId);
      job.checkpoints.whatsapp_anonymized = true;
      job.step_progress = 'whatsapp_anonymized';
      job.updated_at = new Date().toISOString();
      await this.repository.saveJob(job);
    }

    // 8. Checkpoint 6: Exclusão no Firebase Auth
    if (!job.checkpoints.auth_deleted) {
      job.status = 'auth_delete_pending';
      job.step_progress = 'auth_delete_pending';
      job.updated_at = new Date().toISOString();
      await this.repository.saveJob(job);

      try {
        if (authAdmin && typeof authAdmin.deleteUser === 'function') {
          await authAdmin.deleteUser(userId);
        }
        job.checkpoints.auth_deleted = true;
      } catch (err: any) {
        if (err.code === 'auth/user-not-found' || String(err.message || '').includes('user-not-found')) {
          // Idempotente: usuário já foi deletado no Firebase
          job.checkpoints.auth_deleted = true;
        } else {
          job.status = 'attention_required';
          job.error_details = err.message || 'Falha ao excluir usuário do Firebase Auth';
          job.updated_at = new Date().toISOString();
          await this.repository.saveJob(job);
          throw new AppError(500, 'Falha ao concluir exclusão de autenticação. Tente novamente mais tarde.', {
            code: 'AUTH_DELETION_FAILED',
            jobId: job.id,
            details: err.message,
          });
        }
      }
    }

    // 9. Conclusão terminal
    job.status = 'completed';
    job.step_progress = 'completed';
    job.completed_at = new Date().toISOString();
    job.updated_at = new Date().toISOString();
    await this.repository.saveJob(job);

    return {
      success: true,
      message: 'Conta e dados pessoais excluídos com sucesso.',
      job,
    };
  }

  async getDeletionStatus(userId: string): Promise<AccountDeletionJobRecord | null> {
    return this.repository.getJob(userId);
  }

  async isDeletionPending(userId: string): Promise<boolean> {
    return this.repository.isDeletionPending(userId);
  }
}
