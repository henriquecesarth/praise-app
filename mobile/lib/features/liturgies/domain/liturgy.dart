import 'package:flutter/foundation.dart';
import '../../repertoire/domain/song_summary.dart';

enum LiturgyItemType {
  song,
  reading,
  prayer,
  custom;

  static LiturgyItemType fromString(String? value) {
    switch (value?.toLowerCase()) {
      case 'reading':
      case 'leitura':
        return LiturgyItemType.reading;
      case 'prayer':
      case 'oracao':
      case 'oração':
        return LiturgyItemType.prayer;
      case 'custom':
      case 'personalizado':
        return LiturgyItemType.custom;
      case 'song':
      case 'musica':
      case 'música':
      default:
        return LiturgyItemType.song;
    }
  }

  String get label {
    switch (this) {
      case LiturgyItemType.song:
        return 'Música';
      case LiturgyItemType.reading:
        return 'Leitura';
      case LiturgyItemType.prayer:
        return 'Oração';
      case LiturgyItemType.custom:
        return 'Personalizado';
    }
  }

  String get value {
    switch (this) {
      case LiturgyItemType.song:
        return 'song';
      case LiturgyItemType.reading:
        return 'reading';
      case LiturgyItemType.prayer:
        return 'prayer';
      case LiturgyItemType.custom:
        return 'custom';
    }
  }
}

@immutable
class LiturgyItem {
  final String id;
  final String liturgyId;
  final String? songId;
  final SongSummary? song;
  final LiturgyItemType type;
  final String title;
  final String? notes;
  final int position;

  const LiturgyItem({
    this.id = '',
    this.liturgyId = '',
    this.songId,
    this.song,
    this.type = LiturgyItemType.song,
    required this.title,
    this.notes,
    this.position = 0,
  });

  bool get isSong => type == LiturgyItemType.song;
  String? get songTitle => song?.title;
  String? get songArtist => song?.artistName;

  factory LiturgyItem.fromJson(Map<String, dynamic> json) {
    SongSummary? song;
    if (json['song'] is Map<String, dynamic>) {
      song = SongSummary.fromJson(json['song'] as Map<String, dynamic>);
    } else if (json['song'] is Map) {
      song = SongSummary.fromJson(Map<String, dynamic>.from(json['song'] as Map));
    }

    return LiturgyItem(
      id: json['id']?.toString() ?? '',
      liturgyId: json['liturgy_id']?.toString() ?? json['liturgyId']?.toString() ?? '',
      songId: json['song_id']?.toString() ?? json['songId']?.toString(),
      song: song,
      type: LiturgyItemType.fromString(json['type']?.toString()),
      title: json['title']?.toString() ?? '',
      notes: json['notes']?.toString(),
      position: (json['position'] is num) ? (json['position'] as num).toInt() : 0,
    );
  }

  Map<String, dynamic> toJson() {
    final isSong = type == LiturgyItemType.song;
    return {
      'id': id,
      'liturgy_id': liturgyId,
      'song_id': isSong ? songId : null,
      'type': type.value,
      'title': title,
      'notes': notes,
      'position': position,
    };
  }

  LiturgyItem copyWith({
    String? id,
    String? liturgyId,
    String? songId,
    SongSummary? song,
    LiturgyItemType? type,
    String? title,
    String? notes,
    int? position,
  }) {
    return LiturgyItem(
      id: id ?? this.id,
      liturgyId: liturgyId ?? this.liturgyId,
      songId: songId ?? this.songId,
      song: song ?? this.song,
      type: type ?? this.type,
      title: title ?? this.title,
      notes: notes ?? this.notes,
      position: position ?? this.position,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is LiturgyItem &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          liturgyId == other.liturgyId &&
          songId == other.songId &&
          type == other.type &&
          title == other.title &&
          notes == other.notes &&
          position == other.position;

  @override
  int get hashCode =>
      id.hashCode ^
      liturgyId.hashCode ^
      songId.hashCode ^
      type.hashCode ^
      title.hashCode ^
      notes.hashCode ^
      position.hashCode;
}

@immutable
class Liturgy {
  final String id;
  final String ministryId;
  final String title;
  final String date;
  final String? description;
  final String? createdBy;
  final List<LiturgyItem> items;
  final int? explicitItemCount;
  final int? explicitSongCount;
  final String? createdAt;
  final String? updatedAt;

  const Liturgy({
    required this.id,
    required this.ministryId,
    required this.title,
    required this.date,
    this.description,
    this.createdBy,
    this.items = const [],
    this.explicitItemCount,
    this.explicitSongCount,
    this.createdAt,
    this.updatedAt,
  });

  int get songCount => explicitSongCount ?? items.where((it) => it.isSong).length;
  int get itemCount => explicitItemCount ?? items.length;

  DateTime? get parsedDate {
    try {
      return DateTime.parse(date);
    } catch (_) {
      return null;
    }
  }

  String get formattedDate {
    final d = parsedDate;
    if (d == null) return date;
    final day = d.day.toString().padLeft(2, '0');
    final month = d.month.toString().padLeft(2, '0');
    final year = d.year.toString();
    return '$day/$month/$year';
  }

  factory Liturgy.fromJson(Map<String, dynamic> json) {
    final rawItems = json['liturgy_items'] ?? json['items'];
    final itemsList = <LiturgyItem>[];
    if (rawItems is List) {
      for (final raw in rawItems) {
        if (raw is Map<String, dynamic>) {
          itemsList.add(LiturgyItem.fromJson(raw));
        } else if (raw is Map) {
          itemsList.add(LiturgyItem.fromJson(Map<String, dynamic>.from(raw)));
        }
      }
    }
    itemsList.sort((a, b) => a.position.compareTo(b.position));

    final explicitItemCount = (json['item_count'] is num)
        ? (json['item_count'] as num).toInt()
        : null;
    final explicitSongCount = (json['song_count'] is num)
        ? (json['song_count'] as num).toInt()
        : null;

    return Liturgy(
      id: json['id']?.toString() ?? '',
      ministryId: json['ministry_id']?.toString() ?? json['group_id']?.toString() ?? json['ministryId']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      date: json['date']?.toString() ?? '',
      description: json['description']?.toString(),
      createdBy: json['created_by']?.toString() ?? json['createdBy']?.toString(),
      items: itemsList,
      explicitItemCount: explicitItemCount,
      explicitSongCount: explicitSongCount,
      createdAt: json['created_at']?.toString() ?? json['createdAt']?.toString(),
      updatedAt: json['updated_at']?.toString() ?? json['updatedAt']?.toString(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'ministry_id': ministryId,
      'title': title,
      'date': date,
      'description': description,
      'created_by': createdBy,
      'items': items.map((it) => it.toJson()).toList(),
      'created_at': createdAt,
      'updated_at': updatedAt,
    };
  }

  Liturgy copyWith({
    String? id,
    String? ministryId,
    String? title,
    String? date,
    String? description,
    String? createdBy,
    List<LiturgyItem>? items,
    String? createdAt,
    String? updatedAt,
  }) {
    return Liturgy(
      id: id ?? this.id,
      ministryId: ministryId ?? this.ministryId,
      title: title ?? this.title,
      date: date ?? this.date,
      description: description ?? this.description,
      createdBy: createdBy ?? this.createdBy,
      items: items ?? this.items,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is Liturgy &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          ministryId == other.ministryId &&
          title == other.title &&
          date == other.date &&
          description == other.description &&
          listEquals(items, other.items);

  @override
  int get hashCode =>
      id.hashCode ^
      ministryId.hashCode ^
      title.hashCode ^
      date.hashCode ^
      description.hashCode ^
      items.hashCode;
}
