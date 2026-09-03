import crypto from 'crypto';
import { config } from '../../../../config/unifiedConfig';
import { PlanId, BillingInterval } from '../../../../config/plans.config';
import { BillingProviderName } from '../../billing.types';
import {
  BillingProvider,
  ParsedWebhookEvent,
  NormalizedWebhookEventType,
  ProviderPaymentRecord,
  ProviderErrorOutcome,
  CreateDetachedCheckoutParams,
  CreateDetachedCheckoutResult,
} from '../billing-provider.interface';
import { AppError } from '../../../../middleware/error-handler';
import { getCurrentBillingDate } from '../../../../utils/billing-date';
import { providerBrlDecimalToCents, centsToProviderBrlDecimal } from '../../billing-money.utils';

export const HTTP_CREATE_CHECKOUT_TIMEOUT_MS = 25_000;

export function buildOfficialCheckoutUrl(checkoutId: string, isSandbox: boolean): string {
  const host = isSandbox ? 'https://sandbox.asaas.com' : 'https://asaas.com';
  return `${host}/checkoutSession/show?id=${checkoutId}`;
}

export function validateAndResolveCheckoutUrl(
  data: { id?: string; link?: string },
  isSandbox: boolean
): string {
  if (!data?.id || typeof data.id !== 'string' || !data.id.trim()) {
    throw new AppError(500, 'Gateway Asaas não retornou ID de checkout na criação.', {
      code: 'PROVIDER_RESPONSE_MISSING_ID',
    });
  }

  const cleanId = data.id.trim();

  if (data.link && typeof data.link === 'string' && data.link.trim()) {
    try {
      const parsedUrl = new URL(data.link.trim());
      const expectedHosts = isSandbox
        ? ['sandbox.asaas.com']
        : ['asaas.com', 'www.asaas.com'];

      if (expectedHosts.includes(parsedUrl.hostname.toLowerCase())) {
        return data.link.trim();
      }

      throw new AppError(
        500,
        `Host inesperado no link de checkout retornado pelo Asaas ('${parsedUrl.hostname}'). Esperado: ${expectedHosts.join(' ou ')}.`,
        {
          code: 'INVALID_CHECKOUT_LINK_HOST',
          checkoutId: cleanId,
          unexpectedHost: parsedUrl.hostname,
        }
      );
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Link de checkout malformado retornado pelo Asaas ('${data.link}').`, {
        code: 'MALFORMED_CHECKOUT_LINK',
        checkoutId: cleanId,
      });
    }
  }

  return buildOfficialCheckoutUrl(cleanId, isSandbox);
}

export class AsaasBillingProvider implements BillingProvider {
  readonly name: BillingProviderName = 'asaas';

  private readonly apiUrl: string;
  private readonly apiKey?: string;
  private readonly webhookToken?: string;

  constructor(options?: { apiUrl?: string; apiKey?: string; webhookToken?: string }) {
    this.apiUrl = (options && 'apiUrl' in options ? (options.apiUrl || '') : config.asaas.apiUrl).replace(/\/+$/, '');
    this.apiKey = options && 'apiKey' in options ? options.apiKey : config.asaas.apiKey;
    this.webhookToken = options && 'webhookToken' in options ? options.webhookToken : config.asaas.webhookToken;
  }

  /**
   * Classifica se uma falha na chamada de criação de recurso é definitiva
   * (certeza de que nenhum recurso financeiro foi gerado no provedor) ou incerta (timeout, 5xx, perda de conexão).
   */
  classifyErrorOutcome(error: any): ProviderErrorOutcome {
    if (!error) {
      return 'DEFINITE_NO_RESOURCE_CREATED';
    }

    if (error instanceof AppError) {
      // Whitelist estrita e contratual oficial do endpoint POST /v3/checkouts do Asaas:
      // Apenas 400 (Bad Request - validação de payload/parâmetros) e 401 (Unauthorized - falha de autenticação/API Key)
      // possuem comprovação contratual de rejeição prévia à criação de recurso.
      //
      // Exigência de Error Origin: a resposta deve ser comprovadamente originária do gateway (isProviderResponse ou responseBody estruturado).
      //
      // Códigos como 403, 404, 422 (não documentado oficialmente no create checkout), 409, 429, outros 4xx e 5xx:
      // FAIL CLOSED como OUTCOME_UNCERTAIN (quarentena conservadora, zero blind retry).
      const deterministicStatusCodes = [400, 401];
      const statusCode = (error as any).statusCode || (error as any).status;
      const isStructuredProviderResponse = (error as any).isProviderResponse === true || !!(error as any).responseBody;

      if (isStructuredProviderResponse && deterministicStatusCodes.includes(statusCode)) {
        return 'DEFINITE_NO_RESOURCE_CREATED';
      }
      return 'OUTCOME_UNCERTAIN';
    }

    const message = (error.message || '').toLowerCase();
    const code = (error.code || '').toLowerCase();

    // Erros de rede, timeout, socket hangup ou abort são intrinsecamente incertos
    if (
      code === 'etimedout' ||
      code === 'econnreset' ||
      code === 'econnaborted' ||
      code === 'enetunreach' ||
      message.includes('timeout') ||
      message.includes('socket hang up') ||
      message.includes('abort')
    ) {
      return 'OUTCOME_UNCERTAIN';
    }

    return 'OUTCOME_UNCERTAIN';
  }

  /**
   * Cria ou localiza um cliente no Asaas
   */
  async createCustomer(params: {
    ministryId: string;
    ministryName: string;
    email?: string;
    taxId?: string;
    phone?: string;
  }): Promise<{ providerCustomerId: string }> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const response = await fetch(`${this.apiUrl}/customers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: this.apiKey,
        },
        body: JSON.stringify({
          name: params.ministryName || `Ministério ${params.ministryId}`,
          email: params.email,
          cpfCnpj: params.taxId,
          phone: params.phone,
          mobilePhone: params.phone,
          externalReference: params.ministryId,
          notificationDisabled: false,
        }),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const message = errBody?.errors?.[0]?.description || `Erro ao criar cliente no Asaas (HTTP ${response.status})`;
        throw new AppError(400, message);
      }

      const data = (await response.json()) as { id: string };
      return { providerCustomerId: data.id };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação com gateway Asaas: ${err.message}`);
    }
  }

  /**
   * Atualiza os dados de um cliente existente no Asaas
   */
  async updateCustomer(
    providerCustomerId: string,
    params: { name?: string; email?: string; phone?: string; taxId?: string }
  ): Promise<void> {
    if (!this.apiKey) return;
    try {
      const response = await fetch(`${this.apiUrl}/customers/${providerCustomerId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          access_token: this.apiKey,
        },
        body: JSON.stringify({
          ...(params.name ? { name: params.name } : {}),
          ...(params.email ? { email: params.email } : {}),
          ...(params.phone ? { phone: params.phone, mobilePhone: params.phone } : {}),
          ...(params.taxId ? { cpfCnpj: params.taxId } : {}),
        }),
      });
      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        console.warn(`[ASAAS PROVIDER] Falha ao atualizar customer ${providerCustomerId}:`, errBody);
      }
    } catch (err: any) {
      console.warn(`[ASAAS PROVIDER] Erro ao atualizar customer ${providerCustomerId}:`, err.message);
    }
  }

  /**
   * Localiza um cliente existente no Asaas pelo externalReference (ministryId)
   */
  async findCustomerByExternalReference(externalReference: string): Promise<{ providerCustomerId: string } | null> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const queryParams = new URLSearchParams({
        externalReference,
        limit: '5',
      });

      const response = await fetch(`${this.apiUrl}/customers?${queryParams.toString()}`, {
        headers: {
          access_token: this.apiKey,
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new AppError(500, `Falha ao buscar cliente por externalReference no Asaas (HTTP ${response.status})`);
      }

      const data = (await response.json()) as any;
      const items = Array.isArray(data.data) ? data.data : [];
      const validCustomer = items.find((c: any) => c.externalReference === externalReference && !c.deleted);

      if (validCustomer && validCustomer.id) {
        return { providerCustomerId: validCustomer.id };
      }

      return null;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao buscar cliente por externalReference no Asaas: ${err.message}`);
    }
  }

  /**
   * Localiza uma assinatura existente no Asaas pelo externalReference (checkoutIntentId)
   */
  async findSubscriptionByExternalReference(externalReference: string): Promise<{
    providerSubscriptionId: string;
    providerCustomerId?: string;
    status: string;
    valueCents: number;
    cycle?: string;
    nextDueDate?: string;
  } | null> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const queryParams = new URLSearchParams({
        externalReference,
        limit: '5',
      });

      const response = await fetch(`${this.apiUrl}/subscriptions?${queryParams.toString()}`, {
        headers: {
          access_token: this.apiKey,
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new AppError(500, `Falha ao buscar assinatura por externalReference no Asaas (HTTP ${response.status})`);
      }

      const data = (await response.json()) as any;
      const items = Array.isArray(data.data) ? data.data : [];
      const validSub = items.find((s: any) => s.externalReference === externalReference && s.status !== 'DELETED');

      if (validSub && validSub.id) {
        const valueCents = providerBrlDecimalToCents(validSub.value);
        return {
          providerSubscriptionId: validSub.id,
          providerCustomerId: validSub.customer,
          status: validSub.status,
          valueCents,
          cycle: validSub.cycle,
          nextDueDate: validSub.nextDueDate,
        };
      }

      return null;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao buscar assinatura por externalReference no Asaas: ${err.message}`);
    }
  }

  /**
   * Lista todas as cobranças geradas por uma sessão de checkout específica no Asaas.
   * Endpoint oficial Asaas: GET /v3/payments?checkoutSession={checkoutSessionId}
   */
  async listPaymentsByCheckoutSession(checkoutSessionId: string): Promise<Array<ProviderPaymentRecord>> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    const limit = 50;
    let offset = 0;
    let hasMore = true;
    const allPayments: ProviderPaymentRecord[] = [];

    try {
      while (hasMore) {
        const queryParams = new URLSearchParams({
          checkoutSession: checkoutSessionId,
          offset: String(offset),
          limit: String(limit),
        });

        const response = await fetch(`${this.apiUrl}/payments?${queryParams.toString()}`, {
          headers: {
            access_token: this.apiKey,
          },
        });

        if (!response.ok) {
          if (response.status === 404) return [];
          const errBody = (await response.json().catch(() => ({}))) as any;
          const message =
            errBody?.errors?.[0]?.description ||
            `Falha ao listar cobranças por checkoutSession no Asaas (HTTP ${response.status})`;
          throw new AppError(400, message);
        }

        const data = (await response.json()) as {
          hasMore?: boolean;
          data?: any[];
          totalCount?: number;
        };

        const items = Array.isArray(data.data) ? data.data : [];
        for (const item of items) {
          const amountCents = providerBrlDecimalToCents(item.value);

          allPayments.push({
            id: item.id,
            subscriptionId: item.subscription,
            customerId: item.customer,
            status: item.status,
            dueDate: item.dueDate,
            ...(item.originalDueDate ? { originalDueDate: item.originalDueDate } : {}),
            amountCents,
            billingType: item.billingType,
            externalReference: item.externalReference,
          });
        }

        hasMore = Boolean(data.hasMore && items.length > 0);
        offset += limit;
      }

      return allPayments;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao listar cobranças por checkoutSession no Asaas: ${err.message}`);
    }
  }

  /**
   * Cria uma sessão hospedada no Asaas Checkout (POST /v3/checkouts) para assinatura recorrente
   */
  async createCheckout(params: {
    ministryId: string;
    checkoutIntentId?: string;
    providerCustomerId?: string;
    planId: PlanId;
    planName: string;
    interval: BillingInterval;
    addonBlocks: number;
    amountCents: number;
    successUrl?: string;
    cancelUrl?: string;
    expiredUrl?: string;
    customerData?: {
      name?: string;
      email?: string;
      cpfCnpj?: string;
      phone?: string;
    };
    nextDueDate?: string;
  }): Promise<{ checkoutUrl: string; checkoutId: string; expiresAt: string | null }> {
    const value = centsToProviderBrlDecimal(params.amountCents);
    const cycle = params.interval === 'annual' ? 'YEARLY' : 'MONTHLY';
    const checkoutDescription = `LouvAIO - Plano ${params.planName} (${params.interval === 'annual' ? 'Anual com 10% OFF' : 'Mensal'})`;
    const nextDueDate = params.nextDueDate || getCurrentBillingDate();

    const externalReference = params.checkoutIntentId || `intent_${params.ministryId}_${Date.now()}`;

    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    if (!params.successUrl || params.successUrl.includes('localhost') || params.successUrl.includes('127.0.0.1')) {
      throw new AppError(500, 'URL de callback do Asaas inválida ou aponta para localhost.');
    }

    try {
      const payload: any = {
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        minutesToExpire: 60,
        externalReference,
        callback: {
          successUrl: params.successUrl,
          cancelUrl: params.cancelUrl || params.successUrl,
          expiredUrl: params.expiredUrl || params.cancelUrl || params.successUrl,
        },
        items: [
          {
            name: `Plano ${params.planName}`,
            description: checkoutDescription,
            quantity: 1,
            value,
          },
        ],
        subscription: {
          cycle,
          nextDueDate,
        },
      };

      if (params.providerCustomerId && params.providerCustomerId.trim()) {
        payload.customer = params.providerCustomerId.trim();
      } else if (params.customerData?.name) {
        payload.customerData = {
          name: params.customerData.name,
          email: params.customerData.email,
          cpfCnpj: params.customerData.cpfCnpj,
          phone: params.customerData.phone,
        };
      }

      const response = await fetch(`${this.apiUrl}/checkouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: this.apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const message = errBody?.errors?.[0]?.description || `Erro ao gerar checkout no Asaas (HTTP ${response.status})`;
        throw new AppError(400, message);
      }

      const data = (await response.json()) as { id: string; link?: string; url?: string };
      const checkoutUrl = data.link || data.url || `https://sandbox.asaas.com/checkoutSession/show/${data.id}`;

      return {
        checkoutUrl,
        checkoutId: data.id,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação com gateway Asaas: ${err.message}`);
    }
  }

  /**
   * Cria uma sessão hospedada no Asaas Checkout (POST /v3/checkouts) para cobrança avulsa (DETACHED),
   * utilizada exclusivamente para ajuste de ativação antecipada (Early Activation).
   * Não cria recorrência, não inclui bloco subscription, e não interfere na assinatura futura.
   */
  async createDetachedCheckout(
    params: CreateDetachedCheckoutParams
  ): Promise<CreateDetachedCheckoutResult> {
    const value = centsToProviderBrlDecimal(params.amountCents);
    const externalReference = params.checkoutIntentId;

    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    if (typeof params.minutesToExpire !== 'number' || params.minutesToExpire < 10 || params.minutesToExpire > 1440) {
      throw new AppError(
        400,
        `minutesToExpire deve estar entre 10 e 1440 minutos conforme contrato oficial do Asaas (POST /v3/checkouts). Recebido: ${params.minutesToExpire}`,
        { code: 'INVALID_CHECKOUT_TTL' }
      );
    }

    if (!params.successUrl || typeof params.successUrl !== 'string' || !params.successUrl.trim()) {
      throw new AppError(400, 'Callback inválido: successUrl é obrigatória.');
    }

    const successUrl = params.successUrl.trim();
    const cancelUrl = (params.cancelUrl && params.cancelUrl.trim()) || successUrl;
    const expiredUrl = (params.expiredUrl && params.expiredUrl.trim()) || cancelUrl;

    if (!cancelUrl || !expiredUrl) {
      throw new AppError(400, 'Callback inválido: cancelUrl e expiredUrl são obrigatórias.');
    }

    if (successUrl.includes('localhost') || successUrl.includes('127.0.0.1')) {
      throw new AppError(500, 'URL de callback do Asaas inválida ou aponta para localhost.');
    }

    try {
      const payload: any = {
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['DETACHED'],
        minutesToExpire: params.minutesToExpire,
        externalReference,
        callback: {
          successUrl,
          cancelUrl,
          expiredUrl,
        },
        items: [
          {
            name: 'Ativação Antecipada de Plano',
            description: params.description,
            quantity: 1,
            value,
          },
        ],
      };

      if (params.providerCustomerId && params.providerCustomerId.trim()) {
        payload.customer = params.providerCustomerId.trim();
      } else if (params.customerData?.name) {
        payload.customerData = {
          name: params.customerData.name,
          email: params.customerData.email,
          cpfCnpj: params.customerData.cpfCnpj,
          phone: params.customerData.phone,
        };
      }

      const isSandbox = this.apiUrl.includes('sandbox');
      const response = await fetch(`${this.apiUrl}/checkouts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          access_token: this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(HTTP_CREATE_CHECKOUT_TIMEOUT_MS),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const message =
          errBody?.errors?.[0]?.description ||
          `Falha ao criar checkout avulso no Asaas (HTTP ${response.status})`;
        const error = new AppError(400, message);
        (error as any).status = response.status;
        (error as any).statusCode = response.status;
        (error as any).responseBody = errBody;
        (error as any).isProviderResponse = true;
        throw error;
      }

      const data = (await response.json().catch(() => ({}))) as {
        id?: string;
        link?: string;
        expiresAt?: string;
      };

      const checkoutUrl = validateAndResolveCheckoutUrl(data, isSandbox);

      return {
        checkoutUrl,
        checkoutId: data.id!,
        expiresAt: data.expiresAt || null,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação com gateway Asaas: ${err.message}`);
    }
  }

  /**
   * Inativa assinatura no Asaas (PUT /v3/subscriptions/{id} com status: INACTIVE).
   * Impede a geração de novas cobranças recorrentes futuras, preservando cobranças
   * existentes pendentes/vencidas e o histórico financeiro da conta.
   */
  async inactivateSubscription(providerSubscriptionId: string): Promise<{ success: boolean }> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const response = await fetch(`${this.apiUrl}/subscriptions/${providerSubscriptionId}`, {
        method: 'PUT',
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: 'INACTIVE' }),
      });

      if (!response.ok && response.status !== 404) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const message = errBody?.errors?.[0]?.description || 'Erro ao inativar assinatura no Asaas';
        throw new AppError(400, message);
      }

      return { success: true };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao inativar assinatura Asaas: ${err.message}`);
    }
  }

  /**
   * Remove definitivamente uma assinatura no Asaas (DELETE /v3/subscriptions/{id}).
   * ATENÇÃO: Segundo a documentação do Asaas, DELETE remove a assinatura e também
   * exclui cobranças pendentes/overdue não pagas. Usar apenas quando remoção explícita for requerida.
   */
  async removeSubscription(providerSubscriptionId: string): Promise<{ success: boolean }> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const response = await fetch(`${this.apiUrl}/subscriptions/${providerSubscriptionId}`, {
        method: 'DELETE',
        headers: {
          access_token: this.apiKey,
        },
      });

      if (!response.ok && response.status !== 404) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const message = errBody?.errors?.[0]?.description || 'Erro ao remover assinatura no Asaas';
        throw new AppError(400, message);
      }

      return { success: true };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao remover assinatura Asaas: ${err.message}`);
    }
  }

  /**
   * Cancela/Interrompe a renovação da assinatura no Asaas.
   * Utiliza inativação via PUT status INACTIVE para cessar cobranças futuras sem destruir
   * cobranças existentes ou perdoar faturas pendentes.
   */
  async cancelSubscription(
    providerSubscriptionId: string,
    cancelAtPeriodEnd: boolean = true
  ): Promise<{ success: boolean; canceledAtPeriodEnd: boolean }> {
    await this.inactivateSubscription(providerSubscriptionId);
    return { success: true, canceledAtPeriodEnd: cancelAtPeriodEnd };
  }

  /**
   * Reativa uma assinatura inativada no Asaas (PUT /v3/subscriptions/{id} com status: ACTIVE e nextDueDate).
   */
  async reactivateSubscription(providerSubscriptionId: string, nextDueDate?: string): Promise<{ success: boolean }> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const bodyPayload: Record<string, any> = { status: 'ACTIVE' };
      if (nextDueDate) {
        bodyPayload.nextDueDate = nextDueDate;
      }

      const response = await fetch(`${this.apiUrl}/subscriptions/${providerSubscriptionId}`, {
        method: 'PUT',
        headers: {
          access_token: this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyPayload),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const message = errBody?.errors?.[0]?.description || 'Erro ao reativar assinatura no Asaas';
        throw new AppError(400, message);
      }

      return { success: true };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao reativar assinatura Asaas: ${err.message}`);
    }
  }

  /**
   * Lista todas as cobranças vinculadas a uma assinatura no Asaas tratando paginação.
   * Por padrão busca cobranças PENDING, mas aceita filtro opcional de status.
   */
  async listSubscriptionPayments(
    providerSubscriptionId: string,
    options?: { status?: string }
  ): Promise<Array<ProviderPaymentRecord>> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    const statusFilter = options?.status !== undefined ? options.status : 'ALL';
    const limit = 50;
    let offset = 0;
    let hasMore = true;
    const allPayments: ProviderPaymentRecord[] = [];

    try {
      while (hasMore) {
        const queryParams = new URLSearchParams({
          offset: String(offset),
          limit: String(limit),
        });
        if (statusFilter && statusFilter !== 'ALL') {
          queryParams.set('status', statusFilter);
        }

        const response = await fetch(
          `${this.apiUrl}/subscriptions/${providerSubscriptionId}/payments?${queryParams.toString()}`,
          {
            headers: {
              access_token: this.apiKey,
            },
          }
        );

        if (!response.ok) {
          if (response.status === 404) return [];
          const errBody = (await response.json().catch(() => ({}))) as any;
          const message = errBody?.errors?.[0]?.description || `Falha ao listar cobranças da assinatura Asaas (HTTP ${response.status})`;
          throw new AppError(400, message);
        }

        const data = (await response.json()) as {
          hasMore?: boolean;
          data?: any[];
          totalCount?: number;
        };

        const items = Array.isArray(data.data) ? data.data : [];
        for (const item of items) {
          const amountCents = providerBrlDecimalToCents(item.value);

          allPayments.push({
            id: item.id,
            subscriptionId: item.subscription || providerSubscriptionId,
            customerId: item.customer,
            status: item.status,
            dueDate: item.dueDate,
            ...(item.originalDueDate ? { originalDueDate: item.originalDueDate } : {}),
            amountCents,
            billingType: item.billingType,
            externalReference: item.externalReference,
            ...(item.paymentDate ? { paymentDate: item.paymentDate } : {}),
            ...(item.clientPaymentDate ? { clientPaymentDate: item.clientPaymentDate } : {}),
          });
        }

        hasMore = Boolean(data.hasMore && items.length > 0);
        offset += limit;
      }

      return allPayments;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao listar cobranças Asaas: ${err.message}`);
    }
  }

  /**
   * Remove individualmente uma cobrança PENDING no Asaas (DELETE /v3/payments/{id}).
   * Não utilizar para cobranças CONFIRMED/RECEIVED/OVERDUE.
   */
  async removePayment(providerPaymentId: string): Promise<{ success: boolean }> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const response = await fetch(`${this.apiUrl}/payments/${providerPaymentId}`, {
        method: 'DELETE',
        headers: {
          access_token: this.apiKey,
        },
      });

      if (!response.ok && response.status !== 404) {
        const errBody = (await response.json().catch(() => ({}))) as any;
        const message = errBody?.errors?.[0]?.description || `Erro ao remover cobrança no Asaas (HTTP ${response.status})`;
        throw new AppError(response.status >= 500 ? 500 : 400, message);
      }

      return { success: true };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao remover cobrança Asaas: ${err.message}`);
    }
  }

  /**
   * Consulta uma cobrança individual no Asaas para verificação de status e race condition.
   */
  async getPayment(providerPaymentId: string): Promise<ProviderPaymentRecord | null> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const response = await fetch(`${this.apiUrl}/payments/${providerPaymentId}`, {
        headers: {
          access_token: this.apiKey,
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new AppError(500, `Falha ao consultar cobrança Asaas (HTTP ${response.status})`);
      }

      const item = (await response.json()) as any;
      const amountCents = providerBrlDecimalToCents(item.value);

      return {
        id: item.id,
        subscriptionId: item.subscription,
        customerId: item.customer,
        status: item.status,
        dueDate: item.dueDate,
        ...(item.originalDueDate ? { originalDueDate: item.originalDueDate } : {}),
        amountCents,
        billingType: item.billingType,
        externalReference: item.externalReference,
        ...(item.paymentDate ? { paymentDate: item.paymentDate } : {}),
        ...(item.clientPaymentDate ? { clientPaymentDate: item.clientPaymentDate } : {}),
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação ao consultar cobrança Asaas: ${err.message}`);
    }
  }

  /**
   * Consulta os dados da assinatura diretamente no Asaas para reconciliação
   */
  async getSubscription(providerSubscriptionId: string): Promise<{
    status: string;
    value?: number;
    cycle?: string;
    nextDueDate?: string;
  } | null> {
    if (!this.apiKey) {
      throw new AppError(500, 'Gateway Asaas não configurado.');
    }

    try {
      const response = await fetch(`${this.apiUrl}/subscriptions/${providerSubscriptionId}`, {
        headers: {
          access_token: this.apiKey,
        },
      });

      if (!response.ok) {
        if (response.status === 404) return null;
        throw new AppError(500, `Falha ao consultar assinatura Asaas (HTTP ${response.status})`);
      }

      const data = (await response.json()) as any;
      return {
        status: data.status,
        value: data.value,
        cycle: data.cycle,
        nextDueDate: data.nextDueDate,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(500, `Falha de comunicação com gateway Asaas: ${err.message}`);
    }
  }

  /**
   * Valida o token de segurança no cabeçalho do webhook do Asaas usando comparação segura em tempo constante.
   * Regra estritamente fail-closed em todos os ambientes (development, production e test).
   */
  validateWebhookRequest(headers: Record<string, any>, _rawBody?: any): boolean {
    if (!this.webhookToken) {
      return false;
    }

    const headerKeys = Object.keys(headers || {});
    const tokenHeaderKey = headerKeys.find(
      (k) => k.toLowerCase() === 'asaas-access-token' || k.toLowerCase() === 'asaas_access_token'
    );
    const receivedToken = tokenHeaderKey ? headers[tokenHeaderKey] : (headers['asaas-access-token'] ?? headers['asaas_access_token']);

    if (!receivedToken || typeof receivedToken !== 'string') {
      console.warn('[ASAAS WEBHOOK AUTH] Cabeçalho de token de webhook ausente ou inválido.', {
        headerKeys: headerKeys.filter((k) => !k.toLowerCase().includes('secret')),
      });
      return false;
    }

    const cleanReceived = receivedToken.trim();
    const cleanExpected = this.webhookToken.trim();

    if (cleanReceived.length !== cleanExpected.length) {
      console.warn('[ASAAS WEBHOOK AUTH] Divergência no comprimento do token.', {
        receivedLength: cleanReceived.length,
        expectedLength: cleanExpected.length,
      });
      return false;
    }

    const receivedBuf = Buffer.from(cleanReceived);
    const expectedBuf = Buffer.from(cleanExpected);

    return crypto.timingSafeEqual(receivedBuf, expectedBuf);
  }


  /**
   * Transforma o evento bruto do Asaas em um ParsedWebhookEvent tipado.
   * Exige estritamente a presença de `body.id` e `body.event` como strings não-vazias.
   */
  parseWebhookEvent(body: any): ParsedWebhookEvent | null {
    if (!body || typeof body !== 'object') {
      return null;
    }

    const providerEventId = typeof body.id === 'string' ? body.id.trim() : '';
    const rawEvent = typeof body.event === 'string' ? body.event.trim() : '';

    if (!providerEventId || !rawEvent) {
      return null;
    }

    const payment = body.payment && typeof body.payment === 'object' ? body.payment : {};
    const subscription = body.subscription && typeof body.subscription === 'object' ? body.subscription : {};
    const checkout = body.checkout && typeof body.checkout === 'object' ? body.checkout : {};

    const providerCheckoutId =
      (typeof checkout.id === 'string' && checkout.id.trim() ? checkout.id.trim() : undefined) ||
      (typeof subscription.checkoutSession === 'string' && subscription.checkoutSession.trim() ? subscription.checkoutSession.trim() : undefined) ||
      (typeof payment.checkoutSession === 'string' && payment.checkoutSession.trim() ? payment.checkoutSession.trim() : undefined) ||
      (typeof body.checkoutSession === 'string' && body.checkoutSession.trim() ? body.checkoutSession.trim() : undefined) ||
      (typeof body.checkoutId === 'string' && body.checkoutId.trim() ? body.checkoutId.trim() : undefined);

    const providerPaymentId = typeof payment.id === 'string' && payment.id.trim() ? payment.id.trim() : undefined;

    const providerSubscriptionId =
      (typeof payment.subscription === 'string' && payment.subscription.trim() ? payment.subscription.trim() : undefined) ||
      (typeof subscription.id === 'string' && subscription.id.trim() ? subscription.id.trim() : undefined) ||
      (typeof body.subscriptionId === 'string' && body.subscriptionId.trim() ? body.subscriptionId.trim() : undefined);

    const providerCustomerId =
      (typeof payment.customer === 'string' && payment.customer.trim() ? payment.customer.trim() : undefined) ||
      (typeof subscription.customer === 'string' && subscription.customer.trim() ? subscription.customer.trim() : undefined) ||
      (typeof checkout.customer === 'string' && checkout.customer.trim() ? checkout.customer.trim() : undefined) ||
      (typeof body.customerId === 'string' && body.customerId.trim() ? body.customerId.trim() : undefined);

    const externalReference =
      (typeof checkout.externalReference === 'string' && checkout.externalReference.trim() ? checkout.externalReference.trim() : undefined) ||
      (typeof subscription.externalReference === 'string' && subscription.externalReference.trim() ? subscription.externalReference.trim() : undefined) ||
      (typeof payment.externalReference === 'string' && payment.externalReference.trim() ? payment.externalReference.trim() : undefined) ||
      (typeof body.externalReference === 'string' && body.externalReference.trim() ? body.externalReference.trim() : undefined);

    let eventType: NormalizedWebhookEventType = 'unknown';

    switch (rawEvent) {
      case 'CHECKOUT_CREATED':
        eventType = 'checkout_created';
        break;
      case 'CHECKOUT_PAID':
        eventType = 'checkout_paid';
        break;
      case 'CHECKOUT_CANCELED':
        eventType = 'checkout_canceled';
        break;
      case 'CHECKOUT_EXPIRED':
        eventType = 'checkout_expired';
        break;
      case 'SUBSCRIPTION_CREATED':
        eventType = 'subscription_created';
        break;
      case 'SUBSCRIPTION_UPDATED':
        eventType = 'subscription_updated';
        break;
      case 'SUBSCRIPTION_INACTIVATED':
        eventType = 'subscription_inactivated';
        break;
      case 'SUBSCRIPTION_DELETED':
        eventType = 'subscription_canceled';
        break;
      case 'PAYMENT_CONFIRMED':
      case 'PAYMENT_RECEIVED':
        eventType = 'payment_confirmed';
        break;
      case 'PAYMENT_OVERDUE':
        eventType = 'payment_overdue';
        break;
      case 'PAYMENT_DELETED':
      case 'PAYMENT_REFUNDED':
        eventType = 'payment_deleted';
        break;
      default:
        eventType = 'unknown';
    }

    const rawValue = payment.value !== undefined ? payment.value : subscription.value !== undefined ? subscription.value : undefined;
    const amountCents = rawValue !== undefined ? providerBrlDecimalToCents(rawValue) : undefined;

    let subscriptionCycle: BillingInterval | undefined;
    if (subscription.cycle === 'YEARLY') {
      subscriptionCycle = 'annual';
    } else if (subscription.cycle === 'MONTHLY') {
      subscriptionCycle = 'monthly';
    }

    const subRawValue = subscription.value !== undefined ? subscription.value : undefined;
    const subscriptionValueCents = subRawValue !== undefined ? providerBrlDecimalToCents(subRawValue) : undefined;
    const subscriptionNextDueDate = typeof subscription.nextDueDate === 'string' && subscription.nextDueDate.trim() ? subscription.nextDueDate.trim() : undefined;

    const confirmedDate =
      (typeof payment.confirmedDate === 'string' && payment.confirmedDate.trim() ? payment.confirmedDate.trim() : undefined) ||
      (typeof payment.paymentDate === 'string' && payment.paymentDate.trim() ? payment.paymentDate.trim() : undefined) ||
      (typeof payment.clientPaymentDate === 'string' && payment.clientPaymentDate.trim() ? payment.clientPaymentDate.trim() : undefined);

    const paymentDate =
      (typeof payment.paymentDate === 'string' && payment.paymentDate.trim() ? payment.paymentDate.trim() : undefined) ||
      (typeof payment.confirmedDate === 'string' && payment.confirmedDate.trim() ? payment.confirmedDate.trim() : undefined) ||
      (typeof payment.clientPaymentDate === 'string' && payment.clientPaymentDate.trim() ? payment.clientPaymentDate.trim() : undefined);

    return {
      providerEventId,
      eventType,
      rawEventType: rawEvent,
      providerCheckoutId,
      providerSubscriptionId,
      providerCustomerId,
      providerPaymentId,
      externalReference,
      amountCents,
      currency: 'BRL',
      paymentMethod: payment.billingType || subscription.billingType,
      dueDate: payment.dueDate || subscription.nextDueDate,
      ...(payment.originalDueDate ? { originalDueDate: payment.originalDueDate } : {}),
      paymentDate,
      confirmedDate,
      invoiceUrl: payment.invoiceUrl,
      status: payment.status || subscription.status || checkout.status,
      subscriptionCycle,
      subscriptionValueCents,
      subscriptionNextDueDate,
    };
  }
}
