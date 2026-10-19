import 'dart:async';
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
  bool _isLoadingMore = false;
  bool _hasMore = false;
  int _currentPage = 1;
  String? _nextCursor;
  String? _errorMessage;
  String? _linkingSongId;
  int _searchGeneration = 0;
  Timer? _debounceTimer;

  @override
  void initState() {
    super.initState();
    _fetchSongs();
  }

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 300), () {
      if (mounted) {
        _fetchSongs(query: query);
      }
    });
    setState(() {});
  }

  void _clearSearch() {
    _debounceTimer?.cancel();
    _searchController.clear();
    _fetchSongs();
    setState(() {});
  }

  Future<void> _fetchSongs({String? query}) async {
    final generation = ++_searchGeneration;
    setState(() {
      _isLoading = true;
      _isLoadingMore = false;
      _errorMessage = null;
      _currentPage = 1;
      _hasMore = false;
      _nextCursor = null;
    });

    try {
      final repo = ref.read(repertoireRepositoryProvider);
      final trimmed = query?.trim() ?? _searchController.text.trim();
      final result = await repo.listSongs(
        widget.ministryId,
        search: trimmed.isNotEmpty ? trimmed : null,
        page: 1,
        limit: 50,
      );
      if (!mounted || generation != _searchGeneration) return;
      setState(() {
        _songs = result.songs;
        _hasMore = result.hasMore;
        _nextCursor = result.nextCursor;
        _currentPage = 1;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted || generation != _searchGeneration) return;
      setState(() {
        _isLoading = false;
        _errorMessage = 'Não foi possível carregar as músicas.';
      });
    }
  }

  Future<void> _loadMore() async {
    if (_isLoading || _isLoadingMore || !_hasMore) return;

    final generation = _searchGeneration;
    setState(() {
      _isLoadingMore = true;
    });

    try {
      final repo = ref.read(repertoireRepositoryProvider);
      final query = _searchController.text.trim();
      final nextPage = _currentPage + 1;
      final result = await repo.listSongs(
        widget.ministryId,
        search: query.isNotEmpty ? query : null,
        page: nextPage,
        cursor: _nextCursor,
        limit: 50,
      );

      if (!mounted || generation != _searchGeneration) return;

      final existingIds = _songs.map((s) => s.id).toSet();
      final freshItems =
          result.songs.where((s) => !existingIds.contains(s.id)).toList();

      setState(() {
        _songs = [..._songs, ...freshItems];
        _hasMore = result.hasMore;
        _nextCursor = result.nextCursor;
        _currentPage = nextPage;
        _isLoadingMore = false;
      });
    } catch (e) {
      if (!mounted || generation != _searchGeneration) return;
      setState(() {
        _isLoadingMore = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Erro ao carregar mais músicas.')),
      );
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
                          onPressed: _clearSearch,
                        )
                      : null,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                ),
                onSubmitted: (query) {
                  _debounceTimer?.cancel();
                  _fetchSongs(query: query);
                },
                onChanged: _onSearchChanged,
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
                          : NotificationListener<ScrollNotification>(
                              onNotification: (scrollInfo) {
                                if (scrollInfo.metrics.pixels >=
                                    scrollInfo.metrics.maxScrollExtent - 200) {
                                  _loadMore();
                                }
                                return false;
                              },
                              child: ListView.builder(
                                controller: scrollController,
                                itemCount: _songs.length + (_hasMore ? 1 : 0),
                                itemBuilder: (context, index) {
                                  if (index == _songs.length) {
                                    return Padding(
                                      padding: const EdgeInsets.symmetric(vertical: 16),
                                      child: Center(
                                        child: _isLoadingMore
                                            ? const SizedBox(
                                                width: 24,
                                                height: 24,
                                                child: CircularProgressIndicator(strokeWidth: 2),
                                              )
                                            : TextButton.icon(
                                                onPressed: _loadMore,
                                                icon: const Icon(Icons.expand_more),
                                                label: const Text('Carregar mais músicas'),
                                              ),
                                      ),
                                    );
                                  }
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
            ),
          ],
        );
      },
    );
  }
}
