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
  static const int minVocalMidi = 48; // Dó3
  static const int maxVocalMidi = 88; // Mi6
  static const int defaultVocalMinMidi = 48; // Dó3
  static const int defaultVocalMaxMidi = 84; // Dó6

  final String id;
  final String email;
  final String name;
  final String chordFontFamily;
  final int chordLineSpacingPx;
  final int? vocalMinMidi;
  final int? vocalMaxMidi;

  const AuthUser({
    required this.id,
    required this.email,
    required this.name,
    this.chordFontFamily = defaultChordFont,
    this.chordLineSpacingPx = defaultChordLineSpacingPx,
    this.vocalMinMidi,
    this.vocalMaxMidi,
  });

  static (int?, int?) normalizeVocalRange(Object? rawMin, Object? rawMax) {
    final minVal = rawMin is int
        ? rawMin
        : (rawMin is num && rawMin == rawMin.roundToDouble()
              ? rawMin.toInt()
              : null);
    final maxVal = rawMax is int
        ? rawMax
        : (rawMax is num && rawMax == rawMax.roundToDouble()
              ? rawMax.toInt()
              : null);
    if (minVal == null || maxVal == null) return (null, null);
    if (minVal < minVocalMidi ||
        maxVal > maxVocalMidi ||
        minVal >= maxVal) {
      return (null, null);
    }
    return (minVal, maxVal);
  }

  factory AuthUser.fromJson(Map<String, dynamic> json) {
    final prefs = json['preferences'];
    String font = defaultChordFont;
    var lineSpacing = defaultChordLineSpacingPx;
    int? vocalMin;
    int? vocalMax;
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
      final (normalizedMin, normalizedMax) = normalizeVocalRange(
        prefs['vocal_min_midi'] ?? prefs['vocalMinMidi'],
        prefs['vocal_max_midi'] ?? prefs['vocalMaxMidi'],
      );
      vocalMin = normalizedMin;
      vocalMax = normalizedMax;
    }

    return AuthUser(
      id: json['id'] as String? ?? '',
      email: json['email'] as String? ?? '',
      name: json['name'] as String? ?? '',
      chordFontFamily: font,
      chordLineSpacingPx: lineSpacing,
      vocalMinMidi: vocalMin,
      vocalMaxMidi: vocalMax,
    );
  }

  AuthUser copyWith({
    String? id,
    String? email,
    String? name,
    String? chordFontFamily,
    int? chordLineSpacingPx,
    int? vocalMinMidi,
    int? vocalMaxMidi,
    bool clearVocalRange = false,
  }) {
    return AuthUser(
      id: id ?? this.id,
      email: email ?? this.email,
      name: name ?? this.name,
      chordFontFamily: chordFontFamily ?? this.chordFontFamily,
      chordLineSpacingPx: chordLineSpacingPx ?? this.chordLineSpacingPx,
      vocalMinMidi:
          clearVocalRange ? null : (vocalMinMidi ?? this.vocalMinMidi),
      vocalMaxMidi:
          clearVocalRange ? null : (vocalMaxMidi ?? this.vocalMaxMidi),
    );
  }

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'name': name,
    'preferences': {
      'chord_font_family': chordFontFamily,
      'chord_line_spacing_px': chordLineSpacingPx,
      if (vocalMinMidi != null) 'vocal_min_midi': vocalMinMidi,
      if (vocalMaxMidi != null) 'vocal_max_midi': vocalMaxMidi,
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
          chordLineSpacingPx == other.chordLineSpacingPx &&
          vocalMinMidi == other.vocalMinMidi &&
          vocalMaxMidi == other.vocalMaxMidi;

  @override
  int get hashCode =>
      id.hashCode ^
      email.hashCode ^
      name.hashCode ^
      chordFontFamily.hashCode ^
      chordLineSpacingPx.hashCode ^
      vocalMinMidi.hashCode ^
      vocalMaxMidi.hashCode;

  @override
  String toString() =>
      'AuthUser(id: $id, email: $email, name: $name, chordFontFamily: $chordFontFamily, chordLineSpacingPx: $chordLineSpacingPx, vocalMinMidi: $vocalMinMidi, vocalMaxMidi: $vocalMaxMidi)';
}
