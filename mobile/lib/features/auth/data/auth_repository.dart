import 'dart:async';
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

/// Capability interface for updating authenticated chord font preference.
abstract class ChordFontPreferenceUpdater {
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  });
}

/// Safe extension providing updateChordFontPreference on any [AuthRepository].
extension AuthRepositoryChordFontExtension on AuthRepository {
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  }) async {
    final self = this;
    if (self is ChordFontPreferenceUpdater) {
      final updater = self as ChordFontPreferenceUpdater;
      return updater.updateChordFontPreference(chordFontFamily: chordFontFamily);
    }
    return chordFontFamily;
  }
}

/// Firebase-backed implementation of [AuthRepository].
class FirebaseAuthRepository
    implements AuthRepository, ChordFontPreferenceUpdater {
  final FirebaseAuth _firebaseAuth;
  final ApiClient _apiClient;
  final PreferencesStorage _preferencesStorage;

  int _preferenceMutationGeneration = 0;
  int _sessionGeneration = 0;
  String? _activeSessionUid;
  StreamSubscription<User?>? _authStateSub;

  FirebaseAuthRepository({
    required FirebaseAuth firebaseAuth,
    required ApiClient apiClient,
    required PreferencesStorage preferencesStorage,
  })  : _firebaseAuth = firebaseAuth,
        _apiClient = apiClient,
        _preferencesStorage = preferencesStorage {
    _initSessionTracking();
  }

  void _initSessionTracking() {
    try {
      final initialUser = _firebaseAuth.currentUser;
      _activeSessionUid = initialUser?.uid;
    } catch (_) {}
    _sessionGeneration = 1;

    try {
      _authStateSub = _firebaseAuth.authStateChanges().listen((user) {
        if (user == null) {
          _activeSessionUid = null;
          _sessionGeneration++;
        } else if (user.uid != _activeSessionUid) {
          _activeSessionUid = user.uid;
          _sessionGeneration++;
        }
      });
    } catch (_) {
      // In test environments where authStateChanges is not stubbed or unavailable.
    }

    _apiClient.sessionContextProvider = () => currentSessionContext;
  }

  AuthSessionContext? get currentSessionContext {
    final uid = _firebaseAuth.currentUser?.uid;
    if (uid == null || uid.isEmpty) return null;
    return AuthSessionContext(
      userId: uid,
      sessionGeneration: _sessionGeneration,
    );
  }

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
      final cred = await _firebaseAuth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      _activeSessionUid = cred.user?.uid;
      _sessionGeneration++;
      return cred;
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
      final cred = await _firebaseAuth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      _activeSessionUid = cred.user?.uid;
      _sessionGeneration++;

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
    final genAtStart = _preferenceMutationGeneration;
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
      final user = AuthUser.fromJson(data);
      if (user.id.isNotEmpty && genAtStart == _preferenceMutationGeneration) {
        await _preferencesStorage.setUserChordFontFamily(
          user.id,
          user.chordFontFamily,
        );
      }
      return user;
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  @override
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  }) async {
    final effectiveFont = AuthUser.supportedChordFonts.contains(chordFontFamily)
        ? chordFontFamily
        : AuthUser.defaultChordFont;

    // Capture the initiating authenticated session context before starting the PATCH
    final session = currentSessionContext;
    final initiatingUid = session?.userId ?? _firebaseAuth.currentUser?.uid;
    final initiatingSessionGen = session?.sessionGeneration ?? _sessionGeneration;
    ++_preferenceMutationGeneration;

    try {
      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/auth/me/preferences',
        data: {'chord_font_family': effectiveFont},
        options: Options(
          extra: {
            if (initiatingUid != null) AuthInterceptor.sessionUserIdKey: initiatingUid,
            if (initiatingSessionGen > 0)
              AuthInterceptor.sessionGenerationKey: initiatingSessionGen,
          },
        ),
      );
      final data = response.data;
      String confirmedFont = effectiveFont;
      if (data != null && data['preferences'] is Map) {
        final confirmedRaw = (data['preferences'] as Map)['chord_font_family'];
        if (confirmedRaw is String &&
            AuthUser.supportedChordFonts.contains(confirmedRaw)) {
          confirmedFont = confirmedRaw;
        }
      }

      // Use captured initiating UID to update cache, never _firebaseAuth.currentUser after await
      if (initiatingUid != null && initiatingUid.isNotEmpty) {
        await _preferencesStorage.setUserChordFontFamily(
          initiatingUid,
          confirmedFont,
        );
      }

      return confirmedFont;
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  @override
  Future<void> signOut() async {
    try {
      _activeSessionUid = null;
      _sessionGeneration++;
      await _firebaseAuth.signOut();
      await _preferencesStorage.clear();
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  void dispose() {
    _authStateSub?.cancel();
  }
}
