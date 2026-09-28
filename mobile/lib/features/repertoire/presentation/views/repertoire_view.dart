import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../controllers/repertoire_list_controller.dart';
import '../controllers/repertoire_providers.dart';
import '../widgets/song_card.dart';
import 'song_detail_view.dart';

/// Member-facing repertoire browsing screen.
/// Replaces the M6 placeholder. Read-only — no song creation or editing actions.
class RepertoireView extends ConsumerStatefulWidget {
  final String? ministryId;

  const RepertoireView({super.key, required this.ministryId});

  @override
  ConsumerState<RepertoireView> createState() => _RepertoireViewState();
}

class _RepertoireViewState extends ConsumerState<RepertoireView> {
  final TextEditingController _searchController = TextEditingController();
  final ScrollController _scrollController = ScrollController();

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
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }
  }

  void _load() {
    final ministryId = widget.ministryId;
    if (ministryId != null) {
      ref
          .read(repertoireListNotifierProvider.notifier)
          .loadForMinistry(ministryId);
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
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(repertoireListNotifierProvider);
    final isWide = MediaQuery.sizeOf(context).width >= 600;
    final isMatchingMinistry = state.ministryId == widget.ministryId;

    if (widget.ministryId == null) {
      return const _CenteredInfo(
        icon: Icons.church_outlined,
        message: 'Selecione um ministério para ver o repertório.',
      );
    }

    return SafeArea(
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 800),
          child: Column(
            children: [
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
                                    ministryId: widget.ministryId!,
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
            ],
          ),
        ),
      ),
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
