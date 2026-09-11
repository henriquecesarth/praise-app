import { config } from '../../config/unifiedConfig';
import { AppError } from '../../middleware/error-handler';
import {
  WhatsAppProvider,
  WhatsAppOAuthResult,
  WhatsAppAuthorizedPhoneNumber,
  WhatsAppPhoneNumberDetails,
} from './whatsapp.types';

export class MetaWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly configOverride?: {
      appId?: string;
      appSecret?: string;
      graphApiVersion?: string;
    }
  ) {}

  private get graphApiVersion(): string {
    return this.configOverride?.graphApiVersion || config.metaGraphApiVersion || 'v26.0';
  }

  private get appId(): string | undefined {
    return this.configOverride?.appId || config.metaAppId;
  }

  private get appSecret(): string | undefined {
    return this.configOverride?.appSecret || config.metaAppSecret;
  }

  private async handleGraphResponseError(res: Response, fallbackContext: string): Promise<never> {
    let metaError: {
      message?: string;
      type?: string;
      code?: number;
      error_subcode?: number;
      fbtrace_id?: string;
    } | undefined;

    try {
      const body = (await res.json()) as any;
      metaError = body?.error;
    } catch {
      // Non-JSON error body
    }

    const code = metaError?.code;
    const subcode = metaError?.error_subcode;
    const message = metaError?.message || res.statusText || 'Erro retornado pela Meta Graph API';

    // Tier 1: Canonical Error Code & Subcode Matching
    if (code === 190) {
      throw new AppError(401, `WHATSAPP_TOKEN_INVALID: ${message}`, {
        code: 'WHATSAPP_TOKEN_INVALID',
        metaCode: code,
        metaSubcode: subcode,
      });
    }
    if (code === 100) {
      throw new AppError(400, `WHATSAPP_INVALID_PARAMETER: ${message}`, {
        code: 'WHATSAPP_INVALID_PARAMETER',
        metaCode: code,
        metaSubcode: subcode,
      });
    }
    if (code === 131031) {
      throw new AppError(400, `WHATSAPP_PHONE_NOT_REGISTERED: ${message}`, {
        code: 'WHATSAPP_PHONE_NOT_REGISTERED',
        metaCode: code,
        metaSubcode: subcode,
      });
    }
    if (code === 131042) {
      throw new AppError(400, `WHATSAPP_WABA_INELIGIBLE: ${message}`, {
        code: 'WHATSAPP_WABA_INELIGIBLE',
        metaCode: code,
        metaSubcode: subcode,
      });
    }
    if (code === 131053) {
      throw new AppError(429, `WHATSAPP_RATE_LIMITED: ${message}`, {
        code: 'WHATSAPP_RATE_LIMITED',
        metaCode: code,
        metaSubcode: subcode,
      });
    }
    if (code === 133010) {
      throw new AppError(400, `WHATSAPP_PHONE_ATTACHED_TO_OTHER_WABA: ${message}`, {
        code: 'WHATSAPP_PHONE_ATTACHED_TO_OTHER_WABA',
        metaCode: code,
        metaSubcode: subcode,
      });
    }

    // Tier 2: Graph Error Type & HTTP Class Fallback
    if (metaError?.type === 'OAuthException' && (subcode === 463 || subcode === 467)) {
      throw new AppError(401, `WHATSAPP_TOKEN_INVALID: ${message}`, {
        code: 'WHATSAPP_TOKEN_INVALID',
        metaCode: code,
        metaSubcode: subcode,
      });
    }

    if (res.status === 401 || res.status === 403) {
      throw new AppError(res.status, `WHATSAPP_AUTH_ERROR: ${message}`, {
        code: 'WHATSAPP_AUTH_ERROR',
        metaCode: code,
        metaSubcode: subcode,
      });
    }

    if (res.status === 429) {
      throw new AppError(429, `WHATSAPP_RATE_LIMITED: ${message}`, {
        code: 'WHATSAPP_RATE_LIMITED',
        metaCode: code,
        metaSubcode: subcode,
      });
    }

    if (res.status >= 500) {
      throw new AppError(502, `WHATSAPP_PROVIDER_UNAVAILABLE: ${message}`, {
        code: 'WHATSAPP_PROVIDER_UNAVAILABLE',
        metaCode: code,
        metaSubcode: subcode,
      });
    }

    throw new AppError(res.status || 500, `${fallbackContext}: ${message}`, {
      code: 'WHATSAPP_PROVIDER_ERROR',
      metaCode: code,
      metaSubcode: subcode,
    });
  }

  async exchangeOAuthCode(code: string): Promise<WhatsAppOAuthResult> {
    if (!this.appId || !this.appSecret) {
      throw new AppError(
        500,
        'WHATSAPP_PROVIDER_CONFIG_INVALID_OR_MISSING: Meta App ID ou App Secret não configurado.',
        { code: 'WHATSAPP_PROVIDER_CONFIG_INVALID_OR_MISSING' }
      );
    }

    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/oauth/access_token`);
    url.searchParams.set('client_id', this.appId);
    url.searchParams.set('client_secret', this.appSecret);
    url.searchParams.set('code', code);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.handleGraphResponseError(res, 'WHATSAPP_OAUTH_EXCHANGE_FAILED');
      }

      const data = (await res.json()) as any;
      if (!data || !data.access_token) {
        throw new AppError(400, 'WHATSAPP_OAUTH_EXCHANGE_FAILED: Resposta da Meta sem access_token.', {
          code: 'WHATSAPP_OAUTH_EXCHANGE_FAILED',
        });
      }

      const expiresAt = data.expires_in
        ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
        : null;

      return {
        accessToken: data.access_token,
        tokenType: 'business_token',
        expiresAt,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err.name === 'AbortError') {
        throw new AppError(504, 'WHATSAPP_PROVIDER_TIMEOUT: Tempo limite esgotado na comunicação com Meta.', {
          code: 'WHATSAPP_PROVIDER_TIMEOUT',
        });
      }
      throw new AppError(502, `WHATSAPP_PROVIDER_ERROR: ${err.message || 'Falha na comunicação com Meta.'}`, {
        code: 'WHATSAPP_PROVIDER_ERROR',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async verifyMessagingAccountAccess(accessToken: string, wabaId: string): Promise<boolean> {
    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/${wabaId}`);
    url.searchParams.set('fields', 'id');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return false;
      }

      const data = (await res.json()) as any;
      return Boolean(data && data.id === wabaId);
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async listAuthorizedPhoneNumbers(
    accessToken: string,
    wabaId: string
  ): Promise<WhatsAppAuthorizedPhoneNumber[]> {
    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/${wabaId}/phone_numbers`);
    url.searchParams.set('fields', 'id,display_phone_number,verified_name');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.handleGraphResponseError(res, 'WHATSAPP_PHONE_NUMBERS_FETCH_FAILED');
      }

      const data = (await res.json()) as any;
      if (!data || !Array.isArray(data.data)) {
        return [];
      }

      return data.data.map((item: any) => ({
        id: String(item.id),
        displayPhoneNumber: item.display_phone_number,
        verifiedName: item.verified_name,
      }));
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err.name === 'AbortError') {
        throw new AppError(504, 'WHATSAPP_PROVIDER_TIMEOUT: Tempo limite esgotado ao buscar números na Meta.', {
          code: 'WHATSAPP_PROVIDER_TIMEOUT',
        });
      }
      throw new AppError(502, `WHATSAPP_PROVIDER_ERROR: ${err.message || 'Falha ao buscar números na Meta.'}`, {
        code: 'WHATSAPP_PROVIDER_ERROR',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async getPhoneNumberDetails(
    accessToken: string,
    phoneNumberId: string
  ): Promise<WhatsAppPhoneNumberDetails> {
    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}`);
    url.searchParams.set('fields', 'id,display_phone_number,verified_name,quality_rating,messaging_limit_tier');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.handleGraphResponseError(res, 'WHATSAPP_PHONE_DETAILS_FETCH_FAILED');
      }

      const data = (await res.json()) as any;
      return {
        displayPhoneNumber: data.display_phone_number || '',
        verifiedName: data.verified_name || '',
        qualityRating: data.quality_rating || 'UNKNOWN',
        messagingLimitTier: data.messaging_limit_tier,
      };
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err.name === 'AbortError') {
        throw new AppError(504, 'WHATSAPP_PROVIDER_TIMEOUT: Tempo limite esgotado ao buscar detalhes do telefone.', {
          code: 'WHATSAPP_PROVIDER_TIMEOUT',
        });
      }
      throw new AppError(502, `WHATSAPP_PROVIDER_ERROR: ${err.message || 'Falha ao buscar detalhes do telefone.'}`, {
        code: 'WHATSAPP_PROVIDER_ERROR',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async registerPhoneNumber(accessToken: string, phoneNumberId: string, pin: string): Promise<void> {
    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}/register`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          pin,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let message = 'Falha no registro do telefone na Meta.';
        try {
          const body = (await res.json()) as any;
          if (body?.error?.message) message = body.error.message;
        } catch {
          // ignore
        }
        throw new AppError(502, `PROVIDER_REGISTRATION_FAILED: ${message}`, {
          code: 'PROVIDER_REGISTRATION_FAILED',
        });
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err.name === 'AbortError') {
        throw new AppError(504, 'WHATSAPP_PROVIDER_TIMEOUT: Tempo limite esgotado no registro do telefone.', {
          code: 'WHATSAPP_PROVIDER_TIMEOUT',
        });
      }
      throw new AppError(502, `PROVIDER_REGISTRATION_FAILED: ${err.message || 'Erro no registro'}`, {
        code: 'PROVIDER_REGISTRATION_FAILED',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async subscribeMessagingAccountApps(accessToken: string, wabaId: string): Promise<void> {
    const url = new URL(`https://graph.facebook.com/${this.graphApiVersion}/${wabaId}/subscribed_apps`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        let message = 'Falha na assinatura de webhooks na Meta.';
        try {
          const body = (await res.json()) as any;
          if (body?.error?.message) message = body.error.message;
        } catch {
          // ignore
        }
        throw new AppError(502, `PROVIDER_SUBSCRIPTION_FAILED: ${message}`, {
          code: 'PROVIDER_SUBSCRIPTION_FAILED',
        });
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err.name === 'AbortError') {
        throw new AppError(504, 'WHATSAPP_PROVIDER_TIMEOUT: Tempo limite esgotado ao assinar webhooks.', {
          code: 'WHATSAPP_PROVIDER_TIMEOUT',
        });
      }
      throw new AppError(502, `PROVIDER_SUBSCRIPTION_FAILED: ${err.message || 'Erro na assinatura'}`, {
        code: 'PROVIDER_SUBSCRIPTION_FAILED',
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
