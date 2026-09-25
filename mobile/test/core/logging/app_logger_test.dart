import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';

void main() {
  group('AppLogger.sanitize', () {
    test('redacts bearer tokens', () {
      const input =
          'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1aWQiOiJ1c2VyMTIzIn0.xyz';
      final sanitized = AppLogger.sanitize(input);

      expect(sanitized, 'Authorization: Bearer [REDACTED]');
      expect(sanitized.contains('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), false);
    });

    test('redacts password and token query parameters', () {
      const input =
          'https://api.example.com/login?password=mysecretpassword123&token=supersecrettoken';
      final sanitized = AppLogger.sanitize(input);

      expect(sanitized, contains('password=[REDACTED]'));
      expect(sanitized, contains('token=[REDACTED]'));
      expect(sanitized.contains('mysecretpassword123'), false);
    });

    test('leaves non-sensitive paths intact', () {
      const input = '--> GET http://10.0.2.2:3000/api/v1/auth/me';
      final sanitized = AppLogger.sanitize(input);

      expect(sanitized, input);
    });
  });

  group('AppLogger instance methods', () {
    test('logs at all levels without throwing', () {
      const logger = AppLogger(isDebug: true);

      expect(() => logger.debug('debug message'), returnsNormally);
      expect(() => logger.info('info message'), returnsNormally);
      expect(() => logger.warning('warning message'), returnsNormally);
      expect(() => logger.error('error message'), returnsNormally);
    });
  });
}
