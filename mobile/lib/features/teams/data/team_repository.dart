import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/team.dart';

abstract class TeamRepository {
  Future<List<Team>> getTeams(String ministryId);
  Future<Team> getTeamById(String ministryId, String teamId);
  Future<Team> createTeam(
    String ministryId, {
    required String name,
    String? description,
    List<String>? memberIds,
  });
  Future<Team> updateTeam(
    String ministryId,
    String teamId, {
    String? name,
    String? description,
    List<String>? memberIds,
  });
  Future<void> deleteTeam(String ministryId, String teamId);
}

class HttpTeamRepository implements TeamRepository {
  final ApiClient _apiClient;

  HttpTeamRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  @override
  Future<List<Team>> getTeams(String ministryId) async {
    try {
      final response = await _apiClient.dio.get<List<dynamic>>(
        '/ministries/$ministryId/teams',
      );
      final data = response.data ?? [];
      return data
          .whereType<Map<String, dynamic>>()
          .map((item) => Team.fromJson(item))
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<Team> getTeamById(String ministryId, String teamId) async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/teams/$teamId',
      );
      if (response.data == null) {
        throw const AppFailure(
          message: 'Equipe não encontrada.',
          statusCode: 404,
        );
      }
      return Team.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<Team> createTeam(
    String ministryId, {
    required String name,
    String? description,
    List<String>? memberIds,
  }) async {
    try {
      final payload = <String, dynamic>{
        'name': name.trim(),
        if (description != null && description.trim().isNotEmpty)
          'description': description.trim(),
        'memberIds': memberIds ?? [],
      };

      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/teams',
        data: payload,
      );

      if (response.data == null) {
        throw const AppFailure(message: 'Resposta vazia ao criar equipe.');
      }
      return Team.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<Team> updateTeam(
    String ministryId,
    String teamId, {
    String? name,
    String? description,
    List<String>? memberIds,
  }) async {
    try {
      final payload = <String, dynamic>{
        if (name != null) 'name': name.trim(),
        if (description != null)
          'description':
              description.trim().isEmpty ? null : description.trim(),
        if (memberIds != null) 'memberIds': memberIds,
      };

      final response = await _apiClient.dio.put<Map<String, dynamic>>(
        '/ministries/$ministryId/teams/$teamId',
        data: payload,
      );

      if (response.data == null) {
        throw const AppFailure(message: 'Resposta vazia ao atualizar equipe.');
      }
      return Team.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<void> deleteTeam(String ministryId, String teamId) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/teams/$teamId',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }
}
