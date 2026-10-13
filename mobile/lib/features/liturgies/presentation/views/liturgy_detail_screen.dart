import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../repertoire/presentation/views/song_detail_view.dart';
import '../../domain/liturgy.dart';
import '../widgets/liturgy_item_tile.dart';
import 'liturgy_form_screen.dart';

/// Screen displaying the full details and items of a specific liturgy.
class LiturgyDetailScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final String liturgyId;

  const LiturgyDetailScreen({
    super.key,
    required this.ministryId,
    required this.liturgyId,
  });

  @override
  ConsumerState<LiturgyDetailScreen> createState() => _LiturgyDetailScreenState();
}

class _LiturgyDetailScreenState extends ConsumerState<LiturgyDetailScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(liturgyDetailNotifierProvider.notifier)
          .loadLiturgy(widget.ministryId, widget.liturgyId);
    });
  }

  @override
  void didUpdateWidget(LiturgyDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId ||
        oldWidget.liturgyId != widget.liturgyId) {
      ref
          .read(liturgyDetailNotifierProvider.notifier)
          .loadLiturgy(widget.ministryId, widget.liturgyId);
    }
  }

  Future<void> _confirmDelete(Liturgy liturgy) async {
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final errorColor = Theme.of(context).colorScheme.error;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        title: const Text('Excluir Liturgia'),
        content: Text(
          'Deseja realmente excluir a liturgia "${liturgy.title}"? Esta ação removerá todos os itens do roteiro.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: errorColor,
            ),
            onPressed: () => Navigator.of(dialogCtx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      final success = await ref
          .read(liturgyFormNotifierProvider.notifier)
          .deleteLiturgy(widget.ministryId, widget.liturgyId);

      if (!mounted) return;
      final currentActiveId =
          ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
      if (currentActiveId != widget.ministryId) {
        // Stale tenant switch occurred during deletion - discard UI feedback
        return;
      }

      if (success && mounted) {
        messenger.showSnackBar(
          const SnackBar(
            content: Text('Liturgia excluída com sucesso.'),
            duration: Duration(seconds: 2),
          ),
        );
        navigator.pop(true);
      } else if (mounted) {
        final error = ref.read(liturgyFormNotifierProvider).errorMessage ??
            'Não foi possível excluir a liturgia.';
        messenger.showSnackBar(
          SnackBar(
            content: Text(error),
            backgroundColor: errorColor,
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<MinistryContextState>(ministryContextNotifierProvider, (_, next) {
      if (next.selectedMinistry?.id != widget.ministryId && mounted) {
        Navigator.of(context).pop();
      }
    });

    final theme = Theme.of(context);
    final detailState = ref.watch(liturgyDetailNotifierProvider);
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final selectedMinistry = ministryState.selectedMinistry;
    final isAdmin = selectedMinistry?.isAdmin ?? false;
    final liturgy = detailState.liturgy;
    final isMatchingLiturgy = liturgy != null &&
        liturgy.id == widget.liturgyId &&
        detailState.ministryId == widget.ministryId;

    return Scaffold(
      appBar: AppBar(
        title: Text(
          liturgy?.title ?? 'Detalhes do Roteiro',
          overflow: TextOverflow.ellipsis,
        ),
        actions: [
          if (isAdmin && liturgy != null) ...[
            IconButton(
              key: const ValueKey('edit_liturgy_button'),
              tooltip: 'Editar',
              icon: const Icon(Icons.edit_outlined),
              onPressed: () async {
                final updated = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(
                    builder: (_) => LiturgyFormScreen(
                      ministryId: widget.ministryId,
                      liturgyId: widget.liturgyId,
                      initialLiturgy: liturgy,
                    ),
                  ),
                );
                if (updated == true && mounted) {
                  ref
                      .read(liturgyDetailNotifierProvider.notifier)
                      .loadLiturgy(widget.ministryId, widget.liturgyId, refresh: true);
                }
              },
            ),
            IconButton(
              key: const ValueKey('delete_liturgy_button'),
              tooltip: 'Excluir',
              icon: Icon(Icons.delete_outline, color: theme.colorScheme.error),
              onPressed: () => _confirmDelete(liturgy),
            ),
          ],
        ],
      ),
      body: Builder(
        builder: (context) {
          if (detailState.isLoading && !isMatchingLiturgy) {
            return const Center(child: CircularProgressIndicator());
          }

          if (detailState.errorMessage != null && !isMatchingLiturgy) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(24.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.error_outline_rounded,
                      size: 56,
                      color: theme.colorScheme.error,
                    ),
                    const SizedBox(height: 16),
                    Text(
                      detailState.errorMessage!,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: () {
                        ref
                            .read(liturgyDetailNotifierProvider.notifier)
                            .loadLiturgy(widget.ministryId, widget.liturgyId, refresh: true);
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Tentar novamente'),
                    ),
                  ],
                ),
              ),
            );
          }

          if (liturgy == null) {
            return const SizedBox.shrink();
          }

          final items = liturgy.items;

          return RefreshIndicator(
            onRefresh: () async {
              await ref
                  .read(liturgyDetailNotifierProvider.notifier)
                  .loadLiturgy(widget.ministryId, widget.liturgyId, refresh: true);
            },
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16.0),
              children: [
                // Header Card
                Card(
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(14),
                    side: BorderSide(
                      color: theme.dividerColor.withValues(alpha: 0.2),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(18.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 4,
                              ),
                              decoration: BoxDecoration(
                                color: theme.colorScheme.primary.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.calendar_today_outlined,
                                    size: 14,
                                    color: theme.colorScheme.primary,
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    liturgy.formattedDate,
                                    style: theme.textTheme.labelMedium?.copyWith(
                                      fontWeight: FontWeight.bold,
                                      color: theme.colorScheme.primary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Text(
                          liturgy.title,
                          style: theme.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (liturgy.description != null &&
                            liturgy.description!.trim().isNotEmpty) ...[
                          const SizedBox(height: 10),
                          Text(
                            liturgy.description!.trim(),
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface.withValues(alpha: 0.8),
                            ),
                          ),
                        ],
                        const SizedBox(height: 14),
                        Wrap(
                          spacing: 8,
                          runSpacing: 6,
                          children: [
                            _SummaryChip(
                              icon: Icons.format_list_bulleted,
                              label: liturgy.itemCount == 1
                                  ? '1 item no roteiro'
                                  : '${liturgy.itemCount} itens no roteiro',
                            ),
                            if (liturgy.songCount > 0)
                              _SummaryChip(
                                icon: Icons.music_note,
                                label: liturgy.songCount == 1
                                    ? '1 música'
                                    : '${liturgy.songCount} músicas',
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                // Section header
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4.0, vertical: 4.0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Roteiro da Celebração',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      Text(
                        '${items.length} ${items.length == 1 ? 'etapa' : 'etapas'}',
                        style: theme.textTheme.labelMedium?.copyWith(
                          color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 8),

                if (items.isEmpty)
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
                        child: Text(
                          'Nenhum item adicionado a este roteiro.',
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                          ),
                        ),
                      ),
                    ),
                  )
                else
                  ...items.asMap().entries.map((entry) {
                    final index = entry.key;
                    final item = entry.value;

                    return LiturgyItemTile(
                      item: item,
                      index: index,
                      onTap: (item.type == LiturgyItemType.song && item.songId != null)
                          ? () {
                              Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => SongDetailView(
                                    ministryId: widget.ministryId,
                                    songId: item.songId!,
                                    initialTitle: item.songTitle ?? item.title,
                                  ),
                                ),
                              );
                            }
                          : null,
                    );
                  }),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _SummaryChip extends StatelessWidget {
  final IconData icon;
  final String label;

  const _SummaryChip({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: theme.colorScheme.onSurfaceVariant),
          const SizedBox(width: 6),
          Text(
            label,
            style: theme.textTheme.labelSmall?.copyWith(
              fontWeight: FontWeight.w600,
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}
