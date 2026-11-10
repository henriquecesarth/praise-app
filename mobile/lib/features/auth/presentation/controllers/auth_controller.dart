import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/auth_repository.dart';
import '../../domain/auth_failure_normalizer.dart';
import '../../domain/auth_user.dart';

enum AuthStatus {
  initializing,
  unauthenticated,
  authenticating,
  authenticated,
  bootstrapError,
  error,
}

class AuthState {
  final AuthStatus status;
  final AuthUser? user;
  final AppFailure? failure;

  const AuthState({required this.status, this.user, this.failure});

  const AuthState.initializing()
    : status = AuthStatus.initializing,
      user = null,
      failure = null;

  const AuthState.unauthenticated()
    : status = AuthStatus.unauthenticated,
      user = null,
      failure = null;

  const AuthState.authenticating({this.user})
    : status = AuthStatus.authenticating,
      failure = null;

  const AuthState.authenticated(AuthUser this.user)
    : status = AuthStatus.authenticated,
      failure = null;

  const AuthState.bootstrapError(AppFailure this.failure, {this.user})
    : status = AuthStatus.bootstrapError;

  const AuthState.error(AppFailure this.failure, {this.user})
    : status = AuthStatus.error;

  bool get isInitializing => status == AuthStatus.initializing;
  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get isAuthenticating => status == AuthStatus.authenticating;
  bool get isUnauthenticated => status == AuthStatus.unauthenticated;
  bool get hasBootstrapError => status == AuthStatus.bootstrapError;
  bool get hasError =>
      status == AuthStatus.error || status == AuthStatus.bootstrapError;
  String get chordFontFamily =>
      user?.chordFontFamily ?? AuthUser.defaultChordFont;
  int get chordLineSpacingPx =>
      user?.chordLineSpacingPx ?? AuthUser.defaultChordLineSpacingPx;
  int? get vocalMinMidi => user?.vocalMinMidi;
  int? get vocalMaxMidi => user?.vocalMaxMidi;

  AuthState copyWith({
    AuthStatus? status,
    AuthUser? user,
    AppFailure? failure,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: user ?? this.user,
      failure: failure ?? this.failure,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthState &&
          runtimeType == other.runtimeType &&
          status == other.status &&
          user == other.user &&
          failure == other.failure;

  @override
  int get hashCode => status.hashCode ^ user.hashCode ^ failure.hashCode;
}

class AuthNotifier extends StateNotifier<AuthState> {
  final AuthRepository _repository;
  final Future<void> Function()? _onBeforeSignOut;
  StreamSubscription<User?>? _authSubscription;
  int _authOpId = 0;
  int _fontPreferenceOpId = 0;
  int _spacingPreferenceOpId = 0;
  int _vocalRangePreferenceOpId = 0;
  int _confirmedFontPreferenceOpId = 0;
  int _confirmedSpacingPreferenceOpId = 0;
  int _confirmedVocalRangePreferenceOpId = 0;
  int? _credentialOpId;

  AuthNotifier(this._repository, {Future<void> Function()? onBeforeSignOut})
    : _onBeforeSignOut = onBeforeSignOut,
      super(const AuthState.initializing()) {
    _init();
  }

  void _init() {
    _authSubscription = _repository.authStateChanges().listen((
      firebaseUser,
    ) async {
      // The explicit action owns bootstrap while its native SDK mutation is
      // pending. Its stream event belongs to that same action, not a new one.
      if (_credentialOpId != null) return;
      final opId = ++_authOpId;
      if (firebaseUser == null) {
        ++_fontPreferenceOpId;
        ++_spacingPreferenceOpId;
        ++_vocalRangePreferenceOpId;
        ++_confirmedFontPreferenceOpId;
        ++_confirmedSpacingPreferenceOpId;
        ++_confirmedVocalRangePreferenceOpId;
        if (!state.isUnauthenticated) {
          state = const AuthState.unauthenticated();
        }
      } else {
        await _fetchAuthoritativeUser(opId);
      }
    });
  }

  Future<void> _fetchAuthoritativeUser([
    int? expectedOpId,
    bool canRetrySessionChange = true,
  ]) async {
    final opId = expectedOpId ?? ++_authOpId;
    final confirmedFontIdAtStart = _confirmedFontPreferenceOpId;
    final confirmedSpacingIdAtStart = _confirmedSpacingPreferenceOpId;
    final confirmedVocalIdAtStart = _confirmedVocalRangePreferenceOpId;
    try {
      final authUser = await _repository.getMe();
      if (opId == _authOpId) {
        final currentUser = state.user;
        final isSameUser = currentUser != null && currentUser.id == authUser.id;
        final hasNewerFont =
            isSameUser && confirmedFontIdAtStart != _confirmedFontPreferenceOpId;
        final hasNewerSpacing =
            isSameUser &&
            confirmedSpacingIdAtStart != _confirmedSpacingPreferenceOpId;
        final hasNewerVocal =
            isSameUser &&
            confirmedVocalIdAtStart != _confirmedVocalRangePreferenceOpId;

        final effectiveFont = hasNewerFont
            ? currentUser.chordFontFamily
            : authUser.chordFontFamily;
        final effectiveSpacing = hasNewerSpacing
            ? currentUser.chordLineSpacingPx
            : authUser.chordLineSpacingPx;
        final effectiveVocalMin = hasNewerVocal
            ? currentUser.vocalMinMidi
            : authUser.vocalMinMidi;
        final effectiveVocalMax = hasNewerVocal
            ? currentUser.vocalMaxMidi
            : authUser.vocalMaxMidi;

        state = AuthState.authenticated(
          authUser.copyWith(
            chordFontFamily: effectiveFont,
            chordLineSpacingPx: effectiveSpacing,
            vocalMinMidi: effectiveVocalMin,
            vocalMaxMidi: effectiveVocalMax,
          ),
        );
      }
    } catch (e) {
      if (opId != _authOpId) return;
      final failure = AuthFailureNormalizer.normalize(e);
      if (failure.code == 'SESSION_CHANGED') {
        // Obsolete session response discarded. If a Firebase user is active and
        // the state is not authenticated yet, recover by fetching under the stabilized session.
        final currentUser = _repository.currentFirebaseUser;
        if (currentUser != null &&
            !state.isAuthenticated &&
            canRetrySessionChange) {
          await _fetchAuthoritativeUser(opId, false);
        } else if (!state.isAuthenticated) {
          state = const AuthState.unauthenticated();
        }
        return;
      }
      if (failure.statusCode == 401 ||
          failure.statusCode == 403 ||
          failure.code == 'ACCOUNT_DELETION_IN_PROGRESS') {
        // Genuine authentication error or account deleted/disabled: fail closed
        await _repository.signOut();
        if (opId == _authOpId) state = const AuthState.unauthenticated();
      } else {
        // Transient error (network error, 5xx server error, timeout, backend unavailable)
        // Firebase session remains intact, user does not need to re-enter credentials
        state = AuthState.bootstrapError(failure);
      }
    }
  }

  /// Retries fetching authoritative profile when in recoverable bootstrap error state.
  Future<void> retryBootstrap() async {
    final opId = ++_authOpId;
    state = const AuthState.initializing();
    await _fetchAuthoritativeUser(opId);
  }

  Future<void> login({required String email, required String password}) async {
    final opId = ++_authOpId;
    _credentialOpId = opId;
    state = const AuthState.authenticating();
    try {
      await _repository.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      if (opId != _authOpId) return;
      await _fetchAuthoritativeUser(opId);
    } catch (e) {
      if (opId == _authOpId) {
        final failure = AuthFailureNormalizer.normalize(e);
        if (failure.code == 'SESSION_CHANGED') {
          if (_repository.currentFirebaseUser != null) {
            await _fetchAuthoritativeUser(opId);
          } else {
            state = const AuthState.unauthenticated();
          }
          return;
        }
        state = AuthState.error(failure);
      }
      if (opId == _authOpId) rethrow;
    } finally {
      if (_credentialOpId == opId) _credentialOpId = null;
    }
  }

  Future<void> signup({
    required String name,
    required String email,
    required String password,
  }) async {
    final opId = ++_authOpId;
    _credentialOpId = opId;
    state = const AuthState.authenticating();
    try {
      final user = await _repository.signUp(
        name: name,
        email: email,
        password: password,
      );
      if (opId == _authOpId) {
        state = AuthState.authenticated(user);
      }
    } catch (e) {
      if (opId == _authOpId) {
        final failure = AuthFailureNormalizer.normalize(e);
        if (failure.code == 'SESSION_CHANGED') {
          if (_repository.currentFirebaseUser != null) {
            await _fetchAuthoritativeUser(opId);
          } else {
            state = const AuthState.unauthenticated();
          }
          return;
        } else {
          state = AuthState.error(failure);
        }
      }
      if (opId == _authOpId) rethrow;
    } finally {
      if (_credentialOpId == opId) _credentialOpId = null;
    }
  }

  Future<void> updateChordFontPreference(String fontFamily) async {
    final currentUser = state.user;
    if (currentUser == null) return;

    final opId = ++_fontPreferenceOpId;
    try {
      final confirmedFont = await _repository.updateChordFontPreference(
        chordFontFamily: fontFamily,
      );

      // Fencing: ignore if a newer preference op ran or if user changed / logged out
      if (opId == _fontPreferenceOpId &&
          state.isAuthenticated &&
          state.user?.id == currentUser.id) {
        ++_confirmedFontPreferenceOpId;
        state = state.copyWith(
          user: state.user!.copyWith(chordFontFamily: confirmedFont),
        );
      }
    } catch (e) {
      rethrow;
    }
  }

  Future<void> updateChordLineSpacingPreference(int spacingPx) async {
    final currentUser = state.user;
    if (currentUser == null) return;
    final bounded = spacingPx.clamp(0, 24);
    final spacing = bounded.isEven ? bounded : bounded - 1;
    final opId = ++_spacingPreferenceOpId;
    try {
      final confirmed = await _repository.updateChordLineSpacingPreference(
        spacingPx: spacing,
      );
      if (opId == _spacingPreferenceOpId &&
          state.isAuthenticated &&
          state.user?.id == currentUser.id) {
        ++_confirmedSpacingPreferenceOpId;
        state = state.copyWith(
          user: state.user!.copyWith(chordLineSpacingPx: confirmed),
        );
      }
    } catch (_) {
      rethrow;
    }
  }

  Future<(int, int)> updateVocalRangePreference({
    required int minMidi,
    required int maxMidi,
  }) async {
    final currentUser = state.user;
    if (currentUser == null) {
      throw const AppFailure(
        message: 'Faça login para salvar sua extensão vocal.',
        statusCode: 401,
        code: 'UNAUTHENTICATED',
      );
    }
    final opId = ++_vocalRangePreferenceOpId;
    try {
      final confirmed = await _repository.updateVocalRangePreference(
        minMidi: minMidi,
        maxMidi: maxMidi,
      );
      if (opId == _vocalRangePreferenceOpId &&
          state.isAuthenticated &&
          state.user?.id == currentUser.id) {
        ++_confirmedVocalRangePreferenceOpId;
        state = state.copyWith(
          user: state.user!.copyWith(
            vocalMinMidi: confirmed.$1,
            vocalMaxMidi: confirmed.$2,
          ),
        );
      }
      return confirmed;
    } catch (_) {
      rethrow;
    }
  }

  Future<void> logout() async {
    final opId = ++_authOpId;
    // Invalidate a non-cancellable native sign-in before awaiting push cleanup.
    final repository = _repository;
    if (repository is AuthAttemptInvalidator) {
      (repository as AuthAttemptInvalidator).cancelPendingAuthentication();
    }
    _credentialOpId = opId;
    ++_fontPreferenceOpId;
    ++_spacingPreferenceOpId;
    ++_vocalRangePreferenceOpId;
    ++_confirmedFontPreferenceOpId;
    ++_confirmedSpacingPreferenceOpId;
    ++_confirmedVocalRangePreferenceOpId;
    state = const AuthState.unauthenticated();
    if (_onBeforeSignOut != null) {
      try {
        await _onBeforeSignOut();
      } catch (_) {
        // Non-fatal: push cleanup error must never trap user in session
      }
    }
    if (opId != _authOpId) return;
    try {
      await _repository.signOut();
      if (opId == _authOpId) state = const AuthState.unauthenticated();
    } catch (e) {
      final failure = AuthFailureNormalizer.normalize(e);
      if (opId == _authOpId) state = AuthState.error(failure);
    } finally {
      if (_credentialOpId == opId) _credentialOpId = null;
    }
  }

  @override
  void dispose() {
    ++_authOpId;
    _credentialOpId = null;
    _authSubscription?.cancel();
    super.dispose();
  }
}
