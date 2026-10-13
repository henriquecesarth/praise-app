import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/liturgy.dart';

abstract class LiturgyRepository {
  Future<List<Liturgy>> listLiturgies(String ministryId);
  Future<Liturgy> getLiturgyById(String ministryId, String liturgyId);
  Future<Liturgy> createLiturgy(
    String ministryId, {
    required String title,
    required String date,
    String? description,
    List<Map<String, dynamic>>? items,
  });
  Future<Liturgy> updateLiturgy(
    String ministryId,
    String liturgyId, {
    String? title,
    String? date,
    String? description,
    List<Map<String, dynamic>>? items,
  });
  Future<void> deleteLiturgy(String ministryId, String liturgyId);
}

class HttpLiturgyRepository implements LiturgyRepository {
  final ApiClient _apiClient;

  HttpLiturgyRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  @override
  Future<List<Liturgy>> listLiturgies(String ministryId) async {
    try {
      final response = await _apiClient.dio.get<List<dynamic>>(
        '/ministries/$ministryId/liturgies',
      );
      final data = response.data ?? [];
      return data
          .whereType<Map<String, dynamic>>()
          .map((item) => Liturgy.fromJson(item))
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<Liturgy> getLiturgyById(String ministryId, String liturgyId) async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/liturgies/$liturgyId',
      );
      if (response.data == null) {
        throw const AppFailure(message: 'Liturgia não encontrada.', statusCode: 404);
      }
      return Liturgy.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<Liturgy> createLiturgy(
    String ministryId, {
    required String title,
    required String date,
    String? description,
    List<Map<String, dynamic>>? items,
  }) async {
    try {
      final payload = <String, dynamic>{
        'title': title.trim(),
        'date': date,
        if (description != null && description.trim().isNotEmpty)
          'description': description.trim(),
        if (items != null) 'items': items,
      };

      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/ministries/$ministryId/liturgies',
        data: payload,
      );

      if (response.data == null) {
        throw const AppFailure(message: 'Resposta vazia ao criar liturgia.');
      }
      return Liturgy.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<Liturgy> updateLiturgy(
    String ministryId,
    String liturgyId, {
    String? title,
    String? date,
    String? description,
    List<Map<String, dynamic>>? items,
  }) async {
    try {
      final payload = <String, dynamic>{
        if (title != null) 'title': title.trim(),
        if (date != null) 'date': date,
        if (description != null) 'description': description.trim(),
        if (items != null) 'items': items,
      };

      final response = await _apiClient.dio.put<Map<String, dynamic>>(
        '/ministries/$ministryId/liturgies/$liturgyId',
        data: payload,
      );

      if (response.data == null) {
        throw const AppFailure(message: 'Resposta vazia ao atualizar liturgia.');
      }
      return Liturgy.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<void> deleteLiturgy(String ministryId, String liturgyId) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/liturgies/$liturgyId',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }
}
