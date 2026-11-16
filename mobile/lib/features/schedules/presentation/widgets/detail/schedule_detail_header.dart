import 'package:flutter/material.dart';
import '../../../../../app/theme/app_theme.dart';
import '../../../../../core/utils/date_utils.dart';
import '../../../domain/schedule.dart';

/// Parses valid hex palette strings stored on schedule documents safely.
Color? parseScheduleColor(String? value) {
  final text = value?.trim() ?? '';
  if (!RegExp(r'^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$').hasMatch(text)) {
    return null;
  }
  var hex = text.replaceFirst('#', '');
  if (hex.length == 3) {
    hex = hex.split('').map((c) => '$c$c').join();
  }
  return Color(int.parse('FF$hex', radix: 16));
}

/// Top summary panel displaying schedule title, weekday, full date, time,
/// relative indicator, and status badges inside LouvAIO's color system.
class ScheduleDetailHeader extends StatelessWidget {
  final ScheduleDetail schedule;

  const ScheduleDetailHeader({
    super.key,
    required this.schedule,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final accentColor =
        parseScheduleColor(schedule.colorPalette) ?? theme.colorScheme.secondary;
    final weekday = AppDateUtils.formatWeekdayPtBR(schedule.date);
    final fullDate = AppDateUtils.formatFullDatePtBR(schedule.date);
    final relativeLabel = AppDateUtils.formatRelativeDaysLabel(schedule.date);
    final isUpcoming = schedule.isUpcoming();
    final dateLine = [
      if (weekday.isNotEmpty) weekday,
      if (fullDate.isNotEmpty) fullDate,
    ].join(', ');

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      child: Card(
        key: const ValueKey('schedule_detail_hero'),
        elevation: 0,
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        color: isDark ? AppColors.darkSurface : theme.colorScheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(
            color: theme.colorScheme.outlineVariant.withValues(
              alpha: isDark ? 0.3 : 0.45,
            ),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              key: const ValueKey('schedule_detail_accent_bar'),
              height: 5,
              color: accentColor,
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    schedule.title,
                    key: const ValueKey('schedule_detail_header_title'),
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.2,
                      height: 1.2,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    key: const ValueKey('schedule_detail_summary_meta'),
                    spacing: 10,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (dateLine.isNotEmpty)
                        _HeaderMetaItem(
                          icon: Icons.calendar_today_outlined,
                          label: dateLine,
                        ),
                      if (schedule.formattedTime.isNotEmpty)
                        _HeaderMetaItem(
                          icon: Icons.access_time_rounded,
                          label: schedule.formattedTime,
                        ),
                      if (schedule.formattedDuration.isNotEmpty)
                        _HeaderMetaItem(
                          icon: Icons.timer_outlined,
                          label: schedule.formattedDuration,
                        ),
                      if (relativeLabel.isNotEmpty)
                        Container(
                          key: const ValueKey('schedule_detail_relative_badge'),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 9,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: isUpcoming
                                ? theme.colorScheme.primaryContainer
                                : theme.colorScheme.surfaceContainerHighest,
                            borderRadius: BorderRadius.circular(20),
                            border: isUpcoming
                                ? Border.all(
                                    color: theme.colorScheme.primary
                                        .withValues(alpha: 0.35),
                                  )
                                : null,
                          ),
                          child: Text(
                            relativeLabel,
                            maxLines: 1,
                            style: theme.textTheme.labelSmall?.copyWith(
                              fontWeight: FontWeight.w700,
                              color: isUpcoming
                                  ? theme.colorScheme.onPrimaryContainer
                                  : theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                    ],
                  ),
                  if (!schedule.isVisible || schedule.requireConfirmation) ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        if (!schedule.isVisible)
                          _HeaderStatusBadge(
                            badgeKey: const ValueKey('schedule_private_badge'),
                            icon: Icons.visibility_off_outlined,
                            label: 'Privado (apenas admins)',
                            backgroundColor:
                                theme.colorScheme.secondaryContainer,
                            foregroundColor:
                                theme.colorScheme.onSecondaryContainer,
                          ),
                        if (schedule.requireConfirmation)
                          _HeaderStatusBadge(
                            icon: Icons.how_to_reg_outlined,
                            label: 'Confirmação solicitada',
                            backgroundColor: theme.colorScheme.primaryContainer
                                .withValues(alpha: 0.55),
                            foregroundColor:
                                theme.colorScheme.onPrimaryContainer,
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _HeaderMetaItem extends StatelessWidget {
  final IconData icon;
  final String label;

  const _HeaderMetaItem({
    required this.icon,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = theme.colorScheme.onSurfaceVariant;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 14, color: theme.colorScheme.primary),
        const SizedBox(width: 5),
        Flexible(
          child: Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: color,
              fontWeight: FontWeight.w500,
            ),
          ),
        ),
      ],
    );
  }
}

class _HeaderStatusBadge extends StatelessWidget {
  final Key? badgeKey;
  final IconData icon;
  final String label;
  final Color backgroundColor;
  final Color foregroundColor;

  const _HeaderStatusBadge({
    this.badgeKey,
    required this.icon,
    required this.label,
    required this.backgroundColor,
    required this.foregroundColor,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      key: badgeKey,
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 12, color: foregroundColor),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: theme.textTheme.labelSmall?.copyWith(
                color: foregroundColor,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
