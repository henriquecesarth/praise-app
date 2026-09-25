import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../domain/schedule.dart';
import '../controllers/schedule_list_controller.dart';
import '../controllers/schedule_providers.dart';
import '../widgets/schedule_card.dart';
import 'schedule_detail_view.dart';

/// Member-facing Escalas list screen with Próximas / Anteriores tabs.
///
/// Replaces the M4 placeholder. Read-only — no creation or edit actions.
class SchedulesView extends ConsumerStatefulWidget {
  final String? ministryId;

  const SchedulesView({super.key, required this.ministryId});

  @override
  ConsumerState<SchedulesView> createState() => _SchedulesViewState();
}

class _SchedulesViewState extends ConsumerState<SchedulesView>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
    });
  }

  @override
  void didUpdateWidget(SchedulesView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }
  }

  void _load() {
    final ministryId = widget.ministryId;
    if (ministryId != null) {
      ref
          .read(scheduleListNotifierProvider.notifier)
          .loadForMinistry(ministryId);
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(scheduleListNotifierProvider);
    final isWide = MediaQuery.sizeOf(context).width >= 600;

    Widget content;

    if (state.ministryId == null) {
      content = const _CenteredInfo(
        icon: Icons.church_outlined,
        message: 'Selecione um ministério para ver as escalas.',
      );
    } else if (state.isLoading) {
      content = const Center(child: CircularProgressIndicator());
    } else if (state.error != null) {
      content = _ErrorState(
        message: state.error!,
        onRetry: () => ref.read(scheduleListNotifierProvider.notifier).retry(),
      );
    } else {
      content = _TabContent(
        tabController: _tabController,
        listState: state,
        ministryId: widget.ministryId!,
        isWide: isWide,
        onRefresh: () =>
            ref.read(scheduleListNotifierProvider.notifier).refresh(),
      );
    }

    return SafeArea(
      child: Column(
        children: [
          if (state.ministryId != null &&
              !state.isLoading &&
              state.error == null)
            TabBar(
              controller: _tabController,
              tabs: const [
                Tab(text: 'Próximas'),
                Tab(text: 'Anteriores'),
              ],
            ),
          Expanded(child: content),
        ],
      ),
    );
  }
}

class _TabContent extends StatelessWidget {
  final TabController tabController;
  final ScheduleListState listState;
  final String ministryId;
  final bool isWide;
  final Future<void> Function() onRefresh;

  const _TabContent({
    required this.tabController,
    required this.listState,
    required this.ministryId,
    required this.isWide,
    required this.onRefresh,
  });

  @override
  Widget build(BuildContext context) {
    final upcoming = listState.upcomingSchedules();
    final past = listState.pastSchedules();

    return TabBarView(
      controller: tabController,
      children: [
        _ScheduleTab(
          schedules: upcoming,
          emptyMessage: 'Nenhuma escala próxima encontrada.',
          emptyIcon: Icons.event_available_outlined,
          ministryId: ministryId,
          isWide: isWide,
          onRefresh: onRefresh,
          isRefreshing: listState.isRefreshing,
        ),
        _ScheduleTab(
          schedules: past,
          emptyMessage: 'Nenhuma escala anterior registrada.',
          emptyIcon: Icons.history_outlined,
          ministryId: ministryId,
          isWide: isWide,
          onRefresh: onRefresh,
          isRefreshing: listState.isRefreshing,
        ),
      ],
    );
  }
}

class _ScheduleTab extends StatelessWidget {
  final List<ScheduleSummary> schedules;
  final String emptyMessage;
  final IconData emptyIcon;
  final String ministryId;
  final bool isWide;
  final Future<void> Function() onRefresh;
  final bool isRefreshing;

  const _ScheduleTab({
    required this.schedules,
    required this.emptyMessage,
    required this.emptyIcon,
    required this.ministryId,
    required this.isWide,
    required this.onRefresh,
    required this.isRefreshing,
  });

  @override
  Widget build(BuildContext context) {
    if (schedules.isEmpty) {
      return RefreshIndicator(
        onRefresh: onRefresh,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: SizedBox(
            height: 400,
            child: _CenteredInfo(icon: emptyIcon, message: emptyMessage),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: EdgeInsets.symmetric(
          horizontal: isWide ? 48 : 16,
          vertical: 12,
        ),
        itemCount: schedules.length,
        itemBuilder: (context, index) {
          final schedule = schedules[index];
          return ScheduleCard(
            schedule: schedule,
            onTap: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => ScheduleDetailView(
                    ministryId: ministryId,
                    scheduleId: schedule.id,
                    initialTitle: schedule.title,
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorState({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline_rounded,
                size: 48, color: theme.colorScheme.error),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium,
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: const Text('Tentar novamente'),
            ),
          ],
        ),
      ),
    );
  }
}

class _CenteredInfo extends StatelessWidget {
  final IconData icon;
  final String message;

  const _CenteredInfo({required this.icon, required this.message});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon,
                size: 48,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.4)),
            const SizedBox(height: 16),
            Text(
              message,
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
