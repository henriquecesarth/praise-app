import { db } from '../../lib/firebase';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { AppError } from '../../middleware/error-handler';
import { config, requireZernioWebhookSecret } from '../../config/unifiedConfig';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppMinistryAssignmentClaimRepository } from '../../repositories/WhatsAppMinistryAssignmentClaimRepository';
import { WhatsAppOnboardingSessionRepository } from '../../repositories/WhatsAppOnboardingSessionRepository';
import { WhatsAppProviderCleanupJobRepository } from '../../repositories/WhatsAppProviderCleanupJobRepository';
import { WhatsAppWabaLifecycleLockRepository } from '../../repositories/WhatsAppWabaLifecycleLockRepository';
import { WhatsAppWabaReconciliationJobRepository } from '../../repositories/WhatsAppWabaReconciliationJobRepository';
import { WhatsAppZernioWebhookRepository } from '../../repositories/WhatsAppZernioWebhookRepository';
import { WhatsAppOutboundDispatchRepository } from '../../repositories/WhatsAppOutboundDispatchRepository';
import { WhatsAppWabaCoordinatorService } from './whatsapp-waba-coordinator.service';
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
  WhatsAppProviderProgress,
  normalizeToE164,
  isProviderIdentityMaterialized,
  getClaimId,
  getZernioAccountClaimId,
  getZernioPhoneClaimId,
  getMinistryAssignmentClaimId,
  WhatsAppMinistryAssignmentClaimRecord,
  WhatsAppProviderCleanupJobRecord,
} from './whatsapp.types';
import { OrganizationRecord } from '../organizations/organization.types';
import { ZernioHttpClient } from './zernio-http-client';
import {
  ZernioAccount,
  ZernioWhatsAppNumberInfo,
  ZERNIO_HOSTED_ONBOARDING_SESSION_TTL_MS,
  getZernioAccountProfileId,
  mapZernioCallbackError,
  ZernioError,
  zernioAccountConnectedWebhookSchema,
  zernioAccountDisconnectedWebhookSchema,
  zernioMessageWebhookSchema,
} from './zernio.types';

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
    private readonly encryptionService: WhatsAppEncryptionService = new WhatsAppEncryptionService(),
    private readonly wabaCoordinator: WhatsAppWabaCoordinatorService = new WhatsAppWabaCoordinatorService(),
    private readonly cleanupJobRepo: WhatsAppProviderCleanupJobRepository = new WhatsAppProviderCleanupJobRepository(),
    private readonly wabaLockRepo: WhatsAppWabaLifecycleLockRepository = new WhatsAppWabaLifecycleLockRepository(),
    private readonly zernioClient: ZernioHttpClient = new ZernioHttpClient(),
    private readonly webhookRepo: WhatsAppZernioWebhookRepository = new WhatsAppZernioWebhookRepository(),
    private readonly outboundRepo: WhatsAppOutboundDispatchRepository = new WhatsAppOutboundDispatchRepository(),
    private readonly reconJobRepo: WhatsAppWabaReconciliationJobRepository = new WhatsAppWabaReconciliationJobRepository()
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

  async bindZernioProfileToConnection(
    orgId: string,
    connectionId: string,
    providerProfileId: string
  ): Promise<WhatsAppConnectionRecord> {
    return await this.connectionRepo.bindZernioProfileToConnection({
      organizationId: orgId,
      connectionId,
      providerProfileId,
    });
  }

  async materializeZernioProviderIdentity(
    orgId: string,
    connectionId: string,
    data: {
      providerProfileId: string;
      providerAccountId: string;
      phoneNumber: string;
    }
  ): Promise<WhatsAppConnectionRecord> {
    return await this.connectionRepo.materializeZernioProviderIdentity({
      organizationId: orgId,
      connectionId,
      providerProfileId: data.providerProfileId,
      providerAccountId: data.providerAccountId,
      phoneNumber: data.phoneNumber,
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
      if (conn.provider === 'zernio') {
        const accountClaimId = getZernioAccountClaimId(conn.provider_account_id!);
        const phoneClaimId = getZernioPhoneClaimId(conn.phone_number!);
        const [accountClaim, phoneClaim] = await Promise.all([
          this.claimRepo.getClaim(accountClaimId),
          this.claimRepo.getClaim(phoneClaimId),
        ]);
        if (!accountClaim || accountClaim.connection_id !== conn.id || accountClaim.organization_id !== orgId) {
          throw new AppError(400, 'Claim de identidade do provedor (conta Zernio) inválido ou ausente.', {
            code: 'INVALID_PROVIDER_CLAIM',
          });
        }
        if (!phoneClaim || phoneClaim.connection_id !== conn.id || phoneClaim.organization_id !== orgId) {
          throw new AppError(400, 'Claim de identidade do provedor (telefone Zernio) inválido ou ausente.', {
            code: 'INVALID_PROVIDER_CLAIM',
          });
        }
      } else {
        const claimId = getClaimId(conn.provider, conn.provider_phone_number_id!);
        const claim = await this.claimRepo.getClaim(claimId);
        if (!claim || claim.connection_id !== conn.id || claim.organization_id !== orgId) {
          throw new AppError(400, 'Claim de identidade do provedor inválido ou ausente.', {
            code: 'INVALID_PROVIDER_CLAIM',
          });
        }
      }
    }

    await this.connectionRepo.setConnectionStatus(orgId, connectionId, targetStatus, reason);
  }

  async transitionZernioConnectedAtomically(params: {
    orgId: string;
    connectionId: string;
    providerAccountId: string;
    providerProfileId?: string | null;
    phoneNumber: string;
  }): Promise<void> {
    const { orgId, connectionId, providerAccountId, phoneNumber } = params;
    const providerProfileId = params.providerProfileId ?? null;
    const now = new Date().toISOString();
    const reconJobId = `recon_zernio_${connectionId}`;

    await db.runTransaction(async (tx) => {
      // 1. ALL READS FIRST
      const connRef = db.collection('whatsapp_connections').doc(connectionId);
      const connDoc = await tx.get(connRef);
      if (!connDoc.exists) {
        throw new AppError(404, 'Conexão não encontrada nesta organização.');
      }
      const conn = connDoc.data() as WhatsAppConnectionRecord;
      if (conn.organization_id !== orgId) {
        throw new AppError(404, 'Conexão não encontrada nesta organização.');
      }

      const accountClaimId = getZernioAccountClaimId(providerAccountId);
      const phoneClaimId = getZernioPhoneClaimId(phoneNumber);
      const accountClaimRef = db.collection('whatsapp_provider_identity_claims').doc(accountClaimId);
      const phoneClaimRef = db.collection('whatsapp_provider_identity_claims').doc(phoneClaimId);

      const [accountClaimDoc, phoneClaimDoc] = await Promise.all([
        tx.get(accountClaimRef),
        tx.get(phoneClaimRef),
      ]);

      const reconJobRef = db.collection('whatsapp_waba_reconciliation_jobs').doc(reconJobId);
      const reconJobDoc = await tx.get(reconJobRef);

      // 2. VALIDATE CLAIMS
      if (
        !accountClaimDoc.exists ||
        accountClaimDoc.data()?.connection_id !== connectionId ||
        accountClaimDoc.data()?.organization_id !== orgId
      ) {
        throw new AppError(400, 'Claim de identidade do provedor (conta Zernio) inválido ou ausente.', {
          code: 'INVALID_PROVIDER_CLAIM',
        });
      }
      if (
        !phoneClaimDoc.exists ||
        phoneClaimDoc.data()?.connection_id !== connectionId ||
        phoneClaimDoc.data()?.organization_id !== orgId
      ) {
        throw new AppError(400, 'Claim de identidade do provedor (telefone Zernio) inválido ou ausente.', {
          code: 'INVALID_PROVIDER_CLAIM',
        });
      }

      // 3. ALL WRITES AFTER READS
      tx.update(connRef, {
        status: 'connected',
        status_reason: null,
        last_connected_at: now,
        pending_expires_at: null,
        updated_at: now,
      });

      if (!reconJobDoc.exists) {
        tx.set(reconJobRef, {
          id: reconJobId,
          provider: 'zernio',
          provider_waba_id: null,
          organization_id: orgId,
          connection_id: connectionId,
          provider_account_id: providerAccountId,
          provider_profile_id: providerProfileId,
          phone_number: phoneNumber,
          desired_state: 'connected',
          status: 'pending',
          attempt_count: 0,
          next_attempt_at: now,
          lease_token: null,
          lease_expires_at: null,
          last_error_code: null,
          last_error_message: null,
          consecutive_stable_observations: 0,
          last_observed_at: null,
          created_at: now,
          updated_at: now,
        });
      } else {
        const existingRecon = reconJobDoc.data() as any;
        const reconUpdates: any = {
          desired_state: 'connected',
          organization_id: orgId,
          connection_id: connectionId,
          provider_account_id: providerAccountId,
          provider_profile_id: providerProfileId ?? existingRecon.provider_profile_id,
          phone_number: phoneNumber,
          updated_at: now,
        };
        if (existingRecon.status !== 'processing') {
          reconUpdates.status = 'pending';
          reconUpdates.next_attempt_at = now;
        }
        tx.update(reconJobRef, reconUpdates);
      }
    });
  }

  async startZernioOnboarding(
    orgId: string,
    actorUserId: string,
    input: StartWhatsAppOnboardingInput
  ): Promise<StartWhatsAppOnboardingResponseDto> {
    const now = new Date();
    const nowIso = now.toISOString();

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const sessionId = `wabs_z_${tokenHash}`;
    const sessionExpiresAt = new Date(now.getTime() + ZERNIO_HOSTED_ONBOARDING_SESSION_TTL_MS).toISOString();
    const retentionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

    let targetConnectionId: string;
    let mode: 'start' | 'resume_clean' = 'start';

    if (input.resumeConnectionId) {
      targetConnectionId = input.resumeConnectionId;
      mode = 'resume_clean';
      await db.runTransaction(async (tx) => {
        const connRef = db.collection('whatsapp_connections').doc(targetConnectionId);
        const connDoc = await tx.get(connRef);
        if (!connDoc.exists) {
          throw new AppError(404, 'CONNECTION_NOT_FOUND: Conexão não encontrada.', {
            code: 'CONNECTION_NOT_FOUND',
          });
        }
        const conn = connDoc.data() as WhatsAppConnectionRecord;
        if (conn.organization_id !== orgId) {
          throw new AppError(404, 'CONNECTION_NOT_FOUND: Conexão não encontrada nesta organização.', {
            code: 'CONNECTION_NOT_FOUND',
          });
        }
        if (conn.provider !== 'zernio') {
          throw new AppError(400, 'Esta conexão não pertence ao provedor Zernio.', {
            code: 'INVALID_PROVIDER',
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
        if (conn.pending_expires_at && new Date(conn.pending_expires_at) <= now) {
          tx.update(connRef, {
            status: 'disconnected',
            status_reason: 'PENDING_EXPIRED',
            pending_expires_at: null,
            assigned_ministry_id: null,
            updated_at: nowIso,
          });
          throw new AppError(410, 'CONNECTION_RESERVATION_EXPIRED: Prazo de 24 horas da reserva expirado.', {
            code: 'CONNECTION_RESERVATION_EXPIRED',
          });
        }

        const orgRef = db.collection('organizations').doc(orgId);
        const orgDoc = await tx.get(orgRef);
        const org = { id: orgDoc.id, ...orgDoc.data() } as OrganizationRecord;

        const subRef = db.collection('ministry_subscriptions').doc(org.billing_anchor_ministry_id);
        const subDoc = await tx.get(subRef);
        const sub = subDoc.exists ? ({ id: subDoc.id, ...subDoc.data() } as MinistrySubscriptionRecord) : null;

        const capacity = SubscriptionService.evaluateOrganizationWhatsAppCapacity(org, sub, now);
        if (!capacity.enabled || capacity.billingAccessMode !== 'normal') {
          throw new AppError(403, 'A organização não possui capacidade comercial normal disponível.', {
            code: 'WHATSAPP_CAPACITY_LIMIT_REACHED',
          });
        }

        if (conn.current_onboarding_session_id) {
          const priorSessionRef = db.collection('whatsapp_onboarding_sessions').doc(conn.current_onboarding_session_id);
          tx.update(priorSessionRef, {
            status: 'expired',
            updated_at: nowIso,
          });
        }

        const sessionRecord: WhatsAppOnboardingSessionRecord = {
          id: sessionId,
          organization_id: orgId,
          connection_id: conn.id,
          actor_user_id: actorUserId,
          state_nonce_hash: tokenHash,
          status: 'active',
          provider_progress: 'none',
          expires_at: sessionExpiresAt,
          retention_expires_at: retentionExpiresAt,
          consumed_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        tx.set(db.collection('whatsapp_onboarding_sessions').doc(sessionId), sessionRecord);

        tx.update(connRef, {
          current_onboarding_session_id: sessionId,
          updated_at: nowIso,
        });
      });
    } else {
      targetConnectionId = `wac_${crypto.randomBytes(12).toString('hex')}`;
      mode = 'start';
      await db.runTransaction(async (tx) => {
        const orgRef = db.collection('organizations').doc(orgId);
        const orgDoc = await tx.get(orgRef);
        if (!orgDoc.exists) {
          throw new AppError(404, 'Organização não encontrada.');
        }
        const org = { id: orgDoc.id, ...orgDoc.data() } as OrganizationRecord;

        const subRef = db.collection('ministry_subscriptions').doc(org.billing_anchor_ministry_id);
        const subDoc = await tx.get(subRef);
        const sub = subDoc.exists ? ({ id: subDoc.id, ...subDoc.data() } as MinistrySubscriptionRecord) : null;

        const capacity = SubscriptionService.evaluateOrganizationWhatsAppCapacity(org, sub, now);
        if (!capacity.enabled || capacity.billingAccessMode !== 'normal') {
          throw new AppError(
            403,
            'A organização não possui capacidade comercial disponível para WhatsApp no plano atual.',
            { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' }
          );
        }

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

        if (activeConfiguredCount >= capacity.totalAllowedConnections) {
          throw new AppError(
            403,
            'Limite de capacidade comercial de conexões WhatsApp atingido para a organização.',
            { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' }
          );
        }

        tx.update(orgRef, {
          whatsapp_reservation_sequence: FieldValue.increment(1),
          updated_at: nowIso,
        });

        const pendingExpiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

        const connectionRecord: WhatsAppConnectionRecord = {
          id: targetConnectionId,
          organization_id: orgId,
          display_name: input.displayName?.trim() || 'Linha WhatsApp',
          phone_number: null,
          provider: 'zernio',
          provider_profile_id: null,
          provider_account_id: null,
          provider_waba_id: null,
          provider_phone_number_id: null,
          status: 'pending',
          status_reason: null,
          assigned_ministry_id: null,
          created_by_user_id: actorUserId,
          current_onboarding_session_id: sessionId,
          pending_expires_at: pendingExpiresAt,
          last_connected_at: null,
          last_health_check_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        tx.set(db.collection('whatsapp_connections').doc(targetConnectionId), connectionRecord);

        const sessionRecord: WhatsAppOnboardingSessionRecord = {
          id: sessionId,
          organization_id: orgId,
          connection_id: targetConnectionId,
          actor_user_id: actorUserId,
          state_nonce_hash: tokenHash,
          status: 'active',
          provider_progress: 'none',
          expires_at: sessionExpiresAt,
          retention_expires_at: retentionExpiresAt,
          consumed_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        };
        tx.set(db.collection('whatsapp_onboarding_sessions').doc(sessionId), sessionRecord);
      });
    }

    // Ensure dedicated Zernio profile for this connection
    const profile = await this.zernioClient.ensureProfileForConnection(targetConnectionId);

    // Bind profile to connection
    await this.connectionRepo.bindZernioProfileToConnection({
      organizationId: orgId,
      connectionId: targetConnectionId,
      providerProfileId: profile._id,
    });

    // Build callback redirect URL
    const publicApiBase = (config.billingPublicApiUrl || config.webAppUrl || '').trim().replace(/\/+$/, '');
    if (!publicApiBase) {
      throw new AppError(500, 'WHATSAPP_CONFIG_ERROR: URL pública do LouvAIO não configurada no servidor.');
    }
    const redirectUrl = `${publicApiBase}/api/v1/whatsapp/zernio/callback?token=${encodeURIComponent(rawToken)}`;

    // Call Zernio GET /v1/connect/whatsapp
    const connectRes = await this.zernioClient.getConnectUrl({
      profileId: profile._id,
      redirectUrl,
    });

    return {
      sessionId,
      connectionId: targetConnectionId,
      expiresAt: sessionExpiresAt,
      authUrl: connectRes.authUrl,
      provider: 'zernio',
      mode,
    };
  }

  async handleZernioCallback(query: Record<string, string | undefined>): Promise<string> {
    const webAppBase = (config.webAppUrl || 'http://localhost:5173').trim().replace(/\/+$/, '');

    const token = query?.token?.trim();
    if (!token || typeof token !== 'string' || token.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(token)) {
      return `${webAppBase}/whatsapp/callback?status=invalid_token`;
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const sessionId = `wabs_z_${tokenHash}`;

    const session = await this.onboardingSessionRepo.getSessionById(sessionId);
    if (!session) {
      return `${webAppBase}/whatsapp/callback?status=session_not_found`;
    }

    // Timing-safe verification of token hash
    const storedBuf = Buffer.from(session.state_nonce_hash, 'hex');
    const incomingBuf = Buffer.from(tokenHash, 'hex');
    if (storedBuf.length !== incomingBuf.length || !crypto.timingSafeEqual(storedBuf, incomingBuf)) {
      return `${webAppBase}/whatsapp/callback?status=invalid_token`;
    }

    const candidateAccountId = query?.accountId?.trim();

    // Idempotent replay check if already consumed
    if (session.status === 'consumed') {
      const conn = await this.connectionRepo.getConnectionById(session.connection_id);
      if (conn && conn.status === 'connected') {
        if (
          (candidateAccountId && conn.provider_account_id && candidateAccountId !== conn.provider_account_id) ||
          (query?.profileId && conn.provider_profile_id && query.profileId.trim() !== conn.provider_profile_id)
        ) {
          return `${webAppBase}/whatsapp/callback?status=identity_conflict`;
        }
        return `${webAppBase}/whatsapp/callback?status=success&connectionId=${encodeURIComponent(conn.id)}`;
      }
      return `${webAppBase}/whatsapp/callback?status=session_consumed`;
    }

    // Check terminal session states
    if (session.status === 'expired') {
      return `${webAppBase}/whatsapp/callback?status=session_expired`;
    }
    if (session.status === 'failed') {
      return `${webAppBase}/whatsapp/callback?status=failed`;
    }

    // Check logical expiration
    if (new Date(session.expires_at) <= new Date()) {
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'expired' });
      return `${webAppBase}/whatsapp/callback?status=session_expired`;
    }

    // Check failure hints in query
    if (
      query.connection_cancelled === 'true' ||
      query.connection_cancelled === '1'
    ) {
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      return `${webAppBase}/whatsapp/callback?status=connection_cancelled`;
    }

    if (query.error || query.error_code) {
      const rawError = query.error || query.error_code;
      const failureStatus = mapZernioCallbackError(rawError);
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      return `${webAppBase}/whatsapp/callback?status=${encodeURIComponent(failureStatus)}`;
    }

    // Candidate account validation
    if (!candidateAccountId || candidateAccountId.includes('/')) {
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      return `${webAppBase}/whatsapp/callback?status=missing_account_id`;
    }

    const conn = await this.connectionRepo.getConnectionById(session.connection_id);
    if (!conn || conn.organization_id !== session.organization_id) {
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      return `${webAppBase}/whatsapp/callback?status=connection_not_found`;
    }

    if (conn.provider !== 'zernio' || !conn.provider_profile_id) {
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      return `${webAppBase}/whatsapp/callback?status=invalid_connection_state`;
    }

    // Prechecks: fail-fast if query.connected !== 'whatsapp' or query.profileId !== conn.provider_profile_id
    if (query.connected && query.connected.trim().toLowerCase() !== 'whatsapp') {
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      return `${webAppBase}/whatsapp/callback?status=account_verification_failed`;
    }
    if (query.profileId && query.profileId.trim() !== conn.provider_profile_id) {
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      return `${webAppBase}/whatsapp/callback?status=account_verification_failed`;
    }

    // Step 1 & 2: Server-side account and number verification via shared helper
    let verified: {
      account: ZernioAccount;
      numberInfo: ZernioWhatsAppNumberInfo;
      canonicalPhone: string;
    };
    try {
      verified = await this.verifyZernioWhatsAppAccount({
        providerProfileId: conn.provider_profile_id,
        providerAccountId: candidateAccountId,
      });
    } catch (err: any) {
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      if (err?.code === 'NUMBER_VERIFICATION_FAILED') {
        return `${webAppBase}/whatsapp/callback?status=number_verification_failed`;
      }
      if (err?.code === 'INVALID_PHONE_NUMBER') {
        return `${webAppBase}/whatsapp/callback?status=invalid_phone_number`;
      }
      return `${webAppBase}/whatsapp/callback?status=account_verification_failed`;
    }

    const { canonicalPhone } = verified;

    // Step 3, 4, 5: Replay / Idempotency convergence
    const isAlreadyConnectedWithSameIdentity =
      conn.status === 'connected' &&
      conn.provider_account_id === candidateAccountId &&
      conn.phone_number === canonicalPhone;

    if (!isAlreadyConnectedWithSameIdentity) {
      if (conn.status === 'connected') {
        await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
        return `${webAppBase}/whatsapp/callback?status=identity_conflict`;
      }

      // Step 3: Atomic Materialization of Zernio Provider Identity
      try {
        await this.connectionRepo.materializeZernioProviderIdentity({
          organizationId: conn.organization_id,
          connectionId: conn.id,
          providerProfileId: conn.provider_profile_id,
          providerAccountId: candidateAccountId,
          phoneNumber: canonicalPhone,
        });
      } catch (err: any) {
        await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
        if (
          err?.code === 'ZERNIO_ACCOUNT_ALREADY_REGISTERED' ||
          err?.code === 'PROVIDER_PHONE_ALREADY_REGISTERED' ||
          err?.statusCode === 409
        ) {
          return `${webAppBase}/whatsapp/callback?status=identity_conflict`;
        }
        return `${webAppBase}/whatsapp/callback?status=materialization_failed`;
      }

      // Step 4: Transition status: pending -> connecting -> connected (atomic with recon ownership)
      try {
        await this.transitionZernioConnectedAtomically({
          orgId: conn.organization_id,
          connectionId: conn.id,
          providerAccountId: candidateAccountId,
          providerProfileId: conn.provider_profile_id,
          phoneNumber: canonicalPhone,
        });
      } catch {
        await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
        return `${webAppBase}/whatsapp/callback?status=status_transition_failed`;
      }
    }

    // Step 5: Consume onboarding session
    try {
      const nowIso = new Date().toISOString();
      const retentionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      await this.onboardingSessionRepo.updateSession(session.id, {
        status: 'consumed',
        consumed_at: nowIso,
        retention_expires_at: retentionExpiresAt,
      });
    } catch {
      // If session finalization fails after connection is connected, do NOT mark session failed;
      // leave it active/replayable and return finalization_failed.
      return `${webAppBase}/whatsapp/callback?status=finalization_failed`;
    }

    return `${webAppBase}/whatsapp/callback?status=success&connectionId=${encodeURIComponent(conn.id)}`;
  }

  async verifyZernioWhatsAppAccount(params: {
    providerProfileId: string;
    providerAccountId: string;
  }): Promise<{
    account: ZernioAccount;
    numberInfo: ZernioWhatsAppNumberInfo;
    canonicalPhone: string;
  }> {
    const { providerProfileId, providerAccountId } = params;

    // Step 1: Server-side account verification via GET /v1/accounts?profileId=...&platform=whatsapp&page=1&limit=2
    let matchingAccounts: ZernioAccount[];
    try {
      matchingAccounts = await this.zernioClient.listAccounts({
        profileId: providerProfileId,
        platform: 'whatsapp',
        page: 1,
        limit: 2,
      });
    } catch (err: any) {
      if (
        err instanceof ZernioError &&
        (err.kind === 'TIMEOUT' || err.kind === 'TRANSIENT_PROVIDER_ERROR' || err.statusCode >= 500)
      ) {
        throw err;
      }
      throw new AppError(400, `Zernio account verification failed: ${err.message}`, {
        code: 'ACCOUNT_VERIFICATION_FAILED',
        originalError: err,
      });
    }

    // Require exactly 1 match whose _id === providerAccountId and whose normalized profileId equals providerProfileId
    const matched = matchingAccounts.filter(
      (acc) =>
        acc._id === providerAccountId &&
        getZernioAccountProfileId(acc) === providerProfileId
    );
    if (matched.length !== 1) {
      throw new AppError(400, 'Zernio account verification failed: matching account not found or ambiguous', {
        code: 'ACCOUNT_VERIFICATION_FAILED',
      });
    }

    const account = matched[0];
    if (
      account.platform.toLowerCase() !== 'whatsapp' ||
      (account.status !== 'connected' && account.status !== 'active')
    ) {
      throw new AppError(400, 'Zernio account verification failed: account not active on whatsapp platform', {
        code: 'ACCOUNT_VERIFICATION_FAILED',
      });
    }

    // Step 2: Server-side number verification via GET /v1/whatsapp/number-info?accountId=...
    let numberInfo: ZernioWhatsAppNumberInfo;
    try {
      numberInfo = await this.zernioClient.getWhatsAppNumberInfo(providerAccountId);
    } catch (err: any) {
      if (
        err instanceof ZernioError &&
        (err.kind === 'TIMEOUT' || err.kind === 'TRANSIENT_PROVIDER_ERROR' || err.statusCode >= 500)
      ) {
        throw err;
      }
      throw new AppError(400, `Zernio number verification failed: ${err.message}`, {
        code: 'NUMBER_VERIFICATION_FAILED',
        originalError: err,
      });
    }

    if (
      !numberInfo.phone ||
      numberInfo.phone.status?.toUpperCase() !== 'CONNECTED' ||
      numberInfo.phone.platform_type?.toUpperCase() !== 'CLOUD_API'
    ) {
      throw new AppError(400, 'Zernio number verification failed: phone not connected or invalid platform', {
        code: 'NUMBER_VERIFICATION_FAILED',
      });
    }

    let canonicalPhone: string;
    try {
      canonicalPhone = normalizeToE164(numberInfo.phone.display_phone_number);
    } catch (err: any) {
      throw new AppError(400, `Invalid phone number format in Zernio number info: ${err.message}`, {
        code: 'INVALID_PHONE_NUMBER',
      });
    }

    return {
      account,
      numberInfo,
      canonicalPhone,
    };
  }

  async handleZernioWebhook(params: {
    rawBody: Buffer | unknown;
    signature?: string;
    headerEventId?: string;
  }): Promise<{ statusCode: number; body: Record<string, unknown> }> {
    const rawSignature = params.signature?.trim();
    if (!rawSignature) {
      throw new AppError(401, 'X-Zernio-Signature header ausente ou vazio.', {
        code: 'MISSING_SIGNATURE',
      });
    }

    const secret = requireZernioWebhookSecret();

    if (!params.rawBody || !Buffer.isBuffer(params.rawBody)) {
      throw new AppError(400, 'Raw body deve ser um Buffer válido.', {
        code: 'INVALID_RAW_BODY',
      });
    }
    if (params.rawBody.length === 0) {
      throw new AppError(400, 'Corpo da requisição vazio.', {
        code: 'EMPTY_BODY',
      });
    }

    const cleanSig = (
      rawSignature.startsWith('sha256=') ? rawSignature.slice(7) : rawSignature
    ).trim().toLowerCase();

    if (!/^[0-9a-f]{64}$/.test(cleanSig)) {
      throw new AppError(401, 'Formato de assinatura X-Zernio-Signature inválido.', {
        code: 'INVALID_SIGNATURE_FORMAT',
      });
    }

    const computedHex = crypto
      .createHmac('sha256', secret)
      .update(params.rawBody)
      .digest('hex');

    const incomingBuf = Buffer.from(cleanSig, 'hex');
    const computedBuf = Buffer.from(computedHex, 'hex');

    if (incomingBuf.length !== computedBuf.length || !crypto.timingSafeEqual(incomingBuf, computedBuf)) {
      throw new AppError(401, 'Assinatura X-Zernio-Signature inválida.', {
        code: 'INVALID_SIGNATURE',
      });
    }

    let payload: any;
    try {
      payload = JSON.parse(params.rawBody.toString('utf8'));
    } catch {
      throw new AppError(400, 'Payload JSON inválido.', {
        code: 'INVALID_JSON_PAYLOAD',
      });
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new AppError(400, 'Payload deve ser um objeto JSON.', {
        code: 'INVALID_JSON_PAYLOAD',
      });
    }

    const eventId = typeof payload.id === 'string' ? payload.id.trim() : '';
    if (!eventId) {
      throw new AppError(400, 'payload.id é obrigatório.', {
        code: 'MISSING_EVENT_ID',
      });
    }

    if (params.headerEventId !== undefined && params.headerEventId !== null && params.headerEventId !== '') {
      const headerId = String(params.headerEventId).trim();
      if (headerId !== eventId) {
        throw new AppError(400, 'X-Zernio-Event-Id não coincide com payload.id.', {
          code: 'EVENT_ID_MISMATCH',
          headerEventId: headerId,
          payloadEventId: eventId,
        });
      }
    }

    const eventType = typeof payload.event === 'string' ? payload.event.trim() : '';
    if (!eventType) {
      throw new AppError(400, 'payload.event é obrigatório.', {
        code: 'MISSING_EVENT_TYPE',
      });
    }

    const acquisition = await this.webhookRepo.acquireEvent({
      eventId,
      eventType,
      payload,
    });

    if (!acquisition.shouldProcess) {
      if (acquisition.isConcurrentLeaseActive) {
        throw new AppError(429, 'Evento em processamento concorrente ativo.', {
          code: 'CONCURRENT_WEBHOOK_PROCESSING',
          eventId,
        });
      }
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: 'duplicate',
          eventId,
          processingStatus: acquisition.record.status,
        },
      };
    }

        // D5/D6 scope: actively process 'account.connected', 'account.disconnected', 'message.sent', 'message.delivered', 'message.read', 'message.failed'
    const activeEventTypes = [
      'account.connected',
      'account.disconnected',
      'message.sent',
      'message.delivered',
      'message.read',
      'message.failed',
    ];

    if (!activeEventTypes.includes(eventType)) {
      await this.webhookRepo.markEventIgnored(
        acquisition.record.id,
        `Ignored unhandled event: ${eventType}`
      );
      return {
        statusCode: 200,
        body: {
          ok: true,
          status: 'ignored',
          eventId,
          eventType,
        },
      };
    }

    if (eventType === 'account.connected') {
      const parseResult = zernioAccountConnectedWebhookSchema.safeParse(payload);
      if (!parseResult.success) {
        const errMsg = `Payload do evento account.connected inválido: ${parseResult.error.message}`;
        await this.webhookRepo.markEventTerminalError(acquisition.record.id, errMsg);
        return {
          statusCode: 200,
          body: {
            ok: true,
            status: 'terminal_error',
            eventId,
            error: errMsg,
          },
        };
      }

      const { accountId, profileId, platform } = parseResult.data;

      if (accountId.includes('/')) {
        const errMsg = 'accountId não pode conter barra ("/")';
        await this.webhookRepo.markEventTerminalError(acquisition.record.id, errMsg);
        return {
          statusCode: 200,
          body: { ok: true, status: 'terminal_error', eventId, error: errMsg },
        };
      }

      if (platform && platform.trim().toLowerCase() !== 'whatsapp') {
        const reason = `Ignored non-whatsapp platform: ${platform}`;
        await this.webhookRepo.markEventIgnored(acquisition.record.id, reason);
        return {
          statusCode: 200,
          body: { ok: true, status: 'ignored', eventId, reason },
        };
      }

      let conn: WhatsAppConnectionRecord | null;
      try {
        conn = await this.connectionRepo.findByZernioProfileId(profileId);
      } catch (err: any) {
        await this.webhookRepo.markEventTerminalError(acquisition.record.id, err.message);
        return {
          statusCode: 200,
          body: { ok: true, status: 'terminal_error', eventId, error: err.message },
        };
      }

      if (!conn) {
        const reason = `No connection found for profileId: ${profileId}`;
        await this.webhookRepo.markEventIgnored(acquisition.record.id, reason);
        return {
          statusCode: 200,
          body: { ok: true, status: 'ignored', eventId, reason },
        };
      }

      if (conn.status === 'disconnected') {
        const reason = 'Connection is disconnected and cannot be revived';
        await this.webhookRepo.markEventIgnored(acquisition.record.id, reason);
        return {
          statusCode: 200,
          body: { ok: true, status: 'ignored', eventId, reason },
        };
      }

      let verified: {
        account: ZernioAccount;
        numberInfo: ZernioWhatsAppNumberInfo;
        canonicalPhone: string;
      };
      try {
        verified = await this.verifyZernioWhatsAppAccount({
          providerProfileId: conn.provider_profile_id!,
          providerAccountId: accountId,
        });
      } catch (err: any) {
        const isRetryable =
          err instanceof ZernioError &&
          (err.kind === 'TIMEOUT' ||
            err.kind === 'TRANSIENT_PROVIDER_ERROR' ||
            err.kind === 'RATE_LIMITED' ||
            err.statusCode >= 500);

        if (isRetryable) {
          await this.webhookRepo.markEventRetryableError(acquisition.record.id, err.message);
          throw err;
        }

        await this.webhookRepo.markEventTerminalError(acquisition.record.id, err.message);
        return {
          statusCode: 200,
          body: { ok: true, status: 'terminal_error', eventId, error: err.message },
        };
      }

      const { canonicalPhone } = verified;

      const isAlreadyConnectedWithSameIdentity =
        conn.status === 'connected' &&
        conn.provider_account_id === accountId &&
        conn.phone_number === canonicalPhone;

      if (isAlreadyConnectedWithSameIdentity) {
        await this.webhookRepo.markEventProcessed(acquisition.record.id);
        return {
          statusCode: 200,
          body: { ok: true, status: 'processed', eventId, connectionId: conn.id },
        };
      }

      if (conn.status === 'connected') {
        const errMsg = 'Connection is already connected with different account/phone';
        await this.webhookRepo.markEventTerminalError(acquisition.record.id, errMsg);
        return {
          statusCode: 200,
          body: { ok: true, status: 'terminal_error', eventId, error: errMsg },
        };
      }

      // D3 Materialization
      try {
        await this.connectionRepo.materializeZernioProviderIdentity({
          organizationId: conn.organization_id,
          connectionId: conn.id,
          providerProfileId: conn.provider_profile_id!,
          providerAccountId: accountId,
          phoneNumber: canonicalPhone,
        });
      } catch (err: any) {
        if (
          err?.code === 'ZERNIO_ACCOUNT_ALREADY_REGISTERED' ||
          err?.code === 'PROVIDER_PHONE_ALREADY_REGISTERED' ||
          err?.statusCode === 409
        ) {
          await this.webhookRepo.markEventTerminalError(acquisition.record.id, err.message);
          return {
            statusCode: 200,
            body: { ok: true, status: 'terminal_error', eventId, error: err.message },
          };
        }
        await this.webhookRepo.markEventRetryableError(acquisition.record.id, err.message);
        throw err;
      }

      // Advance status: pending -> connecting -> connected (atomic with recon ownership)
      try {
        await this.transitionZernioConnectedAtomically({
          orgId: conn.organization_id,
          connectionId: conn.id,
          providerAccountId: accountId,
          providerProfileId: conn.provider_profile_id,
          phoneNumber: canonicalPhone,
        });
      } catch (err: any) {
        await this.webhookRepo.markEventRetryableError(acquisition.record.id, err.message);
        throw err;
      }

      await this.webhookRepo.markEventProcessed(acquisition.record.id);
      return {
        statusCode: 200,
        body: { ok: true, status: 'processed', eventId, connectionId: conn.id },
      };
    }

    if (eventType === 'account.disconnected') {
      const parseResult = zernioAccountDisconnectedWebhookSchema.safeParse(payload);
      if (!parseResult.success) {
        const errMsg = `Payload do evento account.disconnected inválido: ${parseResult.error.message}`;
        await this.webhookRepo.markEventTerminalError(acquisition.record.id, errMsg);
        return {
          statusCode: 200,
          body: { ok: true, status: 'terminal_error', eventId, error: errMsg },
        };
      }

      const { accountId, profileId, disconnectionType } = parseResult.data;

      let conn: WhatsAppConnectionRecord | null;
      try {
        conn = await this.connectionRepo.findByZernioProfileId(profileId);
      } catch (err: any) {
        await this.webhookRepo.markEventTerminalError(acquisition.record.id, err.message);
        return {
          statusCode: 200,
          body: { ok: true, status: 'terminal_error', eventId, error: err.message },
        };
      }

      if (!conn) {
        const reason = `No connection found for profileId: ${profileId}`;
        await this.webhookRepo.markEventIgnored(acquisition.record.id, reason);
        return {
          statusCode: 200,
          body: { ok: true, status: 'ignored', eventId, reason },
        };
      }

      if (conn.provider_account_id && conn.provider_account_id !== accountId) {
        const reason = `Account mismatch: conn has ${conn.provider_account_id}, event has ${accountId}`;
        await this.webhookRepo.markEventIgnored(acquisition.record.id, reason);
        return {
          statusCode: 200,
          body: { ok: true, status: 'ignored', eventId, reason },
        };
      }

      const reason = disconnectionType
        ? `PROVIDER_DISCONNECTED:${disconnectionType}`
        : 'PROVIDER_DISCONNECTED';

      if (conn.status === 'connected' || conn.status === 'connecting') {
        try {
          await this.transitionConnectionStatus(conn.organization_id, conn.id, 'error', reason);
          await this.reconJobRepo.ensureZernioJobPending({
            connectionId: conn.id,
            organizationId: conn.organization_id,
            desiredState: 'connected',
            providerAccountId: conn.provider_account_id,
            providerProfileId: conn.provider_profile_id,
            phoneNumber: conn.phone_number,
          });
        } catch (err: any) {
          await this.webhookRepo.markEventRetryableError(acquisition.record.id, err.message);
          throw err;
        }
      }

      // CRITICAL: NEVER release claims in D5. Claims remain retained for D7.
      await this.webhookRepo.markEventProcessed(acquisition.record.id);
      return {
        statusCode: 200,
        body: { ok: true, status: 'processed', eventId, connectionId: conn.id },
      };
    }

    // D6 message lifecycle handling: message.sent, message.delivered, message.read, message.failed
    if (
      eventType === 'message.sent' ||
      eventType === 'message.delivered' ||
      eventType === 'message.read' ||
      eventType === 'message.failed'
    ) {
      const parseResult = zernioMessageWebhookSchema.safeParse(payload);
      if (!parseResult.success) {
        const errMsg = `Payload do evento ${eventType} inválido: ${parseResult.error.message}`;
        await this.webhookRepo.markEventTerminalError(acquisition.record.id, errMsg);
        return {
          statusCode: 200,
          body: { ok: true, status: 'terminal_error', eventId, error: errMsg },
        };
      }

      const { accountId, messageId, conversationId, error: errorObj } = parseResult.data;

      const conn = await this.connectionRepo.findByZernioAccountId(accountId);
      if (!conn) {
        const reason = `No connection found for accountId: ${accountId}`;
        await this.webhookRepo.markEventIgnored(acquisition.record.id, reason);
        return {
          statusCode: 200,
          body: { ok: true, status: 'ignored', eventId, reason },
        };
      }

      try {
        await this.outboundRepo.recordProviderMessageLifecycleEvent({
          providerMessageId: messageId,
          providerAccountId: accountId,
          organizationId: conn.organization_id,
          connectionId: conn.id,
          eventType,
          conversationId,
          timestamp: typeof payload.timestamp === 'string' ? payload.timestamp : new Date().toISOString(),
          error: errorObj,
        });
      } catch (err: any) {
        if (err?.code === 'ZERNIO_ACCOUNT_MISMATCH') {
          await this.webhookRepo.markEventTerminalError(acquisition.record.id, err.message);
          return {
            statusCode: 200,
            body: { ok: true, status: 'terminal_error', eventId, error: err.message },
          };
        }
        await this.webhookRepo.markEventRetryableError(acquisition.record.id, err.message);
        throw err;
      }

      await this.webhookRepo.markEventProcessed(acquisition.record.id);
      return {
        statusCode: 200,
        body: { ok: true, status: 'processed', eventId, messageId, eventType },
      };
    }

    return {
      statusCode: 200,
      body: { ok: true, status: 'ignored', eventId, eventType },
    };
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

    if (input.provider === 'zernio') {
      return await this.startZernioOnboarding(orgId, actorUserId, input);
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

    // Branch B: Resume Existing Reservation (DEC-7D-35)
    if (input.resumeConnectionId) {
      const resumeConnId = input.resumeConnectionId;
      return await db.runTransaction(async (tx) => {
        const connRef = db.collection('whatsapp_connections').doc(resumeConnId);
        const connDoc = await tx.get(connRef);
        if (!connDoc.exists) {
          throw new AppError(404, 'CONNECTION_NOT_FOUND: Conexão não encontrada.', {
            code: 'CONNECTION_NOT_FOUND',
          });
        }
        const conn = connDoc.data() as WhatsAppConnectionRecord;
        if (conn.organization_id !== orgId) {
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
        if (conn.pending_expires_at && new Date(conn.pending_expires_at) <= now) {
          tx.update(connRef, {
            status: 'disconnected',
            status_reason: 'PENDING_EXPIRED',
            pending_expires_at: null,
            assigned_ministry_id: null,
            updated_at: nowIso,
          });
          throw new AppError(410, 'CONNECTION_RESERVATION_EXPIRED: Prazo de 24 horas da reserva expirado.', {
            code: 'CONNECTION_RESERVATION_EXPIRED',
          });
        }

        const orgRef = db.collection('organizations').doc(orgId);
        const orgDoc = await tx.get(orgRef);
        const org = { id: orgDoc.id, ...orgDoc.data() } as OrganizationRecord;

        const subRef = db.collection('ministry_subscriptions').doc(org.billing_anchor_ministry_id);
        const subDoc = await tx.get(subRef);
        const sub = subDoc.exists ? ({ id: subDoc.id, ...subDoc.data() } as MinistrySubscriptionRecord) : null;

        const capacity = SubscriptionService.evaluateOrganizationWhatsAppCapacity(org, sub, now);

        const secretRef = db.collection('whatsapp_connection_secrets').doc(conn.id);
        const secretDoc = await tx.get(secretRef);
        const hasStagedSecret = secretDoc.exists;

        const sessionId = `wabs_${crypto.randomBytes(12).toString('hex')}`;
        const rawNonce = crypto.randomBytes(32).toString('hex');
        const stateNonceHash = crypto.createHash('sha256').update(rawNonce).digest('hex');
        const sessionExpiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
        const retentionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

        if (!hasStagedSecret) {
          // Sub-Branch B1: Resume Clean Reservation
          if (!capacity.enabled || capacity.billingAccessMode !== 'normal') {
            throw new AppError(403, 'A organização não possui capacidade comercial normal disponível.', {
              code: 'WHATSAPP_CAPACITY_LIMIT_REACHED',
            });
          }

          if (conn.current_onboarding_session_id) {
            const priorSessionRef = db.collection('whatsapp_onboarding_sessions').doc(conn.current_onboarding_session_id);
            tx.update(priorSessionRef, {
              status: 'expired',
              updated_at: nowIso,
            });
          }

          const sessionRecord: WhatsAppOnboardingSessionRecord = {
            id: sessionId,
            organization_id: orgId,
            connection_id: conn.id,
            actor_user_id: actorUserId,
            state_nonce_hash: stateNonceHash,
            status: 'active',
            provider_progress: 'none',
            expires_at: sessionExpiresAt,
            retention_expires_at: retentionExpiresAt,
            consumed_at: null,
            created_at: nowIso,
            updated_at: nowIso,
          };
          tx.set(db.collection('whatsapp_onboarding_sessions').doc(sessionId), sessionRecord);

          tx.update(connRef, {
            current_onboarding_session_id: sessionId,
            updated_at: nowIso,
          });

          return {
            sessionId,
            connectionId: conn.id,
            stateNonce: rawNonce,
            fbAppId,
            configId,
            expiresAt: sessionExpiresAt,
            mode: 'resume_clean' as const,
            providerProgress: 'none' as const,
          };
        } else {
          // Sub-Branch B2: Resume Staged Reservation
          if (!capacity.enabled || capacity.billingAccessMode === 'suspended') {
            throw new AppError(403, 'A assinatura da organização está suspensa.', {
              code: 'WHATSAPP_SUBSCRIPTION_SUSPENDED',
            });
          }

          let priorProgress: WhatsAppProviderProgress = 'credential_staged';
          if (conn.current_onboarding_session_id) {
            const priorSessionRef = db.collection('whatsapp_onboarding_sessions').doc(conn.current_onboarding_session_id);
            const priorSessionDoc = await tx.get(priorSessionRef);
            if (priorSessionDoc.exists) {
              const priorData = priorSessionDoc.data() as WhatsAppOnboardingSessionRecord;
              if (priorData.provider_progress) {
                priorProgress = priorData.provider_progress;
              }
              tx.update(priorSessionRef, {
                status: 'expired',
                updated_at: nowIso,
              });
            }
          }

          const sessionRecord: WhatsAppOnboardingSessionRecord = {
            id: sessionId,
            organization_id: orgId,
            connection_id: conn.id,
            actor_user_id: actorUserId,
            state_nonce_hash: stateNonceHash,
            status: 'active',
            provider_progress: priorProgress,
            expires_at: sessionExpiresAt,
            retention_expires_at: retentionExpiresAt,
            consumed_at: null,
            created_at: nowIso,
            updated_at: nowIso,
          };
          tx.set(db.collection('whatsapp_onboarding_sessions').doc(sessionId), sessionRecord);

          tx.update(connRef, {
            current_onboarding_session_id: sessionId,
            updated_at: nowIso,
          });

          return {
            sessionId,
            connectionId: conn.id,
            stateNonce: rawNonce,
            fbAppId,
            configId,
            expiresAt: sessionExpiresAt,
            mode: 'resume_staged' as const,
            providerProgress: priorProgress,
          };
        }
      });
    }

    // Branch A: Allocate New Reservation
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
      const retentionExpiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

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
        current_onboarding_session_id: sessionId,
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
        provider_progress: 'none',
        expires_at: sessionExpiresAt,
        retention_expires_at: retentionExpiresAt,
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
        mode: 'start' as const,
        providerProgress: 'none' as const,
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

    const now = new Date();
    const nowIso = now.toISOString();

    // Step 1: Session Lookup & Verification (DEC-7D-33, DEC-7D-45)
    const session = await this.onboardingSessionRepo.getSessionById(input.sessionId);
    if (!session || session.organization_id !== orgId) {
      throw new AppError(400, 'Sessão de onboarding não encontrada ou expirada.', {
        code: 'ONBOARDING_SESSION_EXPIRED',
      });
    }

    // 30-Day Bounded Logical Retention Boundary (DEC-7D-45)
    if (session.retention_expires_at && new Date(session.retention_expires_at) <= now) {
      throw new AppError(400, 'Sessão de onboarding com retenção expirada.', {
        code: 'ONBOARDING_SESSION_EXPIRED',
      });
    }

    const conn = await this.connectionRepo.getConnectionById(session.connection_id);
    if (!conn || conn.organization_id !== orgId) {
      throw new AppError(404, 'Conexão não encontrada nesta organização.');
    }

    // Replay / Idempotency Check (DEC-7D-37)
    if (session.status === 'consumed') {
      if (conn.status === 'connected') {
        const org = await this.orgRepo.getOrganizationById(orgId);
        return this.mapToDto(conn, org?.default_whatsapp_connection_id ?? null);
      }
      throw new AppError(409, 'Sessão de onboarding já consumida.', {
        code: 'ONBOARDING_SESSION_ALREADY_CONSUMED',
      });
    }

    // Stale Session Completion Guard (DEC-7D-33)
    if (conn.current_onboarding_session_id && conn.current_onboarding_session_id !== session.id) {
      throw new AppError(409, 'ONBOARDING_SESSION_SUPERSEDED: Sessão de onboarding foi substituída por uma nova sessão.', {
        code: 'ONBOARDING_SESSION_SUPERSEDED',
      });
    }

    if (session.status === 'failed') {
      throw new AppError(400, 'ONBOARDING_SESSION_FAILED: Sessão de onboarding em estado de falha.', {
        code: 'ONBOARDING_SESSION_FAILED',
      });
    }

    if (new Date(session.expires_at) <= now) {
      if (session.provider_progress && session.provider_progress !== 'none') {
        await this.onboardingSessionRepo.updateSession(session.id, { status: 'expired' });
      } else {
        await this.releaseTerminalPendingReservation(
          orgId,
          session.id,
          session.connection_id,
          'expired',
          'ONBOARDING_SESSION_EXPIRED'
        );
      }
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

    // Step 4: Credential Staging / Reuse (DEC-7D-20, DEC-7D-32)
    let accessToken: string;
    if (!session.provider_progress || session.provider_progress === 'none') {
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
        created_at: nowIso,
        updated_at: nowIso,
      };
      await this.secretRepo.setSecret(secretRecord);

      await this.onboardingSessionRepo.updateSession(session.id, {
        status: 'credential_staged',
        provider_progress: 'credential_staged',
      });
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

    // Step 5: Server-Side Messaging Account Authority Check (DEC-7D-18, DEC-7D-31)
    let isWabaAuthorized = false;
    try {
      isWabaAuthorized = await this.metaProvider.verifyMessagingAccountAccess(accessToken, input.wabaId);
    } catch {
      isWabaAuthorized = false;
    }

    if (!isWabaAuthorized) {
      await this.secretRepo.deleteSecret(orgId, session.connection_id, { wabaId: input.wabaId });
      await this.connectionRepo.updateConnection(orgId, session.connection_id, {
        status: 'error',
        status_reason: 'UNAUTHORIZED_WABA_ACCESS',
      });
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      throw new AppError(403, 'Acesso não autorizado à conta do WhatsApp fornecida.', {
        code: 'UNAUTHORIZED_WABA_ACCESS',
      });
    }

    // Step 6: Edge Operational Authorization Verification (DEC-7D-18, DEC-7D-31)
    let phoneNumbers: WhatsAppAuthorizedPhoneNumber[] = [];
    try {
      phoneNumbers = await this.metaProvider.listAuthorizedPhoneNumbers(accessToken, input.wabaId);
    } catch {
      await this.secretRepo.deleteSecret(orgId, session.connection_id, { wabaId: input.wabaId });
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
      await this.secretRepo.deleteSecret(orgId, session.connection_id, { wabaId: input.wabaId });
      await this.connectionRepo.updateConnection(orgId, session.connection_id, {
        status: 'error',
        status_reason: 'PHONE_NOT_IN_WABA',
      });
      await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
      throw new AppError(400, 'O número de telefone informado não pertence à conta WhatsApp.', {
        code: 'PHONE_NOT_IN_WABA',
      });
    }

    await this.onboardingSessionRepo.updateSession(session.id, {
      provider_progress: 'assets_verified',
    });

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
        await this.onboardingSessionRepo.updateSession(session.id, {
          provider_progress: 'phone_registered',
        });
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

    // Step 9: Messaging Account Webhook Subscription (DEC-7D-56, DEC-7D-60, DEC-7D-65)
    let acquiredWabaLock: { leaseToken: string; generation: number } | null = null;
    try {
      const coordResult = await this.wabaCoordinator.coordinateOnboardingSubscription(
        input.wabaId,
        session.id,
        conn.id,
        async () => {
          await this.metaProvider.subscribeMessagingAccountApps(accessToken, input.wabaId);
        }
      );
      acquiredWabaLock = {
        leaseToken: coordResult.leaseToken,
        generation: coordResult.generation,
      };
    } catch (err: any) {
      if (err instanceof AppError && err.statusCode === 409) {
        throw err;
      }
      throw new AppError(
        502,
        `Falha na assinatura de webhooks da conta no provedor: ${err.message || 'Erro no provedor'}`,
        {
          code: 'PROVIDER_SUBSCRIPTION_FAILED',
          cause: err,
        }
      );
    }

    // Step 10: Atomic Materialization Transaction (DEC-7D-21, DEC-7D-30, DEC-7D-60)
    const claimId = getClaimId('meta_cloud_api', input.phoneNumberId);

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
        const currentConn = connDoc.data() as WhatsAppConnectionRecord;
        if (currentConn.organization_id !== orgId) {
          throw new AppError(404, 'Conexão não encontrada nesta organização.');
        }
        if (currentConn.status !== 'pending' && currentConn.status !== 'connecting') {
          throw new AppError(400, `Conexão em estado inválido para materialização: ${currentConn.status}`);
        }

        // Concurrency Guard (DEC-7D-33): Pointer must match
        if (currentConn.current_onboarding_session_id && currentConn.current_onboarding_session_id !== session.id) {
          throw new AppError(409, 'ONBOARDING_SESSION_SUPERSEDED: Sessão de onboarding substituída durante materialização.', {
            code: 'ONBOARDING_SESSION_SUPERSEDED',
          });
        }

        // 10d. Verify WABA Lock Lease (DEC-7D-60)
        const wabaLockRef = db.collection('whatsapp_waba_lifecycle_locks').doc(`lock_meta_${input.wabaId}`);
        const wabaLockDoc = await tx.get(wabaLockRef);
        if (wabaLockDoc.exists && acquiredWabaLock) {
          const lockData = wabaLockDoc.data() as any;
          if (
            lockData.lease_token !== acquiredWabaLock.leaseToken ||
            lockData.operation_generation !== acquiredWabaLock.generation
          ) {
            throw new AppError(409, 'WABA_LIFECYCLE_LEASE_LOST: O lease do ciclo de vida WABA foi perdido.', {
              code: 'WABA_LIFECYCLE_LEASE_LOST',
            });
          }
        }

        // 10e. Read claim doc
        const claimRef = db.collection('whatsapp_provider_identity_claims').doc(claimId);
        const claimDoc = await tx.get(claimRef);

        // 10f. Read configured connections for orgId
        const connectionsQuery = db
          .collection('whatsapp_connections')
          .where('organization_id', '==', orgId)
          .where('status', 'in', ['pending', 'connecting', 'connected', 'error', 'disabled_by_user']);
        const connectionsSnapshot = await tx.get(connectionsQuery);

        // Capacity & Subscription Access Mode Check (DEC-7D-30)
        const currentCapacity = SubscriptionService.evaluateOrganizationWhatsAppCapacity(org, sub, new Date());
        if (!currentCapacity.enabled || currentCapacity.billingAccessMode === 'suspended') {
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

        if (activeConfiguredCount > currentCapacity.totalAllowedConnections) {
          throw new AppError(
            403,
            'Limite de capacidade comercial de conexões WhatsApp atingido para a organização.',
            { code: 'WHATSAPP_CAPACITY_LIMIT_REACHED' }
          );
        }

        // Check Claim Collision (DEC-7D-21)
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

        // 10g. Update connection to connected
        tx.update(connRef, {
          status: 'connected',
          phone_number: normalizedPhoneNumber,
          provider_waba_id: input.wabaId,
          provider_phone_number_id: input.phoneNumberId,
          last_connected_at: nowIso,
          status_reason: null,
          pending_expires_at: null,
          current_onboarding_session_id: null,
          updated_at: nowIso,
        });

        // 10h. Update session to consumed
        const sessionRef = db.collection('whatsapp_onboarding_sessions').doc(session.id);
        const retentionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        tx.update(sessionRef, {
          status: 'consumed',
          consumed_at: nowIso,
          provider_progress: 'waba_subscribed',
          retention_expires_at: retentionExpiresAt,
          updated_at: nowIso,
        });

        // 10i. Release WABA Lifecycle Lock
        if (wabaLockDoc.exists && acquiredWabaLock) {
          tx.update(wabaLockRef, {
            operation_status: 'idle',
            provider_observed_state: 'subscribed',
            provider_observed_at: nowIso,
            provider_observed_generation: acquiredWabaLock.generation,
            lease_token: null,
            lease_expires_at: null,
            last_settled_at: nowIso,
            updated_at: nowIso,
          });
        }
      });
    } catch (err: any) {
      if (err?.code === 'PROVIDER_PHONE_ALREADY_REGISTERED' || (err instanceof AppError && err.statusCode === 409)) {
        await this.secretRepo.deleteSecret(orgId, session.connection_id, { wabaId: input.wabaId });
        await this.connectionRepo.updateConnection(orgId, session.connection_id, {
          status: 'error',
          status_reason: 'PHONE_ALREADY_REGISTERED',
        });
        await this.onboardingSessionRepo.updateSession(session.id, { status: 'failed' });
        throw err;
      }
      if (
        err?.code === 'SUBSCRIPTION_RESTRICTED' ||
        err?.code === 'WHATSAPP_CAPACITY_LIMIT_REACHED' ||
        err?.code === 'WHATSAPP_SUBSCRIPTION_SUSPENDED' ||
        (err instanceof AppError && err.statusCode === 403)
      ) {
        await this.secretRepo.deleteSecret(orgId, session.connection_id, { wabaId: input.wabaId });
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

  async disconnectConnection(
    orgId: string,
    connectionId: string,
    actorUserId: string
  ): Promise<void> {
    const member = await this.orgRepo.getOrganizationMember(orgId, actorUserId);
    if (!member) {
      throw new AppError(404, 'Organização não encontrada.');
    }
    if (member.role !== 'admin' && member.role !== 'owner') {
      throw new AppError(403, 'Apenas administradores da organização podem desconectar conexões.');
    }

    const conn = await this.connectionRepo.getConnectionById(connectionId);
    if (!conn || conn.organization_id !== orgId) {
      throw new AppError(404, 'Conexão não encontrada nesta organização.');
    }

    if (conn.status === 'disconnected') {
      return; // Idempotent no-op
    }

    const now = new Date();
    const nowIso = now.toISOString();

    if (conn.provider === 'zernio') {
      const isMaterialized = Boolean(conn.provider_account_id);

      await db.runTransaction(async (tx) => {
        // 1. ALL READS FIRST (Strict Firestore rule: zero reads after any writes)
        const connRef = db.collection('whatsapp_connections').doc(connectionId);
        const freshConnDoc = await tx.get(connRef);
        if (!freshConnDoc.exists) {
          throw new AppError(404, 'Conexão não encontrada nesta organização.');
        }
        const freshConn = freshConnDoc.data() as WhatsAppConnectionRecord;
        if (freshConn.organization_id !== orgId) {
          throw new AppError(404, 'Conexão não encontrada nesta organização.');
        }
        if (freshConn.status === 'disconnected') {
          return; // Idempotent no-op
        }

        const orgRef = db.collection('organizations').doc(orgId);
        const orgDoc = await tx.get(orgRef);

        let assignmentClaimRef: FirebaseFirestore.DocumentReference | undefined;
        let assignmentClaimDoc: FirebaseFirestore.DocumentSnapshot | undefined;
        if (freshConn.assigned_ministry_id) {
          const assignmentClaimId = getMinistryAssignmentClaimId(orgId, freshConn.assigned_ministry_id);
          assignmentClaimRef = db.collection('whatsapp_ministry_assignment_claims').doc(assignmentClaimId);
          assignmentClaimDoc = await tx.get(assignmentClaimRef);
        }

        const cleanupJobId = `cleanup_conn_${freshConn.id}`;
        const cleanupJobRef = db.collection('whatsapp_provider_cleanup_jobs').doc(cleanupJobId);
        let cleanupJobDoc: FirebaseFirestore.DocumentSnapshot | undefined;

        const reconJobId = `recon_zernio_${freshConn.id}`;
        const reconJobRef = db.collection('whatsapp_waba_reconciliation_jobs').doc(reconJobId);
        let reconJobDoc: FirebaseFirestore.DocumentSnapshot | undefined;

        if (isMaterialized) {
          cleanupJobDoc = await tx.get(cleanupJobRef);
          reconJobDoc = await tx.get(reconJobRef);
        }

        // 2. ALL WRITES AFTER ALL READS
        if (orgDoc.exists) {
          const orgData = orgDoc.data() as OrganizationRecord;
          if (orgData.default_whatsapp_connection_id === connectionId) {
            tx.update(orgRef, {
              default_whatsapp_connection_id: null,
              updated_at: nowIso,
            });
          }
        }

        if (
          assignmentClaimRef &&
          assignmentClaimDoc?.exists &&
          assignmentClaimDoc.data()?.connection_id === connectionId &&
          assignmentClaimDoc.data()?.organization_id === orgId
        ) {
          tx.delete(assignmentClaimRef);
        }

        // NOTE: For Zernio, do NOT delete claim_zernio_account_* or claim_zernio_phone_* here.
        // Claim release authority is strictly D7 cleanup strong settlement (settleZernioCleanupInTransaction).

        tx.update(connRef, {
          status: 'disconnected',
          status_reason: 'USER_DISCONNECTED',
          assigned_ministry_id: null,
          pending_expires_at: null,
          current_onboarding_session_id: null,
          updated_at: nowIso,
        });

        if (!isMaterialized) {
          const secretRef = db.collection('whatsapp_connection_secrets').doc(connectionId);
          tx.delete(secretRef);
        } else {
          // BLOCKER 1: In the same atomic commit, create/upsert the deterministic cleanup job
          if (!cleanupJobDoc?.exists) {
            const newCleanupJob: WhatsAppProviderCleanupJobRecord = {
              id: cleanupJobId,
              organization_id: orgId,
              connection_id: freshConn.id,
              provider: 'zernio',
              provider_waba_id: null,
              provider_phone_number_id: null,
              provider_account_id: freshConn.provider_account_id,
              provider_profile_id: freshConn.provider_profile_id,
              phone_number: freshConn.phone_number,
              status: 'pending',
              attempt_count: 0,
              max_attempts: 5,
              next_attempt_at: nowIso,
              lease_token: null,
              lease_expires_at: null,
              last_attempt_started_at: null,
              last_error_code: null,
              last_error_at: null,
              provider_cleanup_proof: null,
              override_reason: null,
              manual_action_by: null,
              manual_action_at: null,
              manual_action_reason: null,
              created_at: nowIso,
              updated_at: nowIso,
              completed_at: null,
              retention_expires_at: null,
            };
            tx.set(cleanupJobRef, newCleanupJob);
          } else {
            const existingJob = cleanupJobDoc.data() as WhatsAppProviderCleanupJobRecord;
            if (existingJob.status !== 'succeeded') {
              const updates: Partial<WhatsAppProviderCleanupJobRecord> = {
                organization_id: orgId,
                connection_id: freshConn.id,
                provider: 'zernio',
                provider_account_id: freshConn.provider_account_id ?? existingJob.provider_account_id,
                provider_profile_id: freshConn.provider_profile_id ?? existingJob.provider_profile_id,
                phone_number: freshConn.phone_number ?? existingJob.phone_number,
                updated_at: nowIso,
              };
              if (existingJob.status !== 'processing') {
                updates.status = 'pending';
                updates.next_attempt_at = nowIso;
              }
              tx.update(cleanupJobRef, updates);
            }
          }

          // MEDIUM 1: Upsert recon job in the same transaction
          if (!reconJobDoc?.exists) {
            const newReconJob = {
              id: reconJobId,
              provider: 'zernio',
              provider_waba_id: null,
              organization_id: freshConn.organization_id,
              connection_id: freshConn.id,
              provider_account_id: freshConn.provider_account_id || null,
              provider_profile_id: freshConn.provider_profile_id || null,
              phone_number: freshConn.phone_number || null,
              desired_state: 'disconnected',
              status: 'pending',
              attempt_count: 0,
              next_attempt_at: nowIso,
              lease_token: null,
              lease_expires_at: null,
              last_error_code: null,
              last_error_message: null,
              consecutive_stable_observations: 0,
              last_observed_at: null,
              created_at: nowIso,
              updated_at: nowIso,
            };
            tx.set(reconJobRef, newReconJob);
          } else {
            const existingRecon = reconJobDoc.data() as any;
            const reconUpdates: any = {
              desired_state: 'disconnected',
              organization_id: freshConn.organization_id,
              connection_id: freshConn.id,
              provider_account_id: freshConn.provider_account_id !== undefined ? freshConn.provider_account_id : existingRecon.provider_account_id,
              provider_profile_id: freshConn.provider_profile_id !== undefined ? freshConn.provider_profile_id : existingRecon.provider_profile_id,
              phone_number: freshConn.phone_number !== undefined ? freshConn.phone_number : existingRecon.phone_number,
              updated_at: nowIso,
            };
            if (existingRecon.status !== 'processing') {
              reconUpdates.status = 'pending';
              reconUpdates.next_attempt_at = nowIso;
            }
            tx.update(reconJobRef, reconUpdates);
          }
        }
      });

      return;
    }

    let shouldEnqueueCleanupJob = false;
    let wabaClaimGen = 0;

    if (conn.provider_waba_id) {
      const activeDeps = await this.connectionRepo.findActivePlatformDependencies(
        conn.provider_waba_id,
        conn.id
      );

      if (activeDeps.length === 0) {
        shouldEnqueueCleanupJob = true;
        const lock = await this.wabaLockRepo.getLock(conn.provider_waba_id);
        wabaClaimGen = lock?.operation_generation ?? 0;
      }
    }

    // Execute atomic local disconnect transaction
    await db.runTransaction(async (tx) => {
      const connRef = db.collection('whatsapp_connections').doc(connectionId);
      const orgRef = db.collection('organizations').doc(orgId);
      const orgDoc = await tx.get(orgRef);

      if (orgDoc.exists) {
        const orgData = orgDoc.data() as OrganizationRecord;
        if (orgData.default_whatsapp_connection_id === connectionId) {
          tx.update(orgRef, {
            default_whatsapp_connection_id: null,
            updated_at: nowIso,
          });
        }
      }

      if (conn.assigned_ministry_id) {
        const assignmentClaimId = getMinistryAssignmentClaimId(orgId, conn.assigned_ministry_id);
        tx.delete(db.collection('whatsapp_ministry_assignment_claims').doc(assignmentClaimId));
      }

      if (conn.provider_phone_number_id) {
        const claimId = getClaimId(conn.provider, conn.provider_phone_number_id);
        tx.delete(db.collection('whatsapp_provider_identity_claims').doc(claimId));
      }

      tx.update(connRef, {
        status: 'disconnected',
        status_reason: 'USER_DISCONNECTED',
        assigned_ministry_id: null,
        pending_expires_at: null,
        current_onboarding_session_id: null,
        updated_at: nowIso,
      });

      if (!shouldEnqueueCleanupJob) {
        const secretRef = db.collection('whatsapp_connection_secrets').doc(connectionId);
        tx.delete(secretRef);
      }
    });

    // If zero surviving dependencies, enqueue durable cleanup job
    if (shouldEnqueueCleanupJob && conn.provider_waba_id) {
      await this.cleanupJobRepo.createJob({
        id: `cleanup_conn_${conn.id}`,
        organization_id: orgId,
        connection_id: conn.id,
        provider: 'meta_cloud_api',
        provider_waba_id: conn.provider_waba_id,
        provider_phone_number_id: conn.provider_phone_number_id,
        waba_claim_generation: wabaClaimGen,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_attempt_at: nowIso,
        lease_token: null,
        lease_expires_at: null,
        last_attempt_started_at: null,
        last_error_code: null,
        last_error_at: null,
        provider_cleanup_proof: null,
        override_reason: null,
        manual_action_by: null,
        manual_action_at: null,
        manual_action_reason: null,
        created_at: nowIso,
        updated_at: nowIso,
        completed_at: null,
        retention_expires_at: null,
      });
    }
  }
}
