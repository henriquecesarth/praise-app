import 'dart:async';

import 'package:dio/dio.dart';

import '../../../core/errors/app_failure.dart';
import '../../../core/http/api_client.dart';
import '../../../core/http/auth_interceptor.dart';
import '../domain/ministry_audio_models.dart';
import 'ministry_audio_transfer_policy.dart';

/// Opened stem transfer: status already validated, body streamed in chunks.
final class MinistryAudioStemResponse {
  const MinistryAudioStemResponse({required this.body, this.contentLength});

  final Stream<List<int>> body;
  final int? contentLength;
}

/// Opens one stem transfer. Implementations must never log the target.
abstract interface class MinistryAudioStemTransport {
  /// Failures are [AppFailure]s with the `AUDIO_TRANSFER_*` codes below.
  Future<MinistryAudioStemResponse> open(
    MinistryAudioTransferTarget target, {
    required String ministryId,
    required CancelToken cancelToken,
  });
}

abstract final class MinistryAudioTransferCodes {
  /// Signature/ticket no longer valid: ask `getPlayback` for fresh targets.
  static const String expired = 'AUDIO_TRANSFER_EXPIRED';
  static const String preconditionFailed = 'AUDIO_TRANSFER_PRECONDITION_FAILED';
  static const String redirectBlocked = 'AUDIO_TRANSFER_REDIRECT_BLOCKED';
  static const String failed = 'AUDIO_TRANSFER_FAILED';
  static const String cancelled = 'AUDIO_TRANSFER_CANCELLED';
}

/// Dio transport.
///
/// * `direct`: an isolated [Dio] with **no** interceptors, cookies or LouvAIO
///   credentials, redirects disabled, only validated `If-Match`.
/// * `legacy`: the authenticated [ApiClient] (its own origin only) and the
///   validated library path + ticket.
///
/// Bodies are streamed (`ResponseType.stream`); nothing is buffered here.
final class DioMinistryAudioTransport implements MinistryAudioStemTransport {
  DioMinistryAudioTransport({
    required ApiClient apiClient,
    required MinistryAudioTransferPolicy policy,
    Dio? directDio,
  })  : _apiClient = apiClient,
        _policy = policy,
        _directDio = directDio ?? _newDirectDio();

  final ApiClient _apiClient;
  final MinistryAudioTransferPolicy _policy;
  final Dio _directDio;

  static Dio _newDirectDio() => Dio(
        BaseOptions(
          connectTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 60),
          followRedirects: false,
          maxRedirects: 0,
          responseType: ResponseType.stream,
          validateStatus: (status) => status == 200,
        ),
      );

  void close() => _directDio.close(force: true);

  @override
  Future<MinistryAudioStemResponse> open(
    MinistryAudioTransferTarget target, {
    required String ministryId,
    required CancelToken cancelToken,
  }) async {
    final Future<Response<ResponseBody>> request;
    if (target.transfer == MinistryAudioTransfer.direct) {
      final uri = _policy.validateDirectUrl(target.url);
      final headers = _policy.validateHeaders(target.headers);
      request = _directDio.getUri<ResponseBody>(
        uri,
        cancelToken: cancelToken,
        options: Options(
          headers: {...headers, 'Accept-Encoding': 'identity'},
          followRedirects: false,
          maxRedirects: 0,
          responseType: ResponseType.stream,
          validateStatus: (status) => status == 200,
        ),
      );
    } else {
      final legacy =
          _policy.resolveLegacy(ministryId: ministryId, target: target);
      final session = _apiClient.sessionContextProvider?.call();
      if (session == null) {
        throw const AppFailure(
          message: 'Sessão expirada ou alternada durante a requisição.',
          statusCode: 401,
          code: 'SESSION_CHANGED',
        );
      }
      request = _apiClient.dio.get<ResponseBody>(
        legacy.path,
        queryParameters: {'ticket': legacy.ticket},
        cancelToken: cancelToken,
        options: Options(
          headers: {'Accept-Encoding': 'identity', 'Accept': 'audio/wav'},
          followRedirects: false,
          maxRedirects: 0,
          responseType: ResponseType.stream,
          validateStatus: (status) => status == 200,
          extra: {
            AuthInterceptor.sessionUserIdKey: session.userId,
            AuthInterceptor.sessionGenerationKey: session.sessionGeneration,
          },
        ),
      );
    }

    final Response<ResponseBody> response;
    try {
      response = await request;
    } on DioException catch (e) {
      throw _mapError(e);
    }
    final body = response.data;
    if (body == null) {
      throw const AppFailure(
        message: 'Resposta de transferência de áudio vazia.',
        code: MinistryAudioTransferCodes.failed,
      );
    }
    final rawLength = response.headers.value(Headers.contentLengthHeader);
    final length = rawLength == null ? null : int.tryParse(rawLength);
    if (rawLength != null && length == null) {
      throw const AppFailure(
        message: 'Tamanho de transferência de áudio inválido.',
        code: MinistryAudioTransferCodes.failed,
      );
    }
    return MinistryAudioStemResponse(body: body.stream, contentLength: length);
  }

  AppFailure _mapError(DioException e) {
    final inner = e.error;
    if (inner is AppFailure) return inner; // e.g. SESSION_CHANGED
    if (e.type == DioExceptionType.cancel) {
      return const AppFailure(
        message: 'Transferência de áudio cancelada.',
        code: MinistryAudioTransferCodes.cancelled,
      );
    }
    final status = e.response?.statusCode;
    if (status != null) {
      if (status >= 300 && status < 400) {
        return AppFailure(
          message: 'Redirecionamento de transferência de áudio bloqueado.',
          statusCode: status,
          code: MinistryAudioTransferCodes.redirectBlocked,
        );
      }
      if (status == 412) {
        return const AppFailure(
          message: 'O arquivo de áudio mudou durante a transferência.',
          statusCode: 412,
          code: MinistryAudioTransferCodes.preconditionFailed,
        );
      }
      if (status == 403) {
        return const AppFailure(
          message: 'A autorização temporária da transferência expirou.',
          statusCode: 403,
          code: MinistryAudioTransferCodes.expired,
        );
      }
      return AppFailure(
        message: 'Falha na transferência de áudio (HTTP $status).',
        statusCode: status,
        code: MinistryAudioTransferCodes.failed,
      );
    }
    return AppFailure.network(
      message: 'Falha de conexão na transferência de áudio.',
    );
  }
}
