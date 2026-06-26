import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/constants/app_constants.dart';
import '../../domain/entities/entities.dart';
import '../../domain/repositories/repositories.dart';
import '../bloc/song_list_bloc.dart';
import '../bloc/artist_list_bloc.dart';
import '../bloc/folder_list_bloc.dart';
import 'folder_detail_screen.dart';
import '../widgets/widgets.dart';
import 'song_detail_screen.dart';
import 'song_form_screen.dart';

/// Main Repertoire Screen with 3 tabs: Músicas, Pastas, Artistas
class RepertoireScreen extends StatefulWidget {
  const RepertoireScreen({super.key});

  @override
  State<RepertoireScreen> createState() => _RepertoireScreenState();
}

class _RepertoireScreenState extends State<RepertoireScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;
  final TextEditingController _searchController = TextEditingController();
  Timer? _debounce;
  bool _isSearching = false;

  // Tab badge counts
  int _songCount = 0;
  int _folderCount = 0;
  int _artistCount = 0;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _tabController.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String query) {
    _debounce?.cancel();
    _debounce = Timer(
      Duration(milliseconds: UIConstants.searchDebounceMs.toInt()),
      () {
        context.read<SongListBloc>().add(SearchSongs(query));
      },
    );
  }

  void _toggleSearch() {
    setState(() {
      _isSearching = !_isSearching;
      if (!_isSearching) {
        _searchController.clear();
        context.read<SongListBloc>().add(const SearchSongs(''));
      }
    });
  }

  void _showFilterSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) => _FilterBottomSheet(
        onApply: (filters) {
          context.read<SongListBloc>().add(ApplyFilters(filters));
          Navigator.pop(context);
        },
      ),
    );
  }

  void _navigateToSongDetail(Song song) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => SongDetailScreen(song: song),
      ),
    ).then((_) {
      if (!mounted) return;
      context.read<SongListBloc>().add(const LoadSongs());
    });
  }

  void _navigateToCreateSong() {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => const SongFormScreen(),
      ),
    ).then((_) {
      if (!mounted) return;
      context.read<SongListBloc>().add(const RefreshSongs());
    });
  }

  void _showCreateArtistDialog() {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Novo Artista'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: 'Nome do artista ou banda',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () {
              if (controller.text.trim().isNotEmpty) {
                context
                    .read<ArtistListBloc>()
                    .add(CreateArtistEvent(controller.text.trim()));
                Navigator.pop(dialogContext);
              }
            },
            child: const Text('Criar'),
          ),
        ],
      ),
    );
  }

  void _showCreateFolderDialog() {
    final nameController = TextEditingController();
    final descController = TextEditingController();
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Nova Pasta'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameController,
              autofocus: true,
              decoration: const InputDecoration(hintText: 'Nome da pasta'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: descController,
              decoration: const InputDecoration(hintText: 'Descrição (opcional)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () {
              if (nameController.text.trim().isNotEmpty) {
                context.read<FolderListBloc>().add(CreateFolderEvent(
                      nameController.text.trim(),
                      description: descController.text.trim().isEmpty
                          ? null
                          : descController.text.trim(),
                    ));
                Navigator.pop(dialogContext);
              }
            },
            child: const Text('Criar'),
          ),
        ],
      ),
    );
  }

  void _showEditFolderDialog(Folder folder) {
    final nameController = TextEditingController(text: folder.name);
    final descController = TextEditingController(text: folder.description ?? '');

    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Editar Pasta'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameController,
              autofocus: true,
              decoration: const InputDecoration(hintText: 'Nome da pasta'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: descController,
              decoration: const InputDecoration(hintText: 'Descrição (opcional)'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('Cancelar'),
          ),
          ElevatedButton(
            onPressed: () {
              if (nameController.text.trim().isNotEmpty) {
                context.read<FolderListBloc>().add(UpdateFolderEvent(
                      folder.id,
                      nameController.text.trim(),
                      description: descController.text.trim().isEmpty
                          ? null
                          : descController.text.trim(),
                    ));
                Navigator.pop(dialogContext);
              }
            },
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: _buildAppBar(),
      body: Column(
        children: [
          // Search bar (animated)
          AnimatedSize(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeInOut,
            child: _isSearching ? _buildSearchBar() : const SizedBox.shrink(),
          ),
          // Tab bar
          _buildTabBar(),
          // Tab content
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildSongsTab(),
                _buildFoldersTab(),
                _buildArtistsTab(),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: _buildFAB(),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      title: const Text('Repertório'),
      actions: [
        // Search toggle
        IconButton(
          icon: Icon(_isSearching ? Icons.close : Icons.search),
          onPressed: _toggleSearch,
          tooltip: 'Pesquisar',
        ),
        // Filter button
        BlocBuilder<SongListBloc, SongListState>(
          builder: (context, state) {
            final hasFilters = state is SongListLoaded && state.hasActiveFilters;
            return Stack(
              children: [
                IconButton(
                  icon: const Icon(Icons.tune_rounded),
                  onPressed: _showFilterSheet,
                  tooltip: 'Filtros',
                ),
                if (hasFilters)
                  Positioned(
                    right: 8,
                    top: 8,
                    child: Container(
                      width: 8,
                      height: 8,
                      decoration: const BoxDecoration(
                        color: AppColors.primary,
                        shape: BoxShape.circle,
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: TextField(
        controller: _searchController,
        autofocus: true,
        onChanged: _onSearchChanged,
        decoration: InputDecoration(
          hintText: 'Buscar por título ou artista...',
          prefixIcon:
              const Icon(Icons.search, color: AppColors.textTertiary, size: 20),
          suffixIcon: _searchController.text.isNotEmpty
              ? IconButton(
                  icon: const Icon(Icons.clear, size: 18),
                  onPressed: () {
                    _searchController.clear();
                    _onSearchChanged('');
                  },
                )
              : null,
        ),
      ),
    );
  }

  Widget _buildTabBar() {
    return BlocListener<SongListBloc, SongListState>(
      listener: (context, state) {
        if (state is SongListLoaded) {
          setState(() => _songCount = state.totalCount);
        }
      },
      child: BlocListener<ArtistListBloc, ArtistListState>(
        listener: (context, state) {
          if (state is ArtistListLoaded) {
            setState(() => _artistCount = state.artists.length);
          }
        },
        child: BlocListener<FolderListBloc, FolderListState>(
          listener: (context, state) {
            if (state is FolderListLoaded) {
              setState(() => _folderCount = state.folders.length);
            }
          },
          child: TabBar(
            controller: _tabController,
            tabs: [
              Tab(text: 'Músicas ($_songCount)'),
              Tab(text: 'Pastas ($_folderCount)'),
              Tab(text: 'Artistas ($_artistCount)'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSongsTab() {
    return BlocBuilder<SongListBloc, SongListState>(
      builder: (context, state) {
        if (state is SongListLoading || state is SongListInitial) {
          return const ShimmerSongList();
        }

        if (state is SongListError) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline, color: AppColors.error, size: 48),
                const SizedBox(height: 16),
                Text(state.message, style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: () =>
                      context.read<SongListBloc>().add(const RefreshSongs()),
                  child: const Text('Tentar novamente'),
                ),
              ],
            ),
          );
        }

        if (state is SongListLoaded) {
          if (state.songs.isEmpty) {
            return EmptyStateWidget(
              icon: Icons.music_note_rounded,
              title: 'Nenhuma música encontrada',
              subtitle: state.hasActiveFilters
                  ? 'Tente remover alguns filtros.'
                  : 'Adicione músicas ao repertório do ministério.',
              actionLabel: state.hasActiveFilters ? null : 'Adicionar Música',
              onAction: state.hasActiveFilters ? null : _navigateToCreateSong,
            );
          }

          return RefreshIndicator(
            color: AppColors.primary,
            backgroundColor: AppColors.surface,
            onRefresh: () async {
              context.read<SongListBloc>().add(const RefreshSongs());
            },
            child: ListView.builder(
              padding: const EdgeInsets.only(top: 8, bottom: 80),
              itemCount: state.songs.length,
              itemBuilder: (context, index) {
                final song = state.songs[index];
                return SongCard(
                  song: song,
                  index: index,
                  onTap: () => _navigateToSongDetail(song),
                );
              },
            ),
          );
        }

        return const SizedBox.shrink();
      },
    );
  }

  Widget _buildFoldersTab() {
    return BlocBuilder<FolderListBloc, FolderListState>(
      builder: (context, state) {
        if (state is FolderListLoading || state is FolderListInitial) {
          return const Center(child: CircularProgressIndicator(color: AppColors.primary));
        }

        if (state is FolderListError) {
          return Center(child: Text(state.message));
        }

        if (state is FolderListLoaded) {
          if (state.folders.isEmpty) {
            return EmptyStateWidget(
              icon: Icons.folder_rounded,
              title: 'Nenhuma pasta criada',
              subtitle: 'Organize suas músicas em pastas temáticas.',
              actionLabel: 'Criar Pasta',
              onAction: _showCreateFolderDialog,
            );
          }

          return GridView.builder(
            padding: const EdgeInsets.all(16),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 12,
              mainAxisSpacing: 12,
              childAspectRatio: 1.2,
            ),
            itemCount: state.folders.length,
            itemBuilder: (context, index) {
              final folder = state.folders[index];
              return FolderCard(
                folder: folder,
                onTap: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (_) => FolderDetailScreen(folder: folder),
                    ),
                  );
                },
                onEdit: () {
                  _showEditFolderDialog(folder);
                },
                onDelete: () {
                  context
                      .read<FolderListBloc>()
                      .add(DeleteFolderEvent(folder.id));
                },
              );
            },
          );
        }

        return const SizedBox.shrink();
      },
    );
  }

  Widget _buildArtistsTab() {
    return BlocBuilder<ArtistListBloc, ArtistListState>(
      builder: (context, state) {
        if (state is ArtistListLoading || state is ArtistListInitial) {
          return const Center(child: CircularProgressIndicator(color: AppColors.primary));
        }

        if (state is ArtistListError) {
          return Center(child: Text(state.message));
        }

        if (state is ArtistListLoaded) {
          if (state.artists.isEmpty) {
            return EmptyStateWidget(
              icon: Icons.person_rounded,
              title: 'Nenhum artista cadastrado',
              subtitle: 'Cadastre artistas para organizar seu repertório.',
              actionLabel: 'Adicionar Artista',
              onAction: _showCreateArtistDialog,
            );
          }

          // Grouped by letter with section headers
          final groups = state.grouped;
          final entries = groups.entries.toList();

          return ListView.builder(
            padding: const EdgeInsets.only(top: 8, bottom: 80),
            itemCount: entries.fold<int>(
              0,
              (sum, entry) => sum + 1 + entry.value.length,
            ),
            itemBuilder: (context, index) {
              int currentIndex = 0;
              for (final entry in entries) {
                // Section header
                if (index == currentIndex) {
                  return Padding(
                    padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
                    child: Text(
                      entry.key,
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color: AppColors.primary,
                          ),
                    ),
                  );
                }
                currentIndex++;

                // Artist items
                for (int i = 0; i < entry.value.length; i++) {
                  if (index == currentIndex) {
                    final artist = entry.value[i];
                    return ArtistCard(
                      artist: artist,
                      onDelete: () {
                        context
                            .read<ArtistListBloc>()
                            .add(DeleteArtistEvent(artist.id));
                      },
                    );
                  }
                  currentIndex++;
                }
              }
              return const SizedBox.shrink();
            },
          );
        }

        return const SizedBox.shrink();
      },
    );
  }

  Widget _buildFAB() {
    final icons = [Icons.add, Icons.create_new_folder_rounded, Icons.person_add_rounded];
    final labels = ['Música', 'Pasta', 'Artista'];
    final actions = [_navigateToCreateSong, _showCreateFolderDialog, _showCreateArtistDialog];

    return FloatingActionButton.extended(
      onPressed: actions[_tabController.index],
      icon: Icon(icons[_tabController.index]),
      label: Text(labels[_tabController.index]),
    );
  }
}

/// Bottom sheet with filter options for songs
class _FilterBottomSheet extends StatefulWidget {
  final Function(SongFilters) onApply;

  const _FilterBottomSheet({required this.onApply});

  @override
  State<_FilterBottomSheet> createState() => _FilterBottomSheetState();
}

class _FilterBottomSheetState extends State<_FilterBottomSheet> {
  String? _selectedKey;
  bool _hasYoutube = false;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.textTertiary,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 20),

          Text('Filtros', style: Theme.of(context).textTheme.titleLarge),
          const SizedBox(height: 24),

          // Key filter
          Text('Tom', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: MusicalKeys.all.map((key) {
              final isSelected = _selectedKey == key;
              return ChoiceChip(
                label: Text(key),
                selected: isSelected,
                onSelected: (selected) {
                  setState(() => _selectedKey = selected ? key : null);
                },
                selectedColor: AppColors.primarySurface,
                labelStyle: TextStyle(
                  color: isSelected ? AppColors.primary : AppColors.textSecondary,
                  fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
                ),
                side: BorderSide(
                  color: isSelected ? AppColors.primary : AppColors.border,
                ),
              );
            }).toList(),
          ),

          const SizedBox(height: 20),

          // YouTube filter
          SwitchListTile(
            title: const Text('Apenas com YouTube'),
            subtitle: const Text('Mostrar músicas que possuem vídeo de referência'),
            value: _hasYoutube,
            activeColor: AppColors.primary,
            contentPadding: EdgeInsets.zero,
            onChanged: (value) => setState(() => _hasYoutube = value),
          ),

          const SizedBox(height: 24),

          // Actions
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () {
                    widget.onApply(const SongFilters());
                  },
                  child: const Text('Limpar'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: () {
                    widget.onApply(SongFilters(
                      originalKey: _selectedKey,
                      hasYoutube: _hasYoutube ? true : null,
                    ));
                  },
                  child: const Text('Aplicar'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }
}
