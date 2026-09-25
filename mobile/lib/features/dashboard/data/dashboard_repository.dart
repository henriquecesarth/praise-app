import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/announcement.dart';
import '../domain/dashboard_schedule_summary.dart';

abstract class DashboardRepository {
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId);
  Future<List<Announcement>> getAnnouncements(String ministryId,
      {int limit = 20});
}

class HttpDashboardRepository implements DashboardRepository {
  final ApiClient _apiClient;

  HttpDashboardRepository({required ApiClient apiClient})
      : _apiClient = apiClient;

  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async {
    try {
      final response = await _apiClient.dio.get<List<dynamic>>(
        '/ministries/$ministryId/schedules',
      );

      final data = response.data;
      if (data == null) return [];

      return data
          .whereType<Map<String, dynamic>>()
          .map(DashboardScheduleSummary.fromJson)
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar escalas: $e');
    }
  }

  @override
  Future<List<Announcement>> getAnnouncements(
    String ministryId, {
    int limit = 20,
  }) async {
    try {
      final response = await _apiClient.dio.get<List<dynamic>>(
        '/ministries/$ministryId/announcements',
        queryParameters: {'limit': limit},
      );

      final data = response.data;
      if (data == null) return [];

      return data
          .whereType<Map<String, dynamic>>()
          .map(Announcement.fromJson)
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(message: 'Erro ao carregar avisos: $e');
    }
  }
}
