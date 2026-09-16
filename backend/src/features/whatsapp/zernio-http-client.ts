import { requireZernioApiKey, ZERNIO_DEFAULT_BASE_URL } from '../../config/unifiedConfig';
import { AppError } from '../../middleware/error-handler';
import {
  ZernioCreateProfileDto,
  ZernioProfile,
  ZernioRequestOptions,
  EnsureProfileOptions,
  ZernioError,
  ZernioErrorKind,
  zernioCreateProfileResponseSchema,
  zernioGetProfileResponseSchema,
  zernioListProfilesResponseSchema,
} from './zernio.types';
import { ZernioProfileService } from './zernio-profile.service';

export interface ZernioHttpClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  defaultTimeoutMs?: number;
}

export interface ZernioHttpRequestOptions extends ZernioRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export class ZernioHttpClient {
  private readonly apiKeyOverride?: string;
  private readonly baseUrl: string;
  private readonly customFetchFn?: typeof fetch;
  private readonly defaultTimeoutMs: number;

  constructor(options?: ZernioHttpClientOptions) {
    this.apiKeyOverride = options?.apiKey;
    this.baseUrl = options?.baseUrl || ZERNIO_DEFAULT_BASE_URL;
    this.customFetchFn = options?.fetchFn;
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 15_000;
  }

  private get fetchFn(): typeof fetch {
    return this.customFetchFn || fetch;
  }

  private getApiKey(): string {
    return requireZernioApiKey(this.apiKeyOverride);
  }

  private buildUrl(
    endpoint: string,
    query?: Record<string, string | number | boolean | undefined>
  ): string {
    const cleanBase = this.baseUrl.replace(/\/+$/, '');
    const cleanPath = endpoint.replace(/^\/+/, '');
    const url = new URL(`${cleanBase}/${cleanPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private resolveEffectiveTimeoutMs(
    defaultTimeoutMs: number,
    options?: ZernioRequestOptions
  ): number {
    const minimumOperationalMs = 1_000;
    let effectiveTimeoutMs = defaultTimeoutMs;

    if (options?.timeoutMs !== undefined && options.timeoutMs > 0) {
      effectiveTimeoutMs = Math.min(effectiveTimeoutMs, options.timeoutMs);
    }

    if (options?.deadline) {
      const clamped = options.deadline.getClampedTimeoutMs(effectiveTimeoutMs, minimumOperationalMs);
      if (clamped <= 0) {
        throw new ZernioError({
          statusCode: 504,
          kind: 'TIMEOUT',
          message:
            'WHATSAPP_PROVIDER_TIMEOUT: Orçamento de execução esgotado antes do envio da requisição ao Zernio.',
          providerCode: 'INSUFFICIENT_EXECUTION_BUDGET',
        });
      }
      return clamped;
    }

    if (options?.deadlineAt !== undefined) {
      const remaining = options.deadlineAt - Date.now();
      if (remaining < minimumOperationalMs) {
        throw new ZernioError({
          statusCode: 504,
          kind: 'TIMEOUT',
          message:
            'WHATSAPP_PROVIDER_TIMEOUT: Orçamento de execução esgotado antes do envio da requisição ao Zernio.',
          providerCode: 'INSUFFICIENT_EXECUTION_BUDGET',
        });
      }
      return Math.min(effectiveTimeoutMs, remaining);
    }

    return effectiveTimeoutMs;
  }

  private async handleHttpError(res: Response): Promise<never> {
    const status = res.status;
    let retryAfterSeconds: number | undefined;
    const retryAfterHeader = res.headers.get('Retry-After');
    if (retryAfterHeader) {
      const parsed = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsed) && parsed >= 0) {
        retryAfterSeconds = parsed;
      }
    }

    let body: any = null;
    try {
      const text = await res.text();
      if (text && text.trim().length > 0) {
        body = JSON.parse(text);
      }
    } catch {
      // Non-JSON or empty response body
    }

    // Flat canonical envelope:
    // { error: "...", type: "...", code: "...", param: "...", platform: "...", details: ..., platformError: ... }
    // Fallback if legacy nested: { error: { message: "...", type: "...", code: "...", ... } }
    const providerType =
      typeof body?.type === 'string'
        ? body.type
        : typeof body?.error?.type === 'string'
        ? body.error.type
        : undefined;

    const providerCode =
      typeof body?.code === 'string'
        ? body.code
        : typeof body?.error?.code === 'string'
        ? body.error.code
        : undefined;

    const providerParam =
      typeof body?.param === 'string'
        ? body.param
        : typeof body?.error?.param === 'string'
        ? body.error.param
        : undefined;

    const providerPlatform =
      typeof body?.platform === 'string'
        ? body.platform
        : typeof body?.error?.platform === 'string'
        ? body.error.platform
        : undefined;

    const rawErrorMessage =
      typeof body?.error === 'string'
        ? body.error
        : typeof body?.error?.message === 'string'
        ? body.error.message
        : typeof body?.message === 'string'
        ? body.message
        : res.statusText || 'Erro retornado pela API Zernio';

    let safeDetails: Record<string, unknown> | undefined;
    const rawDetails = body?.details || body?.error?.details;
    if (rawDetails && typeof rawDetails === 'object' && !Array.isArray(rawDetails)) {
      safeDetails = {};
      if (typeof rawDetails.existingProfileId === 'string') {
        safeDetails.existingProfileId = rawDetails.existingProfileId;
      }
      if (typeof rawDetails.profileId === 'string') {
        safeDetails.existingProfileId = rawDetails.profileId;
      }
    }

    const rawPlatformError = body?.platformError;
    if (rawPlatformError && typeof rawPlatformError === 'object' && !Array.isArray(rawPlatformError)) {
      if (!safeDetails) safeDetails = {};
      safeDetails.platformError = {
        code: rawPlatformError.code,
        error_subcode: rawPlatformError.error_subcode,
        type: rawPlatformError.type,
      };
    }

    let kind: ZernioErrorKind;
    let safeMessage: string;

    if (providerType === 'platform_error') {
      kind = 'PLATFORM_ERROR';
      safeMessage = `ZERNIO_PLATFORM_ERROR: Falha na plataforma vinculada (${providerCode || providerPlatform || rawErrorMessage}).`;
    } else if (status === 409 || providerCode === 'profilenameconflict') {
      kind = 'CONFLICT';
      safeMessage = `ZERNIO_CONFLICT: Conflito de recurso no provedor Zernio (${providerCode || rawErrorMessage}).`;
    } else if (status === 402) {
      kind = 'PAYMENT_REQUIRED';
      safeMessage = 'ZERNIO_PAYMENT_REQUIRED: Provedor Zernio requer pagamento ou créditos de assinatura.';
    } else if (providerType === 'authentication_error' || providerType === 'permission_error' || status === 401 || status === 403) {
      kind = 'AUTH';
      safeMessage = `ZERNIO_AUTH_ERROR: ${rawErrorMessage}`;
    } else if (providerType === 'rate_limit_error' || status === 429) {
      kind = 'RATE_LIMITED';
      safeMessage = 'ZERNIO_RATE_LIMITED: Limite de requisições excedido no provedor Zernio.';
    } else if (providerType === 'not_found' || status === 404) {
      kind = 'NOT_FOUND';
      safeMessage = 'ZERNIO_NOT_FOUND: Recurso não encontrado no provedor Zernio.';
    } else if (providerType === 'invalid_request_error' || status === 400 || status === 422) {
      kind = 'VALIDATION';
      safeMessage = `ZERNIO_VALIDATION_ERROR: ${rawErrorMessage}`;
    } else if (providerType === 'api_error' || (status >= 500 && status <= 599)) {
      kind = 'TRANSIENT_PROVIDER_ERROR';
      safeMessage = `ZERNIO_PROVIDER_UNAVAILABLE: Falha no serviço Zernio (HTTP ${status}${providerCode ? ': ' + providerCode : ''}).`;
    } else {
      kind = 'UNKNOWN_PROVIDER_ERROR';
      safeMessage = `ZERNIO_PROVIDER_ERROR: Erro inesperado do provedor Zernio (HTTP ${status}).`;
    }

    throw new ZernioError({
      statusCode: status,
      kind,
      message: safeMessage,
      providerType,
      providerCode,
      providerParam,
      providerPlatform,
      retryAfterSeconds,
      safeDetails,
    });
  }

  async request<T>(endpoint: string, options?: ZernioHttpRequestOptions): Promise<T> {
    const apiKey = this.getApiKey();

    if (options?.signal?.aborted) {
      throw new ZernioError({
        statusCode: 504,
        kind: 'TIMEOUT',
        message: 'WHATSAPP_PROVIDER_TIMEOUT: Requisição abortada pelo chamador.',
        providerCode: 'ABORTED',
      });
    }

    const effectiveTimeoutMs = this.resolveEffectiveTimeoutMs(this.defaultTimeoutMs, options);
    const url = this.buildUrl(endpoint, options?.query);

    const controller = new AbortController();
    let signalListener: (() => void) | undefined;

    if (options?.signal) {
      signalListener = () => {
        controller.abort(options.signal!.reason);
      };
      options.signal.addEventListener('abort', signalListener, { once: true });
    }

    const timeoutId = setTimeout(() => {
      controller.abort('timeout');
    }, effectiveTimeoutMs);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    };

    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    let bodyPayload: string | undefined;
    if (options?.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      bodyPayload = JSON.stringify(options.body);
    }

    try {
      const res = await this.fetchFn(url, {
        method: options?.method || (bodyPayload ? 'POST' : 'GET'),
        headers,
        body: bodyPayload,
        signal: controller.signal,
      });

      if (!res.ok) {
        await this.handleHttpError(res);
      }

      if (res.status === 204 || res.headers.get('content-length') === '0') {
        return undefined as T;
      }

      const text = await res.text();
      if (!text || text.trim().length === 0) {
        return undefined as T;
      }

      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ZernioError({
          statusCode: 502,
          kind: 'TRANSIENT_PROVIDER_ERROR',
          message: 'ZERNIO_PROTOCOL_ERROR: Resposta do provedor Zernio contém JSON inválido.',
          providerCode: 'MALFORMED_JSON',
        });
      }
    } catch (err: any) {
      if (err instanceof AppError) {
        throw err;
      }
      if (err.name === 'AbortError' || err.code === 20 || controller.signal.aborted) {
        throw new ZernioError({
          statusCode: 504,
          kind: 'TIMEOUT',
          message: 'WHATSAPP_PROVIDER_TIMEOUT: Tempo limite esgotado na comunicação com o Zernio.',
          providerCode: 'TIMEOUT',
        });
      }
      throw new ZernioError({
        statusCode: 502,
        kind: 'TRANSIENT_PROVIDER_ERROR',
        message: `WHATSAPP_PROVIDER_UNAVAILABLE: Falha de rede ao contatar o Zernio (${err.message || 'Network error'}).`,
        providerCode: 'NETWORK_ERROR',
      });
    } finally {
      clearTimeout(timeoutId);
      if (options?.signal && signalListener) {
        options.signal.removeEventListener('abort', signalListener);
      }
    }
  }

  async createProfile(
    data: ZernioCreateProfileDto,
    options?: ZernioRequestOptions
  ): Promise<ZernioProfile> {
    const raw = await this.request<unknown>('profiles', {
      method: 'POST',
      body: {
        name: data.name,
        description: data.description,
        color: data.color,
      },
      ...options,
    });

    const parsed = zernioCreateProfileResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ZernioError({
        statusCode: 502,
        kind: 'TRANSIENT_PROVIDER_ERROR',
        message:
          'ZERNIO_PROTOCOL_ERROR: Resposta da criação de perfil malformada pelo provedor Zernio.',
        providerCode: 'ZERNIO_PROTOCOL_ERROR',
      });
    }

    return parsed.data.profile;
  }

  async getProfile(profileId: string, options?: ZernioRequestOptions): Promise<ZernioProfile> {
    const cleanId = profileId?.trim();
    if (!cleanId) {
      throw new AppError(400, 'ZERNIO_INVALID_PROFILE_ID: profileId não pode ser vazio.', {
        code: 'ZERNIO_INVALID_PROFILE_ID',
      });
    }

    const raw = await this.request<unknown>(`profiles/${encodeURIComponent(cleanId)}`, {
      method: 'GET',
      ...options,
    });

    const parsed = zernioGetProfileResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ZernioError({
        statusCode: 502,
        kind: 'TRANSIENT_PROVIDER_ERROR',
        message:
          'ZERNIO_PROTOCOL_ERROR: Resposta de consulta de perfil malformada pelo provedor Zernio.',
        providerCode: 'ZERNIO_PROTOCOL_ERROR',
      });
    }

    return parsed.data;
  }

  async findProfileByExactName(
    name: string,
    options?: ZernioRequestOptions
  ): Promise<ZernioProfile | null> {
    const cleanName = name?.trim();
    if (!cleanName) {
      throw new AppError(400, 'ZERNIO_INVALID_PROFILE_NAME: nome do perfil não pode ser vazio.', {
        code: 'ZERNIO_INVALID_PROFILE_NAME',
      });
    }

    const raw = await this.request<unknown>('profiles', {
      method: 'GET',
      query: { name: cleanName },
      ...options,
    });

    const parsed = zernioListProfilesResponseSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ZernioError({
        statusCode: 502,
        kind: 'TRANSIENT_PROVIDER_ERROR',
        message:
          'ZERNIO_PROTOCOL_ERROR: Resposta de listagem de perfis malformada pelo provedor Zernio.',
        providerCode: 'ZERNIO_PROTOCOL_ERROR',
      });
    }

    const matches = parsed.data.filter((p) => p.name === cleanName);
    if (matches.length === 0) {
      return null;
    }
    if (matches.length > 1) {
      throw new AppError(
        409,
        'ZERNIO_AMBIGUOUS_PROFILE_MATCH: Múltiplos perfis encontrados com o mesmo nome exato.',
        {
          code: 'ZERNIO_AMBIGUOUS_PROFILE_MATCH',
        }
      );
    }

    return matches[0];
  }

  async ensureProfileForConnection(
    connectionId: string,
    options?: EnsureProfileOptions
  ): Promise<ZernioProfile> {
    const service = new ZernioProfileService(this);
    return service.ensureProfileForConnection(connectionId, options);
  }
}
