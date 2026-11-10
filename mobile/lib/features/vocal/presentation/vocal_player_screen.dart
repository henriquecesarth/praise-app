import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/providers.dart';
import '../../../core/errors/app_failure.dart';
import '../../auth/presentation/controllers/auth_controller.dart';
import '../data/vocal_exercise_repository.dart';
import '../domain/vocal_catalog.dart';
import '../domain/vocal_exercise.dart';
import 'controllers/vocal_exercise_controller.dart';
import 'widgets/custom_exercise_editor_sheet.dart';
import 'widgets/piano_keyboard.dart';
import 'widgets/vocal_exercise_library.dart';

class VocalPlayerScreen extends StatelessWidget {
  const VocalPlayerScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final hasProviderScope =
        context.findAncestorWidgetOfExactType<UncontrolledProviderScope>() !=
        null;
    if (hasProviderScope) {
      return const _VocalPlayerScreenContent();
    }
    return const ProviderScope(child: _VocalPlayerScreenContent());
  }
}

class _VocalPlayerScreenContent extends ConsumerStatefulWidget {
  const _VocalPlayerScreenContent();

  @override
  ConsumerState<_VocalPlayerScreenContent> createState() =>
      _VocalPlayerScreenContentState();
}

class _VocalPlayerScreenContentState
    extends ConsumerState<_VocalPlayerScreenContent>
    with WidgetsBindingObserver {
  static const _audio = MethodChannel('com.louvaio.mobile/vocal_audio');
  static const List<int> _bpmPresets = [60, 72, 80, 96, 120];

  String _selectedExerciseId = vocalExercises.first.id;
  int _bpm = 80;
  bool _metronome = true;
  bool _ascending = true;
  int _midiLow = defaultVocalMinMidi;
  int _midiHigh = defaultVocalMaxMidi;
  int _stepTranspose = 0;
  int? _activeNote;
  bool _playing = false;
  bool _paused = false;
  bool _ready = false;
  bool _showKeyboard = false;
  int _runId = 0;
  Timer? _positionTimer;

  List<int> _currentProgNotes = const [];
  List<double> _currentProgDurations = const [];
  List<int> _currentProgSteps = const [];

  String? _hydratedUserId;
  int? _lastAppliedUserMinMidi;
  int? _lastAppliedUserMaxMidi;
  bool _isSavingRange = false;
  String? _rangeFeedbackMessage;
  bool _rangeFeedbackIsError = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _syncWithAuthState(ref.read(authNotifierProvider));
    });
  }

  void _syncWithAuthState(AuthState authState) {
    final user = authState.user;
    final userId = user?.id;

    if (userId != _hydratedUserId) {
      _hydratedUserId = userId;
      _lastAppliedUserMinMidi = user?.vocalMinMidi;
      _lastAppliedUserMaxMidi = user?.vocalMaxMidi;
      _rangeFeedbackMessage = null;

      if (userId != null && userId.isNotEmpty) {
        if (user?.vocalMinMidi != null &&
            user?.vocalMaxMidi != null &&
            user!.vocalMinMidi! < user.vocalMaxMidi!) {
          setState(() {
            _midiLow = user.vocalMinMidi!;
            _midiHigh = user.vocalMaxMidi!;
          });
        } else {
          setState(() {
            _midiLow = defaultVocalMinMidi;
            _midiHigh = defaultVocalMaxMidi;
          });
        }
        ref
            .read(customVocalExercisesNotifierProvider.notifier)
            .loadForUser(userId);
      } else {
        // Logged out or unauthenticated: clear custom selection and reset range
        ref.read(customVocalExercisesNotifierProvider.notifier).reset();
        setState(() {
          _midiLow = defaultVocalMinMidi;
          _midiHigh = defaultVocalMaxMidi;
          if (!vocalExercises.any((e) => e.id == _selectedExerciseId)) {
            _selectedExerciseId = vocalExercises.first.id;
          }
        });
      }
      return;
    }

    if (user != null &&
        user.vocalMinMidi != null &&
        user.vocalMaxMidi != null &&
        (user.vocalMinMidi != _lastAppliedUserMinMidi ||
            user.vocalMaxMidi != _lastAppliedUserMaxMidi)) {
      _lastAppliedUserMinMidi = user.vocalMinMidi;
      _lastAppliedUserMaxMidi = user.vocalMaxMidi;
      if (user.vocalMinMidi! < user.vocalMaxMidi!) {
        setState(() {
          _midiLow = user.vocalMinMidi!;
          _midiHigh = user.vocalMaxMidi!;
        });
      }
    }
  }

  List<VocalExercise> _allAvailableExercises(
    CustomVocalExercisesState customState,
  ) {
    return [...vocalExercises, ...customState.exercises];
  }

  VocalExercise _resolveSelectedExercise(
    CustomVocalExercisesState customState,
  ) {
    final all = _allAvailableExercises(customState);
    for (final ex in all) {
      if (ex.id == _selectedExerciseId) return ex;
    }
    return vocalExercises.first;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _stop(notifyUi: mounted);
    }
  }

  Future<void> _play(VocalExercise exercise) async {
    final runId = ++_runId;
    _positionTimer?.cancel();
    await _invoke('stop');
    if (!mounted || runId != _runId) return;

    final prog = exercise.progression(
      midiLow: _midiLow,
      midiHigh: _midiHigh,
      ascending: _ascending,
    );
    _currentProgNotes = prog.notes;
    _currentProgDurations = prog.durations;
    _currentProgSteps = prog.steps;

    setState(() {
      _playing = true;
      _paused = false;
      _ready = false;
      _stepTranspose = prog.steps.first;
      _activeNote = null;
    });

    try {
      await _invoke('playSequence', {
        'sessionId': runId,
        'notes': prog.notes,
        'durations': prog.durations,
        'bpm': _bpm,
        'metronome': _metronome,
      });
    } catch (_) {
      if (mounted && runId == _runId) {
        setState(() {
          _playing = false;
          _paused = false;
          _ready = false;
          _activeNote = null;
        });
      }
      return;
    }
    if (!mounted || runId != _runId || !_playing) return;
    setState(() {
      _ready = true;
      if (!_paused && _currentProgNotes.isNotEmpty) {
        _activeNote = _currentProgNotes.first;
      }
    });
    _startPositionPolling(runId);
  }

  Future<void> _previewCustomPattern(
    List<int> notes,
    List<double> durations,
  ) async {
    final runId = ++_runId;
    _positionTimer?.cancel();
    await _invoke('stop');
    await _invoke('playSequence', {
      'sessionId': runId,
      'notes': notes,
      'durations': durations,
      'bpm': _bpm,
      'metronome': false,
    });
  }

  void _startPositionPolling(int runId) {
    _positionTimer?.cancel();
    _positionTimer = Timer.periodic(const Duration(milliseconds: 50), (
      timer,
    ) async {
      if (!mounted || runId != _runId || !_playing) {
        timer.cancel();
        return;
      }
      if (_paused) return;

      final pos = await _invokeMap('position', {'sessionId': runId});
      if (!mounted || runId != _runId || !_playing || pos == null) return;

      final state = pos['state'] as String?;
      final playedFrames = (pos['playedFrames'] as num?)?.toInt() ?? 0;
      final sampleRate = (pos['sampleRate'] as num?)?.toInt() ?? 44100;

      if (state == 'completed' || state == 'stopped' || state == 'error') {
        timer.cancel();
        setState(() {
          _playing = false;
          _paused = false;
          _ready = false;
          _activeNote = null;
          _stepTranspose = 0;
        });
        return;
      }

      if (sampleRate > 0) {
        final seconds = playedFrames / sampleRate;
        _updateActiveFromSeconds(seconds);
      }
    });
  }

  void _updateActiveFromSeconds(double seconds) {
    if (_currentProgDurations.isEmpty) return;
    final beatSeconds = 60.0 / _bpm;
    var elapsed = 0.0;
    for (var i = 0; i < _currentProgDurations.length; i++) {
      final stepDur = _currentProgDurations[i] * beatSeconds;
      if (seconds < elapsed + stepDur) {
        final newStep = _currentProgSteps[i];
        final newNote = _currentProgNotes[i];
        if (newStep != _stepTranspose || newNote != _activeNote) {
          setState(() {
            _stepTranspose = newStep;
            _activeNote = newNote;
          });
        }
        return;
      }
      elapsed += stepDur;
    }
  }

  Future<void> _pause() async {
    if (!_playing || !_ready || _paused) return;
    setState(() => _paused = true);
    await _invoke('pause', {'sessionId': _runId});
  }

  Future<void> _resume() async {
    if (!_playing || !_ready || !_paused) return;
    setState(() => _paused = false);
    await _invoke('resume', {'sessionId': _runId});
  }

  Future<void> _stop({bool notifyUi = true}) async {
    final prevRunId = _runId;
    _runId++;
    _positionTimer?.cancel();
    _positionTimer = null;
    if (notifyUi && mounted) {
      setState(() {
        _playing = false;
        _paused = false;
        _ready = false;
        _activeNote = null;
        _stepTranspose = 0;
      });
    }
    await _invoke('stop', {'sessionId': prevRunId});
  }

  Future<void> _invoke(String method, [Map<String, Object?>? args]) async {
    try {
      await _audio.invokeMethod<void>(method, args);
    } on MissingPluginException {
      // Widget tests without native audio plugin still verify UI state.
    }
  }

  Future<Map<Object?, Object?>?> _invokeMap(
    String method, [
    Map<String, Object?>? args,
  ]) async {
    try {
      return await _audio.invokeMethod<Map<Object?, Object?>>(method, args);
    } on MissingPluginException {
      return null;
    }
  }

  Future<void> _saveVocalRange() async {
    if (_midiLow >= _midiHigh) {
      setState(() {
        _rangeFeedbackMessage =
            'A nota mais grave deve ser menor que a nota mais aguda.';
        _rangeFeedbackIsError = true;
      });
      return;
    }
    setState(() {
      _isSavingRange = true;
      _rangeFeedbackMessage = null;
      _rangeFeedbackIsError = false;
    });
    try {
      final confirmed = await ref
          .read(authNotifierProvider.notifier)
          .updateVocalRangePreference(minMidi: _midiLow, maxMidi: _midiHigh);
      if (!mounted) return;
      setState(() {
        _isSavingRange = false;
        _midiLow = confirmed.$1;
        _midiHigh = confirmed.$2;
        _lastAppliedUserMinMidi = confirmed.$1;
        _lastAppliedUserMaxMidi = confirmed.$2;
        _rangeFeedbackMessage = 'Extensão salva no seu perfil!';
        _rangeFeedbackIsError = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSavingRange = false;
        _rangeFeedbackMessage = e is AppFailure
            ? e.message
            : 'Não foi possível salvar sua extensão vocal.';
        _rangeFeedbackIsError = true;
      });
    }
  }

  Future<void> _openCustomModal(
    CustomExerciseEditorMode mode, [
    VocalExercise? source,
  ]) async {
    if (_playing || _ready || _paused || _positionTimer != null) {
      await _stop();
    }
    if (!mounted) return;
    await CustomExerciseEditorSheet.show(
      context,
      mode: mode,
      initialExercise: source,
      onPreviewPattern: _previewCustomPattern,
      onStopPreview: () => _stop(notifyUi: false),
      onSave: (draft) async {
        final notifier = ref.read(
          customVocalExercisesNotifierProvider.notifier,
        );
        if (mode == CustomExerciseEditorMode.edit && source != null) {
          final updated = await notifier.updateExercise(
            source.id,
            CustomVocalExercisePatch(
              title: draft.title,
              description: draft.description,
              notes: draft.notes,
              noteDurations: draft.noteDurations,
              minTranspose: draft.minTranspose,
              maxTranspose: draft.maxTranspose,
              category: draft.category,
            ),
          );
          if (mounted) {
            setState(() => _selectedExerciseId = updated.id);
          }
        } else {
          final created = await notifier.createExercise(draft);
          if (mounted) {
            setState(() => _selectedExerciseId = created.id);
          }
        }
      },
    );
  }

  Future<void> _confirmDeleteCustomExercise(VocalExercise exercise) async {
    if (!exercise.isCustom) return;
    if (_playing || _ready || _paused || _positionTimer != null) {
      await _stop();
    }
    if (!mounted) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Excluir exercício personalizado'),
        content: Text(
          'Deseja excluir "${exercise.title}"? Esta ação não pode ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogContext).colorScheme.error,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await ref
          .read(customVocalExercisesNotifierProvider.notifier)
          .deleteExercise(exercise.id);
      if (mounted && _selectedExerciseId == exercise.id) {
        setState(() => _selectedExerciseId = vocalExercises.first.id);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              e is AppFailure
                  ? e.message
                  : 'Não foi possível excluir o exercício.',
            ),
          ),
        );
      }
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stop(notifyUi: false);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<AuthState>(authNotifierProvider, (_, next) {
      _syncWithAuthState(next);
    });

    final theme = Theme.of(context);
    final authState = ref.watch(authNotifierProvider);
    final customState = ref.watch(customVocalExercisesNotifierProvider);
    final exercise = _resolveSelectedExercise(customState);
    final (minT, maxT) = exercise.transposeBounds(
      midiLow: _midiLow,
      midiHigh: _midiHigh,
    );
    final fitsSelectedRange = exercise.fitsRange(
      midiLow: _midiLow,
      midiHigh: _midiHigh,
    );
    final activeNotes = exercise.notesAt(_stepTranspose);

    return Scaffold(
      appBar: AppBar(title: const Text('Aquecimento vocal')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
          // 1. Collapsible Visual Exercise Library (M21-UX1)
          VocalExerciseLibrary(
            catalogExercises: vocalExercises,
            customExercises: customState.exercises,
            selectedExerciseId: exercise.id,
            isAuthenticated: authState.isAuthenticated,
            isLoadingCustom: customState.isLoading,
            customErrorMessage: customState.failure?.message,
            onRetryLoadCustom: authState.user?.id != null
                ? () => ref
                      .read(customVocalExercisesNotifierProvider.notifier)
                      .loadForUser(authState.user!.id, force: true)
                : null,
            onSelectExercise: (selected) {
              _stop();
              setState(() => _selectedExerciseId = selected.id);
            },
            onCreateCustom: () =>
                _openCustomModal(CustomExerciseEditorMode.create),
            onEditCustom: (target) =>
                _openCustomModal(CustomExerciseEditorMode.edit, target),
            onDuplicateExercise: (target) =>
                _openCustomModal(CustomExerciseEditorMode.duplicate, target),
            onDeleteCustom: _confirmDeleteCustomExercise,
          ),
          const SizedBox(height: 12),

          // 2. Monitor & Current Step Card
          Card(
            key: const ValueKey('vocal_monitor_card'),
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.25),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          exercise.title,
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                      OutlinedButton.icon(
                        key: const ValueKey('vocal_toggle_keyboard_button'),
                        onPressed: () {
                          setState(() => _showKeyboard = !_showKeyboard);
                        },
                        icon: Icon(
                          _showKeyboard ? Icons.piano_off : Icons.piano,
                          size: 16,
                        ),
                        label: Text(
                          _showKeyboard
                              ? 'Ocultar teclado'
                              : 'Mostrar teclado',
                        ),
                        style: OutlinedButton.styleFrom(
                          visualDensity: VisualDensity.compact,
                        ),
                      ),
                    ],
                  ),
                  if (exercise.description.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      exercise.description,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 12,
                    runSpacing: 6,
                    children: [
                      Text(
                        'Tom atual: ${midiLabel(60 + _stepTranspose)} (${_stepTranspose >= 0 ? '+$_stepTranspose' : '$_stepTranspose'} st)',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        'Nota atual: ${_activeNote == null
                            ? '-'
                            : _activeNote! < 0
                            ? 'Pausa'
                            : midiLabel(_activeNote!)}',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (var i = 0; i < activeNotes.length; i++)
                        Chip(
                          backgroundColor: _activeNote == activeNotes[i]
                              ? theme.colorScheme.primaryContainer
                              : null,
                          label: Text(
                            '${midiLabel(activeNotes[i])} (${exercise.noteDurations[i]}t)',
                            style: TextStyle(
                              fontWeight: _activeNote == activeNotes[i]
                                  ? FontWeight.w800
                                  : FontWeight.w500,
                            ),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          if (_showKeyboard) ...[
            const SizedBox(height: 12),
            PianoKeyboard(
              activeNote: _activeNote != null && _activeNote! >= 0
                  ? _activeNote
                  : null,
              minMidi: supportedPianoMinMidi,
              maxMidi: supportedPianoMaxMidi,
              initialFocusMidi: activeNotes.isNotEmpty ? activeNotes.first : 60,
            ),
          ],

          const SizedBox(height: 12),

          // 3. Tempo (BPM) & Metronome Card
          Card(
            key: const ValueKey('vocal_tempo_card'),
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.25),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Andamento: $_bpm BPM',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final preset in _bpmPresets)
                        ChoiceChip(
                          key: ValueKey('vocal_bpm_preset_$preset'),
                          label: Text('$preset BPM'),
                          selected: _bpm == preset,
                          onSelected: _playing
                              ? null
                              : (_) => setState(() => _bpm = preset),
                        ),
                    ],
                  ),
                  Slider(
                    min: 40,
                    max: 160,
                    divisions: 24,
                    value: _bpm.toDouble(),
                    label: '$_bpm BPM',
                    onChanged: _playing
                        ? null
                        : (value) => setState(() => _bpm = value.round()),
                  ),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Metrônomo'),
                    value: _metronome,
                    onChanged: _playing
                        ? null
                        : (value) => setState(() => _metronome = value),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // 4. Vocal Range (Musical Notes) & Persistence Card
          Card(
            key: const ValueKey('vocal_range_card'),
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.25),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Extensão vocal: ${midiLabel(_midiLow)} a ${midiLabel(_midiHigh)}',
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            Text(
                              'Selecione a nota mais grave e a nota mais aguda confortável.',
                              style: theme.textTheme.bodySmall?.copyWith(
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                      if (authState.isAuthenticated)
                        FilledButton.tonalIcon(
                          key: const ValueKey('vocal_save_range_button'),
                          onPressed: _isSavingRange ? null : _saveVocalRange,
                          icon: const Icon(Icons.bookmark_added_outlined, size: 16),
                          label: Text(
                            _isSavingRange
                                ? 'Salvando...'
                                : 'Salvar minha extensão',
                          ),
                          style: FilledButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                    ],
                  ),
                  if (_rangeFeedbackMessage != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _rangeFeedbackMessage!,
                      key: const ValueKey('vocal_range_feedback_text'),
                      style: theme.textTheme.bodySmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: _rangeFeedbackIsError
                            ? theme.colorScheme.error
                            : theme.colorScheme.primary,
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final preset in vocalRangePresets)
                        ChoiceChip(
                          key: ValueKey('vocal_range_preset_${preset.id}'),
                          label: Text('${preset.label} (${preset.subtitle})'),
                          selected:
                              _midiLow == preset.minMidi &&
                              _midiHigh == preset.maxMidi,
                          onSelected: _playing
                              ? null
                              : (_) {
                                  setState(() {
                                    _midiLow = preset.minMidi;
                                    _midiHigh = preset.maxMidi;
                                    _rangeFeedbackMessage = null;
                                  });
                                },
                        ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: DropdownButtonFormField<int>(
                          key: const ValueKey('vocal_min_note_dropdown'),
                          initialValue: _midiLow,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Mais grave',
                            border: OutlineInputBorder(),
                            isDense: true,
                          ),
                          items: [
                            for (final note in selectableVocalNotes)
                              if (note.midi < supportedPianoMaxMidi)
                                DropdownMenuItem(
                                  value: note.midi,
                                  child: Text(note.label),
                                ),
                          ],
                          onChanged: _playing
                              ? null
                              : (val) {
                                  if (val == null) return;
                                  setState(() {
                                    _midiLow = val;
                                    if (_midiHigh <= val) {
                                      _midiHigh = (val + 1).clamp(
                                        supportedPianoMinMidi + 1,
                                        supportedPianoMaxMidi,
                                      );
                                    }
                                    _rangeFeedbackMessage = null;
                                  });
                                },
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: DropdownButtonFormField<int>(
                          key: const ValueKey('vocal_max_note_dropdown'),
                          initialValue: _midiHigh,
                          isExpanded: true,
                          decoration: const InputDecoration(
                            labelText: 'Mais aguda',
                            border: OutlineInputBorder(),
                            isDense: true,
                          ),
                          items: [
                            for (final note in selectableVocalNotes)
                              if (note.midi > supportedPianoMinMidi)
                                DropdownMenuItem(
                                  value: note.midi,
                                  child: Text(note.label),
                                ),
                          ],
                          onChanged: _playing
                              ? null
                              : (val) {
                                  if (val == null) return;
                                  setState(() {
                                    _midiHigh = val;
                                    if (_midiLow >= val) {
                                      _midiLow = (val - 1).clamp(
                                        supportedPianoMinMidi,
                                        supportedPianoMaxMidi - 1,
                                      );
                                    }
                                    _rangeFeedbackMessage = null;
                                  });
                                },
                        ),
                      ),
                    ],
                  ),
                  if (!fitsSelectedRange) ...[
                    const SizedBox(height: 10),
                    Container(
                      key: const ValueKey('vocal_range_warning_banner'),
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: Colors.amber.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: Colors.amber.shade700.withValues(alpha: 0.5),
                        ),
                      ),
                      child: Text(
                        'A extensão selecionada (${midiLabel(_midiLow)}–${midiLabel(_midiHigh)}) é estreita demais para este exercício. Tocando apenas no tom central (Dó4).',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: theme.brightness == Brightness.dark
                              ? Colors.amber.shade200
                              : Colors.amber.shade900,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // 5. Progression Direction Card
          Card(
            key: const ValueKey('vocal_progression_card'),
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.25),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Progressão por semitons (faixa efetiva: ${midiLabel(60 + minT)} a ${midiLabel(60 + maxT)})',
                    style: theme.textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SegmentedButton<bool>(
                    segments: const [
                      ButtonSegment(
                        value: true,
                        label: Text('Subir semitom a semitom'),
                      ),
                      ButtonSegment(
                        value: false,
                        label: Text('Descer semitom a semitom'),
                      ),
                    ],
                    selected: {_ascending},
                    onSelectionChanged: _playing
                        ? null
                        : (values) => setState(() => _ascending = values.first),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 6. Transport Controls
          Wrap(
            spacing: 12,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                key: const ValueKey('vocal_start_button'),
                onPressed: _playing ? null : () => _play(exercise),
                icon: const Icon(Icons.play_arrow),
                label: Text(
                  _playing
                      ? (_paused ? 'Em pausa' : 'Tocando...')
                      : 'Iniciar exercício',
                ),
              ),
              FilledButton.tonalIcon(
                key: const ValueKey('vocal_pause_resume_button'),
                onPressed: _playing && _ready
                    ? (_paused ? _resume : _pause)
                    : null,
                icon: Icon(_paused ? Icons.play_arrow : Icons.pause),
                label: Text(_paused ? 'Retomar' : 'Pausar'),
              ),
              OutlinedButton.icon(
                key: const ValueKey('vocal_stop_button'),
                onPressed: _playing ? () => _stop() : null,
                icon: const Icon(Icons.stop),
                label: const Text('Parar'),
              ),
            ],
          ),
          ],
        ),
      ),
    );
  }
}
