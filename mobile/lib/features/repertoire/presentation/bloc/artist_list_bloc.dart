import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:equatable/equatable.dart';
import '../../domain/entities/entities.dart';
import '../../domain/repositories/repositories.dart';

// ============================================================
// EVENTS
// ============================================================
abstract class ArtistListEvent extends Equatable {
  const ArtistListEvent();
  @override
  List<Object?> get props => [];
}

class LoadArtists extends ArtistListEvent {
  final String? search;
  const LoadArtists({this.search});
  @override
  List<Object?> get props => [search];
}

class CreateArtistEvent extends ArtistListEvent {
  final String name;
  const CreateArtistEvent(this.name);
  @override
  List<Object?> get props => [name];
}

class DeleteArtistEvent extends ArtistListEvent {
  final String artistId;
  const DeleteArtistEvent(this.artistId);
  @override
  List<Object?> get props => [artistId];
}

// ============================================================
// STATES
// ============================================================
abstract class ArtistListState extends Equatable {
  const ArtistListState();
  @override
  List<Object?> get props => [];
}

class ArtistListInitial extends ArtistListState {
  const ArtistListInitial();
}

class ArtistListLoading extends ArtistListState {
  const ArtistListLoading();
}

class ArtistListLoaded extends ArtistListState {
  final List<Artist> artists;
  /// Artists grouped by first letter for section display
  final Map<String, List<Artist>> grouped;

  ArtistListLoaded({required this.artists})
      : grouped = _groupByLetter(artists);

  static Map<String, List<Artist>> _groupByLetter(List<Artist> artists) {
    final map = <String, List<Artist>>{};
    for (final artist in artists) {
      final letter = artist.avatarLetter;
      map.putIfAbsent(letter, () => []).add(artist);
    }
    return Map.fromEntries(
      map.entries.toList()..sort((a, b) => a.key.compareTo(b.key)),
    );
  }

  @override
  List<Object?> get props => [artists];
}

class ArtistListError extends ArtistListState {
  final String message;
  const ArtistListError(this.message);
  @override
  List<Object?> get props => [message];
}

class ArtistCreated extends ArtistListState {
  final Artist artist;
  const ArtistCreated(this.artist);
  @override
  List<Object?> get props => [artist];
}

// ============================================================
// BLOC
// ============================================================
class ArtistListBloc extends Bloc<ArtistListEvent, ArtistListState> {
  final ArtistRepository _artistRepository;
  final String _ministryId;

  ArtistListBloc({
    required ArtistRepository artistRepository,
    required String ministryId,
  })  : _artistRepository = artistRepository,
        _ministryId = ministryId,
        super(const ArtistListInitial()) {
    on<LoadArtists>(_onLoadArtists);
    on<CreateArtistEvent>(_onCreateArtist);
    on<DeleteArtistEvent>(_onDeleteArtist);
  }

  Future<void> _onLoadArtists(
    LoadArtists event,
    Emitter<ArtistListState> emit,
  ) async {
    emit(const ArtistListLoading());

    final result = await _artistRepository.getArtists(
      _ministryId,
      search: event.search,
    );

    result.fold(
      (dynamic failure) => emit(ArtistListError(failure.message)),
      (artists) => emit(ArtistListLoaded(artists: artists)),
    );
  }

  Future<void> _onCreateArtist(
    CreateArtistEvent event,
    Emitter<ArtistListState> emit,
  ) async {
    final result = await _artistRepository.createArtist(_ministryId, event.name);

    result.fold(
      (dynamic failure) => emit(ArtistListError(failure.message)),
      (artist) {
        emit(ArtistCreated(artist));
        add(const LoadArtists());
      },
    );
  }

  Future<void> _onDeleteArtist(
    DeleteArtistEvent event,
    Emitter<ArtistListState> emit,
  ) async {
    final result = await _artistRepository.deleteArtist(_ministryId, event.artistId);

    result.fold(
      (dynamic failure) => emit(ArtistListError(failure.message)),
      (_) => add(const LoadArtists()),
    );
  }
}
