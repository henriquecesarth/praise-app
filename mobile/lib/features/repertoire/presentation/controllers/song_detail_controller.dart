import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/repertoire_repository.dart';
import '../../domain/song_detail.dart';

@immutable
class SongDetailState {
  final String? ministryId;
  final String? songId;
  final bool isLoading;
  final SongDetail? song;
  final String? error;

  const SongDetailState({
    this.ministryId,
    this.songId,
    this.isLoading = false,
    this.song,
    this.error,
  });

  SongDetailState copyWith({
    String? ministryId,
    String? songId,
    bool? isLoading,
    SongDetail? song,
    String? error,
    bool clearError = false,
  }) {
    return SongDetailState(
      ministryId: ministryId ?? this.ministryId,
      songId: songId ?? this.songId,
      isLoading: isLoading ?? this.isLoading,
      song: song ?? this.song,
      error: clearError ? null : (error ?? this.error),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SongDetailState &&
          runtimeType == other.runtimeType &&
          ministryId == other.ministryId &&
          songId == other.songId &&
          isLoading == other.isLoading &&
          song == other.song &&
          error == other.error;

  @override
  int get hashCode =>
      ministryId.hashCode ^
      songId.hashCode ^
      isLoading.hashCode ^
      song.hashCode ^
      error.hashCode;
}

class SongDetailNotifier extends StateNotifier<SongDetailState> {
  final RepertoireRepository _repository;
  int _requestSequence = 0;

  SongDetailNotifier({required RepertoireRepository repository})
      : _repository = repository,
        super(const SongDetailState());

  /// Loads song detail for [ministryId] + [songId].
  Future<void> load(String ministryId, String songId) async {
    _requestSequence++;
    final currentSeq = _requestSequence;

    if (state.ministryId != ministryId || state.songId != songId) {
      state = SongDetailState(
        ministryId: ministryId,
        songId: songId,
        isLoading: true,
      );
    } else {
      state = state.copyWith(isLoading: true, clearError: true);
    }

    try {
      final detail = await _repository.getSongDetail(ministryId, songId);

      if (_requestSequence != currentSeq ||
          state.ministryId != ministryId ||
          state.songId != songId) {
        return; // Stale response discarded
      }

      state = state.copyWith(
        song: detail,
        isLoading: false,
        clearError: true,
      );
    } on AppFailure catch (e) {
      if (_requestSequence != currentSeq ||
          state.ministryId != ministryId ||
          state.songId != songId) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: e.message,
      );
    } catch (_) {
      if (_requestSequence != currentSeq ||
          state.ministryId != ministryId ||
          state.songId != songId) {
        return;
      }
      state = state.copyWith(
        isLoading: false,
        error: 'Não foi possível carregar os detalhes da música.',
      );
    }
  }

  /// Retries loading the song detail.
  Future<void> retry() async {
    final mId = state.ministryId;
    final sId = state.songId;
    if (mId != null && sId != null) {
      await load(mId, sId);
    }
  }

  /// Resets detail state.
  void reset() {
    _requestSequence++;
    state = const SongDetailState();
  }
}
