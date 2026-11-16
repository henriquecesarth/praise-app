import 'package:flutter/material.dart';
import '../../../../repertoire/domain/song_summary.dart';
import '../../../domain/schedule.dart';
import 'schedule_detail_surface.dart';
import 'schedule_song_presentation.dart';

/// Músicas tab inside Schedule Detail:
/// displays ordinal position (1ª, 2ª...), title, artist, classification, key,
/// media/resource indicators on the right, and optional YouTube launch action.
class ScheduleSongsTabView extends StatelessWidget {
  final List<ScheduleSong> songs;
  final Map<String, SongSummary> summariesById;
  final void Function(int slotIndex, ScheduleSong song) onOpenSong;
  final ValueChanged<String>? onOpenYoutube;

  const ScheduleSongsTabView({
    super.key,
    required this.songs,
    this.summariesById = const {},
    required this.onOpenSong,
    this.onOpenYoutube,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return SingleChildScrollView(
      key: const ValueKey('schedule_songs_scroll'),
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
              'Músicas Escaladas (${songs.length})',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(height: 4),
          if (songs.isEmpty)
            ScheduleDetailSectionCard(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Column(
                  children: [
                    Icon(
                      Icons.music_off_outlined,
                      size: 36,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Nenhuma música escalada para esta escala.',
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
            for (var i = 0; i < songs.length; i++) ...[
              if (i > 0) const SizedBox(height: 10),
              _ScheduleSongCard(
                presentation: ScheduleSongPresentation.fromScheduleSong(
                  index: i,
                  song: songs[i],
                  summary: summariesById[songs[i].id],
                ),
                onOpenSong: songs[i].id.trim().isNotEmpty
                    ? () => onOpenSong(i, songs[i])
                    : null,
                onOpenYoutube: onOpenYoutube,
              ),
            ],
        ],
      ),
    );
  }
}

class _ScheduleSongCard extends StatelessWidget {
  final ScheduleSongPresentation presentation;
  final VoidCallback? onOpenSong;
  final ValueChanged<String>? onOpenYoutube;

  const _ScheduleSongCard({
    required this.presentation,
    required this.onOpenSong,
    required this.onOpenYoutube,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final slotNumber = presentation.index + 1;
    final hasAnyResourceIcon = presentation.hasChord ||
        presentation.hasLyrics ||
        presentation.hasAudio ||
        presentation.hasYoutube;

    return ScheduleDetailSectionCard(
      padding: EdgeInsets.zero,
      child: InkWell(
        key: ValueKey('detail_song_row_$slotNumber'),
        onTap: onOpenSong,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              // Ordinal position badge (1ª, 2ª, 3ª...)
              Container(
                width: 38,
                height: 38,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer
                      .withValues(alpha: 0.7),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  presentation.ordinalLabel,
                  key: ValueKey('detail_song_ordinal_$slotNumber'),
                  style: theme.textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.w800,
                    color: theme.colorScheme.onPrimaryContainer,
                  ),
                ),
              ),
              const SizedBox(width: 12),

              // Title, artist, version, classification, key
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      presentation.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (presentation.artist != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        presentation.artist!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                    if (presentation.versionName != null ||
                        presentation.classificationName != null ||
                        presentation.keyLabel != null) ...[
                      const SizedBox(height: 6),
                      Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          if (presentation.keyLabel != null)
                            Container(
                              key: ValueKey(
                                'detail_song_key_${presentation.song.id}',
                              ),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 7,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.primary
                                    .withValues(alpha: 0.14),
                                borderRadius: BorderRadius.circular(6),
                                border: Border.all(
                                  color: theme.colorScheme.primary
                                      .withValues(alpha: 0.35),
                                ),
                              ),
                              child: Text(
                                'Tom: ${presentation.keyLabel}',
                                style: theme.textTheme.labelSmall?.copyWith(
                                  fontWeight: FontWeight.w700,
                                  color: theme.colorScheme.primary,
                                ),
                              ),
                            ),
                          if (presentation.classificationName != null)
                            _ClassificationPill(
                              name: presentation.classificationName!,
                              color: presentation.classificationColor ??
                                  theme.colorScheme.secondary,
                            ),
                          if (presentation.versionName != null)
                            Text(
                              'Versão: ${presentation.versionName!}',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),

              if (hasAnyResourceIcon || onOpenSong != null) ...[
                const SizedBox(width: 8),
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (hasAnyResourceIcon)
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 86),
                            child: Wrap(
                              spacing: 4,
                              runSpacing: 4,
                              alignment: WrapAlignment.end,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: [
                                if (presentation.hasChord)
                                  _ResourceBadgeIcon(
                                    iconKey: ValueKey(
                                      'detail_song_ind_chord_$slotNumber',
                                    ),
                                    icon: Icons.queue_music_rounded,
                                    tooltip: 'Cifra disponível',
                                    color: theme.colorScheme.primary,
                                  ),
                                if (presentation.hasLyrics)
                                  _ResourceBadgeIcon(
                                    iconKey: ValueKey(
                                      'detail_song_ind_lyrics_$slotNumber',
                                    ),
                                    icon: Icons.article_outlined,
                                    tooltip: 'Letra disponível',
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                if (presentation.hasAudio)
                                  _ResourceBadgeIcon(
                                    iconKey: ValueKey(
                                      'detail_song_ind_audio_$slotNumber',
                                    ),
                                    icon: Icons.headphones_outlined,
                                    tooltip: 'Áudio disponível',
                                    color: theme.colorScheme.tertiary,
                                  ),
                                if (presentation.hasYoutube)
                                  presentation.youtubeUrl != null &&
                                          onOpenYoutube != null
                                      ? Tooltip(
                                          message: 'Abrir no YouTube',
                                          child: InkWell(
                                            key: ValueKey(
                                              'detail_song_youtube_$slotNumber',
                                            ),
                                            onTap: () => onOpenYoutube!(
                                              presentation.youtubeUrl!,
                                            ),
                                            borderRadius:
                                                BorderRadius.circular(8),
                                            child: Padding(
                                              padding: const EdgeInsets.all(4),
                                              child: Icon(
                                                Icons.smart_display_rounded,
                                                size: 18,
                                                color: Colors.red.shade400,
                                              ),
                                            ),
                                          ),
                                        )
                                      : _ResourceBadgeIcon(
                                          iconKey: ValueKey(
                                            'detail_song_ind_video_$slotNumber',
                                          ),
                                          icon: Icons.smart_display_rounded,
                                          tooltip: 'Vídeo disponível',
                                          color: Colors.red.shade400,
                                        ),
                              ],
                            ),
                          ),
                        if (onOpenSong != null) ...[
                          const SizedBox(width: 4),
                          Icon(
                            Icons.chevron_right_rounded,
                            size: 20,
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ClassificationPill extends StatelessWidget {
  final String name;
  final Color color;

  const _ClassificationPill({
    required this.name,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: color.withValues(alpha: 0.38)),
      ),
      child: Text(
        name,
        style: theme.textTheme.labelSmall?.copyWith(
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}

class _ResourceBadgeIcon extends StatelessWidget {
  final Key iconKey;
  final IconData icon;
  final String tooltip;
  final Color color;

  const _ResourceBadgeIcon({
    required this.iconKey,
    required this.icon,
    required this.tooltip,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Semantics(
        label: tooltip,
        child: Icon(icon, key: iconKey, size: 16, color: color),
      ),
    );
  }
}
