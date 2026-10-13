import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/liturgies/data/liturgy_repository.dart';
import 'package:louvaio_mobile/features/liturgies/domain/liturgy.dart';
import 'package:louvaio_mobile/features/liturgies/presentation/views/liturgy_detail_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';

class FakeDetailRepo implements LiturgyRepository {
  Liturgy? liturgyToReturn;
  Exception? error;
  int deleteCallCount = 0;

  @override
  Future<List<Liturgy>> listLiturgies(String ministryId) async => [];

  @override
  Future<Liturgy> getLiturgyById(String ministryId, String liturgyId) async {
    if (error != null) throw error!;
    return liturgyToReturn!;
  }

  @override
  Future<Liturgy> createLiturgy(String ministryId, {required String title, required String date, String? description, List<Map<String, dynamic>>? items}) async {
    throw UnimplementedError();
  }

  @override
  Future<Liturgy> updateLiturgy(String ministryId, String liturgyId, {String? title, String? date, String? description, List<Map<String, dynamic>>? items}) async {
    throw UnimplementedError();
  }

  @override
  Future<bool> deleteLiturgy(String ministryId, String liturgyId) async {
    deleteCallCount++;
    return true;
  }
}

class FakeMinistryContextNotifier extends StateNotifier<MinistryContextState>
    implements MinistryContextNotifier {
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

  const sampleLiturgy = Liturgy(
    id: 'lit-1',
    ministryId: 'min-1',
    title: 'Culto de Celebração',
    date: '2026-10-25',
    description: 'Roteiro com louvor e leitura bíblica',
    items: [
      LiturgyItem(
        id: 'item-1',
        liturgyId: 'lit-1',
        title: 'Oração Pastoral',
        type: LiturgyItemType.prayer,
        position: 0,
      ),
      LiturgyItem(
        id: 'item-2',
        liturgyId: 'lit-1',
        title: 'Porque Ele Vive',
        type: LiturgyItemType.song,
        songId: 'song-55',
        song: SongSummary(
          id: 'song-55',
          ministryId: 'min-1',
          title: 'Porque Ele Vive',
          artistName: 'Harpa Cristã',
          originalKey: 'G',
        ),
        position: 1,
      ),
      LiturgyItem(
        id: 'item-3',
        liturgyId: 'lit-1',
        title: 'Leitura de Salmos',
        type: LiturgyItemType.reading,
        position: 2,
      ),
    ],
  );

  Widget createWidget({
    required FakeDetailRepo repo,
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
        home: LiturgyDetailScreen(
          ministryId: 'min-1',
          liturgyId: 'lit-1',
        ),
      ),
    );
  }

  group('LiturgyDetailScreen', () {
    testWidgets('renders liturgy header, description, and item tiles', (tester) async {
      final repo = FakeDetailRepo()..liturgyToReturn = sampleLiturgy;

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pump();
      await tester.pumpAndSettle();

      expect(find.text('Culto de Celebração'), findsWidgets);
      expect(find.text('Roteiro com louvor e leitura bíblica'), findsOneWidget);
      expect(find.text('Oração Pastoral'), findsOneWidget);
      expect(find.text('Porque Ele Vive'), findsOneWidget);
      expect(find.text('Leitura de Salmos'), findsOneWidget);
      expect(find.text('Cifra'), findsOneWidget); // song badge
    });

    testWidgets('admin sees edit and delete buttons in AppBar', (tester) async {
      final repo = FakeDetailRepo()..liturgyToReturn = sampleLiturgy;

      await tester.pumpWidget(createWidget(repo: repo, ministry: adminMinistry));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('edit_liturgy_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('delete_liturgy_button')), findsOneWidget);
    });

    testWidgets('member does not see edit or delete buttons', (tester) async {
      final repo = FakeDetailRepo()..liturgyToReturn = sampleLiturgy;

      await tester.pumpWidget(createWidget(repo: repo, ministry: memberMinistry));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('edit_liturgy_button')), findsNothing);
      expect(find.byKey(const ValueKey('delete_liturgy_button')), findsNothing);
    });

    testWidgets('delete flow shows confirmation dialog and calls repo', (tester) async {
      final repo = FakeDetailRepo()..liturgyToReturn = sampleLiturgy;

      await tester.pumpWidget(createWidget(repo: repo, ministry: adminMinistry));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('delete_liturgy_button')));
      await tester.pumpAndSettle();

      expect(find.text('Excluir Liturgia'), findsOneWidget);
      expect(find.text('Deseja realmente excluir a liturgia "Culto de Celebração"? Esta ação removerá todos os itens do roteiro.'), findsOneWidget);

      await tester.tap(find.widgetWithText(FilledButton, 'Excluir'));
      await tester.pumpAndSettle();

      expect(repo.deleteCallCount, equals(1));
    });
  });
}
