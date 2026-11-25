import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../app/providers.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/ministry_audio_player_port.dart';
import '../../domain/ministry_audio_models.dart';
import '../controllers/ministry_audio_playback_controller.dart';

const _stemLabels = <MinistryStemId, String>{
  MinistryStemId.vocals: 'Voz',
  MinistryStemId.drums: 'Bateria',
  MinistryStemId.bass: 'Baixo',
  MinistryStemId.guitar: 'Guitarra',
  MinistryStemId.piano: 'Piano',
  MinistryStemId.other: 'Outros',
};

const _stemColors = <MinistryStemId, Color>{
  MinistryStemId.vocals: Color(0xFFD81B60),
  MinistryStemId.drums: Color(0xFFF4511E),
  MinistryStemId.bass: Color(0xFF3949AB),
  MinistryStemId.guitar: Color(0xFF00897B),
  MinistryStemId.piano: Color(0xFF8E24AA),
  MinistryStemId.other: Color(0xFF6D4C41),
};

/// User-facing text for a failure code (never raw native/exception text).
String ministryAudioErrorText(String? code) {
  switch (code) {
    case MinistryAudioPlayerCodes.contextChanged:
      return 'A sessão ou o ministério mudou. Reabra a gravação.';
    case MinistryAudioPlayerCodes.closeFailed:
    case MinistryAudioPlayerCodes.shutdownPending:
      return 'O áudio anterior ainda está sendo encerrado. Tente novamente em instantes.';
    case MinistryAudioPlayerCodes.unavailable:
      return 'O player de áudio não está disponível neste aparelho.';
    case 'NETWORK_ERROR':
      return 'Sem conexão. É preciso estar online para abrir a gravação.';
    case 'AUDIO_NATIVE_FOCUS_DENIED':
      return 'Outro app está usando o áudio. Tente novamente.';
    case 'AUDIO_NATIVE_OUTPUT_FAILED':
      return 'Não foi possível usar a saída de áudio.';
    case 'AUDIO_NATIVE_READ_FAILED':
    case 'AUDIO_NATIVE_WAV_TRUNCATED':
    case 'AUDIO_NATIVE_WAV_INVALID_HEADER':
    case 'AUDIO_NATIVE_WAV_SIZE_MISMATCH':
      return 'Os arquivos de áudio estão inválidos. Tente abrir novamente.';
    case 'AUDIO_NATIVE_INSUFFICIENT_SPACE':
      return 'Sem espaço livre suficiente para preparar esta gravação.';
    case 'AUDIO_NATIVE_MP3_ALIGNMENT_UNVERIFIED':
    case 'AUDIO_NATIVE_MP3_UNSUPPORTED':
      return 'Este aparelho não consegue reproduzir esta gravação com precisão.';
    case 'AUDIO_NATIVE_MP3_DECODE_FAILED':
    case 'AUDIO_NATIVE_MP3_LENGTH_MISMATCH':
    case 'AUDIO_NATIVE_WRITE_FAILED':
      return 'Não foi possível preparar o áudio. Tente abrir novamente.';
    case 'AUDIO_NATIVE_CANCELLED':
      return 'Preparação cancelada.';
    default:
      return 'Não foi possível abrir ou controlar esta gravação.';
  }
}

String _clock(int frames, int sampleRate) {
  if (sampleRate <= 0) return '0:00';
  final s = frames ~/ sampleRate;
  return '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}';
}

/// Mixer for ONE recording. All commands go through
/// [MinistryAudioPlaybackController]; this widget holds no playback logic.
class MinistryAudioMixerScreen extends ConsumerStatefulWidget {
  const MinistryAudioMixerScreen({
    super.key,
    required this.recordingId,
    this.title,
    this.subtitle,
    this.pollInterval = const Duration(milliseconds: 500),
  });

  final String recordingId;
  final String? title;
  final String? subtitle;
  final Duration pollInterval;

  @override
  ConsumerState<MinistryAudioMixerScreen> createState() =>
      _MinistryAudioMixerScreenState();
}

class _MinistryAudioMixerScreenState
    extends ConsumerState<MinistryAudioMixerScreen> {
  late final MinistryAudioPlaybackController _controller;
  Timer? _poll;
  bool _inFlight = false;
  bool _sawActive = false; // left idle at least once (opening or session)
  double? _dragFraction;

  @override
  void initState() {
    super.initState();
    _controller = ref.read(ministryAudioPlaybackControllerProvider.notifier);
    WidgetsBinding.instance.addPostFrameCallback((_) => _open());
  }

  @override
  void dispose() {
    _poll?.cancel();
    _poll = null;
    // Controlled shutdown: native closes first, the lease is released after
    // confirmation (single-flight inside the controller).
    unawaited(_controller.close());
    super.dispose();
  }

  Future<void> _open() async {
    if (!mounted) return;
    try {
      await _controller.open(widget.recordingId);
    } on AppFailure {
      // The controller state already carries the error shown below.
    }
  }

  void _syncPolling(MinistryAudioPlaybackPhase phase) {
    final shouldPoll = phase == MinistryAudioPlaybackPhase.playing;
    if (shouldPoll && _poll == null) {
      _poll = Timer.periodic(widget.pollInterval, (_) async {
        if (!mounted || _inFlight) return; // never stack snapshots
        _inFlight = true;
        try {
          await _controller.refresh();
        } finally {
          _inFlight = false;
        }
      });
    } else if (!shouldPoll && _poll != null) {
      _poll!.cancel();
      _poll = null;
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    try {
      await action();
    } on AppFailure catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(ministryAudioErrorText(e.code))));
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<MinistryAudioPlaybackPhase>(
      ministryAudioPlaybackControllerProvider.select((s) => s.phase),
      (_, next) {
        if (next != MinistryAudioPlaybackPhase.idle) _sawActive = true;
        _syncPolling(next);
      },
    );
    final title = widget.title ?? 'Gravação';
    return Scaffold(
      appBar: AppBar(
        title: Text(title, key: const ValueKey('mixer_title')),
        bottom: widget.subtitle == null || widget.subtitle!.isEmpty
            ? null
            : PreferredSize(
                preferredSize: const Size.fromHeight(24),
                child: Padding(
                  padding: const EdgeInsets.only(left: 16, right: 16, bottom: 6),
                  child: Align(
                    alignment: Alignment.centerLeft,
                    child: Text(widget.subtitle!),
                  ),
                ),
              ),
      ),
      body: SafeArea(
        child: Consumer(
          builder: (context, ref, _) {
            final phase = ref.watch(
              ministryAudioPlaybackControllerProvider.select((s) => s.phase),
            );
            final code = ref.watch(
              ministryAudioPlaybackControllerProvider.select((s) => s.errorCode),
            );
            if (phase == MinistryAudioPlaybackPhase.idle && _sawActive) {
              // The session was closed under us (logout, ministry switch,
              // context change): never keep showing the old recording.
              return _ErrorView(
                text: ministryAudioErrorText(
                    MinistryAudioPlayerCodes.contextChanged),
                onRetry: _open,
              );
            }
            if (phase == MinistryAudioPlaybackPhase.idle ||
                phase == MinistryAudioPlaybackPhase.loading) {
              return const _Preparing();
            }
            if (phase == MinistryAudioPlaybackPhase.error) {
              return _ErrorView(
                text: ministryAudioErrorText(code),
                onRetry: _open,
              );
            }
            return LayoutBuilder(
              builder: (context, box) {
                final wide = box.maxWidth >= 720;
                final channels = [
                  for (final stem in MinistryStemId.values)
                    _ChannelStrip(
                      key: ValueKey('channel_${stem.name}'),
                      stem: stem,
                      onError: _run,
                    ),
                ];
                final transport = _Transport(
                  onRun: _run,
                  onReopen: _open,
                  dragFraction: _dragFraction,
                  onDrag: (v) => setState(() => _dragFraction = v),
                );
                return SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 1000),
                      child: wide
                          ? Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                SizedBox(width: 340, child: transport),
                                const SizedBox(width: 24),
                                Expanded(
                                  child: Wrap(
                                    key: const ValueKey('mixer_channels_wide'),
                                    spacing: 12,
                                    runSpacing: 12,
                                    children: [
                                      for (final c in channels)
                                        SizedBox(
                                          width: (box.maxWidth - 340 - 32 - 24 - 12) / 2 - 1,
                                          child: c,
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                            )
                          : Column(
                              children: [
                                transport,
                                const SizedBox(height: 16),
                                Column(
                                  key: const ValueKey('mixer_channels_narrow'),
                                  children: [
                                    for (final c in channels)
                                      Padding(
                                        padding: const EdgeInsets.only(bottom: 8),
                                        child: c,
                                      ),
                                  ],
                                ),
                              ],
                            ),
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _Preparing extends StatelessWidget {
  const _Preparing();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Indeterminate on purpose: there is no transfer-progress contract.
          CircularProgressIndicator(key: ValueKey('mixer_preparing')),
          SizedBox(height: 16),
          Text('Preparando a gravação…'),
        ],
      ),
    );
  }
}

class _ErrorView extends StatelessWidget {
  const _ErrorView({required this.text, required this.onRetry});

  final String text;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline, size: 40),
            const SizedBox(height: 12),
            Text(text, key: const ValueKey('mixer_error'), textAlign: TextAlign.center),
            const SizedBox(height: 12),
            FilledButton.icon(
              key: const ValueKey('mixer_retry'),
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Transport extends ConsumerWidget {
  const _Transport({
    required this.onRun,
    required this.onReopen,
    required this.dragFraction,
    required this.onDrag,
  });

  final Future<void> Function(Future<void> Function()) onRun;
  final Future<void> Function() onReopen;
  final double? dragFraction;
  final ValueChanged<double?> onDrag;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = ref.read(ministryAudioPlaybackControllerProvider.notifier);
    final phase = ref.watch(
      ministryAudioPlaybackControllerProvider.select((s) => s.phase),
    );
    final master = ref.watch(
      ministryAudioPlaybackControllerProvider.select((s) => s.master),
    );
    final completed = phase == MinistryAudioPlaybackPhase.completed;
    final playing = phase == MinistryAudioPlaybackPhase.playing;
    final paused = phase == MinistryAudioPlaybackPhase.paused;
    final ready = phase == MinistryAudioPlaybackPhase.ready;

    Widget main;
    if (playing) {
      main = _big('mixer_pause', Icons.pause, 'Pausar', () => onRun(c.pause));
    } else if (paused) {
      main = _big('mixer_resume', Icons.play_arrow, 'Retomar', () => onRun(c.resume));
    } else if (completed) {
      main = _big('mixer_replay', Icons.replay, 'Tocar novamente', onReopen);
    } else {
      main = _big('mixer_play', Icons.play_arrow, 'Tocar',
          ready ? () => onRun(c.play) : null);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const _Progress(),
        Slider(
          key: const ValueKey('mixer_progress'),
          value: ref.watch(ministryAudioPlaybackControllerProvider.select((s) {
            if (s.durationFrames <= 0) return 0.0;
            return (s.positionFrames / s.durationFrames).clamp(0.0, 1.0);
          })),
          onChanged: (ready || playing || paused)
              ? (v) => onDrag(v)
              : null,
          onChangeEnd: (v) {
            final d = ref.read(ministryAudioPlaybackControllerProvider).durationFrames;
            onDrag(null);
            onRun(() => c.seek((v * d).round()));
          },
          semanticFormatterCallback: (v) => 'Posição ${(v * 100).round()}%',
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            main,
            const SizedBox(width: 16),
            IconButton.outlined(
              key: const ValueKey('mixer_stop'),
              tooltip: 'Parar',
              constraints: const BoxConstraints(minWidth: 56, minHeight: 56),
              onPressed: (playing || paused) ? () => onRun(c.stop) : null,
              icon: const Icon(Icons.stop),
            ),
          ],
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            const Icon(Icons.volume_up_outlined),
            Expanded(
              child: Slider(
                key: const ValueKey('mixer_master'),
                value: master,
                semanticFormatterCallback: (v) => 'Volume geral ${(v * 100).round()}%',
                onChanged: (ready || playing || paused)
                    ? (v) => onRun(() => c.setMasterVolume(v))
                    : null,
              ),
            ),
          ],
        ),
        const Text('Volume geral', textAlign: TextAlign.center),
      ],
    );
  }

  Widget _big(String key, IconData icon, String label, VoidCallback? onTap) {
    return Semantics(
      label: label,
      button: true,
      child: IconButton.filled(
        key: ValueKey(key),
        tooltip: label,
        iconSize: 36,
        constraints: const BoxConstraints(minWidth: 64, minHeight: 64),
        onPressed: onTap,
        icon: Icon(icon),
      ),
    );
  }
}

/// Current time / duration; rebuilds on position only.
class _Progress extends ConsumerWidget {
  const _Progress();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = ref.watch(ministryAudioPlaybackControllerProvider.select(
      (s) => (_clock(s.positionFrames, s.sampleRate), _clock(s.durationFrames, s.sampleRate)),
    ));
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(t.$1, key: const ValueKey('mixer_position')),
        Text(t.$2, key: const ValueKey('mixer_duration')),
      ],
    );
  }
}

/// One channel. Watches ONLY its own gain/mute/solo, so moving one slider does
/// not rebuild the other five.
class _ChannelStrip extends ConsumerWidget {
  const _ChannelStrip({super.key, required this.stem, required this.onError});

  final MinistryStemId stem;
  final Future<void> Function(Future<void> Function()) onError;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final i = stem.index;
    final v = ref.watch(ministryAudioPlaybackControllerProvider.select(
      (s) => (
        s.gains[i],
        s.muted[i],
        s.solo[i],
        s.phase == MinistryAudioPlaybackPhase.ready ||
            s.phase == MinistryAudioPlaybackPhase.playing ||
            s.phase == MinistryAudioPlaybackPhase.paused,
      ),
    ));
    final c = ref.read(ministryAudioPlaybackControllerProvider.notifier);
    final label = _stemLabels[stem]!;
    final color = _stemColors[stem]!;
    final enabled = v.$4;

    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        child: Row(
          children: [
            Container(
              width: 6,
              height: 40,
              decoration: BoxDecoration(
                color: color,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
            const SizedBox(width: 10),
            SizedBox(
              width: 72,
              child: Text(label, style: Theme.of(context).textTheme.titleSmall),
            ),
            Expanded(
              child: Slider(
                key: ValueKey('gain_${stem.name}'),
                value: v.$1,
                activeColor: color,
                semanticFormatterCallback: (g) => 'Volume $label ${(g * 100).round()}%',
                onChanged: enabled
                    ? (g) => onError(() => c.setTrackGain(stem, g))
                    : null,
              ),
            ),
            Semantics(
              label: 'Silenciar $label',
              toggled: v.$2,
              child: IconButton(
                key: ValueKey('mute_${stem.name}'),
                tooltip: 'Silenciar $label',
                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                isSelected: v.$2,
                selectedIcon: const Icon(Icons.volume_off),
                icon: const Icon(Icons.volume_up_outlined),
                onPressed: enabled ? () => onError(() => c.setTrackMuted(stem, !v.$2)) : null,
              ),
            ),
            Semantics(
              label: 'Solo $label',
              toggled: v.$3,
              child: IconButton(
                key: ValueKey('solo_${stem.name}'),
                tooltip: 'Solo $label',
                constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                isSelected: v.$3,
                style: v.$3
                    ? IconButton.styleFrom(
                        backgroundColor: color.withValues(alpha: 0.25),
                      )
                    : null,
                icon: const Text('S', style: TextStyle(fontWeight: FontWeight.bold)),
                selectedIcon: Text('S',
                    style: TextStyle(fontWeight: FontWeight.bold, color: color)),
                onPressed: enabled ? () => onError(() => c.setTrackSolo(stem, !v.$3)) : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
