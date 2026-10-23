import 'dart:async';
import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';

class MockFirebaseAuth extends Mock implements FirebaseAuth {}

class MockUser extends Mock implements User {}

class MockUserCredential extends Mock implements UserCredential {}

class MockPreferencesStorage extends Mock
    implements PreferencesStorage, UserChordFontPreferencesStorage {}

class MockAdapter implements HttpClientAdapter {
  final Future<ResponseBody> Function(RequestOptions options) handler;

  MockAdapter(this.handler);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late MockFirebaseAuth mockFirebaseAuth;
  late MockPreferencesStorage mockPreferencesStorage;
  late ApiClient apiClient;
  late FirebaseAuthRepository repository;

  setUp(() {
    mockFirebaseAuth = MockFirebaseAuth();
    mockPreferencesStorage = MockPreferencesStorage();

    const env = AppEnvironment(
      env: AppEnv.development,
      apiBaseUrl: 'http://127.0.0.1:3000/api/v1',
    );

    apiClient = ApiClient(
      environment: env,
      logger: const AppLogger(isDebug: false),
    );

    when(() => mockPreferencesStorage.setUserChordFontFamily(any(), any()))
        .thenAnswer((_) async {});

    repository = FirebaseAuthRepository(
      firebaseAuth: mockFirebaseAuth,
      apiClient: apiClient,
      preferencesStorage: mockPreferencesStorage,
    );
  });

  group('FirebaseAuthRepository', () {
    test('getMe returns AuthUser when backend responds with 200', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return ResponseBody.fromString(
          '{"id": "usr_999", "email": "me@louvaio.com", "name": "Me User"}',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      final user = await repository.getMe();

      expect(user.id, 'usr_999');
      expect(user.email, 'me@louvaio.com');
      expect(user.name, 'Me User');
    });

    test('getMe maps 401 DioException into AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return ResponseBody.fromString(
          '{"error": {"message": "Sessão expirada.", "details": {"code": "AUTH_EXPIRED"}}}',
          401,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      await expectLater(
        repository.getMe(),
        throwsA(
          isA<AppFailure>()
              .having((f) => f.statusCode, 'statusCode', 401)
              .having((f) => f.message, 'message', 'Sessão expirada.'),
        ),
      );
    });

    test('signInWithEmailAndPassword calls FirebaseAuth and returns credential',
        () async {
      final mockCred = MockUserCredential();
      when(() => mockFirebaseAuth.signInWithEmailAndPassword(
            email: 'user@test.com',
            password: 'password123',
          )).thenAnswer((_) async => mockCred);

      final cred = await repository.signInWithEmailAndPassword(
        email: 'user@test.com ',
        password: 'password123',
      );

      expect(cred, mockCred);
      verify(() => mockFirebaseAuth.signInWithEmailAndPassword(
            email: 'user@test.com',
            password: 'password123',
          )).called(1);
    });

    test('signOut signs out of Firebase and clears local preferences',
        () async {
      when(() => mockFirebaseAuth.signOut()).thenAnswer((_) async {});
      when(() => mockPreferencesStorage.clear()).thenAnswer((_) async {});

      await repository.signOut();

      verify(() => mockFirebaseAuth.signOut()).called(1);
      verify(() => mockPreferencesStorage.clear()).called(1);
    });

    test(
        'signUp provisions through backend, discards legacy token, signs in natively, and fetches me',
        () async {
      final mockCred = MockUserCredential();
      when(() => mockFirebaseAuth.signInWithEmailAndPassword(
            email: 'newuser@louvaio.com',
            password: 'password123',
          )).thenAnswer((_) async => mockCred);

      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        if (options.path.contains('/auth/signup')) {
          // Backend responds with legacy token and user data
          return ResponseBody.fromString(
            '{"user": {"id": "uid_new", "email": "newuser@louvaio.com", "name": "New User"}, "token": "legacy_hmac_jwt_token"}',
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        }
        if (options.path.contains('/auth/me')) {
          return ResponseBody.fromString(
            '{"id": "uid_new", "email": "newuser@louvaio.com", "name": "New User"}',
            200,
            headers: {
              Headers.contentTypeHeader: [Headers.jsonContentType],
            },
          );
        }
        return ResponseBody.fromString('Not Found', 404);
      });

      final user = await repository.signUp(
        name: 'New User',
        email: 'newuser@louvaio.com',
        password: 'password123',
      );

      expect(user.id, 'uid_new');
      expect(user.email, 'newuser@louvaio.com');
      expect(user.name, 'New User');

      // Native Firebase sign-in must be called with provided credentials
      verify(() => mockFirebaseAuth.signInWithEmailAndPassword(
            email: 'newuser@louvaio.com',
            password: 'password123',
          )).called(1);

      // Mobile repository must never persist legacy token to local preferences
      verifyNever(() => mockPreferencesStorage.clear());
      verifyNever(() => mockPreferencesStorage.setSelectedMinistryId(any()));
    });

    test('signUp maps 400 backend error into AppFailure', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return ResponseBody.fromString(
          '{"error": {"message": "Este endereço de e-mail já está cadastrado."}}',
          400,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      await expectLater(
        repository.signUp(
          name: 'Existing',
          email: 'exists@louvaio.com',
          password: 'password123',
        ),
        throwsA(
          isA<AppFailure>()
              .having((f) => f.statusCode, 'statusCode', 400)
              .having((f) => f.message, 'message',
                  'Este endereço de e-mail já está cadastrado.'),
        ),
      );
    });

    test('getMe caches chord font preference in preferencesStorage', () async {
      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        return ResponseBody.fromString(
          '{"id": "usr_999", "email": "me@louvaio.com", "name": "Me User", "preferences": {"chord_font_family": "Georgia"}}',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      final user = await repository.getMe();

      expect(user.chordFontFamily, 'Georgia');
      verify(() => mockPreferencesStorage.setUserChordFontFamily('usr_999', 'Georgia')).called(1);
    });

    test('updateChordFontPreference sends PATCH to backend and caches confirmed preference', () async {
      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_current_123');
      when(() => mockFirebaseAuth.currentUser).thenReturn(mockUser);

      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        expect(options.path, contains('/auth/me/preferences'));
        expect(options.method, 'PATCH');
        expect(options.data, {'chord_font_family': 'Verdana'});

        return ResponseBody.fromString(
          '{"preferences": {"chord_font_family": "Verdana"}}',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      final confirmedFont = await repository.updateChordFontPreference(
        chordFontFamily: 'Verdana',
      );

      expect(confirmedFont, 'Verdana');
      verify(() => mockPreferencesStorage.setUserChordFontFamily('usr_current_123', 'Verdana')).called(1);
    });

    test('updateChordFontPreference falls back to monospace for invalid font', () async {
      final mockUser = MockUser();
      when(() => mockUser.uid).thenReturn('usr_current_123');
      when(() => mockFirebaseAuth.currentUser).thenReturn(mockUser);

      apiClient.dio.httpClientAdapter = MockAdapter((options) async {
        expect(options.data, {'chord_font_family': 'monospace'});

        return ResponseBody.fromString(
          '{"preferences": {"chord_font_family": "monospace"}}',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        );
      });

      final confirmedFont = await repository.updateChordFontPreference(
        chordFontFamily: 'InvalidFont123',
      );

      expect(confirmedFont, 'monospace');
      verify(() => mockPreferencesStorage.setUserChordFontFamily('usr_current_123', 'monospace')).called(1);
    });

    test('MOB-02: User A late PATCH cannot contaminate User B local cache after account switch', () async {
      final mockUserA = MockUser();
      when(() => mockUserA.uid).thenReturn('usr_a');
      final mockUserB = MockUser();
      when(() => mockUserB.uid).thenReturn('usr_b');

      // Initially user A is logged in
      when(() => mockFirebaseAuth.currentUser).thenReturn(mockUserA);

      final patchCompleter = Completer<ResponseBody>();
      apiClient.dio.httpClientAdapter = MockAdapter((options) {
        return patchCompleter.future;
      });

      // 1. User A starts updating preference to Georgia
      final updateFuture = repository.updateChordFontPreference(
        chordFontFamily: 'Georgia',
      );

      // 2. While PATCH is in-flight, Firebase currentUser switches to User B!
      when(() => mockFirebaseAuth.currentUser).thenReturn(mockUserB);

      // 3. User A's PATCH now completes
      patchCompleter.complete(
        ResponseBody.fromString(
          '{"preferences": {"chord_font_family": "Georgia"}}',
          200,
          headers: {
            Headers.contentTypeHeader: [Headers.jsonContentType],
          },
        ),
      );

      final confirmed = await updateFuture;
      expect(confirmed, 'Georgia');

      // 4. Must NOT cache under User B!
      verifyNever(() => mockPreferencesStorage.setUserChordFontFamily('usr_b', any()));
      // Must cache under User A (the initiating user)
      verify(() => mockPreferencesStorage.setUserChordFontFamily('usr_a', 'Georgia')).called(1);
    });
  });
}
