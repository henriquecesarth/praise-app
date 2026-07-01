import 'package:equatable/equatable.dart';

class SmartChord extends Equatable {
  final String id;
  final String userId;
  final String title;
  final String? artistId;
  final String? artistName;
  final String? songId;
  final String originalKey;
  final String content;
  final DateTime createdAt;
  final DateTime updatedAt;

  const SmartChord({
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

  @override
  List<Object?> get props => [
        id,
        userId,
        title,
        artistId,
        artistName,
        songId,
        originalKey,
        content,
        createdAt,
        updatedAt,
      ];
}
