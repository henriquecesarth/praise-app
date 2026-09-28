import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../core/errors/app_failure.dart';
import '../../../../core/utils/date_utils.dart';
import '../../domain/availability.dart';
import '../controllers/availability_providers.dart';

/// Modal bottom sheet form for creating or editing an availability period.
class AvailabilityFormModal extends ConsumerStatefulWidget {
  final String ministryId;
  final MemberAvailability? editingItem;
  final ValueChanged<MemberAvailability> onSaved;

  const AvailabilityFormModal({
    super.key,
    required this.ministryId,
    this.editingItem,
    required this.onSaved,
  });

  static Future<void> show({
    required BuildContext context,
    required String ministryId,
    MemberAvailability? editingItem,
    required ValueChanged<MemberAvailability> onSaved,
  }) {
    return showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => AvailabilityFormModal(
        ministryId: ministryId,
        editingItem: editingItem,
        onSaved: onSaved,
      ),
    );
  }

  @override
  ConsumerState<AvailabilityFormModal> createState() =>
      _AvailabilityFormModalState();
}

class _AvailabilityFormModalState extends ConsumerState<AvailabilityFormModal> {
  late String _startDate;
  late String _endDate;
  late bool _allDay;
  late String _startTime;
  late String _endTime;
  late final TextEditingController _reasonController;

  bool _isSaving = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    final item = widget.editingItem;
    final todayStr = _toCivilDateStr(DateTime.now());

    if (item != null) {
      _startDate = item.startDate;
      _endDate = item.endDate;
      _allDay = item.allDay;
      _startTime = item.startTime ?? '19:00';
      _endTime = item.endTime ?? '22:00';
      _reasonController = TextEditingController(text: item.reason ?? '');
    } else {
      _startDate = todayStr;
      _endDate = todayStr;
      _allDay = true;
      _startTime = '19:00';
      _endTime = '22:00';
      _reasonController = TextEditingController();
    }
  }

  @override
  void dispose() {
    _reasonController.dispose();
    super.dispose();
  }

  static String _toCivilDateStr(DateTime dt) {
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  Future<void> _pickDate({required bool isStart}) async {
    final current =
        DateTime.tryParse(isStart ? _startDate : _endDate) ?? DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime(2020),
      lastDate: DateTime(2035),
    );

    if (picked != null) {
      final pickedStr = _toCivilDateStr(picked);
      setState(() {
        if (isStart) {
          _startDate = pickedStr;
          // If start is after end, adjust end to match start
          if (_endDate.compareTo(_startDate) < 0) {
            _endDate = _startDate;
          }
        } else {
          _endDate = pickedStr;
        }
        _errorMessage = null;
      });
    }
  }

  Future<void> _pickTime({required bool isStart}) async {
    final timeStr = isStart ? _startTime : _endTime;
    final parts = timeStr.split(':');
    final initial = TimeOfDay(
      hour: parts.isNotEmpty ? (int.tryParse(parts[0]) ?? 19) : 19,
      minute: parts.length > 1 ? (int.tryParse(parts[1]) ?? 0) : 0,
    );

    final picked = await showTimePicker(
      context: context,
      initialTime: initial,
    );

    if (picked != null) {
      final h = picked.hour.toString().padLeft(2, '0');
      final m = picked.minute.toString().padLeft(2, '0');
      setState(() {
        if (isStart) {
          _startTime = '$h:$m';
        } else {
          _endTime = '$h:$m';
        }
        _errorMessage = null;
      });
    }
  }

  Future<void> _save() async {
    final clientError = AvailabilityValidator.validate(
      startDate: _startDate,
      endDate: _endDate,
      allDay: _allDay,
      startTime: _allDay ? null : _startTime,
      endTime: _allDay ? null : _endTime,
      reason: _reasonController.text,
    );

    if (clientError != null) {
      setState(() {
        _errorMessage = clientError;
      });
      return;
    }

    setState(() {
      _isSaving = true;
      _errorMessage = null;
    });

    final repo = ref.read(availabilityRepositoryProvider);

    try {
      final MemberAvailability saved;
      if (widget.editingItem != null) {
        final payload = UpdateAvailabilityPayload(
          startDate: _startDate,
          endDate: _endDate,
          allDay: _allDay,
          startTime: _allDay ? null : _startTime,
          endTime: _allDay ? null : _endTime,
          reason: _reasonController.text,
        );
        saved = await repo.updateMyAvailability(
          widget.ministryId,
          widget.editingItem!.id,
          payload,
        );
      } else {
        final payload = CreateAvailabilityPayload(
          startDate: _startDate,
          endDate: _endDate,
          allDay: _allDay,
          startTime: _allDay ? null : _startTime,
          endTime: _allDay ? null : _endTime,
          reason: _reasonController.text,
        );
        saved = await repo.createMyAvailability(
          widget.ministryId,
          payload,
        );
      }

      if (mounted) {
        widget.onSaved(saved);
        Navigator.of(context).pop();
      }
    } on AppFailure catch (e) {
      if (mounted) {
        setState(() {
          _isSaving = false;
          _errorMessage = e.message;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isSaving = false;
          _errorMessage = 'Erro ao salvar indisponibilidade: $e';
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isEditing = widget.editingItem != null;
    final viewInsets = MediaQuery.of(context).viewInsets;

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 600),
        child: Material(
          color: theme.colorScheme.surface,
          borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          child: Padding(
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 20,
              bottom: 20 + viewInsets.bottom,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // Handle bar
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: theme.dividerColor.withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Modal Header
                  Row(
                    children: [
                      Icon(
                        isEditing ? Icons.edit_calendar : Icons.event_busy,
                        color: theme.colorScheme.primary,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          isEditing
                              ? 'Editar Indisponibilidade'
                              : 'Nova Indisponibilidade',
                          style: theme.textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close),
                        tooltip: 'Fechar',
                        onPressed: _isSaving
                            ? null
                            : () => Navigator.of(context).pop(),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Error message banner
                  if (_errorMessage != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: theme.colorScheme.errorContainer,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.error_outline,
                            color: theme.colorScheme.onErrorContainer,
                            size: 20,
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Text(
                              _errorMessage!,
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
                    const SizedBox(height: 16),
                  ],

                  // All day toggle
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text(
                      'Dia inteiro',
                      style: TextStyle(fontWeight: FontWeight.w600),
                    ),
                    subtitle: const Text(
                      'Indisponível durante todo o período selecionado',
                      style: TextStyle(fontSize: 12),
                    ),
                    value: _allDay,
                    onChanged: _isSaving
                        ? null
                        : (val) {
                            setState(() {
                              _allDay = val;
                              _errorMessage = null;
                            });
                          },
                  ),
                  const Divider(),
                  const SizedBox(height: 8),

                  // Dates row
                  Row(
                    children: [
                      Expanded(
                        child: _buildPickerField(
                          label: 'Data Inicial',
                          value: AppDateUtils.formatDatePtBR(_startDate),
                          icon: Icons.calendar_today,
                          onTap:
                              _isSaving ? null : () => _pickDate(isStart: true),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _buildPickerField(
                          label: 'Data Final',
                          value: AppDateUtils.formatDatePtBR(_endDate),
                          icon: Icons.calendar_today,
                          onTap: _isSaving
                              ? null
                              : () => _pickDate(isStart: false),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  // Times row (if not all day)
                  if (!_allDay) ...[
                    Row(
                      children: [
                        Expanded(
                          child: _buildPickerField(
                            label: 'Horário Inicial',
                            value: AppDateUtils.formatTimePtBR(_startTime),
                            icon: Icons.access_time,
                            onTap: _isSaving
                                ? null
                                : () => _pickTime(isStart: true),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _buildPickerField(
                            label: 'Horário Final',
                            value: AppDateUtils.formatTimePtBR(_endTime),
                            icon: Icons.access_time,
                            onTap: _isSaving
                                ? null
                                : () => _pickTime(isStart: false),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                  ],

                  // Reason input
                  TextFormField(
                    controller: _reasonController,
                    enabled: !_isSaving,
                    maxLength: 255,
                    maxLines: 2,
                    decoration: const InputDecoration(
                      labelText: 'Motivo (opcional)',
                      hintText: 'Ex: Viagem, compromisso pessoal, trabalho',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Action buttons
                  Row(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      TextButton(
                        onPressed: _isSaving
                            ? null
                            : () => Navigator.of(context).pop(),
                        child: const Text('Cancelar'),
                      ),
                      const SizedBox(width: 12),
                      FilledButton(
                        onPressed: _isSaving ? null : _save,
                        child: _isSaving
                            ? const SizedBox(
                                width: 20,
                                height: 20,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : Text(isEditing ? 'Salvar' : 'Adicionar'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPickerField({
    required String label,
    required String value,
    required IconData icon,
    required VoidCallback? onTap,
  }) {
    final theme = Theme.of(context);

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: Icon(icon, size: 20),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        ),
        child: Text(
          value.isNotEmpty ? value : 'Selecionar',
          style: theme.textTheme.bodyMedium?.copyWith(
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}
