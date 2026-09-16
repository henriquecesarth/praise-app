import { z } from 'zod';
import { BillingAccessMode } from '../organizations/organization.types';
import { AppError } from '../../middleware/error-handler';

export const whatsappSupportedProviderSchema = z.enum(['meta_cloud_api', 'zernio']);
export type WhatsAppSupportedProvider = z.infer<typeof whatsappSupportedProviderSchema>;
export type WhatsAppProviderType = WhatsAppSupportedProvider;

export function isWhatsAppSupportedProvider(val: unknown): val is WhatsAppSupportedProvider {
  return whatsappSupportedProviderSchema.safeParse(val).success;
}

export type WhatsAppConnectionStatus =
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disabled_by_user'
  | 'disconnected';

export interface WhatsAppConnectionRecord {
  id: string; // Document ID: `wac_${nanoid(20)}` or uuid
  organization_id: string; // Foreign key to organizations
  display_name: string; // Local label (1..100 chars)
  phone_number: string | null; // Canonical E.164 string; null prior to materialization
  provider: WhatsAppSupportedProvider; // Platform provider
  provider_profile_id?: string | null; // Zernio Profile ID (1:1 dedicated profile; D1/D3)
  provider_account_id?: string | null; // Zernio Account ID (D1/D3)
  provider_waba_id: string | null; // Meta WABA ID; null prior to materialization
  provider_phone_number_id: string | null; // Meta Phone Number ID; null prior to materialization
  status: WhatsAppConnectionStatus; // Current lifecycle status
  status_reason: string | null; // Sanitized internal status reason code
  assigned_ministry_id: string | null; // Foreign key to ministries; null if unassigned or disconnected
  created_by_user_id: string; // Firebase Auth UID of creating Org Admin
  current_onboarding_session_id?: string | null; // Pointer to active onboarding session (DEC-7D-33)
  pending_expires_at: string | null; // ISO 8601 UTC; 24h TTL for 'pending'; null otherwise
  last_connected_at: string | null; // ISO 8601 UTC timestamp of last active connection
  last_health_check_at: string | null; // ISO 8601 UTC timestamp of last health evaluation
  created_at: string; // ISO 8601 UTC timestamp
  updated_at: string; // ISO 8601 UTC timestamp
}

export interface WhatsAppConnectionSecretRecord {
  id: string; // matches connection_id
  connection_id: string; // foreign key to whatsapp_connections
  organization_id: string; // tenant boundary for cumulative anti-IDOR
  key_version: number; // encryption key version for rotation (1 initially)
  encrypted_access_token: string; // Base64 ciphertext
  iv: string; // Base64 IV (12 decoded bytes)
  auth_tag: string; // Base64 GCM Tag (16 decoded bytes)
  token_type: 'business_token' | 'system_user' | 'user_token';
  expires_at: string | null; // ISO 8601 or null if permanent
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
}

export interface WhatsAppProviderIdentityClaimRecord {
  id: string; // Deterministic claim ID: `claim_${provider}_${provider_phone_number_id}`
  provider: WhatsAppSupportedProvider;
  provider_phone_number_id: string; // Meta Phone Number ID or provider-specific uniqueness key
  organization_id: string; // Tenant context
  connection_id: string; // Foreign key to claiming whatsapp_connections record
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
}

export const CONFIG_CONSUMING_STATUSES: WhatsAppConnectionStatus[] = [
  'pending',
  'connecting',
  'connected',
  'error',
  'disabled_by_user',
];

export function isProviderIdentityMaterialized(
  conn: Partial<WhatsAppConnectionRecord>
): boolean {
  if (conn.provider === 'zernio') {
    return (
      conn.phone_number !== null &&
      conn.phone_number !== undefined &&
      conn.provider_profile_id !== null &&
      conn.provider_profile_id !== undefined &&
      conn.provider_account_id !== null &&
      conn.provider_account_id !== undefined
    );
  }
  return (
    conn.phone_number !== null &&
    conn.phone_number !== undefined &&
    conn.provider_waba_id !== null &&
    conn.provider_waba_id !== undefined &&
    conn.provider_phone_number_id !== null &&
    conn.provider_phone_number_id !== undefined
  );
}

export function getClaimId(provider: string, providerPhoneNumberId: string): string {
  return `claim_${provider}_${providerPhoneNumberId}`;
}

export function getZernioAccountClaimId(providerAccountId: string): string {
  const cleanId = providerAccountId?.trim();
  if (!cleanId) {
    throw new AppError(400, 'providerAccountId é obrigatório para construir o claim ID.', {
      code: 'INVALID_ACCOUNT_ID',
    });
  }
  if (cleanId.includes('/')) {
    throw new AppError(400, 'providerAccountId não pode conter barra ("/").', {
      code: 'INVALID_ACCOUNT_ID',
    });
  }
  return `claim_zernio_account_${cleanId}`;
}

export function getZernioPhoneClaimId(phoneNumber: string): string {
  const canonical = normalizeToE164(phoneNumber);
  return `claim_zernio_phone_${canonical}`;
}

export interface BindZernioProfileInput {
  organizationId: string;
  connectionId: string;
  providerProfileId: string;
}

export interface MaterializeZernioProviderIdentityInput {
  organizationId: string;
  connectionId: string;
  providerProfileId: string;
  providerAccountId: string;
  phoneNumber: string;
}

export interface WhatsAppMinistryAssignmentClaimRecord {
  id: string; // Deterministic claim ID: `assignment_claim_${orgId}_${ministryId}`
  organization_id: string; // Tenant context
  ministry_id: string; // Ministry foreign key (1:1 exclusive lock)
  connection_id: string; // Foreign key to claiming whatsapp_connections record
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
}

export function getMinistryAssignmentClaimId(orgId: string, ministryId: string): string {
  return `assignment_claim_${orgId}_${ministryId}`;
}

export interface WhatsAppConnectionDto {
  id: string;
  organizationId: string;
  displayName: string;
  phoneNumber: string | null;
  provider: WhatsAppSupportedProvider;
  status: WhatsAppConnectionStatus;
  statusReason: string | null;
  isOrganizationDefault: boolean;
  assignedMinistryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedWhatsAppConnectionsResponseDto {
  items: WhatsAppConnectionDto[];
  nextCursor: string | null;
}

export interface MinistryWhatsAppStatusDto {
  hasOrganization: boolean;
  organizationId: string | null;
  isConfigured: boolean;
  isConnected: boolean;
  source: 'exclusive' | 'default' | 'none';
  connectionId: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  connectionAccessMode: 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';
  canSendMessages: boolean;
}

export interface OrganizationWhatsAppCapacityUsageDto {
  organizationId: string;
  billingAnchorMinistryId: string;
  totalAllowedConnections: number;
  includedConnections: number;
  additionalConnections: number;
  configuredConnectionsCount: number;
  remainingCapacity: number;
  billingAccessMode: BillingAccessMode;
  connectionAccessMode: 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';
  canCreateConnection: boolean;
  canSendMessages: boolean;
}

export interface ResolvedWhatsAppConnectionResult {
  success: boolean;
  code?:
    | 'NO_ORGANIZATION'
    | 'WHATSAPP_SUSPENDED'
    | 'RESTRICTED_OVER_LIMIT'
    | 'NO_CONNECTION_AVAILABLE'
    | 'CONNECTION_NOT_ACTIVE';
  connection?: WhatsAppConnectionRecord;
  source?: 'exclusive' | 'default';
}

export const updateWhatsAppConnectionSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(1, 'Nome de exibição deve ter entre 1 e 100 caracteres.')
      .max(100, 'Nome de exibição deve ter entre 1 e 100 caracteres.')
      .optional(),
    isOrganizationDefault: z.boolean().optional(),
    assignedMinistryId: z.string().trim().min(1).nullable().optional(),
  })
  .refine(
    (data) =>
      !(
        data.isOrganizationDefault === true &&
        data.assignedMinistryId !== undefined &&
        data.assignedMinistryId !== null
      ),
    {
      message:
        'CANNOT_COMBINE_DEFAULT_AND_EXCLUSIVE_ASSIGNMENT: Não é possível definir a conexão como padrão da organização e atribuí-la a um ministério simultaneamente.',
      params: { code: 'CANNOT_COMBINE_DEFAULT_AND_EXCLUSIVE_ASSIGNMENT' },
    }
  );

export type UpdateWhatsAppConnectionInput = z.infer<typeof updateWhatsAppConnectionSchema>;

export const whatsappCursorPayloadSchema = z
  .object({
    createdAt: z
      .string()
      .trim()
      .min(1, 'createdAt não pode ser vazio.')
      .max(50)
      .refine((val) => !isNaN(Date.parse(val)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val), {
        message: 'createdAt deve ser um timestamp ISO válido.',
      }),
    id: z
      .string()
      .trim()
      .min(1, 'id não pode ser vazio.')
      .max(100, 'id excede o tamanho máximo.')
      .regex(/^[A-Za-z0-9_-]+$/, 'id contém caracteres inválidos.'),
  })
  .strict();

export function parseWhatsAppCursor(cursor: string): { createdAt: string; id: string } {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 512) {
    throw new AppError(400, 'Cursor de paginação inválido.', { code: 'INVALID_CURSOR' });
  }

  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new AppError(400, 'Cursor de paginação inválido.', { code: 'INVALID_CURSOR' });
  }

  let decodedStr: string;
  try {
    decodedStr = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new AppError(400, 'Cursor de paginação inválido.', { code: 'INVALID_CURSOR' });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(decodedStr);
  } catch {
    throw new AppError(400, 'Cursor de paginação inválido.', { code: 'INVALID_CURSOR' });
  }

  const result = whatsappCursorPayloadSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new AppError(400, 'Cursor de paginação inválido.', { code: 'INVALID_CURSOR' });
  }

  return result.data;
}

export const listWhatsAppConnectionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  cursor: z.string().optional(),
});

export type ListWhatsAppConnectionsQuery = z.infer<typeof listWhatsAppConnectionsQuerySchema>;

export interface CreateWhatsAppConnectionData {
  organization_id: string;
  display_name: string;
  created_by_user_id: string;
  provider?: WhatsAppSupportedProvider;
  provider_profile_id?: string | null;
  provider_account_id?: string | null;
  status?: WhatsAppConnectionStatus;
  status_reason?: string | null;
  phone_number?: string | null;
  provider_waba_id?: string | null;
  provider_phone_number_id?: string | null;
  assigned_ministry_id?: string | null;
  current_onboarding_session_id?: string | null;
  pending_expires_at?: string | null;
  last_connected_at?: string | null;
  last_health_check_at?: string | null;
}

export type WhatsAppOnboardingSessionStatus =
  | 'active'
  | 'credential_staged'
  | 'consumed'
  | 'expired'
  | 'failed';

export type WhatsAppProviderProgress =
  | 'none'
  | 'credential_staged'
  | 'assets_verified'
  | 'phone_registered'
  | 'waba_subscribed';

export interface WhatsAppOnboardingSessionRecord {
  id: string; // "wabs_" + random hex
  organization_id: string;
  connection_id: string; // FK to whatsapp_connections
  actor_user_id: string;
  state_nonce_hash: string; // SHA-256 hex
  status: WhatsAppOnboardingSessionStatus;
  provider_progress?: WhatsAppProviderProgress; // DEC-7D-38
  expires_at: string; // ISO 8601 UTC (15m logical boundary)
  retention_expires_at?: string; // ISO 8601 UTC (30d bounded physical retention, DEC-7D-32, DEC-7D-45)
  consumed_at: string | null;
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
}

export const startWhatsAppOnboardingSchema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  resumeConnectionId: z.string().trim().min(1).max(100).optional(), // Model B resume (DEC-7D-34)
  provider: whatsappSupportedProviderSchema.optional(),
});

export type StartWhatsAppOnboardingInput = z.infer<typeof startWhatsAppOnboardingSchema>;

export interface StartWhatsAppOnboardingResponseDto {
  sessionId: string;
  connectionId: string;
  stateNonce?: string; // raw 32-byte hex entropy returned strictly once for Meta embedded signup
  fbAppId?: string;
  configId?: string;
  expiresAt: string;
  mode?: 'start' | 'resume_clean' | 'resume_staged';
  providerProgress?: WhatsAppProviderProgress;
  provider?: WhatsAppSupportedProvider;
  authUrl?: string;
}

export const completeWhatsAppOnboardingSchema = z.object({
  sessionId: z.string().trim().min(1, 'sessionId é obrigatório.').max(100),
  stateNonce: z.string().trim().min(1, 'stateNonce é obrigatório.').max(200),
  code: z.string().trim().min(1, 'code de autorização é obrigatório.').max(1000),
  wabaId: z.string().trim().min(1, 'wabaId é obrigatório.').max(100),
  phoneNumberId: z.string().trim().min(1, 'phoneNumberId é obrigatório.').max(100),
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'PIN de registro deve conter exatamente 6 dígitos numéricos.')
    .optional(),
});

export type CompleteWhatsAppOnboardingInput = z.infer<typeof completeWhatsAppOnboardingSchema>;

export function normalizeToE164(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new AppError(400, 'Número de telefone deve estar no formato canônico E.164.', {
      code: 'INVALID_PHONE_E164',
    });
  }

  const trimmed = raw.trim();
  const cleaned = trimmed.replace(/[\s\-\(\)]/g, '');

  if (!/^\+[1-9]\d{1,14}$/.test(cleaned)) {
    throw new AppError(400, 'Número de telefone deve estar no formato canônico E.164.', {
      code: 'INVALID_PHONE_E164',
    });
  }

  return cleaned;
}

export interface WhatsAppOAuthResult {
  accessToken: string;
  tokenType: 'business_token' | 'system_user' | 'user_token';
  expiresAt: string | null;
}

export interface WhatsAppPhoneNumberDetails {
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  messagingLimitTier?: string;
}

export interface WhatsAppAuthorizedPhoneNumber {
  id: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

export interface WhatsAppSubscribedAppsProof {
  isSubscribed: boolean;
  proof: 'PROVEN_CLEAN' | 'STILL_SUBSCRIBED' | 'UNPROVEN';
  status?: 'PROVEN_SUBSCRIBED' | 'PROVEN_UNSUBSCRIBED' | 'UNPROVEN';
  pageCount?: number;
}

export interface WhatsAppProviderRequestOptions {
  timeoutMs?: number;
  deadlineAt?: number;
  signal?: AbortSignal;
}

export interface WhatsAppAccountRef {
  connectionId: string;
  provider: WhatsAppSupportedProvider;
  providerAccountId?: string | null;
  providerProfileId?: string | null;
  providerWabaId?: string | null;
  providerPhoneNumberId?: string | null;
}

export type WhatsAppNormalizedHealthStatus = 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN';

export interface WhatsAppAccountHealthResult {
  normalizedStatus: WhatsAppNormalizedHealthStatus;
  rawStatus?: string;
  displayPhoneNumber?: string;
  verifiedName?: string;
}

export interface WhatsAppProvider {
  exchangeOAuthCode(code: string): Promise<WhatsAppOAuthResult>;
  verifyMessagingAccountAccess(accessToken: string, wabaId: string): Promise<boolean>;
  listAuthorizedPhoneNumbers(accessToken: string, wabaId: string): Promise<WhatsAppAuthorizedPhoneNumber[]>;
  getPhoneNumberDetails(accessToken: string, phoneNumberId: string): Promise<WhatsAppPhoneNumberDetails>;
  registerPhoneNumber(accessToken: string, phoneNumberId: string, pin: string): Promise<void>;
  subscribeMessagingAccountApps(
    accessToken: string,
    wabaId: string,
    options?: WhatsAppProviderRequestOptions
  ): Promise<void>;
  unsubscribeMessagingAccountApps(
    accessToken: string,
    wabaId: string,
    options?: WhatsAppProviderRequestOptions
  ): Promise<{ success: boolean; errorStatus?: number; errorCode?: number }>;
  checkMessagingAccountSubscribedApps(
    accessToken: string,
    wabaId: string,
    options?: WhatsAppProviderRequestOptions
  ): Promise<WhatsAppSubscribedAppsProof>;
}

// ---------------------------------------------------------------------------
// Phase 7D1 R15 Distributed Coordination & Lifecycle Schemas
// ---------------------------------------------------------------------------

export interface WhatsAppUnresolvedRemoteMutation {
  operation_generation: number;
  operation: 'subscribe' | 'unsubscribe';
  dispatched_at: string; // ISO 8601 UTC
  status: 'unknown_outcome' | 'settled';
  connection_id: string;
  audit_note?: string;
}

export interface WhatsAppWabaLifecycleLockRecord {
  id: string; // "lock_meta_${providerWabaId}"
  provider: 'meta';
  provider_waba_id: string;
  operation_generation: number;
  desired_subscription_state: 'subscribed' | 'unsubscribed';
  operation_status: 'idle' | 'in_flight' | 'unknown_outcome';
  current_holder_id: string | null;
  lease_token: string | null;
  lease_expires_at: string | null; // ISO 8601 UTC (120s concurrency lease)
  provider_observed_state: 'subscribed' | 'unsubscribed' | 'unknown';
  provider_observed_at: string | null;
  provider_observed_generation: number | null;
  unresolved_remote_mutations: WhatsAppUnresolvedRemoteMutation[]; // Bounded FIFO ledger (max 20 entries, DEC-7D-65)
  last_settled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppWabaReconciliationJobRecord {
  id: string; // "recon_meta_${providerWabaId}"
  provider: 'meta';
  provider_waba_id: string;
  desired_state: 'subscribed' | 'unsubscribed';
  status: 'pending' | 'processing' | 'idle' | 'exhausted' | 'cancelled';
  attempt_count: number;
  next_attempt_at: string; // ISO 8601 UTC
  lease_token: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  consecutive_stable_observations: number;
  last_observed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppProviderCleanupJobRecord {
  id: string; // "cleanup_conn_${connectionId}"
  connection_id: string;
  organization_id: string;
  provider: 'meta_cloud_api' | 'meta';
  provider_waba_id: string;
  provider_phone_number_id: string | null;
  status: 'pending' | 'processing' | 'retry_wait' | 'succeeded' | 'exhausted' | 'cancelled' | 'abandoned';
  attempt_count: number;
  max_attempts: number; // default 5 (DEC-7D-41, DEC-7D-50)
  next_attempt_at: string; // ISO 8601 UTC
  lease_token: string | null;
  lease_expires_at: string | null; // 5-minute lease (DEC-7D-42)
  last_attempt_started_at: string | null;
  last_error_code: string | null;
  last_error_message?: string | null;
  last_error_at?: string | null;
  provider_cleanup_proof: 'proven' | 'unproven' | 'not_needed' | 'overridden' | null;
  waba_claim_generation?: number;
  override_reason?: string | null;
  manual_action_by: string | null; // e.g. "internal_operator"
  manual_action_at: string | null;
  manual_action_reason: string | null;
  retention_expires_at: string | null; // ISO 8601 UTC (30d after success/cancel/abandon; null on exhausted)
  completed_at?: string | null;
  created_at: string;
  updated_at: string;
}
