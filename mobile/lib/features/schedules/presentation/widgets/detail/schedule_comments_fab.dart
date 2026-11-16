import 'package:flutter/material.dart';
import '../../../../../app/theme/app_theme.dart';

/// Floating action button anchored at bottom-right to open schedule comments,
/// respecting SafeArea and displaying the real comment counter.
class ScheduleCommentsFab extends StatelessWidget {
  final int commentsCount;
  final VoidCallback? onPressed;

  const ScheduleCommentsFab({
    super.key,
    required this.commentsCount,
    required this.onPressed,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Tooltip(
      message: 'Comentários da escala ($commentsCount)',
      child: FloatingActionButton.extended(
        key: const ValueKey('open_schedule_chat'),
        onPressed: onPressed,
        elevation: 3,
        backgroundColor:
            isDark ? AppColors.green : theme.colorScheme.primary,
        foregroundColor: AppColors.cream,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(28),
          side: BorderSide(
            color: theme.colorScheme.primary.withValues(alpha: 0.45),
          ),
        ),
        icon: const Icon(Icons.chat_bubble_outline_rounded, size: 19),
        label: Text(
          'Comentários ($commentsCount)',
          maxLines: 1,
          softWrap: false,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
    );
  }
}
