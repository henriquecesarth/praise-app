import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/smart_chord.dart';
import '../domain/smart_chord_import.dart';

abstract class SmartChordRepository {
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit});
  Future<List<SmartChord>> getSmartChordsBySong(String songId);
  Future<SmartChord> getSmartChordById(String id);
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload);
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload);
  Future<void> deleteSmartChord(String id);
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename);
  Future<SmartChordImportDraft> importTextDraft(String text);
}

class HttpSmartChordRepository implements SmartChordRepository {
  final ApiClient _apiClient;

  HttpSmartChordRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  @override
  Future<List<SmartChord>> getSmartChords({String? search, int? page, int? limit}) async {
    try {
      final queryParams = <String, dynamic>{};
      if (search != null && search.trim().isNotEmpty) {
        queryParams['search'] = search.trim();
      }
      if (page != null && page > 0) {
        queryParams['page'] = page;
      }
      if (limit != null && limit > 0) {
        queryParams['limit'] = limit;
      }

      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/smart-chords',
        queryParameters: queryParams.isNotEmpty ? queryParams : null,
      );

      final data = response.data?['data'];
      if (data is List) {
        return data
            .whereType<Map<String, dynamic>>()
            .map((item) => SmartChord.fromJson(item))
            .toList();
      }
      return [];
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<List<SmartChord>> getSmartChordsBySong(String songId) async {
    try {
      final response = await _apiClient.dio.get<dynamic>(
        '/smart-chords/song/$songId',
      );

      final rawData = response.data;
      final List<dynamic> list;
      if (rawData is List) {
        list = rawData;
      } else if (rawData is Map<String, dynamic> && rawData['data'] is List) {
        list = rawData['data'] as List;
      } else {
        list = [];
      }

      return list
          .whereType<Map<String, dynamic>>()
          .map((item) => SmartChord.fromJson(item))
          .toList();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<SmartChord> getSmartChordById(String id) async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/smart-chords/$id',
      );
      if (response.data == null) {
        throw const AppFailure(message: 'Cifra não encontrada.', statusCode: 404);
      }
      return SmartChord.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<SmartChord> createSmartChord(Map<String, dynamic> payload) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/smart-chords',
        data: payload,
      );
      if (response.data == null) {
        throw const AppFailure(message: 'Resposta vazia ao criar cifra.');
      }
      return SmartChord.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> payload) async {
    try {
      final response = await _apiClient.dio.put<Map<String, dynamic>>(
        '/smart-chords/$id',
        data: payload,
      );
      if (response.data == null) {
        throw const AppFailure(message: 'Resposta vazia ao atualizar cifra.');
      }
      return SmartChord.fromJson(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<void> deleteSmartChord(String id) async {
    try {
      await _apiClient.dio.delete<void>('/smart-chords/$id');
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<SmartChordImportDraft> importPdfDraft(List<int> bytes, String filename) async {
    try {
      final formData = FormData.fromMap({
        'file': MultipartFile.fromBytes(
          bytes,
          filename: filename,
        ),
      });

      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/smart-chords/import/pdf',
        data: formData,
      );

      if (response.data == null) {
        throw const AppFailure(message: 'Resposta vazia ao importar PDF.');
      }
      return SmartChordImportDraft.fromMap(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<SmartChordImportDraft> importTextDraft(String text) async {
    try {
      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/smart-chords/import/text',
        data: {'text': text},
      );

      if (response.data == null) {
        throw const AppFailure(message: 'Resposta vazia ao importar texto.');
      }
      return SmartChordImportDraft.fromMap(response.data!);
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }
}
