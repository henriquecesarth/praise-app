import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';
import '../../domain/entities/entities.dart';
import '../../domain/repositories/repositories.dart';

// ============================================================
// EVENTS
// ============================================================
abstract class SongListEvent extends Equatable {
  const SongListEvent();
  @override
  List<Object?> get props => [];
}

class LoadSongs extends SongListEvent {
  final SongFilters? filters;
  const LoadSongs({this.filters});
  @override
  List<Object?> get props => [filters];
}

class SearchSongs extends SongListEvent {
  final String query;
  const SearchSongs(this.query);
  @override
  List<Object?> get props => [query];
}

class ApplyFilters extends SongListEvent {
  final SongFilters filters;
  const ApplyFilters(this.filters);
  @override
  List<Object?> get props => [filters];
}

class ClearFilters extends SongListEvent {
  const ClearFilters();
}

class RefreshSongs extends SongListEvent {
  const RefreshSongs();
}

class DeleteSongEvent extends SongListEvent {
  final String songId;
  const DeleteSongEvent(this.songId);
  @override
  List<Object?> get props => [songId];
}

// ============================================================
// STATES
// ============================================================
abstract class SongListState extends Equatable {
  const SongListState();
  @override
  List<Object?> get props => [];
}

class SongListInitial extends SongListState {
  const SongListInitial();
}

class SongListLoading extends SongListState {
  const SongListLoading();
}

class SongListLoaded extends SongListState {
  final List<Song> songs;
  final int totalCount;
  final int page;
  final int totalPages;
  final SongFilters currentFilters;
  final bool hasActiveFilters;

  const SongListLoaded({
    required this.songs,
    required this.totalCount,
    required this.page,
    required this.totalPages,
    required this.currentFilters,
    this.hasActiveFilters = false,
  });

  @override
  List<Object?> get props =>
      [songs, totalCount, page, totalPages, currentFilters, hasActiveFilters];
}

class SongListError extends SongListState {
  final String message;
  const SongListError(this.message);
  @override
  List<Object?> get props => [message];
}

class SongDeleted extends SongListState {
  const SongDeleted();
}

// ============================================================
// BLOC
// ============================================================
class SongListBloc extends Bloc<SongListEvent, SongListState> {
  final SongRepository _songRepository;
  final String _ministryId;
  SongFilters _currentFilters;

  SongListBloc({
    required SongRepository songRepository,
    required String ministryId,
    SongFilters? initialFilters,
  })  : _songRepository = songRepository,
        _ministryId = ministryId,
        _currentFilters = initialFilters ?? const SongFilters(),
        super(const SongListInitial()) {
    on<LoadSongs>(_onLoadSongs);
    on<SearchSongs>(_onSearchSongs);
    on<ApplyFilters>(_onApplyFilters);
    on<ClearFilters>(_onClearFilters);
    on<RefreshSongs>(_onRefreshSongs);
    on<DeleteSongEvent>(_onDeleteSong);
  }

  Future<void> _onLoadSongs(
    LoadSongs event,
    Emitter<SongListState> emit,
  ) async {
    emit(const SongListLoading());

    if (event.filters != null) {
      _currentFilters = event.filters!;
    }

    final result = await _songRepository.getSongs(_ministryId, _currentFilters);

    result.fold(
      (failure) => emit(SongListError(failure.message)),
      (paginatedResult) => emit(SongListLoaded(
        songs: paginatedResult.data,
        totalCount: paginatedResult.total,
        page: paginatedResult.page,
        totalPages: paginatedResult.totalPages,
        currentFilters: _currentFilters,
        hasActiveFilters: _hasActiveFilters(),
      )),
    );
  }

  Future<void> _onSearchSongs(
    SearchSongs event,
    Emitter<SongListState> emit,
  ) async {
    _currentFilters = SongFilters(
      search: event.query.isEmpty ? null : event.query,
      classificationId: _currentFilters.classificationId,
      originalKey: _currentFilters.originalKey,
      artistId: _currentFilters.artistId,
      hasYoutube: _currentFilters.hasYoutube,
    );

    add(LoadSongs(filters: _currentFilters));
  }

  Future<void> _onApplyFilters(
    ApplyFilters event,
    Emitter<SongListState> emit,
  ) async {
    _currentFilters = event.filters;
    add(LoadSongs(filters: _currentFilters));
  }

  Future<void> _onClearFilters(
    ClearFilters event,
    Emitter<SongListState> emit,
  ) async {
    _currentFilters = const SongFilters();
    add(const LoadSongs());
  }

  Future<void> _onRefreshSongs(
    RefreshSongs event,
    Emitter<SongListState> emit,
  ) async {
    add(LoadSongs(filters: _currentFilters));
  }

  Future<void> _onDeleteSong(
    DeleteSongEvent event,
    Emitter<SongListState> emit,
  ) async {
    final result = await _songRepository.deleteSong(_ministryId, event.songId);

    result.fold(
      (failure) => emit(SongListError(failure.message)),
      (_) {
        emit(const SongDeleted());
        add(LoadSongs(filters: _currentFilters));
      },
    );
  }

  bool _hasActiveFilters() {
    return _currentFilters.classificationId != null ||
        _currentFilters.originalKey != null ||
        _currentFilters.artistId != null ||
        _currentFilters.hasYoutube == true;
  }
}
