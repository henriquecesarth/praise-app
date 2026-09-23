import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { MinistryRepository, MinistryRecord, MinistryMemberRecord } from '../../repositories/MinistryRepository';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { BillingRepository } from '../../repositories/BillingRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { AppError } from '../../middleware/error-handler';
import { requireOrganizationRole } from '../../middleware/rbac';
import { authenticate } from '../../middleware/auth';
import { db } from '../../lib/firebase';
import organizationRoutes from '../organizations/organization.routes';
import { WhatsAppConnectionRecord, getClaimId } from './whatsapp.types';
import { OrganizationRecord, OrganizationMemberRecord } from '../organizations/organization.types';

describe('Phase 7E-B2 — Authenticated WhatsApp Disconnect Endpoint Suite', () => {
  // In-memory Firestore stores
  let organizationsStore: Map<string, OrganizationRecord>;
  let orgMembersStore: Map<string, OrganizationMemberRecord>;
  let ministriesStore: Map<string, MinistryRecord>;
  let ministryMembersStore: Map<string, MinistryMemberRecord>;
  let connectionsStore: Map<string, WhatsAppConnectionRecord>;
  let secretsStore: Map<string, any>;
  let claimsStore: Map<string, any>;
  let assignmentClaimsStore: Map<string, any>;
  let cleanupJobsStore: Map<string, any>;
  let reconJobsStore: Map<string, any>;
  let subscriptionsStore: Map<string, any>;
  let usageStore: Map<string, any>;

  let connectionRepo: WhatsAppConnectionRepository;
  let secretRepo: WhatsAppConnectionSecretRepository;
  let claimRepo: WhatsAppProviderIdentityClaimRepository;
  let orgRepo: OrganizationRepository;
  let ministryRepo: MinistryRepository;
  let subService: SubscriptionService;
  let whatsappService: WhatsAppConnectionService;
  let controller: WhatsAppController;

  const orgId = 'org-louvaio-1';
  const otherOrgId = 'org-foreign-2';
  const ownerUserId = 'user-owner-1';
  const adminUserId = 'user-admin-2';
  const memberUserId = 'user-member-3';
  const outsiderUserId = 'user-outsider-9';

  const anchorMinistryId = 'min-anchor-1';
  const otherOrgMinistryId = 'min-foreign-2';

  const conn1Id = 'conn-active-1';
  const otherConnId = 'conn-foreign-2';

  function createMockReqRes(params: any = {}, body: any = {}, userId?: string, query: any = {}) {
    const req: any = {
      params,
      body,
      query,
      user: userId ? { id: userId } : undefined,
      headers: {},
    };
    const res: any = {
      statusCode: 200,
      status: vi.fn().mockImplementation(function (this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn().mockImplementation(function (this: any, data: any) {
        this.body = data;
        return this;
      }),
      send: vi.fn().mockImplementation(function (this: any) {
        return this;
      }),
    };
    const next = vi.fn();
    return { req, res, next };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    organizationsStore = new Map();
    orgMembersStore = new Map();
    ministriesStore = new Map();
    ministryMembersStore = new Map();
    connectionsStore = new Map();
    secretsStore = new Map();
    claimsStore = new Map();
    assignmentClaimsStore = new Map();
    cleanupJobsStore = new Map();
    reconJobsStore = new Map();
    subscriptionsStore = new Map();
    usageStore = new Map();

    const now = new Date().toISOString();

    // 1. Setup Organizations
    organizationsStore.set(orgId, {
      id: orgId,
      name: 'Igreja LouvAIO Central',
      slug: 'igreja-louvaio',
      owner_user_id: ownerUserId,
      billing_anchor_ministry_id: anchorMinistryId,
      default_whatsapp_connection_id: conn1Id,
      created_at: now,
      updated_at: now,
    });

    organizationsStore.set(otherOrgId, {
      id: otherOrgId,
      name: 'Igreja Estrangeira',
      slug: 'igreja-estrangeira',
      owner_user_id: outsiderUserId,
      billing_anchor_ministry_id: otherOrgMinistryId,
      default_whatsapp_connection_id: null,
      created_at: now,
      updated_at: now,
    });

    // 2. Setup Org Memberships
    orgMembersStore.set(`${orgId}_${ownerUserId}`, {
      id: `${orgId}_${ownerUserId}`,
      organization_id: orgId,
      user_id: ownerUserId,
      role: 'owner',
      invited_by_user_id: null,
      created_at: now,
      updated_at: now,
    });

    orgMembersStore.set(`${orgId}_${adminUserId}`, {
      id: `${orgId}_${adminUserId}`,
      organization_id: orgId,
      user_id: adminUserId,
      role: 'admin',
      invited_by_user_id: ownerUserId,
      created_at: now,
      updated_at: now,
    });

    orgMembersStore.set(`${orgId}_${memberUserId}`, {
      id: `${orgId}_${memberUserId}`,
      organization_id: orgId,
      user_id: memberUserId,
      role: 'member' as any,
      invited_by_user_id: ownerUserId,
      created_at: now,
      updated_at: now,
    });

    // Foreign org member
    orgMembersStore.set(`${otherOrgId}_${outsiderUserId}`, {
      id: `${otherOrgId}_${outsiderUserId}`,
      organization_id: otherOrgId,
      user_id: outsiderUserId,
      role: 'admin',
      invited_by_user_id: null,
      created_at: now,
      updated_at: now,
    });

    // 3. Setup Ministries
    ministriesStore.set(anchorMinistryId, {
      id: anchorMinistryId,
      name: 'Ministério Principal',
      owner_user_id: ownerUserId,
      organization_id: orgId,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
    });

    ministriesStore.set(otherOrgMinistryId, {
      id: otherOrgMinistryId,
      name: 'Ministério Estrangeiro',
      owner_user_id: outsiderUserId,
      organization_id: otherOrgId,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
    });

    // 4. Setup Subscriptions (Premium allows 1 connection)
    subscriptionsStore.set(anchorMinistryId, {
      id: anchorMinistryId,
      ministry_id: anchorMinistryId,
      plan_id: 'premium',
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'paid',
      created_at: now,
      updated_at: now,
    });

    // 5. Setup WhatsApp Connections
    connectionsStore.set(conn1Id, {
      id: conn1Id,
      organization_id: orgId,
      display_name: 'Linha Principal',
      phone_number: '+5511988887771',
      provider: 'meta_cloud_api',
      provider_waba_id: 'waba-001',
      provider_phone_number_id: 'phone-001',
      status: 'connected',
      status_reason: null,
      assigned_ministry_id: null,
      created_by_user_id: ownerUserId,
      pending_expires_at: null,
      last_connected_at: now,
      last_health_check_at: now,
      created_at: now,
      updated_at: now,
    });

    connectionsStore.set(otherConnId, {
      id: otherConnId,
      organization_id: otherOrgId,
      display_name: 'Linha Estrangeira',
      phone_number: '+5511988887779',
      provider: 'meta_cloud_api',
      provider_waba_id: 'waba-009',
      provider_phone_number_id: 'phone-009',
      status: 'connected',
      status_reason: null,
      assigned_ministry_id: null,
      created_by_user_id: outsiderUserId,
      pending_expires_at: null,
      last_connected_at: now,
      last_health_check_at: now,
      created_at: now,
      updated_at: now,
    });

    // Setup Claims
    claimsStore.set(getClaimId('meta_cloud_api', 'phone-001'), {
      id: getClaimId('meta_cloud_api', 'phone-001'),
      provider: 'meta_cloud_api',
      provider_phone_number_id: 'phone-001',
      organization_id: orgId,
      connection_id: conn1Id,
      created_at: now,
      updated_at: now,
    });

    // Setup Secrets
    secretsStore.set(conn1Id, {
      id: conn1Id,
      organization_id: orgId,
      connection_id: conn1Id,
      encrypted_access_token: 'enc-token-blob',
      encryption_iv: 'iv-bytes',
      encryption_tag: 'tag-bytes',
      encryption_key_version: 'v1',
      token_expires_at: null,
      created_at: now,
      updated_at: now,
    });

    // Mock Firestore Collections
    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      const getStore = () => {
        switch (colName) {
          case 'organizations':
            return organizationsStore;
          case 'organization_members':
            return orgMembersStore;
          case 'ministries':
            return ministriesStore;
          case 'ministry_members':
            return ministryMembersStore;
          case 'whatsapp_connections':
            return connectionsStore;
          case 'whatsapp_connection_secrets':
            return secretsStore;
          case 'whatsapp_provider_identity_claims':
            return claimsStore;
          case 'whatsapp_ministry_assignment_claims':
            return assignmentClaimsStore;
          case 'whatsapp_provider_cleanup_jobs':
            return cleanupJobsStore;
          case 'whatsapp_waba_reconciliation_jobs':
            return reconJobsStore;
          case 'ministry_subscriptions':
            return subscriptionsStore;
          case 'ministry_usage':
            return usageStore;
          default:
            return new Map();
        }
      };

      return {
        doc: vi.fn().mockImplementation((docId: string) => {
          return {
            id: docId,
            get: vi.fn().mockImplementation(async () => {
              const store = getStore();
              const data = store.get(docId);
              return {
                exists: Boolean(data),
                id: docId,
                data: () => (data ? { ...data } : undefined),
              };
            }),
            set: vi.fn().mockImplementation(async (data: any) => {
              getStore().set(docId, { id: docId, ...data });
            }),
            update: vi.fn().mockImplementation(async (data: any) => {
              const current = getStore().get(docId) || {};
              getStore().set(docId, { ...current, ...data, id: docId });
            }),
            delete: vi.fn().mockImplementation(async () => {
              getStore().delete(docId);
            }),
          };
        }),
        where: vi.fn().mockImplementation((field: string, op: string, val: any) => {
          const store = getStore();
          let filters: Array<{ field: string; op: string; val: any }> = [{ field, op, val }];

          const queryObj: any = {
            where: vi.fn().mockImplementation((f2: string, op2: string, v2: any) => {
              filters.push({ field: f2, op: op2, val: v2 });
              return queryObj;
            }),
            orderBy: vi.fn().mockImplementation(() => queryObj),
            limit: vi.fn().mockImplementation(() => queryObj),
            startAfter: vi.fn().mockImplementation(() => queryObj),
            get: vi.fn().mockImplementation(async () => {
              let docs = Array.from(store.values());
              for (const f of filters) {
                if (f.op === '==') {
                  docs = docs.filter((d: any) => d[f.field] === f.val);
                } else if (f.op === 'in') {
                  docs = docs.filter((d: any) => Array.isArray(f.val) && f.val.includes(d[f.field]));
                }
              }
              return {
                docs: docs.map((d: any) => ({
                  id: d.id,
                  exists: true,
                  data: () => ({ ...d }),
                })),
                empty: docs.length === 0,
              };
            }),
          };
          return queryObj;
        }),
      };
    });

    // Mock db.runTransaction
    vi.spyOn(db, 'runTransaction').mockImplementation(async (callback: any) => {
      const transaction: any = {
        get: vi.fn().mockImplementation(async (docRef: any) => {
          return await docRef.get();
        }),
        set: vi.fn().mockImplementation((docRef: any, data: any) => {
          docRef.set(data);
        }),
        update: vi.fn().mockImplementation((docRef: any, data: any) => {
          docRef.update(data);
        }),
        delete: vi.fn().mockImplementation((docRef: any) => {
          docRef.delete();
        }),
      };
      return await callback(transaction);
    });

    connectionRepo = new WhatsAppConnectionRepository();
    secretRepo = new WhatsAppConnectionSecretRepository();
    claimRepo = new WhatsAppProviderIdentityClaimRepository();
    orgRepo = new OrganizationRepository();
    ministryRepo = new MinistryRepository();
    const subRepo = new SubscriptionRepository();
    const billingRepo = new BillingRepository();
    subService = new SubscriptionService(subRepo, billingRepo, orgRepo);

    whatsappService = new WhatsAppConnectionService(
      connectionRepo,
      secretRepo,
      claimRepo,
      orgRepo,
      subService,
      ministryRepo
    );

    controller = new WhatsAppController(whatsappService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // ROUTE REGISTRATION & STRUCTURE
  // =========================================================================
  describe('Route Registration & Contract Structure', () => {
    it('DELETE /:organizationId/whatsapp/connections/:connectionId is registered on organizationRoutes', () => {
      const orgRoutesStack = (organizationRoutes as any).stack || [];
      const routeLayers = orgRoutesStack.filter((layer: any) => layer.route);

      const disconnectRoute = routeLayers.find((layer: any) => {
        const path = layer.route.path;
        const methods = layer.route.methods;
        return (
          methods.delete &&
          path === '/:organizationId/whatsapp/connections/:connectionId'
        );
      });

      expect(disconnectRoute).toBeDefined();
      expect(disconnectRoute.route.methods.delete).toBe(true);
    });
  });

  // =========================================================================
  // A. AUTHENTICATED ADMIN DISCONNECT SUCCEEDS
  // =========================================================================
  describe('A. Authenticated Admin Disconnect', () => {
    it('Org Admin can disconnect an active connection and receives deterministic 200 JSON', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        adminUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({
        success: true,
        connectionId: conn1Id,
        status: 'disconnected',
      });

      // Verify connection updated in store
      const conn = connectionsStore.get(conn1Id);
      expect(conn).toBeDefined();
      expect(conn?.status).toBe('disconnected');
      expect(conn?.status_reason).toBe('USER_DISCONNECTED');
    });

    it('Org Owner can also disconnect an active connection', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        ownerUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('disconnected');
    });
  });

  // =========================================================================
  // B. CORRECT SERVICE ARGUMENTS & SERVER-SIDE ACTOR DERIVATION
  // =========================================================================
  describe('B. Correct Service Arguments & Server-Side Actor Derivation', () => {
    it('passes exactly organizationId, connectionId, and authenticated actorUserId to service', async () => {
      const serviceSpy = vi.spyOn(whatsappService, 'disconnectConnection');

      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { actorUserId: 'malicious-spoofed-id', userId: 'attacker' },
        adminUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(serviceSpy).toHaveBeenCalledTimes(1);
      expect(serviceSpy).toHaveBeenCalledWith(orgId, conn1Id, adminUserId);

      // Verify that actorUserId was NEVER taken from req.body
      expect(serviceSpy).not.toHaveBeenCalledWith(orgId, conn1Id, 'malicious-spoofed-id');
    });
  });

  // =========================================================================
  // C. ALREADY-DISCONNECTED REPLAY IS SAFE (IDEMPOTENCY)
  // =========================================================================
  describe('C. Already-Disconnected Replay is Safe', () => {
    it('replaying disconnect on already-disconnected connection succeeds idempotently with 200', async () => {
      // First disconnect
      const { req: req1, res: res1, next: next1 } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        adminUserId
      );
      await controller.disconnectConnection(req1, res1, next1);
      expect(next1).not.toHaveBeenCalled();
      expect(res1.body.status).toBe('disconnected');

      // Second disconnect (replay)
      const { req: req2, res: res2, next: next2 } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        adminUserId
      );
      await controller.disconnectConnection(req2, res2, next2);

      expect(next2).not.toHaveBeenCalled();
      expect(res2.statusCode).toBe(200);
      expect(res2.body).toEqual({
        success: true,
        connectionId: conn1Id,
        status: 'disconnected',
      });
      expect(connectionsStore.get(conn1Id)?.status).toBe('disconnected');
    });
  });

  // =========================================================================
  // D. NON-ADMIN REJECTED
  // =========================================================================
  describe('D. Non-Admin Rejected', () => {
    it('member role (non-admin) is rejected with HTTP 403', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        memberUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Apenas administradores da organização podem desconectar conexões.',
        })
      );
      expect(connectionsStore.get(conn1Id)?.status).toBe('connected');
    });

    it('outsider user receives indistinguishable 404 (Anti-IDOR)', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        outsiderUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Organização não encontrada.',
        })
      );
    });
  });

  // =========================================================================
  // E. UNAUTHENTICATED REJECTED
  // =========================================================================
  describe('E. Unauthenticated Rejected', () => {
    it('unauthenticated request (missing req.user) is rejected with HTTP 401 by controller', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        undefined // No authenticated user
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Usuário não autenticado.',
        })
      );
    });

    it('unauthenticated request is rejected with HTTP 401 by requireOrganizationRole middleware', async () => {
      const middleware = requireOrganizationRole('admin', orgRepo);
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        undefined
      );

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Usuário não autenticado.',
        })
      );
    });
  });

  // =========================================================================
  // F. FOREIGN ORGANIZATION CONNECTION CANNOT BE DISCONNECTED (ANTI-IDOR)
  // =========================================================================
  describe('F. Foreign Organization Connection Cannot Be Disconnected', () => {
    it('rejects attempt to disconnect a connection from another organization with fail-closed 404', async () => {
      // otherConnId belongs to otherOrgId, but caller requests it under orgId
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: otherConnId },
        {},
        adminUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Conexão não encontrada nesta organização.',
        })
      );

      // Foreign connection must remain completely unchanged
      const foreignConn = connectionsStore.get(otherConnId);
      expect(foreignConn?.status).toBe('connected');
    });

    it('rejects non-existent connection with fail-closed 404', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: 'non-existent-conn' },
        {},
        adminUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Conexão não encontrada nesta organização.',
        })
      );
    });
  });

  // =========================================================================
  // G. SERVICE ERROR PROPAGATION THROUGH CANONICAL ERROR HANDLER
  // =========================================================================
  describe('G. Service Error Propagation', () => {
    it('unexpected service error is forwarded to next(err) for canonical handling', async () => {
      const unexpectedError = new AppError(500, 'Firestore unavailable or transaction failure');
      vi.spyOn(whatsappService, 'disconnectConnection').mockRejectedValueOnce(unexpectedError);

      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        adminUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(unexpectedError);
    });
  });

  // =========================================================================
  // H. SUCCESS RESPONSE CONTRACT STABILITY
  // =========================================================================
  describe('H. Success Response Contract Stability', () => {
    it('returns strictly { success: true, connectionId, status: "disconnected" } with no secret leaks', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        adminUserId
      );

      await controller.disconnectConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.body).toEqual({
        success: true,
        connectionId: conn1Id,
        status: 'disconnected',
      });

      // Assert complete absence of secrets / internal fields
      const body = res.body;
      expect(body.encrypted_access_token).toBeUndefined();
      expect(body.token).toBeUndefined();
      expect(body.secret).toBeUndefined();
      expect(body.provider_account_id).toBeUndefined();
      expect(body.provider_waba_id).toBeUndefined();
    });
  });

  // =========================================================================
  // 6. COMMERCIAL CAPACITY REGRESSION (SECTION 6)
  // =========================================================================
  describe('Commercial Capacity Regression (Section 6)', () => {
    it('disconnecting active connection transitions it to canonical disconnected state and frees capacity', async () => {
      // 1. Initial State: conn1 is connected and consumes 1 connection
      const consumingBefore = await connectionRepo.getConsumingConnections(orgId);
      expect(consumingBefore.length).toBe(1);
      expect(consumingBefore[0].id).toBe(conn1Id);

      // Check commercial capacity before disconnect: limit = 1, consumed = 1 -> available = 0
      const capBefore = await subService.getOrganizationWhatsAppCapacity(orgId);
      expect(capBefore.includedConnections).toBe(1);
      expect(capBefore.configuredConnectionsCount).toBe(1);
      expect(capBefore.remainingCapacity).toBe(0);
      expect(capBefore.canCreateConnection).toBe(false);

      // 2. Disconnect connection via controller
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        {},
        adminUserId
      );

      await controller.disconnectConnection(req, res, next);
      expect(next).not.toHaveBeenCalled();

      // 3. Post-disconnect state verification
      const connAfter = connectionsStore.get(conn1Id);
      expect(connAfter?.status).toBe('disconnected');
      expect(connAfter?.status_reason).toBe('USER_DISCONNECTED');

      // 4. Consuming connections becomes 0
      const consumingAfter = await connectionRepo.getConsumingConnections(orgId);
      expect(consumingAfter.length).toBe(0);

      // 5. Commercial capacity becomes available (consumed: 0, available: 1)
      const capAfter = await subService.getOrganizationWhatsAppCapacity(orgId);
      expect(capAfter.configuredConnectionsCount).toBe(0);
      expect(capAfter.remainingCapacity).toBe(1);
      expect(capAfter.canCreateConnection).toBe(true);

      // 6. Verify deterministic cleanup job created/registered (cleanup ownership preserved)
      const cleanupJob = cleanupJobsStore.get(`cleanup_conn_${conn1Id}`);
      expect(cleanupJob).toBeDefined();
      expect(cleanupJob.organization_id).toBe(orgId);
      expect(cleanupJob.connection_id).toBe(conn1Id);
    });
  });
});
