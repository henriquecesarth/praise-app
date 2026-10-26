import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from './api';
import { Classification, Song, SongVersion } from './types';
import { CreateSongModal } from './components/CreateSongModal';
import { VersionEditModal } from './components/VersionEditModal';

const values = [72, '72.50', 'Infinity', '0', 0, '1000', null, undefined, 'Lento e expressivo'] as const;
const version = (bpm: SongVersion['bpm']): SongVersion => ({
  id: 'v1', name: 'Original', classificationIds: [], key: 'C', links: [],
  ...(bpm !== undefined ? { bpm } : {}),
});
const song = (bpm: SongVersion['bpm']): Song => ({
  id: 'song', title: 'Original song', artist: 'Artist', versions: [version(bpm), { ...version(bpm), id: 'v2', name: 'Secondary' }],
});
let requests: { method: string; body: any }[];
beforeEach(() => {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit = {}) => {
    const body = options.body ? JSON.parse(String(options.body)) : {};
    requests.push({ method: options.method || 'GET', body });
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: {
      id: 'song', title: 'Song', ...body,
    } }) };
  }));
});

for (const bpm of values) {
  describe(`BPM ${String(bpm)} (${typeof bpm})`, () => {
    for (const method of ['create', 'update']) {
      it(`${method} serializes explicit values exactly; omitted remains omitted`, async () => {
        const data = { title: 'Song', versions: [version(bpm)], ...(bpm !== undefined ? { bpm } : {}) };
        if (method === 'create') await api.createSong(data, 'min');
        else await api.updateSong('song', data, 'min');
        const body = requests[0].body;
        if (bpm === undefined) {
          expect(body).not.toHaveProperty('bpm'); expect(body.versions[0]).not.toHaveProperty('bpm');
        } else {
          expect(body.bpm).toBe(bpm); expect(body.versions[0].bpm).toBe(bpm);
        }
      });
    }

    it('reads flat and version BPM without losing zero, null or textual representation', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ data: {
        id: 'song', title: 'Song', bpm, versions: [version(bpm)],
      } }) } as Response);
      const result = await api.getSongById('song', 'min');
      expect(result.bpm).toBe(bpm); expect(result.versions[0].bpm).toBe(bpm);
    });

    it('title/artist-only API updates omit BPM and versions', async () => {
      await api.updateSong('song', { title: 'Renamed' }, 'min');
      await api.updateSong('song', { artist: 'Renamed artist' }, 'min');
      for (const { body } of requests) {
        expect(body).not.toHaveProperty('bpm'); expect(body).not.toHaveProperty('versions');
      }
    });

    it('actual song editor omits untouched primary and secondary BPMs', async () => {
      const original = song(bpm);
      const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
      render(<CreateSongModal song={original} classifications={[]} onSave={save} onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText('Título da Música *'), { target: { value: 'Renamed' } });
      fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
      await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
      const body = requests[0].body;
      expect(body.title).toBe('Renamed'); expect(body).not.toHaveProperty('bpm');
      expect(body.versions.map((item: SongVersion) => item.id)).toEqual(['v1', 'v2']);
      for (const item of body.versions) expect(item).not.toHaveProperty('bpm');
      expect(original.versions[0].bpm).toBe(bpm);
    });

    it('renaming inside the version editor preserves the original BPM type/value', () => {
      const save = vi.fn();
      render(<VersionEditModal version={version(bpm)} classifications={[]} onSave={save} onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText('Nome da Versão (ex: Original, Acústico) *'), { target: { value: 'Renamed' } });
      fireEvent.click(screen.getByTitle('Concluir Versão'));
      expect(save).toHaveBeenCalledTimes(1); expect(save.mock.calls[0][0].bpm).toBe(bpm);
      expect(save.mock.calls[0][0].links).toEqual(version(bpm).links);
    });
  });
}

it('explicit empty BPM serializes as a clear while omitted remains absent', async () => {
  await api.updateSong('song', { bpm: '', versions: [version('')] }, 'min');
  expect(requests[0].body.bpm).toBeNull(); expect(requests[0].body.versions[0].bpm).toBeNull();
});

for (const explicit of ['72.50', 'Infinity', '0', '1000', '']) {
  it(`explicit version edit preserves text or clears (${explicit})`, () => {
    const save = vi.fn();
    render(<VersionEditModal version={version(72)} classifications={[]} onSave={save} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('BPM (ex: 120)'), { target: { value: explicit } });
    fireEvent.click(screen.getByTitle('Concluir Versão'));
    expect(save.mock.calls[0][0].bpm).toBe(explicit === '' ? null : explicit);
  });
}
for (const invalid of ['   ', 'Lento e expressivo']) {
  it('rejects explicitly edited invalid text instead of silently dropping it', () => {
    const save = vi.fn();
    render(<VersionEditModal version={version(72)} classifications={[]} onSave={save} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('BPM (ex: 120)'), { target: { value: invalid } });
    fireEvent.click(screen.getByTitle('Concluir Versão'));
    expect(save).not.toHaveBeenCalled(); expect(screen.getByLabelText('BPM (ex: 120)')).toHaveAttribute('aria-invalid', 'true');
  });
}

it('version-name/BPM-only edits preserve link labels, URLs and identifiers exactly', () => {
  const original = { ...version('Infinity'), links: [
    { label: 'YouTube', url: 'https://example.test/video' },
    { id: 'score', label: 'Partitura em Ré', url: 'https://example.test/score', isCustom: true },
  ] };
  const save = vi.fn();
  render(<VersionEditModal version={original} classifications={[]} onSave={save} onClose={() => {}} />);
  fireEvent.change(screen.getByLabelText('BPM (ex: 120)'), { target: { value: '72.50' } });
  fireEvent.click(screen.getByTitle('Concluir Versão'));
  expect(save.mock.calls[0][0].links).toEqual(original.links);
});

for (const invalidNumber of [Infinity, -Infinity, NaN]) {
  it('rejects nonfinite numeric BPM before JSON can convert it into a clear', async () => {
    await expect(api.updateSong('song', { bpm: invalidNumber }, 'min')).rejects.toMatchObject({ statusCode: 400 });
    await expect(api.createSong({ title: 'Song', versions: [version(invalidNumber)] }, 'min')).rejects.toMatchObject({ statusCode: 400 });
    expect(fetch).not.toHaveBeenCalled();
  });
}

describe('R4-M15 classification omitted updates & explicit edits', () => {
  const singleVersionFixture: Song = {
    id: 'song',
    title: 'Song',
    artist: 'Artist',
    classificationId: 'deleted',
    versions: [{ id: 'v1', name: 'Original', classificationIds: [], key: 'C', bpm: 72, links: [] }],
  };

  const twoVersionFixture: Song = {
    id: 'song',
    title: 'Song',
    artist: 'Artist',
    classificationId: 'deleted',
    versions: [
      { id: 'v1', name: 'Original', classificationIds: [], key: 'C', bpm: 72, links: [] },
      { id: 'v2', name: 'Secondary', classificationIds: ['deleted-secondary'], key: 'D', bpm: '72.50', links: [] },
    ],
  };

  const classifications: Classification[] = [
    { id: 'valid', ministryId: 'min', name: 'Valid Classification', createdAt: '', updatedAt: '' },
  ];

  it('single-version R4-M14 fixture title-only edit wire payload matches exact contract', async () => {
    const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
    render(<CreateSongModal song={singleVersionFixture} classifications={[]} onSave={save} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Título da Música *'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(requests[0].body).toEqual({
      title: 'Renamed',
      artist: 'Artist',
      artist_name: 'Artist',
      versions: [{ id: 'v1', name: 'Original', key: 'C', links: [] }],
    });
  });

  it('title-only edit on two-version song omits bpm, classification_id, and versions[*].classificationIds', async () => {
    const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
    render(<CreateSongModal song={twoVersionFixture} classifications={[]} onSave={save} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Título da Música *'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const body = requests[0].body;
    expect(body.title).toBe('Renamed');
    expect(body).not.toHaveProperty('bpm');
    expect(body).not.toHaveProperty('classification_id');
    expect(body.versions).toHaveLength(2);
    for (const v of body.versions) {
      expect(v).not.toHaveProperty('bpm');
      expect(v).not.toHaveProperty('classificationIds');
      expect(v).not.toHaveProperty('classification_ids');
    }
  });

  it('artist-only edit omits classificationIds and classification_ids on all versions', async () => {
    const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
    render(<CreateSongModal song={twoVersionFixture} classifications={[]} onSave={save} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Artista / Compositor'), { target: { value: 'Renamed Artist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const body = requests[0].body;
    expect(body.artist).toBe('Renamed Artist');
    expect(body).not.toHaveProperty('classification_id');
    for (const v of body.versions) {
      expect(v).not.toHaveProperty('classificationIds');
      expect(v).not.toHaveProperty('classification_ids');
    }
  });

  it('version-name-only edit omits classificationIds and classification_ids', async () => {
    const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
    render(<CreateSongModal song={twoVersionFixture} classifications={[]} onSave={save} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTitle('Editar Versão')[0]);
    fireEvent.change(screen.getByLabelText('Nome da Versão (ex: Original, Acústico) *'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTitle('Concluir Versão'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const body = requests[0].body;
    expect(body.versions[0].name).toBe('Renamed');
    for (const v of body.versions) {
      expect(v).not.toHaveProperty('classificationIds');
      expect(v).not.toHaveProperty('classification_ids');
    }
  });

  it('selecting a valid classification chip serializes classificationIds on versions[0] while versions[1] omits it', async () => {
    const fixtureWithDeleted: Song = {
      ...twoVersionFixture,
      versions: [
        { ...twoVersionFixture.versions[0], classificationIds: ['deleted'] },
        twoVersionFixture.versions[1],
      ],
    };
    const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
    render(<CreateSongModal song={fixtureWithDeleted} classifications={classifications} onSave={save} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTitle('Editar Versão')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Valid Classification/i }));
    fireEvent.click(screen.getByTitle('Concluir Versão'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const body = requests[0].body;
    expect(body.versions[0].classificationIds).toEqual(['valid']);
    expect(body.versions[0].classification_ids).toEqual(['valid']);
    expect(body.versions[1]).not.toHaveProperty('classificationIds');
    expect(body.versions[1]).not.toHaveProperty('classification_ids');
  });

  it('selecting a valid classification chip when version previously had empty classificationIds serializes valid', async () => {
    const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
    render(<CreateSongModal song={twoVersionFixture} classifications={classifications} onSave={save} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTitle('Editar Versão')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Valid Classification/i }));
    fireEvent.click(screen.getByTitle('Concluir Versão'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const body = requests[0].body;
    expect(body.versions[0].classificationIds).toEqual(['valid']);
    expect(body.versions[0].classification_ids).toEqual(['valid']);
    expect(body.versions[1]).not.toHaveProperty('classificationIds');
    expect(body.versions[1]).not.toHaveProperty('classification_ids');
  });

  it('explicitly unchecking a selected classification chip serializes empty classificationIds on versions[0]', async () => {
    const fixtureWithValid: Song = {
      ...twoVersionFixture,
      versions: [
        { ...twoVersionFixture.versions[0], classificationIds: ['valid'] },
        twoVersionFixture.versions[1],
      ],
    };
    const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
    render(<CreateSongModal song={fixtureWithValid} classifications={classifications} onSave={save} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTitle('Editar Versão')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Valid Classification/i }));
    fireEvent.click(screen.getByTitle('Concluir Versão'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const body = requests[0].body;
    expect(body.versions[0].classificationIds).toEqual([]);
    expect(body.versions[0].classification_ids).toEqual([]);
    expect(body.versions[1]).not.toHaveProperty('classificationIds');
  });

  it('toggling a chip on and off to clear serializes empty classificationIds on versions[0]', async () => {
    const save = vi.fn(async (data) => { await api.updateSong('song', data, 'min'); });
    render(<CreateSongModal song={twoVersionFixture} classifications={classifications} onSave={save} onClose={() => {}} />);
    fireEvent.click(screen.getAllByTitle('Editar Versão')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Valid Classification/i }));
    fireEvent.click(screen.getByRole('button', { name: /Valid Classification/i }));
    fireEvent.click(screen.getByTitle('Concluir Versão'));
    fireEvent.click(screen.getByRole('button', { name: 'Salvar música' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const body = requests[0].body;
    expect(body.versions[0].classificationIds).toEqual([]);
    expect(body.versions[0].classification_ids).toEqual([]);
    expect(body.versions[1]).not.toHaveProperty('classificationIds');
  });
});
