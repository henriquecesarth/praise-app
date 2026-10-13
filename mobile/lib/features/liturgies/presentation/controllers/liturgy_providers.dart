import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/liturgy_repository.dart';
import 'liturgy_detail_controller.dart';
import 'liturgy_form_controller.dart';
import 'liturgy_list_controller.dart';

final liturgyRepositoryProvider = Provider<LiturgyRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return HttpLiturgyRepository(apiClient: apiClient);
});

final liturgyListNotifierProvider =
    StateNotifierProvider<LiturgyListNotifier, LiturgyListState>((ref) {
  final repository = ref.watch(liturgyRepositoryProvider);
  return LiturgyListNotifier(repository: repository);
});

final liturgyDetailNotifierProvider =
    StateNotifierProvider<LiturgyDetailNotifier, LiturgyDetailState>((ref) {
  final repository = ref.watch(liturgyRepositoryProvider);
  return LiturgyDetailNotifier(repository: repository);
});

final liturgyFormNotifierProvider =
    StateNotifierProvider<LiturgyFormNotifier, LiturgyFormState>((ref) {
  final repository = ref.watch(liturgyRepositoryProvider);
  return LiturgyFormNotifier(repository: repository);
});
