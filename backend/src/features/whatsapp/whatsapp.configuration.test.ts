import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppConnectionRecord, getClaimId } from './whatsapp.types';
import { OrganizationRecord, OrganizationMemberRecord } from '../organizations/organization.types';

describe('WhatsApp Configuration & Invariants Suite (Phase 7C)', () => {
  let organizationsStore: Map<string, OrganizationRecord>;
  let orgMembersStore: Map<string, OrganizationMemberRecord>;
  let ministriesStore: Map<string, any>;
  let connectionsStore: Map<string, WhatsAppConnectionRecord>;
  let claimsStore: Map<string, any>;
  let secretsStore: Map<string, any>;

  let connectionRepo: WhatsAppConnectionRepository;
  let claimRepo: WhatsAppProviderIdentityClaimRepository;
  let orgRepo: OrganizationRepository;
  let ministryRepo: MinistryRepository;
  let service: WhatsAppConnectionService;

  const orgId = 'org-test-1';
  const ownerUserId = 'user-owner-1';
  const ministryId = 'min-anchor-1';
  const secondMinistryId = 'min-youth-2';

  beforeEach(() => {
    vi.clearAllMocks();

    organizationsStore = new Map();
    orgMembersStore = new Map();
    ministriesStore = new Map();
    connectionsStore = new Map();
    claimsStore = new Map();
    secretsStore = new Map();

    // Populate org and member
    organizationsStore.set(orgId, {
      id: orgId,
      name: 'Igreja Central',
      slug: 'igreja-central',
      owner_user_id: ownerUserId,
      billing_anchor_ministry_id: ministryId,
      default_whatsapp_connection_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    orgMembersStore.set(`${orgId}_${ownerUserId}`, {
      id: `${orgId}_${ownerUserId}`,
      organization_id: orgId,
      user_id: ownerUserId,
      role: 'owner',
      invited_by_user_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Populate ministries
    ministriesStore.set(ministryId, {
      id: ministryId,
      name: 'Louvor Central',
      owner_user_id: ownerUserId,
      organization_id: orgId,
    });

    ministriesStore.set(secondMinistryId, {
      id: secondMinistryId,
      name: 'Louvor Jovens',
      owner_user_id: ownerUserId,
      organization_id: orgId,
    });

    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      const getStore = () => {
        switch (colName) {
          case 'organizations':
            return organizationsStore;
          case 'organization_members':
            return orgMembersStore;
          case 'ministries':
            return ministriesStore;
          case 'whatsapp_connections':
            return connectionsStore;
          case 'whatsapp_provider_identity_claims':
            return claimsStore;
          case 'whatsapp_connection_secrets':
            return secretsStore;
          default:
            return new Map();
        }
      };

      return {
        doc: (id: string) => ({
          id,
          get: vi.fn().mockImplementation(async () => {
            const data = getStore().get(id);
            return {
              exists: Boolean(data),
              id,
              data: () => data,
            };
          }),
          set: vi.fn().mockImplementation(async (data: any) => {
            getStore().set(id, { id, ...data });
          }),
          update: vi.fn().mockImplementation(async (data: any) => {
            const current = getStore().get(id) || {};
            getStore().set(id, { ...current, ...data });
          }),
          delete: vi.fn().mockImplementation(async () => {
            getStore().delete(id);
          }),
        }),
        where: vi.fn().mockImplementation((field: string, op: string, val: any) => ({
          where: vi.fn().mockImplementation((field2: string, op2: string, val2: any) => ({
            limit: vi.fn().mockImplementation((lim: number) => ({
              get: vi.fn().mockImplementation(async () => {
                const store = getStore();
                const matched: any[] = [];
                for (const [, doc] of store) {
                  if (doc[field] === val && doc[field2] === val2) {
                    matched.push({ id: doc.id, data: () => doc });
                  }
                }
                return { docs: matched.slice(0, lim), empty: matched.length === 0 };
              }),
            })),
          })),
          limit: vi.fn().mockImplementation((lim: number) => ({
            get: vi.fn().mockImplementation(async () => {
              const store = getStore();
              const matched: any[] = [];
              for (const [, doc] of store) {
                if (doc[field] === val) {
                  matched.push({ id: doc.id, data: () => doc });
                }
              }
              return { docs: matched.slice(0, lim), empty: matched.length === 0 };
            }),
          })),
        })),
      };
    });

    vi.spyOn(db, 'runTransaction').mockImplementation(async (updateFn: any) => {
      const tx: any = {
        get: async (docRef: any) => {
          return await docRef.get();
        },
        set: (docRef: any, data: any) => {
          docRef.set(data);
        },
        update: (docRef: any, data: any) => {
          docRef.update(data);
        },
        delete: (docRef: any) => {
          docRef.delete();
        },
      };
      return await updateFn(tx);
    });

    connectionRepo = new WhatsAppConnectionRepository();
    claimRepo = new WhatsAppProviderIdentityClaimRepository();
    orgRepo = new OrganizationRepository();
    ministryRepo = new MinistryRepository();
    service = new WhatsAppConnectionService(
      connectionRepo,
      undefined,
      claimRepo,
      orgRepo,
      undefined,
      ministryRepo
    );
  });

  async function createConnectedLine(id: string, phoneId: string): Promise<WhatsAppConnectionRecord> {
    const conn = await connectionRepo.createConnection({
      organization_id: orgId,
      display_name: `Line ${id}`,
      created_by_user_id: ownerUserId,
      status: 'connecting',
    });

    await service.materializeProviderIdentity(orgId, conn.id, {
      phoneNumber: '+5511999998888',
      providerWabaId: 'waba-1',
      providerPhoneNumberId: phoneId,
    });

    await service.transitionConnectionStatus(orgId, conn.id, 'connected');
    return (await connectionRepo.getConnectionById(conn.id))!;
  }

  it('1. Setting new default requires status === connected (DEC-7C-15)', async () => {
    const pendingConn = await connectionRepo.createConnection({
      organization_id: orgId,
      display_name: 'Pending Line',
      created_by_user_id: ownerUserId,
      status: 'pending',
    });

    await expect(
      service.setOrganizationDefault(orgId, pendingConn.id, ownerUserId)
    ).rejects.toThrow(/CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION/);

    const connectingConn = await connectionRepo.createConnection({
      organization_id: orgId,
      display_name: 'Connecting Line',
      created_by_user_id: ownerUserId,
      status: 'connecting',
    });

    await expect(
      service.setOrganizationDefault(orgId, connectingConn.id, ownerUserId)
    ).rejects.toThrow(/CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION/);
  });

  it('2. Setting new exclusive assignment requires status === connected (DEC-7C-15)', async () => {
    const pendingConn = await connectionRepo.createConnection({
      organization_id: orgId,
      display_name: 'Pending Line',
      created_by_user_id: ownerUserId,
      status: 'pending',
    });

    await expect(
      service.assignMinistry(orgId, pendingConn.id, ministryId, ownerUserId)
    ).rejects.toThrow(/CONNECTION_NOT_ACTIVE_FOR_CONFIGURATION/);
  });

  it('3. Setting connection as default fails if already assigned to a ministry', async () => {
    const conn = await createConnectedLine('conn-1', 'phone-1');

    // Assign to ministry
    await service.assignMinistry(orgId, conn.id, ministryId, ownerUserId);

    // Attempt to set as default
    await expect(
      service.setOrganizationDefault(orgId, conn.id, ownerUserId)
    ).rejects.toThrow(/CANNOT_SET_ASSIGNED_CONNECTION_AS_DEFAULT/);
  });

  it('4. Setting connection as exclusive assignment fails if it is currently Organization default', async () => {
    const conn = await createConnectedLine('conn-1', 'phone-1');

    // Set as default
    await service.setOrganizationDefault(orgId, conn.id, ownerUserId);

    // Attempt to assign to ministry
    await expect(
      service.assignMinistry(orgId, conn.id, ministryId, ownerUserId)
    ).rejects.toThrow(/CANNOT_ASSIGN_DEFAULT_CONNECTION/);
  });

  it('5. Setting connection to a cross-organization ministry fails with 404', async () => {
    const conn = await createConnectedLine('conn-1', 'phone-1');

    // Create ministry in different org
    ministriesStore.set('min-other-org', {
      id: 'min-other-org',
      name: 'Outro Ministério',
      organization_id: 'org-foreign',
    });

    await expect(
      service.assignMinistry(orgId, conn.id, 'min-other-org', ownerUserId)
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('6. One ministry cannot have two exclusively assigned connections (1:1 constraint)', async () => {
    const conn1 = await createConnectedLine('conn-1', 'phone-1');
    const conn2 = await createConnectedLine('conn-2', 'phone-2');

    await service.assignMinistry(orgId, conn1.id, ministryId, ownerUserId);

    await expect(
      service.assignMinistry(orgId, conn2.id, ministryId, ownerUserId)
    ).rejects.toThrow(/MINISTRY_ALREADY_HAS_EXCLUSIVE_CONNECTION/);
  });

  it('7. Existing Organization default is strictly PRESERVED across transient failure (error and disabled_by_user)', async () => {
    const conn = await createConnectedLine('conn-1', 'phone-1');
    await service.setOrganizationDefault(orgId, conn.id, ownerUserId);

    let org = await orgRepo.getOrganizationById(orgId);
    expect(org?.default_whatsapp_connection_id).toBe(conn.id);

    // Degrade to error
    await service.transitionConnectionStatus(orgId, conn.id, 'error');
    org = await orgRepo.getOrganizationById(orgId);
    expect(org?.default_whatsapp_connection_id).toBe(conn.id); // PRESERVED!

    // Pause to disabled_by_user
    await service.transitionConnectionStatus(orgId, conn.id, 'disabled_by_user');
    org = await orgRepo.getOrganizationById(orgId);
    expect(org?.default_whatsapp_connection_id).toBe(conn.id); // PRESERVED!
  });

  it('8. Existing Ministry assignment is strictly PRESERVED across transient failure (error and disabled_by_user)', async () => {
    const conn = await createConnectedLine('conn-1', 'phone-1');
    await service.assignMinistry(orgId, conn.id, ministryId, ownerUserId);

    let current = await connectionRepo.getConnectionById(conn.id);
    expect(current?.assigned_ministry_id).toBe(ministryId);

    // Degrade to error
    await service.transitionConnectionStatus(orgId, conn.id, 'error');
    current = await connectionRepo.getConnectionById(conn.id);
    expect(current?.assigned_ministry_id).toBe(ministryId); // PRESERVED!

    // Pause to disabled_by_user
    await service.transitionConnectionStatus(orgId, conn.id, 'disabled_by_user');
    current = await connectionRepo.getConnectionById(conn.id);
    expect(current?.assigned_ministry_id).toBe(ministryId); // PRESERVED!
  });

  it('9. Terminal disconnect clears Organization default pointer and Ministry assignment atomically', async () => {
    const conn = await createConnectedLine('conn-1', 'phone-1');
    await service.setOrganizationDefault(orgId, conn.id, ownerUserId);

    let org = await orgRepo.getOrganizationById(orgId);
    expect(org?.default_whatsapp_connection_id).toBe(conn.id);

    // Terminal disconnect
    await connectionRepo.disconnectConnection(orgId, conn.id);

    org = await orgRepo.getOrganizationById(orgId);
    expect(org?.default_whatsapp_connection_id).toBeNull(); // CLEARED!

    const connRecord = await connectionRepo.getConnectionById(conn.id);
    expect(connRecord?.status).toBe('disconnected');
    expect(connRecord?.assigned_ministry_id).toBeNull(); // CLEARED!
  });
});
