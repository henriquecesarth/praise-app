import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_comment.dart';
import '../../domain/schedule_participant.dart';
import '../controllers/schedule_detail_controller.dart';
import '../controllers/schedule_providers.dart';

/// Full schedule detail screen.
///
/// State is keyed by [ministryId] + [scheduleId].
/// Contains: title, date/time, duration, notes, participants,
/// songs/timeline/clothing (when present), confirmation section, comments.
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

  @override
  Widget build(BuildContext context) {
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

    Widget body;

    if (detailState.isLoading && detailState.schedule == null) {
      body = const Center(child: CircularProgressIndicator());
    } else if (detailState.error != null && detailState.schedule == null) {
      body = _DetailError(
        message: detailState.error!,
        onRetry: () => ref
            .read(scheduleDetailNotifierProvider.notifier)
            .load(widget.ministryId, widget.scheduleId),
        onBack: () => Navigator.of(context).maybePop(),
      );
    } else if (detailState.schedule != null) {
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

    return Scaffold(
      appBar: AppBar(
        title: Text(
          detailState.schedule?.title ??
              widget.initialTitle ??
              'Detalhes da Escala',
          overflow: TextOverflow.ellipsis,
        ),
      ),
      body: SafeArea(child: body),
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
  Widget build(BuildContext context, WidgetRef ref) {
    final isWide = MediaQuery.sizeOf(context).width >= 600;
    final maxWidth = isWide ? 680.0 : double.infinity;

    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: Column(
          children: [
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  _InfoSection(schedule: schedule),
                  const SizedBox(height: 16),
                  if (schedule.participants.isNotEmpty) ...[
                    _ParticipantsSection(participants: schedule.participants),
                    const SizedBox(height: 16),
                  ],
                  _ConfirmationSection(
                    schedule: schedule,
                    ministryId: ministryId,
                    scheduleId: scheduleId,
                    isConfirming: isConfirming,
                    error: confirmationError,
                  ),
                  const SizedBox(height: 16),
                  if (schedule.songs.isNotEmpty) ...[
                    _SongsSection(songs: schedule.songs),
                    const SizedBox(height: 16),
                  ],
                  if (schedule.timeline.isNotEmpty) ...[
                    _TimelineSection(items: schedule.timeline),
                    const SizedBox(height: 16),
                  ],
                  if (schedule.clothingPieces.isNotEmpty) ...[
                    _ClothingSection(pieces: schedule.clothingPieces),
                    const SizedBox(height: 16),
                  ],
                  if (schedule.notes?.isNotEmpty == true) ...[
                    _NotesSection(notes: schedule.notes!),
                    const SizedBox(height: 16),
                  ],
                  _CommentsSection(
                    ministryId: ministryId,
                    scheduleId: scheduleId,
                    commentsState: commentsState,
                  ),
                  const SizedBox(height: 20),
                ],
              ),
            ),
            _CommentComposer(
              ministryId: ministryId,
              scheduleId: scheduleId,
              controller: commentController,
              focusNode: commentFocusNode,
              commentsState: commentsState,
            ),
          ],
        ),
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
  const _InfoSection({required this.schedule});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(schedule.title,
              style: theme.textTheme.titleLarge
                  ?.copyWith(fontWeight: FontWeight.bold)),
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
        ],
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
            Text('Participantes ($confirmed/$total confirmados)',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
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
        if (participant.role.isNotEmpty)
          Text(participant.role,
              style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.55))),
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
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.how_to_reg_outlined,
                size: 18, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('Confirmação de Presença',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
          ]),
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
                  label: const Text('Não vou'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.colorScheme.error,
                    side: BorderSide(
                        color: theme.colorScheme.error.withValues(alpha: 0.5)),
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
                  label: Text(isConfirming ? 'Confirmando...' : 'Confirmar'),
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
  const _SongsSection({required this.songs});

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
            Text('Músicas (${songs.length})',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 10),
          ...songs.asMap().entries.map((e) {
            final idx = e.key + 1;
            final song = e.value;
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(children: [
                Text('$idx.',
                    style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurface
                            .withValues(alpha: 0.5))),
                const SizedBox(width: 8),
                Expanded(
                    child: Text(song.title ?? '—',
                        style: theme.textTheme.bodyMedium)),
                if (song.artist != null)
                  Text(song.artist!,
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.55))),
              ]),
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
            Text('Roteiro',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 10),
          ...items.map((item) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(children: [
                  SizedBox(
                    width: 42,
                    child: Text(
                      item.time ?? '',
                      style: theme.textTheme.bodySmall?.copyWith(
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.5),
                          fontFamily: 'monospace'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                      child:
                          Text(item.title, style: theme.textTheme.bodyMedium)),
                ]),
              )),
        ],
      ),
    );
  }
}

// ─── Clothing Section ─────────────────────────────────────────────────────────

class _ClothingSection extends StatelessWidget {
  final List<ScheduleClothingPiece> pieces;
  const _ClothingSection({required this.pieces});

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
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.checkroom_outlined,
                size: 18, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('Vestimenta',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 10),
          ...pieces.map((piece) => Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(children: [
                  if (piece.colorHex != null)
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
                  if (piece.description != null)
                    Expanded(
                        child: Text(piece.description!,
                            style: theme.textTheme.bodyMedium)),
                ]),
              )),
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
            Text('Observações',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
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
    return _SectionCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [
            Icon(Icons.chat_bubble_outline,
                size: 18, color: theme.colorScheme.primary),
            const SizedBox(width: 8),
            Text('Comentários',
                style: theme.textTheme.titleSmall
                    ?.copyWith(fontWeight: FontWeight.w600)),
          ]),
          const SizedBox(height: 10),
          if (commentsState.isCommerciallyRestricted) ...[
            const _CommercialRestrictionBanner(),
            const SizedBox(height: 8),
          ],
          if (commentsState.isLoading) ...[
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
          child: Row(children: [
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
                enabled: !widget.commentsState.isCommerciallyRestricted,
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
          ]),
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
