import '../../domain/entities/entities.dart';

/// Song model — handles JSON serialization/deserialization
class SongModel {
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
  final String createdAt;
  final String updatedAt;
  final SongSmartChord? smartChord;

  const SongModel({
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

  factory SongModel.fromJson(Map<String, dynamic> json) {
    final artist = json['artist'] as Map<String, dynamic>?;
    final classification = json['classification'] as Map<String, dynamic>?;
    final smartChordJson = json['smart_chord'] as Map<String, dynamic>?;
    final smartChordObj = smartChordJson != null
        ? SongSmartChord(
            id: smartChordJson['id'] as String,
            originalKey: smartChordJson['original_key'] as String,
            content: smartChordJson['content'] as String,
          )
        : null;

    return SongModel(
      id: json['id'] as String,
      ministryId: json['ministry_id'] as String,
      userId: json['user_id'] as String?,
      title: json['title'] as String,
      artistId: json['artist_id'] as String?,
      artistName: artist?['name'] as String?,
      classificationId: json['classification_id'] as String?,
      classificationName: classification?['name'] as String?,
      classificationColor: classification?['color'] as String?,
      originalKey: json['original_key'] as String?,
      bpm: json['bpm'] != null ? (json['bpm'] as num).toDouble() : null,
      duration: json['duration'] as String?,
      lyrics: json['lyrics'] as String?,
      chordSheetUrl: json['chord_sheet_url'] as String?,
      youtubeUrl: json['youtube_url'] as String?,
      audioUrl: json['audio_url'] as String?,
      externalLinks: json['external_links'] != null
          ? Map<String, String>.from(json['external_links'] as Map)
          : null,
      createdAt: json['created_at'] as String,
      updatedAt: json['updated_at'] as String,
      smartChord: smartChordObj,
    );
  }

  Song toEntity() {
    return Song(
      id: id,
      ministryId: ministryId,
      userId: userId,
      title: title,
      artistId: artistId,
      artistName: artistName,
      classificationId: classificationId,
      classificationName: classificationName,
      classificationColor: classificationColor,
      originalKey: originalKey,
      bpm: bpm,
      duration: duration,
      lyrics: lyrics,
      chordSheetUrl: chordSheetUrl,
      youtubeUrl: youtubeUrl,
      audioUrl: audioUrl,
      externalLinks: externalLinks,
      createdAt: DateTime.parse(createdAt),
      updatedAt: DateTime.parse(updatedAt),
      smartChord: smartChord,
    );
  }
}

/// Artist model
class ArtistModel {
  final String id;
  final String ministryId;
  final String name;
  final String createdAt;
  final String updatedAt;

  const ArtistModel({
    required this.id,
    required this.ministryId,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
  });

  factory ArtistModel.fromJson(Map<String, dynamic> json) {
    return ArtistModel(
      id: json['id'] as String,
      ministryId: json['ministry_id'] as String,
      name: json['name'] as String,
      createdAt: json['created_at'] as String,
      updatedAt: json['updated_at'] as String,
    );
  }

  Artist toEntity() {
    return Artist(
      id: id,
      ministryId: ministryId,
      name: name,
      createdAt: DateTime.parse(createdAt),
      updatedAt: DateTime.parse(updatedAt),
    );
  }
}

/// Classification model
class ClassificationModel {
  final String id;
  final String ministryId;
  final String name;
  final String? description;
  final String? color;
  final String createdAt;
  final String updatedAt;

  const ClassificationModel({
    required this.id,
    required this.ministryId,
    required this.name,
    this.description,
    this.color,
    required this.createdAt,
    required this.updatedAt,
  });

  factory ClassificationModel.fromJson(Map<String, dynamic> json) {
    return ClassificationModel(
      id: json['id'] as String,
      ministryId: json['ministry_id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      color: json['color'] as String?,
      createdAt: json['created_at'] as String,
      updatedAt: json['updated_at'] as String,
    );
  }

  Classification toEntity() {
    return Classification(
      id: id,
      ministryId: ministryId,
      name: name,
      description: description,
      color: color,
      createdAt: DateTime.parse(createdAt),
      updatedAt: DateTime.parse(updatedAt),
    );
  }
}

/// Folder model
class FolderModel {
  final String id;
  final String ministryId;
  final String name;
  final String? description;
  final int songCount;
  final List<SongModel> songs;
  final String createdAt;
  final String updatedAt;

  const FolderModel({
    required this.id,
    required this.ministryId,
    required this.name,
    this.description,
    this.songCount = 0,
    this.songs = const [],
    required this.createdAt,
    required this.updatedAt,
  });

  factory FolderModel.fromJson(Map<String, dynamic> json) {
    return FolderModel(
      id: json['id'] as String,
      ministryId: json['ministry_id'] as String,
      name: json['name'] as String,
      description: json['description'] as String?,
      songCount: json['song_count'] as int? ?? 0,
      songs: (json['songs'] as List<dynamic>?)?.map((s) => SongModel.fromJson(s as Map<String, dynamic>)).toList() ?? [],
      createdAt: json['created_at'] as String,
      updatedAt: json['updated_at'] as String,
    );
  }

  Folder toEntity() {
    return Folder(
      id: id,
      ministryId: ministryId,
      name: name,
      description: description,
      songCount: songCount,
      songs: songs.map((s) => s.toEntity()).toList(),
      createdAt: DateTime.parse(createdAt),
      updatedAt: DateTime.parse(updatedAt),
    );
  }
}
