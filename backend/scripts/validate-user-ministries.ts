import { MinistryRepository } from '../src/repositories/MinistryRepository';
import { SubscriptionService } from '../src/features/subscriptions/subscription.service';

async function validateUserAccess() {
  const userId = 'XnpmlGGY6PZCRT90U0hYlLrEwjf2';
  const ministryId = '5kL2qssw4PCi2irzC25X';

  console.log(`=== VALIDANDO ACESSO DO USUÁRIO ${userId} ===\n`);

  const minRepo = new MinistryRepository();
  const subService = new SubscriptionService();

  // 1. Consultar my-ministries
  console.log('1. Consultando getUserMinistries (my-ministries)...');
  const ministries = await minRepo.getUserMinistries(userId);
  console.log(JSON.stringify(ministries, null, 2));

  const targetMin = ministries.find((m) => m.id === ministryId);
  if (targetMin) {
    console.log(`\n✅ Ministério de homologação ${ministryId} encontrado com role: "${targetMin.role}"!`);
  } else {
    console.error(`\n❌ Ministério de homologação ${ministryId} NÃO encontrado nos ministérios do usuário!`);
  }

  // 2. Consultar getSubscriptionSummary SEM ALTERAR ESTADO
  console.log('\n2. Consultando Subscription do ministério de homologação (SEM ALTERAR ESTADO)...');
  const summary = await subService.getSubscriptionSummary(ministryId);
  console.log(JSON.stringify(summary, null, 2));
}

validateUserAccess().catch(console.error);
