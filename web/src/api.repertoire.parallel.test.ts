import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import type { SongVersion } from './types';

const versions: SongVersion[] = [
  { id: 'v-studio', name: 'Estúdio', key: 'Db', bpm: 72, duration: '04:12', notes: 'Capotraste 1', classificationIds: ['adoracao'], links: [{ label: 'Cifra', url: 'https://example.test/studio' }] },
  { id: 'v-live', name: 'Ao vivo', key: 'E', bpm: 80, duration: '05:10', notes: 'Intro 2x', classificationIds: ['celebracao'], links: [{ label: 'Vídeo', url: 'https://example.test/live' }] },
];
const song = { id: 'song-a', ministry_id: 'min-a', user_id: 'user-a', title: 'Paz', created_at: '2026-10-01', updated_at: '2026-11-07', versions };
function respond(data: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ data }) });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());

describe('P1 repertoire client contracts (mock HTTP only)', () => {
  it('reads multiple versions retaining IDs, metadata and classifications', async () => {
    const fetchMock = respond(song);
    const result = await api.getSongById('song-a', 'min-a');
    expect(result.versions).toEqual(versions);
    expect(result).toMatchObject({ id: 'song-a', ministryId: 'min-a', userId: 'user-a', createdAt: song.created_at });
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/ministries\/min-a\/songs\/song-a$/);
  });

  it('sends all versions on create without mutating the caller fixture', async () => {
    const fetchMock = respond(song);
    const before = JSON.stringify(versions);
    await api.createSong({ title: 'Paz', versions }, 'min-a');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ versions, original_key: 'Db', bpm: 72, classification_id: 'adoracao' });
    expect(JSON.stringify(versions)).toBe(before);
  });

  it('updates one version without changing the other version identity', async () => {
    const changed = versions.map(v => v.id === 'v-live' ? { ...v, key: 'F#' } : v);
    const fetchMock = respond({ ...song, versions: changed });
    const result = await api.updateSong('song-a', { versions: changed }, 'min-a');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).versions).toEqual(changed);
    expect(result.versions[0]).toEqual(versions[0]);
    expect(result.versions[1]).toMatchObject({ id: 'v-live', key: 'F#' });
  });

  it('removes a secondary version using the existing replacement-array contract', async () => {
    const fetchMock = respond({ ...song, versions: [versions[0]] });
    const result = await api.updateSong('song-a', { versions: [versions[0]] }, 'min-a');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).versions).toEqual([versions[0]]);
    expect(result.versions.map(v => v.id)).toEqual(['v-studio']);
  });

  it('omits versions and musical metadata in a title-only partial update', async () => {
    const fetchMock = respond({ ...song, title: 'Paz renovada' });
    await api.updateSong('song-a', { title: 'Paz renovada' }, 'min-a');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ title: 'Paz renovada' });
  });

  it('keeps the song ID stable when loading the legacy single-version contract', async () => {
    respond({ id: 'legacy', ministry_id: 'min-b', title: 'Paz', original_key: 'G', classification_id: 'classe-b' });
    const result = await api.getSongById('legacy', 'min-b');
    expect(result.id).toBe('legacy');
    expect(result.versions[0]).toMatchObject({ id: 'legacy_v1', key: 'G', classificationIds: ['classe-b'] });
  });
});
