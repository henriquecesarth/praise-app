import 'package:flutter/material.dart';
import '../../../../core/errors/app_failure.dart';
import '../../data/vocal_exercise_repository.dart';
import '../../domain/vocal_exercise.dart';

enum CustomExerciseEditorMode { create, edit, duplicate }

class _NoteStepItem {
  int midi;
  double duration;

  _NoteStepItem({required this.midi, required this.duration});
}

class CustomExerciseEditorSheet extends StatefulWidget {
  final CustomExerciseEditorMode mode;
  final VocalExercise? initialExercise;
  final Future<void> Function(CustomVocalExerciseDraft draft) onSave;
  final Future<void> Function(List<int> notes, List<double> durations)?
  onPreviewPattern;
  final Future<void> Function()? onStopPreview;

  const CustomExerciseEditorSheet({
    super.key,
    required this.mode,
    this.initialExercise,
    required this.onSave,
    this.onPreviewPattern,
    this.onStopPreview,
  });

  static Future<bool?> show(
    BuildContext context, {
    required CustomExerciseEditorMode mode,
    VocalExercise? initialExercise,
    required Future<void> Function(CustomVocalExerciseDraft draft) onSave,
    Future<void> Function(List<int> notes, List<double> durations)?
    onPreviewPattern,
    Future<void> Function()? onStopPreview,
  }) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => CustomExerciseEditorSheet(
        mode: mode,
        initialExercise: initialExercise,
        onSave: onSave,
        onPreviewPattern: onPreviewPattern,
        onStopPreview: onStopPreview,
      ),
    );
  }

  @override
  State<CustomExerciseEditorSheet> createState() =>
      _CustomExerciseEditorSheetState();
}

class _CustomExerciseEditorSheetState extends State<CustomExerciseEditorSheet> {
  static const List<({double value, String label})> _durationOptions = [
    (value: 0.5, label: '0.5 tempo (Colcheia)'),
    (value: 0.75, label: '0.75 tempo'),
    (value: 1.0, label: '1 tempo (Semínima)'),
    (value: 1.25, label: '1.25 tempo'),
    (value: 1.5, label: '1.5 tempo'),
    (value: 2.0, label: '2 tempos (Mínima)'),
    (value: 2.5, label: '2.5 tempos'),
    (value: 3.0, label: '3 tempos'),
    (value: 4.0, label: '4 tempos (Semibreve)'),
  ];

  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late final List<_NoteStepItem> _steps;
  String _categoryOption = 'auto'; // 'auto' | 'ascendente' | 'descendente' | 'misto'
  bool _isSaving = false;
  bool _isPreviewing = false;
  int _previewGeneration = 0;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialExercise;
    final initialTitle = initial == null
        ? ''
        : widget.mode == CustomExerciseEditorMode.duplicate
        ? '${initial.title} (Cópia)'
        : initial.title;
    _titleController = TextEditingController(text: initialTitle);
    _descriptionController = TextEditingController(
      text: initial?.description ?? '',
    );
    _categoryOption = initial?.category.value ?? 'auto';

    if (initial != null && initial.notes.isNotEmpty) {
      _steps = [
        for (var i = 0; i < initial.notes.length; i++)
          _NoteStepItem(
            midi: initial.notes[i].clamp(
              supportedPianoMinMidi,
              supportedPianoMaxMidi,
            ),
            duration: i < initial.noteDurations.length
                ? initial.noteDurations[i]
                : 1.0,
          ),
      ];
    } else {
      _steps = [
        _NoteStepItem(midi: 60, duration: 1.0),
        _NoteStepItem(midi: 62, duration: 1.0),
        _NoteStepItem(midi: 64, duration: 1.0),
        _NoteStepItem(midi: 62, duration: 1.0),
        _NoteStepItem(midi: 60, duration: 2.0),
      ];
    }
  }

  @override
  void dispose() {
    _previewGeneration++;
    if (_isPreviewing && widget.onStopPreview != null) {
      widget.onStopPreview!();
    }
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  List<int> get _currentNotes => _steps.map((s) => s.midi).toList();
  List<double> get _currentDurations => _steps.map((s) => s.duration).toList();

  MelodicCategory get _detectedCategory =>
      MelodicCategory.detectFromNotes(_currentNotes);

  MelodicCategory get _effectiveCategory => _categoryOption == 'auto'
      ? _detectedCategory
      : MelodicCategory.fromString(_categoryOption);

  void _addNote() {
    if (_steps.length >= 64) return;
    final last = _steps.isNotEmpty
        ? _steps.last
        : _NoteStepItem(midi: 60, duration: 1.0);
    setState(() {
      _steps.add(_NoteStepItem(midi: last.midi, duration: 1.0));
      _errorMessage = null;
    });
  }

  void _removeNote(int index) {
    if (_steps.length <= 1) return;
    setState(() {
      _steps.removeAt(index);
      _errorMessage = null;
    });
  }

  void _moveNote(int index, int delta) {
    final target = index + delta;
    if (target < 0 || target >= _steps.length) return;
    setState(() {
      final item = _steps.removeAt(index);
      _steps.insert(target, item);
    });
  }

  Future<void> _togglePreview() async {
    if (widget.onPreviewPattern == null) return;
    final gen = ++_previewGeneration;
    if (_isPreviewing) {
      if (widget.onStopPreview != null) {
        await widget.onStopPreview!();
      }
      if (mounted && gen == _previewGeneration) {
        setState(() => _isPreviewing = false);
      }
      return;
    }
    setState(() {
      _isPreviewing = true;
      _errorMessage = null;
    });
    try {
      await widget.onPreviewPattern!(_currentNotes, _currentDurations);
    } catch (e) {
      if (mounted && gen == _previewGeneration) {
        setState(() {
          _errorMessage = e is AppFailure
              ? e.message
              : 'Não foi possível reproduzir a prévia.';
        });
      }
    } finally {
      if (mounted && gen == _previewGeneration) {
        setState(() => _isPreviewing = false);
      }
    }
  }

  Future<void> _submit() async {
    final trimmedTitle = _titleController.text.trim();
    if (trimmedTitle.isEmpty) {
      setState(() => _errorMessage = 'Informe um nome para o exercício.');
      return;
    }
    if (_steps.isEmpty) {
      setState(() => _errorMessage = 'Adicione pelo menos 1 nota ao exercício.');
      return;
    }

    setState(() {
      _isSaving = true;
      _errorMessage = null;
    });

    try {
      if (_isPreviewing && widget.onStopPreview != null) {
        await widget.onStopPreview!();
        _isPreviewing = false;
      }
      final draft = CustomVocalExerciseDraft(
        title: trimmedTitle,
        description: _descriptionController.text.trim(),
        notes: _currentNotes,
        noteDurations: _currentDurations,
        minTranspose: widget.initialExercise?.minTranspose ?? -12,
        maxTranspose: widget.initialExercise?.maxTranspose ?? 12,
        category: _effectiveCategory,
      );
      await widget.onSave(draft);
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSaving = false;
          _errorMessage = e is AppFailure
              ? e.message
              : 'Não foi possível salvar o exercício personalizado.';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final headerTitle = switch (widget.mode) {
      CustomExerciseEditorMode.edit => 'Editar exercício personalizado',
      CustomExerciseEditorMode.duplicate => 'Duplicar exercício',
      CustomExerciseEditorMode.create => 'Novo exercício personalizado',
    };

    return Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.88,
        minChildSize: 0.55,
        maxChildSize: 0.96,
        builder: (context, scrollController) {
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            headerTitle,
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          Text(
                            'Monte a sequência de notas base (será transposta na sua extensão vocal).',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () => Navigator.of(context).pop(false),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              Expanded(
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.all(16),
                  children: [
                    TextField(
                      key: const ValueKey('custom_exercise_title_input'),
                      controller: _titleController,
                      maxLength: 120,
                      decoration: const InputDecoration(
                        labelText: 'Nome do exercício *',
                        hintText: 'Ex: Tríade com Nona Descendente',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      key: const ValueKey('custom_exercise_description_input'),
                      controller: _descriptionController,
                      maxLength: 500,
                      decoration: const InputDecoration(
                        labelText: 'Descrição (opcional)',
                        hintText: 'Ex: Trabalhar vogal Ô suave na descida',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      key: const ValueKey('custom_exercise_category_dropdown'),
                      initialValue: _categoryOption,
                      decoration: const InputDecoration(
                        labelText: 'Direção melódica',
                        border: OutlineInputBorder(),
                        isDense: true,
                      ),
                      items: [
                        DropdownMenuItem(
                          value: 'auto',
                          child: Text(
                            'Automático (Detectado: ${_detectedCategory.label})',
                          ),
                        ),
                        const DropdownMenuItem(
                          value: 'ascendente',
                          child: Text('Ascendente'),
                        ),
                        const DropdownMenuItem(
                          value: 'descendente',
                          child: Text('Descendente'),
                        ),
                        const DropdownMenuItem(
                          value: 'misto',
                          child: Text('Misto (Sobe e Desce)'),
                        ),
                      ],
                      onChanged: (val) {
                        if (val == null) return;
                        setState(() => _categoryOption = val);
                      },
                    ),
                    const SizedBox(height: 16),
                    Wrap(
                      alignment: WrapAlignment.spaceBetween,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        Text(
                          'Sequência de notas (${_steps.length}/64)',
                          style: theme.textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            if (widget.onPreviewPattern != null)
                              OutlinedButton.icon(
                                key: const ValueKey(
                                  'custom_preview_audio_button',
                                ),
                                onPressed: _togglePreview,
                                icon: Icon(
                                  _isPreviewing ? Icons.stop : Icons.volume_up,
                                  size: 16,
                                ),
                                label: Text(
                                  _isPreviewing
                                      ? 'Parar prévia'
                                      : 'Ouvir prévia',
                                ),
                                style: OutlinedButton.styleFrom(
                                  visualDensity: VisualDensity.compact,
                                ),
                              ),
                            FilledButton.tonalIcon(
                              key: const ValueKey('custom_add_note_button'),
                              onPressed: _steps.length >= 64 ? null : _addNote,
                              icon: const Icon(Icons.add, size: 16),
                              label: const Text('Adicionar nota'),
                              style: FilledButton.styleFrom(
                                visualDensity: VisualDensity.compact,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary.withValues(
                          alpha: 0.08,
                        ),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        'Padrão: ${_steps.map((s) => midiLabel(s.midi)).join(" → ")}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    for (var index = 0; index < _steps.length; index++)
                      _buildNoteStepRow(context, index),
                    if (_errorMessage != null) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: theme.colorScheme.errorContainer,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          _errorMessage!,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onErrorContainer,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const Divider(height: 1),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 14),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: _isSaving
                          ? null
                          : () => Navigator.of(context).pop(false),
                      child: const Text('Cancelar'),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      key: const ValueKey('custom_save_exercise_button'),
                      onPressed: _isSaving ? null : _submit,
                      child: Text(
                        _isSaving ? 'Salvando...' : 'Salvar exercício',
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildNoteStepRow(BuildContext context, int index) {
    final theme = Theme.of(context);
    final step = _steps[index];
    final hasDurationOption = _durationOptions.any(
      (opt) => opt.value == step.duration,
    );
    final durationItems = [
      ..._durationOptions,
      if (!hasDurationOption)
        (value: step.duration, label: '${step.duration} tempo(s)'),
    ];

    return Container(
      key: ValueKey('custom_note_row_$index'),
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.dividerColor.withValues(alpha: 0.2)),
      ),
      child: Row(
        children: [
          SizedBox(
            width: 26,
            child: Text(
              '#${index + 1}',
              style: theme.textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.w800,
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            flex: 2,
            child: DropdownButtonFormField<int>(
              key: ValueKey('custom_note_midi_$index'),
              initialValue: step.midi,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Nota',
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 8,
                ),
                border: OutlineInputBorder(),
              ),
              items: [
                for (final note in selectableVocalNotes)
                  DropdownMenuItem(
                    value: note.midi,
                    child: Text(
                      note.label,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (val) {
                if (val == null) return;
                setState(() => step.midi = val);
              },
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            flex: 3,
            child: DropdownButtonFormField<double>(
              key: ValueKey('custom_note_duration_$index'),
              initialValue: step.duration,
              isExpanded: true,
              decoration: const InputDecoration(
                labelText: 'Duração',
                isDense: true,
                contentPadding: EdgeInsets.symmetric(
                  horizontal: 8,
                  vertical: 8,
                ),
                border: OutlineInputBorder(),
              ),
              items: [
                for (final opt in durationItems)
                  DropdownMenuItem(
                    value: opt.value,
                    child: Text(
                      opt.label,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12.5),
                    ),
                  ),
              ],
              onChanged: (val) {
                if (val == null) return;
                setState(() => step.duration = val);
              },
            ),
          ),
          const SizedBox(width: 4),
          IconButton(
            tooltip: 'Mover para cima',
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.keyboard_arrow_up, size: 18),
            onPressed: index == 0 ? null : () => _moveNote(index, -1),
          ),
          IconButton(
            tooltip: 'Mover para baixo',
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.keyboard_arrow_down, size: 18),
            onPressed: index == _steps.length - 1
                ? null
                : () => _moveNote(index, 1),
          ),
          IconButton(
            key: ValueKey('custom_remove_note_$index'),
            tooltip: 'Remover nota',
            visualDensity: VisualDensity.compact,
            icon: Icon(
              Icons.close,
              size: 18,
              color: _steps.length <= 1
                  ? theme.disabledColor
                  : theme.colorScheme.error,
            ),
            onPressed: _steps.length <= 1 ? null : () => _removeNote(index),
          ),
        ],
      ),
    );
  }
}
