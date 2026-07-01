import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../../core/constants/app_constants.dart';
import 'models/smart_chord_model.dart';
import '../domain/entities/smart_chord_entity.dart';

class SmartChordService {
  final http.Client _client = http.Client();
  final String _baseUrl = ApiConstants.baseUrl;

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-user-id': 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
      };

  Future<List<SmartChord>> getSmartChords({String? search}) async {
    final queryParams = <String, String>{};
    if (search != null && search.isNotEmpty) queryParams['search'] = search;
    
    final uri = Uri.parse('$_baseUrl/smart-chords').replace(queryParameters: queryParams);
    final response = await _client.get(uri, headers: _headers).timeout(ApiConstants.timeout);

    if (response.statusCode != 200) {
      throw Exception('Erro ao carregar cifras.');
    }

    final jsonDecoded = json.decode(response.body) as Map<String, dynamic>;
    final list = jsonDecoded['data'] as List;
    return list.map((item) => SmartChordModel.fromJson(item as Map<String, dynamic>).toEntity()).toList();
  }

  Future<SmartChord> createSmartChord(Map<String, dynamic> data) async {
    final uri = Uri.parse('$_baseUrl/smart-chords');
    final response = await _client.post(
      uri,
      headers: _headers,
      body: json.encode(data),
    ).timeout(ApiConstants.timeout);

    if (response.statusCode != 201) {
      throw Exception('Erro ao criar cifra.');
    }

    return SmartChordModel.fromJson(json.decode(response.body) as Map<String, dynamic>).toEntity();
  }

  Future<SmartChord> updateSmartChord(String id, Map<String, dynamic> data) async {
    final uri = Uri.parse('$_baseUrl/smart-chords/$id');
    final response = await _client.put(
      uri,
      headers: _headers,
      body: json.encode(data),
    ).timeout(ApiConstants.timeout);

    if (response.statusCode != 200) {
      throw Exception('Erro ao atualizar cifra.');
    }

    return SmartChordModel.fromJson(json.decode(response.body) as Map<String, dynamic>).toEntity();
  }

  Future<void> deleteSmartChord(String id) async {
    final uri = Uri.parse('$_baseUrl/smart-chords/$id');
    final response = await _client.delete(
      uri,
      headers: _headers,
    ).timeout(ApiConstants.timeout);

    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception('Erro ao excluir cifra.');
    }
  }
}
