import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_failure_normalizer.dart';

void main() {
  group('AuthFailureNormalizer', () {
    test('returns AppFailure as-is if already an AppFailure', () {
      const original = AppFailure(message: 'Erro customizado', statusCode: 422);
      final normalized = AuthFailureNormalizer.normalize(original);

      expect(identical(normalized, original), isTrue);
      expect(normalized.message, 'Erro customizado');
      expect(normalized.statusCode, 422);
    });

    test(
        'normalizes FirebaseAuthException credentials errors to friendly message',
        () {
      final authEx1 = FirebaseAuthException(code: 'user-not-found');
      final authEx2 = FirebaseAuthException(code: 'wrong-password');
      final authEx3 = FirebaseAuthException(code: 'invalid-credential');
      final authEx4 = FirebaseAuthException(code: 'INVALID-LOGIN-CREDENTIALS');

      for (final ex in [authEx1, authEx2, authEx3, authEx4]) {
        final failure = AuthFailureNormalizer.normalize(ex);
        expect(failure.message, 'E-mail ou senha incorretos.');
        expect(failure.statusCode, 401);
      }
    });

    test('normalizes disabled user error', () {
      final ex = FirebaseAuthException(code: 'user-disabled');
      final failure = AuthFailureNormalizer.normalize(ex);

      expect(failure.message, 'Esta conta foi desativada pelo administrador.');
      expect(failure.statusCode, 403);
    });

    test('normalizes rate limiting error', () {
      final ex = FirebaseAuthException(code: 'too-many-requests');
      final failure = AuthFailureNormalizer.normalize(ex);

      expect(failure.message, contains('Muitas tentativas'));
      expect(failure.statusCode, 429);
    });

    test('normalizes network request failed error', () {
      final ex = FirebaseAuthException(code: 'network-request-failed');
      final failure = AuthFailureNormalizer.normalize(ex);

      expect(failure.code, 'NETWORK_ERROR');
      expect(failure.message, contains('Falha de conexão'));
    });

    test(
        'normalizes signup specific errors (email in use, weak password, invalid email)',
        () {
      final inUse = AuthFailureNormalizer.normalize(
        FirebaseAuthException(code: 'email-already-in-use'),
      );
      expect(inUse.message, 'Este e-mail já está em uso.');
      expect(inUse.statusCode, 409);

      final weak = AuthFailureNormalizer.normalize(
        FirebaseAuthException(code: 'weak-password'),
      );
      expect(weak.message, 'A senha informada é muito fraca.');
      expect(weak.statusCode, 400);

      final invalidEmail = AuthFailureNormalizer.normalize(
        FirebaseAuthException(code: 'invalid-email'),
      );
      expect(invalidEmail.message, 'O formato do e-mail é inválido.');
      expect(invalidEmail.statusCode, 400);
    });

    test('normalizes unknown Firebase error code with fallback message', () {
      final ex =
          FirebaseAuthException(code: 'unknown-code', message: 'Raw error');
      final failure = AuthFailureNormalizer.normalize(ex);

      expect(failure.message, 'Raw error');
      expect(failure.code, 'unknown-code');
    });

    test('normalizes generic Exception and error objects gracefully', () {
      final failure1 =
          AuthFailureNormalizer.normalize(Exception('Something failed'));
      expect(
        failure1.message,
        'Ocorreu um erro inesperado durante a autenticação.',
      );
      expect(failure1.details?['raw'], contains('Something failed'));

      final failure2 = AuthFailureNormalizer.normalize('A string error');
      expect(
        failure2.message,
        'Ocorreu um erro inesperado durante a autenticação.',
      );
      expect(failure2.details?['raw'], 'A string error');
    });
  });
}
