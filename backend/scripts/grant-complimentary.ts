/**
 * Script Operacional: Concessão Manual de Plano de Cortesia (Complimentary Plan)
 *
 * Uso:
 *   npx ts-node scripts/grant-complimentary.ts <ministryId> <planId> [grantedBy] [grantReason] [expiresInDays]
 *
 * Exemplo:
 *   npx ts-node scripts/grant-complimentary.ts min_123 premium "admin@louvaio.com" "Parceria Igreja Central" 365
 */

import { SubscriptionService } from '../src/features/subscriptions/subscription.service';
import { PlanId, PLANS_CATALOG } from '../src/config/plans.config';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Uso: npx ts-node scripts/grant-complimentary.ts <ministryId> <planId> [grantedBy] [grantReason] [expiresInDays]');
    process.exit(1);
  }

  const [ministryId, planId, grantedBy = 'cli_admin', grantReason = 'Concessão operacional CLI', expiresInDaysStr] = args;

  if (!(planId in PLANS_CATALOG)) {
    console.error(`Erro: Plano inválido "${planId}". Opções: ${Object.keys(PLANS_CATALOG).join(', ')}`);
    process.exit(1);
  }

  let expiresAt: string | null = null;
  if (expiresInDaysStr && !isNaN(Number(expiresInDaysStr))) {
    const days = Number(expiresInDaysStr);
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const subscriptionService = new SubscriptionService();

  console.log(`Concedendo plano cortesia "${planId}" para o ministério "${ministryId}"...`);
  const result = await subscriptionService.grantComplimentaryPlan(
    ministryId,
    planId as PlanId,
    grantedBy,
    grantReason,
    expiresAt
  );

  console.log('✅ Plano concedido com sucesso!');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Erro ao executar concessão:', err);
  process.exit(1);
});
