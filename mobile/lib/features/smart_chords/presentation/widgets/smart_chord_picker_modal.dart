import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/smart_chord.dart';
import '../controllers/smart_chord_providers.dart';

class SmartChordPickerModal extends ConsumerStatefulWidget {
  final String ministryId;
  final String songId;
  final String? songTitle;

  const SmartChordPickerModal({
    super.key,
    required this.ministryId,
    required this.songId,
    this.songTitle,
  });

  static Future<bool?> show(
    BuildContext context, {
    required String ministryId,
    required String songId,
    String? songTitle,
  }) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => SmartChordPickerModal(
        ministryId: ministryId,
        songId: songId,
        songTitle: songTitle,
      ),
    );
  }

  @override
  ConsumerState<SmartChordPickerModal> createState() => _SmartChordPickerModalState();
}

class _SmartChordPickerModalState extends ConsumerState<SmartChordPickerModal> {
  final _searchController = TextEditingController();
  List<SmartChord> _chords = [];
  bool _isLoading = true;
  String? _errorMessage;
  String? _linkingChordId;

  @override
  void initState() {
    super.initState();
    _fetchChords();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchChords({String? query}) async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final repo = ref.read(smartChordRepositoryProvider);
      final result = await repo.getSmartChords(
        search: query?.trim().isNotEmpty == true ? query!.trim() : null,
      );
      if (!mounted) return;
      setState(() {
        _chords = result;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = 'Não foi possível carregar as cifras.';
      });
    }
  }

  Future<void> _selectChord(SmartChord chord) async {
    setState(() {
      _linkingChordId = chord.id;
    });

    final linkNotifier = ref.read(smartChordRepertoireLinkNotifierProvider.notifier);
    final success = await linkNotifier.setLink(
      ministryId: widget.ministryId,
      chordId: chord.id,
      songId: widget.songId,
    );

    if (!mounted) return;
    setState(() {
      _linkingChordId = null;
    });

    if (success) {
      await ref.read(songSmartChordsNotifierProvider.notifier).load(
        widget.songId,
        ministryId: widget.ministryId,
        force: true,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Cifra "${chord.title}" vinculada com sucesso!'),
        ),
      );
    } else {
      final error = ref.read(smartChordRepertoireLinkNotifierProvider).errorMessage;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error ?? 'Erro ao vincular cifra.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  bool _isTitleMatch(String chordTitle) {
    if (widget.songTitle == null || widget.songTitle!.trim().isEmpty) return false;
    final a = widget.songTitle!.trim().toLowerCase();
    final b = chordTitle.trim().toLowerCase();
    return a == b;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return DraggableScrollableSheet(
      initialChildSize: 0.8,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (context, scrollController) {
        return Column(
          children: [
            // Handle bar
            const SizedBox(height: 12),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: theme.colorScheme.onSurfaceVariant.withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 12),

            // Header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  const Icon(Icons.queue_music, size: 24),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Vincular Cifra Existente',
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

            // Search input
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: TextField(
                controller: _searchController,
                decoration: InputDecoration(
                  hintText: 'Buscar entre minhas cifras...',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () {
                            _searchController.clear();
                            _fetchChords();
                          },
                        )
                      : null,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                ),
                onSubmitted: (query) => _fetchChords(query: query),
                onChanged: (val) {
                  setState(() {});
                },
              ),
            ),

            const Divider(),

            // Content
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _errorMessage != null
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(_errorMessage!),
                              const SizedBox(height: 8),
                              FilledButton(
                                onPressed: () => _fetchChords(query: _searchController.text),
                                child: const Text('Tentar novamente'),
                              ),
                            ],
                          ),
                        )
                      : _chords.isEmpty
                          ? Center(
                              child: Text(
                                'Nenhuma cifra inteligente encontrada.',
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            )
                          : ListView.builder(
                              controller: scrollController,
                              itemCount: _chords.length,
                              itemBuilder: (context, index) {
                                final chord = _chords[index];
                                final isMatchingTitle = _isTitleMatch(chord.title);
                                final isLinking = _linkingChordId == chord.id;

                                return ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor: isMatchingTitle
                                        ? theme.colorScheme.secondaryContainer
                                        : theme.colorScheme.surfaceContainerHighest,
                                    child: isLinking
                                        ? const SizedBox(
                                            width: 20,
                                            height: 20,
                                            child: CircularProgressIndicator(strokeWidth: 2),
                                          )
                                        : Icon(
                                            Icons.queue_music,
                                            color: isMatchingTitle
                                                ? theme.colorScheme.secondary
                                                : theme.colorScheme.onSurfaceVariant,
                                          ),
                                  ),
                                  title: Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          chord.title,
                                          style: const TextStyle(fontWeight: FontWeight.w600),
                                        ),
                                      ),
                                      if (isMatchingTitle)
                                        Container(
                                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                          decoration: BoxDecoration(
                                            color: theme.colorScheme.secondaryContainer,
                                            borderRadius: BorderRadius.circular(4),
                                          ),
                                          child: Text(
                                            'Título igual',
                                            style: theme.textTheme.labelSmall?.copyWith(
                                              color: theme.colorScheme.onSecondaryContainer,
                                              fontSize: 10,
                                            ),
                                          ),
                                        ),
                                    ],
                                  ),
                                  subtitle: Text(
                                    [
                                      if (chord.artistName != null && chord.artistName!.isNotEmpty)
                                        chord.artistName,
                                      'Tom: ${chord.originalKey}',
                                    ].join(' • '),
                                  ),
                                  trailing: const Icon(Icons.link),
                                  onTap: isLinking ? null : () => _selectChord(chord),
                                );
                              },
                            ),
            ),
          ],
        );
      },
    );
  }
}
