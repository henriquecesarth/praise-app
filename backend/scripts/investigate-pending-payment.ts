import { config } from '../src/config/unifiedConfig';
import { db } from '../src/lib/firebase';

async function investigate() {
  const apiUrl = config.asaas.apiUrl.replace(/\/+$/, '');
  const apiKey = config.asaas.apiKey;
  const headers = { 'Content-Type': 'application/json', access_token: apiKey };

  const paymentId = 'pay_877qe68tysbejnj1';
  const subscriptionId = 'sub_6wptsex5cwoqky26';
  const checkoutId = 'd338454e-2818-4bd6-a260-5484a247a60b';
  const ministryId = '5kL2qssw4PCi2irzC25X';

  console.log('=== INVESTIGAÇÃO DETALHADA: COBRANÇA CREDIT_CARD PENDING ===\n');

  // 1. Consultar Payment
  console.log(`--- 1. GET /v3/payments/${paymentId} ---`);
  try {
    const payRes = await fetch(`${apiUrl}/payments/${paymentId}`, { headers });
    const payData: any = await payRes.json();
    console.log({
      id: payData.id,
      status: payData.status,
      billingType: payData.billingType,
      value: payData.value,
      netValue: payData.netValue,
      dueDate: payData.dueDate,
      originalDueDate: payData.originalDueDate,
      paymentDate: payData.paymentDate,
      clientPaymentDate: payData.clientPaymentDate,
      confirmedDate: payData.confirmedDate,
      creditDate: payData.creditDate,
      estimatedCreditDate: payData.estimatedCreditDate,
      subscription: payData.subscription,
      customer: payData.customer,
      checkoutSession: payData.checkoutSession,
      externalReference: payData.externalReference,
      invoiceUrl: payData.invoiceUrl,
      invoiceNumber: payData.invoiceNumber,
      description: payData.description,
      creditCardBrand: payData.creditCard?.creditCardBrand,
      creditCardNumber: payData.creditCard?.creditCardNumber,
      refunds: payData.refunds,
    });
  } catch (err: any) {
    console.error('Erro ao consultar payment:', err.message);
  }

  // 2. Consultar Subscription
  console.log(`\n--- 2. GET /v3/subscriptions/${subscriptionId} ---`);
  try {
    const subRes = await fetch(`${apiUrl}/subscriptions/${subscriptionId}`, { headers });
    const subData: any = await subRes.json();
    console.log({
      id: subData.id,
      status: subData.status,
      billingType: subData.billingType,
      cycle: subData.cycle,
      value: subData.value,
      nextDueDate: subData.nextDueDate,
      customer: subData.customer,
      checkoutSession: subData.checkoutSession,
      externalReference: subData.externalReference,
      dateCreated: subData.dateCreated,
      creditCardBrand: subData.creditCard?.creditCardBrand,
      creditCardNumber: subData.creditCard?.creditCardNumber,
    });
  } catch (err: any) {
    console.error('Erro ao consultar subscription:', err.message);
  }

  // 3. Consultar cobranças da Subscription
  console.log(`\n--- 3. GET /v3/payments?subscription=${subscriptionId} ---`);
  try {
    const listRes = await fetch(`${apiUrl}/payments?subscription=${subscriptionId}`, { headers });
    const listData: any = await listRes.json();
    console.log(`Total de pagamentos para a subscription: ${listData.totalCount}`);
    listData.data?.forEach((p: any) => {
      console.log({
        id: p.id,
        status: p.status,
        billingType: p.billingType,
        dueDate: p.dueDate,
        value: p.value,
        confirmedDate: p.confirmedDate,
      });
    });
  } catch (err: any) {
    console.error('Erro ao listar pagamentos da subscription:', err.message);
  }

  // 4. Consultar Checkout
  console.log(`\n--- 4. GET /v3/checkouts/${checkoutId} ---`);
  try {
    const chkRes = await fetch(`${apiUrl}/checkouts/${checkoutId}`, { headers });
    const chkText = await chkRes.text();
    console.log('Status code:', chkRes.status);
    console.log('Response body:', chkText || '(empty)');
  } catch (err: any) {
    console.error('Erro ao consultar checkout:', err.message);
  }

  // 5. Inspecionar billing_webhook_events no Firestore
  console.log('\n--- 5. EVENTOS DO CHECKOUT NO FIRESTORE (billing_webhook_events) ---');
  const eventsSnap = await db.collection('billing_webhook_events').orderBy('received_at', 'desc').limit(15).get();
  eventsSnap.forEach((doc: any) => {
    const d = doc.data();
    console.log(`Event ID: ${doc.id}`);
    console.log(`  Type: ${d.event_type} | Status: ${d.processing_status} | Received: ${d.received_at}`);
    console.log(`  Error: ${d.error_message || 'none'}`);
  });

  // 6. Consultar Webhooks configurados no Asaas
  console.log('\n--- 6. WEBHOOK CONFIGURADO NO ASAAS ---');
  try {
    const whRes = await fetch(`${apiUrl}/webhooks`, { headers });
    const whData: any = await whRes.json();
    console.log(JSON.stringify(whData, null, 2));
  } catch (err: any) {
    console.error('Erro ao consultar webhooks:', err.message);
  }
}

investigate().catch(console.error);
