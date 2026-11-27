import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../repertoire/presentation/views/song_detail_view.dart';
import '../../domain/schedule.dart';
import '../../domain/song_timeline.dart';
import 'schedule_chat_view.dart';
import '../../domain/schedule_participant.dart';
import 'schedule_form_screen.dart';

/// Full schedule detail screen.
///
/// State is keyed by [ministryId] + [scheduleId].
/// Contains: title, date/time, duration, notes, participants,
/// songs/timeline/clothing (when present), confirmation section, comments,
/// and admin edit/delete controls.
class ScheduleDetailView extends ConsumerStatefulWidget {
  final String ministryId;
  final String scheduleId;
  final String? initialTitle;

  const ScheduleDetailView({
    super.key,
    required this.ministryId,
    required this.scheduleId,
    this.initialTitle,
  });

  @override
  ConsumerState<ScheduleDetailView> createState() => _ScheduleDetailViewState();
}

class _ScheduleDetailViewState extends ConsumerState<ScheduleDetailView> {

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
    });
  }

  void _load() {
    ref
        .read(scheduleDetailNotifierProvider.notifier)
        .load(widget.ministryId, widget.scheduleId);
    ref
        .read(commentsNotifierProvider.notifier)
        .load(widget.ministryId, widget.scheduleId);
  }

  Future<void> _confirmAndDeleteSchedule(
    ScheduleDetail schedule,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir escala?'),
        content: Text(
          'Tem certeza que deseja excluir a escala "${schedule.title}"? Esta ação não pode ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const ValueKey('confirm_delete_schedule_button'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    final deleted = await ref
        .read(scheduleDetailNotifierProvider.notifier)
        .deleteSchedule(widget.ministryId, widget.scheduleId);

    if (!mounted) return;

    if (deleted) {
      ref.read(scheduleListNotifierProvider.notifier).refresh();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Escala "${schedule.title}" excluída com sucesso.'),
        ),
      );
      Navigator.of(context).maybePop();
    } else {
      final err = ref.read(scheduleDetailNotifierProvider).deleteError ??
          'Não foi possível excluir a escala.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    // Safely pop detail screen if ministry switches away from widget.ministryId
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null && newMinistryId != widget.ministryId) {
        if (mounted) {
          Navigator.of(context).maybePop();
        }
      }
    });

    final detailState = ref.watch(scheduleDetailNotifierProvider);
    final commentsState = ref.watch(commentsNotifierProvider);

    // Trigger reload if the state doesn't belong to this screen's key
    final stateKey = '${detailState.ministryId}:${detailState.scheduleId}';
    final myKey = '${widget.ministryId}:${widget.scheduleId}';
    if (stateKey != myKey) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }

    final isMatchingKey = detailState.ministryId == widget.ministryId &&
        detailState.scheduleId == widget.scheduleId;

    Widget body;

    if (!isMatchingKey ||
        (detailState.isLoading && detailState.schedule == null)) {
      body = const Center(child: CircularProgressIndicator());
    } else if (detailState.error != null && detailState.schedule == null) {
      body = _DetailError(
        message: detailState.error!,
        onRetry: () => ref
            .read(scheduleDetailNotifierProvider.notifier)
            .load(widget.ministryId, widget.scheduleId),
        onBack: () => Navigator.of(context).maybePop(),
      );
    } else if (detailState.schedule != null && isMatchingKey) {
      body = _DetailContent(
        schedule: detailState.schedule!,
        ministryId: widget.ministryId,
        scheduleId: widget.scheduleId,
        isConfirming: detailState.isConfirming,
        confirmationError: detailState.confirmationError,
      );
    } else {
      body = const Center(child: CircularProgressIndicator());
    }

    final ministryContext = ref.watch(ministryContextNotifierProvider);
    final activeMinistry = ministryContext.selectedMinistry;
    final isMatchingTenant =
        activeMinistry != null && activeMinistry.id == widget.ministryId;
    final isAdmin = isMatchingTenant && activeMinistry.isAdmin;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          (isMatchingKey ? detailState.schedule?.title : null) ??
              widget.initialTitle ??
              'Detalhes da Escala',
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          IconButton(
            key: const ValueKey('open_schedule_chat'),
            tooltip: 'Chat da Escala',
            icon: Badge(
              isLabelVisible: commentsState.ministryId == widget.ministryId &&
                  commentsState.scheduleId == widget.scheduleId && commentsState.comments.isNotEmpty,
              label: Text('${commentsState.comments.length}'),
              child: const Icon(Icons.chat_bubble_outline)),
            onPressed: !isMatchingTenant ? null : () async {
              final userId = ref.read(authNotifierProvider).user?.id;
              if (userId == null || userId.isEmpty) return;
              await Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => ScheduleChatView(ministryId: widget.ministryId,
                  scheduleId: widget.scheduleId, userId: userId)));
              if (!mounted || ref.read(authNotifierProvider).user?.id != userId ||
                  ref.read(ministryContextNotifierProvider).selectedMinistry?.id != widget.ministryId) {
                return;
              }
              ref.read(commentsNotifierProvider.notifier).load(widget.ministryId, widget.scheduleId);
            },
          ),
          if (isAdmin && detailState.schedule != null) ...[
            IconButton(
              key: const ValueKey('edit_schedule_button'),
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Editar escala',
              onPressed: () {
                Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => ScheduleFormScreen(
                      ministryId: widget.ministryId,
                      initialSchedule: detailState.schedule,
                    ),
                  ),
                );
              },
            ),
            IconButton(
              key: const ValueKey('delete_schedule_button'),
              icon: detailState.isDeleting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(
                      Icons.delete_outline,
                      color: Theme.of(context).colorScheme.error,
                    ),
              tooltip: 'Excluir escala',
              onPressed: detailState.isDeleting
                  ? null
                  : () => _confirmAndDeleteSchedule(
                        detailState.schedule!,
                      ),
            ),
          ],
        ],
      ),
      body: SafeArea(bottom: false, child: body),
    );
  }
}

// ─── Detail Content ───────────────────────────────────────────────────────────

class _DetailContent extends ConsumerWidget {
  final ScheduleDetail schedule;
  final String ministryId;
  final String scheduleId;
  final bool isConfirming;
  final String? confirmationError;
  const _DetailContent({required this.schedule, required this.ministryId,
    required this.scheduleId, required this.isConfirming, this.confirmationError});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Center(child: ConstrainedBox(
      constraints: const BoxConstraints(maxWidth: 760),
      child: SingleChildScrollView(
        key: const ValueKey('schedule_detail_sections'),
        padding: const EdgeInsets.all(12),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          _InfoSection(schedule: schedule),
          const SizedBox(height: 16),
          _SongsSection(songs: schedule.songs, ministryId: ministryId),
          const SizedBox(height: 16),
          _TimelineSection(items: schedule.timeline, songs: schedule.songs, ministryId: ministryId),
          const SizedBox(height: 16),
          _ParticipantsSection(participants: schedule.participants),
          const SizedBox(height: 16),
          _ConfirmationSection(schedule: schedule, ministryId: ministryId,
            scheduleId: scheduleId, isConfirming: isConfirming, error: confirmationError),
          const SizedBox(height: 16),
          _ClothingSection(pieces: schedule.clothingPieces, palette: schedule.colorPalette),
          if (schedule.notes?.isNotEmpty == true) ...[
            const SizedBox(height: 16), _NotesSection(notes: schedule.notes!),
          ],
        ]),
      ),
    ));
  }
}

// ─── Section Card helper ──────────────────────────────────────────────────────

class _SectionCard extends StatelessWidget {
  final Widget child;
  const _SectionCard({required this.child});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: BorderSide(
            color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      child: Padding(padding: const EdgeInsets.all(20), child: child),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color? color;
  const _InfoRow({required this.icon, required this.text, this.color});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (text.isEmpty) return const SizedBox.shrink();
    final c = color ?? theme.colorScheme.onSurface.withValues(alpha: 0.75);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Icon(icon, size: 15, color: c),
          const SizedBox(width: 8),
          Expanded(
              child: Text(text,
                  style: theme.textTheme.bodyMedium?.copyWith(color: c))),
        ],
      ),
    );
  }
}

// ─── Info Section ─────────────────────────────────────────────────────────────

class _InfoSection extends StatelessWidget {
  final ScheduleDetail schedule;
  const _InfoSection({required this.schedule});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final dressCount = schedule.clothingPieces.length +
        ((schedule.colorPalette != null &&
                schedule.colorPalette!.trim().isNotEmpty &&
                schedule.clothingPieces.isEmpty)
            ? 1
            : 0);

    return Card(
      key: const ValueKey('schedule_detail_hero'),
      elevation: 0,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(
            color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(
            key: const ValueKey('schedule_detail_accent_bar'),
            height: 8,
            color: parseScheduleColor(schedule.colorPalette) ?? theme.colorScheme.secondary,
          ),
          Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(schedule.title,
              style: theme.textTheme.headlineSmall
                  ?.copyWith(fontWeight: FontWeight.w800)),
          if (!schedule.isVisible || schedule.requireConfirmation) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 4,
              children: [
                if (!schedule.isVisible)
                  Container(
                    key: const ValueKey('schedule_private_badge'),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.secondaryContainer,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.visibility_off_outlined,
                          size: 13,
                          color: theme.colorScheme.onSecondaryContainer,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            'Privado (apenas admins)',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.labelSmall?.copyWith(
                              color: theme.colorScheme.onSecondaryContainer,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (schedule.requireConfirmation)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primaryContainer
                          .withValues(alpha: 0.6),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      'Confirmação solicitada',
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onPrimaryContainer,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 12),
          _InfoRow(
              icon: Icons.calendar_today_outlined,
              text: schedule.formattedDate),
          if (schedule.time.isNotEmpty)
            _InfoRow(
                icon: Icons.access_time_outlined, text: schedule.formattedTime),
          if (schedule.formattedDuration.isNotEmpty)
            _InfoRow(
                icon: Icons.timer_outlined,
                text: 'Duração: ${schedule.formattedDuration}'),
          if (schedule.isUpcoming())
            _InfoRow(
              icon: Icons.event_available_outlined,
              text: schedule.weeksUntil(),
              color: theme.colorScheme.primary,
            ),
          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 10),
          LayoutBuilder(builder: (context, constraints) {
            final width = (constraints.maxWidth - 8) / 2;
            return Wrap(key: const ValueKey('schedule_detail_stats_row'), spacing: 8, runSpacing: 8, children: [
              for (final stat in [
                ('participantes', Icons.people_outline, schedule.participants.length, 'Participantes'),
                ('musicas', Icons.music_note_outlined, schedule.songs.length, 'Músicas'),
                ('roteiro', Icons.view_timeline_outlined, schedule.timeline.length, 'Roteiro'),
                ('vestimenta', Icons.checkroom_outlined, dressCount, 'Vestimenta'),
              ]) SizedBox(width: width, child: _StatCell(
                keyName: 'schedule_detail_stat_${stat.$1}', icon: stat.$2, count: stat.$3, label: stat.$4)),
            ]);
          }),
        ],
      ),
          ),
        ],
      ),
    );
  }
}

class _StatCell extends StatelessWidget {
  final String keyName;
  final IconData icon;
  final int count;
  final String label;

  const _StatCell({
    required this.keyName,
    required this.icon,
    required this.count,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      key: ValueKey(keyName),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12)),
      child: Column(children: [
        Icon(icon, size: 22, color: theme.colorScheme.primary),
        const SizedBox(height: 6),
        Text('$count', style: theme.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800)),
        Text(label, textAlign: TextAlign.center, style: theme.textTheme.labelMedium),
      ]),
    );
  }
}

// ─── Participants Section ─────────────────────────────────────────────────────

class _ParticipantsSection extends StatelessWidget {
  final List<ScheduleParticipant> participants;
  const _ParticipantsSection({required this.participants});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final confirmed = participants.where((p) => p.confirmed == true).length;
    final total = participants.length;
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.people_outline,
                size: 18, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Participantes ($confirmed/$total confirmados)',
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ]),
          const SizedBox(height: 12),
          ...participants.map((p) => _ParticipantRow(participant: p)),
        ],
      ),
    );
  }
}

class _ParticipantRow extends StatelessWidget {
  final ScheduleParticipant participant;
  const _ParticipantRow({required this.participant});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final confirmed = participant.confirmed;
    final Color statusColor;
    final IconData statusIcon;
    if (confirmed == true) {
      statusColor = Colors.green.shade600;
      statusIcon = Icons.check_circle_outline;
    } else if (confirmed == false) {
      statusColor = theme.colorScheme.error;
      statusIcon = Icons.cancel_outlined;
    } else {
      statusColor = theme.colorScheme.onSurface.withValues(alpha: 0.4);
      statusIcon = Icons.radio_button_unchecked;
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(children: [
        Icon(statusIcon, size: 16, color: statusColor),
        const SizedBox(width: 8),
        Expanded(
            child: Text(participant.name, style: theme.textTheme.bodyMedium)),
        if (participant.role.isNotEmpty) ...[
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              participant.role,
              textAlign: TextAlign.end,
              style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.55)),
            ),
          ),
        ],
      ]),
    );
  }
}

// ─── Confirmation Section ─────────────────────────────────────────────────────

class _ConfirmationSection extends ConsumerWidget {
  final ScheduleDetail schedule;
  final String ministryId;
  final String scheduleId;
  final bool isConfirming;
  final String? error;

  const _ConfirmationSection({
    required this.schedule,
    required this.ministryId,
    required this.scheduleId,
    required this.isConfirming,
    required this.error,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    if (!schedule.isUpcoming()) {
      return _SectionCard(
        child: Row(children: [
          Icon(Icons.history_outlined,
              size: 18,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.5)),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Escala encerrada — confirmação não disponível.',
              style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.6)),
            ),
          ),
        ]),
      );
    }

    final authUser = ref.watch(authNotifierProvider).user;
    ScheduleParticipant? myParticipant;
    if (authUser != null) {
      for (final p in schedule.participants) {
        if (p.userId == authUser.id ||
            p.id == authUser.id ||
            (p.userId == null &&
                authUser.name.trim().isNotEmpty &&
                p.name.trim().toLowerCase() ==
                    authUser.name.trim().toLowerCase())) {
          myParticipant = p;
          break;
        }
      }
    }

    final isExplicitlyUnscheduledUser =
        authUser != null && myParticipant == null;

    return _SectionCard(
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
                  Icon(Icons.how_to_reg_outlined,
                      size: 18, color: theme.colorScheme.primary),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      'Confirmação de Presença',
                      style: theme.textTheme.titleSmall
                          ?.copyWith(fontWeight: FontWeight.w600),
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
                    color: myParticipant.confirmed == true
                        ? Colors.green.withValues(alpha: 0.15)
                        : myParticipant.confirmed == false
                            ? theme.colorScheme.errorContainer
                            : theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    myParticipant.confirmed == true
                        ? 'Confirmado'
                        : myParticipant.confirmed == false
                            ? 'Recusado'
                            : 'Pendente',
                    style: theme.textTheme.labelSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                      color: myParticipant.confirmed == true
                          ? Colors.green.shade700
                          : myParticipant.confirmed == false
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
              child: Row(children: [
                Icon(Icons.warning_amber_outlined,
                    size: 15, color: theme.colorScheme.error),
                const SizedBox(width: 8),
                Expanded(
                    child: Text(error!,
                        style: theme.textTheme.bodySmall
                            ?.copyWith(color: theme.colorScheme.error))),
                GestureDetector(
                  onTap: () => ref
                      .read(scheduleDetailNotifierProvider.notifier)
                      .clearConfirmationError(),
                  child: Icon(Icons.close,
                      size: 14, color: theme.colorScheme.error),
                ),
              ]),
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
            Row(children: [
              Expanded(
                child: SizedBox(
                  height: 44,
                  child: OutlinedButton.icon(
                    onPressed: isConfirming
                        ? null
                        : () => ref
                            .read(scheduleDetailNotifierProvider.notifier)
                            .confirm(ministryId, scheduleId, false),
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
                          color:
                              theme.colorScheme.error.withValues(alpha: 0.5)),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: SizedBox(
                  height: 44,
                  child: FilledButton.icon(
                    onPressed: isConfirming
                        ? null
                        : () => ref
                            .read(scheduleDetailNotifierProvider.notifier)
                            .confirm(ministryId, scheduleId, true),
                    icon: isConfirming
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: Colors.white))
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
            ]),
        ],
      ),
    );
  }
}

// ─── Songs Section ────────────────────────────────────────────────────────────

class _SongsSection extends StatelessWidget {
  final List<ScheduleSong> songs;
  final String ministryId;

  const _SongsSection({
    required this.songs,
    required this.ministryId,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.queue_music_outlined,
                size: 18, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Músicas Escaladas (${songs.length})',
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ]),
          const SizedBox(height: 10),
          ...songs.asMap().entries.map((e) {
            final idx = e.key + 1;
            final song = e.value;
            final canOpenDetail = song.id.trim().isNotEmpty;
            return InkWell(
              key: ValueKey('detail_song_row_$idx'),
              onTap: canOpenDetail
                  ? () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => SongDetailView(
                            ministryId: ministryId,
                            songId: song.id,
                            initialTitle: song.title,
                          ),
                        ),
                      );
                    }
                  : null,
              borderRadius: BorderRadius.circular(8),
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(vertical: 16, horizontal: 4),
                child: Row(children: [
                  Text('$idx.',
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.5))),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(song.title ?? '—',
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w500,
                            )),
                        if (song.artist != null && song.artist!.isNotEmpty)
                          Text(
                            song.artist!,
                            style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurface
                                    .withValues(alpha: 0.55)),
                          ),
                      ],
                    ),
                  ),
                  if (song.key != null && song.key!.trim().isNotEmpty) ...[
                    const SizedBox(width: 8),
                    Container(
                      key: ValueKey('detail_song_key_${song.id}'),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        borderRadius: BorderRadius.circular(6),
                        border: Border.all(
                            color: theme.colorScheme.outlineVariant),
                      ),
                      child: Text(
                        'Tom: ${song.key}',
                        style: theme.textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                  if (canOpenDetail) ...[
                    const SizedBox(width: 4),
                    Icon(
                      Icons.chevron_right,
                      size: 18,
                      color:
                          theme.colorScheme.onSurface.withValues(alpha: 0.45),
                    ),
                  ],
                ]),
              ),
            );
          }),
        ],
      ),
    );
  }
}

// ─── Timeline Section ─────────────────────────────────────────────────────────

class _TimelineSection extends StatelessWidget {
  final List<ScheduleTimelineItem> items;
  final List<ScheduleSong> songs;
  final String ministryId;
  const _TimelineSection({required this.items, required this.songs, required this.ministryId});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Roteiro do Culto', style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
      const SizedBox(height: 20),
      if (items.isEmpty) const Text('Nenhum momento no roteiro desta escala.'),
      for (var index = 0; index < items.length; index++)
        Builder(builder: (context) {
          final item = items[index];
          final song = isSongSlot(item) ? resolveTimelineSong(item, items.take(index).where(isSongSlot).length, songs) : null;
          return IntrinsicHeight(child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            SizedBox(width: 36, child: Column(children: [
              CircleAvatar(radius: 18, child: Text('${index + 1}')),
              if (index < items.length - 1)
                Expanded(child: Center(child: Container(width: 2, color: theme.colorScheme.outlineVariant))),
            ])),
            const SizedBox(width: 14),
            Expanded(child: InkWell(
              key: ValueKey('timeline_item_${item.id}'),
              onTap: song == null ? null : () => Navigator.of(context).push(MaterialPageRoute<void>(
                builder: (_) => SongDetailView(ministryId: ministryId, songId: song.id, initialTitle: song.title))),
              child: Padding(padding: const EdgeInsets.only(bottom: 24, top: 4),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(song?.title ?? item.title,
                    style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  Wrap(spacing: 8, runSpacing: 6, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    Chip(label: Text(const {
                      'Música': 'Louvor', 'worship': 'Louvor', 'prayer': 'Oração',
                      'word': 'Palavra', 'transition': 'Transição', 'other': 'Outro',
                    }[item.type] ?? item.type),
                      visualDensity: VisualDensity.compact),
                    if (item.time?.isNotEmpty == true) Text(item.time!),
                    if (song != null) const Icon(Icons.chevron_right, size: 20),
                  ]),
                ])),
            )),
          ]));
        }),
    ]));
  }
}

/// Existing stored hex values are rendered without changing persistence.
Color? parseScheduleColor(String? value) {
  final text = value?.trim() ?? '';
  if (!RegExp(r'^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$').hasMatch(text)) return null;
  var hex = text.replaceFirst('#', '');
  if (hex.length == 3) hex = hex.split('').map((c) => '$c$c').join();
  return Color(int.parse('FF$hex', radix: 16));
}

class _ColorSwatch extends StatelessWidget {
  final Color color;
  final Key? swatchKey;
  const _ColorSwatch(this.color, {this.swatchKey});
  @override
  Widget build(BuildContext context) => Semantics(label: 'Cor da equipe',
    child: Container(key: swatchKey, width: 48, height: 48,
      decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Theme.of(context).colorScheme.outline))));
}

class _ClothingSection extends StatelessWidget {
  final List<ScheduleClothingPiece> pieces;
  final String? palette;
  const _ClothingSection({required this.pieces, this.palette});
  @override
  Widget build(BuildContext context) {
    final color = parseScheduleColor(palette);
    final legacyLabel = palette?.trim();
    return _SectionCard(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('Vestimenta', style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 16),
      if (color != null)
        Row(children: [
          _ColorSwatch(color, swatchKey: const ValueKey('schedule_palette_swatch')),
          const SizedBox(width: 12), const Expanded(child: Text('Cor da equipe')),
        ])
      else if (legacyLabel != null && legacyLabel.isNotEmpty && !legacyLabel.startsWith('#'))
        Text(legacyLabel)
      else
        const Text('Cor da equipe não definida'),
      for (final piece in pieces) ...[
        const SizedBox(height: 16),
        Text(piece.description.isEmpty ? piece.name : piece.description),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final value in piece.colors.isNotEmpty ? piece.colors : [if (piece.colorHex != null) piece.colorHex!])
            if (parseScheduleColor(value) case final Color parsed) _ColorSwatch(parsed),
        ]),
      ],
    ]));
  }
}

// ─── Notes Section ────────────────────────────────────────────────────────────

class _NotesSection extends StatelessWidget {
  final String notes;
  const _NotesSection({required this.notes});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.notes_outlined,
                size: 18, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Observações',
                style: theme.textTheme.titleLarge
                    ?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ]),
          const SizedBox(height: 8),
          Text(notes, style: theme.textTheme.bodyMedium),
        ],
      ),
    );
  }
}

// ─── Detail error ────────────────────────────────────────────────────────────

class _DetailError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  final VoidCallback onBack;
  const _DetailError(
      {required this.message, required this.onRetry, required this.onBack});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline_rounded,
                size: 48, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text(message,
                textAlign: TextAlign.center, style: theme.textTheme.bodyMedium),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
                onPressed: onBack, child: const Text('Voltar à Lista')),
          ],
        ),
      ),
    );
  }
}
