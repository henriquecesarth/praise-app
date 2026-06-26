import 'package:dartz/dartz.dart';
import 'package:praise/core/errors/failures.dart';
import 'package:praise/features/repertoire/domain/entities/entities.dart';

/// Filters for song queries
class SongFilters {
  final String? search;
  final String? classificationId;
  final String? originalKey;
  final String? artistId;
  final bool? hasYoutube;
  final int page;
  final int limit;

  const SongFilters({
    this.search,
    this.classificationId,
    this.originalKey,
    this.artistId,
    this.hasYoutube,
    this.page = 1,
    this.limit = 50,
  });

  SongFilters copyWith({
    String? search,
    String? classificationId,
    String? originalKey,
    String? artistId,
    bool? hasYoutube,
    int? page,
    int? limit,
  }) {
    return SongFilters(
      search: search ?? this.search,
      classificationId: classificationId ?? this.classificationId,
      originalKey: originalKey ?? this.originalKey,
      artistId: artistId ?? this.artistId,
      hasYoutube: hasYoutube ?? this.hasYoutube,
      page: page ?? this.page,
      limit: limit ?? this.limit,
    );
  }
}

/// Paginated response wrapper
class PaginatedResult<T> {
  final List<T> data;
  final int total;
  final int page;
  final int limit;
  final int totalPages;

  const PaginatedResult({
    required this.data,
    required this.total,
    required this.page,
    required this.limit,
    required this.totalPages,
  });
}

/// Abstract repository for Song operations
abstract class SongRepository {
  Future<Either<Failure, PaginatedResult<Song>>> getSongs(
    String ministryId,
    SongFilters filters,
  );

  Future<Either<Failure, Song>> getSongById(
    String ministryId,
    String songId,
  );

  Future<Either<Failure, Song>> createSong(
    String ministryId,
    Map<String, dynamic> songData,
  );

  Future<Either<Failure, Song>> updateSong(
    String ministryId,
    String songId,
    Map<String, dynamic> songData,
  );

  Future<Either<Failure, void>> deleteSong(
    String ministryId,
    String songId,
  );
}

/// Abstract repository for Artist operations
abstract class ArtistRepository {
  Future<Either<Failure, List<Artist>>> getArtists(
    String ministryId, {
    String? search,
  });

  Future<Either<Failure, Artist>> createArtist(
    String ministryId,
    String name,
  );

  Future<Either<Failure, Artist>> updateArtist(
    String ministryId,
    String artistId,
    String name,
  );

  Future<Either<Failure, void>> deleteArtist(
    String ministryId,
    String artistId,
  );
}

/// Abstract repository for Classification operations
abstract class ClassificationRepository {
  Future<Either<Failure, List<Classification>>> getClassifications(
    String ministryId,
  );

  Future<Either<Failure, Classification>> createClassification(
    String ministryId,
    Map<String, dynamic> data,
  );

  Future<Either<Failure, Classification>> updateClassification(
    String ministryId,
    String classificationId,
    Map<String, dynamic> data,
  );

  Future<Either<Failure, void>> deleteClassification(
    String ministryId,
    String classificationId,
  );
}

/// Abstract repository for Folder operations
abstract class FolderRepository {
  Future<Either<Failure, List<Folder>>> getFolders(String ministryId);

  Future<Either<Failure, Folder>> createFolder(
    String ministryId,
    String name, {
    String? description,
  });

  Future<Either<Failure, Folder>> updateFolder(
    String ministryId,
    String folderId,
    Map<String, dynamic> data,
  );

  Future<Either<Failure, void>> deleteFolder(
    String ministryId,
    String folderId,
  );

  Future<Either<Failure, void>> addSongToFolder(
    String ministryId,
    String folderId,
    String songId, {
    int? position,
  });

  Future<Either<Failure, void>> removeSongFromFolder(
    String ministryId,
    String folderId,
    String songId,
  );
}

/// Abstract repository for Repertoire counts
abstract class RepertoireCountsRepository {
  Future<Either<Failure, RepertoireCounts>> getCounts(String ministryId);
}
