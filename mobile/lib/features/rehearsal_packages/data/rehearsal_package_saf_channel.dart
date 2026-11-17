import 'dart:async';

import 'package:flutter/services.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';

/// Exception thrown when querying or invoking the native SAF bridge fails
/// unexpectedly (for example, missing platform implementation on unsupported OS).
final class SafChannelException implements Exception {
  const SafChannelException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'SafChannelException($code): $message';
}

/// Internal app-private storage snapshot returned by the native SAF bridge.
final class SafStorageInfo {
  const SafStorageInfo({
    required this.filesDirPath,
    required this.availableBytes,
    required this.totalBytes,
  });

  final String filesDirPath;
  final int availableBytes;
  final int totalBytes;

  factory SafStorageInfo.fromMap(Map<Object?, Object?> map) {
    final filesDirPath = map['filesDirPath'];
    final availableBytes = map['availableBytes'];
    final totalBytes = map['totalBytes'];
    if (filesDirPath is! String ||
        filesDirPath.isEmpty ||
        availableBytes is! num ||
        totalBytes is! num) {
      throw const SafChannelException(
        'STORAGE_INFO_INVALID',
        'Resposta inválida ao consultar armazenamento interno.',
      );
    }
    return SafStorageInfo(
      filesDirPath: filesDirPath,
      availableBytes: availableBytes.toInt(),
      totalBytes: totalBytes.toInt(),
    );
  }
}

/// Result status returned by `pickAndStagePackage`.
enum SafStageStatus {
  staged,
  cancelled,
  error,
}

/// Result of picking an external archive via SAF and copying it into staging.
final class SafStageResult {
  const SafStageResult({
    required this.status,
    this.stagedFilePath,
    this.bytesCopied,
    this.untrustedDisplayName,
    this.untrustedDeclaredSize,
    this.availableBytesAfter,
    this.code,
    this.message,
  });

  final SafStageStatus status;
  final String? stagedFilePath;
  final int? bytesCopied;
  final String? untrustedDisplayName;
  final int? untrustedDeclaredSize;
  final int? availableBytesAfter;
  final String? code;
  final String? message;

  factory SafStageResult.fromMap(Map<Object?, Object?> map) {
    final rawStatus = map['status'];
    final status = switch (rawStatus) {
      'staged' => SafStageStatus.staged,
      'cancelled' => SafStageStatus.cancelled,
      _ => SafStageStatus.error,
    };

    return SafStageResult(
      status: status,
      stagedFilePath: map['stagedFilePath'] as String?,
      bytesCopied: (map['bytesCopied'] as num?)?.toInt(),
      untrustedDisplayName: map['untrustedDisplayName'] as String?,
      untrustedDeclaredSize: (map['untrustedDeclaredSize'] as num?)?.toInt(),
      availableBytesAfter: (map['availableBytesAfter'] as num?)?.toInt(),
      code: map['code'] as String?,
      message: map['message'] as String?,
    );
  }
}

/// Result status returned by `exportPackageToUri`.
enum SafExportStatus {
  exported,
  cancelled,
  error,
}

/// Result of exporting a validated internal archive to an external SAF URI.
final class SafExportResult {
  const SafExportResult({
    required this.status,
    this.bytesWritten,
    this.code,
    this.message,
  });

  final SafExportStatus status;
  final int? bytesWritten;
  final String? code;
  final String? message;

  factory SafExportResult.fromMap(Map<Object?, Object?> map) {
    final rawStatus = map['status'];
    final status = switch (rawStatus) {
      'exported' => SafExportStatus.exported,
      'cancelled' => SafExportStatus.cancelled,
      _ => SafExportStatus.error,
    };

    return SafExportResult(
      status: status,
      bytesWritten: (map['bytesWritten'] as num?)?.toInt(),
      code: map['code'] as String?,
      message: map['message'] as String?,
    );
  }
}

/// Streaming byte progress event emitted by the native SAF handler.
final class SafProgressEvent {
  const SafProgressEvent({
    required this.operationId,
    required this.phase,
    required this.bytesProcessed,
    this.totalBytes,
  });

  final String operationId;
  final String phase;
  final int bytesProcessed;
  final int? totalBytes;

  factory SafProgressEvent.fromMap(Map<Object?, Object?> map) {
    return SafProgressEvent(
      operationId: (map['operationId'] as String?) ?? '',
      phase: (map['phase'] as String?) ?? '',
      bytesProcessed: (map['bytesProcessed'] as num?)?.toInt() ?? 0,
      totalBytes: (map['totalBytes'] as num?)?.toInt(),
    );
  }
}

/// Port abstracting native SAF file picking, staging copy, export, and storage query.
abstract interface class RehearsalPackageSafPort {
  Stream<SafProgressEvent> get progressStream;

  Future<SafStorageInfo> getStorageInfo();

  Future<SafStageResult> pickAndStagePackage({
    required String operationId,
    required String targetStageFilePath,
    int maxBytes = RehearsalLimitsV1.maxCompressedBytes,
    int requiredReserveBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes,
  });

  Future<SafExportResult> exportPackageToUri({
    required String operationId,
    required String sourceFilePath,
    required String suggestedFileName,
  });

  Future<bool> cancelOperation({String? operationId});
}

/// Flutter [MethodChannel] implementation of [RehearsalPackageSafPort] backed by
/// Android `RehearsalPackageSafHandler`.
final class MethodChannelRehearsalPackageSafAdapter
    implements RehearsalPackageSafPort {
  MethodChannelRehearsalPackageSafAdapter({
    MethodChannel? channel,
  }) : _channel = channel ?? const MethodChannel(channelName) {
    _channel.setMethodCallHandler(_handleNativeCall);
  }

  static const String channelName = 'com.louvaio.mobile/rehearsal_package_saf';

  final MethodChannel _channel;
  final StreamController<SafProgressEvent> _progressController =
      StreamController<SafProgressEvent>.broadcast();
  bool _disposed = false;

  @override
  Stream<SafProgressEvent> get progressStream => _progressController.stream;

  Future<void> _handleNativeCall(MethodCall call) async {
    if (_disposed) return;
    if (call.method == 'onOperationProgress' &&
        call.arguments is Map<Object?, Object?>) {
      final event = SafProgressEvent.fromMap(
        call.arguments as Map<Object?, Object?>,
      );
      if (!_progressController.isClosed) {
        _progressController.add(event);
      }
    }
  }

  @override
  Future<SafStorageInfo> getStorageInfo() async {
    try {
      final raw = await _channel.invokeMapMethod<Object?, Object?>(
        'getStorageInfo',
      );
      if (raw == null) {
        throw const SafChannelException(
          'STORAGE_INFO_EMPTY',
          'Resposta vazia ao consultar armazenamento interno.',
        );
      }
      return SafStorageInfo.fromMap(raw);
    } on SafChannelException {
      rethrow;
    } on MissingPluginException {
      throw const SafChannelException(
        'SAF_UNAVAILABLE',
        'Recurso nativo de armazenamento não está disponível nesta plataforma.',
      );
    } on PlatformException catch (ex) {
      throw SafChannelException(
        ex.code,
        ex.message ?? 'Falha ao consultar armazenamento interno.',
      );
    }
  }

  @override
  Future<SafStageResult> pickAndStagePackage({
    required String operationId,
    required String targetStageFilePath,
    int maxBytes = RehearsalLimitsV1.maxCompressedBytes,
    int requiredReserveBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes,
  }) async {
    try {
      final raw = await _channel.invokeMapMethod<Object?, Object?>(
        'pickAndStagePackage',
        {
          'operationId': operationId,
          'targetStageFilePath': targetStageFilePath,
          'maxBytes': maxBytes,
          'requiredReserveBytes': requiredReserveBytes,
        },
      );
      if (raw == null) {
        return const SafStageResult(
          status: SafStageStatus.error,
          code: 'EMPTY_CHANNEL_RESPONSE',
          message: 'Resposta vazia do seletor de arquivos.',
        );
      }
      return SafStageResult.fromMap(raw);
    } on MissingPluginException {
      return const SafStageResult(
        status: SafStageStatus.error,
        code: 'SAF_UNAVAILABLE',
        message:
            'Importação de arquivos não está disponível neste dispositivo/plataforma.',
      );
    } on PlatformException catch (ex) {
      return SafStageResult(
        status: SafStageStatus.error,
        code: ex.code,
        message: ex.message ?? 'Falha ao copiar arquivo selecionado.',
      );
    }
  }

  @override
  Future<SafExportResult> exportPackageToUri({
    required String operationId,
    required String sourceFilePath,
    required String suggestedFileName,
  }) async {
    try {
      final raw = await _channel.invokeMapMethod<Object?, Object?>(
        'exportPackageToUri',
        {
          'operationId': operationId,
          'sourceFilePath': sourceFilePath,
          'suggestedFileName': suggestedFileName,
        },
      );
      if (raw == null) {
        return const SafExportResult(
          status: SafExportStatus.error,
          code: 'EMPTY_CHANNEL_RESPONSE',
          message: 'Resposta vazia do seletor de destino.',
        );
      }
      return SafExportResult.fromMap(raw);
    } on MissingPluginException {
      return const SafExportResult(
        status: SafExportStatus.error,
        code: 'SAF_UNAVAILABLE',
        message:
            'Exportação de arquivos não está disponível neste dispositivo/plataforma.',
      );
    } on PlatformException catch (ex) {
      return SafExportResult(
        status: SafExportStatus.error,
        code: ex.code,
        message: ex.message ?? 'Falha ao exportar pacote de ensaio.',
      );
    }
  }

  @override
  Future<bool> cancelOperation({String? operationId}) async {
    try {
      final cancelled = await _channel.invokeMethod<bool>(
        'cancelOperation',
        {
          if (operationId != null) 'operationId': operationId,
        },
      );
      return cancelled ?? false;
    } on MissingPluginException {
      return false;
    } on PlatformException {
      return false;
    }
  }

  Future<void> dispose() async {
    _disposed = true;
    _channel.setMethodCallHandler(null);
    await _progressController.close();
  }
}
