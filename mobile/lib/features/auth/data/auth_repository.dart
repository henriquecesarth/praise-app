import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/errors/app_failure.dart';
import '../../../core/http/api_client.dart';
import '../../../core/http/auth_interceptor.dart';
import '../../../core/storage/preferences_storage.dart';
import '../domain/auth_failure_normalizer.dart';
import '../domain/auth_user.dart';

/// Contract for mobile authentication and authoritative user identity.
abstract class AuthRepository {
  Stream<User?> authStateChanges();
  User? get currentFirebaseUser;
  Future<String?> getIdToken({bool forceRefresh = false});
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  });
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  });
  Future<AuthUser> getMe();
  Future<void> signOut();
}

/// Firebase-backed implementation of [AuthRepository].
class FirebaseAuthRepository implements AuthRepository {
  final FirebaseAuth _firebaseAuth;
  final ApiClient _apiClient;
  final PreferencesStorage _preferencesStorage;

  FirebaseAuthRepository({
    required FirebaseAuth firebaseAuth,
    required ApiClient apiClient,
    required PreferencesStorage preferencesStorage,
  })  : _firebaseAuth = firebaseAuth,
        _apiClient = apiClient,
        _preferencesStorage = preferencesStorage;

  @override
  Stream<User?> authStateChanges() => _firebaseAuth.authStateChanges();

  @override
  User? get currentFirebaseUser => _firebaseAuth.currentUser;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async {
    final user = _firebaseAuth.currentUser;
    if (user == null) return null;
    return user.getIdToken(forceRefresh);
  }

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    try {
      return await _firebaseAuth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) async {
    try {
      // 1. Backend provisioning creates Firebase user + LouvAIO profile
      await _apiClient.dio.post<Map<String, dynamic>>(
        '/auth/signup',
        data: {
          'name': name.trim(),
          'email': email.trim(),
          'password': password,
        },
        options: Options(
          extra: {AuthInterceptor.requiresAuthKey: false},
        ),
      );

      // Mobile intentionally discards any legacy token in backend response.

      // 2. Perform native Firebase sign-in
      await _firebaseAuth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );

      // 3. Confirm identity via authoritative /auth/me
      return await getMe();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  @override
  Future<AuthUser> getMe() async {
    try {
      final response =
          await _apiClient.dio.get<Map<String, dynamic>>('/auth/me');
      final data = response.data;
      if (data == null) {
        throw const AppFailure(
          message: 'Resposta vazia do servidor.',
          statusCode: 500,
        );
      }
      return AuthUser.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  @override
  Future<void> signOut() async {
    try {
      await _firebaseAuth.signOut();
      await _preferencesStorage.clear();
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }
}
