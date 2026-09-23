import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../lib/firebase';
import { WhatsAppProviderIdentityClaimRepository } from '../../repositories/WhatsAppProviderIdentityClaimRepository';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionService } from './whatsapp-connection.service';
import {
  WhatsAppConnectionRecord,
  WhatsAppProviderIdentityClaimRecord,
  getClaimId,
} from './whatsapp.types';

describe('WhatsApp Provider Identity Claims Suite (Phase 7C)', () => {
  let claimsStore: Map<string, WhatsAppProviderIdentityClaimRecord>;
  let connectionsStore: Map<string, WhatsAppConnectionRecord>;
  let organizationsStore: Map<string, any>;

  let claimRepo: WhatsAppProviderIdentityClaimRepository;
  let connectionRepo: WhatsAppConnectionRepository;
  let service: WhatsAppConnectionService;

  beforeEach(() => {
    vi.clearAllMocks();

    claimsStore = new Map();
    connectionsStore = new Map();
    organizationsStore = new Map();

    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      const getStore = () => {
        switch (colName) {
          case 'whatsapp_provider_identity_claims':
            return claimsStore;
          case 'whatsapp_connections':
            return connectionsStore;
          case 'organizations':
            return organizationsStore;
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
      };
    });

    vi.spyOn(db, 'runTransaction').mockImplementation(async (updateFn: any) => {
      const tx: any = {
        get: async (docRef: any) => {
          return await docRef.get();
        },
        set: (docRef: any, data: any) => {
          const colName = docRef.id ? (docRef.id.startsWith('claim_') ? claimsStore : docRef.id.startsWith('wac_') ? connectionsStore : organizationsStore) : connectionsStore;
          colName.set(docRef.id, { id: docRef.id, ...data });
        },
        update: (docRef: any, data: any) => {
          const colName = docRef.id.startsWith('claim_') ? claimsStore : docRef.id.startsWith('wac_') ? connectionsStore : organizationsStore;
          const current = colName.get(docRef.id) || {};
          colName.set(docRef.id, { ...current, ...data });
        },
        delete: (docRef: any) => {
          const colName = docRef.id.startsWith('claim_') ? claimsStore : docRef.id.startsWith('wac_') ? connectionsStore : organizationsStore;
          colName.delete(docRef.id);
        },
      };
      return await updateFn(tx);
    });

    claimRepo = new WhatsAppProviderIdentityClaimRepository();
    connectionRepo = new WhatsAppConnectionRepository();
    service = new WhatsAppConnectionService(connectionRepo, undefined, claimRepo);
  });

  it('1. Pre-materialization pending connection has no claim', async () => {
    const conn = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'Pending Line',
      created_by_user_id: 'user-1',
      status: 'pending',
    });

    expect(conn.phone_number).toBeNull();
    expect(conn.provider_phone_number_id).toBeNull();
    expect(claimsStore.size).toBe(0);
  });

  it('2. Early connecting connection has no claim prior to phone ID materialization', async () => {
    const conn = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'Connecting Line',
      created_by_user_id: 'user-1',
      status: 'connecting',
    });

    expect(conn.phone_number).toBeNull();
    expect(claimsStore.size).toBe(0);
  });

  it('3. Claim is acquired atomically when provider phone ID materializes', async () => {
    const conn = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'Line To Materialize',
      created_by_user_id: 'user-1',
      status: 'connecting',
    });

    await service.materializeProviderIdentity('org-1', conn.id, {
      phoneNumber: '+5511999998888',
      providerWabaId: 'waba-100',
      providerPhoneNumberId: 'phone-100',
    });

    const claimId = getClaimId('meta_cloud_api', 'phone-100');
    const claim = await claimRepo.getClaim(claimId);

    expect(claim).toBeDefined();
    expect(claim?.connection_id).toBe(conn.id);
    expect(claim?.organization_id).toBe('org-1');
    expect(claim?.provider_phone_number_id).toBe('phone-100');

    const updatedConn = await connectionRepo.getConnectionById(conn.id);
    expect(updatedConn?.phone_number).toBe('+5511999998888');
    expect(updatedConn?.provider_phone_number_id).toBe('phone-100');
  });

  it('4. Concurrent claim attempt for same provider_phone_number_id rejects second connection with 409', async () => {
    const conn1 = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'First Line',
      created_by_user_id: 'user-1',
      status: 'connecting',
    });

    const conn2 = await connectionRepo.createConnection({
      organization_id: 'org-2',
      display_name: 'Second Line (Rival)',
      created_by_user_id: 'user-2',
      status: 'connecting',
    });

    // conn1 claims phone-200
    await service.materializeProviderIdentity('org-1', conn1.id, {
      phoneNumber: '+5511999997777',
      providerWabaId: 'waba-200',
      providerPhoneNumberId: 'phone-200',
    });

    // conn2 attempts to claim phone-200 while conn1 is active
    await expect(
      service.materializeProviderIdentity('org-2', conn2.id, {
        phoneNumber: '+5511999997777',
        providerWabaId: 'waba-200',
        providerPhoneNumberId: 'phone-200',
      })
    ).rejects.toThrow(/PROVIDER_PHONE_ALREADY_REGISTERED/);
  });

  it('5. Error and disabled_by_user retain the provider claim', async () => {
    const conn = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'Operational Line',
      created_by_user_id: 'user-1',
      status: 'connecting',
    });

    await service.materializeProviderIdentity('org-1', conn.id, {
      phoneNumber: '+5511999996666',
      providerWabaId: 'waba-300',
      providerPhoneNumberId: 'phone-300',
    });

    // Enter connected
    await service.transitionConnectionStatus('org-1', conn.id, 'connected');

    // Degrade to error
    await service.transitionConnectionStatus('org-1', conn.id, 'error');
    const claimId = getClaimId('meta_cloud_api', 'phone-300');
    expect(await claimRepo.getClaim(claimId)).not.toBeNull();

    // Pause to disabled_by_user
    await service.transitionConnectionStatus('org-1', conn.id, 'disabled_by_user');
    expect(await claimRepo.getClaim(claimId)).not.toBeNull();
  });

  it('6. Meta disconnect retains claim for D7 strong settlement (DEFECT 2 fix)', async () => {
    const conn = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'Line to Disconnect',
      created_by_user_id: 'user-1',
      status: 'connecting',
    });

    await service.materializeProviderIdentity('org-1', conn.id, {
      phoneNumber: '+5511999995555',
      providerWabaId: 'waba-400',
      providerPhoneNumberId: 'phone-400',
    });

    await service.transitionConnectionStatus('org-1', conn.id, 'connected');

    const claimId = getClaimId('meta_cloud_api', 'phone-400');
    expect(await claimRepo.getClaim(claimId)).not.toBeNull();

    // Terminal disconnect - CLAIM MUST BE RETAINED for D7 strong settlement
    // The provider claim is NOT deleted here; it will be released atomically by
    // finalizeMetaCleanupOnStrongSettlement() after durable provider cleanup proof.
    await connectionRepo.disconnectConnection('org-1', conn.id);

    // Claim is retained (not deleted) - DEFECT 2 fix verification
    const claimAfterDisconnect = await claimRepo.getClaim(claimId);
    expect(claimAfterDisconnect).not.toBeNull();
    expect(claimAfterDisconnect?.connection_id).toBe(conn.id);
    expect(claimAfterDisconnect?.organization_id).toBe('org-1');

    // A new connection cannot immediately reacquire the phone because claim is retained
    // Ownership transfer only happens during strong settlement (finalizeMetaCleanupOnStrongSettlement)
    const newConn = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'New Line',
      created_by_user_id: 'user-1',
      status: 'connecting',
    });

    // New connection will NOT be able to claim the same phone while claim is retained
    await expect(
      service.materializeProviderIdentity('org-1', newConn.id, {
        phoneNumber: '+5511999995555',
        providerWabaId: 'waba-400',
        providerPhoneNumberId: 'phone-400',
      })
    ).rejects.toThrow(/PROVIDER_PHONE_ALREADY_REGISTERED/);
  });

  it('7. Disconnect replay retains claim owned by original connection (F3 remediation)', async () => {
    // 1. Connection A claims phone-500
    const connA = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'Line A',
      created_by_user_id: 'user-1',
      status: 'connecting',
    });

    await service.materializeProviderIdentity('org-1', connA.id, {
      phoneNumber: '+5511999995550',
      providerWabaId: 'waba-500',
      providerPhoneNumberId: 'phone-500',
    });
    await service.transitionConnectionStatus('org-1', connA.id, 'connected');

    const claimId = getClaimId('meta_cloud_api', 'phone-500');
    expect(await claimRepo.getClaim(claimId)).not.toBeNull();

    // 2. Disconnect Connection A - claim is RETAINED (DEFECT 2 fix)
    await connectionRepo.disconnectConnection('org-1', connA.id);
    expect(await claimRepo.getClaim(claimId)).not.toBeNull();
    expect((await claimRepo.getClaim(claimId))?.connection_id).toBe(connA.id);

    const disconnectedA = await connectionRepo.getConnectionById(connA.id);
    expect(disconnectedA?.status).toBe('disconnected');

    // 3. Connection B attempts to claim phone-500 - should FAIL because claim is retained
    const connB = await connectionRepo.createConnection({
      organization_id: 'org-1',
      display_name: 'Line B',
      created_by_user_id: 'user-2',
      status: 'connecting',
    });

    // Claim is still owned by A, so B cannot claim
    await expect(
      service.materializeProviderIdentity('org-1', connB.id, {
        phoneNumber: '+5511999995550',
        providerWabaId: 'waba-500',
        providerPhoneNumberId: 'phone-500',
      })
    ).rejects.toThrow(/PROVIDER_PHONE_ALREADY_REGISTERED/);

    // 4. Replay disconnect of Connection A (idempotent)
    await connectionRepo.disconnectConnection('org-1', connA.id);

    // 5. Assert Connection A's claim remains INTACT
    const claimAfterReplay = await claimRepo.getClaim(claimId);
    expect(claimAfterReplay).not.toBeNull();
    expect(claimAfterReplay?.connection_id).toBe(connA.id);
    expect(claimAfterReplay?.provider_phone_number_id).toBe('phone-500');
  });
});