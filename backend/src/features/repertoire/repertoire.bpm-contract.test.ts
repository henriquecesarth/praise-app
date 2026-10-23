import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const { mockCreateSongTransactional, storeRef } = vi.hoisted(() => {
  const storeRef = { current: null as any };
  const mockCreateSongTransactional = vi.fn().mockImplementation(async ({ songData, ministryId }: any) => {
    const song = structuredClone({ id: 'song-bpm', ministry_id: ministryId, ...songData });
    storeRef.current?.docs.set('song-bpm', song);
    return { song: structuredClone(song), usage: {} };
  });
  return { mockCreateSongTransactional, storeRef };
});

vi.mock('../../lib/firebase', () => ({
  db: {
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn().mockResolvedValue(undefined),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      })),
      where: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ docs: [], size: 0 }),
        count: vi.fn(() => ({ get: vi.fn().mockResolvedValue({ data: () => ({ count: 0 }) }) })),
      })),
    })),
    runTransaction: vi.fn().mockImplementation(async () => {
      throw new Error('TEST ISOLATION VIOLATION: db.runTransaction called in unit test');
    }),
  },
}));

vi.mock('../../repositories/SubscriptionRepository', () => ({
  SubscriptionRepository: class {
    createSongTransactional = mockCreateSongTransactional;
  },
}));

import { createSongSchema, updateSongSchema, normalizeBpmValue } from './repertoire.types';
import { RepertoireRepository } from '../../repositories/RepertoireRepository';

/**
 * BPM Contract Closure — Backend side.
 *
 * The matrix in __fixtures__/bpm-contract-matrix.json is shared with the Mobile
 * suite (mobile/test/features/repertoire/data/bpm_contract_matrix_test.dart).
 * Persistence here is an isolated in-memory double: every write and read is
 * deep-cloned so tests can never observe shared references. This does NOT
 * verify real Firestore behaviour.
 */

type Wire = { send: unknown } | { omit: true };
interface MatrixCase {
  id: string;
  kind: 'accepted' | 'rejected' | 'legacy';
  input?: unknown;
  stored?: unknown;
  expectStored?: unknown;
  mobileWire?: Wire;
}

const matrix: { cases: MatrixCase[] } = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'bpm-contract-matrix.json'), 'utf8')
);
const accepted = matrix.cases.filter((c) => c.kind === 'accepted');
const rejected = matrix.cases.filter((c) => c.kind === 'rejected');
const legacy = matrix.cases.filter((c) => c.kind === 'legacy');

const MINISTRY = 'min-alpha';

function createStore() {
  const docs = new Map<string, any>();
  const writes: any[] = [];
  const songsCol = {
    doc: vi.fn().mockImplementation((id: string) => ({
      get: vi.fn().mockImplementation(async () => {
        const d = docs.get(id);
        return { exists: !!d, id, data: () => (d ? structuredClone(d) : undefined) };
      }),
      update: vi.fn().mockImplementation(async (up: any) => {
        writes.push(structuredClone(up));
        docs.set(id, { ...structuredClone(docs.get(id)), ...structuredClone(up) });
      }),
    })),
  };
  const classificationsCol = {
    doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
  };
  const artistsCol = {
    doc: vi.fn().mockReturnValue({ get: vi.fn().mockResolvedValue({ exists: false }) }),
  };
  return { docs, writes, songsCol, classificationsCol, artistsCol };
}

function wireBpm(w: Wire | undefined): Record<string, unknown> {
  if (!w || 'omit' in w) return {};
  return { bpm: (w as { send: unknown }).send };
}

/** Payload shape produced by Mobile when the user only renames the secondary version. */
function mobileUnrelatedEditPayload(wire: Wire | undefined) {
  return {
    title: 'Contrato BPM',
    ...wireBpm(wire),
    versions: [
      { id: 'v1', name: 'Original', key: 'E', classificationIds: [], classification_ids: [], notes: null, ...wireBpm(wire), duration: null, links: [] },
      { id: 'v2', name: 'Live Renamed', key: null, classificationIds: [], classification_ids: [], notes: 'nota v2', ...wireBpm(wire), duration: null, links: [] },
      { id: 'v3', name: 'Sibling', key: 'G', classificationIds: [], classification_ids: [], notes: null, bpm: 'Allegro', duration: null, links: [] },
    ],
  };
}

describe('BPM Contract Closure (Backend)', () => {
  let repo: RepertoireRepository;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = createStore();
    storeRef.current = store;
    repo = new RepertoireRepository();
    (repo as any).songsCol = store.songsCol;
    (repo as any).classificationsCol = store.classificationsCol;
    (repo as any).artistsCol = store.artistsCol;
  });

  describe('Schema / normalizer alignment', () => {
    it.each(accepted.map((c) => [c.id, c] as const))('%s: normalizer output satisfies the schema it was validated by', (_id, c) => {
      const parsed = updateSongSchema.parse({ versions: [{ id: 'v1', name: 'O', bpm: c.input }] });
      const normalized = normalizeBpmValue(parsed.versions![0].bpm);
      expect(normalized).toEqual(c.expectStored);
      // Re-validating the normalized value must succeed: normalization never produces contract-violating values.
      expect(() => updateSongSchema.parse({ versions: [{ id: 'v1', name: 'O', bpm: normalized }] })).not.toThrow();
    });
  });

  describe('Accepted inputs: create -> persist -> reload -> Mobile unrelated edit -> update -> reload', () => {
    it.each(accepted.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
      const createPayload = createSongSchema.parse({
        title: 'Contrato BPM',
        artist: 'Free Artist',
        versions: [
          { id: 'v1', name: 'Original', key: 'E', bpm: c.input },
          { id: 'v2', name: 'Live', key: null, bpm: c.input, notes: 'nota v2' },
          { id: 'v3', name: 'Sibling', key: 'G', bpm: 'Allegro' },
        ],
      });
      await repo.createSong(MINISTRY, 'user-1', createPayload);

      const persisted = store.docs.get('song-bpm');
      expect(persisted.bpm).toEqual(c.expectStored);
      expect(persisted.versions[0].bpm).toEqual(c.expectStored);
      expect(persisted.versions[1].bpm).toEqual(c.expectStored);

      const reloaded = await repo.getSongById('song-bpm', MINISTRY);
      expect(reloaded.bpm).toEqual(c.expectStored);
      expect(reloaded.versions[1].bpm).toEqual(c.expectStored);

      const updatePayload = updateSongSchema.parse(mobileUnrelatedEditPayload(c.mobileWire));
      const updated = await repo.updateSong('song-bpm', MINISTRY, updatePayload);

      const after = store.docs.get('song-bpm');
      expect(after.bpm).toEqual(c.expectStored);
      expect(after.versions[0].bpm).toEqual(c.expectStored);
      expect(after.versions[1].bpm).toEqual(c.expectStored);
      expect(after.versions[1].name).toBe('Live Renamed');
      expect(after.versions[1].key).toBeNull();
      expect(after.versions[2].bpm).toBe('Allegro');
      expect(after.artist).toEqual({ id: '', name: 'Free Artist' });
      expect(updated.versions[1].bpm).toEqual(c.expectStored);
    });
  });

  describe('Rejected inputs never produce writes', () => {
    it.each(rejected.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
      expect(() => createSongSchema.parse({ title: 'X', versions: [{ name: 'O', bpm: c.input }] })).toThrow();
      expect(() => createSongSchema.parse({ title: 'X', bpm: c.input })).toThrow();
      expect(() => updateSongSchema.parse({ versions: [{ id: 'v1', name: 'O', bpm: c.input }] })).toThrow();
      expect(() => updateSongSchema.parse({ bpm: c.input })).toThrow();
      expect(store.writes).toHaveLength(0);
    });
  });

  describe('Legacy persisted values survive unrelated edits', () => {
    it.each(legacy.map((c) => [c.id, c] as const))('%s', async (_id, c) => {
      store.docs.set('song-bpm', {
        id: 'song-bpm',
        ministry_id: MINISTRY,
        title: 'Contrato BPM',
        artist: { id: '', name: 'Free Artist' },
        artist_name: 'Free Artist',
        artist_id: null,
        bpm: c.stored,
        versions: [
          { id: 'v1', name: 'Original', key: 'E', bpm: c.stored, classificationIds: [], links: [] },
          { id: 'v2', name: 'Live', key: null, bpm: c.stored, notes: 'nota v2', classificationIds: [], links: [] },
          { id: 'v3', name: 'Sibling', key: 'G', bpm: 'Allegro', classificationIds: [], links: [] },
        ],
      });

      const reloaded = await repo.getSongById('song-bpm', MINISTRY);
      expect(reloaded.bpm).toEqual(c.stored);
      expect(reloaded.versions[0].bpm).toEqual(c.stored);
      expect(reloaded.versions[1].bpm).toEqual(c.stored);

      const updatePayload = updateSongSchema.parse(mobileUnrelatedEditPayload(c.mobileWire));
      await repo.updateSong('song-bpm', MINISTRY, updatePayload);

      const after = store.docs.get('song-bpm');
      expect(after.bpm).toEqual(c.stored);
      expect(after.versions[0].bpm).toEqual(c.stored);
      expect(after.versions[1].bpm).toEqual(c.stored);
      expect(after.versions[1].name).toBe('Live Renamed');
      expect(after.versions[2].bpm).toBe('Allegro');
      expect(after.artist).toEqual({ id: '', name: 'Free Artist' });
    });

    it('legacy flat-only update (no versions array) preserves out-of-range primary BPM', async () => {
      store.docs.set('song-bpm', {
        id: 'song-bpm', ministry_id: MINISTRY, title: 'T', bpm: 0,
        versions: [{ id: 'v1', name: 'Original', bpm: 0 }, { id: 'v2', name: 'Live', bpm: 1000 }],
      });
      await repo.updateSong('song-bpm', MINISTRY, updateSongSchema.parse({ original_key: 'D' }));
      const after = store.docs.get('song-bpm');
      expect(after.versions[0].bpm).toBe(0);
      expect(after.versions[0].key).toBe('D');
      expect(after.versions[1].bpm).toBe(1000);
    });
  });

  describe('Null vs omission and flat/primary synchronization', () => {
    beforeEach(() => {
      store.docs.set('song-bpm', {
        id: 'song-bpm', ministry_id: MINISTRY, title: 'T', bpm: '0',
        versions: [
          { id: 'v1', name: 'Original', bpm: '0' },
          { id: 'v2', name: 'Live', bpm: '1000' },
        ],
      });
    });

    it('omitted version BPM preserves the stored value; explicit null clears only that version', async () => {
      await repo.updateSong('song-bpm', MINISTRY, updateSongSchema.parse({
        versions: [{ id: 'v1', name: 'Original' }, { id: 'v2', name: 'Live', bpm: null }],
      }));
      const after = store.docs.get('song-bpm');
      expect(after.versions[0].bpm).toBe('0');
      expect(after.bpm).toBe('0');
      expect(after.versions[1].bpm).toBeNull();
    });

    it('primary version BPM change synchronizes the flat field; flat-only change synchronizes the primary', async () => {
      await repo.updateSong('song-bpm', MINISTRY, updateSongSchema.parse({
        versions: [{ id: 'v1', name: 'Original', bpm: ' Rubato ' }, { id: 'v2', name: 'Live' }],
      }));
      let after = store.docs.get('song-bpm');
      expect(after.bpm).toBe(' Rubato ');
      expect(after.versions[1].bpm).toBe('1000');

      await repo.updateSong('song-bpm', MINISTRY, updateSongSchema.parse({ bpm: '0' }));
      after = store.docs.get('song-bpm');
      expect(after.bpm).toBe('0');
      expect(after.versions[0].bpm).toBe('0');
      expect(after.versions[1].bpm).toBe('1000');
    });

    it('conflict detection compares values exactly and rejects without writing', async () => {
      const conflicting = [
        { bpm: 'Rubato', v: ' Rubato ' },
        { bpm: '72', v: 72 },
        { bpm: '0', v: null },
      ];
      for (const { bpm, v } of conflicting) {
        expect(() => updateSongSchema.parse({ bpm, versions: [{ id: 'v1', name: 'O', bpm: v }] })).toThrow();
        await expect(repo.updateSong('song-bpm', MINISTRY, { bpm, versions: [{ id: 'v1', name: 'O', bpm: v }] })).rejects.toThrow();
      }
      expect(store.writes).toHaveLength(0);
      expect(() => updateSongSchema.parse({ bpm: '0', versions: [{ id: 'v1', name: 'O', bpm: '0' }] })).not.toThrow();
      expect(() => updateSongSchema.parse({ bpm: 72.5, versions: [{ id: 'v1', name: 'O', bpm: 72.5 }] })).not.toThrow();
    });
  });

  describe('Web compatibility (payload shapes produced by web/src/api.ts mapSongToApi)', () => {
    it('Web numeric, textual and cleared BPM payloads persist unchanged', async () => {
      store.docs.set('song-bpm', {
        id: 'song-bpm', ministry_id: MINISTRY, title: 'T', bpm: 72,
        versions: [{ id: 'v1', name: 'Original', bpm: 72 }, { id: 'v2', name: 'Live', bpm: 'Rubato' }, { id: 'v3', name: 'Ac', bpm: 68 }],
      });
      // mapSongToApi: Number() for numeric-looking strings, verbatim text otherwise, '' -> null
      await repo.updateSong('song-bpm', MINISTRY, updateSongSchema.parse({
        title: 'T2',
        versions: [
          { id: 'v1', name: 'Original', bpm: 72.5 },
          { id: 'v2', name: 'Live', bpm: 'Rubato' },
          { id: 'v3', name: 'Ac', bpm: null },
        ],
      }));
      const after = store.docs.get('song-bpm');
      expect(after.versions.map((v: any) => v.bpm)).toEqual([72.5, 'Rubato', null]);
      expect(after.bpm).toBe(72.5);
    });

    it('Web resubmitting a legacy out-of-range number is rejected (fail closed) without any write', async () => {
      store.docs.set('song-bpm', {
        id: 'song-bpm', ministry_id: MINISTRY, title: 'T', bpm: 1000,
        versions: [{ id: 'v1', name: 'Original', bpm: 1000 }],
      });
      expect(() => updateSongSchema.parse({ versions: [{ id: 'v1', name: 'Original', bpm: 1000 }] })).toThrow();
      expect(store.writes).toHaveLength(0);
      expect(store.docs.get('song-bpm').versions[0].bpm).toBe(1000);
    });
  });
});
