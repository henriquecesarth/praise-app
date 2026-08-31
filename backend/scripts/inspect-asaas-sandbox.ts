import { config } from '../src/config/unifiedConfig';

async function inspectAsaas() {
  const apiUrl = config.asaas.apiUrl.replace(/\/+$/, '');
  const apiKey = config.asaas.apiKey;

  console.log('=== INSPEÇÃO DA API ASAAS SANDBOX ===');
  console.log(`API URL: ${apiUrl}`);
  console.log(`API Key configurada: ${apiKey ? 'SIM (len: ' + apiKey.length + ')' : 'NÃO'}`);

  const headers = {
    'Content-Type': 'application/json',
    access_token: apiKey,
  };

  // 1. Webhooks configurados
  console.log('\n--- 1. WEBHOOKS CONFIGURADOS NO ASAAS ---');
  try {
    const res = await fetch(`${apiUrl}/webhooks`, { headers });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Erro ao consultar webhooks:', err.message);
  }

  // 2. Checkout e6cf65eb-b5ff-4a40-8844-ce75cac5cb25
  const checkoutId = 'e6cf65eb-b5ff-4a40-8844-ce75cac5cb25';
  console.log(`\n--- 2. DETALHES DO CHECKOUT ${checkoutId} ---`);
  try {
    const res = await fetch(`${apiUrl}/checkouts/${checkoutId}`, { headers });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Erro ao consultar checkout:', err.message);
  }

  // 3. Customer cus_000008945392
  const customerId = 'cus_000008945392';
  console.log(`\n--- 3. DETALHES DO CUSTOMER ${customerId} ---`);
  try {
    const res = await fetch(`${apiUrl}/customers/${customerId}`, { headers });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Erro ao consultar customer:', err.message);
  }

  // 4. Subscriptions do Customer
  console.log(`\n--- 4. SUBSCRIPTIONS DO CUSTOMER ${customerId} ---`);
  try {
    const res = await fetch(`${apiUrl}/subscriptions?customer=${customerId}`, { headers });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Erro ao consultar subscriptions:', err.message);
  }

  // 5. Payments do Customer
  console.log(`\n--- 5. PAYMENTS DO CUSTOMER ${customerId} ---`);
  try {
    const res = await fetch(`${apiUrl}/payments?customer=${customerId}`, { headers });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Erro ao consultar payments:', err.message);
  }

  // 6. Últimos Payments gerais no Sandbox
  console.log('\n--- 6. ÚLTIMOS PAYMENTS NO SANDBOX ---');
  try {
    const res = await fetch(`${apiUrl}/payments?limit=5`, { headers });
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (err: any) {
    console.error('Erro ao consultar payments gerais:', err.message);
  }
}

inspectAsaas().catch(console.error);
