import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../../core/utils/date_utils.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../domain/ministry_member.dart';
import '../../domain/ministry_role.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_participant.dart';
import '../controllers/schedule_form_controller.dart';

/// Screen for creating and editing schedules in LouvAIO Mobile.
///
/// Features:
/// - Civil date and time pickers (no UTC shift).
/// - Duration chips with standard presets + custom minute input.
/// - Switch for confirmation requirement.
/// - Notes text area.
/// - Participant management with real ministry members, role selection,
///   and strict duplicate prevention.
/// - Double-submit prevention.
/// - Unsaved changes guard via PopScope.
/// - Tenant switch race protection (auto-pops when active ministry changes).
class ScheduleFormScreen extends ConsumerStatefulWidget {
  final String ministryId;
  final ScheduleDetail? initialSchedule;

  const ScheduleFormScreen({
    super.key,
    required this.ministryId,
    this.initialSchedule,
  });

  @override
  ConsumerState<ScheduleFormScreen> createState() => _ScheduleFormScreenState();
}

class _ScheduleFormScreenState extends ConsumerState<ScheduleFormScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _titleController;
  late final TextEditingController _notesController;

  @override
  void initState() {
    super.initState();
    _titleController =
        TextEditingController(text: widget.initialSchedule?.title ?? 'Culto');
    _notesController =
        TextEditingController(text: widget.initialSchedule?.notes ?? '');

    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(scheduleFormNotifierProvider.notifier).init(
            ministryId: widget.ministryId,
            initialSchedule: widget.initialSchedule,
          );
    });
  }

  @override
  void dispose() {
    _titleController.dispose();
    _notesController.dispose();
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
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Continuar editando'),
          ),
          FilledButton(
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

  DateTime _parseDate(String dateStr) {
    final parts = dateStr.split('-');
    if (parts.length == 3) {
      final y = int.tryParse(parts[0]);
      final m = int.tryParse(parts[1]);
      final d = int.tryParse(parts[2]);
      if (y != null && m != null && d != null) {
        return DateTime(y, m, d);
      }
    }
    return DateTime.now();
  }

  Future<void> _pickDate(ScheduleFormState formState) async {
    final initialDate = formState.date.isNotEmpty
        ? _parseDate(formState.date)
        : DateTime.now();

    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );

    if (picked != null) {
      final civilDate =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
      ref.read(scheduleFormNotifierProvider.notifier).setDate(civilDate);
    }
  }

  Future<void> _pickTime(ScheduleFormState formState) async {
    int hour = 19;
    int minute = 0;
    if (formState.time.isNotEmpty && formState.time.contains(':')) {
      final parts = formState.time.split(':');
      hour = int.tryParse(parts[0]) ?? 19;
      minute = int.tryParse(parts[1]) ?? 0;
    }

    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay(hour: hour, minute: minute),
    );

    if (picked != null) {
      final civilTime =
          '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
      ref.read(scheduleFormNotifierProvider.notifier).setTime(civilTime);
    }
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final schedule =
        await ref.read(scheduleFormNotifierProvider.notifier).submit();
    if (schedule != null && mounted) {
      ref.read(scheduleListNotifierProvider.notifier).refresh();
      if (widget.initialSchedule != null) {
        ref
            .read(scheduleDetailNotifierProvider.notifier)
            .load(widget.ministryId, schedule.id);
      }

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            widget.initialSchedule != null
                ? 'Escala "${schedule.title}" atualizada com sucesso!'
                : 'Escala "${schedule.title}" criada com sucesso!',
          ),
          backgroundColor: Colors.green.shade700,
        ),
      );
      Navigator.of(context).pop(schedule);
    }
  }

  void _openMemberPicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _MemberPickerSheet(
        ministryId: widget.ministryId,
        onMemberSelected: (member, role) {
          final added = ref
              .read(scheduleFormNotifierProvider.notifier)
              .addParticipant(member, role);
          if (added && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('${member.name} adicionado(a) como $role'),
                duration: const Duration(seconds: 2),
              ),
            );
          }
        },
      ),
    );
  }

  void _editParticipantRole(
    BuildContext context,
    int index,
    ScheduleParticipant participant,
  ) {
    final controller = TextEditingController(text: participant.role);
    final formState = ref.read(scheduleFormNotifierProvider);
    final roles = formState.availableRoles;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text('Alterar função: ${participant.name}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (roles.isNotEmpty) ...[
                const Text('Sugestões do ministério:'),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: roles.map((r) {
                    final isSelected = controller.text.trim().toLowerCase() ==
                        r.name.trim().toLowerCase();
                    return ChoiceChip(
                      label: Text(r.name),
                      selected: isSelected,
                      onSelected: (selected) {
                        if (selected) {
                          setDialogState(() {
                            controller.text = r.name;
                          });
                        }
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: 12),
              ],
              TextField(
                controller: controller,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Função musical / ministerial',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () {
                final newRole = controller.text.trim();
                if (newRole.isNotEmpty) {
                  ref
                      .read(scheduleFormNotifierProvider.notifier)
                      .updateParticipantRole(index, newRole);
                }
                Navigator.of(ctx).pop();
              },
              child: const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    // Tenant switch race safety: pop if active ministry changes away from widget.ministryId
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null && newMinistryId != widget.ministryId) {
        if (mounted) {
          Navigator.of(context).maybePop();
        }
      }
    });

    final formState = ref.watch(scheduleFormNotifierProvider);
    final notifier = ref.read(scheduleFormNotifierProvider.notifier);
    final theme = Theme.of(context);

    return PopScope(
      canPop: !formState.isDirty || formState.submitSuccess,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        final shouldLeave = await _showDiscardDialog(context);
        if (shouldLeave && context.mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(formState.isEditing ? 'Editar Escala' : 'Nova Escala'),
          actions: [
            Padding(
              padding: const EdgeInsets.only(right: 8.0),
              child: TextButton.icon(
                onPressed: formState.isSubmitting ? null : _save,
                icon: formState.isSubmitting
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.check),
                label: Text(formState.isEditing ? 'Salvar' : 'Criar'),
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 700),
              child: Form(
                key: _formKey,
                child: ListView(
                  padding: const EdgeInsets.all(16.0),
                  children: [
                    if (formState.error != null) ...[
                      Card(
                        color: theme.colorScheme.errorContainer,
                        child: Padding(
                          padding: const EdgeInsets.all(12.0),
                          child: Row(
                            children: [
                              Icon(
                                Icons.error_outline,
                                color: theme.colorScheme.onErrorContainer,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  formState.error!,
                                  style: TextStyle(
                                    color: theme.colorScheme.onErrorContainer,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 16),
                    ],

                    // ─── Basic Details Card ─────────────────────────────
                    Card(
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(
                          color: theme.dividerColor.withValues(alpha: 0.2),
                        ),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Informações do Evento',
                              style: theme.textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                            const SizedBox(height: 16),
                            TextFormField(
                              controller: _titleController,
                              decoration: const InputDecoration(
                                labelText: 'Título da escala *',
                                hintText: 'ex: Culto de Domingo, Ensaio Geral',
                                border: OutlineInputBorder(),
                                prefixIcon: Icon(Icons.edit_note),
                              ),
                              validator: (val) {
                                if (val == null || val.trim().isEmpty) {
                                  return 'O título da escala é obrigatório.';
                                }
                                return null;
                              },
                              onChanged: (val) => notifier.setTitle(val),
                            ),
                            const SizedBox(height: 16),
                            Row(
                              children: [
                                Expanded(
                                  child: InkWell(
                                    onTap: () => _pickDate(formState),
                                    borderRadius: BorderRadius.circular(8),
                                    child: InputDecorator(
                                      decoration: const InputDecoration(
                                        labelText: 'Data *',
                                        border: OutlineInputBorder(),
                                        prefixIcon: Icon(
                                            Icons.calendar_today_outlined),
                                      ),
                                      child: Text(
                                        formState.date.isNotEmpty
                                            ? AppDateUtils.formatDatePtBR(
                                                formState.date)
                                            : 'Selecionar data',
                                        style: theme.textTheme.bodyMedium,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: InkWell(
                                    onTap: () => _pickTime(formState),
                                    borderRadius: BorderRadius.circular(8),
                                    child: InputDecorator(
                                      decoration: const InputDecoration(
                                        labelText: 'Horário *',
                                        border: OutlineInputBorder(),
                                        prefixIcon:
                                            Icon(Icons.access_time_outlined),
                                      ),
                                      child: Text(
                                        formState.time.isNotEmpty
                                            ? AppDateUtils.formatTimePtBR(
                                                formState.time)
                                            : 'Selecionar horário',
                                        style: theme.textTheme.bodyMedium,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 20),
                            Text(
                              'Duração estimada',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 8,
                              runSpacing: 4,
                              children: [60, 90, 120, 180].map((minutes) {
                                final isSelected =
                                    formState.durationMinutes == minutes;
                                final label = minutes < 60
                                    ? '${minutes}m'
                                    : minutes % 60 == 0
                                        ? '${minutes ~/ 60}h'
                                        : '${minutes ~/ 60}h ${minutes % 60}m';
                                return ChoiceChip(
                                  label: Text(label),
                                  selected: isSelected,
                                  onSelected: (selected) {
                                    if (selected) {
                                      notifier.setDurationMinutes(minutes);
                                    }
                                  },
                                );
                              }).toList(),
                            ),
                            const SizedBox(height: 12),
                            SwitchListTile(
                              contentPadding: EdgeInsets.zero,
                              title: const Text(
                                  'Exigir confirmação de presença'),
                              subtitle: const Text(
                                'Integrantes poderão confirmar ou recusar participação',
                              ),
                              value: formState.requireConfirmation,
                              onChanged: (val) =>
                                  notifier.setRequireConfirmation(val),
                            ),
                            const SizedBox(height: 8),
                            TextFormField(
                              controller: _notesController,
                              maxLines: 3,
                              decoration: const InputDecoration(
                                labelText: 'Observações / Instruções (opcional)',
                                hintText:
                                    'Orientações aos participantes, ensaio prévio, etc.',
                                border: OutlineInputBorder(),
                              ),
                              onChanged: (val) => notifier.setNotes(val),
                            ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 16),

                    // ─── Participants Section ────────────────────────────
                    Card(
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(
                          color: theme.dividerColor.withValues(alpha: 0.2),
                        ),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(16.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  'Integrantes (${formState.participants.length})',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                FilledButton.tonalIcon(
                                  onPressed: () => _openMemberPicker(context),
                                  icon: const Icon(Icons.person_add_outlined,
                                      size: 18),
                                  label: const Text('Adicionar'),
                                  style: FilledButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            if (formState.participants.isEmpty)
                              Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 24.0),
                                child: Center(
                                  child: Column(
                                    children: [
                                      Icon(
                                        Icons.people_outline,
                                        size: 40,
                                        color: theme.colorScheme.onSurface
                                            .withValues(alpha: 0.3),
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        'Nenhum integrante adicionado à escala.',
                                        style: theme.textTheme.bodyMedium
                                            ?.copyWith(
                                          color: theme.colorScheme.onSurface
                                              .withValues(alpha: 0.5),
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Toque em "Adicionar" para escalar músicos e líderes.',
                                        style: theme.textTheme.bodySmall
                                            ?.copyWith(
                                          color: theme.colorScheme.onSurface
                                              .withValues(alpha: 0.4),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              )
                            else
                              ListView.separated(
                                shrinkWrap: true,
                                physics: const NeverScrollableScrollPhysics(),
                                itemCount: formState.participants.length,
                                separatorBuilder: (_, __) =>
                                    const Divider(height: 1),
                                itemBuilder: (ctx, index) {
                                  final p = formState.participants[index];
                                  return ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    leading: CircleAvatar(
                                      child: Text(
                                        p.name.isNotEmpty
                                            ? p.name[0].toUpperCase()
                                            : '?',
                                      ),
                                    ),
                                    title: Text(
                                      p.name,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600),
                                    ),
                                    subtitle: Text(p.role),
                                    trailing: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        IconButton(
                                          icon: const Icon(
                                            Icons.edit_outlined,
                                            size: 20,
                                          ),
                                          tooltip: 'Alterar função',
                                          onPressed: () =>
                                              _editParticipantRole(
                                                  context, index, p),
                                        ),
                                        IconButton(
                                          icon: Icon(
                                            Icons.remove_circle_outline,
                                            size: 20,
                                            color: theme.colorScheme.error,
                                          ),
                                          tooltip: 'Remover da escala',
                                          onPressed: () =>
                                              notifier.removeParticipant(index),
                                        ),
                                      ],
                                    ),
                                  );
                                },
                              ),
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: 24),

                    // ─── Bottom Submit Button ────────────────────────────
                    SizedBox(
                      height: 52,
                      child: FilledButton.icon(
                        onPressed: formState.isSubmitting ? null : _save,
                        icon: formState.isSubmitting
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.check),
                        label: Text(
                          formState.isEditing
                              ? 'Salvar Alterações'
                              : 'Criar Escala',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 32),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Modal bottom sheet for searching and selecting a ministry member to add to the schedule.
class _MemberPickerSheet extends ConsumerStatefulWidget {
  final String ministryId;
  final void Function(MinistryMember member, String role) onMemberSelected;

  const _MemberPickerSheet({
    required this.ministryId,
    required this.onMemberSelected,
  });

  @override
  ConsumerState<_MemberPickerSheet> createState() => _MemberPickerSheetState();
}

class _MemberPickerSheetState extends ConsumerState<_MemberPickerSheet> {
  final _searchController = TextEditingController();
  String _filter = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _chooseRoleAndAdd(
    BuildContext context,
    MinistryMember member,
    List<MinistryRole> availableRoles,
  ) {
    final defaultRole = availableRoles.isNotEmpty
        ? availableRoles.first.name
        : 'Ministro de Louvor';
    final roleController = TextEditingController(text: defaultRole);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 20,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Função para ${member.name}',
                style: Theme.of(ctx).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
              ),
              const SizedBox(height: 8),
              const Text(
                'Selecione uma função ou digite uma personalizada:',
                style: TextStyle(fontSize: 13),
              ),
              const SizedBox(height: 16),
              if (availableRoles.isNotEmpty) ...[
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: availableRoles.map((r) {
                    final isSelected =
                        roleController.text.trim().toLowerCase() ==
                            r.name.trim().toLowerCase();
                    return ChoiceChip(
                      label: Text(r.name),
                      selected: isSelected,
                      onSelected: (selected) {
                        if (selected) {
                          setSheetState(() {
                            roleController.text = r.name;
                          });
                        }
                      },
                    );
                  }).toList(),
                ),
                const SizedBox(height: 16),
              ],
              TextField(
                controller: roleController,
                decoration: const InputDecoration(
                  labelText: 'Função musical',
                  border: OutlineInputBorder(),
                  prefixIcon: Icon(Icons.music_note),
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: FilledButton(
                  onPressed: () {
                    final role = roleController.text.trim().isNotEmpty
                        ? roleController.text.trim()
                        : 'Integrante';
                    Navigator.of(ctx).pop(); // pop role sheet
                    Navigator.of(context).pop(); // pop member picker
                    widget.onMemberSelected(member, role);
                  },
                  child: const Text('Confirmar e Adicionar'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final formState = ref.watch(scheduleFormNotifierProvider);
    final theme = Theme.of(context);

    final members = formState.availableMembers;
    final filtered = members.where((m) {
      if (_filter.isEmpty) return true;
      final q = _filter.toLowerCase();
      return m.name.toLowerCase().contains(q) ||
          m.email.toLowerCase().contains(q);
    }).toList();

    return Padding(
      padding: EdgeInsets.only(
        top: 16,
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16.0),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    'Selecionar Integrante',
                    style: theme.textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
          ),
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
            child: TextField(
              controller: _searchController,
              decoration: InputDecoration(
                hintText: 'Buscar por nome ou e-mail...',
                prefixIcon: const Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                isDense: true,
              ),
              onChanged: (v) {
                setState(() {
                  _filter = v.trim();
                });
              },
            ),
          ),
          if (formState.isLoadingMembers)
            const Padding(
              padding: EdgeInsets.all(32.0),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (filtered.isEmpty)
            Padding(
              padding: const EdgeInsets.all(32.0),
              child: Center(
                child: Text(
                  _filter.isEmpty
                      ? 'Nenhum integrante cadastrado no ministério.'
                      : 'Nenhum integrante encontrado para "$_filter".',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurface.withValues(alpha: 0.6),
                  ),
                ),
              ),
            )
          else
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemCount: filtered.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (ctx, index) {
                  final member = filtered[index];
                  final isAlreadySelected =
                      formState.isMemberSelected(member.id, member.userId);

                  return ListTile(
                    enabled: !isAlreadySelected,
                    leading: CircleAvatar(
                      child: Text(
                        member.name.isNotEmpty
                            ? member.name[0].toUpperCase()
                            : '?',
                      ),
                    ),
                    title: Text(member.name),
                    subtitle: member.email.isNotEmpty
                        ? Text(member.email)
                        : member.isManual
                            ? const Text('Membro cadastrado manualmente')
                            : null,
                    trailing: isAlreadySelected
                        ? const Chip(
                            label: Text('Já escalado'),
                            visualDensity: VisualDensity.compact,
                          )
                        : const Icon(Icons.chevron_right),
                    onTap: isAlreadySelected
                        ? null
                        : () => _chooseRoleAndAdd(
                              context,
                              member,
                              formState.availableRoles,
                            ),
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
