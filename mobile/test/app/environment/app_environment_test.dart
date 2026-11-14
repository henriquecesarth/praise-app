import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';

void main() {
  group('AppEnv enum parsing', () {
    test('parses development variants correctly', () {
      expect(AppEnv.fromString('development'), AppEnv.development);
      expect(AppEnv.fromString('dev'), AppEnv.development);
      expect(AppEnv.fromString('DEV'), AppEnv.development);
      expect(AppEnv.fromString('  development  '), AppEnv.development);
    });

    test('parses staging variants correctly', () {
      expect(AppEnv.fromString('staging'), AppEnv.staging);
      expect(AppEnv.fromString('STAGING'), AppEnv.staging);
    });

    test('parses production variants correctly', () {
      expect(AppEnv.fromString('production'), AppEnv.production);
      expect(AppEnv.fromString('prod'), AppEnv.production);
      expect(AppEnv.fromString('PRODUCTION'), AppEnv.production);
    });

    test('defaults to development on unknown strings', () {
      expect(AppEnv.fromString('unknown'), AppEnv.development);
      expect(AppEnv.fromString(''), AppEnv.development);
    });
  });

  group('AppEnvironment model', () {
    test('reports correct booleans for development', () {
      const env = AppEnvironment(
        env: AppEnv.development,
        apiBaseUrl: 'http://10.0.2.2:3000/api/v1',
      );

      expect(env.isDevelopment, true);
      expect(env.isStaging, false);
      expect(env.isProduction, false);
      expect(env.apiBaseUrl, 'http://10.0.2.2:3000/api/v1');
    });

    test('reports correct booleans for staging', () {
      const env = AppEnvironment(
        env: AppEnv.staging,
        apiBaseUrl: 'https://louvaio-r17-api-staging.vercel.app/api/v1',
      );

      expect(env.isDevelopment, false);
      expect(env.isStaging, true);
      expect(env.isProduction, false);
      expect(
        AppEnvironment.isAuthorizedStagingApiBaseUrl(env.apiBaseUrl),
        true,
      );
    });

    test('rejects unauthorized staging apiBaseUrl', () {
      const env = AppEnvironment(
        env: AppEnv.staging,
        apiBaseUrl: 'https://staging-api.louvaio.com.br/api/v1',
      );

      expect(env.isStaging, true);
      expect(
        AppEnvironment.isAuthorizedStagingApiBaseUrl(env.apiBaseUrl),
        false,
      );
    });

    test('accepts official staging apiBaseUrl variants', () {
      const authorizedUrls = [
        'https://louvaio-staging-api.vercel.app/api/v1',
        'https://louvaio-r17-api-staging.vercel.app/api/v1',
        'https://louvaio-m20-c14-api-staging.vercel.app/api/v1',
      ];

      for (final url in authorizedUrls) {
        expect(
          AppEnvironment.isAuthorizedStagingApiBaseUrl(url),
          true,
          reason: 'Expected authorized staging URL to be accepted: $url',
        );
      }
    });

    test('rejects malicious, malformed or production urls in staging', () {
      const rejectedUrls = [
        '',
        'http://louvaio-staging-api.vercel.app/api/v1',
        'https://louvaio-staging-api.vercel.app.evil.test/api/v1',
        'https://evil-louvaio-staging-api.vercel.app/api/v1',
        'https://louvaio-staging-api.vercel.app:443/api/v1',
        'https://louvaio-staging-api.vercel.app:8443/api/v1',
        'https://user@louvaio-staging-api.vercel.app/api/v1',
        'https://user:pass@louvaio-staging-api.vercel.app/api/v1',
        'https://louvaio-staging-api.vercel.app/api/v1?override=1',
        'https://louvaio-staging-api.vercel.app/api/v1#override',
        'https://louvaio-staging-api.vercel.app/api/v2',
        'https://louvaio-staging-api.vercel.app/api/v1/',
        'https://louvaio-staging-api.vercel.app',
        'https://praise-app-gray.vercel.app/api/v1',
        'https://api.louvaio.com.br/api/v1',
      ];

      for (final url in rejectedUrls) {
        expect(
          AppEnvironment.isAuthorizedStagingApiBaseUrl(url),
          false,
          reason: 'Expected invalid/unauthorized URL to be rejected: $url',
        );
      }
    });

    test('validates staging dart-defines when APP_ENV=staging', () {
      const rawEnv = String.fromEnvironment('APP_ENV');
      if (rawEnv.trim().toLowerCase() != 'staging') {
        return;
      }
      final env = AppEnvironment.fromDartDefines();
      expect(env.isStaging, true);
      expect(
        AppEnvironment.isAuthorizedStagingApiBaseUrl(env.apiBaseUrl),
        true,
      );
    });

    test('reports correct booleans for production', () {
      const env = AppEnvironment(
        env: AppEnv.production,
        apiBaseUrl: 'https://api.louvaio.com.br/api/v1',
      );

      expect(env.isDevelopment, false);
      expect(env.isStaging, false);
      expect(env.isProduction, true);
    });

    test('fromDartDefines loads defaults in test runner environment', () {
      if (const String.fromEnvironment('APP_ENV').isNotEmpty ||
          const String.fromEnvironment('API_BASE_URL').isNotEmpty) {
        return;
      }
      final env = AppEnvironment.fromDartDefines();
      expect(env.env, AppEnv.development);
      expect(env.apiBaseUrl, AppEnvironment.defaultDevApiBaseUrl);
    });
  });
}
