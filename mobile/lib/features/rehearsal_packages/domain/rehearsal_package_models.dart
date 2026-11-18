import 'dart:collection' show UnmodifiableListView, UnmodifiableMapView;

import '../../repertoire/domain/song_detail.dart';

/// Canonical version ID pattern shared with backend (`SAFE_VERSION_ID_REGEX`)
/// and Smart Chords: allows legacy spaces while blocking control chars, path
/// separators, query/fragment delimiters, and HTML brackets (1..150 chars).
final RegExp safeVersionIdRegex = RegExp(r'^[^\x00-\x1F\x7F/\\?#&%<>]{1,150}$');

/// Integrity verification state of a locally imported rehearsal package.
enum RehearsalPackageIntegrityState {
  verified,
  corrupted,
  incomplete,
  missingFiles,
  unverified,
}

/// Binding state of a local rehearsal package.
enum RehearsalPackageBindingState {
  unlinked,
  linked,
}

/// Asset role selected when binding a local rehearsal package to a `SongVersion`.
enum RehearsalAssetId {
  original('original'),
  stemsBundleV1('stems_bundle_v1');

  const RehearsalAssetId(this.wireValue);

  final String wireValue;

  static RehearsalAssetId fromWireValue(String raw) {
    return switch (raw) {
      'original' => RehearsalAssetId.original,
      'stems_bundle_v1' || 'stemsBundleV1' => RehearsalAssetId.stemsBundleV1,
      _ => throw FormatException('Invalid RehearsalAssetId "$raw"'),
    };
  }
}

/// Lifecycle validity state for an account + ministry-scoped local binding.
enum LocalBindingValidityState {
  valid('valid'),
  packageMissing('package_missing'),
  packageReplacedIncompatible('package_replaced_incompatible'),
  packageCorrupted('package_corrupted'),
  versionRemoved('version_removed'),
  unsupportedCodec('unsupported_codec');

  const LocalBindingValidityState(this.wireValue);

  final String wireValue;

  static LocalBindingValidityState fromWireValue(String raw) {
    return switch (raw) {
      'valid' => LocalBindingValidityState.valid,
      'package_missing' || 'packageMissing' => LocalBindingValidityState.packageMissing,
      'package_replaced_incompatible' ||
      'packageReplacedIncompatible' =>
        LocalBindingValidityState.packageReplacedIncompatible,
      'package_corrupted' || 'packageCorrupted' => LocalBindingValidityState.packageCorrupted,
      'version_removed' || 'versionRemoved' => LocalBindingValidityState.versionRemoved,
      'unsupported_codec' || 'unsupportedCodec' => LocalBindingValidityState.unsupportedCodec,
      _ => throw FormatException('Invalid LocalBindingValidityState "$raw"'),
    };
  }
}

/// Status of canonical `SongVersion` resolution.
enum CanonicalVersionResolutionStatus {
  resolved,
  versionRequired,
  versionNotFound,
}

/// Canonical representation of an effective `SongVersion` for local bindings.
final class CanonicalSongVersion {
  const CanonicalSongVersion({
    required this.id,
    required this.name,
    this.key,
    required this.isSynthetic,
  });

  final String id;
  final String name;
  final String? key;
  final bool isSynthetic;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CanonicalSongVersion &&
          runtimeType == other.runtimeType &&
          id == other.id &&
          name == other.name &&
          key == other.key &&
          isSynthetic == other.isSynthetic;

  @override
  int get hashCode => Object.hash(id, name, key, isSynthetic);
}

/// Outcome of resolving a requested version ID against a [SongDetail].
final class CanonicalSongVersionResolution {
  CanonicalSongVersionResolution({
    required this.status,
    this.version,
    required List<CanonicalSongVersion> effectiveVersions,
  }) : effectiveVersions = UnmodifiableListView(effectiveVersions);

  final CanonicalVersionResolutionStatus status;
  final CanonicalSongVersion? version;
  final List<CanonicalSongVersion> effectiveVersions;

  String? get versionId => version?.id;

  bool get isResolved =>
      status == CanonicalVersionResolutionStatus.resolved && version != null;
}

/// Extracts canonical effective versions from [song], preserving insertion order,
/// excluding ambiguous IDs, and retaining locally synthesized legacy provenance.
List<CanonicalSongVersion> extractCanonicalSongVersions(SongDetail song) {
  if (song.id.trim().isEmpty) return const [];
  final versions = song.effectiveVersions;
  final counts = <String, int>{};
  for (final version in versions) {
    final id = version.id?.trim() ?? '';
    counts[id] = (counts[id] ?? 0) + 1;
  }
  final explicit = <CanonicalSongVersion>[];

  for (final rawVersion in versions) {
    final trimmedId = rawVersion.id?.trim() ?? '';
    if (trimmedId.isEmpty ||
        !safeVersionIdRegex.hasMatch(trimmedId) ||
        counts[trimmedId] != 1) {
      continue;
    }
    final trimmedName = rawVersion.name.trim().isNotEmpty
        ? rawVersion.name.trim()
        : 'Original';
    final rawKey = rawVersion.key?.trim();
    final fallbackKey = song.originalKey?.trim();
    final resolvedKey = (rawKey != null && rawKey.isNotEmpty)
        ? rawKey
        : ((fallbackKey != null && fallbackKey.isNotEmpty)
              ? fallbackKey
              : null);
    explicit.add(
      CanonicalSongVersion(
        id: trimmedId,
        name: trimmedName,
        key: resolvedKey,
        isSynthetic: rawVersion.isLegacySynthetic,
      ),
    );
  }

  return List<CanonicalSongVersion>.unmodifiable(explicit);
}

/// Resolves [requestedVersionId] against [song] using strict TS/Dart parity:
/// - Never silently falls back to index 0 when ambiguous (`versionRequired`)
///   or missing (`versionNotFound`).
/// - Legacy `'v1'` alias resolves ONLY when the song has a single synthetic
///   version (`isSynthetic == true`).
CanonicalSongVersionResolution resolveCanonicalSongVersion(
  SongDetail song, {
  String? requestedVersionId,
}) {
  final effectiveVersions = extractCanonicalSongVersions(song);
  final trimmedRequested = requestedVersionId?.trim();
  if (effectiveVersions.isEmpty) {
    return CanonicalSongVersionResolution(
      status: CanonicalVersionResolutionStatus.versionNotFound,
      effectiveVersions: effectiveVersions,
    );
  }

  if (trimmedRequested != null && trimmedRequested.isNotEmpty) {
    if (!safeVersionIdRegex.hasMatch(trimmedRequested)) {
      return CanonicalSongVersionResolution(
        status: CanonicalVersionResolutionStatus.versionNotFound,
        effectiveVersions: effectiveVersions,
      );
    }

    for (final candidate in effectiveVersions) {
      if (candidate.id == trimmedRequested) {
        if (!safeVersionIdRegex.hasMatch(candidate.id)) {
          return CanonicalSongVersionResolution(
            status: CanonicalVersionResolutionStatus.versionNotFound,
            effectiveVersions: effectiveVersions,
          );
        }
        return CanonicalSongVersionResolution(
          status: CanonicalVersionResolutionStatus.resolved,
          version: candidate,
          effectiveVersions: effectiveVersions,
        );
      }
    }

    if (effectiveVersions.length == 1 &&
        effectiveVersions.first.isSynthetic &&
        trimmedRequested == 'v1' &&
        safeVersionIdRegex.hasMatch(effectiveVersions.first.id)) {
      return CanonicalSongVersionResolution(
        status: CanonicalVersionResolutionStatus.resolved,
        version: effectiveVersions.first,
        effectiveVersions: effectiveVersions,
      );
    }

    return CanonicalSongVersionResolution(
      status: CanonicalVersionResolutionStatus.versionNotFound,
      effectiveVersions: effectiveVersions,
    );
  }

  if (effectiveVersions.length == 1 && song.versions.length <= 1) {
    final only = effectiveVersions.first;
    if (!safeVersionIdRegex.hasMatch(only.id)) {
      return CanonicalSongVersionResolution(
        status: CanonicalVersionResolutionStatus.versionNotFound,
        effectiveVersions: effectiveVersions,
      );
    }
    return CanonicalSongVersionResolution(
      status: CanonicalVersionResolutionStatus.resolved,
      version: only,
      effectiveVersions: effectiveVersions,
    );
  }

  return CanonicalSongVersionResolution(
    status: CanonicalVersionResolutionStatus.versionRequired,
    effectiveVersions: effectiveVersions,
  );
}

/// Account- and ministry-scoped local audio binding linking a canonical
/// `SongVersion` to an imported rehearsal package inside `index.json`.
final class LocalSongVersionAudioBinding {
  const LocalSongVersionAudioBinding({
    required this.accountNamespaceHash,
    required this.ministryId,
    required this.songId,
    required this.canonicalVersionId,
    required this.versionNameSnapshot,
    required this.versionIsSynthetic,
    required this.packageId,
    required this.packageDisplayNameSnapshot,
    required this.assetId,
    required this.packageCompositeSha256,
    required this.assetSha256,
    required this.validityState,
    this.validityReason,
    required this.createdAt,
    required this.updatedAt,
  });

  final String accountNamespaceHash;
  final String ministryId;
  final String songId;
  final String canonicalVersionId;
  final String versionNameSnapshot;
  final bool versionIsSynthetic;
  final String packageId;
  final String packageDisplayNameSnapshot;
  final RehearsalAssetId assetId;
  final String packageCompositeSha256;
  final String assetSha256;
  final LocalBindingValidityState validityState;
  final String? validityReason;
  final String createdAt;
  final String updatedAt;

  bool get isValid => validityState == LocalBindingValidityState.valid;

  bool get isPlayableSingleMix =>
      isValid && assetId == RehearsalAssetId.original;

  LocalSongVersionAudioBinding copyWith({
    String? versionNameSnapshot,
    String? packageDisplayNameSnapshot,
    LocalBindingValidityState? validityState,
    String? validityReason,
    bool clearValidityReason = false,
    String? updatedAt,
  }) {
    return LocalSongVersionAudioBinding(
      accountNamespaceHash: accountNamespaceHash,
      ministryId: ministryId,
      songId: songId,
      canonicalVersionId: canonicalVersionId,
      versionNameSnapshot: versionNameSnapshot ?? this.versionNameSnapshot,
      versionIsSynthetic: versionIsSynthetic,
      packageId: packageId,
      packageDisplayNameSnapshot:
          packageDisplayNameSnapshot ?? this.packageDisplayNameSnapshot,
      assetId: assetId,
      packageCompositeSha256: packageCompositeSha256,
      assetSha256: assetSha256,
      validityState: validityState ?? this.validityState,
      validityReason: clearValidityReason
          ? null
          : (validityReason ?? this.validityReason),
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, Object?> toJson() => {
        'accountNamespaceHash': accountNamespaceHash,
        'ministryId': ministryId,
        'songId': songId,
        'canonicalVersionId': canonicalVersionId,
        'versionNameSnapshot': versionNameSnapshot,
        'versionIsSynthetic': versionIsSynthetic,
        'packageId': packageId,
        'packageDisplayNameSnapshot': packageDisplayNameSnapshot,
        'assetId': assetId.wireValue,
        'packageCompositeSha256': packageCompositeSha256,
        'assetSha256': assetSha256,
        'validityState': validityState.wireValue,
        'validityReason': validityReason,
        'createdAt': createdAt,
        'updatedAt': updatedAt,
      };

  factory LocalSongVersionAudioBinding.fromJson(Map<String, dynamic> json) {
    final canonicalVersionId = _requireString(json, 'canonicalVersionId');
    if (!safeVersionIdRegex.hasMatch(canonicalVersionId)) {
      throw const FormatException(
        'Invalid canonicalVersionId in LocalSongVersionAudioBinding',
      );
    }
    final rawSynthetic = json['versionIsSynthetic'];
    if (rawSynthetic is! bool) {
      throw const FormatException(
        'Missing or invalid bool "versionIsSynthetic"',
      );
    }

    return LocalSongVersionAudioBinding(
      accountNamespaceHash: _requireString(json, 'accountNamespaceHash'),
      ministryId: _requireString(json, 'ministryId'),
      songId: _requireString(json, 'songId'),
      canonicalVersionId: canonicalVersionId,
      versionNameSnapshot: _requireString(json, 'versionNameSnapshot'),
      versionIsSynthetic: rawSynthetic,
      packageId: _requireString(json, 'packageId').toLowerCase(),
      packageDisplayNameSnapshot:
          (json['packageDisplayNameSnapshot'] as String?) ?? '',
      assetId: RehearsalAssetId.fromWireValue(_requireString(json, 'assetId')),
      packageCompositeSha256: _requireString(json, 'packageCompositeSha256'),
      assetSha256: _requireString(json, 'assetSha256'),
      validityState: LocalBindingValidityState.fromWireValue(
        _requireString(json, 'validityState'),
      ),
      validityReason: json['validityReason'] as String?,
      createdAt: _requireString(json, 'createdAt'),
      updatedAt: _requireString(json, 'updatedAt'),
    );
  }
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
  bound,
  unbound,
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
    RehearsalPackageBindingState? bindingState,
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
      bindingState: bindingState ?? this.bindingState,
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
    this.bindings = const [],
    required this.storageSummary,
    required this.recoveredOrphanedCount,
    required this.corruptedOrIncompleteCount,
  });

  final List<LocalRehearsalPackageRecord> packages;
  final List<LocalSongVersionAudioBinding> bindings;
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
    this.binding,
    this.conflict,
    this.recoveredOrphanedCount = 0,
  });

  final RehearsalUserOutcomeCategory category;
  final String title;
  final String message;
  final String? errorCode;
  final LocalRehearsalPackageRecord? record;
  final LocalSongVersionAudioBinding? binding;
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
