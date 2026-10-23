/// Authenticated LouvAIO user domain model matching backend /api/v1/auth/me.
class AuthUser {
  static const supportedChordFonts = [
    'monospace',
    'Arial',
    'Times New Roman',
    'Georgia',
    'Verdana',
    'Courier New',
  ];
  static const defaultChordFont = 'monospace';

  final String id;
  final String email;
  final String name;
  final String chordFontFamily;

  const AuthUser({
    required this.id,
    required this.email,
    required this.name,
    this.chordFontFamily = defaultChordFont,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    final prefs = json['preferences'];
    String font = defaultChordFont;
    if (prefs is Map) {
      final rawFont = prefs['chord_font_family'];
      if (rawFont is String && supportedChordFonts.contains(rawFont)) {
        font = rawFont;
      }
    }

    return AuthUser(
      id: json['id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      name: json['name'] as String? ?? '',
      chordFontFamily: font,
    );
  }

  AuthUser copyWith({
    String? id,
    String? email,
    String? name,
    String? chordFontFamily,
  }) {
    return AuthUser(
      id: id ?? this.id,
      email: email ?? this.email,
      name: name ?? this.name,
      chordFontFamily: chordFontFamily ?? this.chordFontFamily,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'email': email,
        'name': name,
        'preferences': {
          'chord_font_family': chordFontFamily,
        },
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthUser &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          email == other.email &&
          name == other.name &&
          chordFontFamily == other.chordFontFamily;

  @override
  int get hashCode =>
      id.hashCode ^ email.hashCode ^ name.hashCode ^ chordFontFamily.hashCode;

  @override
  String toString() =>
      'AuthUser(id: $id, email: $email, name: $name, chordFontFamily: $chordFontFamily)';
}
