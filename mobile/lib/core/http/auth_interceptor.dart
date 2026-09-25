import 'package:dio/dio.dart';

typedef TokenProvider = Future<String?> Function({bool forceRefresh});
typedef AuthFailureCallback = Future<void> Function();

/// Dio interceptor providing Firebase ID Token bearer authentication
/// and single-attempt 401 token refresh.
class AuthInterceptor extends Interceptor {
  final TokenProvider tokenProvider;
  final AuthFailureCallback onAuthenticationFailed;
  final Dio dio;

  static const String requiresAuthKey = 'requiresAuth';
  static const String authRetryKey = 'auth_retry';

  AuthInterceptor({
    required this.tokenProvider,
    required this.onAuthenticationFailed,
    required this.dio,
  });

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final requiresAuth = options.extra[requiresAuthKey] as bool? ?? true;

    if (!requiresAuth) {
      return handler.next(options);
    }

    if (!options.headers.containsKey('Authorization')) {
      final token = await tokenProvider(forceRefresh: false);
      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }

    return handler.next(options);
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

    if (statusCode == 401 && requiresAuth) {
      if (!alreadyRetried) {
        err.requestOptions.extra[authRetryKey] = true;
        try {
          final refreshedToken = await tokenProvider(forceRefresh: true);
          if (refreshedToken != null && refreshedToken.isNotEmpty) {
            final retryHeaders =
                Map<String, dynamic>.from(err.requestOptions.headers);
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
            await onAuthenticationFailed();
            return handler.next(err);
          }
        } catch (e) {
          if (e is DioException && e.response?.statusCode == 401) {
            await onAuthenticationFailed();
          }
          if (e is DioException) {
            return handler.next(e);
          }
          return handler.next(err);
        }
      } else {
        // Second 401: do NOT retry again. Invalidate session.
        await onAuthenticationFailed();
        return handler.next(err);
      }
    }

    return handler.next(err);
  }
}
