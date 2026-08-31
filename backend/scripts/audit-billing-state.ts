/**
 * Script Operacional: Auditoria do Estado de Billing no Firestore
 *
 * Purpose:
 *   Inspeciona documentos das coleções de billing no Firestore
 *   (billing_subscriptions, billing_customers, billing_webhook_events,
 *   billing_transactions, ministry_subscriptions).
 *   Suporta filtro por ministério específico ou amostragem limitada dos últimos registros.
 *
 * Required env / args:
 *   MINISTRY_ID=<ministry_id> AUDIT_LIMIT=50 npx ts-node scripts/audit-billing-state.ts
 *   ou:
 *   npx ts-node scripts/audit-billing-state.ts [ministryId]
 *
 * Configuração:
 *   AUDIT_LIMIT: Inteiro entre 1 e 500 (padrão: 25).
 *
 * Operation type:
 *   Read-only (apenas leitura de coleções/documentos).
 *
 * Environment restrictions:
 *   Pode ser executado em dev, staging ou production com credenciais válidas.
 */

import { db } from '../src/lib/firebase';

function getAuditLimit(): number {
  const envVal = process.env.AUDIT_LIMIT;
  if (!envVal) return 25;
  const parsed = parseInt(envVal, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 500) {
    console.warn(`[AVISO] AUDIT_LIMIT inválido ("${envVal}"). O valor deve ser um inteiro entre 1 e 500. Usando padrão: 25.`);
    return 25;
  }
  return parsed;
}

function checkTruncation(count: number, limit: number) {
  if (count === limit) {
    console.warn(`⚠️  Results may be truncated. Increase AUDIT_LIMIT if a wider audit is required.`);
  }
}

async function audit() {
  const targetMinistryId = process.env.MINISTRY_ID || process.argv[2] || null;
  const auditLimit = getAuditLimit();

  console.log('=== AUDITORIA DE BILLING NO FIRESTORE ===');
  console.log(`Audit limit: ${auditLimit}`);
  if (targetMinistryId) {
    console.log(`Filtrando para o ministério: ${targetMinistryId}\n`);
  } else {
    console.log(`Modo geral (amostragem de até ${auditLimit} registros por coleção)\n`);
  }

  // 1. BILLING_SUBSCRIPTIONS
  console.log('--- 1. BILLING_SUBSCRIPTIONS ---');
  let subsSnapshot;
  if (targetMinistryId) {
    subsSnapshot = await db.collection('billing_subscriptions').where('ministry_id', '==', targetMinistryId).limit(auditLimit).get();
  } else {
    subsSnapshot = await db.collection('billing_subscriptions').limit(auditLimit).get();
  }

  if (subsSnapshot.empty) {
    console.log('Nenhuma subscription encontrada.');
  } else {
    subsSnapshot.forEach((doc: any) => {
      console.log(`Doc ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
    });
    checkTruncation(subsSnapshot.size, auditLimit);
  }

  // 2. BILLING_CUSTOMERS
  console.log('\n--- 2. BILLING_CUSTOMERS ---');
  let custSnapshot;
  if (targetMinistryId) {
    custSnapshot = await db.collection('billing_customers').where('ministry_id', '==', targetMinistryId).limit(auditLimit).get();
  } else {
    custSnapshot = await db.collection('billing_customers').limit(auditLimit).get();
  }

  if (custSnapshot.empty) {
    console.log('Nenhum customer encontrado.');
  } else {
    custSnapshot.forEach((doc: any) => {
      console.log(`Doc ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
    });
    checkTruncation(custSnapshot.size, auditLimit);
  }

  // 3. BILLING_WEBHOOK_EVENTS
  console.log('\n--- 3. BILLING_WEBHOOK_EVENTS (Últimos registros) ---');
  const eventsSnapshot = await db.collection('billing_webhook_events').orderBy('received_at', 'desc').limit(auditLimit).get();
  if (eventsSnapshot.empty) {
    console.log('Nenhum webhook event encontrado.');
  } else {
    eventsSnapshot.forEach((doc: any) => {
      const d = doc.data();
      console.log(`Event ID: ${doc.id} | Type: ${d.event_type} | Status: ${d.processing_status} | Received: ${d.received_at} | Error: ${d.error_message || 'none'}`);
    });
    checkTruncation(eventsSnapshot.size, auditLimit);
  }

  // 4. BILLING_TRANSACTIONS
  console.log('\n--- 4. BILLING_TRANSACTIONS ---');
  try {
    let txSnapshot;
    if (targetMinistryId) {
      txSnapshot = await db.collection('billing_transactions').where('ministry_id', '==', targetMinistryId).limit(auditLimit).get();
    } else {
      txSnapshot = await db.collection('billing_transactions').limit(auditLimit).get();
    }

    if (txSnapshot.empty) {
      console.log('Nenhuma transação encontrada.');
    } else {
      txSnapshot.forEach((doc: any) => {
        console.log(`Tx ID: ${doc.id}`);
        console.log(JSON.stringify(doc.data(), null, 2));
      });
      checkTruncation(txSnapshot.size, auditLimit);
    }
  } catch (err: any) {
    console.error('Erro ao consultar transactions:', err.message);
  }

  // 5. MINISTRY_SUBSCRIPTIONS (se aplicável)
  console.log('\n--- 5. MINISTRY_SUBSCRIPTIONS ---');
  try {
    if (targetMinistryId) {
      const doc = await db.collection('ministry_subscriptions').doc(targetMinistryId).get();
      if (doc.exists) {
        console.log(`Ministry Sub ID: ${doc.id}`);
        console.log(JSON.stringify(doc.data(), null, 2));
      } else {
        console.log('Nenhuma ministry subscription encontrada para este ID.');
      }
    } else {
      const minSubsSnapshot = await db.collection('ministry_subscriptions').limit(auditLimit).get();
      if (minSubsSnapshot.empty) {
        console.log('Nenhuma ministry subscription encontrada.');
      } else {
        minSubsSnapshot.forEach((doc: any) => {
          console.log(`Ministry Sub ID: ${doc.id}`);
          console.log(JSON.stringify(doc.data(), null, 2));
        });
        checkTruncation(minSubsSnapshot.size, auditLimit);
      }
    }
  } catch (err: any) {
    console.error('Erro ao consultar ministry_subscriptions:', err.message);
  }
}

audit().catch(console.error);
