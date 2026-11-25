// M22-C.5D-C4-A — pagination of the ministry audio library when published records are hidden by a closed codec gate.
// Firestore Emulator only (demo project). Records are seeded directly: published MP3 v2 manifests stay hidden because the
// gate (`serverByteValidation: false`) is closed. Nothing here opens the gate, touches R2 or production Firebase.
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../../lib/firebase';
import { errorHandler } from '../../middleware/error-handler';
import { UserRepository } from '../../repositories/UserRepository';
import { CODEC_PROFILES } from './audio-codec';
import { createMinistryAudioRouter } from './ministry-audio.routes';
import type { StemStorage } from './storage';

type Page = { items: Array<{ id: string; title: string }>; nextCursor: string | null };
type Seed = { n: number; hidden: boolean; title?: string };

const T0 = Date.UTC(2026, 10, 20, 12);
const rid = (n: number) => n.toString(16).padStart(64, '0'); // canonical 64-hex recording ids
const manifestOf = (hidden: boolean) => ({
  schemaVersion: hidden ? 2 : 1,
  stems: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'].map((id) => ({ id, codec: hidden ? 'mp3_cbr256' : 'pcm_s16le' })),
});

describe('ministry audio catalog pagination with hidden codecs (Firestore Emulator)', { timeout: 60_000 }, () => {
  const users = new UserRepository();
  const legacy: StemStorage = {
    put: vi.fn().mockRejectedValue(new Error('unused')), verify: vi.fn().mockRejectedValue(new Error('unused')),
    open: vi.fn().mockRejectedValue(new Error('unused')), remove: vi.fn().mockRejectedValue(new Error('unused')),
  };
  const profile = CODEC_PROFILES.mp3_cbr256 as { serverByteValidation: boolean };
  let server: Server;
  let origin: string;
  let ministryId: string;
  let otherId: string;
  let memberToken: string;
  let otherToken: string;

  beforeAll(async () => {
    const app = express();
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    app.use(express.json());
    app.use('/api/v1/ministries/:ministryId/audio-library', createMinistryAudioRouter({ storage: legacy, now: () => T0 }));
    app.use(errorHandler);
  });
  afterAll(async () => {
    profile.serverByteValidation = false;
    await new Promise<void>((resolve, reject) => { server.close((e) => (e ? reject(e) : resolve())); server.closeAllConnections(); });
  });
  beforeEach(async () => {
    profile.serverByteValidation = false; // the gate stays closed in every case
    ministryId = `audio-page-${randomUUID()}`;
    otherId = `audio-page-${randomUUID()}`;
    const member = `member-${randomUUID()}`, other = `other-${randomUUID()}`;
    memberToken = users.generateAuthToken(member, 'm@example.test');
    otherToken = users.generateAuthToken(other, 'o@example.test');
    const batch = db.batch();
    batch.set(db.collection('ministries').doc(ministryId), { name: 'Page', owner_user_id: `owner-${randomUUID()}` });
    batch.set(db.collection('ministries').doc(otherId), { name: 'Other', owner_user_id: other });
    batch.set(db.collection('ministry_members').doc(`${ministryId}_${member}`), { ministry_id: ministryId, user_id: member, role: 'member', status: 'active' });
    await batch.commit();
  });

  /** Seeds published records; a higher `n` is newer, so the canonical order is n descending. */
  async function seed(tenant: string, rows: Seed[]) {
    for (let i = 0; i < rows.length; i += 400) {
      const batch = db.batch();
      for (const row of rows.slice(i, i + 400)) {
        batch.set(db.collection('ministries').doc(tenant).collection('audio_recordings').doc(rid(row.n)), {
          id: rid(row.n), ministryId: tenant, status: 'published', title: row.title ?? `Song ${row.n}`, artist: 'Synthetic', version: 'v',
          publishedAt: T0 + row.n, updatedAt: T0 + row.n, manifest: manifestOf(row.hidden),
        });
      }
      await batch.commit();
    }
  }
  const get = async (tenant: string, token: string, query: string): Promise<{ status: number; body: Page }> => {
    const response = await fetch(`${origin}/api/v1/ministries/${tenant}/audio-library/${query}`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as Page };
  };

  /** Follows cursors to the end; refuses to loop forever. */
  async function walk(tenant: string, token: string, params: string, maxRequests = 40) {
    const ids: string[] = [];
    const sizes: number[] = [];
    let cursor: string | null = null;
    let requests = 0;
    do {
      const suffix: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await get(tenant, token, `?${params}${suffix}`);
      expect(page.status).toBe(200);
      ids.push(...page.body.items.map((item) => item.id));
      sizes.push(page.body.items.length);
      cursor = page.body.nextCursor;
      if (++requests > maxRequests) throw new Error('pagination did not terminate');
    } while (cursor);
    return { ids, sizes, requests };
  }
  const ordered = (rows: Seed[]) => rows.filter((r) => !r.hidden).map((r) => rid(r.n)).sort().reverse();

  it('lists every visible record exactly once when hidden MP3 records are interleaved (no search)', async () => {
    const rows = Array.from({ length: 40 }, (_, i): Seed => ({ n: i + 1, hidden: i % 3 !== 0 }));
    rows.push({ n: 41, hidden: true }, { n: 42, hidden: true }); // the newest rows are hidden too
    await seed(ministryId, rows);
    const { ids, sizes } = await walk(ministryId, memberToken, 'limit=5');
    expect(ids).toEqual(ordered(rows));
    expect(new Set(ids).size).toBe(ids.length);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
  });

  it('does not announce the end early: a short page before hidden rows still carries a cursor', async () => {
    const rows: Seed[] = [...Array.from({ length: 6 }, (_, i): Seed => ({ n: i + 1, hidden: false })), ...Array.from({ length: 3 }, (_, i): Seed => ({ n: 10 + i, hidden: true }))];
    // Newest first: 3 hidden, then 6 visible. limit=5 reads 6 raw rows (5 + lookahead): one hidden among them.
    await seed(ministryId, rows);
    const first = await get(ministryId, memberToken, '?limit=5');
    expect(first.body.items).toHaveLength(5);
    expect(first.body.nextCursor).not.toBeNull();
    const { ids } = await walk(ministryId, memberToken, 'limit=5');
    expect(ids).toEqual(ordered(rows));
  });

  it('crosses batches made only of hidden records', async () => {
    const rows: Seed[] = [...Array.from({ length: 6 }, (_, i): Seed => ({ n: i + 1, hidden: false })), ...Array.from({ length: 30 }, (_, i): Seed => ({ n: 100 + i, hidden: true }))];
    await seed(ministryId, rows);
    const { ids } = await walk(ministryId, memberToken, 'limit=5');
    expect(ids).toEqual(ordered(rows));
    const first = await get(ministryId, memberToken, '?limit=5');
    expect(first.body.items.length).toBe(5); // 30 hidden rows are skipped inside the request, not returned as an empty page
  });

  it('applies the same rules with a search term', async () => {
    const rows: Seed[] = Array.from({ length: 130 }, (_, i): Seed => ({ n: i + 1, hidden: i % 2 === 0, title: i % 3 === 0 ? `Louvor ${i}` : `Hino ${i}` }));
    await seed(ministryId, rows);
    const wanted = rows.filter((r) => !r.hidden && r.title!.startsWith('Louvor')).map((r) => rid(r.n)).sort().reverse();
    expect(wanted.length).toBeGreaterThan(3);
    const { ids, sizes } = await walk(ministryId, memberToken, 'q=louvor&limit=2');
    expect(ids).toEqual(wanted);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(2);
    const hiddenMatches = rows.filter((r) => r.hidden && r.title!.startsWith('Louvor')).map((r) => rid(r.n));
    expect(hiddenMatches.length).toBeGreaterThan(0);
    expect(ids.some((id) => hiddenMatches.includes(id))).toBe(false);
  });

  it('terminates and misses nothing when more records are hidden than one request may scan', async () => {
    const rows: Seed[] = [...Array.from({ length: 3 }, (_, i): Seed => ({ n: i + 1, hidden: false })), ...Array.from({ length: 200 }, (_, i): Seed => ({ n: 100 + i, hidden: true }))];
    await seed(ministryId, rows);
    const { ids, requests } = await walk(ministryId, memberToken, 'limit=5');
    expect(ids).toEqual(ordered(rows));
    expect(requests).toBeLessThanOrEqual(4); // bounded work per request, finite continuation
  });

  it('does not mistake unpositionable documents for the end of the catalog', async () => {
    const rows = Array.from({ length: 6 }, (_, i): Seed => ({ n: i + 1, hidden: false }));
    await seed(ministryId, rows);
    // Corrupt documents (string publishedAt sorts first in descending order) written outside the service.
    for (const n of [900, 901]) {
      await db.collection('ministries').doc(ministryId).collection('audio_recordings').doc(rid(n)).set({
        id: rid(n), ministryId, status: 'published', title: 'Bad', artist: 'x', version: 'v', publishedAt: 'oops', updatedAt: T0, manifest: manifestOf(false),
      });
    }
    const { ids } = await walk(ministryId, memberToken, 'limit=5');
    expect(ids).toEqual(ordered(rows));
  });

  it('respects the 30-item maximum and keeps WAV-only catalogs unchanged', async () => {
    const rows = Array.from({ length: 70 }, (_, i): Seed => ({ n: i + 1, hidden: false }));
    await seed(ministryId, rows);
    const { ids, sizes } = await walk(ministryId, memberToken, 'limit=30');
    expect(ids).toEqual(ordered(rows));
    expect(sizes).toEqual([30, 30, 10]);
    const exact = await get(ministryId, memberToken, '?limit=30');
    expect(exact.body.nextCursor).not.toBeNull();
        expect((await get(ministryId, memberToken, '?limit=31')).status).toBe(400);
    const defaultPage = await get(ministryId, memberToken, '');
    expect(defaultPage.body.items).toHaveLength(15);
  });

  it('ends without a cursor exactly when the last visible record is returned, even if hidden rows follow', async () => {
    const rows: Seed[] = [...Array.from({ length: 5 }, (_, i): Seed => ({ n: 50 + i, hidden: false })), ...Array.from({ length: 4 }, (_, i): Seed => ({ n: 1 + i, hidden: true }))];
    await seed(ministryId, rows);
    const page = await get(ministryId, memberToken, '?limit=5');
    expect(page.body.items).toHaveLength(5);
    expect(page.body.nextCursor).toBeNull();
  });

  it('lists MP3 and WAV records together when the codec is enabled, and a rollback mid-walk hides MP3 without duplicates, gaps or errors', async () => {
    const rows = Array.from({ length: 30 }, (_, i): Seed => ({ n: i + 1, hidden: i % 2 === 0 })); // alternating MP3 / WAV
    await seed(ministryId, rows);
    const everything = rows.map((r) => rid(r.n)).sort().reverse();
    profile.serverByteValidation = true; // codec enabled (test-only switch; the publishable build has none)
    try {
      const open = await walk(ministryId, memberToken, 'limit=4');
      expect(open.ids).toEqual(everything);
      expect(new Set(open.ids).size).toBe(open.ids.length);

      // Rollback between two requests of the same walk: the cursor stays valid and the remainder is WAV-only.
      const first = await get(ministryId, memberToken, '?limit=4');
      expect(first.body.items).toHaveLength(4);
      profile.serverByteValidation = false;
      const rest: string[] = [];
      let cursor = first.body.nextCursor;
      let guard = 0;
      while (cursor) {
        const page = await get(ministryId, memberToken, `?limit=4&cursor=${encodeURIComponent(cursor)}`);
        expect(page.status).toBe(200);
        rest.push(...page.body.items.map((item) => item.id));
        cursor = page.body.nextCursor;
        if (++guard > 20) throw new Error('pagination did not terminate');
      }
      const seen = new Set(first.body.items.map((item) => item.id));
      expect(rest.some((id) => seen.has(id))).toBe(false);
      expect(rest).toEqual(ordered(rows).filter((id) => id < first.body.items.at(-1)!.id));
      // Re-enabling restores every record (nothing was altered by the rollback).
      profile.serverByteValidation = true;
      expect((await walk(ministryId, memberToken, 'limit=4')).ids).toEqual(everything);
    } finally {
      profile.serverByteValidation = false;
    }
  });
  it('keeps ministries isolated and the cursor bound to its ministry and query', async () => {
    await seed(ministryId, Array.from({ length: 12 }, (_, i): Seed => ({ n: i + 1, hidden: i % 2 === 0 })));
    await seed(otherId, Array.from({ length: 12 }, (_, i): Seed => ({ n: 100 + i, hidden: false })));
    const mine = await walk(ministryId, memberToken, 'limit=2');
    expect(mine.ids.every((id) => parseInt(id, 16) <= 12)).toBe(true);
    expect(mine.ids).toHaveLength(6);
    const first = await get(ministryId, memberToken, '?limit=2');
    expect(first.body.nextCursor).not.toBeNull();
    // A cursor from one ministry or query is refused elsewhere.
    expect((await get(otherId, otherToken, `?limit=2&cursor=${encodeURIComponent(first.body.nextCursor!)}`)).status).toBe(400);
    expect((await get(ministryId, memberToken, `?limit=2&q=x&cursor=${encodeURIComponent(first.body.nextCursor!)}`)).status).toBe(400);
    // And a user of another ministry cannot read this catalog at all.
    expect((await get(ministryId, otherToken, '?limit=2')).status).toBe(403);
  });
});
