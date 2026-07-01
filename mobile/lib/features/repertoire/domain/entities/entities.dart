import 'package:equatable/equatable.dart';

class SongSmartChord {
  final String id;
  final String originalKey;
  final String content;

  const SongSmartChord({
    required this.id,
    required this.originalKey,
    required this.content,
  });
}

/// Song entity — Pure domain object
class Song extends Equatable {
  final String id;
  final String ministryId;
  final String? userId;
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
  final Map<String, String>? externalLinks;
  final DateTime createdAt;
  final DateTime updatedAt;
  final SongSmartChord? smartChord;

  const Song({
    required this.id,
    required this.ministryId,
    this.userId,
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
    this.externalLinks,
    required this.createdAt,
    required this.updatedAt,
    this.smartChord,
  });

  /// Gets the first letter of the title for avatar display
  String get avatarLetter => title.isNotEmpty ? title[0].toUpperCase() : '?';

  /// Checks if the song has any external links
  bool get hasLinks =>
      (chordSheetUrl?.isNotEmpty ?? false) ||
      (youtubeUrl?.isNotEmpty ?? false) ||
      (audioUrl?.isNotEmpty ?? false) ||
      (externalLinks?.isNotEmpty ?? false);

  /// Checks if the song has a YouTube link
  bool get hasYoutube => youtubeUrl?.isNotEmpty ?? false;

  @override
  List<Object?> get props => [
        id,
        ministryId,
        userId,
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
        externalLinks,
        createdAt,
        updatedAt,
        smartChord,
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
  final List<Song> songs;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Folder({
    required this.id,
    required this.ministryId,
    required this.name,
    this.description,
    this.songCount = 0,
    this.songs = const [],
    required this.createdAt,
    required this.updatedAt,
  });

  @override
  List<Object?> get props => [id, ministryId, name, description, songCount, songs, createdAt, updatedAt];
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
