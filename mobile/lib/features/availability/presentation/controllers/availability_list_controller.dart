import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/availability_repository.dart';
import '../../domain/availability.dart';

@immutable
class AvailabilityListState {
  final String? ministryId;
  final bool isLoading;
  final bool isRefreshing;
  final bool isLoadingMore;
  final List<MemberAvailability> items;
  final String? nextCursor;
  final String? error;

  const AvailabilityListState({
    this.ministryId,
    this.isLoading = false,
    this.isRefreshing = false,
    this.isLoadingMore = false,
    this.items = const [],
    this.nextCursor,
    this.error,
  });

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  AvailabilityListState copyWith({
    String? ministryId,
    bool? isLoading,
    bool? isRefreshing,
    bool? isLoadingMore,
    List<MemberAvailability>? items,
    String? nextCursor,
    bool clearCursor = false,
    String? error,
    bool clearError = false,
  }) {
    return AvailabilityListState(
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      items: items ?? this.items,
      nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AvailabilityListState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          isLoading == other.isLoading &&
          isRefreshing == other.isRefreshing &&
          isLoadingMore == other.isLoadingMore &&
          listEquals(items, other.items) &&
          nextCursor == other.nextCursor &&
          error == other.error;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      isLoading.hashCode ^
      isRefreshing.hashCode ^
      isLoadingMore.hashCode ^
      Object.hashAll(items) ^
      nextCursor.hashCode ^
      error.hashCode;
}

class AvailabilityListNotifier extends StateNotifier<AvailabilityListState> {
  final AvailabilityRepository _repository;

  AvailabilityListNotifier({required AvailabilityRepository repository})
      : _repository = repository,
        super(const AvailabilityListState());

  /// Loads the first page of availability records for [ministryId].
  ///
  /// Immediately clears old data if [ministryId] is different to prevent
  /// cross-tenant data flashing.
  Future<void> loadForMinistry(String ministryId) async {
    if (state.ministryId != ministryId) {
      state = AvailabilityListState(
        ministryId: ministryId,
        isLoading: true,
      );
    } else {
      state = state.copyWith(
        isLoading: true,
        clearError: true,
      );
    }

    try {
      final response = await _repository.listMyAvailabilities(ministryId);

      // Stale response guard
      if (state.ministryId != ministryId) return;

      state = state.copyWith(
        isLoading: false,
        items: response.data,
        nextCursor: response.nextCursor,
        clearCursor: response.nextCursor == null,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoading: false,
        error: e.message,
      );
    } catch (e) {
      if (state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoading: false,
        error: 'Erro ao carregar indisponibilidades.',
      );
    }
  }

  /// Pull-to-refresh: reloads the first page, keeping current items visible during fetch.
  Future<void> refresh() async {
    final ministryId = state.ministryId;
    if (ministryId == null) return;

    state = state.copyWith(isRefreshing: true, clearError: true);

    try {
      final response = await _repository.listMyAvailabilities(ministryId);

      if (state.ministryId != ministryId) return;

      state = state.copyWith(
        isRefreshing: false,
        items: response.data,
        nextCursor: response.nextCursor,
        clearCursor: response.nextCursor == null,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (state.ministryId != ministryId) return;
      state = state.copyWith(
        isRefreshing: false,
        error: e.message,
      );
    } catch (e) {
      if (state.ministryId != ministryId) return;
      state = state.copyWith(
        isRefreshing: false,
        error: 'Erro ao atualizar indisponibilidades.',
      );
    }
  }

  /// Loads the next page using [nextCursor].
  /// Appends deduplicating defensively by ID.
  Future<void> loadMore() async {
    final ministryId = state.ministryId;
    final cursor = state.nextCursor;
    if (ministryId == null ||
        cursor == null ||
        state.isLoadingMore ||
        state.isLoading) {
      return;
    }

    state = state.copyWith(isLoadingMore: true);

    try {
      final response = await _repository.listMyAvailabilities(
        ministryId,
        cursor: cursor,
      );

      if (state.ministryId != ministryId) return;

      // Defensive deduplication by ID
      final existingIds = state.items.map((i) => i.id).toSet();
      final newItems =
          response.data.where((i) => !existingIds.contains(i.id)).toList();

      state = state.copyWith(
        isLoadingMore: false,
        items: [...state.items, ...newItems],
        nextCursor: response.nextCursor,
        clearCursor: response.nextCursor == null,
      );
    } on AppFailure catch (e) {
      if (state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoadingMore: false,
        error: e.message,
      );
    } catch (_) {
      if (state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoadingMore: false,
        error: 'Erro ao carregar mais indisponibilidades.',
      );
    }
  }

  /// Adds a newly created authoritative server record to local state.
  void addCreated(MemberAvailability item) {
    if (item.ministryId != state.ministryId) return;
    state = state.copyWith(
      items: [item, ...state.items.where((i) => i.id != item.id)],
    );
  }

  /// Replaces an updated item with the authoritative server record.
  void updateItem(MemberAvailability item) {
    if (item.ministryId != state.ministryId) return;
    state = state.copyWith(
      items: state.items.map((i) => i.id == item.id ? item : i).toList(),
    );
  }

  /// Removes an item after confirmed HTTP 204 server deletion.
  void removeItem(String id) {
    state = state.copyWith(
      items: state.items.where((i) => i.id != id).toList(),
    );
  }

  /// Resets state completely (e.g. on unauthenticated or explicit reset).
  void reset() {
    state = const AvailabilityListState();
  }
}
