import crypto from 'crypto';
import { config } from '../../../../config/unifiedConfig';
import { PlanId, BillingInterval } from '../../../../config/plans.config';
import { BillingProviderName } from '../../billing.types';
import {
  BillingProvider,
  ParsedWebhookEvent,
  NormalizedWebhookEventType,
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
      // Modo mock/sandbox quando API key não estiver injetada
      return {
        providerCustomerId: `cus_mock_${params.ministryId.slice(0, 8)}`,
      };
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
      // Mock Sandbox Checkout URL
      const mockCheckoutId = `chk_mock_${Date.now()}_${params.planId}`;
      const mockUrl = `https://sandbox.asaas.com/checkoutSession/show/${mockCheckoutId}`;
      return {
        checkoutUrl: mockUrl,
        checkoutId: mockCheckoutId,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      };
    }

    try {
      const payload: any = {
        billingTypes: ['CREDIT_CARD'],
        chargeTypes: ['RECURRENT'],
        minutesToExpire: 60,
        externalReference,
        callback: {
          successUrl: params.successUrl || 'https://louvaio.com/ministerio/plano?status=success',
          cancelUrl: params.cancelUrl || 'https://louvaio.com/ministerio/plano?status=cancel',
          expiredUrl: params.cancelUrl || 'https://louvaio.com/ministerio/plano?status=expired',
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

      if (params.customerData?.name) {
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
   * Cancela assinatura no Asaas
   */
  async cancelSubscription(
    providerSubscriptionId: string,
    cancelAtPeriodEnd: boolean
  ): Promise<{ success: boolean; canceledAtPeriodEnd: boolean }> {
    if (!this.apiKey) {
      return { success: true, canceledAtPeriodEnd: cancelAtPeriodEnd };
    }

    // Se o cancelamento for imediato no Asaas:
    if (!cancelAtPeriodEnd) {
      try {
        const response = await fetch(`${this.apiUrl}/subscriptions/${providerSubscriptionId}`, {
          method: 'DELETE',
          headers: {
            access_token: this.apiKey,
          },
        });

        if (!response.ok && response.status !== 404) {
          const errBody = (await response.json().catch(() => ({}))) as any;
          const message = errBody?.errors?.[0]?.description || 'Erro ao cancelar assinatura no Asaas';
          throw new AppError(400, message);
        }
      } catch (err: any) {

        if (err instanceof AppError) throw err;
        throw new AppError(500, `Falha de comunicação ao cancelar assinatura Asaas: ${err.message}`);
      }
    }

    return { success: true, canceledAtPeriodEnd: cancelAtPeriodEnd };
  }

  /**
   * Reativa assinatura cancelada
   */
  async reactivateSubscription(_providerSubscriptionId: string): Promise<{ success: boolean }> {
    // No Asaas, uma assinatura marcada para não renovar pode ter a exclusão revertida ou mantida ativa
    return { success: true };
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
      return {
        status: 'ACTIVE',
        value: 34.9,
        cycle: 'MONTHLY',
        nextDueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      };
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
