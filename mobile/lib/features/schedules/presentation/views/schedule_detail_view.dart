import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../repertoire/presentation/views/song_detail_view.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_comment.dart';
import '../../domain/schedule_participant.dart';
import '../controllers/schedule_detail_controller.dart';
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
  final _commentController = TextEditingController();
  final _commentFocusNode = FocusNode();

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

  @override
  void dispose() {
    _commentController.dispose();
    _commentFocusNode.dispose();
    super.dispose();
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
        commentsState: commentsState,
        commentController: _commentController,
        commentFocusNode: _commentFocusNode,
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

enum _DetailTab { detalhes, musicas, participantes, roteiro }

class _DetailContent extends ConsumerStatefulWidget {
  final ScheduleDetail schedule;
  final String ministryId;
  final String scheduleId;
  final bool isConfirming;
  final String? confirmationError;
  final CommentsState commentsState;
  final TextEditingController commentController;
  final FocusNode commentFocusNode;

  const _DetailContent({
    required this.schedule,
    required this.ministryId,
    required this.scheduleId,
    required this.isConfirming,
    required this.confirmationError,
    required this.commentsState,
    required this.commentController,
    required this.commentFocusNode,
  });

  @override
  ConsumerState<_DetailContent> createState() => _DetailContentState();
}

class _DetailContentState extends ConsumerState<_DetailContent> {
  _DetailTab _tab = _DetailTab.detalhes;

  void _select(_DetailTab tab) {
    if (tab != _tab) setState(() => _tab = tab);
  }

  @override
  Widget build(BuildContext context) {
    final schedule = widget.schedule;
    final isWide = MediaQuery.sizeOf(context).width >= 600;
    final maxWidth = isWide ? 680.0 : double.infinity;
    final hasDress = schedule.clothingPieces.isNotEmpty ||
        (schedule.colorPalette != null &&
            schedule.colorPalette!.trim().isNotEmpty);

    final List<Widget> tabChildren;
    switch (_tab) {
      case _DetailTab.detalhes:
        tabChildren = [
          _ConfirmationSection(
            schedule: schedule,
            ministryId: widget.ministryId,
            scheduleId: widget.scheduleId,
            isConfirming: widget.isConfirming,
            error: widget.confirmationError,
          ),
          const SizedBox(height: 16),
          if (hasDress) ...[
            _ClothingSection(
              pieces: schedule.clothingPieces,
              palette: schedule.colorPalette,
            ),
            const SizedBox(height: 16),
          ],
          if (schedule.notes?.isNotEmpty == true) ...[
            _NotesSection(notes: schedule.notes!),
            const SizedBox(height: 16),
          ],
          _CommentsSection(
            ministryId: widget.ministryId,
            scheduleId: widget.scheduleId,
            commentsState: widget.commentsState,
          ),
        ];
        break;
      case _DetailTab.musicas:
        tabChildren = [
          if (schedule.songs.isNotEmpty)
            _SongsSection(
              songs: schedule.songs,
              ministryId: widget.ministryId,
            )
          else
            const _TabEmptyState(
              key: ValueKey('schedule_detail_empty_musicas'),
              icon: Icons.music_note_outlined,
              message: 'Nenhuma música nesta escala.',
            ),
        ];
        break;
      case _DetailTab.participantes:
        tabChildren = [
          if (schedule.participants.isNotEmpty)
            _ParticipantsSection(participants: schedule.participants)
          else
            const _TabEmptyState(
              key: ValueKey('schedule_detail_empty_participantes'),
              icon: Icons.people_outline,
              message: 'Nenhum participante nesta escala.',
            ),
        ];
        break;
      case _DetailTab.roteiro:
        tabChildren = [
          if (schedule.timeline.isNotEmpty)
            _TimelineSection(items: schedule.timeline)
          else
            const _TabEmptyState(
              key: ValueKey('schedule_detail_empty_roteiro'),
              icon: Icons.view_timeline_outlined,
              message: 'Nenhum momento no roteiro desta escala.',
            ),
        ];
        break;
    }

    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                children: [
                  _InfoSection(schedule: schedule, onSelectTab: _select),
                  const SizedBox(height: 12),
                  _DetailTabBar(selected: _tab, onSelect: _select),
                  const SizedBox(height: 16),
                  ...tabChildren,
                  const SizedBox(height: 20),
                ],
              ),
            ),
            if (_tab == _DetailTab.detalhes)
              _CommentComposer(
                ministryId: widget.ministryId,
                scheduleId: widget.scheduleId,
                controller: widget.commentController,
                focusNode: widget.commentFocusNode,
                commentsState: widget.commentsState,
              ),
          ],
        ),
      ),
    );
  }
}

/// Section navigation: Detalhes / Músicas / Participantes / Roteiro.
class _DetailTabBar extends StatelessWidget {
  final _DetailTab selected;
  final ValueChanged<_DetailTab> onSelect;
  const _DetailTabBar({required this.selected, required this.onSelect});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    const tabs = <(_DetailTab, String, String)>[
      (_DetailTab.detalhes, 'Detalhes', 'schedule_detail_tab_detalhes'),
      (_DetailTab.musicas, 'Músicas', 'schedule_detail_tab_musicas'),
      (
        _DetailTab.participantes,
        'Participantes',
        'schedule_detail_tab_participantes'
      ),
      (_DetailTab.roteiro, 'Roteiro', 'schedule_detail_tab_roteiro'),
    ];
    return Container(
      key: const ValueKey('schedule_detail_tab_bar'),
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          for (final t in tabs)
            Expanded(
              child: Semantics(
                button: true,
                selected: selected == t.$1,
                child: InkWell(
                  key: ValueKey(t.$3),
                  borderRadius: BorderRadius.circular(9),
                  onTap: () => onSelect(t.$1),
                  child: Container(
                    constraints: const BoxConstraints(minHeight: 44),
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: selected == t.$1
                          ? theme.colorScheme.primary
                          : Colors.transparent,
                      borderRadius: BorderRadius.circular(9),
                    ),
                    child: FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        t.$2,
                        maxLines: 1,
                        style: theme.textTheme.labelLarge?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: selected == t.$1
                              ? theme.colorScheme.onPrimary
                              : theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _TabEmptyState extends StatelessWidget {
  final IconData icon;
  final String message;
  const _TabEmptyState({super.key, required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _SectionCard(
      child: Column(
        children: [
          Icon(icon,
              size: 36,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.35)),
          const SizedBox(height: 8),
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6)),
          ),
        ],
      ),
    );
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
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(
            color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4)),
      ),
      child: Padding(padding: const EdgeInsets.all(16), child: child),
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
  final ValueChanged<_DetailTab>? onSelectTab;
  const _InfoSection({required this.schedule, this.onSelectTab});

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
            height: 5,
            color: theme.colorScheme.secondary,
          ),
          Padding(
            padding: const EdgeInsets.all(16),
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
          Row(
            key: const ValueKey('schedule_detail_stats_row'),
            children: [
              _StatCell(
                keyName: 'schedule_detail_stat_participantes',
                icon: Icons.people_outline,
                count: schedule.participants.length,
                label: 'Participantes',
                onTap: onSelectTab == null
                    ? null
                    : () => onSelectTab!(_DetailTab.participantes),
              ),
              _StatCell(
                keyName: 'schedule_detail_stat_musicas',
                icon: Icons.music_note_outlined,
                count: schedule.songs.length,
                label: 'Músicas',
                onTap: onSelectTab == null
                    ? null
                    : () => onSelectTab!(_DetailTab.musicas),
              ),
              _StatCell(
                keyName: 'schedule_detail_stat_roteiro',
                icon: Icons.view_timeline_outlined,
                count: schedule.timeline.length,
                label: 'Roteiro',
                onTap: onSelectTab == null
                    ? null
                    : () => onSelectTab!(_DetailTab.roteiro),
              ),
              _StatCell(
                keyName: 'schedule_detail_stat_vestimenta',
                icon: Icons.checkroom_outlined,
                count: dressCount,
                label: 'Vestimenta',
                onTap: onSelectTab == null
                    ? null
                    : () => onSelectTab!(_DetailTab.detalhes),
              ),
            ],
          ),
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
  final VoidCallback? onTap;

  const _StatCell({
    required this.keyName,
    required this.icon,
    required this.count,
    required this.label,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 3),
        child: InkWell(
          key: ValueKey(keyName),
          borderRadius: BorderRadius.circular(10),
          onTap: onTap,
          child: Container(
            constraints: const BoxConstraints(minHeight: 44),
            padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 2),
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.5),
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 16, color: theme.colorScheme.primary),
                const SizedBox(height: 2),
                Text(
                  '$count',
                  style: theme.textTheme.titleMedium
                      ?.copyWith(fontWeight: FontWeight.w800),
                ),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  child: Text(
                    label,
                    maxLines: 1,
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
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
                style: theme.textTheme.titleSmall
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
                'Músicas (${songs.length})',
                style: theme.textTheme.titleSmall
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
                    const EdgeInsets.symmetric(vertical: 6, horizontal: 4),
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
  const _TimelineSection({required this.items});

  String _getTimelineTypeLabel(String type) {
    switch (type) {
      case 'worship':
      case 'Louvor':
      case 'Música':
        return 'Louvor';
      case 'word':
      case 'Palavra':
        return 'Palavra';
      case 'prayer':
      case 'Oração':
        return 'Oração';
      case 'transition':
      case 'Transição':
        return 'Transição';
      case 'Avisos':
        return 'Avisos';
      case 'Oferta':
        return 'Oferta';
      case 'Evento':
        return 'Evento';
      case 'other':
      case 'Outro':
      default:
        return '';
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.view_timeline_outlined,
                size: 18, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                'Roteiro',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600),
              ),
            ),
          ]),
          const SizedBox(height: 10),
          ...items.map((item) {
            final typeLabel = _getTimelineTypeLabel(item.type);
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(children: [
                SizedBox(
                  width: 46,
                  child: Text(
                    item.time ?? '',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color:
                            theme.colorScheme.onSurface.withValues(alpha: 0.5),
                        fontFamily: 'monospace'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                    child: Text(item.title, style: theme.textTheme.bodyMedium)),
                if (typeLabel.isNotEmpty) ...[
                  const SizedBox(width: 8),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      typeLabel,
                      style: theme.textTheme.labelSmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ]),
            );
          }),
        ],
      ),
    );
  }
}

// ─── Clothing Section ─────────────────────────────────────────────────────────

class _ClothingSection extends StatelessWidget {
  final List<ScheduleClothingPiece> pieces;
  final String? palette;

  const _ClothingSection({required this.pieces, this.palette});

  Color? _parseColor(String hex) {
    try {
      final clean = hex.replaceAll('#', '').trim();
      if (clean.length == 6) {
        return Color(int.parse('FF$clean', radix: 16));
      }
    } catch (_) {}
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasPalette = palette != null && palette!.trim().isNotEmpty;

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
                  Icon(Icons.checkroom_outlined,
                      size: 18, color: theme.colorScheme.primary),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text('Vestimenta',
                        style: theme.textTheme.titleSmall
                            ?.copyWith(fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
              if (hasPalette)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    palette!.trim(),
                    style: theme.textTheme.labelSmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ),
          if (pieces.isEmpty && hasPalette)
            Padding(
              padding: const EdgeInsets.only(top: 8.0),
              child: Text(
                'Paleta definida: ${palette!.trim()}',
                style: theme.textTheme.bodyMedium,
              ),
            ),
          if (pieces.isNotEmpty) ...[
            const SizedBox(height: 10),
            ...pieces.map((piece) {
              final label = piece.description.isNotEmpty
                  ? piece.description
                  : piece.name;
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(children: [
                  if (piece.colors.isNotEmpty)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: piece.colors.map((c) {
                        return Container(
                          width: 14,
                          height: 14,
                          margin: const EdgeInsets.only(right: 4),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: _parseColor(c) ?? theme.colorScheme.primary,
                            border: Border.all(
                                color: theme.colorScheme.outlineVariant),
                          ),
                        );
                      }).toList(),
                    )
                  else if (piece.colorHex != null)
                    Container(
                      width: 14,
                      height: 14,
                      margin: const EdgeInsets.only(right: 8),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: _parseColor(piece.colorHex!) ??
                            theme.colorScheme.primary,
                        border:
                            Border.all(color: theme.colorScheme.outlineVariant),
                      ),
                    ),
                  if (label.isNotEmpty)
                    Expanded(
                      child: Text(
                        label,
                        style: theme.textTheme.bodyMedium,
                      ),
                    ),
                ]),
              );
            }),
          ],
        ],
      ),
    );
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
                style: theme.textTheme.titleSmall
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

// ─── Comments Section ─────────────────────────────────────────────────────────

class _CommentsSection extends ConsumerWidget {
  final String ministryId;
  final String scheduleId;
  final CommentsState commentsState;

  const _CommentsSection({
    required this.ministryId,
    required this.scheduleId,
    required this.commentsState,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final isMatchingCommentsKey = commentsState.ministryId == ministryId &&
        commentsState.scheduleId == scheduleId;

    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.chat_bubble_outline,
                size: 18, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Comentários',
                  style: theme.textTheme.titleSmall
                      ?.copyWith(fontWeight: FontWeight.w600)),
            ),
          ]),
          const SizedBox(height: 10),
          if (commentsState.isCommerciallyRestricted) ...[
            const _CommercialRestrictionBanner(),
            const SizedBox(height: 8),
          ],
          if (!isMatchingCommentsKey || commentsState.isLoading) ...[
            const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Center(child: CircularProgressIndicator())),
          ] else if (commentsState.error != null) ...[
            _InlineError(
              message: commentsState.error!,
              onRetry: () => ref
                  .read(commentsNotifierProvider.notifier)
                  .load(ministryId, scheduleId),
            ),
          ] else if (commentsState.comments.isEmpty) ...[
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'Nenhum comentário ainda. Seja o primeiro!',
                style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.55),
                    fontStyle: FontStyle.italic),
              ),
            ),
          ] else ...[
            ...commentsState.comments.map((c) => _CommentTile(comment: c)),
          ],
        ],
      ),
    );
  }
}

class _CommentTile extends StatelessWidget {
  final ScheduleComment comment;
  const _CommentTile({required this.comment});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            CircleAvatar(
              radius: 13,
              backgroundColor: theme.colorScheme.secondaryContainer,
              child: Text(
                comment.userName.isNotEmpty
                    ? comment.userName[0].toUpperCase()
                    : '?',
                style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSecondaryContainer,
                    fontWeight: FontWeight.bold),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
                child: Text(comment.userName,
                    style: theme.textTheme.labelMedium
                        ?.copyWith(fontWeight: FontWeight.w600))),
            Text(comment.formattedDate,
                style: theme.textTheme.labelSmall?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.5))),
          ]),
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 34),
            child: Text(comment.content, style: theme.textTheme.bodyMedium),
          ),
          const Divider(height: 16, thickness: 0.5),
        ],
      ),
    );
  }
}

class _CommercialRestrictionBanner extends StatelessWidget {
  const _CommercialRestrictionBanner();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.colorScheme.tertiaryContainer.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(children: [
        Icon(Icons.info_outline, size: 16, color: theme.colorScheme.tertiary),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            'O envio de comentários está temporariamente indisponível. A leitura continua disponível.',
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.onTertiaryContainer),
          ),
        ),
      ]),
    );
  }
}

// ─── Comment Composer ─────────────────────────────────────────────────────────

class _CommentComposer extends ConsumerStatefulWidget {
  final String ministryId;
  final String scheduleId;
  final TextEditingController controller;
  final FocusNode focusNode;
  final CommentsState commentsState;

  const _CommentComposer({
    required this.ministryId,
    required this.scheduleId,
    required this.controller,
    required this.focusNode,
    required this.commentsState,
  });

  @override
  ConsumerState<_CommentComposer> createState() => _CommentComposerState();
}

class _CommentComposerState extends ConsumerState<_CommentComposer> {
  String _text = '';

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onTextChanged);
  }

  void _onTextChanged() {
    setState(() => _text = widget.controller.text);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onTextChanged);
    super.dispose();
  }

  bool get _canPost =>
      widget.commentsState.ministryId == widget.ministryId &&
      widget.commentsState.scheduleId == widget.scheduleId &&
      _text.trim().isNotEmpty &&
      _text.trim().length <= 1000 &&
      !widget.commentsState.isPosting &&
      !widget.commentsState.isCommerciallyRestricted;

  Future<void> _submit() async {
    if (!_canPost) return;
    final success = await ref
        .read(commentsNotifierProvider.notifier)
        .postComment(widget.ministryId, widget.scheduleId, _text);
    if (success && mounted) {
      widget.controller.clear();
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final postError = widget.commentsState.postError;
    final isPosting = widget.commentsState.isPosting;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (postError != null &&
            !widget.commentsState.isCommerciallyRestricted) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
            color: theme.colorScheme.errorContainer.withValues(alpha: 0.8),
            child: Row(children: [
              Icon(Icons.warning_amber_outlined,
                  size: 14, color: theme.colorScheme.error),
              const SizedBox(width: 8),
              Expanded(
                  child: Text(postError,
                      style: theme.textTheme.bodySmall
                          ?.copyWith(color: theme.colorScheme.error))),
              GestureDetector(
                onTap: () => ref
                    .read(commentsNotifierProvider.notifier)
                    .clearPostError(),
                child:
                    Icon(Icons.close, size: 14, color: theme.colorScheme.error),
              ),
            ]),
          ),
        ],
        Container(
          padding: EdgeInsets.only(
            left: 12,
            right: 8,
            top: 8,
            bottom: MediaQuery.viewInsetsOf(context).bottom > 0 ? 8 : 12,
          ),
          decoration: BoxDecoration(
            color: theme.colorScheme.surface,
            border: Border(
              top: BorderSide(
                  color:
                      theme.colorScheme.outlineVariant.withValues(alpha: 0.4)),
            ),
          ),
          child: SafeArea(top: false, child: Row(children: [
            Expanded(
              child: TextField(
                controller: widget.controller,
                focusNode: widget.focusNode,
                maxLength: 1000,
                maxLines: null,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(
                  hintText: widget.commentsState.isCommerciallyRestricted
                      ? 'Envio de comentários indisponível'
                      : 'Escreva um comentário...',
                  counterText: '',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(20),
                    borderSide: BorderSide.none,
                  ),
                  filled: true,
                  fillColor: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  isDense: true,
                ),
                enabled: widget.commentsState.ministryId == widget.ministryId &&
                    widget.commentsState.scheduleId == widget.scheduleId &&
                    !widget.commentsState.isCommerciallyRestricted,
                onSubmitted: (_) => _submit(),
              ),
            ),
            const SizedBox(width: 6),
            SizedBox(
              height: 44,
              width: 44,
              child: isPosting
                  ? const Padding(
                      padding: EdgeInsets.all(10),
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : IconButton(
                      onPressed: _canPost ? _submit : null,
                      icon: const Icon(Icons.send_rounded),
                      tooltip: 'Enviar comentário',
                    ),
            ),
          ])),
        ),
      ],
    );
  }
}

// ─── Error / Shared Widgets ───────────────────────────────────────────────────

class _InlineError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const _InlineError({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(message,
            style: theme.textTheme.bodySmall
                ?.copyWith(color: theme.colorScheme.error)),
        const SizedBox(height: 8),
        TextButton.icon(
          onPressed: onRetry,
          icon: const Icon(Icons.refresh, size: 14),
          label: const Text('Tentar novamente'),
          style: TextButton.styleFrom(
              padding: EdgeInsets.zero, minimumSize: const Size(0, 44)),
        ),
      ],
    );
  }
}

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
