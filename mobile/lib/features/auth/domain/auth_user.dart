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
  static const defaultChordLineSpacingPx = 0;
  static const double defaultChordLineSpacingPxDouble = 0.0;

  final String id;
  final String email;
  final String name;
  final String chordFontFamily;
  final int chordLineSpacingPx;

  const AuthUser({
    required this.id,
    required this.email,
    required this.name,
    this.chordFontFamily = defaultChordFont,
    this.chordLineSpacingPx = defaultChordLineSpacingPx,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    final prefs = json['preferences'];
    String font = defaultChordFont;
    var lineSpacing = defaultChordLineSpacingPx;
    if (prefs is Map) {
      final rawFont = prefs['chord_font_family'];
      if (rawFont is String && supportedChordFonts.contains(rawFont)) {
        font = rawFont;
      }
      final rawSpacing = prefs['chord_line_spacing_px'];
      if (rawSpacing is int &&
          rawSpacing >= 0 &&
          rawSpacing <= 24 &&
          rawSpacing.isEven) {
        lineSpacing = rawSpacing;
      }
    }

    return AuthUser(
      id: json['id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      name: json['name'] as String? ?? '',
      chordFontFamily: font,
      chordLineSpacingPx: lineSpacing,
    );
  }

  AuthUser copyWith({
    String? id,
    String? email,
    String? name,
    String? chordFontFamily,
    int? chordLineSpacingPx,
  }) {
    return AuthUser(
      id: id ?? this.id,
      email: email ?? this.email,
      name: name ?? this.name,
      chordFontFamily: chordFontFamily ?? this.chordFontFamily,
      chordLineSpacingPx: chordLineSpacingPx ?? this.chordLineSpacingPx,
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'name': name,
    'preferences': {
      'chord_font_family': chordFontFamily,
      'chord_line_spacing_px': chordLineSpacingPx,
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
          chordFontFamily == other.chordFontFamily &&
          chordLineSpacingPx == other.chordLineSpacingPx;

  @override
  int get hashCode =>
      id.hashCode ^
      email.hashCode ^
      name.hashCode ^
      chordFontFamily.hashCode ^
      chordLineSpacingPx.hashCode;

  @override
  String toString() =>
      'AuthUser(id: $id, email: $email, name: $name, chordFontFamily: $chordFontFamily, chordLineSpacingPx: $chordLineSpacingPx)';
}
