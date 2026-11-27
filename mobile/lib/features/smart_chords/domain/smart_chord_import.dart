class ImportWarning {
  final String code;
  final String message;

  const ImportWarning({
    required this.code,
    required this.message,
  });

  factory ImportWarning.fromMap(Map<String, dynamic> map) {
    return ImportWarning(
      code: map['code'] as String? ?? 'UNKNOWN',
      message: map['message'] as String? ?? '',
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'code': code,
      'message': message,
    };
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ImportWarning &&
          runtimeType == other.runtimeType &&
          code == other.code &&
          message == other.message;

  @override
  int get hashCode => Object.hash(code, message);

  @override
  String toString() => 'ImportWarning(code: , message: )';
}

class SmartChordImportDraft {
  final String title;
  final String? artistName;
  final String? originalKey;
  final String content;
  final List<ImportWarning> warnings;
  final String sourceType;
  final bool requiresManualPaste;
  final String? sourceUrl;
  final String? originalText;
  final String? displayedKey;
  final int? capo;

  const SmartChordImportDraft({
    required this.title,
    this.artistName,
    this.originalKey,
    required this.content,
    required this.warnings,
    required this.sourceType,
    this.requiresManualPaste = false,
    this.sourceUrl,
    this.originalText,
    this.displayedKey,
    this.capo,
  });

  factory SmartChordImportDraft.fromMap(Map<String, dynamic> map) {
    final rawWarnings = map['warnings'] as List<dynamic>? ?? [];
    return SmartChordImportDraft(
      title: map['title'] as String? ?? 'Nova Cifra',
      artistName: (map['artist_name'] ?? map['artistName']) as String?,
      originalKey: (map['original_key'] ?? map['originalKey']) as String?,
      content: map['content'] as String? ?? '',
      warnings: rawWarnings
          .map(
              (w) => ImportWarning.fromMap(Map<String, dynamic>.from(w as Map)))
          .toList(),
      sourceType:
          (map['source_type'] ?? map['sourceType']) as String? ?? 'text',
      requiresManualPaste: (map['requires_manual_paste'] ??
              map['requiresManualPaste']) as bool? ??
          false,
      sourceUrl: (map['source_url'] ?? map['sourceUrl']) as String?,
      originalText: (map['original_text'] ?? map['originalText']) as String?,
      displayedKey: (map['displayed_key'] ?? map['displayedKey']) as String?,
      capo: map['capo'] as int?,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'title': title,
      'artist_name': artistName,
      'original_key': originalKey,
      'content': content,
      'warnings': warnings.map((w) => w.toMap()).toList(),
      'source_type': sourceType,
      'requires_manual_paste': requiresManualPaste,
      'source_url': sourceUrl,
      if (originalText != null) 'original_text': originalText,
      if (displayedKey != null) 'displayed_key': displayedKey,
      if (capo != null) 'capo': capo,
    };
  }

  SmartChordImportDraft copyWith({
    String? title,
    String? artistName,
    String? originalKey,
    String? content,
    List<ImportWarning>? warnings,
    String? sourceType,
    bool? requiresManualPaste,
    String? sourceUrl,
    String? originalText,
    String? displayedKey,
    int? capo,
  }) {
    return SmartChordImportDraft(
      title: title ?? this.title,
      artistName: artistName ?? this.artistName,
      originalKey: originalKey ?? this.originalKey,
      content: content ?? this.content,
      warnings: warnings ?? this.warnings,
      sourceType: sourceType ?? this.sourceType,
      requiresManualPaste: requiresManualPaste ?? this.requiresManualPaste,
      sourceUrl: sourceUrl ?? this.sourceUrl,
      originalText: originalText ?? this.originalText,
      displayedKey: displayedKey ?? this.displayedKey,
      capo: capo ?? this.capo,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SmartChordImportDraft &&
          runtimeType == other.runtimeType &&
          title == other.title &&
          artistName == other.artistName &&
          originalKey == other.originalKey &&
          content == other.content &&
          sourceType == other.sourceType &&
          requiresManualPaste == other.requiresManualPaste &&
          sourceUrl == other.sourceUrl &&
          originalText == other.originalText &&
          displayedKey == other.displayedKey &&
          capo == other.capo &&
          _warningsEqual(warnings, other.warnings);

  @override
  int get hashCode => Object.hash(
        title,
        artistName,
        originalKey,
        content,
        sourceType,
        requiresManualPaste,
        sourceUrl,
        originalText,
        displayedKey,
        capo,
        Object.hashAll(warnings),
      );

  static bool _warningsEqual(List<ImportWarning> a, List<ImportWarning> b) {
    if (a.length != b.length) return false;
    for (var index = 0; index < a.length; index++) {
      if (a[index] != b[index]) return false;
    }
    return true;
  }
}
