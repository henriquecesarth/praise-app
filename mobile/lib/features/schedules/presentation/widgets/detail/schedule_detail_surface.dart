import 'package:flutter/material.dart';
import '../../../../../app/theme/app_theme.dart';

/// Shared LouvAIO-styled surface card used across Schedule Detail tabs.
class ScheduleDetailSectionCard extends StatelessWidget {
  final Widget child;
  final Key? cardKey;
  final EdgeInsetsGeometry padding;

  const ScheduleDetailSectionCard({
    super.key,
    this.cardKey,
    required this.child,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Card(
      key: cardKey,
      elevation: 0,
      margin: EdgeInsets.zero,
      color: isDark ? AppColors.darkCard : theme.colorScheme.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: theme.colorScheme.outlineVariant.withValues(
            alpha: isDark ? 0.28 : 0.45,
          ),
        ),
      ),
      child: Padding(
        padding: padding,
        child: child,
      ),
    );
  }
}

/// Standardized section heading row for Schedule Detail cards.
class ScheduleDetailCardHeading extends StatelessWidget {
  final IconData icon;
  final String title;
  final Widget? trailing;

  const ScheduleDetailCardHeading({
    super.key,
    required this.icon,
    required this.title,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(icon, size: 18, color: theme.colorScheme.primary),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            title,
            style: theme.textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        if (trailing != null) ...[
          const SizedBox(width: 8),
          trailing!,
        ],
      ],
    );
  }
}
