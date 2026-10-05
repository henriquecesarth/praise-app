import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/app/providers.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../schedules/domain/ministry_member.dart';
import '../../domain/availability.dart';
import '../controllers/manual_member_availability_controller.dart';
import '../widgets/manual_availability_form_modal.dart';

/// Screen for administrative management of availability for manual/unlinked members.
///
/// Implements M12B-2:
/// - Admin-only mutation of manual members (`is_manual === true` and `user_id == null`).
/// - Actor/subject separation.
/// - Reason visibility and editing.
/// - Authoritative refresh after create/edit/delete.
/// - Stale form and tenant-switch race protection.
/// - Responsive phone and tablet layout.
class ManualMemberAvailabilityScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final MinistryMember member;

  const ManualMemberAvailabilityScreen({
    super.key,
    required this.ministryId,
    required this.member,
  });

  @override
  ConsumerState<ManualMemberAvailabilityScreen> createState() =>
      _ManualMemberAvailabilityScreenState();
}

class _ManualMemberAvailabilityScreenState
    extends ConsumerState<ManualMemberAvailabilityScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
    });
  }

  void _load() {
    ref.read(manualMemberAvailabilityNotifierProvider.notifier).load(
          ministryId: widget.ministryId,
          memberId: widget.member.id,
        );
  }

  Future<void> _openCreateModal() async {
    final activeMinistry =
        ref.read(ministryContextNotifierProvider).selectedMinistry;
    if (activeMinistry == null || activeMinistry.id != widget.ministryId) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Operação cancelada: ministério ativo foi alterado.'),
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }

    final saved = await ManualAvailabilityFormModal.show(
      context: context,
      ministryId: widget.ministryId,
      memberName: widget.member.name,
      onSave: ({required payload}) async {
        return ref
            .read(manualMemberAvailabilityNotifierProvider.notifier)
            .createAvailability(
              payload: payload,
              expectedMinistryId: widget.ministryId,
            );
      },
    );

    if (saved == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Indisponibilidade criada com sucesso!'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _openEditModal(MemberAvailability item) async {
    final activeMinistry =
        ref.read(ministryContextNotifierProvider).selectedMinistry;
    if (activeMinistry == null || activeMinistry.id != widget.ministryId) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Operação cancelada: ministério ativo foi alterado.'),
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }

    final saved = await ManualAvailabilityFormModal.show(
      context: context,
      ministryId: widget.ministryId,
      memberName: widget.member.name,
      editingItem: item,
      onSave: ({required payload}) async {
        final updatePayload = UpdateAvailabilityPayload(
          startDate: payload.startDate,
          endDate: payload.endDate,
          startTime: payload.startTime,
          endTime: payload.endTime,
          allDay: payload.allDay,
          reason: payload.reason,
        );
        return ref
            .read(manualMemberAvailabilityNotifierProvider.notifier)
            .updateAvailability(
              id: item.id,
              payload: updatePayload,
              expectedMinistryId: widget.ministryId,
            );
      },
    );

    if (saved == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Indisponibilidade atualizada com sucesso!'),
          duration: Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _confirmDelete(MemberAvailability item) async {
    final activeMinistry =
        ref.read(ministryContextNotifierProvider).selectedMinistry;
    if (activeMinistry == null || activeMinistry.id != widget.ministryId) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Operação cancelada: ministério ativo foi alterado.'),
          duration: Duration(seconds: 2),
        ),
      );
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir indisponibilidade'),
        content: Text(
          'Deseja realmente remover o período de indisponibilidade de ${widget.member.name} (${item.formattedPeriod})?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
              foregroundColor: Theme.of(ctx).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );

    if (confirmed == true && mounted) {
      final success = await ref
          .read(manualMemberAvailabilityNotifierProvider.notifier)
          .deleteAvailability(
            id: item.id,
            expectedMinistryId: widget.ministryId,
          );

      if (success && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Indisponibilidade removida com sucesso!'),
            duration: Duration(seconds: 2),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    // Tenant switch protection: if active ministry switches away, pop screen immediately
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newId = next.selectedMinistry?.id;
      if (newId != null && newId != widget.ministryId) {
        if (mounted) {
          Navigator.of(context).maybePop();
        }
      }
    });

    final theme = Theme.of(context);
    final state = ref.watch(manualMemberAvailabilityNotifierProvider);
    final isEligible = ManualMemberEligibility.isEligible(widget.member);

    final ministryContext = ref.watch(ministryContextNotifierProvider);
    final activeMinistry = ministryContext.selectedMinistry;
    final isViewerAdmin =
        activeMinistry != null &&
        activeMinistry.id == widget.ministryId &&
        activeMinistry.isAdmin;

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Indisponibilidade',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
            Text(
              '${widget.member.name} • Cadastro manual',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
              ),
            ),
          ],
        ),
      ),
      floatingActionButton: (isEligible && isViewerAdmin)
          ? FloatingActionButton.extended(
              onPressed: state.isSubmitting ? null : _openCreateModal,
              icon: const Icon(Icons.add),
              label: const Text('Novo período'),
            )
          : null,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 700),
          child: _buildBody(context, state, isEligible, isViewerAdmin),
        ),
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    ManualMemberAvailabilityState state,
    bool isEligible,
    bool isViewerAdmin,
  ) {
    final theme = Theme.of(context);

    // 1. Ineligible subject guard (linked/authenticated member)
    if (!isEligible) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.block_outlined,
                size: 56,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                'Operação não permitida',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Apenas integrantes cadastrados manualmente podem ter disponibilidades gerenciadas por administradores.\n\n'
                'Integrantes com conta LouvAIO vinculada devem autodeclarar seus próprios períodos.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                ),
              ),
              const SizedBox(height: 24),
              OutlinedButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Voltar'),
              ),
            ],
          ),
        ),
      );
    }

    // 2. Unauthorized viewer (403)
    if (!isViewerAdmin || state.isUnauthorized) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.lock_outline_rounded,
                size: 56,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                'Acesso restrito',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Apenas administradores do ministério têm permissão para gerenciar a indisponibilidade de integrantes manuais.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                ),
              ),
              const SizedBox(height: 24),
              OutlinedButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Voltar'),
              ),
            ],
          ),
        ),
      );
    }

    // 3. Not Found (404 anti-IDOR)
    if (state.isNotFound) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.search_off_outlined,
                size: 56,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                'Integrante não encontrado',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Este integrante não foi encontrado ou não pertence a este ministério.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                ),
              ),
              const SizedBox(height: 24),
              OutlinedButton(
                onPressed: () => Navigator.of(context).pop(),
                child: const Text('Voltar'),
              ),
            ],
          ),
        ),
      );
    }

    // 4. Initial Loading
    if (state.isLoading && state.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    // 5. Error with retry
    if (state.error != null && state.items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.error_outline_rounded,
                size: 48,
                color: theme.colorScheme.error,
              ),
              const SizedBox(height: 16),
              Text(
                state.error!,
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyLarge?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
              ),
              const SizedBox(height: 20),
              FilledButton.icon(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(160, 44),
                ),
                onPressed: _load,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    // 6. Empty state
    if (state.items.isEmpty) {
      return RefreshIndicator(
        onRefresh: () => ref
            .read(manualMemberAvailabilityNotifierProvider.notifier)
            .refresh(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(32),
          children: [
            const SizedBox(height: 48),
            Icon(
              Icons.event_busy_outlined,
              size: 56,
              color: theme.colorScheme.primary.withValues(alpha: 0.5),
            ),
            const SizedBox(height: 16),
            Text(
              'Nenhum período registrado',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              '${widget.member.name} não possui períodos de indisponibilidade cadastrados.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
              ),
            ),
            const SizedBox(height: 24),
            Center(
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  minimumSize: const Size(180, 44),
                ),
                onPressed: _openCreateModal,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Adicionar período'),
              ),
            ),
          ],
        ),
      );
    }

    // 7. Populated List
    return RefreshIndicator(
      onRefresh: () => ref
          .read(manualMemberAvailabilityNotifierProvider.notifier)
          .refresh(),
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 80),
        itemCount: state.items.length + (state.actionError != null ? 1 : 0),
        itemBuilder: (context, index) {
          if (state.actionError != null && index == 0) {
            return Container(
              margin: const EdgeInsets.only(bottom: 12),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: theme.colorScheme.errorContainer,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(
                    Icons.error_outline,
                    color: theme.colorScheme.onErrorContainer,
                    size: 20,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      state.actionError!,
                      style: TextStyle(
                        color: theme.colorScheme.onErrorContainer,
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ],
              ),
            );
          }

          final itemIndex = state.actionError != null ? index - 1 : index;
          final item = state.items[itemIndex];

          return Card(
            elevation: 0,
            margin: const EdgeInsets.symmetric(vertical: 4),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
              side: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.2),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Period and All Day Chip
                  Row(
                    children: [
                      Icon(
                        Icons.calendar_today_outlined,
                        size: 16,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          item.formattedPeriod,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      if (item.allDay)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: theme.colorScheme.primaryContainer,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            'Dia inteiro',
                            style: theme.textTheme.bodySmall?.copyWith(
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),

                  // Reason (visible in manual member management)
                  if (item.reason != null && item.reason!.isNotEmpty) ...[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(
                          Icons.notes_outlined,
                          size: 16,
                          color: theme.colorScheme.onSurface
                              .withValues(alpha: 0.6),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            item.reason!,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.8),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                  ],

                  // Action Buttons (Edit and Delete)
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(90, 44),
                          visualDensity: VisualDensity.compact,
                        ),
                        onPressed: state.isSubmitting
                            ? null
                            : () => _openEditModal(item),
                        icon: const Icon(Icons.edit_outlined, size: 16),
                        label: const Text('Editar'),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(90, 44),
                          visualDensity: VisualDensity.compact,
                          foregroundColor: theme.colorScheme.error,
                          side: BorderSide(
                            color:
                                theme.colorScheme.error.withValues(alpha: 0.5),
                          ),
                        ),
                        onPressed: state.isSubmitting
                            ? null
                            : () => _confirmDelete(item),
                        icon: const Icon(Icons.delete_outline, size: 16),
                        label: const Text('Excluir'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
