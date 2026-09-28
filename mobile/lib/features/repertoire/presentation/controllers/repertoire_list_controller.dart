import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/repertoire_repository.dart';
import '../../domain/classification.dart';
import '../../domain/song_summary.dart';

@immutable
class RepertoireListState {
  final String? ministryId;
  final bool isLoading;
  final bool isRefreshing;
  final bool isLoadingMore;
  final List<SongSummary> songs;
  final int total;
  final String? nextCursor;
  final bool hasMore;
  final int currentPage;
  final String searchQuery;
  final String? selectedClassificationId;
  final List<Classification> availableClassifications;
  final bool isLoadingClassifications;
  final String? error;

  const RepertoireListState({
    this.ministryId,
    this.isLoading = false,
    this.isRefreshing = false,
    this.isLoadingMore = false,
    this.songs = const [],
    this.total = 0,
    this.nextCursor,
    this.hasMore = false,
    this.currentPage = 1,
    this.searchQuery = '',
    this.selectedClassificationId,
    this.availableClassifications = const [],
    this.isLoadingClassifications = false,
    this.error,
  });

  bool get isFiltered =>
      searchQuery.trim().isNotEmpty || selectedClassificationId != null;

  bool get isEmptyState => !isLoading && error == null && songs.isEmpty;

  RepertoireListState copyWith({
    String? ministryId,
    bool? isLoading,
    bool? isRefreshing,
    bool? isLoadingMore,
    List<SongSummary>? songs,
    int? total,
    String? nextCursor,
    bool? hasMore,
    int? currentPage,
    String? searchQuery,
    String? selectedClassificationId,
    bool clearClassification = false,
    List<Classification>? availableClassifications,
    bool? isLoadingClassifications,
    String? error,
    bool clearError = false,
  }) {
    return RepertoireListState(
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      songs: songs ?? this.songs,
      total: total ?? this.total,
      nextCursor: nextCursor ?? this.nextCursor,
      hasMore: hasMore ?? this.hasMore,
      currentPage: currentPage ?? this.currentPage,
      searchQuery: searchQuery ?? this.searchQuery,
      selectedClassificationId: clearClassification
          ? null
          : (selectedClassificationId ?? this.selectedClassificationId),
      availableClassifications:
          availableClassifications ?? this.availableClassifications,
      isLoadingClassifications:
          isLoadingClassifications ?? this.isLoadingClassifications,
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is RepertoireListState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          isLoading == other.isLoading &&
          isRefreshing == other.isRefreshing &&
          isLoadingMore == other.isLoadingMore &&
          listEquals(songs, other.songs) &&
          total == other.total &&
          nextCursor == other.nextCursor &&
          hasMore == other.hasMore &&
          currentPage == other.currentPage &&
          searchQuery == other.searchQuery &&
          selectedClassificationId == other.selectedClassificationId &&
          listEquals(
              availableClassifications, other.availableClassifications) &&
          isLoadingClassifications == other.isLoadingClassifications &&
          error == other.error;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      isLoading.hashCode ^
      isRefreshing.hashCode ^
      isLoadingMore.hashCode ^
      Object.hashAll(songs) ^
      total.hashCode ^
      nextCursor.hashCode ^
      hasMore.hashCode ^
      currentPage.hashCode ^
      searchQuery.hashCode ^
      selectedClassificationId.hashCode ^
      Object.hashAll(availableClassifications) ^
      isLoadingClassifications.hashCode ^
      error.hashCode;
}

class RepertoireListNotifier extends StateNotifier<RepertoireListState> {
  final RepertoireRepository _repository;
  Timer? _debounceTimer;
  int _requestSequence = 0;

  RepertoireListNotifier({required RepertoireRepository repository})
      : _repository = repository,
        super(const RepertoireListState());

  @override
  void dispose() {
    _debounceTimer?.cancel();
    super.dispose();
  }

  /// Initial load or reload for [ministryId].
  /// Clears stale data immediately on ministry switch.
  Future<void> loadForMinistry(String ministryId) async {
    _debounceTimer?.cancel();
    _requestSequence++;
    final currentSeq = _requestSequence;

    if (state.ministryId != ministryId) {
      // Immediate state wipe for ministry isolation
      state = RepertoireListState(
        ministryId: ministryId,
        isLoading: true,
      );
    } else {
      state = state.copyWith(
        isLoading: true,
        clearError: true,
      );
    }

    // Parallel load of classifications and first page of songs
    _loadClassifications(ministryId);

    try {
      final response = await _repository.listSongs(
        ministryId,
        search: state.searchQuery.isNotEmpty ? state.searchQuery : null,
        classificationId: state.selectedClassificationId,
        page: 1,
      );

      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return; // stale response discarded
      }

      state = state.copyWith(
        songs: response.songs,
        total: response.total,
        nextCursor: response.nextCursor,
        hasMore: response.hasMore,
        currentPage: 1,
        isLoading: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: e.message,
      );
    } catch (e) {
      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: 'Não foi possível carregar o repertório.',
      );
    }
  }

  Future<void> _loadClassifications(String ministryId) async {
    try {
      final list = await _repository.listClassifications(ministryId);
      if (state.ministryId == ministryId) {
        state = state.copyWith(availableClassifications: list);
      }
    } catch (_) {
      // Non-fatal: list view continues without classification filter chips
    }
  }

  /// Debounced search query handler (300ms).
  void onSearchChanged(String query) {
    _debounceTimer?.cancel();
    final trimmed = query.trim();

    state = state.copyWith(searchQuery: query);

    if (trimmed.isEmpty) {
      _executeSearch('');
      return;
    }

    _debounceTimer = Timer(const Duration(milliseconds: 300), () {
      _executeSearch(trimmed);
    });
  }

  /// Clears search filter and restores normal song list.
  void clearSearch() {
    _debounceTimer?.cancel();
    state = state.copyWith(searchQuery: '');
    _executeSearch('');
  }

  /// Toggles or sets classification filter.
  void setClassificationFilter(String? classificationId) {
    _debounceTimer?.cancel();
    final newFilter = state.selectedClassificationId == classificationId
        ? null
        : classificationId;

    state = state.copyWith(
      selectedClassificationId: newFilter,
      clearClassification: newFilter == null,
    );

    _executeSearch(state.searchQuery);
  }

  Future<void> _executeSearch(String query) async {
    final ministryId = state.ministryId;
    if (ministryId == null) return;

    _requestSequence++;
    final currentSeq = _requestSequence;

    state = state.copyWith(
      isLoading: true,
      clearError: true,
    );

    try {
      final response = await _repository.listSongs(
        ministryId,
        search: query.isNotEmpty ? query : null,
        classificationId: state.selectedClassificationId,
        page: 1,
      );

      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return; // Stale search result discarded
      }

      state = state.copyWith(
        songs: response.songs,
        total: response.total,
        nextCursor: response.nextCursor,
        hasMore: response.hasMore,
        currentPage: 1,
        isLoading: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: e.message,
      );
    } catch (e) {
      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: 'Erro na busca de músicas.',
      );
    }
  }

  /// Loads next page of songs using nextCursor / page and deduplicates by ID.
  Future<void> loadMore() async {
    final ministryId = state.ministryId;
    if (ministryId == null ||
        !state.hasMore ||
        state.isLoadingMore ||
        state.isLoading ||
        state.isRefreshing) {
      return;
    }

    state = state.copyWith(isLoadingMore: true);
    final nextPage = state.currentPage + 1;

    try {
      final response = await _repository.listSongs(
        ministryId,
        search: state.searchQuery.trim().isNotEmpty
            ? state.searchQuery.trim()
            : null,
        classificationId: state.selectedClassificationId,
        cursor: state.nextCursor,
        page: nextPage,
      );

      if (state.ministryId != ministryId) return;

      // Deduplicate incoming songs against already loaded items
      final existingIds = state.songs.map((s) => s.id).toSet();
      final freshItems =
          response.songs.where((s) => !existingIds.contains(s.id)).toList();

      state = state.copyWith(
        songs: [...state.songs, ...freshItems],
        total: response.total,
        nextCursor: response.nextCursor,
        hasMore: response.hasMore,
        currentPage: nextPage,
        isLoadingMore: false,
      );
    } on AppFailure catch (e) {
      state = state.copyWith(
        isLoadingMore: false,
        error: e.message,
      );
    } catch (_) {
      state = state.copyWith(
        isLoadingMore: false,
        error: 'Não foi possível carregar mais músicas.',
      );
    }
  }

  /// Pull-to-refresh without wiping current list before new data arrives.
  Future<void> refresh() async {
    final ministryId = state.ministryId;
    if (ministryId == null || state.isRefreshing) return;

    state = state.copyWith(isRefreshing: true);
    _requestSequence++;
    final currentSeq = _requestSequence;

    try {
      final response = await _repository.listSongs(
        ministryId,
        search: state.searchQuery.trim().isNotEmpty
            ? state.searchQuery.trim()
            : null,
        classificationId: state.selectedClassificationId,
        page: 1,
      );

      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return;
      }

      state = state.copyWith(
        songs: response.songs,
        total: response.total,
        nextCursor: response.nextCursor,
        hasMore: response.hasMore,
        currentPage: 1,
        isRefreshing: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return;
      }
      state = state.copyWith(
        isRefreshing: false,
        error: e.message,
      );
    } catch (_) {
      if (_requestSequence != currentSeq || state.ministryId != ministryId) {
        return;
      }
      state = state.copyWith(
        isRefreshing: false,
        error: 'Não foi possível atualizar o repertório.',
      );
    }
  }

  /// Retry after error.
  Future<void> retry() async {
    final ministryId = state.ministryId;
    if (ministryId == null) return;
    await loadForMinistry(ministryId);
  }

  /// Resets notifier state.
  void reset() {
    _debounceTimer?.cancel();
    _requestSequence++;
    state = const RepertoireListState();
  }
}
