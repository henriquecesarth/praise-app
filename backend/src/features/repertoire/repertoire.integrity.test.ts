import { beforeEach, describe, expect, it, vi } from 'vitest';

const memory = vi.hoisted(() => ({ collections: new Map<string, Map<string, any>>(), writes: [] as any[] }));
vi.mock('../../lib/firebase', () => ({
  db: {
    collection: (name: string) => {
      if (!memory.collections.has(name)) memory.collections.set(name, new Map());
      const rows = memory.collections.get(name)!;
      const snapshot = (id: string, selected?: string[]) => ({
        id, exists: rows.has(id), data: () => {
          const data = structuredClone(rows.get(id));
          return selected ? Object.fromEntries(selected.filter((key) => key in data).map((key) => [key, data[key]])) : data;
        },
      });
      const query = (predicates: ((row: any) => boolean)[] = [], selected?: string[]): any => {
        const matching = () => [...rows.keys()].filter((id) => predicates.every((predicate) => predicate(rows.get(id))));
        return {
          where: (field: string, op: string, value: any) => query([...predicates,
            (row) => op === '==' ? row[field] === value : row[field] != null && row[field] !== value], selected),
          select: (...fields: string[]) => query(predicates, fields),
          orderBy: () => query(predicates, selected), limit: () => query(predicates, selected),
          count: () => ({ get: async () => ({ data: () => ({ count: matching().length }) }) }),
          get: async () => ({ docs: matching().map((id) => snapshot(id, selected)), size: matching().length }),
        };
      };
      return {
        ...query(),
        doc: (id: string) => ({
          get: async () => snapshot(id),
          update: async (patch: any) => {
            memory.writes.push(structuredClone(patch));
            rows.set(id, { ...structuredClone(rows.get(id)), ...structuredClone(patch) });
          },
        }),
      };
    },
  },
}));
vi.mock('../../repositories/SubscriptionRepository', () => ({
  SubscriptionRepository: class {
    async createSongTransactional({ ministryId, songData }: any) {
      const song = structuredClone({ id: 'created', ministry_id: ministryId, ...songData });
      memory.collections.get('songs')!.set(song.id, song);
      memory.writes.push(structuredClone(song));
      return { song: structuredClone(song) };
    }
  },
}));

import { RepertoireRepository } from '../../repositories/RepertoireRepository';
import { createSongSchema, updateSongSchema } from './repertoire.types';

const ministry = 'min-integrity';
const oldUrl = 'https://example.test/old';
const newUrl = 'https://example.test/new';
const secondary = { id: 'v2', name: 'Secondary', key: 'D', bpm: '72.50', classificationIds: [], links: [{ label: 'Vídeo', url: oldUrl }] };
let repo: RepertoireRepository;
const rows = () => memory.collections.get('songs')!;
const stored = () => structuredClone(rows().get('song'));
const update = (patch: any) => repo.updateSong('song', ministry, updateSongSchema.parse(patch));
const create = (patch: any) => repo.createSong(ministry, 'fixture-user', createSongSchema.parse({ title: 'Song', ...patch }));
const seed = (patch: any = {}) => rows().set('song', structuredClone({
  id: 'song', ministry_id: ministry, title: 'Song', original_key: 'C', bpm: 72,
  classification_id: null, chord_sheet_url: oldUrl, youtube_url: oldUrl, audio_url: oldUrl,
  external_links: { letras: oldUrl, Partitura: oldUrl },
  versions: [
    { id: 'v1', name: 'Original', key: 'C', bpm: 72, classificationIds: [], links: [
      { label: 'Cifra', url: oldUrl }, { label: 'Vídeo', url: oldUrl }, { label: 'Áudio', url: oldUrl },
      { label: 'Letra', url: oldUrl }, { id: 'custom-score', label: 'Partitura', url: oldUrl, isCustom: true },
    ] }, secondary,
  ], ...patch,
}));

beforeEach(() => {
  memory.collections.clear(); memory.writes.length = 0;
  repo = new RepertoireRepository();
  memory.collections.get('ministry_classifications')!.set('valid', { ministry_id: ministry, name: 'Valid' });
  memory.collections.get('ministry_classifications')!.set('foreign', { ministry_id: 'other-ministry', name: 'Foreign' });
  seed();
});

describe('R4-M13 bidirectional links, persistence-equivalent reads/writes', () => {
  it('creates primary-only links with legacy fields and indexed/search YouTube filtering', async () => {
    const result = await create({ versions: [{ id: 'new-primary', name: 'Original', links: [
      { label: 'Cifra', url: newUrl }, { label: 'YouTube', url: newUrl }, { label: 'MP3', url: newUrl },
      { label: 'Letra', url: newUrl }, { label: 'Partitura', url: newUrl, isCustom: true },
    ] }] });
    expect(result).toMatchObject({ chord_sheet_url: newUrl, youtube_url: newUrl, audio_url: newUrl,
      external_links: { letras: newUrl, Partitura: newUrl } });
    expect((await repo.getSongById('created', ministry)).versions[0].links).toEqual(result.versions[0].links);
    for (const filters of [{ has_youtube: true }, { has_youtube: true, search: 'Song' }]) {
      const list = await repo.getSongs(ministry, filters);
      expect(list.data.find((song: { id: string }) => song.id === 'created')).toMatchObject({ has_youtube: true, youtube_url: newUrl });
    }
  });

  it('accepts consistent mixed create and explicit matching clears', async () => {
    const result = await create({ youtube_url: newUrl, external_links: { Partitura: newUrl },
      versions: [{ name: 'Original', links: [{ label: 'YouTube', url: newUrl }, { label: 'Partitura', url: newUrl }] }] });
    expect(result.youtube_url).toBe(newUrl);
    await update({ youtube_url: null, external_links: {}, versions: [{ id: 'v1', name: 'Original', links: [] }, secondary] });
    expect(stored().youtube_url).toBeNull(); expect(stored().external_links).toEqual({});
  });

  it('legacy patches preserve unspecified flat fields even in an already inconsistent legacy document', async () => {
    const original = stored(); original.youtube_url = 'https://example.test/legacy-video'; rows().set('song', original);
    await update({ external_links: { Partitura: newUrl } });
    await update({ versions: [{ id: 'v1', name: 'Renamed' }, secondary] });
    expect(stored().youtube_url).toBe(original.youtube_url);
  });

  it('creates legacy-only links, including custom labels, and exposes them in the primary version', async () => {
    const result = await create({ chord_sheet_url: newUrl, youtube_url: newUrl, audio_url: newUrl,
      external_links: { letras: newUrl, 'Partitura em Ré': newUrl } });
    expect(result.versions[0].links).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Cifra', url: newUrl }),
      expect.objectContaining({ label: 'Vídeo', url: newUrl }),
      expect.objectContaining({ label: 'Áudio', url: newUrl }),
      expect.objectContaining({ label: 'Partitura em Ré', url: newUrl }),
    ]));
    expect(result.external_links).toEqual({ letras: newUrl, 'Partitura em Ré': newUrl });
  });

  it('patches flat links alongside versions that omit links during create', async () => {
    const result = await create({ youtube_url: newUrl, external_links: { Score: newUrl }, versions: [{ name: 'Original' }] });
    expect(result.youtube_url).toBe(newUrl);
    expect(result.versions[0].links).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Score', url: newUrl })]));
  });

  it('never resurrects an external URL after version/song renaming; preserves secondary links and custom IDs', async () => {
    await update({ external_links: { letras: newUrl, Partitura: newUrl, 'Novo link': newUrl } });
    const afterLinks = stored();
    expect(afterLinks.versions[0].links).toContainEqual({ id: 'custom-score', label: 'Partitura', url: newUrl, isCustom: true });
    await update({ versions: [{ id: 'v1', name: 'Renamed' }, { id: 'v2', name: 'Secondary' }] });
    await update({ title: 'Renamed song', artist: 'New artist' });
    const reloaded = await repo.getSongById('song', ministry);
    expect(reloaded.external_links).toEqual({ letras: newUrl, Partitura: newUrl, 'Novo link': newUrl });
    expect(reloaded.versions[0].links).toEqual(afterLinks.versions[0].links);
    expect(reloaded.versions[1]).toMatchObject(secondary);
  });

  for (const [field, label] of [['chord_sheet_url', 'Chord'], ['youtube_url', 'YouTube'], ['audio_url', 'MP3']]) {
    it(`patches/removes ${field} aliases and cannot resurrect an old URL`, async () => {
      // Avoid introducing a second semantic category while exercising its aliases.
      const categoryIndex = field === 'chord_sheet_url' ? 0 : field === 'youtube_url' ? 1 : 2;
      seed(); const aliasSong = stored(); aliasSong.versions[0].links[categoryIndex].label = label; rows().set('song', aliasSong);
      await update({ [field]: newUrl });
      expect(stored()[field]).toBe(newUrl);
      await update({ [field]: null });
      await update({ versions: [{ id: 'v1', name: 'Renamed' }, { id: 'v2', name: 'Secondary' }] });
      expect(stored()[field]).toBeNull();
      expect(stored().versions[0].links.filter((link: any) => link.label === label)).toEqual([]);
      expect(stored().versions[1].links).toEqual(secondary.links);
    });
  }

  it('removes video from indexed YouTube filtering and preserves other link categories', async () => {
    await update({ youtube_url: '' });
    expect((await repo.getSongs(ministry, { has_youtube: true })).data).toHaveLength(0);
    expect(stored().chord_sheet_url).toBe(oldUrl);
    expect(stored().versions[1].links).toEqual(secondary.links);
  });

  it('replaces explicit primary links and clears omitted categories, including custom links', async () => {
    await update({ versions: [{ id: 'v1', name: 'Original', links: [{ label: 'Partitura', url: newUrl }] }, secondary] });
    expect(stored()).toMatchObject({ chord_sheet_url: null, youtube_url: null, audio_url: null, external_links: { Partitura: newUrl } });
    await update({ versions: [{ id: 'v1', name: 'Original', links: [] }, secondary] });
    expect(stored().external_links).toEqual({});
    expect(stored().versions[0].links).toEqual([]);
    expect(stored().versions[1].links).toEqual(secondary.links);
  });

  it('preserves explicitly custom external labels even when they match a supported category', async () => {
    await update({ external_links: { YouTube: newUrl, constructor: newUrl } });
    await update({ versions: [{ id: 'v1', name: 'Renamed' }, secondary] });
    expect(stored().external_links).toEqual({ YouTube: newUrl, constructor: newUrl });
    expect(stored().youtube_url).toBe(oldUrl);
    expect(stored().versions[0].links).toContainEqual({ label: 'YouTube', url: newUrl, isCustom: true });
  });

  it('external_links is a replacement map: omitted labels/empty URLs clear, supported links survive', async () => {
    await update({ external_links: { Partitura: '', 'Novo link': newUrl } });
    expect(stored().external_links).toEqual({ 'Novo link': newUrl });
    expect(stored().chord_sheet_url).toBe(oldUrl);
    await update({ external_links: {} });
    expect(stored().versions[0].links.map((link: any) => link.label)).toEqual(['Cifra', 'Vídeo', 'Áudio']);
  });

  it('accepts consistent mixed writes and patches legacy links when versions omit links', async () => {
    await update({ youtube_url: newUrl, versions: [{ id: 'v1', name: 'Original' }, secondary] });
    expect(stored().versions[0].links.find((link: any) => link.label === 'Vídeo').url).toBe(newUrl);
    await update({ youtube_url: newUrl, external_links: { Partitura: newUrl },
      versions: [{ id: 'v1', name: 'Original', links: [{ label: 'Vídeo', url: newUrl }, { label: 'Partitura', url: newUrl }] }, secondary] });
    expect(stored().external_links).toEqual({ Partitura: newUrl });
  });

  for (const write of ['create', 'update']) {
    it(`${write} rejects conflicting mixed scalar/external writes without persisting`, async () => {
      for (const patch of [
        { youtube_url: oldUrl, versions: [{ name: 'Original', links: [{ label: 'Vídeo', url: newUrl }] }] },
        { external_links: {}, versions: [{ name: 'Original', links: [{ label: 'Partitura', url: newUrl }] }] },
      ]) {
        const before = structuredClone([...rows()]); const writesBefore = memory.writes.length;
        await expect(write === 'create' ? create(patch) : update(patch)).rejects.toMatchObject({ statusCode: 400 });
        expect([...rows()]).toEqual(before); expect(memory.writes).toHaveLength(writesBefore);
      }
    });
  }
});

describe('R4-M13 reference-slot classification validation', () => {
  beforeEach(() => {
    const song = stored(); song.classification_id = 'deleted';
    song.versions[0].classificationIds = ['deleted'];
    song.versions[1].classificationIds = ['deleted-secondary']; rows().set('song', song);
  });
  for (const patch of [{ title: 'Renamed' }, { artist: 'New artist' },
    { versions: [{ id: 'v1', name: 'Renamed', classificationIds: ['deleted'] }, { id: 'v2', name: 'Secondary', classificationIds: ['deleted-secondary'] }] }]) {
    it(`preserves unchanged orphan references for ${Object.keys(patch)[0]} edits`, async () => {
      await update(patch);
      expect(stored().classification_id).toBe('deleted');
      expect(stored().versions[0].classificationIds).toEqual(['deleted']);
      expect(stored().versions[1].classificationIds).toEqual(['deleted-secondary']);
    });
  }
  it('version renaming does not erase a flat orphan when pre-existing version tags disagree', async () => {
    const song = stored(); song.versions[0].classificationIds = []; rows().set('song', song);
    await update({ versions: [{ id: 'v1', name: 'Renamed' }, { id: 'v2', name: 'Secondary' }] });
    expect(stored().classification_id).toBe('deleted');
    expect(stored().versions[0].classificationIds).toEqual([]);
    expect(stored().versions[1].classificationIds).toEqual(['deleted-secondary']);
  });
  it('explicit flat clear removes only primary classification', async () => {
    await update({ classification_id: null });
    expect(stored().classification_id).toBeNull(); expect(stored().versions[0].classificationIds).toEqual([]);
    expect(stored().versions[1].classificationIds).toEqual(['deleted-secondary']);
  });
  it('accepts a normal valid replacement and explicit version clear', async () => {
    await update({ classification_id: 'valid' });
    expect(stored().classification).toMatchObject({ id: 'valid', ministry_id: ministry });
    await update({ versions: [{ id: 'v1', name: 'Original', classificationIds: [] }, { id: 'v2', name: 'Secondary' }] });
    expect(stored().classification_id).toBeNull();
  });
  for (const ids of [['missing-new'], ['foreign'], ['valid', 'missing-new'], ['deleted-secondary']]) {
    it(`rejects new/reassigned references ${ids.join(',')} without writes`, async () => {
      const before = stored();
      await expect(update({ versions: [{ id: 'v1', name: 'Original', classificationIds: ids }, { id: 'v2', name: 'Secondary' }] }))
        .rejects.toMatchObject({ statusCode: 404 });
      expect(stored()).toEqual(before); expect(memory.writes).toHaveLength(0);
    });
  }
  it('rejects orphan reuse in a new version even though the ID exists in the song', async () => {
    await expect(update({ versions: [{ id: 'v1', name: 'Original' }, { id: 'v2', name: 'Secondary' },
      { id: 'v3', name: 'New', classificationIds: ['deleted'] }] })).rejects.toMatchObject({ statusCode: 404 });
  });
  it('rejects existing cross-tenant references even during title-only edits', async () => {
    const song = stored(); song.versions[1].classificationIds = ['foreign']; rows().set('song', song);
    await expect(update({ title: 'Renamed' })).rejects.toMatchObject({ statusCode: 404 });
    expect(memory.writes).toHaveLength(0);
  });
  for (const id of ['deleted', 'foreign']) {
    it(`create still rejects ${id} references`, async () => {
      await expect(create({ versions: [{ name: 'Original', classificationIds: [id] }] })).rejects.toMatchObject({ statusCode: 404 });
      expect(memory.writes).toHaveLength(0);
    });
  }
});

for (const bpm of [72, '72.50', 'Infinity', '0', 0, '1000', null, undefined, 'Lento e expressivo']) {
  it(`preserves stored BPM ${String(bpm)} after title/artist/version-name-only updates`, async () => {
    const song = stored(); song.bpm = bpm; song.versions[0].bpm = bpm;
    if (bpm === undefined) { delete song.bpm; delete song.versions[0].bpm; }
    rows().set('song', song);
    await update({ title: 'Renamed' }); await update({ artist: 'New artist' });
    await update({ versions: [{ id: 'v1', name: 'Renamed' }, { id: 'v2', name: 'Secondary' }] });
    expect(stored().bpm).toBe(bpm); expect(stored().versions[0].bpm).toBe(bpm);
    if (bpm === undefined) { expect(stored()).not.toHaveProperty('bpm'); expect(stored().versions[0]).not.toHaveProperty('bpm'); }
    expect(stored().versions[0].id).toBe('v1'); expect(stored().versions[1].bpm).toBe('72.50');
  });
}
