import 'package:flutter/foundation.dart';

import 'schedule.dart';

String? _normalizeOptionalText(String? value) {
  final trimmed = value?.trim();
  if (trimmed == null || trimmed.isEmpty) {
    return null;
  }
  return trimmed;
}

@immutable
class ScheduleSongSequenceItem {
  final int scheduleSlotIndex;
  final String songId;
  final String title;
  final String? versionId;
  final String? versionName;
  final String? key;

  const ScheduleSongSequenceItem({
    required this.scheduleSlotIndex,
    required this.songId,
    required this.title,
    this.versionId,
    this.versionName,
    this.key,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleSongSequenceItem &&
          runtimeType == other.runtimeType &&
          scheduleSlotIndex == other.scheduleSlotIndex &&
          songId == other.songId &&
          title == other.title &&
          versionId == other.versionId &&
          versionName == other.versionName &&
          key == other.key;

  @override
  int get hashCode => Object.hash(
        scheduleSlotIndex,
        songId,
        title,
        versionId,
        versionName,
        key,
      );
}

@immutable
class ScheduleSongSequenceContext {
  final String ministryId;
  final String scheduleId;
  final List<ScheduleSongSequenceItem> items;
  final int currentIndex;

  ScheduleSongSequenceContext({
    required this.ministryId,
    required this.scheduleId,
    required List<ScheduleSongSequenceItem> items,
    required int currentIndex,
  })  : items = List<ScheduleSongSequenceItem>.unmodifiable(items),
        currentIndex = items.isEmpty
            ? 0
            : currentIndex.clamp(0, items.length - 1).toInt();

  factory ScheduleSongSequenceContext.fromScheduleSongs({
    required String ministryId,
    required String scheduleId,
    required List<ScheduleSong> songs,
    int? initialScheduleSlotIndex,
  }) {
    final items = <ScheduleSongSequenceItem>[];
    var resolvedIndex = 0;

    for (var i = 0; i < songs.length; i++) {
      final song = songs[i];
      final normalizedSongId = song.id.trim();
      if (normalizedSongId.isEmpty) {
        continue;
      }
      if (initialScheduleSlotIndex != null && i == initialScheduleSlotIndex) {
        resolvedIndex = items.length;
      }
      final normalizedTitle = _normalizeOptionalText(song.title);
      items.add(
        ScheduleSongSequenceItem(
          scheduleSlotIndex: i,
          songId: normalizedSongId,
          title: normalizedTitle ?? 'Música ${i + 1}',
          versionId: _normalizeOptionalText(song.versionId),
          versionName: _normalizeOptionalText(song.versionName),
          key: _normalizeOptionalText(song.key),
        ),
      );
    }

    return ScheduleSongSequenceContext(
      ministryId: ministryId,
      scheduleId: scheduleId,
      items: items,
      currentIndex: resolvedIndex,
    );
  }

  bool get isEmpty => items.isEmpty;
  bool get isNotEmpty => items.isNotEmpty;
  bool get hasPrevious => items.isNotEmpty && currentIndex > 0;
  bool get hasNext => items.isNotEmpty && currentIndex < items.length - 1;

  ScheduleSongSequenceItem? get currentItem =>
      (currentIndex >= 0 && currentIndex < items.length)
          ? items[currentIndex]
          : null;

  ScheduleSongSequenceItem? get previousItem =>
      hasPrevious ? items[currentIndex - 1] : null;

  ScheduleSongSequenceItem? get nextItem =>
      hasNext ? items[currentIndex + 1] : null;

  String get positionLabel =>
      items.isEmpty ? '' : '${currentIndex + 1} de ${items.length}';

  ScheduleSongSequenceContext moveToIndex(int index) {
    if (items.isEmpty) {
      return this;
    }
    final nextIndex = index.clamp(0, items.length - 1).toInt();
    if (nextIndex == currentIndex) {
      return this;
    }
    return ScheduleSongSequenceContext(
      ministryId: ministryId,
      scheduleId: scheduleId,
      items: items,
      currentIndex: nextIndex,
    );
  }

  ScheduleSongSequenceContext? movePrevious() =>
      hasPrevious ? moveToIndex(currentIndex - 1) : null;

  ScheduleSongSequenceContext? moveNext() =>
      hasNext ? moveToIndex(currentIndex + 1) : null;
}
