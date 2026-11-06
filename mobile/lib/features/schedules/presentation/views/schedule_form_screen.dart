import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../app/providers.dart';
import '../../../../core/utils/date_utils.dart';
import '../../../auth/presentation/controllers/auth_controller.dart';
import '../../../ministry_context/presentation/controllers/ministry_context_controller.dart';
import '../../data/schedule_repository.dart';
import '../../domain/ministry_member.dart';
import '../../domain/ministry_role.dart';
import '../../domain/schedule.dart';
import '../../domain/schedule_participant.dart';
import '../../../repertoire/domain/song_summary.dart';
import '../../../repertoire/presentation/widgets/musical_key_selector.dart';
import '../../../teams/presentation/widgets/team_picker_sheet.dart';
import '../controllers/schedule_form_controller.dart';

/// Screen for creating and editing schedules in LouvAIO Mobile.
///
/// Redesigned into 5 tabs for Android parity with Web:
/// - Tab 1: Geral (title, single-line date/time, duration presets + custom, confirmation, visibility, notes)
/// - Tab 2: Integrantes (participants, team import, roles, availability conflicts)
/// - Tab 3: Músicas (repertoire song picker, ordering, compact musical key selector)
/// - Tab 4: Roteiro (timeline/liturgy items, ordering, types)
/// - Tab 5: Vestimenta (color palette, clothing pieces with add/edit/remove)
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

class _ScheduleFormScreenState extends ConsumerState<ScheduleFormScreen>
    with SingleTickerProviderStateMixin {
  static const List<int> _durationPresets = [60, 90, 120, 150, 180];

  final _formKey = GlobalKey<FormState>();
  late final TabController _tabController;
  late final TextEditingController _titleController;
  late final TextEditingController _notesController;
  late final TextEditingController _paletteController;
  late final TextEditingController _customDurationController;

  bool _isCustomDurationMode = false;
  bool _generalTabHasValidationError = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 5, vsync: this);
    _tabController.addListener(() {
      if (mounted) {
        setState(() {});
      }
    });

    _titleController =
        TextEditingController(text: widget.initialSchedule?.title ?? 'Culto');
    _notesController =
        TextEditingController(text: widget.initialSchedule?.notes ?? '');
    _paletteController = TextEditingController(
        text: widget.initialSchedule?.colorPalette ?? '');

    final initialDuration = widget.initialSchedule?.durationMinutes ?? 120;
    _isCustomDurationMode = !_durationPresets.contains(initialDuration);
    _customDurationController =
        TextEditingController(text: initialDuration.toString());

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
    _tabController.dispose();
    _titleController.dispose();
    _notesController.dispose();
    _paletteController.dispose();
    _customDurationController.dispose();
    super.dispose();
  }

  void _switchToTab(int index) {
    if (_tabController.index != index) {
      _tabController.animateTo(index);
    }
    setState(() {});
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
    final isValid = _formKey.currentState?.validate() ?? false;
    if (!isValid) {
      setState(() {
        _generalTabHasValidationError = true;
      });
      if (_tabController.index != 0) {
        _switchToTab(0);
      }
      return;
    }

    if (_generalTabHasValidationError) {
      setState(() {
        _generalTabHasValidationError = false;
      });
    }

    final activeMinistryId =
        ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
    final currentUserId = ref.read(authNotifierProvider).user?.id;

    final schedule =
        await ref.read(scheduleFormNotifierProvider.notifier).submit(
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

  void _openTeamPicker(BuildContext context) {
    final formState = ref.read(scheduleFormNotifierProvider);
    TeamPickerSheet.show(
      context: context,
      ministryId: widget.ministryId,
      availableMembers: formState.availableMembers,
      onTeamSelected: (team) {
        final currentMid =
            ref.read(ministryContextNotifierProvider).selectedMinistry?.id;
        if (currentMid != widget.ministryId) {
          return;
        }

        final memberMap = {for (final m in formState.availableMembers) m.id: m};
        final resolvableMembers = team.memberIds
            .map((id) => memberMap[id])
            .whereType<MinistryMember>()
            .toList();

        if (resolvableMembers.isEmpty) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Nenhum integrante ativo encontrado nesta equipe para importar.',
                ),
                duration: Duration(seconds: 3),
              ),
            );
          }
          return;
        }

        final addedCount = ref
            .read(scheduleFormNotifierProvider.notifier)
            .addParticipants(resolvableMembers);

        if (mounted) {
          if (addedCount == 0) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(
                content: Text(
                  'Todos os integrantes da equipe já estão na escala.',
                ),
                duration: Duration(seconds: 2),
              ),
            );
          } else {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text(
                  '$addedCount ${addedCount == 1 ? 'integrante adicionado' : 'integrantes adicionados'}.',
                ),
                duration: const Duration(seconds: 2),
              ),
            );
          }
        }
      },
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
          content: SingleChildScrollView(
            child: Column(
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

  Future<void> _editSongKey(
    BuildContext context,
    int index,
    ScheduleSong song,
  ) async {
    final result = await showMusicalKeyPickerSheet(
      context: context,
      currentKey: song.key,
      title: 'Tom da música: ${song.title ?? "Sem título"}',
    );
    if (result != null && mounted) {
      ref
          .read(scheduleFormNotifierProvider.notifier)
          .updateSongKey(index, result.selectedKey);
    }
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
      'Avisos': 'Avisos',
      'Oferta': 'Oferta',
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
                    final isSelected = selectedType == e.key ||
                        _getTimelineTypeLabel(selectedType) == e.value;
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

  void _openTemplateSelectorSheet(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (_) => _ScheduleTemplatePickerSheet(
        ministryId: widget.ministryId,
        onApplyTemplate: (template, {required replace}) {
          ref
              .read(scheduleFormNotifierProvider.notifier)
              .applyTemplate(template, replace: replace);
        },
      ),
    );
  }

  void _openClothingDialog(
    BuildContext context, {
    int? index,
    ScheduleClothingPiece? piece,
  }) {
    final initialDesc = piece != null
        ? (piece.description.isNotEmpty ? piece.description : piece.name)
        : '';
    final descController = TextEditingController(text: initialDesc);
    final selectedColors = <String>[
      if (piece != null && piece.colors.isNotEmpty)
        ...piece.colors
      else if (piece?.colorHex != null && piece!.colorHex!.isNotEmpty)
        piece.colorHex!
      else
        '#1E3A8A',
    ];

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
          title: Text(
            piece == null
                ? 'Adicionar Peça de Vestimenta'
                : 'Editar Peça de Vestimenta',
          ),
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
                    final isSelected = selectedColors.contains(hex);
                    final colorVal =
                        int.parse('FF${hex.replaceAll('#', '')}', radix: 16);
                    return GestureDetector(
                      onTap: () {
                        setDialogState(() {
                          if (isSelected && selectedColors.length > 1) {
                            selectedColors.remove(hex);
                          } else if (!isSelected) {
                            selectedColors
                              ..clear()
                              ..add(hex);
                          }
                        });
                      },
                      onLongPress: () {
                        setDialogState(() {
                          if (isSelected && selectedColors.length > 1) {
                            selectedColors.remove(hex);
                          } else if (!isSelected) {
                            selectedColors.add(hex);
                          }
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

                final updatedPiece = ScheduleClothingPiece(
                  id: piece?.id ??
                      DateTime.now().millisecondsSinceEpoch.toString(),
                  name: trimmedDesc,
                  description: trimmedDesc,
                  colors: List<String>.from(selectedColors),
                  colorHex:
                      selectedColors.isNotEmpty ? selectedColors.first : null,
                );

                if (index != null) {
                  ref
                      .read(scheduleFormNotifierProvider.notifier)
                      .updateClothingPiece(index, updatedPiece);
                } else {
                  ref
                      .read(scheduleFormNotifierProvider.notifier)
                      .addClothingPiece(updatedPiece);
                }
                Navigator.of(ctx).pop();
              },
              child: Text(piece == null ? 'Adicionar' : 'Salvar'),
            ),
          ],
        ),
      ),
    );
  }

  String _getTimelineTypeLabel(String type) {
    switch (type) {
      case 'worship':
      case 'Louvor':
      case 'Música':
        return 'Louvor';
      case 'word':
      case 'Palavra':
        return 'Palavra';
      case 'prayer':
      case 'Oração':
        return 'Oração';
      case 'transition':
      case 'Transição':
        return 'Transição';
      case 'Avisos':
        return 'Avisos';
      case 'Oferta':
        return 'Oferta';
      case 'Evento':
        return 'Evento';
      case 'other':
      case 'Outro':
      default:
        return 'Outro';
    }
  }

  // ─── Tab Content Builders ─────────────────────────────────────────────────

  Widget _buildGeneralTab(
    BuildContext context,
    ScheduleFormState formState,
    ScheduleFormNotifier notifier,
    ThemeData theme,
  ) {
    return ListView(
      key: const ValueKey('schedule_tab_content_geral'),
      padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 16.0),
      children: [
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: theme.dividerColor.withValues(alpha: 0.2),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14.0),
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
                  key: const ValueKey('schedule_title_input'),
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
                  onChanged: (val) {
                    if (_generalTabHasValidationError &&
                        val.trim().isNotEmpty) {
                      setState(() {
                        _generalTabHasValidationError = false;
                      });
                    }
                    notifier.setTitle(val);
                  },
                ),
                const SizedBox(height: 16),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      flex: 6,
                      child: InkWell(
                        key: const ValueKey('schedule_date_field'),
                        onTap: () => _pickDate(formState),
                        borderRadius: BorderRadius.circular(8),
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            labelText: 'Data *',
                            border: OutlineInputBorder(),
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 12,
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.calendar_today_outlined,
                                size: 16,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    formState.date.isNotEmpty
                                        ? AppDateUtils.formatDatePtBR(
                                            formState.date)
                                        : 'Selecionar data',
                                    key: const ValueKey('schedule_date_text'),
                                    maxLines: 1,
                                    softWrap: false,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      flex: 5,
                      child: InkWell(
                        key: const ValueKey('schedule_time_field'),
                        onTap: () => _pickTime(formState),
                        borderRadius: BorderRadius.circular(8),
                        child: InputDecorator(
                          decoration: const InputDecoration(
                            labelText: 'Horário *',
                            border: OutlineInputBorder(),
                            isDense: true,
                            contentPadding: EdgeInsets.symmetric(
                              horizontal: 10,
                              vertical: 12,
                            ),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                Icons.access_time_outlined,
                                size: 16,
                                color: theme.colorScheme.onSurfaceVariant,
                              ),
                              const SizedBox(width: 6),
                              Expanded(
                                child: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    formState.time.isNotEmpty
                                        ? AppDateUtils.formatTimePtBR(
                                            formState.time)
                                        : 'Selecionar horário',
                                    key: const ValueKey('schedule_time_text'),
                                    maxLines: 1,
                                    softWrap: false,
                                    style: theme.textTheme.bodyMedium?.copyWith(
                                      fontWeight: FontWeight.w500,
                                    ),
                                  ),
                                ),
                              ),
                            ],
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
                  children: [
                    ..._durationPresets.map((minutes) {
                      final isSelected = !_isCustomDurationMode &&
                          formState.durationMinutes == minutes;
                      final label = minutes < 60
                          ? '${minutes}m'
                          : minutes % 60 == 0
                              ? '${minutes ~/ 60}h'
                              : '${minutes ~/ 60}h ${minutes % 60}m';
                      return ChoiceChip(
                        key: ValueKey('duration_chip_$minutes'),
                        label: Text(label),
                        selected: isSelected,
                        onSelected: (selected) {
                          if (selected) {
                            setState(() {
                              _isCustomDurationMode = false;
                              _customDurationController.text =
                                  minutes.toString();
                            });
                            notifier.setDurationMinutes(minutes);
                          }
                        },
                      );
                    }),
                    ChoiceChip(
                      key: const ValueKey('duration_custom_chip'),
                      label: const Text('Personalizado'),
                      selected: _isCustomDurationMode,
                      onSelected: (selected) {
                        if (selected) {
                          setState(() {
                            _isCustomDurationMode = true;
                            _customDurationController.text =
                                formState.durationMinutes.toString();
                          });
                        }
                      },
                    ),
                  ],
                ),
                if (_isCustomDurationMode) ...[
                  const SizedBox(height: 12),
                  TextFormField(
                    key: const ValueKey('schedule_custom_duration_input'),
                    controller: _customDurationController,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'Duração em minutos (15 a 1440)',
                      hintText: 'ex: 75',
                      border: OutlineInputBorder(),
                      isDense: true,
                      suffixText: 'min',
                    ),
                    validator: (val) {
                      if (!_isCustomDurationMode) return null;
                      final parsed = int.tryParse((val ?? '').trim());
                      if (parsed == null || parsed < 15 || parsed > 1440) {
                        return 'Informe entre 15 e 1440 minutos.';
                      }
                      return null;
                    },
                    onChanged: (val) {
                      final parsed = int.tryParse(val.trim());
                      if (parsed != null && parsed >= 15 && parsed <= 1440) {
                        notifier.setDurationMinutes(parsed);
                      }
                    },
                  ),
                ],
                const SizedBox(height: 12),
                SwitchListTile(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Exigir confirmação de presença'),
                  subtitle: const Text(
                    'Integrantes poderão confirmar ou recusar participação',
                  ),
                  value: formState.requireConfirmation,
                  onChanged: (val) => notifier.setRequireConfirmation(val),
                ),
                SwitchListTile(
                  key: const Key('schedule_is_visible_switch'),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Visível para a equipe'),
                  subtitle: const Text(
                    'Quando desativado, apenas administradores visualizam a escala',
                  ),
                  value: formState.isVisible,
                  onChanged: (val) => notifier.setIsVisible(val),
                ),
                const SizedBox(height: 8),
                TextFormField(
                  key: const ValueKey('schedule_notes_input'),
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
      ],
    );
  }

  Widget _buildParticipantsTab(
    BuildContext context,
    ScheduleFormState formState,
    ScheduleFormNotifier notifier,
    ThemeData theme,
  ) {
    return ListView(
      key: const ValueKey('schedule_tab_content_integrantes'),
      padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 16.0),
      children: [
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: theme.dividerColor.withValues(alpha: 0.2),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    Text(
                      'Integrantes (${formState.participants.length})',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    Wrap(
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        OutlinedButton.icon(
                          key: const ValueKey('import_team_button'),
                          onPressed: () => _openTeamPicker(context),
                          icon: const Icon(Icons.groups_outlined, size: 18),
                          label: const Text('Importar Equipe'),
                          style: OutlinedButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                        FilledButton.tonalIcon(
                          key: const ValueKey('add_participant_button'),
                          onPressed: () => _openMemberPicker(context),
                          icon: const Icon(Icons.person_add_outlined, size: 18),
                          label: const Text('Adicionar'),
                          style: FilledButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                if (formState.isCheckingConflicts)
                  Padding(
                    key: const ValueKey('schedule_conflict_loading_indicator'),
                    padding: const EdgeInsets.only(top: 8.0, bottom: 4.0),
                    child: Row(
                      children: [
                        const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Verificando disponibilidade...',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.6),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                if (formState.conflictError != null &&
                    !formState.isCheckingConflicts)
                  Container(
                    key: const ValueKey('schedule_conflict_error_banner'),
                    margin: const EdgeInsets.only(top: 8.0, bottom: 8.0),
                    padding: const EdgeInsets.all(10.0),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.errorContainer
                          .withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: theme.colorScheme.error.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 8,
                      runSpacing: 4,
                      children: [
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.sync_problem,
                                size: 18, color: theme.colorScheme.error),
                            const SizedBox(width: 8),
                            Flexible(
                              child: Text(
                                formState.conflictError!,
                                style: theme.textTheme.bodySmall?.copyWith(
                                  color: theme.colorScheme.onErrorContainer,
                                ),
                              ),
                            ),
                          ],
                        ),
                        TextButton(
                          key: const ValueKey('retry_conflict_check_button'),
                          onPressed: () => notifier.retryConflictCheck(),
                          style: TextButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                            padding: const EdgeInsets.symmetric(horizontal: 8),
                          ),
                          child: const Text('Tentar novamente'),
                        ),
                      ],
                    ),
                  ),
                if (formState.selectedConflictsCount > 0 &&
                    !formState.isCheckingConflicts)
                  Container(
                    key: const ValueKey('schedule_conflict_warning_banner'),
                    margin: const EdgeInsets.only(top: 8.0, bottom: 8.0),
                    padding: const EdgeInsets.all(12.0),
                    decoration: BoxDecoration(
                      color: Colors.amber.shade50,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.amber.shade400),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.warning_amber_rounded,
                            size: 20, color: Colors.amber.shade900),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                formState.selectedConflictsCount == 1
                                    ? '1 integrante escalado está indisponível neste horário.'
                                    : '${formState.selectedConflictsCount} integrantes escalados estão indisponíveis neste horário.',
                                style: TextStyle(
                                  fontWeight: FontWeight.bold,
                                  fontSize: 13,
                                  color: Colors.amber.shade900,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Aviso informativo: você ainda pode salvar a escala normalmente.',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.amber.shade900
                                      .withValues(alpha: 0.8),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 12),
                if (formState.participants.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24.0),
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
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.5),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Toque em "Adicionar" para escalar músicos e líderes.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall?.copyWith(
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
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (ctx, index) {
                      final p = formState.participants[index];
                      final hasConflict = formState.hasConflict(p.id, p.userId);
                      return ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: CircleAvatar(
                          child: Text(
                            p.name.isNotEmpty ? p.name[0].toUpperCase() : '?',
                          ),
                        ),
                        title: Text(
                          p.name,
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        subtitle: Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 6,
                          runSpacing: 4,
                          children: [
                            Text(p.role),
                            if (hasConflict)
                              Container(
                                key: ValueKey(
                                    'participant_conflict_badge_${p.id}'),
                                padding: const EdgeInsets.symmetric(
                                    horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: Colors.amber.shade100,
                                  borderRadius: BorderRadius.circular(4),
                                  border:
                                      Border.all(color: Colors.amber.shade700),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      Icons.warning_amber_rounded,
                                      size: 12,
                                      color: Colors.amber.shade900,
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      'Indisponível',
                                      style: TextStyle(
                                        fontSize: 11,
                                        fontWeight: FontWeight.w600,
                                        color: Colors.amber.shade900,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                          ],
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              icon: const Icon(
                                Icons.edit_outlined,
                                size: 20,
                              ),
                              tooltip: 'Alterar função',
                              onPressed: () =>
                                  _editParticipantRole(context, index, p),
                            ),
                            IconButton(
                              visualDensity: VisualDensity.compact,
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
      ],
    );
  }

  Widget _buildSongsTab(
    BuildContext context,
    ScheduleFormState formState,
    ScheduleFormNotifier notifier,
    ThemeData theme,
  ) {
    return ListView(
      key: const ValueKey('schedule_tab_content_musicas'),
      padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 16.0),
      children: [
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: theme.dividerColor.withValues(alpha: 0.2),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
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
                    padding: const EdgeInsets.symmetric(vertical: 24.0),
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
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.5),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Toque em "Adicionar" para selecionar do repertório.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall?.copyWith(
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
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (ctx, index) {
                      final song = formState.songs[index];
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                CircleAvatar(
                                  radius: 16,
                                  child: Text(
                                    '${index + 1}',
                                    style: const TextStyle(fontSize: 13),
                                  ),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        song.title ?? 'Sem título',
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w600),
                                      ),
                                      if (song.artist != null &&
                                          song.artist!.isNotEmpty)
                                        Text(
                                          song.artist!,
                                          style: theme.textTheme.bodySmall
                                              ?.copyWith(
                                            color: theme.colorScheme.onSurface
                                                .withValues(alpha: 0.65),
                                          ),
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 6),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                InkWell(
                                  key: ValueKey(
                                      'schedule_song_key_chip_$index'),
                                  onTap: () =>
                                      _editSongKey(context, index, song),
                                  borderRadius: BorderRadius.circular(6),
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: theme.colorScheme
                                          .surfaceContainerHighest,
                                      borderRadius: BorderRadius.circular(6),
                                      border: Border.all(
                                        color: theme.colorScheme.outlineVariant,
                                      ),
                                    ),
                                    child: Text(
                                      song.key != null && song.key!.isNotEmpty
                                          ? 'Tom: ${song.key}'
                                          : 'Tom: —',
                                      style:
                                          theme.textTheme.labelSmall?.copyWith(
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 4),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon:
                                      const Icon(Icons.arrow_upward, size: 18),
                                  tooltip: 'Subir',
                                  onPressed: index > 0
                                      ? () =>
                                          notifier.reorderSongs(index, index - 1)
                                      : null,
                                ),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon: const Icon(Icons.arrow_downward,
                                      size: 18),
                                  tooltip: 'Descer',
                                  onPressed: index < formState.songs.length - 1
                                      ? () =>
                                          notifier.reorderSongs(index, index + 2)
                                      : null,
                                ),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon: Icon(
                                    Icons.remove_circle_outline,
                                    size: 20,
                                    color: theme.colorScheme.error,
                                  ),
                                  tooltip: 'Remover música',
                                  onPressed: () => notifier.removeSong(index),
                                ),
                              ],
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
      ],
    );
  }

  Widget _buildTimelineTab(
    BuildContext context,
    ScheduleFormState formState,
    ScheduleFormNotifier notifier,
    ThemeData theme,
  ) {
    return ListView(
      key: const ValueKey('schedule_tab_content_roteiro'),
      padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 16.0),
      children: [
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: theme.dividerColor.withValues(alpha: 0.2),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    Text(
                      'Roteiro (${formState.timeline.length})',
                      style: theme.textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      children: [
                        OutlinedButton.icon(
                          key: const ValueKey('open_templates_button'),
                          onPressed: () => _openTemplateSelectorSheet(context),
                          icon: const Icon(Icons.layers_outlined, size: 17),
                          label: const Text('Modelos'),
                          style: OutlinedButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                        FilledButton.tonalIcon(
                          key: const ValueKey('add_timeline_button'),
                          onPressed: () => _openTimelineDialog(context),
                          icon: const Icon(Icons.add_circle_outline, size: 18),
                          label: const Text('Adicionar'),
                          style: FilledButton.styleFrom(
                            visualDensity: VisualDensity.compact,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                if (formState.timeline.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24.0),
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
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.onSurface
                                  .withValues(alpha: 0.5),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            'Toque em "Adicionar" para definir a liturgia do culto.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall?.copyWith(
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
                    separatorBuilder: (_, __) => const Divider(height: 1),
                    itemBuilder: (ctx, index) {
                      final item = formState.timeline[index];
                      return Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8.0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 8, vertical: 4),
                                  decoration: BoxDecoration(
                                    color: theme
                                        .colorScheme.surfaceContainerHighest,
                                    borderRadius: BorderRadius.circular(6),
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
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        item.title,
                                        style: const TextStyle(
                                            fontWeight: FontWeight.w600),
                                      ),
                                      Text(
                                        _getTimelineTypeLabel(item.type),
                                        style: theme.textTheme.bodySmall
                                            ?.copyWith(
                                          color: theme.colorScheme.onSurface
                                              .withValues(alpha: 0.65),
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                            Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon:
                                      const Icon(Icons.arrow_upward, size: 18),
                                  tooltip: 'Subir',
                                  onPressed: index > 0
                                      ? () => notifier.reorderTimeline(
                                          index, index - 1)
                                      : null,
                                ),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon: const Icon(Icons.arrow_downward,
                                      size: 18),
                                  tooltip: 'Descer',
                                  onPressed:
                                      index < formState.timeline.length - 1
                                          ? () => notifier.reorderTimeline(
                                              index, index + 2)
                                          : null,
                                ),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon:
                                      const Icon(Icons.edit_outlined, size: 20),
                                  tooltip: 'Editar momento',
                                  onPressed: () => _openTimelineDialog(
                                    context,
                                    index: index,
                                    item: item,
                                  ),
                                ),
                                IconButton(
                                  visualDensity: VisualDensity.compact,
                                  icon: Icon(
                                    Icons.remove_circle_outline,
                                    size: 20,
                                    color: theme.colorScheme.error,
                                  ),
                                  tooltip: 'Remover momento',
                                  onPressed: () =>
                                      notifier.removeTimelineItem(index),
                                ),
                              ],
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
      ],
    );
  }

  Widget _buildDressCodeTab(
    BuildContext context,
    ScheduleFormState formState,
    ScheduleFormNotifier notifier,
    ThemeData theme,
  ) {
    return ListView(
      key: const ValueKey('schedule_tab_content_vestimenta'),
      padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 16.0),
      children: [
        Card(
          elevation: 0,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(
              color: theme.dividerColor.withValues(alpha: 0.2),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.all(14.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Wrap(
                  alignment: WrapAlignment.spaceBetween,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: 8,
                  runSpacing: 8,
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
                      icon: const Icon(Icons.add_circle_outline, size: 18),
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
                    final isSelected = formState.colorPalette == preset;
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
                    padding: const EdgeInsets.symmetric(vertical: 12.0),
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
                    separatorBuilder: (_, __) => const Divider(height: 1),
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
                                    color: theme.colorScheme.outlineVariant,
                                  ),
                                ),
                              ),
                        title: Text(
                          piece.description.isNotEmpty
                              ? piece.description
                              : (piece.name.isNotEmpty
                                  ? piece.name
                                  : 'Peça de roupa'),
                          style: const TextStyle(fontWeight: FontWeight.w500),
                        ),
                        subtitle: piece.colors.length > 1
                            ? Text(piece.colors.join(', '))
                            : (piece.colorHex != null
                                ? Text(piece.colorHex!)
                                : null),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              key: ValueKey('edit_clothing_button_$index'),
                              visualDensity: VisualDensity.compact,
                              icon: const Icon(Icons.edit_outlined, size: 20),
                              tooltip: 'Editar peça',
                              onPressed: () => _openClothingDialog(
                                context,
                                index: index,
                                piece: piece,
                              ),
                            ),
                            IconButton(
                              visualDensity: VisualDensity.compact,
                              icon: Icon(
                                Icons.remove_circle_outline,
                                size: 20,
                                color: theme.colorScheme.error,
                              ),
                              tooltip: 'Remover peça',
                              onPressed: () =>
                                  notifier.removeClothingPiece(index),
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
      ],
    );
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
      canPop: formState.isInvalidated ||
          !formState.isDirty ||
          formState.submitSuccess,
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
          bottom: TabBar(
            key: const ValueKey('schedule_form_tab_bar'),
            controller: _tabController,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            tabs: [
              Tab(
                key: const ValueKey('schedule_tab_geral'),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Geral'),
                    if (_generalTabHasValidationError) ...[
                      const SizedBox(width: 6),
                      Icon(
                        Icons.error_rounded,
                        key: const ValueKey('schedule_tab_geral_error_badge'),
                        size: 16,
                        color: theme.colorScheme.error,
                      ),
                    ],
                  ],
                ),
              ),
              Tab(
                key: const ValueKey('schedule_tab_integrantes'),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text('Integrantes'),
                    if (formState.selectedConflictsCount > 0) ...[
                      const SizedBox(width: 6),
                      Container(
                        key: const ValueKey('tab_conflict_badge'),
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: Colors.amber.shade100,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: Colors.amber.shade800),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.warning_amber_rounded,
                              size: 12,
                              color: Colors.amber.shade900,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              '${formState.selectedConflictsCount}',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                                color: Colors.amber.shade900,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              const Tab(
                key: ValueKey('schedule_tab_musicas'),
                text: 'Músicas',
              ),
              const Tab(
                key: ValueKey('schedule_tab_roteiro'),
                text: 'Roteiro',
              ),
              const Tab(
                key: ValueKey('schedule_tab_vestimenta'),
                text: 'Vestimenta',
              ),
            ],
          ),
        ),
        body: SafeArea(
          bottom: false,
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 700),
              child: Form(
                key: _formKey,
                child: Column(
                  children: [
                    if (formState.error != null)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(12, 12, 12, 0),
                        child: Card(
                          color: theme.colorScheme.errorContainer,
                          margin: EdgeInsets.zero,
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
                      ),
                    Expanded(
                      child: IndexedStack(
                        index: _tabController.index,
                        children: [
                          _buildGeneralTab(context, formState, notifier, theme),
                          _buildParticipantsTab(
                              context, formState, notifier, theme),
                          _buildSongsTab(context, formState, notifier, theme),
                          _buildTimelineTab(
                              context, formState, notifier, theme),
                          _buildDressCodeTab(
                              context, formState, notifier, theme),
                        ],
                      ),
                    ),
                    Container(
                      key: const ValueKey('schedule_submit_bar'),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.surface,
                        border: Border(
                          top: BorderSide(
                            color: theme.dividerColor.withValues(alpha: 0.2),
                          ),
                        ),
                      ),
                      child: SafeArea(
                        top: false,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
                          child: SizedBox(
                            width: double.infinity,
                            height: 48,
                            child: FilledButton.icon(
                              key: const ValueKey('schedule_submit_button'),
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
                        ),
                      ),
                    ),
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
    String? memberMatchedRole;
    if (member.roleIds.isNotEmpty && availableRoles.isNotEmpty) {
      for (final r in availableRoles) {
        if (member.roleIds.contains(r.id)) {
          memberMatchedRole = r.name;
          break;
        }
      }
    }
    final defaultRole = memberMatchedRole ??
        (availableRoles.isNotEmpty
            ? availableRoles.first.name
            : 'Ministro de Louvor');
    final roleController = TextEditingController(text: defaultRole);

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => SingleChildScrollView(
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
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SizedBox(
        key: const ValueKey('member_picker_sheet'),
        height: double.infinity,
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.max,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
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
            const Expanded(
              child: Center(child: CircularProgressIndicator()),
            )
          else if (filtered.isEmpty)
            Expanded(
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
            Expanded(
              child: ListView.separated(
                padding: const EdgeInsets.symmetric(vertical: 8),
                itemCount: filtered.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (ctx, index) {
                  final member = filtered[index];
                  final isAlreadySelected =
                      formState.isMemberSelected(member.id, member.userId);
                  final hasConflict =
                      formState.hasConflict(member.id, member.userId);

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
                        : Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              if (hasConflict)
                                Container(
                                  key: ValueKey(
                                      'member_picker_conflict_badge_${member.id}'),
                                  margin: const EdgeInsets.only(right: 6),
                                  padding: const EdgeInsets.symmetric(
                                      horizontal: 6, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: Colors.amber.shade100,
                                    borderRadius: BorderRadius.circular(4),
                                    border: Border.all(
                                        color: Colors.amber.shade700),
                                  ),
                                  child: Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      Icon(
                                        Icons.warning_amber_rounded,
                                        size: 12,
                                        color: Colors.amber.shade900,
                                      ),
                                      const SizedBox(width: 4),
                                      Text(
                                        'Indisponível',
                                        style: TextStyle(
                                          fontSize: 11,
                                          fontWeight: FontWeight.w600,
                                          color: Colors.amber.shade900,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              const Icon(Icons.chevron_right),
                            ],
                          ),
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
        ),
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
        top: 8,
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SizedBox(
        key: const ValueKey('song_picker_sheet'),
        height: double.infinity,
        child: SafeArea(
          top: false,
          child: Column(
            mainAxisSize: MainAxisSize.max,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(bottom: 4),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
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
            const Expanded(
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_error != null)
            Expanded(
              child: Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
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
            Expanded(
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
            Expanded(
              child: ListView.separated(
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
        ),
      ),
    );
  }
}

typedef _ApplyTemplateCallback = void Function(
  ScheduleTemplate template, {
  required bool replace,
});

class _ScheduleTemplatePickerSheet extends ConsumerStatefulWidget {
  final String ministryId;
  final _ApplyTemplateCallback onApplyTemplate;

  const _ScheduleTemplatePickerSheet({
    required this.ministryId,
    required this.onApplyTemplate,
  });

  @override
  ConsumerState<_ScheduleTemplatePickerSheet> createState() =>
      _ScheduleTemplatePickerSheetState();
}

class _ScheduleTemplatePickerSheetState
    extends ConsumerState<_ScheduleTemplatePickerSheet> {
  List<ScheduleTemplate> _templates = const [];
  bool _isLoading = true;
  String? _error;
  ScheduleTemplate? _pendingTemplate;

  @override
  void initState() {
    super.initState();
    _loadTemplates();
  }

  Future<void> _loadTemplates() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });
    try {
      final repo = ref.read(scheduleRepositoryProvider);
      final list = await repo.getScheduleTemplates(widget.ministryId);
      if (!mounted) return;
      setState(() {
        _templates = list;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Não foi possível carregar os modelos de roteiro.';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final formState = ref.watch(scheduleFormNotifierProvider);
    final pending = _pendingTemplate;

    return DraggableScrollableSheet(
      initialChildSize: 0.65,
      minChildSize: 0.45,
      maxChildSize: 0.9,
      expand: false,
      builder: (context, scrollController) {
        return SafeArea(
          top: false,
          child: Column(
            key: const ValueKey('schedule_template_picker_sheet'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 10, bottom: 4),
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: theme.colorScheme.outlineVariant,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
                child: Row(
                  children: [
                    if (pending != null)
                      IconButton(
                        key: const ValueKey('back_to_templates_list_button'),
                        icon: const Icon(Icons.arrow_back),
                        tooltip: 'Voltar aos modelos',
                        onPressed: () =>
                            setState(() => _pendingTemplate = null),
                      )
                    else
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: Icon(
                          Icons.layers_outlined,
                          size: 20,
                          color: theme.colorScheme.primary,
                        ),
                      ),
                    Expanded(
                      child: Text(
                        pending != null
                            ? 'Aplicar "${pending.name}"'
                            : 'Modelos de Roteiro',
                        style: theme.textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    IconButton(
                      key: const ValueKey('close_templates_sheet_button'),
                      icon: const Icon(Icons.close),
                      tooltip: 'Fechar',
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ],
                ),
              ),
              const Divider(height: 1),
              if (pending != null)
                Expanded(
                  child: _buildConfirmApplyView(
                    context,
                    theme,
                    pending,
                    formState,
                    scrollController,
                  ),
                )
              else if (_isLoading)
                const Expanded(
                  child: Center(
                    child: CircularProgressIndicator(
                      key: ValueKey('templates_loading_indicator'),
                    ),
                  ),
                )
              else if (_error != null)
                Expanded(
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.error_outline,
                            size: 40,
                            color: theme.colorScheme.error,
                          ),
                          const SizedBox(height: 12),
                          Text(
                            _error!,
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodyMedium?.copyWith(
                              color: theme.colorScheme.error,
                            ),
                          ),
                          const SizedBox(height: 12),
                          FilledButton.tonalIcon(
                            key: const ValueKey('retry_load_templates_button'),
                            onPressed: _loadTemplates,
                            icon: const Icon(Icons.refresh, size: 18),
                            label: const Text('Tentar novamente'),
                          ),
                        ],
                      ),
                    ),
                  ),
                )
              else if (_templates.isEmpty)
                Expanded(
                  child: Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24.0),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.layers_clear_outlined,
                            size: 44,
                            color: theme.colorScheme.onSurface
                                .withValues(alpha: 0.35),
                          ),
                          const SizedBox(height: 12),
                          Text(
                            'Nenhum modelo cadastrado',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Crie modelos de roteiro na página do Ministério para reutilizá-los nas escalas.',
                            textAlign: TextAlign.center,
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                )
              else
                Expanded(
                  child: SingleChildScrollView(
                    key: const ValueKey('schedule_templates_list'),
                    controller: scrollController,
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          formState.songs.isNotEmpty
                              ? 'Selecione um modelo para preencher o roteiro desta escala. As ${formState.songs.length} músicas selecionadas serão posicionadas automaticamente nos slots de música do modelo.'
                              : 'Selecione um modelo para preencher o roteiro desta escala.',
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 12),
                        for (final tmpl in _templates)
                          Card(
                            key: ValueKey('template_option_${tmpl.id}'),
                            elevation: 0,
                            margin: const EdgeInsets.only(bottom: 10),
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                              side: BorderSide(
                                color: theme.colorScheme.outlineVariant,
                              ),
                            ),
                            child: ListTile(
                              leading: CircleAvatar(
                                backgroundColor:
                                    theme.colorScheme.primaryContainer,
                                child: Icon(
                                  Icons.layers_outlined,
                                  size: 18,
                                  color: theme.colorScheme.onPrimaryContainer,
                                ),
                              ),
                              title: Text(
                                tmpl.name,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              subtitle: Wrap(
                                spacing: 8,
                                runSpacing: 2,
                                children: [
                                  if (tmpl.songsCount > 0)
                                    Text(
                                      '${tmpl.songsCount} ${tmpl.songsCount == 1 ? 'música' : 'músicas'}',
                                      style: theme.textTheme.bodySmall,
                                    ),
                                  if (tmpl.eventsCount > 0)
                                    Text(
                                      '${tmpl.eventsCount} ${tmpl.eventsCount == 1 ? 'evento' : 'eventos'}',
                                      style: theme.textTheme.bodySmall,
                                    ),
                                  Text(
                                    '• ${tmpl.items.length} itens no total',
                                    style: theme.textTheme.bodySmall?.copyWith(
                                      color: theme.colorScheme.onSurfaceVariant,
                                    ),
                                  ),
                                ],
                              ),
                              trailing: const Icon(Icons.chevron_right),
                              onTap: () =>
                                  setState(() => _pendingTemplate = tmpl),
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildConfirmApplyView(
    BuildContext context,
    ThemeData theme,
    ScheduleTemplate pending,
    ScheduleFormState formState,
    ScrollController scrollController,
  ) {
    final hasExistingItems = formState.timeline.isNotEmpty;
    var songIdx = 0;
    final previewItems = <({String type, String title, String duration})>[];
    for (final item in pending.items) {
      var displayTitle = item.title;
      if (item.type == 'song') {
        final realSong = songIdx < formState.songs.length
            ? formState.songs[songIdx]
            : null;
        songIdx++;
        if (realSong?.title != null && realSong!.title!.trim().isNotEmpty) {
          displayTitle = realSong.title!.trim();
        }
      }
      previewItems.add((
        type: item.type,
        title: displayTitle,
        duration: item.formattedDuration,
      ));
    }

    return Column(
      key: const ValueKey('apply_template_confirm_view'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(
          child: SingleChildScrollView(
            controller: scrollController,
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Como deseja aplicar este modelo ao roteiro atual?',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerHighest
                        .withValues(alpha: 0.5),
                    borderRadius: BorderRadius.circular(10),
                    border: Border.all(
                      color: theme.colorScheme.outlineVariant,
                    ),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'PRÉVIA DO ROTEIRO',
                        style: theme.textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      for (var i = 0; i < previewItems.length; i++) ...[
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 4),
                          child: Row(
                            children: [
                              Icon(
                                previewItems[i].type == 'song'
                                    ? Icons.music_note_outlined
                                    : Icons.event_note_outlined,
                                size: 16,
                                color: theme.colorScheme.primary,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  previewItems[i].title,
                                  style: theme.textTheme.bodyMedium,
                                ),
                              ),
                              if (previewItems[i].duration.isNotEmpty)
                                Text(
                                  previewItems[i].duration,
                                  style: theme.textTheme.labelSmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                    fontFamily: 'monospace',
                                  ),
                                ),
                            ],
                          ),
                        ),
                        if (i < previewItems.length - 1)
                          const Divider(height: 8, thickness: 0.5),
                      ],
                    ],
                  ),
                ),
                if (hasExistingItems) ...[
                  const SizedBox(height: 12),
                  Container(
                    key: const ValueKey('template_existing_items_warning'),
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.amber.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: Colors.amber.withValues(alpha: 0.4),
                      ),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(
                          Icons.warning_amber_rounded,
                          size: 18,
                          color: Colors.amber,
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'O roteiro atual tem ${formState.timeline.length} ${formState.timeline.length == 1 ? 'item' : 'itens'}. Escolha abaixo o que fazer.',
                            style: theme.textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        const Divider(height: 1),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              if (hasExistingItems) ...[
                SizedBox(
                  height: 44,
                  child: OutlinedButton(
                    key: const ValueKey('apply_template_append_button'),
                    onPressed: () {
                      widget.onApplyTemplate(pending, replace: false);
                      Navigator.of(context).pop();
                    },
                    child: const Text('Adicionar ao final do roteiro atual'),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              SizedBox(
                height: 44,
                child: FilledButton(
                  key: const ValueKey('apply_template_replace_button'),
                  onPressed: () {
                    widget.onApplyTemplate(pending, replace: true);
                    Navigator.of(context).pop();
                  },
                  child: Text(
                    hasExistingItems
                        ? 'Substituir roteiro atual'
                        : 'Aplicar modelo',
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
