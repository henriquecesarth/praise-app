import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/widgets.dart' show AppLifecycleState;
import 'package:flutter_test/flutter_test.dart';
import 'package:louvaio_mobile/core/errors/app_failure.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_download_manager.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_player_port.dart';
import 'package:louvaio_mobile/features/ministry_audio/data/ministry_audio_repository.dart';
import 'package:louvaio_mobile/features/ministry_audio/domain/ministry_audio_models.dart';
import 'package:louvaio_mobile/features/ministry_audio/presentation/controllers/ministry_audio_playback_controller.dart';

import '../data/ministry_audio_cache_test.dart' show idN, mk, playbackFor;
import '../data/ministry_audio_mp3_cache_test.dart' show idA, mp3Payload, mp3Playback;
import '../data/ministry_audio_download_manager_test.dart'
    show FakeStorage, FakeTransport, payloadOf;

class _Repo implements MinistryAudioRepository {
  final Map<String, MinistryAudioPlayback> byId = {};
  Object? error;
  Completer<void>? gate;

  @override
  Future<MinistryAudioPlayback> getPlayback({
    required String ministryId,
    required String recordingId,
    CancelToken? cancelToken,
  }) async {
    if (gate != null) await gate!.future;
    if (error != null) throw error!;
    final p = byId[recordingId];
    if (p == null) {
      throw const AppFailure(message: 'Gravação não encontrada.', statusCode: 404);
    }
    return p;
  }

  @override
  Future<MinistryAudioPage> listRecordings({
    required String ministryId,
    String query = '',
    int? limit,
    String? cursor,
    CancelToken? cancelToken,
  }) =>
      throw UnimplementedError();
}

class _Port implements MinistryAudioPlayerPort {
  final StreamController<MinistryAudioNativeEvent> bus =
      StreamController<MinistryAudioNativeEvent>.broadcast();
  final List<String> calls = [];
  final List<Map<String, Object?>> prepareArgs = [];
  Completer<void>? prepareGate;
  Completer<void>? playGate;
  Completer<bool>? closeGate;
  Object? prepareError;
  final List<bool> closeResults = []; // consumed first; default true
  int closeCalls = 0;

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
    MinistryAudioMp3Alignment? mp3Alignment,
  }) async {
    calls.add('prepare:$sessionId');
    prepareArgs.add({
      'sessionId': sessionId,
      'userId': userId,
      'ministryId': ministryId,
      'recordingId': recordingId,
      'sampleRate': sampleRate,
      'frames': frames,
      if (mp3Alignment != null) 'mp3Alignment': mp3Alignment,
    });
    if (prepareGate != null) await prepareGate!.future;
    if (prepareError != null) throw prepareError!;
    return (sampleRate: sampleRate, frames: frames);
  }

  @override
  Future<void> play(String s) async {
    calls.add('play:$s');
    if (playGate != null) await playGate!.future;
  }

  @override
  Future<void> pause(String s) async => calls.add('pause:$s');
  @override
  Future<void> resume(String s) async => calls.add('resume:$s');
  @override
  Future<void> stop(String s) async => calls.add('stop:$s');
  @override
  Future<void> seek(String s, int frame) async => calls.add('seek:$s:$frame');
  @override
  Future<void> setTrackGain(String s, MinistryStemId stem, double v) async =>
      calls.add('gain:$s:${stem.name}:$v');
  @override
  Future<void> setTrackMuted(String s, MinistryStemId stem, bool v) async =>
      calls.add('mute:$s:${stem.name}:$v');
  @override
  Future<void> setTrackSolo(String s, MinistryStemId stem, bool v) async =>
      calls.add('solo:$s:${stem.name}:$v');
  @override
  Future<void> setMasterVolume(String s, double v) async =>
      calls.add('master:$s:$v');

  @override
  Future<MinistryAudioNativeSnapshot> snapshot(String s) async {
    calls.add('snapshot:$s');
    return MinistryAudioNativeSnapshot(
      sessionId: s,
      state: MinistryAudioNativeState.playing,
      positionFrames: 5,
      durationFrames: 10,
      sampleRate: 8000,
      gains: const [1, 1, 1, 1, 1, 1],
      muted: const [false, false, false, false, false, false],
      solo: const [false, false, false, false, false, false],
      master: 1,
    );
  }

  @override
  Future<bool> close(String s) async {
    closeCalls++;
    calls.add('close:$s');
    if (closeGate != null) return closeGate!.future;
    if (closeResults.isNotEmpty) return closeResults.removeAt(0);
    return true;
  }

  void emit(String sid, MinistryAudioNativeState st, {String? code}) => bus.add(
      MinistryAudioNativeEvent(sessionId: sid, state: st, errorCode: code));
}

Future<void> _pump() => Future<void>.delayed(const Duration(milliseconds: 20));

Future<void> _until(bool Function() c) async {
  final end = DateTime.now().add(const Duration(seconds: 5));
  while (!c() && DateTime.now().isBefore(end)) {
    await Future<void>.delayed(const Duration(milliseconds: 5));
  }
}

void main() {
  late Directory temp;
  late _Repo repo;
  late _Port port;
  late FakeTransport transport;
  MinistryAudioDownloadContext? ctx;
  var seq = 0;
  final made = <MinistryAudioCache>[];
  final controllers = <MinistryAudioPlaybackController>[];

  setUp(() {
    temp = Directory.systemTemp.createTempSync('louvaio_audio_player_');
    ctx = mk('user_1', 'min_1', 'e1');
    repo = _Repo();
    for (var i = 0; i < 4; i++) {
      repo.byId[idN(i)] = playbackFor(idN(i));
    }
    port = _Port();
    seq = 0;
    transport = FakeTransport(
      behavior: (s, a, t) => Stream.value(payloadOf(s.name,
          salt: int.parse(Uri.parse(t.url).pathSegments[1]))),
    );
  });

  tearDown(() async {
    for (final c in controllers) {
      c.dispose();
    }
    for (final c in made) {
      c.dispose();
    }
    controllers.clear();
    made.clear();
    await _pump();
    try {
      temp.deleteSync(recursive: true);
    } catch (_) {}
  });

  MinistryAudioPlaybackController build({int closeAttempts = 2}) {
    final storage = FakeStorage(temp.path.replaceAll('\\', '/'));
    final manager = MinistryAudioDownloadManager(
      repository: repo,
      transport: transport,
      storage: storage,
      context: () => ctx,
    );
    final cache = MinistryAudioCache(manager: manager);
    made.add(cache);
    final c = MinistryAudioPlaybackController(
      cache: cache,
      port: port,
      context: () => ctx,
      newSessionId: () => 'session-${++seq}',
      closeAttempts: closeAttempts,
      closeRetryDelay: const Duration(milliseconds: 1),
    );
    controllers.add(c);
    return c;
  }

  int leases() => MinistryAudioCache.debugActiveLeases;

  Matcher code(String c) => isA<AppFailure>().having((f) => f.code, 'code', c);

  test('full flow: ensureCached -> prepare -> controls -> close releases the lease',
      () async {
    final c = build();
    await c.open(idN(0));
    expect(c.state.phase, MinistryAudioPlaybackPhase.ready);
    expect(c.state.durationFrames, 10);
    expect(c.state.sampleRate, 8000);
    expect(leases(), 1, reason: 'lease held while the player owns the files');

    await c.play();
    port.emit('session-1', MinistryAudioNativeState.playing);
    await _pump();
    expect(c.state.phase, MinistryAudioPlaybackPhase.playing);
    await c.setTrackGain(MinistryStemId.drums, 0.5);
    await c.setTrackMuted(MinistryStemId.bass, true);
    await c.setTrackSolo(MinistryStemId.piano, true);
    await c.setMasterVolume(0.7);
    await c.seek(4);
    expect(c.state.gains[1], 0.5);
    expect(c.state.muted[2], true);
    expect(c.state.solo[4], true);
    expect(c.state.master, 0.7);
    expect(c.state.positionFrames, 4);
    await c.refresh();
    expect(c.state.positionFrames, 5);
    await c.pause();
    await c.resume();
    await c.stop();
    expect(leases(), 1);

    expect(await c.close(), isTrue);
    expect(leases(), 0);
    expect(c.state.phase, MinistryAudioPlaybackPhase.idle);
    expect(port.calls.last, 'close:session-1');
    await expectLater(c.play(), throwsA(isA<AppFailure>()));
  });

  test('an MP3 set is prepared with its manifest alignment and nothing else new crosses the channel', () async {
    repo.byId[idA] = mp3Playback(id: idA);
    transport = FakeTransport(behavior: (s, a, t) => Stream.value(mp3Payload(s.name)));
    final c = build();
    await c.open(idA);
    expect(c.state.phase, MinistryAudioPlaybackPhase.ready);
    expect(c.state.sampleRate, 44100);
    expect(c.state.durationFrames, 3000);
    final args = port.prepareArgs.single;
    expect(args.keys.toSet(), {'sessionId', 'userId', 'ministryId', 'recordingId', 'sampleRate', 'frames', 'mp3Alignment'});
    final al = args['mp3Alignment']! as MinistryAudioMp3Alignment;
    expect(al.encoderDelayFrames, 1105);
    expect('${port.prepareArgs} ${port.calls}'.contains(temp.path), isFalse);
    expect(leases(), 1);
    expect(await c.close(), isTrue);
    expect(leases(), 0);
  });

  for (final status in [401, 403, 404]) {
    test('access lost ($status) while an MP3 set was being decoded: never ready, closed, lease released', () async {
      repo.byId[idA] = mp3Playback(id: idA);
      transport = FakeTransport(behavior: (s, a, t) => Stream.value(mp3Payload(s.name)));
      final c = build();
      port.prepareGate = Completer<void>();
      final opening = c.open(idA);
      opening.ignore();
      await _until(() => port.calls.contains('prepare:session-1'));
      repo.error = AppFailure(message: 'Acesso negado.', statusCode: status);
      port.prepareGate!.complete();
      await expectLater(opening, throwsA(isA<AppFailure>().having((f) => f.statusCode, 'statusCode', status)));
      expect(c.state.phase, MinistryAudioPlaybackPhase.error);
      expect(port.calls, contains('close:session-1'));
      expect(leases(), 0);
      await expectLater(c.play(), throwsA(isA<AppFailure>()));
      expect(port.calls.where((x) => x.startsWith('play')), isEmpty);
    });
  }

  test('a manifest republished while an MP3 set was being decoded is refused', () async {
    repo.byId[idA] = mp3Playback(id: idA);
    transport = FakeTransport(behavior: (s, a, t) => Stream.value(mp3Payload(s.name)));
    final c = build();
    port.prepareGate = Completer<void>();
    final opening = c.open(idA);
    opening.ignore();
    await _until(() => port.calls.contains('prepare:session-1'));
    repo.byId[idA] = playbackFor(idN(1));
    port.prepareGate!.complete();
    await expectLater(opening, throwsA(code(MinistryAudioDownloadCodes.manifestChanged)));
    expect(leases(), 0);
  });

  test('a WAV set never sends an alignment', () async {
    final c = build();
    await c.open(idN(0));
    expect(port.prepareArgs.single.containsKey('mp3Alignment'), isFalse);
    await c.close();
  });

  test('native messages carry identifiers only: no path, no URL, no secret',
      () async {
    final c = build();
    await c.open(idN(0));
    await c.play();
    await c.seek(1);
    await c.close();
    expect(port.prepareArgs.single.keys.toSet(), {
      'sessionId',
      'userId',
      'ministryId',
      'recordingId',
      'sampleRate',
      'frames',
    });
    final text = '${port.prepareArgs} ${port.calls}';
    for (final bad in ['http', 'SECRET', 'X=', temp.path, 'r2.cloudflarestorage', r'\']) {
      expect(text.contains(bad), isFalse, reason: bad);
    }
  });

  test('a logout/ministry reset (cache.dispose) does NOT release a lease the player owns',
      () async {
    final c = build();
    await c.open(idN(0));
    made.single.dispose(); // what resetAuthenticatedFeatures does
    expect(leases(), 1, reason: 'files are still open natively');
    c.dispose(); // the controller is torn down too
    await _until(() => leases() == 0);
    expect(port.closeCalls, 1);
    expect(leases(), 0, reason: 'released after confirmed native close');
  });

  test('lease is released only AFTER native confirms the close', () async {
    final c = build();
    await c.open(idN(0));
    port.closeGate = Completer<bool>();
    final closing = c.close();
    await _pump();
    expect(port.closeCalls, 1);
    expect(leases(), 1, reason: 'close not confirmed yet');
    port.closeGate!.complete(true);
    expect(await closing, isTrue);
    expect(leases(), 0);
  });

  test('a failed close is never treated as closed: the lease is kept and retried',
      () async {
    final c = build(closeAttempts: 2);
    await c.open(idN(0));
    port.closeResults.addAll([false, false]);
    expect(await c.close(), isFalse);
    expect(port.closeCalls, 2);
    expect(leases(), 1);
    expect(c.state.phase, MinistryAudioPlaybackPhase.error);
    expect(c.state.errorCode, MinistryAudioPlayerCodes.closeFailed);

    port.closeResults.add(true); // native finally confirms
    expect(await c.close(), isTrue);
    expect(leases(), 0);

    // an exception while closing is a failure too
    final c2 = build(closeAttempts: 1);
    await c2.open(idN(1));
    port.closeResults.clear();
    port.closeGate = Completer<bool>()..completeError(StateError('boom'));
    expect(await c2.close(), isFalse);
    expect(leases(), 1);
    port.closeGate = null;
    expect(await c2.close(), isTrue);
    expect(leases(), 0);
  });

  test('logout during download: nothing reaches native and no lease remains',
      () async {
    final c = build();
    repo.gate = Completer<void>();
    final opening = c.open(idN(0));
    opening.ignore();
    await _pump();
    ctx = null; // logout
    c.checkContext();
    repo.gate!.complete();
    await expectLater(opening, throwsA(isA<AppFailure>()));
    expect(port.calls.where((x) => x.startsWith('prepare')), isEmpty);
    expect(leases(), 0);
  });

  test('logout during native load: the session is closed, lease released after confirmation',
      () async {
    final c = build();
    port.prepareGate = Completer<void>();
    final opening = c.open(idN(0));
    opening.ignore();
    await _until(() => port.calls.contains('prepare:session-1'));
    expect(port.calls, contains('prepare:session-1'));
    ctx = null; // logout while native is loading
    c.checkContext();
    port.prepareGate!.complete();
    await expectLater(opening, throwsA(code(MinistryAudioPlayerCodes.contextChanged)));
    await _pump();
    expect(port.calls, contains('close:session-1'));
    expect(leases(), 0);
    expect(c.state.phase, isNot(MinistryAudioPlaybackPhase.playing));
  });

  test('logout during playback closes native before releasing the lease', () async {
    final c = build();
    await c.open(idN(0));
    await c.play();
    port.closeGate = Completer<bool>();
    ctx = null;
    c.checkContext();
    await _pump();
    expect(leases(), 1, reason: 'native has not confirmed yet');
    await expectLater(c.pause(), throwsA(isA<AppFailure>()),
        reason: 'new commands are refused immediately');
    port.closeGate!.complete(true);
    await _until(() => leases() == 0);
    expect(leases(), 0);
    await _until(() => c.state.phase == MinistryAudioPlaybackPhase.idle);
    expect(c.state.phase, MinistryAudioPlaybackPhase.idle);
  });

  test('ministry switch A -> B -> A is detected through the epoch stamp', () async {
    final c = build();
    await c.open(idN(0));
    ctx = mk('user_1', 'min_2', 'e2');
    ctx = mk('user_1', 'min_1', 'e3'); // back to A, but a new context epoch
    await expectLater(c.play(), throwsA(code(MinistryAudioPlayerCodes.contextChanged)));
    await _until(() => leases() == 0);
    expect(port.calls.where((x) => x.startsWith('play')), isEmpty);
    expect(port.calls, contains('close:session-1'));
    expect(leases(), 0);
  });

  test('dispose with a command pending still closes natively and releases the lease',
      () async {
    final c = build();
    await c.open(idN(0));
    port.playGate = Completer<void>();
    final playing = c.play();
    playing.ignore();
    await _pump();
    c.dispose();
    c.dispose(); // repeated dispose is safe
    port.playGate!.complete();
    await _until(() => leases() == 0);
    expect(port.closeCalls, 1);
    expect(leases(), 0);
  });

  test('native error event ends the session and releases the lease', () async {
    final c = build();
    await c.open(idN(0));
    await c.play();
    port.emit('session-1', MinistryAudioNativeState.error,
        code: 'AUDIO_NATIVE_READ_FAILED');
    await _until(() => leases() == 0);
    expect(c.state.phase, MinistryAudioPlaybackPhase.error);
    expect(c.state.errorCode, 'AUDIO_NATIVE_READ_FAILED');
    expect(port.calls, contains('close:session-1'));
    expect(leases(), 0);
  });

  test('native prepare failure surfaces a typed error and leaks nothing', () async {
    final c = build();
    port.prepareError = const AppFailure(
        message: 'x', code: 'AUDIO_NATIVE_WAV_TRUNCATED');
    await expectLater(c.open(idN(0)), throwsA(code('AUDIO_NATIVE_WAV_TRUNCATED')));
    expect(c.state.phase, MinistryAudioPlaybackPhase.error);
    expect(c.state.errorCode, 'AUDIO_NATIVE_WAV_TRUNCATED');
    expect(port.calls, contains('close:session-1'));
    expect(leases(), 0);
  });

  test('network/revalidation failure: no offline playback, native never opened',
      () async {
    final c = build();
    await c.open(idN(0));
    await c.close();
    repo.error = const AppFailure(message: 'Sem rede.', code: 'NETWORK_ERROR');
    port.calls.clear();
    await expectLater(c.open(idN(0)), throwsA(code('NETWORK_ERROR')),
        reason: 'the cached copy is NOT played without online revalidation');
    expect(port.calls.where((x) => x.startsWith('prepare')), isEmpty);
    expect(leases(), 0);
    expect(c.state.phase, MinistryAudioPlaybackPhase.error);
  });

  test('late events from a previous session never change the current state', () async {
    final c = build();
    await c.open(idN(0));
    await c.close();
    await c.open(idN(1));
    expect(c.state.sessionId, 'session-2');
    port.emit('session-1', MinistryAudioNativeState.error, code: 'OLD');
    port.emit('session-1', MinistryAudioNativeState.playing);
    await _pump();
    expect(c.state.phase, MinistryAudioPlaybackPhase.ready);
    expect(c.state.errorCode, isNull);
    expect(leases(), 1);
    port.emit('session-2', MinistryAudioNativeState.playing);
    await _pump();
    expect(c.state.phase, MinistryAudioPlaybackPhase.playing);
  });

  test('opening another recording closes the previous session first', () async {
    final c = build();
    await c.open(idN(0));
    await c.open(idN(1));
    final i = port.calls.indexOf('close:session-1');
    expect(i, greaterThanOrEqualTo(0));
    expect(i, lessThan(port.calls.indexOf('prepare:session-2')));
    expect(leases(), 1);
    await c.close();
    expect(leases(), 0);
  });

  test('natural completion stops and closes the engine, then releases the lease',
      () async {
    final c = build();
    await c.open(idN(0));
    await c.play();
    port.emit('session-1', MinistryAudioNativeState.completed);
    await _until(() => leases() == 0);
    expect(c.state.phase, MinistryAudioPlaybackPhase.completed);
    expect(c.state.positionFrames, c.state.durationFrames);
    expect(port.calls, contains('close:session-1'));
    expect(leases(), 0);
  });

  test('going to the background ends playback (no background playback)', () async {
    final c = build();
    await c.open(idN(0));
    await c.play();
    c.handleAppLifecycle(AppLifecycleState.inactive);
    await _pump();
    expect(port.closeCalls, 0);
    c.handleAppLifecycle(AppLifecycleState.paused);
    await _until(() => leases() == 0);
    expect(port.closeCalls, 1);
    expect(leases(), 0);
  });

  test('commands without an open session are refused', () async {
    final c = build();
    await expectLater(c.play(), throwsA(isA<AppFailure>()));
    await expectLater(c.seek(1), throwsA(isA<AppFailure>()));
    expect(port.calls, isEmpty);
  });

  test('a missing context (not signed in / no ministry) never opens anything',
      () async {
    final c = build();
    ctx = null;
    await expectLater(c.open(idN(0)), throwsA(code(MinistryAudioPlayerCodes.contextChanged)));
    expect(port.calls, isEmpty);
    expect(leases(), 0);
  });

  test('cache.dispose still releases leases nobody took over', () async {
    final storage = FakeStorage(temp.path.replaceAll('\\', '/'));
    final manager = MinistryAudioDownloadManager(
        repository: repo, transport: transport, storage: storage, context: () => ctx);
    final cache = MinistryAudioCache(manager: manager);
    final a = await cache.ensureCached(ministryId: 'min_1', recordingId: idN(0));
    final b = await cache.ensureCached(ministryId: 'min_1', recordingId: idN(1));
    b.takeOwnership();
    expect(leases(), 2);
    cache.dispose();
    expect(leases(), 1, reason: 'only the handle nobody owns is dropped');
    a.release(); // idempotent
    b.release();
    expect(leases(), 0);
  });
}
