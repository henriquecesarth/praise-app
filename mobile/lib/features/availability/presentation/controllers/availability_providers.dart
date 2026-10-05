import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/availability_repository.dart';
import 'availability_list_controller.dart';
import 'admin_availability_controller.dart';
import 'manual_member_availability_controller.dart';

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

/// Ministry-scoped consolidated admin availability provider.
final adminAvailabilityNotifierProvider =
    StateNotifierProvider<AdminAvailabilityNotifier, AdminAvailabilityState>(
        (ref) {
  return AdminAvailabilityNotifier(
    repository: ref.watch(availabilityRepositoryProvider),
    membersRepository: ref.watch(membersRepositoryProvider),
  );
});

/// Manual member availability administration provider.
final manualMemberAvailabilityNotifierProvider = StateNotifierProvider<
    ManualMemberAvailabilityNotifier, ManualMemberAvailabilityState>((ref) {
  return ManualMemberAvailabilityNotifier(
    repository: ref.watch(availabilityRepositoryProvider),
  );
});
