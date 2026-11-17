import 'dart:collection' show UnmodifiableMapView;

/// Integrity verification state of a locally imported rehearsal package.
enum RehearsalPackageIntegrityState {
  verified,
  corrupted,
  incomplete,
  missingFiles,
  unverified,
}

/// Binding state of a local rehearsal package.
///
/// Informative only in T8: local rehearsal packages never bind to `SongVersion`.
enum RehearsalPackageBindingState {
  unlinked,
}

/// Lifecycle phases reported during local rehearsal package operations.
enum RehearsalOperationPhase {
  idle,
  picking,
  preflight,
  stagingCopy,
  validating,
  extracting,
  committing,
  revalidating,
  exporting,
  deleting,
}

/// User-facing outcome categories for local rehearsal package operations.
enum RehearsalUserOutcomeCategory {
  imported,
  idempotentNoop,
  conflict,
  incompatible,
  corrupted,
  insufficientSpace,
  cancelled,
  exported,
  deleted,
  renamed,
  revalidated,
  recoverableFailure,
}

/// Metadata for a single validated audio stem or optional original track stored
/// inside the app-private rehearsal package directory.
final class LocalRehearsalStemMetadata {
  const LocalRehearsalStemMetadata({
    required this.id,
    required this.internalFileName,
    required this.container,
    required this.codec,
    required this.byteLength,
    required this.sha256,
    required this.decodedFrames,
    required this.sampleRate,
    required this.channels,
  });

  final String id;
  final String internalFileName;
  final String container;
  final String codec;
  final int byteLength;
  final String sha256;
  final int decodedFrames;
  final int sampleRate;
  final int channels;

  Map<String, Object?> toJson() => {
        'id': id,
        'internalFileName': internalFileName,
        'container': container,
        'codec': codec,
        'byteLength': byteLength,
        'sha256': sha256,
        'decodedFrames': decodedFrames,
        'sampleRate': sampleRate,
        'channels': channels,
      };

  factory LocalRehearsalStemMetadata.fromJson(Map<String, dynamic> json) {
    return LocalRehearsalStemMetadata(
      id: _requireString(json, 'id'),
      internalFileName: _requireString(json, 'internalFileName'),
      container: _requireString(json, 'container'),
      codec: _requireString(json, 'codec'),
      byteLength: _requireInt(json, 'byteLength'),
      sha256: _requireString(json, 'sha256'),
      decodedFrames: _requireInt(json, 'decodedFrames'),
      sampleRate: _requireInt(json, 'sampleRate'),
      channels: _requireInt(json, 'channels'),
    );
  }
}

/// Durable metadata record persisted in the account-scoped `index.json`.
///
/// Stores strictly metadata — never raw audio bytes or Base64 blobs.
final class LocalRehearsalPackageRecord {
  LocalRehearsalPackageRecord({
    required this.packageId,
    required this.accountNamespaceHash,
    required this.revision,
    required this.title,
    this.customLabel,
    required this.format,
    required this.formatVersion,
    required this.createdAt,
    required this.importedAt,
    required this.lastValidatedAt,
    required this.integrityState,
    this.integrityCode,
    this.integrityMessage,
    required this.sampleRate,
    required this.channels,
    required this.totalFrames,
    required this.durationSeconds,
    required this.archiveBytes,
    required this.extractedBytes,
    required this.totalOccupiedBytes,
    required this.manifestSha256,
    required this.compositeSha256,
    required Map<String, LocalRehearsalStemMetadata> stems,
    this.original,
    this.storageLocationLabel = defaultStorageLocationLabel,
    required this.relativeDirectory,
    this.bindingState = RehearsalPackageBindingState.unlinked,
    required this.usageRightsDeclaration,
  }) : stems = UnmodifiableMapView(_orderRequiredStems(stems));

  static const String defaultStorageLocationLabel =
      'Armazenamento interno privado do app';

  static const List<String> requiredStemOrder = [
    'vocals',
    'drums',
    'bass',
    'other',
  ];

  final String packageId;
  final String accountNamespaceHash;
  final int revision;
  final String title;
  final String? customLabel;
  final String format;
  final int formatVersion;
  final String createdAt;
  final String importedAt;
  final String lastValidatedAt;
  final RehearsalPackageIntegrityState integrityState;
  final String? integrityCode;
  final String? integrityMessage;
  final int sampleRate;
  final int channels;
  final int totalFrames;
  final double durationSeconds;
  final int archiveBytes;
  final int extractedBytes;
  final int totalOccupiedBytes;
  final String manifestSha256;
  final String compositeSha256;
  final Map<String, LocalRehearsalStemMetadata> stems;
  final LocalRehearsalStemMetadata? original;
  final String storageLocationLabel;
  final String relativeDirectory;
  final RehearsalPackageBindingState bindingState;
  final String usageRightsDeclaration;

  String get displayName =>
      customLabel != null && customLabel!.trim().isNotEmpty
          ? customLabel!.trim()
          : title;

  bool get isReadyForLocalUse =>
      integrityState == RehearsalPackageIntegrityState.verified;

  LocalRehearsalPackageRecord copyWith({
    String? title,
    String? customLabel,
    bool clearCustomLabel = false,
    String? lastValidatedAt,
    RehearsalPackageIntegrityState? integrityState,
    String? integrityCode,
    bool clearIntegrityCode = false,
    String? integrityMessage,
    bool clearIntegrityMessage = false,
  }) {
    return LocalRehearsalPackageRecord(
      packageId: packageId,
      accountNamespaceHash: accountNamespaceHash,
      revision: revision,
      title: title ?? this.title,
      customLabel:
          clearCustomLabel ? null : (customLabel ?? this.customLabel),
      format: format,
      formatVersion: formatVersion,
      createdAt: createdAt,
      importedAt: importedAt,
      lastValidatedAt: lastValidatedAt ?? this.lastValidatedAt,
      integrityState: integrityState ?? this.integrityState,
      integrityCode:
          clearIntegrityCode ? null : (integrityCode ?? this.integrityCode),
      integrityMessage: clearIntegrityMessage
          ? null
          : (integrityMessage ?? this.integrityMessage),
      sampleRate: sampleRate,
      channels: channels,
      totalFrames: totalFrames,
      durationSeconds: durationSeconds,
      archiveBytes: archiveBytes,
      extractedBytes: extractedBytes,
      totalOccupiedBytes: totalOccupiedBytes,
      manifestSha256: manifestSha256,
      compositeSha256: compositeSha256,
      stems: stems,
      original: original,
      storageLocationLabel: storageLocationLabel,
      relativeDirectory: relativeDirectory,
      bindingState: bindingState,
      usageRightsDeclaration: usageRightsDeclaration,
    );
  }

  Map<String, Object?> toJson() => {
        'packageId': packageId,
        'accountNamespaceHash': accountNamespaceHash,
        'revision': revision,
        'title': title,
        'customLabel': customLabel,
        'format': format,
        'formatVersion': formatVersion,
        'createdAt': createdAt,
        'importedAt': importedAt,
        'lastValidatedAt': lastValidatedAt,
        'integrityState': integrityState.name,
        'integrityCode': integrityCode,
        'integrityMessage': integrityMessage,
        'sampleRate': sampleRate,
        'channels': channels,
        'totalFrames': totalFrames,
        'durationSeconds': durationSeconds,
        'archiveBytes': archiveBytes,
        'extractedBytes': extractedBytes,
        'totalOccupiedBytes': totalOccupiedBytes,
        'manifestSha256': manifestSha256,
        'compositeSha256': compositeSha256,
        'stems': {
          for (final stemId in requiredStemOrder)
            if (stems[stemId] != null) stemId: stems[stemId]!.toJson(),
        },
        'original': original?.toJson(),
        'storageLocationLabel': storageLocationLabel,
        'relativeDirectory': relativeDirectory,
        'bindingState': bindingState.name,
        'usageRightsDeclaration': usageRightsDeclaration,
      };

  factory LocalRehearsalPackageRecord.fromJson(Map<String, dynamic> json) {
    final rawStems = json['stems'];
    if (rawStems is! Map<String, dynamic>) {
      throw const FormatException('Invalid stems map in LocalRehearsalPackageRecord');
    }
    final parsedStems = <String, LocalRehearsalStemMetadata>{};
    for (final stemId in requiredStemOrder) {
      final rawStem = rawStems[stemId];
      if (rawStem is! Map<String, dynamic>) {
        throw FormatException('Missing required stem "$stemId" in index record');
      }
      parsedStems[stemId] = LocalRehearsalStemMetadata.fromJson(rawStem);
    }

    final rawOriginal = json['original'];
    final parsedOriginal = rawOriginal is Map<String, dynamic>
        ? LocalRehearsalStemMetadata.fromJson(rawOriginal)
        : null;

    final rawIntegrity = _requireString(json, 'integrityState');
    final integrityState = RehearsalPackageIntegrityState.values.firstWhere(
      (value) => value.name == rawIntegrity,
      orElse: () => RehearsalPackageIntegrityState.unverified,
    );

    final rawBinding = json['bindingState'] as String?;
    final bindingState = RehearsalPackageBindingState.values.firstWhere(
      (value) => value.name == rawBinding,
      orElse: () => RehearsalPackageBindingState.unlinked,
    );

    return LocalRehearsalPackageRecord(
      packageId: _requireString(json, 'packageId'),
      accountNamespaceHash: _requireString(json, 'accountNamespaceHash'),
      revision: _requireInt(json, 'revision'),
      title: _requireString(json, 'title'),
      customLabel: json['customLabel'] as String?,
      format: _requireString(json, 'format'),
      formatVersion: _requireInt(json, 'formatVersion'),
      createdAt: _requireString(json, 'createdAt'),
      importedAt: _requireString(json, 'importedAt'),
      lastValidatedAt: _requireString(json, 'lastValidatedAt'),
      integrityState: integrityState,
      integrityCode: json['integrityCode'] as String?,
      integrityMessage: json['integrityMessage'] as String?,
      sampleRate: _requireInt(json, 'sampleRate'),
      channels: _requireInt(json, 'channels'),
      totalFrames: _requireInt(json, 'totalFrames'),
      durationSeconds: _requireDouble(json, 'durationSeconds'),
      archiveBytes: _requireInt(json, 'archiveBytes'),
      extractedBytes: _requireInt(json, 'extractedBytes'),
      totalOccupiedBytes: _requireInt(json, 'totalOccupiedBytes'),
      manifestSha256: _requireString(json, 'manifestSha256'),
      compositeSha256: _requireString(json, 'compositeSha256'),
      stems: parsedStems,
      original: parsedOriginal,
      storageLocationLabel: (json['storageLocationLabel'] as String?) ??
          defaultStorageLocationLabel,
      relativeDirectory: _requireString(json, 'relativeDirectory'),
      bindingState: bindingState,
      usageRightsDeclaration: _requireString(json, 'usageRightsDeclaration'),
    );
  }

  static Map<String, LocalRehearsalStemMetadata> _orderRequiredStems(
    Map<String, LocalRehearsalStemMetadata> input,
  ) {
    final ordered = <String, LocalRehearsalStemMetadata>{};
    for (final stemId in requiredStemOrder) {
      final stem = input[stemId];
      if (stem != null) {
        ordered[stemId] = stem;
      }
    }
    return ordered;
  }
}

/// Real-time progress snapshot emitted during import, revalidation, or export.
final class RehearsalOperationProgress {
  const RehearsalOperationProgress({
    required this.operationId,
    required this.phase,
    required this.phaseLabel,
    required this.bytesProcessed,
    this.totalBytes,
    this.detailMessage,
  });

  final String operationId;
  final RehearsalOperationPhase phase;
  final String phaseLabel;
  final int bytesProcessed;
  final int? totalBytes;
  final String? detailMessage;
}

/// Details presented to the user when an incoming package shares `packageId`
/// with an existing package but has a different content hash or revision.
final class RehearsalConflictDetails {
  const RehearsalConflictDetails({
    required this.packageId,
    required this.pendingTransactionId,
    required this.existingRecord,
    required this.incomingDisplayName,
    required this.incomingRevision,
    required this.incomingCompositeSha256,
  });

  final String packageId;
  final String pendingTransactionId;
  final LocalRehearsalPackageRecord existingRecord;
  final String incomingDisplayName;
  final int incomingRevision;
  final String incomingCompositeSha256;
}

/// Account-scoped internal storage telemetry for rehearsal packages.
final class RehearsalStorageSummary {
  const RehearsalStorageSummary({
    required this.accountNamespaceHash,
    required this.filesDirPath,
    required this.availableBytes,
    required this.totalBytes,
    required this.occupiedByAccountBytes,
    required this.requiredReserveBytes,
    required this.packageCount,
  });

  final String accountNamespaceHash;
  final String filesDirPath;
  final int availableBytes;
  final int totalBytes;
  final int occupiedByAccountBytes;
  final int requiredReserveBytes;
  final int packageCount;
}

/// Loaded library state for a specific authenticated account namespace.
final class RehearsalLibrarySnapshot {
  const RehearsalLibrarySnapshot({
    required this.packages,
    required this.storageSummary,
    required this.recoveredOrphanedCount,
    required this.corruptedOrIncompleteCount,
  });

  final List<LocalRehearsalPackageRecord> packages;
  final RehearsalStorageSummary storageSummary;
  final int recoveredOrphanedCount;
  final int corruptedOrIncompleteCount;
}

/// Structured outcome returned by transactional manager commands.
final class RehearsalOperationOutcome {
  const RehearsalOperationOutcome({
    required this.category,
    required this.title,
    required this.message,
    this.errorCode,
    this.record,
    this.conflict,
    this.recoveredOrphanedCount = 0,
  });

  final RehearsalUserOutcomeCategory category;
  final String title;
  final String message;
  final String? errorCode;
  final LocalRehearsalPackageRecord? record;
  final RehearsalConflictDetails? conflict;
  final int recoveredOrphanedCount;
}

String _requireString(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is! String || value.isEmpty) {
    throw FormatException('Missing or invalid string "$key"');
  }
  return value;
}

int _requireInt(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is int) return value;
  if (value is num) return value.toInt();
  throw FormatException('Missing or invalid int "$key"');
}

double _requireDouble(Map<String, dynamic> json, String key) {
  final value = json[key];
  if (value is num) return value.toDouble();
  throw FormatException('Missing or invalid double "$key"');
}
