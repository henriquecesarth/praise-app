import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { SubscriptionService } from '../subscriptions/subscription.service';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import { WhatsAppConnectionRecord, CONFIG_CONSUMING_STATUSES } from './whatsapp.types';

describe('WhatsApp Commercial Capacity & Accounting Suite (Phase 7C)', () => {
  let connectionsStore: Map<string, WhatsAppConnectionRecord>;
  let connectionRepo: WhatsAppConnectionRepository;
  let subService: SubscriptionService;
  let service: WhatsAppConnectionService;

  const orgId = 'org-test-1';
  let mockAllowed = 1;
  let mockAccessMode: 'normal' | 'grace' | 'suspended' = 'normal';

  beforeEach(() => {
    vi.clearAllMocks();
    connectionsStore = new Map();
    mockAllowed = 1;
    mockAccessMode = 'normal';

    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      return {
        where: vi.fn().mockImplementation((field: string, op: string, val: any) => ({
          where: vi.fn().mockImplementation((field2: string, op2: string, val2: any) => ({
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
            get: vi.fn().mockImplementation(async () => {
              const matched: any[] = [];
              for (const [, doc] of connectionsStore) {
                if ((doc as any)[field] === val && val2.includes((doc as any)[field2])) {
                  matched.push({ id: doc.id, data: () => doc });
                }
              }
              return { docs: matched, size: matched.length };
            }),
          })),
        })),
        doc: vi.fn().mockImplementation((id: string) => ({
          set: vi.fn().mockImplementation(async (data: any) => {
            connectionsStore.set(id, { id, ...data });
          }),
          get: vi.fn().mockImplementation(async () => {
            const data = connectionsStore.get(id);
            return { exists: Boolean(data), id, data: () => data };
          }),
        })),
      };
    });

    connectionRepo = new WhatsAppConnectionRepository();
    subService = {
      getOrganizationWhatsAppCapacity: vi.fn().mockImplementation(async () => ({
        organizationId: orgId,
        billingAnchorMinistryId: 'min-1',
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
      undefined,
      undefined,
      subService
    );
  });

  it('1. Allowed 0 / Configured 0 (Free tier): cannot create, cannot send', async () => {
    mockAllowed = 0;
    const usage = await service.getOrganizationCapacityUsage(orgId);

    expect(usage.totalAllowedConnections).toBe(0);
    expect(usage.configuredConnectionsCount).toBe(0);
    expect(usage.remainingCapacity).toBe(0);
    expect(usage.canCreateConnection).toBe(false);
    expect(usage.canSendMessages).toBe(false);
  });

  it('2. Allowed 1 / Configured 0: can create, can send', async () => {
    mockAllowed = 1;
    const usage = await service.getOrganizationCapacityUsage(orgId);

    expect(usage.totalAllowedConnections).toBe(1);
    expect(usage.configuredConnectionsCount).toBe(0);
    expect(usage.remainingCapacity).toBe(1);
    expect(usage.canCreateConnection).toBe(true);
    expect(usage.canSendMessages).toBe(true);
  });

  it('3. Allowed 1 / Configured 1: cannot create, can send', async () => {
    mockAllowed = 1;
    connectionsStore.set('wac-1', {
      id: 'wac-1',
      organization_id: orgId,
      status: 'connected',
    } as WhatsAppConnectionRecord);

    const usage = await service.getOrganizationCapacityUsage(orgId);

    expect(usage.configuredConnectionsCount).toBe(1);
    expect(usage.remainingCapacity).toBe(0);
    expect(usage.canCreateConnection).toBe(false);
    expect(usage.canSendMessages).toBe(true);
  });

  it('4. Allowed 1 / Configured 2 (Over Limit): evaluates to restricted_over_limit, cannot create, cannot send', async () => {
    mockAllowed = 1;
    connectionsStore.set('wac-1', {
      id: 'wac-1',
      organization_id: orgId,
      status: 'connected',
    } as WhatsAppConnectionRecord);
    connectionsStore.set('wac-2', {
      id: 'wac-2',
      organization_id: orgId,
      status: 'connected',
    } as WhatsAppConnectionRecord);

    const usage = await service.getOrganizationCapacityUsage(orgId);

    expect(usage.configuredConnectionsCount).toBe(2);
    expect(usage.totalAllowedConnections).toBe(1);
    expect(usage.remainingCapacity).toBe(0);
    expect(usage.connectionAccessMode).toBe('restricted_over_limit');
    expect(usage.canCreateConnection).toBe(false);
    expect(usage.canSendMessages).toBe(false);
  });

  it('5. Capacity slot consumption: pending, connecting, connected, error, disabled_by_user consume; disconnected DOES NOT consume', async () => {
    mockAllowed = 10;

    for (const status of CONFIG_CONSUMING_STATUSES) {
      connectionsStore.set(`wac-${status}`, {
        id: `wac-${status}`,
        organization_id: orgId,
        status,
      } as WhatsAppConnectionRecord);
    }

    // Also add disconnected
    connectionsStore.set('wac-disconnected', {
      id: 'wac-disconnected',
      organization_id: orgId,
      status: 'disconnected',
    } as WhatsAppConnectionRecord);

    const usage = await service.getOrganizationCapacityUsage(orgId);
    // 5 statuses consume; disconnected does NOT
    expect(usage.configuredConnectionsCount).toBe(5);
    expect(usage.remainingCapacity).toBe(5);
  });

  it('6. Grace mode allows operational sending but blocks new creation', async () => {
    mockAllowed = 2;
    mockAccessMode = 'grace';

    connectionsStore.set('wac-1', {
      id: 'wac-1',
      organization_id: orgId,
      status: 'connected',
    } as WhatsAppConnectionRecord);

    const usage = await service.getOrganizationCapacityUsage(orgId);

    expect(usage.connectionAccessMode).toBe('grace');
    expect(usage.canCreateConnection).toBe(false); // Grace blocks creation
    expect(usage.canSendMessages).toBe(true); // Grace allows sending
  });

  it('7. Suspended mode blocks both creation and sending', async () => {
    mockAllowed = 2;
    mockAccessMode = 'suspended';

    const usage = await service.getOrganizationCapacityUsage(orgId);

    expect(usage.connectionAccessMode).toBe('suspended');
    expect(usage.canCreateConnection).toBe(false);
    expect(usage.canSendMessages).toBe(false);
  });

  it('8. Downgrade preservation: over-limit evaluation mutates ZERO stored documents', async () => {
    mockAllowed = 1;
    const originalDoc1 = {
      id: 'wac-1',
      organization_id: orgId,
      status: 'connected' as const,
      display_name: 'Line 1',
    };
    const originalDoc2 = {
      id: 'wac-2',
      organization_id: orgId,
      status: 'connected' as const,
      display_name: 'Line 2',
    };

    connectionsStore.set('wac-1', { ...originalDoc1 } as WhatsAppConnectionRecord);
    connectionsStore.set('wac-2', { ...originalDoc2 } as WhatsAppConnectionRecord);

    // Call capacity usage
    const usage = await service.getOrganizationCapacityUsage(orgId);
    expect(usage.connectionAccessMode).toBe('restricted_over_limit');

    // Verify stored records were untouched
    expect(connectionsStore.get('wac-1')).toEqual(originalDoc1);
    expect(connectionsStore.get('wac-2')).toEqual(originalDoc2);
  });

  it('9. additionalConnections remains 0 in Phase 7C runtime', async () => {
    const usage = await service.getOrganizationCapacityUsage(orgId);
    expect(usage.additionalConnections).toBe(0);
  });
});
