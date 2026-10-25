import { describe, expect, it } from 'vitest';
import { syncTimelineSongSlots, resolveTimelineSong, TimelineSlot } from './song-timeline';
const songs = [{ id: 'a', title: 'Oceanos' }, { id: 'b', title: 'Ao Teu Rosto Vir' }, { id: 'c', title: 'Até que Ele Venha' }];
const slot = (n: number): TimelineSlot => ({ id: `s${n}`, title: `Música ${n}`, type: 'Música' });
const event = { id: 'oferta', title: 'Oferta', type: 'Oferta', time: '5min' };
describe('positional song timeline contract', () => {
  it('maps templates before/after selection, preserves events and survives JSON roundtrip', () => {
    const result = syncTimelineSongSlots([slot(1), event, slot(2), slot(3)], [], songs);
    expect(result.map(it => it.title)).toEqual(['Oceanos', 'Oferta', 'Ao Teu Rosto Vir', 'Até que Ele Venha']);
    expect(result[1]).toBe(event);
    const reopened = JSON.parse(JSON.stringify(result));
    expect(resolveTimelineSong(reopened[2], 1, songs)?.id).toBe('b');
    expect(syncTimelineSongSlots([], [], songs).map(it => it.title)).toEqual(songs.map(s => s.title));
  });
  it('updates remove/reorder without changing custom titles or event metadata', () => {
    const initial = syncTimelineSongSlots([slot(1), event, slot(2), slot(3)], [], songs);
    const reordered = [songs[2], songs[0], songs[1]];
    const result = syncTimelineSongSlots(initial, songs, reordered);
    expect(result.map(it => it.title)).toEqual(['Até que Ele Venha', 'Oferta', 'Oceanos', 'Ao Teu Rosto Vir']);
    expect(syncTimelineSongSlots(result, reordered, [songs[0]])[2].title).toBe('Música 2');
    const custom = { ...slot(1), title: 'Medley especial' };
    expect(syncTimelineSongSlots([custom, event], songs, reordered)[0]).toBe(custom);
    expect(resolveTimelineSong(custom, 0, songs)).toBeUndefined();
    expect(resolveTimelineSong({ ...slot(1), title: 'Oceanos' }, 0, [songs[0], { id: 'x', title: 'Oceanos' }])).toBeUndefined();
  });
});
