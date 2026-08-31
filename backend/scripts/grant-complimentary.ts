/**
 * Script Operacional: Concessão Manual de Plano de Cortesia (Complimentary Plan)
 *
 * Purpose:
 *   Concede manualmente um plano de cortesia (free, lite, pro, premium) a um ministério,
 *   definindo status, quotas e validade no Firestore via SubscriptionService.
 *
 * Required env / args:
 *   npx ts-node scripts/grant-complimentary.ts <ministryId> <planId> <grantedBy> <grantReason> [expiresInDays]
 *
 * Operation type:
 *   Mutating (atualiza documentos no Firestore).
 *
 * Environment restrictions:
 *   Pode ser executado em dev, staging ou production por administradores com credenciais válidas.
 *
 * Exemplo:
 *   npx ts-node scripts/grant-complimentary.ts min_123 premium "admin@louvaio.com" "Parceria Igreja Central" 365
 */

import { SubscriptionService } from '../src/features/subscriptions/subscription.service';
import { PlanId, PLANS_CATALOG } from '../src/config/plans.config';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.error('Uso: npx ts-node scripts/grant-complimentary.ts <ministryId> <planId> <grantedBy> <grantReason> [expiresInDays]');
    console.error('Exemplo: npx ts-node scripts/grant-complimentary.ts min_123 premium "admin@louvaio.com" "Parceria Igreja Central" 365');
    process.exit(1);
  }

  const [ministryId, planId, grantedBy, grantReason, expiresInDaysStr] = args;

  if (!ministryId || !ministryId.trim()) {
    console.error('Erro: ministryId não pode ser vazio.');
    process.exit(1);
  }

  if (!(planId in PLANS_CATALOG)) {
    console.error(`Erro: Plano inválido "${planId}". Opções: ${Object.keys(PLANS_CATALOG).join(', ')}`);
    process.exit(1);
  }

  if (!grantedBy || !grantedBy.trim()) {
    console.error('Erro: grantedBy é obrigatório (ex: "admin@louvaio.com").');
    process.exit(1);
  }

  if (!grantReason || !grantReason.trim()) {
    console.error('Erro: grantReason é obrigatório (ex: "Parceria Institucional").');
    process.exit(1);
  }

  let expiresAt: string | null = null;
  if (expiresInDaysStr && !isNaN(Number(expiresInDaysStr))) {
    const days = Number(expiresInDaysStr);
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const subscriptionService = new SubscriptionService();

  console.log(`Concedendo plano cortesia "${planId}" para o ministério "${ministryId}"...`);
  console.log(`Concedido por: ${grantedBy}`);
  console.log(`Motivo: ${grantReason}`);
  console.log(`Expiração: ${expiresAt || 'Sem expiração definida'}`);

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
