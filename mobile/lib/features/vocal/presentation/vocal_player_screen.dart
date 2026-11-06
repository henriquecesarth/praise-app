import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/material.dart';

import '../domain/vocal_exercise.dart';
import '../domain/vocal_catalog.dart';

/// Offline exercise player with tempo, metronome, and tessitura transposition.
class VocalPlayerScreen extends StatefulWidget {
  const VocalPlayerScreen({super.key});
  @override
  State<VocalPlayerScreen> createState() => _VocalPlayerScreenState();
}

class _VocalPlayerScreenState extends State<VocalPlayerScreen>
    with WidgetsBindingObserver {
  VocalExercise exercise = vocalExercises.first;
  int bpm = 80, beat = 0;
  double midiLow = 48, midiHigh = 84;
  bool descending = false;
  bool playing = false, metronome = true;
  bool audioReady = false;
  bool paused = false;
  int currentNoteIndex = 0;
  List<int> _activeNotes = const [];
  List<double> _activeDurations = const [];
  Stopwatch? _clock;
  double _totalBeats = 0;
  Timer? timer;
  Timer? completionTimer;
  Timer? positionTimer;
  static const audio = MethodChannel('com.louvaio.mobile/vocal_audio');
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && playing) stop();
  }

  List<int> get displayNotes {
    final (minimum, maximum) = exercise.transposeBounds(
      midiLow: midiLow.round(),
      midiHigh: midiHigh.round(),
    );
    if (minimum > maximum) return const [];
    return exercise.notesAt(
      0.clamp(minimum, maximum),
      midiLow: midiLow.round(),
      midiHigh: midiHigh.round(),
    );
  }

  bool get canPlay {
    final (minimum, maximum) = exercise.transposeBounds(
      midiLow: midiLow.round(),
      midiHigh: midiHigh.round(),
    );
    return minimum <= maximum;
  }

  void start() {
    if (!canPlay) return;
    timer?.cancel();
    completionTimer?.cancel();
    final generation = ++_generation;
    final selected = exercise;
    final selectedBpm = bpm;
    final timeline = selected.progression(
      ascending: !descending,
      midiLow: midiLow.round(),
      midiHigh: midiHigh.round(),
    );
    final totalBeats = timeline.durations.fold<double>(0, (a, b) => a + b);
    _activeNotes = timeline.notes;
    _activeDurations = timeline.durations;
    _totalBeats = totalBeats;
    final duration = Duration(
      milliseconds: (totalBeats * 60000 / selectedBpm).round(),
    );
    if (duration.inSeconds > 900) {
      setState(() {
        audioError = true;
        playing = false;
      });
      return;
    }
    setState(() => audioError = false);
    setState(() {
      playing = true;
      audioReady = false;
      paused = false;
      beat = 0;
    });
    audio
        .invokeMethod<dynamic>('playSequence', {
          'sessionId': generation,
          'notes': timeline.notes,
          'durations': timeline.durations,
          'bpm': selectedBpm,
          'metronome': metronome,
        })
        .then((_) {
          if (!mounted || generation != _generation) return;
          setState(() {
            audioReady = true;
            beat = 0;
            currentNoteIndex = 0;
          });
          final clock = Stopwatch()..start();
          _clock = clock;

          positionTimer?.cancel();
          positionTimer = Timer.periodic(
            const Duration(milliseconds: 100),
            (t) async {
              if (!mounted || generation != _generation || !playing || paused) return;
              try {
                final pos = await audio.invokeMapMethod<String, dynamic>(
                  'position',
                  {'sessionId': generation},
                );
                if (!mounted || generation != _generation || pos == null) return;
                final state = pos['state'] as String?;
                if (state == 'completed') {
                  t.cancel();
                  stop();
                  return;
                }
                if (state == 'error') {
                  t.cancel();
                  setState(() {
                    audioError = true;
                    playing = false;
                    audioReady = false;
                    paused = false;
                  });
                  return;
                }
                final playedFrames = (pos['playedFrames'] as num?)?.toInt();
                final sampleRate = (pos['sampleRate'] as num?)?.toInt() ?? 44100;
                if (playedFrames != null && playedFrames > 0) {
                  final elapsedSeconds = playedFrames / sampleRate.toDouble();
                  final elapsedBeats = elapsedSeconds * selectedBpm / 60.0;
                  var noteAtBeat = 0;
                  var noteBoundary = 0.0;
                  for (var i = 0; i < timeline.durations.length; i++) {
                    noteAtBeat = i;
                    noteBoundary += timeline.durations[i];
                    if (elapsedBeats < noteBoundary) break;
                  }
                  setState(() {
                    beat = elapsedBeats.floor().clamp(0, totalBeats.ceil());
                    currentNoteIndex = noteAtBeat;
                  });
                }
              } catch (_) {}
            },
          );

          completionTimer = Timer(duration, () {
            if (!mounted || generation != _generation) return;
            timer?.cancel();
            setState(() {
              playing = false;
              audioReady = false;
              paused = false;
              beat = totalBeats.ceil();
              currentNoteIndex = timeline.notes.length - 1;
            });
          });
          void tick() {
            if (!mounted || generation != _generation) return;
            final currentBeat =
                (clock.elapsedMilliseconds * selectedBpm / 60000).floor();
            final elapsedBeats =
                clock.elapsedMilliseconds * selectedBpm / 60000;
            var noteAtBeat = 0;
            var noteBoundary = 0.0;
            for (var i = 0; i < timeline.durations.length; i++) {
              noteAtBeat = i;
              noteBoundary += timeline.durations[i];
              if (elapsedBeats < noteBoundary) break;
            }
            setState(() {
              beat = currentBeat.clamp(0, totalBeats.ceil());
              currentNoteIndex = noteAtBeat;
            });
            if (beat >= totalBeats.ceil()) return;
            final nextBoundary = ((beat + 1) * 60000 / selectedBpm).round();
            final delay = nextBoundary - clock.elapsedMilliseconds;
            timer = Timer(Duration(milliseconds: delay > 0 ? delay : 1), tick);
          }

          tick();
        })
        .catchError((Object _) {
          if (mounted && generation == _generation) {
            timer?.cancel();
            completionTimer?.cancel();
            setState(() {
              audioError = true;
              playing = false;
              audioReady = false;
              paused = false;
            });
          }
        });
  }

  bool audioError = false;

  Future<void> pause() async {
    if (!playing || !audioReady || paused) return;
    final generation = _generation;
    try {
      await audio.invokeMethod<void>('pause', {'sessionId': generation});
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => audioError = true);
      }
      return;
    }
    if (!mounted || generation != _generation) return;
    timer?.cancel();
    completionTimer?.cancel();
    _clock?.stop();
    if (mounted) setState(() => paused = true);
  }

  Future<void> resume() async {
    if (!playing || !paused) return;
    final generation = _generation;
    final clock = _clock;
    if (clock == null) return;
    final elapsed = clock.elapsed;
    final remainingMs =
        (_totalBeats * 60000 / bpm).round() - elapsed.inMilliseconds;
    try {
      await audio.invokeMethod<void>('resume', {'sessionId': generation});
    } catch (_) {
      if (mounted && generation == _generation) {
        setState(() => audioError = true);
      }
      return;
    }
    if (!mounted || generation != _generation) return;
    clock.start();
    setState(() => paused = false);
    completionTimer = Timer(
      Duration(milliseconds: remainingMs.clamp(0, 900000)),
      () {
        if (!mounted) return;
        timer?.cancel();
        setState(() {
          playing = false;
          paused = false;
          beat = _totalBeats.ceil();
        });
      },
    );
    _scheduleProgressTick();
  }

  void _scheduleProgressTick() {
    final clock = _clock;
    if (clock == null || !playing || paused) return;
    final elapsedBeats = clock.elapsedMilliseconds * bpm / 60000;
    var boundary = 0.0;
    var index = 0;
    for (var i = 0; i < _activeDurations.length; i++) {
      index = i;
      boundary += _activeDurations[i];
      if (elapsedBeats < boundary) break;
    }
    setState(() {
      beat = elapsedBeats.floor().clamp(0, _totalBeats.ceil());
      currentNoteIndex = index;
    });
    if (beat >= _totalBeats.ceil()) return;
    final nextBoundary = ((beat + 1) * 60000 / bpm).round();
    final delay = nextBoundary - clock.elapsedMilliseconds;
    timer = Timer(
      Duration(milliseconds: delay > 0 ? delay : 1),
      _scheduleProgressTick,
    );
  }

  void stop() {
    final generation = ++_generation;
    timer?.cancel();
    completionTimer?.cancel();
    positionTimer?.cancel();
    _clock?.stop();
    _clock = null;
    audio
        .invokeMethod<void>('stop', {'sessionId': generation})
        .catchError((Object _) {});
    if (mounted) {
      setState(() {
        playing = false;
        audioReady = false;
        paused = false;
        beat = 0;
        currentNoteIndex = 0;
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    final generation = ++_generation;
    timer?.cancel();
    completionTimer?.cancel();
    positionTimer?.cancel();
    audio
        .invokeMethod<void>('stop', {'sessionId': generation})
        .catchError((Object _) {});
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Aquecimento vocal')),
    body: ListView(
      padding: const EdgeInsets.all(20),
      children: [
        DropdownButtonFormField<VocalExercise>(
          initialValue: exercise,
          decoration: const InputDecoration(labelText: 'Exercício'),
          items: vocalExercises
              .map((e) => DropdownMenuItem(value: e, child: Text(e.title)))
              .toList(),
          onChanged: (e) {
            if (e != null) {
              if (playing) stop();
              setState(() {
                exercise = e;
                beat = 0;
              });
            }
          },
        ),
        const SizedBox(height: 12),
        Text(exercise.description),
        DropdownButtonFormField<bool>(
          initialValue: descending,
          decoration: const InputDecoration(labelText: 'Direção da progressão'),
          items: const [
            DropdownMenuItem(
              value: false,
              child: Text('Subir semitom a semitom'),
            ),
            DropdownMenuItem(
              value: true,
              child: Text('Descer semitom a semitom'),
            ),
          ],
          onChanged: (value) {
            if (value != null) {
              if (playing) stop();
              setState(() => descending = value);
            }
          },
        ),
        Text('Tessitura MIDI: ${midiLow.round()}–${midiHigh.round()}'),
        RangeSlider(
          min: 48,
          max: 84,
          divisions: 36,
          values: RangeValues(midiLow, midiHigh),
          labels: RangeLabels('${midiLow.round()}', '${midiHigh.round()}'),
          onChanged: (range) {
            final low = range.start;
            final high = range.end;
            if (playing) stop();
            setState(() {
              midiLow = low;
              midiHigh = high;
            });
          },
        ),
        const SizedBox(height: 24),
        Text('Andamento: $bpm BPM'),
        Slider(
          min: 40,
          max: 180,
          divisions: 140,
          value: bpm.toDouble(),
          onChanged: (v) {
            if (playing) stop();
            setState(() => bpm = v.round());
          },
        ),
        SwitchListTile(
          title: const Text('Metrônomo'),
          value: metronome,
          onChanged: (v) {
            if (playing) stop();
            setState(() => metronome = v);
          },
        ),
        if (audioError)
          const Text(
            'Falha ao iniciar áudio neste dispositivo.',
            style: TextStyle(color: Colors.red),
          ),
        if (!canPlay)
          const Text(
            'A tessitura escolhida nÃ£o comporta este exercÃ­cio.',
            style: TextStyle(color: Colors.red),
          ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: displayNotes.asMap().entries.map((entry) {
            final midi = entry.value;
            final pc = midi % 12;
            final octave = midi ~/ 12 - 1;
            const names = [
              'Dó',
              'Dó♯',
              'Ré',
              'Ré♯',
              'Mi',
              'Fá',
              'Fá♯',
              'Sol',
              'Sol♯',
              'Lá',
              'Lá♯',
              'Si',
            ];
            return Chip(
              label: Text(
                '${names[pc]}$octave · ${exercise.noteDurations[entry.key]}t',
              ),
            );
          }).toList(),
        ),
        const SizedBox(height: 24),
        if (playing && currentNoteIndex < _activeNotes.length)
          Text('Nota atual: ${_noteName(_activeNotes[currentNoteIndex])}'),
        if (playing)
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: audioReady ? (paused ? resume : pause) : null,
                  icon: Icon(paused ? Icons.play_arrow : Icons.pause),
                  label: Text(paused ? 'Retomar' : 'Pausar'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: stop,
                  icon: const Icon(Icons.stop),
                  label: const Text('Parar'),
                ),
              ),
            ],
          )
        else
          FilledButton.icon(
            onPressed: canPlay ? start : null,
            icon: const Icon(Icons.play_arrow),
            label: Text(playing ? 'Parar' : 'Iniciar exercício'),
          ),
      ],
    ),
  );

  String _noteName(int midi) {
    if (midi < 0) return 'Pausa';
    const names = [
      'Dó',
      'Dó♯',
      'Ré',
      'Ré♯',
      'Mi',
      'Fá',
      'Fá♯',
      'Sol',
      'Sol♯',
      'Lá',
      'Lá♯',
      'Si',
    ];
    return '${names[midi % 12]}${midi ~/ 12 - 1}';
  }
}
