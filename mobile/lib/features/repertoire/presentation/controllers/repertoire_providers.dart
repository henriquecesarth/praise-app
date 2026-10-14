import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart' show apiClientProvider;
import '../../data/repertoire_repository.dart';
import 'repertoire_list_controller.dart';
import 'song_detail_controller.dart';
import 'song_form_controller.dart';
export 'song_form_controller.dart'
    show
        SongFormNotifier,
        SongFormState,
        SongMutationOutcome,
        SongMutationResult;

/// Provider for the repertoire HTTP repository.
final repertoireRepositoryProvider = Provider<RepertoireRepository>((ref) {
  return HttpRepertoireRepository(
    apiClient: ref.watch(apiClientProvider),
  );
});

/// Ministry-scoped repertoire list provider.
/// Keyed by ministryId — invalidated automatically on ministry switch.
final repertoireListNotifierProvider =
    StateNotifierProvider<RepertoireListNotifier, RepertoireListState>((ref) {
  return RepertoireListNotifier(
    repository: ref.watch(repertoireRepositoryProvider),
  );
});

/// Song detail provider.
/// Keyed by ministryId + songId — reset when either changes.
final songDetailNotifierProvider =
    StateNotifierProvider<SongDetailNotifier, SongDetailState>((ref) {
  return SongDetailNotifier(
    repository: ref.watch(repertoireRepositoryProvider),
  );
});

/// Song form provider for creating and updating songs.
final songFormNotifierProvider =
    StateNotifierProvider<SongFormNotifier, SongFormState>((ref) {
  return SongFormNotifier(
    repository: ref.watch(repertoireRepositoryProvider),
  );
});
