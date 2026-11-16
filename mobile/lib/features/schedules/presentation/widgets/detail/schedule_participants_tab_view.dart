import 'package:flutter/material.dart';
import '../../../../../app/theme/app_theme.dart';
import '../../../domain/schedule_participant.dart';
import 'schedule_detail_surface.dart';

enum ParticipantsViewMode {
  members,
  roles,
}

/// Participantes tab inside Schedule Detail:
/// includes segmented toggle between Membros and Funções,
/// showing avatars, names, roles, and confirmation badges.
class ScheduleParticipantsTabView extends StatefulWidget {
  final List<ScheduleParticipant> participants;

  const ScheduleParticipantsTabView({
    super.key,
    required this.participants,
  });

  @override
  State<ScheduleParticipantsTabView> createState() =>
      _ScheduleParticipantsTabViewState();
}

class _ScheduleParticipantsTabViewState
    extends State<ScheduleParticipantsTabView> {
  ParticipantsViewMode _mode = ParticipantsViewMode.members;

  String _initials(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((s) => s.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  Map<String, List<ScheduleParticipant>> _groupByRole() {
    final grouped = <String, List<ScheduleParticipant>>{};
    for (final p in widget.participants) {
      final role = p.role.trim().isNotEmpty ? p.role.trim() : 'Integrante';
      grouped.putIfAbsent(role, () => <ScheduleParticipant>[]).add(p);
    }
    return grouped;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final confirmed =
        widget.participants.where((p) => p.confirmed == true).length;
    final total = widget.participants.length;

    return SingleChildScrollView(
      key: const ValueKey('schedule_participants_scroll'),
      padding: EdgeInsets.fromLTRB(
        12,
        4,
        12,
        100 + MediaQuery.paddingOf(context).bottom,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: Text(
                    'Participantes ($confirmed/$total confirmados)',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),

          // Internal segmented toggle: Membros | Funções
          Container(
            padding: const EdgeInsets.all(4),
            decoration: BoxDecoration(
              color: isDark
                  ? AppColors.darkSurface
                  : theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.55),
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: theme.colorScheme.outlineVariant.withValues(
                  alpha: isDark ? 0.28 : 0.45,
                ),
              ),
            ),
            child: Row(
              children: [
                _TogglePill(
                  buttonKey: const ValueKey('participants_toggle_members'),
                  label: 'Membros',
                  icon: Icons.person_outline_rounded,
                  selected: _mode == ParticipantsViewMode.members,
                  onTap: () =>
                      setState(() => _mode = ParticipantsViewMode.members),
                ),
                _TogglePill(
                  buttonKey: const ValueKey('participants_toggle_roles'),
                  label: 'Funções',
                  icon: Icons.badge_outlined,
                  selected: _mode == ParticipantsViewMode.roles,
                  onTap: () =>
                      setState(() => _mode = ParticipantsViewMode.roles),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),

          if (widget.participants.isEmpty)
            ScheduleDetailSectionCard(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Column(
                  children: [
                    Icon(
                      Icons.group_off_outlined,
                      size: 36,
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                    const SizedBox(height: 10),
                    Text(
                      'Nenhum participante escalado nesta escala.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            )
          else if (_mode == ParticipantsViewMode.members) ...[
            for (var i = 0; i < widget.participants.length; i++) ...[
              if (i > 0) const SizedBox(height: 8),
              _MemberCard(
                participant: widget.participants[i],
                initials: _initials(widget.participants[i].name),
              ),
            ],
          ] else ...[
            for (final entry in _groupByRole().entries) ...[
              _RoleGroupCard(
                roleName: entry.key,
                members: entry.value,
                initialsBuilder: _initials,
              ),
              const SizedBox(height: 10),
            ],
          ],
        ],
      ),
    );
  }
}

class _TogglePill extends StatelessWidget {
  final Key buttonKey;
  final String label;
  final IconData icon;
  final bool selected;
  final VoidCallback onTap;

  const _TogglePill({
    required this.buttonKey,
    required this.label,
    required this.icon,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final activeBg = theme.brightness == Brightness.dark
        ? AppColors.darkCard
        : theme.colorScheme.primaryContainer;

    return Expanded(
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          key: buttonKey,
          onTap: onTap,
          borderRadius: BorderRadius.circular(9),
          child: Container(
            constraints: const BoxConstraints(minHeight: 40),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
            decoration: BoxDecoration(
              color: selected ? activeBg : Colors.transparent,
              borderRadius: BorderRadius.circular(9),
              border: selected
                  ? Border.all(
                      color: theme.colorScheme.primary.withValues(alpha: 0.4),
                    )
                  : null,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  icon,
                  size: 16,
                  color: selected
                      ? theme.colorScheme.primary
                      : theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color: selected
                          ? theme.colorScheme.onSurface
                          : theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _MemberCard extends StatelessWidget {
  final ScheduleParticipant participant;
  final String initials;

  const _MemberCard({
    required this.participant,
    required this.initials,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final roleLabel = participant.role.trim().isNotEmpty
        ? participant.role.trim()
        : 'Integrante';

    return ScheduleDetailSectionCard(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor:
                theme.colorScheme.primary.withValues(alpha: 0.16),
            child: Text(
              initials,
              style: theme.textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w700,
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
                  participant.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  roleLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          _ConfirmationStatusChip(confirmed: participant.confirmed),
        ],
      ),
    );
  }
}

class _RoleGroupCard extends StatelessWidget {
  final String roleName;
  final List<ScheduleParticipant> members;
  final String Function(String name) initialsBuilder;

  const _RoleGroupCard({
    required this.roleName,
    required this.members,
    required this.initialsBuilder,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return ScheduleDetailSectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ScheduleDetailCardHeading(
            icon: Icons.badge_outlined,
            title: roleName,
            trailing: Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: theme.colorScheme.primaryContainer,
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                '${members.length}',
                style: theme.textTheme.labelSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          for (var i = 0; i < members.length; i++) ...[
            if (i > 0) const Divider(height: 12),
            Row(
              children: [
                CircleAvatar(
                  radius: 15,
                  backgroundColor:
                      theme.colorScheme.primary.withValues(alpha: 0.14),
                  child: Text(
                    initialsBuilder(members[i].name),
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    members[i].name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                _ConfirmationStatusChip(confirmed: members[i].confirmed),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _ConfirmationStatusChip extends StatelessWidget {
  final bool? confirmed;

  const _ConfirmationStatusChip({required this.confirmed});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final Color color;
    final Color bgColor;
    final IconData icon;
    final String label;

    if (confirmed == true) {
      color = Colors.green.shade400;
      bgColor = Colors.green.withValues(alpha: 0.14);
      icon = Icons.check_circle_outline;
      label = 'Confirmado';
    } else if (confirmed == false) {
      color = theme.colorScheme.error;
      bgColor = theme.colorScheme.errorContainer.withValues(alpha: 0.65);
      icon = Icons.cancel_outlined;
      label = 'Recusado';
    } else {
      color = theme.colorScheme.onSurfaceVariant;
      bgColor = theme.colorScheme.surfaceContainerHighest;
      icon = Icons.schedule_rounded;
      label = 'Pendente';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: color),
          const SizedBox(width: 4),
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}
