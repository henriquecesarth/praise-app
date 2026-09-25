import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/providers.dart';
import '../../ministry_context/domain/ministry.dart';
import '../../ministry_context/presentation/widgets/ministry_switcher_sheet.dart';
import 'controllers/dashboard_controller.dart';
import 'widgets/announcement_card.dart';
import 'widgets/upcoming_schedule_card.dart';

/// Full native Dashboard view (Início tab) with real backend data.
class DashboardView extends ConsumerStatefulWidget {
  final Ministry? selectedMinistry;
  final bool hasMultipleMinistries;
  final ValueChanged<int> onNavigateToTab;

  const DashboardView({
    super.key,
    required this.selectedMinistry,
    required this.hasMultipleMinistries,
    required this.onNavigateToTab,
  });

  @override
  ConsumerState<DashboardView> createState() => _DashboardViewState();
}

class _DashboardViewState extends ConsumerState<DashboardView> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _loadData();
    });
  }

  @override
  void didUpdateWidget(DashboardView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selectedMinistry?.id != widget.selectedMinistry?.id) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _loadData();
        }
      });
    }
  }

  void _loadData() {
    final ministryId = widget.selectedMinistry?.id;
    if (ministryId != null) {
      ref.read(dashboardNotifierProvider.notifier).loadForMinistry(ministryId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final dashboardState = ref.watch(dashboardNotifierProvider);
    final user = ref.watch(authNotifierProvider).user;
    final userName = user?.name.isNotEmpty == true ? user!.name : 'Músico';

    final upcoming = dashboardState.upcomingSchedules();
    final displayedSchedules = upcoming.take(3).toList();
    final announcements = dashboardState.announcements;

    final isWide = MediaQuery.of(context).size.width >= 600;

    return SafeArea(
      child: RefreshIndicator(
        onRefresh: () => ref.read(dashboardNotifierProvider.notifier).refresh(),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: 20.0, vertical: 16.0),
          children: [
            // 1. Header & Greeting
            _buildHeader(context, userName, isDark),
            const SizedBox(height: 16),

            // 2. Active Ministry Card
            if (widget.selectedMinistry != null) ...[
              _buildMinistryBanner(context, widget.selectedMinistry!, isDark),
              const SizedBox(height: 24),
            ],

            // 3. Responsive Content
            if (isWide)
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Left Column: Upcoming Schedules
                  Expanded(
                    flex: 1,
                    child: _buildSchedulesSection(
                      context,
                      dashboardState,
                      displayedSchedules,
                      upcoming.length,
                    ),
                  ),
                  const SizedBox(width: 24),
                  // Right Column: Announcements
                  Expanded(
                    flex: 1,
                    child: _buildAnnouncementsSection(
                      context,
                      dashboardState,
                      announcements,
                    ),
                  ),
                ],
              )
            else ...[
              // Compact Phone: Vertical Stack
              _buildSchedulesSection(
                context,
                dashboardState,
                displayedSchedules,
                upcoming.length,
              ),
              const SizedBox(height: 28),
              _buildAnnouncementsSection(
                context,
                dashboardState,
                announcements,
              ),
            ],
            const SizedBox(height: 32),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(BuildContext context, String userName, bool isDark) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(
              Icons.auto_awesome,
              size: 16,
              color: theme.colorScheme.primary,
            ),
            const SizedBox(width: 6),
            Text(
              'PAINEL DO INTEGRANTE',
              style: theme.textTheme.labelSmall?.copyWith(
                fontWeight: FontWeight.bold,
                letterSpacing: 0.8,
                color: theme.colorScheme.primary,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          'Olá, $userName! 👋',
          style: theme.textTheme.headlineSmall?.copyWith(
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          'Confira suas escalas e os comunicados da sua equipe.',
          style: theme.textTheme.bodyMedium?.copyWith(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
          ),
        ),
      ],
    );
  }

  Widget _buildMinistryBanner(
    BuildContext context,
    Ministry ministry,
    bool isDark,
  ) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: BoxDecoration(
        color:
            theme.colorScheme.primary.withValues(alpha: isDark ? 0.12 : 0.06),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: theme.colorScheme.primary.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 20,
            backgroundColor: theme.colorScheme.primary
                .withValues(alpha: isDark ? 0.3 : 0.15),
            child: Icon(
              Icons.church,
              size: 20,
              color: theme.colorScheme.primary,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  ministry.name,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 2,
                      ),
                      decoration: BoxDecoration(
                        color: ministry.isAdmin
                            ? theme.colorScheme.primary.withValues(alpha: 0.2)
                            : theme.colorScheme.secondary
                                .withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        ministry.roleLabel.toUpperCase(),
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: ministry.isAdmin
                              ? theme.colorScheme.primary
                              : theme.colorScheme.secondary,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (widget.hasMultipleMinistries)
            TextButton.icon(
              onPressed: () => MinistrySwitcherSheet.show(context),
              icon: const Icon(Icons.swap_horiz, size: 18),
              label: const Text('Trocar'),
              style: TextButton.styleFrom(
                visualDensity: VisualDensity.compact,
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildSchedulesSection(
    BuildContext context,
    DashboardState state,
    List<dynamic> displayedSchedules,
    int totalUpcoming,
  ) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Section Header
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Row(
                children: [
                  Icon(
                    Icons.calendar_month_outlined,
                    size: 20,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Flexible(
                    child: Text(
                      'Próximas Escalas',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
            ),
            TextButton(
              onPressed: () => widget.onNavigateToTab(1),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text('Ver todas'),
                  SizedBox(width: 4),
                  Icon(Icons.arrow_forward, size: 14),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),

        // Section Content
        if (state.isSchedulesLoading && state.schedules.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24.0),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (state.schedulesError != null && state.schedules.isEmpty)
          _buildErrorBox(
            context,
            message: state.schedulesError!,
            onRetry: () =>
                ref.read(dashboardNotifierProvider.notifier).retrySchedules(),
          )
        else if (displayedSchedules.isEmpty)
          _buildEmptyBox(
            context,
            icon: Icons.event_busy_outlined,
            message: 'Nenhuma próxima escala agendada.',
            actionLabel: 'Ver todas as escalas',
            onAction: () => widget.onNavigateToTab(1),
          )
        else ...[
          for (final schedule in displayedSchedules) ...[
            UpcomingScheduleCard(
              schedule: schedule,
              onTap: () => widget.onNavigateToTab(1),
            ),
            const SizedBox(height: 10),
          ],
        ],
      ],
    );
  }

  Widget _buildAnnouncementsSection(
    BuildContext context,
    DashboardState state,
    List<dynamic> announcements,
  ) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Section Header
        Row(
          children: [
            Icon(
              Icons.campaign_outlined,
              size: 20,
              color: Colors.amber.shade700,
            ),
            const SizedBox(width: 8),
            Text(
              'Avisos da Equipe',
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            if (announcements.isNotEmpty) ...[
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.amber.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${announcements.length}',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: Colors.amber.shade800,
                  ),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: 12),

        // Section Content
        if (state.isAnnouncementsLoading && announcements.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 24.0),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (state.announcementsError != null && announcements.isEmpty)
          _buildErrorBox(
            context,
            message: state.announcementsError!,
            onRetry: () => ref
                .read(dashboardNotifierProvider.notifier)
                .retryAnnouncements(),
          )
        else if (announcements.isEmpty)
          _buildEmptyBox(
            context,
            icon: Icons.announcement_outlined,
            message: 'Nenhum aviso publicado no momento.',
          )
        else ...[
          for (final announcement in announcements) ...[
            AnnouncementCard(announcement: announcement),
            const SizedBox(height: 10),
          ],
        ],
      ],
    );
  }

  Widget _buildEmptyBox(
    BuildContext context, {
    required IconData icon,
    required String message,
    String? actionLabel,
    VoidCallback? onAction,
  }) {
    final theme = Theme.of(context);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 28),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: theme.dividerColor.withValues(alpha: 0.15),
        ),
      ),
      child: Column(
        children: [
          Icon(
            icon,
            size: 40,
            color: theme.colorScheme.onSurface.withValues(alpha: 0.35),
          ),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: theme.textTheme.bodyMedium?.copyWith(
              color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
            ),
          ),
          if (actionLabel != null && onAction != null) ...[
            const SizedBox(height: 14),
            OutlinedButton(
              onPressed: onAction,
              style: OutlinedButton.styleFrom(
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: Text(actionLabel),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildErrorBox(
    BuildContext context, {
    required String message,
    required VoidCallback onRetry,
  }) {
    final theme = Theme.of(context);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.red.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.red.withValues(alpha: 0.25)),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(Icons.error_outline, color: Colors.red, size: 20),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  message,
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: Colors.red.shade800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Tentar novamente'),
              style: TextButton.styleFrom(
                foregroundColor: Colors.red.shade800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
