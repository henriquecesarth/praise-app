export interface TimelineSlot { id: string; title: string; type: string; time?: string }
interface TimelineSong { id: string; title: string }
const placeholder = (title: string, index: number) => !title.trim() || title.trim() === `Música ${index + 1}`;

export function resolveTimelineSong<T extends TimelineSong>(item: TimelineSlot, index: number, songs: T[]): T | undefined {
  const song = songs[index];
  if (item.type !== 'Música' || !song?.id?.trim() || !song.title.trim() || songs.filter(s => s.id === song.id).length !== 1) return;
  if (placeholder(item.title, index)) return song;
  if (item.title.trim() === song.title.trim() && songs.filter(s => s.title.trim() === song.title.trim()).length === 1) return song;
}

export function syncTimelineSongSlots(current: TimelineSlot[], previous: TimelineSong[], songs: TimelineSong[]): TimelineSlot[] {
  let slot = 0;
  const result = current.map(item => {
    if (item.type !== 'Música') return item;
    const index = slot++;
    if (!placeholder(item.title, index) && !resolveTimelineSong(item, index, previous)) return item;
    return { ...item, title: songs[index]?.title.trim() || `Música ${index + 1}` };
  });
  while (slot < songs.length) {
    result.push({ id: `song_slot_${Date.now()}_${slot}`, title: songs[slot].title.trim() || `Música ${slot + 1}`, type: 'Música' });
    slot++;
  }
  return result;
}
