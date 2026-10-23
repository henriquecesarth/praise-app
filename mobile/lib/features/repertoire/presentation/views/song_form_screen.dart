import 'package:flutter/foundation.dart' show listEquals;
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
  late final TextEditingController _versionNameController;
  late final TextEditingController _bpmController;
  late final TextEditingController _durationController;
  late final TextEditingController _lyricsController;
  late final TextEditingController _versionNotesController;
  late final TextEditingController _youtubeUrlController;
  late final TextEditingController _audioUrlController;
  late final TextEditingController _chordSheetUrlController;
  late final TextEditingController _notesController;

  late List<SongVersion> _versions;
  late List<SongVersion> _initialVersions;
  late List<String> _versionBpmDrafts;
  late List<bool> _versionBpmEdited;
  int _activeVersionIndex = 0;
  int _versionIdCounter = 1;
  bool _isLoadingVersionControllers = false;

  String? _selectedKey;
  String? _selectedArtistId;
  bool _artistExplicitlyModified = false;
  List<String> _selectedClassificationIds = [];
  List<SongLink> _customLinks = [];
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

    _versionNameController = TextEditingController();
    _bpmController = TextEditingController();
    _durationController = TextEditingController();
    _versionNotesController = TextEditingController();
    _youtubeUrlController = TextEditingController();
    _audioUrlController = TextEditingController();
    _chordSheetUrlController = TextEditingController();

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
    _activeVersionIndex = 0;
    _loadVersionIntoControllers(_versions[0]);

    _titleController.addListener(_onFieldChanged);
    _versionNameController.addListener(_onFieldChanged);
    _bpmController.addListener(_onFieldChanged);
    _durationController.addListener(_onFieldChanged);
    _lyricsController.addListener(_onFieldChanged);
    _versionNotesController.addListener(_onFieldChanged);
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

  String _findStandardLink(List<SongLink> links, List<String> labels) {
    for (final link in links) {
      if (!link.isCustom &&
          labels.contains(link.label.trim().toLowerCase()) &&
          link.url.trim().isNotEmpty) {
        return link.url.trim();
      }
    }
    return '';
  }

  void _loadVersionIntoControllers(SongVersion version) {
    _isLoadingVersionControllers = true;
    _versionNameController.text = version.name;
    _bpmController.text = (_activeVersionIndex >= 0 &&
            _activeVersionIndex < _versionBpmDrafts.length)
        ? _versionBpmDrafts[_activeVersionIndex]
        : (version.bpm != null ? version.bpm.toString() : '');
    _durationController.text = version.duration ?? '';
    _versionNotesController.text = version.notes ?? '';
    _youtubeUrlController.text =
        _findStandardLink(version.links, const ['vídeo', 'video', 'youtube']);
    _audioUrlController.text =
        _findStandardLink(version.links, const ['áudio', 'audio']);
    _chordSheetUrlController.text =
        _findStandardLink(version.links, const ['cifra']);

    _customLinks = version.links.where((l) {
      if (l.isCustom) return true;
      final lower = l.label.trim().toLowerCase();
      return !const ['vídeo', 'video', 'youtube', 'áudio', 'audio', 'cifra']
          .contains(lower);
    }).toList();

    _selectedKey = version.key;
    _selectedClassificationIds = List<String>.from(version.classificationIds);
    _isLoadingVersionControllers = false;
  }

  void _syncControllersToActiveVersion() {
    if (_isLoadingVersionControllers ||
        _versions.isEmpty ||
        _activeVersionIndex < 0 ||
        _activeVersionIndex >= _versions.length) {
      return;
    }

    final current = _versions[_activeVersionIndex];
    final links = <SongLink>[];

    final chordUrl = _chordSheetUrlController.text.trim();
    if (chordUrl.isNotEmpty) {
      links.add(SongLink(label: 'Cifra', url: chordUrl));
    }
    final ytUrl = _youtubeUrlController.text.trim();
    if (ytUrl.isNotEmpty) {
      links.add(SongLink(label: 'Vídeo', url: ytUrl));
    }
    final audUrl = _audioUrlController.text.trim();
    if (audUrl.isNotEmpty) {
      links.add(SongLink(label: 'Áudio', url: audUrl));
    }
    for (final custom in _customLinks) {
      if (custom.label.trim().isNotEmpty && custom.url.trim().isNotEmpty) {
        links.add(
          SongLink(
            id: custom.id,
            label: custom.label.trim(),
            url: custom.url.trim(),
            isCustom: custom.isCustom,
          ),
        );
      }
    }

    final rawBpmText = _bpmController.text;
    final prevDraft = _activeVersionIndex < _versionBpmDrafts.length
        ? _versionBpmDrafts[_activeVersionIndex]
        : (current.bpm != null ? current.bpm.toString() : '');
    if (rawBpmText != prevDraft) {
      if (_activeVersionIndex < _versionBpmDrafts.length) {
        _versionBpmDrafts[_activeVersionIndex] = rawBpmText;
        _versionBpmEdited[_activeVersionIndex] = true;
      }
    }

    final bool bpmWasEdited = _activeVersionIndex < _versionBpmEdited.length
        ? _versionBpmEdited[_activeVersionIndex]
        : true;

    final Object? resolvedBpm;
    if (!bpmWasEdited) {
      resolvedBpm = current.bpm;
    } else if (rawBpmText.trim().isEmpty) {
      resolvedBpm = null;
    } else {
      final candidateBpm = parseBpmValue(rawBpmText, trimString: true);
      resolvedBpm = candidateBpm ?? current.bpm;
    }

    final durText = _durationController.text.trim();
    final vNotesText = _versionNotesController.text.trim();
    final nameText = _versionNameController.text.trim();

    _versions[_activeVersionIndex] = SongVersion(
      id: current.id,
      name: nameText.isNotEmpty
          ? nameText
          : (_activeVersionIndex == 0
              ? 'Original'
              : 'Versão ${_activeVersionIndex + 1}'),
      classificationIds: List<String>.from(_selectedClassificationIds),
      notes: vNotesText.isNotEmpty ? vNotesText : null,
      key: _selectedKey,
      bpm: resolvedBpm,
      duration: durText.isNotEmpty ? durText : null,
      links: links,
    );
  }

  void _selectVersion(int index) {
    if (index < 0 || index >= _versions.length) return;
    _syncControllersToActiveVersion();
    setState(() {
      _activeVersionIndex = index;
      _loadVersionIntoControllers(_versions[index]);
    });
  }

  void _addVersion() {
    _syncControllersToActiveVersion();
    if (_versions.length >= 20) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text('A música pode ter no máximo 20 versões.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
      return;
    }

    final newId = _nextUniqueVersionId();
    final newVersion = SongVersion(
      id: newId,
      name: 'Versão ${_versions.length + 1}',
      classificationIds: const [],
      notes: null,
      key: null,
      bpm: null,
      duration: null,
      links: const [],
    );

    setState(() {
      _versions.add(newVersion);
      _versionBpmDrafts.add('');
      _versionBpmEdited.add(false);
      _activeVersionIndex = _versions.length - 1;
      _loadVersionIntoControllers(newVersion);
    });
  }

  void _duplicateVersion(int index) {
    if (index < 0 || index >= _versions.length) return;
    _syncControllersToActiveVersion();
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
      _activeVersionIndex = _versions.length - 1;
      _loadVersionIntoControllers(clonedVersion);
    });
  }

  Future<void> _confirmDeleteVersion(int index) async {
    if (_versions.length <= 1 || index < 0 || index >= _versions.length) return;
    _syncControllersToActiveVersion();
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
        if (_activeVersionIndex >= _versions.length) {
          _activeVersionIndex = _versions.length - 1;
        } else if (_activeVersionIndex > index) {
          _activeVersionIndex--;
        }
        _loadVersionIntoControllers(_versions[_activeVersionIndex]);
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
    _isLoadingVersionControllers = true;
    _titleController.clear();
    _versionNameController.clear();
    _bpmController.clear();
    _durationController.clear();
    _lyricsController.clear();
    _versionNotesController.clear();
    _youtubeUrlController.clear();
    _audioUrlController.clear();
    _chordSheetUrlController.clear();
    _notesController.clear();
    _selectedKey = null;
    _selectedArtistId = null;
    _artistExplicitlyModified = false;
    _selectedClassificationIds = [];
    _customLinks = [];
    _versions = [];
    _versionBpmDrafts = [];
    _versionBpmEdited = [];
    _isLoadingVersionControllers = false;
  }

  void _onFieldChanged() {
    if (_isLoadingVersionControllers) return;
    _syncControllersToActiveVersion();
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _titleController.removeListener(_onFieldChanged);
    _versionNameController.removeListener(_onFieldChanged);
    _bpmController.removeListener(_onFieldChanged);
    _durationController.removeListener(_onFieldChanged);
    _lyricsController.removeListener(_onFieldChanged);
    _versionNotesController.removeListener(_onFieldChanged);
    _youtubeUrlController.removeListener(_onFieldChanged);
    _audioUrlController.removeListener(_onFieldChanged);
    _chordSheetUrlController.removeListener(_onFieldChanged);
    _notesController.removeListener(_onFieldChanged);

    _titleController.dispose();
    _versionNameController.dispose();
    _bpmController.dispose();
    _durationController.dispose();
    _lyricsController.dispose();
    _versionNotesController.dispose();
    _youtubeUrlController.dispose();
    _audioUrlController.dispose();
    _chordSheetUrlController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  bool get _isDirty {
    _syncControllersToActiveVersion();
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
    _syncControllersToActiveVersion();

    for (int i = 0; i < _versions.length; i++) {
      final wasEdited = i < _versionBpmEdited.length && _versionBpmEdited[i];
      if (!wasEdited) continue;
      final draft =
          i < _versionBpmDrafts.length ? _versionBpmDrafts[i].trim() : '';
      if (draft.isNotEmpty && parseBpmValue(draft, trimString: true) == null) {
        if (_activeVersionIndex != i) {
          setState(() {
            _activeVersionIndex = i;
            _loadVersionIntoControllers(_versions[i]);
          });
        }
        _formKey.currentState!.validate();
        return;
      }
    }

    if (!_formKey.currentState!.validate()) return;

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
          widget.initialSong!.artistName!.trim().isNotEmpty &&
          widget.initialSong?.artistId == _selectedArtistId) {
        artistLabel = widget.initialSong!.artistName!;
      }
    } else if (_hasPreservedFreeTextArtist) {
      artistLabel = widget.initialSong!.artistName!.trim();
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
                            const SizedBox(height: 16),

                            // Versions Management Section
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Versões da Música (${_versions.length})',
                                  style: theme.textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                TextButton.icon(
                                  key: const ValueKey('add_version_button'),
                                  onPressed: _addVersion,
                                  icon: const Icon(Icons.add, size: 18),
                                  label: const Text('Nova Versão'),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            ...List.generate(_versions.length, (idx) {
                              final ver = _versions[idx];
                              final isActive = idx == _activeVersionIndex;
                              final metaParts = <String>[
                                if (ver.key != null && ver.key!.isNotEmpty)
                                  'Tom: ${ver.key}'
                                else
                                  'Sem tom',
                                if (ver.bpm != null)
                                  (ver.bpm is num
                                      ? '${ver.bpm} BPM'
                                      : '${ver.bpm}'),
                                if (ver.duration != null &&
                                    ver.duration!.isNotEmpty)
                                  ver.duration!,
                              ];
                              return Card(
                                key: ValueKey('version_card_$idx'),
                                margin: const EdgeInsets.only(bottom: 8),
                                elevation: 0,
                                color: isActive
                                    ? theme.colorScheme.primaryContainer
                                        .withValues(alpha: 0.25)
                                    : null,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(10),
                                  side: BorderSide(
                                    color: isActive
                                        ? theme.colorScheme.primary
                                        : theme.dividerColor
                                            .withValues(alpha: 0.3),
                                    width: isActive ? 1.5 : 1.0,
                                  ),
                                ),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(10),
                                  onTap: () => _selectVersion(idx),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 12,
                                      vertical: 6,
                                    ),
                                    child: Row(
                                      children: [
                                        Icon(
                                          isActive
                                              ? Icons.radio_button_checked
                                              : Icons.radio_button_off,
                                          size: 18,
                                          color: isActive
                                              ? theme.colorScheme.primary
                                              : Colors.grey,
                                        ),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                ver.name.isEmpty
                                                    ? (idx == 0
                                                        ? 'Original'
                                                        : 'Versão ${idx + 1}')
                                                    : ver.name,
                                                style: TextStyle(
                                                  fontWeight: isActive
                                                      ? FontWeight.bold
                                                      : FontWeight.w500,
                                                ),
                                              ),
                                              Text(
                                                metaParts.join(' • '),
                                                style: theme.textTheme.bodySmall
                                                    ?.copyWith(
                                                  color: Colors.grey,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                        IconButton(
                                          key: ValueKey(
                                            'edit_version_button_$idx',
                                          ),
                                          tooltip: 'Editar versão',
                                          icon: const Icon(
                                            Icons.edit_outlined,
                                            size: 20,
                                          ),
                                          onPressed: () => _selectVersion(idx),
                                        ),
                                        IconButton(
                                          key: ValueKey(
                                            'duplicate_version_button_$idx',
                                          ),
                                          tooltip: 'Duplicar versão',
                                          icon: const Icon(
                                            Icons.copy_outlined,
                                            size: 20,
                                          ),
                                          onPressed: () =>
                                              _duplicateVersion(idx),
                                        ),
                                        if (_versions.length > 1)
                                          IconButton(
                                            key: ValueKey(
                                              'delete_version_button_$idx',
                                            ),
                                            tooltip: 'Excluir versão',
                                            icon: Icon(
                                              Icons.delete_outline,
                                              size: 20,
                                              color:
                                                  theme.colorScheme.error,
                                            ),
                                            onPressed: () =>
                                                _confirmDeleteVersion(idx),
                                          ),
                                      ],
                                    ),
                                  ),
                                ),
                              );
                            }),
                            const SizedBox(height: 12),

                            // Active Version Name
                            TextFormField(
                              key: const ValueKey('song_version_name_input'),
                              controller: _versionNameController,
                              decoration: InputDecoration(
                                labelText:
                                    'Nome da Versão ${_activeVersionIndex + 1} *',
                                hintText: 'ex: Original, Acústico, Ao Vivo',
                                border: const OutlineInputBorder(),
                                prefixIcon: const Icon(Icons.layers_outlined),
                              ),
                              validator: (val) {
                                if (val == null || val.trim().isEmpty) {
                                  return 'O nome da versão é obrigatório';
                                }
                                return null;
                              },
                            ),
                            const SizedBox(height: 16),

                            // Musical Key (Tom Original / da Versão)
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
                                  key: const ValueKey('key_chip_none'),
                                  label: const Text('Sem tom'),
                                  selected: _selectedKey == null,
                                  onSelected: (selected) {
                                    if (selected) {
                                      setState(() {
                                        _selectedKey = null;
                                        _syncControllersToActiveVersion();
                                      });
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
                                        _syncControllersToActiveVersion();
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
                                    keyboardType: TextInputType.text,
                                    decoration: const InputDecoration(
                                      labelText: 'BPM',
                                      hintText: 'ex: 72 ou Rubato',
                                      border: OutlineInputBorder(),
                                      prefixIcon: Icon(Icons.speed),
                                    ),
                                    validator: (val) {
                                      if (val == null || val.trim().isEmpty) {
                                        return null;
                                      }
                                      final wasEdited = _activeVersionIndex <
                                              _versionBpmEdited.length
                                          ? _versionBpmEdited[
                                              _activeVersionIndex]
                                          : true;
                                      final parsed = parseBpmValue(
                                        val,
                                        trimString: wasEdited,
                                      );
                                      if (parsed == null) {
                                        return '1 a 999 ou texto de até 10 caracteres';
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

                            // Classification Selector (multi-select per version)
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
                                    selected:
                                        _selectedClassificationIds.isEmpty,
                                    onSelected: (selected) {
                                      if (selected) {
                                        setState(() {
                                          _selectedClassificationIds = [];
                                          _syncControllersToActiveVersion();
                                        });
                                      }
                                    },
                                  ),
                                  ...formState.classifications.map((c) {
                                    final isSelected =
                                        _selectedClassificationIds
                                            .contains(c.id);
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
                                          if (selected) {
                                            if (!_selectedClassificationIds
                                                .contains(c.id)) {
                                              _selectedClassificationIds = [
                                                ..._selectedClassificationIds,
                                                c.id,
                                              ];
                                            }
                                          } else {
                                            _selectedClassificationIds =
                                                _selectedClassificationIds
                                                    .where((id) => id != c.id)
                                                    .toList();
                                          }
                                          _syncControllersToActiveVersion();
                                        });
                                      },
                                    );
                                  }),
                                ],
                              ),
                            const SizedBox(height: 20),

                            // Active Version Notes
                            TextFormField(
                              key: const ValueKey('song_version_notes_input'),
                              controller: _versionNotesController,
                              minLines: 2,
                              maxLines: 4,
                              decoration: const InputDecoration(
                                labelText: 'Observações da Versão',
                                hintText:
                                    'ex: Intro no violão, modulação no refrão final',
                                border: OutlineInputBorder(),
                                prefixIcon: Icon(Icons.sticky_note_2_outlined),
                              ),
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
