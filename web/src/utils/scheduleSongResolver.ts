import type { Song } from '../types';

export interface ScheduleTimelineItemLike {
  id: string;
  title: string;
  time?: string;
  type: string;
}

export function isScheduleSongSlot(item: ScheduleTimelineItemLike): boolean {
  return item.type === 'Música';
}

function isPlaceholderTitle(title: string, slotIndex: number): boolean {
  const trimmed = title.trim();
  return trimmed === `Música ${slotIndex + 1}` || trimmed.length === 0;
}

/**
 * Resolves a schedule timeline song slot to its scheduled song when the
 * positional and title mapping is unambiguous.
 */
export function resolveScheduleTimelineSong(
  item: ScheduleTimelineItemLike,
  slotIndex: number,
  songs: Song[]
): Song | null {
  if (!isScheduleSongSlot(item) || slotIndex < 0 || slotIndex >= songs.length) {
    return null;
  }
  const song = songs[slotIndex];
  const songId = (song?.id || '').trim();
  if (!songId) return null;
  if (songs.filter((s) => (s.id || '').trim() === songId).length !== 1) {
    return null;
  }
  const title = (song.title || '').trim();
  if (!title) return null;
  if (isPlaceholderTitle(item.title || '', slotIndex)) {
    return song;
  }
  if (
    (item.title || '').trim() === title &&
    songs.filter((s) => (s.title || '').trim() === title).length === 1
  ) {
    return song;
  }
  return null;
}
