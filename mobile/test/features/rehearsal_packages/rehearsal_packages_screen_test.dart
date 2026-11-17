import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/app/app.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/audio/rehearsal_package_validator.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/auth/presentation/login_screen.dart';
import 'package:louvaio_mobile/features/dashboard/data/dashboard_repository.dart';
import 'package:louvaio_mobile/features/dashboard/domain/announcement.dart';
import 'package:louvaio_mobile/features/dashboard/domain/dashboard_schedule_summary.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_manager.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/data/rehearsal_package_saf_channel.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/domain/rehearsal_package_models.dart';
import 'package:louvaio_mobile/features/rehearsal_packages/presentation/views/rehearsal_packages_screen.dart';

import '../../support/rehearsal_package_corpus.dart';

class _StubAuthRepository implements AuthRepository {
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
  }) => throw UnimplementedError();

  @override
  Future<AuthUser> signUp({
    required String name,
    required String email,
    required String password,
  }) => throw UnimplementedError();

  @override
  Future<AuthUser> getMe() => throw UnimplementedError();

  @override
  Future<void> signOut() async {}
}

class _TestAuthNotifier extends AuthNotifier {
  _TestAuthNotifier({String? initialUserId = 'user-alpha'})
    : super(_StubAuthRepository()) {
    if (initialUserId != null) {
      setAuthenticated(initialUserId);
    } else {
      setUnauthenticated();
    }
  }

  void setAuthenticated(String userId) {
    state = AuthState.authenticated(
      AuthUser(
        id: userId,
        email: '$userId@louvaio.test',
        name: 'Usuário $userId',
      ),
    );
  }

  void setUnauthenticated() {
    state = const AuthState.unauthenticated();
  }

  void setInitializing() {
    state = const AuthState.initializing();
  }
}

class _MockMinistryRepository implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async => const [
    Ministry(id: 'min-1', name: 'Ministério Principal'),
  ];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FailingMinistryRepository implements MinistryRepository {
  @override
  Future<List<Ministry>> getMyMinistries() async {
    throw AppFailure.network(message: 'Sem conexão com a internet.');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeDashboardRepository implements DashboardRepository {
  @override
  Future<List<DashboardScheduleSummary>> getSchedules(String ministryId) async =>
      const [];

  @override
  Future<List<Announcement>> getAnnouncements(
    String ministryId, {
    int limit = 20,
  }) async => const [];

  @override
  Future<Announcement> createAnnouncement(
    String ministryId,
    Map<String, dynamic> data,
  ) => throw UnimplementedError();
}

final class _FakeWidgetSafPort implements RehearsalPackageSafPort {
  _FakeWidgetSafPort({required this.filesDirPath});

  final String filesDirPath;
  int availableBytes = 1024 * 1024 * 1024; // 1 GiB
  int totalBytes = 8 * 1024 * 1024 * 1024; // 8 GiB

  final StreamController<SafProgressEvent> _progressController =
      StreamController<SafProgressEvent>.broadcast();

  Uint8List? nextPickArchiveBytes;
  SafStageResult? overridePickResult;
  SafExportResult? overrideExportResult;
  Future<void> Function()? onGetStorageInfoStarted;
  Future<void> Function(String operationId)? onPickStarted;

  int pickCalls = 0;
  int exportCalls = 0;
  int cancelCalls = 0;
  String? lastSuggestedFileName;
  Uint8List? lastExportedBytes;

  @override
  Stream<SafProgressEvent> get progressStream => _progressController.stream;

  void emitProgress(SafProgressEvent event) {
    if (!_progressController.isClosed) {
      _progressController.add(event);
    }
  }

  @override
  Future<SafStorageInfo> getStorageInfo() async {
    await onGetStorageInfoStarted?.call();
    return SafStorageInfo(
      filesDirPath: filesDirPath,
      availableBytes: availableBytes,
      totalBytes: totalBytes,
    );
  }

  @override
  Future<SafStageResult> pickAndStagePackage({
    required String operationId,
    required String targetStageFilePath,
    int maxBytes = RehearsalLimitsV1.maxCompressedBytes,
    int requiredReserveBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes,
  }) async {
    pickCalls++;
    await onPickStarted?.call(operationId);

    if (overridePickResult != null) {
      return overridePickResult!;
    }

    final bytes = nextPickArchiveBytes;
    if (bytes == null) {
      return const SafStageResult(status: SafStageStatus.cancelled);
    }

    final targetFile = File(targetStageFilePath);
    targetFile.parent.createSync(recursive: true);
    targetFile.writeAsBytesSync(bytes, flush: true);

    emitProgress(
      SafProgressEvent(
        operationId: operationId,
        phase: 'staging_copy',
        bytesProcessed: bytes.length,
        totalBytes: bytes.length,
      ),
    );

    return SafStageResult(
      status: SafStageStatus.staged,
      stagedFilePath: targetFile.path,
      bytesCopied: bytes.length,
      untrustedDisplayName: 'pacote.louvaio-rehearsal.zip',
      untrustedDeclaredSize: bytes.length,
      availableBytesAfter: availableBytes - bytes.length,
    );
  }

  @override
  Future<SafExportResult> exportPackageToUri({
    required String operationId,
    required String sourceFilePath,
    required String suggestedFileName,
  }) async {
    exportCalls++;
    lastSuggestedFileName = suggestedFileName;

    if (overrideExportResult != null) {
      return overrideExportResult!;
    }

    final sourceFile = File(sourceFilePath);
    if (!sourceFile.existsSync()) {
      return const SafExportResult(
        status: SafExportStatus.error,
        code: 'SOURCE_NOT_FOUND',
        message: 'Arquivo fonte não encontrado.',
      );
    }

    final bytes = sourceFile.readAsBytesSync();
    lastExportedBytes = bytes;
    emitProgress(
      SafProgressEvent(
        operationId: operationId,
        phase: 'exporting',
        bytesProcessed: bytes.length,
        totalBytes: bytes.length,
      ),
    );
    return SafExportResult(
      status: SafExportStatus.exported,
      bytesWritten: bytes.length,
    );
  }

  @override
  Future<bool> cancelOperation({String? operationId}) async {
    cancelCalls++;
    return true;
  }

  Future<void> dispose() async {
    await _progressController.close();
  }
}

Uint8List _buildValidPackageZip({
  String packageId = '11111111-1111-4111-8111-111111111111',
  int revision = 1,
  String displayName = 'Santo Pra Sempre - Ensaio',
  int seedOffset = 0,
  bool includeOriginal = false,
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

  const stemIds = ['vocals', 'drums', 'bass', 'other'];
  for (var i = 0; i < stemIds.length; i++) {
    final stemId = stemIds[i];
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

Future<void> _pumpUntilIdle(WidgetTester tester) async {
  final element = tester.element(find.byType(RehearsalPackagesScreen));
  final container = ProviderScope.containerOf(element);
  for (var i = 0; i < 2000; i++) {
    await tester.runAsync(() => Future<void>.delayed(Duration.zero));
    await tester.pump(const Duration(milliseconds: 1));
    final state = container.read(rehearsalPackagesNotifierProvider);
    if (!state.isBusy && !state.isLoading) {
      await tester.pumpAndSettle();
      return;
    }
    if (i % 20 == 19) {
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 5)),
      );
    }
  }
  await tester.pumpAndSettle();
}

Future<void> _pumpScreen(
  WidgetTester tester, {
  required _FakeWidgetSafPort safPort,
  required _TestAuthNotifier authNotifier,
  RehearsalPackageManager? manager,
  double textScaleFactor = 1.6,
}) async {
  await tester.binding.setSurfaceSize(const Size(360, 800));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final effectiveManager = manager ?? RehearsalPackageManager(safPort: safPort);

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        authNotifierProvider.overrideWith((ref) => authNotifier),
        rehearsalPackageSafPortProvider.overrideWithValue(safPort),
        rehearsalPackageManagerProvider.overrideWithValue(effectiveManager),
      ],
      child: MaterialApp(
        home: MediaQuery(
          data: MediaQueryData(
            size: const Size(360, 800),
            textScaler: TextScaler.linear(textScaleFactor),
          ),
          child: const RehearsalPackagesScreen(),
        ),
      ),
    ),
  );

  await tester.pump();
  await _pumpUntilIdle(tester);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tempDir;
  late _FakeWidgetSafPort safPort;
  late _TestAuthNotifier authNotifier;

  setUp(() {
    tempDir = Directory.systemTemp.createTempSync('louvaio_rehearsal_ui_');
    safPort = _FakeWidgetSafPort(filesDirPath: tempDir.path);
    authNotifier = _TestAuthNotifier(initialUserId: 'user-alpha');
  });

  tearDown(() async {
    await safPort.dispose();
    if (tempDir.existsSync()) {
      tempDir.deleteSync(recursive: true);
    }
  });

  group('RehearsalPackagesScreen UI & Controller', () {
    testWidgets(
      'renders at 360x800 with 1.6 textScaler without overflow, showing backup warning, storage summary and empty state',
      (tester) async {
        final flutterErrors = <FlutterErrorDetails>[];
        final prevOnError = FlutterError.onError;
        FlutterError.onError = (details) {
          flutterErrors.add(details);
          prevOnError?.call(details);
        };
        addTearDown(() => FlutterError.onError = prevOnError);

        await _pumpScreen(
          tester,
          safPort: safPort,
          authNotifier: authNotifier,
          textScaleFactor: 1.6,
        );

        expect(flutterErrors, isEmpty);
        expect(find.text('Pacotes de Ensaio Offline'), findsOneWidget);
        expect(
          find.byKey(const ValueKey('rehearsal_import_button')),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('rehearsal_backup_notice_card')),
          findsOneWidget,
        );
        expect(
          find.textContaining('armazenamento interno privado deste aparelho'),
          findsOneWidget,
        );
        expect(
          find.textContaining('Desinstalar o aplicativo'),
          findsOneWidget,
        );
        expect(
          find.byKey(const ValueKey('rehearsal_storage_summary_card')),
          findsOneWidget,
        );
        expect(find.textContaining('256 MiB'), findsOneWidget);
        expect(
          find.text('Nenhum pacote de ensaio importado'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'displays imported package card with 4 stems, metadata, unlinked status, details sheet, and NO SongVersion link',
      (tester) async {
        final flutterErrors = <FlutterErrorDetails>[];
        final prevOnError = FlutterError.onError;
        FlutterError.onError = (details) {
          flutterErrors.add(details);
          prevOnError?.call(details);
        };
        addTearDown(() => FlutterError.onError = prevOnError);

        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: '11111111-1111-4111-8111-111111111111',
          displayName: 'Santo Pra Sempre - Ensaio',
          includeOriginal: true,
        );

        await _pumpScreen(
          tester,
          safPort: safPort,
          authNotifier: authNotifier,
          textScaleFactor: 1.6,
        );

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        await _pumpUntilIdle(tester);

        expect(flutterErrors, isEmpty);
        expect(
          find.byKey(const ValueKey('rehearsal_outcome_banner')),
          findsOneWidget,
        );
        expect(find.text('Santo Pra Sempre - Ensaio'), findsOneWidget);
        expect(find.text('Verificado'), findsOneWidget);
        expect(find.textContaining('louvaio-rehearsal v1'), findsOneWidget);
        expect(
          find.textContaining(
            LocalRehearsalPackageRecord.defaultStorageLocationLabel,
          ),
          findsOneWidget,
        );
        expect(find.text('Vínculo local: Não associado'), findsOneWidget);

        expect(find.textContaining('Vocais: WAV / PCM_S16LE'), findsOneWidget);
        expect(find.textContaining('Bateria: WAV / PCM_S16LE'), findsOneWidget);
        expect(find.textContaining('Baixo: WAV / PCM_S16LE'), findsOneWidget);
        expect(find.textContaining('Outros: WAV / PCM_S16LE'), findsOneWidget);
        expect(
          find.textContaining('Original: WAV / PCM_S16LE'),
          findsOneWidget,
        );

        expect(find.textContaining('SongVersion'), findsNothing);
        expect(find.textContaining('Vincular'), findsNothing);

        final detailsBtn = find.byKey(
          const ValueKey(
            'rehearsal_details_11111111-1111-4111-8111-111111111111',
          ),
        );
        await tester.ensureVisible(detailsBtn);
        await tester.tap(detailsBtn);
        await tester.pumpAndSettle();

        expect(
          find.text('11111111-1111-4111-8111-111111111111'),
          findsOneWidget,
        );
        expect(find.text('SHA-256 composto'), findsOneWidget);
        expect(find.text('Declaração de direitos de uso'), findsOneWidget);
      },
    );

    testWidgets(
      'displays progress bar and working Cancel button during active import',
      (tester) async {
        final pickCompleter = Completer<void>();
        safPort.onPickStarted = (opId) async {
          safPort.emitProgress(
            SafProgressEvent(
              operationId: opId,
              phase: 'staging_copy',
              bytesProcessed: 12 * 1024 * 1024,
              totalBytes: 45 * 1024 * 1024,
            ),
          );
          await pickCompleter.future;
        };
        safPort.overridePickResult = const SafStageResult(
          status: SafStageStatus.cancelled,
        );

        await _pumpScreen(
          tester,
          safPort: safPort,
          authNotifier: authNotifier,
          textScaleFactor: 1.0,
        );

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        await tester.pump();
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump();

        expect(
          find.byKey(const ValueKey('rehearsal_progress_card')),
          findsOneWidget,
        );
        expect(find.byType(LinearProgressIndicator), findsOneWidget);
        expect(find.textContaining('12,0 MiB / 45,0 MiB'), findsOneWidget);

        final cancelBtn = find.byKey(
          const ValueKey('rehearsal_cancel_operation_button'),
        );
        expect(cancelBtn, findsOneWidget);

        await tester.tap(cancelBtn);
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        pickCompleter.complete();
        await _pumpUntilIdle(tester);

        expect(safPort.cancelCalls, greaterThanOrEqualTo(1));
        expect(
          find.byKey(const ValueKey('rehearsal_progress_card')),
          findsNothing,
        );
        expect(
          find.byKey(const ValueKey('rehearsal_outcome_banner')),
          findsOneWidget,
        );
        expect(find.text('Operação cancelada'), findsOneWidget);
      },
    );

    testWidgets(
      'conflict flow displays conflict card, allows Cancel to keep existing and Replace to update',
      (tester) async {
        const pkgId = '22222222-2222-4222-8222-222222222222';
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgId,
          revision: 1,
          displayName: 'Caminho No Deserto v1',
          seedOffset: 1,
        );

        await _pumpScreen(
          tester,
          safPort: safPort,
          authNotifier: authNotifier,
          textScaleFactor: 1.0,
        );

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        await _pumpUntilIdle(tester);
        expect(find.text('Caminho No Deserto v1'), findsOneWidget);

        // Now pick revision 2 with the same packageId -> triggers conflict
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgId,
          revision: 2,
          displayName: 'Caminho No Deserto v2',
          seedOffset: 20,
        );

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        await _pumpUntilIdle(tester);

        expect(
          find.byKey(const ValueKey('rehearsal_conflict_card')),
          findsOneWidget,
        );
        expect(
          find.textContaining('Nenhum dado existente foi sobrescrito'),
          findsOneWidget,
        );

        // Cancel conflict first -> v1 preserved
        final cancelConflictBtn = find.byKey(
          const ValueKey('rehearsal_conflict_cancel_button'),
        );
        await tester.ensureVisible(cancelConflictBtn);
        await tester.tap(cancelConflictBtn);
        await _pumpUntilIdle(tester);

        expect(
          find.byKey(const ValueKey('rehearsal_conflict_card')),
          findsNothing,
        );
        expect(find.text('Caminho No Deserto v1'), findsOneWidget);
        expect(find.text('Caminho No Deserto v2'), findsNothing);

        // Pick revision 2 again and replace
        final importBtn = find.byKey(const ValueKey('rehearsal_import_button'));
        await tester.ensureVisible(importBtn);
        await tester.tap(importBtn);
        await _pumpUntilIdle(tester);
        expect(
          find.byKey(const ValueKey('rehearsal_conflict_card')),
          findsOneWidget,
        );

        final replaceBtn = find.byKey(
          const ValueKey('rehearsal_conflict_replace_button'),
        );
        await tester.ensureVisible(replaceBtn);
        await tester.tap(replaceBtn);
        await _pumpUntilIdle(tester);

        expect(
          find.byKey(const ValueKey('rehearsal_conflict_card')),
          findsNothing,
        );
        expect(find.text('Caminho No Deserto v2'), findsOneWidget);
      },
    );

    testWidgets(
      'rename dialog validates blank input and updates displayName locally',
      (tester) async {
        const pkgId = '33333333-3333-4333-8333-333333333333';
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgId,
          displayName: 'Nome Original Manifesto',
        );

        await _pumpScreen(
          tester,
          safPort: safPort,
          authNotifier: authNotifier,
          textScaleFactor: 1.0,
        );

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        await _pumpUntilIdle(tester);

        final renameBtn = find.byKey(const ValueKey('rehearsal_rename_$pkgId'));
        await tester.ensureVisible(renameBtn);
        await tester.tap(renameBtn);
        await tester.pumpAndSettle();

        // Blank input shows validation error and keeps dialog open
        await tester.enterText(
          find.byKey(const ValueKey('rehearsal_rename_text_field')),
          '   ',
        );
        await tester.tap(
          find.byKey(const ValueKey('rehearsal_rename_confirm_button')),
        );
        await tester.pumpAndSettle();
        expect(
          find.text('Informe um nome entre 1 e 120 caracteres.'),
          findsOneWidget,
        );

        // Valid input updates local label while keeping original manifest title note
        await tester.enterText(
          find.byKey(const ValueKey('rehearsal_rename_text_field')),
          'Ensaio Domingo Noite',
        );
        await tester.tap(
          find.byKey(const ValueKey('rehearsal_rename_confirm_button')),
        );
        await _pumpUntilIdle(tester);

        expect(find.text('Ensaio Domingo Noite'), findsOneWidget);
        expect(
          find.text('Original no manifesto: Nome Original Manifesto'),
          findsOneWidget,
        );
      },
    );

    testWidgets(
      'revalidate, export, and delete dialogs work end-to-end',
      (tester) async {
        const pkgId = '44444444-4444-4444-8444-444444444444';
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: pkgId,
          displayName: 'Agnus Dei - Local',
        );

        await _pumpScreen(
          tester,
          safPort: safPort,
          authNotifier: authNotifier,
          textScaleFactor: 1.0,
        );

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        await _pumpUntilIdle(tester);

        // Revalidate action
        final revalidateBtn = find.byKey(
          const ValueKey('rehearsal_revalidate_$pkgId'),
        );
        await tester.ensureVisible(revalidateBtn);
        await tester.tap(revalidateBtn);
        await _pumpUntilIdle(tester);
        expect(find.text('Pacote íntegro'), findsOneWidget);

        // Export action
        final exportBtn = find.byKey(
          const ValueKey('rehearsal_export_$pkgId'),
        );
        await tester.ensureVisible(exportBtn);
        await tester.tap(exportBtn);
        await _pumpUntilIdle(tester);
        expect(find.text('Pacote exportado'), findsOneWidget);
        expect(safPort.exportCalls, 1);
        expect(
          safPort.lastSuggestedFileName,
          'Agnus Dei - Local.louvaio-rehearsal.zip',
        );
        expect(safPort.lastExportedBytes, isNotNull);

        // Delete dialog explains scope and removes package after confirmation
        final deleteBtn = find.byKey(
          const ValueKey('rehearsal_delete_$pkgId'),
        );
        await tester.ensureVisible(deleteBtn);
        await tester.tap(deleteBtn);
        await tester.pumpAndSettle();

        expect(
          find.textContaining(
            'Arquivos originais ou backups salvos fora do app não serão apagados.',
          ),
          findsOneWidget,
        );

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_delete_confirm_button')),
        );
        await _pumpUntilIdle(tester);

        expect(find.text('Cópia local removida'), findsOneWidget);
        expect(
          find.text('Nenhum pacote de ensaio importado'),
          findsOneWidget,
        );
      },
    );

    test(
      'controller resetAuthenticatedFeatures cancels active import and isolates Account A from Account B',
      () async {
        final pickCompleter = Completer<void>();
        safPort.onPickStarted = (_) => pickCompleter.future;
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: '55555555-5555-4555-8555-555555555555',
          displayName: 'Conta A Privado',
        );

        final manager = RehearsalPackageManager(safPort: safPort);
        final container = ProviderContainer(
          overrides: [
            authNotifierProvider.overrideWith((ref) => authNotifier),
            rehearsalPackageSafPortProvider.overrideWithValue(safPort),
            rehearsalPackageManagerProvider.overrideWithValue(manager),
          ],
        );
        addTearDown(container.dispose);

        final notifier = container.read(
          rehearsalPackagesNotifierProvider.notifier,
        );

        // Start an in-flight import for Account A
        final inFlight = notifier.importFromSaf();
        await Future<void>.delayed(const Duration(milliseconds: 20));
        expect(
          container.read(rehearsalPackagesNotifierProvider).isBusy,
          isTrue,
        );

        // Session logout / clear invokes resetAuthenticatedFeatures
        resetAuthenticatedFeatures(container);
        expect(safPort.cancelCalls, greaterThanOrEqualTo(1));

        // Release blocked SAF picker after session invalidation
        pickCompleter.complete();
        await inFlight;

        // State must remain clean with zero Account A leakage
        final afterReset = container.read(rehearsalPackagesNotifierProvider);
        expect(afterReset.isBusy, isFalse);
        expect(afterReset.packages, isEmpty);
        expect(afterReset.boundUserId, isNull);
        expect(afterReset.lastOutcome, isNull);

        // Complete a normal import for Account A
        authNotifier.setAuthenticated('user-alpha');
        final alphaNotifier = container.read(
          rehearsalPackagesNotifierProvider.notifier,
        );
        await alphaNotifier.importFromSaf();
        expect(
          container
              .read(rehearsalPackagesNotifierProvider)
              .packages
              .map((p) => p.displayName),
          ['Conta A Privado'],
        );

        // Logout & switch to Account B
        resetAuthenticatedFeatures(container);
        authNotifier.setAuthenticated('user-beta');
        final betaNotifier = container.read(
          rehearsalPackagesNotifierProvider.notifier,
        );
        await betaNotifier.loadLibrary();

        final betaState = container.read(rehearsalPackagesNotifierProvider);
        expect(betaState.boundUserId, 'user-beta');
        expect(betaState.packages, isEmpty);
      },
    );

    testWidgets(
      'renders loaded package card at 360x800 with 2.0 textScaler without overflow',
      (tester) async {
        final flutterErrors = <FlutterErrorDetails>[];
        final prevOnError = FlutterError.onError;
        FlutterError.onError = (details) {
          flutterErrors.add(details);
          prevOnError?.call(details);
        };
        addTearDown(() => FlutterError.onError = prevOnError);

        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: '66666666-6666-4666-8666-666666666666',
          displayName: 'Grande É O Senhor - Ensaio Completo',
          includeOriginal: true,
        );

        await _pumpScreen(
          tester,
          safPort: safPort,
          authNotifier: authNotifier,
          textScaleFactor: 2.0,
        );

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        await _pumpUntilIdle(tester);

        expect(flutterErrors, isEmpty);
        expect(find.text('Grande É O Senhor - Ensaio Completo'), findsOneWidget);
      },
    );

    testWidgets(
      'displays recoverable error notice and retry button when storage channel fails',
      (tester) async {
        final failingPort = _ThrowingStorageSafPort();

        await tester.binding.setSurfaceSize(const Size(360, 800));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => authNotifier),
              rehearsalPackageSafPortProvider.overrideWithValue(failingPort),
              rehearsalPackageManagerProvider.overrideWithValue(
                RehearsalPackageManager(safPort: failingPort),
              ),
            ],
            child: const MaterialApp(home: RehearsalPackagesScreen()),
          ),
        );

        await tester.pump();
        await _pumpUntilIdle(tester);

        expect(
          find.text('Recurso nativo indisponível nesta plataforma.'),
          findsOneWidget,
        );
        expect(find.text('Tentar novamente'), findsOneWidget);
        expect(find.text('Nenhum pacote de ensaio importado'), findsNothing);
        expect(
          find.byKey(const ValueKey('rehearsal_empty_import_button')),
          findsNothing,
        );
      },
    );

    testWidgets(
      'disables import button and ignores mutations while initial loadLibrary is running',
      (tester) async {
        final loadCompleter = Completer<void>();
        safPort.onGetStorageInfoStarted = () => loadCompleter.future;
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: '77777777-7777-4777-8777-777777777777',
          displayName: 'Carga Inicial',
        );

        await tester.binding.setSurfaceSize(const Size(360, 800));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => authNotifier),
              rehearsalPackageSafPortProvider.overrideWithValue(safPort),
              rehearsalPackageManagerProvider.overrideWithValue(
                RehearsalPackageManager(safPort: safPort),
              ),
            ],
            child: const MaterialApp(home: RehearsalPackagesScreen()),
          ),
        );

        await tester.pump();
        await tester.pump();

        final element = tester.element(find.byType(RehearsalPackagesScreen));
        final container = ProviderScope.containerOf(element);
        final loadingState = container.read(rehearsalPackagesNotifierProvider);
        expect(loadingState.isLoading, isTrue);

        final importButton = tester.widget<FilledButton>(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        expect(importButton.onPressed, isNull);

        await tester.tap(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        await container
            .read(rehearsalPackagesNotifierProvider.notifier)
            .importFromSaf();
        await container
            .read(rehearsalPackagesNotifierProvider.notifier)
            .exportPackage('77777777-7777-4777-8777-777777777777');
        expect(safPort.pickCalls, 0);
        expect(safPort.exportCalls, 0);

        loadCompleter.complete();
        await _pumpUntilIdle(tester);

        final loadedImportButton = tester.widget<FilledButton>(
          find.byKey(const ValueKey('rehearsal_import_button')),
        );
        expect(loadedImportButton.onPressed, isNotNull);
      },
    );
  });

  group('Rehearsal Packages Router Auth Guard & Navigation', () {
    testWidgets(
      'unauthenticated visitor navigating to /rehearsal-packages is redirected to /login',
      (tester) async {
        final auth = _TestAuthNotifier(initialUserId: null);
        final storage = InMemoryPreferencesStorage();

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => auth),
              preferencesStorageProvider.overrideWithValue(storage),
              ministryRepositoryProvider.overrideWithValue(
                _MockMinistryRepository(),
              ),
              rehearsalPackageSafPortProvider.overrideWithValue(safPort),
              rehearsalPackageManagerProvider.overrideWithValue(
                RehearsalPackageManager(safPort: safPort),
              ),
            ],
            child: const LouvAioApp(),
          ),
        );
        await tester.pumpAndSettle();

        expect(find.byType(LoginScreen), findsOneWidget);
        expect(find.byType(RehearsalPackagesScreen), findsNothing);

        final BuildContext context = tester.element(find.byType(LoginScreen));
        final router = ProviderScope.containerOf(context).read(routerProvider);
        router.go('/rehearsal-packages');
        await tester.pumpAndSettle();

        expect(find.byType(RehearsalPackagesScreen), findsNothing);
        expect(find.byType(LoginScreen), findsOneWidget);
      },
    );

    testWidgets(
      'authenticated user navigates from Profile tile to RehearsalPackagesScreen and logout redirects to /login cleanly',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 800));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        final auth = _TestAuthNotifier(initialUserId: 'user-alpha');
        final storage = InMemoryPreferencesStorage();
        await storage.setSelectedMinistryIdForUser('user-alpha', 'min-1');

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => auth),
              preferencesStorageProvider.overrideWithValue(storage),
              ministryRepositoryProvider.overrideWithValue(
                _MockMinistryRepository(),
              ),
              dashboardRepositoryProvider.overrideWithValue(
                _FakeDashboardRepository(),
              ),
              rehearsalPackageSafPortProvider.overrideWithValue(safPort),
              rehearsalPackageManagerProvider.overrideWithValue(
                RehearsalPackageManager(safPort: safPort),
              ),
            ],
            child: const LouvAioApp(),
          ),
        );
        await tester.pumpAndSettle();

        await tester.tap(find.text('Perfil'));
        await tester.pumpAndSettle();

        final profileTile = find.byKey(
          const ValueKey('profile_rehearsal_packages_tile'),
        );
        await tester.scrollUntilVisible(
          profileTile,
          200,
          scrollable: find.byType(Scrollable).last,
        );
        await tester.pumpAndSettle();
        expect(profileTile, findsOneWidget);

        await tester.tap(profileTile);
        for (var i = 0; i < 20; i++) {
          await tester.pump(const Duration(milliseconds: 25));
          if (find.byType(RehearsalPackagesScreen).evaluate().isNotEmpty) {
            break;
          }
        }
        await _pumpUntilIdle(tester);

        expect(find.byType(RehearsalPackagesScreen), findsOneWidget);
        expect(find.text('Pacotes de Ensaio Offline'), findsOneWidget);

        final screenElement = tester.element(
          find.byType(RehearsalPackagesScreen),
        );
        final container = ProviderScope.containerOf(screenElement);
        expect(
          container.read(rehearsalPackagesNotifierProvider).boundUserId,
          'user-alpha',
        );

        auth.setUnauthenticated();
        await tester.pumpAndSettle();

        expect(find.byType(RehearsalPackagesScreen), findsNothing);
        expect(find.byType(LoginScreen), findsOneWidget);
        expect(
          container.read(rehearsalPackagesNotifierProvider).boundUserId,
          isNull,
        );
      },
    );

    testWidgets(
      'authenticated user can access /rehearsal-packages offline when ministry repository fails and logout calls resetAuthenticatedFeatures',
      (tester) async {
        final auth = _TestAuthNotifier(initialUserId: 'user-alpha');
        final storage = InMemoryPreferencesStorage();
        final pickCompleter = Completer<void>();
        safPort.onPickStarted = (_) => pickCompleter.future;
        safPort.nextPickArchiveBytes = _buildValidPackageZip(
          packageId: '88888888-8888-4888-8888-888888888888',
          displayName: 'Offline Route Test',
        );

        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              authNotifierProvider.overrideWith((ref) => auth),
              preferencesStorageProvider.overrideWithValue(storage),
              ministryRepositoryProvider.overrideWithValue(
                _FailingMinistryRepository(),
              ),
              rehearsalPackageSafPortProvider.overrideWithValue(safPort),
              rehearsalPackageManagerProvider.overrideWithValue(
                RehearsalPackageManager(safPort: safPort),
              ),
            ],
            child: const LouvAioApp(),
          ),
        );
        await tester.pumpAndSettle();

        final BuildContext context = tester.element(find.byType(LouvAioApp));
        final container = ProviderScope.containerOf(context);
        final router = container.read(routerProvider);
        router.go('/rehearsal-packages');
        for (var i = 0; i < 20; i++) {
          await tester.pump(const Duration(milliseconds: 25));
          if (find.byType(RehearsalPackagesScreen).evaluate().isNotEmpty) {
            break;
          }
        }
        await _pumpUntilIdle(tester);

        expect(find.byType(RehearsalPackagesScreen), findsOneWidget);

        // Start an import so resetAuthenticatedFeatures cancels it on logout
        var inFlightDone = false;
        final inFlight = container
            .read(rehearsalPackagesNotifierProvider.notifier)
            .importFromSaf()
            .whenComplete(() => inFlightDone = true);
        await tester.runAsync(
          () => Future<void>.delayed(const Duration(milliseconds: 20)),
        );
        await tester.pump();

        auth.setUnauthenticated();
        await tester.pumpAndSettle();

        expect(find.byType(RehearsalPackagesScreen), findsNothing);
        expect(find.byType(LoginScreen), findsOneWidget);
        expect(safPort.cancelCalls, greaterThanOrEqualTo(1));

        pickCompleter.complete();
        for (var i = 0; i < 200 && !inFlightDone; i++) {
          await tester.runAsync(() => Future<void>.delayed(Duration.zero));
          await tester.pump(const Duration(milliseconds: 5));
        }
        await inFlight;
        expect(inFlightDone, isTrue);
        expect(
          container.read(rehearsalPackagesNotifierProvider).packages,
          isEmpty,
        );
        expect(
          container.read(rehearsalPackagesNotifierProvider).boundUserId,
          isNull,
        );
      },
    );
  });
}

final class _ThrowingStorageSafPort implements RehearsalPackageSafPort {
  @override
  Stream<SafProgressEvent> get progressStream => const Stream.empty();

  @override
  Future<SafStorageInfo> getStorageInfo() async {
    throw const SafChannelException(
      'SAF_UNAVAILABLE',
      'Recurso nativo indisponível nesta plataforma.',
    );
  }

  @override
  Future<SafStageResult> pickAndStagePackage({
    required String operationId,
    required String targetStageFilePath,
    int maxBytes = RehearsalLimitsV1.maxCompressedBytes,
    int requiredReserveBytes = RehearsalLimitsV1.minFreeSpaceReserveBytes,
  }) => throw UnimplementedError();

  @override
  Future<SafExportResult> exportPackageToUri({
    required String operationId,
    required String sourceFilePath,
    required String suggestedFileName,
  }) => throw UnimplementedError();

  @override
  Future<bool> cancelOperation({String? operationId}) async => false;
}
