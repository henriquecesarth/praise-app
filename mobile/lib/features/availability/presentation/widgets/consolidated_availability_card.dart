import 'package:flutter/material.dart';
import '../../domain/consolidated_availability.dart';

/// Card widget rendering a single consolidated availability item.
///
/// Ensures privacy: reason is strictly omitted from presentation.
class ConsolidatedAvailabilityCard extends StatelessWidget {
  final ConsolidatedAvailabilityItem item;
  final VoidCallback? onTap;

  const ConsolidatedAvailabilityCard({
    super.key,
    required this.item,
    this.onTap,
  });

  String _getInitials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts[0].isEmpty) return '?';
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[parts.length - 1][0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final isCurrent = item.isCurrent();
    final isPast = item.isPast();

    final statusLabel = isCurrent
        ? 'Em andamento'
        : (isPast ? 'Encerrado' : 'Agendado');

    final statusColor = isCurrent
        ? Colors.amber.shade800
        : (isPast
            ? theme.colorScheme.onSurface.withValues(alpha: 0.5)
            : theme.colorScheme.primary);

    return Card(
      elevation: 0,
      margin: const EdgeInsets.symmetric(vertical: 4.0),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
          color: isCurrent
              ? Colors.amber.withValues(alpha: 0.4)
              : theme.dividerColor.withValues(alpha: 0.15),
        ),
      ),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header: Avatar, Member Name, Status Chip
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  CircleAvatar(
                    radius: 20,
                    backgroundColor: theme.colorScheme.primary
                        .withValues(alpha: isDark ? 0.25 : 0.12),
                    child: Text(
                      _getInitials(item.memberName),
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: theme.colorScheme.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          item.memberName,
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          statusLabel,
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: statusColor,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (item.allDay)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest
                            .withValues(alpha: 0.5),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        'Dia inteiro',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),

              // Period Row
              Row(
                children: [
                  Icon(
                    Icons.event_outlined,
                    size: 16,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      item.formattedPeriod,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),

              // Privacy Note
              Row(
                children: [
                  Icon(
                    Icons.lock_outline,
                    size: 14,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.45),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Motivo confidencial • Privacidade protegida',
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontSize: 11,
                      color:
                          theme.colorScheme.onSurface.withValues(alpha: 0.55),
                      fontStyle: FontStyle.italic,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
