import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../repertoire/domain/song_summary.dart';
import '../../../repertoire/presentation/controllers/repertoire_providers.dart';
import '../controllers/smart_chord_providers.dart';

class SongLinkPickerModal extends ConsumerStatefulWidget {
  final String ministryId;
  final String chordId;
  final String? chordTitle;
  final String? currentLinkedSongId;

  const SongLinkPickerModal({
    super.key,
    required this.ministryId,
    required this.chordId,
    this.chordTitle,
    this.currentLinkedSongId,
  });

  static Future<bool?> show(
    BuildContext context, {
    required String ministryId,
    required String chordId,
    String? chordTitle,
    String? currentLinkedSongId,
  }) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => SongLinkPickerModal(
        ministryId: ministryId,
        chordId: chordId,
        chordTitle: chordTitle,
        currentLinkedSongId: currentLinkedSongId,
      ),
    );
  }

  @override
  ConsumerState<SongLinkPickerModal> createState() => _SongLinkPickerModalState();
}

class _SongLinkPickerModalState extends ConsumerState<SongLinkPickerModal> {
  final _searchController = TextEditingController();
  List<SongSummary> _songs = [];
  bool _isLoading = true;
  String? _errorMessage;
  String? _linkingSongId;

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

  Future<void> _fetchSongs({String? query}) async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final repo = ref.read(repertoireRepositoryProvider);
      final result = await repo.listSongs(
        widget.ministryId,
        search: query?.trim().isNotEmpty == true ? query!.trim() : null,
        limit: 50,
      );
      if (!mounted) return;
      setState(() {
        _songs = result.songs;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = 'Não foi possível carregar as músicas.';
      });
    }
  }

  Future<void> _selectSong(SongSummary song) async {
    setState(() {
      _linkingSongId = song.id;
    });

    final linkNotifier = ref.read(smartChordRepertoireLinkNotifierProvider.notifier);
    final success = await linkNotifier.setLink(
      ministryId: widget.ministryId,
      chordId: widget.chordId,
      songId: song.id,
    );

    if (!mounted) return;
    setState(() {
      _linkingSongId = null;
    });

    if (success) {
      Navigator.of(context).pop(true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Cifra vinculada a "${song.title}".'),
        ),
      );
    } else {
      final error = ref.read(smartChordRepertoireLinkNotifierProvider).errorMessage;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error ?? 'Erro ao vincular música.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  bool _isTitleMatch(String songTitle) {
    if (widget.chordTitle == null || widget.chordTitle!.trim().isEmpty) return false;
    final a = widget.chordTitle!.trim().toLowerCase();
    final b = songTitle.trim().toLowerCase();
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
                  const Icon(Icons.link, size: 24),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'Vincular ao Repertório',
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
                  hintText: 'Buscar música no ministério...',
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _searchController.text.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear),
                          onPressed: () {
                            _searchController.clear();
                            _fetchSongs();
                          },
                        )
                      : null,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                ),
                onSubmitted: (query) => _fetchSongs(query: query),
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
                                onPressed: () => _fetchSongs(query: _searchController.text),
                                child: const Text('Tentar novamente'),
                              ),
                            ],
                          ),
                        )
                      : _songs.isEmpty
                          ? Center(
                              child: Text(
                                'Nenhuma música encontrada no repertório.',
                                style: theme.textTheme.bodyMedium?.copyWith(
                                  color: theme.colorScheme.onSurfaceVariant,
                                ),
                              ),
                            )
                          : ListView.builder(
                              controller: scrollController,
                              itemCount: _songs.length,
                              itemBuilder: (context, index) {
                                final song = _songs[index];
                                final isCurrentlyLinked = song.id == widget.currentLinkedSongId;
                                final isMatchingTitle = _isTitleMatch(song.title);
                                final isLinking = _linkingSongId == song.id;

                                return ListTile(
                                  leading: CircleAvatar(
                                    backgroundColor: isCurrentlyLinked
                                        ? theme.colorScheme.primaryContainer
                                        : isMatchingTitle
                                            ? theme.colorScheme.secondaryContainer
                                            : theme.colorScheme.surfaceContainerHighest,
                                    child: isLinking
                                        ? const SizedBox(
                                            width: 20,
                                            height: 20,
                                            child: CircularProgressIndicator(strokeWidth: 2),
                                          )
                                        : Icon(
                                            isCurrentlyLinked
                                                ? Icons.check
                                                : Icons.music_note,
                                            color: isCurrentlyLinked
                                                ? theme.colorScheme.primary
                                                : isMatchingTitle
                                                    ? theme.colorScheme.secondary
                                                    : theme.colorScheme.onSurfaceVariant,
                                          ),
                                  ),
                                  title: Row(
                                    children: [
                                      Expanded(
                                        child: Text(
                                          song.title,
                                          style: TextStyle(
                                            fontWeight: isCurrentlyLinked ? FontWeight.bold : FontWeight.normal,
                                          ),
                                        ),
                                      ),
                                      if (isMatchingTitle && !isCurrentlyLinked)
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
                                      if (song.artistName != null && song.artistName!.isNotEmpty)
                                        song.artistName,
                                      if (song.originalKey != null && song.originalKey!.isNotEmpty)
                                        'Tom: ${song.originalKey}',
                                    ].join(' • '),
                                  ),
                                  trailing: isCurrentlyLinked
                                      ? Chip(
                                          label: const Text('Vinculada'),
                                          backgroundColor: theme.colorScheme.primaryContainer,
                                        )
                                      : const Icon(Icons.chevron_right),
                                  onTap: isLinking || isCurrentlyLinked
                                      ? null
                                      : () => _selectSong(song),
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
