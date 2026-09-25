import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
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
                            Icons.check_circle,
                            color: theme.colorScheme.secondary,
                            size: 28,
                          ),
                          const SizedBox(width: 12),
                          Text(
                            'Fundação Mobile Pronta',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'Cliente nativo LouvAIO inicializado com arquitetura Flutter Android-first.',
                        style: theme.textTheme.bodyMedium,
                      ),
                      const Divider(height: 24),
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
              ElevatedButton.icon(
                onPressed: () => context.go('/login'),
                icon: const Icon(Icons.login),
                label: const Text('Ir para Acesso / Login'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
