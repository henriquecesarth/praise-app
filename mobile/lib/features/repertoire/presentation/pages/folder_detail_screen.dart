import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/constants/app_constants.dart';
import '../../domain/entities/entities.dart';
import '../../domain/repositories/repositories.dart';
import '../bloc/folder_list_bloc.dart';
import '../bloc/song_list_bloc.dart';
import 'song_detail_screen.dart';

class FolderDetailScreen extends StatefulWidget {
  final Folder folder;

  const FolderDetailScreen({super.key, required this.folder});

  @override
  State<FolderDetailScreen> createState() => _FolderDetailScreenState();
}

class _FolderDetailScreenState extends State<FolderDetailScreen> {
  late Folder _folder;
  bool _isLoading = false;

  @override
  void initState() {
    super.initState();
    _folder = widget.folder;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadFolderData();
    });
  }

  Future<void> _loadFolderData() async {
    setState(() => _isLoading = true);
    final repository = context.read<FolderRepository>();
    final result = await repository.getFolderById(ApiConstants.defaultMinistryId, _folder.id);
    if (mounted) {
      setState(() {
        _isLoading = false;
        result.fold(
          (failure) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Erro ao recarregar pasta: ${failure.message}')),
            );
          },
          (folderData) {
            _folder = folderData;
          },
        );
      });
    }
  }

  void _showEditFolderDialog() {
    final nameController = TextEditingController(text: _folder.name);
    final descController = TextEditingController(text: _folder.description ?? '');

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
            onPressed: () async {
              if (nameController.text.trim().isNotEmpty) {
                final newName = nameController.text.trim();
                final newDesc = descController.text.trim().isEmpty ? null : descController.text.trim();
                
                Navigator.pop(dialogContext); // close dialog
                
                setState(() => _isLoading = true);
                final repository = context.read<FolderRepository>();
                final result = await repository.updateFolder(
                  ApiConstants.defaultMinistryId,
                  _folder.id,
                  {'name': newName, 'description': newDesc},
                );
                
                if (mounted) {
                  result.fold(
                    (failure) {
                      setState(() => _isLoading = false);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(failure.message)),
                      );
                    },
                    (updatedFolder) {
                      setState(() {
                        // Keep the songs since updateFolder might not return them
                        _folder = Folder(
                          id: updatedFolder.id,
                          ministryId: updatedFolder.ministryId,
                          name: updatedFolder.name,
                          description: updatedFolder.description,
                          songCount: updatedFolder.songCount,
                          songs: _folder.songs,
                          createdAt: updatedFolder.createdAt,
                          updatedAt: updatedFolder.updatedAt,
                        );
                        _isLoading = false;
                      });
                      context.read<FolderListBloc>().add(const LoadFolders());
                    },
                  );
                }
              }
            },
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
  }

  void _showAddSongsSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.background,
      builder: (sheetContext) {
        return DraggableScrollableSheet(
          initialChildSize: 0.7,
          minChildSize: 0.5,
          maxChildSize: 0.9,
          expand: false,
          builder: (_, scrollController) {
            return BlocBuilder<SongListBloc, SongListState>(
              builder: (context, state) {
                if (state is SongListLoading) {
                  return const Center(child: CircularProgressIndicator());
                } else if (state is SongListLoaded) {
                  // Filter out songs that are already in the folder
                  final existingIds = _folder.songs.map((s) => s.id).toSet();
                  final availableSongs = state.songs.where((s) => !existingIds.contains(s.id)).toList();

                  if (availableSongs.isEmpty) {
                    return const Center(child: Text('Nenhuma música nova disponível para adicionar.'));
                  }

                  return Column(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Text('Adicionar Música', style: Theme.of(context).textTheme.titleLarge),
                      ),
                      Expanded(
                        child: ListView.builder(
                          controller: scrollController,
                          itemCount: availableSongs.length,
                          itemBuilder: (context, index) {
                            final song = availableSongs[index];
                            return ListTile(
                              title: Text(song.title),
                              subtitle: Text(song.artistName ?? 'Artista desconhecido'),
                              trailing: const Icon(Icons.add_circle_outline, color: AppColors.primary),
                              onTap: () async {
                                Navigator.pop(sheetContext); // Close sheet immediately for responsiveness
                                setState(() => _isLoading = true);
                                final repo = context.read<FolderRepository>();
                                final result = await repo.addSongToFolder(
                                  ApiConstants.defaultMinistryId,
                                  _folder.id,
                                  song.id,
                                );
                                
                                if (mounted) {
                                  result.fold(
                                    (failure) {
                                      setState(() => _isLoading = false);
                                      ScaffoldMessenger.of(context).showSnackBar(
                                        SnackBar(content: Text(failure.message)),
                                      );
                                    },
                                    (_) {
                                      // Reload folder to get the updated songs list
                                      _loadFolderData();
                                      context.read<FolderListBloc>().add(const LoadFolders());
                                    }
                                  );
                                }
                              },
                            );
                          },
                        ),
                      ),
                    ],
                  );
                }
                return const Center(child: Text('Erro ao carregar músicas.'));
              },
            );
          },
        );
      },
    );
  }

  Future<void> _removeSong(Song song) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remover música'),
        content: Text('Tem certeza que deseja remover "${song.title}" desta pasta?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Remover', style: TextStyle(color: Colors.red))),
        ],
      )
    );

    if (confirm != true) return;

    setState(() => _isLoading = true);
    final repo = context.read<FolderRepository>();
    final result = await repo.removeSongFromFolder(ApiConstants.defaultMinistryId, _folder.id, song.id);

    if (mounted) {
      result.fold(
        (failure) {
          setState(() => _isLoading = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(failure.message)),
          );
        },
        (_) {
          _loadFolderData();
          context.read<FolderListBloc>().add(const LoadFolders());
        },
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_folder.name),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit),
            onPressed: _showEditFolderDialog,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (_folder.description != null && _folder.description!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Text(
                      _folder.description!,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: AppColors.textSecondary),
                    ),
                  ),
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                  child: Text('Músicas', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                ),
                Expanded(
                  child: _folder.songs.isEmpty
                      ? const Center(child: Text('Pasta vazia.', style: TextStyle(color: AppColors.textSecondary)))
                      : ListView.builder(
                          itemCount: _folder.songs.length,
                          itemBuilder: (context, index) {
                            final song = _folder.songs[index];
                            return Dismissible(
                              key: Key(song.id),
                              direction: DismissDirection.endToStart,
                              background: Container(
                                alignment: Alignment.centerRight,
                                padding: const EdgeInsets.only(right: 20),
                                color: Colors.red,
                                child: const Icon(Icons.delete, color: Colors.white),
                              ),
                              confirmDismiss: (direction) async {
                                await _removeSong(song);
                                return false; // Let the _removeSong handle the reload so it doesn't crash ListView before reload
                              },
                              child: ListTile(
                                leading: CircleAvatar(
                                  backgroundColor: AppColors.primarySurface,
                                  child: Text(song.avatarLetter, style: const TextStyle(color: AppColors.primary)),
                                ),
                                title: Text(song.title),
                                subtitle: Text(song.artistName ?? 'Artista desconhecido'),
                                trailing: IconButton(
                                  icon: const Icon(Icons.remove_circle_outline, color: AppColors.error),
                                  onPressed: () => _removeSong(song),
                                  tooltip: 'Remover da pasta',
                                ),
                                onTap: () {
                                  Navigator.push(
                                    context,
                                    MaterialPageRoute(builder: (_) => SongDetailScreen(song: song)),
                                  ).then((_) => _loadFolderData());
                                },
                              ),
                            );
                          },
                        ),
                ),
              ],
            ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _showAddSongsSheet,
        icon: const Icon(Icons.add),
        label: const Text('Música'),
      ),
    );
  }
}
