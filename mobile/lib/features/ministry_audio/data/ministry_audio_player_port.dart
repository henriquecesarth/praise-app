import 'dart:async';

import 'package:flutter/services.dart';

import '../../../core/errors/app_failure.dart';
import '../domain/ministry_audio_models.dart';

/// State of the native engine as reported by an event or a snapshot.
enum MinistryAudioNativeState {
  idle,
  loading,
  ready,
  playing,
  paused,
  completed,
  error,
  disposed,
}

/// Native state notification, always tagged with the session it belongs to.
final class MinistryAudioNativeEvent {
  const MinistryAudioNativeEvent({
    required this.sessionId,
    required this.state,
    this.errorCode,
  });

  final String sessionId;
  final MinistryAudioNativeState state;
  final String? errorCode;
}

final class MinistryAudioNativeSnapshot {
  const MinistryAudioNativeSnapshot({
    required this.sessionId,
    required this.state,
    required this.positionFrames,
    required this.durationFrames,
    required this.sampleRate,
    required this.gains,
    required this.muted,
    required this.solo,
    required this.master,
    this.errorCode,
  });

  final String sessionId;
  final MinistryAudioNativeState state;
  final int positionFrames;
  final int durationFrames;
  final int sampleRate;
  final List<double> gains;
  final List<bool> muted;
  final List<bool> solo;
  final double master;
  final String? errorCode;
}

/// Typed access to the native ministry audio engine.
///
/// The port never takes a file path or a URL: the native side rebuilds the
/// private directory from opaque identifiers, and only for audio that the
/// cache already verified. Every call carries the session id.
abstract interface class MinistryAudioPlayerPort {
  Stream<MinistryAudioNativeEvent> get events;

  /// Opens the six verified stems of [recordingId] (replacing any previous
  /// session, which native closes first). Returns the validated format.
  Future<({int sampleRate, int frames})> prepare({
    required String sessionId,
    required String userId,
    required String ministryId,
    required String recordingId,
    required int sampleRate,
    required int frames,
    MinistryAudioMp3Alignment? mp3Alignment,
  });

  Future<void> play(String sessionId);
  Future<void> pause(String sessionId);
  Future<void> resume(String sessionId);
  Future<void> stop(String sessionId);
  Future<void> seek(String sessionId, int frame);
  Future<void> setTrackGain(String sessionId, MinistryStemId stem, double value);
  Future<void> setTrackMuted(String sessionId, MinistryStemId stem, bool value);
  Future<void> setTrackSolo(String sessionId, MinistryStemId stem, bool value);
  Future<void> setMasterVolume(String sessionId, double value);
  Future<MinistryAudioNativeSnapshot> snapshot(String sessionId);

  /// Closes the session. Returns true ONLY when native confirmed that the
  /// render worker is gone and every file is closed; false (or a throw) means
  /// the files may still be in use and the lease must be kept.
  Future<bool> close(String sessionId);
}

abstract final class MinistryAudioPlayerCodes {
  static const String unavailable = 'AUDIO_NATIVE_UNAVAILABLE';
  static const String internal = 'AUDIO_NATIVE_INTERNAL';
  static const String staleSession = 'AUDIO_NATIVE_STALE_SESSION';
  static const String shutdownPending = 'AUDIO_NATIVE_SHUTDOWN_PENDING';
  static const String contextChanged = 'AUDIO_PLAYER_CONTEXT_CHANGED';
  static const String closeFailed = 'AUDIO_PLAYER_CLOSE_FAILED';
}

/// Android implementation over the dedicated MethodChannel.
final class MethodChannelMinistryAudioPlayerPort
    implements MinistryAudioPlayerPort {
  MethodChannelMinistryAudioPlayerPort({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel(channelName) {
    _channel.setMethodCallHandler(_onCall);
  }

  static const String channelName = 'com.louvaio.mobile/ministry_audio_player';

  final MethodChannel _channel;
  final StreamController<MinistryAudioNativeEvent> _events =
      StreamController<MinistryAudioNativeEvent>.broadcast();

  @override
  Stream<MinistryAudioNativeEvent> get events => _events.stream;

  void dispose() {
    _channel.setMethodCallHandler(null);
    _events.close();
  }

  Future<dynamic> _onCall(MethodCall call) async {
    if (call.method != 'onEvent' || _events.isClosed) return null;
    final args = call.arguments;
    if (args is! Map) return null;
    final id = args['sessionId'];
    final state = _parseState(args['state']);
    if (id is! String || state == null) return null;
    final code = args['errorCode'];
    _events.add(MinistryAudioNativeEvent(
      sessionId: id,
      state: state,
      errorCode: code is String ? code : null,
    ));
    return null;
  }

  static MinistryAudioNativeState? _parseState(Object? raw) {
    if (raw is! String) return null;
    for (final s in MinistryAudioNativeState.values) {
      if (s.name == raw) return s;
    }
    return null;
  }

  Future<Map<Object?, Object?>> _call(
    String method, [
    Map<String, Object?>? args,
  ]) async {
    try {
      final r = await _channel.invokeMethod<Object?>(method, args);
      return r is Map ? Map<Object?, Object?>.from(r) : const {};
    } on PlatformException catch (e) {
      // Only the stable code crosses; the native message is path-free but the
      // UI text is ours anyway.
      throw AppFailure(
        message: 'Falha no player de áudio.',
        code: e.code.startsWith('AUDIO_') ? e.code : MinistryAudioPlayerCodes.internal,
      );
    } on MissingPluginException {
      throw const AppFailure(
        message: 'Player de áudio indisponível neste aparelho.',
        code: MinistryAudioPlayerCodes.unavailable,
      );
    }
  }

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
    final r = await _call('prepare', {
      'sessionId': sessionId,
      'userId': userId,
      'ministryId': ministryId,
      'recordingId': recordingId,
      'sampleRate': sampleRate,
      'frames': frames,
      if (mp3Alignment != null) ...{
        'codec': MinistryAudioCodec.mp3.wireName,
        'encoderDelayFrames': mp3Alignment.encoderDelayFrames,
        'paddingFrames': mp3Alignment.paddingFrames,
        'mpegAudioFrames': mp3Alignment.mpegAudioFrames,
      },
    });
    final rate = r['sampleRate'];
    final f = r['frames'];
    if (rate is! int || f is! int) {
      throw const AppFailure(
        message: 'Resposta inválida do player de áudio.',
        code: MinistryAudioPlayerCodes.internal,
      );
    }
    return (sampleRate: rate, frames: f);
  }

  Map<String, Object?> _s(String id) => {'sessionId': id};

  @override
  Future<void> play(String sessionId) => _call('play', _s(sessionId));
  @override
  Future<void> pause(String sessionId) => _call('pause', _s(sessionId));
  @override
  Future<void> resume(String sessionId) => _call('resume', _s(sessionId));
  @override
  Future<void> stop(String sessionId) => _call('stop', _s(sessionId));
  @override
  Future<void> seek(String sessionId, int frame) =>
      _call('seek', {..._s(sessionId), 'frame': frame});
  @override
  Future<void> setTrackGain(String sessionId, MinistryStemId stem, double value) =>
      _call('setTrackGain', {..._s(sessionId), 'stem': stem.name, 'value': value});
  @override
  Future<void> setTrackMuted(String sessionId, MinistryStemId stem, bool value) =>
      _call('setTrackMuted', {..._s(sessionId), 'stem': stem.name, 'enabled': value});
  @override
  Future<void> setTrackSolo(String sessionId, MinistryStemId stem, bool value) =>
      _call('setTrackSolo', {..._s(sessionId), 'stem': stem.name, 'enabled': value});
  @override
  Future<void> setMasterVolume(String sessionId, double value) =>
      _call('setMasterVolume', {..._s(sessionId), 'value': value});

  @override
  Future<MinistryAudioNativeSnapshot> snapshot(String sessionId) async {
    final r = await _call('snapshot', _s(sessionId));
    final state = _parseState(r['state']);
    final pos = r['positionFrames'];
    final dur = r['durationFrames'];
    final rate = r['sampleRate'];
    final gains = r['gains'];
    final muted = r['muted'];
    final solo = r['solo'];
    final master = r['master'];
    if (state == null ||
        pos is! int ||
        dur is! int ||
        rate is! int ||
        gains is! List ||
        muted is! List ||
        solo is! List ||
        master is! num) {
      throw const AppFailure(
        message: 'Resposta inválida do player de áudio.',
        code: MinistryAudioPlayerCodes.internal,
      );
    }
    return MinistryAudioNativeSnapshot(
      sessionId: sessionId,
      state: state,
      positionFrames: pos,
      durationFrames: dur,
      sampleRate: rate,
      gains: [for (final g in gains) (g as num).toDouble()],
      muted: [for (final m in muted) m == true],
      solo: [for (final s in solo) s == true],
      master: master.toDouble(),
      errorCode: r['errorCode'] is String ? r['errorCode'] as String : null,
    );
  }

  @override
  Future<bool> close(String sessionId) async {
    final r = await _call('close', _s(sessionId));
    return r['closed'] == true;
  }
}
