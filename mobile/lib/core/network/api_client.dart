import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';
import '../constants/app_constants.dart';

class ApiClient {
  static const String tokenKey = 'praise_auth_token';
  static const String userKey = 'praise_user';
  static const String activeMinistryIdKey = 'praise_active_ministry_id';

  final http.Client _client;

  ApiClient({http.Client? client}) : _client = client ?? http.Client();

  String get _baseUrl => ApiConstants.baseUrl;

  Future<Map<String, String>> _getHeaders() async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString(tokenKey);
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }
    } catch (_) {}
    return headers;
  }

  Future<dynamic> _handleResponse(http.Response response) async {
    if (response.statusCode == 204) return {};
    try {
      final body = jsonDecode(response.body);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return body;
      }
      final errorMsg = body['error']?['message'] ?? 'Erro no servidor (${response.statusCode})';
      throw Exception(errorMsg);
    } catch (e) {
      if (e is Exception) rethrow;
      throw Exception('Erro de resposta do servidor (${response.statusCode})');
    }
  }

  // ─── Auth ───────────────────────────────────────────────────

  Future<Map<String, dynamic>> login(String email, String password) async {
    final uri = Uri.parse('$_baseUrl/auth/login');
    final response = await _client.post(
      uri,
      headers: await _getHeaders(),
      body: jsonEncode({'email': email, 'password': password}),
    ).timeout(ApiConstants.timeout);

    final result = await _handleResponse(response) as Map<String, dynamic>;

    if (result.containsKey('token')) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(tokenKey, result['token'] as String);
      if (result.containsKey('user')) {
        await prefs.setString(userKey, jsonEncode(result['user']));
      }
    }

    return result;
  }

  Future<Map<String, dynamic>> signUp(String name, String email, String password) async {
    final uri = Uri.parse('$_baseUrl/auth/signup');
    final response = await _client.post(
      uri,
      headers: await _getHeaders(),
      body: jsonEncode({'name': name, 'email': email, 'password': password}),
    ).timeout(ApiConstants.timeout);

    final result = await _handleResponse(response) as Map<String, dynamic>;

    if (result.containsKey('token')) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(tokenKey, result['token'] as String);
      if (result.containsKey('user')) {
        await prefs.setString(userKey, jsonEncode(result['user']));
      }
    }

    return result;
  }

  Future<Map<String, dynamic>?> getStoredUser() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final userStr = prefs.getString(userKey);
      if (userStr != null) {
        return jsonDecode(userStr) as Map<String, dynamic>;
      }
    } catch (_) {}
    return null;
  }

  Future<void> logout() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(tokenKey);
      await prefs.remove(userKey);
      await prefs.remove(activeMinistryIdKey);
    } catch (_) {}
  }

  // ─── Ministries ──────────────────────────────────────────────

  Future<List<dynamic>> getMyMinistries() async {
    final uri = Uri.parse('$_baseUrl/ministries/my-ministries');
    final response = await _client.get(uri, headers: await _getHeaders()).timeout(ApiConstants.timeout);
    final result = await _handleResponse(response);
    if (result is List) return result;
    return [];
  }

  Future<Map<String, dynamic>> createMinistry(String name) async {
    final uri = Uri.parse('$_baseUrl/ministries');
    final response = await _client.post(
      uri,
      headers: await _getHeaders(),
      body: jsonEncode({'name': name}),
    ).timeout(ApiConstants.timeout);
    return await _handleResponse(response) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> joinMinistryByCode(String code) async {
    final uri = Uri.parse('$_baseUrl/ministries/join');
    final response = await _client.post(
      uri,
      headers: await _getHeaders(),
      body: jsonEncode({'code': code}),
    ).timeout(ApiConstants.timeout);
    return await _handleResponse(response) as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> createInviteCode(String ministryId, {int expiresInDays = 7}) async {
    final uri = Uri.parse('$_baseUrl/ministries/$ministryId/invites');
    final response = await _client.post(
      uri,
      headers: await _getHeaders(),
      body: jsonEncode({'expiresInDays': expiresInDays}),
    ).timeout(ApiConstants.timeout);
    return await _handleResponse(response) as Map<String, dynamic>;
  }

  Future<List<dynamic>> getMinistryMembers(String ministryId) async {
    final uri = Uri.parse('$_baseUrl/ministries/$ministryId/members');
    final response = await _client.get(uri, headers: await _getHeaders()).timeout(ApiConstants.timeout);
    final result = await _handleResponse(response);
    if (result is List) return result;
    return [];
  }

  // ─── Schedules ───────────────────────────────────────────────

  Future<List<dynamic>> getSchedules(String ministryId) async {
    final uri = Uri.parse('$_baseUrl/ministries/$ministryId/schedules');
    final response = await _client.get(uri, headers: await _getHeaders()).timeout(ApiConstants.timeout);
    final result = await _handleResponse(response);
    if (result is List) return result;
    return [];
  }

  Future<Map<String, dynamic>> confirmPresence(String ministryId, String scheduleId, bool confirmed) async {
    final uri = Uri.parse('$_baseUrl/ministries/$ministryId/schedules/$scheduleId/confirmation');
    final response = await _client.patch(
      uri,
      headers: await _getHeaders(),
      body: jsonEncode({'confirmed': confirmed}),
    ).timeout(ApiConstants.timeout);
    return await _handleResponse(response) as Map<String, dynamic>;
  }

  // ─── Active Ministry Storage ───────────────────────────────

  Future<String> getActiveMinistryId() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return prefs.getString(activeMinistryIdKey) ?? ApiConstants.defaultMinistryId;
    } catch (_) {
      return ApiConstants.defaultMinistryId;
    }
  }

  Future<void> setActiveMinistryId(String ministryId) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(activeMinistryIdKey, ministryId);
    } catch (_) {}
  }

  Future<bool> isLoggedIn() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final token = prefs.getString(tokenKey);
      final userStr = prefs.getString(userKey);
      return (token != null && token.isNotEmpty) || (userStr != null && userStr.isNotEmpty);
    } catch (_) {
      return false;
    }
  }
}
