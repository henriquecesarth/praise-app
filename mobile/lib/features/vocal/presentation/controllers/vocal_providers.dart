import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/vocal_exercise_repository.dart';
import 'vocal_exercise_controller.dart';

final vocalExerciseRepositoryProvider = Provider<VocalExerciseRepository>((
  ref,
) {
  final apiClient = ref.watch(apiClientProvider);
  return ApiVocalExerciseRepository(apiClient);
});

final customVocalExercisesNotifierProvider =
    StateNotifierProvider<
      CustomVocalExercisesNotifier,
      CustomVocalExercisesState
    >((ref) {
      final repository = ref.watch(vocalExerciseRepositoryProvider);
      return CustomVocalExercisesNotifier(
        repository: repository,
        currentUserIdReader: () => ref.read(authNotifierProvider).user?.id,
      );
    });
