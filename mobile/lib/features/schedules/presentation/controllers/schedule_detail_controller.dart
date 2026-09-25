import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/schedule_repository.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_comment.dart';

// ─── Schedule Detail State ───────────────────────────────────────────────────

@immutable
class ScheduleDetailState {
  final String? ministryId;
  final String? scheduleId;
  final bool isLoading;
  final ScheduleDetail? schedule;
  final String? error;

  /// True when the confirmation PATCH is in-flight.
  final bool isConfirming;
  final String? confirmationError;

  const ScheduleDetailState({
    this.ministryId,
    this.scheduleId,
    this.isLoading = false,
    this.schedule,
    this.error,
    this.isConfirming = false,
    this.confirmationError,
  });

  ScheduleDetailState copyWith({
    String? ministryId,
    String? scheduleId,
    bool? isLoading,
    ScheduleDetail? schedule,
    String? error,
    bool clearError = false,
    bool? isConfirming,
    String? confirmationError,
    bool clearConfirmationError = false,
  }) {
    return ScheduleDetailState(
      ministryId: ministryId ?? this.ministryId,
      scheduleId: scheduleId ?? this.scheduleId,
      isLoading: isLoading ?? this.isLoading,
      schedule: schedule ?? this.schedule,
      error: clearError ? null : (error ?? this.error),
      isConfirming: isConfirming ?? this.isConfirming,
      confirmationError: clearConfirmationError
          ? null
          : (confirmationError ?? this.confirmationError),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScheduleDetailState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          scheduleId == other.scheduleId &&
          isLoading == other.isLoading &&
          schedule == other.schedule &&
          error == other.error &&
          isConfirming == other.isConfirming &&
          confirmationError == other.confirmationError;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      scheduleId.hashCode ^
      isLoading.hashCode ^
      schedule.hashCode ^
      error.hashCode ^
      isConfirming.hashCode ^
      confirmationError.hashCode;
}

// ─── Schedule Detail Notifier ─────────────────────────────────────────────────

class ScheduleDetailNotifier extends StateNotifier<ScheduleDetailState> {
  final ScheduleRepository _repository;

  ScheduleDetailNotifier({required ScheduleRepository repository})
      : _repository = repository,
        super(const ScheduleDetailState());

  /// Loads full detail for [ministryId] + [scheduleId].
  /// Resets state if the key changes (ministry or schedule switch).
  Future<void> load(String ministryId, String scheduleId) async {
    final keyChanged =
        state.ministryId != ministryId || state.scheduleId != scheduleId;

    if (keyChanged) {
      state = ScheduleDetailState(
        ministryId: ministryId,
        scheduleId: scheduleId,
        isLoading: true,
      );
    } else {
      state = state.copyWith(isLoading: true, clearError: true);
    }

    try {
      final detail =
          await _repository.getScheduleDetail(ministryId, scheduleId);
      if (!_isActive(ministryId, scheduleId)) return;
      state = state.copyWith(
        schedule: detail,
        isLoading: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (!_isActive(ministryId, scheduleId)) return;
      state = state.copyWith(
        error: e.message,
        isLoading: false,
      );
    } catch (e) {
      if (!_isActive(ministryId, scheduleId)) return;
      state = state.copyWith(
        error: 'Não foi possível carregar os detalhes da escala.',
        isLoading: false,
      );
    }
  }

  /// Confirms or declines own participation (PATCH /confirmation).
  ///
  /// Mobile NEVER derives participant target — sends only { confirmed: bool }.
  /// On success, replaces local state with authoritative server response.
  /// Handles 403 (not a participant) and 400 (past schedule) safely.
  Future<void> confirm(
      String ministryId, String scheduleId, bool confirmed) async {
    if (state.isConfirming) return;
    state = state.copyWith(
      isConfirming: true,
      clearConfirmationError: true,
    );

    try {
      final updated = await _repository.confirmParticipation(
          ministryId, scheduleId, confirmed);
      if (!_isActive(ministryId, scheduleId)) return;
      // Replace entire schedule with authoritative server state.
      state = state.copyWith(
        schedule: updated,
        isConfirming: false,
        clearConfirmationError: true,
      );
    } on AppFailure catch (e) {
      if (!_isActive(ministryId, scheduleId)) return;
      state = state.copyWith(
        isConfirming: false,
        confirmationError: e.message,
      );
    } catch (e) {
      if (!_isActive(ministryId, scheduleId)) return;
      state = state.copyWith(
        isConfirming: false,
        confirmationError: 'Não foi possível confirmar a presença.',
      );
    }
  }

  void clearConfirmationError() {
    state = state.copyWith(clearConfirmationError: true);
  }

  bool _isActive(String ministryId, String scheduleId) =>
      state.ministryId == ministryId && state.scheduleId == scheduleId;

  void reset() {
    state = const ScheduleDetailState();
  }
}

// ─── Comments State ───────────────────────────────────────────────────────────

/// Codes that map to backend commercial restriction responses.
const kSubscriptionRestrictedCode = 'SUBSCRIPTION_RESTRICTED';
const kSubscriptionSuspendedCode = 'SUBSCRIPTION_SUSPENDED';

@immutable
class CommentsState {
  final String? ministryId;
  final String? scheduleId;
  final bool isLoading;
  final List<ScheduleComment> comments;
  final String? error;

  /// True while POST /comments is in-flight.
  final bool isPosting;
  final String? postError;

  /// True when POST fails with a commercial restriction code.
  final bool isCommerciallyRestricted;

  const CommentsState({
    this.ministryId,
    this.scheduleId,
    this.isLoading = false,
    this.comments = const [],
    this.error,
    this.isPosting = false,
    this.postError,
    this.isCommerciallyRestricted = false,
  });

  CommentsState copyWith({
    String? ministryId,
    String? scheduleId,
    bool? isLoading,
    List<ScheduleComment>? comments,
    String? error,
    bool clearError = false,
    bool? isPosting,
    String? postError,
    bool clearPostError = false,
    bool? isCommerciallyRestricted,
  }) {
    return CommentsState(
      ministryId: ministryId ?? this.ministryId,
      scheduleId: scheduleId ?? this.scheduleId,
      isLoading: isLoading ?? this.isLoading,
      comments: comments ?? this.comments,
      error: clearError ? null : (error ?? this.error),
      isPosting: isPosting ?? this.isPosting,
      postError: clearPostError ? null : (postError ?? this.postError),
      isCommerciallyRestricted:
          isCommerciallyRestricted ?? this.isCommerciallyRestricted,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CommentsState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          scheduleId == other.scheduleId &&
          isLoading == other.isLoading &&
          listEquals(comments, other.comments) &&
          error == other.error &&
          isPosting == other.isPosting &&
          postError == other.postError &&
          isCommerciallyRestricted == other.isCommerciallyRestricted;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      scheduleId.hashCode ^
      isLoading.hashCode ^
      Object.hashAll(comments) ^
      error.hashCode ^
      isPosting.hashCode ^
      postError.hashCode ^
      isCommerciallyRestricted.hashCode;
}

// ─── Comments Notifier ────────────────────────────────────────────────────────

class CommentsNotifier extends StateNotifier<CommentsState> {
  final ScheduleRepository _repository;

  CommentsNotifier({required ScheduleRepository repository})
      : _repository = repository,
        super(const CommentsState());

  /// Loads first-page comments for [ministryId] + [scheduleId].
  Future<void> load(String ministryId, String scheduleId) async {
    final keyChanged =
        state.ministryId != ministryId || state.scheduleId != scheduleId;

    if (keyChanged) {
      state = CommentsState(
        ministryId: ministryId,
        scheduleId: scheduleId,
        isLoading: true,
      );
    } else {
      state = state.copyWith(isLoading: true, clearError: true);
    }

    try {
      final list = await _repository.getComments(ministryId, scheduleId);
      if (!_isActive(ministryId, scheduleId)) return;
      state = state.copyWith(
        comments: list,
        isLoading: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (!_isActive(ministryId, scheduleId)) return;
      state = state.copyWith(
        error: e.message,
        isLoading: false,
      );
    } catch (e) {
      if (!_isActive(ministryId, scheduleId)) return;
      state = state.copyWith(
        error: 'Não foi possível carregar os comentários.',
        isLoading: false,
      );
    }
  }

  /// Posts a comment (1–1000 chars). Waits for HTTP 201 before adding to list.
  /// Clears composer only on confirmed success.
  /// Does NOT blindly retry on uncertain network failure.
  ///
  /// Returns true on success (caller should clear the composer field).
  Future<bool> postComment(
      String ministryId, String scheduleId, String content) async {
    if (state.isPosting) return false;

    // Validate length client-side (backend also validates 1–1000)
    final trimmed = content.trim();
    if (trimmed.isEmpty || trimmed.length > 1000) return false;

    state = state.copyWith(
      isPosting: true,
      clearPostError: true,
      isCommerciallyRestricted: false,
    );

    try {
      final comment =
          await _repository.postComment(ministryId, scheduleId, trimmed);
      if (!_isActive(ministryId, scheduleId)) return false;

      // Add returned comment at the end (chronological order).
      final updated = [...state.comments, comment];
      state = state.copyWith(
        comments: updated,
        isPosting: false,
        clearPostError: true,
      );
      return true; // Signal caller to clear composer
    } on AppFailure catch (e) {
      if (!_isActive(ministryId, scheduleId)) return false;

      final isRestricted = e.code == kSubscriptionRestrictedCode ||
          e.code == kSubscriptionSuspendedCode ||
          e.statusCode == 403;

      state = state.copyWith(
        isPosting: false,
        postError: e.message,
        isCommerciallyRestricted: isRestricted,
      );
      return false;
    } catch (e) {
      if (!_isActive(ministryId, scheduleId)) return false;
      state = state.copyWith(
        isPosting: false,
        postError: 'Não foi possível enviar o comentário.',
      );
      return false;
    }
  }

  void clearPostError() {
    state =
        state.copyWith(clearPostError: true, isCommerciallyRestricted: false);
  }

  bool _isActive(String ministryId, String scheduleId) =>
      state.ministryId == ministryId && state.scheduleId == scheduleId;

  void reset() {
    state = const CommentsState();
  }
}
