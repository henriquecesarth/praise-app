import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:louvaio_mobile/app/environment/app_environment.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/core/http/api_client.dart';
import 'package:louvaio_mobile/core/http/auth_interceptor.dart';
import 'package:louvaio_mobile/core/logging/app_logger.dart';
import 'package:louvaio_mobile/features/auth/data/auth_repository.dart';
import 'package:louvaio_mobile/features/auth/domain/auth_user.dart';
import 'package:louvaio_mobile/features/auth/presentation/controllers/auth_controller.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_player_port.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_repository.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';
import 'package:louvaio_mobile/features/ministry_audio/presentation/controllers/ministry_audio_playback_controller.dart';
import 'package:louvaio_mobile/features/ministry_audio/presentation/views/ministry_audio_library_screen.dart';
import 'package:louvaio_mobile/features/ministry_audio/presentation/views/ministry_audio_mixer_screen.dart';
import 'package:louvaio_mobile/features/ministry_context/data/ministry_repository.dart';
import 'package:louvaio_mobile/features/ministry_context/domain/ministry.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';

import '../data/ministry_audio_cache_test.dart' show idN, playbackFor;
import '../data/ministry_audio_download_manager_test.dart'
    show FakeStorage, FakeTransport, payloadOf;

// ------------------------------------------------------------------- fakes

class _AuthRepo implements AuthRepository {
  @override
  Stream<User?> authStateChanges() => const Stream.empty();
  @override
  User? get currentFirebaseUser => null;
  @override
  Future<String?> getIdToken({bool forceRefresh = false}) async => null;
  @override
  Future<UserCredential> signInWithEmailAndPassword(
          {required String email, required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> signUp(
          {required String name,
          required String email,
          required String password}) =>
      throw UnimplementedError();
  @override
  Future<AuthUser> getMe() => throw UnimplementedError();
  @override
  Future<void> signOut() async {}
}

class _Auth extends AuthNotifier {
  _Auth() : super(_AuthRepo());
  void setUser(String? id) {
    state = id == null
        ? const AuthState.unauthenticated()
        : AuthState.authenticated(
            AuthUser(id: id, email: '$id@louvaio.test', name: id));
  }
}

class _MinRepo implements MinistryRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

MinistryAudioRecording rec(int n,
        {String title = 'Música', String artist = 'Artista', String status = 'published'}) =>
    MinistryAudioRecording.fromJson({
      'id': idN(n),
      'title': '$title $n',
      'artist': artist,
      'version': 'v$n',
      'status': status,
      'updatedAt': 1,
    });

MinistryAudioPage pageOf(List<MinistryAudioRecording> items, {String? next}) =>
    MinistryAudioPage.fromJson({
      'items': [
        for (final r in items)
          {
            'id': r.id,
            'title': r.title,
            'artist': r.artist,
            'version': r.version,
            'status': r.status.name,
            'updatedAt': 1,
          },
      ],
      'nextCursor': next,
    });

class _Repo implements MinistryAudioRepository {
  final List<({String ministry, String query, String? cursor})> calls = [];
  Future<MinistryAudioPage> Function(String ministry, String query, String? cursor)? onList;
  Object? playbackError;

  @override
  Future<MinistryAudioPage> listRecordings({
    required String ministryId,
    String query = '',
    int? limit,
    String? cursor,
    CancelToken? cancelToken,
  }) {
    calls.add((ministry: ministryId, query: query, cursor: cursor));
    return onList!(ministryId, query, cursor);
  }

  @override
  Future<MinistryAudioPlayback> getPlayback({
    required String ministryId,
    required String recordingId,
    CancelToken? cancelToken,
  }) async {
    if (playbackError != null) throw playbackError!;
    return playbackFor(recordingId);
  }
}

class _Port implements MinistryAudioPlayerPort {
  final StreamController<MinistryAudioNativeEvent> bus =
      StreamController<MinistryAudioNativeEvent>.broadcast();
  final List<String> calls = [];
  Completer<void>? prepareGate;
  Completer<void>? snapshotGate;
  Object? prepareError;
  int position = 0;
  int snapshotsInFlight = 0;
  int maxSnapshotsInFlight = 0;
  bool confirmClose = true;

  @override
  Stream<MinistryAudioNativeEvent> get events => bus.stream;

  @override
  Future<({int sampleRate, int frames})> prepare({
    required String sessionId,
    required String userId,
    required String ministryId,
    required String recordingId,
    required int sampleRate,
    required int frames,
  }) async {
    calls.add('prepare:$ministryId');
    if (prepareGate != null) await prepareGate!.future;
    if (prepareError != null) throw prepareError!;
    return (sampleRate: sampleRate, frames: 80000);
  }

  @override
  Future<void> play(String s) async => calls.add('play');
  @override
  Future<void> pause(String s) async => calls.add('pause');
  @override
  Future<void> resume(String s) async => calls.add('resume');
  @override
  Future<void> stop(String s) async => calls.add('stop');
  @override
  Future<void> seek(String s, int frame) async => calls.add('seek:$frame');
  @override
  Future<void> setTrackGain(String s, MinistryStemId stem, double v) async =>
      calls.add('gain:${stem.name}:${v.toStringAsFixed(2)}');
  @override
  Future<void> setTrackMuted(String s, MinistryStemId stem, bool v) async =>
      calls.add('mute:${stem.name}:$v');
  @override
  Future<void> setTrackSolo(String s, MinistryStemId stem, bool v) async =>
      calls.add('solo:${stem.name}:$v');
  @override
  Future<void> setMasterVolume(String s, double v) async =>
      calls.add('master:${v.toStringAsFixed(2)}');

  @override
  Future<MinistryAudioNativeSnapshot> snapshot(String s) async {
    calls.add('snapshot');
    snapshotsInFlight++;
    if (snapshotsInFlight > maxSnapshotsInFlight) {
      maxSnapshotsInFlight = snapshotsInFlight;
    }
    final pos = position;
    try {
      if (snapshotGate != null) await snapshotGate!.future;
    } finally {
      snapshotsInFlight--;
    }
    return MinistryAudioNativeSnapshot(
      sessionId: s,
      state: MinistryAudioNativeState.playing,
      positionFrames: pos,
      durationFrames: 80000,
      sampleRate: 8000,
      gains: const [1, 1, 1, 1, 1, 1],
      muted: const [false, false, false, false, false, false],
      solo: const [false, false, false, false, false, false],
      master: 1,
    );
  }

  @override
  Future<bool> close(String s) async {
    calls.add('close');
    return confirmClose;
  }

  void emit(MinistryAudioNativeState st, String sid) =>
      bus.add(MinistryAudioNativeEvent(sessionId: sid, state: st));
}

// ------------------------------------------------------------------- harness

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory temp;
  late _Repo repo;
  late _Port port;
  late _Auth auth;
  AuthSessionContext? session;
  late ProviderContainer container;

  const ministryA = Ministry(id: 'min_1', name: 'Ministério A');
  const ministryB = Ministry(id: 'min_2', name: 'Ministério B');

  setUp(() {
    temp = Directory.systemTemp.createTempSync('louvaio_audio_ui_');
    repo = _Repo()
      ..onList = (m, q, c) async => pageOf([rec(0), rec(1, artist: 'Outro')]);
    port = _Port();
    auth = _Auth()..setUser('user_1');
    session = const AuthSessionContext(userId: 'user_1', sessionGeneration: 1);
  });

  tearDown(() {
    try {
      temp.deleteSync(recursive: true);
    } catch (_) {}
  });

  List<Override> overrides({
    bool enabled = true,
    AppEnv env = AppEnv.development,
    bool ministryReady = true,
  }) {
    final environment =
        AppEnvironment(env: env, apiBaseUrl: 'http://127.0.0.1:1/api/v1');
    final api = ApiClient(
      environment: environment,
      logger: const AppLogger(isDebug: false),
      sessionContextProvider: () => session,
    );
    return [
      appEnvironmentProvider.overrideWithValue(environment),
      apiClientProvider.overrideWithValue(api),
      authNotifierProvider.overrideWith((ref) => auth),
      ministryAudioLibraryEnabledProvider.overrideWithValue(enabled),
      ministryContextNotifierProvider.overrideWith((ref) {
        final n = MinistryContextNotifier(
          repository: _MinRepo(),
          preferencesStorage: InMemoryPreferencesStorage(),
        );
        n.state = ministryReady
            ? const MinistryContextState(
                status: MinistryBootstrapStatus.ready,
                availableMinistries: [ministryA, ministryB],
                selectedMinistry: ministryA,
              )
            : const MinistryContextState.initial();
        return n;
      }),
      ministryAudioRepositoryProvider.overrideWithValue(repo),
      ministryAudioPlayerPortProvider.overrideWithValue(port),
      ministryAudioDownloadManagerProvider.overrideWith((ref) {
        final notifier = ref.watch(ministryContextNotifierProvider.notifier);
        final manager = MinistryAudioDownloadManager(
          repository: repo,
          transport: FakeTransport(
            behavior: (s, a, t) => Stream.value(payloadOf(s.name,
                salt: int.parse(Uri.parse(t.url).pathSegments[1]))),
          ),
          storage: FakeStorage(temp.path.replaceAll('\\', '/')),
          context: () {
            final s = session;
            final stamp = notifier.contextStamp;
            final id = stamp?.ministryId;
            if (s == null || stamp == null || id == null) return null;
            return MinistryAudioDownloadContext(
              userId: s.userId,
              sessionGeneration: s.sessionGeneration,
              ministryId: id,
              epoch: stamp,
            );
          },
        );
        ref.onDispose(manager.dispose);
        return manager;
      }),
    ];
  }

  GoRouter testRouter({String initial = '/ministry-audio', Duration poll = const Duration(milliseconds: 500)}) {
    return GoRouter(
      initialLocation: initial,
      routes: [
        GoRoute(path: '/', builder: (_, __) => const Scaffold(body: Text('home'))),
        GoRoute(
          path: '/ministry-audio',
          builder: (_, __) => const MinistryAudioLibraryScreen(),
          routes: [
            GoRoute(
              path: 'mixer/:recordingId',
              builder: (_, s) {
                final r = s.extra is MinistryAudioRecording
                    ? s.extra as MinistryAudioRecording
                    : null;
                return MinistryAudioMixerScreen(
                  recordingId: s.pathParameters['recordingId']!,
                  title: r?.title,
                  subtitle: r == null ? null : '${r.artist} • Versão ${r.version}',
                  pollInterval: poll,
                );
              },
            ),
          ],
        ),
      ],
    );
  }

  MinistryAudioPlaybackState ps() =>
      container.read(ministryAudioPlaybackControllerProvider);

  /// Unmount the screens and wait (real time) for any in-flight open/close so
  /// the static download gate and cache leases never leak into the next test.
  Future<void> drainAudio(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    for (var i = 0; i < 400; i++) {
      if (i >= 6 &&
          MinistryAudioCache.debugActiveLeases == 0 &&
          ps().phase != MinistryAudioPlaybackPhase.loading) {
        break;
      }
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 25)));
      await tester.pump(const Duration(milliseconds: 50));
    }
  }

  Future<GoRouter> pumpApp(
    WidgetTester tester, {
    String initial = '/ministry-audio',
    Size size = const Size(400, 800),
    List<Override>? extra,
  }) async {
    tester.view.physicalSize = size;
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    container = ProviderContainer(overrides: [...overrides(), ...?extra]);
    addTearDown(container.dispose);
    addTearDown(() => drainAudio(tester));
    final router = testRouter(initial: initial);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pumpAndSettle();
    return router;
  }

  /// Real file IO (cache/download) does not advance under FakeAsync, so
  /// alternate real waits with pumps until the controller leaves loading.
  Future<void> settleOpen(WidgetTester tester,
      {MinistryAudioPlaybackPhase? target}) async {
    for (var i = 0; i < 400; i++) {
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 25)));
      await tester.pump(const Duration(milliseconds: 50));
      final p = container.read(ministryAudioPlaybackControllerProvider).phase;
      final done = target != null
          ? p == target
          : (p != MinistryAudioPlaybackPhase.loading &&
              p != MinistryAudioPlaybackPhase.idle);
      if (done) {
        break;
      }
    }
    await tester.pump(const Duration(milliseconds: 50));
  }

  Future<void> openMixer(WidgetTester tester, {Size size = const Size(400, 900)}) async {
    await pumpApp(tester, size: size);
    await tester.tap(find.byKey(ValueKey('audio_recording_${idN(0)}')));
    await settleOpen(tester);
  }


  // ------------------------------------------------------------- library

  group('library', () {
    testWidgets('lists published recordings with title, artist, version and the ministry',
        (tester) async {
      repo.onList = (m, q, c) async => pageOf([rec(0), rec(1, status: 'archived'), rec(2)]);
      await pumpApp(tester);
      expect(find.text('Ministério: Ministério A'), findsOneWidget);
      expect(find.text('Música 0'), findsOneWidget);
      expect(find.text('Artista • Versão v0'), findsOneWidget);
      expect(find.text('Música 2'), findsOneWidget);
      expect(find.text('Música 1'), findsNothing, reason: 'archived is never playable');
      expect(repo.calls.single.ministry, 'min_1');
    });

    testWidgets('empty state', (tester) async {
      repo.onList = (m, q, c) async => pageOf([]);
      await pumpApp(tester);
      expect(find.byKey(const ValueKey('audio_library_empty')), findsOneWidget);
    });

    testWidgets('network error shows a message and retry works', (tester) async {
      var fail = true;
      repo.onList = (m, q, c) async {
        if (fail) throw AppFailure.network();
        return pageOf([rec(0)]);
      };
      await pumpApp(tester);
      expect(find.byKey(const ValueKey('audio_library_error')), findsOneWidget);
      fail = false;
      await tester.tap(find.byKey(const ValueKey('audio_library_retry')));
      await tester.pumpAndSettle();
      expect(find.text('Música 0'), findsOneWidget);
    });

    testWidgets('search is debounced and sent to the repository', (tester) async {
      await pumpApp(tester);
      repo.calls.clear();
      repo.onList = (m, q, c) async => pageOf([rec(5, title: 'Grande Deus')]);
      await tester.enterText(find.byKey(const ValueKey('audio_library_search')), 'grande');
      await tester.pump(const Duration(milliseconds: 100));
      expect(repo.calls, isEmpty, reason: 'still debouncing');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(repo.calls.single.query, 'grande');
      expect(find.text('Grande Deus 5'), findsOneWidget);
    });

    testWidgets('pagination follows nextCursor and de-duplicates', (tester) async {
      repo.onList = (m, q, c) async => c == null
          ? pageOf([rec(0), rec(1)], next: 'cur2')
          : pageOf([rec(1), rec(2)]);
      await pumpApp(tester);
      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('audio_library_more')),
        200,
        scrollable: find.descendant(
          of: find.byKey(const ValueKey('audio_library_list')),
          matching: find.byType(Scrollable),
        ),
      );
      await tester.tap(find.byKey(const ValueKey('audio_library_more')));
      await tester.pumpAndSettle();
      expect(repo.calls.last.cursor, 'cur2');
      expect(find.text('Música 2'), findsOneWidget);
      expect(find.text('Música 1'), findsOneWidget);
      expect(find.byKey(const ValueKey('audio_library_more')), findsNothing);
    });

    testWidgets('a late page after a ministry switch is dropped and the new one loads',
        (tester) async {
      final late = Completer<MinistryAudioPage>();
      var first = true;
      repo.onList = (m, q, c) {
        if (first) {
          first = false;
          return late.future; // ministry A's slow answer
        }
        return Future.value(pageOf([rec(7, title: 'Do B')]));
      };
      await tester.runAsync(() async {});
      tester.view.physicalSize = const Size(400, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      container = ProviderContainer(overrides: overrides());
      addTearDown(container.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: testRouter()),
      ));
      await tester.pump();
      expect(find.byKey(const ValueKey('audio_library_loading')), findsOneWidget);

      unawaited(container
          .read(ministryContextNotifierProvider.notifier)
          .selectMinistry(ministryB));
      await tester.pumpAndSettle();
      late.complete(pageOf([rec(9, title: 'Do A')]));
      await tester.pumpAndSettle();
      expect(find.text('Do A 9'), findsNothing);
      expect(find.text('Do B 7'), findsOneWidget);
      expect(find.text('Ministério: Ministério B'), findsOneWidget);
      expect(repo.calls.last.ministry, 'min_2');
    });
  });

  // --------------------------------------------------------------- mixer

  group('mixer', () {
    testWidgets('opens from the library, prepares and shows six channels in order',
        (tester) async {
      await openMixer(tester);
      expect(find.byKey(const ValueKey('mixer_title')), findsOneWidget);
      expect(find.text('Música 0'), findsWidgets);
      expect(ps().phase, MinistryAudioPlaybackPhase.ready);
      final order = [
        for (final s in ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'])
          tester.getTopLeft(find.byKey(ValueKey('channel_$s'))).dy,
      ];
      expect([...order]..sort(), order, reason: 'top-to-bottom order');
      for (final label in ['Voz', 'Bateria', 'Baixo', 'Guitarra', 'Piano', 'Outros']) {
        expect(find.text(label), findsOneWidget);
      }
      expect(find.byKey(const ValueKey('mixer_play')), findsOneWidget);
    });

    testWidgets('shows indeterminate preparation (no invented percentage) until READY',
        (tester) async {
      port.prepareGate = Completer<void>();
      await pumpApp(tester);
      await tester.tap(find.byKey(ValueKey('audio_recording_${idN(0)}')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('mixer_preparing')), findsOneWidget);
      expect(find.byKey(const ValueKey('mixer_play')), findsNothing);
      expect(find.textContaining('%'), findsNothing);
      for (var i = 0; i < 400 && !port.calls.any((c) => c.startsWith('prepare')); i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 25)));
        await tester.pump(const Duration(milliseconds: 50));
      }
      port.prepareGate!.complete();
      await settleOpen(tester);
      expect(find.byKey(const ValueKey('mixer_play')), findsOneWidget);
    });

    testWidgets('preparation error is understandable and can be retried', (tester) async {
      repo.playbackError = AppFailure.network();
      await openMixer(tester);
      expect(find.byKey(const ValueKey('mixer_error')), findsOneWidget);
      expect(find.textContaining('Sem conexão'), findsOneWidget);
      expect(find.textContaining('Exception'), findsNothing);
      repo.playbackError = null;
      await tester.tap(find.byKey(const ValueKey('mixer_retry')));
      await settleOpen(tester, target: MinistryAudioPlaybackPhase.ready);
      expect(ps().phase, MinistryAudioPlaybackPhase.ready);
      expect(find.byKey(const ValueKey('mixer_play')), findsOneWidget);
    });

    testWidgets('gain, mute, solo and master reach the controller/port', (tester) async {
      await openMixer(tester);
      await tester.tap(find.byKey(const ValueKey('mute_drums')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey('solo_piano')));
      await tester.pumpAndSettle();
      await tester.drag(find.byKey(const ValueKey('gain_bass')), const Offset(-60, 0));
      await tester.pumpAndSettle();
      await tester.drag(find.byKey(const ValueKey('mixer_master')), const Offset(-60, 0));
      await tester.pumpAndSettle();
      expect(port.calls, contains('mute:drums:true'));
      expect(port.calls, contains('solo:piano:true'));
      expect(port.calls.where((c) => c.startsWith('gain:bass')), isNotEmpty);
      expect(port.calls.where((c) => c.startsWith('master:')), isNotEmpty);
      expect(ps().muted[1], isTrue);
      expect(ps().solo[4], isTrue);
      expect(ps().gains[2], lessThan(1));
      expect(ps().master, lessThan(1));
      // toggling off
      await tester.tap(find.byKey(const ValueKey('mute_drums')));
      await tester.pumpAndSettle();
      expect(ps().muted[1], isFalse);
    });

    testWidgets('play, pause, resume, stop and seek', (tester) async {
      await openMixer(tester);
      await tester.tap(find.byKey(const ValueKey('mixer_play')));
      await tester.pump();
      port.emit(MinistryAudioNativeState.playing, ps().sessionId!);
      await tester.pump();
      expect(find.byKey(const ValueKey('mixer_pause')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('mixer_pause')));
      await tester.pump();
      port.emit(MinistryAudioNativeState.paused, ps().sessionId!);
      await tester.pump();
      expect(find.byKey(const ValueKey('mixer_resume')), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('mixer_resume')));
      await tester.pump();
      port.emit(MinistryAudioNativeState.playing, ps().sessionId!);
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('mixer_stop')));
      await tester.pump();
      await tester.drag(find.byKey(const ValueKey('mixer_progress')), const Offset(60, 0));
      await tester.pump();
      expect(port.calls, containsAllInOrder(['play', 'pause', 'resume', 'stop']));
      expect(port.calls.any((c) => c.startsWith('seek:')), isTrue);
      // leave the screen so the poll timer is gone
      container.read(ministryAudioPlaybackControllerProvider.notifier);
    });

    testWidgets('position polling: moderate, never stacked, only while playing',
        (tester) async {
      await openMixer(tester);
      port.snapshotGate = Completer<void>();
      await tester.tap(find.byKey(const ValueKey('mixer_play')));
      await tester.pump();
      port.emit(MinistryAudioNativeState.playing, ps().sessionId!);
      await tester.pump();
      for (var i = 0; i < 6; i++) {
        await tester.pump(const Duration(milliseconds: 500));
      }
      expect(port.maxSnapshotsInFlight, 1, reason: 'no concurrent snapshots');
      expect(port.calls.where((c) => c == 'snapshot').length, 1);
      port.snapshotGate!.complete();
      port.snapshotGate = null;
      port.position = 16000;
      await tester.pump(const Duration(milliseconds: 600));
      await tester.pump(const Duration(milliseconds: 600));
      expect(ps().positionFrames, 16000);
      expect(find.text('0:02'), findsOneWidget);
      expect(find.text('0:10'), findsOneWidget);

      // paused: polling stops
      port.emit(MinistryAudioNativeState.paused, ps().sessionId!);
      await tester.pump();
      final before = port.calls.where((c) => c == 'snapshot').length;
      await tester.pump(const Duration(seconds: 2));
      expect(port.calls.where((c) => c == 'snapshot').length, before);
    });

    testWidgets('a snapshot answered after a seek never moves the position back',
        (tester) async {
      await openMixer(tester);
      await tester.tap(find.byKey(const ValueKey('mixer_play')));
      await tester.pump();
      port.emit(MinistryAudioNativeState.playing, ps().sessionId!);
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 600)); // learns the duration
      await tester.pump(const Duration(milliseconds: 10));
      expect(ps().durationFrames, 80000);
      port.snapshotGate = Completer<void>();
      port.position = 100; // old position, requested BEFORE the seek
      await tester.pump(const Duration(milliseconds: 600));
      final c = container.read(ministryAudioPlaybackControllerProvider.notifier);
      await c.seek(40000);
      port.snapshotGate!.complete();
      port.snapshotGate = null;
      await tester.pump();
      expect(ps().positionFrames, 40000);
    });

    testWidgets('leaving the screen closes the session and leaves no timers',
        (tester) async {
      final router = await pumpApp(tester, size: const Size(400, 900));
      await tester.tap(find.byKey(ValueKey('audio_recording_${idN(0)}')));
      await settleOpen(tester);
      await tester.tap(find.byKey(const ValueKey('mixer_play')));
      await tester.pump();
      port.emit(MinistryAudioNativeState.playing, ps().sessionId!);
      await tester.pump();
      router.pop();
      await tester.pumpAndSettle();
      expect(port.calls, contains('close'));
      expect(ps().phase, MinistryAudioPlaybackPhase.idle);
      expect(MinistryAudioCache.debugActiveLeases, 0);
    });

    testWidgets('leaving while native close is still pending does not crash or release early',
        (tester) async {
      final closeGate = Completer<bool>();
      final slow = _SlowClosePort(port, closeGate);
      final router = await pumpApp(tester, extra: [
        ministryAudioPlayerPortProvider.overrideWithValue(slow),
      ]);
      await tester.tap(find.byKey(ValueKey('audio_recording_${idN(0)}')));
      await settleOpen(tester);
      router.pop();
      await tester.pumpAndSettle();
      expect(MinistryAudioCache.debugActiveLeases, 1,
          reason: 'native has not confirmed the close yet');
      closeGate.complete(true);
      await tester.pumpAndSettle();
      expect(MinistryAudioCache.debugActiveLeases, 0);
    });

    testWidgets('logout during playback stops the session and shows nothing stale',
        (tester) async {
      await openMixer(tester);
      await tester.tap(find.byKey(const ValueKey('mixer_play')));
      await tester.pump();
      session = null; // logout
      auth.setUser(null);
      await tester.pumpAndSettle();
      expect(port.calls, contains('close'));
      expect(ps().phase, isNot(MinistryAudioPlaybackPhase.playing));
      expect(MinistryAudioCache.debugActiveLeases, 0);
    });

    testWidgets('ministry switch is noticed immediately (generation bump), A -> B -> A too',
        (tester) async {
      await openMixer(tester);
      final n = container.read(ministryContextNotifierProvider.notifier);
      expect(ps().phase, MinistryAudioPlaybackPhase.ready);
      // selectMinistry bumps the generation BEFORE any await completes:
      final f = n.selectMinistry(ministryB);
      expect(container.read(ministryAudioPlaybackControllerProvider).sessionId,
          isNotNull);
      await tester.pump();
      expect(port.calls, contains('close'),
          reason: 'closed on the generation bump, not after async work');
      await f;
      await tester.pumpAndSettle();
      expect(MinistryAudioCache.debugActiveLeases, 0);

      // A -> B -> A: same ministry id again, but a new epoch
      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(ValueKey('audio_recording_${idN(0)}')));
      await settleOpen(tester);
      expect(ps().phase, MinistryAudioPlaybackPhase.ready);
      port.calls.clear();
      await n.selectMinistry(ministryB);
      await n.selectMinistry(ministryA);
      await tester.pumpAndSettle();
      expect(port.calls, contains('close'));
      expect(MinistryAudioCache.debugActiveLeases, 0);
    });

    testWidgets('a context change during opening never starts playback', (tester) async {
      port.prepareGate = Completer<void>();
      await pumpApp(tester);
      await tester.tap(find.byKey(ValueKey('audio_recording_${idN(0)}')));
      await tester.pump();
      for (var i = 0; i < 400 && !port.calls.any((c) => c.startsWith('prepare')); i++) {
        await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 25)));
        await tester.pump(const Duration(milliseconds: 50));
      }
      expect(port.calls.where((c) => c.startsWith('prepare')), isNotEmpty);
      unawaited(container
          .read(ministryContextNotifierProvider.notifier)
          .selectMinistry(ministryB));
      await tester.pump();
      port.prepareGate!.complete();
      await tester.pumpAndSettle();
      expect(port.calls, contains('close'));
      expect(port.calls.where((c) => c == 'play'), isEmpty);
      expect(MinistryAudioCache.debugActiveLeases, 0);
    });
  });

  // ----------------------------------------------------------- responsive

  group('responsive layout', () {
    testWidgets('phone: single column, touch targets >= 48', (tester) async {
      await openMixer(tester, size: const Size(360, 900));
      expect(find.byKey(const ValueKey('mixer_channels_narrow')), findsOneWidget);
      expect(find.byKey(const ValueKey('mixer_channels_wide')), findsNothing);
      for (final k in ['mute_vocals', 'solo_vocals', 'mixer_play', 'mixer_stop']) {
        final s = tester.getSize(find.byKey(ValueKey(k)));
        expect(s.width, greaterThanOrEqualTo(48), reason: k);
        expect(s.height, greaterThanOrEqualTo(48), reason: k);
      }
      expect(tester.takeException(), isNull);
    });

    testWidgets('tablet: transport beside a two-column channel grid', (tester) async {
      await openMixer(tester, size: const Size(1000, 800));
      expect(find.byKey(const ValueKey('mixer_channels_wide')), findsOneWidget);
      final a = tester.getTopLeft(find.byKey(const ValueKey('channel_vocals')));
      final b = tester.getTopLeft(find.byKey(const ValueKey('channel_drums')));
      expect(b.dy, a.dy, reason: 'two channels per row');
      expect(b.dx, greaterThan(a.dx));
      expect(tester.takeException(), isNull);
    });

    testWidgets('semantic labels on every channel control', (tester) async {
      final handle = tester.ensureSemantics();
      await openMixer(tester);
      for (final label in ['Voz', 'Bateria', 'Baixo', 'Guitarra', 'Piano', 'Outros']) {
        expect(find.bySemanticsLabel(RegExp('Silenciar $label')), findsWidgets);
        expect(find.bySemanticsLabel(RegExp('Solo $label')), findsWidgets);
      }
      handle.dispose();
    });
  });

  // -------------------------------------------------------- flag / router

  group('feature flag and routing', () {
    test('production is always disabled, whatever the define says', () {
      const prod = AppEnvironment(env: AppEnv.production, apiBaseUrl: 'https://x/api/v1');
      const dev = AppEnvironment(env: AppEnv.development, apiBaseUrl: 'http://x');
      const stg = AppEnvironment(env: AppEnv.staging, apiBaseUrl: 'https://x/api/v1');
      expect(isMinistryAudioLibraryEnabled(prod, define: true), isFalse);
      expect(isMinistryAudioLibraryEnabled(dev, define: false), isFalse);
      expect(isMinistryAudioLibraryEnabled(dev, define: true), isTrue);
      expect(isMinistryAudioLibraryEnabled(stg, define: true), isTrue);
      // default build (no --dart-define): off
      expect(isMinistryAudioLibraryEnabled(dev), isFalse);
    });

    Future<String> navigate(
      WidgetTester tester,
      String path, {
      bool enabled = true,
      AppEnv env = AppEnv.development,
      bool ministryReady = true,
      bool authenticated = true,
    }) async {
      auth = _Auth()..setUser(authenticated ? 'user_1' : null);
      final c = ProviderContainer(overrides: [
        ...overrides(enabled: enabled, env: env, ministryReady: ministryReady),
      ]);
      final router = c.read(routerProvider);
      late BuildContext ctx;
      await tester.pumpWidget(MaterialApp(
        home: Builder(builder: (context) {
          ctx = context;
          return const SizedBox();
        }),
      ));
      // Applies the real redirect chain without rendering the target screen.
      final matches = await router.routeInformationParser
          .parseRouteInformationWithDependencies(
        RouteInformation(
          uri: Uri.parse(path),
          state: RouteInformationState<void>(type: NavigatingType.go),
        ),
        ctx,
      );
      final result = matches.uri.path;
      c.dispose();
      await tester.pump(const Duration(milliseconds: 10));
      return result;
    }

    testWidgets('flag disabled: direct navigation to the library and mixer is blocked',
        (tester) async {
      expect(await navigate(tester, '/ministry-audio', enabled: false), '/');
      expect(
          await navigate(tester, '/ministry-audio/mixer/${idN(0)}', enabled: false),
          '/');
    });

    testWidgets('production environment blocks even if the flag provider says true',
        (tester) async {
      expect(
        await navigate(tester, '/ministry-audio', enabled: true, env: AppEnv.production),
        '/',
      );
    });

    testWidgets('requires authentication and a ready ministry', (tester) async {
      expect(await navigate(tester, '/ministry-audio', authenticated: false), '/login');
      expect(await navigate(tester, '/ministry-audio', ministryReady: false), '/');
    });

    testWidgets('enabled + authenticated + ministry: allowed; invalid recording id is rejected',
        (tester) async {
      expect(await navigate(tester, '/ministry-audio'), '/ministry-audio');
      expect(await navigate(tester, '/ministry-audio/mixer/${idN(0)}'),
          '/ministry-audio/mixer/${idN(0)}');
      expect(await navigate(tester, '/ministry-audio/mixer/not-an-id'), '/ministry-audio');
    });
  });
}
/// Port whose close() waits on a gate (native close still running).
class _SlowClosePort implements MinistryAudioPlayerPort {
  _SlowClosePort(this._inner, this._gate);

  final _Port _inner;
  final Completer<bool> _gate;

  @override
  Stream<MinistryAudioNativeEvent> get events => _inner.events;
  @override
  Future<bool> close(String sessionId) async {
    _inner.calls.add('close');
    return _gate.future;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      Function.apply(
        (_inner as dynamic).noSuchMethod,
        [invocation],
      );

  @override
  Future<({int sampleRate, int frames})> prepare({
    required String sessionId,
    required String userId,
    required String ministryId,
    required String recordingId,
    required int sampleRate,
    required int frames,
  }) =>
      _inner.prepare(
        sessionId: sessionId,
        userId: userId,
        ministryId: ministryId,
        recordingId: recordingId,
        sampleRate: sampleRate,
        frames: frames,
      );
  @override
  Future<void> play(String s) => _inner.play(s);
  @override
  Future<void> pause(String s) => _inner.pause(s);
  @override
  Future<void> resume(String s) => _inner.resume(s);
  @override
  Future<void> stop(String s) => _inner.stop(s);
  @override
  Future<void> seek(String s, int f) => _inner.seek(s, f);
  @override
  Future<void> setTrackGain(String s, MinistryStemId st, double v) =>
      _inner.setTrackGain(s, st, v);
  @override
  Future<void> setTrackMuted(String s, MinistryStemId st, bool v) =>
      _inner.setTrackMuted(s, st, v);
  @override
  Future<void> setTrackSolo(String s, MinistryStemId st, bool v) =>
      _inner.setTrackSolo(s, st, v);
  @override
  Future<void> setMasterVolume(String s, double v) => _inner.setMasterVolume(s, v);
  @override
  Future<MinistryAudioNativeSnapshot> snapshot(String s) => _inner.snapshot(s);
}
