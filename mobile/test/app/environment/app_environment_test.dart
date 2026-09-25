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
        apiBaseUrl: 'https://staging-api.louvaio.com.br/api/v1',
      );

      expect(env.isDevelopment, false);
      expect(env.isStaging, true);
      expect(env.isProduction, false);
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
      final env = AppEnvironment.fromDartDefines();
      expect(env.env, AppEnv.development);
      expect(env.apiBaseUrl, AppEnvironment.defaultDevApiBaseUrl);
    });
  });
}
