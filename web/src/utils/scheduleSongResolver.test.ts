import { describe, expect, it } from 'vitest';
import type { Song } from '../types';
import { isScheduleSongSlot, resolveScheduleTimelineSong } from './scheduleSongResolver';

const makeSong = (overrides: Partial<Song> = {}): Song => ({
  id: 'song-1',
  title: 'Oceanos',
  artist: 'Hillsong',
  versions: [],
  ...overrides,
});

describe('scheduleSongResolver', () => {
  it('identifies Música timeline slots consistently', () => {
    expect(isScheduleSongSlot({ id: 't1', title: 'Música 1', type: 'Música' })).toBe(true);
    expect(isScheduleSongSlot({ id: 't2', title: 'Oração', type: 'Oração' })).toBe(false);
  });

  it('resolves unambiguous timeline slots and ignores duplicate ambiguous song IDs', () => {
    const songs = [
      makeSong({ id: 's1', title: 'Bondade de Deus', versionId: 'ver-2' }),
      makeSong({ id: 's2', title: 'A Casa É Sua' }),
    ];

    expect(
      resolveScheduleTimelineSong({ id: 'slot-1', title: 'Música 1', type: 'Música' }, 0, songs)
    ).toMatchObject({ id: 's1', versionId: 'ver-2' });

    expect(
      resolveScheduleTimelineSong({ id: 'slot-2', title: 'A Casa É Sua', type: 'Música' }, 1, songs)
    ).toMatchObject({ id: 's2' });

    const duplicatedSongs = [makeSong({ id: 's1', title: 'Oceanos' }), makeSong({ id: 's1', title: 'Oceanos' })];
    expect(
      resolveScheduleTimelineSong({ id: 'slot-1', title: 'Música 1', type: 'Música' }, 0, duplicatedSongs)
    ).toBeNull();
  });
});
