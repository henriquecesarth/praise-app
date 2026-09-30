import 'package:dio/dio.dart';
import '../../../core/http/api_client.dart';
import '../../../core/logging/app_logger.dart';

/// Contract for pushing device token registrations to the LouvAIO backend.
abstract class PushDeviceRepository {
  Future<bool> registerDevice({
    required String fcmToken,
    required String platform,
    String? appVersion,
    String? deviceModel,
  });

  Future<bool> unregisterDevice({
    required String fcmToken,
  });
}

/// HTTP implementation of [PushDeviceRepository].
///
/// Communicates with `/api/v1/auth/push-devices`.
/// Non-fatal: Network or backend failures are caught and logged; they never crash the caller.
class HttpPushDeviceRepository implements PushDeviceRepository {
  final ApiClient _apiClient;
  final AppLogger _logger;

  HttpPushDeviceRepository({
    required ApiClient apiClient,
    required AppLogger logger,
  })  : _apiClient = apiClient,
        _logger = logger;

  @override
  Future<bool> registerDevice({
    required String fcmToken,
    required String platform,
    String? appVersion,
    String? deviceModel,
  }) async {
    final sanitizedToken = _redactToken(fcmToken);
    try {
      _logger.debug('Registering push device with token: $sanitizedToken');

      final response = await _apiClient.dio.post<Map<String, dynamic>>(
        '/auth/push-devices',
        data: {
          'fcm_token': fcmToken.trim(),
          'platform': platform.trim().toLowerCase(),
          if (appVersion != null) 'app_version': appVersion.trim(),
          if (deviceModel != null) 'device_model': deviceModel.trim(),
        },
      );

      final success = response.statusCode == 200 || response.statusCode == 201;
      if (success) {
        _logger.debug('Push device successfully registered.');
      }
      return success;
    } on DioException catch (e) {
      _logger.warning(
        'Failed to register push device ($sanitizedToken): [${e.response?.statusCode}] ${e.message}',
      );
      return false;
    } catch (e) {
      _logger.warning('Unexpected failure registering push device: $e');
      return false;
    }
  }

  @override
  Future<bool> unregisterDevice({
    required String fcmToken,
  }) async {
    final sanitizedToken = _redactToken(fcmToken);
    try {
      _logger.debug('Unregistering push device with token: $sanitizedToken');

      final response = await _apiClient.dio.delete<Map<String, dynamic>>(
        '/auth/push-devices',
        data: {
          'fcm_token': fcmToken.trim(),
        },
      );

      final success = response.statusCode == 200 || response.statusCode == 404;
      if (success) {
        _logger.debug('Push device unregistered (or already removed).');
      }
      return success;
    } on DioException catch (e) {
      // 404 is considered benign (token already removed)
      if (e.response?.statusCode == 404) {
        return true;
      }
      _logger.warning(
        'Failed to unregister push device ($sanitizedToken): [${e.response?.statusCode}] ${e.message}',
      );
      return false;
    } catch (e) {
      _logger.warning('Unexpected failure unregistering push device: $e');
      return false;
    }
  }

  static String _redactToken(String token) {
    if (token.length < 10) return '***';
    return '${token.substring(0, 5)}...${token.substring(token.length - 4)}';
  }
}
