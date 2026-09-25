import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers.dart';

/// Minimal, polished application shell for LouvAIO Mobile Foundation (M1).
///
/// Displays the official brand header, an environment badge for non-production
/// builds, and router navigation verification to placeholder screens.
class AppShell extends ConsumerWidget {
  const AppShell({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final environment = ref.watch(appEnvironmentProvider);
    final authState = ref.watch(authNotifierProvider);
    final user = authState.user;
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Text(
              'LouvAIO',
              style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 0.5),
            ),
            if (!environment.isProduction) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: environment.isDevelopment
                      ? Colors.orange.shade800
                      : Colors.blue.shade700,
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  environment.env.name.toUpperCase(),
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ],
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
        child: Padding(
          padding: const EdgeInsets.all(24.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(20.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.account_circle,
                            color: theme.colorScheme.secondary,
                            size: 32,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  user?.name.isNotEmpty == true
                                      ? user!.name
                                      : 'Usuário LouvAIO',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                if (user?.email.isNotEmpty == true)
                                  Text(
                                    user!.email,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      color: theme.colorScheme.onSurface
                                          .withValues(alpha: 0.7),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const Divider(height: 24),
                      Text(
                        'ID Autenticado: ${user?.id ?? 'Nenhum'}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace',
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Ambiente: ${environment.env.name}',
                        style: theme.textTheme.bodySmall,
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'API Base: ${environment.apiBaseUrl}',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const Spacer(),
              OutlinedButton.icon(
                onPressed: () async {
                  await ref.read(authNotifierProvider.notifier).logout();
                },
                icon: const Icon(Icons.logout),
                label: const Text('Sair da Conta'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
