import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/providers.dart';
import '../domain/ministry.dart';

/// Screen allowing the user to select their active ministry context
/// when multiple memberships exist and no valid selection is persisted.
class MinistrySelectorScreen extends ConsumerWidget {
  const MinistrySelectorScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final ministries = ministryState.availableMinistries;
    final isLoading = ministryState.isLoading;

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Selecionar Ministério',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            tooltip: 'Atualizar ministérios',
            icon: const Icon(Icons.refresh),
            onPressed: isLoading
                ? null
                : () async {
                    await ref
                        .read(ministryContextNotifierProvider.notifier)
                        .refresh();
                  },
          ),
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
        child: RefreshIndicator(
          onRefresh: () async {
            await ref.read(ministryContextNotifierProvider.notifier).refresh();
          },
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 600),
              child: ListView(
                padding: const EdgeInsets.all(24.0),
                children: [
                  Text(
                    'Seus Ministérios de Louvor',
                    style: theme.textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Você faz parte de mais de um ministério. Escolha qual contexto deseja acessar agora:',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                    ),
                  ),
                  const SizedBox(height: 24),
                  if (isLoading && ministries.isEmpty) ...[
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 48.0),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  ] else ...[
                    for (final ministry in ministries)
                      _MinistryCard(
                        ministry: ministry,
                        onTap: () async {
                          await ref
                              .read(ministryContextNotifierProvider.notifier)
                              .selectMinistry(ministry);
                        },
                      ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _MinistryCard extends StatelessWidget {
  final Ministry ministry;
  final VoidCallback onTap;

  const _MinistryCard({
    required this.ministry,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;

    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Card(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: theme.dividerColor.withValues(alpha: 0.2),
          ),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundColor: theme.colorScheme.primary.withValues(
                    alpha: isDark ? 0.3 : 0.1,
                  ),
                  child: Icon(
                    Icons.church_outlined,
                    color: theme.colorScheme.primary,
                    size: 24,
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        ministry.name,
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 2,
                            ),
                            decoration: BoxDecoration(
                              color: ministry.isAdmin
                                  ? theme.colorScheme.secondary
                                      .withValues(alpha: 0.15)
                                  : theme.colorScheme.primary
                                      .withValues(alpha: 0.1),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              ministry.roleLabel,
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: ministry.isAdmin
                                    ? theme.colorScheme.secondary
                                    : theme.colorScheme.primary,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Icon(
                  Icons.arrow_forward_ios_rounded,
                  size: 16,
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.4),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
