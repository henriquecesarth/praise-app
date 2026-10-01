import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../../core/utils/date_utils.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../domain/ministry_member.dart';
import '../../domain/ministry_role.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_participant.dart';
import '../../../repertoire/domain/song_summary.dart';
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
  late final TextEditingController _paletteController;

  @override
  void initState() {
    super.initState();
    _titleController =
        TextEditingController(text: widget.initialSchedule?.title ?? 'Culto');
    _notesController =
        TextEditingController(text: widget.initialSchedule?.notes ?? '');
    _paletteController = TextEditingController(
        text: widget.initialSchedule?.colorPalette ?? '');

    WidgetsBinding.instance.addPostFrameCallback((_) {
      final currentUserId = ref.read(authNotifierProvider).user?.id ?? '';
      ref.read(scheduleFormNotifierProvider.notifier).init(
            ministryId: widget.ministryId,
            boundUserId: currentUserId,
            initialSchedule: widget.initialSchedule,
          );
    });
  }

  @override
  void dispose() {
    _titleController.dispose();
    _notesController.dispose();
    _paletteController.dispose();
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

    final activeMinistryId =
        ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
    final currentUserId = ref.read(authNotifierProvider).user?.id;

    final schedule = await ref.read(scheduleFormNotifierProvider.notifier).submit(
          currentMinistryId: activeMinistryId,
          currentUserId: currentUserId,
        );
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

  // ─── Content Management Handlers ──────────────────────────────────────────

  void _openSongPicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _SongPickerSheet(
        ministryId: widget.ministryId,
        onSongSelected: (song) {
          final added = ref
              .read(scheduleFormNotifierProvider.notifier)
              .addSong(ScheduleSong(
                id: song.id,
                title: song.title,
                artist: song.artistName,
                key: song.originalKey,
              ));
          if (added && mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('Música "${song.title}" adicionada à escala'),
                duration: const Duration(seconds: 2),
              ),
            );
          }
        },
      ),
    );
  }

  void _editSongKey(
    BuildContext context,
    int index,
    ScheduleSong song,
  ) {
    final controller = TextEditingController(text: song.key ?? '');
    final commonKeys = [
      'C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
      'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm',
    ];

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text('Tom da música: ${song.title ?? "Sem título"}'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Tons mais comuns:'),
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                runSpacing: 4,
                children: commonKeys.take(12).map((k) {
                  final isSelected = controller.text.trim() == k;
                  return ChoiceChip(
                    label: Text(k),
                    selected: isSelected,
                    onSelected: (selected) {
                      if (selected) {
                        setDialogState(() {
                          controller.text = k;
                        });
                      }
                    },
                  );
                }).toList(),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                autofocus: true,
                decoration: const InputDecoration(
                  labelText: 'Tom (ex: G, Em, F#m)',
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
                final newKey = controller.text.trim();
                ref
                    .read(scheduleFormNotifierProvider.notifier)
                    .updateSongKey(index, newKey.isEmpty ? null : newKey);
                Navigator.of(ctx).pop();
              },
              child: const Text('Salvar'),
            ),
          ],
        ),
      ),
    );
  }

  void _openTimelineDialog(
    BuildContext context, {
    int? index,
    ScheduleTimelineItem? item,
  }) {
    final titleController = TextEditingController(text: item?.title ?? '');
    final timeController = TextEditingController(text: item?.time ?? '');
    var selectedType = item?.type ?? 'worship';

    final types = <String, String>{
      'worship': 'Louvor',
      'word': 'Palavra',
      'prayer': 'Oração',
      'transition': 'Transição',
      'other': 'Outro',
    };

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: Text(item == null ? 'Novo Momento' : 'Editar Momento'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: titleController,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'Título do momento *',
                    hintText: 'ex: Oração Inicial, Louvor, Palavra',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: timeController,
                  decoration: const InputDecoration(
                    labelText: 'Horário previsto (opcional)',
                    hintText: 'ex: 19:15',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Tipo de momento:',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: types.entries.map((e) {
                    final isSelected = selectedType == e.key;
                    return ChoiceChip(
                      label: Text(e.value),
                      selected: isSelected,
                      onSelected: (selected) {
                        if (selected) {
                          setDialogState(() {
                            selectedType = e.key;
                          });
                        }
                      },
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () {
                final trimmedTitle = titleController.text.trim();
                if (trimmedTitle.isEmpty) return;

                final newItem = ScheduleTimelineItem(
                  id: item?.id ??
                      DateTime.now().millisecondsSinceEpoch.toString(),
                  title: trimmedTitle,
                  time: timeController.text.trim().isEmpty
                      ? null
                      : timeController.text.trim(),
                  type: selectedType,
                );

                if (index != null) {
                  ref
                      .read(scheduleFormNotifierProvider.notifier)
                      .updateTimelineItem(index, newItem);
                } else {
                  ref
                      .read(scheduleFormNotifierProvider.notifier)
                      .addTimelineItem(newItem);
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

  void _openClothingDialog(BuildContext context) {
    final descController = TextEditingController();
    String? selectedColorHex = '#1E3A8A';

    final presetColors = <Map<String, String>>[
      {'name': 'Preto', 'hex': '#000000'},
      {'name': 'Branco', 'hex': '#FFFFFF'},
      {'name': 'Azul Marinho', 'hex': '#1E3A8A'},
      {'name': 'Azul Claro', 'hex': '#3B82F6'},
      {'name': 'Verde Oliva', 'hex': '#065F46'},
      {'name': 'Vinho', 'hex': '#991B1B'},
      {'name': 'Mostarda', 'hex': '#D97706'},
      {'name': 'Marrom', 'hex': '#78350F'},
      {'name': 'Cinza', 'hex': '#6B7280'},
    ];

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Adicionar Peça de Vestimenta'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: descController,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'Descrição da peça *',
                    hintText: 'ex: Camisa social, Vestido, Calça jeans',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'Cor predominante:',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                ),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: presetColors.map((c) {
                    final hex = c['hex']!;
                    final isSelected = selectedColorHex == hex;
                    final colorVal =
                        int.parse('FF${hex.replaceAll('#', '')}', radix: 16);
                    return GestureDetector(
                      onTap: () {
                        setDialogState(() {
                          selectedColorHex = hex;
                        });
                      },
                      child: Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Color(colorVal),
                          border: Border.all(
                            color: isSelected
                                ? Theme.of(ctx).colorScheme.primary
                                : Colors.grey.shade400,
                            width: isSelected ? 3 : 1,
                          ),
                        ),
                        child: isSelected
                            ? Icon(
                                Icons.check,
                                size: 18,
                                color: colorVal == 0xFFFFFFFF
                                    ? Colors.black
                                    : Colors.white,
                              )
                            : null,
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(ctx).pop(),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              key: const ValueKey('confirm_add_clothing_button'),
              onPressed: () {
                final trimmedDesc = descController.text.trim();
                if (trimmedDesc.isEmpty) return;

                ref.read(scheduleFormNotifierProvider.notifier).addClothingPiece(
                      ScheduleClothingPiece(
                        id: DateTime.now().millisecondsSinceEpoch.toString(),
                        name: trimmedDesc,
                        description: trimmedDesc,
                        colors: selectedColorHex != null
                            ? [selectedColorHex!]
                            : const [],
                        colorHex: selectedColorHex,
                      ),
                    );
                Navigator.of(ctx).pop();
              },
              child: const Text('Adicionar'),
            ),
          ],
        ),
      ),
    );
  }

  String _getTimelineTypeLabel(String type) {
    switch (type) {
      case 'worship':
        return 'Louvor';
      case 'word':
        return 'Palavra';
      case 'prayer':
        return 'Oração';
      case 'transition':
        return 'Transição';
      case 'other':
      default:
        return 'Outro';
    }
  }

  @override
  Widget build(BuildContext context) {
    // Tenant switch race safety: permanently invalidate and pop if active ministry changes
    ref.listen<MinistryContextState>(ministryContextNotifierProvider,
        (previous, next) {
      final newMinistryId = next.selectedMinistry?.id;
      if (newMinistryId != null &&
          newMinistryId.isNotEmpty &&
          newMinistryId != widget.ministryId) {
        ref.read(scheduleFormNotifierProvider.notifier).invalidateTenant();
        if (mounted) {
          Navigator.of(context).pop();
        }
      }
    });

    // Session switch protection: if active user changes away from bound user
    ref.listen<AuthState>(authNotifierProvider, (previous, next) {
      final currentUid = next.user?.id;
      final boundUid = ref.read(scheduleFormNotifierProvider).boundUserId;
      if (boundUid.isNotEmpty &&
          currentUid != null &&
          currentUid.isNotEmpty &&
          currentUid != boundUid) {
        ref.read(scheduleFormNotifierProvider.notifier).invalidateTenant();
        if (mounted) {
          Navigator.of(context).pop();
        }
      }
    });

    final formState = ref.watch(scheduleFormNotifierProvider);
    final notifier = ref.read(scheduleFormNotifierProvider.notifier);
    final theme = Theme.of(context);

    return PopScope(
      canPop: formState.isInvalidated || !formState.isDirty || formState.submitSuccess,
      onPopInvokedWithResult: (didPop, result) async {
        if (didPop) return;
        if (formState.isInvalidated) {
          Navigator.of(context).pop();
          return;
        }
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
                            SwitchListTile(
                              key: const Key('schedule_is_visible_switch'),
                              contentPadding: EdgeInsets.zero,
                              title: const Text('Visível para a equipe'),
                              subtitle: const Text(
                                'Quando desativado, apenas administradores visualizam a escala',
                              ),
                              value: formState.isVisible,
                              onChanged: (val) =>
                                  notifier.setIsVisible(val),
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
                                  key: const ValueKey('add_participant_button'),
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

                    const SizedBox(height: 16),

                    // ─── Songs / Repertoire Section ───────────────────────
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
                                  'Músicas (${formState.songs.length})',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                FilledButton.tonalIcon(
                                  key: const ValueKey('add_song_button'),
                                  onPressed: () => _openSongPicker(context),
                                  icon: const Icon(Icons.playlist_add, size: 18),
                                  label: const Text('Adicionar'),
                                  style: FilledButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            if (formState.songs.isEmpty)
                              Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 24.0),
                                child: Center(
                                  child: Column(
                                    children: [
                                      Icon(
                                        Icons.library_music_outlined,
                                        size: 40,
                                        color: theme.colorScheme.onSurface
                                            .withValues(alpha: 0.3),
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        'Nenhuma música adicionada à escala.',
                                        style: theme.textTheme.bodyMedium
                                            ?.copyWith(
                                          color: theme.colorScheme.onSurface
                                              .withValues(alpha: 0.5),
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Toque em "Adicionar" para selecionar do repertório.',
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
                                itemCount: formState.songs.length,
                                separatorBuilder: (_, __) =>
                                    const Divider(height: 1),
                                itemBuilder: (ctx, index) {
                                  final song = formState.songs[index];
                                  return ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    leading: CircleAvatar(
                                      child: Text('${index + 1}'),
                                    ),
                                    title: Text(
                                      song.title ?? 'Sem título',
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600),
                                    ),
                                    subtitle: song.artist != null
                                        ? Text(song.artist!)
                                        : null,
                                    trailing: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        InkWell(
                                          onTap: () => _editSongKey(
                                              context, index, song),
                                          borderRadius:
                                              BorderRadius.circular(6),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 8, vertical: 4),
                                            decoration: BoxDecoration(
                                              color: theme.colorScheme
                                                  .surfaceContainerHighest,
                                              borderRadius:
                                                  BorderRadius.circular(6),
                                              border: Border.all(
                                                color: theme
                                                    .colorScheme.outlineVariant,
                                              ),
                                            ),
                                            child: Text(
                                              song.key != null &&
                                                      song.key!.isNotEmpty
                                                  ? 'Tom: ${song.key}'
                                                  : 'Tom: —',
                                              style: theme.textTheme.labelSmall
                                                  ?.copyWith(
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                        ),
                                        IconButton(
                                          icon: const Icon(
                                              Icons.arrow_upward,
                                              size: 18),
                                          tooltip: 'Subir',
                                          onPressed: index > 0
                                              ? () => notifier.reorderSongs(
                                                  index, index - 1)
                                              : null,
                                        ),
                                        IconButton(
                                          icon: const Icon(
                                              Icons.arrow_downward,
                                              size: 18),
                                          tooltip: 'Descer',
                                          onPressed: index <
                                                  formState.songs.length - 1
                                              ? () => notifier.reorderSongs(
                                                  index, index + 2)
                                              : null,
                                        ),
                                        IconButton(
                                          icon: Icon(
                                            Icons.remove_circle_outline,
                                            size: 20,
                                            color: theme.colorScheme.error,
                                          ),
                                          tooltip: 'Remover música',
                                          onPressed: () =>
                                              notifier.removeSong(index),
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

                    const SizedBox(height: 16),

                    // ─── Timeline / Roteiro Section ───────────────────────
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
                                  'Roteiro (${formState.timeline.length})',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                FilledButton.tonalIcon(
                                  key: const ValueKey('add_timeline_button'),
                                  onPressed: () => _openTimelineDialog(context),
                                  icon: const Icon(Icons.add_circle_outline,
                                      size: 18),
                                  label: const Text('Adicionar'),
                                  style: FilledButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 12),
                            if (formState.timeline.isEmpty)
                              Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 24.0),
                                child: Center(
                                  child: Column(
                                    children: [
                                      Icon(
                                        Icons.view_timeline_outlined,
                                        size: 40,
                                        color: theme.colorScheme.onSurface
                                            .withValues(alpha: 0.3),
                                      ),
                                      const SizedBox(height: 8),
                                      Text(
                                        'Nenhum momento adicionado ao roteiro.',
                                        style: theme.textTheme.bodyMedium
                                            ?.copyWith(
                                          color: theme.colorScheme.onSurface
                                              .withValues(alpha: 0.5),
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Toque em "Adicionar" para definir a liturgia do culto.',
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
                                itemCount: formState.timeline.length,
                                separatorBuilder: (_, __) =>
                                    const Divider(height: 1),
                                itemBuilder: (ctx, index) {
                                  final item = formState.timeline[index];
                                  return ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    leading: Container(
                                      padding: const EdgeInsets.symmetric(
                                          horizontal: 8, vertical: 4),
                                      decoration: BoxDecoration(
                                        color: theme.colorScheme
                                            .surfaceContainerHighest,
                                        borderRadius:
                                            BorderRadius.circular(6),
                                      ),
                                      child: Text(
                                        item.time?.isNotEmpty == true
                                            ? item.time!
                                            : '—',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.bold,
                                          fontFamily: 'monospace',
                                        ),
                                      ),
                                    ),
                                    title: Text(
                                      item.title,
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w600),
                                    ),
                                    subtitle:
                                        Text(_getTimelineTypeLabel(item.type)),
                                    trailing: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        IconButton(
                                          icon: const Icon(
                                              Icons.arrow_upward,
                                              size: 18),
                                          tooltip: 'Subir',
                                          onPressed: index > 0
                                              ? () => notifier.reorderTimeline(
                                                  index, index - 1)
                                              : null,
                                        ),
                                        IconButton(
                                          icon: const Icon(
                                              Icons.arrow_downward,
                                              size: 18),
                                          tooltip: 'Descer',
                                          onPressed: index <
                                                  formState.timeline.length - 1
                                              ? () => notifier.reorderTimeline(
                                                  index, index + 2)
                                              : null,
                                        ),
                                        IconButton(
                                          icon: const Icon(
                                              Icons.edit_outlined,
                                              size: 20),
                                          tooltip: 'Editar momento',
                                          onPressed: () => _openTimelineDialog(
                                            context,
                                            index: index,
                                            item: item,
                                          ),
                                        ),
                                        IconButton(
                                          icon: Icon(
                                            Icons.remove_circle_outline,
                                            size: 20,
                                            color: theme.colorScheme.error,
                                          ),
                                          tooltip: 'Remover momento',
                                          onPressed: () => notifier
                                              .removeTimelineItem(index),
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

                    const SizedBox(height: 16),

                    // ─── Clothing / Vestimenta Section ────────────────────
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
                                  'Vestimenta & Cores',
                                  style: theme.textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                FilledButton.tonalIcon(
                                  key: const ValueKey('add_clothing_button'),
                                  onPressed: () => _openClothingDialog(context),
                                  icon: const Icon(Icons.add_circle_outline,
                                      size: 18),
                                  label: const Text('Adicionar Peça'),
                                  style: FilledButton.styleFrom(
                                    visualDensity: VisualDensity.compact,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 16),
                            TextField(
                              controller: _paletteController,
                              decoration: InputDecoration(
                                labelText: 'Paleta de Cores / Tema',
                                hintText:
                                    'ex: Tons Terrosos, Preto Básico, Azul e Branco',
                                border: const OutlineInputBorder(),
                                prefixIcon: const Icon(Icons.palette_outlined),
                                suffixIcon: _paletteController.text.isNotEmpty
                                    ? IconButton(
                                        icon: const Icon(Icons.clear, size: 18),
                                        onPressed: () {
                                          _paletteController.clear();
                                          notifier.setColorPalette(null);
                                        },
                                      )
                                    : null,
                              ),
                              onChanged: (val) => notifier.setColorPalette(val),
                            ),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              runSpacing: 4,
                              children: [
                                'Tons Terrosos',
                                'Preto e Branco',
                                'Azul Marinho',
                                'Verde Oliva',
                                'Monocromático',
                              ].map((preset) {
                                final isSelected =
                                    formState.colorPalette == preset;
                                return ChoiceChip(
                                  label: Text(preset),
                                  selected: isSelected,
                                  onSelected: (selected) {
                                    if (selected) {
                                      _paletteController.text = preset;
                                      notifier.setColorPalette(preset);
                                    } else {
                                      _paletteController.clear();
                                      notifier.setColorPalette(null);
                                    }
                                  },
                                );
                              }).toList(),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              'Peças (${formState.clothingPieces.length})',
                              style: theme.textTheme.bodyMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 8),
                            if (formState.clothingPieces.isEmpty)
                              Padding(
                                padding:
                                    const EdgeInsets.symmetric(vertical: 12.0),
                                child: Text(
                                  'Nenhuma peça de vestimenta adicionada.',
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: theme.colorScheme.onSurface
                                        .withValues(alpha: 0.5),
                                  ),
                                ),
                              )
                            else
                              ListView.separated(
                                shrinkWrap: true,
                                physics: const NeverScrollableScrollPhysics(),
                                itemCount: formState.clothingPieces.length,
                                separatorBuilder: (_, __) =>
                                    const Divider(height: 1),
                                itemBuilder: (ctx, index) {
                                  final piece = formState.clothingPieces[index];
                                  final colorVal = piece.colorHex != null
                                      ? int.tryParse(
                                          'FF${piece.colorHex!.replaceAll('#', '').trim()}',
                                          radix: 16)
                                      : null;

                                  return ListTile(
                                    contentPadding: EdgeInsets.zero,
                                    leading: piece.colors.length > 1
                                        ? Row(
                                            mainAxisSize: MainAxisSize.min,
                                            children: piece.colors.take(3).map((hex) {
                                              final cVal = int.tryParse(
                                                  'FF${hex.replaceAll('#', '').trim()}',
                                                  radix: 16);
                                              return Container(
                                                width: 14,
                                                height: 14,
                                                margin: const EdgeInsets.only(right: 3),
                                                decoration: BoxDecoration(
                                                  shape: BoxShape.circle,
                                                  color: cVal != null
                                                      ? Color(cVal)
                                                      : theme.colorScheme.primary,
                                                  border: Border.all(
                                                    color: theme.colorScheme.outlineVariant,
                                                  ),
                                                ),
                                              );
                                            }).toList(),
                                          )
                                        : Container(
                                            width: 22,
                                            height: 22,
                                            decoration: BoxDecoration(
                                              shape: BoxShape.circle,
                                              color: colorVal != null
                                                  ? Color(colorVal)
                                                  : theme.colorScheme.primary,
                                              border: Border.all(
                                                color: theme
                                                    .colorScheme.outlineVariant,
                                              ),
                                            ),
                                          ),
                                    title: Text(
                                      piece.description.isNotEmpty
                                          ? piece.description
                                          : (piece.name.isNotEmpty
                                              ? piece.name
                                              : 'Peça de roupa'),
                                      style: const TextStyle(
                                          fontWeight: FontWeight.w500),
                                    ),
                                    subtitle: piece.colors.length > 1
                                        ? Text(piece.colors.join(', '))
                                        : (piece.colorHex != null
                                            ? Text(piece.colorHex!)
                                            : null),
                                    trailing: IconButton(
                                      icon: Icon(
                                        Icons.remove_circle_outline,
                                        size: 20,
                                        color: theme.colorScheme.error,
                                      ),
                                      tooltip: 'Remover peça',
                                      onPressed: () => notifier
                                          .removeClothingPiece(index),
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

/// Modal bottom sheet for searching and selecting a repertoire song.
class _SongPickerSheet extends ConsumerStatefulWidget {
  final String ministryId;
  final void Function(SongSummary song) onSongSelected;

  const _SongPickerSheet({
    required this.ministryId,
    required this.onSongSelected,
  });

  @override
  ConsumerState<_SongPickerSheet> createState() => _SongPickerSheetState();
}

class _SongPickerSheetState extends ConsumerState<_SongPickerSheet> {
  final _searchController = TextEditingController();
  List<SongSummary> _songs = [];
  bool _isLoading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _fetchSongs();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _fetchSongs([String? query]) async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(repertoireRepositoryProvider)
          .listSongs(widget.ministryId, search: query, limit: 50);
      if (!mounted) return;
      setState(() {
        _songs = result.songs;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Não foi possível carregar as músicas.';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final formState = ref.watch(scheduleFormNotifierProvider);
    final theme = Theme.of(context);

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
                    'Selecionar Música do Repertório',
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
                hintText: 'Buscar por título, artista ou tom...',
                prefixIcon: const Icon(Icons.search),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                ),
                isDense: true,
              ),
              onSubmitted: (v) => _fetchSongs(v.trim()),
              onChanged: (v) {
                if (v.trim().isEmpty) {
                  _fetchSongs();
                }
              },
            ),
          ),
          if (_isLoading)
            const Padding(
              padding: EdgeInsets.all(32.0),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            Padding(
              padding: const EdgeInsets.all(32.0),
              child: Center(
                child: Column(
                  children: [
                    Text(
                      _error!,
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.error,
                      ),
                    ),
                    const SizedBox(height: 8),
                    OutlinedButton(
                      onPressed: () =>
                          _fetchSongs(_searchController.text.trim()),
                      child: const Text('Tentar novamente'),
                    ),
                  ],
                ),
              ),
            )
          else if (_songs.isEmpty)
            Padding(
              padding: const EdgeInsets.all(32.0),
              child: Center(
                child: Text(
                  _searchController.text.trim().isEmpty
                      ? 'Nenhuma música no repertório do ministério.'
                      : 'Nenhuma música encontrada para "${_searchController.text.trim()}".',
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
                itemCount: _songs.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (ctx, index) {
                  final song = _songs[index];
                  final isAlreadySelected = formState.isSongSelected(song.id);

                  return ListTile(
                    enabled: !isAlreadySelected,
                    leading: CircleAvatar(
                      backgroundColor: isAlreadySelected
                          ? theme.disabledColor.withValues(alpha: 0.1)
                          : theme.colorScheme.primaryContainer,
                      child: Icon(
                        Icons.music_note,
                        color: isAlreadySelected
                            ? theme.disabledColor
                            : theme.colorScheme.onPrimaryContainer,
                      ),
                    ),
                    title: Text(
                      song.title,
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                        color: isAlreadySelected ? theme.disabledColor : null,
                      ),
                    ),
                    subtitle: Text(
                      song.artistName ?? 'Artista não informado',
                      style: TextStyle(
                        color: isAlreadySelected ? theme.disabledColor : null,
                      ),
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (song.originalKey != null &&
                            song.originalKey!.isNotEmpty)
                          Container(
                            margin: const EdgeInsets.only(right: 8),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: theme.colorScheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              song.originalKey!,
                              style: theme.textTheme.labelSmall?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        if (isAlreadySelected)
                          const Chip(
                            label: Text('Já escalada'),
                            visualDensity: VisualDensity.compact,
                          )
                        else
                          const Icon(Icons.add_circle_outline),
                      ],
                    ),
                    onTap: isAlreadySelected
                        ? null
                        : () {
                            Navigator.of(context).pop();
                            widget.onSongSelected(song);
                          },
                  );
                },
              ),
            ),
        ],
      ),
    );
  }
}
