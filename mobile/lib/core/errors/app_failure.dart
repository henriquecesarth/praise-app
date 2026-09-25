/// Domain failure representation matching backend AppError contract.
///
/// LouvAIO Express backend formats error responses as:
/// ```json
/// {
///   "error": {
///     "message": "Mensagem amigável para o usuário",
///     "details": {
///       "code": "OPTIONAL_ERROR_CODE",
///       ...
///     }
///   }
/// }
/// ```
class AppFailure implements Exception {
  final String message;
  final int? statusCode;
  final String? code;
  final Map<String, dynamic>? details;

  const AppFailure({
    required this.message,
    this.statusCode,
    this.code,
    this.details,
  });

  /// Factory constructor to parse standard LouvAIO backend error JSON envelopes.
  factory AppFailure.fromBackendJson(
    Map<String, dynamic> json, {
    int? statusCode,
    String? fallbackMessage,
  }) {
    final errorObj = json['error'];
    if (errorObj is Map<String, dynamic>) {
      final message = errorObj['message'] as String? ??
          fallbackMessage ??
          'Ocorreu um erro inesperado.';
      final details = errorObj['details'] as Map<String, dynamic>?;
      final code = details?['code'] as String?;
      return AppFailure(
        message: message,
        statusCode: statusCode,
        code: code,
        details: details,
      );
    }

    final message = json['message'] as String? ??
        fallbackMessage ??
        'Ocorreu um erro inesperado.';
    return AppFailure(
      message: message,
      statusCode: statusCode,
    );
  }

  /// Network-level or transport error.
  factory AppFailure.network({String? message, int? statusCode}) {
    return AppFailure(
      message: message ?? 'Falha de conexão. Verifique sua internet.',
      statusCode: statusCode,
      code: 'NETWORK_ERROR',
    );
  }

  @override
  String toString() =>
      'AppFailure(statusCode: $statusCode, code: $code, message: $message)';
}
