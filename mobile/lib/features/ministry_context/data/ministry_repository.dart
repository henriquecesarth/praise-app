import 'package:dio/dio.dart';
import '../../../core/errors/app_failure.dart';
import '../../../core/http/api_client.dart';
import '../domain/ministry.dart';

/// Contract for fetching ministry membership data.
abstract class MinistryRepository {
  /// Fetches ministries available to the currently authenticated user.
  /// Backend endpoint: GET /api/v1/ministries/my-ministries
  Future<List<Ministry>> getMyMinistries();
}

/// Implementation of [MinistryRepository] communicating with the LouvAIO REST API.
class HttpMinistryRepository implements MinistryRepository {
  final ApiClient _apiClient;

  HttpMinistryRepository({required ApiClient apiClient})
      : _apiClient = apiClient;

  @override
  Future<List<Ministry>> getMyMinistries() async {
    try {
      final response =
          await _apiClient.dio.get<dynamic>('/ministries/my-ministries');
      final data = response.data;

      if (data == null) {
        return [];
      }

      if (data is List) {
        return data
            .map((item) =>
                Ministry.fromJson(Map<String, dynamic>.from(item as Map)))
            .toList();
      }

      throw const AppFailure(
        message: 'Formato de resposta inesperado ao carregar ministérios.',
        statusCode: 500,
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(
        message: 'Não foi possível carregar os ministérios.',
        details: {'raw': e.toString()},
      );
    }
  }
}
