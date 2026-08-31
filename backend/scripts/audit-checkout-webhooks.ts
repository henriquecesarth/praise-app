import { db } from '../src/lib/firebase';
import { config } from '../src/config/unifiedConfig';

async function safeFetchJson(url: string, headers: Record<string, string>): Promise<any> {
  const response = await fetch(url, { headers });
  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`Asaas API request failed (${response.status}) for ${url}: ${raw || '<empty body>'}`);
  }

  if (!raw || !raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`Erro ao fazer parse de JSON da URL ${url}: ${err.message}. Raw: ${raw.substring(0, 200)}`);
  }
}

async function auditCheckoutEvents() {
  const ministryId = process.env.MINISTRY_ID || process.argv[2];
  const checkoutId = process.env.CHECKOUT_ID || process.argv[3];

  if (!ministryId || !checkoutId) {
    console.error('Uso: MINISTRY_ID=<id> CHECKOUT_ID=<uuid> npx ts-node scripts/audit-checkout-webhooks.ts');
    console.error('Ou: npx ts-node scripts/audit-checkout-webhooks.ts <ministryId> <checkoutId>');
    process.exit(1);
  }

  console.log(`=== AUDITORIA DE EVENTOS REAIS PARA O CHECKOUT ===`);
  console.log(`Ministry ID: ${ministryId}`);
  console.log(`Checkout ID: ${checkoutId}\n`);

  // 1. billing_subscriptions
  console.log('--- 1. BILLING_SUBSCRIPTIONS ---');
  const subDoc = await db.collection('billing_subscriptions').doc(`${ministryId}_asaas`).get();
  let providerSubscriptionId: string | null = null;
  let providerCustomerId: string | null = null;

  if (subDoc.exists) {
    const subData = subDoc.data()!;
    providerSubscriptionId = subData.provider_subscription_id || null;
    providerCustomerId = subData.provider_customer_id || null;
    console.log(JSON.stringify(subData, null, 2));
  } else {
    console.log('Nenhum billing_subscription encontrado para', `${ministryId}_asaas`);
  }

  // 2. billing_transactions
  console.log('\n--- 2. BILLING_TRANSACTIONS ---');
  const txSnap = await db.collection('billing_transactions').where('ministry_id', '==', ministryId).get();
  let providerPaymentId: string | null = null;

  if (txSnap.empty) {
    console.log('Nenhuma transação registrada para o ministério', ministryId);
  } else {
    txSnap.forEach((doc: any) => {
      const txData = doc.data();
      providerPaymentId = txData.provider_payment_id || null;
      console.log(JSON.stringify(txData, null, 2));
    });
  }

  // 3. billing_webhook_events (filtrados e correlacionados exclusivamente com este fluxo)
  console.log('\n--- 3. EVENTOS DO WEBHOOK CORRELACIONADOS COM ESTE CHECKOUT ---');
  const allEventsSnap = await db.collection('billing_webhook_events').orderBy('received_at', 'desc').limit(30).get();

  const correlatedEvents: any[] = [];
  const otherHistoricalEvents: any[] = [];

  allEventsSnap.forEach((doc: any) => {
    const d = doc.data();
    // Identificar correlação com este checkout ou IDs gerados nesta jornada
    const isCorrelated =
      doc.id.includes(checkoutId) ||
      (d.error_message && d.error_message.includes(checkoutId)) ||
      (d.event_type === 'CHECKOUT_CREATED' && new Date(d.received_at).getTime() >= new Date('2026-08-31T02:50:00Z').getTime()) ||
      (d.event_type === 'CHECKOUT_PAID' && new Date(d.received_at).getTime() >= new Date('2026-08-31T02:50:00Z').getTime()) ||
      (d.event_type === 'SUBSCRIPTION_CREATED' && new Date(d.received_at).getTime() >= new Date('2026-08-31T02:50:00Z').getTime()) ||
      (d.event_type === 'PAYMENT_CONFIRMED' && new Date(d.received_at).getTime() >= new Date('2026-08-31T02:50:00Z').getTime() && !doc.id.includes('sim'));

    if (isCorrelated) {
      correlatedEvents.push({ id: doc.id, ...d });
    } else {
      otherHistoricalEvents.push({ id: doc.id, event_type: d.event_type, received_at: d.received_at });
    }
  });

  console.log(`Eventos reais da jornada atual (${correlatedEvents.length}):`);
  correlatedEvents.reverse().forEach((ev) => {
    console.log(`- [${ev.received_at}] ${ev.event_type} (${ev.id}) -> Status: ${ev.processing_status} | Erro: ${ev.error_message || 'none'}`);
  });

  console.log(`\n(Outros ${otherHistoricalEvents.length} eventos históricos/anteriores ignorados nesta auditoria)`);

  // 4. Consulta direta à API Asaas Sandbox
  const apiUrl = config.asaas.apiUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json', access_token: config.asaas.apiKey || '' };

  if (providerPaymentId) {
    console.log(`\n--- 4. ASAAS API: GET /v3/payments/${providerPaymentId} ---`);
    try {
      const payData = await safeFetchJson(`${apiUrl}/payments/${providerPaymentId}`, headers);
      if (payData) {
        console.log({
          id: payData.id,
          status: payData.status,
          billingType: payData.billingType,
          value: payData.value,
          netValue: payData.netValue,
          dueDate: payData.dueDate,
          confirmedDate: payData.confirmedDate,
          paymentDate: payData.paymentDate,
          clientPaymentDate: payData.clientPaymentDate,
          subscription: payData.subscription,
          customer: payData.customer,
          checkoutSession: payData.checkoutSession,
          invoiceUrl: payData.invoiceUrl,
          creditCardBrand: payData.creditCard?.creditCardBrand,
          creditCardNumber: payData.creditCard?.creditCardNumber,
        });
      }
    } catch (err: any) {
      console.error(`Erro ao consultar payment ${providerPaymentId}:`, err.message);
    }
  }

  if (providerSubscriptionId) {
    console.log(`\n--- 5. ASAAS API: GET /v3/subscriptions/${providerSubscriptionId} ---`);
    try {
      const subData = await safeFetchJson(`${apiUrl}/subscriptions/${providerSubscriptionId}`, headers);
      if (subData) {
        console.log({
          id: subData.id,
          status: subData.status,
          billingType: subData.billingType,
          cycle: subData.cycle,
          value: subData.value,
          nextDueDate: subData.nextDueDate,
          customer: subData.customer,
          checkoutSession: subData.checkoutSession,
          dateCreated: subData.dateCreated,
        });
      }
    } catch (err: any) {
      console.error(`Erro ao consultar subscription ${providerSubscriptionId}:`, err.message);
    }
  }
}

auditCheckoutEvents().catch(console.error);
