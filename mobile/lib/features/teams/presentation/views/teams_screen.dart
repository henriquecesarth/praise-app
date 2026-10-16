import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../../schedules/domain/ministry_member.dart';
import '../../domain/team.dart';
import '../widgets/team_card.dart';
import 'team_form_screen.dart';

class TeamsScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final String ministryName;

  const TeamsScreen({
    super.key,
    required this.ministryId,
    required this.ministryName,
  });

  @override
  ConsumerState<TeamsScreen> createState() => _TeamsScreenState();
}

class _TeamsScreenState extends ConsumerState<TeamsScreen> {
  final _searchController = TextEditingController();
  List<MinistryMember> _activeMembers = [];
  String? _boundUserId;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(_onSearchChanged);
    _boundUserId = ref.read(authNotifierProvider).user?.id;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(teamsListNotifierProvider.notifier).load(widget.ministryId);
      _loadMembers();
    });
  }

  void _onSearchChanged() {
    ref
        .read(teamsListNotifierProvider.notifier)
        .setSearchQuery(_searchController.text);
  }

  Future<void> _loadMembers() async {
    try {
      final membersRepo = ref.read(membersRepositoryProvider);
      final list = await membersRepo.getMembers(widget.ministryId);
      if (mounted) {
        setState(() {
          _activeMembers = list;
        });
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _searchController.removeListener(_onSearchChanged);
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _openCreateTeam() async {
    final result = await Navigator.of(context).push<Team>(
      MaterialPageRoute(
        builder: (_) => TeamFormScreen(
          ministryId: widget.ministryId,
        ),
      ),
    );

    if (result != null && mounted) {
      ref
          .read(teamsListNotifierProvider.notifier)
          .refresh(widget.ministryId);
    }
  }

  Future<void> _openEditTeam(Team team) async {
    final result = await Navigator.of(context).push<Team>(
      MaterialPageRoute(
        builder: (_) => TeamFormScreen(
          ministryId: widget.ministryId,
          initialTeam: team,
        ),
      ),
    );

    if (result != null && mounted) {
      ref
          .read(teamsListNotifierProvider.notifier)
          .refresh(widget.ministryId);
    }
  }

  Future<void> _confirmDelete(Team team) async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Excluir equipe'),
        content: Text(
          'Tem certeza que deseja excluir a equipe "${team.name}"?\n\n'
          'As escalas já criadas com esta equipe não serão alteradas.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('cancel_delete_team_button'),
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            key: const ValueKey('confirm_delete_team_button'),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );

    if (confirm != true || !mounted) return;

    final formNotifier = ref.read(teamFormNotifierProvider.notifier);
    formNotifier.init(
      ministryId: widget.ministryId,
      boundUserId: _boundUserId ?? '',
      initialTeam: team,
      availableMembers: _activeMembers,
    );

    final result = await formNotifier.deleteTeam(team.id);

    if (!mounted || result.isDiscarded) return;

    if (result.isSuccess) {
      ref
          .read(teamsListNotifierProvider.notifier)
          .removeTeamLocally(team.id);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Equipe "${team.name}" excluída com sucesso.'),
          backgroundColor: Theme.of(context).colorScheme.primary,
        ),
      );
    } else if (result.isFailure) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.errorMessage ?? 'Erro ao excluir equipe.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final listState = ref.watch(teamsListNotifierProvider);

    // Tenant & Session Fencing: Auto-pop on tenant switch
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

    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      final currentUid = next.user?.id;
      final isUnauthenticated =
          !next.isAuthenticated || currentUid == null || currentUid.isEmpty;
      final userChanged = _boundUserId != null && currentUid != _boundUserId;
      if ((_boundUserId != null && isUnauthenticated) || userChanged) {
        if (mounted && Navigator.of(context).canPop()) {
          Navigator.of(context).pop();
        }
      }
    });

    final memberMap = {for (final m in _activeMembers) m.id: m};

    return Scaffold(
      appBar: AppBar(
        title: const Text('Equipes'),
        actions: [
          IconButton(
            key: const ValueKey('create_team_appbar_button'),
            tooltip: 'Nova Equipe',
            icon: const Icon(Icons.group_add_outlined),
            onPressed: _openCreateTeam,
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        key: const ValueKey('create_team_fab'),
        onPressed: _openCreateTeam,
        icon: const Icon(Icons.add),
        label: const Text('Nova Equipe'),
      ),
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () async {
            await Future.wait([
              ref
                  .read(teamsListNotifierProvider.notifier)
                  .refresh(widget.ministryId),
              _loadMembers(),
            ]);
          },
          child: listState.isLoading && listState.teams.isEmpty
              ? const Center(child: CircularProgressIndicator())
              : listState.hasError && listState.teams.isEmpty
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(24.0),
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Icon(
                              Icons.error_outline,
                              size: 48,
                              color: theme.colorScheme.error,
                            ),
                            const SizedBox(height: 16),
                            Text(
                              listState.errorMessage ?? 'Erro ao carregar equipes.',
                              textAlign: TextAlign.center,
                              style: theme.textTheme.titleMedium,
                            ),
                            const SizedBox(height: 16),
                            FilledButton.icon(
                              onPressed: () {
                                ref
                                    .read(teamsListNotifierProvider.notifier)
                                    .refresh(widget.ministryId);
                                _loadMembers();
                              },
                              icon: const Icon(Icons.refresh),
                              label: const Text('Tentar novamente'),
                            ),
                          ],
                        ),
                      ),
                    )
                  : Column(
                      children: [
                        // Search bar
                        if (listState.teams.isNotEmpty ||
                            _searchController.text.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                            child: TextField(
                              key: const ValueKey('teams_search_field'),
                              controller: _searchController,
                              decoration: InputDecoration(
                                prefixIcon:
                                    const Icon(Icons.search, size: 20),
                                hintText: 'Buscar equipes...',
                                isDense: true,
                                border: OutlineInputBorder(
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                suffixIcon: _searchController.text.isNotEmpty
                                    ? IconButton(
                                        icon: const Icon(Icons.clear, size: 18),
                                        onPressed: () {
                                          _searchController.clear();
                                        },
                                      )
                                    : null,
                              ),
                            ),
                          ),

                        // List / Empty State
                        Expanded(
                          child: listState.filteredTeams.isEmpty
                              ? ListView(
                                  padding: const EdgeInsets.all(24),
                                  children: [
                                    const SizedBox(height: 48),
                                    Icon(
                                      Icons.groups_outlined,
                                      size: 64,
                                      color: theme.colorScheme.primary
                                          .withValues(alpha: 0.5),
                                    ),
                                    const SizedBox(height: 16),
                                    Text(
                                      _searchController.text.isNotEmpty
                                          ? 'Nenhuma equipe encontrada'
                                          : 'Nenhuma equipe cadastrada',
                                      textAlign: TextAlign.center,
                                      style: theme.textTheme.titleMedium
                                          ?.copyWith(
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                    const SizedBox(height: 8),
                                    Text(
                                      _searchController.text.isNotEmpty
                                          ? 'Tente buscar com outros termos.'
                                          : 'Crie equipes para organizar os integrantes do ministério e facilitar a criação de escalas.',
                                      textAlign: TextAlign.center,
                                      style: theme.textTheme.bodyMedium
                                          ?.copyWith(
                                        color: theme.colorScheme.onSurface
                                            .withValues(alpha: 0.7),
                                      ),
                                    ),
                                    if (_searchController.text.isEmpty) ...[
                                      const SizedBox(height: 24),
                                      Center(
                                        child: FilledButton.icon(
                                          key: const ValueKey(
                                              'empty_create_team_button'),
                                          onPressed: _openCreateTeam,
                                          icon: const Icon(Icons.add),
                                          label: const Text('Criar Equipe'),
                                        ),
                                      ),
                                    ],
                                  ],
                                )
                              : ListView.builder(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 8,
                                  ),
                                  itemCount: listState.filteredTeams.length,
                                  itemBuilder: (context, index) {
                                    final team = listState.filteredTeams[index];
                                    final resolvedNames = team.memberIds
                                        .map((id) => memberMap[id]?.name)
                                        .whereType<String>()
                                        .toList();

                                    return TeamCard(
                                      key: ValueKey('team_card_${team.id}'),
                                      team: team,
                                      activeMemberCount: resolvedNames.length,
                                      memberNames: resolvedNames,
                                      isAdmin: true,
                                      onTap: () => _openEditTeam(team),
                                      onEdit: () => _openEditTeam(team),
                                      onDelete: () => _confirmDelete(team),
                                    );
                                  },
                                ),
                        ),
                      ],
                    ),
        ),
      ),
    );
  }
}
