import crypto from 'crypto';
import { z } from 'zod';
import { AppError } from '../../middleware/error-handler';
import { WhatsAppProviderRequestOptions, normalizeToE164 } from './whatsapp.types';
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

export const ZERNIO_HOSTED_ONBOARDING_SESSION_TTL_MS = 60 * 60 * 1000;

export const zernioAccountProfileIdSchema = z.union([
  z.string().min(1),
  z.object({
    _id: z.string().min(1),
    name: z.string().optional(),
  }),
]);

export const zernioAccountSchema = z
  .object({
    _id: z.string().min(1, 'Account _id é obrigatório'),
    profileId: zernioAccountProfileIdSchema,
    platform: z.string().min(1, 'platform é obrigatória'),
    status: z.string().optional(),
    username: z.string().optional(),
    phoneNumber: z.string().optional(),
    displayName: z.string().optional(),
    isActive: z.boolean().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough();

export type ZernioAccount = z.infer<typeof zernioAccountSchema>;

export function getZernioAccountProfileId(account: ZernioAccount): string {
  if (typeof account.profileId === 'string') {
    return account.profileId;
  }
  return account.profileId._id;
}

export const zernioListAccountsResponseSchema = z.union([
  z.array(zernioAccountSchema),
  z.object({ accounts: z.array(zernioAccountSchema) }).transform((val) => val.accounts),
  z.object({ data: z.array(zernioAccountSchema) }).transform((val) => val.data),
  z.object({ items: z.array(zernioAccountSchema) }).transform((val) => val.items),
]);

export const zernioPhoneDetailsSchema = z
  .object({
    display_phone_number: z.string().min(1, 'display_phone_number é obrigatório'),
    status: z.string().min(1, 'status é obrigatório'),
    platform_type: z.string().min(1, 'platform_type é obrigatório'),
    quality_rating: z.string().optional(),
    verified_name: z.string().optional(),
  })
  .passthrough();

export const zernioWhatsAppNumberInfoSchema = z
  .object({
    phone: zernioPhoneDetailsSchema,
    waba: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type ZernioWhatsAppNumberInfo = z.infer<typeof zernioWhatsAppNumberInfoSchema>;

export const zernioGetWhatsAppNumberInfoResponseSchema = z.union([
  zernioWhatsAppNumberInfoSchema,
  z.object({ data: zernioWhatsAppNumberInfoSchema }).transform((val) => val.data),
]);

export interface ZernioListAccountsParams {
  profileId: string;
  platform?: string;
  page: number;
  limit: number;
}

export const ZERNIO_KNOWN_CALLBACK_ERRORS = [
  'connection_cancelled',
  'session_expired',
  'payment_required',
  'one_whatsapp_per_profile',
  'whatsapp_number_already_connected',
  'whatsapp_number_pinned_to_profile',
  'whatsapp_error',
] as const;

export type ZernioKnownCallbackError = (typeof ZERNIO_KNOWN_CALLBACK_ERRORS)[number];

export function mapZernioCallbackError(rawError?: string | null): string {
  if (!rawError) return 'failed';
  const clean = rawError.trim().toLowerCase();
  if ((ZERNIO_KNOWN_CALLBACK_ERRORS as readonly string[]).includes(clean)) {
    return clean;
  }
  return 'provider_error';
}

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

// --- Webhook Schemas, Types & Event Records (Phase 7D2-D5) ---

export const zernioWebhookBaseEnvelopeSchema = z
  .object({
    id: z.string().min(1, 'Webhook id é obrigatório'),
    event: z.string().min(1, 'Webhook event é obrigatório'),
    timestamp: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

export type ZernioWebhookBaseEnvelope = z.infer<typeof zernioWebhookBaseEnvelopeSchema>;

export const zernioAccountConnectedWebhookSchema = zernioWebhookBaseEnvelopeSchema
  .extend({
    accountId: z.string().min(1).optional(),
    profileId: z
      .union([
        z.string().min(1),
        z.object({ _id: z.string().min(1) }).transform((p) => p._id),
      ])
      .optional(),
    platform: z.string().optional(),
    username: z.string().optional(),
    displayName: z.string().optional(),
    data: z
      .object({
        accountId: z.string().min(1).optional(),
        profileId: z
          .union([
            z.string().min(1),
            z.object({ _id: z.string().min(1) }).transform((p) => p._id),
          ])
          .optional(),
        platform: z.string().optional(),
        username: z.string().optional(),
        displayName: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .transform((val) => {
    const accountId = val.accountId || val.data?.accountId;
    const profileId = val.profileId || val.data?.profileId;
    const platform = val.platform || val.data?.platform;
    const username = val.username || val.data?.username;
    const displayName = val.displayName || val.data?.displayName;

    if (!accountId) {
      throw new Error('Missing accountId in account.connected event payload');
    }
    if (!profileId) {
      throw new Error('Missing profileId in account.connected event payload');
    }

    return {
      ...val,
      accountId,
      profileId,
      platform,
      username,
      displayName,
    };
  });

export type ZernioAccountConnectedWebhookEvent = z.infer<typeof zernioAccountConnectedWebhookSchema>;

export const zernioAccountDisconnectedWebhookSchema = zernioWebhookBaseEnvelopeSchema
  .extend({
    accountId: z.string().min(1).optional(),
    profileId: z
      .union([
        z.string().min(1),
        z.object({ _id: z.string().min(1) }).transform((p) => p._id),
      ])
      .optional(),
    disconnectionType: z.string().optional(),
    data: z
      .object({
        accountId: z.string().min(1).optional(),
        profileId: z
          .union([
            z.string().min(1),
            z.object({ _id: z.string().min(1) }).transform((p) => p._id),
          ])
          .optional(),
        disconnectionType: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .transform((val) => {
    const accountId = val.accountId || val.data?.accountId;
    const profileId = val.profileId || val.data?.profileId;
    const disconnectionType = val.disconnectionType || val.data?.disconnectionType;

    if (!accountId) {
      throw new Error('Missing accountId in account.disconnected event payload');
    }
    if (!profileId) {
      throw new Error('Missing profileId in account.disconnected event payload');
    }

    return {
      ...val,
      accountId,
      profileId,
      disconnectionType,
    };
  });

export type ZernioAccountDisconnectedWebhookEvent = z.infer<
  typeof zernioAccountDisconnectedWebhookSchema
>;

export type WhatsAppZernioWebhookStatus =
  | 'received'
  | 'processing'
  | 'processed'
  | 'ignored'
  | 'retryable_error'
  | 'terminal_error';

export interface WhatsAppZernioWebhookEventRecord {
  id: string; // zwh_${sha256(payload.id)}
  event_id: string; // payload.id
  event_type: string;
  status: WhatsAppZernioWebhookStatus;
  payload?: Record<string, unknown>;
  processing_attempt_count: number;
  lease_until: string | null;
  received_at: string;
  processed_at: string | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export function buildZernioWebhookEventDocId(eventId: string): string {
  const cleanId = eventId?.trim();
  if (!cleanId) {
    throw new AppError(400, 'eventId é obrigatório para gerar ID do documento de webhook.');
  }
  const hash = crypto.createHash('sha256').update(cleanId).digest('hex');
  return `zwh_${hash}`;
}

// --- D6: Outbound Messaging, Templates & Message Delivery Lifecycle ---

export function formatZernioParticipantId(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new AppError(400, 'Número de telefone deve estar no formato canônico E.164.', {
      code: 'INVALID_PHONE_E164',
    });
  }
  const cleaned = raw.trim().replace(/[\s\-\(\)]/g, '');
  const withPlus = cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  const canonical = normalizeToE164(withPlus);
  return canonical.replace(/\D/g, '');
}

export const zernioWhatsAppTemplateSchema = z
  .object({
    _id: z.string().optional(),
    id: z.string().optional(),
    name: z.string().min(1, 'Template name é obrigatório'),
    language: z.string().min(1, 'Template language é obrigatório'),
    status: z.string().min(1, 'Template status é obrigatório'),
    category: z.string().optional(),
    components: z.array(z.record(z.string(), z.unknown())).optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
  })
  .passthrough()
  .transform((val) => ({
    ...val,
    id: val.id || val._id || val.name,
  }));

export type ZernioWhatsAppTemplate = z.infer<typeof zernioWhatsAppTemplateSchema>;

export const zernioListWhatsAppTemplatesResponseSchema = z.union([
  z.array(zernioWhatsAppTemplateSchema),
  z.object({ templates: z.array(zernioWhatsAppTemplateSchema) }).transform((val) => val.templates),
  z.object({ data: z.array(zernioWhatsAppTemplateSchema) }).transform((val) => val.data),
  z.object({ items: z.array(zernioWhatsAppTemplateSchema) }).transform((val) => val.items),
]);

export interface ZernioListTemplatesParams {
  accountId: string;
  name?: string;
  language?: string;
  status?: string;
  limit?: number;
}

export interface ZernioCreateTemplateConversationParams {
  accountId: string;
  participantId: string;
  templateName: string;
  templateLanguage: string;
  templateParams?: unknown[] | Record<string, unknown>;
}

export const zernioCreateConversationResponseSchema = z
  .record(z.string(), z.unknown())
  .transform((val, ctx) => {
    const d = (val.data && typeof val.data === 'object' ? val.data : val) as Record<string, any>;
    const conversationObj = d.conversation && typeof d.conversation === 'object' ? d.conversation : null;
    const messageObj = d.message && typeof d.message === 'object' ? d.message : null;

    const conversationId =
      conversationObj?.providerConversationId ||
      d.providerConversationId ||
      conversationObj?.id ||
      conversationObj?._id ||
      d.conversationId ||
      d.id ||
      d._id;

    const messageId =
      messageObj?.providerMessageId ||
      d.providerMessageId ||
      messageObj?.id ||
      messageObj?._id ||
      d.messageId ||
      d.id ||
      d._id;

    if (!conversationId || !messageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Missing conversation or message ID in response',
      });
      return z.NEVER;
    }

    return {
      providerConversationId: String(conversationId),
      providerMessageId: String(messageId),
    };
  });

export type ZernioCreateConversationResponse = z.infer<typeof zernioCreateConversationResponseSchema>;

export interface ZernioSendMessageParams {
  conversationId: string;
  accountId: string;
  message: string;
  idempotencyKey?: string;
}

export const zernioSendMessageResponseSchema = z
  .record(z.string(), z.unknown())
  .transform((val, ctx) => {
    const d = (val.data && typeof val.data === 'object' ? val.data : val) as Record<string, any>;
    const messageObj = d.message && typeof d.message === 'object' ? d.message : null;

    const messageId =
      messageObj?.providerMessageId ||
      d.providerMessageId ||
      messageObj?.id ||
      messageObj?._id ||
      d.messageId ||
      d.id ||
      d._id;

    const conversationId =
      conversationObj_id_or_empty(d, messageObj);

    if (!messageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Missing message ID in send message response',
      });
      return z.NEVER;
    }

    return {
      providerMessageId: String(messageId),
      providerConversationId: String(conversationId),
    };
  });

function conversationObj_id_or_empty(d: Record<string, any>, messageObj: Record<string, any> | null): string {
  return (
    messageObj?.providerConversationId ||
    messageObj?.conversationId ||
    d.providerConversationId ||
    d.conversationId ||
    (d.conversation && typeof d.conversation === 'object'
      ? d.conversation.providerConversationId || d.conversation.id || d.conversation._id
      : '') ||
    ''
  );
}

export type ZernioSendMessageResponse = z.infer<typeof zernioSendMessageResponseSchema>;

export type WhatsAppOutboundDispatchStatus =
  | 'pending'
  | 'sending'
  | 'accepted'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'outcome_unknown';

export type WhatsAppOutboundDispatchPhase = 'prepared' | 'request_started' | 'completed';

export interface WhatsAppOutboundDispatchRecord {
  id: string; // logical dispatch ID
  organization_id: string;
  ministry_id: string | null;
  connection_id: string;
  provider: 'zernio';
  provider_account_id: string;
  recipient_e164: string;
  recipient_participant_id: string;
  dispatch_kind: 'proactive_template' | 'existing_conversation_text';
  template_name?: string | null;
  template_language?: string | null;
  template_params?: unknown[] | Record<string, unknown> | null;
  message_text?: string | null;
  request_fingerprint: string;
  provider_idempotency_key?: string | null;
  status: WhatsAppOutboundDispatchStatus;
  phase: WhatsAppOutboundDispatchPhase;
  provider_conversation_id?: string | null;
  provider_message_id?: string | null;
  send_started_at?: string | null;
  provider_accepted_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  failed_at?: string | null;
  last_error_type?: string | null;
  last_error_code?: string | null;
  outcome_unknown_reason?: string | null;
  created_at: string;
  updated_at: string;
}

export type WhatsAppZernioProviderMessageStatus =
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown';

export interface WhatsAppZernioProviderMessageRecord {
  id: string; // zmsg_${sha256(providerMessageId)}
  provider_message_id: string;
  provider_account_id: string;
  organization_id?: string | null;
  connection_id?: string | null;
  outbound_dispatch_id?: string | null;
  provider_conversation_id?: string | null;
  status: WhatsAppZernioProviderMessageStatus;
  sent_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  failed_at?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
  created_at: string;
  updated_at: string;
}

export function buildZernioProviderMessageDocId(providerMessageId: string): string {
  const cleanId = providerMessageId?.trim();
  if (!cleanId) {
    throw new AppError(400, 'providerMessageId é obrigatório para gerar ID do documento de mensagem.');
  }
  const hash = crypto.createHash('sha256').update(cleanId).digest('hex');
  return `zmsg_${hash}`;
}

export const zernioMessageWebhookSchema = zernioWebhookBaseEnvelopeSchema
  .extend({
    accountId: z.string().min(1).optional(),
    messageId: z.string().min(1).optional(),
    conversationId: z.string().optional(),
    error: z
      .object({
        code: z.union([z.string(), z.number()]).optional(),
        message: z.string().optional(),
        details: z.unknown().optional(),
        href: z.string().optional(),
      })
      .optional(),
    data: z
      .object({
        accountId: z.string().min(1).optional(),
        messageId: z.string().min(1).optional(),
        id: z.string().min(1).optional(),
        conversationId: z.string().optional(),
        error: z
          .object({
            code: z.union([z.string(), z.number()]).optional(),
            message: z.string().optional(),
            details: z.unknown().optional(),
            href: z.string().optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .transform((val) => {
    const accountId = val.accountId || val.data?.accountId;
    const messageId = val.messageId || val.data?.messageId || val.data?.id;
    const conversationId = val.conversationId || val.data?.conversationId;
    const errorObj = val.error || val.data?.error;

    if (!accountId) {
      throw new Error('Missing accountId in message webhook event payload');
    }
    if (!messageId) {
      throw new Error('Missing messageId in message webhook event payload');
    }

    return {
      ...val,
      accountId,
      messageId,
      conversationId,
      error: errorObj,
    };
  });

export type ZernioMessageWebhookEvent = z.infer<typeof zernioMessageWebhookSchema>;
