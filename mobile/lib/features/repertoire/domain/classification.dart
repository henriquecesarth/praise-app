import 'package:flutter/material.dart';

/// Lightweight classification model representing a musical genre, theme, or mood.
@immutable
class Classification {
  final String id;
  final String ministryId;
  final String name;
  final String? description;
  final String? color;
  final String? createdAt;
  final String? updatedAt;

  const Classification({
    required this.id,
    required this.ministryId,
    required this.name,
    this.description,
    this.color,
    this.createdAt,
    this.updatedAt,
  });

  factory Classification.fromJson(Map<String, dynamic> json) {
    return Classification(
      id: json['id']?.toString() ?? '',
      ministryId: json['ministry_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      description: json['description']?.toString(),
      color: json['color']?.toString(),
      createdAt: json['created_at']?.toString(),
      updatedAt: json['updated_at']?.toString(),
    );
  }

  /// Parses hex color string (e.g. #7C3AED) safely to a Flutter [Color].
  Color? get displayColor => parseHexColor(color);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Classification &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId;

  @override
  int get hashCode => id.hashCode ^ ministryId.hashCode;
}

/// Embedded classification reference found on song items.
@immutable
class SongClassificationRef {
  final String id;
  final String name;
  final String? color;

  const SongClassificationRef({
    required this.id,
    required this.name,
    this.color,
  });

  factory SongClassificationRef.fromJson(Map<String, dynamic> json) {
    return SongClassificationRef(
      id: json['id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
      color: json['color']?.toString(),
    );
  }

  Color? get displayColor => parseHexColor(color);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is SongClassificationRef &&
          runtimeType == other.runtimeType &&
          id == other.id;

  @override
  int get hashCode => id.hashCode;
}

/// Helper function to parse hex string into [Color].
Color? parseHexColor(String? hexString) {
  if (hexString == null || hexString.isEmpty) return null;
  String clean = hexString.trim();
  if (clean.startsWith('#')) {
    clean = clean.substring(1);
  }
  if (clean.length == 6) {
    clean = 'FF$clean';
  } else if (clean.length != 8) {
    return null;
  }
  final value = int.tryParse(clean, radix: 16);
  return value != null ? Color(value) : null;
}
