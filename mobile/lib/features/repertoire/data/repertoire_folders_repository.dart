import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/repertoire_folder.dart';

/// Repository for ministry-scoped repertoire folders and artist cleanup.
abstract class RepertoireFoldersRepository {
  Future<List<RepertoireFolder>> listFolders(String ministryId);

  Future<RepertoireFolder> getFolder(String ministryId, String folderId);

  Future<RepertoireFolder> createFolder(
    String ministryId, {
    required String name,
    String? description,
  });

  Future<RepertoireFolder> updateFolder(
    String ministryId,
    String folderId, {
    required String name,
    String? description,
  });

  Future<void> deleteFolder(String ministryId, String folderId);

  Future<void> addSongToFolder(
    String ministryId,
    String folderId,
    String songId,
  );

  Future<void> removeSongFromFolder(
    String ministryId,
    String folderId,
    String songId,
  );

  Future<void> deleteArtist(String ministryId, String artistId);
}

class HttpRepertoireFoldersRepository implements RepertoireFoldersRepository {
  final ApiClient _apiClient;

  HttpRepertoireFoldersRepository({required ApiClient apiClient})
      : _apiClient = apiClient;

  @override
  Future<List<RepertoireFolder>> listFolders(String ministryId) async {
    try {
      final response = await _apiClient.dio.get<dynamic>(
        '/ministries/$ministryId/folders',
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
          .map((m) => RepertoireFolder.fromJson(Map<String, dynamic>.from(m)))
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar pastas: $e');
    }
  }

  @override
  Future<RepertoireFolder> getFolder(String ministryId, String folderId) async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/folders/$folderId',
      );
      final data = response.data;
      if (data == null) {
        throw const AppFailure(message: 'Pasta não encontrada.', statusCode: 404);
      }
      final raw = data['data'] is Map
          ? Map<String, dynamic>.from(data['data'] as Map)
          : data;
      return RepertoireFolder.fromJson(raw);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar pasta: $e');
    }
  }

  @override
  Future<RepertoireFolder> createFolder(
    String ministryId, {
    required String name,
    String? description,
  }) async {
    try {
      final trimmedDesc = description?.trim();
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/folders',
        data: <String, dynamic>{
          'name': name.trim(),
          if (trimmedDesc != null && trimmedDesc.isNotEmpty)
            'description': trimmedDesc,
        },
      );
      final data = response.data;
      if (data == null) {
        throw const AppFailure(message: 'Resposta vazia ao criar pasta.');
      }
      final raw = data['data'] is Map
          ? Map<String, dynamic>.from(data['data'] as Map)
          : data;
      return RepertoireFolder.fromJson(raw);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao criar pasta: $e');
    }
  }

  @override
  Future<RepertoireFolder> updateFolder(
    String ministryId,
    String folderId, {
    required String name,
    String? description,
  }) async {
    try {
      final trimmedDesc = description?.trim();
      final response = await _apiClient.dio.put<Map<String, dynamic>>(
        '/ministries/$ministryId/folders/$folderId',
        data: <String, dynamic>{
          'name': name.trim(),
          'description': trimmedDesc != null && trimmedDesc.isNotEmpty
              ? trimmedDesc
              : null,
        },
      );
      final data = response.data;
      if (data == null) {
        throw const AppFailure(message: 'Resposta vazia ao atualizar pasta.');
      }
      final raw = data['data'] is Map
          ? Map<String, dynamic>.from(data['data'] as Map)
          : data;
      return RepertoireFolder.fromJson(raw);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao atualizar pasta: $e');
    }
  }

  @override
  Future<void> deleteFolder(String ministryId, String folderId) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/folders/$folderId',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao excluir pasta: $e');
    }
  }

  @override
  Future<void> addSongToFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {
    try {
      await _apiClient.dio.post<void>(
        '/ministries/$ministryId/folders/$folderId/songs',
        data: {'song_id': songId},
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao adicionar música à pasta: $e');
    }
  }

  @override
  Future<void> removeSongFromFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/folders/$folderId/songs/$songId',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao remover música da pasta: $e');
    }
  }

  @override
  Future<void> deleteArtist(String ministryId, String artistId) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/artists/$artistId',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao excluir artista: $e');
    }
  }
}
