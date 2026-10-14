import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/repertoire_repository.dart';
import '../../domain/artist.dart';
import '../../domain/classification.dart';
import '../../domain/song_detail.dart';
import '../../domain/song_form_data.dart';

enum SongMutationOutcome {
  success,
  failure,
  discarded,
}

@immutable
class SongMutationResult<T> {
  final SongMutationOutcome outcome;
  final T? data;
  final String? errorMessage;

  const SongMutationResult._({
    required this.outcome,
    this.data,
    this.errorMessage,
  });

  const SongMutationResult.success([T? data])
      : this._(outcome: SongMutationOutcome.success, data: data);

  const SongMutationResult.failure([String? errorMessage])
      : this._(outcome: SongMutationOutcome.failure, errorMessage: errorMessage);

  const SongMutationResult.discarded()
      : this._(outcome: SongMutationOutcome.discarded);

  bool get isSuccess => outcome == SongMutationOutcome.success;
  bool get isFailure => outcome == SongMutationOutcome.failure;
  bool get isDiscarded => outcome == SongMutationOutcome.discarded;
}

typedef MutationOutcome = SongMutationOutcome;
typedef MutationResult<T> = SongMutationResult<T>;

@immutable
class SongFormState {
  final bool isSubmitting;
  final bool isLoadingRelations;
  final bool isQuickCreatingArtist;
  final List<Artist> artists;
  final List<Classification> classifications;
  final String? errorMessage;
  final bool isSuccess;

  const SongFormState({
    this.isSubmitting = false,
    this.isLoadingRelations = false,
    this.isQuickCreatingArtist = false,
    this.artists = const [],
    this.classifications = const [],
    this.errorMessage,
    this.isSuccess = false,
  });

  SongFormState copyWith({
    bool? isSubmitting,
    bool? isLoadingRelations,
    bool? isQuickCreatingArtist,
    List<Artist>? artists,
    List<Classification>? classifications,
    String? errorMessage,
    bool clearError = false,
    bool? isSuccess,
  }) {
    return SongFormState(
      isSubmitting: isSubmitting ?? this.isSubmitting,
      isLoadingRelations: isLoadingRelations ?? this.isLoadingRelations,
      isQuickCreatingArtist:
          isQuickCreatingArtist ?? this.isQuickCreatingArtist,
      artists: artists ?? this.artists,
      classifications: classifications ?? this.classifications,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      isSuccess: isSuccess ?? this.isSuccess,
    );
  }
}

class SongFormNotifier extends StateNotifier<SongFormState> {
  final RepertoireRepository _repository;
  int _currentGeneration = 0;
  String? _boundMinistryId;
  String? _boundUserId;

  SongFormNotifier({
    required RepertoireRepository repository,
  })  : _repository = repository,
        super(const SongFormState());

  int get currentGeneration => _currentGeneration;
  String? get boundMinistryId => _boundMinistryId;
  String? get boundUserId => _boundUserId;

  Future<void> init({
    required String ministryId,
    required String boundUserId,
    SongDetail? initialSong,
  }) async {
    _currentGeneration++;
    final generation = _currentGeneration;
    _boundMinistryId = ministryId;
    _boundUserId = boundUserId;

    state = const SongFormState(isLoadingRelations: true);

    try {
      final results = await Future.wait([
        _repository.listArtists(ministryId),
        _repository.listClassifications(ministryId),
      ]);

      if (generation != _currentGeneration ||
          _boundMinistryId != ministryId ||
          _boundUserId != boundUserId) {
        return; // Discard stale relations response
      }

      final artists = results[0] as List<Artist>;
      final classifications = results[1] as List<Classification>;

      state = state.copyWith(
        isLoadingRelations: false,
        artists: artists,
        classifications: classifications,
        clearError: true,
      );
    } catch (e) {
      if (generation != _currentGeneration ||
          _boundMinistryId != ministryId ||
          _boundUserId != boundUserId) {
        return;
      }
      final errorMsg = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(
        isLoadingRelations: false,
        errorMessage: errorMsg,
      );
    }
  }

  Future<MutationResult<Artist>> quickCreateArtist(String name) async {
    if (state.isQuickCreatingArtist) return const MutationResult.discarded();
    final requestGeneration = _currentGeneration;
    final expectedMinistryId = _boundMinistryId;
    final expectedUserId = _boundUserId;

    if (expectedMinistryId == null || expectedMinistryId.isEmpty) {
      return const MutationResult.failure('Ministério não informado.');
    }

    state = state.copyWith(isQuickCreatingArtist: true, clearError: true);

    try {
      final created = await _repository.createArtist(expectedMinistryId, name);

      if (requestGeneration != _currentGeneration ||
          expectedMinistryId != _boundMinistryId ||
          expectedUserId != _boundUserId) {
        return const MutationResult.discarded();
      }

      // Prepend or add new artist to local artists list
      final updatedArtists = [created, ...state.artists];

      state = state.copyWith(
        isQuickCreatingArtist: false,
        artists: updatedArtists,
        clearError: true,
      );

      return MutationResult.success(created);
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          expectedMinistryId != _boundMinistryId ||
          expectedUserId != _boundUserId) {
        return const MutationResult.discarded();
      }

      final errorMsg = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(
        isQuickCreatingArtist: false,
        errorMessage: errorMsg,
      );
      return MutationResult.failure(errorMsg);
    }
  }

  Future<MutationResult<SongDetail>> createSong(SongFormData data) async {
    if (state.isSubmitting) return const MutationResult.discarded();
    final requestGeneration = _currentGeneration;
    final expectedMinistryId = _boundMinistryId;
    final expectedUserId = _boundUserId;

    if (expectedMinistryId == null || expectedMinistryId.isEmpty) {
      return const MutationResult.failure('Ministério não informado.');
    }

    state = state.copyWith(
      isSubmitting: true,
      clearError: true,
      isSuccess: false,
    );

    try {
      final created = await _repository.createSong(expectedMinistryId, data);

      if (requestGeneration != _currentGeneration ||
          expectedMinistryId != _boundMinistryId ||
          expectedUserId != _boundUserId) {
        return const MutationResult.discarded();
      }

      state = state.copyWith(
        isSubmitting: false,
        isSuccess: true,
        clearError: true,
      );

      return MutationResult.success(created);
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          expectedMinistryId != _boundMinistryId ||
          expectedUserId != _boundUserId) {
        return const MutationResult.discarded();
      }

      final errorMsg = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: errorMsg,
      );
      return MutationResult.failure(errorMsg);
    }
  }

  Future<MutationResult<SongDetail>> updateSong(
    String songId,
    SongFormData data,
  ) async {
    if (state.isSubmitting) return const MutationResult.discarded();
    final requestGeneration = _currentGeneration;
    final expectedMinistryId = _boundMinistryId;
    final expectedUserId = _boundUserId;

    if (expectedMinistryId == null || expectedMinistryId.isEmpty) {
      return const MutationResult.failure('Ministério não informado.');
    }

    state = state.copyWith(
      isSubmitting: true,
      clearError: true,
      isSuccess: false,
    );

    try {
      final updated =
          await _repository.updateSong(expectedMinistryId, songId, data);

      if (requestGeneration != _currentGeneration ||
          expectedMinistryId != _boundMinistryId ||
          expectedUserId != _boundUserId) {
        return const MutationResult.discarded();
      }

      state = state.copyWith(
        isSubmitting: false,
        isSuccess: true,
        clearError: true,
      );

      return MutationResult.success(updated);
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          expectedMinistryId != _boundMinistryId ||
          expectedUserId != _boundUserId) {
        return const MutationResult.discarded();
      }

      final errorMsg = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: errorMsg,
      );
      return MutationResult.failure(errorMsg);
    }
  }

  Future<MutationResult<void>> deleteSong(String songId, {String? ministryId}) async {
    if (state.isSubmitting) return const MutationResult.discarded();
    final requestGeneration = _currentGeneration;
    final targetMinistryId = ministryId ?? _boundMinistryId;
    final expectedUserId = _boundUserId;

    if (targetMinistryId == null || targetMinistryId.isEmpty) {
      return const MutationResult.failure('Ministério não informado.');
    }

    state = state.copyWith(
      isSubmitting: true,
      clearError: true,
      isSuccess: false,
    );

    try {
      await _repository.deleteSong(targetMinistryId, songId);

      if (requestGeneration != _currentGeneration ||
          targetMinistryId != (ministryId ?? _boundMinistryId) ||
          expectedUserId != _boundUserId) {
        return const MutationResult.discarded();
      }

      state = state.copyWith(
        isSubmitting: false,
        isSuccess: true,
        clearError: true,
      );

      return const MutationResult.success();
    } catch (e) {
      if (requestGeneration != _currentGeneration ||
          targetMinistryId != (ministryId ?? _boundMinistryId) ||
          expectedUserId != _boundUserId) {
        return const MutationResult.discarded();
      }

      final errorMsg = e is AppFailure ? e.message : e.toString();
      state = state.copyWith(
        isSubmitting: false,
        errorMessage: errorMsg,
      );
      return MutationResult.failure(errorMsg);
    }
  }

  void invalidateTenant() => reset();

  void reset() {
    _currentGeneration++;
    _boundMinistryId = null;
    _boundUserId = null;
    state = const SongFormState();
  }
}
