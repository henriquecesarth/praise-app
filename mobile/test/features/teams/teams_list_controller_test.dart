import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/teams/data/team_repository.dart';
import 'package:louvaio_mobile/features/teams/domain/team.dart';
import 'package:louvaio_mobile/features/teams/presentation/controllers/teams_list_controller.dart';

class FakeTeamRepository implements TeamRepository {
  List<Team> teamsToReturn = [];
  Completer<List<Team>>? pendingCompleter;
  Exception? errorToThrow;

  @override
  Future<List<Team>> getTeams(String ministryId) async {
    if (errorToThrow != null) throw errorToThrow!;
    if (pendingCompleter != null) return pendingCompleter!.future;
    return teamsToReturn;
  }

  @override
  Future<Team> getTeamById(String ministryId, String teamId) async =>
      throw UnimplementedError();

  @override
  Future<Team> createTeam(String ministryId,
          {required String name,
          String? description,
          List<String>? memberIds}) async =>
      throw UnimplementedError();

  @override
  Future<Team> updateTeam(String ministryId, String teamId,
          {String? name,
          String? description,
          List<String>? memberIds}) async =>
      throw UnimplementedError();

  @override
  Future<void> deleteTeam(String ministryId, String teamId) async =>
      throw UnimplementedError();
}

void main() {
  late FakeTeamRepository repo;
  late TeamsListNotifier notifier;

  setUp(() {
    repo = FakeTeamRepository();
    notifier = TeamsListNotifier(repository: repo);
  });

  group('TeamsListNotifier', () {
    test('initial state is empty and pristine', () {
      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.teams, isEmpty);
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isEmpty, isTrue);
    });

    test('load populates state and marks success', () async {
      repo.teamsToReturn = [
        const Team(
          id: 'team-1',
          ministryId: 'min-alpha',
          name: 'Vocal',
          memberIds: ['m1'],
        ),
      ];

      await notifier.load('min-alpha');

      expect(notifier.state.ministryId, equals('min-alpha'));
      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.isSuccess, isTrue);
      expect(notifier.state.teams.length, equals(1));
      expect(notifier.state.teams.first.name, equals('Vocal'));
    });

    test('load without force avoids duplicate call if already loaded',
        () async {
      repo.teamsToReturn = [
        const Team(id: 'team-1', ministryId: 'min-1', name: 'T1'),
      ];

      await notifier.load('min-1');
      expect(notifier.state.teams.length, equals(1));

      // Change repo return, but non-force load should keep current
      repo.teamsToReturn = [];
      await notifier.load('min-1', force: false);
      expect(notifier.state.teams.length, equals(1));

      // Refresh (force) should update
      await notifier.refresh('min-1');
      expect(notifier.state.teams.length, equals(0));
    });

    test('search query filters filteredTeams in memory', () {
      notifier.state = const TeamsListState(
        ministryId: 'min-1',
        teams: [
          Team(id: '1', ministryId: 'min-1', name: 'Vocal Feminino'),
          Team(id: '2', ministryId: 'min-1', name: 'Banda Base', description: 'Bateria e baixo'),
          Team(id: '3', ministryId: 'min-1', name: 'Metais'),
        ],
      );

      notifier.setSearchQuery('vocal');
      expect(notifier.state.filteredTeams.length, equals(1));
      expect(notifier.state.filteredTeams.first.name, equals('Vocal Feminino'));

      notifier.setSearchQuery('bateria');
      expect(notifier.state.filteredTeams.length, equals(1));
      expect(notifier.state.filteredTeams.first.name, equals('Banda Base'));

      notifier.setSearchQuery('');
      expect(notifier.state.filteredTeams.length, equals(3));
    });

    test('removeTeamLocally and upsertTeamLocally mutate state correctly', () {
      notifier.state = const TeamsListState(
        ministryId: 'min-1',
        teams: [
          Team(id: '1', ministryId: 'min-1', name: 'T1'),
          Team(id: '2', ministryId: 'min-1', name: 'T2'),
        ],
      );

      notifier.removeTeamLocally('1');
      expect(notifier.state.teams.length, equals(1));
      expect(notifier.state.teams.first.id, equals('2'));

      // Update existing
      notifier.upsertTeamLocally(
        const Team(id: '2', ministryId: 'min-1', name: 'T2 Updated'),
      );
      expect(notifier.state.teams.first.name, equals('T2 Updated'));

      // Insert new
      notifier.upsertTeamLocally(
        const Team(id: '3', ministryId: 'min-1', name: 'T3 New'),
      );
      expect(notifier.state.teams.length, equals(2));
      expect(notifier.state.teams.first.id, equals('3'));
    });

    test('error during load sets errorMessage', () async {
      repo.errorToThrow = const AppFailure(message: 'Falha de rede');

      await notifier.load('min-1');

      expect(notifier.state.isLoading, isFalse);
      expect(notifier.state.hasError, isTrue);
      expect(notifier.state.errorMessage, equals('Falha de rede'));
    });

    test('TEAM_LIST_TENANT_FENCING: pending request from Alpha is discarded when Beta is loaded', () async {
      final alphaCompleter = Completer<List<Team>>();
      repo.pendingCompleter = alphaCompleter;

      // Start Alpha load
      final alphaFuture = notifier.load('min-alpha');
      expect(notifier.state.ministryId, equals('min-alpha'));
      expect(notifier.state.isLoading, isTrue);

      // User immediately switches to Beta
      final betaCompleter = Completer<List<Team>>();
      repo.pendingCompleter = betaCompleter;
      final betaFuture = notifier.load('min-beta');
      expect(notifier.state.ministryId, equals('min-beta'));

      // Complete Alpha late
      alphaCompleter.complete([
        const Team(id: 'alpha-1', ministryId: 'min-alpha', name: 'Alpha Team'),
      ]);
      await alphaFuture;

      // State MUST NOT have Alpha data
      expect(notifier.state.ministryId, equals('min-beta'));
      expect(notifier.state.teams, isEmpty);

      // Complete Beta
      betaCompleter.complete([
        const Team(id: 'beta-1', ministryId: 'min-beta', name: 'Beta Team'),
      ]);
      await betaFuture;

      expect(notifier.state.ministryId, equals('min-beta'));
      expect(notifier.state.teams.length, equals(1));
      expect(notifier.state.teams.first.name, equals('Beta Team'));
    });

    test('reset increments generation and clears state', () {
      notifier.state = const TeamsListState(
        ministryId: 'min-1',
        teams: [Team(id: '1', ministryId: 'min-1', name: 'T1')],
      );

      final genBefore = notifier.currentGeneration;
      notifier.reset();

      expect(notifier.currentGeneration, greaterThan(genBefore));
      expect(notifier.state.ministryId, isNull);
      expect(notifier.state.teams, isEmpty);
    });
  });
}
