import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { OrganizationService } from './organization.service';
import { OrganizationController } from './organization.controller';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { requireOrganizationRole } from '../../middleware/rbac';
import { db } from '../../lib/firebase';
import { AppError } from '../../middleware/error-handler';
import {
  OrganizationRecord,
  OrganizationMemberRecord,
  addOrganizationMemberSchema,
} from './organization.types';
import { MinistryRecord, MinistryMemberRecord } from '../../repositories/MinistryRepository';
import { MinistrySubscriptionRecord } from '../subscriptions/subscription.types';

describe('Organization & WhatsApp Entitlement Feature Suite (Phase 7B)', () => {
  // In-memory Firestore stores
  let organizationsStore: Map<string, OrganizationRecord>;
  let orgMembersStore: Map<string, OrganizationMemberRecord>;
  let ministriesStore: Map<string, MinistryRecord>;
  let ministryMembersStore: Map<string, MinistryMemberRecord>;
  let usersStore: Map<string, any>;
  let subscriptionsStore: Map<string, MinistrySubscriptionRecord>;

  let orgRepo: OrganizationRepository;
  let subService: SubscriptionService;
  let orgService: OrganizationService;
  let orgController: OrganizationController;

  const ownerUserId = 'user-owner-1';
  const adminUserId = 'user-admin-2';
  const outsiderUserId = 'user-outsider-9';
  const ministryId = 'min-anchor-1';
  const secondaryMinistryId = 'min-secondary-2';

  beforeEach(() => {
    vi.clearAllMocks();

    organizationsStore = new Map();
    orgMembersStore = new Map();
    ministriesStore = new Map();
    ministryMembersStore = new Map();
    usersStore = new Map();
    subscriptionsStore = new Map();

    // Populate default users
    usersStore.set(ownerUserId, { id: ownerUserId, name: 'Owner User', email: 'owner@test.com' });
    usersStore.set(adminUserId, { id: adminUserId, name: 'Admin User', email: 'admin@test.com' });
    usersStore.set(outsiderUserId, { id: outsiderUserId, name: 'Outsider User', email: 'outsider@test.com' });

    // Populate default ministries
    const now = new Date().toISOString();
    const anchorMin: MinistryRecord = {
      id: ministryId,
      name: 'Ministério Central',
      owner_user_id: ownerUserId,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
      organization_id: null,
    };
    ministriesStore.set(ministryId, anchorMin);

    const secondaryMin: MinistryRecord = {
      id: secondaryMinistryId,
      name: 'Ministério Jovens',
      owner_user_id: ownerUserId,
      subscription_status: 'active',
      created_at: now,
      updated_at: now,
      organization_id: null,
    };
    ministriesStore.set(secondaryMinistryId, secondaryMin);

    // Ministry memberships
    ministryMembersStore.set(`${ministryId}_${ownerUserId}`, {
      id: `${ministryId}_${ownerUserId}`,
      ministry_id: ministryId,
      user_id: ownerUserId,
      role: 'admin',
      joined_at: now,
    });
    ministryMembersStore.set(`${ministryId}_${adminUserId}`, {
      id: `${ministryId}_${adminUserId}`,
      ministry_id: ministryId,
      user_id: adminUserId,
      role: 'admin',
      joined_at: now,
    });

    // Mock db.collection
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
          case 'users':
            return usersStore;
          case 'ministry_subscriptions':
            return subscriptionsStore;
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
            store.set(id, { ...data, id });
          }),
          update: vi.fn().mockImplementation(async (data: any) => {
            const store = getStore();
            const existing = store.get(id);
            if (existing) {
              store.set(id, { ...existing, ...data });
            }
          }),
          delete: vi.fn().mockImplementation(async () => {
            const store = getStore();
            store.delete(id);
          }),
        }),
        where: (field: string, op: string, val: any) => {
          let filters: Array<{ field: string; val: any }> = [{ field, val }];
          let queryLimit: number | null = null;

          const queryObj: any = {
            where: (f2: string, op2: string, v2: any) => {
              filters.push({ field: f2, val: v2 });
              return queryObj;
            },
            limit: (n: number) => {
              queryLimit = n;
              return queryObj;
            },
            get: vi.fn().mockImplementation(async () => {
              const store = getStore();
              let docs = Array.from(store.values()).filter((item: any) =>
                filters.every((f) => item[f.field] === f.val)
              );
              if (queryLimit !== null) {
                docs = docs.slice(0, queryLimit);
              }
              return {
                empty: docs.length === 0,
                docs: docs.map((d: any) => ({
                  id: d.id,
                  data: () => d,
                })),
              };
            }),
          };
          return queryObj;
        },
      };
    });

    // Mock db.runTransaction with sequential in-memory isolation
    let transactionQueue = Promise.resolve();
    vi.spyOn(db, 'runTransaction').mockImplementation(async (callback: any) => {
      const run = async () => {
        const transaction = {
          get: vi.fn().mockImplementation(async (docRef: any) => {
            return await docRef.get();
          }),
          set: vi.fn().mockImplementation((docRef: any, data: any) => {
            if (data.owner_user_id && data.billing_anchor_ministry_id) {
              organizationsStore.set(docRef.id, data);
            } else if (data.organization_id && data.user_id) {
              orgMembersStore.set(docRef.id, data);
            } else {
              docRef.set(data);
            }
          }),
          update: vi.fn().mockImplementation((docRef: any, data: any) => {
            if (ministriesStore.has(docRef.id)) {
              const existing = ministriesStore.get(docRef.id)!;
              ministriesStore.set(docRef.id, { ...existing, ...data });
            } else if (organizationsStore.has(docRef.id)) {
              const existing = organizationsStore.get(docRef.id)!;
              organizationsStore.set(docRef.id, { ...existing, ...data });
            }
          }),
          delete: vi.fn().mockImplementation((docRef: any) => {
            orgMembersStore.delete(docRef.id);
          }),
        };

        return await callback(transaction);
      };

      const result = transactionQueue.then(run);
      transactionQueue = result.catch(() => {});
      return await result;
    });

    orgRepo = new OrganizationRepository();
    subService = new SubscriptionService(undefined as any, undefined as any, orgRepo);
    orgService = new OrganizationService(orgRepo, subService);
    orgController = new OrganizationController(orgService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper for mock HTTP requests
  function createMockReqRes(params: any = {}, body: any = {}, userId?: string) {
    const req: any = {
      params,
      body,
      query: {},
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
  // 1. MINISTRY OWNER PROVISIONING AUTHORITY & RBAC (Tests 1, 2, 3)
  // =========================================================================
  describe('Provisioning Authority & RBAC', () => {
    it('1. Ministry Owner Provisioning Authority: POST provision succeeds for authenticated Ministry Owner', async () => {
      const { req, res, next } = createMockReqRes({ ministryId }, {}, ownerUserId);

      await orgController.provisionForMinistry(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalled();
      const org: OrganizationRecord = res.body;
      expect(org).toBeDefined();
      expect(org.owner_user_id).toBe(ownerUserId);
      expect(org.billing_anchor_ministry_id).toBe(ministryId);
      expect(org.default_whatsapp_connection_id).toBeNull();
      expect(organizationsStore.has(org.id)).toBe(true);
      expect(ministriesStore.get(ministryId)?.organization_id).toBe(org.id);
    });

    it('2. Ministry Admin Provisioning Block: POST provision invoked by non-owner Ministry Admin is rejected with 403', async () => {
      const { req, res, next } = createMockReqRes({ ministryId }, {}, adminUserId);

      await orgController.provisionForMinistry(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          details: expect.objectContaining({
            code: 'ONLY_MINISTRY_OWNER_CAN_PROVISION_ORGANIZATION',
          }),
        })
      );
    });

    it('3. No Implicit Privilege Escalation: Provisioning creates exactly 1 owner record and NO implicit org admin for other members', async () => {
      const { req, res, next } = createMockReqRes({ ministryId }, {}, ownerUserId);
      await orgController.provisionForMinistry(req, res, next);

      const org: OrganizationRecord = res.body;
      const orgMembers = Array.from(orgMembersStore.values()).filter(
        (m) => m.organization_id === org.id
      );

      // Exactly 1 member record created
      expect(orgMembers).toHaveLength(1);
      expect(orgMembers[0].user_id).toBe(ownerUserId);
      expect(orgMembers[0].role).toBe('owner');

      // The other ministry admin does NOT have org membership
      expect(orgMembersStore.has(`${org.id}_${adminUserId}`)).toBe(false);
    });
  });

  // =========================================================================
  // 2. NON-MUTATING GET BEHAVIOR & IDEMPOTENCY (Tests 4, 5)
  // =========================================================================
  describe('Non-Mutating GET Behavior & Idempotency', () => {
    it('4. Non-Mutating GET Behavior: Authenticated GET on unprovisioned ministry returns hasOrganization: false without writes', async () => {
      const initialOrgCount = organizationsStore.size;
      const initialMemberCount = orgMembersStore.size;

      const { req, res, next } = createMockReqRes({ ministryId }, {}, ownerUserId);
      await orgController.getMinistryOrganization(req, res, next);

      expect(res.json).toHaveBeenCalledWith({
        hasOrganization: false,
        organization: null,
      });
      // Database state unchanged
      expect(organizationsStore.size).toBe(initialOrgCount);
      expect(orgMembersStore.size).toBe(initialMemberCount);
    });

    it('5. Provisioning Idempotency: Sequential provisioning calls for same ministry return identical record without duplicates', async () => {
      const { req: req1, res: res1, next: next1 } = createMockReqRes({ ministryId }, {}, ownerUserId);
      await orgController.provisionForMinistry(req1, res1, next1);
      const firstOrg = res1.body;

      const { req: req2, res: res2, next: next2 } = createMockReqRes({ ministryId }, {}, ownerUserId);
      await orgController.provisionForMinistry(req2, res2, next2);
      const secondOrg = res2.body;

      expect(secondOrg.id).toBe(firstOrg.id);
      expect(organizationsStore.size).toBe(1);
      expect(orgMembersStore.size).toBe(1);
    });
  });

  // =========================================================================
  // 3. CONCURRENCY SAFETY & OWNER STABILITY (Tests 6, 7, 8)
  // =========================================================================
  describe('Concurrency Safety & Owner Stability', () => {
    it('6. Concurrency Safety: Two concurrent provisioning requests produce exactly one Organization document', async () => {
      // Simulate two concurrent executions
      const [res1, res2] = await Promise.all([
        orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId),
        orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId),
      ]);

      expect(res1.id).toBe(res2.id);
      expect(organizationsStore.size).toBe(1);
      expect(orgMembersStore.size).toBe(1);
    });

    it('7. Deterministic Initial Owner: Initial organizations.owner_user_id strictly matches ministry.owner_user_id', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);
      const ministry = ministriesStore.get(ministryId)!;

      expect(org.owner_user_id).toBe(ministry.owner_user_id);
    });

    it('8. Concurrent Owner Stability: Concurrent requests cannot overwrite or mutate owner_user_id or billing_anchor', async () => {
      const org1 = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      // Attempt concurrent/subsequent provisioning call
      const org2 = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      expect(org2.owner_user_id).toBe(ownerUserId);
      expect(org2.billing_anchor_ministry_id).toBe(ministryId);
      expect(org2.id).toBe(org1.id);
    });
  });

  // =========================================================================
  // 4. OWNER MEMBERSHIP & SINGLE OWNER INVARIANT (Tests 9, 10)
  // =========================================================================
  describe('Owner Invariants', () => {
    it('9. Owner Membership Invariant: organization_members doc exists with role: "owner" matching owner_user_id', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);
      const member = await orgRepo.getOrganizationMember(org.id, ownerUserId);

      expect(member).toBeDefined();
      expect(member?.role).toBe('owner');
      expect(member?.user_id).toBe(org.owner_user_id);
      expect(member?.id).toBe(`${org.id}_${ownerUserId}`);
    });

    it('10. Single Owner Invariant: Exactly one member document holds role: "owner" per Organization', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      // Add an admin
      await orgRepo.addOrganizationMember(org.id, adminUserId, ownerUserId);

      const allMembers = await orgRepo.listOrganizationMembers(org.id);
      const owners = allMembers.filter((m) => m.role === 'owner');

      expect(owners).toHaveLength(1);
      expect(owners[0].user_id).toBe(ownerUserId);
    });
  });

  // =========================================================================
  // 5. LEAST-PRIVILEGE ORG ADMIN & ANTI-IDOR (Tests 11, 22)
  // =========================================================================
  describe('Org RBAC Middleware & Anti-IDOR', () => {
    it('11. Least-Privilege Org Admin: ORG_ADMIN attempting owner-only actions is rejected with 403 Forbidden', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);
      await orgRepo.addOrganizationMember(org.id, adminUserId, ownerUserId);

      const middleware = requireOrganizationRole('owner', orgRepo);
      const { req, res, next } = createMockReqRes({ organizationId: org.id }, {}, adminUserId);

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: expect.stringContaining('proprietário'),
        })
      );
    });

    it('22. Anti-IDOR & Fail-Closed Security: Callers without organization membership receive indistinguishable 404', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      const middleware = requireOrganizationRole('admin', orgRepo);
      const { req, res, next } = createMockReqRes({ organizationId: org.id }, {}, outsiderUserId);

      await middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: 'Organização não encontrada.',
        })
      );
    });
  });

  // =========================================================================
  // 6. MINISTRY ATTACH DUAL-AUTHORIZATION & NULL-ORG INVARIANT (Tests 12, 13, 14)
  // =========================================================================
  describe('Ministry Attachment', () => {
    it('12. Attach Dual-Authorization: Requires caller to be ORG_OWNER AND (owner OR admin) of target ministry', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      // outsider is not org owner -> fails at repo level if called
      await expect(
        orgRepo.linkMinistryToOrganization(org.id, secondaryMinistryId, outsiderUserId)
      ).rejects.toThrow(expect.objectContaining({ statusCode: 403 }));

      // Create a 3rd ministry owned by a third party
      const thirdMinId = 'min-third-party';
      ministriesStore.set(thirdMinId, {
        id: thirdMinId,
        name: 'Igreja Forasteira',
        owner_user_id: outsiderUserId,
        subscription_status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        organization_id: null,
      });

      // ownerUserId is ORG_OWNER, but NOT admin/owner of thirdMinId -> rejects with 403
      await expect(
        orgRepo.linkMinistryToOrganization(org.id, thirdMinId, ownerUserId)
      ).rejects.toThrow(expect.objectContaining({ statusCode: 403 }));

      // ownerUserId is ORG_OWNER AND owner of secondaryMinistryId -> succeeds
      await expect(
        orgRepo.linkMinistryToOrganization(org.id, secondaryMinistryId, ownerUserId)
      ).resolves.toBeUndefined();

      expect(ministriesStore.get(secondaryMinistryId)?.organization_id).toBe(org.id);
    });

    it('13. Attach Requires Null Organization: Succeeds only when ministry.organization_id === null', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);
      expect(ministriesStore.get(secondaryMinistryId)?.organization_id).toBeNull();

      await orgRepo.linkMinistryToOrganization(org.id, secondaryMinistryId, ownerUserId);

      expect(ministriesStore.get(secondaryMinistryId)?.organization_id).toBe(org.id);
    });

    it('14. Already-Attached Ministry Rejection (409): Attaching ministry that already belongs to an org is rejected with 409', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);
      await orgRepo.linkMinistryToOrganization(org.id, secondaryMinistryId, ownerUserId);

      // Second attempt to attach already attached ministry
      await expect(
        orgRepo.linkMinistryToOrganization(org.id, secondaryMinistryId, ownerUserId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 409,
          details: expect.objectContaining({ code: 'MINISTRY_ALREADY_HAS_ORGANIZATION' }),
        })
      );
    });
  });

  // =========================================================================
  // 7. BILLING ANCHOR & DETACH RESTRICTIONS (Tests 15, 16)
  // =========================================================================
  describe('Ministry Detachment', () => {
    it('15. Anchor Detachment Block: Attempting to detach billing_anchor_ministry_id is rejected with 400', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      await expect(
        orgRepo.detachMinistryFromOrganization(org.id, org.billing_anchor_ministry_id, ownerUserId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'CANNOT_DETACH_BILLING_ANCHOR' }),
        })
      );
    });

    it('16. Valid Detach Behavior: Detaching non-anchor resets organization_id to null and preserves operational data', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);
      await orgRepo.linkMinistryToOrganization(org.id, secondaryMinistryId, ownerUserId);

      const beforeDetach = { ...ministriesStore.get(secondaryMinistryId)! };

      await orgRepo.detachMinistryFromOrganization(org.id, secondaryMinistryId, ownerUserId);

      const afterDetach = ministriesStore.get(secondaryMinistryId)!;
      expect(afterDetach.organization_id).toBeNull();
      expect(afterDetach.name).toBe(beforeDetach.name);
      expect(afterDetach.owner_user_id).toBe(beforeDetach.owner_user_id);
      expect(afterDetach.subscription_status).toBe(beforeDetach.subscription_status);
    });
  });

  // =========================================================================
  // 8. GENERIC MEMBER OWNER PROHIBITION & DELETION PROHIBITION (Tests 17, 18)
  // =========================================================================
  describe('Member Role Constraints & Owner Protection', () => {
    it('17. Generic Member Owner Prohibition: POST /organizations/:id/members with { role: "owner" } is rejected with 400', async () => {
      const parseResult = addOrganizationMemberSchema.safeParse({
        userId: adminUserId,
        role: 'owner',
      });

      expect(parseResult.success).toBe(false);
      if (!parseResult.success) {
        expect(parseResult.error.issues[0].message).toBe('CANNOT_ASSIGN_OWNER_VIA_MEMBER_API');
      }

      // Controller layer enforcement
      const { req, res, next } = createMockReqRes(
        { organizationId: 'any-org' },
        { userId: adminUserId, role: 'owner' },
        ownerUserId
      );
      await orgController.addOrganizationAdmin(req, res, next);

      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'CANNOT_ASSIGN_OWNER_VIA_MEMBER_API' }),
        })
      );
    });

    it('18. Owner Deletion Prohibition: DELETE /organizations/:id/members/:ownerUserId is rejected with 400', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      await expect(
        orgRepo.removeOrganizationMember(org.id, ownerUserId, ownerUserId)
      ).rejects.toThrow(
        expect.objectContaining({
          statusCode: 400,
          details: expect.objectContaining({ code: 'OWNER_CANNOT_BE_REMOVED' }),
        })
      );
    });
  });

  // =========================================================================
  // 9. COMMERCIAL CAPACITY ENTITLEMENTS (Tests 19, 20, 21)
  // =========================================================================
  describe('Commercial WhatsApp Capacity Entitlements', () => {
    it('19. Billing Anchor Subscription Scope: Capacity strictly inspects the subscription of billing_anchor_ministry_id', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);
      await orgRepo.linkMinistryToOrganization(org.id, secondaryMinistryId, ownerUserId);

      // Anchor ministry is Pro plan
      subscriptionsStore.set(ministryId, {
        id: ministryId,
        ministry_id: ministryId,
        plan_id: 'pro',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'paid',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Secondary ministry is Free plan
      subscriptionsStore.set(secondaryMinistryId, {
        id: secondaryMinistryId,
        ministry_id: secondaryMinistryId,
        plan_id: 'free',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'free',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const capacity = await subService.getOrganizationWhatsAppCapacity(org.id);

      expect(capacity.billingAnchorMinistryId).toBe(ministryId);
      expect(capacity.includedConnections).toBe(1); // Evaluates anchor Pro plan, NOT secondary Free plan
      expect(capacity.additionalConnections).toBe(0);
      expect(capacity.totalAllowedConnections).toBe(1);
      expect(capacity.enabled).toBe(true);
      expect(capacity.billingAccessMode).toBe('normal');
    });

    it('20. Free Plan Quota: Standalone free plan returns included: 0, additional: 0, total: 0, enabled: false', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      // Anchor ministry is Free plan (default or explicit)
      subscriptionsStore.set(ministryId, {
        id: ministryId,
        ministry_id: ministryId,
        plan_id: 'free',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'free',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: null,
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const capacity = await subService.getOrganizationWhatsAppCapacity(org.id);

      expect(capacity.includedConnections).toBe(0);
      expect(capacity.additionalConnections).toBe(0);
      expect(capacity.totalAllowedConnections).toBe(0);
      expect(capacity.enabled).toBe(false);
      expect(capacity.billingAccessMode).toBe('normal');
    });

    it('21. Paid Plan Quota: Paid plan returns included: 1, additional: 0, total: 1, billingAccessMode: normal (and suspended when suspended)', async () => {
      const org = await orgRepo.lazyProvisionForMinistry(ministryId, ownerUserId);

      // Paid plan (Lite+)
      subscriptionsStore.set(ministryId, {
        id: ministryId,
        ministry_id: ministryId,
        plan_id: 'lite_plus',
        member_addon_blocks: 0,
        billing_status: 'active',
        subscription_mode: 'paid',
        administratively_suspended: false,
        suspended_at: null,
        suspension_reason: null,
        grace_period_expires_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: new Date(Date.now() + 30 * 86400000).toISOString(),
        cancel_at_period_end: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      const normalCapacity = await subService.getOrganizationWhatsAppCapacity(org.id);
      expect(normalCapacity.includedConnections).toBe(1);
      expect(normalCapacity.additionalConnections).toBe(0);
      expect(normalCapacity.totalAllowedConnections).toBe(1);
      expect(normalCapacity.enabled).toBe(true);
      expect(normalCapacity.billingAccessMode).toBe('normal');

      // Now suspend
      subscriptionsStore.set(ministryId, {
        ...subscriptionsStore.get(ministryId)!,
        administratively_suspended: true,
      });

      const suspendedCapacity = await subService.getOrganizationWhatsAppCapacity(org.id);
      expect(suspendedCapacity.billingAccessMode).toBe('suspended');
      expect(suspendedCapacity.enabled).toBe(false);
    });
  });
});
