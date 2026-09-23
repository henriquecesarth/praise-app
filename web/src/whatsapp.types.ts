export type WhatsAppProvider = 'meta_cloud_api' | 'zernio';

export type WhatsAppConnectionStatus =
  | 'pending'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'disabled_by_user'
  | 'disconnected';

export type WhatsAppProviderProgress =
  | 'none'
  | 'credential_staged'
  | 'assets_verified'
  | 'phone_registered'
  | 'waba_subscribed';

export type WhatsAppCommercialState =
  | 'healthy'
  | 'payment_grace'
  | 'post_payment_grace'
  | 'plan_excluded'
  | 'administratively_suspended'
  | 'restricted_over_limit'
  | 'integrity_failure';

export type WhatsAppConnectionAccessMode =
  | 'normal'
  | 'grace'
  | 'restricted_over_limit'
  | 'suspended';

export type BillingAccessMode = 'normal' | 'grace' | 'suspended';

export interface WhatsAppConnectionDto {
  id: string;
  organizationId: string;
  displayName: string;
  phoneNumber: string | null;
  provider: WhatsAppProvider;
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
  connectionAccessMode: WhatsAppConnectionAccessMode;
  canSendMessages: boolean;
}

export interface OrganizationWhatsAppCapacity {
  organizationId: string;
  billingAnchorMinistryId: string;
  totalAllowedConnections: number;
  includedConnections: number;
  additionalConnections: number;
  configuredConnectionsCount: number;
  remainingCapacity: number;
  commercialState: WhatsAppCommercialState;
  canSendMessages: boolean;
  canCreateConnection: boolean;
  canResumeAuthorizedOnboarding: boolean;
  restrictionReason?: string | null;
  gracePeriodExpiresBillingDate?: string | null;
  billingAccessMode: BillingAccessMode;
  connectionAccessMode: WhatsAppConnectionAccessMode;
}

export interface StartWhatsAppOnboardingResponseDto {
  sessionId: string;
  connectionId: string;
  stateNonce?: string;
  fbAppId?: string;
  configId?: string;
  expiresAt: string;
  mode?: 'start' | 'resume_clean' | 'resume_staged';
  providerProgress?: WhatsAppProviderProgress;
  provider?: WhatsAppProvider;
  authUrl?: string;
}

export interface StartWhatsAppOnboardingInput {
  displayName?: string;
  resumeConnectionId?: string;
  provider?: WhatsAppProvider;
}

export interface CompleteWhatsAppOnboardingInput {
  sessionId: string;
  stateNonce: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
  pin?: string;
}

export interface UpdateWhatsAppConnectionInput {
  displayName?: string;
  isOrganizationDefault?: boolean;
  assignedMinistryId?: string | null;
}

export interface DisconnectWhatsAppConnectionResponseDto {
  success: boolean;
  connectionId: string;
  status: 'disconnected';
}
