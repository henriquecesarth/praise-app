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

/// Invalidates credential work synchronously, before optional logout cleanup.
abstract class AuthAttemptInvalidator {
  void cancelPendingAuthentication();
}

/// Capability interface for updating authenticated chord font preference.
abstract class ChordFontPreferenceUpdater {
  Future<String> updateChordFontPreference({required String chordFontFamily});
}

/// Safe extension providing updateChordFontPreference on any [AuthRepository].
extension AuthRepositoryChordFontExtension on AuthRepository {
  Future<String> updateChordFontPreference({
    required String chordFontFamily,
  }) async {
    final self = this;
    if (self is ChordFontPreferenceUpdater) {
      final updater = self as ChordFontPreferenceUpdater;
      return updater.updateChordFontPreference(
        chordFontFamily: chordFontFamily,
      );
    }
    return chordFontFamily;
  }
}

/// Firebase-backed implementation of [AuthRepository].
class FirebaseAuthRepository
    implements
        AuthRepository,
        ChordFontPreferenceUpdater,
        AuthAttemptInvalidator {
  final FirebaseAuth _firebaseAuth;
  final ApiClient _apiClient;
  final PreferencesStorage _preferencesStorage;

  int _preferenceMutationGeneration = 0;
  int _sessionGeneration = 0;
  String? _activeSessionUid;
  StreamSubscription<User?>? _authStateSub;
  final _authEvents = StreamController<User?>.broadcast(sync: true);
  Future<void> _authMutationTail = Future<void>.value();
  int _authIntent = 0;
  int? _runningCredentialIntent;
  int _pendingMutations = 0;
  bool _acceptExternalAuthEvents = true;
  bool _disposed = false;
  late final SessionContextProvider _sessionContextProvider;

  AuthSessionContext? _provideSessionContext() => currentSessionContext;

  static const _sessionChanged = AppFailure(
    message: 'Sessão expirada ou alternada durante a requisição.',
    statusCode: 401,
    code: 'SESSION_CHANGED',
  );

  FirebaseAuthRepository({
    required FirebaseAuth firebaseAuth,
    required ApiClient apiClient,
    required PreferencesStorage preferencesStorage,
  }) : _firebaseAuth = firebaseAuth,
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
        if (_disposed) return;
        // Stream delivery can lag the mutation Future. A previous identity's
        // event must never replace the native identity of the latest intent.
        if (user?.uid != _firebaseAuth.currentUser?.uid) return;
        // A native sign-in cannot be cancelled and may publish before its
        // Future completes. Never expose an obsolete mutation to the app.
        if (_pendingMutations > 0) {
          if (_runningCredentialIntent == _authIntent) {
            _adoptUser(user, advanceGeneration: false);
          }
          return;
        }
        if (!_acceptExternalAuthEvents) return;
        _adoptUser(user);
        _authEvents.add(user);
      });
    } catch (_) {
      // In test environments where authStateChanges is not stubbed or unavailable.
    }

    _sessionContextProvider = _provideSessionContext;
    _apiClient.sessionContextProvider = _sessionContextProvider;
  }

  void _adoptUser(User? user, {bool advanceGeneration = true}) {
    if (_activeSessionUid != user?.uid) {
      _activeSessionUid = user?.uid;
      if (advanceGeneration) _sessionGeneration++;
    }
  }

  int _beginAuthIntent() {
    ++_authIntent;
    _acceptExternalAuthEvents = false;
    _activeSessionUid = null;
    ++_sessionGeneration;
    return _authIntent;
  }

  @override
  void cancelPendingAuthentication() {
    _beginAuthIntent();
  }

  /// Native mutations must finish in order: a stale SDK completion can assign
  /// currentUser even after signOut. Clean it before allowing the next login.
  Future<T> _serializeAuth<T>(Future<T> Function() action) {
    ++_pendingMutations;
    final result = _authMutationTail.then((_) => action());
    _authMutationTail = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace __) {},
    );
    return result.whenComplete(() => --_pendingMutations);
  }

  AuthSessionContext? get currentSessionContext {
    if (_disposed) return null;
    final uid = _firebaseAuth.currentUser?.uid;
    if (uid == null || uid.isEmpty || uid != _activeSessionUid) return null;
    return AuthSessionContext(
      userId: uid,
      sessionGeneration: _sessionGeneration,
    );
  }

  @override
  Stream<User?> authStateChanges() => Stream<User?>.multi((controller) {
    final subscription = _authEvents.stream.listen(controller.addSync);
    controller.addSync(currentFirebaseUser);
    controller.onCancel = subscription.cancel;
  });

  @override
  User? get currentFirebaseUser =>
      currentSessionContext == null ? null : _firebaseAuth.currentUser;

  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async {
    final user = currentFirebaseUser;
    if (user == null) return null;
    final session = currentSessionContext;
    final token = await user.getIdToken(forceRefresh);
    if (session != currentSessionContext) throw _sessionChanged;
    return token;
  }

  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) async {
    final intent = _beginAuthIntent();
    try {
      return await _serializeAuth(() => _signIn(intent, email, password));
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  Future<UserCredential> _signIn(
    int intent,
    String email,
    String password,
  ) async {
    if (intent != _authIntent) throw _sessionChanged;
    _runningCredentialIntent = intent;
    try {
      final credential = await _firebaseAuth.signInWithEmailAndPassword(
        email: email.trim(),
        password: password,
      );
      if (intent != _authIntent) {
        throw _sessionChanged;
      }
      _adoptUser(credential.user, advanceGeneration: false);
      _acceptExternalAuthEvents = true;
      _authEvents.add(credential.user);
      return credential;
    } catch (_) {
      // No newer SDK operation can run until this cleanup finishes.
      await _firebaseAuth.signOut();
      if (intent == _authIntent) {
        _activeSessionUid = null;
        _authEvents.add(null);
      }
      rethrow;
    } finally {
      _runningCredentialIntent = null;
    }
  }

  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) async {
    final intent = _beginAuthIntent();
    try {
      await _serializeAuth(() async {
        if (intent != _authIntent) throw _sessionChanged;
        // 1. Backend provisioning creates Firebase user + LouvAIO profile
        await _apiClient.dio.post<Map<String, dynamic>>(
          '/auth/signup',
          data: {
            'name': name.trim(),
            'email': email.trim(),
            'password': password,
          },
          options: Options(extra: {AuthInterceptor.requiresAuthKey: false}),
        );

        // Mobile intentionally discards any legacy token in backend response.

        // 2. Perform native Firebase sign-in
        await _signIn(intent, email, password);
      });
      // Profile HTTP work must not hold the native mutation queue: its 401
      // callback can itself need to sign out through that queue.
      if (intent != _authIntent) throw _sessionChanged;
      final user = await getMe();
      if (intent != _authIntent) throw _sessionChanged;
      return user;
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  @override
  Future<AuthUser> getMe() async {
    final genAtStart = _preferenceMutationGeneration;
    final sessionAtStart = currentSessionContext;
    final authIntentAtStart = _authIntent;
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/auth/me',
        options: sessionAtStart == null
            ? null
            : Options(
                extra: {
                  AuthInterceptor.sessionUserIdKey: sessionAtStart.userId,
                  AuthInterceptor.sessionGenerationKey:
                      sessionAtStart.sessionGeneration,
                },
              ),
      );
      if (sessionAtStart != currentSessionContext ||
          authIntentAtStart != _authIntent) {
        throw _sessionChanged;
      }
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
    final initiatingSessionGen =
        session?.sessionGeneration ?? _sessionGeneration;
    ++_preferenceMutationGeneration;

    try {
      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/auth/me/preferences',
        data: {'chord_font_family': effectiveFont},
        options: Options(
          extra: {
            if (initiatingUid != null)
              AuthInterceptor.sessionUserIdKey: initiatingUid,
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
    final intent = _beginAuthIntent();
    try {
      await _serializeAuth(() async {
        if (intent != _authIntent) return;
        await _firebaseAuth.signOut();
        await _preferencesStorage.clear();
        if (intent == _authIntent) {
          _acceptExternalAuthEvents = true;
          _authEvents.add(null);
        }
      });
    } catch (e) {
      throw AuthFailureNormalizer.normalize(e);
    }
  }

  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _beginAuthIntent();
    if (identical(_apiClient.sessionContextProvider, _sessionContextProvider)) {
      _apiClient.sessionContextProvider = null;
    }
    _authStateSub?.cancel();
    _authEvents.close();
  }
}
