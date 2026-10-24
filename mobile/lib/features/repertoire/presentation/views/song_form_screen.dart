import 'package:flutter/foundation.dart' show listEquals;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../domain/artist.dart';
import '../../domain/song_detail.dart';
import '../../domain/song_form_data.dart';
import 'version_editor_sheet.dart';

/// Screen for creating and editing repertoire songs in LouvAIO Mobile.
///
/// Features a compact, uncluttered layout:
/// - Title & Artist
/// - Compact Version List with concise cards and dedicated version editor sheet
/// - General Song Information (Lyrics & General Notes)
/// - Unsaved changes discard guard & multi-tenant isolation.
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
  late final TextEditingController _lyricsController;
  late final TextEditingController _notesController;

  late List<SongVersion> _versions;
  late List<SongVersion> _initialVersions;
  late List<String> _versionBpmDrafts;
  late List<bool> _versionBpmEdited;
  int _versionIdCounter = 1;

  String? _selectedArtistId;
  bool _artistExplicitlyModified = false;
  String? _boundUserId;
  bool _isSaved = false;
  bool _isForcedDismiss = false;

  bool get _hasPreservedFreeTextArtist {
    final init = widget.initialSong;
    if (init == null || _artistExplicitlyModified || _selectedArtistId != null) {
      return false;
    }
    final rawInitId = init.artistId?.trim();
    final hasNoInitId = rawInitId == null || rawInitId.isEmpty;
    final rawInitName = init.artistName?.trim();
    return hasNoInitId && rawInitName != null && rawInitName.isNotEmpty;
  }

  static const List<String> _musicalKeys = [
    'C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F',
    'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B',
    'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm',
    'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
  ];

  @override
  void initState() {
    super.initState();
    final init = widget.initialSong;

    _titleController = TextEditingController(text: init?.title ?? '');
    _lyricsController = TextEditingController(text: init?.lyrics ?? '');
    _notesController = TextEditingController(text: init?.notes ?? '');
    final rawInitArtistId = init?.artistId?.trim();
    _selectedArtistId =
        (rawInitArtistId != null && rawInitArtistId.isNotEmpty)
            ? rawInitArtistId
            : null;
    _artistExplicitlyModified = false;

    if (init != null && init.effectiveVersions.isNotEmpty) {
      _versions = List<SongVersion>.from(init.effectiveVersions);
    } else {
      _versions = const [
        SongVersion(
          id: 'v_1',
          name: 'Original',
          classificationIds: [],
          notes: null,
          key: null,
          bpm: null,
          duration: null,
          links: [],
        ),
      ].toList();
    }
    _initialVersions = List<SongVersion>.from(_versions);
    _versionBpmDrafts = _versions
        .map((v) => v.bpm != null ? v.bpm.toString() : '')
        .toList();
    _versionBpmEdited =
        List<bool>.filled(_versions.length, false, growable: true);
    _versionIdCounter = _versions.length + 1;

    _titleController.addListener(_onFieldChanged);
    _lyricsController.addListener(_onFieldChanged);
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

  String _nextUniqueVersionId() {
    final existingIds = _versions
        .map((v) => v.id)
        .whereType<String>()
        .toSet();
    final prefix = widget.initialSong?.id.trim().isNotEmpty == true
        ? '${widget.initialSong!.id.trim()}_v'
        : 'v';
    String candidate;
    do {
      _versionIdCounter++;
      candidate = '${prefix}_${DateTime.now().microsecondsSinceEpoch}_$_versionIdCounter';
    } while (existingIds.contains(candidate));
    return candidate;
  }

  Future<void> _openVersionEditor({int? index}) async {
    final bool isNew = index == null;
    if (isNew && _versions.length >= 20) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('A música pode ter no máximo 20 versões.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
      return;
    }

    final SongVersion initialVersion = isNew
        ? SongVersion(
            id: _nextUniqueVersionId(),
            name: 'Versão ${_versions.length + 1}',
            classificationIds: const [],
            notes: null,
            key: null,
            bpm: null,
            duration: null,
            links: const [],
          )
        : _versions[index];

    final String initialBpmDraft = (index != null && index < _versionBpmDrafts.length)
        ? _versionBpmDrafts[index]
        : (initialVersion.bpm != null ? initialVersion.bpm.toString() : '');

    final result = await showModalBottomSheet<SongVersionEditorResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => VersionEditorSheet(
        initialVersion: initialVersion,
        initialBpmDraft: initialBpmDraft,
        isNew: isNew,
        musicalKeys: _musicalKeys,
        classifications: ref.read(songFormNotifierProvider).classifications,
      ),
    );

    if (result != null && mounted) {
      setState(() {
        if (isNew) {
          _versions.add(result.version);
          _versionBpmDrafts.add(result.bpmDraft);
          _versionBpmEdited.add(result.bpmEdited);
        } else {
          _versions[index] = result.version;
          if (index < _versionBpmDrafts.length) {
            _versionBpmDrafts[index] = result.bpmDraft;
          }
          if (index < _versionBpmEdited.length) {
            _versionBpmEdited[index] = result.bpmEdited;
          }
        }
      });
    }
  }

  void _duplicateVersion(int index) {
    if (index < 0 || index >= _versions.length) return;
    if (_versions.length >= 20) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('A música pode ter no máximo 20 versões.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
      return;
    }

    final source = _versions[index];
    final sourceDraft = index < _versionBpmDrafts.length
        ? _versionBpmDrafts[index]
        : (source.bpm != null ? source.bpm.toString() : '');
    final sourceEdited =
        index < _versionBpmEdited.length ? _versionBpmEdited[index] : false;
    final newId = _nextUniqueVersionId();
    final clonedLinks = source.links
        .map(
          (l) => l.copyWith(
            id: l.id != null ? '${l.id}_copy_$_versionIdCounter' : null,
          ),
        )
        .toList();

    final clonedVersion = SongVersion(
      id: newId,
      name: '${source.name} (Cópia)',
      classificationIds: List<String>.from(source.classificationIds),
      notes: source.notes,
      key: source.key,
      bpm: source.bpm,
      duration: source.duration,
      links: clonedLinks,
    );

    setState(() {
      _versions.add(clonedVersion);
      _versionBpmDrafts.add(sourceDraft);
      _versionBpmEdited.add(sourceEdited);
    });
  }

  Future<void> _confirmDeleteVersion(int index) async {
    if (_versions.length <= 1 || index < 0 || index >= _versions.length) return;
    final target = _versions[index];

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir versão'),
        content: Text(
          'Deseja realmente excluir a versão "${target.name}"?',
        ),
        actions: [
          TextButton(
            key: const ValueKey('cancel_delete_version_button'),
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const ValueKey('confirm_delete_version_button'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      setState(() {
        _versions.removeAt(index);
        if (index < _versionBpmDrafts.length) {
          _versionBpmDrafts.removeAt(index);
        }
        if (index < _versionBpmEdited.length) {
          _versionBpmEdited.removeAt(index);
        }
      });
    }
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
    _lyricsController.clear();
    _notesController.clear();
    _selectedArtistId = null;
    _artistExplicitlyModified = false;
    _versions = [];
    _versionBpmDrafts = [];
    _versionBpmEdited = [];
  }

  void _onFieldChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _titleController.removeListener(_onFieldChanged);
    _lyricsController.removeListener(_onFieldChanged);
    _notesController.removeListener(_onFieldChanged);

    _titleController.dispose();
    _lyricsController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  bool get _isDirty {
    final init = widget.initialSong;
    final hasBpmDraftEdits = _versionBpmEdited.any((e) => e);
    if (init == null) {
      final v0 = _versions.isNotEmpty ? _versions.first : null;
      return _titleController.text.trim().isNotEmpty ||
          _lyricsController.text.trim().isNotEmpty ||
          _notesController.text.trim().isNotEmpty ||
          _selectedArtistId != null ||
          hasBpmDraftEdits ||
          _versions.length > 1 ||
          (v0 != null &&
              (v0.name != 'Original' ||
                  v0.key != null ||
                  v0.bpm != null ||
                  v0.duration != null ||
                  v0.notes != null ||
                  v0.classificationIds.isNotEmpty ||
                  v0.links.isNotEmpty));
    }

    final rawInitArtistId = init.artistId?.trim();
    final normalizedInitArtistId =
        (rawInitArtistId != null && rawInitArtistId.isNotEmpty)
            ? rawInitArtistId
            : null;
    final artistChanged = _selectedArtistId != normalizedInitArtistId ||
        _artistExplicitlyModified;

    return _titleController.text.trim() != init.title.trim() ||
        _lyricsController.text.trim() != (init.lyrics ?? '').trim() ||
        _notesController.text.trim() != (init.notes ?? '').trim() ||
        artistChanged ||
        hasBpmDraftEdits ||
        !listEquals(_versions, _initialVersions);
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
    if (_versions.isEmpty) return;

    final primary = _versions.first;
    final lyricsText = _lyricsController.text.trim();
    final notesText = _notesController.text.trim();

    final Object? artistIdPayload = (widget.isEditing &&
            !_artistExplicitlyModified &&
            _selectedArtistId == null)
        ? songFieldOmitted
        : _selectedArtistId;

    final formData = SongFormData(
      title: _titleController.text.trim(),
      artistId: artistIdPayload,
      classificationId: primary.classificationIds.isNotEmpty
          ? primary.classificationIds.first
          : null,
      originalKey: primary.key,
      bpm: primary.bpm,
      duration: primary.duration,
      lyrics: lyricsText.isNotEmpty ? lyricsText : null,
      notes: notesText.isNotEmpty ? notesText : null,
      versions: List<SongVersion>.from(_versions),
    );

    final notifier = ref.read(songFormNotifierProvider.notifier);
    final result = widget.isEditing
        ? await notifier.updateSong(widget.initialSong!.id, formData)
        : await notifier.createSong(formData);

    if (!mounted || _isForcedDismiss) return;
    if (result.isDiscarded) return;

    if (result.isSuccess && result.data != null) {
      _isSaved = true;

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
                                    _artistExplicitlyModified = true;
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
                      selected: _selectedArtistId == null &&
                          !_hasPreservedFreeTextArtist,
                      onTap: () {
                        setState(() {
                          _selectedArtistId = null;
                          _artistExplicitlyModified = true;
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
                                      _artistExplicitlyModified = true;
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

  Widget _buildInfoBadge({
    required IconData icon,
    required String label,
    required ThemeData theme,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(
          color: theme.dividerColor.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: theme.colorScheme.primary),
          const SizedBox(width: 4),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final formState = ref.watch(songFormNotifierProvider);
    final theme = Theme.of(context);

    // Multi-tenant fencing
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (prev, next) {
      if (_isSaved || _isForcedDismiss) return;
      if (prev?.selectedMinistry?.id != null &&
          next.selectedMinistry?.id != null &&
          prev!.selectedMinistry!.id != next.selectedMinistry!.id) {
        _forceDismiss();
      }
    });

    // Session fencing
    ref.listen<AuthState>(authNotifierProvider, (prev, next) {
      if (_isSaved || _isForcedDismiss) return;
      final nextUserId = next.user?.id;
      if (!next.isAuthenticated ||
          (_boundUserId != null &&
              nextUserId != null &&
              nextUserId != _boundUserId)) {
        _forceDismiss();
      }
    });

    String artistLabel = 'Nenhum artista selecionado';
    if (_selectedArtistId != null) {
      final found = formState.artists
          .where((a) => a.id == _selectedArtistId)
          .firstOrNull;
      if (found != null) {
        artistLabel = found.name;
      } else if (widget.initialSong?.artistName != null &&
          widget.initialSong!.artistName!.trim().isNotEmpty &&
          widget.initialSong?.artistId == _selectedArtistId) {
        artistLabel = widget.initialSong!.artistName!;
      }
    } else if (_hasPreservedFreeTextArtist) {
      artistLabel = widget.initialSong!.artistName!.trim();
    }

    return PopScope(
      canPop: !_isDirty || _isSaved || _isForcedDismiss,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop) return;
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
                                    fontWeight: (_selectedArtistId != null ||
                                            _hasPreservedFreeTextArtist)
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
                            const SizedBox(height: 24),

                            // Versions Management Section
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    'Versões da Música (${_versions.length})',
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: theme.textTheme.titleSmall?.copyWith(
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                ),
                                TextButton.icon(
                                  key: const ValueKey('add_version_button'),
                                  onPressed: () => _openVersionEditor(),
                                  icon: const Icon(Icons.add, size: 18),
                                  label: const Text('Nova Versão'),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),

                            // Compact Version Cards List
                            ...List.generate(_versions.length, (idx) {
                              final ver = _versions[idx];
                              final isPrimary = idx == 0;
                              final keyText = (ver.key != null && ver.key!.isNotEmpty)
                                  ? ver.key!
                                  : 'Sem tom';
                              final bpmText = ver.bpm != null
                                  ? (ver.bpm is num ? '${ver.bpm} BPM' : '${ver.bpm}')
                                  : 'Sem BPM';
                              final durText = (ver.duration != null && ver.duration!.isNotEmpty)
                                  ? ver.duration!
                                  : 'Sem duração';

                              return Card(
                                key: ValueKey('version_card_$idx'),
                                margin: const EdgeInsets.only(bottom: 10),
                                elevation: 0,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(12),
                                  side: BorderSide(
                                    color: theme.dividerColor.withValues(alpha: 0.3),
                                  ),
                                ),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(12),
                                  onTap: () => _openVersionEditor(index: idx),
                                  child: Padding(
                                    padding: const EdgeInsets.all(12),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Expanded(
                                              child: Wrap(
                                                spacing: 8,
                                                runSpacing: 4,
                                                crossAxisAlignment: WrapCrossAlignment.center,
                                                children: [
                                                  Text(
                                                    ver.name.isEmpty
                                                        ? (isPrimary ? 'Original' : 'Versão ${idx + 1}')
                                                        : ver.name,
                                                    style: const TextStyle(
                                                      fontSize: 15,
                                                      fontWeight: FontWeight.bold,
                                                    ),
                                                    maxLines: 1,
                                                    overflow: TextOverflow.ellipsis,
                                                  ),
                                                  if (isPrimary)
                                                    Container(
                                                      padding: const EdgeInsets.symmetric(
                                                        horizontal: 6,
                                                        vertical: 2,
                                                      ),
                                                      decoration: BoxDecoration(
                                                        color: theme.colorScheme.primaryContainer,
                                                        borderRadius: BorderRadius.circular(6),
                                                      ),
                                                      child: Text(
                                                        'Padrão',
                                                        style: TextStyle(
                                                          fontSize: 11,
                                                          fontWeight: FontWeight.w600,
                                                          color: theme.colorScheme.onPrimaryContainer,
                                                        ),
                                                      ),
                                                    ),
                                                ],
                                              ),
                                            ),
                                            IconButton(
                                              key: ValueKey('edit_version_button_$idx'),
                                              tooltip: 'Editar versão',
                                              visualDensity: VisualDensity.compact,
                                              icon: const Icon(Icons.edit_outlined, size: 20),
                                              onPressed: () => _openVersionEditor(index: idx),
                                            ),
                                            IconButton(
                                              key: ValueKey('duplicate_version_button_$idx'),
                                              tooltip: 'Duplicar versão',
                                              visualDensity: VisualDensity.compact,
                                              icon: const Icon(Icons.copy_outlined, size: 20),
                                              onPressed: () => _duplicateVersion(idx),
                                            ),
                                            if (_versions.length > 1)
                                              IconButton(
                                                key: ValueKey('delete_version_button_$idx'),
                                                tooltip: 'Excluir versão',
                                                visualDensity: VisualDensity.compact,
                                                icon: Icon(
                                                  Icons.delete_outline,
                                                  size: 20,
                                                  color: theme.colorScheme.error,
                                                ),
                                                onPressed: () => _confirmDeleteVersion(idx),
                                              ),
                                          ],
                                        ),
                                        const SizedBox(height: 8),
                                        Wrap(
                                          spacing: 8,
                                          runSpacing: 6,
                                          children: [
                                            _buildInfoBadge(
                                              icon: Icons.music_note,
                                              label: keyText,
                                              theme: theme,
                                            ),
                                            _buildInfoBadge(
                                              icon: Icons.speed,
                                              label: bpmText,
                                              theme: theme,
                                            ),
                                            _buildInfoBadge(
                                              icon: Icons.timer_outlined,
                                              label: durText,
                                              theme: theme,
                                            ),
                                          ],
                                        ),
                                        if (ver.notes != null && ver.notes!.isNotEmpty) ...[
                                          const SizedBox(height: 6),
                                          Text(
                                            ver.notes!,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: TextStyle(
                                              fontSize: 12,
                                              fontStyle: FontStyle.italic,
                                              color: Colors.grey.shade600,
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            }),
                            const SizedBox(height: 24),

                            // General Information Section Header
                            Text(
                              'Informações Gerais',
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 12),

                            // Lyrics Editor
                            TextFormField(
                              key: const ValueKey('song_lyrics_input'),
                              controller: _lyricsController,
                              minLines: 5,
                              maxLines: 12,
                              keyboardType: TextInputType.multiline,
                              style: const TextStyle(
                                fontFamily: 'monospace',
                                height: 1.4,
                              ),
                              decoration: const InputDecoration(
                                labelText: 'Letra da Música',
                                hintText: 'Cole ou digite a letra aqui...',
                                border: OutlineInputBorder(),
                                alignLabelWithHint: true,
                              ),
                            ),
                            const SizedBox(height: 16),

                            // General Notes
                            TextFormField(
                              key: const ValueKey('song_notes_input'),
                              controller: _notesController,
                              minLines: 2,
                              maxLines: 4,
                              decoration: const InputDecoration(
                                labelText: 'Observações Gerais',
                                hintText:
                                    'ex: Arranjo acústico, transição suave para estrofe 2',
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
