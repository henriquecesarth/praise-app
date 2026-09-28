import 'package:flutter/material.dart';
import '../../domain/availability.dart';

/// Card displaying a single availability period with edit and delete actions.
///
/// Ensures interactive touch targets are at least 44x44px.
/// Does not expose raw database IDs to the user.
class AvailabilityCard extends StatelessWidget {
  final MemberAvailability availability;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const AvailabilityCard({
    super.key,
    required this.availability,
    required this.onEdit,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isPast = availability.isPast();
    final isCurrent = availability.isCurrent();

    return Card(
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 6.0),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: theme.dividerColor.withValues(alpha: 0.25),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Top row: Period icon + status chip + action buttons
            Row(
              children: [
                Icon(
                  availability.allDay
                      ? Icons.calendar_today_outlined
                      : Icons.access_time_outlined,
                  size: 20,
                  color: isPast
                      ? theme.colorScheme.onSurface.withValues(alpha: 0.4)
                      : theme.colorScheme.primary,
                ),
                const SizedBox(width: 8),
                _buildStatusChip(context, isPast, isCurrent),
                const Spacer(),
                // Edit button (min 44x44px target)
                SizedBox(
                  width: 44,
                  height: 44,
                  child: IconButton(
                    icon: const Icon(Icons.edit_outlined, size: 20),
                    tooltip: 'Editar',
                    onPressed: onEdit,
                  ),
                ),
                // Delete button (min 44x44px target)
                SizedBox(
                  width: 44,
                  height: 44,
                  child: IconButton(
                    icon: Icon(
                      Icons.delete_outline,
                      size: 20,
                      color: theme.colorScheme.error,
                    ),
                    tooltip: 'Remover',
                    onPressed: onDelete,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),

            // Formatted period text
            Text(
              availability.formattedPeriod,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: isPast
                    ? theme.colorScheme.onSurface.withValues(alpha: 0.6)
                    : null,
              ),
            ),

            // Optional reason
            if (availability.reason != null &&
                availability.reason!.trim().isNotEmpty) ...[
              const SizedBox(height: 6),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.notes_outlined,
                    size: 16,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      availability.reason!.trim(),
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color:
                            theme.colorScheme.onSurface.withValues(alpha: 0.75),
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildStatusChip(BuildContext context, bool isPast, bool isCurrent) {
    final theme = Theme.of(context);

    if (isPast) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color:
              theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          'Encerrada',
          style: theme.textTheme.labelSmall?.copyWith(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
            fontWeight: FontWeight.w500,
          ),
        ),
      );
    }

    if (isCurrent) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        decoration: BoxDecoration(
          color: Colors.amber.shade100,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Text(
          'Em andamento',
          style: theme.textTheme.labelSmall?.copyWith(
            color: Colors.amber.shade900,
            fontWeight: FontWeight.bold,
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: theme.colorScheme.primaryContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        'Agendada',
        style: theme.textTheme.labelSmall?.copyWith(
          color: theme.colorScheme.primary,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
