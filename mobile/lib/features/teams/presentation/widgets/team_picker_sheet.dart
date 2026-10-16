import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../schedules/domain/ministry_member.dart';
import '../../domain/team.dart';

class TeamPickerSheet extends ConsumerStatefulWidget {
  final String ministryId;
  final List<MinistryMember> availableMembers;
  final ValueChanged<Team> onTeamSelected;

  const TeamPickerSheet({
    super.key,
    required this.ministryId,
    required this.availableMembers,
    required this.onTeamSelected,
  });

  static Future<void> show({
    required BuildContext context,
    required String ministryId,
    required List<MinistryMember> availableMembers,
    required ValueChanged<Team> onTeamSelected,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => TeamPickerSheet(
        ministryId: ministryId,
        availableMembers: availableMembers,
        onTeamSelected: onTeamSelected,
      ),
    );
  }

  @override
  ConsumerState<TeamPickerSheet> createState() => _TeamPickerSheetState();
}

class _TeamPickerSheetState extends ConsumerState<TeamPickerSheet> {
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() => setState(() {}));

    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(teamsListNotifierProvider.notifier).load(widget.ministryId);
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final listState = ref.watch(teamsListNotifierProvider);

    // TEAM_IMPORT_TENANT_FENCING:
    // If tenant switches while picker is open, dismiss immediately
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null &&
          newMinistryId.isNotEmpty &&
          newMinistryId != widget.ministryId) {
        if (mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
      }
    });

    final activeMemberIds = widget.availableMembers.map((m) => m.id).toSet();

    final query = _searchController.text.trim().toLowerCase();
    final filteredTeams = listState.teams.where((t) {
      if (query.isEmpty) return true;
      final nameMatch = t.name.toLowerCase().contains(query);
      final descMatch = t.description?.toLowerCase().contains(query) ?? false;
      return nameMatch || descMatch;
    }).toList();

    return DraggableScrollableSheet(
      initialChildSize: 0.65,
      minChildSize: 0.4,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) {
        return Column(
          children: [
            // Handle bar
            const SizedBox(height: 8),
            Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: theme.dividerColor.withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: 12),

            // Header
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Icon(
                    Icons.groups_outlined,
                    color: theme.colorScheme.primary,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'Importar Equipe',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Spacer(),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
            ),

            // Search
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: TextField(
                key: const ValueKey('team_picker_search_field'),
                controller: _searchController,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search, size: 20),
                  hintText: 'Buscar equipe...',
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ),
            ),

            const Divider(height: 1),

            // Body
            Expanded(
              child: listState.isLoading && listState.teams.isEmpty
                  ? const Center(child: CircularProgressIndicator())
                  : listState.hasError && listState.teams.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24.0),
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              children: [
                                Text(
                                  listState.errorMessage ??
                                      'Erro ao carregar equipes.',
                                  textAlign: TextAlign.center,
                                ),
                                const SizedBox(height: 12),
                                FilledButton(
                                  onPressed: () {
                                    ref
                                        .read(teamsListNotifierProvider.notifier)
                                        .refresh(widget.ministryId);
                                  },
                                  child: const Text('Tentar novamente'),
                                ),
                              ],
                            ),
                          ),
                        )
                      : filteredTeams.isEmpty
                          ? Center(
                              child: Padding(
                                padding: const EdgeInsets.all(24.0),
                                child: Text(
                                  query.isNotEmpty
                                      ? 'Nenhuma equipe encontrada.'
                                      : 'Nenhuma equipe cadastrada neste ministério.',
                                  textAlign: TextAlign.center,
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: theme.colorScheme.onSurface
                                        .withValues(alpha: 0.6),
                                  ),
                                ),
                              ),
                            )
                          : ListView.separated(
                              controller: scrollController,
                              padding: const EdgeInsets.symmetric(
                                horizontal: 16,
                                vertical: 8,
                              ),
                              itemCount: filteredTeams.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(height: 1),
                              itemBuilder: (context, index) {
                                final team = filteredTeams[index];
                                final resolvableCount = team.memberIds
                                    .where((id) => activeMemberIds.contains(id))
                                    .length;

                                return ListTile(
                                  key: ValueKey('team_picker_tile_${team.id}'),
                                  contentPadding:
                                      const EdgeInsets.symmetric(vertical: 4),
                                  leading: CircleAvatar(
                                    backgroundColor: theme.colorScheme.primary
                                        .withValues(alpha: 0.1),
                                    child: Icon(
                                      Icons.groups_outlined,
                                      color: theme.colorScheme.primary,
                                      size: 20,
                                    ),
                                  ),
                                  title: Text(
                                    team.name,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  subtitle: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      if (team.description != null &&
                                          team.description!.isNotEmpty)
                                        Text(
                                          team.description!,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      const SizedBox(height: 2),
                                      Text(
                                        '$resolvableCount ${resolvableCount == 1 ? 'integrante ativo' : 'integrantes ativos'}',
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: theme.colorScheme.primary,
                                          fontWeight: FontWeight.w500,
                                        ),
                                      ),
                                    ],
                                  ),
                                  trailing: const Icon(
                                    Icons.arrow_forward_ios,
                                    size: 16,
                                  ),
                                  onTap: () {
                                    // Fencing check before triggering callback
                                    final currentMid = ref
                                        .read(ministryContextNotifierProvider)
                                        .selectedMinistry
                                        ?.id;
                                    if (currentMid != widget.ministryId) {
                                      Navigator.of(context).pop();
                                      return;
                                    }

                                    Navigator.of(context).pop();
                                    widget.onTeamSelected(team);
                                  },
                                );
                              },
                            ),
            ),
          ],
        );
      },
    );
  }
}
