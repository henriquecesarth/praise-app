import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionSecretRepository } from '../../repositories/WhatsAppConnectionSecretRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { MinistryRepository, MinistryRecord, MinistryMemberRecord } from '../../repositories/MinistryRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { requireOrganizationRole, requireMinistryRole } from '../../middleware/rbac';
import {
  listWhatsAppConnectionsQuerySchema,
  updateWhatsAppConnectionSchema,
  WhatsAppConnectionRecord,
  getClaimId,
} from './whatsapp.types';
import { OrganizationRecord, OrganizationMemberRecord } from '../organizations/organization.types';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { BillingRepository } from '../../repositories/BillingRepository';
import { AppError } from '../../middleware/error-handler';
import { db } from '../../lib/firebase';
import organizationRoutes from '../organizations/organization.routes';

describe('WhatsApp Connection Domain Feature & Security Suite (Phase 7C)', () => {
  // In-memory Firestore stores
  let organizationsStore: Map<string, OrganizationRecord>;
  let orgMembersStore: Map<string, OrganizationMemberRecord>;
  let ministriesStore: Map<string, MinistryRecord>;
  let ministryMembersStore: Map<string, MinistryMemberRecord>;
  let connectionsStore: Map<string, WhatsAppConnectionRecord>;
  let secretsStore: Map<string, any>;
  let claimsStore: Map<string, any>;
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

  const orgId = 'org-main-1';
  const otherOrgId = 'org-other-2';

  const ownerUserId = 'user-owner-1';
  const adminUserId = 'user-admin-2';
  const memberUserId = 'user-member-3';
  const ministryOnlyAdminId = 'user-min-admin-4';
  const outsiderUserId = 'user-outsider-9';

  const anchorMinistryId = 'min-anchor-1';
  const secondaryMinistryId = 'min-secondary-2';
  const unattachedMinistryId = 'min-unattached-3';
  const otherOrgMinistryId = 'min-other-org-4';

  const conn1Id = 'wac-conn-1';
  const conn2Id = 'wac-conn-2';
  const otherConnId = 'wac-other-9';

  beforeEach(() => {
    vi.clearAllMocks();

    organizationsStore = new Map();
    orgMembersStore = new Map();
    ministriesStore = new Map();
    ministryMembersStore = new Map();
    connectionsStore = new Map();
    secretsStore = new Map();
    claimsStore = new Map();
    subscriptionsStore = new Map();
    usageStore = new Map();

    const now = new Date().toISOString();

    // 1. Setup Organizations
    organizationsStore.set(orgId, {
      id: orgId,
      name: 'Igreja Central',
      slug: 'igreja-central',
      owner_user_id: ownerUserId,
      billing_anchor_ministry_id: anchorMinistryId,
      default_whatsapp_connection_id: null,
      created_at: now,
      updated_at: now,
    });

    organizationsStore.set(otherOrgId, {
      id: otherOrgId,
      name: 'Outra Igreja',
      slug: 'outra-igreja',
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

    ministriesStore.set(secondaryMinistryId, {
      id: secondaryMinistryId,
      name: 'Ministério Secundário',
      owner_user_id: ownerUserId,
      organization_id: orgId,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
    });

    ministriesStore.set(unattachedMinistryId, {
      id: unattachedMinistryId,
      name: 'Ministério Sem Org',
      owner_user_id: memberUserId,
      organization_id: null,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
    });

    ministriesStore.set(otherOrgMinistryId, {
      id: otherOrgMinistryId,
      name: 'Ministério de Outra Org',
      owner_user_id: outsiderUserId,
      organization_id: otherOrgId,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
    });

    // 4. Setup Ministry Memberships
    ministryMembersStore.set(`${anchorMinistryId}_${ownerUserId}`, {
      id: `${anchorMinistryId}_${ownerUserId}`,
      ministry_id: anchorMinistryId,
      user_id: ownerUserId,
      role: 'admin',
      joined_at: now,
    });

    ministryMembersStore.set(`${anchorMinistryId}_${adminUserId}`, {
      id: `${anchorMinistryId}_${adminUserId}`,
      ministry_id: anchorMinistryId,
      user_id: adminUserId,
      role: 'admin',
      joined_at: now,
    });

    ministryMembersStore.set(`${anchorMinistryId}_${memberUserId}`, {
      id: `${anchorMinistryId}_${memberUserId}`,
      ministry_id: anchorMinistryId,
      user_id: memberUserId,
      role: 'member',
      joined_at: now,
    });

    ministryMembersStore.set(`${anchorMinistryId}_${ministryOnlyAdminId}`, {
      id: `${anchorMinistryId}_${ministryOnlyAdminId}`,
      ministry_id: anchorMinistryId,
      user_id: ministryOnlyAdminId,
      role: 'admin',
      joined_at: now,
    });

    ministryMembersStore.set(`${secondaryMinistryId}_${memberUserId}`, {
      id: `${secondaryMinistryId}_${memberUserId}`,
      ministry_id: secondaryMinistryId,
      user_id: memberUserId,
      role: 'member',
      joined_at: now,
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

    connectionsStore.set(conn2Id, {
      id: conn2Id,
      organization_id: orgId,
      display_name: 'Linha Secundária',
      phone_number: '+5511988887772',
      provider: 'meta_cloud_api',
      provider_waba_id: 'waba-002',
      provider_phone_number_id: 'phone-002',
      status: 'connected',
      status_reason: null,
      assigned_ministry_id: secondaryMinistryId,
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
      display_name: 'Linha Outra Org',
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

    // 6. Setup Secrets (Stored separately, should NEVER leak through connections API)
    secretsStore.set(conn1Id, {
      id: conn1Id,
      organization_id: orgId,
      connection_id: conn1Id,
      encrypted_access_token: 'enc-token-blob-12345',
      encryption_iv: 'iv-secret-bytes',
      encryption_tag: 'tag-secret-bytes',
      encryption_key_version: 'v1',
      token_expires_at: null,
      created_at: now,
      updated_at: now,
    });

    // 7. Setup Subscriptions for anchor ministries
    subscriptionsStore.set(anchorMinistryId, {
      id: anchorMinistryId,
      ministry_id: anchorMinistryId,
      plan_id: 'pro',
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'paid',
      created_at: now,
      updated_at: now,
    });

    subscriptionsStore.set(otherOrgMinistryId, {
      id: otherOrgMinistryId,
      ministry_id: otherOrgMinistryId,
      plan_id: 'pro',
      member_addon_blocks: 0,
      billing_status: 'active',
      subscription_mode: 'paid',
      created_at: now,
      updated_at: now,
    });

    // 8. Setup Provider Identity Claims
    claimsStore.set(getClaimId('meta_cloud_api', 'phone-001'), {
      id: getClaimId('meta_cloud_api', 'phone-001'),
      provider: 'meta_cloud_api',
      provider_phone_number_id: 'phone-001',
      organization_id: orgId,
      connection_id: conn1Id,
      created_at: now,
      updated_at: now,
    });

    claimsStore.set(getClaimId('meta_cloud_api', 'phone-002'), {
      id: getClaimId('meta_cloud_api', 'phone-002'),
      provider: 'meta_cloud_api',
      provider_phone_number_id: 'phone-002',
      organization_id: orgId,
      connection_id: conn2Id,
      created_at: now,
      updated_at: now,
    });

    // Mock Firestore Collection
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
          case 'ministry_subscriptions':
            return subscriptionsStore;
          case 'ministry_usage':
            return usageStore;
          default:
            return new Map();
        }
      };

      return {
        doc: (id: string) => ({
          id,
          get: vi.fn().mockImplementation(async () => {
            const store = getStore();
            const data = store.get(id);
            return {
              exists: Boolean(data),
              id,
              data: () => data,
            };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            const store = getStore();
            store.set(id, { id, ...data });
          }),
          update: vi.fn().mockImplementation(async (data: any) => {
            const store = getStore();
            const current = store.get(id) || {};
            store.set(id, { ...current, ...data });
          }),
          delete: vi.fn().mockImplementation(async () => {
            const store = getStore();
            store.delete(id);
          }),
        }),
        where: vi.fn().mockImplementation((field: string, op: string, val: any) => {
          let filters: Array<{ field: string; op: string; val: any }> = [{ field, op, val }];

          const queryObj: any = {
            where: vi.fn().mockImplementation((f2: string, op2: string, v2: any) => {
              filters.push({ field: f2, op: op2, val: v2 });
              return queryObj;
            }),
            get: vi.fn().mockImplementation(async () => {
              const store = getStore();
              let items = Array.from(store.values()).filter((item: any) =>
                filters.every((f) => {
                  if (f.op === '==') return item[f.field] === f.val;
                  if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(item[f.field]);
                  return true;
                })
              );
              return {
                docs: items.map((d: any) => ({
                  id: d.id,
                  data: () => d,
                })),
                size: items.length,
                empty: items.length === 0,
              };
            }),
            orderBy: vi.fn().mockImplementation((orderField: string, dir: 'asc' | 'desc') => {
              let orderings: Array<{ field: string; dir: 'asc' | 'desc' }> = [
                { field: orderField, dir },
              ];

              const orderObj: any = {
                orderBy: vi.fn().mockImplementation((tieField: string, tieDir: 'asc' | 'desc') => {
                  orderings.push({ field: tieField, dir: tieDir });
                  return orderObj;
                }),
                startAfter: vi.fn().mockImplementation((..._args: any[]) => {
                  return orderObj;
                }),
                limit: vi.fn().mockImplementation((lim: number) => ({
                  get: vi.fn().mockImplementation(async () => {
                    const store = getStore();
                    let items = Array.from(store.values()).filter((item: any) =>
                      filters.every((f) => {
                        if (f.op === '==') return item[f.field] === f.val;
                        if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(item[f.field]);
                        return true;
                      })
                    );
                    const sliced = items.slice(0, lim);
                    return {
                      docs: sliced.map((d: any) => ({
                        id: d.id,
                        data: () => d,
                      })),
                      size: sliced.length,
                      empty: sliced.length === 0,
                    };
                  }),
                })),
              };
              return orderObj;
            }),
            limit: vi.fn().mockImplementation((lim: number) => ({
              get: vi.fn().mockImplementation(async () => {
                const store = getStore();
                let items = Array.from(store.values()).filter((item: any) =>
                  filters.every((f) => {
                    if (f.op === '==') return item[f.field] === f.val;
                    if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(item[f.field]);
                    return true;
                  })
                );
                const sliced = items.slice(0, lim);
                return {
                  docs: sliced.map((d: any) => ({
                    id: d.id,
                    data: () => d,
                  })),
                  size: sliced.length,
                  empty: sliced.length === 0,
                };
              }),
            })),
            count: vi.fn().mockImplementation(() => ({
              get: vi.fn().mockImplementation(async () => {
                const store = getStore();
                const count = Array.from(store.values()).filter((item: any) =>
                  filters.every((f) => {
                    if (f.op === '==') return item[f.field] === f.val;
                    if (f.op === 'in') return Array.isArray(f.val) && f.val.includes(item[f.field]);
                    return true;
                  })
                ).length;
                return {
                  data: () => ({ count }),
                };
              }),
            })),
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

    // Spies on MinistryRepository to ensure requireMinistryRole queries test stores
    vi.spyOn(MinistryRepository.prototype, 'getMinistryById').mockImplementation(
      async (minId: string, uId: string) => {
        const min = ministriesStore.get(minId);
        if (!min) {
          throw new AppError(404, 'Ministério não encontrado.');
        }
        if (min.owner_user_id === uId) {
          return { ...min, role: 'admin' };
        }
        const member = ministryMembersStore.get(`${minId}_${uId}`);
        if (!member) {
          throw new AppError(403, 'Acesso negado. Você não é integrante deste ministério.');
        }
        return { ...min, role: member.role };
      }
    );

    vi.spyOn(MinistryRepository.prototype, 'findById').mockImplementation(async (minId: string) => {
      return ministriesStore.get(minId) || null;
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

  function createMockReqRes(params: any = {}, body: any = {}, userId?: string, query: any = {}) {
    const req: any = {
      params,
      body,
      query,
      user: userId ? { id: userId } : undefined,
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

  // =========================================================================
  // 1. GET /api/v1/organizations/:organizationId/whatsapp/connections
  // =========================================================================
  describe('GET /organizations/:organizationId/whatsapp/connections', () => {
    it('1.1 Org Owner can list connections (HTTP 200) with mapped DTOs and nextCursor', async () => {
      const { req, res, next } = createMockReqRes({ organizationId: orgId }, {}, ownerUserId);

      await controller.listConnections(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      const response = res.body;
      expect(response).toBeDefined();
      expect(Array.isArray(response.items)).toBe(true);
      expect(response.items.length).toBe(2);

      const item1 = response.items.find((i: any) => i.id === conn1Id);
      expect(item1).toBeDefined();
      expect(item1.displayName).toBe('Linha Principal');
      expect(item1.phoneNumber).toBe('+5511988887771');
      expect(item1.provider).toBe('meta_cloud_api');
      expect(item1.status).toBe('connected');
      expect(item1.isOrganizationDefault).toBe(false);
      expect(item1.assignedMinistryId).toBeNull();
    });

    it('1.2 Org Admin can list connections (HTTP 200)', async () => {
      const { req, res, next } = createMockReqRes({ organizationId: orgId }, {}, adminUserId);

      await controller.listConnections(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      expect(res.body.items.length).toBe(2);
    });

    it('1.3 Anti-IDOR & Fail-Closed: Ministry Admin without Org membership is rejected with 404', async () => {
      // Test RBAC middleware level
      const middleware = requireOrganizationRole('admin', orgRepo);
      const { req, res, next } = createMockReqRes({ organizationId: orgId }, {}, ministryOnlyAdminId);

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Organização não encontrada.',
        })
      );

      // Test Controller / Service level fail-closed defense
      const { req: cReq, res: cRes, next: cNext } = createMockReqRes(
        { organizationId: orgId },
        {},
        ministryOnlyAdminId
      );
      await controller.listConnections(cReq, cRes, cNext);

      expect(cNext).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Organização não encontrada.',
        })
      );
    });

    it('1.4 Anti-IDOR: Unrelated Outsider receives indistinguishable 404', async () => {
      const middleware = requireOrganizationRole('admin', orgRepo);
      const { req, res, next } = createMockReqRes({ organizationId: orgId }, {}, outsiderUserId);

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Organização não encontrada.',
        })
      );
    });

    it('1.5 Unauthenticated request is rejected with 401', async () => {
      const middleware = requireOrganizationRole('admin', orgRepo);
      const { req, res, next } = createMockReqRes({ organizationId: orgId }, {}, undefined);

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 401,
          message: 'Usuário não autenticado.',
        })
      );
    });

    it('1.6 SECRET NON-EXPOSURE: Credentials and tokens are strictly absent from connection list DTOs', async () => {
      const { req, res, next } = createMockReqRes({ organizationId: orgId }, {}, ownerUserId);

      await controller.listConnections(req, res, next);

      const items = res.body.items;
      expect(items.length).toBeGreaterThan(0);

      for (const item of items) {
        // Assert absence of any secret fields
        expect((item as any).encrypted_access_token).toBeUndefined();
        expect((item as any).encryption_iv).toBeUndefined();
        expect((item as any).encryption_tag).toBeUndefined();
        expect((item as any).encryption_key_version).toBeUndefined();
        expect((item as any).token).toBeUndefined();
        expect((item as any).access_token).toBeUndefined();
        expect((item as any).accessToken).toBeUndefined();
        expect((item as any).secret).toBeUndefined();
        expect((item as any).provider_phone_number_id).toBeUndefined();
        expect((item as any).provider_waba_id).toBeUndefined();
      }
    });

    it('1.7 Pagination Query Schema Validation: rejects invalid limit (>50 or <1)', () => {
      const validQuery = listWhatsAppConnectionsQuerySchema.safeParse({ limit: '25' });
      expect(validQuery.success).toBe(true);

      const overLimitQuery = listWhatsAppConnectionsQuerySchema.safeParse({ limit: '100' });
      expect(overLimitQuery.success).toBe(false);

      const negativeQuery = listWhatsAppConnectionsQuerySchema.safeParse({ limit: '-5' });
      expect(negativeQuery.success).toBe(false);

      const zeroQuery = listWhatsAppConnectionsQuerySchema.safeParse({ limit: '0' });
      expect(zeroQuery.success).toBe(false);
    });
  });

  // =========================================================================
  // 2. PATCH /api/v1/organizations/:organizationId/whatsapp/connections/:connectionId
  // =========================================================================
  describe('PATCH /organizations/:organizationId/whatsapp/connections/:connectionId', () => {
    it('2.1 Org Owner can update connection displayName (HTTP 200)', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { displayName: 'Novo Nome WhatsApp' },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      expect(res.body.displayName).toBe('Novo Nome WhatsApp');
      expect(connectionsStore.get(conn1Id)?.display_name).toBe('Novo Nome WhatsApp');
    });

    it('2.2 Org Admin can update connection displayName (HTTP 200)', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { displayName: 'Nome Atualizado pelo Admin' },
        adminUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.body.displayName).toBe('Nome Atualizado pelo Admin');
    });

    it('2.3 Anti-IDOR: Ministry-only user cannot PATCH organization connection (404)', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { displayName: 'Tentativa Proibida' },
        ministryOnlyAdminId
      );

      await controller.updateConnection(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Organização não encontrada.',
        })
      );
    });

    it('2.4 Setting isOrganizationDefault: true on connected connection updates organization default', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { isOrganizationDefault: true },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.body.isOrganizationDefault).toBe(true);
      expect(organizationsStore.get(orgId)?.default_whatsapp_connection_id).toBe(conn1Id);
    });

    it('2.5 Setting isOrganizationDefault: true on non-connected connection is rejected with 400', async () => {
      // Set conn1 to pending
      const conn = connectionsStore.get(conn1Id)!;
      connectionsStore.set(conn1Id, { ...conn, status: 'pending' });

      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { isOrganizationDefault: true },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({
            code: 'CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION',
          }),
        })
      );
    });

    it('2.6 Setting isOrganizationDefault: false clears organization default', async () => {
      // First set org default to conn1Id
      const org = organizationsStore.get(orgId)!;
      organizationsStore.set(orgId, { ...org, default_whatsapp_connection_id: conn1Id });

      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { isOrganizationDefault: false },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.body.isOrganizationDefault).toBe(false);
      expect(organizationsStore.get(orgId)?.default_whatsapp_connection_id).toBeNull();
    });

    it('2.7 Assigning ministry: setting assignedMinistryId to attached ministry succeeds', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { assignedMinistryId: anchorMinistryId },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.body.assignedMinistryId).toBe(anchorMinistryId);
      expect(connectionsStore.get(conn1Id)?.assigned_ministry_id).toBe(anchorMinistryId);
    });

    it('2.8 Assigning ministry: setting assignedMinistryId to ministry not in org is rejected with 404', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { assignedMinistryId: unattachedMinistryId },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Ministério não encontrado nesta organização.',
        })
      );
    });

    it('2.9 Assigning ministry: setting assignedMinistryId on non-connected connection is rejected with 400', async () => {
      // Set conn1 to pending
      const conn = connectionsStore.get(conn1Id)!;
      connectionsStore.set(conn1Id, { ...conn, status: 'pending' });

      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { assignedMinistryId: anchorMinistryId },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({
            code: 'CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION',
          }),
        })
      );
    });

    it('2.10 Unassigning ministry: setting assignedMinistryId to null succeeds', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn2Id },
        { assignedMinistryId: null },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.body.assignedMinistryId).toBeNull();
      expect(connectionsStore.get(conn2Id)?.assigned_ministry_id).toBeNull();
    });

    it('2.11 Cross-Tenant Anti-IDOR: Attempting to update connection of another organization returns 404', async () => {
      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: otherConnId },
        { displayName: 'Tentativa Cross-Tenant' },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Conexão não encontrada nesta organização.',
        })
      );
    });

    it('2.12 Updating disconnected connection is rejected with 400', async () => {
      const conn = connectionsStore.get(conn1Id)!;
      connectionsStore.set(conn1Id, { ...conn, status: 'disconnected' });

      const { req, res, next } = createMockReqRes(
        { organizationId: orgId, connectionId: conn1Id },
        { displayName: 'Linha Desconectada' },
        ownerUserId
      );

      await controller.updateConnection(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({
            code: 'CONNECTION_DISCONNECTED',
          }),
        })
      );
    });

    it('2.13 Schema validation rejects empty displayName (min 1)', () => {
      const emptyName = updateWhatsAppConnectionSchema.safeParse({ displayName: '   ' });
      expect(emptyName.success).toBe(false);

      const blank = updateWhatsAppConnectionSchema.safeParse({ displayName: '' });
      expect(blank.success).toBe(false);
    });

    it('2.14 Immutability: Read-only fields cannot be mutated via update connection schema', () => {
      const payloadWithReadOnly = {
        displayName: 'Válido',
        status: 'disconnected',
        organization_id: 'org-hacked',
        provider: 'fake_provider',
        phone_number_id: 'fake_pn',
        created_at: '1970-01-01T00:00:00Z',
      };

      const parsed = updateWhatsAppConnectionSchema.parse(payloadWithReadOnly);
      // Schema only picks allowed fields
      expect((parsed as any).status).toBeUndefined();
      expect((parsed as any).organization_id).toBeUndefined();
      expect((parsed as any).provider).toBeUndefined();
      expect((parsed as any).phone_number_id).toBeUndefined();
      expect((parsed as any).created_at).toBeUndefined();
    });
  });

  // =========================================================================
  // 3. GET /api/v1/ministries/:ministryId/whatsapp/status
  // =========================================================================
  describe('GET /ministries/:ministryId/whatsapp/status', () => {
    it('3.1 Ministry Member can access status (HTTP 200)', async () => {
      const middleware = requireMinistryRole('member');
      const { req, res, next } = createMockReqRes({ ministryId: anchorMinistryId }, {}, memberUserId);

      await middleware(req, res, next);
      expect(next).not.toHaveBeenCalledWith(expect.any(Error));

      await controller.getMinistryWhatsAppStatus(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it('3.2 Ministry Admin can access status (HTTP 200)', async () => {
      const middleware = requireMinistryRole('member');
      const { req, res, next } = createMockReqRes({ ministryId: anchorMinistryId }, {}, adminUserId);

      await middleware(req, res, next);
      expect(next).not.toHaveBeenCalledWith(expect.any(Error));

      await controller.getMinistryWhatsAppStatus(req, res, next);
      expect(res.json).toHaveBeenCalled();
    });

    it('3.3 Outsider without ministry membership is rejected with 403/404 via requireMinistryRole', async () => {
      const middleware = requireMinistryRole('member');
      const { req, res, next } = createMockReqRes({ ministryId: anchorMinistryId }, {}, outsiderUserId);

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
        })
      );
    });

    it('3.4 Handles legacy groupId route alias identically to ministryId', async () => {
      const { req, res, next } = createMockReqRes({ groupId: secondaryMinistryId }, {}, memberUserId);

      await controller.getMinistryWhatsAppStatus(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalled();
      expect(res.body.isConfigured).toBe(true);
      expect(res.body.connectionId).toBe(conn2Id);
    });

    it('3.5 Ministry with dedicated assignment returns direct connection (source: exclusive)', async () => {
      // Set conn1 status to disconnected so org configuredCount = 1 (within Pro plan capacity of 1)
      const conn1 = connectionsStore.get(conn1Id)!;
      connectionsStore.set(conn1Id, { ...conn1, status: 'disconnected' });

      const { req, res, next } = createMockReqRes({ ministryId: secondaryMinistryId }, {}, memberUserId);

      await controller.getMinistryWhatsAppStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          hasOrganization: true,
          organizationId: orgId,
          isConfigured: true,
          isConnected: true,
          source: 'exclusive',
          connectionId: conn2Id,
          displayName: 'Linha Secundária',
          phoneNumber: '+5511988887772',
          connectionAccessMode: 'normal',
          canSendMessages: true,
        })
      );
    });

    it('3.6 Ministry without dedicated assignment falls back to Organization default (source: default)', async () => {
      // Set conn2 status to disconnected so org configuredCount = 1 (within Pro plan capacity of 1)
      const conn2 = connectionsStore.get(conn2Id)!;
      connectionsStore.set(conn2Id, { ...conn2, status: 'disconnected' });

      // Set conn1 as org default
      const org = organizationsStore.get(orgId)!;
      organizationsStore.set(orgId, { ...org, default_whatsapp_connection_id: conn1Id });

      const { req, res, next } = createMockReqRes({ ministryId: anchorMinistryId }, {}, ownerUserId);

      await controller.getMinistryWhatsAppStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          hasOrganization: true,
          organizationId: orgId,
          isConfigured: true,
          isConnected: true,
          source: 'default',
          connectionId: conn1Id,
          displayName: 'Linha Principal',
          phoneNumber: '+5511988887771',
          connectionAccessMode: 'normal',
          canSendMessages: true,
        })
      );
    });

    it('3.7 Attached ministry with no assignment and no default returns unconfigured', async () => {
      const { req, res, next } = createMockReqRes({ ministryId: anchorMinistryId }, {}, ownerUserId);

      await controller.getMinistryWhatsAppStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          hasOrganization: true,
          organizationId: orgId,
          isConfigured: false,
          isConnected: false,
          source: 'none',
          connectionId: null,
          displayName: null,
          phoneNumber: null,
          canSendMessages: false,
        })
      );
    });

    it('3.8 Unattached ministry (organization_id === null) returns unconfigured', async () => {
      const { req, res, next } = createMockReqRes({ ministryId: unattachedMinistryId }, {}, memberUserId);

      await controller.getMinistryWhatsAppStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          hasOrganization: false,
          organizationId: null,
          isConfigured: false,
          isConnected: false,
          source: 'none',
          connectionId: null,
          displayName: null,
          phoneNumber: null,
          canSendMessages: false,
        })
      );
    });

    it('3.9 SECRET NON-EXPOSURE: Ministry status strictly omits tokens and credentials', async () => {
      // Set org default so connection is present
      const org = organizationsStore.get(orgId)!;
      organizationsStore.set(orgId, { ...org, default_whatsapp_connection_id: conn1Id });

      const { req, res, next } = createMockReqRes({ ministryId: anchorMinistryId }, {}, ownerUserId);

      await controller.getMinistryWhatsAppStatus(req, res, next);

      const body = res.body;
      expect(body).toBeDefined();
      expect(body.connectionId).toBe(conn1Id);
      expect(body.encrypted_access_token).toBeUndefined();
      expect(body.encryption_iv).toBeUndefined();
      expect(body.encryption_tag).toBeUndefined();
      expect(body.encryption_key_version).toBeUndefined();
      expect(body.token).toBeUndefined();
      expect(body.secret).toBeUndefined();
      expect(body.provider_waba_id).toBeUndefined();
      expect(body.provider_phone_number_id).toBeUndefined();
    });

    it('3.10 Over-limit state: When configured connections exceed capacity, status returns restricted_over_limit', async () => {
      // Both conn1Id and conn2Id are connected, exceeding Pro plan limit of 1
      const { req, res, next } = createMockReqRes({ ministryId: secondaryMinistryId }, {}, memberUserId);

      await controller.getMinistryWhatsAppStatus(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          hasOrganization: true,
          organizationId: orgId,
          isConfigured: true,
          isConnected: false,
          source: 'exclusive',
          connectionId: conn2Id,
          connectionAccessMode: 'restricted_over_limit',
          canSendMessages: false,
        })
      );
    });
  });

  // =========================================================================
  // 4. PROHIBITED / DEFERRED ROUTE INVARIANTS (Defense-in-Depth)
  // =========================================================================
  describe('Prohibited & Deferred Route Invariants', () => {
    it('4.1 POST /api/v1/organizations/:organizationId/whatsapp/connections is NOT registered in Express router', () => {
      const orgRoutesStack = (organizationRoutes as any).stack || [];
      const routeLayers = orgRoutesStack.filter((layer: any) => layer.route);

      const postConnRoute = routeLayers.find((layer: any) => {
        const path = layer.route.path;
        const methods = layer.route.methods;
        return (
          methods.post &&
          (path === '/:organizationId/whatsapp/connections' || path === '/whatsapp/connections')
        );
      });

      expect(postConnRoute).toBeUndefined();
    });

    it('4.2 POST /api/v1/organizations/:organizationId/whatsapp/connections/:connectionId/disconnect is NOT registered', () => {
      const orgRoutesStack = (organizationRoutes as any).stack || [];
      const routeLayers = orgRoutesStack.filter((layer: any) => layer.route);

      const disconnectRoute = routeLayers.find((layer: any) => {
        const path = layer.route.path;
        const methods = layer.route.methods;
        return (
          methods.post &&
          (path.includes('disconnect') || path.includes('/whatsapp/connections/:connectionId/disconnect'))
        );
      });

      expect(disconnectRoute).toBeUndefined();
    });
  });
});

