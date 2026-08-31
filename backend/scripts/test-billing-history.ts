import { BillingRepository } from '../src/repositories/BillingRepository';

async function testHistory() {
  const repo = new BillingRepository();
  const ministryId = process.env.MINISTRY_ID || 'Cqj1xR8FK2WArZWd2BLj';
  console.log(`Testando getTransactions para ministryId: ${ministryId}`);
  try {
    const txs = await repo.getTransactions(ministryId);
    console.log('✅ Sucesso ao consultar transações:');
    console.log(JSON.stringify(txs, null, 2));
  } catch (err: any) {
    console.error('❌ Erro ao consultar transações:');
    console.error('Mensagem:', err.message);
    console.error('Stack trace:', err.stack);
  }
}

testHistory().catch(console.error);
