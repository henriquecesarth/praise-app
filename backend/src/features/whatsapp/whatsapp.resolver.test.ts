import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { OrganizationRepository } from '../../repositories/OrganizationRepository';
import { MinistryRepository } from '../../repositories/MinistryRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppConnectionRecord, getClaimId } from './whatsapp.types';
import { OrganizationRecord } from '../organizations/organization.types';

describe('WhatsApp Connection Resolver Hierarchy & Fallback Suite (Phase 7C)', () => {
  let organizationsStore: Map<string, OrganizationRecord>;
  let ministriesStore: Map<string, any>;
  let connectionsStore: Map<string, WhatsAppConnectionRecord>;
  let claimsStore: Map<string, any>;

  let connectionRepo: WhatsAppConnectionRepository;
  let claimRepo: WhatsAppProviderIdentityClaimRepository;
  let orgRepo: OrganizationRepository;
  let ministryRepo: MinistryRepository;
  let subService: SubscriptionService;
  let service: WhatsAppConnectionService;

  const orgId = 'org-test-1';
  const ministryId = 'min-test-1';
  let mockAccessMode: 'normal' | 'grace' | 'suspended' = 'normal';
  let mockAllowed = 5;

  beforeEach(() => {
    vi.clearAllMocks();

    organizationsStore = new Map();
    ministriesStore = new Map();
    connectionsStore = new Map();
    claimsStore = new Map();

    mockAccessMode = 'normal';
    mockAllowed = 5;

    organizationsStore.set(orgId, {
      id: orgId,
      name: 'Igreja Central',
      slug: 'igreja-central',
      owner_user_id: 'owner-1',
      billing_anchor_ministry_id: ministryId,
      default_whatsapp_connection_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    ministriesStore.set(ministryId, {
      id: ministryId,
      name: 'Ministério Central',
      owner_user_id: 'owner-1',
      organization_id: orgId,
    });

    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      const getStore = () => {
        switch (colName) {
          case 'organizations':
            return organizationsStore;
          case 'ministries':
            return ministriesStore;
          case 'whatsapp_connections':
            return connectionsStore;
          case 'whatsapp_provider_identity_claims':
            return claimsStore;
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
            count: vi.fn().mockReturnValue({
              get: vi.fn().mockImplementation(async () => {
                let count = 0;
                for (const [, doc] of connectionsStore) {
                  if ((doc as any)[field] === val && val2.includes((doc as any)[field2])) {
                    count++;
                  }
                }
                return { data: () => ({ count }) };
              }),
            }),
          })),
        })),
      };
    });

    connectionRepo = new WhatsAppConnectionRepository();
    claimRepo = new WhatsAppProviderIdentityClaimRepository();
    orgRepo = new OrganizationRepository();
    ministryRepo = new MinistryRepository();

    subService = {
      getOrganizationWhatsAppCapacity: vi.fn().mockImplementation(async () => ({
        organizationId: orgId,
        billingAnchorMinistryId: ministryId,
        enabled: mockAllowed > 0,
        includedConnections: mockAllowed,
        additionalConnections: 0,
        totalAllowedConnections: mockAllowed,
        billingAccessMode: mockAccessMode,
      })),
    } as unknown as SubscriptionService;

    service = new WhatsAppConnectionService(
      connectionRepo,
      undefined,
      claimRepo,
      orgRepo,
      subService,
      ministryRepo
    );
  });

  function setupValidConnection(
    id: string,
    overrides: Partial<WhatsAppConnectionRecord> = {}
  ): WhatsAppConnectionRecord {
    const conn: WhatsAppConnectionRecord = {
      id,
      organization_id: orgId,
      display_name: `Connection ${id}`,
      phone_number: `+551199999000${id.slice(-1)}`,
      provider: 'meta_cloud_api',
      provider_waba_id: `waba-${id}`,
      provider_phone_number_id: `phone-${id}`,
      status: 'connected',
      status_reason: null,
      assigned_ministry_id: null,
      created_by_user_id: 'owner-1',
      pending_expires_at: null,
      last_connected_at: new Date().toISOString(),
      last_health_check_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...overrides,
    };

    connectionsStore.set(id, conn);

    if (conn.provider_phone_number_id) {
      const claimId = getClaimId(conn.provider, conn.provider_phone_number_id);
      claimsStore.set(claimId, {
        id: claimId,
        provider: conn.provider,
        provider_phone_number_id: conn.provider_phone_number_id,
        organization_id: conn.organization_id,
        connection_id: conn.id,
      });
    }

    return conn;
  }

  it('1. Exclusive connected connection beats Organization default connection', async () => {
    const defaultConn = setupValidConnection('conn-default');
    const exclusiveConn = setupValidConnection('conn-exclusive', {
      assigned_ministry_id: ministryId,
    });

    organizationsStore.get(orgId)!.default_whatsapp_connection_id = defaultConn.id;

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(true);
    expect(res.source).toBe('exclusive');
    expect(res.connection?.id).toBe(exclusiveConn.id);
  });

  it('2. When no exclusive assignment exists, resolves to Organization default', async () => {
    const defaultConn = setupValidConnection('conn-default');
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = defaultConn.id;

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(true);
    expect(res.source).toBe('default');
    expect(res.connection?.id).toBe(defaultConn.id);
  });

  it('3. When no exclusive assignment and no Organization default exists, returns NO_CONNECTION_AVAILABLE', async () => {
    const res = await service.resolveWhatsAppConnection(ministryId);
    expect(res.success).toBe(false);
    expect(res.code).toBe('NO_CONNECTION_AVAILABLE');
  });

  it('4. Exclusive connection in error returns CONNECTION_NOT_ACTIVE (NO silent fallback to default! DEC-7C-03)', async () => {
    const defaultConn = setupValidConnection('conn-default');
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = defaultConn.id;

    setupValidConnection('conn-exclusive', {
      assigned_ministry_id: ministryId,
      status: 'error',
    });

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONNECTION_NOT_ACTIVE');
    // Zero fallback to defaultConn!
  });

  it('5. Exclusive connection in disabled_by_user returns CONNECTION_NOT_ACTIVE (NO silent fallback)', async () => {
    const defaultConn = setupValidConnection('conn-default');
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = defaultConn.id;

    setupValidConnection('conn-exclusive', {
      assigned_ministry_id: ministryId,
      status: 'disabled_by_user',
    });

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONNECTION_NOT_ACTIVE');
  });

  it('6. Organization default in error returns CONNECTION_NOT_ACTIVE', async () => {
    const defaultConn = setupValidConnection('conn-default', { status: 'error' });
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = defaultConn.id;

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONNECTION_NOT_ACTIVE');
  });

  it('7. Organization default in disabled_by_user returns CONNECTION_NOT_ACTIVE', async () => {
    const defaultConn = setupValidConnection('conn-default', { status: 'disabled_by_user' });
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = defaultConn.id;

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONNECTION_NOT_ACTIVE');
  });

  it('8. Organization default pointing to foreign organization returns NO_CONNECTION_AVAILABLE', async () => {
    const foreignConn = setupValidConnection('conn-foreign', { organization_id: 'org-foreign' });
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = foreignConn.id;

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(false);
    expect(res.code).toBe('NO_CONNECTION_AVAILABLE');
  });

  it('9. Missing or mismatched provider claim fails closed with CONNECTION_NOT_ACTIVE', async () => {
    const defaultConn = setupValidConnection('conn-default');
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = defaultConn.id;

    // Delete claim
    const claimId = getClaimId(defaultConn.provider, defaultConn.provider_phone_number_id!);
    claimsStore.delete(claimId);

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(false);
    expect(res.code).toBe('CONNECTION_NOT_ACTIVE');
  });

  it('10. Restricted over limit blocks dispatch with RESTRICTED_OVER_LIMIT', async () => {
    mockAllowed = 1;
    // Set 2 connections
    setupValidConnection('conn-1');
    setupValidConnection('conn-2');
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = 'conn-1';

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(false);
    expect(res.code).toBe('RESTRICTED_OVER_LIMIT');
  });

  it('11. Suspended mode blocks dispatch with WHATSAPP_SUSPENDED', async () => {
    mockAccessMode = 'suspended';
    setupValidConnection('conn-1');
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = 'conn-1';

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(false);
    expect(res.code).toBe('WHATSAPP_SUSPENDED');
  });

  it('12. Grace mode allows operational resolution of connected line', async () => {
    mockAccessMode = 'grace';
    const conn = setupValidConnection('conn-1');
    organizationsStore.get(orgId)!.default_whatsapp_connection_id = 'conn-1';

    const res = await service.resolveWhatsAppConnection(ministryId);

    expect(res.success).toBe(true);
    expect(res.connection?.id).toBe(conn.id);
  });

  it('13. Ministry with organization_id === null returns NO_ORGANIZATION', async () => {
    ministriesStore.set('min-no-org', {
      id: 'min-no-org',
      name: 'Sem Org',
      organization_id: null,
    });

    const res = await service.resolveWhatsAppConnection('min-no-org');

    expect(res.success).toBe(false);
    expect(res.code).toBe('NO_ORGANIZATION');
  });
});
