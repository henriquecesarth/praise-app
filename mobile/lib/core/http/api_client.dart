import 'package:dio/dio.dart';
import '../../app/environment/app_environment.dart';
import '../errors/app_failure.dart';
import '../logging/app_logger.dart';
import 'auth_interceptor.dart';

/// Central HTTP API client for LouvAIO mobile.
///
/// Wraps Dio with standard timeouts, base URL resolution, sanitized logging,
/// and consistent conversion of exceptions to [AppFailure].
class ApiClient {
  final Dio dio;
  final AppLogger logger;

  ApiClient({
    required AppEnvironment environment,
    required this.logger,
    Dio? customDio,
    Interceptor? authInterceptor,
    TokenProvider? tokenProvider,
    AuthFailureCallback? onAuthenticationFailed,
  }) : dio = customDio ??
            Dio(
              BaseOptions(
                baseUrl: environment.apiBaseUrl,
                connectTimeout: const Duration(seconds: 10),
                receiveTimeout: const Duration(seconds: 15),
                sendTimeout: const Duration(seconds: 10),
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                },
              ),
            ) {
    if (authInterceptor != null) {
      dio.interceptors.add(authInterceptor);
    } else if (tokenProvider != null) {
      dio.interceptors.add(
        AuthInterceptor(
          tokenProvider: tokenProvider,
          onAuthenticationFailed: onAuthenticationFailed ?? () async {},
          dio: dio,
        ),
      );
    }
    if (customDio == null) {
      dio.interceptors.add(_buildLoggingInterceptor());
    }
  }

  Interceptor _buildLoggingInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) {
        if (logger.isDebug) {
          logger.debug(
              '--> ${options.method} ${AppLogger.sanitize(options.uri.toString())}');
        }
        handler.next(options);
      },
      onResponse: (response, handler) {
        if (logger.isDebug) {
          logger.debug(
            '<-- ${response.statusCode} ${response.requestOptions.method} ${AppLogger.sanitize(response.requestOptions.uri.toString())}',
          );
        }
        handler.next(response);
      },
      onError: (DioException error, handler) {
        final status = error.response?.statusCode;
        final uri = AppLogger.sanitize(error.requestOptions.uri.toString());
        logger.warning(
          '<-- ERROR ${status ?? 'NETWORK'} ${error.requestOptions.method} $uri: ${error.message}',
        );
        handler.next(error);
      },
    );
  }

  /// Maps [DioException] to standard LouvAIO [AppFailure].
  AppFailure mapDioException(DioException error) {
    if (error.response?.data is Map<String, dynamic>) {
      return AppFailure.fromBackendJson(
        error.response!.data as Map<String, dynamic>,
        statusCode: error.response?.statusCode,
      );
    }

    return AppFailure.network(
      message: error.message ?? 'Falha de comunicação com o servidor.',
      statusCode: error.response?.statusCode,
    );
  }
}
