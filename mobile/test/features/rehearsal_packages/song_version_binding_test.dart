import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';
import 'package:louvaio_mobile/core/storage/preferences_storage.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_manager.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_saf_channel.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/domain/rehearsal_package_models.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/presentation/views/rehearsal_packages_screen.dart';
import 'package:louvaio_mobile/features/repertoire/data/repertoire_repository.dart';
import 'package:louvaio_mobile/features/repertoire/domain/artist.dart';
import 'package:louvaio_mobile/features/repertoire/domain/classification.dart';
import 'package:louvaio_mobile/features/repertoire/domain/paginated_songs.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_detail.dart';
import 'package:louvaio_mobile/features/repertoire/domain/song_form_data.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/controllers/song_detail_controller.dart';
import 'package:louvaio_mobile/features/repertoire/presentation/views/song_detail_view.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule.dart';
import 'package:louvaio_mobile/features/schedules/domain/schedule_song_sequence.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repertoire_link_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/data/smart_chord_repository.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord.dart';
import 'package:louvaio_mobile/features/smart_chords/domain/smart_chord_repertoire_link.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/smart_chord_repertoire_link_controller.dart';
import 'package:louvaio_mobile/features/smart_chords/presentation/controllers/song_smart_chords_controller.dart';

import '../../support/rehearsal_package_corpus.dart';

// ---------------------------------------------------------------------------
// Test Doubles & Package Fixture Builders
// ---------------------------------------------------------------------------

final class _FakeSafPort implements RehearsalPackageSafPort {
  _FakeSafPort({required this.filesDirPath});

  final String filesDirPath;
  final StreamController<SafProgressEvent> _progressController =
      StreamController<SafProgressEvent>.broadcast();

  Uint8List? nextPickArchiveBytes;

  @override
  Stream<SafProgressEvent> get progressStream => _progressController.stream;

  @override
  Future<SafStorageInfo> getStorageInfo() async {
    return SafStorageInfo(
      filesDirPath: filesDirPath,
      availableBytes: 1024 * 1024 * 1024,
      totalBytes: 8 * 1024 * 1024 * 1024,
    );
  }

  @override
  Future<SafStageResult> pickAndStagePackage({
    required String operationId,
    required String targetStageFilePath,
    int maxBytes = RehearsalLimitsV1.maxCompressedBytes,
    int requiredReserveBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes,
  }) async {
    final bytes = nextPickArchiveBytes;
    if (bytes == null) {
      return const SafStageResult(status: SafStageStatus.cancelled);
    }
    final targetFile = File(targetStageFilePath);
    targetFile.parent.createSync(recursive: true);
    targetFile.writeAsBytesSync(bytes, flush: true);
    return SafStageResult(
      status: SafStageStatus.staged,
      stagedFilePath: targetFile.path,
      bytesCopied: bytes.length,
    );
  }

  @override
  Future<SafExportResult> exportPackageToUri({
    required String operationId,
    required String sourceFilePath,
    required String suggestedFileName,
  }) async {
    return const SafExportResult(status: SafExportStatus.cancelled);
  }

  @override
  Future<bool> cancelOperation({String? operationId}) async => true;

  Future<void> dispose() async {
    await _progressController.close();
  }
}

Uint8List _buildValidPackageZip({
  String packageId = '11111111-1111-4111-8111-111111111111',
  int revision = 1,
  String displayName = 'Santo Pra Sempre - Ensaio',
  int seedOffset = 0,
  bool includeOriginal = true,
}) {
  final baseManifest = Map<String, dynamic>.from(
    loadReferenceManifest(
      includeOriginal
          ? 'valid-with-original-and-practice.manifest.json'
          : 'valid-wav-minimal.manifest.json',
    ),
  );
  baseManifest['packageId'] = packageId;
  baseManifest['revision'] = revision;
  baseManifest['displayName'] = displayName;

  final entries = <SyntheticZipEntry>[];
  final stems = <Map<String, dynamic>>[];

  for (var i = 0; i < 4; i++) {
    final stemId = ['vocals', 'drums', 'bass', 'other'][i];
    final path = 'stems/$stemId.wav';
    final bytes = buildSyntheticWavPcm16(
      seed: 10 + seedOffset + i,
      frames: 4410,
    );
    stems.add({
      'id': stemId,
      'path': path,
      'container': 'wav',
      'codec': 'pcm_s16le',
      'bitsPerSample': 16,
      'byteLength': bytes.length,
      'sha256': IncrementalSha256.computeHex(bytes),
      'sampleRate': 44100,
      'channels': 2,
      'decodedFrames': 4410,
    });
    entries.add(SyntheticZipEntry(path: path, uncompressedData: bytes));
  }
  baseManifest['stems'] = stems;

  if (includeOriginal) {
    const origPath = 'audio/original.wav';
    final origBytes = buildSyntheticWavPcm16(
      seed: 99 + seedOffset,
      frames: 4410,
    );
    final origSha = IncrementalSha256.computeHex(origBytes);
    baseManifest['original'] = {
      'included': true,
      'path': origPath,
      'container': 'wav',
      'codec': 'pcm_s16le',
      'bitsPerSample': 16,
      'byteLength': origBytes.length,
      'sha256': origSha,
      'sampleRate': 44100,
      'channels': 2,
      'decodedFrames': 4410,
    };
    (baseManifest['source'] as Map<String, dynamic>)['sha256'] = origSha;
    entries.add(SyntheticZipEntry(path: origPath, uncompressedData: origBytes));
  } else {
    baseManifest['original'] = {'included': false};
  }

  final manifestBytes = Uint8List.fromList(utf8.encode(jsonEncode(baseManifest)));
  return buildSyntheticZip([
    SyntheticZipEntry(path: 'manifest.json', uncompressedData: manifestBytes),
    ...entries,
  ]);
}

class _StubAuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword({
    required String email,
    required String password,
  }) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class _TestAuthNotifier extends AuthNotifier {
  _TestAuthNotifier({String? userId = 'user-alpha'}) : super(_StubAuthRepo()) {
    if (userId != null) {
      setAuthenticated(userId);
    } else {
      state = const AuthState.unauthenticated();
    }
  }

  void setAuthenticated(String userId) {
    state = AuthState.authenticated(
      AuthUser(id: userId, email: '$userId@test.com', name: 'Usuário $userId'),
    );
  }

  void setUnauthenticated() {
    state = const AuthState.unauthenticated();
  }
}

class _FakeMinistryRepo implements MinistryRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
  @override
  Future<List<Ministry>> getMyMinistries() async => const [];
}

class _FakePreferencesStorage implements PreferencesStorage {
  @override
  Future<void> clear() async {}
  @override
  String? getSelectedMinistryId() => null;
  @override
  String? getThemeMode() => null;
  @override
  Future<void> setSelectedMinistryId(String? ministryId) async {}
  @override
  Future<void> setThemeMode(String? themeMode) async {}
}

class _TestMinistryContextNotifier extends MinistryContextNotifier {
  _TestMinistryContextNotifier({
    String ministryId = 'min_1',
    String role = 'member',
  }) : super(
          repository: _FakeMinistryRepo(),
          preferencesStorage: _FakePreferencesStorage(),
        ) {
    state = MinistryContextState(
      status: MinistryBootstrapStatus.ready,
      selectedMinistry: Ministry(
        id: ministryId,
        name: 'Ministério $ministryId',
        role: role,
      ),
      availableMinistries: [
        Ministry(id: 'min_1', name: 'Ministério 1', role: role),
        Ministry(id: 'min_2', name: 'Ministério 2', role: role),
      ],
    );
  }
}

class _FakeRepertoireRepo implements RepertoireRepository {
  final Map<String, SongDetail> songs = {};
  SongDetail? singleDetail;

  @override
  Future<SongDetail> getSongDetail(String ministryId, String songId) async {
    final hit = songs['$ministryId:$songId'] ?? songs[songId] ?? singleDetail;
    if (hit == null) {
      throw StateError('Song not found: $ministryId/$songId');
    }
    return hit;
  }

  @override
  Future<PaginatedSongs> listSongs(
    String ministryId, {
    String? search,
    String? classificationId,
    String? cursor,
    int? page,
    int? limit,
  }) async =>
      const PaginatedSongs(songs: [], total: 0);

  @override
  Future<List<Classification>> listClassifications(String ministryId) async =>
      [];
  @override
  Future<SongDetail> createSong(String ministryId, SongFormData data) async =>
      throw UnimplementedError();
  @override
  Future<SongDetail> updateSong(
    String ministryId,
    String songId,
    SongFormData data,
  ) async =>
      throw UnimplementedError();
  @override
  Future<void> deleteSong(String ministryId, String songId) async {}
  @override
  Future<List<Artist>> listArtists(String ministryId, {String? search}) async =>
      [];
  @override
  Future<Artist> createArtist(String ministryId, String name) async =>
      throw UnimplementedError();
}

class _NoopSmartChordRepo implements SmartChordRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _EmptyLinkRepo implements SmartChordRepertoireLinkRepository {
  @override
  Future<List<SmartChord>> getMySmartChordsForSong({
    required String ministryId,
    required String songId,
    String? versionId,
    String? linkStatus,
  }) async =>
      const [];

  @override
  Future<void> removeRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async {}

  @override
  Future<SmartChordRepertoireLink> getRepertoireLink({
    required String ministryId,
    required String chordId,
  }) async =>
      const SmartChordRepertoireLink.unlinked();

  @override
  Future<SmartChordRepertoireLink> setRepertoireLink({
    required String ministryId,
    required String chordId,
    required String songId,
    String? versionId,
  }) async =>
      throw UnimplementedError();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('T10 HTTP song version identity provenance', () {
    SongDetail readSong([List<Object?>? versions]) => SongDetail.fromJson({
      'id': 'legacy', 'ministry_id': 'min_1', 'title': 'Song',
      if (versions != null) 'versions': versions,
    });

    test('retains synthetic legacy identity and v1 alias from JSON', () {
      final song = readSong();
      expect(extractCanonicalSongVersions(song).single.isSynthetic, isTrue);
      final resolved = resolveCanonicalSongVersion(song, requestedVersionId: 'v1');
      expect(resolved.status, CanonicalVersionResolutionStatus.resolved);
      expect(resolved.versionId, 'legacy_v1');
      final copied = song.versions.single.copyWith(name: 'Copied');
      expect(copied.isLegacySynthetic, isTrue);
      expect(copied.toJson().containsKey('isLegacySynthetic'), isFalse);
    });

    test('ignores payload synthetic claims and preserves explicit v_1 IDs', () {
      final song = readSong([{'id': 'v_1', 'name': 'Studio', 'isSynthetic': true, 'isLegacySynthetic': true}]);
      expect(extractCanonicalSongVersions(song).single.isSynthetic, isFalse);
      expect(resolveCanonicalSongVersion(song, requestedVersionId: 'v1').isResolved, isFalse);
      expect(resolveCanonicalSongVersion(song, requestedVersionId: 'v_1').isResolved, isTrue);
    });

    test('missing IDs and Studio Live reorder cannot create positional identities', () {
      for (final versions in [
        [{'name': 'Studio'}, {'name': 'Live'}],
        [{'name': 'Live'}, {'name': 'Studio'}],
      ]) {
        final song = readSong(versions);
        expect(extractCanonicalSongVersions(song), isEmpty);
        expect(resolveCanonicalSongVersion(song, requestedVersionId: 'v_1').isResolved, isFalse);
        expect(resolveCanonicalSongVersion(song).isResolved, isFalse);
      }
    });

    test('duplicates and malformed lists never become legacy or auto-select another version', () {
      for (final versions in [
        [{'id': 'dup', 'name': 'Studio'}, {'id': 'dup', 'name': 'Live'}],
        [null, 42],
        [{'name': 'Missing'}],
      ]) {
        final song = readSong(versions);
        expect(extractCanonicalSongVersions(song), isEmpty);
        expect(resolveCanonicalSongVersion(song, requestedVersionId: 'v1').isResolved, isFalse);
      }
      final mixed = readSong([{'name': 'Missing'}, {'id': 'real', 'name': 'Live'}]);
      expect(resolveCanonicalSongVersion(mixed).status, CanonicalVersionResolutionStatus.versionRequired);
      expect(resolveCanonicalSongVersion(mixed, requestedVersionId: 'real').isResolved, isTrue);
    });
  });

  // =========================================================================
  // Fase A — Canonical SongVersion Identity & Resolution (12 parity cases)
  // =========================================================================
  group('Fase A: Canonical SongVersion identity & resolution (TS/Dart parity)', () {
    const legacySong = SongDetail(
      id: 'song_legacy',
      ministryId: 'min_1',
      title: 'Música Legada',
      originalKey: 'G',
      versions: [],
    );

    const singleExplicitSong = SongDetail(
      id: 'song_single',
      ministryId: 'min_1',
      title: 'Música Única',
      originalKey: 'D',
      versions: [
        SongVersion(id: 'ver_custom', name: 'Estúdio', key: 'D'),
      ],
    );

    const multiVersionSong = SongDetail(
      id: 'song_multi',
      ministryId: 'min_1',
      title: 'Música Multi',
      originalKey: 'C',
      versions: [
        SongVersion(id: 'v_orig', name: 'Original', key: 'C'),
        SongVersion(id: 'v_acoust', name: 'Acústica', key: 'E'),
      ],
    );

    test('Case 1: empty versions synthesizes deterministic {songId}_v1 with isSynthetic=true', () {
      final extracted = extractCanonicalSongVersions(legacySong);
      expect(extracted, hasLength(1));
      expect(extracted.first.id, 'song_legacy_v1');
      expect(extracted.first.name, 'Original');
      expect(extracted.first.key, 'G');
      expect(extracted.first.isSynthetic, isTrue);
    });

    test('Case 2: empty versions with null requestedVersionId resolves to synthetic {songId}_v1', () {
      final res = resolveCanonicalSongVersion(legacySong);
      expect(res.status, CanonicalVersionResolutionStatus.resolved);
      expect(res.versionId, 'song_legacy_v1');
      expect(res.version?.isSynthetic, isTrue);
    });

    test('Case 3: empty versions allows legacy "v1" alias ONLY when single synthetic', () {
      final res = resolveCanonicalSongVersion(
        legacySong,
        requestedVersionId: 'v1',
      );
      expect(res.status, CanonicalVersionResolutionStatus.resolved);
      expect(res.versionId, 'song_legacy_v1');
    });

    test('Case 4: empty versions resolves exact synthetic ID "{songId}_v1"', () {
      final res = resolveCanonicalSongVersion(
        legacySong,
        requestedVersionId: ' song_legacy_v1 ',
      );
      expect(res.status, CanonicalVersionResolutionStatus.resolved);
      expect(res.versionId, 'song_legacy_v1');
    });

    test('Case 5: empty versions rejects unknown requestedVersionId with versionNotFound', () {
      final res = resolveCanonicalSongVersion(
        legacySong,
        requestedVersionId: 'v2',
      );
      expect(res.status, CanonicalVersionResolutionStatus.versionNotFound);
      expect(res.version, isNull);
    });

    test('Case 6: single explicit version with null requestedVersionId resolves cleanly', () {
      final res = resolveCanonicalSongVersion(singleExplicitSong);
      expect(res.status, CanonicalVersionResolutionStatus.resolved);
      expect(res.versionId, 'ver_custom');
      expect(res.version?.isSynthetic, isFalse);
    });

    test('Case 7: single explicit version rejects legacy "v1" alias (not synthetic)', () {
      final res = resolveCanonicalSongVersion(
        singleExplicitSong,
        requestedVersionId: 'v1',
      );
      expect(res.status, CanonicalVersionResolutionStatus.versionNotFound);
      expect(res.version, isNull);
    });

    test('Case 8: multi-version song with null requestedVersionId returns versionRequired (never index 0)', () {
      final res = resolveCanonicalSongVersion(multiVersionSong);
      expect(res.status, CanonicalVersionResolutionStatus.versionRequired);
      expect(res.version, isNull);
      expect(res.effectiveVersions.map((v) => v.id), ['v_orig', 'v_acoust']);
    });

    test('Case 9: multi-version song with whitespace requestedVersionId returns versionRequired', () {
      final res = resolveCanonicalSongVersion(
        multiVersionSong,
        requestedVersionId: '   ',
      );
      expect(res.status, CanonicalVersionResolutionStatus.versionRequired);
      expect(res.version, isNull);
    });

    test('Case 10: multi-version song resolves exact requestedVersionId (trimmed)', () {
      final res = resolveCanonicalSongVersion(
        multiVersionSong,
        requestedVersionId: ' v_acoust ',
      );
      expect(res.status, CanonicalVersionResolutionStatus.resolved);
      expect(res.versionId, 'v_acoust');
      expect(res.version?.name, 'Acústica');
    });

    test('Case 11: multi-version song rejects missing requestedVersionId with versionNotFound (never index 0)', () {
      final res = resolveCanonicalSongVersion(
        multiVersionSong,
        requestedVersionId: 'ver-removida',
      );
      expect(res.status, CanonicalVersionResolutionStatus.versionNotFound);
      expect(res.version, isNull);
    });

    test('Case 12: SAFE_VERSION_ID_REGEX rejects unsafe chars/excess length, allows spaces, preserves duplicate names with distinct IDs', () {
      for (final unsafe in [
        '',
        'a/b',
        r'a\b',
        'a?b',
        'a#b',
        'a&b',
        'a%b',
        'a<b',
        'a>b',
        'a\nb',
        'a\x7Fb',
        'a' * 151,
      ]) {
        expect(
          safeVersionIdRegex.hasMatch(unsafe),
          isFalse,
          reason: 'Expected unsafe ID "$unsafe" to be rejected',
        );
      }

      const dupNamesSong = SongDetail(
        id: 'song_dup_names',
        ministryId: 'min_1',
        title: 'Duplicada',
        versions: [
          SongVersion(id: 'id alpha', name: 'Original', key: 'C'),
          SongVersion(id: 'id_beta', name: 'Original', key: 'D'),
          SongVersion(id: 'id_beta', name: 'DuplicadoMesmoId', key: 'E'),
          SongVersion(id: 'bad/id', name: 'Invalida', key: 'F'),
        ],
      );
      final extracted = extractCanonicalSongVersions(dupNamesSong);
      // Both entries with id_beta are ambiguous; neither may claim its binding.
      expect(extracted.map((v) => v.id), ['id alpha']);
      expect(extracted.map((v) => v.name), ['Original']);

      final ambiguous = resolveCanonicalSongVersion(dupNamesSong);
      expect(ambiguous.status, CanonicalVersionResolutionStatus.versionRequired);

      final second = resolveCanonicalSongVersion(
        dupNamesSong,
        requestedVersionId: 'id_beta',
      );
      expect(second.status, CanonicalVersionResolutionStatus.versionNotFound);
      expect(second.version, isNull);

      final badQuery = resolveCanonicalSongVersion(
        dupNamesSong,
        requestedVersionId: 'bad/id',
      );
      expect(badQuery.status, CanonicalVersionResolutionStatus.versionNotFound);
    });
  });

  // =========================================================================
  // Fase B & C — Account & Ministry-Scoped Binding Persistence & Reconciliation
  // =========================================================================
  group('Fase B/C: Account & Ministry-scoped bindings in RehearsalPackageManager', () {
    late Directory tempDir;
    late _FakeSafPort safPort;
    late RehearsalPackageManager manager;
    late DateTime clock;

    const pkgAId = '11111111-1111-4111-8111-111111111111';
    const pkgBId = '22222222-2222-4222-8222-222222222222';

    const songMultiMin1 = SongDetail(
      id: 'song_1',
      ministryId: 'min_1',
      title: 'Santo Pra Sempre',
      originalKey: 'G',
      versions: [
        SongVersion(id: 'v1', name: 'Original', key: 'G'),
        SongVersion(id: 'v2', name: 'Acústica', key: 'E'),
      ],
    );

    setUp(() {
      tempDir = Directory.systemTemp.createTempSync('louvaio_t10_mgr_');
      safPort = _FakeSafPort(filesDirPath: tempDir.path);
      clock = DateTime.utc(2026, 11, 17, 18, 0, 0);
      manager = RehearsalPackageManager(
        safPort: safPort,
        clock: () {
          clock = clock.add(const Duration(seconds: 1));
          return clock;
        },
      );
    });

    tearDown(() async {
      await safPort.dispose();
      if (tempDir.existsSync()) {
        tempDir.deleteSync(recursive: true);
      }
    });

    test('backward-compatible index without bindings defaults to [] and all index mutations preserve bindings & packages', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgAId,
        includeOriginal: true,
      );
      final imp = await manager.importFromSaf(userId: 'user-1');
      expect(imp.category, RehearsalUserOutcomeCategory.imported);

      // Simulate legacy T8 index.json without 'bindings' key.
      final hash = RehearsalPackageManager.computeAccountNamespaceHash('user-1');
      final indexFile = File(
        '${tempDir.path}/rehearsal_packages/accounts/$hash/index.json',
      );
      final raw = jsonDecode(indexFile.readAsStringSync()) as Map<String, dynamic>;
      raw.remove('bindings');
      indexFile.writeAsStringSync(jsonEncode(raw));

      expect(await manager.listBindings(userId: 'user-1'), isEmpty);

      // Bind, then rename + revalidate + loadLibrary and confirm binding is preserved.
      final bindRes = await manager.bindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v2',
        packageId: pkgAId,
        songReadVerified: true,
        isOnline: true,
      );
      expect(bindRes.category, RehearsalUserOutcomeCategory.bound);
      expect(bindRes.binding?.assetId, RehearsalAssetId.original);
      expect(bindRes.binding?.isPlayableSingleMix, isTrue);

      await manager.renamePackageLabel(
        userId: 'user-1',
        packageId: pkgAId,
        newLabel: 'Ensaio Acústico Renomeado',
      );
      await manager.revalidatePackage(userId: 'user-1', packageId: pkgAId);
      final snapshot = await manager.loadLibrary(userId: 'user-1');

      expect(snapshot.packages, hasLength(1));
      expect(snapshot.packages.first.bindingState, RehearsalPackageBindingState.linked);
      expect(snapshot.bindings, hasLength(1));
      expect(
        snapshot.bindings.first.packageDisplayNameSnapshot,
        'Ensaio Acústico Renomeado',
      );
      expect(snapshot.bindings.first.validityState, LocalBindingValidityState.valid);
    });

    test('enforces strict account isolation AND ministry isolation and fail-closed security guards', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgAId,
        includeOriginal: true,
      );
      await manager.importFromSaf(userId: 'user-alpha');

      // Offline bind denied
      final offline = await manager.bindSongVersion(
        userId: 'user-alpha',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgAId,
        songReadVerified: true,
        isOnline: false,
      );
      expect(offline.errorCode, 'OFFLINE_BIND_DENIED');

      // Unverified song read denied
      final unread = await manager.bindSongVersion(
        userId: 'user-alpha',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgAId,
        songReadVerified: false,
        isOnline: true,
      );
      expect(unread.errorCode, 'SONG_READ_NOT_VERIFIED');

      // Ambiguous version denied (never auto-selects index 0)
      final ambiguous = await manager.bindSongVersion(
        userId: 'user-alpha',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: null,
        packageId: pkgAId,
        songReadVerified: true,
      );
      expect(ambiguous.errorCode, 'VERSION_REQUIRED');

      // Cross-ministry song mismatch denied
      final crossTenantSong = await manager.bindSongVersion(
        userId: 'user-alpha',
        ministryId: 'min_2',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgAId,
        songReadVerified: true,
      );
      expect(crossTenantSong.errorCode, 'TENANT_MISMATCH');

      // Bind in min_1 for user-alpha
      final okMin1 = await manager.bindSongVersion(
        userId: 'user-alpha',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgAId,
        songReadVerified: true,
      );
      expect(okMin1.category, RehearsalUserOutcomeCategory.bound);

      // Another account cannot bind user-alpha's package or see user-alpha's bindings
      final otherUserBind = await manager.bindSongVersion(
        userId: 'user-beta',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgAId,
        songReadVerified: true,
      );
      expect(otherUserBind.errorCode, 'PACKAGE_NOT_FOUND');
      expect(await manager.listBindings(userId: 'user-beta'), isEmpty);

      // Ministry isolation inside same account: min_2 sees 0 bindings for min_1 song
      expect(
        await manager.listBindings(
          userId: 'user-alpha',
          ministryId: 'min_2',
          songId: 'song_1',
        ),
        isEmpty,
      );
      expect(
        await manager.listBindings(
          userId: 'user-alpha',
          ministryId: 'min_1',
          songId: 'song_1',
        ),
        hasLength(1),
      );
    });

    test('stems-only package binds as stems_bundle_v1 and is non-playable single mix', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgBId,
        includeOriginal: false,
      );
      await manager.importFromSaf(userId: 'user-1');

      final res = await manager.bindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgBId,
        songReadVerified: true,
      );
      expect(res.category, RehearsalUserOutcomeCategory.bound);
      expect(res.binding?.assetId, RehearsalAssetId.stemsBundleV1);
      expect(res.binding?.isPlayableSingleMix, isFalse);
    });

    test('deletePackage marks binding packageMissing; unbind removes binding without deleting package', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgAId,
        includeOriginal: true,
      );
      await manager.importFromSaf(userId: 'user-1');
      await manager.bindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgAId,
        songReadVerified: true,
      );

      // Delete package -> binding marked packageMissing
      await manager.deletePackage(
        userId: 'user-1',
        packageId: pkgAId,
        confirmedScope: true,
      );
      final afterDelete = await manager.reconcileSongVersionBindings(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
      );
      expect(afterDelete, hasLength(1));
      expect(
        afterDelete.first.validityState,
        LocalBindingValidityState.packageMissing,
      );

      // Re-import, rebind, then unbind -> package remains on disk as unlinked
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgAId,
        includeOriginal: true,
      );
      await manager.importFromSaf(userId: 'user-1');
      await manager.bindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgAId,
        songReadVerified: true,
      );

      final unbindRes = await manager.unbindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        songId: 'song_1',
        canonicalVersionId: 'v1',
      );
      expect(unbindRes.category, RehearsalUserOutcomeCategory.unbound);
      expect(await manager.listBindings(userId: 'user-1'), isEmpty);

      final lib = await manager.loadLibrary(userId: 'user-1');
      expect(lib.packages, hasLength(1));
      expect(lib.packages.first.bindingState, RehearsalPackageBindingState.unlinked);
    });

    test('confirmConflictReplace marks affected binding packageReplacedIncompatible when hash/original changes', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgAId,
        revision: 1,
        seedOffset: 1,
        includeOriginal: true,
      );
      await manager.importFromSaf(userId: 'user-1');
      await manager.bindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v1',
        packageId: pkgAId,
        songReadVerified: true,
      );

      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgAId,
        revision: 2,
        seedOffset: 50,
        includeOriginal: false,
      );
      final conflict = await manager.importFromSaf(userId: 'user-1');
      expect(conflict.category, RehearsalUserOutcomeCategory.conflict);

      final replaced = await manager.confirmConflictReplace(
        userId: 'user-1',
        pendingTransactionId: conflict.conflict!.pendingTransactionId,
      );
      expect(replaced.category, RehearsalUserOutcomeCategory.imported);

      final bindings = await manager.reconcileSongVersionBindings(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
      );
      expect(bindings, hasLength(1));
      expect(
        bindings.first.validityState,
        LocalBindingValidityState.packageReplacedIncompatible,
      );

      final libAfterReplace = await manager.loadLibrary(userId: 'user-1');
      expect(libAfterReplace.packages, hasLength(1));
      expect(
        libAfterReplace.packages.first.bindingState,
        RehearsalPackageBindingState.unlinked,
      );
    });

    test('revalidatePackage updates packageCorrupted / valid and preserves sticky versionRemoved tombstone across recreated version ID', () async {
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgAId,
        includeOriginal: true,
      );
      await manager.importFromSaf(userId: 'user-1');
      await manager.bindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v2',
        packageId: pkgAId,
        songReadVerified: true,
      );

      // Tamper original.wav on disk -> revalidate marks packageCorrupted
      final hash = RehearsalPackageManager.computeAccountNamespaceHash('user-1');
      final origFile = File(
        '${tempDir.path}/rehearsal_packages/accounts/$hash/packages/$pkgAId/original.wav',
      );
      final originalBytes = origFile.readAsBytesSync();
      final corruptedBytes = Uint8List.fromList(originalBytes);
      corruptedBytes[corruptedBytes.length - 1] ^= 0xFF;
      origFile.writeAsBytesSync(corruptedBytes, flush: true);

      final revalBad = await manager.revalidatePackage(
        userId: 'user-1',
        packageId: pkgAId,
      );
      expect(revalBad.category, RehearsalUserOutcomeCategory.corrupted);
      var bindings = await manager.listBindings(userId: 'user-1');
      expect(
        bindings.first.validityState,
        LocalBindingValidityState.packageCorrupted,
      );

      // Restore original bytes -> revalidate restores valid
      origFile.writeAsBytesSync(originalBytes, flush: true);
      final revalGood = await manager.revalidatePackage(
        userId: 'user-1',
        packageId: pkgAId,
      );
      expect(revalGood.category, RehearsalUserOutcomeCategory.revalidated);
      bindings = await manager.listBindings(userId: 'user-1');
      expect(bindings.first.validityState, LocalBindingValidityState.valid);

      // Remove v2 from song -> reconcile marks versionRemoved
      const songWithoutV2 = SongDetail(
        id: 'song_1',
        ministryId: 'min_1',
        title: 'Santo Pra Sempre',
        versions: [SongVersion(id: 'v1', name: 'Original', key: 'G')],
      );
      bindings = await manager.reconcileSongVersionBindings(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songWithoutV2,
      );
      expect(bindings.first.validityState, LocalBindingValidityState.versionRemoved);

      // Recreate v2 with same ID -> sticky tombstone MUST remain versionRemoved
      bindings = await manager.reconcileSongVersionBindings(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
      );
      expect(bindings.first.validityState, LocalBindingValidityState.versionRemoved);

      // Revalidate package -> MUST preserve sticky versionRemoved
      await manager.revalidatePackage(userId: 'user-1', packageId: pkgAId);
      bindings = await manager.listBindings(userId: 'user-1');
      expect(bindings.first.validityState, LocalBindingValidityState.versionRemoved);

      // Explicit rebind clears tombstone
      final rebind = await manager.bindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        song: songMultiMin1,
        requestedVersionId: 'v2',
        packageId: pkgAId,
        songReadVerified: true,
      );
      expect(rebind.binding?.validityState, LocalBindingValidityState.valid);
    });

    test('synthetic-to-explicit transition invalidates synthetic binding as versionRemoved', () async {
      final legacy = SongDetail.fromJson(const {
        'id': 'song_legacy_trans',
        'ministry_id': 'min_1',
        'title': 'Legado',
      });
      safPort.nextPickArchiveBytes = _buildValidPackageZip(
        packageId: pkgAId,
        includeOriginal: true,
      );
      await manager.importFromSaf(userId: 'user-1');
      await manager.bindSongVersion(
        userId: 'user-1',
        ministryId: 'min_1',
        song: legacy,
        packageId: pkgAId,
        songReadVerified: true,
      );

      // Even if an explicit version happens to use the old synthetic ID,
      // versionIsSynthetic changed from true -> false, so reconcile invalidates it.
      final explicitSameId = SongDetail.fromJson(const {
        'id': 'song_legacy_trans',
        'ministry_id': 'min_1',
        'title': 'Legado',
        'versions': [
          {'id': 'song_legacy_trans_v1', 'name': 'Original'},
        ],
      });
      final reconciled = await manager.reconcileSongVersionBindings(
        userId: 'user-1',
        ministryId: 'min_1',
        song: explicitSameId,
      );
      expect(reconciled, hasLength(1));
      expect(
        reconciled.first.validityState,
        LocalBindingValidityState.versionRemoved,
      );
    });
  });

  // =========================================================================
  // Fase F & G — SongDetailView UI, Schedule Sequence, & Logout Reset
  // =========================================================================
  group('Fase F/G: SongDetailView binding UX, schedule navigation, and auth reset', () {
    late Directory tempDir;
    late _FakeSafPort safPort;
    late RehearsalPackageManager manager;
    late _FakeRepertoireRepo repertoireRepo;

    const pkgOrigId = '11111111-1111-4111-8111-111111111111';
    const pkgStemsId = '22222222-2222-4222-8222-222222222222';

    setUp(() {
      tempDir = Directory.systemTemp.createTempSync('louvaio_t10_ui_');
      safPort = _FakeSafPort(filesDirPath: tempDir.path);
      manager = RehearsalPackageManager(safPort: safPort);
      repertoireRepo = _FakeRepertoireRepo();
    });

    tearDown(() async {
      await safPort.dispose();
      if (tempDir.existsSync()) {
        tempDir.deleteSync(recursive: true);
      }
    });

    Future<void> pumpIo(WidgetTester tester) async {
      for (var i = 0; i < 60; i++) {
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 2)),
        );
        await tester.pump();
      }
      await tester.pumpAndSettle();
    }

    Widget buildSubject({
      Key? scopeKey,
      required Widget home,
      bool isOnline = true,
      String ministryId = 'min_1',
      String role = 'member',
      String userId = 'user-alpha',
    }) {
      final linkRepo = _EmptyLinkRepo();
      return ProviderScope(
        key: scopeKey,
        overrides: [
          appEnvironmentProvider.overrideWithValue(
            const AppEnvironment(
              env: AppEnv.development,
              apiBaseUrl: 'http://localhost:3000/api/v1',
            ),
          ),
          repertoireRepositoryProvider.overrideWithValue(repertoireRepo),
          songDetailNotifierProvider.overrideWith(
            (ref) => SongDetailNotifier(repository: repertoireRepo),
          ),
          ministryContextNotifierProvider.overrideWith(
            (ref) => _TestMinistryContextNotifier(
              ministryId: ministryId,
              role: role,
            ),
          ),
          authNotifierProvider.overrideWith(
            (ref) => _TestAuthNotifier(userId: userId),
          ),
          rehearsalPackageSafPortProvider.overrideWithValue(safPort),
          rehearsalPackageManagerProvider.overrideWithValue(manager),
          rehearsalOnlineCheckProvider.overrideWithValue(isOnline),
          smartChordRepertoireLinkRepositoryProvider.overrideWithValue(linkRepo),
          songSmartChordsNotifierProvider.overrideWith(
            (ref) => SongSmartChordsNotifier(
              repository: _NoopSmartChordRepo(),
              linkRepository: linkRepo,
            ),
          ),
          smartChordRepertoireLinkNotifierProvider.overrideWith(
            (ref) => SmartChordRepertoireLinkNotifier(repository: linkRepo),
          ),
        ],
        child: MaterialApp(home: home),
      );
    }

    testWidgets(
      'ambiguous multi-version prompt -> explicit chip select -> bind modal -> Android playback notice -> unlink -> RehearsalPackagesScreen linked label',
      (tester) async {
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgOrigId,
          displayName: 'Acústico Local WAV',
          includeOriginal: true,
        );
        await tester.runAsync(() => manager.importFromSaf(userId: 'user-alpha'));

        repertoireRepo.singleDetail = const SongDetail(
          id: 'song_multi_ui',
          ministryId: 'min_1',
          title: 'Bondade de Deus',
          versions: [
            SongVersion(id: 'v1', name: 'Original', key: 'G'),
            SongVersion(id: 'v2', name: 'Acústica', key: 'E'),
          ],
        );

        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('scope_1'),
            home: const SongDetailView(
              ministryId: 'min_1',
              songId: 'song_multi_ui',
            ),
          ),
        );
        await pumpIo(tester);

        final bindingCard = find.byKey(
          const ValueKey('song_detail_rehearsal_binding_card'),
        );
        expect(bindingCard, findsOneWidget);
        expect(
          find.text(
            'Selecione explicitamente uma versão acima para vincular ou carregar áudio local.',
          ),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('song_detail_rehearsal_bind_button')),
          findsNothing,
        );

        // Explicitly tap version 2 chip
        await tester.tap(find.byKey(const ValueKey('detail_version_chip_v2')));
        await pumpIo(tester);

        expect(find.text('Sem áudio local vinculado'), findsOneWidget);
        final bindBtn = find.byKey(
          const ValueKey('song_detail_rehearsal_bind_button'),
        );
        await tester.ensureVisible(bindBtn);
        await tester.tap(bindBtn);
        await pumpIo(tester);

        // Modal lists verified package
        final pkgOption = find.byKey(
          const ValueKey('song_detail_rehearsal_package_option_$pkgOrigId'),
        );
        expect(pkgOption, findsOneWidget);
        await tester.tap(pkgOption);
        await pumpIo(tester);

        // Bound state displays honest Android playback unavailability notice
        expect(find.text('Acústico Local WAV'), findsOneWidget);
        expect(
          find.textContaining(
            'Reprodução nativa local indisponível no Android nesta etapa',
          ),
          findsOneWidget,
        );
        expect(
          find.textContaining('sem reutilizar o canal vocal M21'),
          findsOneWidget,
        );

        // Verify RehearsalPackagesScreen reflects linked state
        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('scope_2'),
            home: const RehearsalPackagesScreen(),
          ),
        );
        await pumpIo(tester);
        expect(find.text('Vínculo local: Associado a música'), findsOneWidget);

        // Return to SongDetailView and unlink cleanly
        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('scope_3'),
            home: const SongDetailView(
              ministryId: 'min_1',
              songId: 'song_multi_ui',
              initialVersionId: 'v2',
            ),
          ),
        );
        await pumpIo(tester);

        final unbindBtn = find.byKey(
          const ValueKey('song_detail_rehearsal_unbind_button'),
        );
        await tester.ensureVisible(unbindBtn);
        await tester.tap(unbindBtn);
        await tester.pumpAndSettle();
        await tester.tap(
          find.byKey(const ValueKey('song_detail_rehearsal_confirm_unbind_button')),
        );
        await pumpIo(tester);

        expect(find.text('Sem áudio local vinculado'), findsOneWidget);
        final libAfter = await tester.runAsync(
          () => manager.loadLibrary(userId: 'user-alpha'),
        );
        expect(libAfter!.packages, hasLength(1));
        expect(
          libAfter.packages.first.bindingState,
          RehearsalPackageBindingState.unlinked,
        );
      },
    );

    testWidgets(
      'stems-only bound state displays explicit non-playable Mixer T12 notice and offline bind is blocked in modal',
      (tester) async {
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgStemsId,
          displayName: 'Somente Stems Pacote',
          includeOriginal: false,
        );
        await tester.runAsync(() => manager.importFromSaf(userId: 'user-alpha'));

        repertoireRepo.singleDetail = const SongDetail(
          id: 'song_stems_ui',
          ministryId: 'min_1',
          title: 'Música Stems',
          versions: [
            SongVersion(id: 'v1', name: 'Original', key: 'C'),
          ],
        );

        // 1. Offline bind attempt inside modal fails closed
        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('stems_offline'),
            isOnline: false,
            home: const SongDetailView(
              ministryId: 'min_1',
              songId: 'song_stems_ui',
            ),
          ),
        );
        await pumpIo(tester);

        await tester.ensureVisible(
          find.byKey(const ValueKey('song_detail_rehearsal_bind_button')),
        );
        await tester.tap(
          find.byKey(const ValueKey('song_detail_rehearsal_bind_button')),
        );
        await pumpIo(tester);
        await tester.tap(
          find.byKey(
            const ValueKey('song_detail_rehearsal_package_option_$pkgStemsId'),
          ),
        );
        await pumpIo(tester);

        expect(
          find.byKey(const ValueKey('song_detail_rehearsal_picker_error')),
          findsOneWidget,
        );
        expect(find.textContaining('online'), findsWidgets);

        // Dismiss modal and retry online -> stems-only notice shown
        Navigator.of(
          tester.element(
            find.byKey(
              const ValueKey('song_detail_rehearsal_package_option_$pkgStemsId'),
            ),
          ),
        ).pop();
        await tester.pumpAndSettle();

        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('stems_online'),
            isOnline: true,
            home: const SongDetailView(
              ministryId: 'min_1',
              songId: 'song_stems_ui',
            ),
          ),
        );
        await pumpIo(tester);

        await tester.ensureVisible(
          find.byKey(const ValueKey('song_detail_rehearsal_bind_button')),
        );
        await tester.tap(
          find.byKey(const ValueKey('song_detail_rehearsal_bind_button')),
        );
        await pumpIo(tester);
        await tester.tap(
          find.byKey(
            const ValueKey('song_detail_rehearsal_package_option_$pkgStemsId'),
          ),
        );
        await pumpIo(tester);

        expect(
          find.textContaining(
            'Pacote de 4 stems vinculado (para uso futuro no Mixer T12 — não reproduzível como mixagem completa nesta etapa).',
          ),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'missing initialVersionId refuses silent index 0 binding, duplicate version names resolve by ID, and schedule sequence navigation reconciles per slot',
      (tester) async {
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgOrigId,
          displayName: 'Pacote Escala S1 V2',
          includeOriginal: true,
        );
        await tester.runAsync(() => manager.importFromSaf(userId: 'user-alpha'));

        const s1 = SongDetail(
          id: 's1',
          ministryId: 'min_1',
          title: 'Música Um',
          versions: [
            SongVersion(id: 'v1', name: 'Original', key: 'C'),
            SongVersion(id: 'v2', name: 'Original', key: 'D'),
          ],
        );
        const s2 = SongDetail(
          id: 's2',
          ministryId: 'min_1',
          title: 'Música Dois',
          versions: [
            SongVersion(id: 'v_two', name: 'Principal', key: 'G'),
          ],
        );
        repertoireRepo.songs['s1'] = s1;
        repertoireRepo.songs['s2'] = s2;

        // Bind only s1/v2 (even though v1 and v2 share the display name 'Original')
        await tester.runAsync(
          () => manager.bindSongVersion(
            userId: 'user-alpha',
            ministryId: 'min_1',
            song: s1,
            requestedVersionId: 'v2',
            packageId: pkgOrigId,
            songReadVerified: true,
          ),
        );

        // 1. Missing initialVersionId on s1 refuses silent index 0 load
        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('seq_missing'),
            home: const SongDetailView(
              ministryId: 'min_1',
              songId: 's1',
              initialVersionId: 'ver-removida',
            ),
          ),
        );
        await pumpIo(tester);
        expect(
          find.text(
            'Selecione explicitamente uma versão acima para vincular ou carregar áudio local.',
          ),
          findsOneWidget,
        );
        expect(find.text('Pacote Escala S1 V2'), findsNothing);

        // 2. Schedule sequence: s1(v1) -> s2(v_two) -> s1(v2)
        final sequence = ScheduleSongSequenceContext.fromScheduleSongs(
          ministryId: 'min_1',
          scheduleId: 'sch_t10',
          songs: const [
            ScheduleSong(
              id: 's1',
              title: 'Música Um',
              versionId: 'v1',
              versionName: 'Original',
            ),
            ScheduleSong(
              id: 's2',
              title: 'Música Dois',
              versionId: 'v_two',
              versionName: 'Principal',
            ),
            ScheduleSong(
              id: 's1',
              title: 'Música Um',
              versionId: 'v2',
              versionName: 'Original',
            ),
          ],
          initialScheduleSlotIndex: 0,
        );

        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('seq_nav'),
            home: SongDetailView(
              ministryId: 'min_1',
              songId: 's1',
              initialVersionId: 'v1',
              backLabel: 'Voltar',
              scheduleSequence: sequence,
            ),
          ),
        );
        await pumpIo(tester);

        // Slot 0: s1/v1 has no binding
        expect(find.text('Sem áudio local vinculado'), findsOneWidget);
        expect(find.text('Pacote Escala S1 V2'), findsNothing);

        // Step to slot 1: s2/v_two has no binding
        await tester.tap(
          find.byKey(const ValueKey('song_detail_sequence_next_button')),
        );
        await pumpIo(tester);
        expect(find.text('Sem áudio local vinculado'), findsOneWidget);

        // Step to slot 2: s1/v2 HAS bound package
        await tester.tap(
          find.byKey(const ValueKey('song_detail_sequence_next_button')),
        );
        await pumpIo(tester);
        expect(find.text('Pacote Escala S1 V2'), findsOneWidget);
      },
    );

    testWidgets(
      'displays clear diagnostics for package_missing and resetAuthenticatedFeatures clears binding state',
      (tester) async {
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgOrigId,
          displayName: 'Pacote Diagnóstico',
          includeOriginal: true,
        );
        await tester.runAsync(() => manager.importFromSaf(userId: 'user-alpha'));

        const song = SongDetail(
          id: 'song_diag',
          ministryId: 'min_1',
          title: 'Música Diagnóstico',
          versions: [
            SongVersion(id: 'v1', name: 'Original', key: 'E'),
            SongVersion(id: 'v2', name: 'Acústica', key: 'G'),
          ],
        );
        repertoireRepo.singleDetail = song;

        await tester.runAsync(() async {
          await manager.bindSongVersion(
            userId: 'user-alpha',
            ministryId: 'min_1',
            song: song,
            requestedVersionId: 'v1',
            packageId: pkgOrigId,
            songReadVerified: true,
          );
          await manager.deletePackage(
            userId: 'user-alpha',
            packageId: pkgOrigId,
            confirmedScope: true,
          );
        });

        final container = ProviderContainer(
          overrides: [
            appEnvironmentProvider.overrideWithValue(
              const AppEnvironment(
                env: AppEnv.development,
                apiBaseUrl: 'http://localhost:3000/api/v1',
              ),
            ),
            repertoireRepositoryProvider.overrideWithValue(repertoireRepo),
            songDetailNotifierProvider.overrideWith(
              (ref) => SongDetailNotifier(repository: repertoireRepo),
            ),
            ministryContextNotifierProvider.overrideWith(
              (ref) => _TestMinistryContextNotifier(),
            ),
            authNotifierProvider.overrideWith(
              (ref) => _TestAuthNotifier(userId: 'user-alpha'),
            ),
            rehearsalPackageSafPortProvider.overrideWithValue(safPort),
            rehearsalPackageManagerProvider.overrideWithValue(manager),
            smartChordRepertoireLinkRepositoryProvider.overrideWithValue(
              _EmptyLinkRepo(),
            ),
            songSmartChordsNotifierProvider.overrideWith(
              (ref) => SongSmartChordsNotifier(
                repository: _NoopSmartChordRepo(),
                linkRepository: _EmptyLinkRepo(),
              ),
            ),
            smartChordRepertoireLinkNotifierProvider.overrideWith(
              (ref) => SmartChordRepertoireLinkNotifier(
                repository: _EmptyLinkRepo(),
              ),
            ),
          ],
        );
        addTearDown(container.dispose);

        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: const MaterialApp(
              home: SongDetailView(
                ministryId: 'min_1',
                songId: 'song_diag',
                initialVersionId: 'v1',
              ),
            ),
          ),
        );
        await pumpIo(tester);

        expect(find.textContaining('package_missing'), findsOneWidget);
        expect(
          container.read(songVersionAudioBindingsNotifierProvider).bindings,
          hasLength(1),
        );

        resetAuthenticatedFeatures(container);
        await tester.pump();

        expect(
          container.read(songVersionAudioBindingsNotifierProvider).bindings,
          isEmpty,
        );
        expect(
          container.read(songVersionAudioBindingsNotifierProvider).boundUserId,
          isNull,
        );
      },
    );

    testWidgets(
      'displays clear UI diagnostics for package_corrupted, package_replaced_incompatible, and version_removed',
      (tester) async {
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgOrigId,
          revision: 1,
          seedOffset: 3,
          displayName: 'Pacote Estados',
          includeOriginal: true,
        );
        await tester.runAsync(() => manager.importFromSaf(userId: 'user-alpha'));

        const song = SongDetail(
          id: 'song_states',
          ministryId: 'min_1',
          title: 'Música Estados',
          versions: [
            SongVersion(id: 'v1', name: 'Original', key: 'C'),
            SongVersion(id: 'v2', name: 'Acústica', key: 'D'),
          ],
        );
        repertoireRepo.singleDetail = song;

        await tester.runAsync(
          () => manager.bindSongVersion(
            userId: 'user-alpha',
            ministryId: 'min_1',
            song: song,
            requestedVersionId: 'v1',
            packageId: pkgOrigId,
            songReadVerified: true,
          ),
        );

        // 1. package_corrupted
        final hash = RehearsalPackageManager.computeAccountNamespaceHash(
          'user-alpha',
        );
        final origFile = File(
          '${tempDir.path}/rehearsal_packages/accounts/$hash/packages/$pkgOrigId/original.wav',
        );
        final originalBytes = origFile.readAsBytesSync();
        origFile.writeAsBytesSync(originalBytes.sublist(0, 10), flush: true);

        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('diag_corrupted'),
            home: const SongDetailView(
              ministryId: 'min_1',
              songId: 'song_states',
              initialVersionId: 'v1',
            ),
          ),
        );
        await pumpIo(tester);
        expect(find.textContaining('package_corrupted'), findsOneWidget);

        // Restore bytes and revalidate
        origFile.writeAsBytesSync(originalBytes, flush: true);
        await tester.runAsync(
          () => manager.revalidatePackage(
            userId: 'user-alpha',
            packageId: pkgOrigId,
          ),
        );

        // 2. package_replaced_incompatible
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgOrigId,
          revision: 2,
          seedOffset: 77,
          displayName: 'Pacote Estados',
          includeOriginal: false,
        );
        await tester.runAsync(() async {
          final conflict = await manager.importFromSaf(userId: 'user-alpha');
          await manager.confirmConflictReplace(
            userId: 'user-alpha',
            pendingTransactionId: conflict.conflict!.pendingTransactionId,
          );
        });

        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('diag_replaced'),
            home: const SongDetailView(
              ministryId: 'min_1',
              songId: 'song_states',
              initialVersionId: 'v1',
            ),
          ),
        );
        await pumpIo(tester);
        expect(
          find.textContaining('package_replaced_incompatible'),
          findsOneWidget,
        );

        // 3. version_removed (bind v2 then remove v2 from song)
        await tester.runAsync(
          () => manager.bindSongVersion(
            userId: 'user-alpha',
            ministryId: 'min_1',
            song: song,
            requestedVersionId: 'v2',
            packageId: pkgOrigId,
            songReadVerified: true,
          ),
        );
        repertoireRepo.singleDetail = const SongDetail(
          id: 'song_states',
          ministryId: 'min_1',
          title: 'Música Estados',
          versions: [
            SongVersion(id: 'v1', name: 'Original', key: 'C'),
          ],
        );

        await tester.pumpWidget(
          buildSubject(
            scopeKey: const ValueKey('diag_ver_removed'),
            home: const SongDetailView(
              ministryId: 'min_1',
              songId: 'song_states',
              initialVersionId: 'v2',
            ),
          ),
        );
        await pumpIo(tester);
        expect(find.textContaining('version_removed'), findsOneWidget);
      },
    );
  });
}
