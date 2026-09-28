import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/repertoire_list_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/repertoire_view.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_detail_view.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/widgets/song_card.dart';

class FakeRepertoireRepo implements RepertoireRepository {
  List<SongSummary> songs = [];
  List<Classification> classifications = [];
  Exception? listError;
  int listCalls = 0;

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async {
    listCalls++;
    if (listError != null) throw listError!;

    var filtered = List<SongSummary>.from(songs);
    if (search != null && search.isNotEmpty) {
      filtered = filtered
          .where((s) => s.title.toLowerCase().contains(search.toLowerCase()))
          .toList();
    }
    if (classificationId != null && classificationId.isNotEmpty) {
      filtered = filtered
          .where((s) => s.classification?.id == classificationId)
          .toList();
    }

    return PaginatedSongs(
      songs: filtered,
      total: filtered.length,
      hasMore: false,
    );
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    return SongDetail(
      id: songId,
      ministryId: ministryId,
      title: 'Detalhe da Música',
      artistName: 'Artista',
      originalKey: 'G',
      lyrics: 'Letra...',
    );
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async {
    return classifications;
  }
}

void main() {
  late FakeRepertoireRepo fakeRepo;

  setUp(() {
    fakeRepo = FakeRepertoireRepo();
  });

  Widget createSubject({String? ministryId = 'min_1'}) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(
            env: AppEnv.development,
            apiBaseUrl: 'http://localhost:3000/api/v1',
          ),
        ),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        repertoireListNotifierProvider.overrideWith((ref) {
          return RepertoireListNotifier(repository: fakeRepo);
        }),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: RepertoireView(ministryId: ministryId),
        ),
      ),
    );
  }

  group('RepertoireView Presentation', () {
    testWidgets('renders search field and empty state when catalogue is empty',
        (tester) async {
      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.byType(TextField), findsOneWidget);
      expect(find.text('Buscar música por título, artista ou letra...'),
          findsOneWidget);
      expect(find.text('Repertório Vazio'), findsOneWidget);
    });

    testWidgets(
        'renders classification filter chips when classifications exist',
        (tester) async {
      fakeRepo.classifications = [
        const Classification(
            id: 'c1', ministryId: 'min_1', name: 'Louvor', color: '#7C3AED'),
        const Classification(
            id: 'c2', ministryId: 'min_1', name: 'Adoração', color: '#06B6D4'),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Todos'), findsOneWidget);
      expect(find.text('Louvor'), findsOneWidget);
      expect(find.text('Adoração'), findsOneWidget);
    });

    testWidgets('renders list of songs when data is present', (tester) async {
      fakeRepo.songs = [
        const SongSummary(
          id: 's1',
          ministryId: 'min_1',
          title: 'Grande é o Senhor',
          artistName: 'Adhemar de Campos',
          originalKey: 'A',
        ),
        const SongSummary(
          id: 's2',
          ministryId: 'min_1',
          title: 'Ruja o Leão',
          artistName: 'Talita Catanzaro',
          originalKey: 'Dm',
        ),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Grande é o Senhor'), findsOneWidget);
      expect(find.text('Adhemar de Campos'), findsOneWidget);
      expect(find.text('Ruja o Leão'), findsOneWidget);
      expect(find.byType(SongCard), findsNWidgets(2));
    });

    testWidgets('searching filters songs and clearing search restores list',
        (tester) async {
      fakeRepo.songs = [
        const SongSummary(
            id: 's1', ministryId: 'min_1', title: 'Aclame ao Senhor'),
        const SongSummary(
            id: 's2', ministryId: 'min_1', title: 'Vim Para Adorar-te'),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Aclame ao Senhor'), findsOneWidget);
      expect(find.text('Vim Para Adorar-te'), findsOneWidget);

      // Enter search term
      await tester.enterText(find.byType(TextField), 'Vim');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();

      expect(find.text('Vim Para Adorar-te'), findsOneWidget);
      expect(find.text('Aclame ao Senhor'), findsNothing);

      // Clear search via clear button
      final clearButton = find.byIcon(Icons.clear);
      expect(clearButton, findsOneWidget);
      await tester.tap(clearButton);
      await tester.pumpAndSettle();

      expect(find.text('Aclame ao Senhor'), findsOneWidget);
      expect(find.text('Vim Para Adorar-te'), findsOneWidget);
    });

    testWidgets('displays error state and retry triggers reload',
        (tester) async {
      fakeRepo.listError =
          const AppFailure(message: 'Falha de conexão com a API.');

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Falha de conexão com a API.'), findsOneWidget);
      expect(find.text('Tentar novamente'), findsOneWidget);

      // Clear error and press retry
      fakeRepo.listError = null;
      fakeRepo.songs = [
        const SongSummary(id: 's1', ministryId: 'min_1', title: 'Restaurado')
      ];

      await tester.tap(find.text('Tentar novamente'));
      await tester.pumpAndSettle();

      expect(find.text('Restaurado'), findsOneWidget);
    });

    testWidgets('tapping a song card navigates to SongDetailView',
        (tester) async {
      fakeRepo.songs = [
        const SongSummary(
            id: 's1', ministryId: 'min_1', title: 'Música Clicável'),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      await tester.tap(find.text('Música Clicável'));
      await tester.pumpAndSettle();

      expect(find.byType(SongDetailView), findsOneWidget);
    });

    testWidgets('renders responsive layout on tablet width without crash',
        (tester) async {
      tester.view.physicalSize = const Size(1200, 1920);
      tester.view.devicePixelRatio = 2.0;
      addTearDown(() {
        tester.view.resetPhysicalSize();
        tester.view.resetDevicePixelRatio();
      });

      fakeRepo.songs = [
        const SongSummary(id: 's1', ministryId: 'min_1', title: 'Tablet Song'),
      ];

      await tester.pumpWidget(createSubject());
      await tester.pumpAndSettle();

      expect(find.text('Tablet Song'), findsOneWidget);
    });

    testWidgets('displays prompt to select ministry when ministryId is null',
        (tester) async {
      await tester.pumpWidget(createSubject(ministryId: null));
      await tester.pumpAndSettle();

      expect(find.text('Selecione um ministério para ver o repertório.'),
          findsOneWidget);
    });
  });
}
