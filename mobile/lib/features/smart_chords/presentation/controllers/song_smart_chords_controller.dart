import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repository.dart';
import '../../data/smart_chord_repertoire_link_repository.dart';
import '../../domain/smart_chord.dart';

@immutable
class SongSmartChordsState {
  final String? songId;
  final bool isLoading;
  final List<SmartChord> items;
  final String? errorMessage;
  final int generation;

  const SongSmartChordsState({
    this.songId,
    this.isLoading = false,
    this.items = const [],
    this.errorMessage,
    this.generation = 0,
  });

  bool get isEmpty => !isLoading && errorMessage == null && items.isEmpty;
  bool get hasError => errorMessage != null;

  SongSmartChordsState copyWith({
    String? songId,
    bool? isLoading,
    List<SmartChord>? items,
    String? errorMessage,
    bool clearError = false,
    int? generation,
  }) {
    return SongSmartChordsState(
      songId: songId ?? this.songId,
      isLoading: isLoading ?? this.isLoading,
      items: items ?? this.items,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      generation: generation ?? this.generation,
    );
  }
}

class SongSmartChordsNotifier extends StateNotifier<SongSmartChordsState> {
  final SmartChordRepository _repository;
  final SmartChordRepertoireLinkRepository? _linkRepository;
  int _currentGeneration = 0;

  SongSmartChordsNotifier({
    required SmartChordRepository repository,
    SmartChordRepertoireLinkRepository? linkRepository,
  })  : _repository = repository,
        _linkRepository = linkRepository,
        super(const SongSmartChordsState());

  Future<void> load(String songId, {String? ministryId, bool force = false}) async {
    if (!force && state.songId == songId && state.items.isNotEmpty && !state.isLoading) {
      return;
    }

    final generation = ++_currentGeneration;
    state = state.copyWith(
      songId: songId,
      isLoading: true,
      clearError: true,
      generation: generation,
    );

    try {
      final List<SmartChord> list;
      if (ministryId != null && _linkRepository != null) {
        list = await _linkRepository.getMySmartChordsForSong(
          ministryId: ministryId,
          songId: songId,
        );
      } else {
        list = await _repository.getSmartChordsBySong(songId);
      }
      if (generation != _currentGeneration) return;

      state = state.copyWith(
        isLoading: false,
        items: list,
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

  void removeChord(String chordId) {
    final updated = state.items.where((c) => c.id != chordId).toList();
    state = state.copyWith(items: updated);
  }

  void upsertChord(SmartChord chord) {
    if (chord.songId != state.songId) return;
    final index = state.items.indexWhere((c) => c.id == chord.id);
    if (index >= 0) {
      final updated = List<SmartChord>.from(state.items);
      updated[index] = chord;
      state = state.copyWith(items: updated);
    } else {
      state = state.copyWith(items: [chord, ...state.items]);
    }
  }

  void reset() {
    _currentGeneration++;
    state = const SongSmartChordsState();
  }
}
