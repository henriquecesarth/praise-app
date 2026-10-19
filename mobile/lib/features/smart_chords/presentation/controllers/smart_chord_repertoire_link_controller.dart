import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repertoire_link_repository.dart';
import '../../domain/smart_chord_repertoire_link.dart';

@immutable
class SmartChordRepertoireLinkState {
  final String? chordId;
  final String? ministryId;
  final bool isLoading;
  final bool isSaving;
  final SmartChordRepertoireLink? link;
  final String? errorMessage;
  final int generation;

  const SmartChordRepertoireLinkState({
    this.chordId,
    this.ministryId,
    this.isLoading = false,
    this.isSaving = false,
    this.link,
    this.errorMessage,
    this.generation = 0,
  });

  bool get isLinked => link?.isLinked ?? false;
  bool get hasError => errorMessage != null;

  SmartChordRepertoireLinkState copyWith({
    String? chordId,
    String? ministryId,
    bool? isLoading,
    bool? isSaving,
    SmartChordRepertoireLink? link,
    bool clearLink = false,
    String? errorMessage,
    bool clearError = false,
    int? generation,
  }) {
    return SmartChordRepertoireLinkState(
      chordId: chordId ?? this.chordId,
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      isSaving: isSaving ?? this.isSaving,
      link: clearLink ? null : (link ?? this.link),
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      generation: generation ?? this.generation,
    );
  }
}

class SmartChordRepertoireLinkNotifier
    extends StateNotifier<SmartChordRepertoireLinkState> {
  final SmartChordRepertoireLinkRepository _repository;
  int _currentGeneration = 0;

  SmartChordRepertoireLinkNotifier({
    required SmartChordRepertoireLinkRepository repository,
  })  : _repository = repository,
        super(const SmartChordRepertoireLinkState());

  Future<void> load({
    required String ministryId,
    required String chordId,
    bool force = false,
  }) async {
    if (!force &&
        state.ministryId == ministryId &&
        state.chordId == chordId &&
        state.link != null &&
        !state.isLoading) {
      return;
    }

    final generation = ++_currentGeneration;
    state = state.copyWith(
      ministryId: ministryId,
      chordId: chordId,
      isLoading: true,
      clearError: true,
      generation: generation,
    );

    try {
      final link = await _repository.getRepertoireLink(
        ministryId: ministryId,
        chordId: chordId,
      );
      if (generation != _currentGeneration) return;

      state = state.copyWith(
        isLoading: false,
        link: link,
        clearError: true,
      );
    } catch (e) {
      if (generation != _currentGeneration) return;
      state = state.copyWith(
        isLoading: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
    }
  }

  Future<bool> setLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async {
    if (state.isSaving) return false;
    state = state.copyWith(isSaving: true, clearError: true);
    try {
      final link = await _repository.setRepertoireLink(
        ministryId: ministryId,
        chordId: chordId,
        songId: songId,
      );
      state = state.copyWith(
        isSaving: false,
        link: link,
        clearError: true,
      );
      return true;
    } catch (e) {
      state = state.copyWith(
        isSaving: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
      return false;
    }
  }

  Future<bool> unlink({
    required String ministryId,
    required String chordId,
  }) async {
    if (state.isSaving) return false;
    state = state.copyWith(isSaving: true, clearError: true);
    try {
      await _repository.removeRepertoireLink(
        ministryId: ministryId,
        chordId: chordId,
      );
      state = state.copyWith(
        isSaving: false,
        link: const SmartChordRepertoireLink.unlinked(),
        clearError: true,
      );
      return true;
    } catch (e) {
      state = state.copyWith(
        isSaving: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
      return false;
    }
  }

  void reset() {
    _currentGeneration++;
    state = const SmartChordRepertoireLinkState();
  }
}
