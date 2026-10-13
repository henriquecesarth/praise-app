import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/smart_chord_repository.dart';
import 'smart_chord_detail_controller.dart';
import 'smart_chord_form_controller.dart';
import 'smart_chord_list_controller.dart';
import 'song_smart_chords_controller.dart';

final smartChordRepositoryProvider = Provider<SmartChordRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return HttpSmartChordRepository(apiClient: apiClient);
});

final smartChordListNotifierProvider =
    StateNotifierProvider<SmartChordListNotifier, SmartChordListState>((ref) {
  final repository = ref.watch(smartChordRepositoryProvider);
  return SmartChordListNotifier(repository: repository);
});

final songSmartChordsNotifierProvider =
    StateNotifierProvider<SongSmartChordsNotifier, SongSmartChordsState>((ref) {
  final repository = ref.watch(smartChordRepositoryProvider);
  return SongSmartChordsNotifier(repository: repository);
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
