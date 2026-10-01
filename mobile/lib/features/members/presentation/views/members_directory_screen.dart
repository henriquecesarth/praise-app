import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:louvaio_mobile/app/providers.dart';
import 'package:louvaio_mobile/features/ministry_context/presentation/controllers/ministry_context_controller.dart';
import 'package:louvaio_mobile/features/schedules/domain/ministry_member.dart';
import 'package:louvaio_mobile/features/members/presentation/controllers/members_controller.dart';
import 'package:louvaio_mobile/features/members/presentation/controllers/members_providers.dart';
import 'package:louvaio_mobile/features/members/presentation/widgets/member_card.dart';
import 'package:louvaio_mobile/features/members/presentation/widgets/member_detail_sheet.dart';

/// Screen displaying the ministry member directory with search and role filters.
///
/// Responsive for phone and tablet. Keyed by [ministryId] and protected
/// against tenant-switch stale state.
class MembersDirectoryScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final String? ministryName;

  const MembersDirectoryScreen({
    super.key,
    required this.ministryId,
    this.ministryName,
  });

  @override
  ConsumerState<MembersDirectoryScreen> createState() =>
      _MembersDirectoryScreenState();
}

class _MembersDirectoryScreenState
    extends ConsumerState<MembersDirectoryScreen> {
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _load();
    });
  }

  @override
  void didUpdateWidget(MembersDirectoryScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.ministryId != widget.ministryId) {
      _searchController.clear();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _load();
      });
    }
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _load() {
    ref
        .read(membersDirectoryNotifierProvider.notifier)
        .loadForMinistry(widget.ministryId);
  }

  void _onMemberTapped(MinistryMember member, MembersDirectoryState state) {
    MemberDetailSheet.show(
      context: context,
      member: member,
      rolesById: state.rolesById,
    );
  }

  @override
  Widget build(BuildContext context) {
    // Tenant-switch protection: if active ministry switches away, pop screen
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
    final state = ref.watch(membersDirectoryNotifierProvider);
    final isMatchingMinistry = state.ministryId == widget.ministryId;
    final filtered = isMatchingMinistry ? state.filteredMembers : <MinistryMember>[];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Integrantes',
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
          if (isMatchingMinistry && state.members.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(right: 16.0),
              child: Center(
                child: Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.primaryContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '${state.members.length} ${state.members.length == 1 ? 'membro' : 'membros'}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: theme.colorScheme.onPrimaryContainer,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            // Search Bar & Filter Chips
            if (isMatchingMinistry && !state.isLoading && state.error == null) ...[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                child: TextField(
                  key: const ValueKey('member_search_input'),
                  controller: _searchController,
                  decoration: InputDecoration(
                    hintText: 'Buscar integrante por nome, e-mail...',
                    prefixIcon: const Icon(Icons.search, size: 20),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: const Icon(Icons.clear, size: 18),
                            onPressed: () {
                              _searchController.clear();
                              ref
                                  .read(
                                      membersDirectoryNotifierProvider.notifier)
                                  .setSearchQuery('');
                            },
                          )
                        : null,
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(
                        vertical: 12, horizontal: 16),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  onChanged: (val) {
                    ref
                        .read(membersDirectoryNotifierProvider.notifier)
                        .setSearchQuery(val);
                  },
                ),
              ),

              // Filter Chips
              if (state.members.isNotEmpty)
                SizedBox(
                  height: 40,
                  child: ListView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(right: 6.0),
                        child: FilterChip(
                          key: const ValueKey('role_filter_all'),
                          selected: state.selectedRoleFilter == null,
                          label: const Text('Todos'),
                          onSelected: (_) {
                            ref
                                .read(
                                    membersDirectoryNotifierProvider.notifier)
                                .setRoleFilter(null);
                          },
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(right: 6.0),
                        child: FilterChip(
                          key: const ValueKey('role_filter_admin'),
                          selected: state.selectedRoleFilter == 'admin',
                          label: const Text('Líderes / Admins'),
                          onSelected: (_) {
                            ref
                                .read(
                                    membersDirectoryNotifierProvider.notifier)
                                .setRoleFilter(
                                  state.selectedRoleFilter == 'admin'
                                      ? null
                                      : 'admin',
                                );
                          },
                        ),
                      ),
                      Padding(
                        padding: const EdgeInsets.only(right: 6.0),
                        child: FilterChip(
                          key: const ValueKey('role_filter_member'),
                          selected: state.selectedRoleFilter == 'member',
                          label: const Text('Membros'),
                          onSelected: (_) {
                            ref
                                .read(
                                    membersDirectoryNotifierProvider.notifier)
                                .setRoleFilter(
                                  state.selectedRoleFilter == 'member'
                                      ? null
                                      : 'member',
                                );
                          },
                        ),
                      ),
                      // Musical roles
                      ...state.roles.map((role) {
                        final isSelected = state.selectedRoleFilter == role.id;
                        return Padding(
                          padding: const EdgeInsets.only(right: 6.0),
                          child: FilterChip(
                            key: ValueKey('role_filter_${role.id}'),
                            selected: isSelected,
                            label: Text(role.name),
                            onSelected: (_) {
                              ref
                                  .read(
                                      membersDirectoryNotifierProvider.notifier)
                                  .setRoleFilter(
                                    isSelected ? null : role.id,
                                  );
                            },
                          ),
                        );
                      }),
                    ],
                  ),
                ),
              const SizedBox(height: 8),
            ],

            // Content Body: Loading / Error / Empty / List
            Expanded(
              child: _buildBody(context, state, isMatchingMinistry, filtered),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(
    BuildContext context,
    MembersDirectoryState state,
    bool isMatchingMinistry,
    List<MinistryMember> filtered,
  ) {
    final theme = Theme.of(context);

    // 1. Loading State
    if (!isMatchingMinistry || state.isLoading) {
      return const Center(
        child: CircularProgressIndicator(),
      );
    }

    // 2. Error State
    if (state.error != null) {
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
                onPressed: _load,
                icon: const Icon(Icons.refresh, size: 18),
                label: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    // 3. Empty State (no members at all in ministry)
    if (state.members.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.people_outline,
                size: 56,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.35),
              ),
              const SizedBox(height: 16),
              Text(
                'Nenhum integrante cadastrado',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Este ministério ainda não possui integrantes cadastrados.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                ),
              ),
            ],
          ),
        ),
      );
    }

    // 4. Empty Search/Filter Result
    if (filtered.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32.0),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.search_off_rounded,
                size: 48,
                color: theme.colorScheme.onSurface.withValues(alpha: 0.35),
              ),
              const SizedBox(height: 16),
              Text(
                'Nenhum integrante encontrado',
                style: theme.textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                state.searchQuery.isNotEmpty
                    ? 'Nenhum resultado para "${state.searchQuery}".'
                    : 'Nenhum integrante com o filtro selecionado.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: theme.colorScheme.onSurface.withValues(alpha: 0.65),
                ),
              ),
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: () {
                  _searchController.clear();
                  ref
                      .read(membersDirectoryNotifierProvider.notifier)
                      .setSearchQuery('');
                  ref
                      .read(membersDirectoryNotifierProvider.notifier)
                      .setRoleFilter(null);
                },
                child: const Text('Limpar filtros'),
              ),
            ],
          ),
        ),
      );
    }

    // 5. Success List
    return RefreshIndicator(
      onRefresh: () =>
          ref.read(membersDirectoryNotifierProvider.notifier).refresh(),
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(top: 4, bottom: 24),
        itemCount: filtered.length,
        itemBuilder: (context, index) {
          final member = filtered[index];
          return MemberCard(
            key: ValueKey('member_card_${member.id}'),
            member: member,
            rolesById: state.rolesById,
            onTap: () => _onMemberTapped(member, state),
          );
        },
      ),
    );
  }
}
