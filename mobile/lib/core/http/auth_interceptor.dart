import 'package:dio/dio.dart';
import '../errors/app_failure.dart';

typedef TokenProvider = Future<String?> Function({bool forceRefresh});
typedef AuthFailureCallback = Future<void> Function();

/// Authenticated session context identifying the user and session generation.
class AuthSessionContext {
  final String userId;
  final int sessionGeneration;

  const AuthSessionContext({
    required this.userId,
    required this.sessionGeneration,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthSessionContext &&
          runtimeType == other.runtimeType &&
          userId == other.userId &&
          sessionGeneration == other.sessionGeneration;

  @override
  int get hashCode => userId.hashCode ^ sessionGeneration.hashCode;
}

typedef SessionContextProvider = AuthSessionContext? Function();

/// Dio interceptor providing Firebase ID Token bearer authentication
/// and single-attempt 401 token refresh.
class AuthInterceptor extends Interceptor {
  TokenProvider? tokenProvider;
  AuthFailureCallback? onAuthenticationFailed;
  final Dio dio;
  SessionContextProvider? sessionContextProvider;

  static const String requiresAuthKey = 'requiresAuth';
  static const String authRetryKey = 'auth_retry';
  static const String sessionUserIdKey = 'session_user_id';
  static const String sessionGenerationKey = 'session_generation';

  AuthInterceptor({
    this.tokenProvider,
    this.onAuthenticationFailed,
    required this.dio,
    this.sessionContextProvider,
  });

  bool _isSessionActive(RequestOptions options) {
    final boundUserId = options.extra[sessionUserIdKey] as String?;
    final boundSessionGen = options.extra[sessionGenerationKey] as int?;

    if (sessionContextProvider == null) {
      return boundUserId == null && boundSessionGen == null;
    }

    final currentSession = sessionContextProvider?.call();

    if (boundUserId != null) {
      if (currentSession == null) return false;
      if (currentSession.userId != boundUserId) return false;
      if (boundSessionGen != null &&
          currentSession.sessionGeneration != boundSessionGen) {
        return false;
      }
      return true;
    }

    return currentSession != null;
  }

  DioException _sessionChanged(RequestOptions options) => DioException(
    requestOptions: options,
    type: DioExceptionType.cancel,
    error: const AppFailure(
      message: 'Sessão expirada ou alternada durante a requisição.',
      statusCode: 401,
      code: 'SESSION_CHANGED',
    ),
  );

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final requiresAuth = options.extra[requiresAuthKey] as bool? ?? true;

    if (!requiresAuth) {
      return handler.next(options);
    }

    var boundUserId = options.extra[sessionUserIdKey] as String?;
    var boundSessionGen = options.extra[sessionGenerationKey] as int?;

    if (boundUserId == null && sessionContextProvider != null) {
      final currentSession = sessionContextProvider?.call();
      if (currentSession == null) {
        return handler.reject(_sessionChanged(options));
      } else {
        options.extra[sessionUserIdKey] = currentSession.userId;
        options.extra[sessionGenerationKey] = currentSession.sessionGeneration;
        boundUserId = currentSession.userId;
        boundSessionGen = currentSession.sessionGeneration;
      }
    }

    if (boundUserId != null) {
      final currentSession = sessionContextProvider?.call();
      if (currentSession == null ||
          currentSession.userId != boundUserId ||
          (boundSessionGen != null &&
              currentSession.sessionGeneration != boundSessionGen)) {
        return handler.reject(
          DioException(
            requestOptions: options,
            type: DioExceptionType.cancel,
            error: const AppFailure(
              message: 'Sessão expirada ou alternada durante a requisição.',
              statusCode: 401,
              code: 'SESSION_CHANGED',
            ),
          ),
        );
      }
    }

    if (!options.headers.containsKey('Authorization')) {
      final token = await tokenProvider?.call(forceRefresh: false);

      if (boundUserId != null) {
        final currentSession = sessionContextProvider?.call();
        if (currentSession == null ||
            currentSession.userId != boundUserId ||
            (boundSessionGen != null &&
                currentSession.sessionGeneration != boundSessionGen)) {
          return handler.reject(
            DioException(
              requestOptions: options,
              type: DioExceptionType.cancel,
              error: const AppFailure(
                message: 'Sessão expirada ou alternada durante a requisição.',
                statusCode: 401,
                code: 'SESSION_CHANGED',
              ),
            ),
          );
        }
      }

      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }

    return handler.next(options);
  }

  @override
  void onResponse(
    Response<dynamic> response,
    ResponseInterceptorHandler handler,
  ) {
    final requiresAuth =
        response.requestOptions.extra[requiresAuthKey] as bool? ?? true;
    if (requiresAuth && !_isSessionActive(response.requestOptions)) {
      return handler.reject(_sessionChanged(response.requestOptions));
    }
    handler.next(response);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final statusCode = err.response?.statusCode;
    final requiresAuth =
        err.requestOptions.extra[requiresAuthKey] as bool? ?? true;
    final alreadyRetried =
        err.requestOptions.extra[authRetryKey] as bool? ?? false;

    if (requiresAuth && !_isSessionActive(err.requestOptions)) {
      return handler.next(_sessionChanged(err.requestOptions));
    }

    if (statusCode == 401 && requiresAuth) {
      if (!_isSessionActive(err.requestOptions)) {
        // Initiating session is no longer active: do NOT retry or logout under another account
        return handler.next(err);
      }

      if (!alreadyRetried) {
        err.requestOptions.extra[authRetryKey] = true;
        try {
          final refreshedToken = await tokenProvider?.call(forceRefresh: true);

          if (!_isSessionActive(err.requestOptions)) {
            return handler.next(_sessionChanged(err.requestOptions));
          }

          if (refreshedToken != null && refreshedToken.isNotEmpty) {
            final retryHeaders = Map<String, dynamic>.from(
              err.requestOptions.headers,
            );
            retryHeaders['Authorization'] = 'Bearer $refreshedToken';

            final retryOptions = Options(
              method: err.requestOptions.method,
              headers: retryHeaders,
              responseType: err.requestOptions.responseType,
              contentType: err.requestOptions.contentType,
              validateStatus: err.requestOptions.validateStatus,
              receiveTimeout: err.requestOptions.receiveTimeout,
              sendTimeout: err.requestOptions.sendTimeout,
              extra: err.requestOptions.extra,
            );

            final response = await dio.request<dynamic>(
              err.requestOptions.path,
              data: err.requestOptions.data,
              queryParameters: err.requestOptions.queryParameters,
              options: retryOptions,
            );

            return handler.resolve(response);
          } else {
            if (_isSessionActive(err.requestOptions)) {
              await onAuthenticationFailed?.call();
            }
            return handler.next(err);
          }
        } catch (e) {
          if (!_isSessionActive(err.requestOptions) ||
              (e is AppFailure && e.code == 'SESSION_CHANGED')) {
            return handler.next(_sessionChanged(err.requestOptions));
          }
          if (e is DioException && e.response?.statusCode == 401) {
            if (_isSessionActive(err.requestOptions)) {
              await onAuthenticationFailed?.call();
            }
          }
          if (e is DioException) {
            return handler.next(e);
          }
          return handler.next(err);
        }
      } else {
        // Second 401: do NOT retry again. Invalidate session ONLY if still active.
        if (_isSessionActive(err.requestOptions)) {
          await onAuthenticationFailed?.call();
        }
        return handler.next(err);
      }
    }

    final responseData = err.response?.data;
    final isDeletionInProgress =
        statusCode == 403 &&
        (responseData is Map &&
            (responseData['code'] == 'ACCOUNT_DELETION_IN_PROGRESS' ||
                responseData['error']?['code'] ==
                    'ACCOUNT_DELETION_IN_PROGRESS' ||
                responseData['error']?['details']?['code'] ==
                    'ACCOUNT_DELETION_IN_PROGRESS'));

    if (isDeletionInProgress) {
      if (_isSessionActive(err.requestOptions)) {
        await onAuthenticationFailed?.call();
      }
      return handler.next(err);
    }

    return handler.next(err);
  }
}
