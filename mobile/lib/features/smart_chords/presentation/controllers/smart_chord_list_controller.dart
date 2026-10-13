import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repository.dart';
import '../../domain/smart_chord.dart';

@immutable
class SmartChordListState {
  final bool isLoading;
  final List<SmartChord> items;
  final String search;
  final String? errorMessage;
  final int generation;

  const SmartChordListState({
    this.isLoading = false,
    this.items = const [],
    this.search = '',
    this.errorMessage,
    this.generation = 0,
  });

  bool get isEmpty => !isLoading && errorMessage == null && items.isEmpty;
  bool get hasError => errorMessage != null;
  bool get isSuccess => !isLoading && errorMessage == null && items.isNotEmpty;

  SmartChordListState copyWith({
    bool? isLoading,
    List<SmartChord>? items,
    String? search,
    String? errorMessage,
    bool clearError = false,
    int? generation,
  }) {
    return SmartChordListState(
      isLoading: isLoading ?? this.isLoading,
      items: items ?? this.items,
      search: search ?? this.search,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      generation: generation ?? this.generation,
    );
  }
}

class SmartChordListNotifier extends StateNotifier<SmartChordListState> {
  final SmartChordRepository _repository;
  int _currentGeneration = 0;

  SmartChordListNotifier({required SmartChordRepository repository})
      : _repository = repository,
        super(const SmartChordListState());

  Future<void> load({String? search, bool force = false}) async {
    final query = search ?? state.search;
    if (!force && state.items.isNotEmpty && !state.isLoading && state.search == query) {
      return;
    }

    final generation = ++_currentGeneration;
    state = state.copyWith(
      isLoading: true,
      search: query,
      clearError: true,
      generation: generation,
    );

    try {
      final list = await _repository.getSmartChords(
        search: query.trim().isNotEmpty ? query.trim() : null,
      );
      if (generation != _currentGeneration) return; // Stale request fence

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

  void setSearch(String query) {
    if (query == state.search) return;
    load(search: query, force: true);
  }

  void removeChord(String chordId) {
    final updated = state.items.where((c) => c.id != chordId).toList();
    state = state.copyWith(items: updated);
  }

  void upsertChord(SmartChord chord) {
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
    state = const SmartChordListState();
  }
}
