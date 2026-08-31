import { config } from '../src/config/unifiedConfig';

async function inspectSpecific() {
  const apiUrl = config.asaas.apiUrl.replace(/\/+$/, '');
  const apiKey = config.asaas.apiKey;
  const headers = { 'Content-Type': 'application/json', access_token: apiKey };

  console.log('--- SUBSCRIPTION sub_2hqxmkyrm88jwkd3 ---');
  const subRes = await fetch(`${apiUrl}/subscriptions/sub_2hqxmkyrm88jwkd3`, { headers });
  const subData = await subRes.json();
  console.log(JSON.stringify(subData, null, 2));

  console.log('\n--- CUSTOMER cus_000008945616 ---');
  const cusRes = await fetch(`${apiUrl}/customers/cus_000008945616`, { headers });
  const cusData = await cusRes.json();
  console.log(JSON.stringify(cusData, null, 2));

  console.log('\n--- PAYMENTS FOR SUBSCRIPTION sub_2hqxmkyrm88jwkd3 ---');
  const payRes = await fetch(`${apiUrl}/payments?subscription=sub_2hqxmkyrm88jwkd3`, { headers });
  const payData = await payRes.json();
  console.log(JSON.stringify(payData, null, 2));
}

inspectSpecific().catch(console.error);
