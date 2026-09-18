import { OrganizationRecord } from '../organizations/organization.types';
import { MinistrySubscriptionRecord } from './subscription.types';
import { getIncludedWhatsAppConnections, DEFAULT_PLAN_ID } from '../../config/plans.config';
import { getBillingDate } from '../../utils/billing-date';
import { WhatsAppConnectionRecord, WhatsAppConnectionStatus } from '../whatsapp/whatsapp.types';
import { AppError } from '../../middleware/error-handler';

export type WhatsAppCommercialState =
  | 'healthy'
  | 'payment_grace'
  | 'post_payment_grace'
  | 'plan_excluded'
  | 'administratively_suspended'
  | 'restricted_over_limit'
  | 'integrity_failure';

export interface WhatsAppCommercialFacts {
  organization?: OrganizationRecord | null;
  anchorMinistry?: { id: string; organization_id?: string | null } | null;
  subscription?: MinistrySubscriptionRecord | null;
  consumingConnectionsCount?: number;
  connections?: Array<Pick<WhatsAppConnectionRecord, 'id' | 'status' | 'pending_expires_at'>>;
  now?: Date;
}

export interface WhatsAppCommercialEntitlementResult {
  state: WhatsAppCommercialState;
  canSendMessages: boolean;
  canCreateConnection: boolean;
  canResumeAuthorizedOnboarding: boolean;
  allowedConnections: number;
  consumingConnections: number;
  availableSlots: number;
  restrictionReason?: string;
  details?: {
    organizationId?: string;
    billingAnchorMinistryId?: string;
    billingStatus?: string;
    planId?: string;
    graceExpiresAt?: string | null;
    gracePeriodExpiresBillingDate?: string | null;
    [key: string]: unknown;
  };
}

/**
 * Predicado puro que avalia se uma conexão WhatsApp consome capacidade comercial (Phase 7D2-D8).
 *
 * - 'connecting', 'connected', 'error', 'disabled_by_user': sempre consomem capacidade (true).
 * - 'pending': consome se pending_expires_at > now (ou se ausente/inválido por fail-closed).
 *   Se pending_expires_at <= now, a reserva expirou e NÃO consome (false).
 * - 'disconnected' e outros: NÃO consomem capacidade (false).
 */
export function consumesCommercialCapacity(
  conn: Pick<WhatsAppConnectionRecord, 'status' | 'pending_expires_at'>,
  now: Date = new Date()
): boolean {
  if (!conn || !conn.status) {
    return false;
  }

  const nonPendingConsuming: WhatsAppConnectionStatus[] = [
    'connecting',
    'connected',
    'error',
    'disabled_by_user',
  ];

  if (nonPendingConsuming.includes(conn.status)) {
    return true;
  }

  if (conn.status === 'pending') {
    if (!conn.pending_expires_at) {
      // Expiry ausente ou nulo: fail-closed (considera ativo para não burlar limites)
      return true;
    }
    const expires = new Date(conn.pending_expires_at);
    if (isNaN(expires.getTime())) {
      // Expiry malformado: fail-closed
      return true;
    }
    return expires.getTime() > now.getTime();
  }

  return false;
}

/**
 * Avaliador canônico e puro de direito comercial WhatsApp (Phase 7D2-D8).
 * Zero I/O, zero mutações externas, determinístico e imune a desvios de relógio.
 */
export function evaluateWhatsAppCommercialEntitlement(
  facts: WhatsAppCommercialFacts
): WhatsAppCommercialEntitlementResult {
  const now = facts.now ?? new Date();

  // 1. Contagem de conexões consumidoras
  let consumingConnections = facts.consumingConnectionsCount;
  if (consumingConnections === undefined) {
    if (facts.connections && Array.isArray(facts.connections)) {
      consumingConnections = facts.connections.filter((c) => consumesCommercialCapacity(c, now)).length;
    } else {
      consumingConnections = 0;
    }
  }

  // 2. Barreira de Integridade e Tenant Boundary (Anti-IDOR)
  const org = facts.organization;
  const anchorMinistry =
    facts.anchorMinistry !== undefined
      ? facts.anchorMinistry
      : org?.billing_anchor_ministry_id
      ? { id: org.billing_anchor_ministry_id, organization_id: org.id }
      : null;

  if (
    !org ||
    !anchorMinistry ||
    !org.billing_anchor_ministry_id ||
    anchorMinistry.id !== org.billing_anchor_ministry_id ||
    anchorMinistry.organization_id !== org.id
  ) {
    return {
      state: 'integrity_failure',
      canSendMessages: false,
      canCreateConnection: false,
      canResumeAuthorizedOnboarding: false,
      allowedConnections: 0,
      consumingConnections,
      availableSlots: 0,
      restrictionReason: 'COMMERCIAL_INTEGRITY_VIOLATION',
      details: {
        organizationId: org?.id,
        billingAnchorMinistryId: org?.billing_anchor_ministry_id,
        anchorMinistryId: anchorMinistry?.id,
        anchorMinistryOrgId: anchorMinistry?.organization_id,
      },
    };
  }

  const sub = facts.subscription;

  // 3. Suspensão Administrativa (prioridade máxima sobre plano e pagamentos)
  if (sub?.administratively_suspended) {
    return {
      state: 'administratively_suspended',
      canSendMessages: false,
      canCreateConnection: false,
      canResumeAuthorizedOnboarding: false,
      allowedConnections: 0,
      consumingConnections,
      availableSlots: 0,
      restrictionReason: 'ADMINISTRATIVELY_SUSPENDED',
      details: {
        organizationId: org.id,
        billingAnchorMinistryId: org.billing_anchor_ministry_id,
        billingStatus: sub.billing_status,
      },
    };
  }

  // 4. Determinação do Plano Efetivo e Quota Incluída
  let effectivePlanId = sub?.plan_id || DEFAULT_PLAN_ID;
  if (sub) {
    const isLegacyCancelExpired = Boolean(
      sub.cancel_at_period_end &&
      !sub.active_cancellation_transition_id &&
      sub.current_period_end &&
      !isNaN(new Date(sub.current_period_end).getTime()) &&
      now > new Date(sub.current_period_end)
    );
    if (isLegacyCancelExpired) {
      effectivePlanId = DEFAULT_PLAN_ID;
    } else if (sub.subscription_mode === 'complimentary' && sub.expires_at) {
      const grantExpires = new Date(sub.expires_at);
      if (!isNaN(grantExpires.getTime()) && now > grantExpires) {
        effectivePlanId = DEFAULT_PLAN_ID;
      }
    }
  }

  const allowedConnections = getIncludedWhatsAppConnections(effectivePlanId);

  // 5. Plano Excluído (Ex: Free, Lite, Lite+, Essential, Pro possuem quota 0)
  if (allowedConnections <= 0) {
    return {
      state: 'plan_excluded',
      canSendMessages: false,
      canCreateConnection: false,
      canResumeAuthorizedOnboarding: false,
      allowedConnections: 0,
      consumingConnections,
      availableSlots: 0,
      restrictionReason: 'PLAN_EXCLUDED',
      details: {
        organizationId: org.id,
        billingAnchorMinistryId: org.billing_anchor_ministry_id,
        planId: effectivePlanId,
        billingStatus: sub?.billing_status,
      },
    };
  }

  // 6. Avaliação Financeira / Status de Faturamento
  const billingStatus = sub?.billing_status || 'past_due';

  if (billingStatus === 'past_due') {
    // Carência civil de 7 dias [start, end)
    const graceEndDate =
      sub?.grace_period_expires_billing_date ||
      (sub?.grace_period_expires_at ? getBillingDate(sub.grace_period_expires_at) : null);

    const currentCommercialDate = getBillingDate(now);
    const isWithinGrace = Boolean(graceEndDate && currentCommercialDate < graceEndDate);

    if (isWithinGrace) {
      // Dentro da carência: verifica se há excesso de conexões consumidoras
      if (consumingConnections > allowedConnections) {
        return {
          state: 'restricted_over_limit',
          canSendMessages: false,
          canCreateConnection: false,
          canResumeAuthorizedOnboarding: false,
          allowedConnections,
          consumingConnections,
          availableSlots: 0,
          restrictionReason: 'RESTRICTED_OVER_LIMIT',
          details: {
            organizationId: org.id,
            billingAnchorMinistryId: org.billing_anchor_ministry_id,
            planId: effectivePlanId,
            billingStatus,
            gracePeriodExpiresBillingDate: graceEndDate,
          },
        };
      }

      // Em carência e dentro da quota: permite envio e retomada estagiada, mas bloqueia novas reservas
      return {
        state: 'payment_grace',
        canSendMessages: true,
        canCreateConnection: false,
        canResumeAuthorizedOnboarding: true,
        allowedConnections,
        consumingConnections,
        availableSlots: Math.max(0, allowedConnections - consumingConnections),
        restrictionReason: undefined,
        details: {
          organizationId: org.id,
          billingAnchorMinistryId: org.billing_anchor_ministry_id,
          planId: effectivePlanId,
          billingStatus,
          gracePeriodExpiresBillingDate: graceEndDate,
        },
      };
    } else {
      // Fora da carência (ou sem carência registrada)
      return {
        state: 'post_payment_grace',
        canSendMessages: false,
        canCreateConnection: false,
        canResumeAuthorizedOnboarding: false,
        allowedConnections,
        consumingConnections,
        availableSlots: 0,
        restrictionReason: 'SUBSCRIPTION_PAST_DUE',
        details: {
          organizationId: org.id,
          billingAnchorMinistryId: org.billing_anchor_ministry_id,
          planId: effectivePlanId,
          billingStatus,
          gracePeriodExpiresBillingDate: graceEndDate,
        },
      };
    }
  }

  // Se o status não for ativo, nem trialing (ex.: unpaid, canceled)
  if (billingStatus !== 'active' && billingStatus !== 'trialing') {
    return {
      state: 'post_payment_grace',
      canSendMessages: false,
      canCreateConnection: false,
      canResumeAuthorizedOnboarding: false,
      allowedConnections,
      consumingConnections,
      availableSlots: 0,
      restrictionReason: 'SUBSCRIPTION_PAST_DUE',
      details: {
        organizationId: org.id,
        billingAnchorMinistryId: org.billing_anchor_ministry_id,
        planId: effectivePlanId,
        billingStatus,
      },
    };
  }

  // 7. Status Ativo / Trialing: Verificar se está dentro do limite de capacidade
  if (consumingConnections > allowedConnections) {
    return {
      state: 'restricted_over_limit',
      canSendMessages: false,
      canCreateConnection: false,
      canResumeAuthorizedOnboarding: false,
      allowedConnections,
      consumingConnections,
      availableSlots: 0,
      restrictionReason: 'RESTRICTED_OVER_LIMIT',
      details: {
        organizationId: org.id,
        billingAnchorMinistryId: org.billing_anchor_ministry_id,
        planId: effectivePlanId,
        billingStatus,
      },
    };
  }

  // 8. Estado Saudável (Healthy)
  const availableSlots = Math.max(0, allowedConnections - consumingConnections);
  const canCreate = consumingConnections < allowedConnections;

  return {
    state: 'healthy',
    canSendMessages: true,
    canCreateConnection: canCreate,
    canResumeAuthorizedOnboarding: true,
    allowedConnections,
    consumingConnections,
    availableSlots,
    restrictionReason: canCreate ? undefined : 'CAPACITY_LIMIT_REACHED',
    details: {
      organizationId: org.id,
      billingAnchorMinistryId: org.billing_anchor_ministry_id,
      planId: effectivePlanId,
      billingStatus,
    },
  };
}

export interface VerifyServerOwnedStagedReservationParams {
  conn: WhatsAppConnectionRecord;
  organizationId: string;
  entitlement: WhatsAppCommercialEntitlementResult;
  now?: Date;
}

/**
 * Validador de reserva estagiada para retomada autorizada de onboarding (Phase 7D2-D8).
 */
export function verifyServerOwnedStagedReservation(
  params: VerifyServerOwnedStagedReservationParams
): { valid: true } {
  const { conn, organizationId, entitlement, now = new Date() } = params;

  if (conn.organization_id !== organizationId) {
    throw new AppError(404, 'CONNECTION_NOT_FOUND: Conexão não encontrada nesta organização.', {
      code: 'CONNECTION_NOT_FOUND',
    });
  }

  if (conn.status === 'connected') {
    throw new AppError(409, 'CONNECTION_ALREADY_CONNECTED: Conexão já conectada.', {
      code: 'CONNECTION_ALREADY_CONNECTED',
    });
  }

  if (conn.status === 'disconnected') {
    throw new AppError(410, 'CONNECTION_RESERVATION_EXPIRED: Reserva de conexão expirada.', {
      code: 'CONNECTION_RESERVATION_EXPIRED',
    });
  }

  if (conn.status === 'pending' && conn.pending_expires_at) {
    const expires = new Date(conn.pending_expires_at);
    if (!isNaN(expires.getTime()) && expires.getTime() <= now.getTime()) {
      throw new AppError(410, 'CONNECTION_RESERVATION_EXPIRED: Prazo de 24 horas da reserva expirado.', {
        code: 'CONNECTION_RESERVATION_EXPIRED',
      });
    }
  }

  if (!entitlement.canResumeAuthorizedOnboarding) {
    throw new AppError(
      403,
      'WHATSAPP_RESTRICTED: Operação não permitida pelo status comercial da organização.',
      {
        code: entitlement.restrictionReason || 'WHATSAPP_SUBSCRIPTION_SUSPENDED',
      }
    );
  }

  return { valid: true };
}
