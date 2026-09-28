import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/availability_repository.dart';
import 'availability_list_controller.dart';

/// Provider for the availability HTTP repository.
final availabilityRepositoryProvider = Provider<AvailabilityRepository>((ref) {
  return HttpAvailabilityRepository(
    apiClient: ref.watch(apiClientProvider),
  );
});

/// Ministry-scoped availability list provider.
final availabilityListNotifierProvider =
    StateNotifierProvider<AvailabilityListNotifier, AvailabilityListState>(
        (ref) {
  return AvailabilityListNotifier(
    repository: ref.watch(availabilityRepositoryProvider),
  );
});
