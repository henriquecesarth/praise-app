import 'package:dio/dio.dart';
import '../../../core/errors/app_failure.dart';
import '../../../core/http/api_client.dart';
import '../domain/ministry.dart';
import '../domain/ministry_onboarding.dart';

/// Contract for fetching ministry membership and lifecycle data.
abstract class MinistryRepository {
  /// Fetches ministries available to the currently authenticated user.
  /// Backend endpoint: GET /api/v1/ministries/my-ministries
  Future<List<Ministry>> getMyMinistries();

  /// Creates a new ministry with creator assigned as admin.
  /// Backend endpoint: POST /api/v1/ministries
  Future<Ministry> createMinistry({required String name});

  /// Joins an existing ministry using an invite code.
  /// Backend endpoint: POST /api/v1/ministries/join
  Future<JoinMinistryResult> joinMinistryByCode({required String code});

  /// Generates an invitation code for a ministry (admin only).
  /// Backend endpoint: POST /api/v1/ministries/:ministryId/invites
  Future<MinistryInvite> createInviteCode(
    String ministryId, {
    int expiresInDays = 7,
  });
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

  @override
  Future<Ministry> createMinistry({required String name}) async {
    final trimmedName = name.trim();
    if (trimmedName.isEmpty) {
      throw const AppFailure(
        message: 'Nome do ministério é obrigatório.',
        statusCode: 400,
      );
    }

    try {
      final response = await _apiClient.dio.post<dynamic>(
        '/ministries',
        data: {'name': trimmedName},
      );

      final data = response.data;
      if (data is Map) {
        final payload = data['data'] is Map ? data['data'] as Map : data;
        return Ministry.fromJson(Map<String, dynamic>.from(payload));
      }

      throw const AppFailure(
        message: 'Resposta inesperada ao criar ministério.',
        statusCode: 500,
      );
    } on DioException catch (e) {
      throw _apiClient.mapDioException(e);
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(
        message: 'Erro ao criar o ministério de louvor.',
        details: {'raw': e.toString()},
      );
    }
  }

  @override
  Future<JoinMinistryResult> joinMinistryByCode({required String code}) async {
    final cleanCode = code.trim().toUpperCase();
    if (cleanCode.isEmpty) {
      throw const AppFailure(
        message: 'Código de convite é obrigatório.',
        statusCode: 400,
      );
    }

    try {
      final response = await _apiClient.dio.post<dynamic>(
        '/ministries/join',
        data: {'code': cleanCode},
      );

      final data = response.data;
      if (data is Map) {
        return JoinMinistryResult.fromJson(Map<String, dynamic>.from(data));
      }

      throw const AppFailure(
        message: 'Resposta inesperada ao ingressar no ministério.',
        statusCode: 500,
      );
    } on DioException catch (e) {
      final failure = _apiClient.mapDioException(e);
      if (failure.statusCode == 404) {
        throw const AppFailure(
          message:
              'Código de convite não encontrado. Verifique o código e tente novamente.',
          statusCode: 404,
        );
      }
      if (failure.statusCode == 400) {
        if (failure.message.contains('expirou')) {
          throw const AppFailure(
            message:
                'Este código de convite expirou. Solicite um novo código ao líder.',
            statusCode: 400,
          );
        }
        if (failure.message.contains('limite')) {
          throw const AppFailure(
            message:
                'Este código de convite atingiu o limite máximo de utilizações.',
            statusCode: 400,
          );
        }
      }
      if (failure.statusCode == 403 ||
          failure.code == 'PLAN_MEMBER_QUOTA_REACHED') {
        throw const AppFailure(
          message:
              'O ministério atingiu o limite de integrantes do plano atual. Entre em contato com o líder.',
          statusCode: 403,
          code: 'PLAN_MEMBER_QUOTA_REACHED',
        );
      }
      throw failure;
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(
        message: 'Não foi possível validar o código de convite.',
        details: {'raw': e.toString()},
      );
    }
  }

  @override
  Future<MinistryInvite> createInviteCode(
    String ministryId, {
    int expiresInDays = 7,
  }) async {
    try {
      final response = await _apiClient.dio.post<dynamic>(
        '/ministries/$ministryId/invites',
        data: {'expiresInDays': expiresInDays},
      );

      final data = response.data;
      if (data is Map) {
        return MinistryInvite.fromJson(Map<String, dynamic>.from(data));
      }

      throw const AppFailure(
        message: 'Resposta inesperada ao gerar convite.',
        statusCode: 500,
      );
    } on DioException catch (e) {
      final failure = _apiClient.mapDioException(e);
      if (failure.statusCode == 403) {
        if (failure.code == 'SUBSCRIPTION_RESTRICTED') {
          throw const AppFailure(
            message:
                'Ministério em modo restrito por excesso de membros. Regularize o plano na versão web.',
            statusCode: 403,
            code: 'SUBSCRIPTION_RESTRICTED',
          );
        }
        if (failure.code == 'SUBSCRIPTION_SUSPENDED') {
          throw const AppFailure(
            message:
                'Ministério suspenso pela plataforma. Entre em contato com o suporte.',
            statusCode: 403,
            code: 'SUBSCRIPTION_SUSPENDED',
          );
        }
        throw const AppFailure(
          message: 'Apenas administradores podem gerar códigos de convite.',
          statusCode: 403,
        );
      }
      throw failure;
    } catch (e) {
      if (e is AppFailure) rethrow;
      throw AppFailure(
        message: 'Não foi possível gerar o código de convite.',
        details: {'raw': e.toString()},
      );
    }
  }
}
