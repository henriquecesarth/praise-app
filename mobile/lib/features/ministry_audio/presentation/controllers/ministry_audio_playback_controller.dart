import 'dart:async';
import 'dart:math';

import 'package:flutter/widgets.dart'
    show AppLifecycleState, WidgetsBinding, WidgetsBindingObserver;
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/errors/app_failure.dart';
import '../../data/ministry_audio_download_manager.dart';
import '../../data/ministry_audio_player_port.dart';
import '../../domain/ministry_audio_models.dart';

enum MinistryAudioPlaybackPhase {
  idle,
  loading,
  ready,
  playing,
  paused,
  completed,
  error,
}

/// What the (future) UI observes. Always describes the CURRENT session only.
final class MinistryAudioPlaybackState {
  const MinistryAudioPlaybackState({
    this.phase = MinistryAudioPlaybackPhase.idle,
    this.recordingId,
    this.sessionId,
    this.positionFrames = 0,
    this.durationFrames = 0,
    this.sampleRate = 0,
    this.gains = const [1, 1, 1, 1, 1, 1],
    this.muted = const [false, false, false, false, false, false],
    this.solo = const [false, false, false, false, false, false],
    this.master = 1,
    this.errorCode,
  });

  final MinistryAudioPlaybackPhase phase;
  final String? recordingId;
  final String? sessionId;
  final int positionFrames;
  final int durationFrames;
  final int sampleRate;

  /// Indexed by [MinistryStemId.index].
  final List<double> gains;
  final List<bool> muted;
  final List<bool> solo;
  final double master;
  final String? errorCode;

  MinistryAudioPlaybackState copyWith({
    MinistryAudioPlaybackPhase? phase,
    String? recordingId,
    String? sessionId,
    int? positionFrames,
    int? durationFrames,
    int? sampleRate,
    List<double>? gains,
    List<bool>? muted,
    List<bool>? solo,
    double? master,
    String? errorCode,
    bool clearError = false,
  }) =>
      MinistryAudioPlaybackState(
        phase: phase ?? this.phase,
        recordingId: recordingId ?? this.recordingId,
        sessionId: sessionId ?? this.sessionId,
        positionFrames: positionFrames ?? this.positionFrames,
        durationFrames: durationFrames ?? this.durationFrames,
        sampleRate: sampleRate ?? this.sampleRate,
        gains: gains ?? this.gains,
        muted: muted ?? this.muted,
        solo: solo ?? this.solo,
        master: master ?? this.master,
        errorCode: clearError ? null : (errorCode ?? this.errorCode),
      );
}

typedef MinistryAudioContextProvider = MinistryAudioDownloadContext? Function();

/// Forwards app lifecycle changes (no background playback policy).
final class MinistryAudioLifecycleBinding with WidgetsBindingObserver {
  MinistryAudioLifecycleBinding(this._onChange) {
    try {
      WidgetsBinding.instance.addObserver(this);
      _attached = true;
    } catch (_) {
      _attached = false; // no binding (e.g. plain unit tests)
    }
  }

  final void Function(AppLifecycleState) _onChange;
  bool _attached = false;

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) => _onChange(state);

  void dispose() {
    if (!_attached) return;
    try {
      WidgetsBinding.instance.removeObserver(this);
    } catch (_) {}
  }
}

String _randomSessionId() {
  final r = Random.secure();
  final tail = List.generate(10, (_) => r.nextInt(36).toRadixString(36)).join();
  return 's${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}$tail';
}

/// Orchestrates ensureCached -> native engine -> lease for ONE playback.
///
/// Invariants:
/// * Only audio released by [MinistryAudioCache.ensureCached] (online
///   revalidation + full SHA-256) is ever handed to native, and only by
///   identifiers: no path and no URL crosses the channel.
/// * The cache lease is taken over ([MinistryAudioCachedRecording.takeOwnership])
///   so a logout/ministry reset cannot release it behind the player's back; it
///   is released ONLY after native confirmed that the worker is gone and the
///   files are closed. A failed/unconfirmed close keeps the lease.
/// * Every await is followed by a staleness check (epoch + auth/ministry
///   context stamp); events and snapshots of any other session are dropped.
/// * No offline playback: every [open] goes through ensureCached.
class MinistryAudioPlaybackController
    extends StateNotifier<MinistryAudioPlaybackState> {
  MinistryAudioPlaybackController({
    required MinistryAudioCache cache,
    required MinistryAudioPlayerPort port,
    required MinistryAudioContextProvider context,
    String Function()? newSessionId,
    this.closeAttempts = 3,
    this.closeRetryDelay = const Duration(milliseconds: 500),
  })  : _cache = cache,
        _port = port,
        _context = context,
        _newSessionId = newSessionId ?? _randomSessionId,
        super(const MinistryAudioPlaybackState()) {
    _events = port.events.listen(_onEvent);
  }

  final MinistryAudioCache _cache;
  final MinistryAudioPlayerPort _port;
  final MinistryAudioContextProvider _context;
  final String Function() _newSessionId;
  final int closeAttempts;
  final Duration closeRetryDelay;

  late final StreamSubscription<MinistryAudioNativeEvent> _events;
  int _epoch = 0;
  bool _disposed = false;
  bool _prepared = false;
  String? _session;
  MinistryAudioCachedRecording? _lease;
  MinistryAudioDownloadContext? _captured;
  Future<bool>? _closing;

  /// Advances on every user-driven position change (seek/stop) so a snapshot
  /// requested BEFORE it can never move the position back afterwards.
  int _positionStamp = 0;

  bool get _active => _session != null;

  // ------------------------------------------------------------------ open

  /// Prepares [recordingId] for playback (downloads/revalidates as needed).
  /// Any previous playback is closed first. Throws [AppFailure] on failure
  /// (the state also becomes `error`).
  Future<void> open(String recordingId) async {
    final epoch = ++_epoch;
    if (!await _closeSession()) {
      throw _fail(MinistryAudioPlayerCodes.closeFailed,
          'O áudio anterior ainda está sendo encerrado.');
    }
    if (_stale(epoch, null)) throw _contextFailure();
    final captured = _context();
    if (captured == null) {
      throw _fail(MinistryAudioPlayerCodes.contextChanged,
          'Entre novamente e selecione um ministério.');
    }
    _captured = captured;
    _set(MinistryAudioPlaybackState(
      phase: MinistryAudioPlaybackPhase.loading,
      recordingId: recordingId,
    ));

    MinistryAudioCachedRecording? cached;
    try {
      cached = await _cache.ensureCached(
        ministryId: captured.ministryId,
        recordingId: recordingId,
      );
      if (_stale(epoch, captured)) {
        cached.release(); // never reached native: no files open
        throw _contextFailure();
      }
      cached.takeOwnership();
      _lease = cached;
      final sid = _newSessionId();
      _session = sid;
      _prepared = false;
      await _port.prepare(
        sessionId: sid,
        userId: captured.userId,
        ministryId: captured.ministryId,
        recordingId: recordingId,
        sampleRate: cached.sampleRate,
        frames: cached.frames,
        mp3Alignment: cached.recording.mp3Alignment,
      );
      if (_stale(epoch, captured)) throw _contextFailure();
      if (cached.recording.mp3Alignment != null) {
        // Decoding takes minutes: access may have been revoked meanwhile.
        await _cache.revalidate(ministryId: captured.ministryId, cached: cached);
        if (_stale(epoch, captured)) throw _contextFailure();
      }
      _prepared = true;
      _set(state.copyWith(
        phase: MinistryAudioPlaybackPhase.ready,
        sessionId: sid,
        durationFrames: cached.frames,
        sampleRate: cached.sampleRate,
        positionFrames: 0,
        clearError: true,
      ));
    } catch (e) {
      final failure = e is AppFailure ? e : _fail(MinistryAudioPlayerCodes.internal, 'Falha ao preparar o áudio.');
      if (epoch == _epoch) {
        // Not superseded: tear down our own half-open session (the lease is
        // only released once native confirms; otherwise it is kept).
        if (cached != null && _lease == null) cached.release();
        await _closeSession();
        _set(MinistryAudioPlaybackState(
          phase: MinistryAudioPlaybackPhase.error,
          recordingId: recordingId,
          errorCode: failure.code,
        ));
      }
      throw failure;
    }
  }

  // -------------------------------------------------------------- commands

  Future<void> play() => _command((s) => _port.play(s));
  Future<void> pause() => _command((s) => _port.pause(s));
  Future<void> resume() => _command((s) => _port.resume(s));

  Future<void> stop() => _command((s) async {
        _positionStamp++;
        await _port.stop(s);
        _positionStamp++;
        _setIfCurrent(s, state.copyWith(positionFrames: 0));
      });

  Future<void> seek(int frame) => _command((s) async {
        final clamped = frame.clamp(0, state.durationFrames);
        _positionStamp++;
        await _port.seek(s, clamped);
        _positionStamp++;
        _setIfCurrent(s, state.copyWith(positionFrames: clamped));
      });

  Future<void> setTrackGain(MinistryStemId stem, double value) =>
      _command((s) async {
        await _port.setTrackGain(s, stem, value);
        _setIfCurrent(s, state.copyWith(gains: _with(state.gains, stem, value)));
      });

  Future<void> setTrackMuted(MinistryStemId stem, bool value) =>
      _command((s) async {
        await _port.setTrackMuted(s, stem, value);
        _setIfCurrent(s, state.copyWith(muted: _with(state.muted, stem, value)));
      });

  Future<void> setTrackSolo(MinistryStemId stem, bool value) =>
      _command((s) async {
        await _port.setTrackSolo(s, stem, value);
        _setIfCurrent(s, state.copyWith(solo: _with(state.solo, stem, value)));
      });

  Future<void> setMasterVolume(double value) => _command((s) async {
        await _port.setMasterVolume(s, value);
        _setIfCurrent(s, state.copyWith(master: value));
      });

  /// Refreshes position/state from native (the UI polls this).
  Future<void> refresh() async {
    final sid = _session;
    if (sid == null || !_prepared || !_usable()) return;
    final stamp = _positionStamp;
    try {
      final snap = await _port.snapshot(sid);
      if (_session != sid || _disposed) return; // late answer of an old session
      // A seek/stop happened while the snapshot was in flight: it is older
      // than what the user just did and must not move the position back.
      if (stamp != _positionStamp) return;
      _setIfCurrent(
        sid,
        state.copyWith(
          phase: _phaseOf(snap.state) ?? state.phase,
          positionFrames: snap.positionFrames,
          durationFrames: snap.durationFrames,
          gains: snap.gains,
          muted: snap.muted,
          solo: snap.solo,
          master: snap.master,
        ),
      );
    } on AppFailure {
      // transient: keep the last known state
    }
  }

  /// Ends playback and releases everything (lease only after confirmation).
  Future<bool> close() async {
    _epoch++; // supersede any open() in flight
    final ok = await _closeSession();
    if (ok && mounted && state.phase != MinistryAudioPlaybackPhase.error) {
      _set(const MinistryAudioPlaybackState());
    }
    return ok;
  }

  /// Call when the auth/ministry context may have changed (logout, account
  /// switch, ministry switch, notifier rebuild).
  void checkContext() {
    if (_disposed || _session == null && _lease == null) return;
    if (_stale(_epoch, _captured)) {
      _epoch++;
      unawaited(_closeSession().then((_) {
        if (mounted) _set(const MinistryAudioPlaybackState());
      }));
    }
  }

  /// The app policy: no background playback.
  void handleAppLifecycle(AppLifecycleState lifecycle) {
    if (lifecycle == AppLifecycleState.resumed ||
        lifecycle == AppLifecycleState.inactive) {
      return;
    }
    if (_active) unawaited(close());
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _epoch++;
    // The native close is still driven to completion (and only then is the
    // lease released) even though this notifier is gone.
    unawaited(_closeSession().whenComplete(_events.cancel));
    super.dispose();
  }

  // -------------------------------------------------------------- internals

  Future<void> _command(Future<void> Function(String sid) body) async {
    final sid = _session;
    if (sid == null || !_prepared || _disposed) {
      throw _fail(MinistryAudioPlayerCodes.staleSession, 'Nenhum áudio preparado.');
    }
    if (!_usable()) {
      checkContext();
      throw _contextFailure();
    }
    try {
      await body(sid);
    } on AppFailure catch (e) {
      if (e.code == MinistryAudioPlayerCodes.staleSession) {
        unawaited(close());
      }
      rethrow;
    }
  }

  bool _usable() => !_disposed && !_stale(_epoch, _captured);

  bool _stale(int epoch, MinistryAudioDownloadContext? captured) {
    if (_disposed || epoch != _epoch) return true;
    if (captured == null) return false;
    return _context() != captured;
  }

  /// Closes native and, ONLY if confirmed, releases the lease. Single-flight.
  Future<bool> _closeSession() {
    final running = _closing;
    if (running != null) return running;
    final f = _doClose().whenComplete(() => _closing = null);
    _closing = f;
    return f;
  }

  Future<bool> _doClose() async {
    final sid = _session;
    final lease = _lease;
    _prepared = false;
    if (sid != null) {
      var confirmed = false;
      for (var i = 0; i < closeAttempts && !confirmed; i++) {
        try {
          confirmed = await _port.close(sid);
        } catch (_) {
          confirmed = false;
        }
        if (!confirmed && i + 1 < closeAttempts) {
          await Future<void>.delayed(closeRetryDelay);
        }
      }
      if (!confirmed) {
        // Files may still be open: keep the lease AND the session id so a
        // later close()/dispose retries. Never treated as closed.
        if (mounted) {
          _set(state.copyWith(
            phase: MinistryAudioPlaybackPhase.error,
            errorCode: MinistryAudioPlayerCodes.closeFailed,
          ));
        }
        return false;
      }
    }
    _session = null;
    _lease = null;
    _captured = null;
    lease?.release();
    return true;
  }

  void _onEvent(MinistryAudioNativeEvent e) {
    if (_disposed || e.sessionId != _session || !_prepared) return;
    final phase = _phaseOf(e.state);
    if (phase == null) return;
    if (e.state == MinistryAudioNativeState.error) {
      _set(state.copyWith(phase: phase, errorCode: e.errorCode));
      unawaited(_closeSession()); // native already closed its files; confirm
      return;
    }
    if (e.state == MinistryAudioNativeState.completed) {
      _set(state.copyWith(
        phase: phase,
        positionFrames: state.durationFrames,
        clearError: true,
      ));
      // Natural end: stop and close the engine BEFORE releasing the lease.
      unawaited(_closeSession());
      return;
    }
    _set(state.copyWith(phase: phase, clearError: true));
  }

  static MinistryAudioPlaybackPhase? _phaseOf(MinistryAudioNativeState s) {
    switch (s) {
      case MinistryAudioNativeState.idle:
        return MinistryAudioPlaybackPhase.idle;
      case MinistryAudioNativeState.loading:
        return MinistryAudioPlaybackPhase.loading;
      case MinistryAudioNativeState.ready:
        return MinistryAudioPlaybackPhase.ready;
      case MinistryAudioNativeState.playing:
        return MinistryAudioPlaybackPhase.playing;
      case MinistryAudioNativeState.paused:
        return MinistryAudioPlaybackPhase.paused;
      case MinistryAudioNativeState.completed:
        return MinistryAudioPlaybackPhase.completed;
      case MinistryAudioNativeState.error:
        return MinistryAudioPlaybackPhase.error;
      case MinistryAudioNativeState.disposed:
        return null;
    }
  }

  List<T> _with<T>(List<T> list, MinistryStemId stem, T value) {
    final copy = List<T>.of(list);
    copy[stem.index] = value;
    return List<T>.unmodifiable(copy);
  }

  void _setIfCurrent(String sid, MinistryAudioPlaybackState next) {
    if (_session == sid) _set(next);
  }

  void _set(MinistryAudioPlaybackState next) {
    if (mounted) state = next;
  }

  AppFailure _fail(String code, String message) =>
      AppFailure(message: message, code: code);

  AppFailure _contextFailure() => _fail(
        MinistryAudioPlayerCodes.contextChanged,
        'A sessão ou o ministério mudou. Reabra a gravação.',
      );
}
