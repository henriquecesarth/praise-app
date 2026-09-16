import { z } from 'zod';
import { AppError } from '../../middleware/error-handler';
import { WhatsAppProviderRequestOptions } from './whatsapp.types';
import { WhatsAppExecutionDeadline } from './whatsapp-execution-deadline';

// --- Zod Runtime Schemas ---

export const zernioProfileSchema = z.object({
  _id: z.string().min(1, 'Profile _id is required'),
  name: z.string().min(1, 'Profile name is required'),
  description: z.string().optional(),
  color: z.string().optional(),
  isDefault: z.boolean().optional(),
  createdAt: z.string().optional(),
});

export type ZernioProfile = z.infer<typeof zernioProfileSchema>;

export const zernioCreateProfileResponseSchema = z.object({
  message: z.string().optional(),
  profile: zernioProfileSchema,
});

export type ZernioCreateProfileResponse = z.infer<typeof zernioCreateProfileResponseSchema>;

export const zernioGetProfileResponseSchema = z.union([
  z
    .object({
      profile: zernioProfileSchema,
    })
    .transform((val) => val.profile),
  zernioProfileSchema,
]);

export const zernioListProfilesResponseSchema = z.union([
  z.array(zernioProfileSchema),
  z
    .object({ profiles: z.array(zernioProfileSchema) })
    .passthrough()
    .transform((val) => val.profiles),
  z
    .object({ data: z.array(zernioProfileSchema) })
    .passthrough()
    .transform((val) => val.data),
  z
    .object({ items: z.array(zernioProfileSchema) })
    .passthrough()
    .transform((val) => val.items),
]);

export const zernioConnectUrlResponseSchema = z.union([
  z.object({
    authUrl: z.string().min(1, 'authUrl não pode ser vazio'),
    state: z.string().optional(),
  }),
  z
    .object({
      data: z.object({
        authUrl: z.string().min(1, 'authUrl não pode ser vazio'),
        state: z.string().optional(),
      }),
    })
    .transform((val) => val.data),
]);

export type ZernioConnectUrlResponse = z.infer<typeof zernioConnectUrlResponseSchema>;

export function validateZernioAuthUrl(authUrl: string): void {
  if (!authUrl || typeof authUrl !== 'string') {
    throw new AppError(502, 'ZERNIO_PROTOCOL_ERROR: authUrl inválida retornada pelo Zernio.', {
      code: 'ZERNIO_PROTOCOL_ERROR',
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(authUrl);
  } catch {
    throw new AppError(502, 'ZERNIO_PROTOCOL_ERROR: authUrl não é uma URL válida.', {
      code: 'ZERNIO_PROTOCOL_ERROR',
    });
  }

  if (parsed.protocol !== 'https:') {
    throw new AppError(502, 'ZERNIO_PROTOCOL_ERROR: authUrl deve usar estritamente o protocolo HTTPS.', {
      code: 'ZERNIO_PROTOCOL_ERROR',
    });
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'zernio.com' && !hostname.endsWith('.zernio.com')) {
    throw new AppError(502, 'ZERNIO_PROTOCOL_ERROR: authUrl deve pertencer ao domínio zernio.com.', {
      code: 'ZERNIO_PROTOCOL_ERROR',
    });
  }
}

export const zernioAccountSchema = z
  .object({
    _id: z.string().min(1, 'Account _id é obrigatório'),
    profileId: z.string().min(1, 'profileId é obrigatório'),
    platform: z.string().min(1, 'platform é obrigatória'),
    status: z.string().min(1, 'status é obrigatório'),
    username: z.string().optional(),
    phoneNumber: z.string().optional(),
    displayName: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type ZernioAccount = z.infer<typeof zernioAccountSchema>;

export const zernioGetAccountResponseSchema = z.union([
  z
    .object({
      account: zernioAccountSchema,
    })
    .transform((val) => val.account),
  z
    .object({
      data: zernioAccountSchema,
    })
    .transform((val) => val.data),
  zernioAccountSchema,
]);

export const zernioWhatsAppNumberInfoSchema = z
  .object({
    phoneNumber: z.string().min(1, 'phoneNumber é obrigatório'),
    status: z.string().optional(),
    verifiedName: z.string().optional(),
    qualityRating: z.string().optional(),
    platform: z.string().optional(),
  })
  .passthrough();

export type ZernioWhatsAppNumberInfo = z.infer<typeof zernioWhatsAppNumberInfoSchema>;

export const zernioGetWhatsAppNumberInfoResponseSchema = z.union([
  z
    .object({
      whatsapp: zernioWhatsAppNumberInfoSchema,
    })
    .transform((val) => val.whatsapp),
  z
    .object({
      channel: zernioWhatsAppNumberInfoSchema,
    })
    .transform((val) => val.channel),
  z
    .object({
      data: zernioWhatsAppNumberInfoSchema,
    })
    .transform((val) => val.data),
  zernioWhatsAppNumberInfoSchema,
]);

// --- Request DTOs & Options ---

export interface ZernioConnectUrlParams {
  profileId: string;
  redirectUrl: string;
}

export interface ZernioCreateProfileDto {
  name: string;
  description?: string;
  color?: string;
}

export interface ZernioRequestOptions extends WhatsAppProviderRequestOptions {
  idempotencyKey?: string;
  deadline?: WhatsAppExecutionDeadline;
}

export interface EnsureProfileOptions extends ZernioRequestOptions {
  maxTimeoutRetries?: number;
}

// --- Error Model ---

export type ZernioErrorKind =
  | 'AUTH'
  | 'CONFIGURATION'
  | 'VALIDATION'
  | 'PAYMENT_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'PLATFORM_ERROR'
  | 'TRANSIENT_PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN_PROVIDER_ERROR';

export interface ZernioErrorOptions {
  statusCode: number;
  kind: ZernioErrorKind;
  message: string;
  providerType?: string;
  providerCode?: string;
  providerParam?: string;
  providerPlatform?: string;
  retryAfterSeconds?: number;
  safeDetails?: Record<string, unknown>;
}

export class ZernioError extends AppError {
  readonly kind: ZernioErrorKind;
  readonly providerType?: string;
  readonly providerCode?: string;
  readonly providerParam?: string;
  readonly providerPlatform?: string;
  readonly retryAfterSeconds?: number;
  readonly safeDetails?: Record<string, unknown>;

  constructor(options: ZernioErrorOptions) {
    super(options.statusCode, options.message, {
      kind: options.kind,
      providerType: options.providerType,
      providerCode: options.providerCode,
      providerParam: options.providerParam,
      providerPlatform: options.providerPlatform,
      retryAfterSeconds: options.retryAfterSeconds,
      ...(options.safeDetails || {}),
    });
    this.name = 'ZernioError';
    this.kind = options.kind;
    this.providerType = options.providerType;
    this.providerCode = options.providerCode;
    this.providerParam = options.providerParam;
    this.providerPlatform = options.providerPlatform;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.safeDetails = options.safeDetails;
    Object.setPrototypeOf(this, ZernioError.prototype);
  }
}

// --- Deterministic Identity Functions ---

export function buildZernioProfileName(connectionId: string): string {
  const cleanId = connectionId?.trim();
  if (!cleanId) {
    throw new AppError(400, 'ZERNIO_INVALID_CONNECTION_ID: connectionId não pode ser vazio.', {
      code: 'ZERNIO_INVALID_CONNECTION_ID',
    });
  }
  return `louvaio_wac_${cleanId}`;
}

export function buildZernioProfileIdempotencyKey(connectionId: string): string {
  const cleanId = connectionId?.trim();
  if (!cleanId) {
    throw new AppError(400, 'ZERNIO_INVALID_CONNECTION_ID: connectionId não pode ser vazio.', {
      code: 'ZERNIO_INVALID_CONNECTION_ID',
    });
  }
  return `profile_wac_${cleanId}`;
}
