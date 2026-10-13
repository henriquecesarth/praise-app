import 'package:flutter/material.dart';
import '../../domain/liturgy.dart';

/// Tile component for displaying a liturgy item within a liturgy detail or form.
class LiturgyItemTile extends StatelessWidget {
  final LiturgyItem item;
  final int index;
  final VoidCallback? onTap;
  final VoidCallback? onDelete;
  final VoidCallback? onEdit;
  final bool showReorderHandle;

  const LiturgyItemTile({
    super.key,
    required this.item,
    required this.index,
    this.onTap,
    this.onDelete,
    this.onEdit,
    this.showReorderHandle = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isSong = item.type == LiturgyItemType.song;
    final hasSongLink = isSong && item.songId != null;

    IconData typeIcon;
    Color iconColor;
    switch (item.type) {
      case LiturgyItemType.song:
        typeIcon = Icons.music_note;
        iconColor = theme.colorScheme.primary;
        break;
      case LiturgyItemType.reading:
        typeIcon = Icons.menu_book;
        iconColor = theme.colorScheme.tertiary;
        break;
      case LiturgyItemType.prayer:
        typeIcon = Icons.volunteer_activism;
        iconColor = theme.colorScheme.secondary;
        break;
      case LiturgyItemType.custom:
        typeIcon = Icons.label_outline;
        iconColor = theme.colorScheme.outline;
        break;
    }

    final subtitleParts = <String>[];
    subtitleParts.add(item.type.label);
    if (isSong && item.song != null) {
      if (item.song!.artistName != null && item.song!.artistName!.isNotEmpty) {
        subtitleParts.add(item.song!.artistName!);
      }
      if (item.song!.displayKey != null) {
        subtitleParts.add('Tom: ${item.song!.displayKey}');
      }
    }

    return Card(
      key: ValueKey('liturgy_item_${item.id.isNotEmpty ? item.id : index}'),
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(
          color: theme.dividerColor.withValues(alpha: 0.15),
        ),
      ),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
          child: Row(
            children: [
              // Position number badge
              Container(
                width: 28,
                height: 28,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: theme.colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '${index + 1}',
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
              const SizedBox(width: 12),

              // Item Type Icon
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: iconColor.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                alignment: Alignment.center,
                child: Icon(typeIcon, size: 18, color: iconColor),
              ),
              const SizedBox(width: 12),

              // Title, Subtitle, Notes
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.title,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitleParts.join(' • '),
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                      ),
                    ),
                    if (item.notes != null && item.notes!.trim().isNotEmpty) ...[
                      const SizedBox(height: 4),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.comment_outlined,
                            size: 13,
                            color: theme.colorScheme.primary.withValues(alpha: 0.8),
                          ),
                          const SizedBox(width: 4),
                          Expanded(
                            child: Text(
                              item.notes!.trim(),
                              style: theme.textTheme.bodySmall?.copyWith(
                                fontStyle: FontStyle.italic,
                                color: theme.colorScheme.onSurface.withValues(alpha: 0.75),
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),

              // Trailing action
              if (hasSongLink && onTap != null && !showReorderHandle && onDelete == null) ...[
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primary.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.music_note,
                        size: 14,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'Cifra',
                        style: theme.textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 4),
                Icon(
                  Icons.chevron_right,
                  size: 20,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                ),
              ] else if (onDelete != null) ...[
                IconButton(
                  icon: Icon(
                    Icons.delete_outline,
                    color: theme.colorScheme.error,
                    size: 20,
                  ),
                  tooltip: 'Remover item',
                  onPressed: onDelete,
                ),
              ],
              if (showReorderHandle) ...[
                Icon(
                  Icons.drag_handle,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
