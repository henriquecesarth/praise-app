import 'dart:developer' as developer;

/// Sanitizing logger for application and network diagnostics.
///
/// Ensures tokens, authorization headers, passwords, and sensitive keys
/// are never logged even in debug configurations.
class AppLogger {
  final bool isDebug;

  const AppLogger({this.isDebug = true});

  void debug(String message, {String tag = 'LouvAIO'}) {
    if (isDebug) {
      developer.log(message, name: tag, level: 500);
    }
  }

  void info(String message, {String tag = 'LouvAIO'}) {
    developer.log(message, name: tag, level: 800);
  }

  void warning(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    String tag = 'LouvAIO',
  }) {
    developer.log(message,
        name: tag, level: 900, error: error, stackTrace: stackTrace);
  }

  void error(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    String tag = 'LouvAIO',
  }) {
    developer.log(message,
        name: tag, level: 1000, error: error, stackTrace: stackTrace);
  }

  /// Redacts sensitive bearer tokens, passwords, and secrets from text.
  static String sanitize(String input) {
    return input
        .replaceAll(
          RegExp(r'Bearer\s+[A-Za-z0-9\-._~+/]+=*', caseSensitive: false),
          'Bearer [REDACTED]',
        )
        .replaceAllMapped(
          RegExp(r'(password|secret|apiKey|api_key|token)=[^&\s]*',
              caseSensitive: false),
          (match) => '${match.group(1)}=[REDACTED]',
        );
  }
}
