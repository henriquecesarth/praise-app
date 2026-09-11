import { db } from '../../lib/firebase';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { AppError } from '../../middleware/error-handler';
import { config } from '../../config/unifiedConfig';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppMinistryAssignmentClaimRepository } from '../../repositories/WhatsAppMinistryAssignmentClaimRepository';
import { WhatsAppOnboardingSessionRepository } from '../../repositories/WhatsAppOnboardingSessionRepository';
import { MetaWhatsAppProvider } from './meta-whatsapp.provider';
import { WhatsAppEncryptionService } from './whatsapp-encryption.service';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { MinistrySubscriptionRecord } from '../subscriptions/subscription.types';
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
  StartWhatsAppOnboardingInput,
  StartWhatsAppOnboardingResponseDto,
  CompleteWhatsAppOnboardingInput,
  WhatsAppOnboardingSessionRecord,
  WhatsAppConnectionSecretRecord,
  WhatsAppAuthorizedPhoneNumber,
  WhatsAppOAuthResult,
  WhatsAppProvider,
  normalizeToE164,
  isProviderIdentityMaterialized,
  getClaimId,
  getMinistryAssignmentClaimId,
  WhatsAppMinistryAssignmentClaimRecord,
} from './whatsapp.types';
import { OrganizationRecord } from '../organizations/organization.types';

export class WhatsAppConnectionService {
  constructor(
    private readonly connectionRepo: WhatsAppConnectionRepository = new WhatsAppConnectionRepository(),
    private readonly secretRepo: WhatsAppConnectionSecretRepository = new WhatsAppConnectionSecretRepository(),
    private readonly claimRepo: WhatsAppProviderIdentityClaimRepository = new WhatsAppProviderIdentityClaimRepository(),
    private readonly orgRepo: OrganizationRepository = new OrganizationRepository(),
    private readonly subService: SubscriptionService = new SubscriptionService(),
    private readonly ministryRepo: MinistryRepository = new MinistryRepository(),
    private readonly assignmentClaimRepo: WhatsAppMinistryAssignmentClaimRepository = new WhatsAppMinistryAssignmentClaimRepository(),
    private readonly onboardingSessionRepo: WhatsAppOnboardingSessionRepository = new WhatsAppOnboardingSessionRepository(),
    private readonly metaProvider: WhatsAppProvider = new MetaWhatsAppProvider(),
    private readonly encryptionService: WhatsAppEncryptionService = new WhatsAppEncryptionService()
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

    if (input.displayName !== undefined) {
      const trimmed = input.displayName.trim();
      if (!trimmed || trimmed.length > 100) {
        throw new AppError(400, 'Nome de exibição deve ter entre 1 e 100 caracteres.');
      }
    }

    const currentConn = await this.connectionRepo.getConnectionById(connectionId);
    if (!currentConn || currentConn.organization_id !== orgId) {
      throw new AppError(404, 'Conexão não encontrada nesta organização.');
    }

    if (currentConn.status === 'disconnected') {
      throw new AppError(400, 'Conexão desconectada não pode ser modificada.', {
        code: 'CONNECTION_DISCONNECTED',
      });
    }

    const currentOrg = await this.orgRepo.getOrganizationById(orgId);
    if (!currentOrg) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    // Compute desired final state before any mutation
    const currentIsDefault = currentOrg.default_whatsapp_connection_id === connectionId;
    const finalIsDefault =
      input.isOrganizationDefault !== undefined ? input.isOrganizationDefault : currentIsDefault;
    const finalAssignedMinistryId =
      input.assignedMinistryId !== undefined ? input.assignedMinistryId : currentConn.assigned_ministry_id;

    // Validate desired state mutual exclusivity BEFORE ANY WRITES
    if (finalIsDefault === true && finalAssignedMinistryId !== null) {
      if (
        input.isOrganizationDefault === true &&
        input.assignedMinistryId !== undefined &&
        input.assignedMinistryId !== null
      ) {
        throw new AppError(
          400,
          'CANNOT_COMBINE_DEFAULT_AND_EXCLUSIVE_ASSIGNMENT: Uma conexão não pode ser simultaneamente padrão da organização e atribuída a um ministério.',
          { code: 'CANNOT_COMBINE_DEFAULT_AND_EXCLUSIVE_ASSIGNMENT' }
        );
      } else if (input.isOrganizationDefault === true) {
        throw new AppError(
          400,
          'CANNOT_SET_ASSIGNED_CONNECTION_AS_DEFAULT: Uma conexão atribuída exclusivamente a um ministério não pode ser definida como padrão da organização.',
          { code: 'CANNOT_SET_ASSIGNED_CONNECTION_AS_DEFAULT' }
        );
      } else {
        throw new AppError(
          400,
          'CANNOT_ASSIGN_DEFAULT_CONNECTION: A conexão padrão da organização não pode ser atribuída exclusivamente a um ministério.',
          { code: 'CANNOT_ASSIGN_DEFAULT_CONNECTION' }
        );
      }
    }

    // Atomic transaction for all configuration mutations
    await db.runTransaction(async (tx) => {
      // 1. READS FIRST (Strict Firestore rule: all reads before any writes)
      const orgRef = db.collection('organizations').doc(orgId);
      const orgDoc = await tx.get(orgRef);
      if (!orgDoc.exists) {
        throw new AppError(404, 'Organização não encontrada.');
      }
      const orgData = orgDoc.data() as OrganizationRecord;

      const connRef = db.collection('whatsapp_connections').doc(connectionId);
      const connDoc = await tx.get(connRef);
      if (!connDoc.exists) {
        throw new AppError(404, 'Conexão não encontrada nesta organização.');
      }
      const connData = connDoc.data() as WhatsAppConnectionRecord;
      if (connData.organization_id !== orgId) {
        throw new AppError(404, 'Conexão não encontrada nesta organização.');
      }
      if (connData.status === 'disconnected') {
        throw new AppError(400, 'Conexão desconectada não pode ser modificada.', {
          code: 'CONNECTION_DISCONNECTED',
        });
      }

      // If configuration involves active role (becoming/remaining default or assigned), check connection status
      if (finalIsDefault || finalAssignedMinistryId !== null) {
        if (connData.status !== 'connected') {
          throw new AppError(
            400,
            'CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION: Apenas conexões ativas e conectadas podem ser configuradas como padrão ou atribuídas.',
            { code: 'CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION' }
          );
        }
        if (!isProviderIdentityMaterialized(connData)) {
          throw new AppError(
            400,
            'CONNECTION_NOT_MATERIALIZED: Conexão deve ter identidade de provedor materializada.',
            { code: 'CONNECTION_NOT_MATERIALIZED' }
          );
        }

        // Validate provider claim ownership
        const providerClaimId = getClaimId(connData.provider, connData.provider_phone_number_id!);
        const providerClaimRef = db.collection('whatsapp_provider_identity_claims').doc(providerClaimId);
        const providerClaimDoc = await tx.get(providerClaimRef);
        if (
          !providerClaimDoc.exists ||
          providerClaimDoc.data()?.connection_id !== connectionId ||
          providerClaimDoc.data()?.organization_id !== orgId
        ) {
          throw new AppError(400, 'INVALID_PROVIDER_CLAIM: Claim de identidade do provedor inválido ou ausente.', {
            code: 'INVALID_PROVIDER_CLAIM',
          });
        }
      }

      // If assigning to a ministry: read target ministry and assignment claim
      let ministryDoc: FirebaseFirestore.DocumentSnapshot | undefined;
      let assignmentClaimRef: FirebaseFirestore.DocumentReference | undefined;
      let assignmentClaimDoc: FirebaseFirestore.DocumentSnapshot | undefined;

      if (finalAssignedMinistryId !== null) {
        const ministryRef = db.collection('ministries').doc(finalAssignedMinistryId);
        ministryDoc = await tx.get(ministryRef);
        if (!ministryDoc.exists || ministryDoc.data()?.organization_id !== orgId) {
          throw new AppError(404, 'Ministério não encontrado nesta organização.');
        }

        const assignmentClaimId = getMinistryAssignmentClaimId(orgId, finalAssignedMinistryId);
        assignmentClaimRef = db.collection('whatsapp_ministry_assignment_claims').doc(assignmentClaimId);
        assignmentClaimDoc = await tx.get(assignmentClaimRef);

        if (assignmentClaimDoc.exists) {
          const existingClaim = assignmentClaimDoc.data() as WhatsAppMinistryAssignmentClaimRecord;
          if (existingClaim.connection_id !== connectionId) {
            throw new AppError(
              409,
              'MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION: Este ministério já possui uma conexão WhatsApp atribuída.',
              { code: 'MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION' }
            );
          }
        }
      }

      // If unassigning from previous ministry (e.g. finalAssignedMinistryId !== connData.assigned_ministry_id)
      let prevAssignmentClaimRef: FirebaseFirestore.DocumentReference | undefined;
      let prevAssignmentClaimDoc: FirebaseFirestore.DocumentSnapshot | undefined;

      if (connData.assigned_ministry_id && connData.assigned_ministry_id !== finalAssignedMinistryId) {
        const prevClaimId = getMinistryAssignmentClaimId(orgId, connData.assigned_ministry_id);
        prevAssignmentClaimRef = db.collection('whatsapp_ministry_assignment_claims').doc(prevClaimId);
        prevAssignmentClaimDoc = await tx.get(prevAssignmentClaimRef);
      }

      // 2. WRITE PHASE (Executed strictly if all reads passed)
      const now = new Date().toISOString();
      const connUpdates: Partial<WhatsAppConnectionRecord> = { updated_at: now };

      if (input.displayName !== undefined) {
        connUpdates.display_name = input.displayName.trim();
      }

      if (connData.assigned_ministry_id !== finalAssignedMinistryId) {
        connUpdates.assigned_ministry_id = finalAssignedMinistryId;
      }

      tx.update(connRef, connUpdates);

      // Default pointer on organization
      if (finalIsDefault && orgData.default_whatsapp_connection_id !== connectionId) {
        tx.update(orgRef, {
          default_whatsapp_connection_id: connectionId,
          updated_at: now,
        });
      } else if (!finalIsDefault && orgData.default_whatsapp_connection_id === connectionId) {
        tx.update(orgRef, {
          default_whatsapp_connection_id: null,
          updated_at: now,
        });
      }

      // Acquire or update assignment claim
      if (finalAssignedMinistryId !== null && assignmentClaimRef) {
        const claimRecord: WhatsAppMinistryAssignmentClaimRecord = {
          id: assignmentClaimRef.id,
          organization_id: orgId,
          ministry_id: finalAssignedMinistryId,
          connection_id: connectionId,
          created_at: assignmentClaimDoc?.exists ? assignmentClaimDoc.data()?.created_at : now,
          updated_at: now,
        };
        tx.set(assignmentClaimRef, claimRecord);
      }

      // Release previous assignment claim if owned
      if (prevAssignmentClaimRef && prevAssignmentClaimDoc?.exists) {
        if (
          prevAssignmentClaimDoc.data()?.connection_id === connectionId &&
          prevAssignmentClaimDoc.data()?.organization_id === orgId &&
          prevAssignmentClaimDoc.data()?.ministry_id === connData.assigned_ministry_id
        ) {
          tx.delete(prevAssignmentClaimRef);
        }
      }
    });

    const updatedConn = await this.connectionRepo.getConnectionById(connectionId);
    const updatedOrg = await this.orgRepo.getOrganizationById(orgId);
    return this.mapToDto(updatedConn!, updatedOrg ? updatedOrg.default_whatsapp_connection_id : null);
  }

  async setOrganizationDefault(orgId: string, connectionId: string, actorUserId: string): Promise<void> {
    await this.updateConnection(orgId, connectionId, { isOrganizationDefault: true }, actorUserId);
  }

  async clearOrganizationDefault(orgId: string, connectionId?: string, actorUserId?: string): Promise<void> {
    if (connectionId && actorUserId) {
      await this.updateConnection(orgId, connectionId, { isOrganizationDefault: false }, actorUserId);
      return;
    }

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
    await this.updateConnection(orgId, connectionId, { assignedMinistryId: ministryId }, actorUserId);
  }

  async unassignMinistry(orgId: string, connectionId: string, actorUserId: string): Promise<void> {
    await this.updateConnection(orgId, connectionId, { assignedMinistryId: null }, actorUserId);
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

  async startOnboarding(
    orgId: string,
    actorUserId: string,
    input: StartWhatsAppOnboardingInput
  ): Promise<StartWhatsAppOnboardingResponseDto> {
    const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
    if (!member) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    if (member.role !== 'admin' && member.role !== 'owner') {
      throw new AppError(403, 'Apenas administradores da organização podem iniciar o onboarding do WhatsApp.');
    }

    const fbAppId = config.metaAppId || process.env.META_APP_ID;
    const configId = config.metaConfigId || process.env.META_CONFIG_ID || '';

    if (!fbAppId) {
      throw new AppError(
        500,
        'WHATSAPP_PROVIDER_CONFIG_INVALID_OR_MISSING: Meta App ID não configurado no servidor.',
        { code: 'WHATSAPP_PROVIDER_CONFIG_INVALID_OR_MISSING' }
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();

    const result = await db.runTransaction(async (tx) => {
      // 1. Read organizations.doc(orgId)
      const orgRef = db.collection('organizations').doc(orgId);
      const orgDoc = await tx.get(orgRef);
      if (!orgDoc.exists) {
        throw new AppError(404, 'Organização não encontrada.');
      }
      const org = { id: orgDoc.id, ...orgDoc.data() } as OrganizationRecord;

      // 2. Read ministry_subscriptions.doc(billingAnchorMinistryId)
      const subRef = db.collection('ministry_subscriptions').doc(org.billing_anchor_ministry_id);
      const subDoc = await tx.get(subRef);
      const sub = subDoc.exists ? ({ id: subDoc.id, ...subDoc.data() } as MinistrySubscriptionRecord) : null;

      // Evaluate capacity
      const capacity = SubscriptionService.evaluateOrganizationWhatsAppCapacity(org, sub, now);
      if (!capacity.enabled || capacity.billingAccessMode !== 'normal') {
        throw new AppError(
          403,
          'A organização não possui capacidade comercial disponível para WhatsApp no plano atual.',
          { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' }
        );
      }

      // 3. Query whatsapp_connections where organization_id == orgId
      const query = db
        .collection('whatsapp_connections')
        .where('organization_id', '==', orgId)
        .where('status', 'in', ['pending', 'connecting', 'connected', 'error', 'disabled_by_user']);

      const snapshot = await tx.get(query);

      let activeConfiguredCount = 0;
      for (const doc of snapshot.docs) {
        const conn = doc.data() as WhatsAppConnectionRecord;
        if (conn.status === 'pending') {
          const isExpired = conn.pending_expires_at && new Date(conn.pending_expires_at) <= now;
          if (isExpired) {
            tx.update(doc.ref, {
              status: 'disconnected',
              status_reason: 'PENDING_EXPIRED',
              pending_expires_at: null,
              assigned_ministry_id: null,
              updated_at: nowIso,
            });
            continue;
          }
        }
        activeConfiguredCount++;
      }

      // 4. Capacity Gate
      if (activeConfiguredCount >= capacity.totalAllowedConnections) {
        throw new AppError(
          403,
          'Limite de capacidade comercial de conexões WhatsApp atingido para a organização.',
          { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' }
        );
      }

      // 5. Shared Write Contention on organizations.doc(orgId) (DEC-7D-07)
      tx.update(orgRef, {
        whatsapp_reservation_sequence: FieldValue.increment(1),
        updated_at: nowIso,
      });

      // 6. Create pending connection
      const connectionId = `wac_${crypto.randomBytes(12).toString('hex')}`;
      const sessionId = `wabs_${crypto.randomBytes(12).toString('hex')}`;
      const rawNonce = crypto.randomBytes(32).toString('hex');
      const stateNonceHash = crypto.createHash('sha256').update(rawNonce).digest('hex');
      const pendingExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const sessionExpiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();

      const connectionRecord: WhatsAppConnectionRecord = {
        id: connectionId,
        organization_id: orgId,
        display_name: input.displayName?.trim() || 'Linha WhatsApp',
        phone_number: null,
        provider: 'meta_cloud_api',
        provider_waba_id: null,
        provider_phone_number_id: null,
        status: 'pending',
        status_reason: null,
        assigned_ministry_id: null,
        created_by_user_id: actorUserId,
        pending_expires_at: pendingExpiresAt,
        last_connected_at: null,
        last_health_check_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      tx.set(db.collection('whatsapp_connections').doc(connectionId), connectionRecord);

      // 7. Create onboarding session document
      const sessionRecord: WhatsAppOnboardingSessionRecord = {
        id: sessionId,
        organization_id: orgId,
        connection_id: connectionId,
        actor_user_id: actorUserId,
        state_nonce_hash: stateNonceHash,
        status: 'active',
        expires_at: sessionExpiresAt,
        consumed_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };
      tx.set(db.collection('whatsapp_onboarding_sessions').doc(sessionId), sessionRecord);

      return {
        sessionId,
        connectionId,
        stateNonce: rawNonce,
        fbAppId,
        configId,
        expiresAt: sessionExpiresAt,
      };
    });

    return result;
  }

  private async releaseTerminalPendingReservation(
    orgId: string,
    sessionId: string,
    connectionId: string,
    terminalSessionStatus: 'failed' | 'expired',
    reason: string
  ): Promise<void> {
    const nowIso = new Date().toISOString();
    await db.runTransaction(async (tx) => {
      const sessionRef = db.collection('whatsapp_onboarding_sessions').doc(sessionId);
      const connRef = db.collection('whatsapp_connections').doc(connectionId);

      const connDoc = await tx.get(connRef);
      if (connDoc.exists) {
        const conn = connDoc.data() as WhatsAppConnectionRecord;
        if (conn.organization_id === orgId && (conn.status === 'pending' || conn.status === 'connecting')) {
          tx.update(connRef, {
            status: 'disconnected',
            status_reason: reason,
            pending_expires_at: null,
            assigned_ministry_id: null,
            updated_at: nowIso,
          });
        }
      }

      tx.update(sessionRef, {
        status: terminalSessionStatus,
        updated_at: nowIso,
      });
    });
  }

  async completeOnboarding(
    orgId: string,
    actorUserId: string,
    input: CompleteWhatsAppOnboardingInput
  ): Promise<WhatsAppConnectionDto> {
    const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
    if (!member) {
      throw new AppError(404, 'Organização não encontrada.');
    }

    if (member.role !== 'admin' && member.role !== 'owner') {
      throw new AppError(403, 'Apenas administradores da organização podem completar o onboarding.');
    }

    // Step 1: Session Lookup & Verification
    const session = await this.onboardingSessionRepo.getSessionById(input.sessionId);
    if (!session || session.organization_id !== orgId) {
      throw new AppError(400, 'Sessão de onboarding não encontrada ou expirada.', {
        code: 'ONBOARDING_SESSION_EXPIRED',
      });
    }

    if (session.status === 'consumed') {
      throw new AppError(409, 'Sessão de onboarding já consumida.', {
        code: 'ONBOARDING_SESSION_ALREADY_CONSUMED',
      });
    }

    if (session.status !== 'active' && session.status !== 'credential_staged') {
      throw new AppError(400, 'Sessão de onboarding inválida ou expirada.', {
        code: 'ONBOARDING_SESSION_EXPIRED',
      });
    }

    const now = new Date();
    if (new Date(session.expires_at) <= now) {
      await this.releaseTerminalPendingReservation(
        orgId,
        session.id,
        session.connection_id,
        'expired',
        'ONBOARDING_SESSION_EXPIRED'
      );
      throw new AppError(400, 'Sessão de onboarding expirada.', {
        code: 'ONBOARDING_SESSION_EXPIRED',
      });
    }

    // Step 2: Constant-Time Nonce Check (CSRF security)
    const incomingNonceHash = crypto.createHash('sha256').update(input.stateNonce).digest('hex');
    const incomingBuffer = Buffer.from(incomingNonceHash, 'hex');
    const storedBuffer = Buffer.from(session.state_nonce_hash, 'hex');
    const isValidNonce =
      incomingBuffer.length === storedBuffer.length && crypto.timingSafeEqual(incomingBuffer, storedBuffer);

    if (!isValidNonce) {
      await this.releaseTerminalPendingReservation(
        orgId,
        session.id,
        session.connection_id,
        'failed',
        'INVALID_ONBOARDING_STATE'
      );
      throw new AppError(403, 'Estado de onboarding inválido (falha na validação CSRF).', {
        code: 'INVALID_ONBOARDING_STATE',
      });
    }

    // Step 3: Entitlement Downgrade Gate (DEC-7D-16)
    const capacity = await this.subService.getOrganizationWhatsAppCapacity(orgId);
    if (!capacity.enabled || capacity.billingAccessMode === 'suspended') {
      await this.releaseTerminalPendingReservation(
        orgId,
        session.id,
        session.connection_id,
        'failed',
        'SUBSCRIPTION_RESTRICTED'
      );
      throw new AppError(403, 'A assinatura da organização está suspensa ou sem capacidade WhatsApp.', {
        code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED',
      });
    }

    // Step 4: Credential Staging / Reuse (DEC-7D-20)
    let accessToken: string;
    if (session.status === 'active') {
      let oauthResult: WhatsAppOAuthResult;
      try {
        oauthResult = await this.metaProvider.exchangeOAuthCode(input.code);
      } catch (err: any) {
        await this.releaseTerminalPendingReservation(
          orgId,
          session.id,
          session.connection_id,
          'failed',
          'OAUTH_EXCHANGE_FAILED'
        );
        throw new AppError(400, `Falha na troca do código OAuth do WhatsApp: ${err.message || 'Erro do provedor'}`, {
          code: 'WHATSAPP_OAUTH_EXCHANGE_FAILED',
          cause: err,
        });
      }
      accessToken = oauthResult.accessToken;

      const encrypted = this.encryptionService.encryptToken(accessToken, orgId, session.connection_id);
      const secretRecord: WhatsAppConnectionSecretRecord = {
        id: session.connection_id,
        organization_id: orgId,
        connection_id: session.connection_id,
        encrypted_access_token: encrypted.encryptedAccessToken,
        iv: encrypted.iv,
        auth_tag: encrypted.authTag,
        key_version: encrypted.keyVersion,
        token_type: 'business_token',
        expires_at: oauthResult.expiresAt,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await this.secretRepo.setSecret(secretRecord);

      await this.onboardingSessionRepo.updateSession(session.id, { status: 'credential_staged' });
    } else {
      const existingSecret = await this.secretRepo.getSecret(orgId, session.connection_id);
      if (!existingSecret) {
        await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
        throw new AppError(400, 'Credencial em estágio não encontrada.', {
          code: 'ONBOARDING_SESSION_EXPIRED',
        });
      }
      accessToken = this.encryptionService.decryptToken(existingSecret, orgId, session.connection_id);
    }

    // Step 5: Server-Side Messaging Account Authority Check (DEC-7D-18)
    let isWabaAuthorized = false;
    try {
      isWabaAuthorized = await this.metaProvider.verifyMessagingAccountAccess(accessToken, input.wabaId);
    } catch {
      isWabaAuthorized = false;
    }

    if (!isWabaAuthorized) {
      await this.secretRepo.deleteSecret(orgId, session.connection_id);
      await this.connectionRepo.updateConnection(orgId, session.connection_id, {
        status: 'error',
        status_reason: 'UNAUTHORIZED_WABA_ACCESS',
      });
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      throw new AppError(403, 'Acesso não autorizado à conta do WhatsApp fornecida.', {
        code: 'UNAUTHORIZED_WABA_ACCESS',
      });
    }

    // Step 6: Edge Operational Authorization Verification (DEC-7D-18)
    let phoneNumbers: WhatsAppAuthorizedPhoneNumber[] = [];
    try {
      phoneNumbers = await this.metaProvider.listAuthorizedPhoneNumbers(accessToken, input.wabaId);
    } catch {
      await this.secretRepo.deleteSecret(orgId, session.connection_id);
      await this.connectionRepo.updateConnection(orgId, session.connection_id, {
        status: 'error',
        status_reason: 'PHONE_NOT_IN_WABA',
      });
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      throw new AppError(400, 'O número de telefone informado não pertence à conta WhatsApp.', {
        code: 'PHONE_NOT_IN_WABA',
      });
    }

    const matchingPhone = phoneNumbers.find((p) => p.id === input.phoneNumberId);
    if (!matchingPhone) {
      await this.secretRepo.deleteSecret(orgId, session.connection_id);
      await this.connectionRepo.updateConnection(orgId, session.connection_id, {
        status: 'error',
        status_reason: 'PHONE_NOT_IN_WABA',
      });
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      throw new AppError(400, 'O número de telefone informado não pertence à conta WhatsApp.', {
        code: 'PHONE_NOT_IN_WABA',
      });
    }

    // Step 7: Phone Normalization
    let displayPhone = matchingPhone.displayPhoneNumber;
    if (!displayPhone) {
      const details = await this.metaProvider.getPhoneNumberDetails(accessToken, input.phoneNumberId);
      displayPhone = details.displayPhoneNumber;
    }
    const normalizedPhoneNumber = normalizeToE164(displayPhone);

    // Step 8: Ephemeral Two-Step PIN Registration (DEC-7D-15)
    if (input.pin) {
      try {
        await this.metaProvider.registerPhoneNumber(accessToken, input.phoneNumberId, input.pin);
      } catch (err: any) {
        throw new AppError(
          502,
          `Falha no registro do número com PIN no provedor: ${err.message || 'Erro no provedor'}`,
          {
            code: 'PROVIDER_REGISTRATION_FAILED',
            cause: err,
          }
        );
      }
    }

    // Step 9: Messaging Account Webhook Subscription
    try {
      await this.metaProvider.subscribeMessagingAccountApps(accessToken, input.wabaId);
    } catch (err: any) {
      throw new AppError(
        502,
        `Falha na assinatura de webhooks da conta no provedor: ${err.message || 'Erro no provedor'}`,
        {
          code: 'PROVIDER_SUBSCRIPTION_FAILED',
          cause: err,
        }
      );
    }

    // Step 10: Atomic Materialization Transaction (Inside Firestore Transaction) (DEC-7D-21)
    const claimId = getClaimId('meta_cloud_api', input.phoneNumberId);
    const nowIso = new Date().toISOString();

    try {
      await db.runTransaction(async (tx) => {
        // 10a. Read organization doc
        const orgRef = db.collection('organizations').doc(orgId);
        const orgDoc = await tx.get(orgRef);
        if (!orgDoc.exists) {
          throw new AppError(404, 'Organização não encontrada.');
        }
        const org = { id: orgDoc.id, ...orgDoc.data() } as OrganizationRecord;

        // 10b. Read ministry_subscriptions doc
        const subRef = db.collection('ministry_subscriptions').doc(org.billing_anchor_ministry_id);
        const subDoc = await tx.get(subRef);
        const sub = subDoc.exists ? ({ id: subDoc.id, ...subDoc.data() } as MinistrySubscriptionRecord) : null;

        // 10c. Read connection doc
        const connRef = db.collection('whatsapp_connections').doc(session.connection_id);
        const connDoc = await tx.get(connRef);
        if (!connDoc.exists) {
          throw new AppError(404, 'Conexão não encontrada.');
        }
        const conn = connDoc.data() as WhatsAppConnectionRecord;
        if (conn.organization_id !== orgId) {
          throw new AppError(404, 'Conexão não encontrada nesta organização.');
        }
        if (conn.status !== 'pending' && conn.status !== 'connecting') {
          throw new AppError(400, `Conexão em estado inválido para materialização: ${conn.status}`);
        }

        // 10d. Read claim doc
        const claimRef = db.collection('whatsapp_provider_identity_claims').doc(claimId);
        const claimDoc = await tx.get(claimRef);

        // 10e. Read configured connections for orgId (bounded by CONFIG_CONSUMING_STATUSES)
        const connectionsQuery = db
          .collection('whatsapp_connections')
          .where('organization_id', '==', orgId)
          .where('status', 'in', ['pending', 'connecting', 'connected', 'error', 'disabled_by_user']);
        const connectionsSnapshot = await tx.get(connectionsQuery);

        // All reads complete. Evaluate transactional commercial capacity & access mode
        const capacity = SubscriptionService.evaluateOrganizationWhatsAppCapacity(org, sub, new Date());
        if (!capacity.enabled || capacity.billingAccessMode === 'suspended') {
          throw new AppError(403, 'A assinatura da organização está suspensa ou sem capacidade WhatsApp.', {
            code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED',
          });
        }

        let activeConfiguredCount = 0;
        for (const doc of connectionsSnapshot.docs) {
          const c = doc.data() as WhatsAppConnectionRecord;
          if (c.status === 'pending') {
            const isExpired = c.pending_expires_at && new Date(c.pending_expires_at) <= new Date();
            if (isExpired && doc.id !== session.connection_id) {
              continue;
            }
          }
          activeConfiguredCount++;
        }

        if (activeConfiguredCount > capacity.totalAllowedConnections) {
          throw new AppError(
            403,
            'Limite de capacidade comercial de conexões WhatsApp atingido para a organização.',
            { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' }
          );
        }

        if (claimDoc.exists) {
          const existingClaim = claimDoc.data();
          if (existingClaim?.connection_id !== session.connection_id) {
            throw new AppError(409, 'Este número de telefone já está registrado em outra conexão.', {
              code: 'PROVIDER_PHONE_ALREADY_REGISTERED',
            });
          }
        } else {
          tx.set(claimRef, {
            id: claimId,
            provider: 'meta_cloud_api',
            provider_phone_number_id: input.phoneNumberId,
            organization_id: orgId,
            connection_id: session.connection_id,
            created_at: nowIso,
            updated_at: nowIso,
          });
        }

        // 10f. Update connection
        tx.update(connRef, {
          status: 'connected',
          phone_number: normalizedPhoneNumber,
          provider_waba_id: input.wabaId,
          provider_phone_number_id: input.phoneNumberId,
          last_connected_at: nowIso,
          status_reason: null,
          pending_expires_at: null,
          updated_at: nowIso,
        });

        // 10g. Update session to consumed
        const sessionRef = db.collection('whatsapp_onboarding_sessions').doc(session.id);
        tx.update(sessionRef, {
          status: 'consumed',
          consumed_at: nowIso,
          updated_at: nowIso,
        });
      });
    } catch (err: any) {
      if (err?.code === 'PROVIDER_PHONE_ALREADY_REGISTERED' || (err instanceof AppError && err.statusCode === 409)) {
        await this.secretRepo.deleteSecret(orgId, session.connection_id);
        await this.connectionRepo.updateConnection(orgId, session.connection_id, {
          status: 'error',
          status_reason: 'PHONE_ALREADY_REGISTERED',
        });
        await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
        throw err;
      }
      if (
        err?.code === 'WHATSAPP_CAPACITY_LIMIT_REACHED' ||
        err?.code === 'WHATSAPP_SUBSCRIPTION_SUSPENDED' ||
        (err instanceof AppError && err.statusCode === 403)
      ) {
        await this.secretRepo.deleteSecret(orgId, session.connection_id);
        await this.connectionRepo.updateConnection(orgId, session.connection_id, {
          status: 'error',
          status_reason: 'SUBSCRIPTION_RESTRICTED',
        });
        await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
        throw err;
      }
      throw err;
    }

    const org = await this.orgRepo.getOrganizationById(orgId);
    const updatedConn = await this.connectionRepo.getConnectionById(session.connection_id);
    if (!updatedConn) {
      throw new AppError(404, 'Conexão não encontrada após conclusão.');
    }

    return this.mapToDto(updatedConn, org?.default_whatsapp_connection_id ?? null);
  }
}
