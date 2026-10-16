import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../domain/team.dart';

class TeamFormScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final Team? initialTeam;

  const TeamFormScreen({
    super.key,
    required this.ministryId,
    this.initialTeam,
  });

  bool get isEditing => initialTeam != null;

  @override
  ConsumerState<TeamFormScreen> createState() => _TeamFormScreenState();
}

class _TeamFormScreenState extends ConsumerState<TeamFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _memberSearchController;

  bool _isForcedDismiss = false;
  bool _isSaved = false;
  String? _boundUserId;

  @override
  void initState() {
    super.initState();
    _nameController =
        TextEditingController(text: widget.initialTeam?.name ?? '');
    _descriptionController =
        TextEditingController(text: widget.initialTeam?.description ?? '');
    _memberSearchController = TextEditingController();

    _nameController.addListener(_onFieldChanged);
    _descriptionController.addListener(_onFieldChanged);
    _memberSearchController.addListener(_onFieldChanged);

    final currentUserId = ref.read(authNotifierProvider).user?.id ?? '';
    _boundUserId = currentUserId.isNotEmpty ? currentUserId : null;

    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(teamFormNotifierProvider.notifier).init(
            ministryId: widget.ministryId,
            boundUserId: currentUserId,
            initialTeam: widget.initialTeam,
          );
    });
  }

  void _onFieldChanged() {
    if (mounted) setState(() {});
  }

  void _forceDismiss() {
    if (_isForcedDismiss) return;
    _isForcedDismiss = true;
    ref.read(teamFormNotifierProvider.notifier).invalidateTenant();
    if (mounted && Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  @override
  void dispose() {
    _nameController.removeListener(_onFieldChanged);
    _descriptionController.removeListener(_onFieldChanged);
    _memberSearchController.removeListener(_onFieldChanged);
    _nameController.dispose();
    _descriptionController.dispose();
    _memberSearchController.dispose();
    super.dispose();
  }

  Future<bool> _showDiscardDialog(BuildContext context) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Descartar alterações?'),
        content: const Text(
          'Existem alterações não salvas. Se sair agora, todas as modificações serão perdidas.',
        ),
        actions: [
          TextButton(
            key: const ValueKey('discard_dialog_cancel_button'),
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Continuar editando'),
          ),
          FilledButton(
            key: const ValueKey('discard_dialog_confirm_button'),
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(ctx).colorScheme.error,
            ),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    return result ?? false;
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final notifier = ref.read(teamFormNotifierProvider.notifier);
    final name = _nameController.text.trim();
    final description = _descriptionController.text.trim().isEmpty
        ? null
        : _descriptionController.text.trim();

    final result = widget.isEditing
        ? await notifier.updateTeam(
            teamId: widget.initialTeam!.id,
            name: name,
            description: description,
          )
        : await notifier.createTeam(
            name: name,
            description: description,
          );

    if (!mounted || _isForcedDismiss) return;
    if (result.isDiscarded) return;

    if (result.isSuccess && result.data != null) {
      _isSaved = true;
      ref.read(teamsListNotifierProvider.notifier).refresh(widget.ministryId);

      Navigator.of(context).pop(result.data);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            widget.isEditing
                ? 'Equipe "${result.data!.name}" atualizada com sucesso!'
                : 'Equipe "${result.data!.name}" criada com sucesso!',
          ),
          backgroundColor: Theme.of(context).colorScheme.primary,
        ),
      );
    } else if (result.isFailure) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.errorMessage ?? 'Erro ao salvar equipe.'),
          backgroundColor: Theme.of(context).colorScheme.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final formState = ref.watch(teamFormNotifierProvider);

    // TEAM_FORM_FORCED_TENANT_DISMISSAL:
    // Security dismissal MUST NOT be vetoed by dirty-form confirmation.
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null &&
          newMinistryId.isNotEmpty &&
          newMinistryId != widget.ministryId) {
        _forceDismiss();
      }
    });

    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      final currentUid = next.user?.id;
      final isUnauthenticated =
          !next.isAuthenticated || currentUid == null || currentUid.isEmpty;
      final userChanged = _boundUserId != null && currentUid != _boundUserId;
      if ((_boundUserId != null && isUnauthenticated) || userChanged) {
        _forceDismiss();
      }
    });

    final filteredMembers = formState.availableMembers.where((m) {
      final query = _memberSearchController.text.trim().toLowerCase();
      if (query.isEmpty) return true;
      return m.name.toLowerCase().contains(query) ||
          m.email.toLowerCase().contains(query);
    }).toList();

    return PopScope(
      canPop: _isForcedDismiss ||
          _isSaved ||
          !formState.isDirty ||
          formState.isSubmitting,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (_isForcedDismiss) {
          if (Navigator.of(context).canPop()) {
            Navigator.of(context).pop();
          }
          return;
        }
        final shouldLeave = await _showDiscardDialog(context);
        if (shouldLeave && context.mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(widget.isEditing ? 'Editar Equipe' : 'Nova Equipe'),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 8.0),
              child: FilledButton(
                key: const ValueKey('team_form_save_button'),
                onPressed: formState.isSubmitting ? null : _submit,
                child: formState.isSubmitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Colors.white,
                        ),
                      )
                    : const Text('Salvar'),
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: formState.isLoadingMembers
              ? const Center(child: CircularProgressIndicator())
              : Form(
                  key: _formKey,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      // Nome da Equipe
                      TextFormField(
                        key: const ValueKey('team_name_field'),
                        controller: _nameController,
                        decoration: const InputDecoration(
                          labelText: 'Nome da equipe *',
                          hintText: 'Ex: Vocal, Banda Base, Ministério Domingo',
                          border: OutlineInputBorder(),
                        ),
                        maxLength: 100,
                        textCapitalization: TextCapitalization.sentences,
                        validator: (value) {
                          final trimmed = value?.trim() ?? '';
                          if (trimmed.isEmpty) {
                            return 'Nome da equipe é obrigatório.';
                          }
                          if (trimmed.length > 100) {
                            return 'O nome deve ter no máximo 100 caracteres.';
                          }
                          return null;
                        },
                        onChanged: (val) {
                          ref
                              .read(teamFormNotifierProvider.notifier)
                              .setName(val);
                        },
                      ),
                      const SizedBox(height: 12),

                      // Descrição
                      TextFormField(
                        key: const ValueKey('team_description_field'),
                        controller: _descriptionController,
                        decoration: const InputDecoration(
                          labelText: 'Descrição (opcional)',
                          hintText: 'Breve resumo da equipe ou responsabilidades',
                          border: OutlineInputBorder(),
                        ),
                        maxLength: 300,
                        maxLines: 3,
                        validator: (value) {
                          final trimmed = value?.trim() ?? '';
                          if (trimmed.length > 300) {
                            return 'A descrição deve ter no máximo 300 caracteres.';
                          }
                          return null;
                        },
                        onChanged: (val) {
                          ref
                              .read(teamFormNotifierProvider.notifier)
                              .setDescription(val);
                        },
                      ),
                      const SizedBox(height: 16),

                      // Integrantes Section Header
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'Integrantes',
                            style: theme.textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Chip(
                            key: const ValueKey('team_selected_members_count'),
                            label: Text(
                              '${formState.selectedMemberIds.length} selecionados',
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            visualDensity: VisualDensity.compact,
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),

                      // Integrantes Search
                      TextField(
                        key: const ValueKey('team_member_search_field'),
                        controller: _memberSearchController,
                        decoration: InputDecoration(
                          prefixIcon: const Icon(Icons.search, size: 20),
                          hintText: 'Buscar integrante...',
                          isDense: true,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                      ),
                      const SizedBox(height: 8),

                      // Integrantes List
                      if (formState.availableMembers.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 24.0),
                          child: Center(
                            child: Text(
                              'Nenhum integrante ativo encontrado neste ministério.',
                            ),
                          ),
                        )
                      else if (filteredMembers.isEmpty)
                        const Padding(
                          padding: EdgeInsets.symmetric(vertical: 24.0),
                          child: Center(
                            child: Text('Nenhum integrante corresponde à busca.'),
                          ),
                        )
                      else
                        ListView.builder(
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          itemCount: filteredMembers.length,
                          itemBuilder: (context, index) {
                            final member = filteredMembers[index];
                            final isSelected = formState.selectedMemberIds
                                .contains(member.id);

                            return CheckboxListTile(
                              key: ValueKey('team_member_tile_${member.id}'),
                              value: isSelected,
                              title: Text(
                                member.name,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              subtitle: member.email.isNotEmpty
                                  ? Text(member.email)
                                  : null,
                              secondary: CircleAvatar(
                                radius: 18,
                                child: Text(
                                  member.initials,
                                  style: const TextStyle(fontSize: 12),
                                ),
                              ),
                              onChanged: (_) {
                                ref
                                    .read(teamFormNotifierProvider.notifier)
                                    .toggleMember(member.id);
                              },
                            );
                          },
                        ),
                    ],
                  ),
                ),
        ),
      ),
    );
  }
}
