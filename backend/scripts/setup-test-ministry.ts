import { db } from '../src/lib/firebase';
import { MinistryRepository } from '../src/repositories/MinistryRepository';
import { SubscriptionService } from '../src/features/subscriptions/subscription.service';

async function setupTestMinistry() {
  console.log('=== CRIANDO MINISTÉRIO LIMPO PARA HOMOLOGAÇÃO REAL ===\n');

  const userId = process.env.TEST_USER_ID;
  if (!userId) {
    throw new Error('TEST_USER_ID é obrigatório. Uso: TEST_USER_ID=<uid> npx ts-node scripts/setup-test-ministry.ts');
  }

  const userDoc = await db.collection('users').doc(userId).get();
  if (!userDoc.exists) {
    throw new Error(`Usuário com ID "${userId}" não encontrado na coleção users.`);
  }

  const userData = userDoc.data() || {};
  console.log(`Usuário selecionado: ${userId} (${userData.email || userData.name || 'Sem email'})`);

  const minRepo = new MinistryRepository();
  const subService = new SubscriptionService();

  const newMin = await minRepo.createMinistry(userId, 'LouvAIO Sandbox Test');
  console.log(`\n✅ Ministério criado com sucesso!`);
  console.log(`Ministry ID: ${newMin.id}`);
  console.log(`Nome: ${newMin.name}`);

  const summary = await subService.getSubscriptionSummary(newMin.id);
  console.log('\nEstado inicial da assinatura:');
  console.log(JSON.stringify(summary, null, 2));
}

setupTestMinistry().catch(console.error);
