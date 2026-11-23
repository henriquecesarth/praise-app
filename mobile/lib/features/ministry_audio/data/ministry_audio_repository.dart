import 'package:dio/dio.dart';

import '../../../core/errors/app_failure.dart';
import '../../../core/http/api_client.dart';
import '../../../core/http/auth_interceptor.dart';
import '../domain/ministry_audio_models.dart';

/// Returns the ministry the user is currently working in, or `null`.
typedef ActiveMinistryIdProvider = String? Function();

/// Read-only access to the ministry audio library (WAV v1).
///
/// This contract never downloads audio bytes and never writes: it only lists
/// published recordings and asks the backend for playback targets.
abstract class MinistryAudioRepository {
  /// `GET /ministries/:ministryId/audio-library`
  Future<MinistryAudioPage> listRecordings({
    required String ministryId,
    String query = '',
    int? limit,
    String? cursor,
    CancelToken? cancelToken,
  });

  /// `GET /ministries/:ministryId/audio-library/:recordingId/playback`
  Future<MinistryAudioPlayback> getPlayback({
    required String ministryId,
    required String recordingId,
    CancelToken? cancelToken,
  });
}

/// [MinistryAudioRepository] over the shared [ApiClient].
///
/// Context isolation: every call captures the authenticated session and the
/// requested ministry. The session is bound to the request so the
/// [AuthInterceptor] rejects it if the session changes. After the response (or
/// failure) the repository checks again that both the session and the active
/// ministry are unchanged; otherwise the result is discarded and a
/// [contextChangedCode] failure is thrown. Cancelling is never relied upon:
/// late responses are dropped here. Authorization stays in the backend.
///
/// A -> B -> A: when [contextEpoch] is supplied, its value is captured at the
/// start and must compare equal (`==`) afterwards, so a ministry switched away
/// and back is detected even though the ministry id matches. It must advance
/// when a context change starts (see `MinistryContextStamp`). A `null` epoch
/// while a provider is supplied fails closed. Without a provider only the
/// ministry id is compared (the app wiring always supplies it).
class HttpMinistryAudioRepository implements MinistryAudioRepository {
  static const String contextChangedCode = 'AUDIO_CONTEXT_CHANGED';

  final ApiClient _apiClient;
  final ActiveMinistryIdProvider _activeMinistryId;
  final Object? Function()? _contextEpoch;

  HttpMinistryAudioRepository({
    required ApiClient apiClient,
    required ActiveMinistryIdProvider activeMinistryId,
    Object? Function()? contextEpoch,
  })  : _apiClient = apiClient,
        _activeMinistryId = activeMinistryId,
        _contextEpoch = contextEpoch;

  @override
  Future<MinistryAudioPage> listRecordings({
    required String ministryId,
    String query = '',
    int? limit,
    String? cursor,
    CancelToken? cancelToken,
  }) async {
    final trimmed = query.trim();
    if (trimmed.length > 160) {
      throw const AppFailure(
        message: 'A pesquisa é longa demais.',
        statusCode: 400,
      );
    }
    if (limit != null && (limit < 1 || limit > 30)) {
      throw const AppFailure(
        message: 'Limite de página inválido.',
        statusCode: 400,
      );
    }
    if (cursor != null &&
        !MinistryAudioContract.cursorPattern.hasMatch(cursor)) {
      throw const AppFailure(message: 'Cursor inválido.', statusCode: 400);
    }
    return _guarded(
      ministryId,
      cancelToken,
      path: '',
      queryParameters: {
        if (trimmed.isNotEmpty) 'q': trimmed,
        if (limit != null) 'limit': '$limit',
        if (cursor != null) 'cursor': cursor,
      },
      parse: MinistryAudioPage.fromJson,
    );
  }

  @override
  Future<MinistryAudioPlayback> getPlayback({
    required String ministryId,
    required String recordingId,
    CancelToken? cancelToken,
  }) async {
    if (!MinistryAudioContract.recordingIdPattern.hasMatch(recordingId)) {
      throw const AppFailure(
        message: 'Identificador de gravação inválido.',
        statusCode: 400,
      );
    }
    return _guarded(
      ministryId,
      cancelToken,
      path: '/$recordingId/playback',
      parse: (data) {
        final playback = MinistryAudioPlayback.fromJson(data);
        if (playback.manifest.recordingId != recordingId) {
          throw const AppFailure(
            message:
                'Resposta inválida da biblioteca de áudio (gravação divergente).',
            statusCode: 500,
            code: MinistryAudioContract.invalidCode,
          );
        }
        return playback;
      },
    );
  }

  AppFailure get _contextChanged => const AppFailure(
        message: 'O ministério ou a sessão mudou durante a requisição.',
        code: contextChangedCode,
      );

  bool _isCurrent(
    AuthSessionContext? session,
    String ministryId,
    Object? epoch,
  ) {
    final now = _apiClient.sessionContextProvider?.call();
    if (session == null || now != session) return false;
    if (_activeMinistryId() != ministryId) return false;
    final provider = _contextEpoch;
    if (provider == null) return true;
    return epoch != null && provider() == epoch;
  }

  Future<T> _guarded<T>(
    String ministryId,
    CancelToken? cancelToken, {
    required String path,
    Map<String, dynamic>? queryParameters,
    required T Function(Object? data) parse,
  }) async {
    if (!MinistryAudioContract.ministryIdPattern.hasMatch(ministryId)) {
      throw const AppFailure(
        message: 'Identificador de ministério inválido.',
        statusCode: 400,
      );
    }
    final session = _apiClient.sessionContextProvider?.call();
    if (session == null) {
      throw const AppFailure(
        message: 'Sessão expirada ou alternada durante a requisição.',
        statusCode: 401,
        code: 'SESSION_CHANGED',
      );
    }
    final epoch = _contextEpoch?.call();
    if (!_isCurrent(session, ministryId, epoch)) throw _contextChanged;

    final Response<dynamic> response;
    try {
      response = await _apiClient.dio.get<dynamic>(
        '/ministries/${Uri.encodeComponent(ministryId)}/audio-library$path',
        queryParameters: queryParameters,
        cancelToken: cancelToken,
        options: Options(
          extra: {
            AuthInterceptor.sessionUserIdKey: session.userId,
            AuthInterceptor.sessionGenerationKey: session.sessionGeneration,
          },
        ),
      );
    } on DioException catch (e) {
      if (!_isCurrent(session, ministryId, epoch)) throw _contextChanged;
      throw _apiClient.mapDioException(e);
    }
    if (!_isCurrent(session, ministryId, epoch)) throw _contextChanged;
    return parse(response.data);
  }
}
