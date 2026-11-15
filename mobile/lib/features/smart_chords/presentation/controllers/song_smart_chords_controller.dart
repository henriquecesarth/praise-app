import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/smart_chord_repository.dart';
import '../../data/smart_chord_repertoire_link_repository.dart';
import '../../domain/smart_chord.dart';

@immutable
class SongSmartChordsState {
  final String? songId;
  final String? ministryId;
  final String? versionId;
  final bool isLoading;
  final List<SmartChord> items;
  final List<SmartChord> pendingItems;
  final String? errorMessage;
  final int generation;

  const SongSmartChordsState({
    this.songId,
    this.ministryId,
    this.versionId,
    this.isLoading = false,
    this.items = const [],
    this.pendingItems = const [],
    this.errorMessage,
    this.generation = 0,
  });

  bool get isEmpty => !isLoading && errorMessage == null && items.isEmpty;
  bool get hasPendingClassification => pendingItems.isNotEmpty;
  bool get hasError => errorMessage != null;

  SongSmartChordsState copyWith({
    String? songId,
    String? ministryId,
    bool clearMinistryId = false,
    String? versionId,
    bool clearVersionId = false,
    bool? isLoading,
    List<SmartChord>? items,
    List<SmartChord>? pendingItems,
    String? errorMessage,
    bool clearError = false,
    int? generation,
  }) {
    return SongSmartChordsState(
      songId: songId ?? this.songId,
      ministryId: clearMinistryId ? null : (ministryId ?? this.ministryId),
      versionId: clearVersionId ? null : (versionId ?? this.versionId),
      isLoading: isLoading ?? this.isLoading,
      items: items ?? this.items,
      pendingItems: pendingItems ?? this.pendingItems,
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

  Future<void> load(
    String songId, {
    String? ministryId,
    String? versionId,
    bool force = false,
  }) async {
    final normalizedVersionId =
        (versionId != null && versionId.trim().isNotEmpty)
            ? versionId.trim()
            : null;
    if (!force &&
        state.songId == songId &&
        state.ministryId == ministryId &&
        state.versionId == normalizedVersionId &&
        state.items.isNotEmpty &&
        !state.isLoading) {
      return;
    }

    final generation = ++_currentGeneration;
    final contextChanged = state.songId != songId ||
        state.ministryId != ministryId ||
        state.versionId != normalizedVersionId;
    state = state.copyWith(
      songId: songId,
      ministryId: ministryId,
      clearMinistryId: ministryId == null,
      versionId: normalizedVersionId,
      clearVersionId: normalizedVersionId == null,
      items: contextChanged ? const [] : state.items,
      pendingItems: contextChanged ? const [] : state.pendingItems,
      isLoading: true,
      clearError: true,
      generation: generation,
    );

    try {
      final List<SmartChord> list;
      List<SmartChord> pendingList = const [];
      if (ministryId != null && _linkRepository != null) {
        final rawList = await _linkRepository.getMySmartChordsForSong(
          ministryId: ministryId,
          songId: songId,
          versionId: normalizedVersionId,
        );
        list = rawList.where((c) {
          final link = c.repertoireLink;
          if (link != null && link.isPendingClassification) {
            return false;
          }
          if (normalizedVersionId != null) {
            final resolvedVersion = link?.versionId ?? c.versionId;
            if (resolvedVersion != null && resolvedVersion != normalizedVersionId) {
              return false;
            }
          }
          return true;
        }).toList();

        if (normalizedVersionId != null) {
          try {
            final rawPending = await _linkRepository.getMySmartChordsForSong(
              ministryId: ministryId,
              songId: songId,
              linkStatus: 'pending_classification',
            );
            pendingList = rawPending
                .where((c) => c.repertoireLink?.isPendingClassification == true)
                .toList();
          } catch (_) {
            pendingList = const [];
          }
        }
      } else {
        list = await _repository.getSmartChordsBySong(songId);
      }
      if (generation != _currentGeneration) return;

      state = state.copyWith(
        isLoading: false,
        items: list,
        pendingItems: pendingList,
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
    final updatedPending =
        state.pendingItems.where((c) => c.id != chordId).toList();
    state = state.copyWith(items: updated, pendingItems: updatedPending);
  }

  void upsertChord(SmartChord chord) {
    if (chord.songId != state.songId) return;
    final updatedPending =
        state.pendingItems.where((c) => c.id != chord.id).toList();
    if (state.versionId != null &&
        chord.versionId != null &&
        chord.versionId != state.versionId) {
      state = state.copyWith(pendingItems: updatedPending);
      return;
    }
    final index = state.items.indexWhere((c) => c.id == chord.id);
    if (index >= 0) {
      final updated = List<SmartChord>.from(state.items);
      updated[index] = chord;
      state = state.copyWith(items: updated, pendingItems: updatedPending);
    } else {
      state = state.copyWith(
        items: [chord, ...state.items],
        pendingItems: updatedPending,
      );
    }
  }

  void reset() {
    _currentGeneration++;
    state = const SongSmartChordsState();
  }
}
