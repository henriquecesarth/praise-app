import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_failure.dart';
import '../../data/ministry_audio_download_manager.dart'
    show MinistryAudioDownloadContext;
import '../../data/ministry_audio_repository.dart';
import '../../domain/ministry_audio_models.dart';

final class MinistryAudioLibraryState {
  const MinistryAudioLibraryState({
    this.ministryId,
    this.query = '',
    this.items = const [],
    this.nextCursor,
    this.isLoading = false,
    this.isLoadingMore = false,
    this.errorMessage,
    this.loadMoreError,
    this.loaded = false,
  });

  /// Ministry the items belong to (never mixed with another one).
  final String? ministryId;
  final String query;

  /// Published recordings only.
  final List<MinistryAudioRecording> items;
  final String? nextCursor;
  final bool isLoading;
  final bool isLoadingMore;
  final String? errorMessage;
  final String? loadMoreError;
  final bool loaded;

  bool get hasMore => nextCursor != null;
  bool get isEmpty => loaded && items.isEmpty && errorMessage == null;

  MinistryAudioLibraryState copyWith({
    String? ministryId,
    String? query,
    List<MinistryAudioRecording>? items,
    String? nextCursor,
    bool clearCursor = false,
    bool? isLoading,
    bool? isLoadingMore,
    String? errorMessage,
    bool clearError = false,
    String? loadMoreError,
    bool clearLoadMoreError = false,
    bool? loaded,
  }) =>
      MinistryAudioLibraryState(
        ministryId: ministryId ?? this.ministryId,
        query: query ?? this.query,
        items: items ?? this.items,
        nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
        isLoading: isLoading ?? this.isLoading,
        isLoadingMore: isLoadingMore ?? this.isLoadingMore,
        errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
        loadMoreError:
            clearLoadMoreError ? null : (loadMoreError ?? this.loadMoreError),
        loaded: loaded ?? this.loaded,
      );
}

typedef MinistryAudioLibraryContext = MinistryAudioDownloadContext? Function();

/// Lists the published recordings of the active ministry.
///
/// Every response is checked against the epoch AND the auth/ministry context
/// stamp captured when the request started; a late page of an old query or
/// ministry is dropped, never shown.
class MinistryAudioLibraryController
    extends StateNotifier<MinistryAudioLibraryState> {
  MinistryAudioLibraryController({
    required MinistryAudioRepository repository,
    required MinistryAudioLibraryContext context,
    this.searchDebounce = const Duration(milliseconds: 350),
    this.pageSize = 20,
  })  : _repository = repository,
        _context = context,
        super(const MinistryAudioLibraryState());

  final MinistryAudioRepository _repository;
  final MinistryAudioLibraryContext _context;
  final Duration searchDebounce;
  final int pageSize;

  int _epoch = 0;
  Timer? _debounce;
  MinistryAudioDownloadContext? _captured;

  /// (Re)loads the first page for the current ministry.
  Future<void> load() async {
    _debounce?.cancel();
    final epoch = ++_epoch;
    final captured = _context();
    _captured = captured;
    if (captured == null) {
      _set(const MinistryAudioLibraryState());
      return;
    }
    final query = state.ministryId == captured.ministryId ? state.query : '';
    _set(MinistryAudioLibraryState(
      ministryId: captured.ministryId,
      query: query,
      isLoading: true,
    ));
    try {
      final page = await _repository.listRecordings(
        ministryId: captured.ministryId,
        query: query,
        limit: pageSize,
      );
      if (_stale(epoch, captured)) return;
      _set(state.copyWith(
        items: _playable(page.items),
        nextCursor: page.nextCursor,
        clearCursor: page.nextCursor == null,
        isLoading: false,
        loaded: true,
        clearError: true,
      ));
    } catch (e) {
      if (_stale(epoch, captured)) return;
      _set(state.copyWith(
        isLoading: false,
        loaded: true,
        items: const [],
        clearCursor: true,
        errorMessage: _message(e),
      ));
    }
  }

  Future<void> refresh() => load();

  /// Debounced search by title or artist.
  void setQuery(String value) {
    final q = value.trim();
    if (q == state.query && !state.isLoading) return;
    _set(state.copyWith(query: q));
    _debounce?.cancel();
    _debounce = Timer(searchDebounce, () => load());
  }

  Future<void> loadMore() async {
    final cursor = state.nextCursor;
    final captured = _captured;
    if (cursor == null ||
        captured == null ||
        state.isLoading ||
        state.isLoadingMore) {
      return;
    }
    final epoch = _epoch;
    _set(state.copyWith(isLoadingMore: true, clearLoadMoreError: true));
    try {
      final page = await _repository.listRecordings(
        ministryId: captured.ministryId,
        query: state.query,
        limit: pageSize,
        cursor: cursor,
      );
      if (_stale(epoch, captured)) return;
      final seen = state.items.map((e) => e.id).toSet();
      _set(state.copyWith(
        items: [
          ...state.items,
          for (final r in _playable(page.items))
            if (seen.add(r.id)) r,
        ],
        nextCursor: page.nextCursor,
        clearCursor: page.nextCursor == null,
        isLoadingMore: false,
      ));
    } catch (e) {
      if (_stale(epoch, captured)) return;
      _set(state.copyWith(isLoadingMore: false, loadMoreError: _message(e)));
    }
  }

  /// Auth/ministry may have changed: drop everything of the old context now
  /// and load the new one when there is one.
  void checkContext() {
    if (!mounted) return;
    final captured = _captured;
    if (captured == null && state.ministryId == null) return;
    if (_context() == captured) return;
    _epoch++;
    _debounce?.cancel();
    _captured = null;
    _set(const MinistryAudioLibraryState());
    if (_context() != null) unawaited(load());
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _epoch++;
    super.dispose();
  }

  // ------------------------------------------------------------- internals

  bool _stale(int epoch, MinistryAudioDownloadContext captured) =>
      !mounted || epoch != _epoch || _context() != captured;

  List<MinistryAudioRecording> _playable(List<MinistryAudioRecording> items) => [
        for (final r in items)
          if (r.status == MinistryAudioStatus.published) r,
      ];

  void _set(MinistryAudioLibraryState next) {
    if (mounted) state = next;
  }

  String _message(Object e) {
    if (e is AppFailure) {
      if (e.statusCode == 403) return 'Você não tem acesso a esta biblioteca.';
      if (e.statusCode == 404) return 'Biblioteca de áudio indisponível.';
      if (e.message.trim().isNotEmpty) return e.message;
    }
    return 'Não foi possível carregar as gravações. Verifique sua conexão.';
  }
}
