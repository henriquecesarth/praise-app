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

  const SmartChordImportDraft({
    required this.title,
    this.artistName,
    this.originalKey,
    required this.content,
    required this.warnings,
    required this.sourceType,
  });

  factory SmartChordImportDraft.fromMap(Map<String, dynamic> map) {
    final rawWarnings = map['warnings'] as List<dynamic>? ?? [];
    return SmartChordImportDraft(
      title: map['title'] as String? ?? 'Nova Cifra',
      artistName: (map['artist_name'] ?? map['artistName']) as String?,
      originalKey: (map['original_key'] ?? map['originalKey']) as String?,
      content: map['content'] as String? ?? '',
      warnings: rawWarnings
          .map((w) => ImportWarning.fromMap(Map<String, dynamic>.from(w as Map)))
          .toList(),
      sourceType: (map['source_type'] ?? map['sourceType']) as String? ?? 'text',
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
    };
  }

  SmartChordImportDraft copyWith({
    String? title,
    String? artistName,
    String? originalKey,
    String? content,
    List<ImportWarning>? warnings,
    String? sourceType,
  }) {
    return SmartChordImportDraft(
      title: title ?? this.title,
      artistName: artistName ?? this.artistName,
      originalKey: originalKey ?? this.originalKey,
      content: content ?? this.content,
      warnings: warnings ?? this.warnings,
      sourceType: sourceType ?? this.sourceType,
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
          sourceType == other.sourceType;

  @override
  int get hashCode => Object.hash(title, artistName, originalKey, content, sourceType);
}
