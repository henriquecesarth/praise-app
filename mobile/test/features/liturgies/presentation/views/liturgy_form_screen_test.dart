import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/liturgies/data/liturgy_repository.dart';
import 'package:louvaio_mobile/features/liturgies/domain/liturgy.dart';
import 'package:louvaio_mobile/features/liturgies/presentation/views/liturgy_form_screen.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';

class FakeFormLiturgyRepo implements LiturgyRepository {
  Liturgy? createdLiturgy;
  Liturgy? updatedLiturgy;
  String? lastCreatedTitle;
  List<Map<String, dynamic>>? lastCreatedItems;

  @override
  Future<List<Liturgy>> listLiturgies(String ministryId) async => [];

  @override
  Future<Liturgy> getLiturgyById(String ministryId, String liturgyId) async {
    throw UnimplementedError();
  }

  @override
  Future<Liturgy> createLiturgy(
    String ministryId, {
    required String title,
    required String date,
    String? description,
    List<Map<String, dynamic>>? items,
  }) async {
    lastCreatedTitle = title;
    lastCreatedItems = items;
    return Liturgy(
      id: 'new-lit-1',
      ministryId: ministryId,
      title: title,
      date: date,
      description: description,
    );
  }

  @override
  Future<Liturgy> updateLiturgy(
    String ministryId,
    String liturgyId, {
    String? title,
    String? date,
    String? description,
    List<Map<String, dynamic>>? items,
  }) async {
    return Liturgy(
      id: liturgyId,
      ministryId: ministryId,
      title: title ?? 'Updated',
      date: date ?? '2026-10-15',
    );
  }

  @override
  Future<bool> deleteLiturgy(String ministryId, String liturgyId) async => true;
}

class FakeRepertoireRepo implements RepertoireRepository {
  List<SongSummary> songs = [
    const SongSummary(
      id: 'song-1',
      ministryId: 'min-1',
      title: 'Graça Infinitamente Maior',
      artistName: 'Comunidade da Graça',
      originalKey: 'D',
    ),
  ];

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async {
    return PaginatedSongs(songs: songs, total: songs.length, hasMore: false);
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async =>
      throw UnimplementedError();

  @override
  Future<List<Classification>> listClassifications(String ministryId) async =>
      [];
}

void main() {
  Widget createWidget({
    required FakeFormLiturgyRepo repo,
    FakeRepertoireRepo? repRepo,
    String? liturgyId,
    Liturgy? initialLiturgy,
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
        repertoireRepositoryProvider.overrideWithValue(repRepo ?? FakeRepertoireRepo()),
      ],
      child: MaterialApp(
        home: LiturgyFormScreen(
          ministryId: 'min-1',
          liturgyId: liturgyId,
          initialLiturgy: initialLiturgy,
        ),
      ),
    );
  }

  group('LiturgyFormScreen', () {
    testWidgets('empty title validation fails when tapping save', (tester) async {
      final repo = FakeFormLiturgyRepo();

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      expect(find.text('Nova Liturgia'), findsOneWidget);

      // Tap save without title
      await tester.tap(find.byKey(const ValueKey('save_liturgy_button')));
      await tester.pumpAndSettle();

      expect(find.text('Informe o título da liturgia.'), findsOneWidget);
      expect(repo.lastCreatedTitle, isNull);
    });

    testWidgets('fills title, adds reading item and submits successfully', (tester) async {
      final repo = FakeFormLiturgyRepo();

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      // Enter title
      await tester.enterText(
        find.byKey(const ValueKey('liturgy_title_input')),
        'Culto de Domingo Noite',
      );

      // Open Add Item modal
      await tester.tap(find.byKey(const ValueKey('add_liturgy_item_button')));
      await tester.pumpAndSettle();

      expect(find.text('Adicionar Momento'), findsOneWidget);

      // Select "Leitura"
      await tester.tap(find.text('Leitura'));
      await tester.pumpAndSettle();

      // Enter moment title
      await tester.enterText(
        find.byKey(const ValueKey('item_title_input')),
        'Leitura Bíblica: Salmos 100',
      );

      // Confirm add
      await tester.tap(find.byKey(const ValueKey('confirm_add_item_button')));
      await tester.pumpAndSettle();

      expect(find.text('Leitura Bíblica: Salmos 100'), findsOneWidget);
      expect(find.text('1 etapa cadastrada'), findsOneWidget);

      // Submit form
      await tester.tap(find.byKey(const ValueKey('save_liturgy_button')));
      await tester.pumpAndSettle();

      expect(repo.lastCreatedTitle, equals('Culto de Domingo Noite'));
      expect(repo.lastCreatedItems?.length, equals(1));
      expect(repo.lastCreatedItems?.first['title'], equals('Leitura Bíblica: Salmos 100'));
      expect(repo.lastCreatedItems?.first['type'], equals('reading'));
    });

    testWidgets('edit mode pre-populates initial liturgy', (tester) async {
      final repo = FakeFormLiturgyRepo();
      const initial = Liturgy(
        id: 'lit-99',
        ministryId: 'min-1',
        title: 'Culto Existente',
        date: '2026-11-01',
        description: 'Descrição prévia',
        items: [
          LiturgyItem(id: 'i-1', liturgyId: 'lit-99', title: 'Abertura', type: LiturgyItemType.custom),
        ],
      );

      await tester.pumpWidget(createWidget(
        repo: repo,
        liturgyId: 'lit-99',
        initialLiturgy: initial,
      ));
      await tester.pumpAndSettle();

      expect(find.text('Editar Liturgia'), findsOneWidget);
      expect(find.text('Culto Existente'), findsOneWidget);
      expect(find.text('Descrição prévia'), findsOneWidget);
      expect(find.text('Abertura'), findsOneWidget);
    });
  });
}
