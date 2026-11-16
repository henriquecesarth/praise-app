import 'package:flutter/material.dart';
import '../../../../../app/theme/app_theme.dart';

/// Top-level sections inside the Schedule Detail screen.
enum ScheduleDetailSectionTab {
  details,
  songs,
  participants,
  order,
}

/// Segmented navigation bar for switching between Schedule Detail sections:
/// Detalhes, Músicas, Participantes, and Roteiro.
class ScheduleDetailTabBar extends StatelessWidget {
  final ScheduleDetailSectionTab selectedTab;
  final ValueChanged<ScheduleDetailSectionTab> onSelectTab;
  final int songsCount;
  final int confirmedParticipants;
  final int totalParticipants;
  final int orderItemsCount;

  const ScheduleDetailTabBar({
    super.key,
    required this.selectedTab,
    required this.onSelectTab,
    required this.songsCount,
    required this.confirmedParticipants,
    required this.totalParticipants,
    required this.orderItemsCount,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 8),
      child: Container(
        key: const ValueKey('schedule_detail_tab_bar'),
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: isDark
              ? AppColors.darkSurface
              : theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: theme.colorScheme.outlineVariant.withValues(
              alpha: isDark ? 0.3 : 0.45,
            ),
          ),
        ),
        child: Row(
          children: [
            _SegmentButton(
              buttonKey: const ValueKey('schedule_detail_tab_details'),
              icon: Icons.info_outline_rounded,
              label: 'Detalhes',
              selected: selectedTab == ScheduleDetailSectionTab.details,
              onTap: () => onSelectTab(ScheduleDetailSectionTab.details),
            ),
            _SegmentButton(
              buttonKey: const ValueKey('schedule_detail_tab_songs'),
              icon: Icons.music_note_rounded,
              label: 'Músicas',
              badge: '$songsCount',
              selected: selectedTab == ScheduleDetailSectionTab.songs,
              onTap: () => onSelectTab(ScheduleDetailSectionTab.songs),
            ),
            _SegmentButton(
              buttonKey: const ValueKey('schedule_detail_tab_participants'),
              icon: Icons.people_outline_rounded,
              label: 'Participantes',
              badge: '$confirmedParticipants/$totalParticipants',
              selected: selectedTab == ScheduleDetailSectionTab.participants,
              onTap: () => onSelectTab(ScheduleDetailSectionTab.participants),
            ),
            _SegmentButton(
              buttonKey: const ValueKey('schedule_detail_tab_order'),
              icon: Icons.format_list_numbered_rounded,
              label: 'Roteiro',
              badge: '$orderItemsCount',
              selected: selectedTab == ScheduleDetailSectionTab.order,
              onTap: () => onSelectTab(ScheduleDetailSectionTab.order),
            ),
          ],
        ),
      ),
    );
  }
}

class _SegmentButton extends StatelessWidget {
  final Key buttonKey;
  final IconData icon;
  final String label;
  final String? badge;
  final bool selected;
  final VoidCallback onTap;

  const _SegmentButton({
    required this.buttonKey,
    required this.icon,
    required this.label,
    this.badge,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final activeBg = theme.brightness == Brightness.dark
        ? AppColors.darkCard
        : theme.colorScheme.primaryContainer;
    final activeBorder = theme.colorScheme.primary.withValues(alpha: 0.45);
    final foreground = selected
        ? theme.colorScheme.primary
        : theme.colorScheme.onSurfaceVariant;

    return Expanded(
      child: Semantics(
        button: true,
        selected: selected,
        label: badge != null ? '$label ($badge)' : label,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            key: buttonKey,
            onTap: onTap,
            borderRadius: BorderRadius.circular(10),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 160),
              curve: Curves.easeOut,
              constraints: const BoxConstraints(minHeight: 54),
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
              decoration: BoxDecoration(
                color: selected ? activeBg : Colors.transparent,
                borderRadius: BorderRadius.circular(10),
                border: selected
                    ? Border.all(color: activeBorder)
                    : Border.all(color: Colors.transparent),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(icon, size: 17, color: foreground),
                      if (badge != null) ...[
                        const SizedBox(width: 4),
                        Flexible(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: selected
                                  ? theme.colorScheme.primary
                                      .withValues(alpha: 0.16)
                                  : theme.colorScheme.surfaceContainerHighest
                                      .withValues(alpha: 0.7),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              badge!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.labelSmall?.copyWith(
                                fontSize: 10.5,
                                fontWeight: FontWeight.w700,
                                color: foreground,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 3),
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    child: Text(
                      label,
                      maxLines: 1,
                      softWrap: false,
                      style: theme.textTheme.labelSmall?.copyWith(
                        fontWeight:
                            selected ? FontWeight.w700 : FontWeight.w500,
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
      ),
    );
  }
}
