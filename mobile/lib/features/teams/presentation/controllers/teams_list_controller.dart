import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/team_repository.dart';
import '../../domain/team.dart';

@immutable
class TeamsListState {
  final String? ministryId;
  final bool isLoading;
  final List<Team> teams;
  final String? errorMessage;
  final int generation;
  final String searchQuery;

  const TeamsListState({
    this.ministryId,
    this.isLoading = false,
    this.teams = const [],
    this.errorMessage,
    this.generation = 0,
    this.searchQuery = '',
  });

  bool get isEmpty => !isLoading && errorMessage == null && teams.isEmpty;
  bool get hasError => errorMessage != null;
  bool get isSuccess => !isLoading && errorMessage == null && teams.isNotEmpty;

  List<Team> get filteredTeams {
    final query = searchQuery.trim().toLowerCase();
    if (query.isEmpty) return teams;
    return teams.where((t) {
      final nameMatch = t.name.toLowerCase().contains(query);
      final descMatch = t.description?.toLowerCase().contains(query) ?? false;
      return nameMatch || descMatch;
    }).toList();
  }

  TeamsListState copyWith({
    String? ministryId,
    bool? isLoading,
    List<Team>? teams,
    String? errorMessage,
    bool clearError = false,
    int? generation,
    String? searchQuery,
  }) {
    return TeamsListState(
      ministryId: ministryId ?? this.ministryId,
      isLoading: isLoading ?? this.isLoading,
      teams: teams ?? this.teams,
      errorMessage: clearError ? null : (errorMessage ?? this.errorMessage),
      generation: generation ?? this.generation,
      searchQuery: searchQuery ?? this.searchQuery,
    );
  }
}

class TeamsListNotifier extends StateNotifier<TeamsListState> {
  final TeamRepository _repository;
  int _currentGeneration = 0;

  TeamsListNotifier({required TeamRepository repository})
      : _repository = repository,
        super(const TeamsListState());

  int get currentGeneration => _currentGeneration;

  Future<void> load(String ministryId, {bool force = false}) async {
    if (!force &&
        state.ministryId == ministryId &&
        state.teams.isNotEmpty &&
        !state.isLoading) {
      return;
    }

    final generation = ++_currentGeneration;
    state = state.copyWith(
      ministryId: ministryId,
      isLoading: true,
      clearError: true,
      generation: generation,
    );

    try {
      final list = await _repository.getTeams(ministryId);
      if (generation != _currentGeneration || state.ministryId != ministryId) {
        return; // Stale response fenced
      }

      state = state.copyWith(
        isLoading: false,
        teams: list,
        clearError: true,
      );
    } catch (e) {
      if (generation != _currentGeneration || state.ministryId != ministryId) {
        return; // Stale response fenced
      }
      state = state.copyWith(
        isLoading: false,
        errorMessage: e is AppFailure ? e.message : e.toString(),
      );
    }
  }

  Future<void> refresh(String ministryId) async {
    await load(ministryId, force: true);
  }

  void setSearchQuery(String query) {
    if (state.searchQuery == query) return;
    state = state.copyWith(searchQuery: query);
  }

  void removeTeamLocally(String teamId) {
    final updated = state.teams.where((t) => t.id != teamId).toList();
    state = state.copyWith(teams: updated);
  }

  void upsertTeamLocally(Team team) {
    final index = state.teams.indexWhere((t) => t.id == team.id);
    if (index >= 0) {
      final updated = List<Team>.from(state.teams);
      updated[index] = team;
      state = state.copyWith(teams: updated);
    } else {
      state = state.copyWith(teams: [team, ...state.teams]);
    }
  }

  void reset() {
    _currentGeneration++;
    state = const TeamsListState();
  }
}
