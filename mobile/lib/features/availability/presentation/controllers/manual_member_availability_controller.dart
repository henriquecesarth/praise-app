import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/availability_repository.dart';
import '../../domain/availability.dart';

@immutable
class ManualMemberAvailabilityState {
  final String? ministryId;
  final String? memberId;
  final bool isLoading;
  final bool isRefreshing;
  final bool isSubmitting;
  final bool isLoadingMore;
  final List<MemberAvailability> items;
  final String? nextCursor;
  final String? error;
  final String? actionError;
  final bool isUnauthorized;
  final bool isNotFound;

  const ManualMemberAvailabilityState({
    this.ministryId,
    this.memberId,
    this.isLoading = false,
    this.isRefreshing = false,
    this.isSubmitting = false,
    this.isLoadingMore = false,
    this.items = const [],
    this.nextCursor,
    this.error,
    this.actionError,
    this.isUnauthorized = false,
    this.isNotFound = false,
  });

  bool get hasMore => nextCursor != null && nextCursor!.isNotEmpty;

  ManualMemberAvailabilityState copyWith({
    String? ministryId,
    String? memberId,
    bool? isLoading,
    bool? isRefreshing,
    bool? isSubmitting,
    bool? isLoadingMore,
    List<MemberAvailability>? items,
    String? nextCursor,
    bool clearCursor = false,
    String? error,
    bool clearError = false,
    String? actionError,
    bool clearActionError = false,
    bool? isUnauthorized,
    bool? isNotFound,
  }) {
    return ManualMemberAvailabilityState(
      ministryId: ministryId ?? this.ministryId,
      memberId: memberId ?? this.memberId,
      isLoading: isLoading ?? this.isLoading,
      isRefreshing: isRefreshing ?? this.isRefreshing,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      items: items ?? this.items,
      nextCursor: clearCursor ? null : (nextCursor ?? this.nextCursor),
      error: clearError ? null : (error ?? this.error),
      actionError: clearActionError ? null : (actionError ?? this.actionError),
      isUnauthorized: isUnauthorized ?? this.isUnauthorized,
      isNotFound: isNotFound ?? this.isNotFound,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ManualMemberAvailabilityState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          memberId == other.memberId &&
          isLoading == other.isLoading &&
          isRefreshing == other.isRefreshing &&
          isSubmitting == other.isSubmitting &&
          isLoadingMore == other.isLoadingMore &&
          listEquals(items, other.items) &&
          nextCursor == other.nextCursor &&
          error == other.error &&
          actionError == other.actionError &&
          isUnauthorized == other.isUnauthorized &&
          isNotFound == other.isNotFound;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      memberId.hashCode ^
      isLoading.hashCode ^
      isRefreshing.hashCode ^
      isSubmitting.hashCode ^
      isLoadingMore.hashCode ^
      Object.hashAll(items) ^
      nextCursor.hashCode ^
      error.hashCode ^
      actionError.hashCode ^
      isUnauthorized.hashCode ^
      isNotFound.hashCode;
}

class ManualMemberAvailabilityNotifier
    extends StateNotifier<ManualMemberAvailabilityState> {
  final AvailabilityRepository _repository;
  int _requestSequence = 0;

  ManualMemberAvailabilityNotifier({
    required AvailabilityRepository repository,
  })  : _repository = repository,
        super(const ManualMemberAvailabilityState());

  /// Loads unavailabilities for a specific manual member.
  Future<void> load({
    required String ministryId,
    required String memberId,
  }) async {
    final seq = ++_requestSequence;

    if (state.ministryId != ministryId || state.memberId != memberId) {
      state = ManualMemberAvailabilityState(
        ministryId: ministryId,
        memberId: memberId,
        isLoading: true,
      );
    } else {
      state = state.copyWith(
        isLoading: true,
        clearError: true,
        clearActionError: true,
      );
    }

    try {
      final response = await _repository.listManualMemberAvailabilities(
        ministryId,
        memberId,
      );

      // Stale response / tenant-switch guard
      if (seq != _requestSequence ||
          state.ministryId != ministryId ||
          state.memberId != memberId) {
        return;
      }

      state = state.copyWith(
        isLoading: false,
        items: response.data,
        nextCursor: response.nextCursor,
        clearCursor: response.nextCursor == null,
        clearError: true,
        clearActionError: true,
        isUnauthorized: false,
        isNotFound: false,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != ministryId ||
          state.memberId != memberId) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: e.message,
        isUnauthorized: e.statusCode == 403,
        isNotFound: e.statusCode == 404,
      );
    } catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != ministryId ||
          state.memberId != memberId) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: 'Erro ao carregar indisponibilidades do integrante.',
        isUnauthorized: false,
        isNotFound: false,
      );
    }
  }

  /// Pull-to-refresh: reloads list keeping current items visible.
  Future<void> refresh() async {
    final mId = state.ministryId;
    final memId = state.memberId;
    if (mId == null || memId == null) return;

    final seq = ++_requestSequence;
    state = state.copyWith(isRefreshing: true, clearActionError: true);

    try {
      final response = await _repository.listManualMemberAvailabilities(
        mId,
        memId,
      );

      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return;
      }

      state = state.copyWith(
        isRefreshing: false,
        items: response.data,
        nextCursor: response.nextCursor,
        clearCursor: response.nextCursor == null,
        clearError: true,
        clearActionError: true,
        isUnauthorized: false,
        isNotFound: false,
      );
    } on AppFailure catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return;
      }
      state = state.copyWith(
        isRefreshing: false,
        error: e.message,
        isUnauthorized: e.statusCode == 403,
        isNotFound: e.statusCode == 404,
      );
    } catch (_) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return;
      }
      state = state.copyWith(
        isRefreshing: false,
        error: 'Erro ao atualizar indisponibilidades.',
      );
    }
  }

  /// Loads next page with cursor pagination.
  Future<void> loadMore() async {
    final mId = state.ministryId;
    final memId = state.memberId;
    final cursor = state.nextCursor;
    if (mId == null ||
        memId == null ||
        cursor == null ||
        state.isLoadingMore ||
        state.isLoading ||
        state.isRefreshing) {
      return;
    }

    final seq = ++_requestSequence;
    state = state.copyWith(isLoadingMore: true);

    try {
      final response = await _repository.listManualMemberAvailabilities(
        mId,
        memId,
        cursor: cursor,
      );

      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return;
      }

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
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return;
      }
      state = state.copyWith(
        isLoadingMore: false,
        actionError: e.message,
      );
    } catch (_) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return;
      }
      state = state.copyWith(
        isLoadingMore: false,
        actionError: 'Erro ao carregar mais períodos.',
      );
    }
  }

  /// Creates an unavailability period for the active manual member.
  /// Reconciles against authoritative backend state upon success.
  Future<bool> createAvailability({
    required CreateAvailabilityPayload payload,
    String? expectedMinistryId,
  }) async {
    final mId = state.ministryId;
    final memId = state.memberId;
    if (mId == null || memId == null || state.isSubmitting) return false;

    // Tenant fence
    if (expectedMinistryId != null && expectedMinistryId != mId) {
      return false;
    }

    final seq = ++_requestSequence;
    state = state.copyWith(isSubmitting: true, clearActionError: true);

    try {
      final created = await _repository.createManualMemberAvailability(
        mId,
        memId,
        payload,
      );

      // Verify tenant / member didn't switch while mutation was in-flight
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }

      state = state.copyWith(
        isSubmitting: false,
        items: [created, ...state.items.where((i) => i.id != created.id)],
        clearActionError: true,
      );
      return true;
    } on AppFailure catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }
      state = state.copyWith(
        isSubmitting: false,
        actionError: e.message,
      );
      return false;
    } catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }
      state = state.copyWith(
        isSubmitting: false,
        actionError: 'Erro ao criar indisponibilidade.',
      );
      return false;
    }
  }

  /// Updates an existing unavailability period.
  Future<bool> updateAvailability({
    required String id,
    required UpdateAvailabilityPayload payload,
    String? expectedMinistryId,
  }) async {
    final mId = state.ministryId;
    final memId = state.memberId;
    if (mId == null || memId == null || state.isSubmitting) return false;

    if (expectedMinistryId != null && expectedMinistryId != mId) {
      return false;
    }

    final seq = ++_requestSequence;
    state = state.copyWith(isSubmitting: true, clearActionError: true);

    try {
      final updated = await _repository.updateManualMemberAvailability(
        mId,
        memId,
        id,
        payload,
      );

      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }

      state = state.copyWith(
        isSubmitting: false,
        items: state.items.map((i) => i.id == id ? updated : i).toList(),
        clearActionError: true,
      );
      return true;
    } on AppFailure catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }
      state = state.copyWith(
        isSubmitting: false,
        actionError: e.message,
      );
      return false;
    } catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }
      state = state.copyWith(
        isSubmitting: false,
        actionError: 'Erro ao atualizar indisponibilidade.',
      );
      return false;
    }
  }

  /// Deletes an unavailability period after confirmation.
  Future<bool> deleteAvailability({
    required String id,
    String? expectedMinistryId,
  }) async {
    final mId = state.ministryId;
    final memId = state.memberId;
    if (mId == null || memId == null || state.isSubmitting) return false;

    if (expectedMinistryId != null && expectedMinistryId != mId) {
      return false;
    }

    final seq = ++_requestSequence;
    state = state.copyWith(isSubmitting: true, clearActionError: true);

    try {
      await _repository.deleteManualMemberAvailability(
        mId,
        memId,
        id,
      );

      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }

      state = state.copyWith(
        isSubmitting: false,
        items: state.items.where((i) => i.id != id).toList(),
        clearActionError: true,
      );
      return true;
    } on AppFailure catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }
      state = state.copyWith(
        isSubmitting: false,
        actionError: e.message,
      );
      return false;
    } catch (e) {
      if (seq != _requestSequence ||
          state.ministryId != mId ||
          state.memberId != memId) {
        return false;
      }
      state = state.copyWith(
        isSubmitting: false,
        actionError: 'Erro ao remover indisponibilidade.',
      );
      return false;
    }
  }

  /// Tenant invalidation guard.
  void invalidateTenant() {
    ++_requestSequence;
    state = const ManualMemberAvailabilityState();
  }

  /// Complete reset (e.g. on logout or user switch).
  void reset() {
    ++_requestSequence;
    state = const ManualMemberAvailabilityState();
  }
}
