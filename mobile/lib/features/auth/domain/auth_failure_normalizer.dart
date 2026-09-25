import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/errors/app_failure.dart';

/// Normalizes authentication exceptions into user-friendly [AppFailure] instances.
class AuthFailureNormalizer {
  static const String genericErrorMessage =
      'Não foi possível concluir a operação agora. Tente novamente em instantes.';

  static const Map<String, String> _safeBackendMessages = {
    'Este endereço de e-mail já está cadastrado.':
        'Este endereço de e-mail já está cadastrado.',
    'Dados inválidos.':
        'Dados inválidos. Verifique os campos e tente novamente.',
    'A senha deve ter pelo menos 6 caracteres':
        'A senha deve ter pelo menos 6 caracteres.',
    'E-mail inválido': 'O formato do e-mail é inválido.',
    'O nome deve ter pelo menos 2 caracteres':
        'O nome deve ter pelo menos 2 caracteres.',
    'Sessão inválida ou expirada. Faça login novamente.':
        'Sessão inválida ou expirada. Faça login novamente.',
    'Token de autenticação não fornecido.':
        'Sessão inválida ou expirada. Faça login novamente.',
    'Token de autenticação inválido.':
        'Sessão inválida ou expirada. Faça login novamente.',
    'Senha incorreta': 'Senha incorreta',
    'E-mail ou senha incorretos.': 'E-mail ou senha incorretos.',
  };

  static AppFailure normalize(Object error) {
    if (error is AppFailure) {
      return normalizeAppFailure(error);
    }

    if (error is FirebaseAuthException) {
      final code = error.code.toLowerCase();
      switch (code) {
        case 'user-not-found':
        case 'wrong-password':
        case 'invalid-credential':
        case 'invalid-login-credentials':
          return AppFailure(
            message: 'E-mail ou senha incorretos.',
            code: error.code,
            statusCode: 401,
            details: error.message != null ? {'raw': error.message} : null,
          );
        case 'user-disabled':
          return AppFailure(
            message: 'Esta conta foi desativada pelo administrador.',
            code: error.code,
            statusCode: 403,
            details: error.message != null ? {'raw': error.message} : null,
          );
        case 'too-many-requests':
          return AppFailure(
            message:
                'Muitas tentativas consecutivas. Tente novamente mais tarde.',
            code: error.code,
            statusCode: 429,
            details: error.message != null ? {'raw': error.message} : null,
          );
        case 'network-request-failed':
          return AppFailure.network(
            message: 'Falha de conexão. Verifique sua rede e tente novamente.',
          );
        case 'email-already-in-use':
          return AppFailure(
            message: 'Este e-mail já está em uso.',
            code: error.code,
            statusCode: 409,
            details: error.message != null ? {'raw': error.message} : null,
          );
        case 'weak-password':
          return AppFailure(
            message: 'A senha informada é muito fraca.',
            code: error.code,
            statusCode: 400,
            details: error.message != null ? {'raw': error.message} : null,
          );
        case 'invalid-email':
          return AppFailure(
            message: 'O formato do e-mail é inválido.',
            code: error.code,
            statusCode: 400,
            details: error.message != null ? {'raw': error.message} : null,
          );
        default:
          return AppFailure(
            message: genericErrorMessage,
            code: error.code,
            details: error.message != null ? {'raw': error.message} : null,
          );
      }
    }

    return AppFailure(
      message: genericErrorMessage,
      details: {'raw': error.toString()},
    );
  }

  /// Normalizes backend-originated [AppFailure] instances so that arbitrary
  /// internal backend errors or credentials failures are not rendered verbatim.
  static AppFailure normalizeAppFailure(AppFailure failure) {
    final status = failure.statusCode;
    final code = failure.code?.toLowerCase();

    // 1. Network level failure
    if (code == 'network_error' || status == null) {
      return AppFailure.network(
        message: 'Falha de conexão. Verifique sua rede e tente novamente.',
        statusCode: status,
      );
    }

    // 2. Rate limiting
    if (status == 429 || code == 'too_many_requests') {
      return AppFailure(
        message: 'Muitas tentativas consecutivas. Tente novamente mais tarde.',
        statusCode: 429,
        code: failure.code,
        details: failure.details ?? {'raw': failure.message},
      );
    }

    // 3. Unauthorized / Session expired
    if (status == 401 || code == 'unauthorized') {
      final rawMsg = failure.message.trim();
      if (_safeBackendMessages.containsKey(rawMsg)) {
        return AppFailure(
          message: _safeBackendMessages[rawMsg]!,
          statusCode: 401,
          code: failure.code,
          details: failure.details ?? {'raw': failure.message},
        );
      }
      return AppFailure(
        message: 'Sessão inválida ou expirada. Faça login novamente.',
        statusCode: 401,
        code: failure.code,
        details: failure.details ?? {'raw': failure.message},
      );
    }

    // 4. Forbidden / Account disabled
    if (status == 403 || code == 'forbidden') {
      return AppFailure(
        message:
            'Acesso negado. Esta conta foi desativada ou não possui permissão.',
        statusCode: 403,
        code: failure.code,
        details: failure.details ?? {'raw': failure.message},
      );
    }

    // 5. Conflict / Email already registered
    if (status == 409 ||
        code == 'email_already_exists' ||
        code == 'auth/email-already-exists') {
      return AppFailure(
        message: 'Este endereço de e-mail já está cadastrado.',
        statusCode: 409,
        code: failure.code,
        details: failure.details ?? {'raw': failure.message},
      );
    }

    // 6. Bad Request (Validation vs Domain vs Internal/OAuth error)
    if (status == 400) {
      // Check if backend returned structured validation errors (Zod)
      if (failure.details != null && failure.details!['errors'] != null) {
        return AppFailure(
          message: 'Dados inválidos. Verifique os campos e tente novamente.',
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          details: failure.details,
        );
      }

      // Check safe known domain messages
      final rawMsg = failure.message.trim();
      if (_safeBackendMessages.containsKey(rawMsg)) {
        return AppFailure(
          message: _safeBackendMessages[rawMsg]!,
          statusCode: 400,
          code: failure.code,
          details: failure.details ?? {'raw': failure.message},
        );
      }

      // Any other 400 (e.g. Firebase Admin credential error, OAuth failure)
      return AppFailure(
        message: genericErrorMessage,
        statusCode: 400,
        code: failure.code,
        details: failure.details ?? {'raw': failure.message},
      );
    }

    // 7. Generic fallback for 5xx and all unknown errors
    return AppFailure(
      message: genericErrorMessage,
      statusCode: status,
      code: failure.code,
      details: failure.details ?? {'raw': failure.message},
    );
  }
}
