import 'package:flutter/foundation.dart';

/// Representation of a musical artist within a ministry.
@immutable
class Artist {
  final String id;
  final String ministryId;
  final String name;

  const Artist({
    required this.id,
    required this.ministryId,
    required this.name,
  });

  factory Artist.fromJson(Map<String, dynamic> json) {
    return Artist(
      id: json['id']?.toString() ?? '',
      ministryId: json['ministry_id']?.toString() ?? '',
      name: json['name']?.toString() ?? '',
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'ministry_id': ministryId,
        'name': name,
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Artist &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId;

  @override
  int get hashCode => id.hashCode ^ ministryId.hashCode;

  @override
  String toString() => 'Artist(id: $id, name: $name)';
}
