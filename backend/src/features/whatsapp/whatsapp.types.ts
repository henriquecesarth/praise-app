import { z } from 'zod';
import { BillingAccessMode } from '../organizations/organization.types';
import { AppError } from '../../middleware/error-handler';

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
  provider: 'meta_cloud_api'; // Platform provider
  provider_waba_id: string | null; // Meta WABA ID; null prior to materialization
  provider_phone_number_id: string | null; // Meta Phone Number ID; null prior to materialization
  status: WhatsAppConnectionStatus; // Current lifecycle status
  status_reason: string | null; // Sanitized internal status reason code
  assigned_ministry_id: string | null; // Foreign key to ministries; null if unassigned or disconnected
  created_by_user_id: string; // Firebase Auth UID of creating Org Admin
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
  token_type: 'system_user' | 'user_token';
  expires_at: string | null; // ISO 8601 or null if permanent
  created_at: string; // ISO 8601 UTC
  updated_at: string; // ISO 8601 UTC
}

export interface WhatsAppProviderIdentityClaimRecord {
  id: string; // Deterministic claim ID: `claim_${provider}_${provider_phone_number_id}`
  provider: 'meta_cloud_api';
  provider_phone_number_id: string; // Meta Phone Number ID (foreign uniqueness key)
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
  provider: 'meta_cloud_api';
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
  status?: WhatsAppConnectionStatus;
  status_reason?: string | null;
  phone_number?: string | null;
  provider_waba_id?: string | null;
  provider_phone_number_id?: string | null;
  assigned_ministry_id?: string | null;
  pending_expires_at?: string | null;
  last_connected_at?: string | null;
  last_health_check_at?: string | null;
}
