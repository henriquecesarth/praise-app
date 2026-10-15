import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/availability.dart';

/// Data access layer for member availability backend endpoints.
abstract class AvailabilityRepository {
  /// Lists unavailabilities for current authenticated user under [ministryId].
  Future<AvailabilityListResponse> listMyAvailabilities(
    String ministryId, {
    int limit = 50,
    String? cursor,
  });

  /// Creates a new unavailability period for current authenticated user.
  Future<MemberAvailability> createMyAvailability(
    String ministryId,
    CreateAvailabilityPayload payload,
  );

  /// Updates an existing unavailability period.
  Future<MemberAvailability> updateMyAvailability(
    String ministryId,
    String id,
    UpdateAvailabilityPayload payload,
  );

  /// Deletes an existing unavailability period.
  Future<void> deleteMyAvailability(String ministryId, String id);

  /// Lists consolidated unavailabilities for all members in [ministryId] between [from] and [to] (inclusive).
  ///
  /// Admin-only. Ommits private reason fields.
  Future<ConsolidatedAvailabilityResponse> listConsolidatedAvailability(
    String ministryId, {
    required String from,
    required String to,
    String? memberId,
    int limit = 50,
    String? cursor,
  });

  /// Lists unavailabilities for a manual/unlinked member under [ministryId].
  ///
  /// Admin-only. Requires target member to be is_manual === true and user_id == null.
  Future<AvailabilityListResponse> listManualMemberAvailabilities(
    String ministryId,
    String memberId, {
    int limit = 50,
    String? cursor,
  });

  /// Creates an unavailability period for a manual/unlinked member under [ministryId].
  ///
  /// Admin-only. Subject/actor separation: authenticated user is actor, [memberId] is subject.
  Future<MemberAvailability> createManualMemberAvailability(
    String ministryId,
    String memberId,
    CreateAvailabilityPayload payload,
  );

  /// Updates an unavailability period for a manual/unlinked member under [ministryId].
  Future<MemberAvailability> updateManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
    UpdateAvailabilityPayload payload,
  );

  /// Deletes an unavailability period for a manual/unlinked member under [ministryId].
  Future<void> deleteManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
  );

  /// Checks availability conflicts for a schedule time window against candidate member unavailabilities.
  ///
  /// Calls `POST /api/v1/ministries/:ministryId/availability/check-conflicts`.
  /// Admin-only. Does NOT block schedule authoring.
  Future<ScheduleConflictCheckResponse> checkScheduleConflicts(
    String ministryId,
    CheckScheduleConflictsPayload payload,
  );
}

class HttpAvailabilityRepository implements AvailabilityRepository {
  final ApiClient _apiClient;

  HttpAvailabilityRepository({required ApiClient apiClient})
      : _apiClient = apiClient;

  @override
  Future<AvailabilityListResponse> listMyAvailabilities(
    String ministryId, {
    int limit = 50,
    String? cursor,
  }) async {
    try {
      final queryParams = <String, dynamic>{
        'limit': limit,
      };
      if (cursor != null && cursor.isNotEmpty) {
        queryParams['cursor'] = cursor;
      }

      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/availability/my',
        queryParameters: queryParams,
      );

      final data = response.data;
      if (data == null) {
        return const AvailabilityListResponse(data: [], nextCursor: null);
      }

      return AvailabilityListResponse.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message:
            'Não foi possível interpretar os dados de disponibilidade recebidos.',
      );
    }
  }

  @override
  Future<MemberAvailability> createMyAvailability(
    String ministryId,
    CreateAvailabilityPayload payload,
  ) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/availability/my',
        data: payload.toJson(),
      );

      final data = response.data;
      if (data == null) {
        throw const AppFailure(
          message: 'Não foi possível salvar a indisponibilidade.',
        );
      }

      return MemberAvailability.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message: 'Não foi possível salvar a indisponibilidade.',
      );
    }
  }

  @override
  Future<MemberAvailability> updateMyAvailability(
    String ministryId,
    String id,
    UpdateAvailabilityPayload payload,
  ) async {
    try {
      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/ministries/$ministryId/availability/my/$id',
        data: payload.toJson(),
      );

      final data = response.data;
      if (data == null) {
        throw const AppFailure(
          message: 'Não foi possível salvar a indisponibilidade.',
        );
      }

      return MemberAvailability.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message: 'Não foi possível salvar a indisponibilidade.',
      );
    }
  }

  @override
  Future<void> deleteMyAvailability(String ministryId, String id) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/availability/my/$id',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message: 'Não foi possível remover a indisponibilidade.',
      );
    }
  }

  @override
  Future<ConsolidatedAvailabilityResponse> listConsolidatedAvailability(
    String ministryId, {
    required String from,
    required String to,
    String? memberId,
    int limit = 50,
    String? cursor,
  }) async {
    try {
      final queryParams = <String, dynamic>{
        'from': from,
        'to': to,
        'limit': limit,
      };
      if (memberId != null && memberId.trim().isNotEmpty) {
        queryParams['memberId'] = memberId.trim();
      }
      if (cursor != null && cursor.trim().isNotEmpty) {
        queryParams['cursor'] = cursor.trim();
      }

      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/availability',
        queryParameters: queryParams,
      );

      final data = response.data;
      if (data == null) {
        return const ConsolidatedAvailabilityResponse(data: []);
      }

      return ConsolidatedAvailabilityResponse.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message:
            'Não foi possível interpretar os dados de disponibilidade recebidos.',
      );
    }
  }

  @override
  Future<AvailabilityListResponse> listManualMemberAvailabilities(
    String ministryId,
    String memberId, {
    int limit = 50,
    String? cursor,
  }) async {
    try {
      final queryParams = <String, dynamic>{
        'limit': limit,
      };
      if (cursor != null && cursor.trim().isNotEmpty) {
        queryParams['cursor'] = cursor.trim();
      }

      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/availability/members/$memberId',
        queryParameters: queryParams,
      );

      final data = response.data;
      if (data == null) {
        return const AvailabilityListResponse(data: []);
      }

      return AvailabilityListResponse.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message:
            'Não foi possível interpretar os dados de disponibilidade recebidos.',
      );
    }
  }

  @override
  Future<MemberAvailability> createManualMemberAvailability(
    String ministryId,
    String memberId,
    CreateAvailabilityPayload payload,
  ) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/availability/members/$memberId',
        data: payload.toJson(),
      );

      final data = response.data;
      if (data == null) {
        throw const AppFailure(
          message: 'Não foi possível salvar a indisponibilidade.',
        );
      }

      return MemberAvailability.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message: 'Não foi possível salvar a indisponibilidade.',
      );
    }
  }

  @override
  Future<MemberAvailability> updateManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
    UpdateAvailabilityPayload payload,
  ) async {
    try {
      final response = await _apiClient.dio.patch<Map<String, dynamic>>(
        '/ministries/$ministryId/availability/members/$memberId/$id',
        data: payload.toJson(),
      );

      final data = response.data;
      if (data == null) {
        throw const AppFailure(
          message: 'Não foi possível salvar a indisponibilidade.',
        );
      }

      return MemberAvailability.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message: 'Não foi possível salvar a indisponibilidade.',
      );
    }
  }

  @override
  Future<void> deleteManualMemberAvailability(
    String ministryId,
    String memberId,
    String id,
  ) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/availability/members/$memberId/$id',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw const AppFailure(
        message: 'Não foi possível remover a indisponibilidade.',
      );
    }
  }

  @override
  Future<ScheduleConflictCheckResponse> checkScheduleConflicts(
    String ministryId,
    CheckScheduleConflictsPayload payload,
  ) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/availability/check-conflicts',
        data: payload.toJson(),
      );
      var data = response.data;
      if (data == null) {
        throw const AppFailure(
          message:
              'Resposta vazia do servidor ao verificar conflitos de disponibilidade.',
          statusCode: 500,
        );
      }
      if (data.containsKey('data') && data['data'] is Map<String, dynamic>) {
        data = data['data'] as Map<String, dynamic>;
      }
      return ScheduleConflictCheckResponse.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(
        message:
            'Não foi possível verificar a disponibilidade dos integrantes.',
        details: {'raw': e.toString()},
      );
    }
  }
}
