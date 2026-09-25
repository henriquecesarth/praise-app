import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';

void main() {
  group('AppFailure', () {
    test(
        'parses standard backend { error: { message, details: { code } } } envelope',
        () {
      final json = {
        'error': {
          'message': 'Sessão inválida ou expirada.',
          'details': {
            'code': 'AUTH_EXPIRED',
            'retryAfter': 60,
          },
        },
      };

      final failure = AppFailure.fromBackendJson(json, statusCode: 401);

      expect(failure.message, 'Sessão inválida ou expirada.');
      expect(failure.statusCode, 401);
      expect(failure.code, 'AUTH_EXPIRED');
      expect(failure.details?['retryAfter'], 60);
    });

    test('parses fallback simple { message: ... } json', () {
      final json = {
        'message': 'Recurso não encontrado.',
      };

      final failure = AppFailure.fromBackendJson(json, statusCode: 404);

      expect(failure.message, 'Recurso não encontrado.');
      expect(failure.statusCode, 404);
      expect(failure.code, isNull);
    });

    test('uses fallback message when message is missing or empty', () {
      final failure = AppFailure.fromBackendJson(
        {},
        statusCode: 500,
        fallbackMessage: 'Erro interno do servidor',
      );

      expect(failure.message, 'Erro interno do servidor');
      expect(failure.statusCode, 500);
    });

    test('creates network failure with default message and code', () {
      final failure = AppFailure.network();

      expect(failure.message, contains('Falha de conexão'));
      expect(failure.code, 'NETWORK_ERROR');
    });

    test('toString includes statusCode, code and message', () {
      const failure = AppFailure(
        message: 'Teste de erro',
        statusCode: 400,
        code: 'BAD_REQUEST',
      );

      final str = failure.toString();
      expect(str, contains('400'));
      expect(str, contains('BAD_REQUEST'));
      expect(str, contains('Teste de erro'));
    });
  });
}
