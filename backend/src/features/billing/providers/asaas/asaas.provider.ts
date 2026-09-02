import crypto from 'crypto';
import { config } from '../../../../config/unifiedConfig';
import { PlanId, BillingInterval } from '../../../../config/plans.config';
import { BillingProviderName } from '../../billing.types';
import {
  BillingProvider,
  ParsedWebhookEvent,
  NormalizedWebhookEventType,
  ProviderPaymentRecord,
} from '../billing-provider.interface';
import { AppError } from '../../../../middleware/error-handler';
import { getCurrentBillingDate } from '../../../../utils/billing-date';


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
  }): Promise<{ checkoutUrl: string; checkoutId: string; expiresAt: string | null }> {
    const value = Number((params.amountCents / 100).toFixed(2));
    const cycle = params.interval === 'annual' ? 'YEARLY' : 'MONTHLY';
    const checkoutDescription = `LouvAIO - Plano ${params.planName} (${params.interval === 'annual' ? 'Anual com 10% OFF' : 'Mensal'})`;
    const nextDueDate = getCurrentBillingDate();

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

    const statusFilter = options?.status ? options.status : 'PENDING';
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
        if (statusFilter) {
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
          const rawValue = item.value !== undefined ? item.value : 0;
          const valueNumber = Number(rawValue);
          const amountCents = !isNaN(valueNumber) ? Math.round(valueNumber * 100) : 0;

          allPayments.push({
            id: item.id,
            subscriptionId: item.subscription || providerSubscriptionId,
            customerId: item.customer,
            status: item.status,
            dueDate: item.dueDate,
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
      const rawValue = item.value !== undefined ? item.value : 0;
      const valueNumber = Number(rawValue);
      const amountCents = !isNaN(valueNumber) ? Math.round(valueNumber * 100) : 0;

      return {
        id: item.id,
        subscriptionId: item.subscription,
        customerId: item.customer,
        status: item.status,
        dueDate: item.dueDate,
        amountCents,
        billingType: item.billingType,
        externalReference: item.externalReference,
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

    const receivedToken = headers['asaas-access-token'] ?? headers['asaas_access_token'];

    if (!receivedToken || typeof receivedToken !== 'string') {
      return false;
    }

    const receivedBuf = Buffer.from(receivedToken);
    const expectedBuf = Buffer.from(this.webhookToken);

    if (receivedBuf.length !== expectedBuf.length) {
      return false;
    }

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
    const valueNumber = rawValue !== undefined ? Number(rawValue) : undefined;
    const amountCents = valueNumber !== undefined && !isNaN(valueNumber) ? Math.round(valueNumber * 100) : undefined;

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
      paymentMethod: payment.billingType || subscription.billingType,
      dueDate: payment.dueDate || subscription.nextDueDate,
      paymentDate: payment.paymentDate || payment.confirmedDate,
      invoiceUrl: payment.invoiceUrl,
      status: payment.status || subscription.status || checkout.status,
    };
  }
}
