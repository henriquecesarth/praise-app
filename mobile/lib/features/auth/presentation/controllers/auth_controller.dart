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
  error,
}

class AuthState {
  final AuthStatus status;
  final AuthUser? user;
  final AppFailure? failure;

  const AuthState({
    required this.status,
    this.user,
    this.failure,
  });

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

  const AuthState.error(AppFailure this.failure, {this.user})
      : status = AuthStatus.error;

  bool get isInitializing => status == AuthStatus.initializing;
  bool get isAuthenticated => status == AuthStatus.authenticated;
  bool get isAuthenticating => status == AuthStatus.authenticating;
  bool get isUnauthenticated => status == AuthStatus.unauthenticated;
  bool get hasError => status == AuthStatus.error;

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
  StreamSubscription<User?>? _authSubscription;

  AuthNotifier(this._repository) : super(const AuthState.initializing()) {
    _init();
  }

  void _init() {
    _authSubscription =
        _repository.authStateChanges().listen((firebaseUser) async {
      if (firebaseUser == null) {
        if (!state.isUnauthenticated) {
          state = const AuthState.unauthenticated();
        }
      } else {
        try {
          final authUser = await _repository.getMe();
          state = AuthState.authenticated(authUser);
        } catch (e) {
          final failure = AuthFailureNormalizer.normalize(e);
          state = AuthState.error(failure);
        }
      }
    });
  }

  Future<void> login({
    required String email,
    required String password,
  }) async {
    state = const AuthState.authenticating();
    try {
      await _repository.signInWithEmailAndPassword(
        email: email,
        password: password,
      );
      final user = await _repository.getMe();
      state = AuthState.authenticated(user);
    } catch (e) {
      final failure = AuthFailureNormalizer.normalize(e);
      state = AuthState.error(failure);
      rethrow;
    }
  }

  Future<void> signup({
    required String name,
    required String email,
    required String password,
  }) async {
    state = const AuthState.authenticating();
    try {
      final user = await _repository.signUp(
        name: name,
        email: email,
        password: password,
      );
      state = AuthState.authenticated(user);
    } catch (e) {
      final failure = AuthFailureNormalizer.normalize(e);
      state = AuthState.error(failure);
      rethrow;
    }
  }

  Future<void> logout() async {
    try {
      await _repository.signOut();
      state = const AuthState.unauthenticated();
    } catch (e) {
      final failure = AuthFailureNormalizer.normalize(e);
      state = AuthState.error(failure);
    }
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    super.dispose();
  }
}
