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
    return PaginatedSongs(songs: songs, total: songs.length);
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
    return SongDetail(id: 'new-id', ministryId: ministryId, title: data.title);
  }

  @override
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data) async {
    return SongDetail(id: songId, ministryId: ministryId, title: data.title);
  }

  @override
  Future<void> deleteSong(String ministryId, String songId) async {
    if (deleteCompleter != null) {
      await deleteCompleter!.future;
    }
    deletedSongId = songId;
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
