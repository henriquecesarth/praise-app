import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';

/// Modal bottom sheet for creating a new ministry.
/// Keyed to prevent duplicate submits and handles post-creation context convergence.
class CreateMinistrySheet extends ConsumerStatefulWidget {
  const CreateMinistrySheet({super.key});

  static Future<bool?> show(BuildContext context) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => const CreateMinistrySheet(),
    );
  }

  @override
  ConsumerState<CreateMinistrySheet> createState() =>
      _CreateMinistrySheetState();
}

class _CreateMinistrySheetState extends ConsumerState<CreateMinistrySheet> {
  final _nameController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final notifier = ref.read(createMinistryNotifierProvider.notifier);
    final result = await notifier.createMinistry(_nameController.text);

    if (!mounted) return;

    if (result.isSuccess) {
      Navigator.of(context).pop(true);
    }
  }

  Future<void> _retryConvergence() async {
    final notifier = ref.read(createMinistryNotifierProvider.notifier);
    final result = await notifier.retryConvergence();

    if (!mounted) return;

    if (result.isSuccess) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = ref.watch(createMinistryNotifierProvider);
    final isSubmitting = state.isSubmitting;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Padding(
      padding: EdgeInsets.only(
        bottom: bottomInset,
        left: 20,
        right: 20,
        top: 12,
      ),
      child: SafeArea(
        child: SingleChildScrollView(
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Drag handle
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: 16),
                    decoration: BoxDecoration(
                      color: theme.dividerColor.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),

                // Header
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Icon(
                          Icons.add_business_outlined,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'Criar Novo Ministério',
                          style: theme.textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ],
                    ),
                    IconButton(
                      icon: const Icon(Icons.close),
                      tooltip: 'Fechar',
                      onPressed: isSubmitting
                          ? null
                          : () => Navigator.of(context).pop(false),
                    ),
                  ],
                ),
                const SizedBox(height: 8),

                Text(
                  'Cadastre seu ministério de louvor ou igreja para organizar músicas, cifras e escalas de domingo. Você será o administrador deste ministério.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 20),

                // Error / Recovery banner
                if (state.errorMessage != null) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: state.isRefreshFailure
                          ? Colors.amber.withValues(alpha: 0.15)
                          : theme.colorScheme.errorContainer,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: state.isRefreshFailure
                            ? Colors.amber
                            : theme.colorScheme.error,
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            Icon(
                              state.isRefreshFailure
                                  ? Icons.warning_amber_rounded
                                  : Icons.error_outline,
                              size: 20,
                              color: state.isRefreshFailure
                                  ? Colors.amber[800]
                                  : theme.colorScheme.error,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                state.errorMessage!,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: state.isRefreshFailure
                                      ? Colors.amber[900]
                                      : theme.colorScheme.onErrorContainer,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ),
                          ],
                        ),
                        if (state.isRefreshFailure) ...[
                          const SizedBox(height: 8),
                          FilledButton.tonalIcon(
                            onPressed: isSubmitting ? null : _retryConvergence,
                            icon: const Icon(Icons.refresh, size: 18),
                            label: const Text('Atualizar contexto'),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                ],

                // Name field
                TextFormField(
                  controller: _nameController,
                  autofocus: true,
                  textCapitalization: TextCapitalization.words,
                  enabled: !isSubmitting && !state.isRefreshFailure,
                  decoration: const InputDecoration(
                    labelText: 'Nome do ministério ou igreja *',
                    hintText: 'Ex: Ministério de Louvor Batista',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.church_outlined),
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Nome do ministério é obrigatório.';
                    }
                    if (value.trim().length > 100) {
                      return 'O nome deve ter no máximo 100 caracteres.';
                    }
                    return null;
                  },
                ),
                const SizedBox(height: 24),

                // Form actions
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: isSubmitting
                            ? null
                            : () => Navigator.of(context).pop(false),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                        ),
                        child: const Text('Cancelar'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton.icon(
                        key: const ValueKey('submit_create_ministry_button'),
                        onPressed:
                            isSubmitting || state.isRefreshFailure ? null : _submit,
                        style: FilledButton.styleFrom(
                          minimumSize: const Size.fromHeight(48),
                        ),
                        icon: isSubmitting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.add),
                        label: Text(
                          isSubmitting ? 'Criando...' : 'Criar Ministério',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
