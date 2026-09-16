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

// --- Request DTOs & Options ---

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
