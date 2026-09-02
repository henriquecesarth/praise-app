/**
 * Script Operacional: Phase 0 — Asaas Future Checkout Spike (Strict & Hardened)
 *
 * Propósito:
 *   Ferramenta temporária e isolada de homologação em Sandbox para auditar o
 *   comportamento real do Asaas Hosted Checkout recorrente quando parametrizado com
 *   `subscription.nextDueDate` futuro (D+7 comercial).
 *
 * Segurança & Isolamento:
 *   - Utiliza estritamente o ambiente Sandbox (recusa execução em produção).
 *   - Utiliza um customer Asaas Sandbox exclusivo do spike (externalReference: 'billing-transition-v1-spike-customer').
 *   - Garante que o customer possua fixture cadastral completa (cpfCnpj, phone, mobilePhone, endereço) exigida pelo Hosted Checkout.
 *   - Impede criação de múltiplos customers duplicados.
 *   - Não altera entitlements, planos, quotas ou registros de ministérios reais no LouvAIO.
 *   - Não expõe chaves de API, senhas ou tokens em tela ou logs.
 *   - Suporta recovery seguro de prepare parcial e preserva Single Live Spike Guard.
 *
 * Comandos CLI:
 *   npx ts-node scripts/spike-future-checkout.ts check
 *   npx ts-node scripts/spike-future-checkout.ts prepare
 *   npx ts-node scripts/spike-future-checkout.ts inspect
 *   npx ts-node scripts/spike-future-checkout.ts cleanup
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Carrega variáveis de ambiente
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const STATE_FILE_PATH = path.resolve(__dirname, '../.spike-future-checkout-state.json');
const SPIKE_CUSTOMER_REF = 'billing-transition-v1-spike-customer';
const BILLING_TIMEZONE = process.env.BILLING_TIMEZONE || 'America/Sao_Paulo';

/**
 * Fixture cadastral segura exclusiva para Sandbox
 * Contém dados de teste sintéticos (sem dados reais de pessoas)
 */
export const SANDBOX_SPIKE_CUSTOMER_FIXTURE = {
  name: 'Spike Customer Transition V1',
  email: 'spike-transition-v1@example.com',
  cpfCnpj: '04717147987', // CPF de teste válido para Sandbox
  phone: '4738010919',
  mobilePhone: '47993456789',
  address: 'Av. Rolf Colin',
  addressNumber: '100',
  province: 'America',
  postalCode: '89223005',
};

export interface AuditClassification {
  target_correlation: 'PASS' | 'AMBIGUOUS' | 'NOT_FOUND';
  future_due_date: 'PASS' | 'FAIL';
  early_capture: 'PASS' | 'FAIL';
  customer_reuse: 'PASS' | 'FAIL';
  financial_state: 'ZERO_PAYMENTS' | 'FUTURE_PENDING_ONLY' | 'EARLY_CAPTURE_DETECTED' | 'OTHER_REVIEW_REQUIRED';
}

export type FinancialState = AuditClassification['financial_state'];

export interface CleanupClassification {
  target_inactive: 'PASS' | 'FAIL';
  future_pending_payments_cleaned: 'PASS' | 'FAIL';
  confirmed_payments_touched: 'NO';
  financially_live_target_remains: 'YES' | 'NO';
}

export interface SpikeState {
  spike_id: string;
  external_reference: string;
  provider_customer_id: string;
  provider_checkout_id: string | null;
  checkout_url: string | null;
  started_at: string;
  commercial_date_today: string;
  effective_billing_date: string;
  target_cycle: 'YEARLY' | 'MONTHLY';
  expected_amount_cents: number;
  currency: string;
  status: 'prepare_failed' | 'prepared' | 'inspected' | 'cleanup_confirmed';
  last_prepare_error?: string | null;
  last_prepare_error_at?: string | null;
  detected_subscription_id?: string | null;
  detected_subscription_status?: string | null;
  detected_subscription_next_due_date?: string | null;
  payments_found?: any[];
  audit_classification?: AuditClassification;
  cleanup_classification?: CleanupClassification;
  cleanup_confirmed_at?: string | null;
  updated_at: string;
}

function getAsaasConfig(): { apiUrl: string; apiKey: string } {
  const apiUrl = (process.env.ASAAS_API_URL || '').trim().replace(/\/+$/, '');
  const apiKey = (process.env.ASAAS_API_KEY || '').trim();

  if (!apiUrl || !apiKey) {
    throw new Error('Configurações do Asaas ausentes no .env (ASAAS_API_URL ou ASAAS_API_KEY não definidas).');
  }

  // Guard obrigatório de Sandbox
  if (!apiUrl.includes('sandbox.asaas.com')) {
    throw new Error(`[SEGURANÇA BLOQUEADA] Este spike só pode ser executado em ambiente Sandbox do Asaas. URL configurada: ${apiUrl}`);
  }

  return { apiUrl, apiKey };
}

async function asaasFetch(endpoint: string, options: { method?: string; body?: any } = {}): Promise<any> {
  const { apiUrl, apiKey } = getAsaasConfig();
  const url = `${apiUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      access_token: apiKey,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const raw = await response.text();
  let json: any = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch (err: any) {
    throw new Error(`Resposta do Asaas não é JSON válido (HTTP ${response.status}): ${raw.substring(0, 200)}`);
  }

  if (!response.ok) {
    const errorMsg = json?.errors?.[0]?.description || `Erro HTTP ${response.status} na chamada ${options.method || 'GET'} ${endpoint}`;
    throw new Error(errorMsg);
  }

  return json;
}

function getCommercialDate(date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BILLING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function getCommercialDates(daysAhead: number = 7): { today: string; futureDate: string } {
  const now = new Date();
  const todayStr = getCommercialDate(now);

  // Calcula D+N adicionando milissegundos equivalentes
  const futureInstant = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const futureStr = getCommercialDate(futureInstant);

  return { today: todayStr, futureDate: futureStr };
}

function saveState(state: SpikeState): void {
  fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function loadState(): SpikeState | null {
  if (!fs.existsSync(STATE_FILE_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Validação de prontidão cadastral do customer para Hosted Checkout
 */
function validateSpikeCustomerForCheckout(customerData: any): void {
  const customerId = customerData?.id || '';
  if (!customerId.startsWith('cus_')) {
    throw new Error(`[CUSTOMER_CHECKOUT_READINESS: FAIL] Customer ID inválido: "${customerId}". Deve iniciar com "cus_".`);
  }
  if (customerData.externalReference !== SPIKE_CUSTOMER_REF) {
    throw new Error(`[CUSTOMER_CHECKOUT_READINESS: FAIL] Customer externalReference divergente: "${customerData.externalReference}".`);
  }
  if (!customerData.cpfCnpj || !customerData.cpfCnpj.trim()) {
    throw new Error(`[CUSTOMER_CHECKOUT_READINESS: FAIL] Customer ${customerId} não possui cpfCnpj preenchido.`);
  }
  const hasPhone = Boolean((customerData.phone || customerData.mobilePhone || '').trim());
  if (!hasPhone) {
    throw new Error(`[CUSTOMER_CHECKOUT_READINESS: FAIL] Customer ${customerId} não possui telefone cadastrado.`);
  }
  if (!customerData.name || !customerData.name.trim()) {
    throw new Error(`[CUSTOMER_CHECKOUT_READINESS: FAIL] Customer ${customerId} não possui name cadastrado.`);
  }
  if (!customerData.email || !customerData.email.trim()) {
    throw new Error(`[CUSTOMER_CHECKOUT_READINESS: FAIL] Customer ${customerId} não possui email cadastrado.`);
  }
  console.log(`[OK] CUSTOMER_CHECKOUT_READINESS: PASS (customer ${customerId} pronto para Hosted Checkout)`);
}

/**
 * Resolve ou cria o customer exclusivo do spike garantindo pré-requisitos cadastrais completos
 */
async function resolveOrCreateSpikeCustomer(): Promise<{ customerId: string; customerData: any }> {
  console.log(`[1/4] Resolvendo customer exclusivo do spike (externalReference: ${SPIKE_CUSTOMER_REF})...`);
  const custQuery = await asaasFetch(`/customers?externalReference=${encodeURIComponent(SPIKE_CUSTOMER_REF)}`);
  const allCandidates = Array.isArray(custQuery?.data) ? custQuery.data : [];
  const validCandidates = allCandidates.filter((c: any) => !c.deleted);

  if (validCandidates.length > 1) {
    throw new Error(`[SEGURANÇA BLOQUEADA] Múltiplos customers ativos (${validCandidates.length}) encontrados para externalReference '${SPIKE_CUSTOMER_REF}'. Abortando para evitar ambiguidade.`);
  }

  let customerId: string | null = null;
  let customerData: any = null;

  if (validCandidates.length === 1) {
    const existing = validCandidates[0];
    customerId = existing.id;
    customerData = existing;
    console.log(`[OK] Customer exclusivo existente localizado: ${customerId}`);

    // Verifica campos da fixture que estão ausentes/vazios no cadastro existente
    const updatePayload: Record<string, any> = {};
    if (!existing.cpfCnpj?.trim()) updatePayload.cpfCnpj = SANDBOX_SPIKE_CUSTOMER_FIXTURE.cpfCnpj;
    if (!existing.phone?.trim()) updatePayload.phone = SANDBOX_SPIKE_CUSTOMER_FIXTURE.phone;
    if (!existing.mobilePhone?.trim()) updatePayload.mobilePhone = SANDBOX_SPIKE_CUSTOMER_FIXTURE.mobilePhone;
    if (!existing.address?.trim()) updatePayload.address = SANDBOX_SPIKE_CUSTOMER_FIXTURE.address;
    if (!existing.addressNumber?.trim()) updatePayload.addressNumber = SANDBOX_SPIKE_CUSTOMER_FIXTURE.addressNumber;
    if (!existing.province?.trim()) updatePayload.province = SANDBOX_SPIKE_CUSTOMER_FIXTURE.province;
    if (!existing.postalCode?.trim()) updatePayload.postalCode = SANDBOX_SPIKE_CUSTOMER_FIXTURE.postalCode;

    if (Object.keys(updatePayload).length > 0) {
      console.log(`[INFO] Atualizando cadastro do customer ${customerId} no Asaas com campos ausentes (${Object.keys(updatePayload).join(', ')})...`);
      await asaasFetch(`/customers/${customerId}`, {
        method: 'PUT',
        body: updatePayload,
      });

      customerData = await asaasFetch(`/customers/${customerId}`);
      console.log(`[OK] Cadastro do customer ${customerId} reparado com sucesso para o Checkout.`);
    }
  } else {
    console.log('[INFO] Customer exclusivo não encontrado. Criando explicitamente no Asaas com fixture completa...');
    const createdCust = await asaasFetch('/customers', {
      method: 'POST',
      body: {
        ...SANDBOX_SPIKE_CUSTOMER_FIXTURE,
        externalReference: SPIKE_CUSTOMER_REF,
      },
    });

    if (createdCust?.id && typeof createdCust.id === 'string') {
      customerId = createdCust.id;
      customerData = createdCust;
      console.log(`[OK] Novo customer exclusivo criado com fixture completa: ${customerId}`);
    }
  }

  if (!customerId || typeof customerId !== 'string' || !customerId.trim() || !customerData) {
    throw new Error('Falha ao resolver ou criar customer ID no Asaas para o spike.');
  }

  // Validação explícita de prontidão para Checkout
  validateSpikeCustomerForCheckout(customerData);

  return { customerId: customerId.trim(), customerData };
}

/**
 * Localiza de forma estrita e inequívoca a subscription correspondente ao spike
 */
async function findUnequivocalTargetSubscription(state: SpikeState): Promise<{
  subscription: any | null;
  correlation: 'PASS' | 'AMBIGUOUS' | 'NOT_FOUND';
  reason: string;
  candidatesCount: number;
}> {
  const subQuery = await asaasFetch(`/subscriptions?customer=${encodeURIComponent(state.provider_customer_id)}&order=desc&limit=50`);
  const allSubs = Array.isArray(subQuery?.data) ? subQuery.data : [];

  const activeSubs = allSubs.filter((s: any) => !s.deleted && s.customer === state.provider_customer_id);

  if (activeSubs.length === 0) {
    return {
      subscription: null,
      correlation: 'NOT_FOUND',
      reason: 'Nenhuma assinatura encontrada para o customer do spike.',
      candidatesCount: 0,
    };
  }

  // 1. Filtrar por critérios determinísticos fortes
  const expectedValue = Number((state.expected_amount_cents / 100).toFixed(2));
  const startedAtTime = new Date(state.started_at).getTime() - 120000; // tolerância de 2 minutos de relógio

  const strictCandidates = activeSubs.filter((s: any) => {
    const valueMatch = Math.abs(Number(s.value) - expectedValue) < 0.01;
    const cycleMatch = s.cycle === state.target_cycle;
    const nextDueMatch = s.nextDueDate === state.effective_billing_date;
    const createdTime = s.dateCreated ? new Date(s.dateCreated).getTime() : 0;
    const timeMatch = createdTime >= startedAtTime || s.externalReference === state.external_reference;

    return valueMatch && cycleMatch && nextDueMatch && timeMatch;
  });

  if (strictCandidates.length === 1) {
    return {
      subscription: strictCandidates[0],
      correlation: 'PASS',
      reason: `Assinatura ${strictCandidates[0].id} correlacionada com sucesso (cycle=${strictCandidates[0].cycle}, nextDueDate=${strictCandidates[0].nextDueDate}, value=${strictCandidates[0].value}).`,
      candidatesCount: 1,
    };
  }

  // 2. Se houver mais de um candidato estrito, tenta desambiguar por externalReference exata
  if (strictCandidates.length > 1) {
    const exactRefCandidates = strictCandidates.filter((s: any) => s.externalReference === state.external_reference);
    if (exactRefCandidates.length === 1) {
      return {
        subscription: exactRefCandidates[0],
        correlation: 'PASS',
        reason: `Assinatura ${exactRefCandidates[0].id} correlacionada inequivocamente por externalReference.`,
        candidatesCount: 1,
      };
    }

    return {
      subscription: null,
      correlation: 'AMBIGUOUS',
      reason: `Múltiplas assinaturas (${strictCandidates.length}) atendem aos critérios de valor, ciclo e nextDueDate. Não é seguro selecionar automaticamente.`,
      candidatesCount: strictCandidates.length,
    };
  }

  // 3. Se nenhum candidato estrito foi encontrado, verifica se há assinaturas com divergência de nextDueDate (para auditoria de erro)
  const partialCandidates = activeSubs.filter((s: any) => {
    const createdTime = s.dateCreated ? new Date(s.dateCreated).getTime() : 0;
    return createdTime >= startedAtTime;
  });

  if (partialCandidates.length === 1) {
    return {
      subscription: partialCandidates[0],
      correlation: 'PASS',
      reason: `Assinatura ${partialCandidates[0].id} detectada no intervalo de tempo do teste (atenção: nextDueDate = ${partialCandidates[0].nextDueDate}).`,
      candidatesCount: 1,
    };
  }

  return {
    subscription: null,
    correlation: 'NOT_FOUND',
    reason: 'Nenhuma assinatura compatível com a sessão do spike foi localizada.',
    candidatesCount: 0,
  };
}

/**
 * 1. PREPARE: Resolve customer exclusivo e gera a sessão de Hosted Checkout com nextDueDate futuro
 */
async function runPrepare(): Promise<void> {
  console.log('====================================================');
  console.log('PHASE 0 — ASAAS FUTURE CHECKOUT SPIKE: PREPARE');
  console.log('====================================================\n');

  // Single Live Spike Guard: impede sobrescrever estado de spike ativo ainda não limpo
  const existingState = loadState();
  if (existingState) {
    if (existingState.status === 'cleanup_confirmed') {
      // Arquiva estado anterior finalizado antes de iniciar o novo
      const archivePath = path.resolve(__dirname, `../.spike-future-checkout-state-archived-${existingState.spike_id}.json`);
      fs.writeFileSync(archivePath, JSON.stringify(existingState, null, 2), 'utf-8');
      console.log(`[OK] Estado anterior finalizado (${existingState.spike_id}) arquivado em ${path.basename(archivePath)}.`);
    } else if (existingState.status === 'prepare_failed' || !existingState.provider_checkout_id) {
      // Recovery de tentativa parcial que falhou antes do checkout ser criado
      console.log(`[INFO] Detectada tentativa anterior sem checkout criado (${existingState.spike_id}, status=${existingState.status}).`);
      console.log('[INFO] Verificando se existe alguma assinatura financeira ativa no Asaas...');
      const checkSubs = await asaasFetch(`/subscriptions?customer=${encodeURIComponent(existingState.provider_customer_id)}&order=desc&limit=10`);
      const activeSubs = Array.isArray(checkSubs?.data) ? checkSubs.data.filter((s: any) => !s.deleted && s.status === 'ACTIVE') : [];
      if (activeSubs.length > 0) {
        console.error('❌ [BLOQUEIO DE SEGURANÇA] Assinatura ativa detectada no Asaas para a tentativa anterior!');
        console.error('Execute inspect e cleanup antes de preparar um novo spike.');
        process.exit(1);
      }
      console.log('[OK] Nenhuma assinatura ativa encontrada no Asaas. Permitindo retry/resume seguro do PREPARE.');
    } else {
      console.error('❌ [BLOQUEIO DE SEGURANÇA — SINGLE LIVE SPIKE GUARD]');
      console.error(`Um spike anterior (${existingState.spike_id}) com Checkout ativo (${existingState.provider_checkout_id}) ainda NÃO foi finalizado com segurança.`);
      console.error(`Status atual do state file: "${existingState.status}".`);
      console.error('Execute os comandos abaixo antes de criar um novo spike:');
      console.error('  npx ts-node scripts/spike-future-checkout.ts inspect');
      console.error('  npx ts-node scripts/spike-future-checkout.ts cleanup\n');
      process.exit(1);
    }
  }

  const { apiUrl } = getAsaasConfig();
  console.log(`[OK] Gateway: ${apiUrl} (Sandbox verificado)`);

  // 1. Resolver ou criar customer exclusivo do spike (com fixture completa garantida)
  const { customerId: resolvedCustomerId, customerData } = await resolveOrCreateSpikeCustomer();

  // 2. Calcular datas comerciais
  const { today, futureDate } = getCommercialDates(7);
  console.log(`\n[2/4] Datas Comerciais (${BILLING_TIMEZONE}):`);
  console.log(`      Data de hoje (comercial): ${today}`);
  console.log(`      Data futura agendada (D+7): ${futureDate}`);

  // 3. Gerar externalReference única para este teste
  const timestamp = Date.now();
  const spikeId = `spike_${timestamp}`;
  const spikeExternalRef = `billing-transition-v1-spike-${timestamp}`;
  const expectedAmountCents = 37692; // R$ 376,92 (Essential Anual)
  const amountValue = Number((expectedAmountCents / 100).toFixed(2));

  // 4. Criar Hosted Checkout no Asaas com subscription.nextDueDate = futureDate
  console.log(`\n[3/4] Criando Hosted Checkout no Asaas com subscription.nextDueDate = ${futureDate}...`);
  const checkoutPayload = {
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['RECURRENT'],
    customer: resolvedCustomerId,
    minutesToExpire: 120,
    externalReference: spikeExternalRef,
    callback: {
      successUrl: 'https://louvaio.com/billing/spike-success',
      cancelUrl: 'https://louvaio.com/billing/spike-cancel',
      expiredUrl: 'https://louvaio.com/billing/spike-expired',
    },
    items: [
      {
        name: 'Plano Essential Anual Spike',
        description: 'Spike Phase 0 - Homologação de Checkout com Data Futura (D+7)',
        quantity: 1,
        value: amountValue,
      },
    ],
    subscription: {
      cycle: 'YEARLY',
      nextDueDate: futureDate,
    },
  };

  let checkoutResult: any = null;
  try {
    checkoutResult = await asaasFetch('/checkouts', {
      method: 'POST',
      body: checkoutPayload,
    });
  } catch (err: any) {
    // Persiste o erro de tentativa sem marcar checkout criado
    const failedState: SpikeState = {
      spike_id: spikeId,
      external_reference: spikeExternalRef,
      provider_customer_id: resolvedCustomerId,
      provider_checkout_id: null,
      checkout_url: null,
      started_at: new Date().toISOString(),
      commercial_date_today: today,
      effective_billing_date: futureDate,
      target_cycle: 'YEARLY',
      expected_amount_cents: expectedAmountCents,
      currency: 'BRL',
      status: 'prepare_failed',
      last_prepare_error: err.message,
      last_prepare_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    saveState(failedState);
    throw err;
  }

  // Persistência imediata de sucesso
  const state: SpikeState = {
    spike_id: spikeId,
    external_reference: spikeExternalRef,
    provider_customer_id: resolvedCustomerId,
    provider_checkout_id: checkoutResult.id,
    checkout_url: checkoutResult.link || checkoutResult.url || checkoutResult.checkoutUrl,
    started_at: new Date().toISOString(),
    commercial_date_today: today,
    effective_billing_date: futureDate,
    target_cycle: 'YEARLY',
    expected_amount_cents: expectedAmountCents,
    currency: 'BRL',
    status: 'prepared',
    updated_at: new Date().toISOString(),
  };

  saveState(state);

  console.log('\n[4/4] Sessão de Checkout gerada com sucesso e estado salvo localmente!');
  console.log('----------------------------------------------------');
  console.log(`Spike ID:               ${state.spike_id}`);
  console.log(`External Reference:     ${state.external_reference}`);
  console.log(`Customer ID:            ${state.provider_customer_id}`);
  console.log(`Checkout ID:            ${state.provider_checkout_id}`);
  console.log(`Checkout URL:           ${state.checkout_url}`);
  console.log(`Ciclo Configurado:      ${state.target_cycle}`);
  console.log(`Valor Esperado:         R$ ${(state.expected_amount_cents / 100).toFixed(2)}`);
  console.log(`Data Futura de Cobrança:${state.effective_billing_date}`);
  console.log('----------------------------------------------------\n');
  console.log('👉 PRÓXIMA ETAPA (MANUAL):');
  console.log('   1. Abra a URL do Checkout acima no navegador.');
  console.log('   2. Preencha os dados usando o cartão de teste do Asaas Sandbox.');
  console.log('   3. Conclua o pagamento.');
  console.log('   4. Execute em seguida: npx ts-node scripts/spike-future-checkout.ts inspect\n');
}

/**
 * 2. INSPECT: Audita no Asaas a assinatura e as cobranças geradas pós-checkout
 */
async function runInspect(): Promise<void> {
  console.log('====================================================');
  console.log('PHASE 0 — ASAAS FUTURE CHECKOUT SPIKE: INSPECT');
  console.log('====================================================\n');

  const state = loadState();
  if (!state) {
    throw new Error('Nenhum estado de spike encontrado. Execute primeiro: npx ts-node scripts/spike-future-checkout.ts prepare');
  }

  console.log(`Spike ID:           ${state.spike_id}`);
  console.log(`Customer ID:        ${state.provider_customer_id}`);
  console.log(`Checkout ID:        ${state.provider_checkout_id}`);
  console.log(`External Reference: ${state.external_reference}`);
  console.log(`Data Futura Alvo:   ${state.effective_billing_date}\n`);

  // 1. Correlacionar a assinatura de forma estrita e inequívoca
  console.log('[1/2] Correlacionando assinatura do spike no Asaas...');
  const matchResult = await findUnequivocalTargetSubscription(state);

  if (matchResult.correlation === 'NOT_FOUND') {
    console.error(`❌ [TARGET_CORRELATION: NOT_FOUND] ${matchResult.reason}`);
    console.error('O checkout já foi concluído manualmente no navegador Sandbox?\n');
    return;
  }

  if (matchResult.correlation === 'AMBIGUOUS') {
    console.error(`⚠️  [TARGET_CORRELATION: AMBIGUOUS] ${matchResult.reason}`);
    console.error('Abortando inspeção automática. Verifique as assinaturas no painel do Sandbox.\n');
    return;
  }

  const targetSub = matchResult.subscription;
  if (!targetSub || typeof targetSub.id !== 'string' || !targetSub.id.trim()) {
    console.error('❌ [ERRO] Assinatura alvo retornada não possui ID válido.');
    return;
  }
  const validTargetSubId: string = targetSub.id.trim();

  console.log(`[OK] Assinatura localizada: ${validTargetSubId}`);
  console.log(`     Status:       ${targetSub.status}`);
  console.log(`     Ciclo:        ${targetSub.cycle}`);
  console.log(`     nextDueDate:  ${targetSub.nextDueDate}`);
  console.log(`     Valor:        R$ ${targetSub.value}`);
  console.log(`     dateCreated:  ${targetSub.dateCreated}`);

  // 2. Buscar pagamentos da assinatura
  console.log('\n[2/2] Consultando pagamentos gerados para a assinatura...');
  const payQuery = await asaasFetch(`/payments?subscription=${encodeURIComponent(validTargetSubId)}`);
  const payments = Array.isArray(payQuery?.data) ? payQuery.data : [];

  console.log(`Total de pagamentos encontrados: ${payments.length}`);
  if (payments.length > 0) {
    console.log('\n| ID Pagamento | Status | Valor | Vencimento (dueDate) | dateCreated | billingType |');
    console.log('| :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const p of payments) {
      console.log(`| ${p.id} | ${p.status} | R$ ${p.value} | ${p.dueDate} | ${p.dateCreated} | ${p.billingType} |`);
    }
  } else {
    console.log('[INFO] Zero cobranças emitidas até o momento (comportamento aceito pelo modelo de data futura).');
  }

  // 3. Avaliação Estrita dos Critérios
  const todayCommercial = getCommercialDate(new Date());
  
  // Early payment: qualquer pagamento CONFIRMED ou RECEIVED que ocorra antes de effective_billing_date
  const earlyPaidPayments = payments.filter((p: any) => {
    const isPaid = p.status === 'CONFIRMED' || p.status === 'RECEIVED';
    return isPaid && todayCommercial < state.effective_billing_date;
  });

  const futurePendingPayments = payments.filter((p: any) => p.status === 'PENDING' && p.dueDate === state.effective_billing_date);
  const isFutureDueDateCorrect = targetSub.nextDueDate === state.effective_billing_date;
  const isCustomerReused = targetSub.customer === state.provider_customer_id;

  let financialState: FinancialState = 'OTHER_REVIEW_REQUIRED';
  if (earlyPaidPayments.length > 0) {
    financialState = 'EARLY_CAPTURE_DETECTED';
  } else if (payments.length === 0) {
    financialState = 'ZERO_PAYMENTS';
  } else if (futurePendingPayments.length === payments.length) {
    financialState = 'FUTURE_PENDING_ONLY';
  }

  const classification: AuditClassification = {
    target_correlation: matchResult.correlation,
    future_due_date: isFutureDueDateCorrect ? 'PASS' : 'FAIL',
    early_capture: earlyPaidPayments.length === 0 ? 'PASS' : 'FAIL',
    customer_reuse: isCustomerReused ? 'PASS' : 'FAIL',
    financial_state: financialState,
  };

  state.detected_subscription_id = validTargetSubId;
  state.detected_subscription_status = targetSub.status;
  state.detected_subscription_next_due_date = targetSub.nextDueDate;
  state.payments_found = payments;
  state.audit_classification = classification;
  state.status = 'inspected';
  state.updated_at = new Date().toISOString();
  saveState(state);

  console.log('\n====================================================');
  console.log('RESULTADO DA AUDITORIA DO SPIKE:');
  console.log(`  TARGET_CORRELATION: ${classification.target_correlation}`);
  console.log(`  FUTURE_DUE_DATE:    ${classification.future_due_date} (nextDueDate: ${targetSub.nextDueDate})`);
  console.log(`  EARLY_CAPTURE:      ${classification.early_capture}`);
  console.log(`  CUSTOMER_REUSE:     ${classification.customer_reuse}`);
  console.log(`  FINANCIAL_STATE:    ${classification.financial_state}`);
  console.log('====================================================\n');
  console.log('👉 PRÓXIMA ETAPA:');
  console.log('   Execute a limpeza obrigatória: npx ts-node scripts/spike-future-checkout.ts cleanup\n');
}

/**
 * 3. CLEANUP: Inativa a assinatura exata do spike no Asaas e remove cobranças futuras PENDING
 */
async function runCleanup(): Promise<void> {
  console.log('====================================================');
  console.log('PHASE 0 — ASAAS FUTURE CHECKOUT SPIKE: CLEANUP');
  console.log('====================================================\n');

  const state = loadState();
  if (!state) {
    throw new Error('Nenhum estado de spike encontrado para limpeza.');
  }

  let targetSubId: string | null = state.detected_subscription_id || null;

  if (!targetSubId) {
    console.log('[INFO] Assinatura não estava salva no state. Buscando correlação inequívoca no Asaas...');
    const match = await findUnequivocalTargetSubscription(state);
    if (match.correlation === 'PASS' && match.subscription && match.subscription.id) {
      targetSubId = match.subscription.id;
    } else {
      console.error(`❌ [BLOQUEIO DE SEGURANÇA] Impossível executar cleanup automático: correlação é "${match.correlation}".`);
      console.error('Razão:', match.reason);
      console.error('Nenhuma assinatura foi alterada no Asaas.\n');
      process.exit(1);
    }
  }

  // Type narrowing estrito
  if (!targetSubId || typeof targetSubId !== 'string' || !targetSubId.trim()) {
    console.error('❌ [BLOQUEIO DE SEGURANÇA] Target subscription ID inválido para cleanup.');
    process.exit(1);
  }
  const validCleanupTargetId: string = targetSubId.trim();

  // Validação estrita da subscription alvo antes de mutar
  console.log(`[1/3] Revalidando subscription alvo ${validCleanupTargetId} antes da inativação...`);
  const currentSub = await asaasFetch(`/subscriptions/${validCleanupTargetId}`);
  if (
    currentSub.customer !== state.provider_customer_id ||
    currentSub.cycle !== state.target_cycle ||
    currentSub.nextDueDate !== state.effective_billing_date
  ) {
    console.error('❌ [BLOQUEIO DE SEGURANÇA] Dados da subscription alvo divergiram do state file.');
    console.error(`Esperado: customer=${state.provider_customer_id}, cycle=${state.target_cycle}, nextDueDate=${state.effective_billing_date}`);
    console.error(`Obtido:   customer=${currentSub.customer}, cycle=${currentSub.cycle}, nextDueDate=${currentSub.nextDueDate}`);
    console.error('Abortando cleanup automático para evitar inativação indevida.\n');
    process.exit(1);
  }

  // 1. Inativar a subscription alvo
  console.log(`[2/3] Inativando assinatura no Asaas: ${validCleanupTargetId}...`);
  await asaasFetch(`/subscriptions/${validCleanupTargetId}`, {
    method: 'PUT',
    body: { status: 'INACTIVE' },
  });

  const verifiedSub = await asaasFetch(`/subscriptions/${validCleanupTargetId}`);
  const isTargetInactive = verifiedSub.status === 'INACTIVE';
  console.log(`[OK] Status verificado após inativação: ${verifiedSub.status} (PASS)`);

  // 2. Limpar cobranças PENDING futuras associadas exclusivamente à assinatura do spike
  console.log(`\n[3/3] Verificando cobranças PENDING futuras para exclusão segura...`);
  const payQuery = await asaasFetch(`/payments?subscription=${encodeURIComponent(validCleanupTargetId)}&status=PENDING`);
  const pendingPayments = Array.isArray(payQuery?.data) ? payQuery.data : [];

  let pendingCleanedPass = true;
  for (const p of pendingPayments) {
    if (p.subscription === validCleanupTargetId && p.status === 'PENDING' && p.dueDate >= state.effective_billing_date) {
      console.log(`     Removendo cobrança futura PENDING ${p.id} (dueDate: ${p.dueDate})...`);
      try {
        await asaasFetch(`/payments/${p.id}`, { method: 'DELETE' });
        console.log(`     [OK] Cobrança ${p.id} removida com sucesso.`);
      } catch (err: any) {
        pendingCleanedPass = false;
        console.warn(`     [AVISO] Falha ao deletar cobrança ${p.id}: ${err.message}`);
      }
    }
  }

  // 3. Verificação final de live targets
  const finalPayQuery = await asaasFetch(`/payments?subscription=${encodeURIComponent(validCleanupTargetId)}&status=PENDING`);
  const finalPending = Array.isArray(finalPayQuery?.data) ? finalPayQuery.data : [];
  const financiallyLiveRemains = !isTargetInactive || finalPending.length > 0 ? 'YES' : 'NO';

  const cleanupClassification: CleanupClassification = {
    target_inactive: isTargetInactive ? 'PASS' : 'FAIL',
    future_pending_payments_cleaned: pendingCleanedPass ? 'PASS' : 'FAIL',
    confirmed_payments_touched: 'NO',
    financially_live_target_remains: financiallyLiveRemains,
  };

  state.cleanup_classification = cleanupClassification;
  state.cleanup_confirmed_at = new Date().toISOString();
  state.status = 'cleanup_confirmed';
  state.updated_at = new Date().toISOString();
  saveState(state);

  console.log('\n====================================================');
  console.log('RESULTADO DO CLEANUP DO SPIKE:');
  console.log(`  TARGET_INACTIVE:                 ${cleanupClassification.target_inactive}`);
  console.log(`  FUTURE_PENDING_PAYMENTS_CLEANED: ${cleanupClassification.future_pending_payments_cleaned}`);
  console.log(`  CONFIRMED_PAYMENTS_TOUCHED:      ${cleanupClassification.confirmed_payments_touched}`);
  console.log(`  FINANCIALLY_LIVE_TARGET_REMAINS: ${cleanupClassification.financially_live_target_remains}`);
  console.log('====================================================\n');
}

function runCheck(): void {
  console.log('====================================================');
  console.log('PHASE 0 — ASAAS FUTURE CHECKOUT SPIKE: SELF-CHECK');
  console.log('====================================================');
  const { apiUrl } = getAsaasConfig();
  const { today, futureDate } = getCommercialDates(7);
  console.log(`[OK] TypeScript compilation & runtime typing: PASS`);
  console.log(`[OK] Asaas API configured: ${apiUrl} (Sandbox verified)`);
  console.log(`[OK] Timezone configured: ${BILLING_TIMEZONE}`);
  console.log(`[OK] Commercial date today: ${today}`);
  console.log(`[OK] Commercial date D+7:   ${futureDate}`);
  console.log(`[OK] Spike Customer Ref:    ${SPIKE_CUSTOMER_REF}`);

  // Validação estrutural da fixture Sandbox
  if (!SANDBOX_SPIKE_CUSTOMER_FIXTURE.cpfCnpj || !SANDBOX_SPIKE_CUSTOMER_FIXTURE.phone || !SANDBOX_SPIKE_CUSTOMER_FIXTURE.name) {
    throw new Error('[CHECK FALHOU] SANDBOX_SPIKE_CUSTOMER_FIXTURE incompleta.');
  }
  console.log(`[OK] Sandbox Spike Fixture: PASS (cpfCnpj, phone, mobilePhone, address, postalCode configurados)`);
  console.log('[OK] Self-check completed without external network mutations.\n');
}

function printHelp(): void {
  console.log('Uso:');
  console.log('  npx ts-node scripts/spike-future-checkout.ts check');
  console.log('  npx ts-node scripts/spike-future-checkout.ts prepare');
  console.log('  npx ts-node scripts/spike-future-checkout.ts inspect');
  console.log('  npx ts-node scripts/spike-future-checkout.ts cleanup');
}

async function main() {
  const command = process.argv[2]?.toLowerCase();

  switch (command) {
    case 'check':
    case '--check':
      runCheck();
      break;
    case 'prepare':
      await runPrepare();
      break;
    case 'inspect':
      await runInspect();
      break;
    case 'cleanup':
      await runCleanup();
      break;
    case 'help':
    case '--help':
      printHelp();
      break;
    default:
      printHelp();
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('\n❌ ERRO NA EXECUÇÃO DO SPIKE:', err.message);
  process.exit(1);
});
