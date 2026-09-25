import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../features/dashboard/presentation/dashboard_view.dart';
import '../../features/ministry_context/domain/ministry.dart';
import '../../features/ministry_context/presentation/widgets/ministry_switcher_sheet.dart';
import '../../features/schedules/presentation/views/schedules_view.dart';
import '../providers.dart';

/// Responsive native application shell for LouvAIO Mobile.
///
/// Automatically adapts between compact (phone) bottom NavigationBar and
/// wide (tablet) side NavigationRail at a 600dp breakpoint.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _currentIndex = 0;

  @override
  Widget build(BuildContext context) {
    final environment = ref.watch(appEnvironmentProvider);
    final ministryState = ref.watch(ministryContextNotifierProvider);
    final selectedMinistry = ministryState.selectedMinistry;
    final availableMinistries = ministryState.availableMinistries;
    final theme = Theme.of(context);
    final width = MediaQuery.sizeOf(context).width;
    final isTablet = width >= 600;

    // Loading / error states within shell
    if (ministryState.isLoading && selectedMinistry == null) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    if (ministryState.hasError && selectedMinistry == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('LouvAIO')),
        body: Center(
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
                  ministryState.failure?.message ??
                      'Não foi possível carregar os dados do ministério.',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.titleMedium,
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: () {
                    ref
                        .read(ministryContextNotifierProvider.notifier)
                        .bootstrap();
                  },
                  icon: const Icon(Icons.refresh),
                  label: const Text('Tentar novamente'),
                ),
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () {
                    ref.read(authNotifierProvider.notifier).logout();
                  },
                  child: const Text('Sair da Conta'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final views = [
      DashboardView(
        selectedMinistry: selectedMinistry,
        hasMultipleMinistries: availableMinistries.length > 1,
        onNavigateToTab: (index) => setState(() => _currentIndex = index),
      ),
      SchedulesView(ministryId: selectedMinistry?.id),
      const _RepertoirePlaceholderView(),
      _ProfileView(
        selectedMinistry: selectedMinistry,
        hasMultipleMinistries: availableMinistries.length > 1,
      ),
    ];

    final appBar = AppBar(
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
        if (selectedMinistry != null)
          Padding(
            padding: const EdgeInsets.only(right: 8.0),
            child: availableMinistries.length > 1
                ? TextButton.icon(
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                        side: BorderSide(
                          color: theme.dividerColor.withValues(alpha: 0.3),
                        ),
                      ),
                    ),
                    onPressed: () => MinistrySwitcherSheet.show(context),
                    icon: Icon(
                      Icons.church_outlined,
                      size: 18,
                      color: theme.colorScheme.primary,
                    ),
                    label: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 140),
                          child: Text(
                            selectedMinistry.name,
                            overflow: TextOverflow.ellipsis,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        const SizedBox(width: 4),
                        const Icon(Icons.arrow_drop_down, size: 18),
                      ],
                    ),
                  )
                : Chip(
                    avatar: Icon(
                      Icons.church_outlined,
                      size: 16,
                      color: theme.colorScheme.primary,
                    ),
                    label: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 140),
                      child: Text(
                        selectedMinistry.name,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ),
                  ),
          ),
      ],
    );

    if (isTablet) {
      // Tablet layout: Side NavigationRail + Body
      return Scaffold(
        appBar: appBar,
        body: Row(
          children: [
            NavigationRail(
              selectedIndex: _currentIndex,
              onDestinationSelected: (index) {
                setState(() => _currentIndex = index);
              },
              labelType: NavigationRailLabelType.all,
              destinations: const [
                NavigationRailDestination(
                  icon: Icon(Icons.home_outlined),
                  selectedIcon: Icon(Icons.home),
                  label: Text('Início'),
                ),
                NavigationRailDestination(
                  icon: Icon(Icons.calendar_today_outlined),
                  selectedIcon: Icon(Icons.calendar_today),
                  label: Text('Escalas'),
                ),
                NavigationRailDestination(
                  icon: Icon(Icons.queue_music_outlined),
                  selectedIcon: Icon(Icons.queue_music),
                  label: Text('Repertório'),
                ),
                NavigationRailDestination(
                  icon: Icon(Icons.person_outline),
                  selectedIcon: Icon(Icons.person),
                  label: Text('Perfil'),
                ),
              ],
            ),
            const VerticalDivider(thickness: 1, width: 1),
            Expanded(
              child: views[_currentIndex],
            ),
          ],
        ),
      );
    }

    // Phone layout: Body + Bottom NavigationBar
    return Scaffold(
      appBar: appBar,
      body: views[_currentIndex],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _currentIndex,
        onDestinationSelected: (index) {
          setState(() => _currentIndex = index);
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Início',
          ),
          NavigationDestination(
            icon: Icon(Icons.calendar_today_outlined),
            selectedIcon: Icon(Icons.calendar_today),
            label: 'Escalas',
          ),
          NavigationDestination(
            icon: Icon(Icons.queue_music_outlined),
            selectedIcon: Icon(Icons.queue_music),
            label: 'Repertório',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Perfil',
          ),
        ],
      ),
    );
  }
}

/// Repertoire tab placeholder (M6).
class _RepertoirePlaceholderView extends StatelessWidget {
  const _RepertoirePlaceholderView();

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircleAvatar(
              radius: 36,
              backgroundColor: theme.colorScheme.primary.withValues(alpha: 0.1),
              child: Icon(
                Icons.queue_music_outlined,
                size: 36,
                color: theme.colorScheme.primary,
              ),
            ),
            const SizedBox(height: 20),
            Text(
              'Repertório Musical',
              style: theme.textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'O catálogo de músicas, versões, cifras inteligentes transponíveis e arranjos estarão disponíveis nesta seção no módulo M6.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                height: 1.5,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Profile tab displaying authoritative identity, current ministry context, and logout.
class _ProfileView extends ConsumerWidget {
  final Ministry? selectedMinistry;
  final bool hasMultipleMinistries;

  const _ProfileView({
    required this.selectedMinistry,
    required this.hasMultipleMinistries,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);
    final authState = ref.watch(authNotifierProvider);
    final user = authState.user;
    final environment = ref.watch(appEnvironmentProvider);

    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(20.0),
        children: [
          // User Card
          Card(
            elevation: 0,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
              side: BorderSide(
                color: theme.dividerColor.withValues(alpha: 0.2),
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(20.0),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 28,
                    backgroundColor:
                        theme.colorScheme.secondary.withValues(alpha: 0.15),
                    child: Icon(
                      Icons.person,
                      size: 28,
                      color: theme.colorScheme.secondary,
                    ),
                  ),
                  const SizedBox(width: 16),
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
                        if (user?.email.isNotEmpty == true) ...[
                          const SizedBox(height: 4),
                          Text(
                            user!.email,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.7),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // Ministry Context Card
          if (selectedMinistry != null)
            Card(
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
                side: BorderSide(
                  color: theme.dividerColor.withValues(alpha: 0.2),
                ),
              ),
              child: Padding(
                padding: const EdgeInsets.all(20.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Contexto do Ministério',
                      style: theme.textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: theme.colorScheme.primary,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Ministério:'),
                        Text(
                          selectedMinistry!.name,
                          style: const TextStyle(fontWeight: FontWeight.bold),
                        ),
                      ],
                    ),
                    const SizedBox(height: 10),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text('Função:'),
                        Text(
                          selectedMinistry!.roleLabel,
                          style: TextStyle(
                            fontWeight: FontWeight.bold,
                            color: selectedMinistry!.isAdmin
                                ? theme.colorScheme.secondary
                                : theme.colorScheme.primary,
                          ),
                        ),
                      ],
                    ),
                    if (hasMultipleMinistries) ...[
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          onPressed: () => MinistrySwitcherSheet.show(context),
                          icon: const Icon(Icons.swap_horiz_rounded),
                          label: const Text('Trocar de Ministério'),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          const SizedBox(height: 16),

          // Actions
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.refresh),
            title: const Text('Atualizar Dados'),
            subtitle:
                const Text('Recarrega permissões e associações com o servidor'),
            onTap: () async {
              await ref
                  .read(ministryContextNotifierProvider.notifier)
                  .refresh();
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(
                    content: Text('Dados atualizados com sucesso.'),
                    duration: Duration(seconds: 2),
                  ),
                );
              }
            },
          ),
          const Divider(),
          const SizedBox(height: 8),

          // Logout
          SizedBox(
            width: double.infinity,
            height: 48,
            child: OutlinedButton.icon(
              style: OutlinedButton.styleFrom(
                foregroundColor: theme.colorScheme.error,
                side: BorderSide(
                  color: theme.colorScheme.error.withValues(alpha: 0.5),
                ),
              ),
              onPressed: () async {
                await ref.read(authNotifierProvider.notifier).logout();
              },
              icon: const Icon(Icons.logout),
              label: const Text('Sair da Conta'),
            ),
          ),

          // Non-production developer surface only
          if (!environment.isProduction) ...[
            const SizedBox(height: 24),
            ExpansionTile(
              title: Text(
                'Informações Técnicas (DEV)',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.5),
                ),
              ),
              children: [
                Padding(
                  padding: const EdgeInsets.all(12.0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'UID: ',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace',
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'API: ',
                        style: theme.textTheme.bodySmall?.copyWith(
                          fontFamily: 'monospace',
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
