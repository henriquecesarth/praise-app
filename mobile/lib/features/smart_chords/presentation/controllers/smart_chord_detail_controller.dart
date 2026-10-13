import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repository.dart';
import '../../domain/smart_chord.dart';

@immutable
class SmartChordDetailState {
  final String? chordId;
  final bool isLoading;
  final SmartChord? chord;
  final String? errorMessage;
  final bool isNotFound;
  final int semitones;
  final int generation;

  const SmartChordDetailState({
    this.chordId,
    this.isLoading = false,
    this.chord,
    this.errorMessage,
    this.isNotFound = false,
    this.semitones = 0,
    this.generation = 0,
  });

  bool get hasError => errorMessage != null;

  SmartChordDetailState copyWith({
    String? chordId,
    bool? isLoading,
    SmartChord? chord,
    String? errorMessage,
    bool clearError = false,
    bool? isNotFound,
    int? semitones,
    int? generation,
  }) {
    return SmartChordDetailState(
      chordId: chordId ?? this.chordId,
      isLoading: isLoading ?? this.isLoading,
      chord: chord ?? this.chord,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      isNotFound: isNotFound ?? this.isNotFound,
      semitones: semitones ?? this.semitones,
      generation: generation ?? this.generation,
    );
  }
}

class SmartChordDetailNotifier extends StateNotifier<SmartChordDetailState> {
  final SmartChordRepository _repository;
  int _currentGeneration = 0;

  SmartChordDetailNotifier({required SmartChordRepository repository})
      : _repository = repository,
        super(const SmartChordDetailState());

  Future<void> load(String chordId, {bool force = false}) async {
    if (!force && state.chordId == chordId && state.chord != null && !state.isLoading) {
      return;
    }

    final generation = ++_currentGeneration;
    state = state.copyWith(
      chordId: chordId,
      isLoading: true,
      clearError: true,
      isNotFound: false,
      semitones: 0,
      generation: generation,
    );

    try {
      final chord = await _repository.getSmartChordById(chordId);
      if (generation != _currentGeneration) return;

      state = state.copyWith(
        isLoading: false,
        chord: chord,
        clearError: true,
        isNotFound: false,
      );
    } catch (e) {
      if (generation != _currentGeneration) return;
      final is404 = e is AppFailure && e.statusCode == 404;
      state = state.copyWith(
        isLoading: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
        isNotFound: is404,
      );
    }
  }

  void setSemitones(int semitones) {
    // Clamp to -11..+11
    final clamped = semitones.clamp(-11, 11);
    state = state.copyWith(semitones: clamped);
  }

  void transposeBy(int delta) {
    setSemitones(state.semitones + delta);
  }

  void resetTransposition() {
    state = state.copyWith(semitones: 0);
  }

  void updateLocalChord(SmartChord chord) {
    if (chord.id == state.chordId) {
      state = state.copyWith(chord: chord);
    }
  }

  void reset() {
    _currentGeneration++;
    state = const SmartChordDetailState();
  }
}
