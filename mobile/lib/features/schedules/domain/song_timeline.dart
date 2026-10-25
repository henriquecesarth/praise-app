import 'schedule.dart';

/// The REST timeline contract has no song ID: only explicitly typed song slots
/// participate in positional mapping. Customized/ambiguous titles remain opaque.
bool isSongSlot(ScheduleTimelineItem item) => item.type == 'Música';

bool _placeholder(String title, int index) =>
    title.trim() == 'Música ${index + 1}' || title.trim().isEmpty;

ScheduleSong? resolveTimelineSong(
  ScheduleTimelineItem item, int slotIndex, List<ScheduleSong> songs,
) {
  if (!isSongSlot(item) || slotIndex >= songs.length) return null;
  final song = songs[slotIndex];
  if (song.id.trim().isEmpty ||
      songs.where((s) => s.id == song.id).length != 1) return null;
  final title = song.title?.trim() ?? '';
  if (title.isEmpty) return null;
  if (_placeholder(item.title, slotIndex)) return song;
  if (item.title.trim() == title &&
      songs.where((s) => s.title?.trim() == title).length == 1) return song;
  return null;
}

List<ScheduleTimelineItem> syncSongTimeline(
  List<ScheduleTimelineItem> timeline,
  List<ScheduleSong> previousSongs,
  List<ScheduleSong> songs,
) {
  var slot = 0;
  final result = timeline.map((item) {
    if (!isSongSlot(item)) return item;
    final index = slot++;
    final managed = _placeholder(item.title, index) ||
        resolveTimelineSong(item, index, previousSongs) != null;
    if (!managed) return item;
    final title = index < songs.length ? songs[index].title?.trim() : null;
    return item.copyWith(title: title == null || title.isEmpty
        ? 'Música ${index + 1}' : title);
  }).toList();
  final stamp = DateTime.now().microsecondsSinceEpoch;
  while (slot < songs.length) {
    result.add(ScheduleTimelineItem(
      id: 'song_slot_${stamp}_$slot',
      title: songs[slot].title?.trim().isNotEmpty == true
          ? songs[slot].title!.trim() : 'Música ${slot + 1}',
      type: 'Música',
    ));
    slot++;
  }
  return result;
}
