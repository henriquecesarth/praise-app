import '../../domain/entities/smart_chord_entity.dart';

class SmartChordModel {
  final String id;
  final String userId;
  final String title;
  final String? artistId;
  final String? artistName;
  final String? songId;
  final String originalKey;
  final String content;
  final String createdAt;
  final String updatedAt;

  const SmartChordModel({
    required this.id,
    required this.userId,
    required this.title,
    this.artistId,
    this.artistName,
    this.songId,
    required this.originalKey,
    required this.content,
    required this.createdAt,
    required this.updatedAt,
  });

  factory SmartChordModel.fromJson(Map<String, dynamic> json) {
    final artistJson = json['artist'] as Map<String, dynamic>?;
    return SmartChordModel(
      id: json['id'] as String,
      userId: json['user_id'] as String,
      title: json['title'] as String,
      artistId: json['artist_id'] as String?,
      artistName: artistJson != null ? artistJson['name'] as String? : null,
      songId: json['song_id'] as String?,
      originalKey: json['original_key'] as String,
      content: json['content'] as String,
      createdAt: json['created_at'] as String,
      updatedAt: json['updated_at'] as String,
    );
  }

  SmartChord toEntity() {
    return SmartChord(
      id: id,
      userId: userId,
      title: title,
      artistId: artistId,
      artistName: artistName,
      songId: songId,
      originalKey: originalKey,
      content: content,
      createdAt: DateTime.parse(createdAt),
      updatedAt: DateTime.parse(updatedAt),
    );
  }
}
