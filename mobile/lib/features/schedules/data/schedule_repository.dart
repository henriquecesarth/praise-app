import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/ministry_member.dart';
import '../domain/ministry_role.dart';
import '../domain/schedule.dart';
import '../domain/schedule_comment.dart';

/// Data access layer for schedule-related backend endpoints.
abstract class ScheduleRepository {
  /// Lists all schedules for [ministryId].
  /// Backend sorts descending by date; filtering into upcoming/past is done on the client.
  Future<List<ScheduleSummary>> listSchedules(String ministryId);

  /// Fetches full schedule detail keyed by [ministryId] + [scheduleId].
  Future<ScheduleDetail> getScheduleDetail(
      String ministryId, String scheduleId);

  /// Confirms or declines own participation.
  /// Body: { "confirmed": bool }.
  /// Returns authoritative server state of the updated schedule.
  Future<ScheduleDetail> confirmParticipation(
      String ministryId, String scheduleId, bool confirmed);

  /// Loads first page of comments (chronological ascending).
  Future<List<ScheduleComment>> getComments(
      String ministryId, String scheduleId);

  /// Posts a comment (1–1000 chars). Returns HTTP 201 ScheduleComment.
  Future<ScheduleComment> postComment(
      String ministryId, String scheduleId, String content);

  /// Creates a new schedule for [ministryId]. Requires admin role.
  /// Returns the newly created ScheduleDetail.
  Future<ScheduleDetail> createSchedule(
      String ministryId, Map<String, dynamic> data);

  /// Updates an existing schedule. Requires admin role.
  /// Returns the updated ScheduleDetail.
  Future<ScheduleDetail> updateSchedule(
      String ministryId, String scheduleId, Map<String, dynamic> data);

  /// Lists all members of [ministryId] available to be scheduled.
  Future<List<MinistryMember>> getMinistryMembers(String ministryId);

  /// Lists all musical/ministerial roles defined for [ministryId].
  Future<List<MinistryRole>> getMinistryRoles(String ministryId);
}

class HttpScheduleRepository implements ScheduleRepository {
  final ApiClient _apiClient;

  HttpScheduleRepository({required ApiClient apiClient})
      : _apiClient = apiClient;

  @override
  Future<List<ScheduleSummary>> listSchedules(String ministryId) async {
    try {
      final response = await _apiClient.dio.get<List<dynamic>>(
        '/ministries/$ministryId/schedules',
      );
      final data = response.data;
      if (data == null) return [];
      return data
          .whereType<Map<String, dynamic>>()
          .map(ScheduleSummary.fromJson)
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar escalas: $e');
    }
  }

  @override
  Future<ScheduleDetail> getScheduleDetail(
      String ministryId, String scheduleId) async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/schedules/$scheduleId',
      );
      final data = response.data;
      if (data == null) {
        throw const AppFailure(
            message: 'Escala não encontrada.', statusCode: 404);
      }
      return ScheduleDetail.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar detalhe da escala: $e');
    }
  }

  @override
  Future<ScheduleDetail> confirmParticipation(
      String ministryId, String scheduleId, bool confirmed) async {
    try {
      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/ministries/$ministryId/schedules/$scheduleId/confirmation',
        data: {'confirmed': confirmed},
      );
      final data = response.data;
      if (data == null) {
        throw const AppFailure(
            message: 'Resposta inesperada do servidor ao confirmar presença.');
      }
      return ScheduleDetail.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao confirmar presença: $e');
    }
  }

  @override
  Future<List<ScheduleComment>> getComments(
      String ministryId, String scheduleId) async {
    try {
      final response = await _apiClient.dio.get<List<dynamic>>(
        '/ministries/$ministryId/schedules/$scheduleId/comments',
      );
      final data = response.data;
      if (data == null) return [];
      return data
          .whereType<Map<String, dynamic>>()
          .map(ScheduleComment.fromJson)
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar comentários: $e');
    }
  }

  @override
  Future<ScheduleComment> postComment(
      String ministryId, String scheduleId, String content) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/schedules/$scheduleId/comments',
        data: {'content': content},
      );
      final data = response.data;
      if (data == null) {
        throw const AppFailure(
            message: 'Resposta inesperada do servidor ao postar comentário.');
      }
      return ScheduleComment.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao enviar comentário: $e');
    }
  }

  @override
  Future<ScheduleDetail> createSchedule(
      String ministryId, Map<String, dynamic> data) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/schedules',
        data: data,
      );
      final responseData = response.data;
      if (responseData == null) {
        throw const AppFailure(
            message: 'Resposta inesperada do servidor ao criar escala.');
      }
      return ScheduleDetail.fromJson(responseData);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao criar escala: $e');
    }
  }

  @override
  Future<ScheduleDetail> updateSchedule(
      String ministryId, String scheduleId, Map<String, dynamic> data) async {
    try {
      final response = await _apiClient.dio.put<Map<String, dynamic>>(
        '/ministries/$ministryId/schedules/$scheduleId',
        data: data,
      );
      final responseData = response.data;
      if (responseData == null) {
        throw const AppFailure(
            message: 'Resposta inesperada do servidor ao atualizar escala.');
      }
      return ScheduleDetail.fromJson(responseData);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao atualizar escala: $e');
    }
  }

  @override
  Future<List<MinistryMember>> getMinistryMembers(String ministryId) async {
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
  Future<List<MinistryRole>> getMinistryRoles(String ministryId) async {
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
      throw AppFailure(message: 'Erro ao carregar funções ministeriais: $e');
    }
  }
}
