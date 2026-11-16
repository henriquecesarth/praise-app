import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../app/providers.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../repertoire/domain/song_summary.dart';
import '../../../repertoire/presentation/views/song_detail_view.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_actions.dart';
import '../../domain/schedule_song_sequence.dart';
import '../widgets/detail/schedule_comments_fab.dart';
import '../widgets/detail/schedule_detail_header.dart';
import '../widgets/detail/schedule_detail_tabs.dart';
import '../widgets/detail/schedule_details_tab_view.dart';
import '../widgets/detail/schedule_order_tab_view.dart';
import '../widgets/detail/schedule_participants_tab_view.dart';
import '../widgets/detail/schedule_songs_tab_view.dart';
import 'schedule_chat_view.dart';
import 'schedule_form_screen.dart';

export '../widgets/detail/schedule_detail_header.dart' show parseScheduleColor;

/// Full schedule detail panel organized into a summary header, 4 segmented tabs
/// (Detalhes, Músicas, Participantes, Roteiro), and a floating comments action.
///
/// State is strictly keyed by [ministryId] + [scheduleId].
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
  ScheduleDetailSectionTab _selectedTab = ScheduleDetailSectionTab.details;
  Map<String, SongSummary> _repertoireSummariesById = const {};
  String? _enrichedContextKey;
  bool _isEnrichingSongs = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _load();
    });
  }

  @override
  void didUpdateWidget(covariant ScheduleDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId ||
        oldWidget.scheduleId != widget.scheduleId) {
      _selectedTab = ScheduleDetailSectionTab.details;
      _repertoireSummariesById = const {};
      _enrichedContextKey = null;
      _isEnrichingSongs = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }
  }

  void _load() {
    ref
        .read(scheduleDetailNotifierProvider.notifier)
        .load(widget.ministryId, widget.scheduleId);
    ref
        .read(commentsNotifierProvider.notifier)
        .load(widget.ministryId, widget.scheduleId);
  }

  void _maybeEnrichSongMetadata(ScheduleDetail schedule) {
    if (schedule.songs.isEmpty) return;
    final ctxKey = '${widget.ministryId}:${widget.scheduleId}';
    if (_enrichedContextKey == ctxKey || _isEnrichingSongs) return;

    final repState = ref.read(repertoireListNotifierProvider);
    if (repState.ministryId == widget.ministryId && repState.songs.isNotEmpty) {
      _enrichedContextKey = ctxKey;
      return;
    }

    _isEnrichingSongs = true;
    _enrichedContextKey = ctxKey;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      try {
        final page = await ref
            .read(repertoireRepositoryProvider)
            .listSongs(widget.ministryId, limit: 100);
        if (!mounted ||
            '${widget.ministryId}:${widget.scheduleId}' != ctxKey ||
            ref.read(ministryContextNotifierProvider).selectedMinistry?.id !=
                widget.ministryId) {
          return;
        }
        if (page.songs.isNotEmpty) {
          setState(() {
            _repertoireSummariesById = {
              for (final s in page.songs) s.id: s,
            };
          });
        }
      } catch (_) {
        // Non-fatal fallback: schedule songs continue rendering from snapshot fields.
      } finally {
        _isEnrichingSongs = false;
      }
    });
  }

  void _openScheduleSongDetail(
    ScheduleDetail schedule, {
    required int scheduleSlotIndex,
    required ScheduleSong song,
  }) {
    final sequence = ScheduleSongSequenceContext.fromScheduleSongs(
      ministryId: widget.ministryId,
      scheduleId: schedule.id,
      songs: schedule.songs,
      initialScheduleSlotIndex: scheduleSlotIndex,
    );
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => SongDetailView(
          ministryId: widget.ministryId,
          songId: song.id,
          initialTitle: song.title,
          initialVersionId: song.versionId,
          backLabel: 'Voltar',
          scheduleSequence: sequence.isEmpty ? null : sequence,
        ),
      ),
    );
  }

  Future<void> _openComments() async {
    final activeMinistryId =
        ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
    if (activeMinistryId != widget.ministryId) return;
    final userId = ref.read(authNotifierProvider).user?.id;
    if (userId == null || userId.isEmpty) return;

    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ScheduleChatView(
          ministryId: widget.ministryId,
          scheduleId: widget.scheduleId,
          userId: userId,
        ),
      ),
    );
    if (!mounted ||
        ref.read(authNotifierProvider).user?.id != userId ||
        ref.read(ministryContextNotifierProvider).selectedMinistry?.id !=
            widget.ministryId) {
      return;
    }
    ref
        .read(commentsNotifierProvider.notifier)
        .load(widget.ministryId, widget.scheduleId);
  }

  Future<void> _shareSchedule(ScheduleDetail schedule) async {
    final summary = buildScheduleShareSummary(schedule);
    try {
      await Clipboard.setData(ClipboardData(text: summary));
    } catch (_) {
      // Non-fatal if platform clipboard is unavailable
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Resumo da escala copiado para compartilhar.'),
      ),
    );
  }

  Future<void> _openExternalHttpUrl(
    Uri uri, {
    required String errorMessage,
  }) async {
    if (uri.scheme != 'http' && uri.scheme != 'https') {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(errorMessage)),
      );
      return;
    }
    var launched = false;
    try {
      launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      launched = false;
    }
    if (!launched && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(errorMessage)),
      );
    }
  }

  Future<void> _openGoogleCalendar(ScheduleDetail schedule) async {
    final uri = buildGoogleCalendarEventUri(schedule);
    if (uri == null) return;
    await _openExternalHttpUrl(
      uri,
      errorMessage: 'Não foi possível abrir o Google Agenda neste dispositivo.',
    );
  }

  Future<void> _openYoutubeUrl(String rawUrl) async {
    final uri = Uri.tryParse(rawUrl.trim());
    if (uri == null) return;
    await _openExternalHttpUrl(
      uri,
      errorMessage: 'Não foi possível abrir o vídeo no YouTube.',
    );
  }

  Future<void> _confirmAndDeleteSchedule(ScheduleDetail schedule) async {
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
    final ministryContext = ref.watch(ministryContextNotifierProvider);
    final authUser = ref.watch(authNotifierProvider.select((s) => s.user));
    final repSongsForMinistry = ref.watch(
      repertoireListNotifierProvider.select(
        (s) => s.ministryId == widget.ministryId ? s.songs : const <SongSummary>[],
      ),
    );

    // Trigger reload if state belongs to another ministry/schedule
    final stateKey = '${detailState.ministryId}:${detailState.scheduleId}';
    final myKey = '${widget.ministryId}:${widget.scheduleId}';
    if (stateKey != myKey) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }

    final isMatchingKey = detailState.ministryId == widget.ministryId &&
        detailState.scheduleId == widget.scheduleId;
    final activeMinistry = ministryContext.selectedMinistry;
    final isMatchingTenant =
        activeMinistry != null && activeMinistry.id == widget.ministryId;
    final isAdmin = isMatchingTenant && activeMinistry.isAdmin;
    final schedule = isMatchingKey ? detailState.schedule : null;

    if (schedule != null) {
      _maybeEnrichSongMetadata(schedule);
    }

    final mergedSummaries = <String, SongSummary>{
      ..._repertoireSummariesById,
      for (final s in repSongsForMinistry) s.id: s,
    };

    final visibleCommentsCount =
        commentsState.ministryId == widget.ministryId &&
                commentsState.scheduleId == widget.scheduleId
            ? commentsState.comments.length
            : 0;

    Widget body;
    if (!isMatchingKey || (detailState.isLoading && schedule == null)) {
      body = const Center(child: CircularProgressIndicator());
    } else if (detailState.error != null && schedule == null) {
      body = _DetailError(
        message: detailState.error!,
        onRetry: _load,
        onBack: () => Navigator.of(context).maybePop(),
      );
    } else if (schedule != null) {
      final Widget activeTabView;
      switch (_selectedTab) {
        case ScheduleDetailSectionTab.details:
          activeTabView = ScheduleDetailsTabView(
            key: const ValueKey('schedule_tab_view_details'),
            schedule: schedule,
            isConfirming: detailState.isConfirming,
            confirmationError: detailState.confirmationError,
            currentUserId: authUser?.id,
            currentUserName: authUser?.name,
            onConfirm: (confirmed) => ref
                .read(scheduleDetailNotifierProvider.notifier)
                .confirm(widget.ministryId, widget.scheduleId, confirmed),
            onClearConfirmationError: () => ref
                .read(scheduleDetailNotifierProvider.notifier)
                .clearConfirmationError(),
            onShare: () => _shareSchedule(schedule),
            onOpenGoogleCalendar: buildGoogleCalendarEventUri(schedule) != null
                ? () => _openGoogleCalendar(schedule)
                : null,
            onNavigateTab: (tab) => setState(() => _selectedTab = tab),
          );
        case ScheduleDetailSectionTab.songs:
          activeTabView = ScheduleSongsTabView(
            key: const ValueKey('schedule_tab_view_songs'),
            songs: schedule.songs,
            summariesById: mergedSummaries,
            onOpenSong: (slotIdx, song) => _openScheduleSongDetail(
              schedule,
              scheduleSlotIndex: slotIdx,
              song: song,
            ),
            onOpenYoutube: _openYoutubeUrl,
          );
        case ScheduleDetailSectionTab.participants:
          activeTabView = ScheduleParticipantsTabView(
            key: const ValueKey('schedule_tab_view_participants'),
            participants: schedule.participants,
          );
        case ScheduleDetailSectionTab.order:
          activeTabView = ScheduleOrderTabView(
            key: const ValueKey('schedule_tab_view_order'),
            items: schedule.timeline,
            songs: schedule.songs,
            onOpenSong: (slotIdx, song) => _openScheduleSongDetail(
              schedule,
              scheduleSlotIndex: slotIdx,
              song: song,
            ),
          );
      }

      body = Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 780),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              ScheduleDetailHeader(schedule: schedule),
              ScheduleDetailTabBar(
                selectedTab: _selectedTab,
                onSelectTab: (tab) => setState(() => _selectedTab = tab),
                songsCount: schedule.songs.length,
                confirmedParticipants: schedule.confirmedCount,
                totalParticipants: schedule.totalParticipants,
                orderItemsCount: schedule.timeline.length,
              ),
              Expanded(
                child: AnimatedSwitcher(
                  duration: const Duration(milliseconds: 180),
                  switchInCurve: Curves.easeOut,
                  switchOutCurve: Curves.easeIn,
                  layoutBuilder: (currentChild, previousChildren) {
                    return Stack(
                      alignment: Alignment.topCenter,
                      children: [
                        ...previousChildren,
                        if (currentChild != null) currentChild,
                      ],
                    );
                  },
                  child: activeTabView,
                ),
              ),
            ],
          ),
        ),
      );
    } else {
      body = const Center(child: CircularProgressIndicator());
    }

    return Scaffold(
      appBar: AppBar(
        centerTitle: true,
        title: const Text('Escala'),
        actions: [
          if (schedule != null)
            PopupMenuButton<String>(
              key: const ValueKey('schedule_detail_actions_menu'),
              tooltip: 'Mais ações',
              icon: const Icon(Icons.more_vert_rounded),
              onSelected: (value) async {
                switch (value) {
                  case 'share':
                    await _shareSchedule(schedule);
                  case 'calendar':
                    await _openGoogleCalendar(schedule);
                  case 'comments':
                    await _openComments();
                  case 'refresh':
                    _load();
                  case 'edit':
                    await Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => ScheduleFormScreen(
                          ministryId: widget.ministryId,
                          initialSchedule: schedule,
                        ),
                      ),
                    );
                  case 'delete':
                    if (!detailState.isDeleting) {
                      await _confirmAndDeleteSchedule(schedule);
                    }
                }
              },
              itemBuilder: (ctx) => [
                const PopupMenuItem<String>(
                  key: ValueKey('menu_share_schedule'),
                  value: 'share',
                  child: ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.share_outlined),
                    title: Text('Compartilhar escala'),
                  ),
                ),
                if (buildGoogleCalendarEventUri(schedule) != null)
                  const PopupMenuItem<String>(
                    key: ValueKey('menu_calendar_schedule'),
                    value: 'calendar',
                    child: ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.event_outlined),
                      title: Text('Google Agenda'),
                    ),
                  ),
                if (isMatchingTenant)
                  PopupMenuItem<String>(
                    key: const ValueKey('menu_comments_schedule'),
                    value: 'comments',
                    child: ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: const Icon(Icons.chat_bubble_outline_rounded),
                      title: Text('Comentários ($visibleCommentsCount)'),
                    ),
                  ),
                const PopupMenuItem<String>(
                  key: ValueKey('menu_refresh_schedule'),
                  value: 'refresh',
                  child: ListTile(
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(Icons.refresh_rounded),
                    title: Text('Atualizar'),
                  ),
                ),
                if (isAdmin) ...[
                  const PopupMenuDivider(),
                  const PopupMenuItem<String>(
                    key: ValueKey('edit_schedule_button'),
                    value: 'edit',
                    child: ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.edit_outlined),
                      title: Text('Editar escala'),
                    ),
                  ),
                  PopupMenuItem<String>(
                    key: const ValueKey('delete_schedule_button'),
                    value: 'delete',
                    enabled: !detailState.isDeleting,
                    child: ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(
                        Icons.delete_outline,
                        color: Theme.of(ctx).colorScheme.error,
                      ),
                      title: Text(
                        detailState.isDeleting
                            ? 'Excluindo...'
                            : 'Excluir escala',
                        style: TextStyle(
                          color: Theme.of(ctx).colorScheme.error,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
        ],
      ),
      body: SafeArea(bottom: false, child: body),
      floatingActionButton: schedule != null
          ? ScheduleCommentsFab(
              commentsCount: visibleCommentsCount,
              onPressed: isMatchingTenant ? _openComments : null,
            )
          : null,
    );
  }
}

class _DetailError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  final VoidCallback onBack;

  const _DetailError({
    required this.message,
    required this.onRetry,
    required this.onBack,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline_rounded,
              size: 48,
              color: theme.colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: onBack,
              child: const Text('Voltar à Lista'),
            ),
          ],
        ),
      ),
    );
  }
}
