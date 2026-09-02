/**
 * Script Operacional: Phase 0B.1 — Asaas Hosted Detached Adjustment + Token Investigation
 *
 * Propósito:
 *   Ferramenta isolada e progressiva de homologação em Sandbox para validar:
 *   1. Cobrança de ajuste proporcional de upgrade via Hosted Checkout avulso (`DETACHED`);
 *   2. Correlação forte do pagamento avulso por `checkoutSession`, `externalReference`, `customer` e `amount`;
 *   3. Confirmação financeira do ajuste (`PAYMENT_CONFIRMED`);
 *   4. Auditoria estrita da disponibilidade de `creditCardToken` ou método reutilizável provider-safe
 *      disponibilizado ao backend após a liquidação do checkout.
 *
 * Segurança & Isolamento:
 *   - Ambiente restrito a Asaas Sandbox (`sandbox.asaas.com`).
 *   - Reutiliza customer exclusivo do spike (`externalReference: 'billing-transition-v1-spike-customer'`).
 *   - Não altera ministérios, quotas, planos ou entitlements reais do LouvAIO.
 *   - Não expõe segredos, tokens ou senhas.
 *   - NÃO manipula, consulta ou armazena números brutos de cartão ou CVV (PCI-safe).
 *   - Não cria assinatura recorrente futura nesta etapa (escopo de 0B.1 é estritamente o ajuste avulso).
 *   - Pagamento de ajuste Sandbox confirmado NUNCA é deletado ou estornado (permanece como evidência histórica).
 *
 * Comandos CLI:
 *   npx ts-node scripts/spike-upgrade-adjustment.ts check
 *   npx ts-node scripts/spike-upgrade-adjustment.ts prepare
 *   npx ts-node scripts/spike-upgrade-adjustment.ts inspect
 *   npx ts-node scripts/spike-upgrade-adjustment.ts audit-token
 *   npx ts-node scripts/spike-upgrade-adjustment.ts archive
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// Carrega variáveis de ambiente locais
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const STATE_FILE_PATH = path.resolve(__dirname, '../.spike-upgrade-adjustment-state.json');
const SPIKE_CUSTOMER_REF = 'billing-transition-v1-spike-customer';
const BILLING_TIMEZONE = process.env.BILLING_TIMEZONE || 'America/Sao_Paulo';

// Valor controlado de teste para o laboratório de mecânica do provedor
export const TEST_ADJUSTMENT_CENTS = 2750; // R$ 27,50 (ex: 50% de delta R$ 55,00)
export const TEST_ADJUSTMENT_VALUE = 27.50;
export const SPIKE_ITEM_NAME = 'Upgrade adjustment test'; // 23 caracteres (obedece o limite máximo de 30 chars do Asaas)

/**
 * Fixture cadastral segura para Sandbox
 */
export const SANDBOX_SPIKE_CUSTOMER_FIXTURE = {
  name: 'Spike Customer Transition V1', // 29 caracteres (<= 30)
  email: 'spike-transition-v1@example.com',
  cpfCnpj: '04717147987', // CPF sintético de teste
  phone: '4738010919',
  mobilePhone: '47993456789',
  address: 'Av. Rolf Colin',
  addressNumber: '100',
  province: 'America',
  postalCode: '89223005',
};

export type AdjustmentCorrelationStatus = 'PASS' | 'AMBIGUOUS' | 'NOT_FOUND';
export type AdjustmentAmountStatus = 'PASS' | 'FAIL';
export type PaymentState = 'PENDING' | 'CONFIRMED' | 'RECEIVED' | 'FAILED_OR_OTHER';
export type TokenReuseStatus = 'AVAILABLE' | 'NOT_EXPOSED' | 'AMBIGUOUS' | 'NOT_TESTED';
export type OneCheckoutPath = 'POSSIBLE' | 'NOT_PROVEN' | 'NOT_SUPPORTED_BY_OBSERVED_FLOW';
export type NextStage = 'PHASE_0B_2A' | 'PHASE_0B_2B' | 'BLOCKED_REVIEW_REQUIRED';

export type ProviderAdjustmentCapability = 'PASS' | 'FAIL' | 'PENDING' | 'NOT_TESTED';

export interface TokenAuditDetails {
  token_found: boolean;
  token_identifier_type: 'creditCardToken' | 'customerCreditCard' | 'other' | 'none';
  token_masked_value?: string | null;
  token_source_location: 'payment' | 'customer' | 'none';
  reusable_server_to_server: boolean;
  token_audit_notes: string;
}

export interface AdjustmentAuditClassification {
  provider_adjustment_capability: ProviderAdjustmentCapability;
  adjustment_correlation: AdjustmentCorrelationStatus;
  adjustment_amount: AdjustmentAmountStatus;
  payment_state: PaymentState;
  token_reuse: TokenReuseStatus;
  one_checkout_path: OneCheckoutPath;
  next_stage: NextStage;
}

export interface SpikeAdjustmentState {
  spike_id: string;
  external_reference: string;
  provider_customer_id: string;
  provider_checkout_id: string | null;
  checkout_url: string | null;
  started_at: string;
  commercial_date: string;
  expected_adjustment_cents: number;
  currency: 'BRL';
  status: 'prepare_failed' | 'prepared' | 'inspected' | 'archived';
  last_error?: string | null;
  last_error_at?: string | null;
  detected_payment_id?: string | null;
  detected_payment_status?: string | null;
  detected_payment_value?: number | null;
  detected_payment_billing_type?: string | null;
  detected_payment_checkout_session?: string | null;
  detected_payment_external_reference?: string | null;
  detected_payment_date_created?: string | null;
  detected_payment_confirmed_date?: string | null;
  payments_found?: any[];
  token_audit?: TokenAuditDetails;
  audit_classification?: AdjustmentAuditClassification;
  inspected_at?: string | null;
  archived_at?: string | null;
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
    throw new Error(`[SEGURANÇA BLOQUEADA] Este spike só pode ser executado no Sandbox do Asaas. URL configurada: ${apiUrl}`);
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

function loadState(): SpikeAdjustmentState | null {
  if (!fs.existsSync(STATE_FILE_PATH)) {
    return null;
  }
  try {
    const content = fs.readFileSync(STATE_FILE_PATH, 'utf-8');
    return JSON.parse(content) as SpikeAdjustmentState;
  } catch (err: any) {
    console.error(`[AVISO] Não foi possível ler o arquivo de estado ${STATE_FILE_PATH}: ${err.message}`);
    return null;
  }
}

function saveState(state: SpikeAdjustmentState): void {
  fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Validação de prontidão cadastral do customer
 */
function validateCustomerReadiness(customer: any): { ready: boolean; missingFields: string[] } {
  const missingFields: string[] = [];
  if (!customer.cpfCnpj || !customer.cpfCnpj.trim()) missingFields.push('cpfCnpj');
  if (!customer.phone && !customer.mobilePhone) missingFields.push('phone/mobilePhone');
  if (!customer.name || !customer.name.trim()) missingFields.push('name');
  if (!customer.email || !customer.email.trim()) missingFields.push('email');
  return { ready: missingFields.length === 0, missingFields };
}

/**
 * Resolve o customer exclusivo de Sandbox com validação e reparo cadastral
 */
async function resolveDedicatedSpikeCustomer(allowRepair: boolean = false): Promise<string> {
  const search = await asaasFetch(`/customers?externalReference=${encodeURIComponent(SPIKE_CUSTOMER_REF)}`);
  const items: any[] = (search?.data || []).filter((c: any) => !c.deleted);

  if (items.length > 1) {
    throw new Error(
      `[SEGURANÇA BLOQUEADA] Múltiplos customers ativos (${items.length}) encontrados para a referência '${SPIKE_CUSTOMER_REF}'. Abortando para evitar duplicatas.`
    );
  }

  let customerId: string;
  let customerData: any;

  if (items.length === 1) {
    customerId = items[0].id;
    customerData = items[0];
  } else {
    if (!allowRepair) {
      throw new Error(`Customer exclusivo '${SPIKE_CUSTOMER_REF}' não encontrado no Asaas Sandbox.`);
    }
    console.log(`[CUSTOMER] Criando customer exclusivo do spike com fixture completa no Sandbox...`);
    const created = await asaasFetch('/customers', {
      method: 'POST',
      body: {
        ...SANDBOX_SPIKE_CUSTOMER_FIXTURE,
        externalReference: SPIKE_CUSTOMER_REF,
      },
    });
    customerId = created.id;
    customerData = created;
    console.log(`[CUSTOMER] Customer exclusivo criado com sucesso: ${customerId}`);
  }

  const readiness = validateCustomerReadiness(customerData);
  if (!readiness.ready) {
    if (!allowRepair) {
      throw new Error(`Customer ${customerId} incompleto no Asaas. Campos ausentes: ${readiness.missingFields.join(', ')}`);
    }
    console.log(`[CUSTOMER REPAIR] Atualizando cadastro do customer ${customerId} com fixture segura...`);
    const updated = await asaasFetch(`/customers/${customerId}`, {
      method: 'PUT',
      body: {
        ...SANDBOX_SPIKE_CUSTOMER_FIXTURE,
        externalReference: SPIKE_CUSTOMER_REF,
      },
    });
    const recheck = validateCustomerReadiness(updated);
    if (!recheck.ready) {
      throw new Error(`Falha ao reparar customer ${customerId}. Campos ainda ausentes: ${recheck.missingFields.join(', ')}`);
    }
    console.log(`[CUSTOMER REPAIR] Cadastro do customer ${customerId} reparado e validado com sucesso.`);
  }

  return customerId;
}

/**
 * Comando: CHECK
 * Valida o ambiente, timezone, fixture e parâmetros de laboratório sem mutações.
 */
export async function runCheck(): Promise<void> {
  console.log(`==================================================`);
  console.log(`PHASE 0B.1 — HOSTED DETACHED ADJUSTMENT CHECK`);
  console.log(`==================================================`);

  const { apiUrl } = getAsaasConfig();
  console.log(`[ENV] Asaas Sandbox URL : ${apiUrl} (PASS)`);
  console.log(`[ENV] Billing Timezone   : ${BILLING_TIMEZONE} (PASS)`);
  console.log(`[ENV] Test Adjustment    : R$ ${TEST_ADJUSTMENT_VALUE.toFixed(2)} (${TEST_ADJUSTMENT_CENTS} cents)`);
  console.log(`[ENV] Commercial Today   : ${getCommercialDate()} (PASS)`);
  console.log(`[ENV] Spike Customer Ref : ${SPIKE_CUSTOMER_REF}`);

  console.log(`\n[READ-ONLY QUERY] Verificando existência e prontidão do customer no Sandbox...`);
  try {
    const search = await asaasFetch(`/customers?externalReference=${encodeURIComponent(SPIKE_CUSTOMER_REF)}`);
    const items: any[] = (search?.data || []).filter((c: any) => !c.deleted);

    if (items.length === 0) {
      console.log(`[CUSTOMER] Nenhum customer existente com referência '${SPIKE_CUSTOMER_REF}'. Será criado no prepare.`);
    } else if (items.length === 1) {
      const customer = items[0];
      const readiness = validateCustomerReadiness(customer);
      console.log(`[CUSTOMER] Customer exclusivo encontrado: ${customer.id}`);
      console.log(`[CUSTOMER] Prontidão Cadastral : ${readiness.ready ? 'PASS (Completo)' : `PENDING_REPAIR (${readiness.missingFields.join(', ')})`}`);
    } else {
      console.log(`[CUSTOMER] ALERTA: ${items.length} customers encontrados com a referência '${SPIKE_CUSTOMER_REF}'.`);
    }
  } catch (err: any) {
    console.log(`[CUSTOMER QUERY] Erro ao consultar customer: ${err.message}`);
  }

  const existingState = loadState();
  if (existingState) {
    console.log(`\n[LOCAL STATE] Estado local encontrado:`);
    console.log(`  Spike ID       : ${existingState.spike_id}`);
    console.log(`  Status         : ${existingState.status}`);
    console.log(`  Ext Reference  : ${existingState.external_reference}`);
    console.log(`  Checkout ID    : ${existingState.provider_checkout_id || 'null'}`);
    console.log(`  Payment ID     : ${existingState.detected_payment_id || 'null'}`);
  } else {
    console.log(`\n[LOCAL STATE] Nenhum estado local anterior ativo.`);
  }

  console.log(`\n[RESULT] Verificação estática concluída com sucesso (0 mutações executadas).`);
}

/**
 * Comando: PREPARE
 * Cria o Hosted Checkout DETACHED avulso no Asaas Sandbox.
 */
export async function runPrepare(): Promise<void> {
  console.log(`==================================================`);
  console.log(`PHASE 0B.1 — PREPARE HOSTED DETACHED ADJUSTMENT`);
  console.log(`==================================================`);

  // 1. Single Live Spike Guard
  const currentState = loadState();
  if (currentState) {
    if (currentState.status === 'prepared') {
      throw new Error(
        `[SEGURANÇA BLOQUEADA] Um spike de ajuste anterior já está preparado e aguardando pagamento/inspeção (Spike ID: ${currentState.spike_id}, Checkout ID: ${currentState.provider_checkout_id}). Execute 'inspect' antes de preparar outro.`
      );
    }
    if (currentState.status === 'inspected' && currentState.audit_classification?.payment_state === 'PENDING') {
      throw new Error(
        `[SEGURANÇA BLOQUEADA] O spike anterior (${currentState.spike_id}) ainda possui pagamento PENDING. Aguarde a confirmação ou arquive o estado via 'archive' antes de novo prepare.`
      );
    }
    if (currentState.status === 'prepare_failed' && currentState.provider_checkout_id) {
      throw new Error(
        `[SEGURANÇA BLOQUEADA] O spike anterior falhou mas possui um Checkout ID associado (${currentState.provider_checkout_id}). Execute 'inspect' para reconciliar ou 'archive' antes de novo prepare.`
      );
    }
  }

  // 2. Resolve e repara customer (apenas se incompleto)
  const customerId = await resolveDedicatedSpikeCustomer(true);
  const now = new Date();
  const startedAt = now.toISOString();
  const commercialDate = getCommercialDate(now);
  const externalReference = `billing-transition-v1-spike-adjustment-${Date.now()}`;
  const spikeId = `intent_spike_adj_${Date.now()}`;

  // 3. Salva estado preliminar
  const preliminaryState: SpikeAdjustmentState = {
    spike_id: spikeId,
    external_reference: externalReference,
    provider_customer_id: customerId,
    provider_checkout_id: null,
    checkout_url: null,
    started_at: startedAt,
    commercial_date: commercialDate,
    expected_adjustment_cents: TEST_ADJUSTMENT_CENTS,
    currency: 'BRL',
    status: 'prepare_failed',
    updated_at: startedAt,
  };
  saveState(preliminaryState);

  // 4. Criação do Hosted Checkout DETACHED
  console.log(`[CHECKOUT] Criando Hosted Checkout DETACHED de ajuste no Asaas Sandbox...`);
  console.log(`  Customer           : ${customerId}`);
  console.log(`  External Reference : ${externalReference}`);
  console.log(`  Valor do Ajuste    : R$ ${TEST_ADJUSTMENT_VALUE.toFixed(2)}`);
  console.log(`  Item Name          : "${SPIKE_ITEM_NAME}" (${SPIKE_ITEM_NAME.length} chars)`);

  const payload = {
    billingTypes: ['CREDIT_CARD'],
    chargeTypes: ['DETACHED'],
    minutesToExpire: 60,
    externalReference,
    callback: {
      successUrl: 'https://praiseapp.com.br/checkout/success',
      cancelUrl: 'https://praiseapp.com.br/checkout/cancel',
      expiredUrl: 'https://praiseapp.com.br/checkout/cancel',
      autoRedirect: true,
    },
    items: [
      {
        name: SPIKE_ITEM_NAME,
        description: `Ajuste controlado de teste R$ ${TEST_ADJUSTMENT_VALUE.toFixed(2)} (LouvAIO Phase 0B.1 Spike)`,
        quantity: 1,
        value: TEST_ADJUSTMENT_VALUE,
      },
    ],
    customer: customerId,
  };

  let checkoutResponse: any;
  try {
    checkoutResponse = await asaasFetch('/checkouts', {
      method: 'POST',
      body: payload,
    });
  } catch (err: any) {
    preliminaryState.last_error = err.message;
    preliminaryState.last_error_at = new Date().toISOString();
    saveState(preliminaryState);
    throw new Error(`Falha ao criar Hosted Checkout DETACHED: ${err.message}`);
  }

  const checkoutId = checkoutResponse.id;
  const checkoutUrl = checkoutResponse.link || checkoutResponse.url || checkoutResponse.checkoutUrl;

  if (!checkoutId || !checkoutUrl) {
    throw new Error(`Resposta do Asaas não retornou checkoutId ou checkoutUrl válido: ${JSON.stringify(checkoutResponse)}`);
  }

  // 5. Atualiza estado para 'prepared'
  const preparedState: SpikeAdjustmentState = {
    ...preliminaryState,
    provider_checkout_id: checkoutId,
    checkout_url: checkoutUrl,
    status: 'prepared',
    updated_at: new Date().toISOString(),
  };
  saveState(preparedState);

  console.log(`\n==================================================`);
  console.log(`HOSTED CHECKOUT DETACHED CRIADO COM SUCESSO!`);
  console.log(`==================================================`);
  console.log(`Checkout ID : ${checkoutId}`);
  console.log(`Checkout URL: ${checkoutUrl}`);
  console.log(`\nINSTRUÇÕES PARA O TESTE MANUAL:`);
  console.log(`1. Abra a URL do Checkout no navegador;`);
  console.log(`2. Conclua o pagamento com cartão de teste do Asaas Sandbox no valor de R$ ${TEST_ADJUSTMENT_VALUE.toFixed(2)};`);
  console.log(`3. Após a confirmação no navegador, execute:`);
  console.log(`   npx ts-node scripts/spike-upgrade-adjustment.ts inspect`);
  console.log(`==================================================`);
}

/**
 * Auditoria de Tokens Provider-Safe associados ao Customer ou Payment (PCI-Safe: estritamente READ-ONLY)
 */
async function auditCustomerTokenization(customerId: string, paymentId?: string | null): Promise<TokenAuditDetails> {
  let tokenFound = false;
  let tokenIdentifierType: TokenAuditDetails['token_identifier_type'] = 'none';
  let tokenMaskedValue: string | null = null;
  let tokenSourceLocation: TokenAuditDetails['token_source_location'] = 'none';
  let reusable = false;
  const notes: string[] = [];

  // 1. Inspeciona objeto do Payment (GET /v3/payments/{id})
  if (paymentId) {
    try {
      const payment = await asaasFetch(`/payments/${paymentId}`);
      if (payment.creditCardToken) {
        tokenFound = true;
        tokenIdentifierType = 'creditCardToken';
        tokenSourceLocation = 'payment';
        tokenMaskedValue = payment.creditCardToken.substring(0, 8) + '...';
        reusable = true;
        notes.push(`creditCardToken localizado diretamente no payment (${payment.creditCardToken.substring(0, 8)}...)`);
      } else if (payment.creditCard && typeof payment.creditCard === 'object') {
        notes.push(`creditCard metadata presente no payment (brand: ${payment.creditCard.creditCardBrand || 'N/A'}, last4: ${payment.creditCard.creditCardNumber || 'N/A'})`);
      }
    } catch (err: any) {
      notes.push(`Erro ao consultar payment ${paymentId}: ${err.message}`);
    }
  }

  // 2. Inspeciona objeto do Customer (GET /v3/customers/{id})
  try {
    const customer = await asaasFetch(`/customers/${customerId}`);
    if (customer.creditCardToken) {
      tokenFound = true;
      tokenIdentifierType = 'customerCreditCard';
      tokenSourceLocation = 'customer';
      tokenMaskedValue = customer.creditCardToken.substring(0, 8) + '...';
      reusable = true;
      notes.push(`creditCardToken presente no objeto do customer (${customer.creditCardToken.substring(0, 8)}...)`);
    }
  } catch (err: any) {
    notes.push(`Erro ao consultar customer ${customerId}: ${err.message}`);
  }

  // 3. Inspeciona endpoint específico de tokens se disponível (GET /v3/customers/{id}/creditCardTokens)
  try {
    const tokensRes = await asaasFetch(`/customers/${customerId}/creditCardTokens`);
    const tokenList = tokensRes?.data || [];
    if (tokenList.length > 0) {
      tokenFound = true;
      tokenIdentifierType = 'creditCardToken';
      tokenSourceLocation = 'customer';
      tokenMaskedValue = (tokenList[0].creditCardToken || tokenList[0].id || 'token').substring(0, 8) + '...';
      reusable = true;
      notes.push(`${tokenList.length} creditCardToken(s) retornados no endpoint /customers/${customerId}/creditCardTokens`);
    }
  } catch (err: any) {
    notes.push(`Endpoint /customers/${customerId}/creditCardTokens: ${err.message}`);
  }

  if (!tokenFound) {
    notes.push('Nenhum creditCardToken provider-safe exposto após checkout DETACHED.');
  }

  return {
    token_found: tokenFound,
    token_identifier_type: tokenIdentifierType,
    token_masked_value: tokenMaskedValue,
    token_source_location: tokenSourceLocation,
    reusable_server_to_server: reusable,
    token_audit_notes: notes.join(' | '),
  };
}

/**
 * Comando: INSPECT
 * Audita a liquidação do pagamento de ajuste e a disponibilidade de tokens reutilizáveis.
 */
export async function runInspect(): Promise<void> {
  console.log(`==================================================`);
  console.log(`PHASE 0B.1 — INSPECT DETACHED ADJUSTMENT & TOKEN AUDIT`);
  console.log(`==================================================`);

  const state = loadState();
  if (!state || !state.provider_checkout_id) {
    throw new Error('Nenhum estado de spike preparado encontrado. Execute prepare primeiro.');
  }

  console.log(`[INSPECT TARGET]`);
  console.log(`  Spike ID       : ${state.spike_id}`);
  console.log(`  Customer ID    : ${state.provider_customer_id}`);
  console.log(`  Checkout ID    : ${state.provider_checkout_id}`);
  console.log(`  Ext Reference  : ${state.external_reference}`);
  console.log(`  Valor Esperado : R$ ${TEST_ADJUSTMENT_VALUE.toFixed(2)} (${state.expected_adjustment_cents} cents)`);
  console.log(`  Iniciado Em    : ${state.started_at}`);

  // Busca pagamentos associados ao customer
  console.log(`\n[QUERY] Consultando pagamentos no Asaas Sandbox para o customer...`);
  const paymentsQuery = await asaasFetch(`/payments?customer=${encodeURIComponent(state.provider_customer_id)}&limit=10`);
  const payments: any[] = (paymentsQuery?.data || []).filter((p: any) => !p.deleted);

  console.log(`[QUERY] Total de pagamentos encontrados para o customer: ${payments.length}`);

  // Regra Estrita de Correlação: Exige checkoutSession == provider_checkout_id OU externalReference exata
  const stronglyCorrelatedPayments = payments.filter((p: any) => {
    const matchCheckout = p.checkoutSession && p.checkoutSession === state.provider_checkout_id;
    const matchRef = p.externalReference && p.externalReference === state.external_reference;
    return matchCheckout || matchRef;
  });

  let correlationStatus: AdjustmentCorrelationStatus = 'NOT_FOUND';
  let detectedPayment: any = null;

  if (stronglyCorrelatedPayments.length === 1) {
    correlationStatus = 'PASS';
    detectedPayment = stronglyCorrelatedPayments[0];
  } else if (stronglyCorrelatedPayments.length > 1) {
    correlationStatus = 'AMBIGUOUS';
    detectedPayment = stronglyCorrelatedPayments[0];
  } else {
    // Se não há evidência forte, mas há pagamentos com valor igual criados recentemente: reporta AMBIGUOUS (nunca PASS)
    const candidatesByValue = payments.filter((p: any) => {
      return Math.abs(Number(p.value) - TEST_ADJUSTMENT_VALUE) < 0.01;
    });
    if (candidatesByValue.length > 0) {
      correlationStatus = 'AMBIGUOUS';
    } else {
      correlationStatus = 'NOT_FOUND';
    }
  }

  // Avaliação de Valor, BillingType e Estado Financeiro
  let amountStatus: AdjustmentAmountStatus = 'FAIL';
  let paymentState: PaymentState = 'FAILED_OR_OTHER';

  if (detectedPayment) {
    const isAmountCorrect = Math.abs(Number(detectedPayment.value) - TEST_ADJUSTMENT_VALUE) < 0.01;
    amountStatus = isAmountCorrect ? 'PASS' : 'FAIL';

    if (detectedPayment.status === 'CONFIRMED') paymentState = 'CONFIRMED';
    else if (detectedPayment.status === 'RECEIVED') paymentState = 'RECEIVED';
    else if (detectedPayment.status === 'PENDING') paymentState = 'PENDING';
    else paymentState = 'FAILED_OR_OTHER';
  }

  // Provider Adjustment Capability
  let providerAdjustmentCapability: ProviderAdjustmentCapability = 'NOT_TESTED';
  if (correlationStatus === 'PASS' && amountStatus === 'PASS' && (paymentState === 'CONFIRMED' || paymentState === 'RECEIVED')) {
    providerAdjustmentCapability = 'PASS';
  } else if (paymentState === 'PENDING') {
    providerAdjustmentCapability = 'PENDING';
  } else if (correlationStatus === 'NOT_FOUND') {
    providerAdjustmentCapability = 'NOT_TESTED';
  } else {
    providerAdjustmentCapability = 'FAIL';
  }

  // Auditoria de Tokenização e Classificação de Estados
  let tokenAudit: TokenAuditDetails = {
    token_found: false,
    token_identifier_type: 'none',
    token_source_location: 'none',
    reusable_server_to_server: false,
    token_audit_notes: 'Auditoria de token não executada (pagamento ainda não liquidado).',
  };

  let tokenReuse: TokenReuseStatus = 'NOT_TESTED';
  let oneCheckoutPath: OneCheckoutPath = 'NOT_PROVEN';
  let nextStage: NextStage = 'BLOCKED_REVIEW_REQUIRED';

  if (providerAdjustmentCapability === 'PASS') {
    console.log(`\n[TOKEN AUDIT] Pagamento liquidado com sucesso. Auditando disponibilidade de creditCardToken...`);
    tokenAudit = await auditCustomerTokenization(state.provider_customer_id, detectedPayment?.id);

    if (tokenAudit.token_found && tokenAudit.reusable_server_to_server) {
      tokenReuse = 'AVAILABLE';
      oneCheckoutPath = 'POSSIBLE';
      nextStage = 'PHASE_0B_2A';
    } else {
      tokenReuse = 'NOT_EXPOSED';
      oneCheckoutPath = 'NOT_SUPPORTED_BY_OBSERVED_FLOW';
      nextStage = 'PHASE_0B_2B';
    }
  } else if (paymentState === 'PENDING') {
    tokenReuse = 'NOT_TESTED';
    oneCheckoutPath = 'NOT_PROVEN';
    nextStage = 'BLOCKED_REVIEW_REQUIRED';
  } else {
    tokenReuse = 'NOT_TESTED';
    oneCheckoutPath = 'NOT_PROVEN';
    nextStage = 'BLOCKED_REVIEW_REQUIRED';
  }

  const classification: AdjustmentAuditClassification = {
    provider_adjustment_capability: providerAdjustmentCapability,
    adjustment_correlation: correlationStatus,
    adjustment_amount: amountStatus,
    payment_state: paymentState,
    token_reuse: tokenReuse,
    one_checkout_path: oneCheckoutPath,
    next_stage: nextStage,
  };

  // Atualiza estado local
  const updatedState: SpikeAdjustmentState = {
    ...state,
    status: 'inspected',
    detected_payment_id: detectedPayment?.id || null,
    detected_payment_status: detectedPayment?.status || null,
    detected_payment_value: detectedPayment?.value || null,
    detected_payment_billing_type: detectedPayment?.billingType || null,
    detected_payment_checkout_session: detectedPayment?.checkoutSession || null,
    detected_payment_external_reference: detectedPayment?.externalReference || null,
    detected_payment_date_created: detectedPayment?.dateCreated || null,
    detected_payment_confirmed_date: detectedPayment?.confirmedDate || detectedPayment?.paymentDate || null,
    payments_found: payments.map((p: any) => ({
      id: p.id,
      status: p.status,
      value: p.value,
      billingType: p.billingType,
      checkoutSession: p.checkoutSession,
      externalReference: p.externalReference,
      dateCreated: p.dateCreated,
    })),
    token_audit: tokenAudit,
    audit_classification: classification,
    inspected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  saveState(updatedState);

  console.log(`\n==================================================`);
  console.log(`AUDIT CLASSIFICATION RESULTS`);
  console.log(`==================================================`);
  console.log(`Provider Adjustment Cap : ${classification.provider_adjustment_capability}`);
  console.log(`Adjustment Correlation  : ${classification.adjustment_correlation}`);
  console.log(`Adjustment Amount       : ${classification.adjustment_amount} (R$ ${detectedPayment?.value ?? 'N/A'})`);
  console.log(`Payment State           : ${classification.payment_state}`);
  console.log(`Token Reuse             : ${classification.token_reuse}`);
  console.log(`One Checkout Path       : ${classification.one_checkout_path}`);
  console.log(`Next Recommended Stage  : ${classification.next_stage}`);
  console.log(`Token Notes             : ${tokenAudit.token_audit_notes}`);
  console.log(`==================================================`);
}

/**
 * Comando: ARCHIVE
 * Arquiva o spike inspecionado permitindo novo prepare futuro sem deletar pagamentos confirmados.
 */
export async function runArchive(): Promise<void> {
  console.log(`==================================================`);
  console.log(`PHASE 0B.1 — ARCHIVE SPIKE STATE`);
  console.log(`==================================================`);

  const state = loadState();
  if (!state) {
    console.log(`Nenhum estado de spike ativo para arquivar.`);
    return;
  }

  state.status = 'archived';
  state.archived_at = new Date().toISOString();
  state.updated_at = new Date().toISOString();
  saveState(state);

  console.log(`[STATE ARCHIVED] Spike ${state.spike_id} arquivado com sucesso.`);
  console.log(`[NOTA] Pagamentos Sandbox confirmados foram preservados como evidência histórica.`);
}

/**
 * CLI Entrypoint
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'check';

  try {
    switch (command) {
      case 'check':
        await runCheck();
        break;
      case 'prepare':
        await runPrepare();
        break;
      case 'inspect':
        await runInspect();
        break;
      case 'audit-token':
        await runInspect();
        break;
      case 'archive':
        await runArchive();
        break;
      default:
        console.error(`Comando desconhecido: ${command}. Comandos válidos: check, prepare, inspect, audit-token, archive.`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n[ERRO CRÍTICO] ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
