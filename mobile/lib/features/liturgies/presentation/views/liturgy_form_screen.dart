import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../repertoire/domain/song_summary.dart';
import '../../../repertoire/presentation/controllers/repertoire_providers.dart';
import '../controllers/liturgy_providers.dart';
import '../../domain/liturgy.dart';

/// Screen for creating and editing a Liturgy and its itinerary items.
class LiturgyFormScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final String? liturgyId;
  final Liturgy? initialLiturgy;

  const LiturgyFormScreen({
    super.key,
    required this.ministryId,
    this.liturgyId,
    this.initialLiturgy,
  });

  bool get isEditing => liturgyId != null;

  @override
  ConsumerState<LiturgyFormScreen> createState() => _LiturgyFormScreenState();
}

class _LiturgyFormScreenState extends ConsumerState<LiturgyFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  late final TextEditingController _descriptionController;
  late DateTime _selectedDate;
  final List<LiturgyItem> _items = [];

  @override
  void initState() {
    super.initState();
    final init = widget.initialLiturgy;
    _titleController = TextEditingController(text: init?.title ?? '');
    _descriptionController = TextEditingController(text: init?.description ?? '');

    if (init != null && init.date.isNotEmpty) {
      try {
        _selectedDate = DateTime.parse(init.date);
      } catch (_) {
        _selectedDate = DateTime.now();
      }
    } else {
      _selectedDate = DateTime.now();
    }

    if (init != null && init.items.isNotEmpty) {
      _items.addAll(init.items);
    }
  }

  @override
  void dispose() {
    _titleController.dispose();
    _descriptionController.dispose();
    super.dispose();
  }

  String _formatDateYMD(DateTime dt) {
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  String _formatDateBR(DateTime dt) {
    final d = dt.day.toString().padLeft(2, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final y = dt.year.toString();
    return '$d/$m/$y';
  }

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );
    if (picked != null) {
      setState(() {
        _selectedDate = picked;
      });
    }
  }

  void _openAddItemSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetCtx) => _AddItemSheet(
        ministryId: widget.ministryId,
        onItemAdded: (item) {
          setState(() {
            _items.add(item.copyWith(position: _items.length));
          });
        },
      ),
    );
  }

  void _removeItem(int index) {
    setState(() {
      _items.removeAt(index);
      for (var i = 0; i < _items.length; i++) {
        _items[i] = _items[i].copyWith(position: i);
      }
    });
  }

  void _reorderItem(int oldIndex, int newIndex) {
    setState(() {
      final item = _items.removeAt(oldIndex);
      _items.insert(newIndex, item);
      for (var i = 0; i < _items.length; i++) {
        _items[i] = _items[i].copyWith(position: i);
      }
    });
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final title = _titleController.text.trim();
    final description = _descriptionController.text.trim();
    final dateStr = _formatDateYMD(_selectedDate);

    final formNotifier = ref.read(liturgyFormNotifierProvider.notifier);
    bool success;

    final itemsPayload = _items.map((i) => i.toJson()).toList();
    if (widget.isEditing) {
      final updated = await formNotifier.updateLiturgy(
        widget.ministryId,
        widget.liturgyId!,
        title: title,
        date: dateStr,
        description: description.isEmpty ? null : description,
        items: itemsPayload,
      );
      success = updated != null;
    } else {
      final created = await formNotifier.createLiturgy(
        widget.ministryId,
        title: title,
        date: dateStr,
        description: description.isEmpty ? null : description,
        items: itemsPayload,
      );
      success = created != null;
    }

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            widget.isEditing
                ? 'Liturgia atualizada com sucesso.'
                : 'Liturgia criada com sucesso.',
          ),
          duration: const Duration(seconds: 2),
        ),
      );
      Navigator.of(context).pop(true);
    } else if (mounted) {
      final error = ref.read(liturgyFormNotifierProvider).errorMessage ??
          'Ocorreu um erro ao salvar a liturgia.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final formState = ref.watch(liturgyFormNotifierProvider);
    final isSubmitting = formState.isSubmitting;

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.isEditing ? 'Editar Liturgia' : 'Nova Liturgia'),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 8.0),
            child: TextButton.icon(
              key: const ValueKey('save_liturgy_button'),
              onPressed: isSubmitting ? null : _submit,
              icon: isSubmitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.check),
              label: Text(widget.isEditing ? 'Salvar' : 'Criar'),
            ),
          ),
        ],
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16.0),
          children: [
            // Title Field
            TextFormField(
              key: const ValueKey('liturgy_title_input'),
              controller: _titleController,
              decoration: const InputDecoration(
                labelText: 'Título da Liturgia *',
                hintText: 'Ex: Culto de Domingo - Manhã',
                prefixIcon: Icon(Icons.title),
                border: OutlineInputBorder(),
              ),
              textCapitalization: TextCapitalization.sentences,
              validator: (v) {
                if (v == null || v.trim().isEmpty) {
                  return 'Informe o título da liturgia.';
                }
                if (v.trim().length > 200) {
                  return 'O título não pode exceder 200 caracteres.';
                }
                return null;
              },
            ),
            const SizedBox(height: 16),

            // Date Picker Field
            InkWell(
              key: const ValueKey('liturgy_date_picker'),
              onTap: isSubmitting ? null : _pickDate,
              borderRadius: BorderRadius.circular(4),
              child: InputDecorator(
                decoration: const InputDecoration(
                  labelText: 'Data da Liturgia *',
                  prefixIcon: Icon(Icons.calendar_today_outlined),
                  border: OutlineInputBorder(),
                  suffixIcon: Icon(Icons.arrow_drop_down),
                ),
                child: Text(
                  _formatDateBR(_selectedDate),
                  style: theme.textTheme.bodyLarge,
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Description Field
            TextFormField(
              key: const ValueKey('liturgy_description_input'),
              controller: _descriptionController,
              maxLines: 3,
              maxLength: 2000,
              decoration: const InputDecoration(
                labelText: 'Descrição / Tema (opcional)',
                hintText: 'Ex: Série de mensagens sobre Esperança...',
                alignLabelWithHint: true,
                prefixIcon: Padding(
                  padding: EdgeInsets.only(bottom: 40),
                  child: Icon(Icons.notes),
                ),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 24),

            // Itinerary Items Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Itens do Roteiro',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    Text(
                      '${_items.length} ${_items.length == 1 ? 'etapa cadastrada' : 'etapas cadastradas'}',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                      ),
                    ),
                  ],
                ),
                FilledButton.tonalIcon(
                  key: const ValueKey('add_liturgy_item_button'),
                  onPressed: isSubmitting ? null : _openAddItemSheet,
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('Adicionar Item'),
                ),
              ],
            ),
            const SizedBox(height: 12),

            if (_items.isEmpty)
              Card(
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(10),
                  side: BorderSide(
                    color: theme.dividerColor.withValues(alpha: 0.15),
                  ),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(24.0),
                  child: Center(
                    child: Column(
                      children: [
                        Icon(
                          Icons.playlist_add,
                          size: 36,
                          color: theme.colorScheme.outline,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Nenhum item adicionado',
                          style: theme.textTheme.titleSmall,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Adicione músicas do repertório, momentos de oração, leituras bíblicas ou avisos.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              )
            else
              ReorderableListView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _items.length,
                onReorderItem: _reorderItem,
                itemBuilder: (context, index) {
                  final item = _items[index];
                  final isSong = item.type == LiturgyItemType.song;

                  IconData typeIcon = Icons.label_outline;
                  Color iconColor = theme.colorScheme.outline;
                  switch (item.type) {
                    case LiturgyItemType.song:
                      typeIcon = Icons.music_note;
                      iconColor = theme.colorScheme.primary;
                      break;
                    case LiturgyItemType.reading:
                      typeIcon = Icons.menu_book;
                      iconColor = theme.colorScheme.tertiary;
                      break;
                    case LiturgyItemType.prayer:
                      typeIcon = Icons.volunteer_activism;
                      iconColor = theme.colorScheme.secondary;
                      break;
                    case LiturgyItemType.custom:
                      typeIcon = Icons.label_outline;
                      iconColor = theme.colorScheme.outline;
                      break;
                  }

                  return Card(
                    key: ValueKey('item_row_${item.id.isNotEmpty ? item.id : index}'),
                    margin: const EdgeInsets.only(bottom: 8),
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                      side: BorderSide(
                        color: theme.dividerColor.withValues(alpha: 0.15),
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      child: Row(
                        children: [
                          // Reorder grab handle
                          ReorderableDragStartListener(
                            index: index,
                            child: const Padding(
                              padding: EdgeInsets.only(right: 8.0),
                              child: Icon(
                                Icons.drag_indicator,
                                color: Colors.grey,
                                size: 22,
                              ),
                            ),
                          ),

                          // Position chip
                          Container(
                            width: 26,
                            height: 26,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: theme.colorScheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              '${index + 1}',
                              style: theme.textTheme.labelSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),

                          // Type Icon
                          Container(
                            width: 32,
                            height: 32,
                            decoration: BoxDecoration(
                              color: iconColor.withValues(alpha: 0.12),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            alignment: Alignment.center,
                            child: Icon(typeIcon, size: 16, color: iconColor),
                          ),
                          const SizedBox(width: 10),

                          // Title and details
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  item.title,
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    fontWeight: FontWeight.w600,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                                Text(
                                  item.type.label +
                                      (isSong && item.song != null
                                          ? ' • ${item.song!.displayArtist}'
                                          : ''),
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurface
                                        .withValues(alpha: 0.6),
                                  ),
                                ),
                                if (item.notes != null &&
                                    item.notes!.trim().isNotEmpty)
                                  Text(
                                    item.notes!.trim(),
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      fontStyle: FontStyle.italic,
                                      color: theme.colorScheme.onSurface
                                          .withValues(alpha: 0.75),
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                              ],
                            ),
                          ),

                          // Remove button
                          IconButton(
                            icon: Icon(
                              Icons.close,
                              color: theme.colorScheme.error,
                              size: 20,
                            ),
                            tooltip: 'Remover',
                            onPressed: () => _removeItem(index),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }
}

/// Bottom sheet dialog to add an itinerary item to the liturgy.
class _AddItemSheet extends ConsumerStatefulWidget {
  final String ministryId;
  final void Function(LiturgyItem item) onItemAdded;

  const _AddItemSheet({
    required this.ministryId,
    required this.onItemAdded,
  });

  @override
  ConsumerState<_AddItemSheet> createState() => _AddItemSheetState();
}

class _AddItemSheetState extends ConsumerState<_AddItemSheet> {
  LiturgyItemType _selectedType = LiturgyItemType.song;
  final _titleController = TextEditingController();
  final _notesController = TextEditingController();
  SongSummary? _selectedSong;

  @override
  void dispose() {
    _titleController.dispose();
    _notesController.dispose();
    super.dispose();
  }

  void _openSongPicker() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (pickerCtx) => _SongPickerModal(
        ministryId: widget.ministryId,
        onSongSelected: (song) {
          setState(() {
            _selectedSong = song;
            _titleController.text = song.title;
          });
        },
      ),
    );
  }

  void _confirmAdd() {
    final title = _titleController.text.trim();
    if (title.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Informe o título do momento.'),
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }

    final notes = _notesController.text.trim();

    widget.onItemAdded(
      LiturgyItem(
        type: _selectedType,
        title: title,
        notes: notes.isEmpty ? null : notes,
        songId: _selectedType == LiturgyItemType.song ? _selectedSong?.id : null,
        song: _selectedType == LiturgyItemType.song ? _selectedSong : null,
        position: 0,
      ),
    );

    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        left: 16,
        right: 16,
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom + 16,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Adicionar Momento',
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 12),

            // Type segmented buttons
            SegmentedButton<LiturgyItemType>(
              segments: const [
                ButtonSegment(
                  value: LiturgyItemType.song,
                  label: Text('Música'),
                  icon: Icon(Icons.music_note, size: 16),
                ),
                ButtonSegment(
                  value: LiturgyItemType.reading,
                  label: Text('Leitura'),
                  icon: Icon(Icons.menu_book, size: 16),
                ),
                ButtonSegment(
                  value: LiturgyItemType.prayer,
                  label: Text('Oração'),
                  icon: Icon(Icons.volunteer_activism, size: 16),
                ),
                ButtonSegment(
                  value: LiturgyItemType.custom,
                  label: Text('Outro'),
                  icon: Icon(Icons.label_outline, size: 16),
                ),
              ],
              selected: {_selectedType},
              onSelectionChanged: (set) {
                setState(() {
                  _selectedType = set.first;
                });
              },
            ),
            const SizedBox(height: 16),

            // If Song, show Song Selection Button
            if (_selectedType == LiturgyItemType.song) ...[
              OutlinedButton.icon(
                key: const ValueKey('pick_repertoire_song_button'),
                onPressed: _openSongPicker,
                icon: const Icon(Icons.search),
                label: Text(
                  _selectedSong != null
                      ? 'Trocar Música: ${_selectedSong!.title}'
                      : 'Selecionar Música do Repertório',
                ),
              ),
              const SizedBox(height: 12),
            ],

            // Title input
            TextField(
              key: const ValueKey('item_title_input'),
              controller: _titleController,
              decoration: InputDecoration(
                labelText: _selectedType == LiturgyItemType.song
                    ? 'Título da Música *'
                    : 'Título do Momento *',
                hintText: _selectedType == LiturgyItemType.reading
                    ? 'Ex: Leitura de Salmos 23'
                    : _selectedType == LiturgyItemType.prayer
                        ? 'Ex: Oração de Intercessão'
                        : 'Ex: Boas-vindas e Avisos',
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),

            // Notes input
            TextField(
              key: const ValueKey('item_notes_input'),
              controller: _notesController,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Observações / Instruções (opcional)',
                hintText: 'Ex: Tocar suave no fundo, ministro conduz...',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 20),

            FilledButton(
              key: const ValueKey('confirm_add_item_button'),
              onPressed: _confirmAdd,
              child: const Text('Adicionar ao Roteiro'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Modal for picking a song from the repertoire repository
class _SongPickerModal extends ConsumerStatefulWidget {
  final String ministryId;
  final void Function(SongSummary song) onSongSelected;

  const _SongPickerModal({
    required this.ministryId,
    required this.onSongSelected,
  });

  @override
  ConsumerState<_SongPickerModal> createState() => _SongPickerModalState();
}

class _SongPickerModalState extends ConsumerState<_SongPickerModal> {
  final _searchController = TextEditingController();
  List<SongSummary> _songs = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchSongs();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchSongs([String? query]) async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(repertoireRepositoryProvider)
          .listSongs(widget.ministryId, search: query, limit: 50);
      if (!mounted) return;
      setState(() {
        _songs = result.songs;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Não foi possível carregar as músicas.';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Repertório do Ministério',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Buscar por título, artista...',
                prefixIcon: const Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                isDense: true,
              ),
              onSubmitted: (v) => _fetchSongs(v.trim()),
              onChanged: (v) {
                if (v.trim().isEmpty) {
                  _fetchSongs();
                }
              },
            ),
          ),
          if (_isLoading)
            const Padding(
              padding: EdgeInsets.all(32.0),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                children: [
                  Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
                  const SizedBox(height: 8),
                  TextButton(
                    onPressed: () => _fetchSongs(_searchController.text.trim()),
                    child: const Text('Tentar novamente'),
                  ),
                ],
              ),
            )
          else if (_songs.isEmpty)
            const Padding(
              padding: EdgeInsets.all(32.0),
              child: Center(child: Text('Nenhuma música encontrada.')),
            )
          else
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: _songs.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final song = _songs[index];
                  return ListTile(
                    leading: Container(
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.primary.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        song.displayKey ?? '♪',
                        style: theme.textTheme.labelMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    ),
                    title: Text(song.title),
                    subtitle: Text(
                      song.displayArtist,
                      style: theme.textTheme.bodySmall,
                    ),
                    onTap: () {
                      widget.onSongSelected(song);
                      Navigator.of(context).pop();
                    },
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
