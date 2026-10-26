import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from './api';
import { Song, SongVersion } from './types';
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
