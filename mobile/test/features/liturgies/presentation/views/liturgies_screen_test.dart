import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/liturgies/data/liturgy_repository.dart';
import 'package:louvaio_mobile/features/liturgies/domain/liturgy.dart';
import 'package:louvaio_mobile/features/liturgies/presentation/views/liturgies_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';

class FakeLiturgyRepo implements LiturgyRepository {
  List<Liturgy> liturgies = [];
  Exception? error;
  int listCallCount = 0;

  @override
  Future<List<Liturgy>> listLiturgies(String ministryId) async {
    listCallCount++;
    if (error != null) throw error!;
    return liturgies;
  }

  @override
  Future<Liturgy> getLiturgyById(String ministryId, String liturgyId) async {
    return liturgies.firstWhere((l) => l.id == liturgyId);
  }

  @override
  Future<Liturgy> createLiturgy(String ministryId, {required String title, required String date, String? description, List<Map<String, dynamic>>? items}) async {
    return Liturgy(id: 'created-1', ministryId: ministryId, title: title, date: date);
  }

  @override
  Future<Liturgy> updateLiturgy(String ministryId, String liturgyId, {String? title, String? date, String? description, List<Map<String, dynamic>>? items}) async {
    return Liturgy(id: liturgyId, ministryId: ministryId, title: title ?? '', date: date ?? '');
  }

  @override
  Future<bool> deleteLiturgy(String ministryId, String liturgyId) async {
    return true;
  }
}

class FakeMinistryContextNotifier extends StateNotifier<MinistryContextState>
    implements MinistryContextNotifier {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  FakeMinistryContextNotifier(Ministry initialMinistry)
      : super(MinistryContextState(
          status: MinistryBootstrapStatus.ready,
          selectedMinistry: initialMinistry,
          availableMinistries: [initialMinistry],
        ));

  @override
  Future<void> bootstrap() async {}

  @override
  Future<void> refresh() async {}

  @override
  Future<void> selectMinistry(Ministry ministry) async {}

  @override
  Future<void> reset() async {}
}

void main() {
  const adminMinistry = Ministry(
    id: 'min-1',
    name: 'Ministério Alfa',
    role: 'admin',
  );

  const memberMinistry = Ministry(
    id: 'min-1',
    name: 'Ministério Alfa',
    role: 'member',
  );

  Widget createWidget({
    required FakeLiturgyRepo repo,
    Ministry ministry = adminMinistry,
  }) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        liturgyRepositoryProvider.overrideWithValue(repo),
        ministryContextNotifierProvider.overrideWith(
          (ref) => FakeMinistryContextNotifier(ministry),
        ),
      ],
      child: const MaterialApp(
        home: LiturgiesScreen(
          ministryId: 'min-1',
          ministryName: 'Ministério Alfa',
        ),
      ),
    );
  }

  group('LiturgiesScreen', () {
    testWidgets('renders loading and then populated list with LiturgyCards', (tester) async {
      final repo = FakeLiturgyRepo()
        ..liturgies = [
          const Liturgy(
            id: 'lit-1',
            ministryId: 'min-1',
            title: 'Culto da Família',
            date: '2026-10-18',
            description: 'Tema: Unidade no Lar',
            explicitItemCount: 4,
            explicitSongCount: 3,
          ),
        ];

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pump(); // Start async fetch
      await tester.pumpAndSettle(); // Settle list

      expect(find.text('Liturgias & Roteiros'), findsOneWidget);
      expect(find.text('Ministério Alfa'), findsOneWidget);
      expect(find.text('Culto da Família'), findsOneWidget);
      expect(find.text('Tema: Unidade no Lar'), findsOneWidget);
      expect(find.text('4 itens'), findsOneWidget);
      expect(find.text('3 músicas'), findsOneWidget);
      expect(find.byKey(const ValueKey('create_liturgy_fab')), findsOneWidget);
    });

    testWidgets('non-admin user does not see create_liturgy_fab', (tester) async {
      final repo = FakeLiturgyRepo()
        ..liturgies = [
          const Liturgy(
            id: 'lit-1',
            ministryId: 'min-1',
            title: 'Culto da Família',
            date: '2026-10-18',
          ),
        ];

      await tester.pumpWidget(createWidget(repo: repo, ministry: memberMinistry));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('create_liturgy_fab')), findsNothing);
    });

    testWidgets('renders empty state when no liturgies exist', (tester) async {
      final repo = FakeLiturgyRepo()..liturgies = [];

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.text('Nenhuma liturgia cadastrada'), findsOneWidget);
      expect(find.byKey(const ValueKey('empty_create_liturgy_button')), findsOneWidget);
    });

    testWidgets('renders error state and retry button triggers re-fetch', (tester) async {
      final repo = FakeLiturgyRepo()
        ..error = const AppFailure(message: 'Falha ao carregar');

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.text('Falha ao carregar'), findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Fix error and tap retry
      repo.error = null;
      repo.liturgies = [
        const Liturgy(id: 'lit-2', ministryId: 'min-1', title: 'Culto Restaurado', date: '2026-10-25'),
      ];

      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      expect(find.text('Culto Restaurado'), findsOneWidget);
    });
  });
}
