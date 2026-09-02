import os from 'os';
import { config } from '../../config/unifiedConfig';
import { BillingService } from './billing.service';
import { BillingRepository } from '../../repositories/BillingRepository';
import { isBillingTransitionV1 } from './billing.types';

export class BillingReconcilerWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private readonly workerId: string;

  constructor(
    private readonly billingService: BillingService = new BillingService(),
    private readonly billingRepo: BillingRepository = new BillingRepository()
  ) {
    const hostname = os.hostname() || 'host';
    const pid = process.pid || 1;
    const rand = Math.random().toString(36).substring(2, 8);
    this.workerId = `reconciler_${hostname}_${pid}_${rand}`;
  }

  start(): void {
    if (this.timer || !config.billingReconciliationEnabled) {
      return;
    }

    const intervalMinutes = Math.max(1, config.billingReconciliationIntervalMinutes || 15);
    const intervalMs = intervalMinutes * 60 * 1000;

    // Executa uma vez no startup (com pequeno delay para o app estabilizar)
    setTimeout(() => {
      this.runCycle().catch((err) => {
        console.error('[BillingReconcilerWorker] Erro no ciclo inicial de startup:', err);
      });
    }, 5000);

    this.timer = setInterval(() => {
      this.runCycle().catch((err) => {
        console.error('[BillingReconcilerWorker] Erro no ciclo periódico de reconciliação:', err);
      });
    }, intervalMs);

    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runCycle(): Promise<{ processed: number; succeeded: number; failed: number }> {
    if (this.isRunning) {
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    this.isRunning = true;
    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    try {
      // 1. Reconciliação V1 Initial Purchase
      const v1Needing = await this.billingRepo.getV1TransitionsNeedingReconciliation('asaas', 20);
      for (const item of v1Needing) {
        if (isBillingTransitionV1(item)) {
          if (item.execution_strategy === 'immediate_initial_purchase') {
            processed++;
            const recResult = await this.billingService.reconcileInitialPurchaseTransition(item.id, this.workerId);
            if (recResult.success) {
              succeeded++;
              console.log(
                `[BillingReconcilerWorker] Transição V1 Initial Purchase recuperada com sucesso: ${item.id} (ministério: ${item.ministry_id})`
              );
            } else {
              failed++;
            }
          } else if (
            item.execution_strategy === 'scheduled_paid_transition' &&
            item.transition_status === 'pending_future_authorization'
          ) {
            processed++;
            const recResult = await this.billingService.reconcilePaidToPaidFutureAuthorization(item.id, this.workerId);
            if (recResult.success) {
              succeeded++;
              console.log(
                `[BillingReconcilerWorker] Transição V1 Scheduled Paid recuperada com sucesso: ${item.id} (ministério: ${item.ministry_id})`
              );
            } else {
              failed++;
            }
          } else if (
            item.execution_strategy === 'scheduled_paid_transition' &&
            (item.transition_status === 'future_target_prepared' ||
              item.transition_status === 'awaiting_old_inactivation')
          ) {
            processed++;
            const cutResult = await this.billingService.reconcilePaidToPaidSourceCutover(item.id, this.workerId);
            if (cutResult.success) {
              succeeded++;
              console.log(
                `[BillingReconcilerWorker] Transição V1 Cutover para Scheduled concluído com sucesso: ${item.id} (ministério: ${item.ministry_id})`
              );
            } else {
              failed++;
            }
          } else if (
            item.execution_strategy === 'scheduled_paid_transition' &&
            item.transition_status === 'scheduled'
          ) {
            processed++;
            const renewalResult = await this.billingService.reconcilePaidToPaidRenewalSettlement(item.id, this.workerId);
            if (renewalResult.success) {
              succeeded++;
              console.log(
                `[BillingReconcilerWorker] Transição V1 Scheduled Renewal ativada com sucesso: ${item.id} (ministério: ${item.ministry_id})`
              );
            } else {
              if (
                renewalResult.reason !== 'renewal_payment_not_settled' &&
                renewalResult.reason !== 'early_settlement_recorded_awaiting_boundary' &&
                renewalResult.reason !== 'boundary_not_reached'
              ) {
                failed++;
              }
            }
          }
        }
      }

      // 2. Reconciliação Legacy Supersede
      const pendingChanges = await this.billingRepo.getPendingOrFailedPlanChanges('asaas', 20);
      for (const change of pendingChanges) {
        processed++;
        const result = await this.billingService.processPlanChangeSupersede(change.id, this.workerId);
        if (result.success) {
          succeeded++;
          console.log(
            `[BillingReconcilerWorker] Supersede recuperado com sucesso para transição ${change.id} (ministério: ${change.ministry_id})`
          );
        } else {
          failed++;
        }
      }
    } catch (err: any) {
      console.error('[BillingReconcilerWorker] Falha ao executar ciclo de reconciliação:', err);
    } finally {
      this.isRunning = false;
    }

    return { processed, succeeded, failed };
  }
}

export const billingReconcilerWorker = new BillingReconcilerWorker();
