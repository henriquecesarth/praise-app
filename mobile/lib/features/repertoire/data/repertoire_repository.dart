import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/classification.dart';
import '../domain/paginated_songs.dart';
import '../domain/song_detail.dart';

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
}
