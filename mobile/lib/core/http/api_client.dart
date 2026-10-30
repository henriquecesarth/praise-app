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

  SessionContextProvider? _sessionContextProvider;
  TokenProvider? _tokenProvider;
  AuthFailureCallback? _onAuthenticationFailed;

  SessionContextProvider? get sessionContextProvider => _sessionContextProvider;

  set sessionContextProvider(SessionContextProvider? provider) {
    _sessionContextProvider = provider;
    for (final interceptor in dio.interceptors) {
      if (interceptor is AuthInterceptor) {
        interceptor.sessionContextProvider = provider;
      }
    }
  }

  TokenProvider? get tokenProvider => _tokenProvider;

  set tokenProvider(TokenProvider? provider) {
    _tokenProvider = provider;
    var found = false;
    for (final interceptor in dio.interceptors) {
      if (interceptor is AuthInterceptor) {
        interceptor.tokenProvider = provider;
        found = true;
      }
    }
    if (!found && provider != null) {
      dio.interceptors.insert(
        0,
        AuthInterceptor(
          tokenProvider: provider,
          onAuthenticationFailed: _onAuthenticationFailed,
          dio: dio,
          sessionContextProvider: _sessionContextProvider,
        ),
      );
    }
  }

  AuthFailureCallback? get onAuthenticationFailed => _onAuthenticationFailed;

  set onAuthenticationFailed(AuthFailureCallback? callback) {
    _onAuthenticationFailed = callback;
    for (final interceptor in dio.interceptors) {
      if (interceptor is AuthInterceptor) {
        interceptor.onAuthenticationFailed = callback;
      }
    }
  }

  ApiClient({
    required AppEnvironment environment,
    required this.logger,
    Dio? customDio,
    Interceptor? authInterceptor,
    TokenProvider? tokenProvider,
    SessionContextProvider? sessionContextProvider,
    AuthFailureCallback? onAuthenticationFailed,
  })  : _sessionContextProvider = sessionContextProvider,
        _tokenProvider = tokenProvider,
        _onAuthenticationFailed = onAuthenticationFailed,
        dio = customDio ??
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
      if (authInterceptor is AuthInterceptor) {
        if (sessionContextProvider != null) {
          authInterceptor.sessionContextProvider = sessionContextProvider;
        }
        if (tokenProvider != null) {
          authInterceptor.tokenProvider = tokenProvider;
        }
        if (onAuthenticationFailed != null) {
          authInterceptor.onAuthenticationFailed = onAuthenticationFailed;
        }
      }
      dio.interceptors.add(authInterceptor);
    } else if (tokenProvider != null) {
      dio.interceptors.add(
        AuthInterceptor(
          tokenProvider: tokenProvider,
          onAuthenticationFailed: onAuthenticationFailed,
          dio: dio,
          sessionContextProvider: sessionContextProvider,
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
    if (error.error is AppFailure) {
      return error.error as AppFailure;
    }

    if (error.response?.data is Map<String, dynamic>) {
      return AppFailure.fromBackendJson(
        error.response!.data as Map<String, dynamic>,
        statusCode: error.response?.statusCode,
      );
    }

    final status = error.response?.statusCode;
    if (status != null) {
      return AppFailure(
        message: status == 404
            ? 'O servidor configurado não oferece esta operação (HTTP 404).'
            : status == 401 || status == 403
                ? 'Acesso recusado pelo servidor (HTTP $status). Verifique a sessão ou a proteção do ambiente.'
                : 'Resposta inesperada do servidor (HTTP $status).',
        statusCode: status,
        code: 'HTTP_ERROR',
      );
    }
    return AppFailure.network(
      message: error.message ?? 'Falha de comunicação com o servidor.',
      statusCode: error.response?.statusCode,
    );
  }
}
