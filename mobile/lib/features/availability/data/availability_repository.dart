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
      throw AppFailure(message: 'Erro ao carregar indisponibilidades: $e');
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
          message:
              'Resposta inesperada do servidor ao criar indisponibilidade.',
        );
      }

      return MemberAvailability.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao criar indisponibilidade: $e');
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
          message:
              'Resposta inesperada do servidor ao atualizar indisponibilidade.',
        );
      }

      return MemberAvailability.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao atualizar indisponibilidade: $e');
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
      throw AppFailure(message: 'Erro ao remover indisponibilidade: $e');
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
      throw AppFailure(message: 'Erro ao carregar disponibilidade consolidada: $e');
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
      throw AppFailure(
        message: 'Erro ao carregar indisponibilidades do integrante: $e',
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
          message: 'Resposta inesperada do servidor ao criar indisponibilidade.',
        );
      }

      return MemberAvailability.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao criar indisponibilidade manual: $e');
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
          message: 'Resposta inesperada do servidor ao atualizar indisponibilidade.',
        );
      }

      return MemberAvailability.fromJson(data);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao atualizar indisponibilidade manual: $e');
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
      throw AppFailure(message: 'Erro ao remover indisponibilidade manual: $e');
    }
  }
}
