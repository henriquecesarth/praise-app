import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/providers.dart';
import 'widgets/create_ministry_sheet.dart';
import 'widgets/join_ministry_sheet.dart';

/// Screen displayed when an authenticated user has zero ministry memberships.
class MinistryEmptyScreen extends ConsumerWidget {
  const MinistryEmptyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final isLoading = ministryState.isLoading;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'LouvAIO',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            tooltip: 'Sair da conta',
            icon: const Icon(Icons.logout),
            onPressed: () async {
              await ref.read(authNotifierProvider.notifier).logout();
            },
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding:
                const EdgeInsets.symmetric(horizontal: 32.0, vertical: 24.0),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    padding: const EdgeInsets.all(24),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.primary.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      Icons.groups_outlined,
                      size: 64,
                      color: theme.colorScheme.primary,
                    ),
                  ),
                  const SizedBox(height: 24),
                  Text(
                    'Nenhum ministério vinculado',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 12),
                  Text(
                    'Sua conta foi autenticada, mas ainda não está associada a nenhum ministério de louvor. Crie o seu ministério como líder ou digite um código de convite para ingressar na equipe.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                      height: 1.5,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),

                  // Action 1: Create Ministry
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton.icon(
                      key: const ValueKey('empty_screen_create_ministry_button'),
                      onPressed: () => CreateMinistrySheet.show(context),
                      icon: const Icon(Icons.add_business_outlined),
                      label: const Text('Criar ministério'),
                    ),
                  ),
                  const SizedBox(height: 12),

                  // Action 2: Join Ministry by code
                  SizedBox(
                    width: double.infinity,
                    height: 48,
                    child: FilledButton.tonalIcon(
                      key: const ValueKey('empty_screen_join_ministry_button'),
                      onPressed: () => JoinMinistrySheet.show(context),
                      icon: const Icon(Icons.key_rounded),
                      label: const Text('Entrar com código de convite'),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Auxiliary Action 1: Refresh
                  SizedBox(
                    width: double.infinity,
                    height: 44,
                    child: OutlinedButton.icon(
                      onPressed: isLoading
                          ? null
                          : () async {
                              await ref
                                  .read(
                                      ministryContextNotifierProvider.notifier)
                                  .refresh();
                            },
                      icon: isLoading
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                              ),
                            )
                          : const Icon(Icons.refresh),
                      label: Text(
                        isLoading ? 'Verificando...' : 'Atualizar',
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),

                  // Auxiliary Action 2: Logout
                  TextButton.icon(
                    onPressed: () async {
                      await ref.read(authNotifierProvider.notifier).logout();
                    },
                    icon: const Icon(Icons.logout, size: 18),
                    label: const Text('Sair da Conta'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
