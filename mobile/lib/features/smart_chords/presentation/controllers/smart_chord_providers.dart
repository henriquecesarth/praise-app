import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/smart_chord_repository.dart';
import '../../data/smart_chord_repertoire_link_repository.dart';
import 'smart_chord_detail_controller.dart';
import 'smart_chord_form_controller.dart';
import 'smart_chord_import_controller.dart';
import 'smart_chord_list_controller.dart';
import 'smart_chord_repertoire_link_controller.dart';
import 'song_smart_chords_controller.dart';

final smartChordRepositoryProvider = Provider<SmartChordRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return HttpSmartChordRepository(apiClient: apiClient);
});

final smartChordRepertoireLinkRepositoryProvider =
    Provider<SmartChordRepertoireLinkRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return HttpSmartChordRepertoireLinkRepository(apiClient: apiClient);
});

final smartChordListNotifierProvider =
    StateNotifierProvider<SmartChordListNotifier, SmartChordListState>((ref) {
  final repository = ref.watch(smartChordRepositoryProvider);
  return SmartChordListNotifier(repository: repository);
});

final smartChordRepertoireLinkNotifierProvider = StateNotifierProvider<
    SmartChordRepertoireLinkNotifier, SmartChordRepertoireLinkState>((ref) {
  final repository = ref.watch(smartChordRepertoireLinkRepositoryProvider);
  return SmartChordRepertoireLinkNotifier(repository: repository);
});

final songSmartChordsNotifierProvider =
    StateNotifierProvider<SongSmartChordsNotifier, SongSmartChordsState>((ref) {
  final repository = ref.watch(smartChordRepositoryProvider);
  final linkRepository = ref.watch(smartChordRepertoireLinkRepositoryProvider);
  return SongSmartChordsNotifier(
    repository: repository,
    linkRepository: linkRepository,
  );
});

final smartChordDetailNotifierProvider =
    StateNotifierProvider<SmartChordDetailNotifier, SmartChordDetailState>((ref) {
  final repository = ref.watch(smartChordRepositoryProvider);
  return SmartChordDetailNotifier(repository: repository);
});

final smartChordFormNotifierProvider =
    StateNotifierProvider<SmartChordFormNotifier, SmartChordFormState>((ref) {
  final repository = ref.watch(smartChordRepositoryProvider);
  return SmartChordFormNotifier(repository: repository);
});

final smartChordImportNotifierProvider =
    StateNotifierProvider<SmartChordImportNotifier, SmartChordImportState>((ref) {
  final repository = ref.watch(smartChordRepositoryProvider);
  final linkRepository = ref.watch(smartChordRepertoireLinkRepositoryProvider);
  return SmartChordImportNotifier(
    repository: repository,
    linkRepository: linkRepository,
  );
});
