import 'package:dio/dio.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

abstract class MembersRepository {
  Future<List<MinistryMember>> getMembers(String ministryId);
  Future<List<MinistryRole>> getRoles(String ministryId);
}

class HttpMembersRepository implements MembersRepository {
  final ApiClient _apiClient;

  HttpMembersRepository({required ApiClient apiClient})
      : _apiClient = apiClient;

  @override
  Future<List<MinistryMember>> getMembers(String ministryId) async {
    try {
      final response = await _apiClient.dio.get<List<dynamic>>(
        '/ministries/$ministryId/members',
      );
      final data = response.data;
      if (data == null) return [];
      return data
          .whereType<Map<String, dynamic>>()
          .map(MinistryMember.fromJson)
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar integrantes: $e');
    }
  }

  @override
  Future<List<MinistryRole>> getRoles(String ministryId) async {
    try {
      final response = await _apiClient.dio.get<List<dynamic>>(
        '/ministries/$ministryId/roles',
      );
      final data = response.data;
      if (data == null) return [];
      return data
          .whereType<Map<String, dynamic>>()
          .map(MinistryRole.fromJson)
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar funções: $e');
    }
  }
}
