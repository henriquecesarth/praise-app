import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../domain/artist.dart';
import '../../domain/repertoire_folder.dart';
import '../../domain/song_detail.dart';
import '../../domain/song_summary.dart';
import '../controllers/repertoire_list_controller.dart';
import '../widgets/song_card.dart';
import 'song_detail_view.dart';
import 'song_form_screen.dart';

enum _RepertoireTab { songs, folders, artists }

Future<({String name, String? description})?> _showFolderFormDialog(
  BuildContext context, {
  RepertoireFolder? initial,
}) {
  return showDialog<({String name, String? description})>(
    context: context,
    builder: (_) => _FolderFormDialog(initial: initial),
  );
}

class _FolderFormDialog extends StatefulWidget {
  final RepertoireFolder? initial;

  const _FolderFormDialog({this.initial});

  @override
  State<_FolderFormDialog> createState() => _FolderFormDialogState();
}

class _FolderFormDialogState extends State<_FolderFormDialog> {
  late final TextEditingController _nameController;
  late final TextEditingController _descController;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.initial?.name ?? '');
    _descController = TextEditingController(
      text: widget.initial?.description ?? '',
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final isEdit = widget.initial != null;
    return AlertDialog(
      title: Text(isEdit ? 'Editar pasta' : 'Nova pasta'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              key: const ValueKey('repertoire_folder_name_input'),
              controller: _nameController,
              autofocus: true,
              decoration: const InputDecoration(
                labelText: 'Nome da pasta *',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('repertoire_folder_desc_input'),
              controller: _descController,
              maxLines: 2,
              decoration: const InputDecoration(
                labelText: 'Descrição (opcional)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          key: const ValueKey('repertoire_folder_save_button'),
          onPressed: () {
            final trimmed = _nameController.text.trim();
            if (trimmed.isEmpty) return;
            Navigator.of(context).pop((
              name: trimmed,
              description: _descController.text.trim().isEmpty
                  ? null
                  : _descController.text.trim(),
            ));
          },
          child: Text(isEdit ? 'Salvar' : 'Criar'),
        ),
      ],
    );
  }
}

/// Repertoire browsing screen with administrative creation for managers.
class RepertoireView extends ConsumerStatefulWidget {
  final String? ministryId;

  const RepertoireView({super.key, required this.ministryId});

  @override
  ConsumerState<RepertoireView> createState() => _RepertoireViewState();
}

class _RepertoireViewState extends ConsumerState<RepertoireView> {
  final TextEditingController _searchController = TextEditingController();
  final TextEditingController _artistSearchController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  _RepertoireTab _activeTab = _RepertoireTab.songs;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
    });
  }

  @override
  void didUpdateWidget(RepertoireView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId) {
      _searchController.clear();
      _artistSearchController.clear();
      _activeTab = _RepertoireTab.songs;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(repertoireFoldersNotifierProvider.notifier).reset();
        ref.read(repertoireArtistsNotifierProvider.notifier).reset();
        _load();
      });
    }
  }

  void _load() {
    final ministryId = widget.ministryId;
    if (ministryId == null) return;
    ref.read(repertoireListNotifierProvider.notifier).loadForMinistry(ministryId);
    if (_activeTab == _RepertoireTab.folders) {
      ref.read(repertoireFoldersNotifierProvider.notifier).loadFolders(ministryId);
    } else if (_activeTab == _RepertoireTab.artists) {
      ref.read(repertoireArtistsNotifierProvider.notifier).loadArtists(ministryId);
    }
  }

  void _selectTab(_RepertoireTab tab) {
    if (_activeTab == tab) return;
    setState(() => _activeTab = tab);
    final ministryId = widget.ministryId;
    if (ministryId == null) return;
    if (tab == _RepertoireTab.folders) {
      ref.read(repertoireFoldersNotifierProvider.notifier).loadFolders(ministryId);
    } else if (tab == _RepertoireTab.artists) {
      ref.read(repertoireArtistsNotifierProvider.notifier).loadArtists(ministryId);
    }
  }

  void _onScroll() {
    if (!_scrollController.hasClients) return;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.position.pixels;
    if (currentScroll >= maxScroll - 200) {
      ref.read(repertoireListNotifierProvider.notifier).loadMore();
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    _artistSearchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _openCreateSong(BuildContext context) async {
    final ministryId = widget.ministryId;
    if (ministryId == null) return;

    final created = await Navigator.of(context).push<SongDetail>(
      MaterialPageRoute(
        builder: (_) => SongFormScreen(ministryId: ministryId),
      ),
    );

    if (created != null && mounted) {
      await ref
          .read(repertoireListNotifierProvider.notifier)
          .refresh(ministryId: ministryId);
    }
  }

  Future<void> _promptCreateFolder(BuildContext context, String ministryId) async {
    final messenger = ScaffoldMessenger.of(context);
    final created = await _showFolderFormDialog(context);

    if (created == null || !mounted) return;
    final err = await ref
        .read(repertoireFoldersNotifierProvider.notifier)
        .createFolder(
          ministryId,
          name: created.name,
          description: created.description,
        );
    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(err ?? 'Pasta "${created.name}" criada com sucesso.'),
      ),
    );
  }

  Future<void> _promptCreateArtist(BuildContext context, String ministryId) async {
    final messenger = ScaffoldMessenger.of(context);
    final nameController = TextEditingController();
    final artistName = await showDialog<String>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Novo artista'),
        content: TextField(
          key: const ValueKey('repertoire_artist_name_input'),
          controller: nameController,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Nome do artista *',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const ValueKey('repertoire_artist_save_button'),
            onPressed: () {
              final trimmed = nameController.text.trim();
              if (trimmed.isEmpty) return;
              Navigator.of(dialogCtx).pop(trimmed);
            },
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
    nameController.dispose();

    if (artistName == null || !mounted) return;
    final err = await ref
        .read(repertoireArtistsNotifierProvider.notifier)
        .createArtist(ministryId, artistName);
    if (!mounted) return;
    messenger.showSnackBar(
      SnackBar(
        content: Text(err ?? 'Artista "$artistName" cadastrado.'),
      ),
    );
  }

  void _filterByArtist(Artist artist) {
    _searchController.text = artist.name;
    setState(() => _activeTab = _RepertoireTab.songs);
    ref
        .read(repertoireListNotifierProvider.notifier)
        .onSearchChanged(artist.name);
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(repertoireListNotifierProvider);
    final isWide = MediaQuery.sizeOf(context).width >= 600;
    final isMatchingMinistry = state.ministryId == widget.ministryId;
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final isAdmin = ministryState.selectedMinistry?.isAdmin ?? false;
    final ministryId = widget.ministryId;

    if (ministryId == null) {
      return const _CenteredInfo(
        icon: Icons.church_outlined,
        message: 'Selecione um ministério para ver o repertório.',
      );
    }

    Widget? fab;
    if (isAdmin) {
      if (_activeTab == _RepertoireTab.songs) {
        fab = FloatingActionButton.extended(
          key: const ValueKey('repertoire_add_song_fab'),
          onPressed: () => _openCreateSong(context),
          icon: const Icon(Icons.add),
          label: const Text('Nova música'),
        );
      } else if (_activeTab == _RepertoireTab.folders) {
        final foldersState = ref.watch(repertoireFoldersNotifierProvider);
        if (foldersState.selectedFolder == null) {
          fab = FloatingActionButton.extended(
            key: const ValueKey('repertoire_add_folder_fab'),
            onPressed: () => _promptCreateFolder(context, ministryId),
            icon: const Icon(Icons.create_new_folder_outlined),
            label: const Text('Nova pasta'),
          );
        }
      } else {
        fab = FloatingActionButton.extended(
          key: const ValueKey('repertoire_add_artist_fab'),
          onPressed: () => _promptCreateArtist(context, ministryId),
          icon: const Icon(Icons.person_add_outlined),
          label: const Text('Novo artista'),
        );
      }
    }

    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 800),
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: SizedBox(
                    width: double.infinity,
                    child: SegmentedButton<_RepertoireTab>(
                      key: const ValueKey('repertoire_section_tabs'),
                      segments: const [
                        ButtonSegment(
                          value: _RepertoireTab.songs,
                          icon: Icon(Icons.queue_music_outlined, size: 18),
                          label: Text('Músicas'),
                        ),
                        ButtonSegment(
                          value: _RepertoireTab.folders,
                          icon: Icon(Icons.folder_outlined, size: 18),
                          label: Text('Pastas'),
                        ),
                        ButtonSegment(
                          value: _RepertoireTab.artists,
                          icon: Icon(Icons.person_outline, size: 18),
                          label: Text('Artistas'),
                        ),
                      ],
                      selected: {_activeTab},
                      onSelectionChanged: (selection) {
                        if (selection.isNotEmpty) {
                          _selectTab(selection.first);
                        }
                      },
                    ),
                  ),
                ),

                if (_activeTab == _RepertoireTab.songs) ...[
                  // Search bar and Classification chips
                  _SearchAndFilterHeader(
                    searchController: _searchController,
                    state: state,
                    onSearchChanged: (val) {
                      ref
                          .read(repertoireListNotifierProvider.notifier)
                          .onSearchChanged(val);
                    },
                    onClearSearch: () {
                      _searchController.clear();
                      ref
                          .read(repertoireListNotifierProvider.notifier)
                          .clearSearch();
                    },
                    onSelectClassification: (id) {
                      ref
                          .read(repertoireListNotifierProvider.notifier)
                          .setClassificationFilter(id);
                    },
                  ),

                  // Content Body
                  Expanded(
                    child: Builder(
                      builder: (context) {
                        if (!isMatchingMinistry ||
                            (state.isLoading && state.songs.isEmpty)) {
                          return const Center(child: CircularProgressIndicator());
                        }

                        if (state.error != null && state.songs.isEmpty) {
                          return _ErrorState(
                            message: state.error!,
                            onRetry: () {
                              ref
                                  .read(repertoireListNotifierProvider.notifier)
                                  .retry();
                            },
                          );
                        }

                        if (state.isEmptyState) {
                          return _EmptyState(
                            isFiltered: state.isFiltered,
                            onClearFilters: () {
                              _searchController.clear();
                              ref
                                  .read(repertoireListNotifierProvider.notifier)
                                  .clearSearch();
                              ref
                                  .read(repertoireListNotifierProvider.notifier)
                                  .setClassificationFilter(null);
                            },
                          );
                        }

                        return RefreshIndicator(
                          onRefresh: () async {
                            await ref
                                .read(repertoireListNotifierProvider.notifier)
                                .refresh();
                          },
                          child: ListView.builder(
                            controller: _scrollController,
                            physics: const AlwaysScrollableScrollPhysics(),
                            padding: EdgeInsets.symmetric(
                              horizontal: isWide ? 24 : 16,
                              vertical: 12,
                            ),
                            itemCount:
                                state.songs.length + (state.isLoadingMore ? 1 : 0),
                            itemBuilder: (context, index) {
                              if (index == state.songs.length) {
                                return const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 16.0),
                                  child: Center(
                                    child: SizedBox(
                                      width: 24,
                                      height: 24,
                                      child:
                                          CircularProgressIndicator(strokeWidth: 2),
                                    ),
                                  ),
                                );
                              }

                              final song = state.songs[index];
                              return SongCard(
                                song: song,
                                onTap: () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => SongDetailView(
                                        ministryId: ministryId,
                                        songId: song.id,
                                        initialTitle: song.title,
                                      ),
                                    ),
                                  );
                                },
                              );
                            },
                          ),
                        );
                      },
                    ),
                  ),
                ] else if (_activeTab == _RepertoireTab.folders) ...[
                  Expanded(
                    child: _FoldersTabContent(
                      ministryId: ministryId,
                      isAdmin: isAdmin,
                      isWide: isWide,
                    ),
                  ),
                ] else ...[
                  Expanded(
                    child: _ArtistsTabContent(
                      ministryId: ministryId,
                      isAdmin: isAdmin,
                      searchController: _artistSearchController,
                      onTapArtist: _filterByArtist,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: fab,
    );
  }
}

class _FoldersTabContent extends ConsumerWidget {
  final String ministryId;
  final bool isAdmin;
  final bool isWide;

  const _FoldersTabContent({
    required this.ministryId,
    required this.isAdmin,
    required this.isWide,
  });

  Future<void> _confirmDeleteFolder(
    BuildContext context,
    WidgetRef ref,
    RepertoireFolder folder,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Excluir pasta'),
        content: Text(
          'Deseja excluir a pasta "${folder.name}"? As músicas do repertório não serão removidas.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogCtx).colorScheme.error,
              foregroundColor: Theme.of(dialogCtx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(dialogCtx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final err = await ref
        .read(repertoireFoldersNotifierProvider.notifier)
        .deleteFolder(ministryId, folder.id);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(err ?? 'Pasta "${folder.name}" excluída.')),
    );
  }

  Future<void> _openEditFolderDialog(
    BuildContext context,
    WidgetRef ref,
    RepertoireFolder folder,
  ) async {
    final edited = await _showFolderFormDialog(context, initial: folder);
    if (edited == null || !context.mounted) return;
    final err = await ref
        .read(repertoireFoldersNotifierProvider.notifier)
        .updateFolder(
          ministryId,
          folder.id,
          name: edited.name,
          description: edited.description,
        );
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(err ?? 'Pasta "${edited.name}" atualizada.'),
      ),
    );
  }

  Future<void> _openAddSongPicker(
    BuildContext context,
    WidgetRef ref,
    RepertoireFolder folder,
  ) async {
    final listState = ref.read(repertoireListNotifierProvider);
    List<SongSummary> sourceSongs = listState.songs;
    if (listState.isFiltered || listState.hasMore || sourceSongs.isEmpty) {
      try {
        final fullPage = await ref
            .read(repertoireRepositoryProvider)
            .listSongs(ministryId, limit: 200);
        sourceSongs = fullPage.songs;
      } catch (_) {
        // Keep already loaded songs when background refresh is unavailable.
      }
    }
    if (!context.mounted) return;
    final availableSongs = sourceSongs
        .where((s) => !folder.songs.any((existing) => existing.id == s.id))
        .toList();

    final pickedSongId = await showDialog<String>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: Text('Adicionar música em "${folder.name}"'),
        content: SizedBox(
          width: 360,
          height: 320,
          child: availableSongs.isEmpty
              ? const Center(
                  child: Text(
                    'Todas as músicas carregadas já estão nesta pasta.',
                    textAlign: TextAlign.center,
                  ),
                )
              : ListView.builder(
                  itemCount: availableSongs.length,
                  itemBuilder: (_, idx) {
                    final song = availableSongs[idx];
                    return ListTile(
                      leading: const Icon(Icons.music_note_outlined),
                      title: Text(song.title),
                      subtitle: Text(song.displayArtist),
                      onTap: () => Navigator.of(dialogCtx).pop(song.id),
                    );
                  },
                ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(),
            child: const Text('Fechar'),
          ),
        ],
      ),
    );

    if (pickedSongId == null || !context.mounted) return;
    final err = await ref
        .read(repertoireFoldersNotifierProvider.notifier)
        .addSongToFolder(ministryId, folder.id, pickedSongId);
    if (err != null && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(err)));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final foldersState = ref.watch(repertoireFoldersNotifierProvider);
    final isMatching = foldersState.ministryId == ministryId;

    if (!isMatching || (foldersState.isLoading && foldersState.folders.isEmpty)) {
      return const Center(child: CircularProgressIndicator());
    }

    if (foldersState.error != null && foldersState.folders.isEmpty) {
      return _ErrorState(
        message: foldersState.error!,
        onRetry: () => ref
            .read(repertoireFoldersNotifierProvider.notifier)
            .loadFolders(ministryId, force: true),
      );
    }

    final selected = foldersState.selectedFolder;
    if (selected != null) {
      return Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
            child: Row(
              children: [
                TextButton.icon(
                  key: const ValueKey('repertoire_folder_back_button'),
                  onPressed: () => ref
                      .read(repertoireFoldersNotifierProvider.notifier)
                      .clearSelectedFolder(),
                  icon: const Icon(Icons.arrow_back),
                  label: const Text('Pastas'),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    selected.name,
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (isAdmin) ...[
                  IconButton(
                    key: ValueKey('repertoire_folder_detail_edit_${selected.id}'),
                    tooltip: 'Editar pasta',
                    onPressed: foldersState.isMutating
                        ? null
                        : () => _openEditFolderDialog(context, ref, selected),
                    icon: const Icon(Icons.edit_outlined),
                  ),
                  FilledButton.tonalIcon(
                    key: const ValueKey('repertoire_folder_add_song_button'),
                    onPressed: foldersState.isMutating
                        ? null
                        : () => _openAddSongPicker(context, ref, selected),
                    icon: const Icon(Icons.add, size: 18),
                    label: const Text('Adicionar'),
                  ),
                ],
              ],
            ),
          ),
          if (selected.description != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  selected.description!,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
              ),
            ),
          Expanded(
            child: foldersState.isLoadingDetail
                ? const Center(child: CircularProgressIndicator())
                : foldersState.detailError != null
                    ? _ErrorState(
                        message: foldersState.detailError!,
                        onRetry: () => ref
                            .read(repertoireFoldersNotifierProvider.notifier)
                            .openFolder(ministryId, selected.id),
                      )
                    : selected.songs.isEmpty
                        ? const _CenteredInfo(
                            icon: Icons.folder_open_outlined,
                            message: 'Nenhuma música nesta pasta ainda.',
                          )
                        : ListView.builder(
                            padding: EdgeInsets.symmetric(
                              horizontal: isWide ? 24 : 16,
                              vertical: 8,
                            ),
                            itemCount: selected.songs.length,
                            itemBuilder: (_, idx) {
                              final song = selected.songs[idx];
                              return Row(
                                children: [
                                  Expanded(
                                    child: SongCard(
                                      song: song,
                                      onTap: () {
                                        Navigator.of(context).push(
                                          MaterialPageRoute(
                                            builder: (_) => SongDetailView(
                                              ministryId: ministryId,
                                              songId: song.id,
                                              initialTitle: song.title,
                                            ),
                                          ),
                                        );
                                      },
                                    ),
                                  ),
                                  if (isAdmin)
                                    IconButton(
                                      key: ValueKey(
                                        'remove_song_from_folder_${song.id}',
                                      ),
                                      tooltip: 'Remover da pasta',
                                      icon: const Icon(
                                        Icons.remove_circle_outline,
                                      ),
                                      onPressed: foldersState.isMutating
                                          ? null
                                          : () async {
                                              final err = await ref
                                                  .read(
                                                    repertoireFoldersNotifierProvider
                                                        .notifier,
                                                  )
                                                  .removeSongFromFolder(
                                                    ministryId,
                                                    selected.id,
                                                    song.id,
                                                  );
                                              if (err != null && context.mounted) {
                                                ScaffoldMessenger.of(context)
                                                    .showSnackBar(
                                                  SnackBar(content: Text(err)),
                                                );
                                              }
                                            },
                                    ),
                                ],
                              );
                            },
                          ),
          ),
        ],
      );
    }

    if (foldersState.folders.isEmpty) {
      return const _CenteredInfo(
        icon: Icons.folder_outlined,
        message: 'Nenhuma pasta criada no repertório.',
      );
    }

    return RefreshIndicator(
      onRefresh: () => ref
          .read(repertoireFoldersNotifierProvider.notifier)
          .loadFolders(ministryId, force: true),
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.symmetric(
          horizontal: isWide ? 24 : 16,
          vertical: 12,
        ),
        itemCount: foldersState.folders.length,
        itemBuilder: (context, index) {
          final folder = foldersState.folders[index];
          return Card(
            key: ValueKey('repertoire_folder_card_${folder.id}'),
            margin: const EdgeInsets.only(bottom: 10),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: theme.colorScheme.primaryContainer,
                child: Icon(
                  Icons.folder_outlined,
                  color: theme.colorScheme.onPrimaryContainer,
                ),
              ),
              title: Text(
                folder.name,
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                folder.description ??
                    '${folder.songCount} ${folder.songCount == 1 ? 'música' : 'músicas'}',
              ),
              trailing: isAdmin
                  ? Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '${folder.songCount}',
                          style: theme.textTheme.labelMedium,
                        ),
                        IconButton(
                          key: ValueKey('repertoire_folder_edit_button_${folder.id}'),
                          tooltip: 'Editar pasta',
                          icon: const Icon(Icons.edit_outlined),
                          onPressed: () =>
                              _openEditFolderDialog(context, ref, folder),
                        ),
                        IconButton(
                          tooltip: 'Excluir pasta',
                          icon: const Icon(Icons.delete_outline),
                          onPressed: () =>
                              _confirmDeleteFolder(context, ref, folder),
                        ),
                      ],
                    )
                  : const Icon(Icons.chevron_right),
              onTap: () => ref
                  .read(repertoireFoldersNotifierProvider.notifier)
                  .openFolder(ministryId, folder.id),
            ),
          );
        },
      ),
    );
  }
}

class _ArtistsTabContent extends ConsumerWidget {
  final String ministryId;
  final bool isAdmin;
  final TextEditingController searchController;
  final ValueChanged<Artist> onTapArtist;

  const _ArtistsTabContent({
    required this.ministryId,
    required this.isAdmin,
    required this.searchController,
    required this.onTapArtist,
  });

  Future<void> _confirmDeleteArtist(
    BuildContext context,
    WidgetRef ref,
    Artist artist,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Excluir artista'),
        content: Text('Deseja excluir o artista "${artist.name}"?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: ValueKey('confirm_delete_artist_button_${artist.id}'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogCtx).colorScheme.error,
              foregroundColor: Theme.of(dialogCtx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(dialogCtx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final err = await ref
        .read(repertoireArtistsNotifierProvider.notifier)
        .deleteArtist(ministryId, artist.id);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(err ?? 'Artista "${artist.name}" excluído.')),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final artistsState = ref.watch(repertoireArtistsNotifierProvider);
    final isMatching = artistsState.ministryId == ministryId;

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: TextField(
            key: const ValueKey('repertoire_artists_search_input'),
            controller: searchController,
            onChanged: (q) => ref
                .read(repertoireArtistsNotifierProvider.notifier)
                .setSearchQuery(q),
            decoration: InputDecoration(
              hintText: 'Filtrar artistas...',
              prefixIcon: const Icon(Icons.search, size: 20),
              suffixIcon: searchController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear, size: 18),
                      onPressed: () {
                        searchController.clear();
                        ref
                            .read(repertoireArtistsNotifierProvider.notifier)
                            .setSearchQuery('');
                      },
                    )
                  : null,
              isDense: true,
              filled: true,
              fillColor:
                  theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.4),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ),
        Expanded(
          child: Builder(
            builder: (context) {
              if (!isMatching ||
                  (artistsState.isLoading && artistsState.artists.isEmpty)) {
                return const Center(child: CircularProgressIndicator());
              }
              if (artistsState.error != null && artistsState.artists.isEmpty) {
                return _ErrorState(
                  message: artistsState.error!,
                  onRetry: () => ref
                      .read(repertoireArtistsNotifierProvider.notifier)
                      .loadArtists(ministryId, force: true),
                );
              }
              final filtered = artistsState.filteredArtists;
              if (filtered.isEmpty) {
                return const _CenteredInfo(
                  icon: Icons.person_outline,
                  message: 'Nenhum artista encontrado.',
                );
              }
              return RefreshIndicator(
                onRefresh: () => ref
                    .read(repertoireArtistsNotifierProvider.notifier)
                    .loadArtists(ministryId, force: true),
                child: ListView.builder(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  itemCount: filtered.length,
                  itemBuilder: (context, index) {
                    final artist = filtered[index];
                    return Card(
                      key: ValueKey('repertoire_artist_card_${artist.id}'),
                      margin: const EdgeInsets.only(bottom: 8),
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: theme.colorScheme.secondaryContainer,
                          child: Text(
                            artist.name.isNotEmpty
                                ? artist.name[0].toUpperCase()
                                : '?',
                            style: TextStyle(
                              color: theme.colorScheme.onSecondaryContainer,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        title: Text(artist.name),
                        subtitle: const Text('Toque para filtrar músicas'),
                        trailing: isAdmin
                            ? IconButton(
                                tooltip: 'Excluir artista',
                                icon: const Icon(Icons.delete_outline),
                                onPressed: () =>
                                    _confirmDeleteArtist(context, ref, artist),
                              )
                            : const Icon(Icons.chevron_right),
                        onTap: () => onTapArtist(artist),
                      ),
                    );
                  },
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _SearchAndFilterHeader extends StatelessWidget {
  final TextEditingController searchController;
  final RepertoireListState state;
  final ValueChanged<String> onSearchChanged;
  final VoidCallback onClearSearch;
  final ValueChanged<String?> onSelectClassification;

  const _SearchAndFilterHeader({
    required this.searchController,
    required this.state,
    required this.onSearchChanged,
    required this.onClearSearch,
    required this.onSelectClassification,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasSearchText = searchController.text.isNotEmpty;

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      decoration: BoxDecoration(
        color: theme.scaffoldBackgroundColor,
        border: Border(
          bottom: BorderSide(
            color: theme.dividerColor.withValues(alpha: 0.15),
            width: 1,
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Search input field
          TextField(
            controller: searchController,
            onChanged: onSearchChanged,
            decoration: InputDecoration(
              hintText: 'Buscar música por título, artista ou letra...',
              prefixIcon: const Icon(Icons.search, size: 20),
              suffixIcon: hasSearchText
                  ? IconButton(
                      icon: const Icon(Icons.clear, size: 18),
                      onPressed: onClearSearch,
                    )
                  : null,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 16,
                vertical: 12,
              ),
              filled: true,
              fillColor: theme.colorScheme.surfaceContainerHighest
                  .withValues(alpha: 0.4),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide.none,
              ),
            ),
          ),

          // Classification filter chips (if available)
          if (state.availableClassifications.isNotEmpty) ...[
            const SizedBox(height: 8),
            SizedBox(
              height: 38,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: state.availableClassifications.length + 1,
                separatorBuilder: (_, __) => const SizedBox(width: 8),
                itemBuilder: (context, index) {
                  if (index == 0) {
                    final isAllSelected =
                        state.selectedClassificationId == null;
                    return FilterChip(
                      selected: isAllSelected,
                      label: const Text('Todos'),
                      onSelected: (_) => onSelectClassification(null),
                      showCheckmark: false,
                    );
                  }

                  final item = state.availableClassifications[index - 1];
                  final isSelected = state.selectedClassificationId == item.id;
                  final itemColor = item.displayColor;

                  return FilterChip(
                    selected: isSelected,
                    label: Text(item.name),
                    avatar: itemColor != null
                        ? CircleAvatar(
                            radius: 5,
                            backgroundColor: itemColor,
                          )
                        : null,
                    onSelected: (_) => onSelectClassification(item.id),
                    showCheckmark: false,
                  );
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final bool isFiltered;
  final VoidCallback onClearFilters;

  const _EmptyState({
    required this.isFiltered,
    required this.onClearFilters,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircleAvatar(
              radius: 36,
              backgroundColor: theme.colorScheme.primary.withValues(alpha: 0.1),
              child: Icon(
                isFiltered
                    ? Icons.search_off_rounded
                    : Icons.queue_music_outlined,
                size: 36,
                color: theme.colorScheme.primary,
              ),
            ),
            const SizedBox(height: 18),
            Text(
              isFiltered ? 'Nenhuma música encontrada' : 'Repertório Vazio',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              isFiltered
                  ? 'Não encontramos nenhuma música com os critérios informados.'
                  : 'Nenhuma música cadastrada no repertório deste ministério.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                height: 1.4,
              ),
            ),
            if (isFiltered) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: onClearFilters,
                icon: const Icon(Icons.clear, size: 18),
                label: const Text('Limpar busca e filtros'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.error_outline_rounded,
              size: 52,
              color: theme.colorScheme.error,
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}

class _CenteredInfo extends StatelessWidget {
  final IconData icon;
  final String message;

  const _CenteredInfo({required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 48,
              color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
            ),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyLarge?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
