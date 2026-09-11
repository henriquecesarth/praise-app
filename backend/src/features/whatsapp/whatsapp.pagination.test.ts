import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../../lib/firebase';
import { WhatsAppConnectionRepository } from '../../repositories/WhatsAppConnectionRepository';
import { WhatsAppConnectionRecord } from './whatsapp.types';

describe('WhatsApp Bounded Cursor Pagination Suite (Phase 7C / DEC-7C-14)', () => {
  let connectionsStore: Map<string, WhatsAppConnectionRecord>;
  let repo: WhatsAppConnectionRepository;

  const orgId = 'org-test-1';

  beforeEach(() => {
    vi.clearAllMocks();
    connectionsStore = new Map();

    vi.spyOn(db, 'collection').mockImplementation((colName: string): any => {
      return {
        where: vi.fn().mockImplementation((field: string, op: string, val: any) => {
          let docs = Array.from(connectionsStore.values()).filter(
            (doc) => (doc as any)[field] === val
          );

          return {
            orderBy: vi.fn().mockImplementation((orderField: string, direction: 'asc' | 'desc') => ({
              orderBy: vi.fn().mockImplementation((tieBreaker: string, tieDirection: 'asc' | 'desc') => {
                // Compound sort: orderField, then tieBreaker
                docs.sort((a, b) => {
                  const valA = (a as any)[orderField];
                  const valB = (b as any)[orderField];
                  if (valA !== valB) {
                    return direction === 'desc'
                      ? String(valB).localeCompare(String(valA))
                      : String(valA).localeCompare(String(valB));
                  }
                  const idA = a.id;
                  const idB = b.id;
                  return tieDirection === 'desc'
                    ? idB.localeCompare(idA)
                    : idA.localeCompare(idB);
                });

                const queryObj: any = {
                  startAfter: vi.fn().mockImplementation((cursorCreatedAt: string, cursorId: string) => {
                    const idx = docs.findIndex(
                      (d) => d.created_at === cursorCreatedAt && d.id === cursorId
                    );
                    if (idx !== -1) {
                      docs = docs.slice(idx + 1);
                    }
                    return queryObj;
                  }),
                  limit: vi.fn().mockImplementation((lim: number) => ({
                    get: vi.fn().mockImplementation(async () => {
                      const sliced = docs.slice(0, lim);
                      return {
                        docs: sliced.map((d) => ({
                          id: d.id,
                          data: () => d,
                        })),
                        size: sliced.length,
                        empty: sliced.length === 0,
                      };
                    }),
                  })),
                };

                return queryObj;
              }),
            })),
          };
        }),
      };
    });

    repo = new WhatsAppConnectionRepository();
  });

  function populateRecords(count: number, targetOrgId: string = orgId, baseTimestamp: number = 1700000000000) {
    for (let i = 1; i <= count; i++) {
      // Pad id for deterministic sorting: wac_01, wac_02, ...
      const pad = String(i).padStart(3, '0');
      const id = `wac_${pad}`;
      // Every record has unique timestamp descending with i
      const createdAt = new Date(baseTimestamp - i * 1000).toISOString();

      connectionsStore.set(id, {
        id,
        organization_id: targetOrgId,
        display_name: `Connection ${pad}`,
        phone_number: `+5511900000${pad}`,
        provider: 'meta_cloud_api',
        provider_waba_id: `waba_${pad}`,
        provider_phone_number_id: `phone_${pad}`,
        status: 'connected',
        status_reason: null,
        assigned_ministry_id: null,
        created_by_user_id: 'user-1',
        pending_expires_at: null,
        last_connected_at: createdAt,
        last_health_check_at: null,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }
  }

  it('1. Default pageSize is 25 and returns exactly 25 items', async () => {
    populateRecords(30);
    const result = await repo.listConnectionsByOrganization(orgId);

    expect(result.items.length).toBe(25);
    expect(result.nextCursor).not.toBeNull();
  });

  it('2. Exactly pageSize (25) records returns nextCursor === null (zero ghost cursors! DEC-7C-14)', async () => {
    populateRecords(25); // Exactly 25!
    const result = await repo.listConnectionsByOrganization(orgId, { limit: 25 });

    expect(result.items.length).toBe(25);
    expect(result.nextCursor).toBeNull(); // NO GHOST CURSOR
  });

  it('3. pageSize + 1 (26) records returns 25 items and valid nextCursor', async () => {
    populateRecords(26); // 26 records
    const result = await repo.listConnectionsByOrganization(orgId, { limit: 25 });

    expect(result.items.length).toBe(25);
    expect(result.nextCursor).not.toBeNull();

    // Decode cursor to verify payload
    const decoded = JSON.parse(Buffer.from(result.nextCursor!, 'base64url').toString('utf8'));
    expect(decoded.id).toBe(result.items[24].id);
    expect(decoded.createdAt).toBe(result.items[24].created_at);
  });

  it('4. Cursor continuity: Page 2 continues immediately after Page 1 without duplicates or gaps', async () => {
    populateRecords(40);

    const page1 = await repo.listConnectionsByOrganization(orgId, { limit: 25 });
    expect(page1.items.length).toBe(25);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await repo.listConnectionsByOrganization(orgId, {
      limit: 25,
      cursor: page1.nextCursor!,
    });

    expect(page2.items.length).toBe(15);
    expect(page2.nextCursor).toBeNull(); // End of results

    // Verify disjoint sets
    const page1Ids = new Set(page1.items.map((i) => i.id));
    for (const item of page2.items) {
      expect(page1Ids.has(item.id)).toBe(false);
    }
  });

  it('5. Clamping: limit > 50 clamps to 50, limit < 1 clamps to 1', async () => {
    populateRecords(60);

    const clamped50 = await repo.listConnectionsByOrganization(orgId, { limit: 100 });
    expect(clamped50.items.length).toBe(50);

    const clamped1 = await repo.listConnectionsByOrganization(orgId, { limit: 0 });
    expect(clamped1.items.length).toBe(1);
  });

  it('6. Malformed cursor string fails closed with 400 INVALID_CURSOR', async () => {
    await expect(
      repo.listConnectionsByOrganization(orgId, { cursor: 'not-valid-base64-json@@@' })
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'INVALID_CURSOR' } });

    await expect(
      repo.listConnectionsByOrganization(orgId, {
        cursor: Buffer.from(JSON.stringify({ notCreatedAt: 'foo' })).toString('base64url'),
      })
    ).rejects.toMatchObject({ statusCode: 400, details: { code: 'INVALID_CURSOR' } });
  });

  it('7. Identical created_at values ordered deterministically by document ID tie-breaker', async () => {
    const sameTimestamp = new Date().toISOString();
    connectionsStore.set('wac_b', {
      id: 'wac_b',
      organization_id: orgId,
      created_at: sameTimestamp,
    } as WhatsAppConnectionRecord);
    connectionsStore.set('wac_a', {
      id: 'wac_a',
      organization_id: orgId,
      created_at: sameTimestamp,
    } as WhatsAppConnectionRecord);
    connectionsStore.set('wac_c', {
      id: 'wac_c',
      organization_id: orgId,
      created_at: sameTimestamp,
    } as WhatsAppConnectionRecord);

    const result = await repo.listConnectionsByOrganization(orgId, { limit: 10 });
    // Sorted DESC by __name__ (document id): wac_c, wac_b, wac_a
    expect(result.items.map((i) => i.id)).toEqual(['wac_c', 'wac_b', 'wac_a']);
  });

  it('8. Organization boundary: listing never leaks foreign organization connections', async () => {
    for (let i = 1; i <= 10; i++) {
      const pad = String(i).padStart(3, '0');
      connectionsStore.set(`wac_org1_${pad}`, {
        id: `wac_org1_${pad}`,
        organization_id: 'org-1',
        display_name: `Line ${pad}`,
        created_at: new Date(1700000000000 - i * 1000).toISOString(),
      } as WhatsAppConnectionRecord);

      connectionsStore.set(`wac_foreign_${pad}`, {
        id: `wac_foreign_${pad}`,
        organization_id: 'org-foreign',
        display_name: `Foreign Line ${pad}`,
        created_at: new Date(1700000000000 - i * 1000).toISOString(),
      } as WhatsAppConnectionRecord);
    }

    const result = await repo.listConnectionsByOrganization('org-1');
    expect(result.items.length).toBe(10);
    for (const item of result.items) {
      expect(item.organization_id).toBe('org-1');
    }
  });
});
