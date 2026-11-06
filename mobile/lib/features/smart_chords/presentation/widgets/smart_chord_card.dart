import 'package:flutter/material.dart';
import '../../domain/smart_chord.dart';

class SmartChordCard extends StatelessWidget {
  final SmartChord chord;
  final VoidCallback onTap;

  const SmartChordCard({
    super.key,
    required this.chord,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final hasArtist = chord.artistName != null && chord.artistName!.trim().isNotEmpty;
    final hasSongTitle = chord.songTitle != null && chord.songTitle!.trim().isNotEmpty;
    final hasCapo = chord.capo != null && chord.capo! > 0;

    String? subtitleText;
    if (hasArtist) {
      subtitleText = chord.artistName!.trim();
    } else if (hasSongTitle) {
      subtitleText = chord.songTitle!.trim();
    }

    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: theme.dividerColor.withValues(alpha: 0.2),
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                decoration: BoxDecoration(
                  color: theme.colorScheme.primaryContainer.withValues(alpha: 0.5),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  chord.originalKey,
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: theme.colorScheme.primary,
                  ),
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      chord.title,
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (subtitleText != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        subtitleText,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                    if ((hasArtist && hasSongTitle) || hasCapo) ...[
                      const SizedBox(height: 4),
                      Wrap(
                        spacing: 8,
                        runSpacing: 4,
                        children: [
                          if (hasArtist && hasSongTitle)
                            Text(
                              'Repertório: ${chord.songTitle!.trim()}',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.secondary,
                                fontWeight: FontWeight.w600,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          if (hasCapo)
                            Text(
                              'Capo ${chord.capo}ª',
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                Icons.chevron_right,
                size: 20,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
