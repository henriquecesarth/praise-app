import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../../core/errors/app_failure.dart';
import '../../domain/availability.dart';
import '../controllers/availability_providers.dart';
import '../widgets/availability_card.dart';
import '../widgets/availability_form_modal.dart';

/// Screen displaying the member''s personal availability periods with CRUD workflows.
///
/// Responsive for phone and tablet. Keyed by [ministryId] and safe against cross-tenant leaks.
class MyAvailabilityScreen extends ConsumerStatefulWidget {
  final String ministryId;

  const MyAvailabilityScreen({
    super.key,
    required this.ministryId,
  });

  @override
  ConsumerState<MyAvailabilityScreen> createState() =>
      _MyAvailabilityScreenState();
}

class _MyAvailabilityScreenState extends ConsumerState<MyAvailabilityScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
    });
  }

  @override
  void didUpdateWidget(MyAvailabilityScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }
  }

  void _load() {
    ref
        .read(availabilityListNotifierProvider.notifier)
        .loadForMinistry(widget.ministryId);
  }

  void _openCreateModal() {
    AvailabilityFormModal.show(
      context: context,
      ministryId: widget.ministryId,
      onSaved: (created) {
        ref.read(availabilityListNotifierProvider.notifier).addCreated(created);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Indisponibilidade cadastrada com sucesso.'),
              duration: Duration(seconds: 2),
            ),
          );
        }
      },
    );
  }

  void _openEditModal(MemberAvailability item) {
    AvailabilityFormModal.show(
      context: context,
      ministryId: widget.ministryId,
      editingItem: item,
      onSaved: (updated) {
        ref.read(availabilityListNotifierProvider.notifier).updateItem(updated);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Indisponibilidade atualizada com sucesso.'),
              duration: Duration(seconds: 2),
            ),
          );
        }
      },
    );
  }

  Future<void> _confirmDelete(MemberAvailability item) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Remover Indisponibilidade'),
        content: const Text(
          'Deseja realmente remover este período de indisponibilidade? Esta ação não pode ser desfeita.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Remover'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      try {
        final repo = ref.read(availabilityRepositoryProvider);
        await repo.deleteMyAvailability(widget.ministryId, item.id);

        if (mounted) {
          ref
              .read(availabilityListNotifierProvider.notifier)
              .removeItem(item.id);
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Período de indisponibilidade removido.'),
              duration: Duration(seconds: 2),
            ),
          );
        }
      } on AppFailure catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(e.message),
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
          );
        }
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text('Erro ao remover indisponibilidade: $e'),
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
          );
        }
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Tenant safety: pop screen if ministry switches away
    ref.listen(ministryContextNotifierProvider, (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null && newMinistryId != widget.ministryId) {
        if (mounted) {
          Navigator.of(context).maybePop();
        }
      }
    });

    final state = ref.watch(availabilityListNotifierProvider);
    final theme = Theme.of(context);
    final isMatchingMinistry = state.ministryId == widget.ministryId;

    Widget body;

    if (!isMatchingMinistry || state.isLoading) {
      body = const Center(child: CircularProgressIndicator());
    } else if (state.error != null && state.items.isEmpty) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.error_outline,
                size: 48,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                state.error!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge,
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _load,
                icon: const Icon(Icons.refresh),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    } else if (state.items.isEmpty) {
      body = Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.event_available_outlined,
                size: 64,
                color: theme.colorScheme.primary.withValues(alpha: 0.6),
              ),
              const SizedBox(height: 16),
              Text(
                'Nenhuma indisponibilidade',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Você está disponível para todas as escalas deste ministério. Adicione um período caso precise se ausentar.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                ),
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                onPressed: _openCreateModal,
                icon: const Icon(Icons.add),
                label: const Text('Adicionar Indisponibilidade'),
              ),
            ],
          ),
        ),
      );
    } else {
      body = RefreshIndicator(
        onRefresh: () =>
            ref.read(availabilityListNotifierProvider.notifier).refresh(),
        child: ListView.builder(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
          itemCount: state.items.length + (state.hasMore ? 1 : 0),
          itemBuilder: (context, index) {
            if (index == state.items.length) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 16.0),
                child: Center(
                  child: state.isLoadingMore
                      ? const SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : OutlinedButton.icon(
                          onPressed: () => ref
                              .read(availabilityListNotifierProvider.notifier)
                              .loadMore(),
                          icon: const Icon(Icons.arrow_downward, size: 18),
                          label: const Text('Carregar mais'),
                        ),
                ),
              );
            }

            final item = state.items[index];
            return AvailabilityCard(
              availability: item,
              onEdit: () => _openEditModal(item),
              onDelete: () => _confirmDelete(item),
            );
          },
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Minha Indisponibilidade'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add),
            tooltip: 'Nova Indisponibilidade',
            onPressed: _openCreateModal,
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 720),
            child: body,
          ),
        ),
      ),
      floatingActionButton: state.items.isNotEmpty
          ? FloatingActionButton.extended(
              onPressed: _openCreateModal,
              icon: const Icon(Icons.add),
              label: const Text('Nova'),
            )
          : null,
    );
  }
}
