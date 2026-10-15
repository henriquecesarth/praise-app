import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';

/// Modal bottom sheet for joining an existing ministry by invite code.
class JoinMinistrySheet extends ConsumerStatefulWidget {
  const JoinMinistrySheet({super.key});

  static Future<bool?> show(BuildContext context) {
    return showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (context) => const JoinMinistrySheet(),
    );
  }

  @override
  ConsumerState<JoinMinistrySheet> createState() => _JoinMinistrySheetState();
}

class _JoinMinistrySheetState extends ConsumerState<JoinMinistrySheet> {
  final _codeController = TextEditingController();
  final _formKey = GlobalKey<FormState>();

  @override
  void dispose() {
    _codeController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final notifier = ref.read(joinMinistryNotifierProvider.notifier);
    final result = await notifier.joinMinistry(_codeController.text);

    if (!mounted) return;

    if (result.isSuccess) {
      Navigator.of(context).pop(true);
    }
  }

  Future<void> _retryConvergence() async {
    final notifier = ref.read(joinMinistryNotifierProvider.notifier);
    final result = await notifier.retryConvergence();

    if (!mounted) return;

    if (result.isSuccess) {
      Navigator.of(context).pop(true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = ref.watch(joinMinistryNotifierProvider);
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
                          Icons.key_rounded,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 8),
                        Text(
                          'Entrar no Ministério',
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
                  'Digite o código de convite fornecido pelo seu líder de louvor (ex: PR-A1B2C3) para ingressar na equipe.',
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

                // Code field
                TextFormField(
                  controller: _codeController,
                  autofocus: true,
                  textCapitalization: TextCapitalization.characters,
                  inputFormatters: [
                    FilteringTextInputFormatter.allow(RegExp(r'[a-zA-Z0-9\-]')),
                    LengthLimitingTextInputFormatter(16),
                  ],
                  enabled: !isSubmitting && !state.isRefreshFailure,
                  decoration: const InputDecoration(
                    labelText: 'Código de convite *',
                    hintText: 'Ex: PR-A1B2C3',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.password_rounded),
                  ),
                  validator: (value) {
                    if (value == null || value.trim().isEmpty) {
                      return 'Código de convite é obrigatório.';
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
                        key: const ValueKey('submit_join_ministry_button'),
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
                            : const Icon(Icons.login_rounded),
                        label: Text(
                          isSubmitting ? 'Validando...' : 'Ingressar no Ministério',
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
