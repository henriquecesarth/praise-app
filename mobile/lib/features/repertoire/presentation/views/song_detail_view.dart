import 'dart:async';

import 'package:flutter/foundation.dart' show ValueListenable;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../../app/providers.dart';
import '../../../auth/domain/auth_user.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../smart_chords/domain/smart_chord.dart';
import '../../../smart_chords/domain/smart_chord_parser.dart';
import '../../../smart_chords/presentation/views/smart_chord_reader_screen.dart';
import '../../../smart_chords/presentation/views/smart_chord_form_screen.dart';
import '../../../smart_chords/presentation/widgets/chord_lyric_line.dart';
import '../../../smart_chords/presentation/widgets/musical_progression_line.dart';
import '../../../smart_chords/presentation/widgets/smart_chord_picker_modal.dart';
import '../../../schedules/domain/schedule_song_sequence.dart';
import '../../domain/song_detail.dart';
import 'song_form_screen.dart';

/// Native member-facing detail view for a song.
/// Read-only — displays real backend details, links, and readable lyrics.
class SongDetailView extends ConsumerStatefulWidget {
  final String ministryId;
  final String songId;
  final String? initialTitle;
  final String? initialVersionId;
  final String? backLabel;
  final ScheduleSongSequenceContext? scheduleSequence;

  const SongDetailView({
    super.key,
    required this.ministryId,
    required this.songId,
    this.initialTitle,
    this.initialVersionId,
    this.backLabel,
    this.scheduleSequence,
  });

  @override
  ConsumerState<SongDetailView> createState() => _SongDetailViewState();
}

@immutable
class _FullscreenSessionContext {
  final String ministryId;
  final String songId;
  final String title;
  final String? versionId;
  final String? versionName;
  final ScheduleSongSequenceContext? scheduleSequence;
  final int selectedChordIndex;

  const _FullscreenSessionContext({
    required this.ministryId,
    required this.songId,
    required this.title,
    this.versionId,
    this.versionName,
    this.scheduleSequence,
    this.selectedChordIndex = 0,
  });

  String get trackKey =>
      '${ministryId}_${songId}_${versionId ?? ''}_${scheduleSequence?.currentIndex ?? -1}';

  _FullscreenSessionContext copyWith({
    String? ministryId,
    String? songId,
    String? title,
    String? versionId,
    bool clearVersionId = false,
    String? versionName,
    bool clearVersionName = false,
    ScheduleSongSequenceContext? scheduleSequence,
    int? selectedChordIndex,
  }) {
    return _FullscreenSessionContext(
      ministryId: ministryId ?? this.ministryId,
      songId: songId ?? this.songId,
      title: title ?? this.title,
      versionId: clearVersionId ? null : (versionId ?? this.versionId),
      versionName: clearVersionName ? null : (versionName ?? this.versionName),
      scheduleSequence: scheduleSequence ?? this.scheduleSequence,
      selectedChordIndex: selectedChordIndex ?? this.selectedChordIndex,
    );
  }
}

class _SongDetailViewState extends ConsumerState<SongDetailView> {
  String? _boundUserId;
  bool _isDismissed = false;
  late String _activeSongId;
  String? _activeVersionId;
  String? _activeTitle;
  ScheduleSongSequenceContext? _activeSequence;
  late final ValueNotifier<_FullscreenSessionContext> _fullscreenSessionNotifier;
  bool _isFullscreenOpen = false;
  VoidCallback? _stopInlineAutoScrollCallback;
  double _standFontSize = 15.0;
  int _standAutoScrollSpeed = 2;
  int _standSemitones = 0;

  _FullscreenSessionContext _buildSessionContext({
    String? versionIdOverride,
    String? versionNameOverride,
    String? titleOverride,
    int selectedChordIndex = 0,
  }) {
    return _FullscreenSessionContext(
      ministryId: widget.ministryId,
      songId: _activeSongId,
      title: titleOverride ?? _activeTitle ?? 'Música',
      versionId: versionIdOverride ?? _activeVersionId,
      versionName:
          versionNameOverride ?? _activeSequence?.currentItem?.versionName,
      scheduleSequence: _activeSequence,
      selectedChordIndex: selectedChordIndex,
    );
  }

  void _syncActiveFromWidget() {
    _activeSequence = widget.scheduleSequence;
    final currentItem = _activeSequence?.currentItem;
    _activeSongId = currentItem?.songId ?? widget.songId;
    _activeVersionId = currentItem?.versionId ?? widget.initialVersionId;
    _activeTitle = currentItem?.title ?? widget.initialTitle;
  }

  void _loadActiveSong({bool forceChords = false}) {
    if (_isDismissed || !mounted) return;
    ref
        .read(songDetailNotifierProvider.notifier)
        .load(widget.ministryId, _activeSongId);
    ref.read(songSmartChordsNotifierProvider.notifier).load(
          _activeSongId,
          ministryId: widget.ministryId,
          versionId: _activeVersionId,
          force: forceChords,
        );
  }

  void _selectSequenceIndex(int index) {
    final sequence = _activeSequence;
    if (sequence == null || sequence.isEmpty) return;
    final nextSequence = sequence.moveToIndex(index);
    if (nextSequence.currentIndex == sequence.currentIndex) return;
    final nextItem = nextSequence.currentItem;
    if (nextItem == null) return;

    _stopInlineAutoScrollCallback?.call();
    setState(() {
      _activeSequence = nextSequence;
      _activeSongId = nextItem.songId;
      _activeVersionId = nextItem.versionId;
      _activeTitle = nextItem.title;
      _standSemitones = 0;
    });
    _fullscreenSessionNotifier.value = _buildSessionContext();
    _loadActiveSong(forceChords: true);
  }

  @override
  void initState() {
    super.initState();
    final user = ref.read(authNotifierProvider).user;
    _boundUserId = user?.id;
    _syncActiveFromWidget();
    _fullscreenSessionNotifier = ValueNotifier<_FullscreenSessionContext>(
      _buildSessionContext(),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadActiveSong();
    });
  }

  @override
  void didUpdateWidget(covariant SongDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId ||
        oldWidget.songId != widget.songId ||
        oldWidget.initialVersionId != widget.initialVersionId ||
        oldWidget.scheduleSequence != widget.scheduleSequence) {
      _stopInlineAutoScrollCallback?.call();
      _standSemitones = 0;
      _syncActiveFromWidget();
      _fullscreenSessionNotifier.value = _buildSessionContext();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _loadActiveSong(forceChords: true);
      });
    }
  }

  @override
  void dispose() {
    _fullscreenSessionNotifier.dispose();
    super.dispose();
  }

  void _dismissScreen() {
    if (_isDismissed) return;
    _isDismissed = true;
    _stopInlineAutoScrollCallback?.call();
    ref.read(songFormNotifierProvider.notifier).invalidateTenant();
    if (!mounted) return;
    final navigator = Navigator.of(context);
    if (_isFullscreenOpen && navigator.canPop()) {
      navigator.pop();
    }
    final route = ModalRoute.of(context);
    if (mounted && (route?.isCurrent ?? true) && navigator.canPop()) {
      navigator.pop();
    }
  }

  Future<void> _safeLaunchUrl(String urlString) async {
    final uri = Uri.tryParse(urlString.trim());
    if (uri == null || (!uri.isScheme('http') && !uri.isScheme('https'))) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Link inválido: $urlString')),
        );
      }
      return;
    }

    try {
      final launched = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );
      if (!launched && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Não foi possível abrir o link: $urlString')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao abrir o aplicativo externo: $e')),
        );
      }
    }
  }

  Future<void> _openEdit(BuildContext context, SongDetail song) async {
    final updated = await Navigator.of(context).push<SongDetail>(
      MaterialPageRoute(
        builder: (_) => SongFormScreen(
          ministryId: widget.ministryId,
          initialSong: song,
        ),
      ),
    );

    if (updated != null && mounted) {
      ref
          .read(songDetailNotifierProvider.notifier)
          .load(widget.ministryId, _activeSongId);
      ref
          .read(repertoireListNotifierProvider.notifier)
          .refresh(ministryId: widget.ministryId);
    }
  }

  Future<void> _confirmDelete(BuildContext context, SongDetail song) async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final errorColor = Theme.of(context).colorScheme.error;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Excluir música'),
        content: Text(
          'Deseja realmente excluir "${song.title}" do repertório deste ministério? Esta ação não pode ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const ValueKey('confirm_delete_song_button'),
            style: FilledButton.styleFrom(
              backgroundColor: errorColor,
              foregroundColor: Theme.of(dialogCtx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(dialogCtx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      final formNotifier = ref.read(songFormNotifierProvider.notifier);
      final currentUserId =
          ref.read(authNotifierProvider).user?.id ?? _boundUserId;
      final result = await formNotifier.deleteSong(
        song.id,
        ministryId: widget.ministryId,
        boundUserId: currentUserId,
      );

      if (!mounted || _isDismissed) return;
      if (result.isDiscarded) return;

      if (result.isSuccess) {
        ref
            .read(repertoireListNotifierProvider.notifier)
            .refresh(ministryId: widget.ministryId);
        if (navigator.canPop()) {
          navigator.pop();
        }
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Música excluída com sucesso!'),
          ),
        );
      } else if (result.isFailure) {
        messenger.showSnackBar(
          SnackBar(
            content: Text(result.errorMessage ?? 'Erro ao excluir música.'),
            backgroundColor: errorColor,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Ministry isolation: pop immediately if the active ministry changes
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      if (previous?.selectedMinistry?.id != next.selectedMinistry?.id) {
        _dismissScreen();
      }
    });

    // Session switch protection: if active user changes away or logs out, close immediately
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      final currentUid = next.user?.id;
      final isUnauthenticated =
          !next.isAuthenticated || currentUid == null || currentUid.isEmpty;
      final userChanged = _boundUserId != null && currentUid != _boundUserId;
      if ((_boundUserId != null && isUnauthenticated) || userChanged) {
        _dismissScreen();
      }
    });

    final detailState = ref.watch(songDetailNotifierProvider);
    final theme = Theme.of(context);
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final isAdmin = ministryState.selectedMinistry?.isAdmin ?? false;
    final isMatchingContext = detailState.ministryId == widget.ministryId &&
        detailState.songId == _activeSongId;
    final loadedSong =
        (isMatchingContext && detailState.error == null) ? detailState.song : null;
    final displayTitle = loadedSong?.title ?? _activeTitle ?? 'Música';

    Widget body;

    if (!isMatchingContext || detailState.isLoading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (detailState.error != null) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
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
                detailState.error!,
                textAlign: TextAlign.center,
                style: theme.textTheme.titleMedium,
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                onPressed: () => _loadActiveSong(forceChords: true),
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
              if (widget.backLabel == null ||
                  widget.backLabel!.trim().isEmpty) ...[
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () {
                    if (Navigator.of(context).canPop()) {
                      Navigator.of(context).pop();
                    }
                  },
                  child: const Text('Voltar ao Repertório'),
                ),
              ],
            ],
          ),
        ),
      );
    } else if (loadedSong != null) {
      body = Align(
        alignment: Alignment.topCenter,
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 900),
          child: _SongDetailContent(
            song: loadedSong,
            ministryId: widget.ministryId,
            initialVersionId: _activeVersionId,
            activeSlotKey: _activeSequence?.currentIndex ?? 0,
            isAdmin: isAdmin,
            semitones: _standSemitones,
            fontSize: _standFontSize,
            autoScrollSpeed: _standAutoScrollSpeed,
            onSemitonesChanged: (next) {
              if (!mounted) return;
              setState(() => _standSemitones = next);
            },
            onFontSizeChanged: (next) {
              if (!mounted) return;
              setState(() => _standFontSize = next);
            },
            onAutoScrollSpeedChanged: (next) {
              if (!mounted) return;
              setState(() => _standAutoScrollSpeed = next);
            },
            onOpenLink: _safeLaunchUrl,
            onRegisterStopAutoScroll: (cb) => _stopInlineAutoScrollCallback = cb,
            onOpenFullscreen: ({
              required String? activeVersionId,
              required String? activeVersionName,
              required int selectedChordIndex,
            }) async {
              _fullscreenSessionNotifier.value = _buildSessionContext(
                titleOverride: loadedSong.title,
                versionIdOverride: activeVersionId,
                versionNameOverride: activeVersionName,
                selectedChordIndex: selectedChordIndex,
              );
              _isFullscreenOpen = true;
              try {
                await Navigator.of(context).push<void>(
                  MaterialPageRoute(
                    fullscreenDialog: true,
                    builder: (_) => _SongFullscreenStandScreen(
                      sessionListenable: _fullscreenSessionNotifier,
                      initialSemitones: _standSemitones,
                      initialFontSize: _standFontSize,
                      initialAutoScrollSpeed: _standAutoScrollSpeed,
                      onSelectSequenceIndex: _selectSequenceIndex,
                      onSemitonesChanged: (next) {
                        if (!mounted) return;
                        setState(() => _standSemitones = next);
                      },
                      onFontSizeChanged: (next) {
                        if (!mounted) return;
                        setState(() => _standFontSize = next);
                      },
                      onAutoScrollSpeedChanged: (next) {
                        if (!mounted) return;
                        setState(() => _standAutoScrollSpeed = next);
                      },
                    ),
                  ),
                );
              } finally {
                _isFullscreenOpen = false;
              }
            },
          ),
        ),
      );
    } else {
      body = const SizedBox.shrink();
    }

    final hasContextBackLabel =
        widget.backLabel != null && widget.backLabel!.trim().isNotEmpty;
    final hasSequence = _activeSequence != null && _activeSequence!.isNotEmpty;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          displayTitle,
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (isAdmin && !detailState.isLoading && loadedSong != null) ...[
            IconButton(
              key: const ValueKey('edit_song_button'),
              tooltip: 'Editar música',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () => _openEdit(context, loadedSong),
            ),
            IconButton(
              key: const ValueKey('delete_song_button'),
              tooltip: 'Excluir música',
              icon: Icon(Icons.delete_outline, color: theme.colorScheme.error),
              onPressed: () => _confirmDelete(context, loadedSong),
            ),
          ],
        ],
      ),
      body: SafeArea(
        child: Align(
          alignment: Alignment.topCenter,
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 900),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (hasContextBackLabel || hasSequence)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
                    child: Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      alignment: hasContextBackLabel
                          ? WrapAlignment.spaceBetween
                          : WrapAlignment.end,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (hasContextBackLabel)
                          TextButton.icon(
                            key: const ValueKey(
                              'song_detail_context_back_button',
                            ),
                            style: TextButton.styleFrom(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 6,
                              ),
                              minimumSize: const Size(44, 44),
                            ),
                            onPressed: () {
                              if (Navigator.of(context).canPop()) {
                                Navigator.of(context).pop();
                              }
                            },
                            icon: const Icon(Icons.arrow_back, size: 16),
                            label: Text(widget.backLabel!.trim()),
                          ),
                        if (hasSequence)
                          _SequenceNavigationControls(
                            sequence: _activeSequence!,
                            onSelectIndex: _selectSequenceIndex,
                            barKey: const ValueKey('song_detail_sequence_bar'),
                            prevKey: const ValueKey(
                              'song_detail_sequence_prev_button',
                            ),
                            nextKey: const ValueKey(
                              'song_detail_sequence_next_button',
                            ),
                            labelKey: const ValueKey(
                              'song_detail_sequence_position_label',
                            ),
                          ),
                      ],
                    ),
                  ),
                Expanded(child: body),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _SequenceNavigationControls extends StatelessWidget {
  final ScheduleSongSequenceContext sequence;
  final ValueChanged<int> onSelectIndex;
  final Key barKey;
  final Key prevKey;
  final Key nextKey;
  final Key labelKey;

  const _SequenceNavigationControls({
    required this.sequence,
    required this.onSelectIndex,
    required this.barKey,
    required this.prevKey,
    required this.nextKey,
    required this.labelKey,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return DecoratedBox(
      key: barKey,
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.dividerColor.withValues(alpha: 0.25),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            key: prevKey,
            tooltip: sequence.previousItem != null
                ? 'Música anterior: ${sequence.previousItem!.title}'
                : 'Música anterior',
            constraints: const BoxConstraints(
              minWidth: 44,
              minHeight: 44,
            ),
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.chevron_left_rounded, size: 22),
            onPressed: sequence.hasPrevious
                ? () => onSelectIndex(sequence.currentIndex - 1)
                : null,
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 6),
            child: Semantics(
              label: sequence.positionLabel,
              child: Text(
                sequence.positionLabel,
                key: labelKey,
                style: theme.textTheme.labelMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ),
          IconButton(
            key: nextKey,
            tooltip: sequence.nextItem != null
                ? 'Próxima música: ${sequence.nextItem!.title}'
                : 'Próxima música',
            constraints: const BoxConstraints(
              minWidth: 44,
              minHeight: 44,
            ),
            padding: EdgeInsets.zero,
            icon: const Icon(Icons.chevron_right_rounded, size: 22),
            onPressed: sequence.hasNext
                ? () => onSelectIndex(sequence.currentIndex + 1)
                : null,
          ),
        ],
      ),
    );
  }
}

typedef _OpenFullscreenCallback = Future<void> Function({
  required String? activeVersionId,
  required String? activeVersionName,
  required int selectedChordIndex,
});

class _SongDetailContent extends ConsumerStatefulWidget {
  final SongDetail song;
  final String ministryId;
  final String? initialVersionId;
  final int activeSlotKey;
  final bool isAdmin;
  final int semitones;
  final double fontSize;
  final int autoScrollSpeed;
  final ValueChanged<int> onSemitonesChanged;
  final ValueChanged<double> onFontSizeChanged;
  final ValueChanged<int> onAutoScrollSpeedChanged;
  final ValueChanged<String> onOpenLink;
  final ValueChanged<VoidCallback?>? onRegisterStopAutoScroll;
  final _OpenFullscreenCallback? onOpenFullscreen;

  const _SongDetailContent({
    required this.song,
    required this.ministryId,
    this.initialVersionId,
    this.activeSlotKey = 0,
    required this.isAdmin,
    required this.semitones,
    required this.fontSize,
    required this.autoScrollSpeed,
    required this.onSemitonesChanged,
    required this.onFontSizeChanged,
    required this.onAutoScrollSpeedChanged,
    required this.onOpenLink,
    this.onRegisterStopAutoScroll,
    this.onOpenFullscreen,
  });

  @override
  ConsumerState<_SongDetailContent> createState() => _SongDetailContentState();
}

class _SongDetailContentState extends ConsumerState<_SongDetailContent> {
  final ScrollController _scrollController = ScrollController();
  Timer? _autoScrollTimer;
  bool _isAutoScrolling = false;

  int _selectedVersionIndex = 0;
  int _selectedChordIndex = 0;
  String _readingMode = 'lyrics';
  bool _hadLinkedChords = false;
  bool _isUnlinkingChord = false;
  String? _classifyingChordId;

  int _resolveVersionIndex(List<SongVersion> versions, String? versionId) {
    final target = versionId?.trim();
    if (target == null || target.isEmpty) return 0;
    final idx = versions.indexWhere((v) => (v.id ?? '').trim() == target);
    return idx >= 0 ? idx : 0;
  }

  void _syncSmartChordsForActiveVersion({bool force = false}) {
    final versions = widget.song.effectiveVersions;
    if (versions.isEmpty) return;
    final idx = _selectedVersionIndex < versions.length ? _selectedVersionIndex : 0;
    final rawVersionId = versions[idx].id?.trim();
    final activeVersionId =
        (rawVersionId != null && rawVersionId.isNotEmpty) ? rawVersionId : null;
    if (activeVersionId == null) return;

    final current = ref.read(songSmartChordsNotifierProvider);
    if (force ||
        current.songId != widget.song.id ||
        current.ministryId != widget.ministryId ||
        current.versionId != activeVersionId) {
      ref.read(songSmartChordsNotifierProvider.notifier).load(
            widget.song.id,
            ministryId: widget.ministryId,
            versionId: activeVersionId,
            force: force,
          );
    }
  }

  @override
  void initState() {
    super.initState();
    widget.onRegisterStopAutoScroll?.call(_stopAutoScroll);
    _selectedVersionIndex = _resolveVersionIndex(
      widget.song.effectiveVersions,
      widget.initialVersionId,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        _syncSmartChordsForActiveVersion();
      }
    });
  }

  @override
  void dispose() {
    widget.onRegisterStopAutoScroll?.call(null);
    _autoScrollTimer?.cancel();
    _autoScrollTimer = null;
    _scrollController.dispose();
    super.dispose();
  }

  void _stopAutoScroll({bool updateState = true}) {
    _autoScrollTimer?.cancel();
    _autoScrollTimer = null;
    if (_isAutoScrolling && updateState && mounted) {
      setState(() => _isAutoScrolling = false);
    } else {
      _isAutoScrolling = false;
    }
  }

  void _toggleAutoScroll() {
    if (_isAutoScrolling) {
      _stopAutoScroll();
      return;
    }
    setState(() => _isAutoScrolling = true);
    _autoScrollTimer?.cancel();
    _autoScrollTimer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      if (!mounted || !_isAutoScrolling || !_scrollController.hasClients) {
        _stopAutoScroll();
        return;
      }
      final position = _scrollController.position;
      if (!position.hasContentDimensions) return;
      final nextOffset = _scrollController.offset + (0.8 * widget.autoScrollSpeed);
      if (nextOffset >= position.maxScrollExtent) {
        _scrollController.jumpTo(position.maxScrollExtent);
        _stopAutoScroll();
      } else {
        _scrollController.jumpTo(nextOffset);
      }
    });
  }

  @override
  void didUpdateWidget(covariant _SongDetailContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.song.id != widget.song.id ||
        oldWidget.initialVersionId != widget.initialVersionId ||
        oldWidget.activeSlotKey != widget.activeSlotKey ||
        oldWidget.ministryId != widget.ministryId) {
      _stopAutoScroll(updateState: false);
      if (_scrollController.hasClients) {
        _scrollController.jumpTo(0);
      }
      _selectedVersionIndex = _resolveVersionIndex(
        widget.song.effectiveVersions,
        widget.initialVersionId,
      );
      _selectedChordIndex = 0;
      _readingMode = 'lyrics';
      _hadLinkedChords = false;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _syncSmartChordsForActiveVersion(force: true);
        }
      });
    } else {
      final len = widget.song.effectiveVersions.length;
      if (_selectedVersionIndex >= len) {
        _selectedVersionIndex = 0;
      }
    }
  }

  Future<void> _associatePendingChord(
    SmartChord chord,
    String songId,
    String ministryId,
    String versionId,
    String versionName,
  ) async {
    setState(() => _classifyingChordId = chord.id);
    final ok = await ref
        .read(smartChordRepertoireLinkNotifierProvider.notifier)
        .setLink(
          ministryId: ministryId,
          chordId: chord.id,
          songId: songId,
          versionId: versionId,
        );
    if (!mounted) return;
    setState(() => _classifyingChordId = null);
    if (ok) {
      await ref.read(songSmartChordsNotifierProvider.notifier).load(
            songId,
            ministryId: ministryId,
            versionId: versionId,
            force: true,
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Cifra "${chord.title}" associada à versão $versionName.',
            ),
          ),
        );
      }
    } else {
      final err =
          ref.read(smartChordRepertoireLinkNotifierProvider).errorMessage ??
              'Não foi possível classificar a versão da cifra.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(err)),
      );
    }
  }

  Future<void> _confirmUnlinkChord(
    BuildContext context,
    SmartChord chord,
    String ministryId,
    String songId,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Desvincular cifra'),
        content: Text(
          'Deseja desvincular "${chord.title}" desta música do repertório? A sua cifra pessoal continuará salva em Minhas Cifras.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const ValueKey('confirm_unlink_smart_chord_button'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogCtx).colorScheme.error,
              foregroundColor: Theme.of(dialogCtx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(dialogCtx).pop(true),
            child: const Text('Desvincular'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _isUnlinkingChord = true);
    final success = await ref
        .read(smartChordRepertoireLinkNotifierProvider.notifier)
        .unlink(ministryId: ministryId, chordId: chord.id);
    if (!mounted) return;
    setState(() => _isUnlinkingChord = false);
    if (success) {
      ref.read(songSmartChordsNotifierProvider.notifier).removeChord(chord.id);
      setState(() {
        _selectedChordIndex = 0;
      });
      widget.onSemitonesChanged(0);
    } else {
      final err =
          ref.read(smartChordRepertoireLinkNotifierProvider).errorMessage ??
              'Não foi possível desvincular a cifra.';
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(err)),
        );
      }
    }
  }

  Future<void> _openSmartChordPicker(
    BuildContext context,
    SongDetail song,
    String ministryId,
    String? activeVersionId,
    String activeVersionName,
  ) async {
    final linked = await SmartChordPickerModal.show(
      context,
      ministryId: ministryId,
      songId: song.id,
      songTitle: song.title,
      versionId: activeVersionId,
      versionName: activeVersionName,
    );
    if (linked == true && context.mounted) {
      ref.read(songSmartChordsNotifierProvider.notifier).load(
            song.id,
            ministryId: ministryId,
            versionId: activeVersionId,
            force: true,
          );
    }
  }

  Future<void> _openNewSmartChordForm(
    BuildContext context,
    SongDetail song,
    String ministryId,
    String? activeVersionId,
    String activeVersionName,
    String? activeKey,
  ) async {
    final created = await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => SmartChordFormScreen(
          prefillSongId: song.id,
          prefillSongTitle: song.title,
          prefillVersionId: activeVersionId,
          prefillVersionName: activeVersionName,
          prefillArtistName: song.artistName,
          prefillKey: activeKey,
        ),
      ),
    );
    if (created != null && context.mounted) {
      ref.read(songSmartChordsNotifierProvider.notifier).load(
            song.id,
            ministryId: ministryId,
            versionId: activeVersionId,
            force: true,
          );
    }
  }

  Widget _buildStandControlPill(ThemeData theme, List<Widget> children) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: theme.colorScheme.surface.withValues(alpha: 0.8),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: theme.dividerColor.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: children,
      ),
    );
  }

  Widget _buildModeIconButton({
    required ThemeData theme,
    required Key buttonKey,
    required IconData icon,
    required String tooltip,
    required bool selected,
    required VoidCallback onPressed,
  }) {
    return Semantics(
      button: true,
      selected: selected,
      label: tooltip,
      child: IconButton(
        key: buttonKey,
        tooltip: tooltip,
        constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
        padding: EdgeInsets.zero,
        style: IconButton.styleFrom(
          backgroundColor: selected
              ? theme.colorScheme.primaryContainer
              : Colors.transparent,
          foregroundColor: selected
              ? theme.colorScheme.onPrimaryContainer
              : theme.colorScheme.onSurfaceVariant,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
        icon: Icon(icon, size: 19),
        onPressed: onPressed,
      ),
    );
  }

  ({String title, IconData icon, Color color}) _resolveLinkPresentation(
    SongLink link,
    ThemeData theme,
  ) {
    final lower = link.label.trim().toLowerCase();
    if (!link.isCustom) {
      if (lower == 'vídeo' || lower == 'video' || lower == 'youtube') {
        return (
          title: 'Vídeo no YouTube',
          icon: Icons.smart_display_rounded,
          color: Colors.red.shade700,
        );
      }
      if (lower == 'cifra') {
        return (
          title: 'Cifra / Partitura',
          icon: Icons.description_outlined,
          color: theme.colorScheme.primary,
        );
      }
      if (lower == 'áudio' || lower == 'audio') {
        return (
          title: 'Áudio de Referência',
          icon: Icons.headphones_outlined,
          color: theme.colorScheme.secondary,
        );
      }
      if (lower == 'letra' || lower == 'letras') {
        return (
          title: 'Letra Externa',
          icon: Icons.article_outlined,
          color: theme.colorScheme.tertiary,
        );
      }
    }
    return (
      title: link.label.trim().isNotEmpty ? link.label.trim() : 'Link Externo',
      icon: Icons.link,
      color: theme.colorScheme.primary,
    );
  }

  @override
  Widget build(BuildContext context) {
    final song = widget.song;
    final ministryId = widget.ministryId;
    final onOpenLink = widget.onOpenLink;
    final theme = Theme.of(context);

    final versions = song.effectiveVersions;
    final activeIndex =
        _selectedVersionIndex < versions.length ? _selectedVersionIndex : 0;
    final activeVersion = versions[activeIndex];
    final activeVersionId =
        (activeVersion.id != null && activeVersion.id!.trim().isNotEmpty)
            ? activeVersion.id!.trim()
            : null;

    final activeKey =
        (activeVersion.key != null && activeVersion.key!.trim().isNotEmpty)
            ? activeVersion.key!.trim()
            : null;
    final activeBpm = activeVersion.bpm;
    final activeDuration = (activeVersion.duration != null &&
            activeVersion.duration!.trim().isNotEmpty)
        ? activeVersion.duration!.trim()
        : null;
    final activeVersionNotes =
        (activeVersion.notes != null && activeVersion.notes!.trim().isNotEmpty)
            ? activeVersion.notes!.trim()
            : null;
    final activeLinks = activeVersion.links
        .where((l) => l.url.trim().isNotEmpty)
        .toList();

    // Resolve classifications for active version
    final listClassifications =
        ref.watch(repertoireListNotifierProvider).availableClassifications;
    final formClassifications =
        ref.watch(songFormNotifierProvider).classifications;

    final resolvedClassifications = <({String id, String name, Color color})>[];
    if (activeVersion.classificationIds.isNotEmpty) {
      for (final cId in activeVersion.classificationIds) {
        if (song.classification != null && song.classification!.id == cId) {
          resolvedClassifications.add((
            id: cId,
            name: song.classification!.name,
            color:
                song.classification!.displayColor ?? theme.colorScheme.primary,
          ));
          continue;
        }
        final found = listClassifications
                .where((c) => c.id == cId)
                .firstOrNull ??
            formClassifications.where((c) => c.id == cId).firstOrNull;
        if (found != null) {
          resolvedClassifications.add((
            id: found.id,
            name: found.name,
            color: found.displayColor ?? theme.colorScheme.primary,
          ));
        }
      }
    } else if (activeIndex == 0 && song.classification != null) {
      resolvedClassifications.add((
        id: song.classification!.id,
        name: song.classification!.name,
        color: song.classification!.displayColor ?? theme.colorScheme.primary,
      ));
    }

    return SingleChildScrollView(
      controller: _scrollController,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Header: Title & Artist
          Text(
            song.title,
            style: theme.textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
              letterSpacing: -0.5,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            song.displayArtist,
            style: theme.textTheme.titleMedium?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
            ),
          ),
          const SizedBox(height: 16),

          // Versions Selector Chips
          if (versions.isNotEmpty) ...[
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  Icon(
                    Icons.layers_outlined,
                    size: 16,
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    'Versão:',
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                  ),
                  const SizedBox(width: 8),
                  for (int i = 0; i < versions.length; i++) ...[
                    if (i > 0) const SizedBox(width: 8),
                    ChoiceChip(
                      key: ValueKey(
                        'detail_version_chip_${versions[i].id ?? i}',
                      ),
                      label: Text(versions[i].name),
                      selected: activeIndex == i,
                      onSelected: (_) {
                        final selectedVerId = versions[i].id?.trim();
                        setState(() {
                          _selectedVersionIndex = i;
                          _selectedChordIndex = 0;
                        });
                        widget.onSemitonesChanged(0);
                        ref
                            .read(songSmartChordsNotifierProvider.notifier)
                            .load(
                              song.id,
                              ministryId: ministryId,
                              versionId: (selectedVerId != null &&
                                      selectedVerId.isNotEmpty)
                                  ? selectedVerId
                                  : null,
                              force: true,
                            );
                      },
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 12),
          ],

          if ((widget.initialVersionId?.trim().isNotEmpty ?? false) &&
              versions.isNotEmpty &&
              !versions.any(
                (v) =>
                    (v.id ?? '').trim() == widget.initialVersionId!.trim(),
              )) ...[
            Container(
              key: const ValueKey('song_detail_version_fallback_banner'),
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: theme.colorScheme.secondaryContainer
                    .withValues(alpha: 0.45),
                borderRadius: BorderRadius.circular(10),
                border: Border.all(
                  color: theme.colorScheme.outlineVariant,
                ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    Icons.info_outline,
                    size: 18,
                    color: theme.colorScheme.onSecondaryContainer,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'A versão vinculada anteriormente não foi encontrada; exibindo "${activeVersion.name}".',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSecondaryContainer,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],

          // Metadata Chips / Badges for Active Version
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (activeKey != null)
                Chip(
                  avatar: const Icon(Icons.music_note, size: 16),
                  label: Text('Tom: $activeKey'),
                  backgroundColor:
                      theme.colorScheme.primary.withValues(alpha: 0.1),
                  side: BorderSide.none,
                ),
              if (activeBpm != null)
                Chip(
                  avatar: const Icon(Icons.speed, size: 16),
                  label: Text(activeBpm is num ? '$activeBpm BPM' : '$activeBpm'),
                  backgroundColor: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                  side: BorderSide.none,
                ),
              if (activeDuration != null)
                Chip(
                  avatar: const Icon(Icons.timer_outlined, size: 16),
                  label: Text(activeDuration),
                  backgroundColor: theme.colorScheme.surfaceContainerHighest
                      .withValues(alpha: 0.6),
                  side: BorderSide.none,
                ),
              for (final cls in resolvedClassifications)
                Chip(
                  avatar: Icon(Icons.label_outline, size: 16, color: cls.color),
                  label: Text(
                    cls.name,
                    style: TextStyle(
                      color: cls.color,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  backgroundColor: cls.color.withValues(alpha: 0.12),
                  side: BorderSide(
                    color: cls.color.withValues(alpha: 0.3),
                    width: 0.8,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),

          // Active Version Notes
          if (activeVersionNotes != null) ...[
            Text(
              'Observações da Versão (${activeVersion.name})',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            Card(
              elevation: 0,
              color: theme.colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.3),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: SelectableText(
                  activeVersionNotes,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    height: 1.5,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 20),
          ],

          // External Links / Resources for Active Version
          if (activeLinks.isNotEmpty) ...[
            Text(
              'Links e Recursos',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: Column(
                children: [
                  for (int i = 0; i < activeLinks.length; i++) ...[
                    if (i > 0) const Divider(height: 1),
                    Builder(
                      builder: (context) {
                        final link = activeLinks[i];
                        final pres = _resolveLinkPresentation(link, theme);
                        return ListTile(
                          leading: Icon(pres.icon, color: pres.color),
                          title: Text(pres.title),
                          subtitle: Text(
                            link.url,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12),
                          ),
                          trailing: const Icon(Icons.open_in_new, size: 18),
                          onTap: () => onOpenLink(link.url),
                        );
                      },
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 24),
          ],

          // Smart Chords Section & D1 Compact Music Stand Bar
          Builder(
            builder: (context) {
              final smartChordsState =
                  ref.watch(songSmartChordsNotifierProvider);
              final chordsMatchSong = smartChordsState.songId == song.id &&
                  smartChordsState.ministryId == ministryId &&
                  (activeVersionId == null ||
                      smartChordsState.versionId == activeVersionId);
              final chords = chordsMatchSong
                  ? smartChordsState.items
                  : const <SmartChord>[];
              final authUser = ref.watch(authNotifierProvider).user;
              final currentUserId = authUser?.id.trim();
              final canManageMinistryChords = widget.isAdmin &&
                  currentUserId != null &&
                  currentUserId.isNotEmpty;

              bool canModifyChord(SmartChord? chord) {
                if (!canManageMinistryChords || chord == null) return false;
                final ownerId = chord.userId.trim();
                if (ownerId.isEmpty) {
                  return false;
                }
                return ownerId == currentUserId;
              }

              final pendingChords = (!chordsMatchSong || !canManageMinistryChords)
                  ? const <SmartChord>[]
                  : smartChordsState.pendingItems
                      .where((c) => canModifyChord(c))
                      .toList();
              final isLoadingChords =
                  smartChordsState.isLoading || !chordsMatchSong;

              if (chords.isNotEmpty && !_hadLinkedChords) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted) {
                    setState(() {
                      _hadLinkedChords = true;
                      _readingMode = 'cifra';
                    });
                  }
                });
              } else if (!isLoadingChords && chords.isEmpty && _hadLinkedChords) {
                WidgetsBinding.instance.addPostFrameCallback((_) {
                  if (mounted) {
                    setState(() {
                      _hadLinkedChords = false;
                      _readingMode = 'lyrics';
                      _selectedChordIndex = 0;
                    });
                    if (widget.semitones != 0) {
                      widget.onSemitonesChanged(0);
                    }
                  }
                });
              }

              if (!canManageMinistryChords &&
                  !isLoadingChords &&
                  chords.isEmpty) {
                return const SizedBox.shrink();
              }

              final effectiveMode = chords.isEmpty ? 'lyrics' : _readingMode;
              final activeChordIndex =
                  _selectedChordIndex < chords.length ? _selectedChordIndex : 0;
              final activeChord =
                  chords.isNotEmpty ? chords[activeChordIndex] : null;
              final canModifyActiveChord = canModifyChord(activeChord);
              final transposedChordKey = activeChord != null
                  ? SmartChordParser.transposeKey(
                      activeChord.originalKey,
                      widget.semitones,
                    )
                  : null;
              final fontConfig =
                  ChordFontFamilyResolver.resolve(authUser?.chordFontFamily);
              final lineSpacingPx = (authUser?.chordLineSpacingPx ??
                      AuthUser.defaultChordLineSpacingPx)
                  .toDouble();

              return Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (canManageMinistryChords) ...[
                    Row(
                      children: [
                        Icon(
                          Icons.queue_music_outlined,
                          size: 18,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Cifras Inteligentes',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        IconButton(
                          tooltip: 'Vincular cifra existente',
                          constraints: const BoxConstraints(
                            minWidth: 44,
                            minHeight: 44,
                          ),
                          icon: const Icon(Icons.link, size: 20),
                          onPressed: () => _openSmartChordPicker(
                            context,
                            song,
                            ministryId,
                            activeVersionId,
                            activeVersion.name,
                          ),
                        ),
                        IconButton(
                          tooltip: 'Nova Cifra para esta música',
                          constraints: const BoxConstraints(
                            minWidth: 44,
                            minHeight: 44,
                          ),
                          icon:
                              const Icon(Icons.add_circle_outline, size: 20),
                          onPressed: () => _openNewSmartChordForm(
                            context,
                            song,
                            ministryId,
                            activeVersionId,
                            activeVersion.name,
                            activeKey,
                          ),
                        ),
                      ],
                    ),
                  ],
                  if (pendingChords.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Container(
                      key: const ValueKey(
                        'song_detail_pending_classification_banner',
                      ),
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.tertiaryContainer
                            .withValues(alpha: 0.4),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(
                          color: theme.colorScheme.tertiary
                              .withValues(alpha: 0.35),
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            children: [
                              Icon(
                                Icons.warning_amber_rounded,
                                size: 18,
                                color: theme.colorScheme.onTertiaryContainer,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  'Cifras aguardando classificação de versão',
                                  style: theme.textTheme.labelLarge?.copyWith(
                                    fontWeight: FontWeight.bold,
                                    color:
                                        theme.colorScheme.onTertiaryContainer,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          for (final pending in pendingChords)
                            Padding(
                              padding: const EdgeInsets.only(top: 6),
                              child: Wrap(
                                spacing: 8,
                                runSpacing: 6,
                                alignment: WrapAlignment.spaceBetween,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Text(
                                    '${pending.title} (${pending.originalKey})',
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      fontWeight: FontWeight.w600,
                                      color:
                                          theme.colorScheme.onTertiaryContainer,
                                    ),
                                  ),
                                  if (activeVersionId != null)
                                    FilledButton.tonalIcon(
                                      key: ValueKey(
                                        'song_detail_classify_pending_${pending.id}',
                                      ),
                                      style: FilledButton.styleFrom(
                                        minimumSize: const Size(44, 44),
                                      ),
                                      onPressed: _classifyingChordId ==
                                              pending.id
                                          ? null
                                          : () => _associatePendingChord(
                                                pending,
                                                song.id,
                                                ministryId,
                                                activeVersionId,
                                                activeVersion.name,
                                              ),
                                      icon: const Icon(
                                        Icons.layers_outlined,
                                        size: 16,
                                      ),
                                      label: Text(
                                        'Associar à ${activeVersion.name}',
                                      ),
                                    ),
                                ],
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                  const SizedBox(height: 6),
                  if (isLoadingChords && chords.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 8.0),
                      child: Center(
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    )
                  else if (chords.isNotEmpty && activeChord != null) ...[
                    // D1 Compact Music Stand Bar
                    Card(
                      key: const ValueKey('song_detail_music_stand_bar'),
                      elevation: 0,
                      margin: EdgeInsets.zero,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(
                          color: theme.dividerColor.withValues(alpha: 0.25),
                        ),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 10,
                          vertical: 8,
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            // Linha 1: Alternância compacta Cifra/Letra + indicador discreto versão/tom + ações compactas
                            Row(
                              children: [
                                _buildStandControlPill(theme, [
                                  _buildModeIconButton(
                                    theme: theme,
                                    buttonKey: const ValueKey(
                                      'song_detail_view_mode_chord',
                                    ),
                                    icon: Icons.music_note_rounded,
                                    tooltip: 'Cifra Inteligente',
                                    selected: effectiveMode == 'cifra',
                                    onPressed: () =>
                                        setState(() => _readingMode = 'cifra'),
                                  ),
                                  _buildModeIconButton(
                                    theme: theme,
                                    buttonKey: const ValueKey(
                                      'song_detail_view_mode_lyrics',
                                    ),
                                    icon: Icons.article_outlined,
                                    tooltip: 'Apenas Letra',
                                    selected: effectiveMode == 'lyrics',
                                    onPressed: () {
                                      _stopAutoScroll(updateState: false);
                                      setState(() {
                                        _isAutoScrolling = false;
                                        _readingMode = 'lyrics';
                                      });
                                    },
                                  ),
                                ]),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Tooltip(
                                    message:
                                        'Versão: ${activeVersion.name} • ${activeChord.title} (Original: ${activeChord.originalKey})',
                                    child: Text(
                                      '${activeVersion.name} • Tom: $transposedChordKey${widget.semitones != 0 ? ' (${widget.semitones > 0 ? '+${widget.semitones}' : '${widget.semitones}'})' : ''}',
                                      key: const ValueKey(
                                        'song_detail_chord_key_readout',
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                      style:
                                          theme.textTheme.bodySmall?.copyWith(
                                        fontWeight: FontWeight.w700,
                                        color: widget.semitones != 0
                                            ? theme.colorScheme.primary
                                            : theme.colorScheme.onSurfaceVariant,
                                      ),
                                    ),
                                  ),
                                ),
                                if (canModifyActiveChord) ...[
                                  IconButton(
                                    key: const ValueKey(
                                      'song_detail_open_smart_chord_button',
                                    ),
                                    tooltip: 'Abrir no Cifrador',
                                    constraints: const BoxConstraints(
                                      minWidth: 44,
                                      minHeight: 44,
                                    ),
                                    padding: EdgeInsets.zero,
                                    icon: const Icon(
                                      Icons.open_in_new_rounded,
                                      size: 19,
                                    ),
                                    onPressed: () async {
                                      await Navigator.of(context).push(
                                        MaterialPageRoute(
                                          builder: (_) =>
                                              SmartChordReaderScreen(
                                            chordId: activeChord.id,
                                            initialChord: activeChord,
                                          ),
                                        ),
                                      );
                                      if (context.mounted) {
                                        ref
                                            .read(
                                              songSmartChordsNotifierProvider
                                                  .notifier,
                                            )
                                            .load(
                                              song.id,
                                              ministryId: ministryId,
                                              versionId: activeVersionId,
                                              force: true,
                                            );
                                      }
                                    },
                                  ),
                                  PopupMenuButton<String>(
                                    key: const ValueKey(
                                      'song_detail_chord_options_menu',
                                    ),
                                    tooltip: 'Opções da cifra',
                                    icon: const Icon(
                                      Icons.more_vert_rounded,
                                      size: 20,
                                    ),
                                    padding: EdgeInsets.zero,
                                    constraints: const BoxConstraints(
                                      minWidth: 44,
                                      minHeight: 44,
                                    ),
                                    onSelected: (value) {
                                      if (value == 'unlink' &&
                                          !_isUnlinkingChord) {
                                        _confirmUnlinkChord(
                                          context,
                                          activeChord,
                                          ministryId,
                                          song.id,
                                        );
                                      }
                                    },
                                    itemBuilder: (_) => [
                                      PopupMenuItem<String>(
                                        key: const ValueKey(
                                          'song_detail_unlink_smart_chord_button',
                                        ),
                                        value: 'unlink',
                                        enabled: !_isUnlinkingChord,
                                        child: Row(
                                          children: [
                                            Icon(
                                              Icons.link_off,
                                              size: 18,
                                              color: theme.colorScheme.error,
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              _isUnlinkingChord
                                                  ? 'Desvinculando...'
                                                  : 'Desvincular',
                                              style: TextStyle(
                                                color: theme.colorScheme.error,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    ],
                                  ),
                                ],
                              ],
                            ),
                            if (chords.length > 1) ...[
                              const SizedBox(height: 6),
                              SingleChildScrollView(
                                scrollDirection: Axis.horizontal,
                                child: Row(
                                  children: [
                                    for (int i = 0; i < chords.length; i++) ...[
                                      if (i > 0) const SizedBox(width: 6),
                                      ChoiceChip(
                                        key: ValueKey(
                                          'song_detail_chord_pill_${chords[i].id}',
                                        ),
                                        materialTapTargetSize:
                                            MaterialTapTargetSize.padded,
                                        label: Text(
                                          '${chords[i].title} (${chords[i].originalKey})',
                                        ),
                                        selected: activeChordIndex == i,
                                        onSelected: (_) {
                                          setState(() {
                                            _selectedChordIndex = i;
                                          });
                                          widget.onSemitonesChanged(0);
                                        },
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                            ],
                            if (effectiveMode == 'cifra') ...[
                              const SizedBox(height: 8),
                              SingleChildScrollView(
                                scrollDirection: Axis.horizontal,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    _buildStandControlPill(theme, [
                                      IconButton(
                                        key: const ValueKey(
                                          'song_detail_transpose_down_button',
                                        ),
                                        tooltip: 'Meio tom abaixo',
                                        constraints: const BoxConstraints(
                                          minWidth: 44,
                                          minHeight: 44,
                                        ),
                                        padding: EdgeInsets.zero,
                                        icon:
                                            const Icon(Icons.remove, size: 18),
                                        onPressed: () =>
                                            widget.onSemitonesChanged(
                                          widget.semitones - 1,
                                        ),
                                      ),
                                      if (widget.semitones != 0)
                                        IconButton(
                                          key: const ValueKey(
                                            'song_detail_transpose_reset_button',
                                          ),
                                          tooltip:
                                              'Restaurar tom original (${activeChord.originalKey})',
                                          constraints: const BoxConstraints(
                                            minWidth: 44,
                                            minHeight: 44,
                                          ),
                                          padding: EdgeInsets.zero,
                                          icon: Icon(
                                            Icons.restart_alt_rounded,
                                            size: 18,
                                            color: theme.colorScheme.primary,
                                          ),
                                          onPressed: () =>
                                              widget.onSemitonesChanged(0),
                                        ),
                                      IconButton(
                                        key: const ValueKey(
                                          'song_detail_transpose_up_button',
                                        ),
                                        tooltip: 'Meio tom acima',
                                        constraints: const BoxConstraints(
                                          minWidth: 44,
                                          minHeight: 44,
                                        ),
                                        padding: EdgeInsets.zero,
                                        icon: const Icon(Icons.add, size: 18),
                                        onPressed: () =>
                                            widget.onSemitonesChanged(
                                          widget.semitones + 1,
                                        ),
                                      ),
                                    ]),
                                    const SizedBox(width: 6),
                                    _buildStandControlPill(theme, [
                                      IconButton(
                                        key: const ValueKey(
                                          'song_detail_zoom_out_button',
                                        ),
                                        tooltip: 'Diminuir fonte',
                                        constraints: const BoxConstraints(
                                          minWidth: 44,
                                          minHeight: 44,
                                        ),
                                        padding: EdgeInsets.zero,
                                        icon: const Icon(
                                          Icons.text_decrease,
                                          size: 18,
                                        ),
                                        onPressed: widget.fontSize > 11.0
                                            ? () => widget.onFontSizeChanged(
                                                  (widget.fontSize - 1.0)
                                                      .clamp(11.0, 24.0),
                                                )
                                            : null,
                                      ),
                                      Padding(
                                        padding: const EdgeInsets.symmetric(
                                          horizontal: 2,
                                        ),
                                        child: Text(
                                          '${widget.fontSize.round()}px',
                                          key: const ValueKey(
                                            'song_detail_font_size_label',
                                          ),
                                          style: theme.textTheme.labelSmall
                                              ?.copyWith(
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ),
                                      IconButton(
                                        key: const ValueKey(
                                          'song_detail_zoom_in_button',
                                        ),
                                        tooltip: 'Aumentar fonte',
                                        constraints: const BoxConstraints(
                                          minWidth: 44,
                                          minHeight: 44,
                                        ),
                                        padding: EdgeInsets.zero,
                                        icon: const Icon(
                                          Icons.text_increase,
                                          size: 18,
                                        ),
                                        onPressed: widget.fontSize < 24.0
                                            ? () => widget.onFontSizeChanged(
                                                  (widget.fontSize + 1.0)
                                                      .clamp(11.0, 24.0),
                                                )
                                            : null,
                                      ),
                                    ]),
                                    const SizedBox(width: 6),
                                    _buildStandControlPill(theme, [
                                      IconButton.filledTonal(
                                        key: const ValueKey(
                                          'song_detail_autoscroll_toggle_button',
                                        ),
                                        tooltip: _isAutoScrolling
                                            ? 'Pausar rolagem'
                                            : 'Rolagem automática',
                                        constraints: const BoxConstraints(
                                          minWidth: 44,
                                          minHeight: 44,
                                        ),
                                        padding: EdgeInsets.zero,
                                        icon: Icon(
                                          _isAutoScrolling
                                              ? Icons.pause_rounded
                                              : Icons.play_arrow_rounded,
                                          size: 18,
                                        ),
                                        onPressed: _toggleAutoScroll,
                                      ),
                                      IconButton(
                                        key: const ValueKey(
                                          'song_detail_autoscroll_speed_button',
                                        ),
                                        tooltip:
                                            'Velocidade da rolagem (${widget.autoScrollSpeed}x)',
                                        constraints: const BoxConstraints(
                                          minWidth: 44,
                                          minHeight: 44,
                                        ),
                                        padding: EdgeInsets.zero,
                                        onPressed: () =>
                                            widget.onAutoScrollSpeedChanged(
                                          widget.autoScrollSpeed >= 5
                                              ? 1
                                              : widget.autoScrollSpeed + 1,
                                        ),
                                        icon: Text(
                                          '${widget.autoScrollSpeed}x',
                                          style: theme.textTheme.labelMedium
                                              ?.copyWith(
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ),
                                    ]),
                                    const SizedBox(width: 6),
                                    IconButton.outlined(
                                      key: const ValueKey(
                                        'song_detail_fullscreen_button',
                                      ),
                                      tooltip: 'Tela cheia',
                                      constraints: const BoxConstraints(
                                        minWidth: 44,
                                        minHeight: 44,
                                      ),
                                      padding: EdgeInsets.zero,
                                      icon: const Icon(
                                        Icons.fullscreen_rounded,
                                        size: 20,
                                      ),
                                      onPressed: () {
                                        _stopAutoScroll();
                                        widget.onOpenFullscreen?.call(
                                          activeVersionId: activeVersionId,
                                          activeVersionName: activeVersion.name,
                                          selectedChordIndex: activeChordIndex,
                                        );
                                      },
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    if (effectiveMode == 'cifra') ...[
                      const SizedBox(height: 10),
                      Container(
                        key: const ValueKey('song_detail_inline_chord_sheet'),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.surfaceContainerHighest
                              .withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(14),
                          border: Border.all(
                            color: theme.dividerColor.withValues(alpha: 0.25),
                          ),
                        ),
                        child: Builder(
                          builder: (_) {
                            final inlineLines = activeChord.content
                                .replaceAll('\r\n', '\n')
                                .replaceAll('\r', '\n')
                                .split('\n');
                            return Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                for (int i = 0; i < inlineLines.length; i++)
                                  Padding(
                                    padding:
                                        EdgeInsets.only(bottom: lineSpacingPx),
                                    child: SmartChordParser.progressionTokens(
                                              inlineLines[i],
                                            ) !=
                                            null
                                        ? MusicalProgressionLine(
                                            line: inlineLines[i],
                                            semitones: widget.semitones,
                                            fontSize: widget.fontSize,
                                            fontFamily: fontConfig.fontFamily,
                                            fontFamilyFallback:
                                                fontConfig.fallback,
                                          )
                                        : ChordLyricLine(
                                            line: inlineLines[i],
                                            semitones: widget.semitones,
                                            fontSize: widget.fontSize,
                                            fontFamily: fontConfig.fontFamily,
                                            fontFamilyFallback:
                                                fontConfig.fallback,
                                            monospace: fontConfig.isMonospace,
                                            spacingPx: lineSpacingPx,
                                            alignedLyrics: i > 0 &&
                                                SmartChordParser
                                                        .progressionTokens(
                                                      inlineLines[i - 1],
                                                    ) !=
                                                    null,
                                          ),
                                  ),
                              ],
                            );
                          },
                        ),
                      ),
                    ],
                  ] else if (canManageMinistryChords)
                    Card(
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(
                          color: theme.dividerColor.withValues(alpha: 0.2),
                        ),
                      ),
                      child: Column(
                        children: [
                          ListTile(
                            leading: Icon(
                              Icons.link,
                              color: theme.colorScheme.primary,
                            ),
                            title: const Text('Vincular cifra existente'),
                            subtitle: const Text(
                              'Conecte uma cifra pessoal ao repertório deste ministério',
                            ),
                            trailing: const Icon(Icons.chevron_right, size: 20),
                            onTap: () => _openSmartChordPicker(
                              context,
                              song,
                              ministryId,
                              activeVersionId,
                              activeVersion.name,
                            ),
                          ),
                          const Divider(height: 1),
                          ListTile(
                            leading: Icon(
                              Icons.add_circle_outline,
                              color: theme.colorScheme.primary,
                            ),
                            title: const Text(
                              'Cadastrar nova cifra inteligente',
                            ),
                            subtitle: const Text(
                              'Crie uma cifra com transposição dinâmica para esta música',
                            ),
                            trailing: const Icon(Icons.chevron_right, size: 20),
                            onTap: () => _openNewSmartChordForm(
                              context,
                              song,
                              ministryId,
                              activeVersionId,
                              activeVersion.name,
                              activeKey,
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 20),
                ],
              );
            },
          ),

          // General Song Notes Section
          if (song.hasNotes) ...[
            Text(
              'Observações',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 10),
            Card(
              elevation: 0,
              color: theme.colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.3),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
                side: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: SelectableText(
                  song.notes!,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    height: 1.5,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 24),
          ],

          // Lyrics Section
          if (song.hasLyrics) ...[
            Row(
              children: [
                Icon(
                  Icons.article_outlined,
                  size: 20,
                  color: theme.colorScheme.primary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    'Letra da Música',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(18.0),
              decoration: BoxDecoration(
                color: theme.colorScheme.surfaceContainerHighest
                    .withValues(alpha: 0.2),
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: SelectableText(
                song.lyrics!,
                style: theme.textTheme.bodyLarge?.copyWith(
                  height: 1.6,
                  letterSpacing: 0.2,
                  fontSize: widget.fontSize,
                ),
              ),
            ),
          ] else ...[
            Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 32.0),
                child: Text(
                  'Letra não cadastrada para esta música.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                    fontStyle: FontStyle.italic,
                  ),
                ),
              ),
            ),
          ],
          const SizedBox(height: 32),
        ],
      ),
    );
  }
}

class _SongFullscreenStandScreen extends ConsumerStatefulWidget {
  final ValueListenable<_FullscreenSessionContext> sessionListenable;
  final int initialSemitones;
  final double initialFontSize;
  final int initialAutoScrollSpeed;
  final ValueChanged<int> onSelectSequenceIndex;
  final ValueChanged<int>? onSemitonesChanged;
  final ValueChanged<double>? onFontSizeChanged;
  final ValueChanged<int>? onAutoScrollSpeedChanged;

  const _SongFullscreenStandScreen({
    required this.sessionListenable,
    required this.initialSemitones,
    required this.initialFontSize,
    required this.initialAutoScrollSpeed,
    required this.onSelectSequenceIndex,
    this.onSemitonesChanged,
    this.onFontSizeChanged,
    this.onAutoScrollSpeedChanged,
  });

  @override
  ConsumerState<_SongFullscreenStandScreen> createState() =>
      _SongFullscreenStandScreenState();
}

class _SongFullscreenStandScreenState
    extends ConsumerState<_SongFullscreenStandScreen> {
  final ScrollController _scrollController = ScrollController();
  Timer? _autoScrollTimer;
  bool _isAutoScrolling = false;
  late int _autoScrollSpeed;
  late double _fontSize;
  late int _semitones;
  late String _lastTrackKey;

  @override
  void initState() {
    super.initState();
    _fontSize = widget.initialFontSize;
    _semitones = widget.initialSemitones;
    _autoScrollSpeed = widget.initialAutoScrollSpeed;
    _lastTrackKey = widget.sessionListenable.value.trackKey;
    widget.sessionListenable.addListener(_onSessionChanged);
  }

  void _onSessionChanged() {
    final nextKey = widget.sessionListenable.value.trackKey;
    if (nextKey == _lastTrackKey) return;
    _lastTrackKey = nextKey;
    _stopAutoScroll(updateState: false);
    if (_scrollController.hasClients) {
      _scrollController.jumpTo(0);
    }
    if (mounted) {
      setState(() {
        _semitones = 0;
        _isAutoScrolling = false;
      });
    } else {
      _semitones = 0;
      _isAutoScrolling = false;
    }
  }

  @override
  void dispose() {
    widget.sessionListenable.removeListener(_onSessionChanged);
    _autoScrollTimer?.cancel();
    _autoScrollTimer = null;
    _scrollController.dispose();
    super.dispose();
  }

  void _stopAutoScroll({bool updateState = true}) {
    _autoScrollTimer?.cancel();
    _autoScrollTimer = null;
    if (_isAutoScrolling && updateState && mounted) {
      setState(() => _isAutoScrolling = false);
    } else {
      _isAutoScrolling = false;
    }
  }

  void _toggleAutoScroll() {
    if (_isAutoScrolling) {
      _stopAutoScroll();
      return;
    }
    setState(() => _isAutoScrolling = true);
    _autoScrollTimer?.cancel();
    _autoScrollTimer = Timer.periodic(const Duration(milliseconds: 50), (_) {
      if (!mounted || !_isAutoScrolling || !_scrollController.hasClients) {
        _stopAutoScroll();
        return;
      }
      final pos = _scrollController.position;
      if (!pos.hasContentDimensions) return;
      final next = _scrollController.offset + (0.8 * _autoScrollSpeed);
      if (next >= pos.maxScrollExtent) {
        _scrollController.jumpTo(pos.maxScrollExtent);
        _stopAutoScroll();
      } else {
        _scrollController.jumpTo(next);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final detailState = ref.watch(songDetailNotifierProvider);
    final smartChordsState = ref.watch(songSmartChordsNotifierProvider);
    final authUser = ref.watch(authNotifierProvider).user;
    final fontConfig = ChordFontFamilyResolver.resolve(authUser?.chordFontFamily);
    final lineSpacingPx =
        (authUser?.chordLineSpacingPx ?? AuthUser.defaultChordLineSpacingPx)
            .toDouble();

    return ValueListenableBuilder<_FullscreenSessionContext>(
      valueListenable: widget.sessionListenable,
      builder: (context, session, _) {
        final detailMatches = detailState.ministryId == session.ministryId &&
            detailState.songId == session.songId;
        final loadedSong =
            (detailMatches && detailState.error == null) ? detailState.song : null;
        final versions = loadedSong?.effectiveVersions ?? const <SongVersion>[];
        SongVersion? activeVersion;
        if (versions.isNotEmpty) {
          final targetVerId = session.versionId?.trim();
          final foundIdx = (targetVerId != null && targetVerId.isNotEmpty)
              ? versions.indexWhere((v) => (v.id ?? '').trim() == targetVerId)
              : 0;
          activeVersion = versions[foundIdx >= 0 ? foundIdx : 0];
        }
        final activeVersionId =
            (activeVersion?.id != null && activeVersion!.id!.trim().isNotEmpty)
                ? activeVersion.id!.trim()
                : session.versionId;
        final activeVersionName = activeVersion?.name ?? session.versionName;
        final chordsMatch = smartChordsState.ministryId == session.ministryId &&
            smartChordsState.songId == session.songId &&
            (activeVersionId == null ||
                smartChordsState.versionId == activeVersionId);
        final chords =
            chordsMatch ? smartChordsState.items : const <SmartChord>[];
        final safeChordIdx =
            session.selectedChordIndex < chords.length
                ? session.selectedChordIndex
                : 0;
        final activeChord =
            chords.isNotEmpty ? chords[safeChordIdx] : null;
        final isLoading = !detailMatches ||
            detailState.isLoading ||
            (!chordsMatch && smartChordsState.isLoading);
        final sequence = session.scheduleSequence;
        final hasSequence = sequence != null && sequence.isNotEmpty;
        final displayTitle = loadedSong?.title ?? session.title;
        final currentKey = activeChord != null
            ? SmartChordParser.transposeKey(activeChord.originalKey, _semitones)
            : ((activeVersion?.key != null &&
                    activeVersion!.key!.trim().isNotEmpty)
                ? activeVersion.key!.trim()
                : null);
        final screenWidth = MediaQuery.sizeOf(context).width;
        final horizontalPadding = screenWidth >= 700 ? 28.0 : 16.0;
        final bottomPadding = hasSequence ? 136.0 : 96.0;
        final lines = activeChord == null
            ? const <String>[]
            : activeChord.content
                .replaceAll('\r\n', '\n')
                .replaceAll('\r', '\n')
                .split('\n');

        return Scaffold(
          body: SafeArea(
            child: Stack(
              children: [
                Align(
                  alignment: Alignment.topCenter,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 900),
                    child: SingleChildScrollView(
                      key: const ValueKey('song_fullscreen_scroll_container'),
                      controller: _scrollController,
                      padding: EdgeInsets.fromLTRB(
                        horizontalPadding,
                        14,
                        horizontalPadding,
                        bottomPadding,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            '$displayTitle${currentKey != null ? ' • Tom: $currentKey' : ''}${_semitones != 0 && currentKey != null ? ' (${_semitones > 0 ? '+$_semitones' : '$_semitones'})' : ''}',
                            key: const ValueKey('song_fullscreen_header_title'),
                            textAlign: TextAlign.start,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          if (activeVersionName != null &&
                              activeVersionName.isNotEmpty) ...[
                            const SizedBox(height: 2),
                            Text(
                              'Versão: $activeVersionName',
                              textAlign: TextAlign.start,
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                          const SizedBox(height: 12),
                          if (isLoading)
                            const Padding(
                              padding: EdgeInsets.symmetric(vertical: 48),
                              child: Center(child: CircularProgressIndicator()),
                            )
                          else if (detailMatches && detailState.error != null)
                            Padding(
                              padding: const EdgeInsets.symmetric(vertical: 32),
                              child: Column(
                                children: [
                                  Icon(
                                    Icons.error_outline_rounded,
                                    size: 40,
                                    color: theme.colorScheme.error,
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    detailState.error!,
                                    textAlign: TextAlign.center,
                                    style: theme.textTheme.bodyLarge,
                                  ),
                                  const SizedBox(height: 12),
                                  FilledButton.icon(
                                    onPressed: () {
                                      ref
                                          .read(
                                            songDetailNotifierProvider.notifier,
                                          )
                                          .load(
                                            session.ministryId,
                                            session.songId,
                                          );
                                      ref
                                          .read(
                                            songSmartChordsNotifierProvider
                                                .notifier,
                                          )
                                          .load(
                                            session.songId,
                                            ministryId: session.ministryId,
                                            versionId: activeVersionId,
                                            force: true,
                                          );
                                    },
                                    icon: const Icon(Icons.refresh),
                                    label: const Text('Tentar novamente'),
                                  ),
                                ],
                              ),
                            )
                          else if (activeChord != null) ...[
                            for (int i = 0; i < lines.length; i++) ...[
                              SmartChordParser.progressionTokens(lines[i]) !=
                                      null
                                  ? MusicalProgressionLine(
                                      line: lines[i],
                                      semitones: _semitones,
                                      fontSize: _fontSize,
                                      fontFamily: fontConfig.fontFamily,
                                      fontFamilyFallback: fontConfig.fallback,
                                    )
                                  : ChordLyricLine(
                                      line: lines[i],
                                      semitones: _semitones,
                                      fontSize: _fontSize,
                                      fontFamily: fontConfig.fontFamily,
                                      fontFamilyFallback: fontConfig.fallback,
                                      monospace: fontConfig.isMonospace,
                                      spacingPx: lineSpacingPx,
                                      alignedLyrics: i > 0 &&
                                          SmartChordParser.progressionTokens(
                                                lines[i - 1],
                                              ) !=
                                              null,
                                    ),
                              SizedBox(height: lineSpacingPx),
                            ],
                          ] else if (loadedSong != null &&
                              loadedSong.hasLyrics) ...[
                            SelectableText(
                              loadedSong.lyrics!,
                              textAlign: TextAlign.start,
                              style: theme.textTheme.bodyLarge?.copyWith(
                                height: 1.6,
                                fontSize: _fontSize,
                              ),
                            ),
                          ] else ...[
                            Text(
                              'Nenhuma cifra ou letra cadastrada para esta música.',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                ),
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 12,
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 720),
                      child: Material(
                        key: const ValueKey('song_fullscreen_bottom_bar'),
                        elevation: 6,
                        borderRadius: BorderRadius.circular(24),
                        color: theme.colorScheme.surfaceContainerHigh,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 6,
                          ),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (hasSequence) ...[
                                _SequenceNavigationControls(
                                  sequence: sequence,
                                  onSelectIndex: widget.onSelectSequenceIndex,
                                  barKey: const ValueKey(
                                    'song_fullscreen_sequence_bar',
                                  ),
                                  prevKey: const ValueKey(
                                    'song_fullscreen_sequence_prev_button',
                                  ),
                                  nextKey: const ValueKey(
                                    'song_fullscreen_sequence_next_button',
                                  ),
                                  labelKey: const ValueKey(
                                    'song_fullscreen_sequence_position_label',
                                  ),
                                ),
                                const SizedBox(height: 6),
                              ],
                              SingleChildScrollView(
                                scrollDirection: Axis.horizontal,
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    IconButton(
                                      tooltip: 'Meio tom abaixo',
                                      constraints: const BoxConstraints(
                                        minWidth: 44,
                                        minHeight: 44,
                                      ),
                                      icon: const Icon(Icons.remove),
                                      onPressed: activeChord != null
                                          ? () {
                                              setState(() => _semitones--);
                                              widget.onSemitonesChanged
                                                  ?.call(_semitones);
                                            }
                                          : null,
                                    ),
                                    IconButton(
                                      tooltip: 'Meio tom acima',
                                      constraints: const BoxConstraints(
                                        minWidth: 44,
                                        minHeight: 44,
                                      ),
                                      icon: const Icon(Icons.add),
                                      onPressed: activeChord != null
                                          ? () {
                                              setState(() => _semitones++);
                                              widget.onSemitonesChanged
                                                  ?.call(_semitones);
                                            }
                                          : null,
                                    ),
                                    IconButton(
                                      tooltip: 'Diminuir zoom',
                                      constraints: const BoxConstraints(
                                        minWidth: 44,
                                        minHeight: 44,
                                      ),
                                      icon: const Icon(Icons.text_decrease),
                                      onPressed: () {
                                        setState(
                                          () => _fontSize = (_fontSize - 1.0)
                                              .clamp(11.0, 24.0),
                                        );
                                        widget.onFontSizeChanged
                                            ?.call(_fontSize);
                                      },
                                    ),
                                    IconButton(
                                      tooltip: 'Aumentar zoom',
                                      constraints: const BoxConstraints(
                                        minWidth: 44,
                                        minHeight: 44,
                                      ),
                                      icon: const Icon(Icons.text_increase),
                                      onPressed: () {
                                        setState(
                                          () => _fontSize = (_fontSize + 1.0)
                                              .clamp(11.0, 24.0),
                                        );
                                        widget.onFontSizeChanged
                                            ?.call(_fontSize);
                                      },
                                    ),
                                    IconButton(
                                      key: const ValueKey(
                                        'song_fullscreen_autoscroll_button',
                                      ),
                                      tooltip: _isAutoScrolling
                                          ? 'Pausar rolagem'
                                          : 'Rolagem automática',
                                      constraints: const BoxConstraints(
                                        minWidth: 44,
                                        minHeight: 44,
                                      ),
                                      icon: Icon(
                                        _isAutoScrolling
                                            ? Icons.pause_rounded
                                            : Icons.play_arrow_rounded,
                                      ),
                                      onPressed: _toggleAutoScroll,
                                    ),
                                    IconButton(
                                      tooltip:
                                          'Alternar velocidade (${_autoScrollSpeed}x)',
                                      constraints: const BoxConstraints(
                                        minWidth: 44,
                                        minHeight: 44,
                                      ),
                                      onPressed: () {
                                        setState(() {
                                          _autoScrollSpeed =
                                              _autoScrollSpeed >= 5
                                                  ? 1
                                                  : _autoScrollSpeed + 1;
                                        });
                                        widget.onAutoScrollSpeedChanged
                                            ?.call(_autoScrollSpeed);
                                      },
                                      icon: Text(
                                        '${_autoScrollSpeed}x',
                                        style: theme.textTheme.labelMedium
                                            ?.copyWith(
                                          fontWeight: FontWeight.bold,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 4),
                                    FilledButton.tonalIcon(
                                      key: const ValueKey(
                                        'song_fullscreen_exit_button',
                                      ),
                                      style: FilledButton.styleFrom(
                                        minimumSize: const Size(44, 44),
                                      ),
                                      onPressed: () =>
                                          Navigator.of(context).pop(),
                                      icon: const Icon(
                                        Icons.fullscreen_exit_rounded,
                                        size: 18,
                                      ),
                                      label: const Text('Sair'),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
