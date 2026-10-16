import 'package:dio/dio.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/http/api_client.dart';
import '../domain/smart_chord.dart';
import '../domain/smart_chord_repertoire_link.dart';

abstract class SmartChordRepertoireLinkRepository {
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  });

  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  });

  Future<void> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  });

  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  });
}

class HttpSmartChordRepertoireLinkRepository implements SmartChordRepertoireLinkRepository {
  final ApiClient _apiClient;

  HttpSmartChordRepertoireLinkRepository({required ApiClient apiClient}) : _apiClient = apiClient;

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    try {
      final response = await _apiClient.dio.get<Map<String, dynamic>>(
        '/ministries/$ministryId/smart-chords/$chordId/repertoire-link',
      );
      final data = response.data;
      if (data != null) {
        return SmartChordRepertoireLink.fromJson(data);
      }
      return const SmartChordRepertoireLink.unlinked();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
  }) async {
    try {
      final response = await _apiClient.dio.put<Map<String, dynamic>>(
        '/ministries/$ministryId/smart-chords/$chordId/repertoire-link',
        data: {'song_id': songId},
      );
      final data = response.data;
      if (data != null) {
        return SmartChordRepertoireLink.fromJson(data);
      }
      return const SmartChordRepertoireLink.unlinked();
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<void> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {
    try {
      await _apiClient.dio.delete<void>(
        '/ministries/$ministryId/smart-chords/$chordId/repertoire-link',
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      throw AppFailure(message: e.toString());
    }
  }

  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
  }) async {
    try {
      final response = await _apiClient.dio.get<dynamic>(
        '/ministries/$ministryId/songs/$songId/my-smart-chords',
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
}
