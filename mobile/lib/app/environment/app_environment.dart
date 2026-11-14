/// Supported runtime environments for the LouvAIO mobile app.
enum AppEnv {
  development,
  staging,
  production;

  static AppEnv fromString(String value) {
    switch (value.trim().toLowerCase()) {
      case 'staging':
        return AppEnv.staging;
      case 'production':
      case 'prod':
        return AppEnv.production;
      case 'development':
      case 'dev':
      default:
        return AppEnv.development;
    }
  }
}

/// Typed, non-secret application environment configuration.
///
/// Parameters are injected at build/run time via `--dart-define`:
/// - `APP_ENV`: 'development' | 'staging' | 'production' (default: 'development')
/// - `API_BASE_URL`: Full base URL for the LouvAIO backend.
///   Defaults to `http://10.0.2.2:3000/api/v1` in development to route
///   Android Emulator traffic to the host Windows machine.
class AppEnvironment {
  final AppEnv env;
  final String apiBaseUrl;

  const AppEnvironment({
    required this.env,
    required this.apiBaseUrl,
  });

  bool get isProduction => env == AppEnv.production;
  bool get isStaging => env == AppEnv.staging;
  bool get isDevelopment => env == AppEnv.development;

  /// Default API base URL for local development on Android emulator.
  static const String defaultDevApiBaseUrl = 'http://10.0.2.2:3000/api/v1';

  /// Checks whether [url] is an authorized HTTPS Staging `/api/v1` base URL.
  static bool isAuthorizedStagingApiBaseUrl(String url) {
    final trimmed = url.trim();
    if (trimmed.isEmpty || !trimmed.startsWith('https://')) {
      return false;
    }
    final uri = Uri.tryParse(trimmed);
    final host = uri?.host ?? '';
    final isAuthorizedHost =
        host == 'louvaio-staging-api.vercel.app' ||
        host == 'louvaio-r17-api-staging.vercel.app' ||
        host == 'louvaio-m20-c14-api-staging.vercel.app' ||
        host.endsWith('-henriquecesarths-projects.vercel.app');
    return uri != null &&
        isAuthorizedHost &&
        uri.userInfo.isEmpty &&
        !uri.hasPort &&
        !uri.hasQuery &&
        !uri.hasFragment &&
        uri.path == '/api/v1';
  }

  /// Loads configuration from compile-time `--dart-define` parameters.
  factory AppEnvironment.fromDartDefines() {
    const rawEnv =
        String.fromEnvironment('APP_ENV', defaultValue: 'development');
    final env = AppEnv.fromString(rawEnv);

    final rawApiBaseUrl = const String.fromEnvironment('API_BASE_URL').trim();
    if (env == AppEnv.staging) {
      if (rawApiBaseUrl.isEmpty || !rawApiBaseUrl.startsWith('https://')) {
        throw ArgumentError(
          'Staging requires an explicit HTTPS Preview API_BASE_URL.',
        );
      }
      if (!isAuthorizedStagingApiBaseUrl(rawApiBaseUrl)) {
        throw ArgumentError(
          'Staging API must be an authorized HTTPS Staging /api/v1 URL.',
        );
      }
    }

    if (env == AppEnv.production) {
      if (rawApiBaseUrl.isEmpty || !rawApiBaseUrl.startsWith('https://')) {
        throw ArgumentError(
          'Production API_BASE_URL must use HTTPS protocol.',
        );
      }
      final uri = Uri.tryParse(rawApiBaseUrl);
      final host = uri?.host ?? '';
      if (host.contains('staging') ||
          host.contains('preview') ||
          host.contains('localhost') ||
          host == '10.0.2.2' ||
          uri == null ||
          uri.userInfo.isNotEmpty ||
          uri.hasPort ||
          uri.hasQuery ||
          uri.hasFragment ||
          uri.path != '/api/v1') {
        throw ArgumentError(
          'Production API cannot use staging, preview or local hosts.',
        );
      }
    }

    final String apiBaseUrl;
    if (rawApiBaseUrl.isNotEmpty) {
      apiBaseUrl = rawApiBaseUrl;
    } else {
      if (env == AppEnv.production) {
        throw ArgumentError(
          'API_BASE_URL must be explicitly provided via --dart-define in production mode.',
        );
      }
      apiBaseUrl = defaultDevApiBaseUrl;
    }

    return AppEnvironment(
      env: env,
      apiBaseUrl: apiBaseUrl,
    );
  }
}
