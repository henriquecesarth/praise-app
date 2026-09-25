import 'package:flutter/material.dart';
import '../../domain/schedule.dart';

/// Card widget for a single schedule in the list view.
class ScheduleCard extends StatelessWidget {
  final ScheduleSummary schedule;
  final VoidCallback onTap;

  const ScheduleCard({
    super.key,
    required this.schedule,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    final confirmed = schedule.confirmedCount;
    final total = schedule.totalParticipants;
    final relative = schedule.weeksUntil();
    final isUpcoming = schedule.isUpcoming();

    return Card(
      elevation: 0,
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: colorScheme.outlineVariant.withValues(alpha: 0.4),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            children: [
              // Date badge
              _DateBadge(
                date: schedule.formattedDate,
                time: schedule.formattedTime,
                isUpcoming: isUpcoming,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      schedule.title,
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (relative.isNotEmpty) ...[
                      const SizedBox(height: 3),
                      Text(
                        relative,
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: isUpcoming
                              ? colorScheme.primary
                              : colorScheme.onSurface.withValues(alpha: 0.6),
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                    if (total > 0) ...[
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(
                            Icons.people_outline,
                            size: 13,
                            color:
                                colorScheme.onSurface.withValues(alpha: 0.55),
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '$confirmed/$total confirmados',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color:
                                  colorScheme.onSurface.withValues(alpha: 0.65),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              Icon(
                Icons.chevron_right,
                color: colorScheme.onSurface.withValues(alpha: 0.35),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DateBadge extends StatelessWidget {
  final String date;
  final String time;
  final bool isUpcoming;

  const _DateBadge({
    required this.date,
    required this.time,
    required this.isUpcoming,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colorScheme = theme.colorScheme;

    return Container(
      width: 56,
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: isUpcoming
            ? colorScheme.primaryContainer.withValues(alpha: 0.6)
            : colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (date.isNotEmpty) ...[
            // Show day and month from 'DD/MM/YYYY'
            Text(
              date.length >= 5 ? date.substring(0, 5) : date,
              style: theme.textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: isUpcoming
                    ? colorScheme.onPrimaryContainer
                    : colorScheme.onSurface.withValues(alpha: 0.6),
                fontSize: 11,
              ),
              textAlign: TextAlign.center,
            ),
          ],
          if (time.isNotEmpty) ...[
            const SizedBox(height: 2),
            Text(
              time,
              style: theme.textTheme.labelSmall?.copyWith(
                color: isUpcoming
                    ? colorScheme.onPrimaryContainer.withValues(alpha: 0.8)
                    : colorScheme.onSurface.withValues(alpha: 0.5),
                fontSize: 10,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ],
      ),
    );
  }
}
