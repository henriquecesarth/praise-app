import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_storage_info.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_saf_channel.dart';

class _FakeSafPort implements RehearsalPackageSafPort {
  _FakeSafPort({this.info, this.error});
  final SafStorageInfo? info;
  final Object? error;
  final List<String> calls = [];

  @override
  Stream<SafProgressEvent> get progressStream => const Stream.empty();

  @override
  Future<SafStorageInfo> getStorageInfo() async {
    calls.add('getStorageInfo');
    if (error != null) throw error!;
    return info!;
  }

  @override
  Future<SafStageResult> pickAndStagePackage({
    required String operationId,
    required String targetStageFilePath,
    int maxBytes = RehearsalLimitsV1.maxCompressedBytes,
    int requiredReserveBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes,
  }) async {
    calls.add('pickAndStagePackage');
    throw StateError('must not be called');
  }

  @override
  Future<SafExportResult> exportPackageToUri({
    required String operationId,
    required String sourceFilePath,
    required String suggestedFileName,
  }) async {
    calls.add('exportPackageToUri');
    throw StateError('must not be called');
  }

  @override
  Future<bool> cancelOperation({String? operationId}) async {
    calls.add('cancelOperation');
    throw StateError('must not be called');
  }
}

Matcher _failure(String code) =>
    isA<AppFailure>().having((f) => f.code, 'code', code);

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const info = SafStorageInfo(
    filesDirPath: '/data/user/0/app/files',
    availableBytes: 1000,
    totalBytes: 5000,
  );

  group('SafMinistryAudioStorageInfoSource', () {
    test('reads storage through the existing port (read-only)', () async {
      final port = _FakeSafPort(info: info);
      final source = SafMinistryAudioStorageInfoSource(
          port: port, platform: () => TargetPlatform.android);
      final status = await source.query();
      expect(status.availableBytes, 1000);
      expect(status.totalBytes, 5000);
      expect(status.filesDirPath, '/data/user/0/app/files');
      expect(port.calls, ['getStorageInfo']);
    });

    test('fails explicitly on iOS without touching the port', () async {
      final port = _FakeSafPort(info: info);
      final source = SafMinistryAudioStorageInfoSource(
          port: port, platform: () => TargetPlatform.iOS);
      await expectLater(source.query(),
          throwsA(_failure(SafMinistryAudioStorageInfoSource.unsupportedPlatformCode)));
      expect(port.calls, isEmpty);
    });

    test('maps a port failure to a safe AppFailure', () async {
      final source = SafMinistryAudioStorageInfoSource(
        port: _FakeSafPort(
            error: const SafChannelException('SAF_UNAVAILABLE', 'x')),
        platform: () => TargetPlatform.android,
      );
      await expectLater(source.query(),
          throwsA(_failure(SafMinistryAudioStorageInfoSource.unavailableCode)));
    });

    test('rejects inconsistent numbers', () async {
      final source = SafMinistryAudioStorageInfoSource(
        port: _FakeSafPort(
            info: const SafStorageInfo(
                filesDirPath: '/f', availableBytes: 10, totalBytes: 5)),
        platform: () => TargetPlatform.android,
      );
      await expectLater(source.query(),
          throwsA(_failure(SafMinistryAudioStorageInfoSource.unavailableCode)));
    });

    test('fails safely when the native channel does not exist', () async {
      final adapter = MethodChannelRehearsalPackageSafAdapter(
        channel: const MethodChannel('com.louvaio.test/absent_channel'),
      );
      addTearDown(adapter.dispose);
      final source = SafMinistryAudioStorageInfoSource(
          port: adapter, platform: () => TargetPlatform.android);
      await expectLater(source.query(),
          throwsA(_failure(SafMinistryAudioStorageInfoSource.unavailableCode)));
    });
  });

  group('MinistryAudioStorageStatus.privateRootFor', () {
    const status = MinistryAudioStorageStatus(
        filesDirPath: '/nonexistent_louvaio_test_root/files',
        availableBytes: 1,
        totalBytes: 2);

    test('is distinct per user and ministry and from rehearsal storage', () {
      final a = status.privateRootFor(userId: 'u1', ministryId: 'm1');
      final b = status.privateRootFor(userId: 'u2', ministryId: 'm1');
      final c = status.privateRootFor(userId: 'u1', ministryId: 'm2');
      expect({a, b, c}.length, 3);
      expect(a,
          '/nonexistent_louvaio_test_root/files/ministry_audio_library/users/u1/ministries/m1');
      expect(a, isNot(contains('rehearsal_packages')));
    });

    test('is pure: creates nothing on disk', () {
      final root = status.privateRootFor(userId: 'u1', ministryId: 'm1');
      expect(Directory(root).existsSync(), isFalse);
      expect(Directory('/nonexistent_louvaio_test_root').existsSync(), isFalse);
    });

    test('rejects path-like ids and unsafe roots', () {
      for (final bad in ['../x', 'a/b', '', 'a b', 'x' * 129]) {
        expect(() => status.privateRootFor(userId: bad, ministryId: 'm1'),
            throwsA(_failure('AUDIO_STORAGE_INVALID_SCOPE')));
        expect(() => status.privateRootFor(userId: 'u1', ministryId: bad),
            throwsA(_failure('AUDIO_STORAGE_INVALID_SCOPE')));
      }
      for (final root in ['relative/files', '/a/../b', '']) {
        final s = MinistryAudioStorageStatus(
            filesDirPath: root, availableBytes: 1, totalBytes: 2);
        expect(() => s.privateRootFor(userId: 'u1', ministryId: 'm1'),
            throwsA(_failure('AUDIO_STORAGE_INVALID_ROOT')));
      }
    });
  });
}
