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

class MockPreferencesStorage extends Mock implements PreferencesStorage {}

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
  });
}
