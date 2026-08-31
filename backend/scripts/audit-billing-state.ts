import { db } from '../src/lib/firebase';

async function audit() {
  console.log('=== AUDITORIA DE BILLING NO FIRESTORE ===\n');

  console.log('--- BILLING_SUBSCRIPTIONS ---');
  const subsSnapshot = await db.collection('billing_subscriptions').get();
  if (subsSnapshot.empty) {
    console.log('Nenhuma subscription encontrada.');
  } else {
    subsSnapshot.forEach((doc: any) => {
      const data = doc.data();
      console.log(`Doc ID: ${doc.id}`);
      console.log(JSON.stringify(data, null, 2));
    });
  }

  console.log('\n--- BILLING_CUSTOMERS ---');
  const custSnapshot = await db.collection('billing_customers').get();
  if (custSnapshot.empty) {
    console.log('Nenhum customer encontrado.');
  } else {
    custSnapshot.forEach((doc: any) => {
      console.log(`Doc ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
    });
  }

  console.log('\n--- BILLING_WEBHOOK_EVENTS ---');
  const eventsSnapshot = await db.collection('billing_webhook_events').orderBy('received_at', 'desc').limit(20).get();
  if (eventsSnapshot.empty) {
    console.log('Nenhum webhook event encontrado.');
  } else {
    eventsSnapshot.forEach((doc: any) => {
      const d = doc.data();
      console.log(`Event ID: ${doc.id} | Type: ${d.event_type} | Status: ${d.processing_status} | Received: ${d.received_at} | Error: ${d.error_message || 'none'}`);
    });
  }

  console.log('\n--- BILLING_TRANSACTIONS ---');
  try {
    const txSnapshot = await db.collection('billing_transactions').get();
    if (txSnapshot.empty) {
      console.log('Nenhuma transação encontrada.');
    } else {
      txSnapshot.forEach((doc: any) => {
        console.log(`Tx ID: ${doc.id}`);
        console.log(JSON.stringify(doc.data(), null, 2));
      });
    }
  } catch (err: any) {
    console.error('Erro ao consultar transactions:', err.message);
  }

  console.log('\n--- MINISTRY_SUBSCRIPTIONS ---');
  const minSubsSnapshot = await db.collection('ministry_subscriptions').get();
  if (minSubsSnapshot.empty) {
    console.log('Nenhuma ministry subscription encontrada.');
  } else {
    minSubsSnapshot.forEach((doc: any) => {
      console.log(`Ministry Sub ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
    });
  }
}

audit().catch(console.error);
