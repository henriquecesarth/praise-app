import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../data/team_repository.dart';
import 'teams_list_controller.dart';
import 'team_form_controller.dart';

final teamRepositoryProvider = Provider<TeamRepository>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  return HttpTeamRepository(apiClient: apiClient);
});

final teamsListNotifierProvider =
    StateNotifierProvider<TeamsListNotifier, TeamsListState>((ref) {
  final repository = ref.watch(teamRepositoryProvider);
  return TeamsListNotifier(repository: repository);
});

final teamFormNotifierProvider =
    StateNotifierProvider<TeamFormNotifier, TeamFormState>((ref) {
  final teamRepository = ref.watch(teamRepositoryProvider);
  final membersRepository = ref.watch(membersRepositoryProvider);
  return TeamFormNotifier(
    teamRepository: teamRepository,
    membersRepository: membersRepository,
  );
});
