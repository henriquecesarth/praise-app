import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/app/providers.dart';
import '../../../../core/utils/date_utils.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../schedules/domain/ministry_member.dart';
import '../../domain/consolidated_availability.dart';
import '../controllers/admin_availability_controller.dart';
import '../widgets/consolidated_availability_card.dart';
import 'manual_member_availability_screen.dart';

/// Full screen view for administrative consolidated availability across ministry members.
///
/// Implements M12B-1:
/// - Admin-only role authorization and UI gating.
/// - Civil date range filtering (7d, 15d, 30d, this_month, custom up to 90 days).
/// - Member filter.
/// - Privacy preservation: reason is omitted from display.
/// - Tenant-switch race and generation safety.
/// - Responsive phone and tablet layout (max 800dp).
class AdminAvailabilityScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final String? ministryName;

  const AdminAvailabilityScreen({
    super.key,
    required this.ministryId,
    this.ministryName,
  });

  @override
  ConsumerState<AdminAvailabilityScreen> createState() =>
      _AdminAvailabilityScreenState();
}

class _AdminAvailabilityScreenState
    extends ConsumerState<AdminAvailabilityScreen> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
    });
  }

  @override
  void didUpdateWidget(AdminAvailabilityScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _load() {
    ref.read(adminAvailabilityNotifierProvider.notifier).loadForMinistry(
          widget.ministryId,
        );
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(adminAvailabilityNotifierProvider.notifier).loadMore();
    }
  }

  Future<void> _pickCustomDate({required bool isStartDate}) async {
    final state = ref.read(adminAvailabilityNotifierProvider);
    final initialDate = isStartDate
        ? (AvailabilityPlanningPeriod.parseIsoDate(state.from) ?? DateTime.now())
        : (AvailabilityPlanningPeriod.parseIsoDate(state.to) ?? DateTime.now());

    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2000, 1, 1),
      lastDate: DateTime(2100, 12, 31),
    );

    if (picked != null && mounted) {
      final isoPicked = AvailabilityPlanningPeriod.formatIsoDate(picked);
      final newFrom = isStartDate ? isoPicked : state.from;
      final newTo = isStartDate ? state.to : isoPicked;

      await ref
          .read(adminAvailabilityNotifierProvider.notifier)
          .setCustomRange(newFrom, newTo);
    }
  }

  void _openMemberFilterSheet(List<MinistryMember> members, String? selectedId) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20.0),
                  child: Text(
                    'Filtrar por integrante',
                    style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ),
                const SizedBox(height: 8),
                ListTile(
                  title: const Text('Todos os integrantes'),
                  leading: const Icon(Icons.people_outline),
                  trailing: selectedId == null
                      ? const Icon(Icons.check, color: Colors.green)
                      : null,
                  onTap: () {
                    Navigator.of(ctx).pop();
                    ref
                        .read(adminAvailabilityNotifierProvider.notifier)
                        .setMemberFilter(null);
                  },
                ),
                const Divider(),
                ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.sizeOf(ctx).height * 0.5,
                  ),
                  child: ListView.builder(
                    shrinkWrap: true,
                    itemCount: members.length,
                    itemBuilder: (context, index) {
                      final m = members[index];
                      final isSelected = m.id == selectedId;
                      return ListTile(
                        title: Text(m.name),
                        subtitle: Text(
                          m.roleLabel + (m.isManual ? ' • Manual' : ''),
                        ),
                        trailing: isSelected
                            ? const Icon(Icons.check, color: Colors.green)
                            : null,
                        onTap: () {
                          Navigator.of(ctx).pop();
                          ref
                              .read(adminAvailabilityNotifierProvider.notifier)
                              .setMemberFilter(m.id);
                        },
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  void _openManualMemberPicker(List<MinistryMember> members) {
    final eligible = members.where(ManualMemberEligibility.isEligible).toList();

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 16.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20.0),
                  child: Text(
                    'Gerenciar integrante manual',
                    style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                ),
                const SizedBox(height: 4),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20.0),
                  child: Text(
                    'Selecione um integrante de cadastro manual para gerenciar suas indisponibilidades:',
                    style: Theme.of(ctx).textTheme.bodySmall?.copyWith(
                          color: Theme.of(ctx)
                              .colorScheme
                              .onSurface
                              .withValues(alpha: 0.7),
                        ),
                  ),
                ),
                const SizedBox(height: 12),
                if (eligible.isEmpty)
                  const Padding(
                    padding: EdgeInsets.all(24.0),
                    child: Center(
                      child: Text(
                        'Nenhum integrante manual cadastrado neste ministério.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                else
                  ConstrainedBox(
                    constraints: BoxConstraints(
                      maxHeight: MediaQuery.sizeOf(ctx).height * 0.5,
                    ),
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: eligible.length,
                      itemBuilder: (context, index) {
                        final m = eligible[index];
                        return ListTile(
                          leading: const CircleAvatar(
                            child: Icon(Icons.person_outline, size: 20),
                          ),
                          title: Text(m.name),
                          subtitle: const Text('Cadastro manual'),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () {
                            Navigator.of(ctx).pop();
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (_) =>
                                    ManualMemberAvailabilityScreen(
                                  ministryId: widget.ministryId,
                                  member: m,
                                ),
                              ),
                            );
                          },
                        );
                      },
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    // Tenant-switch protection: if active ministry switches away, pop immediately!
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null && newMinistryId != widget.ministryId) {
        if (mounted) {
          Navigator.of(context).maybePop();
        }
      }
    });

    final theme = Theme.of(context);
    final state = ref.watch(adminAvailabilityNotifierProvider);
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
              'Disponibilidade da Equipe',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
            ),
            if (widget.ministryName != null)
              Text(
                widget.ministryName!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.7),
                ),
              ),
          ],
        ),
        actions: [
          if (isViewerAdmin)
            IconButton(
              tooltip: 'Gerenciar manual',
              icon: const Icon(Icons.person_add_alt_1_outlined),
              onPressed: () => _openManualMemberPicker(state.members),
            ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 800),
          child: Column(
            children: [
              // Filter Card: Presets + Date Pickers + Member filter
              _buildFilterCard(context, state),

              // Range error banner if any
              if (state.rangeError != null)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
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
                          state.rangeError!,
                          style: TextStyle(
                            color: theme.colorScheme.onErrorContainer,
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),

              // Main Content
              Expanded(
                child: _buildBody(context, state, isViewerAdmin),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterCard(BuildContext context, AdminAvailabilityState state) {
    final theme = Theme.of(context);
    final selectedPreset = state.selectedPreset;
    final notifier = ref.read(adminAvailabilityNotifierProvider.notifier);

    // Selected member name
    String memberFilterLabel = 'Todos os integrantes';
    if (state.selectedMemberId != null) {
      final found = state.members
          .where((m) => m.id == state.selectedMemberId)
          .firstOrNull;
      if (found != null) {
        memberFilterLabel = found.name;
      }
    }

    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        border: Border(
          bottom: BorderSide(
            color: theme.dividerColor.withValues(alpha: 0.15),
          ),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Preset chips
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _buildPresetChip(
                  label: '7 dias',
                  presetKey: '7d',
                  isSelected: selectedPreset == '7d',
                  onSelected: () => notifier.setPreset('7d'),
                ),
                const SizedBox(width: 8),
                _buildPresetChip(
                  label: '15 dias',
                  presetKey: '15d',
                  isSelected: selectedPreset == '15d',
                  onSelected: () => notifier.setPreset('15d'),
                ),
                const SizedBox(width: 8),
                _buildPresetChip(
                  label: '30 dias',
                  presetKey: '30d',
                  isSelected: selectedPreset == '30d',
                  onSelected: () => notifier.setPreset('30d'),
                ),
                const SizedBox(width: 8),
                _buildPresetChip(
                  label: 'Mês atual',
                  presetKey: 'this_month',
                  isSelected: selectedPreset == 'this_month',
                  onSelected: () => notifier.setPreset('this_month'),
                ),
                const SizedBox(width: 8),
                _buildPresetChip(
                  label: 'Personalizado',
                  presetKey: 'custom',
                  isSelected: selectedPreset == 'custom',
                  onSelected: () {
                    if (selectedPreset != 'custom') {
                      notifier.setPreset('custom');
                    }
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 8),

          // Custom range pickers if 'custom'
          if (selectedPreset == 'custom') ...[
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.calendar_today, size: 16),
                    label: Text(
                      state.from.isNotEmpty
                          ? AppDateUtils.formatDatePtBR(state.from)
                          : 'Data inicial',
                      overflow: TextOverflow.ellipsis,
                    ),
                    onPressed: () => _pickCustomDate(isStartDate: true),
                  ),
                ),
                const SizedBox(width: 8),
                const Text('a'),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(44),
                      visualDensity: VisualDensity.compact,
                    ),
                    icon: const Icon(Icons.calendar_today, size: 16),
                    label: Text(
                      state.to.isNotEmpty
                          ? AppDateUtils.formatDatePtBR(state.to)
                          : 'Data final',
                      overflow: TextOverflow.ellipsis,
                    ),
                    onPressed: () => _pickCustomDate(isStartDate: false),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
          ],

          // Member Filter Button
          Row(
            children: [
              Expanded(
                child: InkWell(
                  borderRadius: BorderRadius.circular(8),
                  onTap: () => _openMemberFilterSheet(
                    state.members,
                    state.selectedMemberId,
                  ),
                  child: Container(
                    height: 44,
                    padding: const EdgeInsets.symmetric(horizontal: 12),
                    decoration: BoxDecoration(
                      border: Border.all(
                        color: theme.dividerColor.withValues(alpha: 0.3),
                      ),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          Icons.filter_list_rounded,
                          size: 18,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            memberFilterLabel,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              fontWeight: FontWeight.w500,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        if (state.selectedMemberId != null)
                          IconButton(
                            icon: const Icon(Icons.close, size: 16),
                            tooltip: 'Remover filtro',
                            onPressed: () => notifier.setMemberFilter(null),
                          )
                        else
                          const Icon(Icons.arrow_drop_down, size: 20),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildPresetChip({
    required String label,
    required String presetKey,
    required bool isSelected,
    required VoidCallback onSelected,
  }) {
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      onSelected: (_) => onSelected(),
    );
  }

  Widget _buildBody(
    BuildContext context,
    AdminAvailabilityState state,
    bool isViewerAdmin,
  ) {
    final theme = Theme.of(context);

    // 1. Unauthorized / 403
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
                'Apenas administradores do ministério têm permissão para acessar a disponibilidade consolidada da equipe.',
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

    // 2. Initial Loading
    if (state.isLoading && state.items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    // 3. Error with retry
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
                onPressed: () {
                  ref
                      .read(adminAvailabilityNotifierProvider.notifier)
                      .loadForMinistry(widget.ministryId);
                },
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    // 4. Empty State
    if (state.items.isEmpty) {
      return RefreshIndicator(
        onRefresh: () =>
            ref.read(adminAvailabilityNotifierProvider.notifier).refresh(),
        child: ListView(
          controller: _scrollController,
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(32),
          children: [
            const SizedBox(height: 48),
            Icon(
              Icons.event_available_outlined,
              size: 56,
              color: theme.colorScheme.primary.withValues(alpha: 0.6),
            ),
            const SizedBox(height: 16),
            Text(
              'Todos disponíveis!',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              'Nenhum integrante registrou indisponibilidade para o período selecionado.',
              textAlign: TextAlign.center,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
              ),
            ),
            const SizedBox(height: 24),
            Center(
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size(160, 44),
                ),
                onPressed: () {
                  ref
                      .read(adminAvailabilityNotifierProvider.notifier)
                      .refresh();
                },
                icon: const Icon(Icons.refresh, size: 16),
                label: const Text('Atualizar'),
              ),
            ),
          ],
        ),
      );
    }

    // 5. Populated List
    return RefreshIndicator(
      onRefresh: () =>
          ref.read(adminAvailabilityNotifierProvider.notifier).refresh(),
      child: ListView.builder(
        controller: _scrollController,
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        itemCount: state.items.length + (state.isLoadingMore ? 1 : 0),
        itemBuilder: (context, index) {
          if (index == state.items.length) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 16.0),
              child: Center(child: CircularProgressIndicator()),
            );
          }

          final item = state.items[index];

          // Check if member is manual to offer direct management
          final member = state.members
              .where((m) => m.id == item.memberId)
              .firstOrNull;
          final isManual = member != null && ManualMemberEligibility.isEligible(member);

          return ConsolidatedAvailabilityCard(
            item: item,
            onTap: isManual
                ? () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => ManualMemberAvailabilityScreen(
                          ministryId: widget.ministryId,
                          member: member,
                        ),
                      ),
                    );
                  }
                : null,
          );
        },
      ),
    );
  }
}
