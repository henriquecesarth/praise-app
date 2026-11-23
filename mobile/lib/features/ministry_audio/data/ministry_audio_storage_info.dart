import 'package:flutter/foundation.dart'
    show TargetPlatform, defaultTargetPlatform;

import '../../../core/errors/app_failure.dart';
import '../../rehearsal_packages/data/rehearsal_package_saf_channel.dart';
import '../domain/ministry_audio_models.dart';

/// Read-only storage query for the future ministry audio library.
///
/// Nothing here creates directories or writes files. The private root is only
/// *planned* (a pure path computation); it is derived from the app-private
/// files directory reported by the platform plus the authenticated user and the
/// ministry, never from any path supplied by the server.
abstract interface class MinistryAudioStorageInfoSource {
  Future<MinistryAudioStorageStatus> query();
}

final class MinistryAudioStorageStatus {
  static const String libraryDirName = 'ministry_audio_library';
  static final RegExp _userIdPattern = RegExp(r'^[A-Za-z0-9_-]{1,128}$');

  const MinistryAudioStorageStatus({
    required this.filesDirPath,
    required this.availableBytes,
    required this.totalBytes,
  });

  /// App-private files directory (platform provided).
  final String filesDirPath;
  final int availableBytes;
  final int totalBytes;

  /// Planned private root: `<filesDir>/ministry_audio_library/users/<userId>/
  /// ministries/<ministryId>`. Distinct from the rehearsal package storage
  /// (`<filesDir>/rehearsal_packages/...`). Pure: no I/O.
  String privateRootFor({required String userId, required String ministryId}) {
    if (!_userIdPattern.hasMatch(userId) ||
        !MinistryAudioContract.ministryIdPattern.hasMatch(ministryId)) {
      throw const AppFailure(
        message: 'Identificador inválido para o armazenamento de áudio.',
        statusCode: 400,
        code: 'AUDIO_STORAGE_INVALID_SCOPE',
      );
    }
    final base = filesDirPath;
    if (!base.startsWith('/') ||
        base.split('/').contains('..') ||
        base.contains('\u0000')) {
      throw const AppFailure(
        message: 'Diretório privado do app inválido.',
        code: 'AUDIO_STORAGE_INVALID_ROOT',
      );
    }
    final trimmed = base.endsWith('/') ? base.substring(0, base.length - 1) : base;
    return '$trimmed/$libraryDirName/users/$userId/ministries/$ministryId';
  }
}

/// Android implementation reusing the existing [RehearsalPackageSafPort]
/// (single native channel adapter; no second MethodChannel is created).
///
/// Platforms other than Android fail explicitly: the equivalent iOS bridge is
/// not confirmed yet, so no guess is made.
final class SafMinistryAudioStorageInfoSource
    implements MinistryAudioStorageInfoSource {
  static const String unsupportedPlatformCode =
      'AUDIO_STORAGE_UNSUPPORTED_PLATFORM';
  static const String unavailableCode = 'AUDIO_STORAGE_UNAVAILABLE';

  SafMinistryAudioStorageInfoSource({
    required RehearsalPackageSafPort port,
    TargetPlatform Function()? platform,
  })  : _port = port,
        _platform = platform ?? (() => defaultTargetPlatform);

  final RehearsalPackageSafPort _port;
  final TargetPlatform Function() _platform;

  @override
  Future<MinistryAudioStorageStatus> query() async {
    if (_platform() != TargetPlatform.android) {
      throw const AppFailure(
        message:
            'O armazenamento da biblioteca de áudio ainda não é suportado nesta plataforma.',
        code: unsupportedPlatformCode,
      );
    }
    final SafStorageInfo info;
    try {
      info = await _port.getStorageInfo();
    } on SafChannelException {
      throw const AppFailure(
        message: 'Não foi possível consultar o armazenamento do aparelho.',
        code: unavailableCode,
      );
    }
    if (info.availableBytes < 0 ||
        info.totalBytes < 0 ||
        info.availableBytes > info.totalBytes) {
      throw const AppFailure(
        message: 'Informação de armazenamento inválida.',
        code: unavailableCode,
      );
    }
    return MinistryAudioStorageStatus(
      filesDirPath: info.filesDirPath,
      availableBytes: info.availableBytes,
      totalBytes: info.totalBytes,
    );
  }
}
