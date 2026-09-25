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

  /// Loads configuration from compile-time `--dart-define` parameters.
  factory AppEnvironment.fromDartDefines() {
    const rawEnv =
        String.fromEnvironment('APP_ENV', defaultValue: 'development');
    final env = AppEnv.fromString(rawEnv);

    final rawApiBaseUrl = const String.fromEnvironment('API_BASE_URL').trim();

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

    if (env == AppEnv.production && !apiBaseUrl.startsWith('https://')) {
      throw ArgumentError(
        'Production API_BASE_URL must use HTTPS protocol.',
      );
    }

    return AppEnvironment(
      env: env,
      apiBaseUrl: apiBaseUrl,
    );
  }
}
