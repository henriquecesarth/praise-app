import {
  LOCAL_SONG_VERSION_PROVENANCE,
  Song,
  SongVersion,
  SongLink,
  Artist,
  Folder,
  Classification,
  RepertoireCounts,
  Ministry,
  MinistryInvite,
  PlansResponse,
  MinistrySubscriptionSummary,
  BillingInterval,
  CheckoutPreviewResult,
  CheckoutCreationResult,
  BillingTransactionRecord,
  SmartChord,
  SmartChordSongLink,
  SmartChordSongSummary,
  SmartChordRepertoireLink,
  SmartChordImportDraft,
  ImportWarning,
  Announcement,
  MemberUnavailability,
  CreateUnavailabilityPayload,
  UpdateUnavailabilityPayload,
  UnavailabilitiesResponse,
  CheckAvailabilityConflictsPayload,
  ScheduleConflictCheckResponse,
  ParticipantConflictResult,
  ParticipantConflictDetail,
  ScheduleCivilWindow,
  ConsolidatedAvailabilityItem,
  ConsolidatedAvailabilityResponse,
  BillingAccessMode,
  WhatsAppProvider,
  WhatsAppConnectionStatus,
  WhatsAppProviderProgress,
  WhatsAppCommercialState,
  WhatsAppConnectionAccessMode,
  WhatsAppConnectionDto,
  PaginatedWhatsAppConnectionsResponseDto,
  MinistryWhatsAppStatusDto,
  OrganizationWhatsAppCapacity,
  StartWhatsAppOnboardingResponseDto,
  StartWhatsAppOnboardingInput,
  CompleteWhatsAppOnboardingInput,
  UpdateWhatsAppConnectionInput,
  DisconnectWhatsAppConnectionResponseDto,
  UserPreferences,
  AuthenticatedUser,
} from './types';
import type {
  AccountDeletionBlocker,
  AccountDeletionBlockerCode,
  AccountDeletionJobRecord,
  AccountDeletionJobStatus,
  AccountDeletionPreflightResponse,
  AccountDeletionResult,
} from './types';
import { COMPLIANCE_CONFIG } from './config/compliance.config';
import type { VocalExercise } from './vocal-exercises';
import {
  MAX_MINISTRY_STEM_BYTES,
  type MinistryAudioMetadata,
  type MinistryAudioPage,
  type MinistryAudioPlayback,
  type MinistryAudioRecord,
  type MinistryAudioReservation,
  type MinistryAudioUpload,
  type MinistryAudioUploadGrant,
} from './audio/ministry-audio-contract';
import type { CanonicalStemId } from './audio/separation/demucs-onnx-separator';

export type {
  SmartChord,
  SmartChordSongLink,
  SmartChordSongSummary,
  SmartChordRepertoireLink,
  SmartChordImportDraft,
  ImportWarning,
  Announcement,
  MemberUnavailability,
  CreateUnavailabilityPayload,
  UpdateUnavailabilityPayload,
  UnavailabilitiesResponse,
  CheckAvailabilityConflictsPayload,
  ScheduleConflictCheckResponse,
  ParticipantConflictResult,
  ParticipantConflictDetail,
  ScheduleCivilWindow,
  ConsolidatedAvailabilityItem,
  ConsolidatedAvailabilityResponse,
  BillingAccessMode,
  WhatsAppProvider,
  WhatsAppConnectionStatus,
  WhatsAppProviderProgress,
  WhatsAppCommercialState,
  WhatsAppConnectionAccessMode,
  WhatsAppConnectionDto,
  PaginatedWhatsAppConnectionsResponseDto,
  MinistryWhatsAppStatusDto,
  OrganizationWhatsAppCapacity,
  StartWhatsAppOnboardingResponseDto,
  StartWhatsAppOnboardingInput,
  CompleteWhatsAppOnboardingInput,
  UpdateWhatsAppConnectionInput,
  DisconnectWhatsAppConnectionResponseDto,
  AccountDeletionBlocker,
  AccountDeletionBlockerCode,
  AccountDeletionJobRecord,
  AccountDeletionJobStatus,
  AccountDeletionPreflightResponse,
  AccountDeletionResult,
};

export function mapConsolidatedAvailabilityItemFromApi(item: any): ConsolidatedAvailabilityItem {
  return {
    id: item?.id ?? '',
    ministryId: item?.ministryId ?? item?.ministry_id ?? '',
    memberId: item?.memberId ?? item?.member_id ?? '',
    memberName: item?.memberName ?? item?.member_name ?? 'Integrante',
    startDate: item?.startDate ?? item?.start_date ?? '',
    endDate: item?.endDate ?? item?.end_date ?? '',
    startTime: item?.startTime ?? item?.start_time ?? null,
    endTime: item?.endTime ?? item?.end_time ?? null,
    allDay: Boolean(item?.allDay ?? item?.all_day),
    startsAt: item?.startsAt ?? item?.starts_at ?? '',
    endsAt: item?.endsAt ?? item?.ends_at ?? '',
  };
}

export function mapUnavailabilityFromApi(item: any): MemberUnavailability {
  return {
    id: item?.id ?? '',
    ministryId: item?.ministryId ?? item?.ministry_id ?? '',
    memberId: item?.memberId ?? item?.member_id ?? '',
    startDate: item?.startDate ?? item?.start_date ?? '',
    endDate: item?.endDate ?? item?.end_date ?? '',
    startTime: item?.startTime ?? item?.start_time ?? null,
    endTime: item?.endTime ?? item?.end_time ?? null,
    allDay: Boolean(item?.allDay ?? item?.all_day),
    startsAt: item?.startsAt ?? item?.starts_at ?? '',
    endsAt: item?.endsAt ?? item?.ends_at ?? '',
    reason: item?.reason ?? null,
    createdAt: item?.createdAt ?? item?.created_at ?? '',
    updatedAt: item?.updatedAt ?? item?.updated_at ?? '',
  };
}

export function mapScheduleConflictResponseFromApi(data: any): ScheduleConflictCheckResponse {
  return {
    scheduleWindow: {
      startsAt: data?.scheduleWindow?.startsAt ?? '',
      endsAt: data?.scheduleWindow?.endsAt ?? '',
      durationMinutes: typeof data?.scheduleWindow?.durationMinutes === 'number' ? data.scheduleWindow.durationMinutes : 120,
      durationSource: data?.scheduleWindow?.durationSource === 'explicit' ? 'explicit' : 'legacy_fallback',
    },
    conflicts: Array.isArray(data?.conflicts)
      ? data.conflicts.map((c: any) => ({
          participantId: c?.participantId ?? '',
          memberId: c?.memberId ?? null,
          hasConflict: Boolean(c?.hasConflict),
          unavailabilities: Array.isArray(c?.unavailabilities)
            ? c.unavailabilities.map((u: any) => ({
                id: u?.id ?? '',
                startsAt: u?.startsAt ?? '',
                endsAt: u?.endsAt ?? '',
                allDay: Boolean(u?.allDay),
              }))
            : [],
        }))
      : [],
    unresolvedParticipantIds: Array.isArray(data?.unresolvedParticipantIds)
      ? data.unresolvedParticipantIds
      : [],
  };
}

export function mapAnnouncementFromApi(item: any): Announcement {
  return {
    id: item?.id ?? '',
    ministryId: item?.ministry_id ?? item?.ministryId ?? '',
    title: item?.title ?? '',
    content: item?.content ?? '',
    author: item?.author ?? item?.author_name ?? item?.authorName ?? 'Liderança',
    important: Boolean(item?.important),
    createdBy: item?.created_by ?? item?.createdBy ?? '',
    createdAt: item?.created_at ?? item?.createdAt ?? '',
    updatedAt: item?.updated_at ?? item?.updatedAt ?? '',
  };
}

export function mapSmartChordSongLinkFromApi(raw: any): SmartChordSongLink {
  const rawStatus = raw?.link_status ?? raw?.linkStatus;
  const linkStatus = rawStatus === 'pending_classification' ? 'pending_classification' : 'active';
  const rawReason = raw?.pending_reason ?? raw?.pendingReason;
  const pendingReason =
    linkStatus === 'pending_classification'
      ? (rawReason === 'version_removed' ? 'version_removed' : 'legacy_ambiguous')
      : null;

  return {
    id: raw?.id ?? '',
    userId: raw?.user_id ?? raw?.userId ?? '',
    smartChordId: raw?.smart_chord_id ?? raw?.smartChordId ?? '',
    ministryId: raw?.ministry_id ?? raw?.ministryId ?? '',
    songId: raw?.song_id ?? raw?.songId ?? '',
    versionId: raw?.version_id ?? raw?.versionId ?? null,
    linkStatus,
    pendingReason,
    createdAt: raw?.created_at ?? raw?.createdAt ?? '',
    updatedAt: raw?.updated_at ?? raw?.updatedAt ?? '',
  };
}

export function mapSmartChordFromApi(item: any): SmartChord {
  return {
    id: item?.id ?? '',
    userId: item?.user_id ?? item?.userId ?? '',
    title: item?.title ?? '',
    artistId: item?.artist_id ?? item?.artistId ?? null,
    artistName: item?.artist_name ?? item?.artistName ?? null,
    songId: item?.song_id ?? item?.songId ?? null,
    originalKey: item?.original_key ?? item?.originalKey ?? 'C',
    ...(item?.source_url != null ? { sourceUrl: item.source_url } : {}),
    ...(item?.displayed_key != null ? { displayedKey: item.displayed_key } : {}),
    ...(item?.capo != null ? { capo: item.capo } : {}),
    content: item?.content ?? '',
    createdAt: item?.created_at ?? item?.createdAt ?? '',
    updatedAt: item?.updated_at ?? item?.updatedAt ?? '',
    artist: item?.artist ? { id: item.artist.id, name: item.artist.name } : null,
    song: item?.song ? { id: item.song.id, title: item.song.title } : null,
    ...(item?.repertoire_link ? { repertoireLink: mapSmartChordSongLinkFromApi(item.repertoire_link) } : {}),
  };
}

export function mapWhatsAppConnectionFromApi(item: any): WhatsAppConnectionDto {
  return {
    id: item?.id ?? '',
    organizationId: item?.organizationId ?? item?.organization_id ?? '',
    displayName: item?.displayName ?? item?.display_name ?? '',
    phoneNumber: item?.phoneNumber ?? item?.phone_number ?? null,
    provider: (item?.provider ?? 'meta_cloud_api') as WhatsAppProvider,
    status: (item?.status ?? 'disconnected') as WhatsAppConnectionStatus,
    statusReason: item?.statusReason ?? item?.status_reason ?? null,
    isOrganizationDefault: Boolean(item?.isOrganizationDefault ?? item?.is_organization_default),
    assignedMinistryId: item?.assignedMinistryId ?? item?.assigned_ministry_id ?? null,
    createdAt: item?.createdAt ?? item?.created_at ?? '',
    updatedAt: item?.updatedAt ?? item?.updated_at ?? '',
  };
}

export function mapPaginatedWhatsAppConnectionsFromApi(data: any): PaginatedWhatsAppConnectionsResponseDto {
  return {
    items: Array.isArray(data?.items) ? data.items.map(mapWhatsAppConnectionFromApi) : [],
    nextCursor: data?.nextCursor ?? data?.next_cursor ?? null,
  };
}

export function mapOrganizationWhatsAppCapacityFromApi(data: any): OrganizationWhatsAppCapacity {
  return {
    organizationId: data?.organizationId ?? data?.organization_id ?? '',
    billingAnchorMinistryId: data?.billingAnchorMinistryId ?? data?.billing_anchor_ministry_id ?? '',
    totalAllowedConnections: Number(data?.totalAllowedConnections ?? data?.total_allowed_connections ?? 0),
    includedConnections: Number(data?.includedConnections ?? data?.included_connections ?? 0),
    additionalConnections: Number(data?.additionalConnections ?? data?.additional_connections ?? 0),
    configuredConnectionsCount: Number(data?.configuredConnectionsCount ?? data?.configured_connections_count ?? 0),
    remainingCapacity: Number(data?.remainingCapacity ?? data?.remaining_capacity ?? 0),
    commercialState: (data?.commercialState ?? data?.commercial_state ?? 'plan_excluded') as WhatsAppCommercialState,
    canSendMessages: Boolean(data?.canSendMessages ?? data?.can_send_messages),
    canCreateConnection: Boolean(data?.canCreateConnection ?? data?.can_create_connection),
    canResumeAuthorizedOnboarding: Boolean(data?.canResumeAuthorizedOnboarding ?? data?.can_resume_authorized_onboarding),
    restrictionReason: data?.restrictionReason ?? data?.restriction_reason ?? null,
    gracePeriodExpiresBillingDate: data?.gracePeriodExpiresBillingDate ?? data?.grace_period_expires_billing_date ?? null,
    billingAccessMode: (data?.billingAccessMode ?? data?.billing_access_mode ?? 'suspended') as BillingAccessMode,
    connectionAccessMode: (data?.connectionAccessMode ?? data?.connection_access_mode ?? 'suspended') as WhatsAppConnectionAccessMode,
  };
}

export function mapMinistryWhatsAppStatusFromApi(data: any): MinistryWhatsAppStatusDto {
  return {
    hasOrganization: Boolean(data?.hasOrganization ?? data?.has_organization),
    organizationId: data?.organizationId ?? data?.organization_id ?? null,
    isConfigured: Boolean(data?.isConfigured ?? data?.is_configured),
    isConnected: Boolean(data?.isConnected ?? data?.is_connected),
    source: (data?.source ?? 'none') as 'exclusive' | 'default' | 'none',
    connectionId: data?.connectionId ?? data?.connection_id ?? null,
    displayName: data?.displayName ?? data?.display_name ?? null,
    phoneNumber: data?.phoneNumber ?? data?.phone_number ?? null,
    connectionAccessMode: (data?.connectionAccessMode ?? data?.connection_access_mode ?? 'suspended') as WhatsAppConnectionAccessMode,
    canSendMessages: Boolean(data?.canSendMessages ?? data?.can_send_messages),
  };
}

export function mapStartWhatsAppOnboardingResponseFromApi(data: any): StartWhatsAppOnboardingResponseDto {
  return {
    sessionId: data?.sessionId ?? data?.session_id ?? '',
    connectionId: data?.connectionId ?? data?.connection_id ?? '',
    stateNonce: data?.stateNonce ?? data?.state_nonce,
    fbAppId: data?.fbAppId ?? data?.fb_app_id,
    configId: data?.configId ?? data?.config_id,
    expiresAt: data?.expiresAt ?? data?.expires_at ?? '',
    mode: data?.mode,
    providerProgress: data?.providerProgress ?? data?.provider_progress,
    provider: data?.provider,
    authUrl: data?.authUrl ?? data?.auth_url,
  };
}

export interface BillingReactivationResponse {
  success: boolean;
  message: string;
  outcome: 'cancellation_reversed' | 'legacy_reactivated';
}

export interface EarlyActivationQuoteResponse {
  quoteId: string;
  transitionId: string;
  sourcePlanId: string;
  targetPlanId: string;
  currentPeriodStartBillingDate: string;
  currentPeriodEndBillingDate: string;
  quoteBillingDate: string;
  totalDays: number;
  remainingDays: number;
  sourceCurrentCycleTotalCents: number;
  targetCurrentCycleTotalCents: number;
  priceDeltaCents: number;
  proratedAdjustmentCents: number;
  currency: string;
  expiresAt: string;
  nextRenewalBillingDate: string;
  nextRecurringAmountCents: number;
}

export interface EarlyActivationCheckoutResponse {
  checkoutUrl?: string;
  checkoutId?: string;
  quoteId: string;
  amountCents?: number;
  expiresAt?: string | null;
  transitionId: string;
  status: string;
  code?: string;
  message?: string;
}

export class ApiError extends Error {
  statusCode: number;
  code?: string;
  details?: any;

  constructor(message: string, statusCode: number, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
    this.code = details?.code || (details as any)?.error?.code;
  }
}

export function getFriendlyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'PLAN_MEMBER_QUOTA_REACHED':
        return 'Você atingiu o limite de membros do seu plano. Acesse "Plano e assinatura" para mais informações.';
      case 'PLAN_SONG_QUOTA_REACHED':
        return 'Você atingiu o limite de músicas do seu plano. Acesse "Plano e assinatura" para mais informações.';
      case 'SUBSCRIPTION_RESTRICTED':
        return 'Seu ministério está acima dos limites do plano atual. Esta operação ficará disponível novamente quando a utilização for regularizada.';
      case 'SUBSCRIPTION_SUSPENDED':
        return 'Este ministério está suspenso e esta operação não está disponível.';
      case 'MINISTRY_ACCESS_DENIED':
        return 'Acesso negado. Você não é integrante deste ministério.';
      default:
        return err.message || 'Erro ao processar a operação.';
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Ocorreu um erro inesperado.';
}

// Usar variável de ambiente ou fallback para backend local/produção
const getCleanApiUrl = (): string => {
  const verifiedApi = (globalThis as typeof globalThis & { __LOUVAIO_VERIFIED_API__?: string }).__LOUVAIO_VERIFIED_API__;
  if (verifiedApi) return verifiedApi;
  const envUrl = (import.meta as any).env?.VITE_API_URL as string | undefined;
  let rawUrl = (envUrl && envUrl.trim()) ? envUrl.trim() : 'http://localhost:3000/api/v1';

  // Remove barras iniciais acidentais (ex: /praise-app-gray.vercel.app/api/v1)
  rawUrl = rawUrl.replace(/^\/+/, '');

  // Garante o protocolo http:// ou https://
  if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
    rawUrl = `https://${rawUrl}`;
  }

  // Remove barras no final para evitar dupla barra na concatenação de rotas
  return rawUrl.replace(/\/+$/, '');
};

export const DEFAULT_MINISTRY_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
export const API_URL = getCleanApiUrl();

export const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('praise_auth_token');
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

export const getHeaders = () => {
  return {
    ...getAuthHeaders(),
    'Content-Type': 'application/json',
  };
};

export const SESSION_EXPIRED_EVENT = 'louvaio:session-expired';

const handleResponse = async <T>(
  response: Response,
  options?: { skipSessionExpiry?: boolean; signal?: AbortSignal }
): Promise<T> => {
  options?.signal?.throwIfAborted();
  if (response.status === 204) {
    return {} as T;
  }

  const text = await response.text();
  options?.signal?.throwIfAborted();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(`Erro de resposta do servidor (${response.status})`, response.status);
  }

  if (response.ok) {
    return body as T;
  }

  const errorMessage = body?.error?.message || `Erro desconhecido (${response.status})`;
  const details = body?.error?.details || body?.error;

  if (response.status === 401 && !options?.skipSessionExpiry) {
    const reqUrl = response.url || '';
    const isAuthCredentialAttempt =
      /\/auth\/(login|signup)/i.test(reqUrl) ||
      reqUrl.includes('securetoken.googleapis.com') ||
      reqUrl.includes('identitytoolkit.googleapis.com');
    const hasActiveSession =
      typeof window !== 'undefined' &&
      Boolean(window.localStorage?.getItem('praise_auth_token'));
    if (!isAuthCredentialAttempt && hasActiveSession && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent(SESSION_EXPIRED_EVENT, {
          detail: { message: errorMessage, status: 401 },
        })
      );
    }
  }

  throw new ApiError(errorMessage, response.status, details);
};

export function isMinistryAudioLoopbackApi(apiUrl = API_URL) {
  try {
    const url = new URL(apiUrl);
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

function ministryAudioPath(ministryId: string) {
  if (!isMinistryAudioLoopbackApi()) throw new Error('A biblioteca experimental exige uma API local.');
  return `${API_URL}/ministries/${encodeURIComponent(ministryId)}/audio-library`;
}

function ministryAudioDirectUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Endereço de transferência inválido.');
  }
  if (!url.search || url.hash || url.username || url.password || url.pathname === '/') {
    throw new Error('Endereço de transferência inválido.');
  }
  const allowedR2 = url.protocol === 'https:' && !url.port &&
    /^[a-f0-9]{32}\.r2\.cloudflarestorage\.com$/.test(url.hostname) &&
    url.origin === import.meta.env.VITE_MINISTRY_AUDIO_R2_ORIGIN;
  const allowedSimulator = import.meta.env.VITE_MINISTRY_AUDIO_EMULATOR === '1' &&
    import.meta.env.VITE_MINISTRY_AUDIO_DIRECT_SIMULATOR === '1' &&
    (import.meta.env.DEV || import.meta.env.MODE === 'test') && isMinistryAudioLoopbackApi() &&
    url.origin === new URL(API_URL).origin && url.pathname.startsWith('/api/local/ministry-audio-objects/');
  if (!allowedR2 && !allowedSimulator) throw new Error('Endereço de transferência inválido.');
  return url.href;
}

function ministryAudioDirectHeaders(method: 'PUT' | 'GET', headers: Record<string, string> | undefined): Record<string, string> {
  const values = new Map(Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  const match = values.get('if-match');
  if (method === 'GET' && Object.keys(headers ?? {}).length === 1 && typeof match === 'string' && /^"[^"\x00-\x20\x7f,]+"$/.test(match)) {
    return { 'if-match': match };
  }

  const cacheControl = values.get('cache-control');
  if (method === 'PUT' && Object.keys(headers ?? {}).length === (cacheControl === undefined ? 2 : 3) &&
      values.get('if-none-match') === '*' && values.get('content-type') === 'audio/wav' &&
      (cacheControl === undefined || cacheControl === 'private, no-store')) {
    return { 'if-none-match': '*', 'content-type': 'audio/wav', ...(cacheControl ? { 'cache-control': cacheControl } : {}) };
  }
  throw new Error('Cabeçalhos de transferência inválidos.');
}

function fetchMinistryAudioObject(url: string, method: 'PUT' | 'GET', headers: HeadersInit, signal: AbortSignal, body?: Blob) {
  signal.throwIfAborted();
  return fetch(url, {
    method, headers, signal, body, cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
  });
}

function assertMinistryStemSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_MINISTRY_STEM_BYTES) throw new Error('Tamanho de faixa inválido.');
}

async function readMinistryWav(response: Response, sizeBytes: number, signal: AbortSignal) {
  if (response.headers.get('content-type')?.split(';')[0] !== 'audio/wav') {
    await response.body?.cancel();
    throw new Error('Formato de faixa inválido.');
  }
  return readMinistryStem(response, sizeBytes, signal);
}

async function readMinistryStem(response: Response, sizeBytes: number, signal: AbortSignal) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) !== sizeBytes) {
    await response.body?.cancel();
    throw new Error('Tamanho de faixa inválido.');
  }
  if (!response.body) throw new Error('Faixa incompleta.');

  const bytes = new Uint8Array(sizeBytes);
  const reader = response.body.getReader();
  let offset = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      if (offset + value.byteLength > sizeBytes) {
        await reader.cancel();
        throw new Error('Tamanho de faixa inválido.');
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  if (offset !== sizeBytes) throw new Error('Faixa incompleta.');
  return bytes;
}

async function requestMinistryAudio<T>(ministryId: string, path: string, signal: AbortSignal, options: RequestInit = {}) {
  signal.throwIfAborted();
  const response = await fetch(`${ministryAudioPath(ministryId)}${path}`, {
    ...options,
    headers: { ...getHeaders(), ...options.headers },
    signal,
    cache: 'no-store',
    redirect: 'error',
  });
  return handleResponse<T>(response, { signal });
}

async function completeMinistryAudioStem(ministryId: string, path: string, attempt: number, signal: AbortSignal) {
  try {
    return await requestMinistryAudio<MinistryAudioUpload>(ministryId, `${path}/complete`, signal, {
      method: 'POST', body: JSON.stringify({ attempt }),
    });
  } catch (error) {
    if (error instanceof ApiError && (error.code === 'AUDIO_UPLOAD_MISSING' || error.code === 'AUDIO_UPLOAD_INVALID')) return error;
    throw error;
  }
}

const ministryAudio = {
  list(ministryId: string, filters: { q?: string; cursor?: string; limit?: number }, signal: AbortSignal) {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.cursor) params.set('cursor', filters.cursor);
    if (filters.limit) params.set('limit', String(filters.limit));
    const query = params.toString();
    return requestMinistryAudio<MinistryAudioPage>(ministryId, query ? `?${query}` : '', signal);
  },
  reserve(ministryId: string, payload: MinistryAudioReservation, signal: AbortSignal) {
    return requestMinistryAudio<MinistryAudioUpload>(ministryId, '/uploads', signal, { method: 'POST', body: JSON.stringify(payload) });
  },
  getUpload(ministryId: string, id: string, signal: AbortSignal) {
    return requestMinistryAudio<MinistryAudioUpload>(ministryId, `/uploads/${encodeURIComponent(id)}`, signal);
  },
  uploadStem(ministryId: string, id: string, stemId: CanonicalStemId, file: Blob, signal: AbortSignal) {
    return requestMinistryAudio<MinistryAudioUpload>(ministryId, `/uploads/${encodeURIComponent(id)}/stems/${stemId}`, signal, {
      method: 'PUT', headers: { 'Content-Type': 'audio/wav' }, body: file,
    });
  },
  async uploadDirectStem(ministryId: string, id: string, stemId: CanonicalStemId, file: Blob, signal: AbortSignal) {
    assertMinistryStemSize(file.size);
    const path = `/uploads/${encodeURIComponent(id)}/stems/${stemId}`;
    // One additional grant covers expiry or an attempt marked invalid by the API.
    for (let grantIndex = 0; grantIndex < 2; grantIndex += 1) {
      const grant = await requestMinistryAudio<MinistryAudioUploadGrant>(ministryId, `${path}/upload-url`, signal, { method: 'POST' });
      if (!Number.isSafeInteger(grant.attempt) || grant.attempt < 1 || !Number.isSafeInteger(grant.expiresAt)) {
        throw new Error('Autorização de transferência inválida.');
      }
      const previous = await completeMinistryAudioStem(ministryId, path, grant.attempt, signal);
      if (!(previous instanceof ApiError)) return previous;
      // The device clock is not trusted for expiry; an expired grant is detected by the provider's 403.
      if (previous.code === 'AUDIO_UPLOAD_INVALID') {
        if (grantIndex === 0) continue;
        throw previous;
      }

      const url = ministryAudioDirectUrl(grant.url);
      const headers = ministryAudioDirectHeaders('PUT', grant.headers);
      let putStatus: number | undefined;
      try {
        const response = await fetchMinistryAudioObject(url, 'PUT', headers, signal, file);
        putStatus = response.status;
        await response.body?.cancel();
      } catch {
        signal.throwIfAborted();
        // A dropped response can still leave an object to confirm.
      }
      const completed = await completeMinistryAudioStem(ministryId, path, grant.attempt, signal);
      if (!(completed instanceof ApiError)) return completed;
      // A PUT with no HTTP status (opaque network/CORS failure from an expired URL) is safe to retry once only
      // because the API just confirmed that the object is absent and the grant is create-only.
      const noObject = putStatus === undefined && completed.code === 'AUDIO_UPLOAD_MISSING';
      if (grantIndex === 0 && (completed.code === 'AUDIO_UPLOAD_INVALID' || putStatus === 403 || noObject)) continue;
      if (completed.code === 'AUDIO_UPLOAD_INVALID' || putStatus === 409 || putStatus === 412) throw completed;
      throw new Error('Não foi possível enviar a faixa. Tente novamente.');
    }
    throw new Error('Não foi possível autorizar o envio da faixa.');
  },
  finalize(ministryId: string, id: string, signal: AbortSignal) {
    return requestMinistryAudio<MinistryAudioRecord>(ministryId, `/uploads/${encodeURIComponent(id)}/finalize`, signal, { method: 'POST' });
  },
  update(ministryId: string, id: string, payload: MinistryAudioMetadata, signal: AbortSignal) {
    return requestMinistryAudio<MinistryAudioRecord>(ministryId, `/${encodeURIComponent(id)}`, signal, { method: 'PATCH', body: JSON.stringify(payload) });
  },
  archive(ministryId: string, id: string, signal: AbortSignal) {
    return requestMinistryAudio<MinistryAudioRecord>(ministryId, `/${encodeURIComponent(id)}/archive`, signal, { method: 'POST' });
  },
  getPlayback(ministryId: string, id: string, signal: AbortSignal) {
    return requestMinistryAudio<MinistryAudioPlayback>(ministryId, `/${encodeURIComponent(id)}/playback`, signal);
  },
  async downloadStem(ministryId: string, id: string, stemId: CanonicalStemId, url: string, sizeBytes: number, signal: AbortSignal) {
    const path = `/${encodeURIComponent(id)}/stems/${stemId}`;
    const prefix = `${path}?`;
    if (!url.startsWith(prefix) || url.includes('#')) throw new Error('Endereço de faixa inválido.');
    const params = new URLSearchParams(url.slice(prefix.length));
    const entries = [...params];
    if (entries.length !== 1 || entries[0][0] !== 'ticket' || !entries[0][1]) throw new Error('Acesso à faixa inválido.');
    assertMinistryStemSize(sizeBytes);

    signal.throwIfAborted();
    const response = await fetch(`${ministryAudioPath(ministryId)}${path}?${params.toString()}`, {
      headers: { ...getAuthHeaders(), Accept: 'audio/wav' },
      signal,
      cache: 'no-store',
      redirect: 'error',
    });
    signal.throwIfAborted();
    if (!response.ok) await handleResponse<never>(response, { signal });
    return readMinistryWav(response, sizeBytes, signal);
  },
  async downloadDirectStem(url: string, headers: Record<string, string> | undefined, sizeBytes: number, signal: AbortSignal) {
    assertMinistryStemSize(sizeBytes);
    const target = ministryAudioDirectUrl(url);
    const requestHeaders = ministryAudioDirectHeaders('GET', headers);
    let response: Response;
    try {
      response = await fetchMinistryAudioObject(target, 'GET', requestHeaders, signal);
    } catch (reason) {
      signal.throwIfAborted();
      // An expired signed URL may surface as an opaque network/CORS failure; status 0 lets the caller renew once.
      if (reason instanceof TypeError) throw new ApiError('A faixa não está disponível para reprodução.', 0);
      throw reason;
    }
    signal.throwIfAborted();
    if (!response.ok) {
      await response.body?.cancel();
      throw new ApiError('A faixa não está disponível para reprodução.', response.status);
    }
    return readMinistryWav(response, sizeBytes, signal);
  },
};

const mapSongFromApi = (apiSong: any): Song => {
  const defaultLinks: SongLink[] = [
    { label: 'Letra', url: apiSong.external_links?.letras || '' },
    { label: 'Cifra', url: apiSong.chord_sheet_url || '' },
    { label: 'Áudio', url: apiSong.audio_url || '' },
    { label: 'Vídeo', url: apiSong.youtube_url || '' },
  ];

  if (apiSong.external_links) {
    Object.entries(apiSong.external_links).forEach(([key, val]) => {
      if (typeof val === 'string' && val && !['letras'].includes(key)) {
        defaultLinks.push({ label: key, url: val, isCustom: true });
      }
    });
  }

  const defaultVersion: SongVersion = {
    [LOCAL_SONG_VERSION_PROVENANCE]: 'legacy',
    id: apiSong.id ? `${apiSong.id}_v1` : 'v1',
    name: 'Original',
    classificationIds: apiSong.classification_id ? [apiSong.classification_id] : (apiSong.classification_ids || []),
    notes: apiSong.version_notes || undefined,
    key: apiSong.original_key || 'C',
    bpm: apiSong.bpm || undefined,
    duration: apiSong.duration || undefined,
    links: defaultLinks,
  };

  const versions: SongVersion[] = Array.isArray(apiSong.versions) && apiSong.versions.length > 0
    ? apiSong.versions.map((entry: any, idx: number) => {
        const v = entry && typeof entry === 'object' ? entry : {};
        const id = typeof v.id === 'string' ? v.id.trim() : '';
        return {
          ...v,
          id,
          ...(!id ? { [LOCAL_SONG_VERSION_PROVENANCE]: 'missing' as const } : {}),
          name: v.name || (idx === 0 ? 'Original' : `Versão ${idx + 1}`),
          ...(v.classificationIds === undefined && v.classificationId ? { classificationIds: [v.classificationId] } : {}),
          ...(v.key === undefined && v.originalKey ? { key: v.originalKey } : {}),
        };
      })
    : [defaultVersion];

  const resolvedArtistName =
    (typeof apiSong.artist === 'string' ? apiSong.artist : apiSong.artist?.name) ||
    apiSong.artist_name ||
    '';

  return {
    id: apiSong.id,
    ministryId: apiSong.ministry_id || apiSong.group_id,
    userId: apiSong.user_id,
    title: apiSong.title || '',
    artist: resolvedArtistName,
    notes: apiSong.notes !== undefined && apiSong.notes !== null ? (apiSong.notes || undefined) : (apiSong.lyrics || undefined),
    versions,
    createdAt: apiSong.created_at,
    updatedAt: apiSong.updated_at,
    
    // Propriedades retrocompatíveis
    artistId: apiSong.artist_id || (typeof apiSong.artist === 'object' ? apiSong.artist?.id : undefined) || undefined,
    artistName: resolvedArtistName,
    classificationId: versions[0]?.classificationIds?.[0] || apiSong.classification_id || undefined,
    classificationName: apiSong.classification?.name || undefined,
    classificationColor: apiSong.classification?.color || undefined,
    originalKey: versions[0]?.key || apiSong.original_key || undefined,
    bpm: versions[0]?.bpm ? Number(versions[0].bpm) : (apiSong.bpm || undefined),
    duration: versions[0]?.duration || apiSong.duration || undefined,
    lyrics: apiSong.lyrics || undefined,
    chordSheetUrl: apiSong.chord_sheet_url || undefined,
    youtubeUrl: apiSong.youtube_url || undefined,
    audioUrl: apiSong.audio_url || undefined,
    externalLinks: apiSong.external_links || {},
    smartChord: apiSong.smart_chord ? {
      id: apiSong.smart_chord.id,
      originalKey: apiSong.smart_chord.original_key,
      content: apiSong.smart_chord.content,
    } : undefined,
  };
};

const mapSongToApi = (song: Partial<Song>): any => {
  const apiSong: any = {};
  if (song.title !== undefined) apiSong.title = song.title;
  if (song.artistId !== undefined) apiSong.artist_id = song.artistId || null;
  if (song.artist !== undefined) {
    // A free-text artist replaces the catalog association unless one is selected.
    if (song.artistId === undefined) apiSong.artist_id = null;
    apiSong.artist = song.artist;
    apiSong.artist_name = song.artist;
  }
  if (song.lyrics !== undefined) apiSong.lyrics = song.lyrics;
  if (song.notes !== undefined) apiSong.notes = song.notes || null;
  if (song.versions !== undefined) apiSong.versions = song.versions;

  const primaryVersion = song.versions?.[0];
  if (primaryVersion) {
    if ('key' in primaryVersion) apiSong.original_key = primaryVersion.key || null;
    if ('bpm' in primaryVersion) apiSong.bpm = primaryVersion.bpm ? Number(primaryVersion.bpm) : null;
    if ('duration' in primaryVersion) apiSong.duration = primaryVersion.duration || null;
    if (primaryVersion.classificationIds && primaryVersion.classificationIds.length > 0) {
      apiSong.classification_id = primaryVersion.classificationIds[0];
    } else if (primaryVersion.classificationIds !== undefined) {
      apiSong.classification_id = null;
    }
    
    // Mapear links da versão principal para campos planos
    const letraLink = primaryVersion.links?.find((l) => l.label.toLowerCase() === 'letra');
    const cifraLink = primaryVersion.links?.find((l) => l.label.toLowerCase() === 'cifra');
    const audioLink = primaryVersion.links?.find((l) => l.label.toLowerCase() === 'áudio' || l.label.toLowerCase() === 'audio');
    const videoLink = primaryVersion.links?.find((l) => l.label.toLowerCase() === 'vídeo' || l.label.toLowerCase() === 'video');

    if (cifraLink) apiSong.chord_sheet_url = cifraLink.url || null;
    if (videoLink) apiSong.youtube_url = videoLink.url || null;
    if (audioLink) apiSong.audio_url = audioLink.url || null;
    
    const extLinks: Record<string, string> = {};
    if (letraLink?.url) extLinks.letras = letraLink.url;
    primaryVersion.links?.forEach((link) => {
      if (link.isCustom && link.label && link.url) {
        extLinks[link.label] = link.url;
      }
    });
    if ('links' in primaryVersion) apiSong.external_links = extLinks;
  }

  return apiSong;
};

const mapArtistFromApi = (apiArtist: any): Artist => ({
  id: apiArtist.id,
  ministryId: apiArtist.ministry_id || apiArtist.group_id,
  name: apiArtist.name,
  createdAt: apiArtist.created_at,
  updatedAt: apiArtist.updated_at,
});

const mapClassificationFromApi = (apiClassification: any): Classification => ({
  id: apiClassification.id,
  ministryId: apiClassification.ministry_id || apiClassification.group_id,
  name: apiClassification.name,
  description: apiClassification.description || undefined,
  color: apiClassification.color || undefined,
  createdAt: apiClassification.created_at,
  updatedAt: apiClassification.updated_at,
});

const mapFolderFromApi = (apiFolder: any): Folder => ({
  id: apiFolder.id,
  ministryId: apiFolder.ministry_id || apiFolder.group_id,
  name: apiFolder.name,
  description: apiFolder.description || undefined,
  songCount: apiFolder.song_count || 0,
  songs: (apiFolder.songs || []).map(mapSongFromApi),
  createdAt: apiFolder.created_at,
  updatedAt: apiFolder.updated_at,
});

const mapScheduleSongFromApi = (rawSong: any) => {
  if (!rawSong || typeof rawSong !== 'object') return rawSong;
  const resolvedId = rawSong.id || rawSong.songId || rawSong.song_id || '';
  const resolvedVersionId =
    (typeof rawSong.versionId === 'string' ? rawSong.versionId.trim() : '') ||
    (typeof rawSong.version_id === 'string' ? rawSong.version_id.trim() : '') ||
    undefined;
  const resolvedVersionName =
    (typeof rawSong.versionName === 'string' ? rawSong.versionName.trim() : '') ||
    (typeof rawSong.version_name === 'string' ? rawSong.version_name.trim() : '') ||
    undefined;
  return {
    ...rawSong,
    id: resolvedId,
    artistName: rawSong.artistName || rawSong.artist || undefined,
    originalKey: rawSong.originalKey || rawSong.key || undefined,
    versionId: resolvedVersionId,
    versionName: resolvedVersionName,
  };
};

const mapScheduleFromApi = (rawSchedule: any) => {
  if (!rawSchedule || typeof rawSchedule !== 'object') return rawSchedule;
  return {
    ...rawSchedule,
    songs: Array.isArray(rawSchedule.songs)
      ? rawSchedule.songs.map(mapScheduleSongFromApi)
      : [],
  };
};

const mapMinistryFromApi = (apiMinistry: any): Ministry => ({
  id: apiMinistry.id,
  name: apiMinistry.name,
  slug: apiMinistry.slug,
  ownerUserId: apiMinistry.owner_user_id,
  subscriptionStatus: apiMinistry.subscription_status,
  role: apiMinistry.role || 'member',
  createdAt: apiMinistry.created_at,
  updatedAt: apiMinistry.updated_at,
});

export const api = {
  ministryAudio,
  // Autenticação
  login: async (email: string, password: string): Promise<{ user: { id: string; email: string; name: string }; token: string }> => {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ email, password }),
    });
    return handleResponse<any>(response, { skipSessionExpiry: true });
  },

  signUp: async (name: string, email: string, password: string): Promise<{ user: { id: string; email: string; name: string }; token: string }> => {
    const response = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, email, password }),
    });
    return handleResponse<any>(response, { skipSessionExpiry: true });
  },

  getMe: async (): Promise<AuthenticatedUser> => {
    const response = await fetch(`${API_URL}/auth/me`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    return {
      id: result.id,
      email: result.email,
      name: result.name,
      preferences: {
        chordFontFamily: result.preferences?.chord_font_family || 'monospace',
        chordLineSpacingPx: result.preferences?.chord_line_spacing_px ?? 0,
        vocalMinMidi: typeof result.preferences?.vocal_min_midi === 'number' ? result.preferences.vocal_min_midi : undefined,
        vocalMaxMidi: typeof result.preferences?.vocal_max_midi === 'number' ? result.preferences.vocal_max_midi : undefined,
      },
    };
  },

  updateUserPreferences: async (preferences: {
    chordFontFamily?: string;
    chordLineSpacingPx?: number;
    vocalMinMidi?: number;
    vocalMaxMidi?: number;
  }): Promise<{ preferences: UserPreferences }> => {
    const payload: Record<string, any> = {};
    if (preferences.chordFontFamily !== undefined) {
      payload.chord_font_family = preferences.chordFontFamily;
    }
    if (preferences.chordLineSpacingPx !== undefined) {
      payload.chord_line_spacing_px = preferences.chordLineSpacingPx;
    }
    if (preferences.vocalMinMidi !== undefined) {
      payload.vocal_min_midi = preferences.vocalMinMidi;
    }
    if (preferences.vocalMaxMidi !== undefined) {
      payload.vocal_max_midi = preferences.vocalMaxMidi;
    }
    const response = await fetch(`${API_URL}/auth/me/preferences`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await handleResponse<any>(response);
    return {
      preferences: {
        chordFontFamily: result.preferences?.chord_font_family || 'monospace',
        chordLineSpacingPx: result.preferences?.chord_line_spacing_px ?? 0,
        vocalMinMidi: typeof result.preferences?.vocal_min_midi === 'number' ? result.preferences.vocal_min_midi : undefined,
        vocalMaxMidi: typeof result.preferences?.vocal_max_midi === 'number' ? result.preferences.vocal_max_midi : undefined,
      },
    };
  },

  // Ministérios e Convites
  getMyMinistries: async (): Promise<Ministry[]> => {
    const response = await fetch(`${API_URL}/ministries/my-ministries`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return (result || []).map(mapMinistryFromApi);
  },

  getMyGroups: async (): Promise<Ministry[]> => {
    return api.getMyMinistries();
  },

  createMinistry: async (name: string): Promise<Ministry> => {
    const response = await fetch(`${API_URL}/ministries`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<any>(response);
    return mapMinistryFromApi(result);
  },

  createGroup: async (name: string): Promise<Ministry> => {
    return api.createMinistry(name);
  },

  joinMinistryByCode: async (code: string): Promise<{ message: string; ministry: Ministry; group: Ministry; role: string }> => {
    const response = await fetch(`${API_URL}/ministries/join`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code }),
    });
    const result = await handleResponse<any>(response);
    const mapped = mapMinistryFromApi(result.ministry || result.group);
    return {
      message: result.message,
      ministry: mapped,
      group: mapped,
      role: result.role,
    };
  },

  joinGroupByCode: async (code: string) => {
    return api.joinMinistryByCode(code);
  },

  createInviteCode: async (ministryId: string, expiresInDays = 7): Promise<MinistryInvite> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/invites`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ expiresInDays }),
    });
    const result = await handleResponse<any>(response);
    return {
      id: result.id,
      ministryId: result.ministry_id || result.group_id,
      code: result.code,
      createdBy: result.created_by,
      maxUses: result.max_uses,
      usesCount: result.uses_count,
      expiresAt: result.expires_at,
      createdAt: result.created_at,
    };
  },

  getMinistryMembers: async (ministryId: string): Promise<Array<{ id: string; userId: string; name: string; email: string; role: string; birthDate?: string; isManual?: boolean; roleIds?: string[] }>> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return (result || []).map((m: any) => ({
      id: m.id || m.user_id,
      userId: m.user_id,
      name: m.name || m.user_id || 'Integrante',
      email: m.email || '',
      role: m.role || 'member',
      birthDate: m.birth_date || undefined,
      isManual: m.is_manual || false,
      roleIds: m.role_ids || m.roleIds || [],
    }));
  },

  getGroupMembers: async (groupId: string) => {
    return api.getMinistryMembers(groupId);
  },

  updateMinistry: async (ministryId: string, data: { name: string }): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    const result = await handleResponse<any>(response);
    return mapMinistryFromApi(result);
  },

  deleteMinistry: async (ministryId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  leaveMinistry: async (ministryId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/leave`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  removeMember: async (ministryId: string, memberId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members/${memberId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  updateMemberRole: async (ministryId: string, memberId: string, role: 'admin' | 'member'): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members/${memberId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ role }),
    });
    return handleResponse<any>(response);
  },

  updateMember: async (
    ministryId: string,
    memberId: string,
    data: {
      name?: string;
      email?: string;
      birthDate?: string;
      role?: 'admin' | 'member';
      roleIds?: string[];
      password?: string;
    }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members/${memberId}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  addMemberManually: async (
    ministryId: string,
    data: { name: string; email: string; role?: 'admin' | 'member'; birthDate?: string }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/members`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  // Equipes
  getTeams: async (ministryId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return result || [];
  },

  getTeamById: async (ministryId: string, teamId: string): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams/${teamId}`, {
      headers: getHeaders(),
    });
    return handleResponse<any>(response);
  },

  createTeam: async (
    ministryId: string,
    data: { name: string; description?: string; memberIds?: string[] }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  updateTeam: async (
    ministryId: string,
    teamId: string,
    data: { name?: string; description?: string | null; memberIds?: string[] }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams/${teamId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  deleteTeam: async (ministryId: string, teamId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/teams/${teamId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Funções (Roles)
  getRoles: async (ministryId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/roles`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return result || [];
  },

  createRole: async (ministryId: string, data: { name: string; icon: string }): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/roles`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  updateRole: async (ministryId: string, roleId: string, data: { name?: string; icon?: string }): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/roles/${roleId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  deleteRole: async (ministryId: string, roleId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/roles/${roleId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Classificações
  getClassifications: async (ministryId: string): Promise<Classification[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    const list = Array.isArray(result) ? result : (result?.data || []);
    return list.map(mapClassificationFromApi);
  },

  createClassification: async (
    ministryId: string,
    data: { name: string; description?: string }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  updateClassification: async (
    ministryId: string,
    id: string,
    data: { name?: string; description?: string | null }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  deleteClassification: async (ministryId: string, id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/classifications/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Modelos de Roteiro (Schedule Templates)
  getScheduleTemplates: async (ministryId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedule-templates`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return result || [];
  },

  createScheduleTemplate: async (
    ministryId: string,
    data: { name: string; items: any[] }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedule-templates`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  updateScheduleTemplate: async (
    ministryId: string,
    id: string,
    data: { name?: string; items?: any[] }
  ): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedule-templates/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    return handleResponse<any>(response);
  },

  deleteScheduleTemplate: async (ministryId: string, id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedule-templates/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Escalas
  getSchedules: async (ministryId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any[]>(response);
    return (result || []).map(mapScheduleFromApi);
  },

  createSchedule: async (ministryId: string, scheduleData: any): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(scheduleData),
    });
    const created = await handleResponse<any>(response);
    return mapScheduleFromApi(created);
  },

  updateSchedule: async (ministryId: string, scheduleId: string, scheduleData: any): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(scheduleData),
    });
    const updated = await handleResponse<any>(response);
    return mapScheduleFromApi(updated);
  },

  deleteSchedule: async (scheduleId: string, ministryId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  confirmSchedulePresence: async (ministryId: string, scheduleId: string, confirmed: boolean): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}/confirmation`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify({ confirmed }),
    });
    return handleResponse<any>(response);
  },

  // Contadores do Repertório
  getCounts: async (ministryId = DEFAULT_MINISTRY_ID): Promise<RepertoireCounts> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/counts`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: RepertoireCounts }>(response);
    return result.data;
  },

  // Músicas
  getSongs: async (
    ministryId = DEFAULT_MINISTRY_ID,
    filters?: {
      search?: string;
      classificationId?: string;
      originalKey?: string;
      artistId?: string;
      hasYoutube?: boolean;
      page?: number;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<{ songs: Song[]; totalCount: number }> => {
    const queryParams = new URLSearchParams();
    if (filters?.search) queryParams.append('search', filters.search);
    if (filters?.classificationId) queryParams.append('classification_id', filters.classificationId);
    if (filters?.originalKey) queryParams.append('original_key', filters.originalKey);
    if (filters?.artistId) queryParams.append('artist_id', filters.artistId);
    if (filters?.hasYoutube !== undefined && filters?.hasYoutube !== null) {
      queryParams.append('has_youtube', String(filters.hasYoutube));
    }
    if (filters?.page) queryParams.append('page', String(filters.page));
    if (filters?.limit) queryParams.append('limit', String(filters.limit));

    const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs${queryString}`, {
      headers: getHeaders(),
      signal,
    });
    const result = await handleResponse<{ data: any[]; total: number }>(response);
    return {
      songs: (result.data || []).map(mapSongFromApi),
      totalCount: result.total || 0,
    };
  },

  getSongById: async (songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs/${songId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  createSong: async (songData: Partial<Song>, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(mapSongToApi(songData)),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  updateSong: async (songId: string, songData: Partial<Song>, ministryId = DEFAULT_MINISTRY_ID): Promise<Song> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs/${songId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(mapSongToApi(songData)),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapSongFromApi(result.data);
  },

  deleteSong: async (songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/songs/${songId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Artistas
  getArtists: async (ministryId = DEFAULT_MINISTRY_ID, search?: string, signal?: AbortSignal): Promise<Artist[]> => {
    const queryString = search ? `?search=${encodeURIComponent(search)}` : '';
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists${queryString}`, {
      headers: getHeaders(),
      signal,
    });
    const result = await handleResponse<{ data: any[] }>(response);
    return (result.data || []).map(mapArtistFromApi);
  },

  createArtist: async (name: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Artist> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapArtistFromApi(result.data);
  },

  updateArtist: async (artistId: string, name: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Artist> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists/${artistId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({ name }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapArtistFromApi(result.data);
  },

  deleteArtist: async (artistId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/artists/${artistId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },
  // Pastas
  getFolders: async (ministryId = DEFAULT_MINISTRY_ID): Promise<Folder[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any[] }>(response);
    return (result.data || []).map(mapFolderFromApi);
  },

  getFolderById: async (folderId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  createFolder: async (name: string, description?: string, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ name, description }),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  updateFolder: async (folderId: string, data: { name?: string; description?: string }, ministryId = DEFAULT_MINISTRY_ID): Promise<Folder> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    const result = await handleResponse<{ data: any }>(response);
    return mapFolderFromApi(result.data);
  },

  deleteFolder: async (folderId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  addSongToFolder: async (folderId: string, songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}/songs`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ song_id: songId }),
    });
    return handleResponse<void>(response);
  },

  removeSongFromFolder: async (folderId: string, songId: string, ministryId = DEFAULT_MINISTRY_ID): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/folders/${folderId}/songs/${songId}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Cifras Inteligentes
  getSmartChords: async (_ministryId?: string, searchQuery?: string, signal?: AbortSignal): Promise<SmartChord[]> => {
    const params = new URLSearchParams();
    if (searchQuery && searchQuery.trim()) {
      params.append('search', searchQuery.trim());
    }
    const queryString = params.toString();
    const url = `${API_URL}/smart-chords${queryString ? `?${queryString}` : ''}`;
    const response = await fetch(url, {
      headers: getHeaders(),
      signal,
    });
    const result = await handleResponse<any>(response);
    const list = Array.isArray(result) ? result : (result?.data || []);
    return list.map(mapSmartChordFromApi);
  },

  getSmartChordById: async (id: string): Promise<SmartChord> => {
    const response = await fetch(`${API_URL}/smart-chords/${id}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    return mapSmartChordFromApi(result);
  },

  getSmartChordsBySongId: async (songId: string): Promise<SmartChord[]> => {
    const response = await fetch(`${API_URL}/smart-chords/song/${songId}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    const list = Array.isArray(result) ? result : (result?.data || []);
    return list.map(mapSmartChordFromApi);
  },

  getSmartChordBySongId: async (songId: string): Promise<SmartChord | null> => {
    const list = await api.getSmartChordsBySongId(songId);
    return list.length > 0 ? list[0] : null;
  },

  createSmartChord: async (payload: Partial<SmartChord>): Promise<SmartChord> => {
    const body: Record<string, any> = {
      title: payload.title,
      original_key: payload.originalKey,
      content: payload.content || '',
    };
    if (payload.artistName !== undefined) {
      body.artist_name = payload.artistName || null;
    }
    if (payload.sourceUrl !== undefined) body.source_url = payload.sourceUrl;
    if (payload.displayedKey !== undefined) body.displayed_key = payload.displayedKey;
    if (payload.capo !== undefined) body.capo = payload.capo;
    if (payload.artistId !== undefined) {
      body.artist_id = payload.artistId || null;
    }
    if (payload.songId !== undefined) {
      body.song_id = payload.songId || null;
    }
    if (payload.versionId !== undefined) {
      body.version_id = payload.versionId || null;
    }

    const response = await fetch(`${API_URL}/smart-chords`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    const result = await handleResponse<any>(response);
    return mapSmartChordFromApi(result);
  },

  updateSmartChord: async (id: string, payload: Partial<SmartChord>): Promise<SmartChord> => {
    const body: Record<string, any> = {};
    if (payload.title !== undefined) body.title = payload.title;
    if (payload.artistName !== undefined) body.artist_name = payload.artistName || null;
    if (payload.originalKey !== undefined) body.original_key = payload.originalKey;
    if (payload.sourceUrl !== undefined) body.source_url = payload.sourceUrl;
    if (payload.displayedKey !== undefined) body.displayed_key = payload.displayedKey;
    if (payload.capo !== undefined) body.capo = payload.capo;
    if (payload.content !== undefined) body.content = payload.content;
    if (payload.artistId !== undefined) body.artist_id = payload.artistId || null;
    if (payload.songId !== undefined) body.song_id = payload.songId || null;
    if (payload.versionId !== undefined) body.version_id = payload.versionId || null;

    const response = await fetch(`${API_URL}/smart-chords/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(body),
    });
    const result = await handleResponse<any>(response);
    return mapSmartChordFromApi(result);
  },

  deleteSmartChord: async (id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/smart-chords/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  getSmartChordRepertoireLink: async (ministryId: string, chordId: string): Promise<SmartChordRepertoireLink> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/smart-chords/${chordId}/repertoire-link`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    return {
      link: result?.link ? mapSmartChordSongLinkFromApi(result.link) : null,
      song: result?.song ? {
        id: result.song.id,
        ministryId: result.song.ministry_id,
        title: result.song.title,
        artistId: result.song.artist_id,
        artistName: result.song.artist_name,
        originalKey: result.song.original_key,
        ...(Array.isArray(result.song.versions)
          ? {
              versions: result.song.versions.map((v: any) => ({
                id: v.id,
                name: v.name,
                key: v.key ?? null,
              })),
            }
          : {}),
      } : null,
      ...(result?.pending_link ? { pendingLink: mapSmartChordSongLinkFromApi(result.pending_link) } : {}),
      ...(result?.requires_version_selection !== undefined
        ? { requiresVersionSelection: Boolean(result.requires_version_selection) }
        : {}),
    };
  },

  setSmartChordRepertoireLink: async (
    ministryId: string,
    chordId: string,
    songId: string,
    versionId?: string
  ): Promise<SmartChordRepertoireLink> => {
    const payload: Record<string, any> = { song_id: songId };
    if (versionId !== undefined && versionId.trim() !== '') {
      payload.version_id = versionId.trim();
    }
    const response = await fetch(`${API_URL}/ministries/${ministryId}/smart-chords/${chordId}/repertoire-link`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await handleResponse<any>(response);
    return {
      link: result?.link ? mapSmartChordSongLinkFromApi(result.link) : null,
      song: result?.song ? {
        id: result.song.id,
        ministryId: result.song.ministry_id,
        title: result.song.title,
        artistId: result.song.artist_id,
        artistName: result.song.artist_name,
        originalKey: result.song.original_key,
        ...(Array.isArray(result.song.versions)
          ? {
              versions: result.song.versions.map((v: any) => ({
                id: v.id,
                name: v.name,
                key: v.key ?? null,
              })),
            }
          : {}),
      } : null,
    };
  },

  removeSmartChordRepertoireLink: async (ministryId: string, chordId: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/smart-chords/${chordId}/repertoire-link`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  getMySmartChordsForSong: async (
    ministryId: string,
    songId: string,
    options?: { versionId?: string; linkStatus?: 'active' | 'pending_classification' }
  ): Promise<SmartChord[]> => {
    const params = new URLSearchParams();
    if (options?.versionId) params.set('version_id', options.versionId);
    if (options?.linkStatus) params.set('link_status', options.linkStatus);
    const qs = params.toString();
    const url = `${API_URL}/ministries/${ministryId}/songs/${songId}/my-smart-chords${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    const list = Array.isArray(result) ? result : (result?.data || []);
    return list.map(mapSmartChordFromApi);
  },

  getMyPendingSmartChordsForSong: async (ministryId: string, songId: string): Promise<SmartChord[]> => {
    return api.getMySmartChordsForSong(ministryId, songId, { linkStatus: 'pending_classification' });
  },

  upsertSmartChord: async (songId: string, originalKey: string, content: string): Promise<SmartChord> => {
    const existing = await api.getSmartChordBySongId(songId);
    if (existing) {
      return api.updateSmartChord(existing.id, { originalKey, content, songId });
    }
    return api.createSmartChord({ title: 'Cifra Inteligente', originalKey, content, songId });
  },

  importSmartChordText: async (text: string, html?: string): Promise<SmartChordImportDraft> => {
    const response = await fetch(`${API_URL}/smart-chords/import/text`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ text, ...(html ? { html } : {}) }),
    });
    const result = await handleResponse<any>(response);
    return {
      title: result.title || '',
      artistName: result.artist_name || null,
      originalKey: result.original_key || null,
      ...(result.displayed_key != null ? { displayedKey: result.displayed_key } : {}),
      ...(result.capo != null ? { capo: result.capo } : {}),
      ...(result.original_text != null ? { originalText: result.original_text } : {}),
      content: result.content || '',
      warnings: result.warnings || [],
      sourceType: result.source_type || 'text',
    };
  },

  importSmartChordPdf: async (file: File): Promise<SmartChordImportDraft> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_URL}/smart-chords/import/pdf`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });
    const result = await handleResponse<any>(response);
    return {
      title: result.title || '',
      artistName: result.artist_name || null,
      originalKey: result.original_key || null,
      ...(result.displayed_key != null ? { displayedKey: result.displayed_key } : {}),
      ...(result.capo != null ? { capo: result.capo } : {}),
      ...(result.original_text != null ? { originalText: result.original_text } : {}),
      content: result.content || '',
      warnings: result.warnings || [],
      sourceType: result.source_type || 'pdf',
    };
  },

  importSmartChordUrl: async (url: string): Promise<SmartChordImportDraft> => {
    const response = await fetch(`${API_URL}/smart-chords/import/url`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ url }),
    });
    const result = await handleResponse<any>(response);
    return {
      title: result.title || '',
      artistName: result.artist_name || null,
      originalKey: result.original_key || null,
      ...(result.displayed_key != null ? { displayedKey: result.displayed_key } : {}),
      ...(result.capo != null ? { capo: result.capo } : {}),
      ...(result.original_text != null ? { originalText: result.original_text } : {}),
      content: result.content || '',
      warnings: result.warnings || [],
      sourceType: result.source_type || 'url',
      requiresManualPaste: result.requires_manual_paste || false,
      sourceUrl: result.source_url || url,
    };
  },

  importSmartChordImage: async (file: File): Promise<SmartChordImportDraft> => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_URL}/smart-chords/import/image`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: formData,
    });
    const result = await handleResponse<any>(response);
    return {
      title: result.title || '',
      artistName: result.artist_name || null,
      originalKey: result.original_key || null,
      ...(result.displayed_key != null ? { displayedKey: result.displayed_key } : {}),
      ...(result.capo != null ? { capo: result.capo } : {}),
      ...(result.original_text != null ? { originalText: result.original_text } : {}),
      content: result.content || '',
      warnings: result.warnings || [],
      sourceType: result.source_type || 'image',
      requiresManualPaste: result.requires_manual_paste || false,
    };
  },

  // Comentários da Escala
  getScheduleComments: async (ministryId: string, scheduleId: string): Promise<any[]> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}/comments`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    return Array.isArray(result) ? result : (result?.data || []);
  },

  createScheduleComment: async (ministryId: string, scheduleId: string, content: string): Promise<any> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/schedules/${scheduleId}/comments`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ content }),
    });
    return handleResponse<any>(response);
  },

  // Avisos do Ministério (Announcements)
  getAnnouncements: async (ministryId: string, limit?: number): Promise<Announcement[]> => {
    const url = limit
      ? `${API_URL}/ministries/${ministryId}/announcements?limit=${limit}`
      : `${API_URL}/ministries/${ministryId}/announcements`;
    const response = await fetch(url, { headers: getHeaders() });
    const result = await handleResponse<any[]>(response);
    return (result || []).map(mapAnnouncementFromApi);
  },

  getAnnouncementById: async (ministryId: string, id: string): Promise<Announcement> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/announcements/${id}`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<any>(response);
    return mapAnnouncementFromApi(result);
  },

  createAnnouncement: async (
    ministryId: string,
    data: { title: string; content: string; author?: string; important?: boolean }
  ): Promise<Announcement> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/announcements`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        title: data.title,
        content: data.content,
        author: data.author,
        important: data.important ?? false,
      }),
    });
    const result = await handleResponse<any>(response);
    return mapAnnouncementFromApi(result);
  },

  updateAnnouncement: async (
    ministryId: string,
    id: string,
    data: { title?: string; content?: string; author?: string; important?: boolean }
  ): Promise<Announcement> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/announcements/${id}`, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({
        title: data.title,
        content: data.content,
        author: data.author,
        important: data.important,
      }),
    });
    const result = await handleResponse<any>(response);
    return mapAnnouncementFromApi(result);
  },

  deleteAnnouncement: async (ministryId: string, id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/announcements/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Indisponibilidade de Membros (Availability)
  getMyUnavailabilities: async (
    ministryId: string,
    limit?: number,
    cursor?: string
  ): Promise<UnavailabilitiesResponse> => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    if (cursor) params.append('cursor', cursor);
    const queryString = params.toString();
    const url = queryString
      ? `${API_URL}/ministries/${ministryId}/availability/my?${queryString}`
      : `${API_URL}/ministries/${ministryId}/availability/my`;

    const response = await fetch(url, { headers: getHeaders() });
    const result = await handleResponse<any>(response);
    return {
      data: (result?.data || []).map(mapUnavailabilityFromApi),
      nextCursor: result?.nextCursor ?? null,
    };
  },

  createMyUnavailability: async (
    ministryId: string,
    data: CreateUnavailabilityPayload
  ): Promise<MemberUnavailability> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/availability/my`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        startDate: data.startDate,
        endDate: data.endDate,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        allDay: data.allDay,
        reason: data.reason ?? null,
      }),
    });
    const result = await handleResponse<any>(response);
    return mapUnavailabilityFromApi(result);
  },

  updateMyUnavailability: async (
    ministryId: string,
    id: string,
    data: UpdateUnavailabilityPayload
  ): Promise<MemberUnavailability> => {
    const payload: any = {};
    if (data.startDate !== undefined) payload.startDate = data.startDate;
    if (data.endDate !== undefined) payload.endDate = data.endDate;
    if (data.startTime !== undefined) payload.startTime = data.startTime;
    if (data.endTime !== undefined) payload.endTime = data.endTime;
    if (data.allDay !== undefined) payload.allDay = data.allDay;
    if (data.reason !== undefined) payload.reason = data.reason;

    const response = await fetch(`${API_URL}/ministries/${ministryId}/availability/my/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await handleResponse<any>(response);
    return mapUnavailabilityFromApi(result);
  },

  deleteMyUnavailability: async (ministryId: string, id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/availability/my/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  // Manual Member Availability (Phase 6D-2)
  getManualMemberUnavailabilities: async (
    ministryId: string,
    memberId: string,
    limit?: number,
    cursor?: string
  ): Promise<UnavailabilitiesResponse> => {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    if (cursor) params.append('cursor', cursor);
    const queryString = params.toString();
    const url = queryString
      ? `${API_URL}/ministries/${ministryId}/availability/members/${memberId}?${queryString}`
      : `${API_URL}/ministries/${ministryId}/availability/members/${memberId}`;

    const response = await fetch(url, { headers: getHeaders() });
    const result = await handleResponse<any>(response);
    return {
      data: (result?.data || []).map(mapUnavailabilityFromApi),
      nextCursor: result?.nextCursor ?? null,
    };
  },

  createManualMemberUnavailability: async (
    ministryId: string,
    memberId: string,
    data: CreateUnavailabilityPayload
  ): Promise<MemberUnavailability> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/availability/members/${memberId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        startDate: data.startDate,
        endDate: data.endDate,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
        allDay: data.allDay,
        reason: data.reason ?? null,
      }),
    });
    const result = await handleResponse<any>(response);
    return mapUnavailabilityFromApi(result);
  },

  updateManualMemberUnavailability: async (
    ministryId: string,
    memberId: string,
    id: string,
    data: UpdateUnavailabilityPayload
  ): Promise<MemberUnavailability> => {
    const payload: any = {};
    if (data.startDate !== undefined) payload.startDate = data.startDate;
    if (data.endDate !== undefined) payload.endDate = data.endDate;
    if (data.startTime !== undefined) payload.startTime = data.startTime;
    if (data.endTime !== undefined) payload.endTime = data.endTime;
    if (data.allDay !== undefined) payload.allDay = data.allDay;
    if (data.reason !== undefined) payload.reason = data.reason;

    const response = await fetch(`${API_URL}/ministries/${ministryId}/availability/members/${memberId}/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(payload),
    });
    const result = await handleResponse<any>(response);
    return mapUnavailabilityFromApi(result);
  },

  deleteManualMemberUnavailability: async (
    ministryId: string,
    memberId: string,
    id: string
  ): Promise<void> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/availability/members/${memberId}/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    return handleResponse<void>(response);
  },

  checkAvailabilityConflicts: async (
    ministryId: string,
    payload: CheckAvailabilityConflictsPayload
  ): Promise<ScheduleConflictCheckResponse> => {
    const bodyPayload: any = {
      date: payload.date,
      time: payload.time,
      participantIds: payload.participantIds,
    };
    if (typeof payload.durationMinutes === 'number') {
      bodyPayload.durationMinutes = payload.durationMinutes;
    }

    const response = await fetch(`${API_URL}/ministries/${ministryId}/availability/check-conflicts`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(bodyPayload),
    });
    const result = await handleResponse<any>(response);
    return mapScheduleConflictResponseFromApi(result);
  },

  getConsolidatedAvailability: async (
    ministryId: string,
    params: {
      from: string;
      to: string;
      memberId?: string;
      limit?: number;
      cursor?: string;
    }
  ): Promise<ConsolidatedAvailabilityResponse> => {
    const searchParams = new URLSearchParams();
    searchParams.set('from', params.from);
    searchParams.set('to', params.to);
    if (params.memberId) searchParams.set('memberId', params.memberId);
    if (params.limit !== undefined) searchParams.set('limit', String(params.limit));
    if (params.cursor) searchParams.set('cursor', params.cursor);

    const queryString = searchParams.toString();
    const url = `${API_URL}/ministries/${ministryId}/availability?${queryString}`;

    const response = await fetch(url, {
      headers: getHeaders(),
    });

    const result = await handleResponse<any>(response);
    return {
      window: {
        from: result?.window?.from || params.from,
        to: result?.window?.to || params.to,
      },
      data: (result?.data || []).map(mapConsolidatedAvailabilityItemFromApi),
      nextCursor: result?.nextCursor || result?.next_cursor || null,
    };
  },

  // Planos e Assinaturas
  getPlans: async (): Promise<PlansResponse> => {
    const response = await fetch(`${API_URL}/plans`, {
      headers: getHeaders(),
    });
    return handleResponse<PlansResponse>(response);
  },

  getMinistrySubscription: async (ministryId: string): Promise<MinistrySubscriptionSummary> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/subscription`, {
      headers: getHeaders(),
    });
    return handleResponse<MinistrySubscriptionSummary>(response);
  },

  // Billing & Checkout
  getBillingPreview: async (
    ministryId: string,
    planId: string,
    interval: BillingInterval,
    addonBlocks: number = 0
  ): Promise<CheckoutPreviewResult> => {
    const query = new URLSearchParams({
      planId,
      interval,
      addonBlocks: String(addonBlocks),
    });
    const response = await fetch(`${API_URL}/ministries/${ministryId}/billing/preview?${query.toString()}`, {
      headers: getHeaders(),
    });
    return handleResponse<CheckoutPreviewResult>(response);
  },

  createBillingCheckout: async (
    ministryId: string,
    params: {
      planId: string;
      interval: BillingInterval;
      addonBlocks?: number;
      successUrl?: string;
      cancelUrl?: string;
    }
  ): Promise<CheckoutCreationResult> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/billing/checkout`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(params),
    });
    return handleResponse<CheckoutCreationResult>(response);
  },

  cancelBillingSubscription: async (
    ministryId: string
  ): Promise<{ message: string; subscription: any }> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/billing/cancel`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse<{ message: string; subscription: any }>(response);
  },

  reactivateBillingSubscription: async (
    ministryId: string
  ): Promise<BillingReactivationResponse> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/billing/reactivate`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse<BillingReactivationResponse>(response);
  },

  getBillingHistory: async (
    ministryId: string
  ): Promise<{ transactions: BillingTransactionRecord[] }> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/billing/history`, {
      headers: getHeaders(),
    });
    return handleResponse<{ transactions: BillingTransactionRecord[] }>(response);
  },

  reconcileBillingSubscription: async (
    ministryId: string
  ): Promise<{ message: string; reconciled: boolean; subscription: any }> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/billing/reconcile`, {
      method: 'POST',
      headers: getHeaders(),
    });
    return handleResponse<{ message: string; reconciled: boolean; subscription: any }>(response);
  },

  getEarlyActivationQuote: async (
    ministryId: string,
    transitionId: string
  ): Promise<EarlyActivationQuoteResponse> => {
    const response = await fetch(
      `${API_URL}/ministries/${ministryId}/billing/transitions/${transitionId}/early-activation/quote`,
      {
        method: 'POST',
        headers: getHeaders(),
      }
    );
    return handleResponse<EarlyActivationQuoteResponse>(response);
  },

  createEarlyActivationCheckout: async (
    ministryId: string,
    transitionId: string,
    quoteId: string
  ): Promise<EarlyActivationCheckoutResponse> => {
    const response = await fetch(
      `${API_URL}/ministries/${ministryId}/billing/transitions/${transitionId}/early-activation/checkout`,
      {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ quoteId }),
      }
    );
    return handleResponse<EarlyActivationCheckoutResponse>(response);
  },

  listWhatsAppConnections: async (
    organizationId: string,
    options?: { limit?: number; cursor?: string }
  ): Promise<PaginatedWhatsAppConnectionsResponseDto> => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.cursor) params.set('cursor', options.cursor);
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await fetch(`${API_URL}/organizations/${organizationId}/whatsapp/connections${query}`, {
      headers: getHeaders(),
    });
    const raw = await handleResponse<any>(response);
    return mapPaginatedWhatsAppConnectionsFromApi(raw);
  },

  getWhatsAppCapacity: async (
    organizationId: string
  ): Promise<OrganizationWhatsAppCapacity> => {
    const response = await fetch(`${API_URL}/organizations/${organizationId}/entitlements/whatsapp`, {
      headers: getHeaders(),
    });
    const raw = await handleResponse<any>(response);
    return mapOrganizationWhatsAppCapacityFromApi(raw);
  },

  getOrganizationWhatsAppCapacity: async (
    organizationId: string
  ): Promise<OrganizationWhatsAppCapacity> => {
    return api.getWhatsAppCapacity(organizationId);
  },

  getMinistryWhatsAppStatus: async (
    ministryId: string
  ): Promise<MinistryWhatsAppStatusDto> => {
    const response = await fetch(`${API_URL}/ministries/${ministryId}/whatsapp/status`, {
      headers: getHeaders(),
    });
    const raw = await handleResponse<any>(response);
    return mapMinistryWhatsAppStatusFromApi(raw);
  },

  updateWhatsAppConnection: async (
    organizationId: string,
    connectionId: string,
    data: UpdateWhatsAppConnectionInput
  ): Promise<WhatsAppConnectionDto> => {
    const response = await fetch(
      `${API_URL}/organizations/${organizationId}/whatsapp/connections/${connectionId}`,
      {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify(data),
      }
    );
    const raw = await handleResponse<any>(response);
    return mapWhatsAppConnectionFromApi(raw);
  },

  startWhatsAppOnboarding: async (
    organizationId: string,
    data?: StartWhatsAppOnboardingInput
  ): Promise<StartWhatsAppOnboardingResponseDto> => {
    const response = await fetch(`${API_URL}/organizations/${organizationId}/whatsapp/onboarding/start`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data || {}),
    });
    const raw = await handleResponse<any>(response);
    return mapStartWhatsAppOnboardingResponseFromApi(raw);
  },

  completeWhatsAppOnboarding: async (
    organizationId: string,
    data: CompleteWhatsAppOnboardingInput
  ): Promise<WhatsAppConnectionDto> => {
    const response = await fetch(`${API_URL}/organizations/${organizationId}/whatsapp/onboarding/complete`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    const raw = await handleResponse<any>(response);
    return mapWhatsAppConnectionFromApi(raw);
  },

  disconnectWhatsAppConnection: async (
    organizationId: string,
    connectionId: string
  ): Promise<DisconnectWhatsAppConnectionResponseDto> => {
    const response = await fetch(
      `${API_URL}/organizations/${organizationId}/whatsapp/connections/${connectionId}`,
      {
        method: 'DELETE',
        headers: getHeaders(),
      }
    );
    return handleResponse<DisconnectWhatsAppConnectionResponseDto>(response);
  },

  // Exclusão de Conta (Google Play compliance PC1-PC3)
  reauthenticateAndGetFreshToken: async (email: string, password: string): Promise<string> => {
    const apiKey = COMPLIANCE_CONFIG.firebaseWebApiKey;
    if (!apiKey) {
      throw new ApiError('Chave da API de autenticação não configurada.', 500);
    }

    // 1. Reautenticação via Firebase Auth REST API (signInWithPassword)
    const signInRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      }
    );

    const signInData = await signInRes.json().catch(() => ({}));
    if (!signInRes.ok) {
      const fbError = signInData?.error?.message;
      if (
        fbError === 'INVALID_PASSWORD' ||
        fbError === 'EMAIL_NOT_FOUND' ||
        fbError === 'INVALID_LOGIN_CREDENTIALS'
      ) {
        throw new ApiError('Senha incorreta. Verifique sua senha e tente novamente.', 401, {
          code: 'INVALID_CREDENTIALS',
        });
      }
      if (fbError === 'USER_DISABLED') {
        throw new ApiError('Esta conta foi desativada.', 403, { code: 'USER_DISABLED' });
      }
      if (fbError === 'TOO_MANY_ATTEMPTS_TRY_LATER') {
        throw new ApiError('Muitas tentativas consecutivas. Tente novamente mais tarde.', 429, {
          code: 'TOO_MANY_ATTEMPTS',
        });
      }
      throw new ApiError(
        'Falha na reautenticação. Verifique os dados e tente novamente.',
        signInRes.status,
        signInData
      );
    }

    const refreshToken = signInData.refreshToken;
    const initialIdToken = signInData.idToken;

    if (!refreshToken) {
      if (initialIdToken) return initialIdToken;
      throw new ApiError('Não foi possível obter o token de segurança para reautenticação.', 500);
    }

    // 2. Force-refresh do Firebase ID Token para assegurar auth_time fresco
    const refreshRes = await fetch(`https://securetoken.googleapis.com/v1/token?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    });

    const refreshData = await refreshRes.json().catch(() => ({}));
    if (!refreshRes.ok) {
      if (initialIdToken) return initialIdToken;
      throw new ApiError('Falha ao atualizar token de segurança.', refreshRes.status, refreshData);
    }

    const freshIdToken = refreshData.id_token || refreshData.access_token || initialIdToken;
    if (!freshIdToken) {
      throw new ApiError('Token de autenticação atualizado não encontrado.', 500);
    }

    return freshIdToken;
  },

  getAccountDeletionPreflight: async (): Promise<AccountDeletionPreflightResponse> => {
    const response = await fetch(`${API_URL}/auth/account-deletion/preflight`, {
      headers: getHeaders(),
    });
    return handleResponse<AccountDeletionPreflightResponse>(response);
  },

  executeAccountDeletion: async (freshIdToken: string): Promise<AccountDeletionResult> => {
    const response = await fetch(`${API_URL}/auth/account-deletion`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${freshIdToken}`,
      },
    });
    return handleResponse<AccountDeletionResult>(response, { skipSessionExpiry: true });
  },

  getAccountDeletionStatus: async (): Promise<{ job: AccountDeletionJobRecord | null }> => {
    const response = await fetch(`${API_URL}/auth/account-deletion/status`, {
      headers: getHeaders(),
    });
    return handleResponse<{ job: AccountDeletionJobRecord | null }>(response, {
      skipSessionExpiry: true,
    });
  },

  // Exercícios Vocais Personalizados
  getCustomVocalExercises: async (): Promise<VocalExercise[]> => {
    const response = await fetch(`${API_URL}/vocal-exercises/custom`, {
      headers: getHeaders(),
    });
    const result = await handleResponse<{ exercises: any[] }>(response);
    return (result.exercises || []).map((e: any) => ({
      id: e.id,
      title: e.title,
      description: e.description || '',
      notes: e.notes || [],
      noteDurations: e.noteDurations || [],
      minTranspose: typeof e.minTranspose === 'number' ? e.minTranspose : -12,
      maxTranspose: typeof e.maxTranspose === 'number' ? e.maxTranspose : 12,
      category: e.category || 'misto',
      isCustom: true,
    }));
  },

  createCustomVocalExercise: async (data: {
    title: string;
    description?: string;
    notes: number[];
    noteDurations: number[];
    minTranspose?: number;
    maxTranspose?: number;
    category?: string;
  }): Promise<VocalExercise> => {
    const response = await fetch(`${API_URL}/vocal-exercises/custom`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(data),
    });
    const result = await handleResponse<{ exercise: any }>(response);
    const e = result.exercise;
    return {
      id: e.id,
      title: e.title,
      description: e.description || '',
      notes: e.notes || [],
      noteDurations: e.noteDurations || [],
      minTranspose: typeof e.minTranspose === 'number' ? e.minTranspose : -12,
      maxTranspose: typeof e.maxTranspose === 'number' ? e.maxTranspose : 12,
      category: e.category || 'misto',
      isCustom: true,
    };
  },

  updateCustomVocalExercise: async (
    id: string,
    patch: {
      title?: string;
      description?: string;
      notes?: number[];
      noteDurations?: number[];
      minTranspose?: number;
      maxTranspose?: number;
      category?: string;
    }
  ): Promise<VocalExercise> => {
    const response = await fetch(`${API_URL}/vocal-exercises/custom/${id}`, {
      method: 'PATCH',
      headers: getHeaders(),
      body: JSON.stringify(patch),
    });
    const result = await handleResponse<{ exercise: any }>(response);
    const e = result.exercise;
    return {
      id: e.id,
      title: e.title,
      description: e.description || '',
      notes: e.notes || [],
      noteDurations: e.noteDurations || [],
      minTranspose: typeof e.minTranspose === 'number' ? e.minTranspose : -12,
      maxTranspose: typeof e.maxTranspose === 'number' ? e.maxTranspose : 12,
      category: e.category || 'misto',
      isCustom: true,
    };
  },

  deleteCustomVocalExercise: async (id: string): Promise<void> => {
    const response = await fetch(`${API_URL}/vocal-exercises/custom/${id}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    await handleResponse<{ success: boolean }>(response);
  },
};

