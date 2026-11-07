import { beforeEach, describe, expect, it, vi } from 'vitest';

// Every collection is in-memory; an unexpected Firebase call fails immediately.
vi.mock('../lib/firebase', () => ({ db: { collection: vi.fn(() => ({})) } }));
import { RepertoireRepository } from './RepertoireRepository';
import { ScheduleRepository } from './ScheduleRepository';
import { createSongSchema, updateSongSchema } from '../features/repertoire/repertoire.types';
import { updateScheduleSchema } from '../features/schedules/schedule.types';

function documentFixture(initial: Record<string, unknown>) {
  let state = structuredClone(initial);
  const ref = {
    get: vi.fn(async () => ({ exists: true, id: 'document-a', data: () => structuredClone(state) })),
    update: vi.fn(async (patch: Record<string, unknown>) => { state = { ...state, ...structuredClone(patch) }; }),
  };
  return { ref, collection: { doc: vi.fn(() => ref) } };
}

describe('P1 repertoire persistence with isolated documents', () => {
  let repo: RepertoireRepository;
  beforeEach(() => { repo = new RepertoireRepository(); });

  it('preserves IDs, musical metadata and versions during a validated title-only patch', async () => {
    const original = { ministry_id: 'min-a', user_id: 'user-a', title: 'Paz', original_key: 'Db', bpm: 72, created_at: '2026-10-01', versions: [{ id: 'v1', key: 'Db' }, { id: 'v2', key: 'E' }] };
    const fixture = documentFixture(original);
    Object.assign(repo, { songsCol: fixture.collection });
    const result = await repo.updateSong('document-a', 'min-a', updateSongSchema.parse({ title: 'Paz renovada' }));
    expect(result).toMatchObject({ ...original, id: 'document-a', title: 'Paz renovada' });
    expect(fixture.ref.update).toHaveBeenCalledWith({ title: 'Paz renovada', updated_at: expect.any(String) });
  });

  it('clears classification explicitly while retaining unrelated musical metadata', async () => {
    const fixture = documentFixture({ ministry_id: 'min-a', classification_id: 'c1', classification: { id: 'c1' }, original_key: 'E' });
    Object.assign(repo, { songsCol: fixture.collection });
    const result = await repo.updateSong('document-a', 'min-a', updateSongSchema.parse({ classification_id: null }));
    expect(result).toMatchObject({ classification_id: null, classification: null, original_key: 'E' });
  });

  it('rejects a foreign song before relation lookup or persistence', async () => {
    const fixture = documentFixture({ ministry_id: 'min-b', title: 'Privada' });
    Object.assign(repo, { songsCol: fixture.collection });
    await expect(repo.updateSong('document-a', 'min-a', { classification_id: 'c1' })).rejects.toMatchObject({ statusCode: 404 });
    expect(fixture.ref.update).not.toHaveBeenCalled();
  });

  it('does not allow payload identifiers to replace document ownership', async () => {
    const fixture = documentFixture({ ministry_id: 'min-a', user_id: 'user-a' });
    Object.assign(repo, { songsCol: fixture.collection });
    const result = await repo.updateSong('document-a', 'min-a', { id: 'foreign', ministry_id: 'min-b', user_id: 'user-b', title: 'Paz' });
    expect(result).toMatchObject({ id: 'document-a', ministry_id: 'min-a', user_id: 'user-a' });
  });

  // Executable known gaps: expected failures, not successful version persistence.
  it.fails('DEFERRED: HTTP create must retain Web versions and notes', () => {
    const input = { title: 'Paz', versions: [{ id: 'v1', name: 'Original', key: 'Db' }], notes: 'Intro 2x' };
    expect(createSongSchema.parse(input)).toMatchObject(input);
  });
  it.fails('DEFERRED: HTTP update must retain replacement versions and notes', () => {
    const input = { versions: [{ id: 'v2', name: 'Ao vivo', key: 'E' }], notes: 'Final 2x' };
    expect(updateSongSchema.parse(input)).toMatchObject(input);
  });
});

describe('P1 schedule persistence with isolated documents', () => {
  let repo: ScheduleRepository;
  beforeEach(() => { repo = new ScheduleRepository(); });
  const original = {
    ministry_id: 'min-a', created_by: 'user-a', created_at: '2026-10-01', title: 'Culto', duration_minutes: 240, isVisible: false,
    participants: [{ id: 'm1', name: 'Ana', role: 'Vocal', assigned_at: '2026-10-01' }],
    songs: [{ id: 's1', title: 'Paz' }, { id: 's2', title: 'Graça' }],
    timeline: [{ id: 't1', title: 'Abertura', type: 'song' }, { id: 't2', title: 'Oração', type: 'prayer' }],
  };

  it('retains songs, timeline order and assignment metadata on title-only HTTP update', async () => {
    const fixture = documentFixture(original);
    Object.assign(repo, { schedulesCol: fixture.collection });
    const result = await repo.updateSchedule('document-a', 'min-a', updateScheduleSchema.parse({ title: 'Ensaio' }));
    expect(result).toMatchObject({ ...original, title: 'Ensaio' });
    expect(fixture.ref.update).toHaveBeenCalledWith({ title: 'Ensaio', updated_at: expect.any(String) });
  });

  it('clears all participants explicitly without deleting songs or program order', async () => {
    const fixture = documentFixture(original);
    Object.assign(repo, { schedulesCol: fixture.collection });
    const result = await repo.updateSchedule('document-a', 'min-a', { participants: [] });
    expect(result.participants).toEqual([]);
    expect(result.songs).toEqual(original.songs);
    expect(result.timeline).toEqual(original.timeline);
  });

  it('persists deliberate song and program reordering exactly', async () => {
    const fixture = documentFixture(original);
    Object.assign(repo, { schedulesCol: fixture.collection });
    const songs = [...original.songs].reverse();
    const timeline = [...original.timeline].reverse();
    const result = await repo.updateSchedule('document-a', 'min-a', { songs, timeline });
    expect(result.songs).toEqual(songs);
    expect(result.timeline).toEqual(timeline);
    expect(result.participants).toEqual(original.participants);
  });

  it('retains assignment date when changing the role of an existing participant', async () => {
    const fixture = documentFixture(original);
    Object.assign(repo, { schedulesCol: fixture.collection });
    const result = await repo.updateSchedule('document-a', 'min-a', { participants: [{ id: 'm1', name: 'Ana', role: 'Violão' }] });
    expect(result.participants).toEqual([{ ...original.participants[0], role: 'Violão' }]);
  });

  it('rejects cross-ministry updates without any write', async () => {
    const fixture = documentFixture(original);
    Object.assign(repo, { schedulesCol: fixture.collection });
    await expect(repo.updateSchedule('document-a', 'min-b', { participants: [] })).rejects.toMatchObject({ statusCode: 404 });
    expect(fixture.ref.update).not.toHaveBeenCalled();
  });
});
