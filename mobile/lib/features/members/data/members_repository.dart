import 'package:dio/dio.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_role.dart';

abstract class MembersRepository {
  Future<List<MinistryMember>> getMembers(String ministryId);
  Future<List<MinistryRole>> getRoles(String ministryId);
  Future<MinistryMember> getMemberById(String ministryId, String memberId);
  Future<MinistryMember> addMember({
    required String ministryId,
    required String name,
    required String email,
    String role = 'member',
    String? birthDate,
    List<String> roleIds = const [],
  });
  Future<MinistryMember> updateMember({
    required String ministryId,
    required String memberId,
    String? name,
    String? email,
    String? birthDate,
    String? role,
    List<String>? roleIds,
  });
  Future<void> removeMember({
    required String ministryId,
    required String memberId,
  });
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

  @override
  Future<MinistryMember> getMemberById(String ministryId, String memberId) async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/members/$memberId',
      );
      final data = response.data;
      if (data == null) {
        throw const AppFailure(message: 'Integrante não encontrado.');
      }
      return MinistryMember.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao buscar dados do integrante: $e');
    }
  }

  @override
  Future<MinistryMember> addMember({
    required String ministryId,
    required String name,
    required String email,
    String role = 'member',
    String? birthDate,
    List<String> roleIds = const [],
  }) async {
    try {
      final payload = <String, dynamic>{
        'name': name.trim(),
        'email': email.trim().toLowerCase(),
        'role': role,
        if (birthDate != null && birthDate.trim().isNotEmpty)
          'birthDate': birthDate.trim(),
        if (roleIds.isNotEmpty) 'roleIds': roleIds,
      };

      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/members',
        data: payload,
      );

      final data = response.data;
      if (data == null) {
        throw const AppFailure(message: 'Falha ao adicionar integrante.');
      }
      return MinistryMember.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao adicionar integrante: $e');
    }
  }

  @override
  Future<MinistryMember> updateMember({
    required String ministryId,
    required String memberId,
    String? name,
    String? email,
    String? birthDate,
    String? role,
    List<String>? roleIds,
  }) async {
    try {
      final payload = <String, dynamic>{
        if (name != null) 'name': name.trim(),
        if (email != null) 'email': email.trim().toLowerCase(),
        if (birthDate != null) 'birthDate': birthDate.trim().isEmpty ? null : birthDate.trim(),
        if (role != null) 'role': role,
        if (roleIds != null) 'roleIds': roleIds,
      };

      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/ministries/$ministryId/members/$memberId',
        data: payload,
      );

      final data = response.data;
      if (data == null) {
        throw const AppFailure(message: 'Falha ao atualizar dados do integrante.');
      }
      return MinistryMember.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao atualizar dados do integrante: $e');
    }
  }

  @override
  Future<void> removeMember({
    required String ministryId,
    required String memberId,
  }) async {
    try {
      await _apiClient.dio.delete<dynamic>(
        '/ministries/$ministryId/members/$memberId',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao remover integrante: $e');
    }
  }
}
