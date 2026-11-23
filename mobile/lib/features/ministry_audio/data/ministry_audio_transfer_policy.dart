import '../../../app/environment/app_environment.dart';
import '../../../core/errors/app_failure.dart';
import '../domain/ministry_audio_models.dart';

/// Decides which transfer targets the app may contact and with which headers.
///
/// Fail-closed: a target that is not explicitly trusted is rejected before any
/// request is made. Nothing from a target is ever logged.
final class MinistryAudioTransferPolicy {
  static const String rejectedCode = 'AUDIO_TRANSFER_REJECTED';
  static const String headerRejectedCode = 'AUDIO_TRANSFER_HEADER_REJECTED';

  static const String simulatorObjectPrefix =
      '/api/local/ministry-audio-objects/';

  /// Cloudflare R2 S3 endpoint used by the backend signer:
  /// `https://<accountId>.r2.cloudflarestorage.com`.
  static final RegExp defaultTrustedHttpsHost =
      RegExp(r'^[a-z0-9-]{1,64}\.r2\.cloudflarestorage\.com$');

  static const Set<String> _loopbackHosts = {
    'localhost',
    '127.0.0.1',
    '10.0.2.2', // Android emulator alias of the host loopback.
  };

  /// Only header the backend ever signs for reads (`signDownload`).
  static const Set<String> _allowedHeaders = {'if-match'};
  static final RegExp _headerValuePattern = RegExp(r'^[\x21-\x7E]{1,200}$');
  static final RegExp _ticketPattern =
      RegExp(r'^\d{1,16}\.[A-Za-z0-9_-]{43}$');

  const MinistryAudioTransferPolicy({
    this.allowLocalHttp = false,
    RegExp? trustedHttpsHost,
  }) : _trustedHttpsHost = trustedHttpsHost;

  /// Local http simulator objects (loopback only). Must be `false` outside
  /// development.
  final bool allowLocalHttp;
  final RegExp? _trustedHttpsHost;

  /// Local loopback http is enabled only in the development environment.
  factory MinistryAudioTransferPolicy.forEnvironment(AppEnvironment env) =>
      MinistryAudioTransferPolicy(allowLocalHttp: env.isDevelopment);

  AppFailure _rejected(String what) => AppFailure(
        message: 'Origem de transferência de áudio não permitida ($what).',
        code: rejectedCode,
      );

  /// Validates a `direct` target and returns its parsed [Uri].
  Uri validateDirectUrl(String url) {
    final uri = Uri.tryParse(url);
    if (uri == null ||
        !uri.hasAuthority ||
        uri.host.isEmpty ||
        uri.userInfo.isNotEmpty ||
        uri.hasFragment) {
      throw _rejected('formato');
    }
    final host = uri.host.toLowerCase();
    if (uri.scheme == 'https') {
      final trusted = _trustedHttpsHost ?? defaultTrustedHttpsHost;
      if (!trusted.hasMatch(host)) throw _rejected('host');
      if (uri.hasPort && uri.port != 443) throw _rejected('porta');
      return uri;
    }
    if (uri.scheme == 'http' &&
        allowLocalHttp &&
        _loopbackHosts.contains(host) &&
        uri.path.startsWith(simulatorObjectPrefix)) {
      return uri;
    }
    throw _rejected('esquema');
  }

  /// Keeps only headers the backend legitimately signs (`If-Match`); anything
  /// else, notably `Authorization` and `Cookie`, is rejected.
  Map<String, String> validateHeaders(Map<String, String> headers) {
    final out = <String, String>{};
    for (final entry in headers.entries) {
      final name = entry.key.toLowerCase();
      if (!_allowedHeaders.contains(name) ||
          !_headerValuePattern.hasMatch(entry.value)) {
        throw const AppFailure(
          message: 'Cabeçalho de transferência de áudio não permitido.',
          code: headerRejectedCode,
        );
      }
      out[name] = entry.value;
    }
    return out;
  }

  /// Resolves a legacy target to the authenticated API path and ticket.
  ///
  /// Only the validated library path and ticket are used; the origin is always
  /// the authenticated API's own (the caller's `baseUrl`).
  ({String path, String ticket}) resolveLegacy({
    required String ministryId,
    required MinistryAudioTransferTarget target,
  }) {
    if (!MinistryAudioContract.ministryIdPattern.hasMatch(ministryId)) {
      throw _rejected('ministério');
    }
    final uri = Uri.tryParse(target.url);
    if (uri == null ||
        uri.hasScheme ||
        uri.hasAuthority ||
        uri.hasFragment ||
        uri.queryParameters.length != 1) {
      throw _rejected('formato legado');
    }
    final ticket = uri.queryParameters['ticket'];
    final expected = RegExp(
      '^/[a-f0-9]{64}/stems/${target.id.name}\$',
    );
    if (ticket == null ||
        !_ticketPattern.hasMatch(ticket) ||
        !expected.hasMatch(uri.path)) {
      throw _rejected('caminho legado');
    }
    return (
      path: '/ministries/${Uri.encodeComponent(ministryId)}/audio-library${uri.path}',
      ticket: ticket,
    );
  }

  /// Validates and normalizes any target; returns request headers for direct.
  void validateTarget(MinistryAudioTransferTarget target, String ministryId) {
    if (target.transfer == MinistryAudioTransfer.direct) {
      validateDirectUrl(target.url);
      validateHeaders(target.headers);
    } else {
      resolveLegacy(ministryId: ministryId, target: target);
      if (target.headers.isNotEmpty) validateHeaders(target.headers);
    }
  }
}
