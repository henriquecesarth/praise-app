import 'package:flutter/material.dart';
import '../../../../../core/utils/date_utils.dart';
import '../../../domain/schedule.dart';
import '../../../domain/schedule_actions.dart';
import '../../../domain/schedule_participant.dart';
import '../../../domain/song_timeline.dart';
import 'schedule_detail_header.dart';
import 'schedule_detail_surface.dart';
import 'schedule_detail_tabs.dart';

/// Detalhes tab inside Schedule Detail:
/// confirmation controls, quick actions (Share & Google Calendar),
/// confirmed summary card, roteiro summary card, dress code, notes, and history.
class ScheduleDetailsTabView extends StatelessWidget {
  final ScheduleDetail schedule;
  final bool isConfirming;
  final String? confirmationError;
  final String? currentUserId;
  final String? currentUserName;
  final ValueChanged<bool> onConfirm;
  final VoidCallback onClearConfirmationError;
  final VoidCallback onShare;
  final VoidCallback? onOpenGoogleCalendar;
  final ValueChanged<ScheduleDetailSectionTab> onNavigateTab;

  const ScheduleDetailsTabView({
    super.key,
    required this.schedule,
    required this.isConfirming,
    required this.confirmationError,
    required this.currentUserId,
    required this.currentUserName,
    required this.onConfirm,
    required this.onClearConfirmationError,
    required this.onShare,
    required this.onOpenGoogleCalendar,
    required this.onNavigateTab,
  });

  ScheduleParticipant? _findMyParticipant() {
    final userId = currentUserId?.trim();
    if (userId == null || userId.isEmpty) return null;
    final normalizedName = currentUserName?.trim().toLowerCase() ?? '';
    for (final p in schedule.participants) {
      if (p.userId == userId ||
          p.id == userId ||
          (p.userId == null &&
              normalizedName.isNotEmpty &&
              p.name.trim().toLowerCase() == normalizedName)) {
        return p;
      }
    }
    return null;
  }

  String _initialsFor(String name) {
    final parts = name
        .trim()
        .split(RegExp(r'\s+'))
        .where((s) => s.isNotEmpty)
        .toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first[0].toUpperCase();
    return '${parts.first[0]}${parts.last[0]}'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final myParticipant = _findMyParticipant();
    final isAuthenticatedUser =
        currentUserId != null && currentUserId!.trim().isNotEmpty;
    final isExplicitlyUnscheduledUser =
        isAuthenticatedUser && myParticipant == null;
    final calendarUri = buildGoogleCalendarEventUri(schedule);

    final confirmedCount = schedule.confirmedCount;
    final declinedCount =
        schedule.participants.where((p) => p.confirmed == false).length;
    final pendingCount =
        schedule.participants.where((p) => p.confirmed == null).length;
    final totalCount = schedule.totalParticipants;
    final confirmedRatio = totalCount > 0 ? confirmedCount / totalCount : 0.0;

    return SingleChildScrollView(
      key: const ValueKey('schedule_details_scroll'),
      padding: EdgeInsets.fromLTRB(
        12,
        4,
        12,
        100 + MediaQuery.paddingOf(context).bottom,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _ConfirmationCard(
            schedule: schedule,
            myParticipant: myParticipant,
            isExplicitlyUnscheduledUser: isExplicitlyUnscheduledUser,
            isConfirming: isConfirming,
            error: confirmationError,
            onConfirm: onConfirm,
            onClearError: onClearConfirmationError,
          ),
          const SizedBox(height: 12),

          // Quick actions row: Share + Google Calendar
          LayoutBuilder(
            builder: (context, constraints) {
              final hasCalendar =
                  calendarUri != null && onOpenGoogleCalendar != null;
              final sideBySide = hasCalendar && constraints.maxWidth >= 330;

              final shareButton = SizedBox(
                height: 44,
                child: OutlinedButton.icon(
                  key: const ValueKey('schedule_share_button'),
                  onPressed: onShare,
                  icon: const Icon(Icons.share_outlined, size: 18),
                  label: const Text(
                    'Compartilhar',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              );

              final calendarButton = hasCalendar
                  ? SizedBox(
                      height: 44,
                      child: OutlinedButton.icon(
                        key: const ValueKey('schedule_google_calendar_button'),
                        onPressed: onOpenGoogleCalendar,
                        icon: const Icon(Icons.event_outlined, size: 18),
                        label: const Text(
                          'Google Agenda',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    )
                  : null;

              if (sideBySide) {
                return Row(
                  children: [
                    Expanded(child: shareButton),
                    const SizedBox(width: 8),
                    Expanded(child: calendarButton!),
                  ],
                );
              }
              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  shareButton,
                  if (calendarButton != null) ...[
                    const SizedBox(height: 8),
                    calendarButton,
                  ],
                ],
              );
            },
          ),
          const SizedBox(height: 12),

          // Confirmados card (e.g. "4 de 7")
          ScheduleDetailSectionCard(
            cardKey: const ValueKey('schedule_details_confirmed_card'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ScheduleDetailCardHeading(
                  icon: Icons.people_outline_rounded,
                  title: 'Confirmados',
                  trailing: Text(
                    '$confirmedCount de $totalCount',
                    key: const ValueKey('schedule_details_confirmed_ratio'),
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: LinearProgressIndicator(
                    value: confirmedRatio,
                    minHeight: 7,
                    backgroundColor: theme.colorScheme.surfaceContainerHighest,
                  ),
                ),
                const SizedBox(height: 10),
                if (totalCount == 0)
                  Text(
                    'Nenhum participante escalado até o momento.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else ...[
                  Wrap(
                    spacing: 10,
                    runSpacing: 6,
                    children: [
                      _StatusDotLabel(
                        color: Colors.green.shade500,
                        label: '$confirmedCount confirmados',
                      ),
                      _StatusDotLabel(
                        color: theme.colorScheme.outline,
                        label: '$pendingCount pendentes',
                      ),
                      if (declinedCount > 0)
                        _StatusDotLabel(
                          color: theme.colorScheme.error,
                          label: '$declinedCount recusados',
                        ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          children: [
                            for (final p in schedule.participants.take(5))
                              Tooltip(
                                message: p.name,
                                child: CircleAvatar(
                                  radius: 15,
                                  backgroundColor: p.confirmed == true
                                      ? Colors.green.withValues(alpha: 0.2)
                                      : theme.colorScheme.surfaceContainerHighest,
                                  child: Text(
                                    _initialsFor(p.name),
                                    style: theme.textTheme.labelSmall?.copyWith(
                                      fontWeight: FontWeight.w700,
                                      color: p.confirmed == true
                                          ? Colors.green.shade400
                                          : theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ),
                              ),
                            if (totalCount > 5)
                              CircleAvatar(
                                radius: 15,
                                backgroundColor:
                                    theme.colorScheme.primaryContainer,
                                child: Text(
                                  '+${totalCount - 5}',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    color:
                                        theme.colorScheme.onPrimaryContainer,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                      TextButton(
                        onPressed: () =>
                            onNavigateTab(ScheduleDetailSectionTab.participants),
                        child: const Text('Ver todos'),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Roteiro summary card
          ScheduleDetailSectionCard(
            cardKey: const ValueKey('schedule_details_order_summary_card'),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                ScheduleDetailCardHeading(
                  icon: Icons.format_list_numbered_rounded,
                  title: 'Roteiro',
                  trailing: Text(
                    '${schedule.timeline.length} ${schedule.timeline.length == 1 ? 'item' : 'itens'}',
                    style: theme.textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                ),
                const SizedBox(height: 10),
                if (schedule.timeline.isEmpty)
                  Text(
                    'Nenhum momento no roteiro desta escala.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  )
                else ...[
                  for (var i = 0; i < schedule.timeline.length && i < 3; i++)
                    Builder(
                      builder: (_) {
                        final item = schedule.timeline[i];
                        final songSlot = isSongSlot(item)
                            ? schedule.timeline.take(i).where(isSongSlot).length
                            : -1;
                        final resolved = songSlot >= 0
                            ? resolveTimelineSong(
                                item,
                                songSlot,
                                schedule.songs,
                              )
                            : null;
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 3),
                          child: Row(
                            children: [
                              Container(
                                width: 22,
                                height: 22,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  color: theme.colorScheme.primaryContainer
                                      .withValues(alpha: 0.65),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: Text(
                                  '${i + 1}',
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    color:
                                        theme.colorScheme.onPrimaryContainer,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  resolved?.title ?? item.title,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: theme.textTheme.bodyMedium,
                                ),
                              ),
                              if (item.time?.isNotEmpty == true) ...[
                                const SizedBox(width: 8),
                                Text(
                                  item.time!,
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        );
                      },
                    ),
                  const SizedBox(height: 6),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      onPressed: () =>
                          onNavigateTab(ScheduleDetailSectionTab.order),
                      icon: const Icon(Icons.arrow_forward_rounded, size: 16),
                      label: const Text('Ver roteiro completo'),
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),

          // Clothing & Color Palette
          _ClothingCard(
            pieces: schedule.clothingPieces,
            palette: schedule.colorPalette,
          ),

          // Notes
          if (schedule.notes != null && schedule.notes!.trim().isNotEmpty) ...[
            const SizedBox(height: 12),
            ScheduleDetailSectionCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const ScheduleDetailCardHeading(
                    icon: Icons.notes_outlined,
                    title: 'Observações',
                  ),
                  const SizedBox(height: 8),
                  Text(
                    schedule.notes!.trim(),
                    style: theme.textTheme.bodyMedium?.copyWith(height: 1.45),
                  ),
                ],
              ),
            ),
          ],
          const SizedBox(height: 12),

          // History card (real createdAt / updatedAt timestamps only)
          _HistoryCard(schedule: schedule),
        ],
      ),
    );
  }
}

class _ConfirmationCard extends StatelessWidget {
  final ScheduleDetail schedule;
  final ScheduleParticipant? myParticipant;
  final bool isExplicitlyUnscheduledUser;
  final bool isConfirming;
  final String? error;
  final ValueChanged<bool> onConfirm;
  final VoidCallback onClearError;

  const _ConfirmationCard({
    required this.schedule,
    required this.myParticipant,
    required this.isExplicitlyUnscheduledUser,
    required this.isConfirming,
    required this.error,
    required this.onConfirm,
    required this.onClearError,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (!schedule.isUpcoming()) {
      return ScheduleDetailSectionCard(
        child: Row(
          children: [
            Icon(
              Icons.history_outlined,
              size: 18,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Escala encerrada — confirmação não disponível.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          ],
        ),
      );
    }

    return ScheduleDetailSectionCard(
      cardKey: const ValueKey('schedule_details_confirmation_card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            runSpacing: 6,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    Icons.how_to_reg_outlined,
                    size: 18,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      'Confirmação de Presença',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
              if (myParticipant != null)
                Container(
                  key: const ValueKey('my_confirmation_status_badge'),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: myParticipant!.confirmed == true
                        ? Colors.green.withValues(alpha: 0.16)
                        : myParticipant!.confirmed == false
                            ? theme.colorScheme.errorContainer
                            : theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    myParticipant!.confirmed == true
                        ? 'Confirmado'
                        : myParticipant!.confirmed == false
                            ? 'Recusado'
                            : 'Pendente',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: myParticipant!.confirmed == true
                          ? Colors.green.shade400
                          : myParticipant!.confirmed == false
                              ? theme.colorScheme.onErrorContainer
                              : theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          if (error != null) ...[
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: theme.colorScheme.errorContainer.withValues(alpha: 0.6),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.warning_amber_outlined,
                    size: 16,
                    color: theme.colorScheme.error,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      error!,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.error,
                      ),
                    ),
                  ),
                  IconButton(
                    constraints: const BoxConstraints(
                      minWidth: 32,
                      minHeight: 32,
                    ),
                    padding: EdgeInsets.zero,
                    icon: Icon(
                      Icons.close,
                      size: 16,
                      color: theme.colorScheme.error,
                    ),
                    onPressed: onClearError,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
          if (isExplicitlyUnscheduledUser)
            Text(
              'Você não está escalado nesta escala.',
              key: const ValueKey('not_scheduled_participant_notice'),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
                fontStyle: FontStyle.italic,
              ),
            )
          else
            Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 44,
                    child: OutlinedButton.icon(
                      onPressed: isConfirming ? null : () => onConfirm(false),
                      icon: const Icon(Icons.cancel_outlined, size: 17),
                      label: const Text(
                        'Não vou',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        foregroundColor: theme.colorScheme.error,
                        side: BorderSide(
                          color: theme.colorScheme.error.withValues(alpha: 0.5),
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: SizedBox(
                    height: 44,
                    child: FilledButton.icon(
                      onPressed: isConfirming ? null : () => onConfirm(true),
                      icon: isConfirming
                          ? const SizedBox(
                              width: 14,
                              height: 14,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.check_circle_outline, size: 17),
                      label: Text(
                        isConfirming ? 'Confirmando...' : 'Confirmar',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _StatusDotLabel extends StatelessWidget {
  final Color color;
  final String label;

  const _StatusDotLabel({
    required this.color,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 5),
        Text(
          label,
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
      ],
    );
  }
}

class _ColorSwatch extends StatelessWidget {
  final Color color;
  final Key? swatchKey;

  const _ColorSwatch(this.color, {this.swatchKey});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Cor da equipe',
      child: Container(
        key: swatchKey,
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: Theme.of(context).colorScheme.outline),
        ),
      ),
    );
  }
}

class _ClothingCard extends StatelessWidget {
  final List<ScheduleClothingPiece> pieces;
  final String? palette;

  const _ClothingCard({
    required this.pieces,
    this.palette,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final color = parseScheduleColor(palette);
    final legacyLabel = palette?.trim();

    return ScheduleDetailSectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ScheduleDetailCardHeading(
            icon: Icons.checkroom_outlined,
            title: 'Vestimenta',
          ),
          const SizedBox(height: 12),
          if (color != null)
            Row(
              children: [
                _ColorSwatch(
                  color,
                  swatchKey: const ValueKey('schedule_palette_swatch'),
                ),
                const SizedBox(width: 12),
                const Expanded(child: Text('Cor da equipe')),
              ],
            )
          else if (legacyLabel != null &&
              legacyLabel.isNotEmpty &&
              !legacyLabel.startsWith('#'))
            Text(legacyLabel, style: theme.textTheme.bodyMedium)
          else
            Text(
              'Cor da equipe não definida',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          for (final piece in pieces) ...[
            const SizedBox(height: 12),
            Text(
              piece.description.isEmpty ? piece.name : piece.description,
              style: theme.textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final value in piece.colors.isNotEmpty
                    ? piece.colors
                    : [if (piece.colorHex != null) piece.colorHex!])
                  if (parseScheduleColor(value) case final Color parsed)
                    _ColorSwatch(parsed),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  final ScheduleDetail schedule;

  const _HistoryCard({required this.schedule});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final created = AppDateUtils.formatTimestampPtBR(schedule.createdAt);
    final updated = AppDateUtils.formatTimestampPtBR(schedule.updatedAt);
    final hasAny = created.isNotEmpty || updated.isNotEmpty;
    final updatedDiffers =
        updated.isNotEmpty && updated != created;

    return ScheduleDetailSectionCard(
      cardKey: const ValueKey('schedule_details_history_card'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const ScheduleDetailCardHeading(
            icon: Icons.history_rounded,
            title: 'Histórico de alterações',
          ),
          const SizedBox(height: 10),
          if (!hasAny)
            Text(
              'Nenhuma alteração registrada ainda.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            )
          else ...[
            if (created.isNotEmpty)
              _HistoryRow(
                icon: Icons.add_circle_outline_rounded,
                label: 'Escala criada em $created',
              ),
            if (updatedDiffers) ...[
              const SizedBox(height: 6),
              _HistoryRow(
                icon: Icons.edit_calendar_outlined,
                label: 'Última atualização em $updated',
              ),
            ],
          ],
        ],
      ),
    );
  }
}

class _HistoryRow extends StatelessWidget {
  final IconData icon;
  final String label;

  const _HistoryRow({
    required this.icon,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      children: [
        Icon(icon, size: 15, color: theme.colorScheme.onSurfaceVariant),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            label,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ),
      ],
    );
  }
}
