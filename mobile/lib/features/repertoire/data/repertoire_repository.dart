import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/artist.dart';
import '../domain/classification.dart';
import '../domain/paginated_songs.dart';
import '../domain/song_detail.dart';
import '../domain/song_form_data.dart';

/// Data access contract for repertoire endpoints.
abstract class RepertoireRepository {
  /// Lists songs for [ministryId] with optional search, classification filter, and cursor/page pagination.
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  });

  /// Fetches authoritative song detail keyed by [ministryId] and [songId].
  Future<SongDetail> getSongDetail(String ministryId, String songId);

  /// Lists available classifications for filtering within [ministryId].
  Future<List<Classification>> listClassifications(String ministryId);

  /// Creates a new song in [ministryId].
  Future<SongDetail> createSong(String ministryId, SongFormData data);

  /// Updates an existing song in [ministryId] by [songId].
  Future<SongDetail> updateSong(String ministryId, String songId, SongFormData data);

  /// Deletes a song from [ministryId] by [songId].
  Future<void> deleteSong(String ministryId, String songId);

  /// Lists artists within [ministryId] with optional search query.
  Future<List<Artist>> listArtists(String ministryId, {String? search});

  /// Creates a new artist within [ministryId].
  Future<Artist> createArtist(String ministryId, String name);
}

class HttpRepertoireRepository implements RepertoireRepository {
  final ApiClient _apiClient;

  HttpRepertoireRepository({required ApiClient apiClient})
      : _apiClient = apiClient;

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async {
    try {
      final queryParams = <String, dynamic>{};
      if (search != null && search.trim().isNotEmpty) {
        queryParams['search'] = search.trim();
      }
      if (classificationId != null && classificationId.trim().isNotEmpty) {
        queryParams['classification_id'] = classificationId.trim();
      }
      if (cursor != null && cursor.trim().isNotEmpty) {
        queryParams['cursor'] = cursor.trim();
      }
      if (page != null) {
        queryParams['page'] = page.toString();
      }
      if (limit != null) {
        queryParams['limit'] = limit.toString();
      }

      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/songs',
        queryParameters: queryParams,
      );

      final data = response.data;
      if (data == null) {
        return const PaginatedSongs(songs: [], total: 0);
      }

      return PaginatedSongs.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar repertório: $e');
    }
  }

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/songs/$songId',
      );

      final data = response.data;
      if (data == null) {
        throw const AppFailure(
          message: 'Música não encontrada.',
          statusCode: 404,
        );
      }

      final rawSong = data['data'] is Map<String, dynamic>
          ? data['data'] as Map<String, dynamic>
          : (data['data'] is Map
              ? Map<String, dynamic>.from(data['data'] as Map)
              : data);

      return SongDetail.fromJson(rawSong);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar detalhe da música: $e');
    }
  }

  @override
  Future<List<Classification>> listClassifications(String ministryId) async {
    try {
      final response = await _apiClient.dio.get<dynamic>(
        '/ministries/$ministryId/classifications',
      );

      final data = response.data;
      if (data == null) return [];

      List<dynamic> rawList = [];
      if (data is Map && data['data'] is List) {
        rawList = data['data'] as List;
      } else if (data is List) {
        rawList = data;
      }

      return rawList
          .whereType<Map>()
          .map((m) => Classification.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar classificações: $e');
    }
  }

  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/songs',
        data: data.toJson(),
      );

      final resData = response.data;
      if (resData == null) {
        throw const AppFailure(message: 'Resposta vazia ao criar música.');
      }

      final rawSong = resData['data'] is Map<String, dynamic>
          ? resData['data'] as Map<String, dynamic>
          : (resData['data'] is Map
              ? Map<String, dynamic>.from(resData['data'] as Map)
              : resData);

      return SongDetail.fromJson(rawSong);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao cadastrar música: $e');
    }
  }

  @override
  Future<SongDetail> updateSong(
    String ministryId,
    String songId,
    SongFormData data,
  ) async {
    try {
      final response = await _apiClient.dio.put<Map<String, dynamic>>(
        '/ministries/$ministryId/songs/$songId',
        data: data.toJson(),
      );

      final resData = response.data;
      if (resData == null) {
        throw const AppFailure(message: 'Resposta vazia ao atualizar música.');
      }

      final rawSong = resData['data'] is Map<String, dynamic>
          ? resData['data'] as Map<String, dynamic>
          : (resData['data'] is Map
              ? Map<String, dynamic>.from(resData['data'] as Map)
              : resData);

      return SongDetail.fromJson(rawSong);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao atualizar música: $e');
    }
  }

  @override
  Future<void> deleteSong(String ministryId, String songId) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/songs/$songId',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao excluir música: $e');
    }
  }

  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (search != null && search.trim().isNotEmpty) {
        queryParams['search'] = search.trim();
      }

      final response = await _apiClient.dio.get<dynamic>(
        '/ministries/$ministryId/artists',
        queryParameters: queryParams,
      );

      final data = response.data;
      if (data == null) return [];

      List<dynamic> rawList = [];
      if (data is Map && data['data'] is List) {
        rawList = data['data'] as List;
      } else if (data is List) {
        rawList = data;
      }

      return rawList
          .whereType<Map>()
          .map((m) => Artist.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar artistas: $e');
    }
  }

  @override
  Future<Artist> createArtist(String ministryId, String name) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/artists',
        data: {'name': name.trim()},
      );

      final resData = response.data;
      if (resData == null) {
        throw const AppFailure(message: 'Resposta vazia ao criar artista.');
      }

      final rawArtist = resData['data'] is Map<String, dynamic>
          ? resData['data'] as Map<String, dynamic>
          : (resData['data'] is Map
              ? Map<String, dynamic>.from(resData['data'] as Map)
              : resData);

      return Artist.fromJson(rawArtist);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao cadastrar artista: $e');
    }
  }
}
