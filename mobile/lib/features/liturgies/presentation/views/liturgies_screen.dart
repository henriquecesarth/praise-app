import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../widgets/liturgy_card.dart';
import 'liturgy_detail_screen.dart';
import 'liturgy_form_screen.dart';

/// Screen displaying the list of liturgies for the active ministry.
class LiturgiesScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final String ministryName;

  const LiturgiesScreen({
    super.key,
    required this.ministryId,
    required this.ministryName,
  });

  @override
  ConsumerState<LiturgiesScreen> createState() => _LiturgiesScreenState();
}

class _LiturgiesScreenState extends ConsumerState<LiturgiesScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref
          .read(liturgyListNotifierProvider.notifier)
          .loadLiturgies(widget.ministryId);
    });
  }

  @override
  void didUpdateWidget(LiturgiesScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId) {
      ref
          .read(liturgyListNotifierProvider.notifier)
          .loadLiturgies(widget.ministryId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = ref.watch(liturgyListNotifierProvider);
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final selectedMinistry = ministryState.selectedMinistry;
    final isAdmin = selectedMinistry?.isAdmin ?? false;
    final isMatchingMinistry = state.ministryId == widget.ministryId;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Liturgias & Roteiros'),
            Text(
              widget.ministryName,
              style: theme.textTheme.labelSmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Atualizar',
            icon: const Icon(Icons.refresh),
            onPressed: () {
              ref
                  .read(liturgyListNotifierProvider.notifier)
                  .loadLiturgies(widget.ministryId, refresh: true);
            },
          ),
        ],
      ),
      floatingActionButton: isAdmin
          ? FloatingActionButton.extended(
              key: const ValueKey('create_liturgy_fab'),
              onPressed: () async {
                final created = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(
                    builder: (_) => LiturgyFormScreen(
                      ministryId: widget.ministryId,
                    ),
                  ),
                );
                if (created == true && mounted) {
                  ref
                      .read(liturgyListNotifierProvider.notifier)
                      .loadLiturgies(widget.ministryId, refresh: true);
                }
              },
              icon: const Icon(Icons.add),
              label: const Text('Nova Liturgia'),
            )
          : null,
      body: Builder(
        builder: (context) {
          // Loading state (or ministry mismatch pending load)
          if (state.isLoading && (!isMatchingMinistry || state.liturgies.isEmpty)) {
            return const Center(
              child: CircularProgressIndicator(),
            );
          }

          // Error state
          if (state.errorMessage != null && (!isMatchingMinistry || state.liturgies.isEmpty)) {
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
                      state.errorMessage!,
                      textAlign: TextAlign.center,
                      style: theme.textTheme.titleMedium,
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      onPressed: () {
                        ref
                            .read(liturgyListNotifierProvider.notifier)
                            .loadLiturgies(widget.ministryId, refresh: true);
                      },
                      icon: const Icon(Icons.refresh),
                      label: const Text('Tentar novamente'),
                    ),
                  ],
                ),
              ),
            );
          }

          // Empty state
          if (state.liturgies.isEmpty) {
            return Center(
              child: Padding(
                padding: const EdgeInsets.all(32.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 72,
                      height: 72,
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surfaceContainerHighest,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        Icons.menu_book_outlined,
                        size: 36,
                        color: theme.colorScheme.outline,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Nenhuma liturgia cadastrada',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Roteiros, momentos de culto e ordens de serviço aparecerão aqui.',
                      textAlign: TextAlign.center,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                      ),
                    ),
                    if (isAdmin) ...[
                      const SizedBox(height: 24),
                      FilledButton.icon(
                        key: const ValueKey('empty_create_liturgy_button'),
                        onPressed: () async {
                          final created = await Navigator.of(context).push<bool>(
                            MaterialPageRoute(
                              builder: (_) => LiturgyFormScreen(
                                ministryId: widget.ministryId,
                              ),
                            ),
                          );
                          if (created == true && mounted) {
                            ref
                                .read(liturgyListNotifierProvider.notifier)
                                .loadLiturgies(widget.ministryId, refresh: true);
                          }
                        },
                        icon: const Icon(Icons.add),
                        label: const Text('Criar Primeira Liturgia'),
                      ),
                    ],
                  ],
                ),
              ),
            );
          }

          // Success / populated list
          return RefreshIndicator(
            onRefresh: () async {
              await ref
                  .read(liturgyListNotifierProvider.notifier)
                  .loadLiturgies(widget.ministryId, refresh: true);
            },
            child: ListView.builder(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              itemCount: state.liturgies.length,
              itemBuilder: (context, index) {
                final liturgy = state.liturgies[index];
                return LiturgyCard(
                  liturgy: liturgy,
                  onTap: () async {
                    final modified = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(
                        builder: (_) => LiturgyDetailScreen(
                          ministryId: widget.ministryId,
                          liturgyId: liturgy.id,
                        ),
                      ),
                    );
                    if (modified == true && mounted) {
                      ref
                          .read(liturgyListNotifierProvider.notifier)
                          .loadLiturgies(widget.ministryId, refresh: true);
                    }
                  },
                );
              },
            ),
          );
        },
      ),
    );
  }
}
