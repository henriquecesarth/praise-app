import 'package:flutter/material.dart';
import '../../../domain/schedule.dart';
import '../../../domain/song_timeline.dart';
import 'schedule_detail_surface.dart';

/// Roteiro tab inside Schedule Detail:
/// displays ordered service items with type label (e.g. Música 1, Oração),
/// title, optional time/duration, and direct drill-down into linked songs.
class ScheduleOrderTabView extends StatelessWidget {
  final List<ScheduleTimelineItem> items;
  final List<ScheduleSong> songs;
  final void Function(int songSlotIndex, ScheduleSong song) onOpenSong;

  const ScheduleOrderTabView({
    super.key,
    required this.items,
    required this.songs,
    required this.onOpenSong,
  });

  static const Map<String, String> _typeLabels = {
    'worship': 'Louvor',
    'prayer': 'Oração',
    'word': 'Palavra',
    'transition': 'Transição',
    'other': 'Outro',
  };

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SingleChildScrollView(
      key: const ValueKey('schedule_order_scroll'),
      padding: EdgeInsets.fromLTRB(
        12,
        4,
        12,
        100 + MediaQuery.paddingOf(context).bottom,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
            child: Text(
              'Roteiro do Culto (${items.length})',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(height: 4),
          if (items.isEmpty)
            ScheduleDetailSectionCard(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Column(
                  children: [
                    Icon(
                      Icons.playlist_remove_outlined,
                      size: 36,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Nenhum momento no roteiro desta escala.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            )
          else
            for (var index = 0; index < items.length; index++) ...[
              if (index > 0) const SizedBox(height: 10),
              Builder(
                builder: (_) {
                  final item = items[index];
                  final isSong = isSongSlot(item);
                  final songSlotIndex =
                      isSong ? items.take(index).where(isSongSlot).length : -1;
                  final song = songSlotIndex >= 0
                      ? resolveTimelineSong(item, songSlotIndex, songs)
                      : null;
                  final typeLabel = isSong
                      ? 'Música ${songSlotIndex + 1}'
                      : (_typeLabels[item.type] ?? item.type);

                  return ScheduleDetailSectionCard(
                    padding: EdgeInsets.zero,
                    child: InkWell(
                      key: ValueKey('timeline_item_${item.id}'),
                      onTap: song == null
                          ? null
                          : () => onOpenSong(songSlotIndex, song),
                      borderRadius: BorderRadius.circular(16),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 14,
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            CircleAvatar(
                              radius: 17,
                              backgroundColor: isSong
                                  ? theme.colorScheme.primaryContainer
                                  : theme.colorScheme.surfaceContainerHighest,
                              child: Text(
                                '${index + 1}',
                                style: theme.textTheme.labelMedium?.copyWith(
                                  fontWeight: FontWeight.w800,
                                  color: isSong
                                      ? theme.colorScheme.onPrimaryContainer
                                      : theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Wrap(
                                    spacing: 6,
                                    runSpacing: 4,
                                    crossAxisAlignment:
                                        WrapCrossAlignment.center,
                                    children: [
                                      Container(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 7,
                                          vertical: 2,
                                        ),
                                        decoration: BoxDecoration(
                                          color: isSong
                                              ? theme.colorScheme.primary
                                                  .withValues(alpha: 0.14)
                                              : theme.colorScheme
                                                  .surfaceContainerHighest,
                                          borderRadius:
                                              BorderRadius.circular(6),
                                        ),
                                        child: Text(
                                          typeLabel,
                                          style: theme.textTheme.labelSmall
                                              ?.copyWith(
                                            fontWeight: FontWeight.w700,
                                            color: isSong
                                                ? theme.colorScheme.primary
                                                : theme.colorScheme
                                                    .onSurfaceVariant,
                                          ),
                                        ),
                                      ),
                                      if (song?.versionName != null &&
                                          song!.versionName!.isNotEmpty)
                                        Text(
                                          song.versionName!,
                                          style: theme.textTheme.labelSmall
                                              ?.copyWith(
                                            color: theme
                                                .colorScheme.onSurfaceVariant,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                    ],
                                  ),
                                  const SizedBox(height: 5),
                                  Text(
                                    song?.title ?? item.title,
                                    style: theme.textTheme.titleSmall?.copyWith(
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (item.time?.isNotEmpty == true) ...[
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: theme
                                      .colorScheme.surfaceContainerHighest
                                      .withValues(alpha: 0.65),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Text(
                                  item.time!,
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ),
                            ],
                            if (song != null) ...[
                              const SizedBox(width: 6),
                              Icon(
                                Icons.chevron_right_rounded,
                                size: 20,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
            ],
        ],
      ),
    );
  }
}
