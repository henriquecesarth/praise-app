export type MinistryRole = 'admin' | 'member';
export type GroupRole = MinistryRole;

export interface Ministry {
  id: string;
  name: string;
  slug?: string;
  ownerUserId: string;
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled';
  role: MinistryRole;
  createdAt: string;
  updatedAt: string;
}

export type Group = Ministry;

export interface MinistryMember {
  id: string;
  ministryId: string;
  userId: string;
  role: MinistryRole;
  joinedAt: string;
}

export type GroupMember = MinistryMember;

export interface MinistryInvite {
  id: string;
  ministryId: string;
  code: string;
  createdBy: string;
  maxUses?: number;
  usesCount: number;
  expiresAt?: string;
  createdAt: string;
}

export type GroupInvite = MinistryInvite;

export interface LiturgyItem {
  id: string;
  liturgyId: string;
  songId?: string;
  song?: Song;
  type: 'song' | 'reading' | 'prayer' | 'custom';
  title: string;
  notes?: string;
  position: number;
}

export interface Liturgy {
  id: string;
  ministryId: string;
  title: string;
  date: string;
  description?: string;
  createdBy: string;
  items?: LiturgyItem[];
  createdAt: string;
  updatedAt: string;
}

export interface SongLink {
  id?: string;
  label: string; // Ex: 'Letra', 'Cifra', 'Áudio', 'Vídeo' ou rótulo customizado
  url: string;
  isCustom?: boolean;
}

export interface SongVersion {
  id: string;
  name: string; // Padrão da primeira versão: "Original"
  classificationIds: string[]; // Classificações da versão
  notes?: string; // Observações específicas desta versão
  key: string; // Tom (ex: "G", "C#m")
  bpm?: string | number; // BPM (ex: 120)
  duration?: string; // Duração formatada em HH:MM:SS
  links: SongLink[]; // 4 links padrão + links customizados
}

export interface Song {
  id: string;
  ministryId?: string;
  userId?: string;
  title: string;
  artist: string; // Texto livre (sem dropdown/sem vínculo com entidade Artista)
  notes?: string; // Observações gerais da música
  versions: SongVersion[]; // Lista de versões (mínimo 1)
  createdAt?: string;
  updatedAt?: string;

  // Propriedades retrocompatíveis opcionais
  artistId?: string;
  artistName?: string;
  classificationId?: string;
  classificationName?: string;
  classificationColor?: string;
  originalKey?: string;
  bpm?: number;
  duration?: string;
  lyrics?: string;
  chordSheetUrl?: string;
  youtubeUrl?: string;
  audioUrl?: string;
  externalLinks?: Record<string, string>;
  smartChord?: {
    id: string;
    originalKey: string;
    content: string;
  };
}

export interface Artist {
  id: string;
  ministryId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Classification {
  id: string;
  ministryId: string;
  name: string;
  description?: string;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Folder {
  id: string;
  ministryId: string;
  name: string;
  description?: string;
  songCount: number;
  songs: Song[];
  createdAt: string;
  updatedAt: string;
}

export interface RepertoireCounts {
  songs: number;
  folders: number;
  artists: number;
}

export interface SongFilters {
  originalKey?: string | null;
  hasYoutube?: boolean | null;
  classificationId?: string | null;
}

// ─── Planos, Quotas, Entitlements e Assinaturas ───────────────────────────

export type PlanId = 'free' | 'lite' | 'lite_plus' | 'essential' | 'pro' | 'premium';

export type QuotaLimit = number | 'unlimited';

export type BillingStatus = 'active' | 'trialing' | 'past_due' | 'canceled';

export type AccessMode = 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';

export type BillingInterval = 'monthly' | 'annual';

export interface PlanDefinition {
  id: PlanId;
  name: string;
  baseMembers: QuotaLimit;
  baseSongs: QuotaLimit;
  allowMemberAddons: boolean;
  maxMemberAddonBlocks: number;
  monthlyPriceCents: number;
  annualPriceCents: number;
  addonBlockMonthlyPriceCents: number;
  addonBlockAnnualPriceCents: number;
}

export interface PlansResponse {
  plans: PlanDefinition[];
  addonBlockSize: number;
  defaultGracePeriodDays: number;
}

export interface QuotaSummary {
  members: QuotaLimit;
  songs: QuotaLimit;
}

export interface UsageSummary {
  membersCount: number;
  songsCount: number;
}

export interface OverLimitDetails {
  membersOver: boolean;
  songsOver: boolean;
}

export type SubscriptionMode = 'free' | 'paid' | 'complimentary';

export interface MinistrySubscriptionRecord {
  planId: PlanId;
  memberAddonBlocks: number;
  billingStatus: BillingStatus;
  billingInterval?: BillingInterval;
  subscriptionMode?: SubscriptionMode;
  grantedBy?: string | null;
  grantedAt?: string | null;
  grantReason?: string | null;
  expiresAt?: string | null;
  administrativelySuspended: boolean;
  suspendedAt: string | null;
  suspensionReason: string | null;
  accessMode: AccessMode;
  gracePeriodExpiresAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}


export interface MinistrySubscriptionSummary {
  plan: PlanDefinition;
  subscription: MinistrySubscriptionRecord;
  quotas: QuotaSummary;
  usage: UsageSummary;
  isOverLimit: boolean;
  overLimitDetails: OverLimitDetails;
  graceDaysRemaining: number | null;
}

export interface CheckoutPreviewResult {
  planId: PlanId;
  planName: string;
  interval: BillingInterval;
  addonBlocks: number;
  effectiveMembersQuota: QuotaLimit;
  effectiveSongsQuota: QuotaLimit;
  basePriceCents: number;
  addonsPriceCents: number;
  totalPriceCents: number;
  fullMonthlyEquivalentCents: number;
  annualSavingsCents: number;
  currency: 'BRL';
  currentPlanId: PlanId;
  isDowngrade: boolean;
  downgradeImpact?: {
    isOverLimit: boolean;
    membersOver: boolean;
    songsOver: boolean;
    gracePeriodDays: number;
  };
}

export interface CheckoutCreationResult {
  checkoutUrl: string;
  checkoutId: string;
  expiresAt: string | null;
  totalPriceCents: number;
  currency: 'BRL';
}

export interface BillingTransactionRecord {
  id: string;
  ministry_id: string;
  provider: string;
  provider_payment_id: string;
  provider_subscription_id?: string | null;
  amount_cents: number;
  currency: 'BRL';
  status: 'pending' | 'paid' | 'overdue' | 'refunded' | 'canceled' | 'failed';
  due_date: string;
  paid_at: string | null;
  payment_method?: string | null;
  invoice_url?: string | null;
  created_at: string;
  updated_at: string;
}

