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
}
