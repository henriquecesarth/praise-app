import 'package:flutter/foundation.dart';
import 'song_summary.dart';

/// Paginated envelope for song listing, matching backend PaginatedResponse<SongSummary>.
@immutable
class PaginatedSongs {
  final List<SongSummary> songs;
  final int total;
  final String? nextCursor;
  final bool hasMore;
  final int limit;
  final int? page;
  final int? totalPages;

  const PaginatedSongs({
    required this.songs,
    required this.total,
    this.nextCursor,
    this.hasMore = false,
    this.limit = 20,
    this.page,
    this.totalPages,
  });

  factory PaginatedSongs.fromJson(Map<String, dynamic> json) {
    final list = <SongSummary>[];
    final rawData = json['data'];
    if (rawData is List) {
      for (final item in rawData) {
        if (item is Map<String, dynamic>) {
          list.add(SongSummary.fromJson(item));
        } else if (item is Map) {
          list.add(SongSummary.fromJson(Map<String, dynamic>.from(item)));
        }
      }
    }

    return PaginatedSongs(
      songs: list,
      total: (json['total'] as num?)?.toInt() ?? list.length,
      nextCursor: json['nextCursor']?.toString(),
      hasMore: json['hasMore'] == true,
      limit: (json['limit'] as num?)?.toInt() ?? 20,
      page: (json['page'] as num?)?.toInt(),
      totalPages: (json['totalPages'] as num?)?.toInt(),
    );
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is PaginatedSongs &&
          runtimeType == other.runtimeType &&
          listEquals(songs, other.songs) &&
          total == other.total &&
          nextCursor == other.nextCursor &&
          hasMore == other.hasMore &&
          limit == other.limit &&
          page == other.page &&
          totalPages == other.totalPages;

  @override
  int get hashCode =>
      Object.hashAll(songs) ^
      total.hashCode ^
      nextCursor.hashCode ^
      hasMore.hashCode ^
      limit.hashCode ^
      page.hashCode ^
      totalPages.hashCode;
}
