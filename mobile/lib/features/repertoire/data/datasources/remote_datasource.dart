import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:praise/core/constants/app_constants.dart';


/// Remote data source — Communicates with the backend API
class RepertoireRemoteDataSource {
  final http.Client _client;
  final String _baseUrl;

  RepertoireRemoteDataSource({
    http.Client? client,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? ApiConstants.baseUrl;

  String _url(String ministryId, String path) =>
      '$_baseUrl/ministries/$ministryId/$path';

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

  // ─── Songs ──────────────────────────────────────────────────

  Future<Map<String, dynamic>> getSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? originalKey,
    String? artistId,
    bool? hasYoutube,
    int page = 1,
    int limit = 50,
  }) async {
    final queryParams = <String, String>{
      'page': page.toString(),
      'limit': limit.toString(),
    };
    if (search != null && search.isNotEmpty) queryParams['search'] = search;
    if (classificationId != null) queryParams['classification_id'] = classificationId;
    if (originalKey != null) queryParams['original_key'] = originalKey;
    if (artistId != null) queryParams['artist_id'] = artistId;
    if (hasYoutube == true) queryParams['has_youtube'] = 'true';

    final uri = Uri.parse(_url(ministryId, 'songs')).replace(queryParameters: queryParams);
    final response = await _client.get(uri, headers: _headers).timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> getSongById(
    String ministryId,
    String songId,
  ) async {
    final response = await _client
        .get(Uri.parse(_url(ministryId, 'songs/$songId')), headers: _headers)
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> createSong(
    String ministryId,
    Map<String, dynamic> songData,
  ) async {
    final response = await _client
        .post(
          Uri.parse(_url(ministryId, 'songs')),
          headers: _headers,
          body: jsonEncode(songData),
        )
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> updateSong(
    String ministryId,
    String songId,
    Map<String, dynamic> songData,
  ) async {
    final response = await _client
        .put(
          Uri.parse(_url(ministryId, 'songs/$songId')),
          headers: _headers,
          body: jsonEncode(songData),
        )
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<void> deleteSong(String ministryId, String songId) async {
    final response = await _client
        .delete(Uri.parse(_url(ministryId, 'songs/$songId')), headers: _headers)
        .timeout(ApiConstants.timeout);

    if (response.statusCode != 204) {
      throw Exception(_extractError(response));
    }
  }

  // ─── Artists ────────────────────────────────────────────────

  Future<Map<String, dynamic>> getArtists(
    String ministryId, {
    String? search,
  }) async {
    final queryParams = <String, String>{};
    if (search != null && search.isNotEmpty) queryParams['search'] = search;

    final uri = Uri.parse(_url(ministryId, 'artists')).replace(queryParameters: queryParams.isEmpty ? null : queryParams);
    final response = await _client.get(uri, headers: _headers).timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> createArtist(
    String ministryId,
    String name,
  ) async {
    final response = await _client
        .post(
          Uri.parse(_url(ministryId, 'artists')),
          headers: _headers,
          body: jsonEncode({'name': name}),
        )
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> updateArtist(
    String ministryId,
    String artistId,
    String name,
  ) async {
    final response = await _client
        .put(
          Uri.parse(_url(ministryId, 'artists/$artistId')),
          headers: _headers,
          body: jsonEncode({'name': name}),
        )
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<void> deleteArtist(String ministryId, String artistId) async {
    final response = await _client
        .delete(Uri.parse(_url(ministryId, 'artists/$artistId')), headers: _headers)
        .timeout(ApiConstants.timeout);

    if (response.statusCode != 204) {
      throw Exception(_extractError(response));
    }
  }

  // ─── Classifications ───────────────────────────────────────

  Future<Map<String, dynamic>> getClassifications(String ministryId) async {
    final response = await _client
        .get(Uri.parse(_url(ministryId, 'classifications')), headers: _headers)
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> createClassification(
    String ministryId,
    Map<String, dynamic> data,
  ) async {
    final response = await _client
        .post(
          Uri.parse(_url(ministryId, 'classifications')),
          headers: _headers,
          body: jsonEncode(data),
        )
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> updateClassification(
    String ministryId,
    String classificationId,
    Map<String, dynamic> data,
  ) async {
    final response = await _client
        .put(
          Uri.parse(_url(ministryId, 'classifications/$classificationId')),
          headers: _headers,
          body: jsonEncode(data),
        )
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<void> deleteClassification(
    String ministryId,
    String classificationId,
  ) async {
    final response = await _client
        .delete(
          Uri.parse(_url(ministryId, 'classifications/$classificationId')),
          headers: _headers,
        )
        .timeout(ApiConstants.timeout);

    if (response.statusCode != 204) {
      throw Exception(_extractError(response));
    }
  }

  // ─── Folders ────────────────────────────────────────────────

  Future<Map<String, dynamic>> getFolders(String ministryId) async {
    final response = await _client
        .get(Uri.parse(_url(ministryId, 'folders')), headers: _headers)
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> getFolderById(String ministryId, String folderId) async {
    final response = await _client
        .get(Uri.parse(_url(ministryId, 'folders/$folderId')), headers: _headers)
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> createFolder(
    String ministryId,
    String name, {
    String? description,
  }) async {
    final response = await _client
        .post(
          Uri.parse(_url(ministryId, 'folders')),
          headers: _headers,
          body: jsonEncode({
            'name': name,
            if (description != null) 'description': description,
          }),
        )
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<Map<String, dynamic>> updateFolder(
    String ministryId,
    String folderId,
    Map<String, dynamic> data,
  ) async {
    final response = await _client
        .put(
          Uri.parse(_url(ministryId, 'folders/$folderId')),
          headers: _headers,
          body: jsonEncode(data),
        )
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  Future<void> deleteFolder(String ministryId, String folderId) async {
    final response = await _client
        .delete(Uri.parse(_url(ministryId, 'folders/$folderId')), headers: _headers)
        .timeout(ApiConstants.timeout);

    if (response.statusCode != 204) {
      throw Exception(_extractError(response));
    }
  }

  Future<void> addSongToFolder(
    String ministryId,
    String folderId,
    String songId, {
    int? position,
  }) async {
    final response = await _client
        .post(
          Uri.parse(_url(ministryId, 'folders/$folderId/songs')),
          headers: _headers,
          body: jsonEncode({
            'song_id': songId,
            if (position != null) 'position': position,
          }),
        )
        .timeout(ApiConstants.timeout);

    if (response.statusCode != 201) {
      throw Exception(_extractError(response));
    }
  }

  Future<void> removeSongFromFolder(
    String ministryId,
    String folderId,
    String songId,
  ) async {
    final response = await _client
        .delete(
          Uri.parse(_url(ministryId, 'folders/$folderId/songs/$songId')),
          headers: _headers,
        )
        .timeout(ApiConstants.timeout);

    if (response.statusCode != 204) {
      throw Exception(_extractError(response));
    }
  }

  // ─── Counts ─────────────────────────────────────────────────

  Future<Map<String, dynamic>> getCounts(String ministryId) async {
    final response = await _client
        .get(Uri.parse(_url(ministryId, 'counts')), headers: _headers)
        .timeout(ApiConstants.timeout);

    return _handleResponse(response);
  }

  // ─── Helpers ────────────────────────────────────────────────

  Map<String, dynamic> _handleResponse(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return jsonDecode(response.body) as Map<String, dynamic>;
    }
    throw Exception(_extractError(response));
  }

  String _extractError(http.Response response) {
    try {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final error = body['error'] as Map<String, dynamic>?;
      return error?['message'] as String? ?? 'Erro desconhecido (${response.statusCode})';
    } catch (_) {
      return 'Erro do servidor (${response.statusCode})';
    }
  }
}
