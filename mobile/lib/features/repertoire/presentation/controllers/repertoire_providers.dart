import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/repertoire_repository.dart';
import 'repertoire_list_controller.dart';
import 'song_detail_controller.dart';

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
