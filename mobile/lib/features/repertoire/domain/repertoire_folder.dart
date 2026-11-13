import 'song_summary.dart';

/// Represents a repertoire folder belonging to a ministry.
class RepertoireFolder {
  final String id;
  final String ministryId;
  final String name;
  final String? description;
  final int songCount;
  final List<SongSummary> songs;

  const RepertoireFolder({
    required this.id,
    required this.ministryId,
    required this.name,
    this.description,
    this.songCount = 0,
    this.songs = const [],
  });

  factory RepertoireFolder.fromJson(Map<String, dynamic> json) {
    final rawSongs = json['songs'];
    final parsedSongs = rawSongs is List
        ? rawSongs
            .whereType<Map>()
            .map((m) => SongSummary.fromJson(Map<String, dynamic>.from(m)))
            .toList()
        : const <SongSummary>[];

    final rawCount = json['song_count'] ?? json['songCount'];
    final int count;
    if (rawCount is int) {
      count = rawCount;
    } else if (rawCount is num) {
      count = rawCount.toInt();
    } else {
      count = parsedSongs.length;
    }

    final rawDesc = json['description']?.toString().trim();

    return RepertoireFolder(
      id: (json['id'] ?? '').toString(),
      ministryId: (json['ministry_id'] ?? json['ministryId'] ?? '').toString(),
      name: (json['name'] ?? 'Pasta sem nome').toString(),
      description: rawDesc != null && rawDesc.isNotEmpty ? rawDesc : null,
      songCount: count,
      songs: parsedSongs,
    );
  }

  RepertoireFolder copyWith({
    String? id,
    String? ministryId,
    String? name,
    String? description,
    int? songCount,
    List<SongSummary>? songs,
  }) {
    return RepertoireFolder(
      id: id ?? this.id,
      ministryId: ministryId ?? this.ministryId,
      name: name ?? this.name,
      description: description ?? this.description,
      songCount: songCount ?? this.songCount,
      songs: songs ?? this.songs,
    );
  }
}
