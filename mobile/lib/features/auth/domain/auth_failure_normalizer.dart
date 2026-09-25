import 'package:firebase_auth/firebase_auth.dart';
import '../../../core/errors/app_failure.dart';

/// Normalizes authentication exceptions into user-friendly [AppFailure] instances.
class AuthFailureNormalizer {
  static AppFailure normalize(Object error) {
    if (error is AppFailure) {
      return error;
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
          );
        case 'user-disabled':
          return AppFailure(
            message: 'Esta conta foi desativada pelo administrador.',
            code: error.code,
            statusCode: 403,
          );
        case 'too-many-requests':
          return AppFailure(
            message:
                'Muitas tentativas consecutivas. Tente novamente mais tarde.',
            code: error.code,
            statusCode: 429,
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
          );
        case 'weak-password':
          return AppFailure(
            message: 'A senha informada é muito fraca.',
            code: error.code,
            statusCode: 400,
          );
        case 'invalid-email':
          return AppFailure(
            message: 'O formato do e-mail é inválido.',
            code: error.code,
            statusCode: 400,
          );
        default:
          return AppFailure(
            message: error.message ?? 'Falha na autenticação. Tente novamente.',
            code: error.code,
          );
      }
    }

    return AppFailure(
      message: 'Ocorreu um erro inesperado durante a autenticação.',
      details: {'raw': error.toString()},
    );
  }
}
