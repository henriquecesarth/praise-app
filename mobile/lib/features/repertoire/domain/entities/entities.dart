import 'package:equatable/equatable.dart';

/// Song entity — Pure domain object
class Song extends Equatable {
  final String id;
  final String ministryId;
  final String title;
  final String? artistId;
  final String? artistName;
  final String? classificationId;
  final String? classificationName;
  final String? classificationColor;
  final String? originalKey;
  final double? bpm;
  final String? duration;
  final String? lyrics;
  final String? chordSheetUrl;
  final String? youtubeUrl;
  final String? audioUrl;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Song({
    required this.id,
    required this.ministryId,
    required this.title,
    this.artistId,
    this.artistName,
    this.classificationId,
    this.classificationName,
    this.classificationColor,
    this.originalKey,
    this.bpm,
    this.duration,
    this.lyrics,
    this.chordSheetUrl,
    this.youtubeUrl,
    this.audioUrl,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Gets the first letter of the title for avatar display
  String get avatarLetter => title.isNotEmpty ? title[0].toUpperCase() : '?';

  /// Checks if the song has any external links
  bool get hasLinks =>
      (chordSheetUrl?.isNotEmpty ?? false) ||
      (youtubeUrl?.isNotEmpty ?? false) ||
      (audioUrl?.isNotEmpty ?? false);

  /// Checks if the song has a YouTube link
  bool get hasYoutube => youtubeUrl?.isNotEmpty ?? false;

  @override
  List<Object?> get props => [
        id,
        ministryId,
        title,
        artistId,
        classificationId,
        originalKey,
        bpm,
        duration,
        lyrics,
        chordSheetUrl,
        youtubeUrl,
        audioUrl,
        createdAt,
        updatedAt,
      ];
}

/// Artist entity
class Artist extends Equatable {
  final String id;
  final String ministryId;
  final String name;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Artist({
    required this.id,
    required this.ministryId,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
  });

  /// Gets the first letter of the name for avatar display
  String get avatarLetter => name.isNotEmpty ? name[0].toUpperCase() : '?';

  @override
  List<Object?> get props => [id, ministryId, name, createdAt, updatedAt];
}

/// Classification entity (dynamic — can be created/deleted by admins)
class Classification extends Equatable {
  final String id;
  final String ministryId;
  final String name;
  final String? description;
  final String? color;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Classification({
    required this.id,
    required this.ministryId,
    required this.name,
    this.description,
    this.color,
    required this.createdAt,
    required this.updatedAt,
  });

  @override
  List<Object?> get props => [id, ministryId, name, description, color, createdAt, updatedAt];
}

/// Folder entity
class Folder extends Equatable {
  final String id;
  final String ministryId;
  final String name;
  final String? description;
  final int songCount;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Folder({
    required this.id,
    required this.ministryId,
    required this.name,
    this.description,
    this.songCount = 0,
    required this.createdAt,
    required this.updatedAt,
  });

  @override
  List<Object?> get props => [id, ministryId, name, description, songCount, createdAt, updatedAt];
}

/// Repertoire counts for tab badges
class RepertoireCounts extends Equatable {
  final int songs;
  final int folders;
  final int artists;

  const RepertoireCounts({
    this.songs = 0,
    this.folders = 0,
    this.artists = 0,
  });

  @override
  List<Object?> get props => [songs, folders, artists];
}
