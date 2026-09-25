import 'package:flutter/material.dart';
import '../../domain/dashboard_schedule_summary.dart';

/// Card displaying an upcoming schedule summary on the dashboard.
class UpcomingScheduleCard extends StatelessWidget {
  final DashboardScheduleSummary schedule;
  final VoidCallback? onTap;

  const UpcomingScheduleCard({
    super.key,
    required this.schedule,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final weeksLabel = schedule.weeksUntil();

    Color? paletteColor;
    if (schedule.colorPalette != null && schedule.colorPalette!.isNotEmpty) {
      try {
        final hex = schedule.colorPalette!.replaceAll('#', '');
        if (hex.length == 6) {
          paletteColor = Color(int.parse('FF$hex', radix: 16));
        }
      } catch (_) {}
    }

    return Card(
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
          color: theme.dividerColor.withValues(alpha: isDark ? 0.3 : 0.15),
        ),
      ),
      color: theme.colorScheme.surface,
      child: InkWell(
        onTap: onTap,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Accent color strip if palette or primary is present
              Container(
                width: 6,
                color: paletteColor ?? theme.colorScheme.primary,
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header: Title & Relative Tag
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Text(
                              schedule.title,
                              style: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          if (weeksLabel.isNotEmpty) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                                vertical: 3,
                              ),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.primary.withValues(
                                  alpha: isDark ? 0.2 : 0.1,
                                ),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Text(
                                weeksLabel,
                                style: theme.textTheme.labelSmall?.copyWith(
                                  fontWeight: FontWeight.bold,
                                  color: theme.colorScheme.primary,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 8),

                      // Date & Time
                      Row(
                        children: [
                          Icon(
                            Icons.schedule_outlined,
                            size: 16,
                            color: theme.colorScheme.onSurface.withValues(
                              alpha: 0.7,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            schedule.formattedDateTime,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface.withValues(
                                alpha: 0.8,
                              ),
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),

                      // Stats Chips Row
                      Wrap(
                        spacing: 8,
                        runSpacing: 6,
                        children: [
                          _buildChip(
                            context,
                            icon: Icons.group_outlined,
                            label:
                                '${schedule.totalParticipants} integrante${schedule.totalParticipants != 1 ? 's' : ''}',
                          ),
                          if (schedule.confirmedCount > 0)
                            _buildChip(
                              context,
                              icon: Icons.check_circle_outline,
                              label:
                                  '${schedule.confirmedCount} confirmado${schedule.confirmedCount != 1 ? 's' : ''}',
                              color: Colors.green.shade700,
                            ),
                          if (schedule.songsCount > 0)
                            _buildChip(
                              context,
                              icon: Icons.music_note_outlined,
                              label:
                                  '${schedule.songsCount} música${schedule.songsCount != 1 ? 's' : ''}',
                              color: Colors.purple.shade600,
                            ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              // Trailing arrow affordance
              Padding(
                padding: const EdgeInsets.only(right: 12.0),
                child: Center(
                  child: Icon(
                    Icons.chevron_right,
                    size: 24,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildChip(
    BuildContext context, {
    required IconData icon,
    required String label,
    Color? color,
  }) {
    final theme = Theme.of(context);
    final effectiveColor =
        color ?? theme.colorScheme.onSurface.withValues(alpha: 0.7);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: effectiveColor.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: effectiveColor),
          const SizedBox(width: 4),
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              color: effectiveColor,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}
