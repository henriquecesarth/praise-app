import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/vocal_exercise_repository.dart';
import '../../domain/vocal_exercise.dart';

enum CustomVocalExercisesStatus {
  idle,
  loading,
  ready,
  error,
}

class CustomVocalExercisesState {
  final CustomVocalExercisesStatus status;
  final List<VocalExercise> exercises;
  final AppFailure? failure;
  final bool isMutating;
  final String? boundUserId;

  const CustomVocalExercisesState({
    this.status = CustomVocalExercisesStatus.idle,
    this.exercises = const [],
    this.failure,
    this.isMutating = false,
    this.boundUserId,
  });

  bool get isLoading => status == CustomVocalExercisesStatus.loading;
  bool get hasError => status == CustomVocalExercisesStatus.error;

  CustomVocalExercisesState copyWith({
    CustomVocalExercisesStatus? status,
    List<VocalExercise>? exercises,
    AppFailure? failure,
    bool clearFailure = false,
    bool? isMutating,
    String? boundUserId,
    bool clearBoundUserId = false,
  }) {
    return CustomVocalExercisesState(
      status: status ?? this.status,
      exercises: exercises ?? this.exercises,
      failure: clearFailure ? null : (failure ?? this.failure),
      isMutating: isMutating ?? this.isMutating,
      boundUserId:
          clearBoundUserId ? null : (boundUserId ?? this.boundUserId),
    );
  }
}

class CustomVocalExercisesNotifier
    extends StateNotifier<CustomVocalExercisesState> {
  final VocalExerciseRepository _repository;
  final String? Function() _currentUserIdReader;
  int _opId = 0;

  CustomVocalExercisesNotifier({
    required VocalExerciseRepository repository,
    required String? Function() currentUserIdReader,
  }) : _repository = repository,
       _currentUserIdReader = currentUserIdReader,
       super(const CustomVocalExercisesState());

  void reset() {
    ++_opId;
    state = const CustomVocalExercisesState();
  }

  Future<void> loadForUser(String? userId, {bool force = false}) async {
    final normalizedUserId = userId?.trim() ?? '';
    if (normalizedUserId.isEmpty) {
      reset();
      return;
    }
    if (!force &&
        state.boundUserId == normalizedUserId &&
        (state.status == CustomVocalExercisesStatus.ready ||
            state.status == CustomVocalExercisesStatus.loading)) {
      return;
    }

    final opId = ++_opId;
    final isUserSwitch = state.boundUserId != normalizedUserId;
    state = state.copyWith(
      status: CustomVocalExercisesStatus.loading,
      exercises: isUserSwitch ? const [] : state.exercises,
      clearFailure: true,
      boundUserId: normalizedUserId,
    );

    try {
      final loaded = await _repository.listCustomExercises();
      if (opId != _opId || _currentUserIdReader() != normalizedUserId) {
        return;
      }
      state = state.copyWith(
        status: CustomVocalExercisesStatus.ready,
        exercises: loaded,
        clearFailure: true,
        boundUserId: normalizedUserId,
      );
    } catch (e) {
      if (opId != _opId || _currentUserIdReader() != normalizedUserId) {
        return;
      }
      final failure = e is AppFailure
          ? e
          : const AppFailure(
              message:
                  'Não foi possível carregar seus exercícios personalizados.',
            );
      state = state.copyWith(
        status: CustomVocalExercisesStatus.error,
        failure: failure,
        boundUserId: normalizedUserId,
      );
    }
  }

  Future<VocalExercise> createExercise(CustomVocalExerciseDraft draft) async {
    final activeUserId = _currentUserIdReader()?.trim() ?? '';
    if (activeUserId.isEmpty) {
      throw const AppFailure(
        message: 'Faça login para criar exercícios personalizados.',
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      );
    }
    final opId = ++_opId;
    state = state.copyWith(
      isMutating: true,
      clearFailure: true,
      boundUserId: activeUserId,
    );
    try {
      final created = await _repository.createCustomExercise(draft);
      if (opId == _opId && _currentUserIdReader() == activeUserId) {
        state = state.copyWith(
          status: CustomVocalExercisesStatus.ready,
          exercises: [...state.exercises, created],
          isMutating: false,
          clearFailure: true,
          boundUserId: activeUserId,
        );
      }
      return created;
    } catch (e) {
      if (opId == _opId && _currentUserIdReader() == activeUserId) {
        state = state.copyWith(isMutating: false);
      }
      rethrow;
    }
  }

  Future<VocalExercise> updateExercise(
    String id,
    CustomVocalExercisePatch patch,
  ) async {
    final activeUserId = _currentUserIdReader()?.trim() ?? '';
    if (activeUserId.isEmpty) {
      throw const AppFailure(
        message: 'Faça login para editar exercícios personalizados.',
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      );
    }
    final opId = ++_opId;
    state = state.copyWith(
      isMutating: true,
      clearFailure: true,
      boundUserId: activeUserId,
    );
    try {
      final updated = await _repository.updateCustomExercise(id, patch);
      if (opId == _opId && _currentUserIdReader() == activeUserId) {
        final nextList = [
          for (final item in state.exercises)
            if (item.id == id) updated else item,
        ];
        state = state.copyWith(
          status: CustomVocalExercisesStatus.ready,
          exercises: nextList,
          isMutating: false,
          clearFailure: true,
          boundUserId: activeUserId,
        );
      }
      return updated;
    } catch (e) {
      if (opId == _opId && _currentUserIdReader() == activeUserId) {
        state = state.copyWith(isMutating: false);
      }
      rethrow;
    }
  }

  Future<void> deleteExercise(String id) async {
    final activeUserId = _currentUserIdReader()?.trim() ?? '';
    if (activeUserId.isEmpty) {
      throw const AppFailure(
        message: 'Faça login para excluir exercícios personalizados.',
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      );
    }
    final opId = ++_opId;
    state = state.copyWith(
      isMutating: true,
      clearFailure: true,
      boundUserId: activeUserId,
    );
    try {
      await _repository.deleteCustomExercise(id);
      if (opId == _opId && _currentUserIdReader() == activeUserId) {
        state = state.copyWith(
          status: CustomVocalExercisesStatus.ready,
          exercises: state.exercises
              .where((item) => item.id != id)
              .toList(growable: false),
          isMutating: false,
          clearFailure: true,
          boundUserId: activeUserId,
        );
      }
    } catch (e) {
      if (opId == _opId && _currentUserIdReader() == activeUserId) {
        state = state.copyWith(isMutating: false);
      }
      rethrow;
    }
  }
}
