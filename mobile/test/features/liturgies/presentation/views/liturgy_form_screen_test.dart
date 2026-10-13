import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/liturgies/data/liturgy_repository.dart';
import 'package:louvaio_mobile/features/liturgies/domain/liturgy.dart';
import 'package:louvaio_mobile/features/liturgies/presentation/views/liturgy_form_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
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
  List<Map<String, dynamic>>? lastUpdatedItems;
  Completer<void>? createCompleter;
  Completer<void>? updateCompleter;

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
    if (createCompleter != null) await createCompleter!.future;
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
    if (updateCompleter != null) await updateCompleter!.future;
    lastUpdatedItems = items;
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

class FakeMinistryContextNotifier extends StateNotifier<MinistryContextState>
    implements MinistryContextNotifier {
  FakeMinistryContextNotifier(Ministry initialMinistry)
      : super(MinistryContextState(
          status: MinistryBootstrapStatus.ready,
          selectedMinistry: initialMinistry,
          availableMinistries: [initialMinistry],
        ));

  void changeMinistry(Ministry ministry) {
    state = state.copyWith(selectedMinistry: ministry);
  }

  @override
  Future<void> bootstrap() async {}

  @override
  Future<void> refresh() async {}

  @override
  Future<void> selectMinistry(Ministry ministry) async {}

  @override
  Future<void> reset() async {}
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
    FakeMinistryContextNotifier? ministryNotifier,
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
        if (ministryNotifier != null)
          ministryContextNotifierProvider.overrideWith((ref) => ministryNotifier)
        else
          ministryContextNotifierProvider.overrideWith(
            (ref) => FakeMinistryContextNotifier(
              const Ministry(id: 'min-1', name: 'Min 1', role: 'admin'),
            ),
          ),
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

    testWidgets('downward reorder adjusts index properly and maintains contiguous positions', (tester) async {
      final repo = FakeFormLiturgyRepo();
      const initial = Liturgy(
        id: 'lit-reorder-1',
        ministryId: 'min-1',
        title: 'Culto Ordem',
        date: '2026-10-15',
        items: [
          LiturgyItem(id: 'i-0', liturgyId: 'lit-reorder-1', title: 'Item 0', type: LiturgyItemType.custom, position: 0),
          LiturgyItem(id: 'i-1', liturgyId: 'lit-reorder-1', title: 'Item 1', type: LiturgyItemType.custom, position: 1),
          LiturgyItem(id: 'i-2', liturgyId: 'lit-reorder-1', title: 'Item 2', type: LiturgyItemType.custom, position: 2),
        ],
      );

      await tester.pumpWidget(createWidget(
        repo: repo,
        liturgyId: 'lit-reorder-1',
        initialLiturgy: initial,
      ));
      await tester.pumpAndSettle();

      final reorderableList = tester.widget<ReorderableListView>(find.byType(ReorderableListView));

      // Drag first item (0) to end (index 3 in Flutter callback)
      reorderableList.onReorderItem!(0, 3);
      await tester.pumpAndSettle();

      // Submit to inspect updated order
      await tester.tap(find.byKey(const ValueKey('save_liturgy_button')));
      await tester.pumpAndSettle();

      expect(repo.lastUpdatedItems?.length, equals(3));
      expect(repo.lastUpdatedItems?[0]['title'], equals('Item 1'));
      expect(repo.lastUpdatedItems?[0]['position'], equals(0));
      expect(repo.lastUpdatedItems?[1]['title'], equals('Item 2'));
      expect(repo.lastUpdatedItems?[1]['position'], equals(1));
      expect(repo.lastUpdatedItems?[2]['title'], equals('Item 0'));
      expect(repo.lastUpdatedItems?[2]['position'], equals(2));
    });

    testWidgets('upward reorder (last to first) maintains contiguous positions', (tester) async {
      final repo = FakeFormLiturgyRepo();
      const initial = Liturgy(
        id: 'lit-reorder-2',
        ministryId: 'min-1',
        title: 'Culto Ordem 2',
        date: '2026-10-15',
        items: [
          LiturgyItem(id: 'i-0', liturgyId: 'lit-reorder-2', title: 'Item 0', type: LiturgyItemType.custom, position: 0),
          LiturgyItem(id: 'i-1', liturgyId: 'lit-reorder-2', title: 'Item 1', type: LiturgyItemType.custom, position: 1),
          LiturgyItem(id: 'i-2', liturgyId: 'lit-reorder-2', title: 'Item 2', type: LiturgyItemType.custom, position: 2),
        ],
      );

      await tester.pumpWidget(createWidget(
        repo: repo,
        liturgyId: 'lit-reorder-2',
        initialLiturgy: initial,
      ));
      await tester.pumpAndSettle();

      final reorderableList = tester.widget<ReorderableListView>(find.byType(ReorderableListView));

      // Drag last item (2) to top (index 0)
      reorderableList.onReorderItem!(2, 0);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('save_liturgy_button')));
      await tester.pumpAndSettle();

      expect(repo.lastUpdatedItems?.length, equals(3));
      expect(repo.lastUpdatedItems?[0]['title'], equals('Item 2'));
      expect(repo.lastUpdatedItems?[0]['position'], equals(0));
      expect(repo.lastUpdatedItems?[1]['title'], equals('Item 0'));
      expect(repo.lastUpdatedItems?[1]['position'], equals(1));
      expect(repo.lastUpdatedItems?[2]['title'], equals('Item 1'));
      expect(repo.lastUpdatedItems?[2]['position'], equals(2));
    });

    testWidgets('first to middle reorder maintains contiguous positions', (tester) async {
      final repo = FakeFormLiturgyRepo();
      const initial = Liturgy(
        id: 'lit-reorder-3',
        ministryId: 'min-1',
        title: 'Culto Ordem 3',
        date: '2026-10-15',
        items: [
          LiturgyItem(id: 'i-0', liturgyId: 'lit-reorder-3', title: 'Item 0', type: LiturgyItemType.custom, position: 0),
          LiturgyItem(id: 'i-1', liturgyId: 'lit-reorder-3', title: 'Item 1', type: LiturgyItemType.custom, position: 1),
          LiturgyItem(id: 'i-2', liturgyId: 'lit-reorder-3', title: 'Item 2', type: LiturgyItemType.custom, position: 2),
        ],
      );

      await tester.pumpWidget(createWidget(
        repo: repo,
        liturgyId: 'lit-reorder-3',
        initialLiturgy: initial,
      ));
      await tester.pumpAndSettle();

      final reorderableList = tester.widget<ReorderableListView>(find.byType(ReorderableListView));

      // Move 0 to 2 (after item 1 in downward shift)
      reorderableList.onReorderItem!(0, 2);
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('save_liturgy_button')));
      await tester.pumpAndSettle();

      expect(repo.lastUpdatedItems?.length, equals(3));
      expect(repo.lastUpdatedItems?[0]['title'], equals('Item 1'));
      expect(repo.lastUpdatedItems?[0]['position'], equals(0));
      expect(repo.lastUpdatedItems?[1]['title'], equals('Item 0'));
      expect(repo.lastUpdatedItems?[1]['position'], equals(1));
      expect(repo.lastUpdatedItems?[2]['title'], equals('Item 2'));
      expect(repo.lastUpdatedItems?[2]['position'], equals(2));
    });

    testWidgets('clears selected song reference when item type switches away from song', (tester) async {
      final repo = FakeFormLiturgyRepo();

      await tester.pumpWidget(createWidget(repo: repo));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('liturgy_title_input')),
        'Culto Transição',
      );

      // Open Add Item sheet
      await tester.tap(find.byKey(const ValueKey('add_liturgy_item_button')));
      await tester.pumpAndSettle();

      // Open Song Picker
      await tester.tap(find.byKey(const ValueKey('pick_repertoire_song_button')));
      await tester.pumpAndSettle();

      // Select song
      await tester.tap(find.text('Graça Infinitamente Maior'));
      await tester.pumpAndSettle();

      // Switch type to "Oração"
      await tester.tap(find.text('Oração'));
      await tester.pumpAndSettle();

      // Confirm add
      await tester.tap(find.byKey(const ValueKey('confirm_add_item_button')));
      await tester.pumpAndSettle();

      // Submit
      await tester.tap(find.byKey(const ValueKey('save_liturgy_button')));
      await tester.pumpAndSettle();

      expect(repo.lastCreatedItems?.length, equals(1));
      final item = repo.lastCreatedItems!.first;
      expect(item['type'], equals('prayer'));
      expect(item['song_id'], isNull);
    });

    testWidgets('auto-dismisses form when active ministry changes', (tester) async {
      final repo = FakeFormLiturgyRepo();
      final contextNotifier = FakeMinistryContextNotifier(
        const Ministry(id: 'min-1', name: 'Alfa', role: 'admin'),
      );

      await tester.pumpWidget(createWidget(
        repo: repo,
        ministryNotifier: contextNotifier,
      ));
      await tester.pumpAndSettle();

      expect(find.byType(LiturgyFormScreen), findsOneWidget);

      // Switch to Beta
      contextNotifier.changeMinistry(
        const Ministry(id: 'min-2', name: 'Beta', role: 'admin'),
      );
      await tester.pumpAndSettle();

      expect(find.byType(LiturgyFormScreen), findsNothing);
    });

    testWidgets('discards UI feedback and navigation if tenant switches during submit', (tester) async {
      final repo = FakeFormLiturgyRepo();
      repo.createCompleter = Completer<void>();
      final contextNotifier = FakeMinistryContextNotifier(
        const Ministry(id: 'min-1', name: 'Alfa', role: 'admin'),
      );

      await tester.pumpWidget(createWidget(
        repo: repo,
        ministryNotifier: contextNotifier,
      ));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const ValueKey('liturgy_title_input')),
        'Culto Fencing',
      );

      // Tap save
      await tester.tap(find.byKey(const ValueKey('save_liturgy_button')));
      await tester.pump(); // Submit started, awaiting createCompleter

      // Switch tenant while submit is in progress
      contextNotifier.changeMinistry(
        const Ministry(id: 'min-2', name: 'Beta', role: 'admin'),
      );
      await tester.pumpAndSettle();

      // Complete async create
      repo.createCompleter!.complete();
      await tester.pumpAndSettle();

      // Verify no SnackBar for successful creation was shown
      expect(find.text('Liturgia criada com sucesso.'), findsNothing);
    });
  });
}
