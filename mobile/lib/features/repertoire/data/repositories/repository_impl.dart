import 'package:dartz/dartz.dart';
import 'package:praise/core/errors/failures.dart';
import 'package:praise/features/repertoire/domain/entities/entities.dart';
import 'package:praise/features/repertoire/domain/repositories/repositories.dart';
import 'package:praise/features/repertoire/data/datasources/remote_datasource.dart';
import 'package:praise/features/repertoire/data/models/models.dart';

/// Concrete implementation of SongRepository
class SongRepositoryImpl implements SongRepository {
  final RepertoireRemoteDataSource _dataSource;

  SongRepositoryImpl(this._dataSource);

  @override
  Future<Either<Failure, PaginatedResult<Song>>> getSongs(
    String ministryId,
    SongFilters filters,
  ) async {
    try {
      final response = await _dataSource.getSongs(
        ministryId,
        search: filters.search,
        classificationId: filters.classificationId,
        originalKey: filters.originalKey,
        artistId: filters.artistId,
        hasYoutube: filters.hasYoutube,
        page: filters.page,
        limit: filters.limit,
      );

      final songs = (response['data'] as List)
          .map((json) => SongModel.fromJson(json as Map<String, dynamic>).toEntity())
          .toList();

      return Right(PaginatedResult(
        data: songs,
        total: response['total'] as int? ?? 0,
        page: response['page'] as int? ?? 1,
        limit: response['limit'] as int? ?? 50,
        totalPages: response['totalPages'] as int? ?? 1,
      ));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Song>> getSongById(
    String ministryId,
    String songId,
  ) async {
    try {
      final response = await _dataSource.getSongById(ministryId, songId);
      final song = SongModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(song);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Song>> createSong(
    String ministryId,
    Map<String, dynamic> songData,
  ) async {
    try {
      final response = await _dataSource.createSong(ministryId, songData);
      final song = SongModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(song);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Song>> updateSong(
    String ministryId,
    String songId,
    Map<String, dynamic> songData,
  ) async {
    try {
      final response = await _dataSource.updateSong(ministryId, songId, songData);
      final song = SongModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(song);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> deleteSong(
    String ministryId,
    String songId,
  ) async {
    try {
      await _dataSource.deleteSong(ministryId, songId);
      return const Right(null);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}

/// Concrete implementation of ArtistRepository
class ArtistRepositoryImpl implements ArtistRepository {
  final RepertoireRemoteDataSource _dataSource;

  ArtistRepositoryImpl(this._dataSource);

  @override
  Future<Either<Failure, List<Artist>>> getArtists(
    String ministryId, {
    String? search,
  }) async {
    try {
      final response = await _dataSource.getArtists(ministryId, search: search);
      final artists = (response['data'] as List)
          .map((json) => ArtistModel.fromJson(json as Map<String, dynamic>).toEntity())
          .toList();
      return Right(artists);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Artist>> createArtist(
    String ministryId,
    String name,
  ) async {
    try {
      final response = await _dataSource.createArtist(ministryId, name);
      final artist = ArtistModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(artist);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Artist>> updateArtist(
    String ministryId,
    String artistId,
    String name,
  ) async {
    try {
      final response = await _dataSource.updateArtist(ministryId, artistId, name);
      final artist = ArtistModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(artist);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> deleteArtist(
    String ministryId,
    String artistId,
  ) async {
    try {
      await _dataSource.deleteArtist(ministryId, artistId);
      return const Right(null);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}

/// Concrete implementation of ClassificationRepository
class ClassificationRepositoryImpl implements ClassificationRepository {
  final RepertoireRemoteDataSource _dataSource;

  ClassificationRepositoryImpl(this._dataSource);

  @override
  Future<Either<Failure, List<Classification>>> getClassifications(
    String ministryId,
  ) async {
    try {
      final response = await _dataSource.getClassifications(ministryId);
      final classifications = (response['data'] as List)
          .map((json) => ClassificationModel.fromJson(json as Map<String, dynamic>).toEntity())
          .toList();
      return Right(classifications);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Classification>> createClassification(
    String ministryId,
    Map<String, dynamic> data,
  ) async {
    try {
      final response = await _dataSource.createClassification(ministryId, data);
      final classification =
          ClassificationModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(classification);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Classification>> updateClassification(
    String ministryId,
    String classificationId,
    Map<String, dynamic> data,
  ) async {
    try {
      final response =
          await _dataSource.updateClassification(ministryId, classificationId, data);
      final classification =
          ClassificationModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(classification);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> deleteClassification(
    String ministryId,
    String classificationId,
  ) async {
    try {
      await _dataSource.deleteClassification(ministryId, classificationId);
      return const Right(null);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}

/// Concrete implementation of FolderRepository
class FolderRepositoryImpl implements FolderRepository {
  final RepertoireRemoteDataSource _dataSource;

  FolderRepositoryImpl(this._dataSource);

  @override
  Future<Either<Failure, List<Folder>>> getFolders(String ministryId) async {
    try {
      final response = await _dataSource.getFolders(ministryId);
      final folders = (response['data'] as List)
          .map((json) => FolderModel.fromJson(json as Map<String, dynamic>).toEntity())
          .toList();
      return Right(folders);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Folder>> getFolderById(String ministryId, String folderId) async {
    try {
      final response = await _dataSource.getFolderById(ministryId, folderId);
      final data = response['data'] ?? response;
      final folder = FolderModel.fromJson(data as Map<String, dynamic>).toEntity();
      return Right(folder);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Folder>> createFolder(
    String ministryId,
    String name, {
    String? description,
  }) async {
    try {
      final response =
          await _dataSource.createFolder(ministryId, name, description: description);
      final folder = FolderModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(folder);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, Folder>> updateFolder(
    String ministryId,
    String folderId,
    Map<String, dynamic> data,
  ) async {
    try {
      final response = await _dataSource.updateFolder(ministryId, folderId, data);
      final folder = FolderModel.fromJson(response['data'] as Map<String, dynamic>).toEntity();
      return Right(folder);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> deleteFolder(
    String ministryId,
    String folderId,
  ) async {
    try {
      await _dataSource.deleteFolder(ministryId, folderId);
      return const Right(null);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> addSongToFolder(
    String ministryId,
    String folderId,
    String songId, {
    int? position,
  }) async {
    try {
      await _dataSource.addSongToFolder(ministryId, folderId, songId, position: position);
      return const Right(null);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }

  @override
  Future<Either<Failure, void>> removeSongFromFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {
    try {
      await _dataSource.removeSongFromFolder(ministryId, folderId, songId);
      return const Right(null);
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}

/// Concrete implementation of RepertoireCountsRepository
class RepertoireCountsRepositoryImpl implements RepertoireCountsRepository {
  final RepertoireRemoteDataSource _dataSource;

  RepertoireCountsRepositoryImpl(this._dataSource);

  @override
  Future<Either<Failure, RepertoireCounts>> getCounts(String ministryId) async {
    try {
      final response = await _dataSource.getCounts(ministryId);
      final data = response['data'] as Map<String, dynamic>;
      return Right(RepertoireCounts(
        songs: data['songs'] as int? ?? 0,
        folders: data['folders'] as int? ?? 0,
        artists: data['artists'] as int? ?? 0,
      ));
    } catch (e) {
      return Left(ServerFailure(message: e.toString()));
    }
  }
}
