import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { validateConnectionTransition } from './whatsapp-transition.validator';
import {
  WhatsAppConnectionRecord,
  WhatsAppConnectionStatus,
  WhatsAppConnectionDto,
  PaginatedWhatsAppConnectionsResponseDto,
  MinistryWhatsAppStatusDto,
  OrganizationWhatsAppCapacityUsageDto,
  ResolvedWhatsAppConnectionResult,
  UpdateWhatsAppConnectionInput,
  isProviderIdentityMaterialized,
  getClaimId,
} from './whatsapp.types';

export class WhatsAppConnectionService {
  constructor(
    private readonly connectionRepo: WhatsAppConnectionRepository = new WhatsAppConnectionRepository(),
    private readonly secretRepo: WhatsAppConnectionSecretRepository = new WhatsAppConnectionSecretRepository(),
    private readonly claimRepo: WhatsAppProviderIdentityClaimRepository = new WhatsAppProviderIdentityClaimRepository(),
    private readonly orgRepo: OrganizationRepository = new OrganizationRepository(),
    private readonly subService: SubscriptionService = new SubscriptionService(),
    private readonly ministryRepo: MinistryRepository = new MinistryRepository()
  ) {}

  private mapToDto(conn: WhatsAppConnectionRecord, defaultConnectionId: string | null): WhatsAppConnectionDto {
    return {
      id: conn.id,
      organizationId: conn.organization_id,
      displayName: conn.display_name,
      phoneNumber: conn.phone_number,
      provider: conn.provider,
      status: conn.status,
      statusReason: conn.status_reason,
      isOrganizationDefault: defaultConnectionId === conn.id,
      assignedMinistryId: conn.assigned_ministry_id,
      createdAt: conn.created_at,
      updatedAt: conn.updated_at,
    };
  }

  async listConnections(
    orgId: string,
    options: { limit?: number; cursor?: string } = {},
    actorUserId: string
  ): Promise<PaginatedWhatsAppConnectionsResponseDto> {
    const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
    if (!member) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    const org = await this.orgRepo.getOrganizationById(orgId);
    if (!org) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    const { items, nextCursor } = await this.connectionRepo.listConnectionsByOrganization(
      orgId,
      options
    );

    return {
      items: items.map((conn) => this.mapToDto(conn, org.default_whatsapp_connection_id)),
      nextCursor,
    };
  }

  async updateConnection(
    orgId: string,
    connectionId: string,
    input: UpdateWhatsAppConnectionInput,
    actorUserId: string
  ): Promise<WhatsAppConnectionDto> {
    const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
    if (!member) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    if (member.role !== 'admin' && member.role !== 'owner') {
      throw new AppError(403, 'Apenas administradores da organização podem configurar conexões.');
    }

    const conn = await this.connectionRepo.getConnectionById(connectionId);
    if (!conn || conn.organization_id !== orgId) {
      throw new AppError(404, 'Conexão não encontrada nesta organização.');
    }

    if (conn.status === 'disconnected') {
      throw new AppError(400, 'Conexão desconectada não pode ser modificada.', {
        code: 'CONNECTION_DISCONNECTED',
      });
    }

    // 1. Update Display Name if provided
    if (input.displayName !== undefined) {
      const trimmed = input.displayName.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new AppError(400, 'Nome de exibição deve ter entre 1 e 100 caracteres.');
      }
      await this.connectionRepo.updateConnection(orgId, connectionId, {
        display_name: trimmed,
      });
    }

    // 2. Update Default status if provided
    if (input.isOrganizationDefault !== undefined) {
      if (input.isOrganizationDefault) {
        await this.setOrganizationDefault(orgId, connectionId, actorUserId);
      } else {
        await this.clearOrganizationDefault(orgId, connectionId, actorUserId);
      }
    }

    // 3. Update Ministry Assignment if provided
    if (input.assignedMinistryId !== undefined) {
      if (input.assignedMinistryId === null) {
        await this.unassignMinistry(orgId, connectionId, actorUserId);
      } else {
        await this.assignMinistry(orgId, connectionId, input.assignedMinistryId, actorUserId);
      }
    }

    const updatedConn = await this.connectionRepo.getConnectionById(connectionId);
    const org = await this.orgRepo.getOrganizationById(orgId);
    return this.mapToDto(updatedConn!, org ? org.default_whatsapp_connection_id : null);
  }

  async setOrganizationDefault(orgId: string, connectionId: string, actorUserId: string): Promise<void> {
    const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
    if (!member) {
      throw new AppError(404, 'Organização não encontrada.');
    }
    if (member.role !== 'admin' && member.role !== 'owner') {
      throw new AppError(403, 'Apenas administradores da organização podem definir a conexão padrão.');
    }

    const conn = await this.connectionRepo.getConnectionById(connectionId);
    if (!conn || conn.organization_id !== orgId) {
      throw new AppError(404, 'Conexão não encontrada nesta organização.');
    }

    // DEC-7C-15: Eligibility Gate: status === 'connected'
    if (conn.status !== 'connected') {
      throw new AppError(400, 'CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION: Apenas conexões ativas e conectadas podem ser definidas como padrão da organização.', {
        code: 'CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION',
      });
    }

    // Mutual Exclusivity: connection cannot be exclusively assigned
    if (conn.assigned_ministry_id !== null) {
      throw new AppError(400, 'CANNOT_SET_ASSIGNED_CONNECTION_AS_DEFAULT: Uma conexão atribuída exclusivamente a um ministério não pode ser definida como padrão da organização.', {
        code: 'CANNOT_SET_ASSIGNED_CONNECTION_AS_DEFAULT',
      });
    }

    if (!isProviderIdentityMaterialized(conn)) {
      throw new AppError(400, 'CONNECTION_NOT_MATERIALIZED: Conexão deve ter identidade de provedor materializada.', {
        code: 'CONNECTION_NOT_MATERIALIZED',
      });
    }

    // Validate provider identity claim ownership
    const claimId = getClaimId(conn.provider, conn.provider_phone_number_id!);
    const claim = await this.claimRepo.getClaim(claimId);
    if (!claim || claim.connection_id !== conn.id || claim.organization_id !== orgId) {
      throw new AppError(400, 'INVALID_PROVIDER_CLAIM: Claim de identidade do provedor inválido ou ausente.', {
        code: 'INVALID_PROVIDER_CLAIM',
      });
    }

    await db.collection('organizations').doc(orgId).update({
      default_whatsapp_connection_id: connectionId,
      updated_at: new Date().toISOString(),
    });
  }

  async clearOrganizationDefault(orgId: string, connectionId?: string, actorUserId?: string): Promise<void> {
    if (actorUserId) {
      const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
      if (!member) {
        throw new AppError(404, 'Organização não encontrada.');
      }
      if (member.role !== 'admin' && member.role !== 'owner') {
        throw new AppError(403, 'Apenas administradores da organização podem alterar a conexão padrão.');
      }
    }

    const org = await this.orgRepo.getOrganizationById(orgId);
    if (!org) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    if (!connectionId || org.default_whatsapp_connection_id === connectionId) {
      await db.collection('organizations').doc(orgId).update({
        default_whatsapp_connection_id: null,
        updated_at: new Date().toISOString(),
      });
    }
  }

  async assignMinistry(
    orgId: string,
    connectionId: string,
    ministryId: string,
    actorUserId: string
  ): Promise<void> {
    const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
    if (!member) {
      throw new AppError(404, 'Organização não encontrada.');
    }
    if (member.role !== 'admin' && member.role !== 'owner') {
      throw new AppError(403, 'Apenas administradores da organização podem atribuir conexões.');
    }

    const conn = await this.connectionRepo.getConnectionById(connectionId);
    if (!conn || conn.organization_id !== orgId) {
      throw new AppError(404, 'Conexão não encontrada nesta organização.');
    }

    // DEC-7C-15: Eligibility Gate: status === 'connected'
    if (conn.status !== 'connected') {
      throw new AppError(400, 'CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION: Apenas conexões ativas e conectadas podem ser atribuídas a ministérios.', {
        code: 'CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION',
      });
    }

    // Mutual Exclusivity: cannot be current Organization default
    const org = await this.orgRepo.getOrganizationById(orgId);
    if (!org) {
      throw new AppError(404, 'Organização não encontrada.');
    }
    if (org.default_whatsapp_connection_id === connectionId) {
      throw new AppError(400, 'CANNOT_ASSIGN_DEFAULT_CONNECTION: A conexão padrão da organização não pode ser atribuída exclusivamente a um ministério.', {
        code: 'CANNOT_ASSIGN_DEFAULT_CONNECTION',
      });
    }

    // Tenant check on target ministry
    const ministry = await this.ministryRepo.findById(ministryId);
    if (!ministry || ministry.organization_id !== orgId) {
      throw new AppError(404, 'Ministério não encontrado nesta organização.');
    }

    // 1:1 Cardinality: Ministry cannot already have another assigned connection
    const existing = await this.connectionRepo.findAssignedConnectionForMinistry(orgId, ministryId);
    if (existing && existing.id !== connectionId) {
      throw new AppError(409, 'MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION: Este ministério já possui uma conexão WhatsApp atribuída.', {
        code: 'MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION',
      });
    }

    if (!isProviderIdentityMaterialized(conn)) {
      throw new AppError(400, 'CONNECTION_NOT_MATERIALIZED: Conexão deve ter identidade de provedor materializada.', {
        code: 'CONNECTION_NOT_MATERIALIZED',
      });
    }

    // Validate provider identity claim ownership
    const claimId = getClaimId(conn.provider, conn.provider_phone_number_id!);
    const claim = await this.claimRepo.getClaim(claimId);
    if (!claim || claim.connection_id !== conn.id || claim.organization_id !== orgId) {
      throw new AppError(400, 'INVALID_PROVIDER_CLAIM: Claim de identidade do provedor inválido ou ausente.', {
        code: 'INVALID_PROVIDER_CLAIM',
      });
    }

    await this.connectionRepo.updateConnection(orgId, connectionId, {
      assigned_ministry_id: ministryId,
    });
  }

  async unassignMinistry(orgId: string, connectionId: string, actorUserId: string): Promise<void> {
    const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
    if (!member) {
      throw new AppError(404, 'Organização não encontrada.');
    }
    if (member.role !== 'admin' && member.role !== 'owner') {
      throw new AppError(403, 'Apenas administradores da organização podem desatribuir conexões.');
    }

    const conn = await this.connectionRepo.getConnectionById(connectionId);
    if (!conn || conn.organization_id !== orgId) {
      throw new AppError(404, 'Conexão não encontrada nesta organização.');
    }

    await this.connectionRepo.updateConnection(orgId, connectionId, {
      assigned_ministry_id: null,
    });
  }

  async getOrganizationCapacityUsage(orgId: string): Promise<OrganizationWhatsAppCapacityUsageDto> {
    const capacity = await this.subService.getOrganizationWhatsAppCapacity(orgId);
    const configuredCount = await this.connectionRepo.countConfiguredConnections(orgId);
    const remainingCapacity = Math.max(0, capacity.totalAllowedConnections - configuredCount);
    const isOverLimit = configuredCount > capacity.totalAllowedConnections;

    let connectionAccessMode: 'normal' | 'grace' | 'restricted_over_limit' | 'suspended';
    if (capacity.billingAccessMode === 'suspended') {
      connectionAccessMode = 'suspended';
    } else if (isOverLimit) {
      connectionAccessMode = 'restricted_over_limit';
    } else {
      connectionAccessMode = capacity.billingAccessMode;
    }

    const canCreateConnection =
      capacity.billingAccessMode === 'normal' &&
      configuredCount < capacity.totalAllowedConnections;

    const canSendMessages =
      capacity.billingAccessMode !== 'suspended' &&
      !isOverLimit &&
      capacity.totalAllowedConnections > 0;

    return {
      organizationId: orgId,
      billingAnchorMinistryId: capacity.billingAnchorMinistryId,
      totalAllowedConnections: capacity.totalAllowedConnections,
      includedConnections: capacity.includedConnections,
      additionalConnections: capacity.additionalConnections,
      configuredConnectionsCount: configuredCount,
      remainingCapacity,
      billingAccessMode: capacity.billingAccessMode,
      connectionAccessMode,
      canCreateConnection,
      canSendMessages,
    };
  }

  async resolveWhatsAppConnection(ministryId: string): Promise<ResolvedWhatsAppConnectionResult> {
    const ministry = await this.ministryRepo.findById(ministryId);
    if (!ministry) {
      throw new AppError(404, 'Ministério não encontrado.');
    }

    if (!ministry.organization_id) {
      return { success: false, code: 'NO_ORGANIZATION' };
    }

    const orgId = ministry.organization_id;
    const capacityUsage = await this.getOrganizationCapacityUsage(orgId);

    if (capacityUsage.connectionAccessMode === 'suspended') {
      return { success: false, code: 'WHATSAPP_SUSPENDED' };
    }

    if (capacityUsage.connectionAccessMode === 'restricted_over_limit') {
      return { success: false, code: 'RESTRICTED_OVER_LIMIT' };
    }

    // Step 1: Check Exclusive Ministry Assignment
    const assignedConn = await this.connectionRepo.findAssignedConnectionForMinistry(orgId, ministryId);
    if (assignedConn) {
      if (assignedConn.organization_id !== orgId) {
        return { success: false, code: 'CONNECTION_NOT_ACTIVE' };
      }
      if (assignedConn.status !== 'connected') {
        // DEC-7C-03: Zero fallback to default
        return { success: false, code: 'CONNECTION_NOT_ACTIVE' };
      }
      if (!isProviderIdentityMaterialized(assignedConn)) {
        return { success: false, code: 'CONNECTION_NOT_ACTIVE' };
      }

      // Claim verification
      const claimId = getClaimId(assignedConn.provider, assignedConn.provider_phone_number_id!);
      const claim = await this.claimRepo.getClaim(claimId);
      if (!claim || claim.connection_id !== assignedConn.id || claim.organization_id !== orgId) {
        return { success: false, code: 'CONNECTION_NOT_ACTIVE' };
      }

      return { success: true, connection: assignedConn, source: 'exclusive' };
    }

    // Step 2: Fallback to Organization Default (Only when no exclusive assignment exists)
    const org = await this.orgRepo.getOrganizationById(orgId);
    if (!org || !org.default_whatsapp_connection_id) {
      return { success: false, code: 'NO_CONNECTION_AVAILABLE' };
    }

    const defaultConn = await this.connectionRepo.getConnectionById(org.default_whatsapp_connection_id);
    if (!defaultConn || defaultConn.organization_id !== orgId) {
      return { success: false, code: 'NO_CONNECTION_AVAILABLE' };
    }

    if (defaultConn.status !== 'connected') {
      return { success: false, code: 'CONNECTION_NOT_ACTIVE' };
    }

    if (!isProviderIdentityMaterialized(defaultConn)) {
      return { success: false, code: 'CONNECTION_NOT_ACTIVE' };
    }

    const claimId = getClaimId(defaultConn.provider, defaultConn.provider_phone_number_id!);
    const claim = await this.claimRepo.getClaim(claimId);
    if (!claim || claim.connection_id !== defaultConn.id || claim.organization_id !== orgId) {
      return { success: false, code: 'CONNECTION_NOT_ACTIVE' };
    }

    return { success: true, connection: defaultConn, source: 'default' };
  }

  async getMinistryWhatsAppStatus(ministryId: string): Promise<MinistryWhatsAppStatusDto> {
    const ministry = await this.ministryRepo.findById(ministryId);
    if (!ministry) {
      throw new AppError(404, 'Ministério não encontrado.');
    }

    if (!ministry.organization_id) {
      return {
        hasOrganization: false,
        organizationId: null,
        isConfigured: false,
        isConnected: false,
        source: 'none',
        connectionId: null,
        displayName: null,
        phoneNumber: null,
        connectionAccessMode: 'normal',
        canSendMessages: false,
      };
    }

    const orgId = ministry.organization_id;
    const capacity = await this.getOrganizationCapacityUsage(orgId);
    const resolution = await this.resolveWhatsAppConnection(ministryId);

    if (resolution.success && resolution.connection) {
      return {
        hasOrganization: true,
        organizationId: orgId,
        isConfigured: true,
        isConnected: resolution.connection.status === 'connected',
        source: resolution.source || 'default',
        connectionId: resolution.connection.id,
        displayName: resolution.connection.display_name,
        phoneNumber: resolution.connection.phone_number,
        connectionAccessMode: capacity.connectionAccessMode,
        canSendMessages: capacity.canSendMessages,
      };
    }

    // Check if configured but inactive
    const assignedConn = await this.connectionRepo.findAssignedConnectionForMinistry(orgId, ministryId);
    if (assignedConn) {
      return {
        hasOrganization: true,
        organizationId: orgId,
        isConfigured: true,
        isConnected: false,
        source: 'exclusive',
        connectionId: assignedConn.id,
        displayName: assignedConn.display_name,
        phoneNumber: assignedConn.phone_number,
        connectionAccessMode: capacity.connectionAccessMode,
        canSendMessages: false,
      };
    }

    const org = await this.orgRepo.getOrganizationById(orgId);
    if (org && org.default_whatsapp_connection_id) {
      const defaultConn = await this.connectionRepo.getConnectionById(org.default_whatsapp_connection_id);
      if (defaultConn) {
        return {
          hasOrganization: true,
          organizationId: orgId,
          isConfigured: true,
          isConnected: false,
          source: 'default',
          connectionId: defaultConn.id,
          displayName: defaultConn.display_name,
          phoneNumber: defaultConn.phone_number,
          connectionAccessMode: capacity.connectionAccessMode,
          canSendMessages: false,
        };
      }
    }

    return {
      hasOrganization: true,
      organizationId: orgId,
      isConfigured: false,
      isConnected: false,
      source: 'none',
      connectionId: null,
      displayName: null,
      phoneNumber: null,
      connectionAccessMode: capacity.connectionAccessMode,
      canSendMessages: false,
    };
  }

  // Internal Domain Methods (For Phase 7D / Internal tests)
  async materializeProviderIdentity(
    orgId: string,
    connectionId: string,
    data: {
      phoneNumber: string;
      providerWabaId: string;
      providerPhoneNumberId: string;
    }
  ): Promise<void> {
    return await db.runTransaction(async (tx) => {
      const connRef = db.collection('whatsapp_connections').doc(connectionId);
      const connDoc = await tx.get(connRef);
      if (!connDoc.exists) {
        throw new AppError(404, 'Conexão não encontrada.');
      }
      const conn = connDoc.data() as WhatsAppConnectionRecord;
      if (conn.organization_id !== orgId) {
        throw new AppError(404, 'Conexão não encontrada nesta organização.');
      }

      const claimId = getClaimId(conn.provider, data.providerPhoneNumberId);
      await this.claimRepo.acquireClaimInTransaction(tx, {
        id: claimId,
        provider: 'meta_cloud_api',
        provider_phone_number_id: data.providerPhoneNumberId,
        organization_id: orgId,
        connection_id: connectionId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      tx.update(connRef, {
        phone_number: data.phoneNumber,
        provider_waba_id: data.providerWabaId,
        provider_phone_number_id: data.providerPhoneNumberId,
        updated_at: new Date().toISOString(),
      });
    });
  }

  async transitionConnectionStatus(
    orgId: string,
    connectionId: string,
    targetStatus: WhatsAppConnectionStatus,
    reason?: string | null
  ): Promise<void> {
    const conn = await this.connectionRepo.getConnectionById(connectionId);
    if (!conn || conn.organization_id !== orgId) {
      throw new AppError(404, 'Conexão não encontrada nesta organização.');
    }

    validateConnectionTransition(conn, targetStatus);

    // If connecting to connected, verify claim ownership
    if (targetStatus === 'connected') {
      if (!isProviderIdentityMaterialized(conn)) {
        throw new AppError(400, 'Conexão deve ter identidade de provedor materializada para conectar.', {
          code: 'CONNECTION_NOT_MATERIALIZED',
        });
      }
      const claimId = getClaimId(conn.provider, conn.provider_phone_number_id!);
      const claim = await this.claimRepo.getClaim(claimId);
      if (!claim || claim.connection_id !== conn.id || claim.organization_id !== orgId) {
        throw new AppError(400, 'Claim de identidade do provedor inválido ou ausente.', {
          code: 'INVALID_PROVIDER_CLAIM',
        });
      }
    }

    await this.connectionRepo.setConnectionStatus(orgId, connectionId, targetStatus, reason);
  }
}
