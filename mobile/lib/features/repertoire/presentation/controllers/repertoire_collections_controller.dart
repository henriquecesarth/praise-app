import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/repertoire_folders_repository.dart';
import '../../data/repertoire_repository.dart';
import '../../domain/artist.dart';
import '../../domain/repertoire_folder.dart';

/// State for ministry-scoped repertoire folders & active folder detail.
@immutable
class RepertoireFoldersState {
  final String? ministryId;
  final bool isLoading;
  final bool isMutating;
  final String? error;
  final List<RepertoireFolder> folders;
  final RepertoireFolder? selectedFolder;
  final bool isLoadingDetail;
  final String? detailError;

  const RepertoireFoldersState({
    this.ministryId,
    this.isLoading = false,
    this.isMutating = false,
    this.error,
    this.folders = const [],
    this.selectedFolder,
    this.isLoadingDetail = false,
    this.detailError,
  });

  RepertoireFoldersState copyWith({
    String? ministryId,
    bool? isLoading,
    bool? isMutating,
    String? error,
    bool clearError = false,
    List<RepertoireFolder>? folders,
    RepertoireFolder? selectedFolder,
    bool clearSelectedFolder = false,
    bool? isLoadingDetail,
    String? detailError,
    bool clearDetailError = false,
  }) {
    return RepertoireFoldersState(
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      isMutating: isMutating ?? this.isMutating,
      error: clearError ? null : (error ?? this.error),
      folders: folders ?? this.folders,
      selectedFolder:
          clearSelectedFolder ? null : (selectedFolder ?? this.selectedFolder),
      isLoadingDetail: isLoadingDetail ?? this.isLoadingDetail,
      detailError: clearDetailError ? null : (detailError ?? this.detailError),
    );
  }
}

class RepertoireFoldersNotifier extends StateNotifier<RepertoireFoldersState> {
  final RepertoireFoldersRepository _foldersRepository;
  int _listSequence = 0;
  int _detailSequence = 0;

  RepertoireFoldersNotifier({
    required RepertoireFoldersRepository foldersRepository,
  })  : _foldersRepository = foldersRepository,
        super(const RepertoireFoldersState());

  void reset() {
    _listSequence++;
    _detailSequence++;
    state = const RepertoireFoldersState();
  }

  void clearSelectedFolder() {
    _detailSequence++;
    state = state.copyWith(
      clearSelectedFolder: true,
      isLoadingDetail: false,
      clearDetailError: true,
    );
  }

  Future<void> loadFolders(String ministryId, {bool force = false}) async {
    if (!force &&
        state.ministryId == ministryId &&
        state.folders.isNotEmpty &&
        !state.isLoading &&
        state.error == null) {
      return;
    }

    final seq = ++_listSequence;
    if (state.ministryId != ministryId) {
      _detailSequence++;
      state = RepertoireFoldersState(ministryId: ministryId, isLoading: true);
    } else {
      state = state.copyWith(isLoading: true, clearError: true);
    }

    try {
      final list = await _foldersRepository.listFolders(ministryId);
      if (_listSequence != seq || state.ministryId != ministryId) return;
      state = state.copyWith(isLoading: false, folders: list, clearError: true);
    } on AppFailure catch (e) {
      if (_listSequence != seq || state.ministryId != ministryId) return;
      state = state.copyWith(isLoading: false, error: e.message);
    } catch (e) {
      if (_listSequence != seq || state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoading: false,
        error: 'Erro ao carregar pastas: $e',
      );
    }
  }

  Future<void> openFolder(String ministryId, String folderId) async {
    final seq = ++_detailSequence;
    final cached =
        state.folders.where((f) => f.id == folderId).firstOrNull;
    state = state.copyWith(
      ministryId: ministryId,
      selectedFolder: cached,
      isLoadingDetail: true,
      clearDetailError: true,
    );

    try {
      final detail = await _foldersRepository.getFolder(ministryId, folderId);
      if (_detailSequence != seq || state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoadingDetail: false,
        selectedFolder: detail,
        clearDetailError: true,
      );
    } on AppFailure catch (e) {
      if (_detailSequence != seq || state.ministryId != ministryId) return;
      state = state.copyWith(isLoadingDetail: false, detailError: e.message);
    } catch (e) {
      if (_detailSequence != seq || state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoadingDetail: false,
        detailError: 'Erro ao carregar músicas da pasta: $e',
      );
    }
  }

  Future<String?> createFolder(
    String ministryId, {
    required String name,
    String? description,
  }) async {
    state = state.copyWith(isMutating: true);
    try {
      final created = await _foldersRepository.createFolder(
        ministryId,
        name: name,
        description: description,
      );
      if (state.ministryId != ministryId) return null;
      state = state.copyWith(
        isMutating: false,
        folders: [...state.folders, created],
      );
      return null;
    } on AppFailure catch (e) {
      state = state.copyWith(isMutating: false);
      return e.message;
    } catch (e) {
      state = state.copyWith(isMutating: false);
      return 'Erro ao criar pasta: $e';
    }
  }

  Future<String?> updateFolder(
    String ministryId,
    String folderId, {
    required String name,
    String? description,
  }) async {
    state = state.copyWith(isMutating: true);
    try {
      final updated = await _foldersRepository.updateFolder(
        ministryId,
        folderId,
        name: name,
        description: description,
      );
      if (state.ministryId != ministryId) return null;
      final nextFolders = state.folders
          .map((f) => f.id == folderId ? updated.copyWith(songs: f.songs) : f)
          .toList();
      final selected = state.selectedFolder;
      state = state.copyWith(
        isMutating: false,
        folders: nextFolders,
        selectedFolder: selected != null && selected.id == folderId
            ? updated.copyWith(songs: selected.songs, songCount: selected.songs.length)
            : selected,
      );
      return null;
    } on AppFailure catch (e) {
      state = state.copyWith(isMutating: false);
      return e.message;
    } catch (e) {
      state = state.copyWith(isMutating: false);
      return 'Erro ao atualizar pasta: $e';
    }
  }

  Future<String?> deleteFolder(String ministryId, String folderId) async {
    state = state.copyWith(isMutating: true);
    try {
      await _foldersRepository.deleteFolder(ministryId, folderId);
      if (state.ministryId != ministryId) return null;
      final remaining = state.folders.where((f) => f.id != folderId).toList();
      final wasSelected = state.selectedFolder?.id == folderId;
      state = state.copyWith(
        isMutating: false,
        folders: remaining,
        clearSelectedFolder: wasSelected,
      );
      return null;
    } on AppFailure catch (e) {
      state = state.copyWith(isMutating: false);
      return e.message;
    } catch (e) {
      state = state.copyWith(isMutating: false);
      return 'Erro ao excluir pasta: $e';
    }
  }

  Future<String?> addSongToFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {
    state = state.copyWith(isMutating: true);
    try {
      await _foldersRepository.addSongToFolder(ministryId, folderId, songId);
      if (state.ministryId != ministryId) return null;
      state = state.copyWith(isMutating: false);
      await openFolder(ministryId, folderId);
      await loadFolders(ministryId, force: true);
      return null;
    } on AppFailure catch (e) {
      state = state.copyWith(isMutating: false);
      return e.message;
    } catch (e) {
      state = state.copyWith(isMutating: false);
      return 'Erro ao adicionar música à pasta: $e';
    }
  }

  Future<String?> removeSongFromFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {
    state = state.copyWith(isMutating: true);
    try {
      await _foldersRepository.removeSongFromFolder(
        ministryId,
        folderId,
        songId,
      );
      if (state.ministryId != ministryId) return null;
      final current = state.selectedFolder;
      if (current != null && current.id == folderId) {
        final nextSongs = current.songs.where((s) => s.id != songId).toList();
        state = state.copyWith(
          isMutating: false,
          selectedFolder: current.copyWith(
            songs: nextSongs,
            songCount: nextSongs.length,
          ),
          folders: state.folders
              .map(
                (f) => f.id == folderId
                    ? f.copyWith(songCount: nextSongs.length)
                    : f,
              )
              .toList(),
        );
      } else {
        state = state.copyWith(isMutating: false);
      }
      return null;
    } on AppFailure catch (e) {
      state = state.copyWith(isMutating: false);
      return e.message;
    } catch (e) {
      state = state.copyWith(isMutating: false);
      return 'Erro ao remover música da pasta: $e';
    }
  }
}

@immutable
class RepertoireArtistsState {
  final String? ministryId;
  final bool isLoading;
  final bool isMutating;
  final String? error;
  final List<Artist> artists;
  final String searchQuery;

  const RepertoireArtistsState({
    this.ministryId,
    this.isLoading = false,
    this.isMutating = false,
    this.error,
    this.artists = const [],
    this.searchQuery = '',
  });

  List<Artist> get filteredArtists {
    final q = searchQuery.trim().toLowerCase();
    if (q.isEmpty) return artists;
    return artists
        .where((a) => a.name.toLowerCase().contains(q))
        .toList();
  }

  RepertoireArtistsState copyWith({
    String? ministryId,
    bool? isLoading,
    bool? isMutating,
    String? error,
    bool clearError = false,
    List<Artist>? artists,
    String? searchQuery,
  }) {
    return RepertoireArtistsState(
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      isMutating: isMutating ?? this.isMutating,
      error: clearError ? null : (error ?? this.error),
      artists: artists ?? this.artists,
      searchQuery: searchQuery ?? this.searchQuery,
    );
  }
}

class RepertoireArtistsNotifier extends StateNotifier<RepertoireArtistsState> {
  final RepertoireRepository _repertoireRepository;
  final RepertoireFoldersRepository? _foldersRepository;
  int _seq = 0;

  RepertoireArtistsNotifier({
    required RepertoireRepository repertoireRepository,
    RepertoireFoldersRepository? foldersRepository,
  })  : _repertoireRepository = repertoireRepository,
        _foldersRepository = foldersRepository,
        super(const RepertoireArtistsState());

  void reset() {
    _seq++;
    state = const RepertoireArtistsState();
  }

  void setSearchQuery(String query) {
    state = state.copyWith(searchQuery: query);
  }

  Future<void> loadArtists(String ministryId, {bool force = false}) async {
    if (!force &&
        state.ministryId == ministryId &&
        state.artists.isNotEmpty &&
        !state.isLoading &&
        state.error == null) {
      return;
    }

    final seq = ++_seq;
    if (state.ministryId != ministryId) {
      state = RepertoireArtistsState(ministryId: ministryId, isLoading: true);
    } else {
      state = state.copyWith(isLoading: true, clearError: true);
    }

    try {
      final list = await _repertoireRepository.listArtists(ministryId);
      if (_seq != seq || state.ministryId != ministryId) return;
      state = state.copyWith(isLoading: false, artists: list, clearError: true);
    } on AppFailure catch (e) {
      if (_seq != seq || state.ministryId != ministryId) return;
      state = state.copyWith(isLoading: false, error: e.message);
    } catch (e) {
      if (_seq != seq || state.ministryId != ministryId) return;
      state = state.copyWith(
        isLoading: false,
        error: 'Erro ao carregar artistas: $e',
      );
    }
  }

  Future<String?> createArtist(String ministryId, String name) async {
    state = state.copyWith(isMutating: true);
    try {
      final created = await _repertoireRepository.createArtist(
        ministryId,
        name.trim(),
      );
      if (state.ministryId != ministryId) return null;
      state = state.copyWith(
        isMutating: false,
        artists: [created, ...state.artists],
      );
      return null;
    } on AppFailure catch (e) {
      state = state.copyWith(isMutating: false);
      return e.message;
    } catch (e) {
      state = state.copyWith(isMutating: false);
      return 'Erro ao criar artista: $e';
    }
  }

  Future<String?> deleteArtist(String ministryId, String artistId) async {
    final repo = _foldersRepository;
    if (repo == null) return 'Exclusão indisponível.';
    state = state.copyWith(isMutating: true);
    try {
      await repo.deleteArtist(ministryId, artistId);
      if (state.ministryId != ministryId) return null;
      state = state.copyWith(
        isMutating: false,
        artists: state.artists.where((a) => a.id != artistId).toList(),
      );
      return null;
    } on AppFailure catch (e) {
      state = state.copyWith(isMutating: false);
      return e.message;
    } catch (e) {
      state = state.copyWith(isMutating: false);
      return 'Erro ao excluir artista: $e';
    }
  }
}
