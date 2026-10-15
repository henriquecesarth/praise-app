import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_summary.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/repertoire_list_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/song_detail_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/repertoire_view.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_detail_view.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/widgets/song_card.dart';

class _FakeAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword(
          {required String email, required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> signUp(
          {required String name,
          required String email,
          required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class FakeAuthNotifier extends AuthNotifier {
  FakeAuthNotifier([
    AuthState initialState = const AuthState.authenticated(
      AuthUser(id: 'admin_user', email: 'admin@test.com', name: 'Admin'),
    ),
  ]) : super(_FakeAuthRepo()) {
    state = initialState;
  }

  void setUser(AuthUser? user) {
    if (user != null) {
      state = AuthState.authenticated(user);
    } else {
      state = const AuthState.unauthenticated();
    }
  }

  @override
  Future<void> logout() async {
    state = const AuthState.unauthenticated();
  }
}

class _FakePreferencesStorage implements PreferencesStorage {
  @override
  Future<void> clear() async {}
  @override
  String? getSelectedMinistryId() => null;
  @override
  String? getThemeMode() => null;
  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {}
  @override
  Future<void> setThemeMode(String? themeMode) async {}
}

class _FakeMinistryRepo implements MinistryRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<Ministry>> getMyMinistries() async => [];
}

class FakeMinistryContextNotifier extends MinistryContextNotifier {
  FakeMinistryContextNotifier({String role = 'member'})
      : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: Ministry(id: 'min_1', name: 'Min 1', role: role),
      availableMinistries: [
        Ministry(id: 'min_1', name: 'Min 1', role: role),
      ],
    );
  }
}

class FakeRepertoireRepo implements RepertoireRepository {
  List<SongSummary> songs = [];
  SongDetail? detail;
  String? deletedSongId;
  Completer<void>? deleteCompleter;

  @override
  Future<PaginatedSongs> listSongs(String ministryId,
      {String? search, String? classificationId, String? cursor, int? page, int? limit}) async {
    var filtered = songs;
    if (search != null && search.trim().isNotEmpty) {
      filtered = songs
          .where((s) => s.title.toLowerCase().contains(search.trim().toLowerCase()))
          .toList();
    }
    return PaginatedSongs(songs: filtered, total: filtered.length);
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    return detail ??
        SongDetail(
          id: songId,
          ministryId: ministryId,
          title: 'Musica Teste',
          artistName: 'Artista Teste',
        );
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async => [];

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async {
    final detail = SongDetail(id: 'new-id', ministryId: ministryId, title: data.title);
    songs = [
      ...songs,
      SongSummary(
        id: 'new-id',
        ministryId: ministryId,
        title: data.title,
        originalKey: data.originalKey,
      ),
    ];
    return detail;
  }

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async {
    final updated = SongDetail(id: songId, ministryId: ministryId, title: data.title);
    songs = songs.map((s) {
      if (s.id == songId) {
        return SongSummary(
          id: songId,
          ministryId: ministryId,
          title: data.title,
          originalKey: data.originalKey ?? s.originalKey,
        );
      }
      return s;
    }).toList();
    detail = updated;
    return updated;
  }

  @override
  Future<void> deleteSong(String ministryId, String songId) async {
    if (deleteCompleter != null) {
      await deleteCompleter!.future;
    }
    deletedSongId = songId;
    songs.removeWhere((s) => s.id == songId);
  }

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async => [];

  @override
  Future<Artist> createArtist(String ministryId, String name) async =>
      Artist(id: 'a1', ministryId: ministryId, name: name);
}

void main() {
  late FakeRepertoireRepo fakeRepo;
  late FakeAuthNotifier authNotifier;

  setUp(() {
    fakeRepo = FakeRepertoireRepo();
    authNotifier = FakeAuthNotifier();
  });

  Widget buildRepertoireView({required String role}) {
    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
        ),
        preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
        ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
        ministryContextNotifierProvider.overrideWith((ref) => FakeMinistryContextNotifier(role: role)),
        authNotifierProvider.overrideWith((ref) => authNotifier),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        repertoireListNotifierProvider.overrideWith((ref) => RepertoireListNotifier(repository: fakeRepo)),
      ],
      child: const MaterialApp(
        home: RepertoireView(ministryId: 'min_1'),
      ),
    );
  }

  Widget buildSongDetailView({required String role}) {
    fakeRepo.detail = const SongDetail(
      id: 'song_123',
      ministryId: 'min_1',
      title: 'Vitorioso Es',
      artistName: 'Gabriel Guedes',
    );

    return ProviderScope(
      overrides: [
        appEnvironmentProvider.overrideWithValue(
          const AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
        ),
        preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
        ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
        ministryContextNotifierProvider.overrideWith((ref) => FakeMinistryContextNotifier(role: role)),
        authNotifierProvider.overrideWith((ref) => authNotifier),
        repertoireRepositoryProvider.overrideWithValue(fakeRepo),
        songDetailNotifierProvider.overrideWith((ref) => SongDetailNotifier(repository: fakeRepo)),
        songFormNotifierProvider.overrideWith((ref) => SongFormNotifier(repository: fakeRepo)),
      ],
      child: const MaterialApp(
        home: SongDetailView(
          ministryId: 'min_1',
          songId: 'song_123',
        ),
      ),
    );
  }

  group('Repertoire Admin Actions & RBAC Visibility', () {
    testWidgets('RepertoireView renders FAB "Nova musica" for admin', (tester) async {
      await tester.pumpWidget(buildRepertoireView(role: 'admin'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('repertoire_add_song_fab')), findsOneWidget);
      expect(find.byIcon(Icons.add), findsOneWidget);
    });

    testWidgets('RepertoireView hides FAB "Nova musica" for regular member', (tester) async {
      await tester.pumpWidget(buildRepertoireView(role: 'member'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('repertoire_add_song_fab')), findsNothing);
    });

    testWidgets('CREATE_RETURN_LIST_CONVERGENCE: create song returns to RepertoireView and displays created song without getting stuck on loading spinner', (tester) async {
      await tester.pumpWidget(buildRepertoireView(role: 'admin'));
      await tester.pumpAndSettle();

      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('Repertório Vazio'), findsOneWidget);

      // Open create form via FAB
      await tester.tap(find.byKey(const ValueKey('repertoire_add_song_fab')));
      await tester.pumpAndSettle();

      // Enter title
      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'Música Nova Criada');
      await tester.pumpAndSettle();

      // Tap Salvar
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      // Form is dismissed, return to RepertoireView
      expect(find.byKey(const ValueKey('song_form_save_button')), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('Música Nova Criada'), findsOneWidget);
    });

    testWidgets('EDIT_RETURN_LIST_CONVERGENCE: edit song returns to SongDetail and RepertoireView with updated title and no permanent spinner', (tester) async {
      fakeRepo.songs = [
        const SongSummary(
          id: 'song_123',
          ministryId: 'min_1',
          title: 'Vitorioso Es',
          artistName: 'Gabriel Guedes',
        ),
      ];
      fakeRepo.detail = const SongDetail(
        id: 'song_123',
        ministryId: 'min_1',
        title: 'Vitorioso Es',
        artistName: 'Gabriel Guedes',
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
            ),
            preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
            ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
            ministryContextNotifierProvider.overrideWith((ref) => FakeMinistryContextNotifier(role: 'admin')),
            authNotifierProvider.overrideWith((ref) => authNotifier),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            repertoireListNotifierProvider.overrideWith((ref) => RepertoireListNotifier(repository: fakeRepo)),
            songDetailNotifierProvider.overrideWith((ref) => SongDetailNotifier(repository: fakeRepo)),
            songFormNotifierProvider.overrideWith((ref) => SongFormNotifier(repository: fakeRepo)),
          ],
          child: const MaterialApp(
            home: RepertoireView(ministryId: 'min_1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Vitorioso Es'), findsOneWidget);

      // Open detail
      await tester.tap(find.text('Vitorioso Es'));
      await tester.pumpAndSettle();

      expect(find.byType(SongDetailView), findsOneWidget);
      expect(find.byKey(const ValueKey('edit_song_button')), findsOneWidget);

      // Open edit form
      await tester.tap(find.byKey(const ValueKey('edit_song_button')));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('song_form_save_button')), findsOneWidget);

      // Enter updated title
      await tester.enterText(find.byKey(const ValueKey('song_title_input')), 'Vitorioso Es Editada');
      await tester.pumpAndSettle();

      // Tap Salvar
      await tester.tap(find.byKey(const ValueKey('song_form_save_button')));
      await tester.pumpAndSettle();

      // Form popped, back in detail view with updated title
      expect(find.byKey(const ValueKey('song_form_save_button')), findsNothing);
      expect(find.text('Vitorioso Es Editada'), findsWidgets);

      // Pop detail view back to RepertoireView
      final backButton = find.byType(BackButton);
      expect(backButton, findsOneWidget);
      await tester.tap(backButton);
      await tester.pumpAndSettle();

      // RepertoireView has updated song and no stuck spinner
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('Vitorioso Es Editada'), findsOneWidget);
    });

    testWidgets('DELETE_LIST_EVICTION: delete song closes detail, refreshes list, evicts from search, and does not get stuck loading', (tester) async {
      fakeRepo.songs = [
        const SongSummary(
          id: 'song_to_delete',
          ministryId: 'min_1',
          title: 'Musica Para Excluir',
        ),
      ];
      fakeRepo.detail = const SongDetail(
        id: 'song_to_delete',
        ministryId: 'min_1',
        title: 'Musica Para Excluir',
      );

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
            ),
            preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
            ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
            ministryContextNotifierProvider.overrideWith((ref) => FakeMinistryContextNotifier(role: 'admin')),
            authNotifierProvider.overrideWith((ref) => authNotifier),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            repertoireListNotifierProvider.overrideWith((ref) => RepertoireListNotifier(repository: fakeRepo)),
            songDetailNotifierProvider.overrideWith((ref) => SongDetailNotifier(repository: fakeRepo)),
            songFormNotifierProvider.overrideWith((ref) => SongFormNotifier(repository: fakeRepo)),
          ],
          child: const MaterialApp(
            home: RepertoireView(ministryId: 'min_1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Musica Para Excluir'), findsOneWidget);

      // Open detail
      await tester.tap(find.text('Musica Para Excluir'));
      await tester.pumpAndSettle();

      expect(find.byType(SongDetailView), findsOneWidget);

      // Tap delete button
      await tester.tap(find.byKey(const ValueKey('delete_song_button')));
      await tester.pumpAndSettle();

      // Confirm delete in dialog
      await tester.tap(find.byKey(const ValueKey('confirm_delete_song_button')));
      await tester.pumpAndSettle();

      // Detail popped, returned to RepertoireView
      expect(find.byType(SongDetailView), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsNothing);
      expect(find.text('Musica Para Excluir'), findsNothing);
      expect(find.text('Repertório Vazio'), findsOneWidget);

      // Searching for deleted song also returns empty
      await tester.enterText(find.byType(TextField), 'Musica Para Excluir');
      await tester.pump(const Duration(milliseconds: 350));
      await tester.pumpAndSettle();

      expect(find.text('Nenhuma música encontrada'), findsOneWidget);
      expect(find.byType(SongCard), findsNothing);
    });

    testWidgets('SongDetailView renders Edit and Delete action icons for admin', (tester) async {
      await tester.pumpWidget(buildSongDetailView(role: 'admin'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('edit_song_button')), findsOneWidget);
      expect(find.byKey(const ValueKey('delete_song_button')), findsOneWidget);
    });

    testWidgets('SongDetailView hides Edit and Delete action icons for member', (tester) async {
      await tester.pumpWidget(buildSongDetailView(role: 'member'));
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('edit_song_button')), findsNothing);
      expect(find.byKey(const ValueKey('delete_song_button')), findsNothing);
    });

    testWidgets('SongDetailView delete confirmation dialog deletes song on confirm', (tester) async {
      await tester.pumpWidget(buildSongDetailView(role: 'admin'));
      await tester.pumpAndSettle();

      // Tap delete icon in appbar
      await tester.tap(find.byKey(const ValueKey('delete_song_button')));
      await tester.pumpAndSettle();

      // Dialog is shown with confirmation button
      expect(find.byKey(const ValueKey('confirm_delete_song_button')), findsOneWidget);
      expect(find.text('Cancelar'), findsOneWidget);

      // Confirm deletion
      await tester.tap(find.byKey(const ValueKey('confirm_delete_song_button')));
      await tester.pumpAndSettle();

      expect(fakeRepo.deletedSongId, equals('song_123'));
    });

    testWidgets('TEST_GAP-03: in-flight delete discarded on logout without snackbar or navigation crash', (tester) async {
      fakeRepo.deleteCompleter = Completer<void>();

      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://localhost:3000/api/v1'),
            ),
            preferencesStorageProvider.overrideWithValue(_FakePreferencesStorage()),
            ministryRepositoryProvider.overrideWithValue(_FakeMinistryRepo()),
            ministryContextNotifierProvider.overrideWith((ref) => FakeMinistryContextNotifier(role: 'admin')),
            authNotifierProvider.overrideWith((ref) => authNotifier),
            repertoireRepositoryProvider.overrideWithValue(fakeRepo),
            songDetailNotifierProvider.overrideWith((ref) => SongDetailNotifier(repository: fakeRepo)),
            songFormNotifierProvider.overrideWith((ref) => SongFormNotifier(repository: fakeRepo)),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: Builder(
                builder: (ctx) => ElevatedButton(
                  onPressed: () {
                    Navigator.of(ctx).push(
                      MaterialPageRoute(
                        builder: (_) => const SongDetailView(
                          ministryId: 'min_1',
                          songId: 'song_123',
                        ),
                      ),
                    );
                  },
                  child: const Text('Open Detail'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(find.text('Open Detail'));
      await tester.pumpAndSettle();

      // Tap delete and confirm
      await tester.tap(find.byKey(const ValueKey('delete_song_button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('confirm_delete_song_button')));
      await tester.pump();

      // Logout occurs while delete is in-flight
      authNotifier.logout();
      await tester.pumpAndSettle();

      // Complete the in-flight delete
      fakeRepo.deleteCompleter!.complete();
      await tester.pumpAndSettle();

      // Detail route is popped, no success snackbar shown, no crash
      expect(find.text('Música excluída com sucesso!'), findsNothing);
      expect(find.byType(SnackBar), findsNothing);
      expect(find.text('Open Detail'), findsOneWidget);
    });
  });
}
