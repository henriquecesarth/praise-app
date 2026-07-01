/// API Configuration
class ApiConstants {
  ApiConstants._();

  /// Base URL for the backend API
  /// Substitua pela URL gerada pelo Ngrok (ex: 'https://abc-123.ngrok-free.app/api/v1')
  static const String baseUrl = 'https://praise-app-gray.vercel.app/api/v1';
  // static const String baseUrl = 'http://10.0.2.2:3000/api/v1'; // IP padrão do host no emulador Android
  // static const String baseUrl = 'http://localhost:3000/api/v1'; // Localhost para Flutter Web/PWA


  /// Default ministry ID for development (no auth)
  static const String defaultMinistryId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

  /// Request timeout
  static const Duration timeout = Duration(seconds: 30);
}

/// Musical Keys available for songs
class MusicalKeys {
  MusicalKeys._();

  static const List<String> all = [
    'C', 'C#', 'D', 'Eb', 'E', 'F',
    'F#', 'G', 'Ab', 'A', 'Bb', 'B',
  ];
}

/// UI Constants
class UIConstants {
  UIConstants._();

  static const double searchDebounceMs = 300;
  static const int staggerDelayMs = 50;
  static const int pageSize = 50;
}
