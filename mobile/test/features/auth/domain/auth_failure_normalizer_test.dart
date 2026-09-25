import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_failure_normalizer.dart';

void main() {
  group('AuthFailureNormalizer', () {
    test(
        'sanitizes raw backend infrastructure errors (e.g. Firebase Admin / OAuth) while keeping details',
        () {
      const rawError = AppFailure(
        message:
            'Credential implementation provided to initializeApp() via the "credential" property failed to fetch a valid Google OAuth2 access token with the following error: "".',
        statusCode: 400,
      );
      final normalized = AuthFailureNormalizer.normalize(rawError);

      // Verbatim raw message must NOT be displayed to the user
      expect(
        normalized.message,
        'Não foi possível concluir a operação agora. Tente novamente em instantes.',
      );
      expect(normalized.statusCode, 400);
      // Raw technical error must be preserved in details for sanitized logging/debugging
      expect(normalized.details?['raw'], contains('Credential implementation'));
    });

    test(
        'preserves safe known backend validation messages (Zod structured errors)',
        () {
      const validationError = AppFailure(
        message: 'Dados inválidos.',
        statusCode: 400,
        details: {
          'errors': [
            {'field': 'email', 'message': 'E-mail inválido'}
          ]
        },
      );
      final normalized = AuthFailureNormalizer.normalize(validationError);

      expect(
        normalized.message,
        'Dados inválidos. Verifique os campos e tente novamente.',
      );
      expect(normalized.statusCode, 400);
      expect(normalized.code, 'VALIDATION_ERROR');
    });

    test('preserves safe known backend domain messages', () {
      const inUse = AppFailure(
        message: 'Este endereço de e-mail já está cadastrado.',
        statusCode: 400,
      );
      final normalizedInUse = AuthFailureNormalizer.normalize(inUse);
      expect(
        normalizedInUse.message,
        'Este endereço de e-mail já está cadastrado.',
      );

      const weakPwd = AppFailure(
        message: 'A senha deve ter pelo menos 6 caracteres',
        statusCode: 400,
      );
      final normalizedWeakPwd = AuthFailureNormalizer.normalize(weakPwd);
      expect(
        normalizedWeakPwd.message,
        'A senha deve ter pelo menos 6 caracteres.',
      );
    });

    test('normalizes 401 unauthorized to standard session expired message', () {
      const unauth = AppFailure(
        message: 'Token de autenticação não fornecido.',
        statusCode: 401,
      );
      final normalized = AuthFailureNormalizer.normalize(unauth);
      expect(
        normalized.message,
        'Sessão inválida ou expirada. Faça login novamente.',
      );
      expect(normalized.statusCode, 401);
    });

    test('normalizes 500 internal server error to generic friendly message',
        () {
      const serverErr = AppFailure(
        message: 'Internal server exception at line 42',
        statusCode: 500,
      );
      final normalized = AuthFailureNormalizer.normalize(serverErr);
      expect(
        normalized.message,
        'Não foi possível concluir a operação agora. Tente novamente em instantes.',
      );
      expect(normalized.details?['raw'], contains('Internal server exception'));
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

    test(
        'normalizes unknown Firebase error code with generic message and preserves raw detail',
        () {
      final ex = FirebaseAuthException(
          code: 'unknown-internal-code', message: 'Internal stack trace');
      final failure = AuthFailureNormalizer.normalize(ex);

      expect(
        failure.message,
        'Não foi possível concluir a operação agora. Tente novamente em instantes.',
      );
      expect(failure.code, 'unknown-internal-code');
      expect(failure.details?['raw'], 'Internal stack trace');
    });

    test('normalizes generic Exception and error objects gracefully', () {
      final failure1 =
          AuthFailureNormalizer.normalize(Exception('Something failed'));
      expect(
        failure1.message,
        'Não foi possível concluir a operação agora. Tente novamente em instantes.',
      );
      expect(failure1.details?['raw'], contains('Something failed'));

      final failure2 = AuthFailureNormalizer.normalize('A string error');
      expect(
        failure2.message,
        'Não foi possível concluir a operação agora. Tente novamente em instantes.',
      );
      expect(failure2.details?['raw'], 'A string error');
    });
  });
}
