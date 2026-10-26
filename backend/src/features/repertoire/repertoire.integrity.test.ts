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

describe('R4-M15 Blocker A: Historical custom link aliases (isCustom: true)', () => {
  const aliases: [string, string][] = [
    ['chord_sheet_url', 'Chord'],
    ['youtube_url', 'YouTube'],
    ['audio_url', 'MP3'],
  ];

  for (const [field, label] of aliases) {
    describe(`${field} alias "${label}"`, () => {
      const customId = `custom-alias-${field}`;
      const seedHistoricalAlias = () => {
        seed();
        const song = stored();
        const categoryIndex = field === 'chord_sheet_url' ? 0 : field === 'youtube_url' ? 1 : 2;
        song.versions[0].links[categoryIndex] = {
          id: customId,
          label,
          url: oldUrl,
          isCustom: true,
        };
        // Ensure oldUrl is in the matching flat field while label is NOT in external_links
        song[field] = oldUrl;
        delete song.external_links[label];
        delete song.external_links[label.toLowerCase()];
        rows().set('song', song);
      };

      beforeEach(() => {
        seedHistoricalAlias();
      });

      it('reproduces R4-M14 exact seed without custom id: flat field + primary link { label, url: oldUrl, isCustom: true } survives version rename', async () => {
        seed({
          chord_sheet_url: field === 'chord_sheet_url' ? oldUrl : null,
          youtube_url: field === 'youtube_url' ? oldUrl : null,
          audio_url: field === 'audio_url' ? oldUrl : null,
          external_links: {},
          versions: [
            { id: 'v1', name: 'Original', key: 'C', bpm: 72, classificationIds: [], links: [{ label, url: oldUrl, isCustom: true }] },
            secondary,
          ],
        });
        await update({
          versions: [
            { id: 'v1', name: 'Renamed', links: [{ label, url: oldUrl, isCustom: true }] },
            secondary,
          ],
        });
        const doc = stored();
        expect(doc[field]).toBe(oldUrl);
        expect(doc.external_links).toEqual({});
        expect(doc.versions[0].links).toEqual([{ label, url: oldUrl, isCustom: true }]);
        expect(doc.versions[1].links).toEqual(secondary.links);
      });

      it('preserves flat URL, does not move to external_links, preserves custom ID and versions[1].links on version rename with unchanged links; preserves YouTube filtering', async () => {
        const primaryLinks = stored().versions[0].links;
        await update({
          versions: [
            { id: 'v1', name: 'Renamed Primary', links: primaryLinks },
            secondary,
          ],
        });

        const doc = stored();
        expect(doc[field]).toBe(oldUrl);
        expect(doc.external_links[label]).toBeUndefined();
        expect(doc.versions[0].links).toContainEqual({
          id: customId,
          label,
          url: oldUrl,
          isCustom: true,
        });
        expect(doc.versions[1].links).toEqual(secondary.links);

        if (field === 'youtube_url') {
          for (const filters of [{ has_youtube: true }, { has_youtube: true, search: 'Song' }]) {
            const list = await repo.getSongs(ministry, filters);
            expect(list.data.find((s: { id: string }) => s.id === 'song')).toMatchObject({
              has_youtube: true,
              youtube_url: oldUrl,
            });
          }
        }
      });

      it('updates the flat field to newUrl without adding to external_links when updated via versions[0].links', async () => {
        const updatedLinks = stored().versions[0].links.map((l: any) =>
          l.id === customId ? { ...l, url: newUrl } : l
        );
        await update({
          versions: [
            { id: 'v1', name: 'Renamed Primary', links: updatedLinks },
            secondary,
          ],
        });

        const doc = stored();
        expect(doc[field]).toBe(newUrl);
        expect(doc.external_links[label]).toBeUndefined();
        expect(doc.versions[0].links).toContainEqual({
          id: customId,
          label,
          url: newUrl,
          isCustom: true,
        });
        expect(doc.versions[1].links).toEqual(secondary.links);
      });

      it('updates both flat field and primary link URL via legacy flat field, and clears via { [field]: null } without resurrecting oldUrl', async () => {
        await update({ [field]: newUrl });
        let doc = stored();
        expect(doc[field]).toBe(newUrl);
        expect(doc.versions[0].links.find((l: any) => l.label === label)?.url).toBe(newUrl);
        expect(doc.external_links[label]).toBeUndefined();

        // Clear via { [field]: null }
        await update({ [field]: null });
        doc = stored();
        expect(doc[field]).toBeNull();
        expect(doc.versions[0].links.filter((l: any) => l.label === label)).toHaveLength(0);

        // Subsequent version rename must not resurrect oldUrl
        await update({
          versions: [
            { id: 'v1', name: 'Renamed Again' },
            { id: 'v2', name: 'Secondary' },
          ],
        });
        doc = stored();
        expect(doc[field]).toBeNull();
        expect(doc.versions[0].links.filter((l: any) => l.label === label)).toHaveLength(0);
      });

      it('clears via versions[0].links: [] and never resurrects oldUrl on subsequent version rename', async () => {
        await update({
          versions: [
            { id: 'v1', name: 'Original', links: [] },
            secondary,
          ],
        });
        let doc = stored();
        expect(doc[field]).toBeNull();
        expect(doc.versions[0].links).toEqual([]);

        // Subsequent version rename must not resurrect oldUrl
        await update({
          versions: [
            { id: 'v1', name: 'Renamed Again' },
            { id: 'v2', name: 'Secondary' },
          ],
        });
        doc = stored();
        expect(doc[field]).toBeNull();
        expect(doc.versions[0].links).toEqual([]);
      });
    });
  }

  it('intentionally custom links (isCustom: true) created when flat field is null remain in external_links and do not populate legacy flat fields', async () => {
    for (const [field, label] of aliases) {
      seed({
        [field]: null,
        versions: [
          {
            id: 'v1',
            name: 'Original',
            key: 'C',
            bpm: 72,
            classificationIds: [],
            links: [
              { id: `custom-ext-${field}`, label, url: newUrl, isCustom: true },
            ],
          },
          secondary,
        ],
        external_links: { [label]: newUrl },
      });

      await update({
        versions: [
          { id: 'v1', name: 'Renamed', links: stored().versions[0].links },
          secondary,
        ],
      });

      const doc = stored();
      expect(doc[field]).toBeNull();
      expect(doc.external_links[label]).toBe(newUrl);
    }
  });

  it('intentionally custom links created via external_links remain in external_links and do not populate legacy flat fields', async () => {
    seed({
      chord_sheet_url: null,
      youtube_url: null,
      audio_url: null,
      versions: [
        { id: 'v1', name: 'Original', key: 'C', bpm: 72, classificationIds: [], links: [] },
        secondary,
      ],
      external_links: {},
    });

    await update({
      external_links: {
        YouTube: newUrl,
        MP3: newUrl,
        Chord: newUrl,
      },
    });

    let doc = stored();
    expect(doc.youtube_url).toBeNull();
    expect(doc.audio_url).toBeNull();
    expect(doc.chord_sheet_url).toBeNull();
    expect(doc.external_links).toMatchObject({
      YouTube: newUrl,
      MP3: newUrl,
      Chord: newUrl,
    });

    await update({
      versions: [
        { id: 'v1', name: 'Renamed' },
        secondary,
      ],
    });

    doc = stored();
    expect(doc.youtube_url).toBeNull();
    expect(doc.audio_url).toBeNull();
    expect(doc.chord_sheet_url).toBeNull();
    expect(doc.external_links).toMatchObject({
      YouTube: newUrl,
      MP3: newUrl,
      Chord: newUrl,
    });
  });

  it('does not transfer historical alias status when promoting secondary version with distinct custom link or replacing link with distinct custom ID', async () => {
    // a) Seed primary v1 with historical alias and secondary v2 with distinct custom link
    seed({
      youtube_url: oldUrl,
      external_links: {},
      versions: [
        {
          id: 'v1',
          name: 'Original',
          key: 'C',
          bpm: 72,
          classificationIds: [],
          links: [
            { id: 'historical', label: 'YouTube', url: oldUrl, isCustom: true },
          ],
        },
        {
          id: 'v2',
          name: 'Secondary',
          key: 'D',
          bpm: 72,
          classificationIds: [],
          links: [
            { id: 'custom', label: 'YouTube', url: newUrl, isCustom: true },
          ],
        },
      ],
    });

    // Promoting secondary v2 to primary
    await update({
      versions: [
        { id: 'v2', name: 'Secondary', key: 'D', links: [{ id: 'custom', label: 'YouTube', url: newUrl, isCustom: true }] },
        { id: 'v1', name: 'Original', key: 'C', links: [{ id: 'historical', label: 'YouTube', url: oldUrl, isCustom: true }] },
      ],
    });

    let doc = stored();
    expect(doc.youtube_url).toBeNull();
    expect(doc.external_links).toEqual({ YouTube: newUrl });
    const list = await repo.getSongs(ministry, { has_youtube: true });
    expect(list.data.find((s: { id: string }) => s.id === 'song')).toBeUndefined();

    // b) Replacing v1's historical alias with a distinct custom link ID on v1
    seed({
      youtube_url: oldUrl,
      external_links: {},
      versions: [
        {
          id: 'v1',
          name: 'Original',
          key: 'C',
          bpm: 72,
          classificationIds: [],
          links: [
            { id: 'historical', label: 'YouTube', url: oldUrl, isCustom: true },
          ],
        },
        secondary,
      ],
    });

    await update({
      versions: [
        {
          id: 'v1',
          name: 'Original',
          key: 'C',
          links: [
            { id: 'custom', label: 'YouTube', url: newUrl, isCustom: true },
          ],
        },
        secondary,
      ],
    });

    doc = stored();
    expect(doc.youtube_url).toBeNull();
    expect(doc.external_links).toEqual({ YouTube: newUrl });
  });
});

describe('R4-M15 Blocker B: Orphan classifications preserved on unrelated edits & cleared on explicit clear', () => {
  const seedR4M14Fixture = () => {
    rows().set('song', structuredClone({
      id: 'song',
      ministry_id: ministry,
      title: 'Song',
      artist: 'Artist',
      artist_name: 'Artist',
      original_key: 'C',
      bpm: 72,
      classification_id: 'deleted',
      chord_sheet_url: null,
      youtube_url: null,
      audio_url: null,
      external_links: {},
      versions: [
        { id: 'v1', name: 'Original', key: 'C', bpm: 72, links: [], classificationIds: [] },
        { id: 'v2', name: 'Secondary', key: 'D', bpm: 72, links: [{ label: 'Vídeo', url: oldUrl }], classificationIds: ['deleted-secondary'] },
      ],
    }));
  };

  beforeEach(() => {
    seedR4M14Fixture();
  });

  it('reproduces R4-M14 single-version fixture with actual Web title-only serialized wire payload', async () => {
    rows().set('song', structuredClone({
      id: 'song',
      ministry_id: ministry,
      title: 'Song',
      artist: 'Artist',
      artist_name: 'Artist',
      original_key: 'C',
      bpm: 72,
      classification_id: 'deleted',
      chord_sheet_url: null,
      youtube_url: null,
      audio_url: null,
      external_links: {},
      versions: [
        { id: 'v1', name: 'Original', key: 'C', bpm: 72, links: [], classificationIds: [] },
      ],
    }));

    const webWirePayload = JSON.parse(
      '{"title":"Renamed","artist":"Artist","artist_name":"Artist","versions":[{"id":"v1","name":"Original","key":"C","links":[]}]}'
    );
    await repo.updateSong('song', ministry, updateSongSchema.parse(webWirePayload));
    const doc = stored();
    expect(doc.title).toBe('Renamed');
    expect(doc.classification_id).toBe('deleted');
    expect(doc.bpm).toBe(72);
    expect(doc.versions[0]).toMatchObject({
      id: 'v1',
      name: 'Original',
      key: 'C',
      bpm: 72,
      classificationIds: [],
      links: [],
    });
  });

  it('preserves classification_id: deleted, bpm: 72, versions[0].classificationIds: [], and versions[1].classificationIds: [deleted-secondary] on title-only, artist-only, and version-name-only Web wire payloads', async () => {
    // 1. Title-only Web wire payload
    const titlePayload = {
      title: 'Renamed Title',
      artist: 'Artist',
      artist_name: 'Artist',
      versions: [
        { id: 'v1', name: 'Original', key: 'C', links: [] },
        { id: 'v2', name: 'Secondary', key: 'D', links: [{ label: 'Vídeo', url: oldUrl }] },
      ],
    };
    await repo.updateSong('song', ministry, updateSongSchema.parse(titlePayload));
    let doc = stored();
    expect(doc.title).toBe('Renamed Title');
    expect(doc.classification_id).toBe('deleted');
    expect(doc.bpm).toBe(72);
    expect(doc.versions[0].classificationIds).toEqual([]);
    expect(doc.versions[1].classificationIds).toEqual(['deleted-secondary']);

    // 2. Artist-only Web wire payload
    const artistPayload = {
      title: 'Renamed Title',
      artist: 'New Artist',
      artist_name: 'New Artist',
      versions: [
        { id: 'v1', name: 'Original', key: 'C', links: [] },
        { id: 'v2', name: 'Secondary', key: 'D', links: [{ label: 'Vídeo', url: oldUrl }] },
      ],
    };
    await repo.updateSong('song', ministry, updateSongSchema.parse(artistPayload));
    doc = stored();
    expect(doc.artist_name).toBe('New Artist');
    expect(doc.classification_id).toBe('deleted');
    expect(doc.bpm).toBe(72);
    expect(doc.versions[0].classificationIds).toEqual([]);
    expect(doc.versions[1].classificationIds).toEqual(['deleted-secondary']);

    // 3. Version-name-only Web wire payload
    const versionNamePayload = {
      title: 'Renamed Title',
      artist: 'New Artist',
      artist_name: 'New Artist',
      versions: [
        { id: 'v1', name: 'Renamed Original Version', key: 'C', links: [] },
        { id: 'v2', name: 'Secondary', key: 'D', links: [{ label: 'Vídeo', url: oldUrl }] },
      ],
    };
    await repo.updateSong('song', ministry, updateSongSchema.parse(versionNamePayload));
    doc = stored();
    expect(doc.versions[0].name).toBe('Renamed Original Version');
    expect(doc.classification_id).toBe('deleted');
    expect(doc.bpm).toBe(72);
    expect(doc.versions[0].classificationIds).toEqual([]);
    expect(doc.versions[1].classificationIds).toEqual(['deleted-secondary']);
  });

  it('explicit version clear clears classification_id to null while preserving versions[1].classificationIds: [deleted-secondary]', async () => {
    const clearVersionPayload = {
      versions: [
        { id: 'v1', name: 'Original', classificationIds: [], classification_ids: [] },
        { id: 'v2', name: 'Secondary' },
      ],
    };
    await repo.updateSong('song', ministry, updateSongSchema.parse(clearVersionPayload));
    const doc = stored();
    expect(doc.classification_id).toBeNull();
    expect(doc.versions[0].classificationIds).toEqual([]);
    expect(doc.versions[1].classificationIds).toEqual(['deleted-secondary']);
  });

  it('explicit flat clear clears classification_id to null while preserving versions[1].classificationIds: [deleted-secondary]', async () => {
    const clearFlatPayload = {
      classification_id: null,
    };
    await repo.updateSong('song', ministry, updateSongSchema.parse(clearFlatPayload));
    const doc = stored();
    expect(doc.classification_id).toBeNull();
    expect(doc.versions[0].classificationIds).toEqual([]);
    expect(doc.versions[1].classificationIds).toEqual(['deleted-secondary']);
  });

  it('valid replacement (versions[0].classificationIds: [valid]) updates classification_id to valid', async () => {
    const validPayload = {
      versions: [
        { id: 'v1', name: 'Original', classificationIds: ['valid'] },
        { id: 'v2', name: 'Secondary' },
      ],
    };
    await repo.updateSong('song', ministry, updateSongSchema.parse(validPayload));
    const doc = stored();
    expect(doc.classification_id).toBe('valid');
    expect(doc.versions[0].classificationIds).toEqual(['valid']);
    expect(doc.versions[1].classificationIds).toEqual(['deleted-secondary']);
  });

  it('moving flat orphan deleted into versions[0].classificationIds when previously [] is rejected with 404', async () => {
    const before = stored();
    const movePayload = {
      versions: [
        { id: 'v1', name: 'Original', classificationIds: ['deleted'] },
        { id: 'v2', name: 'Secondary' },
      ],
    };
    await expect(repo.updateSong('song', ministry, updateSongSchema.parse(movePayload)))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(stored()).toEqual(before);
    expect(memory.writes).toHaveLength(0);
  });

  it('cross-tenant foreign classification is rejected with 404', async () => {
    const before = stored();
    const foreignPayload = {
      versions: [
        { id: 'v1', name: 'Original', classificationIds: ['foreign'] },
        { id: 'v2', name: 'Secondary' },
      ],
    };
    await expect(repo.updateSong('song', ministry, updateSongSchema.parse(foreignPayload)))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(stored()).toEqual(before);
    expect(memory.writes).toHaveLength(0);
  });
});
