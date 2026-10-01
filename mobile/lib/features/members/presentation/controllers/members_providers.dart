import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/members_repository.dart';
import 'members_controller.dart';

final membersRepositoryProvider = Provider<MembersRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return HttpMembersRepository(apiClient: apiClient);
});

final membersDirectoryNotifierProvider =
    StateNotifierProvider<MembersDirectoryNotifier, MembersDirectoryState>((ref) {
  final repository = ref.watch(membersRepositoryProvider);
  return MembersDirectoryNotifier(repository: repository);
});
