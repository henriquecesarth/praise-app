import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../domain/artist.dart';
import '../../domain/song_detail.dart';
import '../../domain/song_form_data.dart';

/// Screen for creating and editing repertoire songs in LouvAIO Mobile.
///
/// Supports phone and tablet responsive layouts, key selector chips,
/// artist selection and quick-creation, classification tagging,
/// unsaved changes discard guard, and multi-tenant isolation.
class SongFormScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final SongDetail? initialSong;

  const SongFormScreen({
    super.key,
    required this.ministryId,
    this.initialSong,
  });

  bool get isEditing => initialSong != null;

  @override
  ConsumerState<SongFormScreen> createState() => _SongFormScreenState();
}

class _SongFormScreenState extends ConsumerState<SongFormScreen> {
  final _formKey = GlobalKey<FormState>();

  late final TextEditingController _titleController;
  late final TextEditingController _bpmController;
  late final TextEditingController _durationController;
  late final TextEditingController _lyricsController;
  late final TextEditingController _youtubeUrlController;
  late final TextEditingController _audioUrlController;
  late final TextEditingController _chordSheetUrlController;
  late final TextEditingController _notesController;

  String? _selectedKey;
  String? _selectedArtistId;
  String? _selectedClassificationId;
  String? _boundUserId;
  bool _isSaved = false;
  bool _isForcedDismiss = false;

  static const List<String> _musicalKeys = [
    'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F',
    'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
  ];

  @override
  void initState() {
    super.initState();
    final init = widget.initialSong;

    _titleController = TextEditingController(text: init?.title ?? '');
    _bpmController = TextEditingController(
      text: init?.bpm != null ? init!.bpm.toString() : '',
    );
    _durationController = TextEditingController(text: init?.duration ?? '');
    _lyricsController = TextEditingController(text: init?.lyrics ?? '');
    _youtubeUrlController = TextEditingController(text: init?.youtubeUrl ?? '');
    _audioUrlController = TextEditingController(text: init?.audioUrl ?? '');
    _chordSheetUrlController =
        TextEditingController(text: init?.chordSheetUrl ?? '');
    _notesController = TextEditingController(text: init?.notes ?? '');

    _selectedKey = init?.originalKey;
    _selectedArtistId = init?.artistId;
    _selectedClassificationId = init?.classificationId;

    _titleController.addListener(_onFieldChanged);
    _bpmController.addListener(_onFieldChanged);
    _durationController.addListener(_onFieldChanged);
    _lyricsController.addListener(_onFieldChanged);
    _youtubeUrlController.addListener(_onFieldChanged);
    _audioUrlController.addListener(_onFieldChanged);
    _chordSheetUrlController.addListener(_onFieldChanged);
    _notesController.addListener(_onFieldChanged);

    final currentUserId = ref.read(authNotifierProvider).user?.id ?? '';
    _boundUserId = currentUserId.isNotEmpty ? currentUserId : null;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(songFormNotifierProvider.notifier).init(
            ministryId: widget.ministryId,
            boundUserId: currentUserId,
            initialSong: widget.initialSong,
          );
    });
  }

  void _forceDismiss() {
    if (_isForcedDismiss) return;
    _isForcedDismiss = true;
    ref.read(songFormNotifierProvider.notifier).invalidateTenant();
    _clearDraftControllers();
    if (mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  void _clearDraftControllers() {
    _titleController.clear();
    _bpmController.clear();
    _durationController.clear();
    _lyricsController.clear();
    _youtubeUrlController.clear();
    _audioUrlController.clear();
    _chordSheetUrlController.clear();
    _notesController.clear();
    _selectedKey = null;
    _selectedArtistId = null;
    _selectedClassificationId = null;
  }

  void _onFieldChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _titleController.removeListener(_onFieldChanged);
    _bpmController.removeListener(_onFieldChanged);
    _durationController.removeListener(_onFieldChanged);
    _lyricsController.removeListener(_onFieldChanged);
    _youtubeUrlController.removeListener(_onFieldChanged);
    _audioUrlController.removeListener(_onFieldChanged);
    _chordSheetUrlController.removeListener(_onFieldChanged);
    _notesController.removeListener(_onFieldChanged);

    _titleController.dispose();
    _bpmController.dispose();
    _durationController.dispose();
    _lyricsController.dispose();
    _youtubeUrlController.dispose();
    _audioUrlController.dispose();
    _chordSheetUrlController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  bool get _isDirty {
    final init = widget.initialSong;
    if (init == null) {
      return _titleController.text.trim().isNotEmpty ||
          _lyricsController.text.trim().isNotEmpty ||
          _bpmController.text.trim().isNotEmpty ||
          _durationController.text.trim().isNotEmpty ||
          _youtubeUrlController.text.trim().isNotEmpty ||
          _audioUrlController.text.trim().isNotEmpty ||
          _chordSheetUrlController.text.trim().isNotEmpty ||
          _notesController.text.trim().isNotEmpty ||
          _selectedKey != null ||
          _selectedArtistId != null ||
          _selectedClassificationId != null;
    }

    return _titleController.text.trim() != init.title.trim() ||
        _lyricsController.text.trim() != (init.lyrics ?? '').trim() ||
        _bpmController.text.trim() != (init.bpm?.toString() ?? '') ||
        _durationController.text.trim() != (init.duration ?? '').trim() ||
        _youtubeUrlController.text.trim() != (init.youtubeUrl ?? '').trim() ||
        _audioUrlController.text.trim() != (init.audioUrl ?? '').trim() ||
        _chordSheetUrlController.text.trim() !=
            (init.chordSheetUrl ?? '').trim() ||
        _notesController.text.trim() != (init.notes ?? '').trim() ||
        _selectedKey != init.originalKey ||
        _selectedArtistId != init.artistId ||
        _selectedClassificationId != init.classificationId;
  }

  Future<bool> _showDiscardDialog(BuildContext context) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Descartar alterações?'),
        content: const Text(
          'Existem alterações não salvas. Se sair agora, todas as modificações serão perdidas.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('discard_dialog_cancel_button'),
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Continuar editando'),
          ),
          FilledButton(
            key: const ValueKey('discard_dialog_confirm_button'),
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final formData = SongFormData(
      title: _titleController.text.trim(),
      artistId: _selectedArtistId,
      classificationId: _selectedClassificationId,
      originalKey: _selectedKey,
      bpm: _bpmController.text.trim().isNotEmpty
          ? int.tryParse(_bpmController.text.trim())
          : null,
      duration: _durationController.text.trim().isNotEmpty
          ? _durationController.text.trim()
          : null,
      lyrics: _lyricsController.text.trim().isNotEmpty
          ? _lyricsController.text.trim()
          : null,
      youtubeUrl: _youtubeUrlController.text.trim().isNotEmpty
          ? _youtubeUrlController.text.trim()
          : null,
      audioUrl: _audioUrlController.text.trim().isNotEmpty
          ? _audioUrlController.text.trim()
          : null,
      chordSheetUrl: _chordSheetUrlController.text.trim().isNotEmpty
          ? _chordSheetUrlController.text.trim()
          : null,
      externalLinks: {
        if (_notesController.text.trim().isNotEmpty)
          'notes': _notesController.text.trim(),
      },
    );

    final notifier = ref.read(songFormNotifierProvider.notifier);
    final result = widget.isEditing
        ? await notifier.updateSong(widget.initialSong!.id, formData)
        : await notifier.createSong(formData);

    if (!mounted || _isForcedDismiss) return;
    if (result.isDiscarded) return;

    if (result.isSuccess && result.data != null) {
      _isSaved = true;
      ref.invalidate(repertoireListNotifierProvider);
      ref.invalidate(songDetailNotifierProvider);

      Navigator.of(context).pop(result.data);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            widget.isEditing
                ? 'Música atualizada com sucesso!'
                : '${result.data!.title} foi cadastrada com sucesso!',
          ),
          backgroundColor: Theme.of(context).colorScheme.primary,
        ),
      );
    } else if (result.isFailure) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.errorMessage ?? 'Erro ao salvar música.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  Future<void> _openArtistPicker(List<Artist> artists) async {
    final searchController = TextEditingController();
    final messenger = ScaffoldMessenger.of(context);
    final errorColor = Theme.of(context).colorScheme.error;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetCtx) {
        return StatefulBuilder(
          builder: (ctx, setSheetState) {
            final query = searchController.text.toLowerCase().trim();
            final filtered = query.isEmpty
                ? artists
                : artists
                    .where((a) => a.name.toLowerCase().contains(query))
                    .toList();

            return DraggableScrollableSheet(
              initialChildSize: 0.7,
              minChildSize: 0.4,
              maxChildSize: 0.9,
              expand: false,
              builder: (_, scrollController) {
                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                      child: Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'Selecionar Artista',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () => Navigator.of(sheetCtx).pop(),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                      child: Row(
                        children: [
                          Expanded(
                            child: TextField(
                              controller: searchController,
                              decoration: InputDecoration(
                                hintText: 'Buscar artista...',
                                prefixIcon: const Icon(Icons.search, size: 20),
                                isDense: true,
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(12),
                                ),
                              ),
                              onChanged: (_) => setSheetState(() {}),
                            ),
                          ),
                          const SizedBox(width: 8),
                          FilledButton.icon(
                            onPressed: () async {
                              final nameController = TextEditingController(
                                text: searchController.text.trim(),
                              );
                              final newName = await showDialog<String>(
                                context: sheetCtx,
                                builder: (dlgCtx) => AlertDialog(
                                  title: const Text('Novo Artista'),
                                  content: TextField(
                                    controller: nameController,
                                    autofocus: true,
                                    decoration: const InputDecoration(
                                      labelText: 'Nome do Artista',
                                      hintText: 'ex: Diante do Trono',
                                    ),
                                  ),
                                  actions: [
                                    TextButton(
                                      onPressed: () =>
                                          Navigator.of(dlgCtx).pop(),
                                      child: const Text('Cancelar'),
                                    ),
                                    FilledButton(
                                      onPressed: () {
                                        final text = nameController.text.trim();
                                        if (text.isNotEmpty) {
                                          Navigator.of(dlgCtx).pop(text);
                                        }
                                      },
                                      child: const Text('Criar'),
                                    ),
                                  ],
                                ),
                              );

                              if (newName != null && newName.isNotEmpty) {
                                final res = await ref
                                    .read(songFormNotifierProvider.notifier)
                                    .quickCreateArtist(newName);

                                if (res.isSuccess && res.data != null) {
                                  setState(() {
                                    _selectedArtistId = res.data!.id;
                                  });
                                  if (sheetCtx.mounted) {
                                    Navigator.of(sheetCtx).pop();
                                  }
                                  messenger.showSnackBar(
                                    SnackBar(
                                      content: Text(
                                        'Artista "${res.data!.name}" criado com sucesso!',
                                      ),
                                    ),
                                  );
                                } else if (res.isFailure) {
                                  messenger.showSnackBar(
                                    SnackBar(
                                      content: Text(
                                        res.errorMessage ??
                                            'Erro ao criar artista.',
                                      ),
                                      backgroundColor: errorColor,
                                    ),
                                  );
                                }
                              }
                            },
                            icon: const Icon(Icons.add, size: 18),
                            label: const Text('Novo'),
                          ),
                        ],
                      ),
                    ),
                    const Divider(height: 16),
                    ListTile(
                      leading: const Icon(Icons.clear, color: Colors.grey),
                      title: const Text('Sem artista / Desvincular'),
                      selected: _selectedArtistId == null,
                      onTap: () {
                        setState(() {
                          _selectedArtistId = null;
                        });
                        Navigator.of(sheetCtx).pop();
                      },
                    ),
                    Expanded(
                      child: filtered.isEmpty
                          ? const Center(
                              child: Text('Nenhum artista encontrado.'),
                            )
                          : ListView.builder(
                              controller: scrollController,
                              itemCount: filtered.length,
                              itemBuilder: (ctx, index) {
                                final artist = filtered[index];
                                final isSelected =
                                    _selectedArtistId == artist.id;

                                return ListTile(
                                  title: Text(artist.name),
                                  trailing: isSelected
                                      ? Icon(
                                          Icons.check_circle,
                                          color: Theme.of(ctx)
                                              .colorScheme
                                              .primary,
                                        )
                                      : null,
                                  onTap: () {
                                    setState(() {
                                      _selectedArtistId = artist.id;
                                    });
                                    Navigator.of(sheetCtx).pop();
                                  },
                                );
                              },
                            ),
                    ),
                  ],
                );
              },
            );
          },
        );
      },
    );
  }

  String? _validateUrl(String? value) {
    if (value == null || value.trim().isEmpty) return null;
    final uri = Uri.tryParse(value.trim());
    if (uri == null || (!uri.isScheme('http') && !uri.isScheme('https'))) {
      return 'Informe uma URL válida iniciando com http:// ou https://';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    // Multi-tenant protection: auto-pop immediately if active ministry switches away
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null &&
          newMinistryId.isNotEmpty &&
          newMinistryId != widget.ministryId) {
        _forceDismiss();
      }
    });

    // Session switch protection: if active user changes away or logs out, close immediately
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      final currentUid = next.user?.id;
      final isUnauthenticated =
          !next.isAuthenticated || currentUid == null || currentUid.isEmpty;
      final userChanged = _boundUserId != null && currentUid != _boundUserId;
      if ((_boundUserId != null && isUnauthenticated) || userChanged) {
        _forceDismiss();
      }
    });

    final formState = ref.watch(songFormNotifierProvider);
    final theme = Theme.of(context);

    // Resolve selected artist name
    String artistLabel = 'Nenhum artista selecionado';
    if (_selectedArtistId != null) {
      final found = formState.artists
          .where((a) => a.id == _selectedArtistId)
          .firstOrNull;
      if (found != null) {
        artistLabel = found.name;
      } else if (widget.initialSong?.artistName != null &&
          widget.initialSong?.artistId == _selectedArtistId) {
        artistLabel = widget.initialSong!.artistName!;
      }
    }

    return PopScope(
      canPop: _isForcedDismiss || _isSaved || !_isDirty || formState.isSubmitting,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (_isForcedDismiss) {
          if (Navigator.of(context).canPop()) {
            Navigator.of(context).pop();
          }
          return;
        }
        final shouldLeave = await _showDiscardDialog(context);
        if (shouldLeave && context.mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.isEditing ? 'Editar Música' : 'Nova Música'),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 8.0),
              child: FilledButton(
                key: const ValueKey('song_form_save_button'),
                onPressed: formState.isSubmitting ? null : _submit,
                child: formState.isSubmitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Salvar'),
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: formState.isLoadingRelations
              ? const Center(child: CircularProgressIndicator())
              : Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 760),
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20.0,
                        vertical: 16.0,
                      ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            // Title
                            TextFormField(
                              key: const ValueKey('song_title_input'),
                              controller: _titleController,
                              decoration: const InputDecoration(
                                labelText: 'Título da Música *',
                                hintText: 'ex: Porque Ele Vive',
                                border: OutlineInputBorder(),
                                prefixIcon: Icon(Icons.music_note),
                              ),
                              textCapitalization: TextCapitalization.sentences,
                              validator: (val) {
                                if (val == null || val.trim().isEmpty) {
                                  return 'O título é obrigatório';
                                }
                                if (val.trim().length > 255) {
                                  return 'O título deve ter no máximo 255 caracteres';
                                }
                                return null;
                              },
                            ),
                            const SizedBox(height: 16),

                            // Artist Selector Tile
                            Card(
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(12),
                                side: BorderSide(
                                  color: theme.dividerColor.withValues(alpha: 0.3),
                                ),
                              ),
                              child: ListTile(
                                key: const ValueKey('artist_picker_tile'),
                                leading: const Icon(Icons.person_outline),
                                title: const Text(
                                  'Artista',
                                  style: TextStyle(
                                    fontSize: 12,
                                    color: Colors.grey,
                                  ),
                                ),
                                subtitle: Text(
                                  artistLabel,
                                  style: TextStyle(
                                    fontWeight: _selectedArtistId != null
                                        ? FontWeight.bold
                                        : FontWeight.normal,
                                    fontSize: 15,
                                  ),
                                ),
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () =>
                                    _openArtistPicker(formState.artists),
                              ),
                            ),
                            const SizedBox(height: 16),

                            // Musical Key (Tom Original)
                            Text(
                              'Tom Original',
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                ChoiceChip(
                                  label: const Text('Sem tom'),
                                  selected: _selectedKey == null,
                                  onSelected: (selected) {
                                    if (selected) {
                                      setState(() => _selectedKey = null);
                                    }
                                  },
                                ),
                                ..._musicalKeys.map((key) {
                                  final isSelected = _selectedKey == key;
                                  return ChoiceChip(
                                    key: ValueKey('key_chip_$key'),
                                    label: Text(key),
                                    selected: isSelected,
                                    onSelected: (selected) {
                                      setState(() {
                                        _selectedKey = selected ? key : null;
                                      });
                                    },
                                  );
                                }),
                              ],
                            ),
                            const SizedBox(height: 20),

                            // BPM & Duration Row
                            Row(
                              children: [
                                Expanded(
                                  child: TextFormField(
                                    key: const ValueKey('song_bpm_input'),
                                    controller: _bpmController,
                                    keyboardType: TextInputType.number,
                                    decoration: const InputDecoration(
                                      labelText: 'BPM',
                                      hintText: 'ex: 72',
                                      border: OutlineInputBorder(),
                                      prefixIcon: Icon(Icons.speed),
                                    ),
                                    validator: (val) {
                                      if (val == null || val.trim().isEmpty) {
                                        return null;
                                      }
                                      final parsed = int.tryParse(val.trim());
                                      if (parsed == null ||
                                          parsed <= 0 ||
                                          parsed > 999) {
                                        return '1 a 999';
                                      }
                                      return null;
                                    },
                                  ),
                                ),
                                const SizedBox(width: 16),
                                Expanded(
                                  child: TextFormField(
                                    key: const ValueKey('song_duration_input'),
                                    controller: _durationController,
                                    decoration: const InputDecoration(
                                      labelText: 'Duração',
                                      hintText: 'ex: 04:30',
                                      border: OutlineInputBorder(),
                                      prefixIcon: Icon(Icons.timer_outlined),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 20),

                            // Classification Selector
                            Text(
                              'Classificação',
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 8),
                            if (formState.classifications.isEmpty)
                              Text(
                                'Nenhuma classificação cadastrada no ministério.',
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: Colors.grey,
                                ),
                              )
                            else
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  ChoiceChip(
                                    label: const Text('Nenhuma'),
                                    selected: _selectedClassificationId == null,
                                    onSelected: (selected) {
                                      if (selected) {
                                        setState(() =>
                                            _selectedClassificationId = null);
                                      }
                                    },
                                  ),
                                  ...formState.classifications.map((c) {
                                    final isSelected =
                                        _selectedClassificationId == c.id;
                                    Color? chipColor;
                                    if (c.color != null &&
                                        c.color!.startsWith('#') &&
                                        c.color!.length == 7) {
                                      try {
                                        chipColor = Color(int.parse(
                                            c.color!.substring(1),
                                            radix: 16) +
                                            0xFF000000);
                                      } catch (_) {}
                                    }

                                    return FilterChip(
                                      key: ValueKey('class_chip_${c.id}'),
                                      label: Text(c.name),
                                      selected: isSelected,
                                      avatar: chipColor != null
                                          ? CircleAvatar(
                                              backgroundColor: chipColor,
                                              radius: 6,
                                            )
                                          : null,
                                      onSelected: (selected) {
                                        setState(() {
                                          _selectedClassificationId =
                                              selected ? c.id : null;
                                        });
                                      },
                                    );
                                  }),
                                ],
                              ),
                            const SizedBox(height: 24),

                            // Lyrics Editor
                            Text(
                              'Letra da Música',
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 8),
                            TextFormField(
                              key: const ValueKey('song_lyrics_input'),
                              controller: _lyricsController,
                              minLines: 8,
                              maxLines: null,
                              keyboardType: TextInputType.multiline,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                height: 1.4,
                              ),
                              decoration: const InputDecoration(
                                hintText: 'Cole ou digite a letra aqui...',
                                border: OutlineInputBorder(),
                                alignLabelWithHint: true,
                              ),
                            ),
                            const SizedBox(height: 24),

                            // External Links
                            Text(
                              'Links e Recursos Externos',
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              key: const ValueKey('song_youtube_input'),
                              controller: _youtubeUrlController,
                              keyboardType: TextInputType.url,
                              decoration: const InputDecoration(
                                labelText: 'Link do YouTube',
                                hintText: 'https://youtube.com/watch?v=...',
                                prefixIcon: Icon(Icons.play_circle_outline),
                                border: OutlineInputBorder(),
                              ),
                              validator: _validateUrl,
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              key: const ValueKey('song_audio_input'),
                              controller: _audioUrlController,
                              keyboardType: TextInputType.url,
                              decoration: const InputDecoration(
                                labelText: 'Link do Áudio / Spotify / Drive',
                                hintText: 'https://...',
                                prefixIcon: Icon(Icons.audiotrack_outlined),
                                border: OutlineInputBorder(),
                              ),
                              validator: _validateUrl,
                            ),
                            const SizedBox(height: 12),
                            TextFormField(
                              key: const ValueKey('song_chord_sheet_input'),
                              controller: _chordSheetUrlController,
                              keyboardType: TextInputType.url,
                              decoration: const InputDecoration(
                                labelText: 'Link da Cifra Externa',
                                hintText: 'https://...',
                                prefixIcon: Icon(Icons.description_outlined),
                                border: OutlineInputBorder(),
                              ),
                              validator: _validateUrl,
                            ),
                            const SizedBox(height: 24),

                            // Notes
                            TextFormField(
                              key: const ValueKey('song_notes_input'),
                              controller: _notesController,
                              minLines: 2,
                              maxLines: 4,
                              decoration: const InputDecoration(
                                labelText: 'Observações / Instruções',
                                hintText: 'ex: Arranjo acústico, transição suave para estrofe 2',
                                border: OutlineInputBorder(),
                                prefixIcon: Icon(Icons.notes_outlined),
                              ),
                            ),
                            const SizedBox(height: 32),
                          ],
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
