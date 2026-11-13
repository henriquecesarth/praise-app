import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { db, authAdmin } from '../../lib/firebase';
import { AccountDeletionRepository } from '../../repositories/AccountDeletionRepository';
import { SubscriptionRepository } from '../../repositories/SubscriptionRepository';
import { AccountDeletionService } from './account-deletion.service';

describe('Account Deletion H13 & M03 Adversarial Regressions', () => {
  const userId = 'user-delete-h13';
  const ministryA = 'min-del-a';
  const ministryB = 'min-del-b';
  let stores: Record<string, Map<string, any>>;
  let customVocalStore: Map<string, any>;
  let failNextTx = false;

  beforeEach(() => {
    vi.clearAllMocks();
    failNextTx = false;
    customVocalStore = new Map([
      ['ex-1', { id: 'ex-1', userId, title: 'Aquecimento Privado', notes: ['C4', 'D4'] }],
      ['ex-2', { id: 'ex-2', userId, title: 'Escala Privada', notes: ['E4', 'F4'] }],
    ]);

    stores = {
      account_deletion_jobs: new Map(),
      users: new Map([[userId, { id: userId, email: 'del@test.dev', name: 'Nome PII', phone: '+5511999990000' }]]),
      smart_chords: new Map(),
      smart_chord_song_links: new Map(),
      member_unavailabilities: new Map(),
      schedule_comments: new Map(),
      ministry_invites: new Map(),
      group_invites: new Map(),
      push_devices: new Map(),
      user_notifications: new Map(),
      ministry_members: new Map([
        [
          'mm-active-a',
          {
            id: 'mm-active-a',
            ministry_id: ministryA,
            user_id: userId,
            name: 'Nome PII Ativo',
            email: 'del@test.dev',
            phone: '+5511999990000',
            birthDate: '1990-01-01',
            role: 'member',
            status: 'active',
          },
        ],
        [
          'mm-soft-removed-b',
          {
            id: 'mm-soft-removed-b',
            ministry_id: ministryB,
            user_id: userId,
            name: 'Nome PII SoftRemoved',
            email: 'del@test.dev',
            phone: '+5511999990000',
            birthDate: '1990-01-01',
            role: 'member',
            status: 'removed',
          },
        ],
      ]),
      group_members: new Map([
        [
          'gm-1',
          { id: 'gm-1', group_id: ministryA, user_id: userId, name: 'Legacy PII', email: 'del@test.dev' },
        ],
      ]),
      organization_members: new Map([
        ['org1_user', { id: 'org1_user', organization_id: 'org-1', user_id: userId, role: 'member' }],
      ]),
      ministry_usage: new Map([
        [ministryA, { id: ministryA, ministry_id: ministryA, members_count: 5, songs_count: 10 }],
        [ministryB, { id: ministryB, ministry_id: ministryB, members_count: 3, songs_count: 4 }],
      ]),
      ministries: new Map([
        [ministryA, { id: ministryA, owner_user_id: 'owner-other' }],
        [ministryB, { id: ministryB, owner_user_id: 'owner-other' }],
      ]),
      groups: new Map(),
      organizations: new Map(),
      ministry_teams: new Map(),
      schedules: new Map(),
      songs: new Map(),
      liturgies: new Map(),
      ministry_announcements: new Map(),
      billing_plan_changes: new Map(),
      billing_customers: new Map(),
      billing_subscriptions: new Map(),
      ministry_subscriptions: new Map(),
      whatsapp_connections: new Map(),
      whatsapp_onboarding_sessions: new Map(),
    };

    const makeSubQuery = (subStore: Map<string, any>) => ({
      get: vi.fn(async () => ({
        empty: subStore.size === 0,
        docs: Array.from(subStore.values()).map((d) => ({
          id: d.id,
          exists: true,
          ref: {
            id: d.id,
            delete: vi.fn(async () => {
              subStore.delete(d.id);
            }),
          },
          data: () => ({ ...d }),
        })),
      })),
    });

    const makeDocRef = (colName: string, docId: string): any => {
      const ref: any = {
        id: docId,
        get: vi.fn(async () => {
          const store = (stores[colName] ||= new Map());
          const data = store.get(docId);
          return {
            exists: Boolean(data),
            id: docId,
            ref,
            data: () => (data ? { ...data } : undefined),
          };
        }),
        set: vi.fn(async (data: any) => {
          const store = (stores[colName] ||= new Map());
          store.set(docId, { id: docId, ...data });
        }),
        update: vi.fn(async (data: any) => {
          const store = (stores[colName] ||= new Map());
          const current = store.get(docId) || {};
          store.set(docId, { ...current, ...data, id: docId });
        }),
        delete: vi.fn(async () => {
          stores[colName]?.delete(docId);
        }),
      };
      if (colName === 'users' && docId === userId) {
        ref.collection = vi.fn((subCol: string) => {
          if (subCol === 'custom_vocal_exercises') return makeSubQuery(customVocalStore);
          return makeSubQuery(new Map());
        });
      }
      return ref;
    };

    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      const store = (stores[colName] ||= new Map());
      return {
        doc: vi.fn((docId: string) => makeDocRef(colName, docId)),
        where: vi.fn((field: string, _op: string, val: any) => {
          const filters = [{ field, val }];
          const state: { pageLimit?: number; cursorId?: string; ordered?: boolean } = {};
          const buildSnap = () => {
            let docs = Array.from(store.values());
            for (const f of filters) {
              docs = docs.filter((d) => d[f.field] === f.val);
            }
            if (state.ordered) {
              docs.sort((a, b) => String(a.id).localeCompare(String(b.id)));
            }
            if (state.cursorId) {
              docs = docs.filter((d) => String(d.id) > state.cursorId!);
            }
            if (typeof state.pageLimit === 'number') {
              docs = docs.slice(0, state.pageLimit);
            }
            return {
              empty: docs.length === 0,
              docs: docs.map((d) => ({
                id: d.id,
                exists: true,
                ref: makeDocRef(colName, d.id),
                data: () => ({ ...d }),
              })),
            };
          };
          const q: any = {
            where: vi.fn((f2: string, _o2: string, v2: any) => {
              filters.push({ field: f2, val: v2 });
              return q;
            }),
            orderBy: vi.fn(() => {
              state.ordered = true;
              return q;
            }),
            limit: vi.fn((n: number) => {
              state.pageLimit = n;
              return q;
            }),
            startAfter: vi.fn((cursorDoc: any) => {
              state.cursorId = cursorDoc.id;
              return q;
            }),
            get: vi.fn(async () => buildSnap()),
          };
          return q;
        }),
        get: vi.fn(async () => ({
          empty: store.size === 0,
          docs: Array.from(store.values()).map((d) => ({
            id: d.id,
            exists: true,
            ref: makeDocRef(colName, d.id),
            data: () => ({ ...d }),
          })),
        })),
      };
    });

    vi.spyOn(db, 'batch').mockImplementation(() => {
      const ops: Array<() => void> = [];
      return {
        delete: vi.fn((ref: any) => {
          ops.push(() => {
            if ((ref as any)._store) (ref as any)._store.delete(ref.id);
            else ref.delete();
          });
        }),
        update: vi.fn((ref: any, data: any) => {
          ops.push(() => ref.update(data));
        }),
        commit: vi.fn(async () => {
          for (const op of ops) op();
        }),
      } as any;
    });

    let txQueue = Promise.resolve();
    vi.spyOn(db, 'runTransaction').mockImplementation((callback: any) => {
      const run = async () => {
        if (failNextTx) {
          failNextTx = false;
          throw new Error('FIRESTORE_TRANSIENT_UNAVAILABLE');
        }
        const tx: any = {
          get: vi.fn(async (docRef: any) => await docRef.get()),
          set: vi.fn((docRef: any, data: any) => docRef.set(data)),
          update: vi.fn((docRef: any, data: any) => docRef.update(data)),
          delete: vi.fn((docRef: any) => docRef.delete()),
        };
        return await callback(tx);
      };
      const result = txQueue.then(run, run);
      txQueue = result.catch(() => {});
      return result;
    });

    vi.spyOn(authAdmin, 'deleteUser').mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('H13: deletePersonalData removes users/{userId}/custom_vocal_exercises subcollection documents', async () => {
    const repo = new AccountDeletionRepository();
    await repo.deletePersonalData(userId);

    expect(stores.users.has(userId)).toBe(false);
    expect(customVocalStore.size).toBe(0);
  });

  it('H13: detachMemberships permanently purges all ministry_members (including soft-removed) with zero residual PII and decrements quota once for active member only', async () => {
    const repo = new AccountDeletionRepository();
    const manifest = await repo.createManifest(userId);

    await repo.detachMemberships(userId, manifest);

    // Zero ministry_members, group_members, or organization_members PII left
    expect(stores.ministry_members.size).toBe(0);
    expect(stores.group_members.size).toBe(0);
    expect(stores.organization_members.size).toBe(0);

    // Active ministry A decremented 5 -> 4; previously soft-removed ministry B untouched at 3
    expect(stores.ministry_usage.get(ministryA)?.members_count).toBe(4);
    expect(stores.ministry_usage.get(ministryB)?.members_count).toBe(3);

    // Idempotent retry must NOT double-decrement
    await repo.detachMemberships(userId, manifest);
    expect(stores.ministry_usage.get(ministryA)?.members_count).toBe(4);
  });

  it('M03: detachMemberships propagates transient errors instead of swallowing them and advancing checkpoint, and recovers on retry', async () => {
    const repo = new AccountDeletionRepository();
    const service = new AccountDeletionService(repo);

    failNextTx = true;
    await expect(service.executeDeletion(userId, 'del@test.dev')).rejects.toThrow('FIRESTORE_TRANSIENT_UNAVAILABLE');

    const failedJob = stores.account_deletion_jobs.get(`del_${userId}`);
    expect(failedJob?.checkpoints?.memberships_detached).not.toBe(true);
    // Transient failure did NOT silently delete the doc without decrementing quota
    expect(stores.ministry_members.has('mm-active-a')).toBe(true);
    expect(stores.ministry_usage.get(ministryA)?.members_count).toBe(5);

    // Recovery retry succeeds cleanly
    const completed = await service.reconcileJob(userId);
    expect(completed.status).toBe('completed');
    expect(stores.ministry_members.size).toBe(0);
    expect(stores.ministry_usage.get(ministryA)?.members_count).toBe(4);
  });

  it('H13-FR2-3a: concurrent account-deletion purges of two admins in the same ministry leave at least 1 active admin fail-closed', async () => {
    const admin1 = 'user-admin-race-1';
    const admin2 = 'user-admin-race-2';
    const sharedMin = 'min-dual-admin';
    stores.ministries.set(sharedMin, {
      id: sharedMin,
      name: 'Ministério Race',
      owner_user_id: 'owner-stays',
    });
    stores.ministry_usage.set(sharedMin, {
      id: sharedMin,
      ministry_id: sharedMin,
      members_count: 3,
      songs_count: 0,
    });
    stores.ministry_members.set('mm-admin-1', {
      id: 'mm-admin-1',
      ministry_id: sharedMin,
      user_id: admin1,
      role: 'admin',
      status: 'active',
    });
    stores.ministry_members.set('mm-admin-2', {
      id: 'mm-admin-2',
      ministry_id: sharedMin,
      user_id: admin2,
      role: 'admin',
      status: 'active',
    });

    const subRepo = new SubscriptionRepository();
    const results = await Promise.allSettled([
      subRepo.purgeMemberOnAccountDeletionTransactional({ memberDocId: 'mm-admin-1', userId: admin1 }),
      subRepo.purgeMemberOnAccountDeletionTransactional({ memberDocId: 'mm-admin-2', userId: admin2 }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({ code: 'SOLE_MINISTRY_ADMIN_CANNOT_BE_PURGED' }),
    });

    const remainingAdmins = Array.from(stores.ministry_members.values()).filter(
      (m) => m.ministry_id === sharedMin && m.role === 'admin' && m.status !== 'removed'
    );
    expect(remainingAdmins).toHaveLength(1);
  });

  it('H13-FR2-3b: transactional member purge rejects ministry owner_user_id fail-closed', async () => {
    const ownerId = 'user-owner-purge';
    const ownedMin = 'min-owned-purge';
    stores.ministries.set(ownedMin, {
      id: ownedMin,
      name: 'Ministério Owned',
      owner_user_id: ownerId,
    });
    stores.ministry_members.set('mm-owner-1', {
      id: 'mm-owner-1',
      ministry_id: ownedMin,
      user_id: ownerId,
      role: 'admin',
      status: 'active',
    });
    // Even with another active admin present, owner cannot be purged
    stores.ministry_members.set('mm-other-admin', {
      id: 'mm-other-admin',
      ministry_id: ownedMin,
      user_id: 'other-admin',
      role: 'admin',
      status: 'active',
    });

    const subRepo = new SubscriptionRepository();
    await expect(
      subRepo.purgeMemberOnAccountDeletionTransactional({ memberDocId: 'mm-owner-1', userId: ownerId })
    ).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({ code: 'MINISTRY_OWNER_CANNOT_BE_PURGED' }),
    });
    expect(stores.ministry_members.has('mm-owner-1')).toBe(true);
  });

  it('H13-FR2-3c: reconcileJob re-evaluates preflight before detaching memberships when user became sole active admin', async () => {
    const raceUser = 'user-stale-reconcile';
    const raceMin = 'min-stale-reconcile';
    stores.ministries.set(raceMin, {
      id: raceMin,
      name: 'Ministério Reconcile',
      owner_user_id: 'owner-someone-else',
    });
    stores.ministry_members.set('mm-stale-admin', {
      id: 'mm-stale-admin',
      ministry_id: raceMin,
      user_id: raceUser,
      role: 'admin',
      status: 'active',
    });
    stores.account_deletion_jobs.set(`del_${raceUser}`, {
      id: `del_${raceUser}`,
      user_id: raceUser,
      user_email: 'stale@test.dev',
      status: 'cleanup_in_progress',
      checkpoints: { manifest_created: true, personal_data_deleted: true },
      manifest: {
        ministry_ids: [raceMin],
        ministry_member_doc_ids: ['mm-stale-admin'],
        organization_member_doc_ids: [],
        group_member_doc_ids: [],
        member_ids: ['mm-stale-admin'],
      },
      requested_at: '2026-11-13T09:00:00.000Z',
      updated_at: '2026-11-13T09:00:00.000Z',
    });

    const repo = new AccountDeletionRepository();
    const service = new AccountDeletionService(repo);

    await expect(service.reconcileJob(raceUser)).rejects.toMatchObject({
      statusCode: 409,
      details: expect.objectContaining({ code: 'PREFLIGHT_BLOCKED' }),
    });

    expect(stores.account_deletion_jobs.get(`del_${raceUser}`)?.status).toBe('preflight_blocked');
    expect(stores.ministry_members.has('mm-stale-admin')).toBe(true);
  });

  it('H13-R3-bound: ordinary member purge with usage doc executes zero membership queries; admin & missing-usage fallback use bounded paginated queries', async () => {
    const bigMin = 'min-r3-bounded';
    const ordUser = 'user-ord-1';
    stores.ministries.set(bigMin, {
      id: bigMin,
      name: 'Ministério Grande',
      owner_user_id: 'owner-big',
    });
    stores.ministry_usage.set(bigMin, {
      id: bigMin,
      ministry_id: bigMin,
      members_count: 150,
      songs_count: 10,
    });
    stores.ministry_members.set('mm-ord-1', {
      id: 'mm-ord-1',
      ministry_id: bigMin,
      user_id: ordUser,
      role: 'member',
      status: 'active',
    });
    for (let i = 0; i < 40; i++) {
      const id = `mm-extra-${String(i).padStart(3, '0')}`;
      stores.ministry_members.set(id, {
        id,
        ministry_id: bigMin,
        user_id: `u-extra-${i}`,
        role: i === 5 ? 'admin' : 'member',
        status: 'active',
      });
    }

    const subRepo = new SubscriptionRepository();
    const membersWhereSpy = vi.spyOn((subRepo as any).membersCol, 'where');

    // 1. Ordinary member purge with existing usage doc -> 0 queries on membersCol!
    await subRepo.purgeMemberOnAccountDeletionTransactional({ memberDocId: 'mm-ord-1', userId: ordUser });
    expect(membersWhereSpy).not.toHaveBeenCalled();
    expect(stores.ministry_usage.get(bigMin)?.members_count).toBe(149);

    // 2. Admin purge with existing usage doc -> bounded role=admin query only (never scans ordinary members)
    const adminUser = 'user-admin-r3';
    stores.ministry_members.set('mm-admin-r3', {
      id: 'mm-admin-r3',
      ministry_id: bigMin,
      user_id: adminUser,
      role: 'admin',
      status: 'active',
    });
    await subRepo.purgeMemberOnAccountDeletionTransactional({ memberDocId: 'mm-admin-r3', userId: adminUser });
    expect(membersWhereSpy).toHaveBeenCalledWith('ministry_id', '==', bigMin);
    expect(stores.ministry_members.has('mm-admin-r3')).toBe(false);

    // 3. Missing usage doc fallback -> bounded paginated fallback (100 per page) across >100 docs
    const missingUsageMin = 'min-missing-usage-r3';
    stores.ministries.set(missingUsageMin, {
      id: missingUsageMin,
      name: 'Ministério Sem Usage',
      owner_user_id: 'owner-mu',
    });
    for (let i = 0; i < 120; i++) {
      const id = `mm-mu-${String(i).padStart(3, '0')}`;
      stores.ministry_members.set(id, {
        id,
        ministry_id: missingUsageMin,
        user_id: i === 0 ? 'user-mu-target' : `u-mu-${i}`,
        role: 'member',
        status: 'active',
      });
    }
    await subRepo.purgeMemberOnAccountDeletionTransactional({
      memberDocId: 'mm-mu-000',
      userId: 'user-mu-target',
    });
    expect(stores.ministry_usage.get(missingUsageMin)?.members_count).toBe(119);
  });
});
