import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/providers.dart';
import '../../../core/errors/app_failure.dart';
import '../../../core/storage/preferences_storage.dart';
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
  bool _completed = false;
  bool _showKeyboard = false;
  double _volume = 1.0;
  double _lastNonZeroVolume = 1.0;
  int _runId = 0;
  int _transportEpoch = 0;
  Timer? _positionTimer;
  Timer? _previewPollTimer;
  Timer? _volumePersistTimer;
  Completer<void>? _previewCompleter;
  final _UiSignal _monitorSignal = _UiSignal();
  final _UiSignal _volumeSignal = _UiSignal();

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
    _loadSavedVolume(
      userId: ref.read(authNotifierProvider).user?.id,
      notify: false,
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _syncWithAuthState(ref.read(authNotifierProvider));
    });
  }

  void _loadSavedVolume({String? userId, bool notify = true}) {
    try {
      final prefs = ref.read(preferencesStorageProvider);
      final saved = prefs.getVocalPlayerVolume(userId: userId);
      final nextVolume = (saved != null && saved.isFinite)
          ? saved.clamp(0.0, 1.0)
          : 1.0;
      _volume = nextVolume;
      _lastNonZeroVolume = nextVolume > 0.02 ? nextVolume : 1.0;
      if (notify && mounted) {
        _volumeSignal.ping();
      }
      if (_playing) {
        unawaited(_invoke('setVolume', {'volume': nextVolume}));
      }
    } catch (_) {}
  }

  void _syncWithAuthState(AuthState authState) {
    final user = authState.user;
    final userId = user?.id;

    if (userId != _hydratedUserId) {
      _volumePersistTimer?.cancel();
      _volumePersistTimer = null;
      _hydratedUserId = userId;
      _lastAppliedUserMinMidi = user?.vocalMinMidi;
      _lastAppliedUserMaxMidi = user?.vocalMaxMidi;
      _rangeFeedbackMessage = null;
      _completed = false;
      _loadSavedVolume(userId: userId, notify: true);

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
          _completed = false;
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
          if (_midiLow != user.vocalMinMidi! ||
              _midiHigh != user.vocalMaxMidi!) {
            _completed = false;
          }
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
    // Only stop when the app is genuinely backgrounded or closing.
    // AppLifecycleState.inactive fires transiently on Android system dialogs
    // and overlays (such as the high-volume warning at max physical volume).
    if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.detached) {
      _stop(notifyUi: mounted);
    }
  }

  Future<void> _play(VocalExercise exercise) async {
    final runId = ++_runId;
    _transportEpoch++;
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
      _completed = false;
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
        'volume': _volume,
      });
    } catch (_) {
      if (mounted && runId == _runId) {
        setState(() {
          _playing = false;
          _paused = false;
          _ready = false;
          _completed = false;
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

  void _finishPreview() {
    _previewPollTimer?.cancel();
    _previewPollTimer = null;
    final completer = _previewCompleter;
    _previewCompleter = null;
    if (completer != null && !completer.isCompleted) {
      completer.complete();
    }
  }

  Future<void> _previewCustomPattern(
    List<int> notes,
    List<double> durations,
  ) async {
    _finishPreview();
    final runId = ++_runId;
    _positionTimer?.cancel();
    await _invoke('stop');
    if (!mounted || runId != _runId) return;

    await _invoke('playSequence', {
      'sessionId': runId,
      'notes': notes,
      'durations': durations,
      'bpm': _bpm,
      'metronome': false,
      'volume': _volume,
    });
    if (!mounted || runId != _runId) return;

    final firstPos = await _invokeMap('position', {'sessionId': runId});
    if (!mounted || runId != _runId || firstPos == null) return;
    final firstState = firstPos['state'] as String?;
    if (firstState == 'completed' ||
        firstState == 'stopped' ||
        firstState == 'error' ||
        firstState == 'idle') {
      return;
    }

    final completer = Completer<void>();
    _previewCompleter = completer;
    final totalBeats = durations.fold<double>(0, (sum, d) => sum + d);
    final maxPreviewMs = ((totalBeats * 60000 / (_bpm > 0 ? _bpm : 80)) + 15000)
        .round()
        .clamp(5000, 120000);
    var elapsedMs = 0;
    var inFlight = false;

    _previewPollTimer = Timer.periodic(
      const Duration(milliseconds: 50),
      (timer) async {
        elapsedMs += 50;
        if (!mounted || runId != _runId || elapsedMs >= maxPreviewMs) {
          if (_previewPollTimer == timer) {
            _finishPreview();
          } else {
            timer.cancel();
          }
          return;
        }
        if (inFlight) return;
        inFlight = true;
        try {
          final pos = await _invokeMap('position', {'sessionId': runId});
          if (!mounted || runId != _runId || pos == null) {
            if (_previewPollTimer == timer) {
              _finishPreview();
            } else {
              timer.cancel();
            }
            return;
          }
          final state = pos['state'] as String?;
          if (state == 'completed' ||
              state == 'stopped' ||
              state == 'error' ||
              state == 'idle') {
            if (_previewPollTimer == timer) {
              _finishPreview();
            } else {
              timer.cancel();
            }
          }
        } finally {
          inFlight = false;
        }
      },
    );

    await completer.future;
  }

  void _startPositionPolling(int runId) {
    _positionTimer?.cancel();
    var inFlight = false;
    _positionTimer = Timer.periodic(const Duration(milliseconds: 50), (
      timer,
    ) async {
      if (!mounted || runId != _runId || !_playing) {
        timer.cancel();
        return;
      }
      if (_paused || inFlight) return;
      inFlight = true;
      final pollEpoch = _transportEpoch;

      try {
        final pos = await _invokeMap('position', {'sessionId': runId});
        if (!mounted ||
            runId != _runId ||
            pollEpoch != _transportEpoch ||
            !_playing ||
            _paused ||
            pos == null) {
          return;
        }

        final state = pos['state'] as String?;
        final playedFrames = (pos['playedFrames'] as num?)?.toInt() ?? 0;
        final sampleRate = (pos['sampleRate'] as num?)?.toInt() ?? 44100;

        if (state == 'paused' && !_paused) {
          setState(() => _paused = true);
          return;
        }

        if (state == 'completed' || state == 'stopped' || state == 'error') {
          timer.cancel();
          setState(() {
            _playing = false;
            _paused = false;
            _ready = false;
            _completed = state == 'completed';
            _activeNote = null;
            _stepTranspose = 0;
          });
          return;
        }

        if (sampleRate > 0) {
          final seconds = playedFrames / sampleRate;
          _updateActiveFromSeconds(seconds);
        }
      } finally {
        inFlight = false;
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
          _stepTranspose = newStep;
          _activeNote = newNote;
          _monitorSignal.ping();
        }
        return;
      }
      elapsed += stepDur;
    }
  }

  Future<void> _pause() async {
    if (!_playing || !_ready || _paused) return;
    _transportEpoch++;
    setState(() => _paused = true);
    await _invoke('pause', {'sessionId': _runId});
  }

  Future<void> _resume() async {
    if (!_playing || !_ready || !_paused) return;
    _transportEpoch++;
    setState(() => _paused = false);
    await _invoke('resume', {'sessionId': _runId});
  }

  Future<void> _stop({bool notifyUi = true}) async {
    final prevRunId = _runId;
    _runId++;
    _transportEpoch++;
    _positionTimer?.cancel();
    _positionTimer = null;
    _finishPreview();
    if (notifyUi && mounted) {
      setState(() {
        _playing = false;
        _paused = false;
        _ready = false;
        _completed = false;
        _activeNote = null;
        _stepTranspose = 0;
      });
    } else {
      _completed = false;
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
        if (_midiLow != confirmed.$1 || _midiHigh != confirmed.$2) {
          _completed = false;
        }
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
            setState(() {
              _selectedExerciseId = updated.id;
              _completed = false;
            });
          }
        } else {
          final created = await notifier.createExercise(draft);
          if (mounted) {
            setState(() {
              _selectedExerciseId = created.id;
              _completed = false;
            });
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
        setState(() {
          _selectedExerciseId = vocalExercises.first.id;
          _completed = false;
        });
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
    _volumePersistTimer?.cancel();
    _stop(notifyUi: false);
    _monitorSignal.dispose();
    _volumeSignal.dispose();
    super.dispose();
  }

  void _updateVolume(double nextValue, {bool persistImmediately = false}) {
    final clamped = nextValue.isFinite ? nextValue.clamp(0.0, 1.0) : 1.0;
    if (clamped > 0.02) {
      _lastNonZeroVolume = clamped;
    }
    _volume = clamped;
    _volumeSignal.ping();
    unawaited(_invoke('setVolume', {'volume': clamped}));
    _volumePersistTimer?.cancel();
    final targetUserId = _hydratedUserId;
    if (persistImmediately) {
      unawaited(_persistVolume(clamped, userId: targetUserId));
    } else {
      _volumePersistTimer = Timer(const Duration(milliseconds: 120), () {
        unawaited(_persistVolume(clamped, userId: targetUserId));
      });
    }
  }

  Future<void> _persistVolume(double volume, {String? userId}) async {
    try {
      final prefs = ref.read(preferencesStorageProvider);
      await prefs.setVocalPlayerVolume(volume, userId: userId);
    } catch (_) {}
  }

  void _toggleMute() {
    if (_volume <= 0.001) {
      final restored = _lastNonZeroVolume > 0.02 ? _lastNonZeroVolume : 0.7;
      _updateVolume(restored, persistImmediately: true);
    } else {
      _updateVolume(0.0, persistImmediately: true);
    }
  }

  _VocalMonitorStatus get _monitorStatus {
    if (_playing && _paused) return _VocalMonitorStatus.paused;
    if (_playing) return _VocalMonitorStatus.playing;
    if (_completed) return _VocalMonitorStatus.completed;
    return _VocalMonitorStatus.ready;
  }

  Widget _buildNoteDropdown({
    required BuildContext context,
    required Key fieldKey,
    required String label,
    required int value,
    required List<SelectableVocalNote> notes,
    required ValueChanged<int?>? onChanged,
  }) {
    final theme = Theme.of(context);
    final disabledTextColor = theme.colorScheme.onSurface.withValues(alpha: 0.78);
    return InputDecorator(
      decoration: InputDecoration(
        labelText: label,
        labelStyle: TextStyle(
          color: onChanged == null
              ? disabledTextColor
              : theme.colorScheme.onSurfaceVariant,
        ),
        border: const OutlineInputBorder(),
        enabledBorder: OutlineInputBorder(
          borderSide: BorderSide(
            color: theme.colorScheme.outline.withValues(
              alpha: onChanged == null ? 0.45 : 0.9,
            ),
          ),
        ),
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 10,
        ),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<int>(
          key: fieldKey,
          value: notes.any((n) => n.midi == value) ? value : notes.first.midi,
          isExpanded: true,
          isDense: true,
          iconEnabledColor: theme.colorScheme.onSurfaceVariant,
          iconDisabledColor: disabledTextColor,
          style: theme.textTheme.bodyMedium?.copyWith(
            color: onChanged == null
                ? disabledTextColor
                : theme.colorScheme.onSurface,
            fontWeight: FontWeight.w600,
          ),
          items: [
            for (final note in notes)
              DropdownMenuItem(
                value: note.midi,
                child: Text(note.label),
              ),
          ],
          onChanged: onChanged,
        ),
      ),
    );
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

    final leftCards = <Widget>[
      // 1. Collapsible Visual Exercise Library (M21-UX1)
      RepaintBoundary(
        child: VocalExerciseLibrary(
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
            setState(() {
              _selectedExerciseId = selected.id;
              _completed = false;
            });
          },
          onCreateCustom: () =>
              _openCustomModal(CustomExerciseEditorMode.create),
          onEditCustom: (target) =>
              _openCustomModal(CustomExerciseEditorMode.edit, target),
          onDuplicateExercise: (target) =>
              _openCustomModal(CustomExerciseEditorMode.duplicate, target),
          onDeleteCustom: _confirmDeleteCustomExercise,
        ),
      ),
      const SizedBox(height: 12),

      // 2. Scoped Real-Time Active Note Monitor & Optional Synchronized Keyboard
      RepaintBoundary(
        child: AnimatedBuilder(
          animation: _monitorSignal,
          builder: (context, _) {
            final focusNotes = exercise.notesAt(_stepTranspose);
            return Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _VocalNoteMonitorCard(
                  exercise: exercise,
                  bpm: _bpm,
                  metronome: _metronome,
                  status: _monitorStatus,
                  ready: _ready,
                  stepTranspose: _stepTranspose,
                  activeNote: _activeNote,
                  minTranspose: minT,
                  maxTranspose: maxT,
                  showKeyboard: _showKeyboard,
                  onToggleKeyboard: () {
                    setState(() => _showKeyboard = !_showKeyboard);
                  },
                ),
                if (_showKeyboard) ...[
                  const SizedBox(height: 12),
                  PianoKeyboard(
                    activeNote: _activeNote != null && _activeNote! >= 0
                        ? _activeNote
                        : null,
                    minMidi: supportedPianoMinMidi,
                    maxMidi: supportedPianoMaxMidi,
                    initialFocusMidi: focusNotes.isNotEmpty
                        ? focusNotes.first
                        : 60,
                  ),
                ],
              ],
            );
          },
        ),
      ),
      const SizedBox(height: 12),
    ];

    final rightCards = <Widget>[
      // 3. Tempo (BPM) & Metronome Card
      RepaintBoundary(
        child: _VocalTempoCard(
          bpm: _bpm,
          bpmPresets: _bpmPresets,
          metronome: _metronome,
          locked: _playing,
          onSelectBpm: (nextBpm) => setState(() {
            _bpm = nextBpm;
            _completed = false;
          }),
          onToggleMetronome: (val) => setState(() {
            _metronome = val;
            _completed = false;
          }),
        ),
      ),
      const SizedBox(height: 12),

      // 4. Vocal Range (Musical Notes) & Persistence Card
      RepaintBoundary(
        child: _VocalRangeCard(
          midiLow: _midiLow,
          midiHigh: _midiHigh,
          locked: _playing,
          isAuthenticated: authState.isAuthenticated,
          isSavingRange: _isSavingRange,
          rangeFeedbackMessage: _rangeFeedbackMessage,
          rangeFeedbackIsError: _rangeFeedbackIsError,
          fitsSelectedRange: fitsSelectedRange,
          onSelectPreset: (preset) {
            setState(() {
              _midiLow = preset.minMidi;
              _midiHigh = preset.maxMidi;
              _rangeFeedbackMessage = null;
              _completed = false;
            });
          },
          onSaveRange: _saveVocalRange,
          minDropdownBuilder: (ctx) => _buildNoteDropdown(
            context: ctx,
            fieldKey: const ValueKey('vocal_min_note_dropdown'),
            label: 'Mais grave',
            value: _midiLow,
            notes: [
              for (final note in selectableVocalNotes)
                if (note.midi < supportedPianoMaxMidi) note,
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
                      _completed = false;
                    });
                  },
          ),
          maxDropdownBuilder: (ctx) => _buildNoteDropdown(
            context: ctx,
            fieldKey: const ValueKey('vocal_max_note_dropdown'),
            label: 'Mais aguda',
            value: _midiHigh,
            notes: [
              for (final note in selectableVocalNotes)
                if (note.midi > supportedPianoMinMidi) note,
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
                      _completed = false;
                    });
                  },
          ),
        ),
      ),
      const SizedBox(height: 12),

      // 5. Progression Direction Card
      RepaintBoundary(
        child: _VocalProgressionCard(
          minTranspose: minT,
          maxTranspose: maxT,
          ascending: _ascending,
          locked: _playing,
          onSelectDirection: (nextAsc) => setState(() {
            _ascending = nextAsc;
            _completed = false;
          }),
        ),
      ),
      const SizedBox(height: 12),
    ];

    final mediaQuery = MediaQuery.of(context);
    final rawKeyboardInset = mediaQuery.viewInsets.bottom;
    final effectiveKeyboardLift = math.min(
      rawKeyboardInset,
      mediaQuery.size.height,
    );
    final availableForAppAndBar = math.max(
      0.0,
      mediaQuery.size.height - mediaQuery.padding.top - kToolbarHeight,
    );
    final remainingAboveKeyboard = math.max(
      0.0,
      availableForAppAndBar - effectiveKeyboardLift,
    );
    final maxBarContentHeight = rawKeyboardInset > 0
        ? remainingAboveKeyboard
        : math.max(96.0, availableForAppAndBar);

    return Scaffold(
      appBar: AppBar(title: const Text('Aquecimento vocal')),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1000),
          child: SingleChildScrollView(
            key: const ValueKey('vocal_main_scroll_view'),
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            child: LayoutBuilder(
              builder: (context, constraints) {
                final isWide = constraints.maxWidth >= 840;
                if (isWide) {
                  return Row(
                    key: const ValueKey('vocal_tablet_two_column_layout'),
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        flex: 6,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: leftCards,
                        ),
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        flex: 5,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: rightCards,
                        ),
                      ),
                    ],
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [...leftCards, ...rightCards],
                );
              },
            ),
          ),
        ),
      ),
      bottomNavigationBar: _VocalBottomPlaybackBar(
        theme: theme,
        keyboardLift: effectiveKeyboardLift,
        maxBarContentHeight: maxBarContentHeight,
        bottomSystemPadding: rawKeyboardInset > 0
            ? 0.0
            : mediaQuery.padding.bottom,
        status: _monitorStatus,
        playing: _playing,
        paused: _paused,
        ready: _ready,
        volumeSignal: _volumeSignal,
        readVolume: () => _volume,
        onVolumeChanged: _updateVolume,
        onVolumeChangeEnd: (val) =>
            _updateVolume(val, persistImmediately: true),
        onToggleMute: _toggleMute,
        onStart: () => _play(exercise),
        onPauseOrResume: _paused ? _resume : _pause,
        onStop: () => _stop(),
      ),
    );
  }
}

class _UiSignal extends ChangeNotifier {
  void ping() => notifyListeners();
}

enum _VocalMonitorStatus { ready, playing, paused, completed }

class _VocalNoteMonitorCard extends StatelessWidget {
  final VocalExercise exercise;
  final int bpm;
  final bool metronome;
  final _VocalMonitorStatus status;
  final bool ready;
  final int stepTranspose;
  final int? activeNote;
  final int minTranspose;
  final int maxTranspose;
  final bool showKeyboard;
  final VoidCallback onToggleKeyboard;

  const _VocalNoteMonitorCard({
    required this.exercise,
    required this.bpm,
    required this.metronome,
    required this.status,
    required this.ready,
    required this.stepTranspose,
    required this.activeNote,
    required this.minTranspose,
    required this.maxTranspose,
    required this.showKeyboard,
    required this.onToggleKeyboard,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final (statusLabel, statusIcon, pillBg, pillFg, pillBorder) =
        switch (status) {
          _VocalMonitorStatus.playing => (
            'Tocando',
            Icons.graphic_eq,
            isDark ? const Color(0xFF1A3A2C) : const Color(0xFFE1EFE8),
            isDark ? const Color(0xFF7CC4A4) : const Color(0xFF145A3A),
            isDark ? const Color(0xFF7CC4A4) : const Color(0xFF145A3A),
          ),
          _VocalMonitorStatus.paused => (
            'Pausa',
            Icons.pause_circle_outline,
            isDark ? const Color(0xFF3E2914) : const Color(0xFFFEF3E2),
            isDark ? const Color(0xFFF5B874) : const Color(0xFF92400E),
            isDark ? const Color(0xFFF5B874) : const Color(0xFFD97706),
          ),
          _VocalMonitorStatus.completed => (
            'Concluído',
            Icons.check_circle_outline,
            isDark ? const Color(0xFF17362A) : const Color(0xFFE6F4EA),
            isDark ? const Color(0xFF7CC4A4) : const Color(0xFF0F5132),
            isDark ? const Color(0xFF529E7D) : const Color(0xFF198754),
          ),
          _VocalMonitorStatus.ready => (
            'Pronto',
            Icons.music_note_outlined,
            theme.colorScheme.surfaceContainerHighest,
            theme.colorScheme.onSurfaceVariant,
            theme.dividerColor.withValues(alpha: 0.45),
          ),
        };

    final displayBg = switch (status) {
      _VocalMonitorStatus.playing => theme.colorScheme.primaryContainer
          .withValues(alpha: isDark ? 0.45 : 0.35),
      _VocalMonitorStatus.paused =>
        Colors.amber.withValues(alpha: isDark ? 0.14 : 0.12),
      _VocalMonitorStatus.completed => theme.colorScheme.secondaryContainer
          .withValues(alpha: isDark ? 0.38 : 0.42),
      _VocalMonitorStatus.ready =>
        theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.6),
    };

    final displayBorder = switch (status) {
      _VocalMonitorStatus.playing =>
        theme.colorScheme.primary.withValues(alpha: 0.55),
      _VocalMonitorStatus.paused => pillBorder.withValues(alpha: 0.55),
      _VocalMonitorStatus.completed => pillBorder.withValues(alpha: 0.55),
      _VocalMonitorStatus.ready => theme.dividerColor.withValues(alpha: 0.3),
    };

    final String heroText;
    final String eyebrowText;
    final String captionText;
    final bool useLargeNoteTypography;

    if (status == _VocalMonitorStatus.playing ||
        status == _VocalMonitorStatus.paused) {
      eyebrowText = 'Nota atual:';
      if (activeNote == null) {
        heroText = ready ? '—' : 'Preparando...';
        captionText = 'Preparando piano acústico...';
        useLargeNoteTypography = false;
      } else if (activeNote! < 0) {
        heroText = 'Pausa musical';
        captionText = status == _VocalMonitorStatus.paused
            ? 'Reprodução pausada'
            : 'Respire antes da próxima transposição';
        useLargeNoteTypography = false;
      } else {
        heroText = midiLabel(activeNote!);
        captionText = status == _VocalMonitorStatus.paused
            ? 'Reprodução pausada'
            : 'Cante a nota em destaque';
        useLargeNoteTypography = true;
      }
    } else if (status == _VocalMonitorStatus.completed) {
      eyebrowText = 'Status da prática';
      heroText = 'Exercício concluído';
      captionText =
          'Progressão concluída (${midiLabel(60 + minTranspose)} a ${midiLabel(60 + maxTranspose)})';
      useLargeNoteTypography = false;
    } else {
      eyebrowText = 'Monitor vocal';
      heroText = 'Pronto para iniciar';
      captionText = 'Acompanhe a nota ativa pelo visor central';
      useLargeNoteTypography = false;
    }

    final semitoneLabel = stepTranspose >= 0
        ? '+$stepTranspose'
        : '$stepTranspose';
    final semanticSummary =
        status == _VocalMonitorStatus.playing ||
            status == _VocalMonitorStatus.paused
        ? '$statusLabel. Nota atual ${activeNote == null
              ? "preparando"
              : activeNote! < 0
              ? "pausa musical"
              : midiLabel(activeNote!)}. Tom atual ${midiLabel(60 + stepTranspose)}, $bpm batidas por minuto.'
        : '$statusLabel. $heroText. Tom base ${midiLabel(60 + stepTranspose)}, $bpm batidas por minuto.';

    return Card(
      key: const ValueKey('vocal_monitor_card'),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: theme.dividerColor.withValues(alpha: 0.25)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 8,
              children: [
                Container(
                  key: const ValueKey('vocal_monitor_status_pill'),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: pillBg,
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: pillBorder.withValues(alpha: 0.6)),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(statusIcon, size: 15, color: pillFg),
                      const SizedBox(width: 6),
                      Text(
                        statusLabel,
                        style: theme.textTheme.labelMedium?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: pillFg,
                        ),
                      ),
                    ],
                  ),
                ),
                Semantics(
                  button: true,
                  toggled: showKeyboard,
                  label: showKeyboard
                      ? 'Ocultar teclado de referência'
                      : 'Mostrar teclado de referência',
                  child: OutlinedButton.icon(
                    key: const ValueKey('vocal_toggle_keyboard_button'),
                    onPressed: onToggleKeyboard,
                    icon: Icon(
                      showKeyboard ? Icons.piano_off : Icons.piano,
                      size: 16,
                    ),
                    label: Text(
                      showKeyboard ? 'Ocultar teclado' : 'Mostrar teclado',
                    ),
                    style: OutlinedButton.styleFrom(
                      visualDensity: VisualDensity.compact,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              exercise.title,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
            if (exercise.description.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(
                exercise.description,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    'Tom atual: ${midiLabel(60 + stepTranspose)} ($semitoneLabel st)',
                    style: theme.textTheme.labelMedium?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (metronome) ...[
                        Icon(
                          Icons.av_timer_outlined,
                          size: 14,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 4),
                      ],
                      Text(
                        '$bpm BPM',
                        style: theme.textTheme.labelMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Semantics(
              container: true,
              liveRegion: true,
              label: semanticSummary,
              child: Container(
                key: const ValueKey('vocal_active_note_display'),
                constraints: const BoxConstraints(minHeight: 112),
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 16,
                ),
                decoration: BoxDecoration(
                  color: displayBg,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: displayBorder, width: 1.4),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text(
                      eyebrowText,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.labelMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      heroText,
                      key: const ValueKey('vocal_active_note_value'),
                      textAlign: TextAlign.center,
                      style: useLargeNoteTypography
                          ? theme.textTheme.displayMedium?.copyWith(
                              fontWeight: FontWeight.w900,
                              height: 1.05,
                              color: status == _VocalMonitorStatus.paused
                                  ? pillFg
                                  : theme.colorScheme.primary,
                            )
                          : theme.textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w800,
                              color: status == _VocalMonitorStatus.ready
                                  ? theme.colorScheme.onSurface
                                  : pillFg,
                            ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      captionText,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _VocalTempoCard extends StatelessWidget {
  final int bpm;
  final List<int> bpmPresets;
  final bool metronome;
  final bool locked;
  final ValueChanged<int> onSelectBpm;
  final ValueChanged<bool> onToggleMetronome;

  const _VocalTempoCard({
    required this.bpm,
    required this.bpmPresets,
    required this.metronome,
    required this.locked,
    required this.onSelectBpm,
    required this.onToggleMetronome,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final disabledFg = theme.colorScheme.onSurface.withValues(alpha: 0.72);
    return Card(
      key: const ValueKey('vocal_tempo_card'),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: theme.dividerColor.withValues(alpha: 0.25)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 6,
              children: [
                Text(
                  'Andamento: $bpm BPM',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (locked)
                  _LockedSettingBadge(theme: theme),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final preset in bpmPresets)
                  ChoiceChip(
                    key: ValueKey('vocal_bpm_preset_$preset'),
                    label: Text('$preset BPM'),
                    selected: bpm == preset,
                    showCheckmark: true,
                    selectedColor: locked
                        ? theme.colorScheme.primaryContainer
                            .withValues(alpha: 0.85)
                        : null,
                    side: BorderSide(
                      color: bpm == preset
                          ? theme.colorScheme.primary.withValues(
                              alpha: locked ? 0.65 : 1.0,
                            )
                          : theme.colorScheme.outlineVariant,
                    ),
                    labelStyle: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: bpm == preset
                          ? FontWeight.w700
                          : FontWeight.w500,
                      color: locked
                          ? (bpm == preset
                                ? theme.colorScheme.onPrimaryContainer
                                : disabledFg)
                          : (bpm == preset
                                ? theme.colorScheme.onPrimaryContainer
                                : theme.colorScheme.onSurface),
                    ),
                    onSelected: locked ? null : (_) => onSelectBpm(preset),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            Semantics(
              label: 'Ajustar andamento, $bpm batidas por minuto',
              slider: true,
              child: Slider(
                min: 40,
                max: 160,
                divisions: 24,
                value: bpm.toDouble(),
                label: '$bpm BPM',
                onChanged: locked ? null : (value) => onSelectBpm(value.round()),
              ),
            ),
            const Divider(height: 12),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              secondary: Icon(
                Icons.av_timer_outlined,
                color: locked
                    ? disabledFg
                    : (metronome
                          ? theme.colorScheme.primary
                          : theme.colorScheme.onSurfaceVariant),
              ),
              title: Text(
                'Metrônomo',
                style: theme.textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: locked ? disabledFg : theme.colorScheme.onSurface,
                ),
              ),
              subtitle: Text(
                metronome
                    ? 'Pulso sonoro ativo a cada tempo ($bpm BPM)'
                    : 'Desativado — apenas notas guia do piano',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: locked
                      ? disabledFg
                      : theme.colorScheme.onSurfaceVariant,
                ),
              ),
              value: metronome,
              onChanged: locked ? null : onToggleMetronome,
            ),
          ],
        ),
      ),
    );
  }
}

class _VocalRangeCard extends StatelessWidget {
  final int midiLow;
  final int midiHigh;
  final bool locked;
  final bool isAuthenticated;
  final bool isSavingRange;
  final String? rangeFeedbackMessage;
  final bool rangeFeedbackIsError;
  final bool fitsSelectedRange;
  final ValueChanged<VocalRangePreset> onSelectPreset;
  final VoidCallback onSaveRange;
  final WidgetBuilder minDropdownBuilder;
  final WidgetBuilder maxDropdownBuilder;

  const _VocalRangeCard({
    required this.midiLow,
    required this.midiHigh,
    required this.locked,
    required this.isAuthenticated,
    required this.isSavingRange,
    required this.rangeFeedbackMessage,
    required this.rangeFeedbackIsError,
    required this.fitsSelectedRange,
    required this.onSelectPreset,
    required this.onSaveRange,
    required this.minDropdownBuilder,
    required this.maxDropdownBuilder,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final disabledFg = theme.colorScheme.onSurface.withValues(alpha: 0.72);
    return Card(
      key: const ValueKey('vocal_range_card'),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: theme.dividerColor.withValues(alpha: 0.25)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 6,
              children: [
                Text(
                  'Extensão vocal: ${midiLabel(midiLow)} a ${midiLabel(midiHigh)}',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (locked) _LockedSettingBadge(theme: theme),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Selecione a nota mais grave e a nota mais aguda confortável.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final preset in vocalRangePresets)
                  Builder(
                    builder: (context) {
                      final isSelected =
                          midiLow == preset.minMidi &&
                          midiHigh == preset.maxMidi;
                      return ChoiceChip(
                        key: ValueKey('vocal_range_preset_${preset.id}'),
                        label: Text(
                          '${preset.label} (${preset.subtitle})',
                          softWrap: true,
                        ),
                        selected: isSelected,
                        showCheckmark: true,
                        selectedColor: locked
                            ? theme.colorScheme.primaryContainer
                                .withValues(alpha: 0.85)
                            : null,
                        side: BorderSide(
                          color: isSelected
                              ? theme.colorScheme.primary.withValues(
                                  alpha: locked ? 0.65 : 1.0,
                                )
                              : theme.colorScheme.outlineVariant,
                        ),
                        labelStyle: theme.textTheme.labelLarge?.copyWith(
                          fontWeight: isSelected
                              ? FontWeight.w700
                              : FontWeight.w500,
                          color: locked
                              ? (isSelected
                                    ? theme.colorScheme.onPrimaryContainer
                                    : disabledFg)
                              : (isSelected
                                    ? theme.colorScheme.onPrimaryContainer
                                    : theme.colorScheme.onSurface),
                        ),
                        onSelected: locked
                            ? null
                            : (_) => onSelectPreset(preset),
                      );
                    },
                  ),
              ],
            ),
            const SizedBox(height: 12),
            LayoutBuilder(
              builder: (context, constraints) {
                final scaledFont =
                    MediaQuery.textScalerOf(context).scale(14.0);
                final stackVertically =
                    constraints.maxWidth < 340 || scaledFont > 17.5;
                if (stackVertically) {
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      minDropdownBuilder(context),
                      const SizedBox(height: 10),
                      maxDropdownBuilder(context),
                    ],
                  );
                }
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(child: minDropdownBuilder(context)),
                    const SizedBox(width: 12),
                    Expanded(child: maxDropdownBuilder(context)),
                  ],
                );
              },
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
                  'A extensão selecionada (${midiLabel(midiLow)}–${midiLabel(midiHigh)}) é estreita demais para este exercício. Tocando apenas no tom central (Dó4).',
                  style: theme.textTheme.bodySmall?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: theme.brightness == Brightness.dark
                        ? Colors.amber.shade200
                        : Colors.amber.shade900,
                  ),
                ),
              ),
            ],
            if (isAuthenticated) ...[
              const SizedBox(height: 12),
              FilledButton.tonalIcon(
                key: const ValueKey('vocal_save_range_button'),
                onPressed: isSavingRange ? null : onSaveRange,
                icon: const Icon(Icons.bookmark_added_outlined, size: 18),
                label: Text(
                  isSavingRange ? 'Salvando...' : 'Salvar minha extensão',
                  textAlign: TextAlign.center,
                ),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(double.infinity, 48),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 12,
                  ),
                ),
              ),
            ],
            if (rangeFeedbackMessage != null) ...[
              const SizedBox(height: 8),
              Text(
                rangeFeedbackMessage!,
                key: const ValueKey('vocal_range_feedback_text'),
                style: theme.textTheme.bodySmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: rangeFeedbackIsError
                      ? theme.colorScheme.error
                      : theme.colorScheme.primary,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _VocalProgressionCard extends StatelessWidget {
  final int minTranspose;
  final int maxTranspose;
  final bool ascending;
  final bool locked;
  final ValueChanged<bool> onSelectDirection;

  const _VocalProgressionCard({
    required this.minTranspose,
    required this.maxTranspose,
    required this.ascending,
    required this.locked,
    required this.onSelectDirection,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      key: const ValueKey('vocal_progression_card'),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: theme.dividerColor.withValues(alpha: 0.25)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Wrap(
              alignment: WrapAlignment.spaceBetween,
              crossAxisAlignment: WrapCrossAlignment.center,
              spacing: 8,
              runSpacing: 6,
              children: [
                Text(
                  'Progressão por semitons (faixa efetiva: ${midiLabel(60 + minTranspose)} a ${midiLabel(60 + maxTranspose)})',
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if (locked) _LockedSettingBadge(theme: theme),
              ],
            ),
            const SizedBox(height: 10),
            LayoutBuilder(
              builder: (context, constraints) {
                final scaledFont =
                    MediaQuery.textScalerOf(context).scale(14.0);
                final sideBySide =
                    constraints.maxWidth >= 420 && scaledFont <= 16.8;
                final ascendingTile = _VocalProgressionOptionTile(
                  key: const ValueKey('vocal_progression_ascending'),
                  label: 'Subir semitom a semitom',
                  icon: Icons.trending_up,
                  selected: ascending,
                  enabled: !locked,
                  onTap: () => onSelectDirection(true),
                );
                final descendingTile = _VocalProgressionOptionTile(
                  key: const ValueKey('vocal_progression_descending'),
                  label: 'Descer semitom a semitom',
                  icon: Icons.trending_down,
                  selected: !ascending,
                  enabled: !locked,
                  onTap: () => onSelectDirection(false),
                );
                if (sideBySide) {
                  return Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: ascendingTile),
                      const SizedBox(width: 10),
                      Expanded(child: descendingTile),
                    ],
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    ascendingTile,
                    const SizedBox(height: 8),
                    descendingTile,
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _VocalProgressionOptionTile extends StatelessWidget {
  final String label;
  final IconData icon;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  const _VocalProgressionOptionTile({
    super.key,
    required this.label,
    required this.icon,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final bgColor = selected
        ? theme.colorScheme.primaryContainer.withValues(
            alpha: enabled ? 0.95 : 0.72,
          )
        : theme.colorScheme.surfaceContainerLow;
    final borderColor = selected
        ? theme.colorScheme.primary.withValues(alpha: enabled ? 1.0 : 0.65)
        : theme.colorScheme.outlineVariant.withValues(
            alpha: enabled ? 0.9 : 0.55,
          );
    final fgColor = selected
        ? theme.colorScheme.onPrimaryContainer
        : theme.colorScheme.onSurface.withValues(alpha: enabled ? 0.9 : 0.68);

    return Semantics(
      button: true,
      selected: selected,
      enabled: enabled,
      label: label,
      child: Material(
        color: bgColor,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(12),
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(
                color: borderColor,
                width: selected ? 1.6 : 1.0,
              ),
            ),
            child: Row(
              children: [
                Icon(icon, size: 18, color: fgColor),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    label,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                      color: fgColor,
                    ),
                  ),
                ),
                if (selected) ...[
                  const SizedBox(width: 6),
                  Icon(Icons.check_circle, size: 18, color: fgColor),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _LockedSettingBadge extends StatelessWidget {
  final ThemeData theme;

  const _LockedSettingBadge({required this.theme});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.lock_outline,
            size: 13,
            color: theme.colorScheme.onSurfaceVariant,
          ),
          const SizedBox(width: 4),
          Text(
            'Bloqueado durante execução',
            style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w600,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _VocalBottomPlaybackBar extends StatelessWidget {
  final ThemeData theme;
  final double keyboardLift;
  final double maxBarContentHeight;
  final double bottomSystemPadding;
  final _VocalMonitorStatus status;
  final bool playing;
  final bool paused;
  final bool ready;
  final Listenable volumeSignal;
  final double Function() readVolume;
  final ValueChanged<double> onVolumeChanged;
  final ValueChanged<double> onVolumeChangeEnd;
  final VoidCallback onToggleMute;
  final VoidCallback onStart;
  final VoidCallback onPauseOrResume;
  final VoidCallback onStop;

  const _VocalBottomPlaybackBar({
    required this.theme,
    required this.keyboardLift,
    required this.maxBarContentHeight,
    required this.bottomSystemPadding,
    required this.status,
    required this.playing,
    required this.paused,
    required this.ready,
    required this.volumeSignal,
    required this.readVolume,
    required this.onVolumeChanged,
    required this.onVolumeChangeEnd,
    required this.onToggleMute,
    required this.onStart,
    required this.onPauseOrResume,
    required this.onStop,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = theme.brightness == Brightness.dark;
    final barSurface = isDark
        ? theme.colorScheme.surfaceContainer
        : theme.colorScheme.surfaceContainerLow;
    final (footerStateLabel, stateColor) = switch (status) {
      _VocalMonitorStatus.playing => (
        ready ? 'Reprodução ativa' : 'Preparando áudio...',
        theme.colorScheme.primary,
      ),
      _VocalMonitorStatus.paused => (
        'Reprodução em pausa',
        isDark ? const Color(0xFFF5B874) : const Color(0xFFB45309),
      ),
      _VocalMonitorStatus.completed => (
        'Reprodução concluída',
        isDark ? const Color(0xFF7CC4A4) : const Color(0xFF145A3A),
      ),
      _VocalMonitorStatus.ready => (
        'Pronto para reproduzir',
        theme.colorScheme.onSurfaceVariant,
      ),
    };

    final volumeControl = AnimatedBuilder(
      animation: volumeSignal,
      builder: (context, _) {
        final volume = readVolume();
        final pct = (volume * 100).round();
        final isMuted = volume <= 0.001;
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(
                  isMuted
                      ? Icons.volume_off_outlined
                      : volume < 0.5
                      ? Icons.volume_down_outlined
                      : Icons.volume_up_outlined,
                  size: 18,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    'Volume interno: $pct%',
                    key: const ValueKey('vocal_volume_percent_text'),
                    style: theme.textTheme.labelLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                Semantics(
                  button: true,
                  label: isMuted
                      ? 'Reativar som interno do exercício'
                      : 'Silenciar som interno do exercício',
                  child: IconButton(
                    key: const ValueKey('vocal_volume_mute_button'),
                    onPressed: onToggleMute,
                    tooltip: isMuted ? 'Reativar som' : 'Silenciar',
                    visualDensity: VisualDensity.compact,
                    constraints: const BoxConstraints(
                      minWidth: 40,
                      minHeight: 40,
                    ),
                    icon: Icon(
                      isMuted ? Icons.volume_off : Icons.volume_up,
                      size: 20,
                      color: isMuted
                          ? theme.colorScheme.error
                          : theme.colorScheme.primary,
                    ),
                  ),
                ),
              ],
            ),
            Semantics(
              slider: true,
              label: 'Controle de volume interno',
              value: '$pct por cento',
              child: SliderTheme(
                data: SliderTheme.of(context).copyWith(
                  trackHeight: 4,
                  thumbShape: const RoundSliderThumbShape(
                    enabledThumbRadius: 8,
                  ),
                  overlayShape: const RoundSliderOverlayShape(
                    overlayRadius: 16,
                  ),
                ),
                child: Slider(
                  key: const ValueKey('vocal_volume_slider'),
                  min: 0.0,
                  max: 1.0,
                  divisions: 20,
                  value: volume,
                  label: '$pct%',
                  onChanged: onVolumeChanged,
                  onChangeEnd: onVolumeChangeEnd,
                ),
              ),
            ),
          ],
        );
      },
    );

    final transportBlock = Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Semantics(
          liveRegion: true,
          label: 'Estado da reprodução: $footerStateLabel',
          child: Row(
            key: const ValueKey('vocal_footer_status_badge'),
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: stateColor,
                ),
              ),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  footerStateLabel,
                  style: theme.textTheme.labelMedium?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: stateColor,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            FilledButton.icon(
              key: const ValueKey('vocal_start_button'),
              onPressed: playing ? null : onStart,
              icon: const Icon(Icons.play_arrow, size: 18),
              label: Text(
                playing
                    ? (paused ? 'Em pausa' : 'Tocando...')
                    : 'Iniciar exercício',
              ),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 44),
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 10,
                ),
              ),
            ),
            FilledButton.tonalIcon(
              key: const ValueKey('vocal_pause_resume_button'),
              onPressed: playing && ready ? onPauseOrResume : null,
              icon: Icon(paused ? Icons.play_arrow : Icons.pause, size: 18),
              label: Text(paused ? 'Retomar' : 'Pausar'),
              style: FilledButton.styleFrom(
                minimumSize: const Size(0, 44),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
              ),
            ),
            OutlinedButton.icon(
              key: const ValueKey('vocal_stop_button'),
              onPressed: playing ? onStop : null,
              icon: const Icon(Icons.stop, size: 18),
              label: const Text('Parar'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 44),
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
              ),
            ),
          ],
        ),
      ],
    );

    final maxTotalBarHeight = maxBarContentHeight + bottomSystemPadding;
    return Padding(
      padding: EdgeInsets.only(bottom: keyboardLift),
      child: Material(
        key: const ValueKey('vocal_bottom_playback_bar'),
        color: barSurface,
        elevation: maxTotalBarHeight > 1 ? 8 : 0,
        surfaceTintColor: Colors.transparent,
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxTotalBarHeight),
          child: Container(
            decoration: maxTotalBarHeight > 1
                ? BoxDecoration(
                    border: Border(
                      top: BorderSide(
                        color: theme.dividerColor.withValues(alpha: 0.35),
                      ),
                    ),
                  )
                : null,
            child: SafeArea(
              top: false,
              bottom: bottomSystemPadding > 0,
              minimum: EdgeInsets.only(bottom: bottomSystemPadding),
              child: SingleChildScrollView(
                physics: const ClampingScrollPhysics(),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 1000),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                      child: LayoutBuilder(
                        builder: (context, constraints) {
                          final isWideBar = constraints.maxWidth >= 720;
                          if (isWideBar) {
                            return Row(
                              crossAxisAlignment: CrossAxisAlignment.center,
                              children: [
                                Expanded(flex: 6, child: transportBlock),
                                const SizedBox(width: 16),
                                Expanded(flex: 4, child: volumeControl),
                              ],
                            );
                          }
                          return Column(
                            mainAxisSize: MainAxisSize.min,
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              volumeControl,
                              const SizedBox(height: 6),
                              transportBlock,
                            ],
                          );
                        },
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
